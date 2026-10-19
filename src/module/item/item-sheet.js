import { DwClassList } from "../config.js";
import { DwUtility } from "../utility.js";
import { DwMoves } from "../moves.js";
import { DwMoveActions } from "../move-actions.js";

const { HandlebarsApplicationMixin } = foundry.applications.api;
const { ItemSheetV2 } = foundry.applications.sheets;
const { TextEditor } = foundry.applications.ux;

/**
 * Item sheet for all Dungeon World item types, built on ApplicationV2.
 * @extends {ItemSheetV2}
 */
export class DwItemSheet extends HandlebarsApplicationMixin(ItemSheetV2) {

  /** @inheritdoc */
  constructor(options = {}) {
    super(options);

    this.tagify = null;

    // Tab to show when the sheet is first opened.
    this.tabGroups.primary ??= "description";
  }

  /** @override */
  static DEFAULT_OPTIONS = {
    classes: ["dw-v2", "dw-item"],
    position: {
      width: 560,
      height: 600,
    },
    window: {
      resizable: true,
    },
    form: {
      submitOnChange: true,
    },
    actions: {
      addMoveAction: DwItemSheet.#onAddMoveAction,
      removeMoveAction: DwItemSheet.#onRemoveMoveAction,
    },
  };

  /** @override */
  static PARTS = {
    sheet: {
      // Replaced with the item type's template in _configureRenderParts().
      template: "systems/dungeonworld/templates/items/move-sheet.html",
      templates: [
        "systems/dungeonworld/templates/items/parts/item-header.html",
        "systems/dungeonworld/templates/items/parts/item-effects.html",
      ],
      scrollable: [".dw-panel"],
    },
  };

  /* -------------------------------------------- */

  /** @inheritdoc */
  _initializeApplicationOptions(options) {
    // Match core's light or dark theme choice.
    return DwUtility.applyThemeClass(super._initializeApplicationOptions(options));
  }

  /** @override */
  get title() {
    return this.document.name;
  }

  /** @inheritdoc */
  _configureRenderParts(options) {
    const parts = super._configureRenderParts(options);
    parts.sheet.template = `systems/dungeonworld/templates/items/${this.item.type}-sheet.html`;
    return parts;
  }

  /* -------------------------------------------- */

  /** @override */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const item = this.item;
    const isEditable = this.isEditable;
    const system = foundry.utils.duplicate(item.system);

    // Prepare enrichment options.
    const enrichmentOptions = {
      secrets: item.isOwner,
      rollData: item.getRollData(),
      relativeTo: item
    };
    const enrich = (text) => TextEditor.implementation.enrichHTML(text ?? '', enrichmentOptions);

    // Load the class list and enrich every field concurrently.
    const hasMoveResults = (item.type == 'move' || item.type == 'npcMove') && system.moveResults;
    const moveResults = hasMoveResults ? Object.entries(system.moveResults) : [];
    const [classlist, descriptionEnriched, choicesEnriched, nameEnriched, ...moveResultsEnriched] = await Promise.all([
      DwClassList.getClasses(),
      enrich(system.description),
      system.choices ? enrich(system.choices) : null,
      item.type == 'bond' ? enrich(item.name) : null,
      ...moveResults.map(([key, result]) => enrich(result.value)),
    ]);

    system.classlist = classlist;
    system.descriptionEnriched = descriptionEnriched;
    if (system.choices) system.choicesEnriched = choicesEnriched;
    moveResults.forEach(([key, result], i) => {
      result.key = `system.moveResults.${key}.value`;
      result.enriched = moveResultsEnriched[i];
    });

    // Handle preprocessing for tagify data.
    if (item.type == 'equipment') {
      // If there are tags, convert it into a string.
      if (system.tags != undefined && system.tags != '') {
        system.tagsString = DwUtility.parseTags(system.tags).join(', ');
      }
      // Otherwise, set tags equal to the string.
      else {
        system.tags = system.tagsString;
      }
    }

