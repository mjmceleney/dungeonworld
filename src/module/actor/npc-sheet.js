import { DwCharacterSheet } from "./character-sheet.js";

const { TextEditor } = foundry.applications.ux;

const NPC_TEMPLATES = "systems/dungeonworld/templates/sheet/npc";
const CHARACTER_TEMPLATES = "systems/dungeonworld/templates/sheet/character";

/**
 * The Dungeon World NPC sheet, in the same style as the character sheet.
 *
 * It extends the character sheet for its actions, drag and drop, theming and
 * move rows, but has its own parts: a banner header with the name, tags and
 * special qualities; a stats band (HP, armor, damage); and Moves and
 * Description tabs. NPCs have no sidebar.
 * @extends {DwCharacterSheet}
 */
export class DwNpcSheet extends DwCharacterSheet {

  /** @inheritdoc */
  constructor(options = {}) {
    super(options);
    this.tagify = null;
  }

  /** @override */
  static DEFAULT_OPTIONS = {
    classes: ["dw-npc"],
    position: {
      width: 660,
      height: 720,
    },
  };

  /** @override */
  static PARTS = {
    header: { template: `${NPC_TEMPLATES}/header.html` },
    stats: { template: `${NPC_TEMPLATES}/stats.html` },
    tabs: { template: `${CHARACTER_TEMPLATES}/tabs.html` },
    moves: {
      template: `${CHARACTER_TEMPLATES}/tab-moves.html`,
      templates: [`${CHARACTER_TEMPLATES}/item-row.html`],
      scrollable: [''],
    },
    description: { template: `${NPC_TEMPLATES}/tab-description.html`, scrollable: [''] },
  };

  /** @override */
  static TAB_IDS = ['moves', 'description'];

  /* -------------------------------------------- */

  /** @override */
  async _prepareContext(options) {
    const context = await this._prepareDocumentContext(options);
    const actor = this.actor;
    const system = actor.system;
    const isEditable = this.isEditable;

    const [items, biography] = await Promise.all([
      this._prepareItems(),
      TextEditor.implementation.enrichHTML(system.details?.biography ?? '', {
        secrets: actor.isOwner,
        rollData: actor.getRollData(),
        relativeTo: actor,
      }),
    ]);

    const hp = Number(system.attributes.hp.value ?? 0);
    const hpMax = Number(system.attributes.hp.max ?? 0);

    return Object.assign(context, {
      actor: actor,
      system: system,
      editable: isEditable,
      owner: actor.isOwner,
      cssClass: isEditable ? 'editable' : 'locked',
      tabs: this._prepareSheetTabs(),
      bannerImg: actor.img && actor.img !== CONST.DEFAULT_TOKEN ? actor.img : null,

      hp: hp,
      hpMax: hpMax,
      hpPct: hpMax > 0 ? Math.max(0, Math.min(100, Math.round(100 * hp / hpMax))) : 0,
      hpState: hpMax > 0 && hp / hpMax <= 0.25 ? 'low' : (hpMax > 0 && hp / hpMax <= 0.5 ? 'mid' : 'high'),

      moveSections: this._prepareNpcMoveSections(items.moves),
      moveItemType: 'npcMove',
      biography: biography,
    });
  }

  /**
   * Group NPC moves into Basic, Special and (if any) Other sections.
   *
   * @param {Object[]} moves Prepared move rows.
   * @return {Object[]}
   */
  _prepareNpcMoveSections(moves) {
    const collapsed = this._getCollapsedState();
    const groups = { basic: [], special: [], other: [] };
    for (let move of moves) {
      (groups[move.moveType] ?? groups.other).push(move);
    }

    const section = (id, title, rows, createType) => ({
      id: id,
      title: title,
      rows: rows,
      count: rows.length,
      collapsed: collapsed[id] ?? this._isCollapsedByDefault(id),
      canCreate: createType !== null,
      createType: createType,
      emptyText: game.i18n.localize('DW.Sheet.NoMoves'),
    });

    const sections = [
      section('basic', game.i18n.localize('DW.MovesBasic'), groups.basic, 'basic'),
      section('special', game.i18n.localize('DW.MovesSpecial'), groups.special, 'special'),
    ];
    if (groups.other.length) {
      sections.push(section('other', game.i18n.localize('DW.MovesOther'), groups.other, null));
    }
    return sections;
  }

  /** @override */
  _isCollapsedByDefault(id) {
    // An NPC has few moves; show them all until the GM collapses a section.
    return false;
  }

  /* -------------------------------------------- */

  /** @inheritdoc */
  async _onRender(context, options) {
    await super._onRender(context, options);
    this._activateTagging();
  }

  /** @inheritdoc */
  _onClose(options) {
    super._onClose(options);
    this._destroyTagify();
  }

  _destroyTagify() {
    if (this.tagify) {
      this.tagify.destroy();
      this.tagify = null;
    }
  }

  /**
   * Turn the tags field into a Tagify widget, suggesting tag items from the
   * world and the Tags compendium. Tagify writes the tags back into the field
   * and fires its change event, which saves the sheet.
   */
  _activateTagging() {
    // The previous instance belongs to markup that has been replaced.
    this._destroyTagify();

    const input = this.element.querySelector('.tags-input-source');
    if (!input) return;

    let tags = game.items.filter(item => item.type == 'tag').map(item => item.name);
    for (let pack of game.packs) {
      if (pack.metadata.type == 'Item' && pack.metadata.name == 'tags') {
        tags = tags.concat(pack.index?.map(entry => entry.name) ?? []);
      }
    }
    const tagNames = [...new Set(tags.map(tag => tag.toLowerCase()))].sort();

    if (!this.isEditable) input.readOnly = true;
    this.tagify = new Tagify(input, {
      whitelist: tagNames,
      maxTags: 'Infinity',
      dropdown: {
        maxItems: 20,
        classname: "tags-look",
        enabled: 0,
        closeOnSelect: false,
      },
    });
  }
}
