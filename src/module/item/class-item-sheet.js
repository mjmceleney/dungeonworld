import { DwItemSheet } from './item-sheet.js';
import { DwUtility } from "../utility.js";
import { DwClassGear } from "./class-gear.js";

/**
 * Item sheet for class items: races, alignments, settings, and the starting
 * equipment groups that the level up dialog offers.
 * @extends {DwItemSheet}
 */
export class DwClassItemSheet extends DwItemSheet {

  /** @inheritdoc */
  constructor(options = {}) {
    super(options);

    // Class sheets open on the equipment tab.
    this.tabGroups.primary = "equipment";
  }

  /** @override */
  static DEFAULT_OPTIONS = {
    classes: ["dw-item-class"],
    position: {
      width: 960,
      height: 640,
    },
    actions: {
      addListEntry: DwClassItemSheet.#onAddListEntry,
      deleteListEntry: DwClassItemSheet.#onDeleteListEntry,
      removeEquipment: DwClassItemSheet.#onRemoveEquipment,
      removeGearOption: DwClassItemSheet.#onRemoveGearOption,
    },
  };

  /* -------------------------------------------- */

  /** @override */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const names = new Map();
    for (const item of await DwUtility.getEquipment() || []) {
      if (!names.has(item.id)) names.set(item.id, item.name);
    }
    context.gearGroups = Object.entries(this.item.system.equipment ?? {}).filter(([, group]) => group).map(([key, group]) => ({
      key,
      label: group.label ?? '',
      mode: ['all', 'radio', 'checkbox'].includes(group.mode) ? group.mode : 'radio',
      count: Number(group.count) || 0,
      options: DwClassGear.options(group).map((option, index) => ({
        key: String(index),
        coins: option.coins,
        items: option.items.map(id => ({
          id,
          name: names.get(id) ?? `? ${id}`,
          quantity: Math.max(1, Number(option.quantities?.[id]) || 1),
        })),
      })),
    }));
    return context;
  }

  /** @inheritdoc */
  async _onRender(context, options) {
    await super._onRender(context, options);

    // Equipment drop targets. These handle the drop themselves so that it
    // doesn't also reach the sheet's default drop handling.
    for (let dropArea of this.element.querySelectorAll('.drop-area')) {
      dropArea.addEventListener('dragover', this._onDragOverEquipment.bind(this));
      dropArea.addEventListener('dragleave', this._onDragLeaveEquipment.bind(this));
      dropArea.addEventListener('drop', this._onDropEquipment.bind(this));
    }

    // An item's quantity and an option's coins.
    for (let input of this.element.querySelectorAll('[data-gear-quantity], [data-gear-coins]')) {
      input.addEventListener('change', event => {
        event.stopPropagation();
        const row = input.closest('[data-option]');
        const itemId = input.closest('[data-item-id]')?.dataset.itemId;
        this._changeOption(row.dataset.group, Number(row.dataset.option), option => {
          if (input.hasAttribute('data-gear-coins')) option.coins = Math.max(0, Math.round(Number(input.value) || 0));
          else if (itemId) {
            const quantity = Math.max(1, Math.round(Number(input.value) || 1));
            if (quantity > 1) option.quantities[itemId] = quantity;
            else delete option.quantities[itemId];
          }
        });
      });
    }
  }

  /* -------------------------------------------- */

  _onDragOverEquipment(event) {
    event.preventDefault();
    event.currentTarget.classList.add('drop-hover');
  }

  _onDragLeaveEquipment(event) {
    event.currentTarget.classList.remove('drop-hover');
  }

  async _onDropEquipment(event) {
    event.preventDefault();
    event.stopPropagation();
    const dropTarget = event.currentTarget;
    dropTarget.classList.remove('drop-hover');
    if (!this.isEditable) return;

    // Get data.
    let itemData;
    try {
      itemData = JSON.parse(event.dataTransfer.getData('text/plain'));
      if (itemData.type !== "Item") return;
    } catch (err) {
      return;
    }

    const item = await Item.fromDropData(itemData);
    if (!item) return;
    const { group, option } = dropTarget.dataset;
    if (option === undefined) return;
    // The last row starts a new option; any other row adds to its option, or
    // gives one more of an item it already has.
    if (option == 'new') return this._saveOptions(group, [...this._options(group), { items: [item.id], quantities: {}, coins: 0 }]);
    return this._changeOption(group, Number(option), entry => {
      if (entry.items.includes(item.id)) entry.quantities[item.id] = (Number(entry.quantities[item.id]) || 1) + 1;
      else entry.items.push(item.id);
    });
  }

  /* -------------------------------------------- */

  /**
   * The list fields that can be added to and removed from on the class sheet.
   *
   * Each list is stored as an object keyed by index ("0", "1", ...). The level
   * up dialog relies on those keys, so they're kept contiguous.
   */
  static LIST_DEFAULTS = {
    races: () => ({ label: '', description: '' }),
    alignments: () => ({ label: '', description: '' }),
    equipment: () => ({ label: '', mode: 'radio', count: 0, items: [], options: [] }),
  };

  /**
   * Add an empty entry to a race, alignment, or equipment group list.
   * @this {DwClassItemSheet}
   * @param {PointerEvent} event
   * @param {HTMLElement} target
   */
  static async #onAddListEntry(event, target) {
    event.preventDefault();
    const field = target.dataset.type;
    const createEntry = DwClassItemSheet.LIST_DEFAULTS[field];
    if (!createEntry) return;

    const entries = this.item.system[field] ?? {};
    const nextKey = Object.keys(entries).length;
    await this.item.update({ [`system.${field}.${nextKey}`]: createEntry() });
  }

  /**
   * Delete an entry from a race, alignment, or equipment group list, then
   * re-index the remaining entries so the keys stay contiguous.
   * @this {DwClassItemSheet}
   * @param {PointerEvent} event
   * @param {HTMLElement} target
   */
  static async #onDeleteListEntry(event, target) {
    event.preventDefault();
    const field = target.dataset.type;
    if (!DwClassItemSheet.LIST_DEFAULTS[field]) return;
    const deleteKey = target.closest('[data-index]')?.dataset.index;
    if (deleteKey === undefined) return;

    const entries = this.item.system[field] ?? {};
    const oldKeys = Object.keys(entries);
    const remaining = Object.entries(entries).filter(([key]) => key != deleteKey).map(([key, value]) => {
      // Equipment groups can hold prepared item documents in `objects`;
      // those are display-only and must not be saved.
      const { objects, ...data } = foundry.utils.deepClone(value);
      return data;
    });

    const update = {};
    remaining.forEach((value, index) => {
      update[`system.${field}.${index}`] = value;
    });
    for (let key of oldKeys) {
      if (Number(key) >= remaining.length || isNaN(Number(key))) {
        Object.assign(update, DwUtility.deletionUpdate(`system.${field}.${key}`));
      }
    }
    await this.item.update(update);
  }

  /**
   * Remove an item from a gear option. An option left with nothing in it
   * goes too.
   * @this {DwClassItemSheet}
   */
  static async #onRemoveEquipment(event, target) {
    event.preventDefault();
    const itemId = target.closest('[data-item-id]')?.dataset.itemId;
    const row = target.closest('[data-option]');
    if (!itemId || !row) return;
    const options = this._options(row.dataset.group);
    const option = options[Number(row.dataset.option)];
    if (!option) return;
    option.items = option.items.filter(id => id != itemId);
    delete option.quantities[itemId];
    await this._saveOptions(row.dataset.group, options.filter(o => o.items.length || o.coins));
  }

  /** @this {DwClassItemSheet} */
  static async #onRemoveGearOption(event, target) {
    event.preventDefault();
    const row = target.closest('[data-option]');
    if (!row) return;
    const options = this._options(row.dataset.group);
    options.splice(Number(row.dataset.option), 1);
    await this._saveOptions(row.dataset.group, options);
  }

  /* -------------------------------------------- */

  /** A gear group's options, as a copy to change and save. */
  _options(groupId) {
    return foundry.utils.deepClone(DwClassGear.options(this.item.system.equipment?.[groupId]));
  }

  /** Change one gear option and save the group. */
  async _changeOption(groupId, index, change) {
    const options = this._options(groupId);
    if (!options[index]) return;
    change(options[index]);
    await this._saveOptions(groupId, options);
  }

  /**
   * Save a gear group's options, and the list of every item they use (which
   * older code reads).
   */
  async _saveOptions(groupId, options) {
    if (this.item.system.equipment?.[groupId] === undefined) return;
    await this.item.update({
      [`system.equipment.${groupId}.options`]: options,
      [`system.equipment.${groupId}.items`]: DwClassGear.itemIds(options),
    });
  }
}