    // A move's effect lines, each with the settings its kind uses.
    const amountHints = {
      formula: 'DW.MoveActions.AmountFormula',
      dice: 'DW.MoveActions.AmountDice',
      count: 'DW.MoveActions.AmountCount',
      number: 'DW.MoveActions.AmountNumber',
    };
    const moveActions = ['move', 'spell'].includes(item.type) ? DwMoveActions.lines(item).map(line => {
      const config = DwMoveActions.TYPES[line.type];
      return {
        ...line,
        fields: config,
        amountHint: amountHints[config.amount] ?? '',
        // Lay on Hands' 7-9: what's healed or removed passes to the character.
        canTransfer: config.transfer && line.target != 'self',
      };
    }) : [];

    const selects = this._prepareSelects(system);
    return Object.assign(context, {
      moveActions,
      item: item,
      system: system,
      nameEnriched: nameEnriched,
      cssClass: isEditable ? "editable" : "locked",
      editable: isEditable,
      owner: item.isOwner,
      limited: item.limited,
      selects: selects,
      tabs: this._prepareSheetTabs(),
      typeLabel: this._prepareTypeLabel(system, selects),
    });
  }

  /**
   * A short description of the item for the header, e.g. "Move · Advanced"
   * or "Spell · Level 3".
   *
   * @param {Object} system The item's prepared system data.
   * @param {Object} selects From _prepareSelects().
   *
   * @return {string}
   */
  _prepareTypeLabel(system, selects) {
    const type = this.item.type;
    const parts = [game.i18n.localize(CONFIG.Item.typeLabels?.[type] ?? type)];
    const detail = {
      move: { basic: 'DW.MoveBasic', starting: 'DW.MoveStarting', advanced: 'DW.MoveAdvanced', special: 'DW.MoveSpecial' }[system.moveType],
      npcMove: { basic: 'DW.MoveBasic', special: 'DW.MoveSpecial' }[system.moveType],
      spell: system.spellLevel !== undefined && system.spellLevel !== null ? `DW.Spells${system.spellLevel}` : null,
      equipment: selects.itemTypes?.[system.itemType],
    }[type];
    if (detail) parts.push(game.i18n.localize(detail));
    if ((type == 'move' || type == 'spell') && system.class) parts.push(system.class);
    return parts.join(' · ');
  }

  /**
   * Prepare the active state of each tab in the primary tab group.
   *
   * @return {Object} Tab state keyed by tab id, e.g. tabs.details.cssClass.
   */
  _prepareSheetTabs() {
    const activeTab = this.tabGroups.primary;
    const tabs = {};
    for (let id of ['description', 'details', 'equipment', 'effects']) {
      tabs[id] = {
        active: activeTab == id,
        cssClass: activeTab == id ? 'active' : '',
      };
    }
    return tabs;
  }

  /**
   * Prepare the options for each select element on the sheet.
   *
   * @param {Object} system The item's prepared system data.
   *
   * @return {Object}
   */
  _prepareSelects(system) {
    const type = this.item.type;
    const selects = {};
    if (type == 'equipment') {
      selects.itemTypes = {
        weapon: 'DW.Weapon',
        armor: 'DW.Armor',
        dungeongear: 'DW.DungeonGear',
        poison: 'DW.Poison',
        service: 'DW.Service',
        meal: 'DW.Meal',
        transport: 'DW.Transport',
        landbuilding: 'DW.LandBuildings',
        bribe: 'DW.Bribe',
        giftsfinery: 'DW.GiftsFinery',
        hoard: 'DW.Hoard',
      };
      selects.useTargets = {
        self: 'DW.Use.TargetSelf',
        other: 'DW.Use.TargetOther',
      };
    }
    if (type == 'spell' || type == 'move') {
      selects.classes = {};
      for (let k of system.classlist) {
        selects.classes[k] = k;
      }
    }
    if (type == 'npcMove') {
      selects.moveTypes = {
        basic: 'DW.MoveBasic',
        special: 'DW.MoveSpecial',
      };
    }
    if (type == 'move') {
      selects.moveTypes = {
        basic: 'DW.MoveBasic',
        starting: 'DW.MoveStarting',
        advanced: 'DW.MoveAdvanced',
        special: 'DW.MoveSpecial',
      };

      selects.rollTypes = {
        STR: 'DW.STR',
        DEX: 'DW.DEX',
        CON: 'DW.CON',
        INT: 'DW.INT',
        WIS: 'DW.WIS',
        CHA: 'DW.CHA',
        ASK: 'DW.ASK',
        BOND: 'DW.Modifier',
        FORMULA: 'DW.FORMULA',
        PLAIN: 'DW.PLAIN',
      };

      selects.automations = DwMoves.choices(system.automation);

      selects.ignoreClumsy = {
        armor: 'DW.IgnoreClumsy.Armor',
        all: 'DW.IgnoreClumsy.All',
      };

      selects.healBonusTargets = {
        any: 'DW.HealBonus.Anyone',
        other: 'DW.HealBonus.Others',
      };

      selects.grantKinds = {
        move: 'DW.Grants.Move',
        spell: 'DW.Grants.Spell',
      };
    }
    // Effects, on moves and spells.
    if (type == 'move' || type == 'spell') {
      selects.moveActionTypes = Object.fromEntries(Object.entries(DwMoveActions.TYPES).map(([key, { label }]) => [key, label]));
      selects.moveActionTargets = DwMoveActions.TARGETS;
      selects.moveActionConditions = Object.fromEntries(DwMoveActions.conditions().map(({ id, name }) => [id, name]));
      selects.moveActionStats = {
        str: 'DW.STR', dex: 'DW.DEX', con: 'DW.CON', int: 'DW.INT', wis: 'DW.WIS', cha: 'DW.CHA',
      };
      selects.actionWhen = {
        always: 'DW.Resource.Always',
        hit: 'DW.Resource.Hit',
        partial: 'DW.Resource.Partial',
        success: 'DW.Resource.Success',
      };
    }
    if (type == 'class') {
      selects.damages = {
        d4: 'd4',
        d6: 'd6',
        d8: 'd8',
        d10: 'd10',
        d12: 'd12',
      };
      selects.equipmentGroupModes = {
        all: 'DW.Gear.ModeAll',
        radio: 'DW.Gear.ModeOne',
        checkbox: 'DW.Gear.ModeSome',
      };
    }
    return selects;
  }

  /* -------------------------------------------- */

  /** @inheritdoc */
  _processFormData(event, form, formData) {
    const data = super._processFormData(event, form, formData);
    // Effect lines come in as {0: {...}, 1: {...}}; they're kept as a list.
    const actions = data.system?.actions;
    if (actions && !Array.isArray(actions)) {
      data.system.actions = Object.keys(actions).sort((a, b) => a - b).map(key => actions[key]);
    }
    return data;
  }

  /** Add an effect line to a move or spell. A spell's works on a hit. */
  static #onAddMoveAction() {
    const actions = DwMoveActions.lines(this.item).map(line => ({ ...line }));
    const when = this.item.type == 'spell' ? 'hit' : 'always';
    actions.push({ type: 'heal', target: 'self', amount: '', stat: '', condition: '', name: '', when, transfer: false });
    return this.item.update({ 'system.actions': actions });
  }

  /** Remove one of a move's effect lines. */
  static #onRemoveMoveAction(event, target) {
    const index = Number(target.dataset.index);
    const actions = DwMoveActions.lines(this.item).filter((line, i) => i != index);
    return this.item.update({ 'system.actions': actions });
  }

  /** @inheritdoc */
  async _onRender(context, options) {
    await super._onRender(context, options);
    // Add the tagging widget. The previous one belongs to replaced markup.
    this.tagify?.destroy();
    const input = this.element.querySelector('.tags-input-source');
    this.tagify = input ? DwUtility.tagify(input, this.isEditable) : null;
    // TODO: Create tags that don't already exist on focus out. This is a
    // nice-to-have, but it's high risk due to how easy it will make it to
    // create extra tags unintentionally.
  }

  /** @inheritdoc */
  _onClose(options) {
    super._onClose(options);
    this.tagify?.destroy();
    this.tagify = null;
  }
}
