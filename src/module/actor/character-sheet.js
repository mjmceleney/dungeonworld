import { DwClassList, ABILITY_ICONS } from "../config.js";
import { DwUtility } from "../utility.js";
import { DwRolls } from "../rolls.js";
import { DwLevelUp } from "./level-up.js";

const { HandlebarsApplicationMixin, DialogV2 } = foundry.applications.api;
const { ActorSheetV2 } = foundry.applications.sheets;
const { TextEditor, DragDrop, FormDataExtended } = foundry.applications.ux;

const TEMPLATES = "systems/dungeonworld/templates/sheet/character";

/** Sections that start collapsed until the player opens them. */
const DEFAULT_COLLAPSED = ['special', 'other'];


/** Spell levels, in display order. */
const SPELL_LEVELS = [0, 1, 3, 5, 7, 9];

/**
 * Normalize a class name so that "The Fighter", "Fighter" and "fighter" match.
 *
 * @param {string} name
 * @return {string}
 */
function classKey(name) {
  return DwUtility.cleanClass(String(name ?? '').trim()).replace(/^the-/, '');
}

/**
 * Display name for a class, without a leading "The".
 *
 * @param {string} name
 * @return {string}
 */
function classLabel(name) {
  return String(name ?? '').trim().replace(/^the\s+/i, '');
}

/**
 * The Dungeon World character sheet, built on ApplicationV2.
 *
 * Each region of the sheet is a separate template part (header with HP,
 * armor and damage; abilities and roll modifiers; tab navigation; one part
 * per tab; and the sidebar). The parts are laid out with CSS grid on the
 * window content. Load and coin live on the Equipment tab.
 * @extends {ActorSheetV2}
 */
export class DwCharacterSheet extends HandlebarsApplicationMixin(ActorSheetV2) {

  /** @inheritdoc */
  constructor(options = {}) {
    super(options);

    // Tab to show when the sheet is first opened.
    this.tabGroups.primary ??= "moves";

    /** Ids of items whose details are expanded. */
    this._expanded = new Set();

    /** Current move search text. */
    this._moveQuery = '';

    /** Section collapse state for users who can't save it to the actor. */
    this._localCollapsed = {};
  }

  /** @override */
  static DEFAULT_OPTIONS = {
    classes: ["dw-v2", "dw-character"],
    position: {
      width: 920,
      height: 900,
    },
    window: {
      resizable: true,
    },
    form: {
      submitOnChange: true,
    },
    actions: {
      rollAbility: DwCharacterSheet.#onRollAbility,
      rollDamage: DwCharacterSheet.#onRollDamage,
      rollItem: DwCharacterSheet.#onRollItem,
      adjustResource: DwCharacterSheet.#onAdjustResource,
      adjustCounter: DwCharacterSheet.#onAdjustCounter,
      levelUp: DwCharacterSheet.#onLevelUp,
      viewClass: DwCharacterSheet.#onViewClass,
      createItem: DwCharacterSheet.#onCreateItem,
      editItem: DwCharacterSheet.#onEditItem,
      deleteItem: DwCharacterSheet.#onDeleteItem,
      toggleDetails: DwCharacterSheet.#onToggleDetails,
      toggleFavorite: DwCharacterSheet.#onToggleFavorite,
      toggleSection: DwCharacterSheet.#onToggleSection,
      toggleEquipped: DwCharacterSheet.#onToggleEquipped,
      togglePrepared: DwCharacterSheet.#onTogglePrepared,
      addTracker: DwCharacterSheet.#onAddTracker,
      editTracker: DwCharacterSheet.#onEditTracker,
      adjustTracker: DwCharacterSheet.#onAdjustTracker,
    },
  };

  /** @override */
  static PARTS = {
    header: { template: `${TEMPLATES}/header.html` },
    stats: { template: `${TEMPLATES}/stats.html` },
    tabs: { template: `${TEMPLATES}/tabs.html` },
    moves: {
      template: `${TEMPLATES}/tab-moves.html`,
      templates: [`${TEMPLATES}/item-row.html`],
      scrollable: [''],
    },
    equipment: {
      template: `${TEMPLATES}/tab-equipment.html`,
      templates: [`${TEMPLATES}/item-row.html`],
      scrollable: [''],
    },
    spells: {
      template: `${TEMPLATES}/tab-spells.html`,
      templates: [`${TEMPLATES}/item-row.html`],
      scrollable: [''],
    },
    character: { template: `${TEMPLATES}/tab-character.html`, scrollable: [''] },
    sidebar: { template: `${TEMPLATES}/sidebar.html`, scrollable: [''] },
  };

  /** Ids of the tabs in the primary tab group, in display order. */
  static TAB_IDS = ['moves', 'equipment', 'spells', 'character'];

  /* -------------------------------------------- */

