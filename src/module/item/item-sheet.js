import { DwClassList } from "../config.js";
import { DwUtility } from "../utility.js";

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
    classes: ["dungeonworld", "sheet", "item"],
    position: {
      width: 520,
      height: 480,
    },
    window: {
      resizable: true,
    },
    form: {
      submitOnChange: true,
    },
  };

  /** @override */
  static PARTS = {
    sheet: {
      // Replaced with the item type's template in _configureRenderParts().
      template: "systems/dungeonworld/templates/items/move-sheet.html",
      scrollable: [".sheet-body"],
    },
  };

  /* -------------------------------------------- */

  /** @inheritdoc */
  _initializeApplicationOptions(options) {
    options = super._initializeApplicationOptions(options);

    // Core applies its light or dark theme to V2 windows, either from the
    // sheet's own theme setting or from the global color scheme. Use the same
    // choice for the system's dark styles so text and backgrounds match.
    let dark = DwUtility.nightmode;
    if (options.classes.includes('theme-dark')) dark = true;
    else if (options.classes.includes('theme-light')) dark = false;
    if (dark) options.classes.push('nightmode');
    return options;
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
        let tagArray = [];
        try {
          tagArray = JSON.parse(system.tags);
        } catch (e) {
          tagArray = [system.tags];
        }
        system.tagsString = tagArray.map((tag) => {
          return tag.value;
        }).join(', ');
      }
      // Otherwise, set tags equal to the string.
      else {
        system.tags = system.tagsString;
      }
    }

    return Object.assign(context, {
      item: item,
      system: system,
      nameEnriched: nameEnriched,
      cssClass: isEditable ? "editable" : "locked",
      editable: isEditable,
      owner: item.isOwner,
      limited: item.limited,
      selects: this._prepareSelects(system),
      tabs: this._prepareSheetTabs(),
    });
  }

  /**
   * Prepare the active state of each tab in the primary tab group.
   *
   * @return {Object} Tab state keyed by tab id, e.g. tabs.details.cssClass.
   */
  _prepareSheetTabs() {
    const activeTab = this.tabGroups.primary;
    const tabs = {};
    for (let id of ['description', 'details', 'equipment']) {
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
        radio: 'DW.ChooseOne',
        checkbox: 'DW.ChooseAny',
      };
    }
    return selects;
  }

  /* -------------------------------------------- */

  /** @inheritdoc */
  async _onRender(context, options) {
    await super._onRender(context, options);
    this._tagify(this.isEditable);
  }

  /** @inheritdoc */
  _onClose(options) {
    super._onClose(options);
    this._destroyTagify();
  }

  /* -------------------------------------------- */

  _destroyTagify() {
    if (this.tagify) {
      this.tagify.destroy();
      this.tagify = null;
    }
  }

  /**
   * Add tagging widget.
   */
  _tagify(editable) {
    // The previous instance belongs to markup that has been replaced.
    this._destroyTagify();

    const input = this.element.querySelector('.tags-input-source');
    if (!input) return;

    // Build the tags list.
    let tags = game.items.filter(item => item.type == 'tag').map(item => item.name);
    for (let c of game.packs) {
      if (c.metadata.type && c.metadata.type == 'Item' && c.metadata.name == 'tags') {
        let items = c?.index ? c.index.map(indexedItem => {
          return indexedItem.name;
        }) : [];
        tags = tags.concat(items);
      }
    }
    // Reduce duplicates.
    let tagNames = [...new Set(tags.map(tag => tag.toLowerCase()))];

    // Sort the tagnames list.
    tagNames.sort((a, b) => {
      const aSort = a.toLowerCase();
      const bSort = b.toLowerCase();
      if (aSort < bSort) {
        return -1;
      }
      if (aSort > bSort) {
        return 1;
      }
      return 0;
    });

    // Tagify!
    if (!editable) {
      input.readOnly = true;
    }

    this.tagify = new Tagify(input, {
      whitelist: tagNames,
      maxTags: 'Infinity',
      dropdown: {
        maxItems: 20,           // <- mixumum allowed rendered suggestions
        classname: "tags-look", // <- custom classname for this dropdown, so it could be targeted
        enabled: 0,             // <- show suggestions on focus
        closeOnSelect: false    // <- do not hide the suggestions dropdown once an item has been selected
      }
    });

    // TODO: Create tags that don't already exist on focus out. This is a
    // nice-to-have, but it's high risk due to how easy it will make it to
    // create extra tags unintentionally.
  }
}
