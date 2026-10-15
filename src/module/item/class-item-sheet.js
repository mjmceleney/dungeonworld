import { DwItemSheet } from './item-sheet.js';
import { DwUtility } from "../utility.js";

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
    classes: ["class"],
    position: {
      width: 960,
      height: 640,
    },
    actions: {
      addListEntry: DwClassItemSheet.#onAddListEntry,
      deleteListEntry: DwClassItemSheet.#onDeleteListEntry,
      removeEquipment: DwClassItemSheet.#onRemoveEquipment,
    },
  };

  /* -------------------------------------------- */

  /** @override */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    let equipmentObjects = await this.item._getEquipmentObjects();
    for (let [group, group_items] of Object.entries(equipmentObjects)) {
      context.system.equipment[group]['objects'] = group_items;
    }
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
    await this._createEquipment(item.id, dropTarget.dataset.group);
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
    equipment: () => ({ label: '', mode: 'radio', items: [], objects: [] }),
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
      return field == 'equipment' ? { ...data, objects: [] } : data;
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
   * Remove a single item from an equipment group.
   * @this {DwClassItemSheet}
   * @param {PointerEvent} event
   * @param {HTMLElement} target
   */
  static async #onRemoveEquipment(event, target) {
    event.preventDefault();
    const itemId = target.closest('.tag')?.dataset.itemId;
    const groupId = target.closest('.item-container')?.dataset.group;
    if (!itemId || groupId === undefined) return;
    await this._deleteEquipment(itemId, groupId);
  }

  /* -------------------------------------------- */

  async _deleteEquipment(equipmentId, groupId) {
    const items = this.item.system.equipment?.[groupId]?.items ?? [];
    await this.item.update({
      [`system.equipment.${groupId}.items`]: items.filter(i => i != equipmentId),
    });
  }

  async _createEquipment(equipmentId, groupId) {
    let items = this.item.system.equipment?.[groupId]?.items;
    items = DwUtility.isEmpty(items) ? [] : [...items];

    // Append our item.
    if (!items.includes(equipmentId)) {
      items.push(equipmentId);
      await this.item.update({ [`system.equipment.${groupId}.items`]: items });
    }
  }
}