  /** @inheritdoc */
  _initializeApplicationOptions(options) {
    options = super._initializeApplicationOptions(options);

    // Match core's light or dark theme choice for this sheet.
    let dark = DwUtility.nightmode;
    if (options.classes.includes('theme-dark')) dark = true;
    else if (options.classes.includes('theme-light')) dark = false;
    if (dark) options.classes.push('dw-dark');
    return options;
  }

  /** @override */
  get title() {
    return this.document.name;
  }

  /* -------------------------------------------- */
  /*  Context                                     */
  /* -------------------------------------------- */

  /**
   * The document sheet's own context, without any character data. Lets
   * subclasses such as the NPC sheet build their own context from scratch.
   *
   * @param {Object} options
   * @return {Promise<Object>}
   */
  _prepareDocumentContext(options) {
    return super._prepareContext(options);
  }

  /** @override */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const actor = this.actor;
    const system = actor.system;
    const isEditable = this.isEditable;

    const enrichmentOptions = {
      secrets: actor.isOwner,
      rollData: actor.getRollData(),
      relativeTo: actor,
    };
    const enrich = (text) => TextEditor.implementation.enrichHTML(text ?? '', enrichmentOptions);

    // Start loading the class list and enriching every field at once.
    const classlistPromise = DwClassList.getClasses();
    const detailsPromise = Promise.all([
      enrich(system.details.look),
      enrich(system.details.alignment?.description),
      enrich(system.details.race?.description),
      enrich(system.details.biography),
    ]);
    const items = await this._prepareItems();
    const [classlist, [look, alignment, race, biography]] = await Promise.all([classlistPromise, detailsPromise]);

    const moveSections = this._prepareMoveSections(items.moves);
    const level = Number(system.attributes.level.value ?? 1);
    const xp = Number(system.attributes.xp.value ?? 0);
    const xpMax = Number(system.attributes.xp.max ?? level + 7);
    const hp = Number(system.attributes.hp.value ?? 0);
    const hpMax = Number(system.attributes.hp.max ?? 0);
    const weight = Number(system.attributes.weight.value ?? 0);
    const weightMax = Number(system.attributes.weight.max ?? 0);

    return Object.assign(context, {
      actor: actor,
      system: system,
      editable: isEditable,
      owner: actor.isOwner,
      cssClass: isEditable ? 'editable' : 'locked',
      isToken: actor.token != null,
      noAbilityScores: game.settings.get('dungeonworld', 'noAbilityScores'),
      tabs: this._prepareSheetTabs(),

      // Header. The portrait doubles as a faded banner behind the header,
      // except for the default silhouette.
      bannerImg: actor.img && actor.img !== CONST.DEFAULT_TOKEN ? actor.img : null,
      classlist: classlist,
      multiclass: moveSections.multiclass,
      level: level,
      xp: xp,
      xpMax: xpMax,
      xpPct: xpMax > 0 ? Math.min(100, Math.round(100 * xp / xpMax)) : 0,
      levelUp: this._prepareLevelUp({ level, xp, xpMax, classlist, startingMoves: items.startingCount }),

      // Vitals.
      hp: hp,
      hpMax: hpMax,
      hpPct: hpMax > 0 ? Math.max(0, Math.min(100, Math.round(100 * hp / hpMax))) : 0,
      hpState: hpMax > 0 && hp / hpMax <= 0.25 ? 'low' : (hpMax > 0 && hp / hpMax <= 0.5 ? 'mid' : 'high'),
      damageFormula: `${system.attributes.damage.value ?? ''}${system.attributes.damage.misc ? '+' + system.attributes.damage.misc : ''}`,
      damages: { d4: 'd4', d6: 'd6', d8: 'd8', d10: 'd10', d12: 'd12' },
      weight: weight,
      weightMax: weightMax,
      encumbered: weight > weightMax,
      weightSpare: Math.max(0, weightMax - weight),

      // Stats.
      abilities: this._prepareAbilities(),
      forwardText: DwCharacterSheet.#signed(system.attributes.forward?.value),
      ongoingText: DwCharacterSheet.#signed(system.attributes.ongoing?.value),
      rollModes: this._prepareRollModes(),

      // Tabs.
      moveSections: moveSections.sections,
      moveItemType: 'move',
      moveQuery: this._moveQuery,
      equipment: items.equipment,
      spellLevels: items.spellLevels,
      enriched: { look, alignment, race, biography },

      // Sidebar.
      trackers: this._prepareTrackers(),
      bonds: items.bonds,
    });
  }

  /** @override */
  async _preparePartContext(partId, context, options) {
    context = await super._preparePartContext(partId, context, options);
    if (this.constructor.TAB_IDS.includes(partId)) context.tab = context.tabs[partId];
    return context;
  }

  /**
   * Prepare the active state of each tab in the primary tab group.
   *
   * @return {Object}
   */
  _prepareSheetTabs() {
    const labels = {
      moves: 'DW.Moves',
      equipment: 'DW.Equipment',
      spells: 'DW.Spells',
      character: 'DW.Sheet.Character_Tab',
      description: 'DW.Description',
    };
    const active = this.tabGroups.primary;
    const tabs = {};
    for (let id of this.constructor.TAB_IDS) {
      tabs[id] = {
        id: id,
        group: 'primary',
        label: labels[id],
        active: active == id,
        cssClass: active == id ? 'active' : '',
      };
    }
    return tabs;
  }

  /**
   * Decide whether the character can level up, and if not, why.
   *
   * @return {{ready: boolean, hint: string}}
   */
  _prepareLevelUp({ level, xp, xpMax, classlist, startingMoves }) {
    // Same check as the level up dialog, which needs the exact class name.
    const className = this.actor.system.details.class ?? '';
    const known = classlist.includes(className) || classlist.includes(className.trim());

    if (this.actor.token != null) {
      return { ready: false, hint: game.i18n.localize('DW.Sheet.UnlinkedToken') };
    }
    if (level >= 10) {
      return { ready: false, hint: game.i18n.localize('DW.Sheet.MaxLevel') };
    }
    // A new character can always use the builder to pick starting moves.
    const eligible = xp >= xpMax || (level === 1 && startingMoves < 1);
    if (!eligible) {
      return { ready: false, hint: game.i18n.format('DW.Sheet.NeedsXp', { xp: xpMax - xp }) };
    }
    // Only mention the class once it's what's actually blocking the level up.
    if (!known) {
      return { ready: false, hint: game.i18n.localize('DW.Sheet.ClassUnknown') };
    }
    return { ready: true, hint: game.i18n.localize('DW.Sheet.LevelUpReady') };
  }

  _prepareAbilities() {
    const abilities = [];
    for (let [key, ability] of Object.entries(this.actor.system.abilities ?? {})) {
      abilities.push({
        key: key,
        icon: ABILITY_ICONS[key] ?? 'fa-circle',
        abbr: game.i18n.localize(`DW.${key.toUpperCase()}`),
        label: ability.label ?? key,
        value: ability.value,
        mod: ability.mod,
        modText: DwCharacterSheet.#signed(ability.mod),
        debility: !!ability.debility,
        debilityLabel: ability.debilityLabel ?? '',
      });
    }
    return abilities;
  }

  /**
   * The character's custom trackers, in the order they were added. Stored in
   * flags.dungeonworld.trackers, keyed by id: {label, value, max, sort}.
   * A max of 0 means the tracker has no maximum.
   *
   * @return {Object[]}
   */
  _prepareTrackers() {
    const trackers = this.actor.flags?.dungeonworld?.trackers ?? {};
    return Object.entries(trackers)
      .filter(([id, tracker]) => tracker && typeof tracker == 'object')
      .map(([id, tracker]) => ({
        id: id,
        label: tracker.label ?? '',
        value: Number(tracker.value) || 0,
        max: Number(tracker.max) || 0,
        sort: Number(tracker.sort) || 0,
      }))
      .sort((a, b) => a.sort - b.sort);
  }

  _prepareRollModes() {
    const current = this.actor.flags?.dungeonworld?.rollMode ?? 'def';
    return [
      { value: 'def', label: 'DW.Normal' },
      { value: 'adv', label: 'DW.Advantage' },
      { value: 'dis', label: 'DW.Disadvantage' },
    ].map(mode => ({ ...mode, checked: mode.value == current }));
  }

  /**
   * Prepare every owned item for display, enriching text concurrently.
   *
   * @return {Promise<Object>}
   */
  async _prepareItems() {
    const actor = this.actor;
    const secrets = actor.isOwner;
    const enrichments = [];
    const enrich = (target, key, text, item) => {
      enrichments.push(TextEditor.implementation.enrichHTML(text ?? '', {
        secrets: secrets,
        rollData: item.getRollData(),
        relativeTo: item,
      }).then(html => target[key] = html));
    };

    const moves = [];
    const equipment = [];
    const bonds = [];
    const spellsByLevel = {};
    let startingCount = 0;

    const items = actor.items.contents.sort((a, b) => (a.sort || 0) - (b.sort || 0));
    for (let item of items) {
      const system = item.system;
      const row = {
        id: item.id,
        uuid: item.uuid,
        name: item.name,
        img: item.img,
        type: item.type,
        expanded: this._expanded.has(item.id),
        favorite: !!item.flags?.dungeonworld?.favorite,
        isMove: item.type == 'move' || item.type == 'npcMove',
        canFavorite: item.type == 'move',
        isEquipment: item.type == 'equipment',
        isSpell: item.type == 'spell',
        results: [],
      };
      if (system.description) enrich(row, 'description', system.description, item);

      if (item.type == 'move' || item.type == 'npcMove') {
        // NPC moves only have a roll formula; show it in place of a stat.
        const rollType = item.type == 'npcMove' ? (system.rollFormula ? 'FORMULA' : '') : (system.rollType ?? '');
        row.moveType = system.moveType ?? '';
        row.className = system.class ?? '';
        row.rollIcon = item.type == 'npcMove'
          ? (system.rollFormula ? 'formula' : 'none')
          : (rollType ? 'dice' : (system.rollFormula ? 'formula' : 'none'));
        row.stat = rollType == 'FORMULA' ? (system.rollFormula ?? '')
          : (rollType == 'BOND' ? game.i18n.localize('DW.Modifier')
          : (rollType ? game.i18n.localize(`DW.${rollType}`) : ''));
        if (row.moveType == 'advanced' && Number(system.requiresLevel) > 1) {
          row.badge = game.i18n.format('DW.Sheet.LevelBadge', { level: system.requiresLevel });
        }
        if (row.moveType == 'starting') startingCount++;
        for (let [key, label, css] of [['success', '10+', 'success'], ['partial', '7–9', 'partial'], ['failure', '6-', 'failure']]) {
          const value = system.moveResults?.[key]?.value;
          if (value) {
            const result = { label, css, html: '' };
            row.results.push(result);
            enrich(result, 'html', value, item);
          }
        }
        if (system.choices) enrich(row, 'choices', system.choices, item);
        moves.push(row);
      }
      else if (item.type == 'equipment') {
        row.rollIcon = system.rollFormula ? 'formula' : 'none';
        row.equipped = !!system.equipped;
        row.uses = system.uses;
        row.quantity = system.quantity;
        row.weight = system.weight;
        try {
          const tags = system.tags ? JSON.parse(system.tags) : [];
          row.tagList = Array.isArray(tags) ? tags.map(t => t?.value ?? t).filter(Boolean) : [];
        } catch (e) {
          row.tagList = [];
        }
        equipment.push(row);
      }
      else if (item.type == 'spell') {
        row.rollIcon = system.rollFormula ? 'formula' : 'none';
        row.prepared = !!system.prepared;
        const level = Number(system.spellLevel ?? 0);
        (spellsByLevel[level] ??= []).push(row);
      }
      else if (item.type == 'bond') {
        enrich(row, 'nameEnriched', item.name, item);
        bonds.push(row);
      }
    }
    await Promise.all(enrichments);

    // Spell groups: the standard levels always, plus any others in use.
    const levels = new Set([...SPELL_LEVELS, ...Object.keys(spellsByLevel).map(Number)]);
    const spellLevels = [...levels].sort((a, b) => a - b).map(level => ({
      level: level,
      label: game.i18n.localize(`DW.Spells${level}`),
      spells: spellsByLevel[level] ?? [],
    }));

    return { moves, equipment, bonds, spellLevels, startingCount };
  }

  /**
   * Group moves into the sections shown on the Moves tab.
   *
   * Class moves get one section per source class, based on each move's class
   * field, with the character's own class first. Starting moves come before
   * advanced moves within a class.
   *
   * @param {Object[]} moves Prepared move rows.
   * @return {{sections: Object[], multiclass: string[]}}
   */
  _prepareMoveSections(moves) {
    const primaryName = this.actor.system.details.class ?? '';
    const primaryKey = classKey(primaryName);
    const collapsed = this._getCollapsedState();

    const basic = [];
    const special = [];
    const other = [];
    const classGroups = new Map();
    classGroups.set(primaryKey, { label: classLabel(primaryName), moves: [], primary: true });

    for (let move of moves) {
      if (move.moveType == 'basic') basic.push(move);
      else if (move.moveType == 'special') special.push(move);
      else if (move.moveType == 'starting' || move.moveType == 'advanced') {
        const key = move.className ? classKey(move.className) : primaryKey;
        if (!classGroups.has(key)) {
          classGroups.set(key, { label: classLabel(move.className), moves: [], primary: false });
        }
        classGroups.get(key).moves.push(move);
      }
      else other.push(move);
    }

    const section = (id, title, rows, extra = {}) => {
      const isCollapsed = collapsed[id] ?? this._isCollapsedByDefault(id);
      return {
        id: id,
        title: title,
        rows: rows,
        count: rows.length,
        collapsed: isCollapsed,
        ...extra,
        // createType is the new move's type; null means no add button.
        canCreate: extra.createType !== undefined && extra.createType !== null,
      };
    };

    const sections = [];
    sections.push(section('favorites', game.i18n.localize('DW.Sheet.Favorites'), moves.filter(m => m.favorite), {
      emptyText: game.i18n.localize('DW.Sheet.FavoritesEmpty'),
    }));
    sections.push(section('basic', game.i18n.localize('DW.MovesBasic'), basic, { createType: 'basic' }));

    const multiclass = [];
    for (let [key, group] of classGroups) {
      // Starting moves first; the sort is stable, so sheet order is kept otherwise.
      const rows = group.moves.sort((a, b) => (a.moveType == 'starting' ? 0 : 1) - (b.moveType == 'starting' ? 0 : 1));
      // Class sections only appear when they have moves.
      if (rows.length < 1) continue;
      if (!group.primary) multiclass.push(group.label);
      const title = group.label
        ? game.i18n.format('DW.Sheet.ClassMoves', { class: group.label })
        : game.i18n.localize('DW.Sheet.ClassMovesDefault');
      sections.push(section(`class-${key || 'primary'}`, title, rows, {
        createType: group.primary ? 'starting' : null,
        hint: group.primary ? '' : game.i18n.localize('DW.Sheet.Multiclass'),
        emptyText: game.i18n.localize('DW.Sheet.NoMoves'),
      }));
    }

    sections.push(section('special', game.i18n.localize('DW.MovesSpecial'), special, { createType: 'special' }));
    sections.push(section('other', game.i18n.localize('DW.MovesOther'), other, {
      createType: '',
      emptyText: game.i18n.localize('DW.Sheet.NoMoves'),
    }));

    return { sections, multiclass };
  }

  /**
   * Whether a move section starts collapsed before the player toggles it.
   *
   * @param {string} id Section id.
   * @return {boolean}
   */
  _isCollapsedByDefault(id) {
    return DEFAULT_COLLAPSED.includes(id);
  }

  /**
   * Collapsed state of the move sections, keyed by section id.
   *
   * @return {Object}
   */
  _getCollapsedState() {
    const saved = this.actor.flags?.dungeonworld?.sheetDisplay?.collapsed ?? {};
    return { ...saved, ...this._localCollapsed };
  }

  /* -------------------------------------------- */
  /*  Rendering                                   */
  /* -------------------------------------------- */

  /** @inheritdoc */
  async _onRender(context, options) {
    await super._onRender(context, options);

    // Older cores have no built-in drag and drop on ActorSheetV2.
    if (!('_dragDrop' in ActorSheetV2.prototype)) this.#bindDragDrop();

    // Core disables every control on a read-only sheet. Controls that only
    // change what's shown (tabs, sections, details, search) stay usable.
    if (!this.isEditable) {
      const viewOnly = '.dw-tab, .dw-section-toggle, [data-action="toggleDetails"], .dw-move-search input';
      for (let control of this.element.querySelectorAll(viewOnly)) control.disabled = false;
    }

    // Right-click decreases equipment counters.
    for (let counter of this.element.querySelectorAll('[data-action="adjustCounter"]')) {
      counter.addEventListener('contextmenu', event => {
        event.preventDefault();
        this._adjustCounter(counter, -1);
      });
    }

    // Shrink the character name to fit, rather than cutting it off.
    const nameInput = this.element.querySelector('input.dw-name');
    this.#nameObserver?.disconnect();
    if (nameInput) {
      this._fitName(nameInput);
      nameInput.addEventListener('input', () => this._fitName(nameInput));
      this.#nameObserver = new ResizeObserver(() => this._fitName(nameInput));
      this.#nameObserver.observe(nameInput);
    }

    // Move search filters rows in place, without re-rendering.
    const search = this.element.querySelector('.dw-move-search input');
    if (search) {
      search.value = this._moveQuery;
      search.addEventListener('input', event => {
        this._moveQuery = event.target.value;
        this._applyMoveFilter();
      });
      this._applyMoveFilter();
    }
  }

  /**
   * Size the name's font so the whole name fits in its field. Below the
   * minimum size the name scrolls, and the tooltip shows it all.
   *
   * The text is measured in its real font once that font has loaded;
   * measuring earlier uses a narrower fallback font and gets it wrong.
   *
   * @param {HTMLInputElement} input
   */
  async _fitName(input) {
    const maxSize = 24;
    const minSize = 14;
    input.title = input.value;

    const style = getComputedStyle(input);
    const family = style.fontFamily;
    try {
      await document.fonts.load(`${maxSize}px ${family}`, input.value);
    } catch (e) {
      // Measure with whatever font is available.
    }

    const context = (DwCharacterSheet.#measureContext ??= document.createElement('canvas').getContext('2d'));
    context.font = `${style.fontWeight} ${maxSize}px ${family}`;
    const textWidth = context.measureText(input.value || input.placeholder || '').width;
    const available = input.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight) - 4;
    if (available <= 0 || textWidth <= 0) return;

    const size = Math.max(minSize, Math.min(maxSize, Math.floor(maxSize * available / textWidth)));
    input.style.fontSize = `${size}px`;
  }

  /** Canvas context used to measure text. */
  static #measureContext = null;

  /** Re-fits the name when its field changes width. */
  #nameObserver = null;

  /** @inheritdoc */
  _onClose(options) {
    super._onClose(options);
    this.#nameObserver?.disconnect();
    this.#nameObserver = null;
  }

  /**
   * Hide moves that don't match the search text. While searching, every
   * section with a match is shown expanded and empty sections are hidden.
   */
  _applyMoveFilter() {
    const panel = this.element.querySelector('.dw-panel[data-tab="moves"]');
    if (!panel) return;
    const query = this._moveQuery.trim().toLowerCase();
    panel.classList.toggle('is-searching', !!query);

    let anyMatch = false;
    for (let section of panel.querySelectorAll('.dw-section')) {
      let matches = 0;
      for (let row of section.querySelectorAll('.dw-row[data-item-id]')) {
        const match = !query || row.dataset.name.toLowerCase().includes(query);
        row.hidden = !match;
        if (match) matches++;
      }
      section.hidden = !!query && matches < 1;
      if (matches) anyMatch = true;
    }
    const noMatches = panel.querySelector('.dw-no-matches');
    if (noMatches) noMatches.hidden = !query || anyMatch;
  }

  /* -------------------------------------------- */
  /*  Drag and Drop                               */
  /* -------------------------------------------- */

  /** @type {DragDrop|null} */
  #dragDrop = null;

  #bindDragDrop() {
    this.#dragDrop ??= new DragDrop({
      dragSelector: '.draggable',
      permissions: {
        dragstart: () => true,
        drop: () => this.isEditable,
      },
      callbacks: {
        dragstart: this._onDragStart.bind(this),
        drop: this._onDrop.bind(this),
      },
    });
    this.#dragDrop.bind(this.element);
  }

  /** @override */
  async _onDragStart(event) {
    const row = event.currentTarget;
    if ('link' in (event.target.dataset ?? {})) return;
    const item = this.actor.items.get(row.dataset.itemId);
    if (item) event.dataTransfer.setData('text/plain', JSON.stringify(item.toDragData()));
  }

  /** @override */
  async _onDrop(event) {
    if (!this.isEditable) return;
    const data = TextEditor.implementation.getDragEventData(event);
    if (Hooks.call('dropActorSheetData', this.actor, this, data) === false) return;
    if (data.type !== 'Item') return;

    const item = await Item.implementation.fromDropData(data);
    if (!item || !this.actor.isOwner) return;

    // Reorder an item already on this sheet.
    if (item.parent?.uuid === this.actor.uuid) return this._sortItem(event, item);

    // Otherwise add a copy.
    const keepId = !this.actor.items.has(item.id);
    const itemData = item.inCompendium
      ? game.items.fromCompendium(item, { clearFolder: true, keepId })
      : item.toObject();
    return Item.implementation.create(itemData, { parent: this.actor, keepId });
  }

  /**
   * Sort an owned item relative to the row it was dropped on.
   *
   * @param {DragEvent} event
   * @param {Item} item
   */
  _sortItem(event, item) {
    const items = this.actor.items;
    const dropTarget = event.target.closest('[data-item-id]');
    if (!dropTarget) return;
    const target = items.get(dropTarget.dataset.itemId);
    if (!target || target.id === item.id) return;

    const siblings = [];
    for (let element of dropTarget.parentElement.children) {
      const siblingId = element.dataset.itemId;
      if (siblingId && siblingId !== item.id) siblings.push(items.get(siblingId));
    }
    const updates = foundry.utils.performIntegerSort(item, { target, siblings }).map(u => ({
      ...u.update,
      _id: u.target.id,
    }));
    return this.actor.updateEmbeddedDocuments('Item', updates);
  }

  /* -------------------------------------------- */
  /*  Actions                                     */
  /* -------------------------------------------- */

  /**
   * Get the owned item for an element inside an item row.
   *
   * @param {HTMLElement} target
   * @return {Item|undefined}
   */
  _getItem(target) {
    const id = target.closest('[data-item-id]')?.dataset.itemId;
    return id ? this.actor.items.get(id) : undefined;
  }

  /** @this {DwCharacterSheet} */
  static #onRollAbility(event, target) {
    event.preventDefault();
    const key = target.dataset.ability;
    const ability = this.actor.system.abilities?.[key];
    if (!ability) return;
    DwRolls.rollMove({
      actor: this.actor,
      data: null,
      formula: key,
      templateData: { title: ability.label ?? key },
    });
  }

  /** @this {DwCharacterSheet} */
  static #onRollDamage(event, target) {
    event.preventDefault();
    const damage = this.actor.system.attributes.damage;
    if (!damage?.value) return;
    DwRolls.rollMove({
      actor: this.actor,
      data: null,
      formula: `${damage.value}${damage.misc ? '+' + damage.misc : ''}`,
      templateData: {
        title: game.i18n.localize('DW.Damage'),
        // NPCs note piercing here (e.g. "2 piercing"); it's shown as a tag.
        flavor: this.actor.type == 'npc' ? (damage.piercing ?? '') : '',
        rollType: 'damage',
      },
    });
  }

  /** @this {DwCharacterSheet} */
  static async #onRollItem(event, target) {
    event.preventDefault();
    await this._getItem(target)?.roll();
  }

  /**
   * Step an actor attribute up or down by one.
   * @this {DwCharacterSheet}
   */
  static async #onAdjustResource(event, target) {
    event.preventDefault();
    const attr = target.dataset.attr;
    const delta = Number(target.dataset.delta ?? 0);
    if (!attr || !delta) return;
    const current = Number(foundry.utils.getProperty(this.actor.system, attr) ?? 0);
    await this.actor.update({ [`system.${attr}`]: current + delta });
  }

  /**
   * Increase an equipment counter (uses or quantity). Right-click decreases.
   * @this {DwCharacterSheet}
   */
  static async #onAdjustCounter(event, target) {
    event.preventDefault();
    await this._adjustCounter(target, 1);
  }

  async _adjustCounter(target, delta) {
    const item = this._getItem(target);
    const field = target.dataset.field;
    if (!item || !['uses', 'quantity'].includes(field)) return;
    await item.update({ [`system.${field}`]: Number(item.system[field] ?? 0) + delta });
  }

  /** @this {DwCharacterSheet} */
  static async #onLevelUp(event, target) {
    event.preventDefault();
    if (target.disabled) return;
    await new DwLevelUp(this.actor)._onLevelUp(event);
  }

  /** @this {DwCharacterSheet} */
  static async #onViewClass(event, target) {
    event.preventDefault();
    await new DwLevelUp(this.actor)._onClassView(event);
  }

  /** @this {DwCharacterSheet} */
  static async #onCreateItem(event, target) {
    event.preventDefault();
    const type = target.dataset.type;
    if (!type) return;
    const system = {};
    if (target.dataset.moveType) system.moveType = target.dataset.moveType;
    if (target.dataset.level !== undefined) system.spellLevel = Number(target.dataset.level);
    const name = type == 'bond' ? game.i18n.localize("DW.BondDefault") : `New ${type.capitalize()}`;
    await this.actor.createEmbeddedDocuments('Item', [{ name, type, system }]);
  }

  /** @this {DwCharacterSheet} */
  static #onEditItem(event, target) {
    event.preventDefault();
    this._getItem(target)?.sheet.render(true);
  }

  /** @this {DwCharacterSheet} */
  static async #onDeleteItem(event, target) {
    event.preventDefault();
    await this._getItem(target)?.delete();
  }

  /**
   * Expand or collapse an item's details. This only changes the page, so it
   * doesn't need a re-render; the state is remembered for later renders.
   * @this {DwCharacterSheet}
   */
  static #onToggleDetails(event, target) {
    event.preventDefault();
    const row = target.closest('[data-item-id]');
    if (!row) return;
    const id = row.dataset.itemId;
    const expanded = !this._expanded.has(id);
    if (expanded) this._expanded.add(id);
    else this._expanded.delete(id);
    row.classList.toggle('expanded', expanded);
    target.setAttribute('aria-expanded', String(expanded));
  }

  /** @this {DwCharacterSheet} */
  static async #onToggleFavorite(event, target) {
    event.preventDefault();
    const item = this._getItem(target);
    if (!item) return;
    await item.update({ 'flags.dungeonworld.favorite': !item.flags?.dungeonworld?.favorite });
  }

  /**
   * Collapse or expand a move section. Saved on the actor so it persists;
   * users who can't edit the actor keep it for this sheet only.
   * @this {DwCharacterSheet}
   */
  static async #onToggleSection(event, target) {
    event.preventDefault();
    const id = target.closest('[data-section]')?.dataset.section;
    if (!id) return;
    const collapsed = !(this._getCollapsedState()[id] ?? this._isCollapsedByDefault(id));
    if (this.isEditable) {
      delete this._localCollapsed[id];
      await this.actor.update({ [`flags.dungeonworld.sheetDisplay.collapsed.${id}`]: collapsed });
    }
    else {
      this._localCollapsed[id] = collapsed;
      this.render({ parts: ['moves'] });
    }
  }

  /** @this {DwCharacterSheet} */
  static async #onToggleEquipped(event, target) {
    event.preventDefault();
    const item = this._getItem(target);
    if (item) await item.update({ 'system.equipped': !item.system.equipped });
  }

  /** @this {DwCharacterSheet} */
  static async #onTogglePrepared(event, target) {
    event.preventDefault();
    const item = this._getItem(target);
    if (item) await item.update({ 'system.prepared': !item.system.prepared });
  }

  /**
   * Ask for a tracker's name and maximum.
   *
   * @param {Object|null} tracker The tracker being edited, or null for a new one.
   * @return {Promise<{action: string, label?: string, max?: number}|null>}
   *   "save" with the entered values, "delete", or null if cancelled.
   */
  async _trackerDialog(tracker = null) {
    const escape = (value) => Handlebars.escapeExpression(String(value ?? ''));
    const content = `
      <div class="form-group">
        <label>${escape(game.i18n.localize('DW.Sheet.TrackerName'))}</label>
        <input type="text" name="label" value="${escape(tracker?.label ?? '')}" placeholder="${escape(game.i18n.localize('DW.Sheet.NewTracker'))}" autofocus>
      </div>
      <div class="form-group">
        <label>${escape(game.i18n.localize('DW.Sheet.TrackerMax'))}</label>
        <input type="number" name="max" min="0" step="1" value="${tracker?.max ? tracker.max : ''}" placeholder="${escape(game.i18n.localize('DW.Sheet.TrackerNoMax'))}">
      </div>`;

    const buttons = [{
      action: 'save',
      label: 'DW.Sheet.Save',
      icon: 'fa-solid fa-check',
      default: true,
      callback: (event, button) => ({ action: 'save', ...new FormDataExtended(button.form).object }),
    }];
    if (tracker) {
      buttons.push({
        action: 'delete',
        label: 'DW.Sheet.DeleteTracker',
        icon: 'fa-solid fa-trash',
        callback: () => ({ action: 'delete' }),
      });
    }
    buttons.push({ action: 'cancel', label: 'DW.Cancel', icon: 'fa-solid fa-xmark', callback: () => null });

    const result = await DialogV2.wait({
      window: { title: game.i18n.localize(tracker ? 'DW.Sheet.EditTracker' : 'DW.Sheet.AddTracker') },
      position: { width: 360 },
      content: content,
      buttons: buttons,
      rejectClose: false,
    });
    if (!result || result.action !== 'save') return result ?? null;

    return {
      action: 'save',
      label: String(result.label ?? '').trim() || game.i18n.localize('DW.Sheet.NewTracker'),
      max: Math.max(0, Number(result.max) || 0),
    };
  }

  /**
   * Add a tracker at the end of the list, after asking for its name and max.
   * @this {DwCharacterSheet}
   */
  static async #onAddTracker(event, target) {
    event.preventDefault();
    const result = await this._trackerDialog();
    if (result?.action !== 'save') return;

    const sorts = this._prepareTrackers().map(t => t.sort);
    const sort = sorts.length ? Math.max(...sorts) + 1 : 0;
    const id = foundry.utils.randomID();
    await this.actor.update({
      [`flags.dungeonworld.trackers.${id}`]: {
        label: result.label,
        value: 0,
        max: result.max,
        sort: sort,
      },
    });
  }

  /**
   * Rename, change the max of, or delete a tracker.
   * @this {DwCharacterSheet}
   */
  static async #onEditTracker(event, target) {
    event.preventDefault();
    const id = target.closest('[data-tracker-id]')?.dataset.trackerId;
    const tracker = this._prepareTrackers().find(t => t.id == id);
    if (!tracker) return;

    const result = await this._trackerDialog(tracker);
    if (result?.action === 'delete') {
      await this.actor.update(DwUtility.deletionUpdate(`flags.dungeonworld.trackers.${id}`));
    }
    else if (result?.action === 'save') {
      // Keep the value within the new maximum.
      const value = result.max > 0 ? Math.min(tracker.value, result.max) : tracker.value;
      await this.actor.update({
        [`flags.dungeonworld.trackers.${id}.label`]: result.label,
        [`flags.dungeonworld.trackers.${id}.max`]: result.max,
        [`flags.dungeonworld.trackers.${id}.value`]: value,
      });
    }
  }

  /**
   * Step a tracker's value up or down by one, staying within 0 and its max.
   * @this {DwCharacterSheet}
   */
  static async #onAdjustTracker(event, target) {
    event.preventDefault();
    const id = target.closest('[data-tracker-id]')?.dataset.trackerId;
    const tracker = this._prepareTrackers().find(t => t.id == id);
    const delta = Number(target.dataset.delta ?? 0);
    if (!tracker || !delta) return;
    let value = tracker.value + delta;
    if (tracker.max > 0) value = Math.min(value, tracker.max);
    value = Math.max(value, 0);
    await this.actor.update({ [`flags.dungeonworld.trackers.${id}.value`]: value });
  }

  /* -------------------------------------------- */

  /**
   * Format a number with an explicit sign.
   *
   * @param {number} value
   * @return {string}
   */
  static #signed(value) {
    const n = Number(value ?? 0) || 0;
    return n < 0 ? `−${Math.abs(n)}` : `+${n}`;
  }
}
