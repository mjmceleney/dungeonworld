import { DwClassList, ABILITY_ICONS } from "../config.js";
import { DwUtility } from "../utility.js";
import { DwRolls } from "../rolls.js";
import { DwLevelUp } from "./level-up.js";
import { DwTrackers } from "./trackers.js";
import { DwBonds } from "./bonds.js";
import { DwResources } from "../resources.js";
import { DwSpells } from "../spells.js";
import { DwStartOver } from "./start-over.js";
import { DwBeyondTen } from "./beyond-ten.js";
import { DwPenalties } from "../penalties.js";
import { DwCharacterCreator } from "./character-creator.js";

const { HandlebarsApplicationMixin } = foundry.applications.api;
const { ActorSheetV2 } = foundry.applications.sheets;
const { TextEditor, DragDrop, FormDataExtended } = foundry.applications.ux;

const TEMPLATES = "systems/dungeonworld/templates/sheet/character";

/** Sections that start collapsed until the player opens them. */
const DEFAULT_COLLAPSED = ['special', 'other'];


/** Spell levels, in display order. */
const SPELL_LEVELS = [0, 1, 3, 5, 7, 9];

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

    /** The sidebar's custom trackers. */
    this.trackers = new DwTrackers(this);

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
      toggleItemField: DwCharacterSheet.#onToggleItemField,
      // Trackers (trackers.js).
      addTracker: function(event, target) { return this.trackers.add(event, target); },
      editTracker: function(event, target) { return this.trackers.edit(event, target); },
      adjustTracker: function(event, target) { return this.trackers.adjust(event, target); },
      setTracker: function(event, target) { return this.trackers.set(event, target); },
      removeMulticlass: DwCharacterSheet.#onRemoveMulticlass,
      createCharacter: function(event) { event.preventDefault(); new DwCharacterCreator(this.actor).render(true); },
      fillBonds: function(event) { event.preventDefault(); return DwBonds.fill(this.actor); },
      editDetail: DwCharacterSheet.#onEditDetail,
      beyondTen: function(event) { event.preventDefault(); return DwBeyondTen.show(this.actor); },
      castSpell: function(event, target) {
        event.preventDefault();
        return this._getItem(target)?.roll({ cast: true });
      },
      prepareSpells: function(event) {
        event.preventDefault();
        // Each casting class has its own button, naming its move.
        return DwSpells.prepare(this.actor, this.actor.items.get(event.target.closest('[data-move-id]')?.dataset.moveId ?? '') ?? null);
      },
      clearPenalty: function(event, target) {
        event.preventDefault();
        return DwPenalties.clear(this.actor, target.dataset.penalty);
      },
      useItem: function(event, target) {
        event.preventDefault();
        const item = this._getItem(target);
        if (item) return DwResources.use(this.actor, item);
      },
      startOver: DwCharacterSheet.#onStartOver,
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
    sidebar: {
      template: `${TEMPLATES}/sidebar.html`,
      templates: [`${TEMPLATES}/trackers.html`],
      scrollable: [''],
    },
  };

  /** Ids of the tabs in the primary tab group, in display order. */
  static TAB_IDS = ['moves', 'equipment', 'spells', 'character'];

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

  /* -------------------------------------------- */
  /*  Context                                     */
  /* -------------------------------------------- */

  /**
   * The context every actor sheet shares: the document sheet's own, plus the
   * actor, whether it's editable, the tabs, the banner and HP. Subclasses
   * such as the NPC sheet build the rest of their context on it.
   *
   * @param {Object} options
   * @return {Promise<Object>}
   */
  async _prepareDocumentContext(options) {
    const context = await super._prepareContext(options);
    const actor = this.actor;
    return Object.assign(context, {
      actor: actor,
      system: actor.system,
      editable: this.isEditable,
      owner: actor.isOwner,
      cssClass: this.isEditable ? 'editable' : 'locked',
      tabs: this._prepareSheetTabs(),
      // The portrait doubles as a faded banner behind the header, except for
      // the default silhouette.
      bannerImg: actor.img && actor.img !== CONST.DEFAULT_TOKEN ? actor.img : null,
      ...DwUtility.hpContext(actor.system),
    });
  }

  /**
   * Enrich one of the actor's text fields (biography, look...) for display.
   *
   * @param {string} text
   * @return {Promise<string>}
   */
  _enrich(text) {
    return TextEditor.implementation.enrichHTML(text ?? '', {
      secrets: this.actor.isOwner,
      rollData: this.actor.getRollData(),
      relativeTo: this.actor,
    });
  }

  /** @override */
  async _prepareContext(options) {
    const context = await this._prepareDocumentContext(options);
    const actor = this.actor;
    const system = actor.system;
    const isEditable = this.isEditable;

    // Start loading the class list and enriching every field at once.
    const classlistPromise = DwClassList.getClasses(false);
    const detailsPromise = Promise.all([
      this._enrich(system.details.look),
      this._enrich(system.details.alignment?.description),
      this._enrich(system.details.race?.description),
      this._enrich(system.details.biography),
    ]);
    const items = await this._prepareItems();
    const [classItems, [look, alignment, race, biography]] = await Promise.all([classlistPromise, detailsPromise]);
    const classlist = classItems.map(c => c.name);
    // Players aren't shown secret classes as suggestions.
    const classSuggestions = game.user.isGM ? classlist : classItems.filter(c => !c.system.secret).map(c => c.name);

    const moveSections = this._prepareMoveSections(items.moves);
    const level = Number(system.attributes.level.value ?? 1);
    const xp = Number(system.attributes.xp.value ?? 0);
    const xpMax = Number(system.attributes.xp.max ?? level + 7);
    const weight = Number(system.attributes.weight.value ?? 0);
    const weightMax = Number(system.attributes.weight.max ?? 0);
    const classLevels = this._prepareClassLevels(level);
    // Classes with levels show their level instead of a "+ class" tag.
    const multiclass = moveSections.multiclass
      .filter(name => !classLevels?.list.some(c => DwUtility.classKey(c.name) === DwUtility.classKey(name)));

    return Object.assign(context, {
      isToken: actor.token != null,
      noAbilityScores: game.settings.get('dungeonworld', 'noAbilityScores'),

      // Header.
      classlist: classSuggestions,
      multiclass: multiclass,
      classLevels: classLevels,
      isGM: game.user.isGM,
      level: level,
      xp: xp,
      xpMax: xpMax,
      xpPct: xpMax > 0 ? Math.min(100, Math.round(100 * xp / xpMax)) : 0,
      levelUp: this._prepareLevelUp({ level, xp, xpMax, classlist, startingMoves: items.startingCount }),
      // A brand new character is made with the character creator.
      creation: isEditable && actor.token == null && level <= 1 && xp == 0 && items.startingCount < 1,

      // Vitals.
      damageFormula: `${system.attributes.damage.value ?? ''}${system.attributes.damage.misc ? '+' + system.attributes.damage.misc : ''}`,
      damages: { d4: 'd4', d6: 'd6', d8: 'd8', d10: 'd10', d12: 'd12' },
      weight: weight,
      weightMax: weightMax,
      load: this._prepareLoad(weight, weightMax),
      armor: this._prepareArmor(),

      // Stats.
      abilities: this._prepareAbilities(),
      forwardText: DwUtility.signed(system.attributes.forward?.value),
      ongoingText: DwUtility.signed(system.attributes.ongoing?.value),
      rollModes: this._prepareRollModes(),
      effects: this._prepareEffects(),

      // Tabs.
      moveSections: moveSections.sections,
      moveItemType: 'move',
      moveQuery: this._moveQuery,
      equipment: items.equipment,
      spellLevels: items.spellLevels,
      spellcasting: this._prepareSpellcasting(items.spellLevels),
      enriched: { look, alignment, race, biography },

      // Sidebar.
      trackers: this.trackers.prepare(),
      bonds: items.bonds,
      bondBlanks: actor.items.some(i => i.type == 'bond' && DwBonds.hasBlank(i)),
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
    // Retired characters and mentors don't level up any more.
    const flags = this.actor.flags?.dungeonworld ?? {};
    if (flags.retired) return { ready: false, hint: game.i18n.localize('DW.Beyond.RetiredHint') };
    if (flags.mentor) return { ready: false, hint: game.i18n.localize('DW.Beyond.MentorHint') };
    // Beyond level 10: retire, take on an apprentice, change class, or (with
    // multiclassing) level up in another class.
    if (DwBeyondTen.capped(this.actor)) {
      return xp >= xpMax
        ? { ready: true, beyond: true, hint: game.i18n.localize('DW.Beyond.Title') }
        : { ready: false, hint: game.i18n.format('DW.Sheet.NeedsXp', { xp: xpMax - xp }) };
    }
    // A new character can always use the builder to pick starting moves.
    const hasXp = xp >= xpMax;
    const eligible = hasXp || (level === 1 && startingMoves < 1);
    if (!eligible) {
      return { ready: false, hint: game.i18n.format('DW.Sheet.NeedsXp', { xp: xpMax - xp }) };
    }
    // The builder needs a known class. A level up doesn't: the character can
    // still raise an ability and multiclass. Only mention the class once it's
    // what's actually blocking.
    if (!known && !hasXp) {
      return { ready: false, hint: game.i18n.localize('DW.Sheet.ClassUnknown') };
    }
    return { ready: true, hint: game.i18n.localize('DW.Sheet.LevelUpReady') };
  }

  /**
   * The character's level in each class, once they have more than one class.
   * Null for a single class, whose level is just the character's level.
   */
  _prepareClassLevels(level) {
    const list = DwUtility.classLevels(this.actor);
    if (list.length < 2) return null;
    const sum = list.reduce((total, c) => total + c.level, 0);
    return {
      list: list.map(c => ({ ...c, short: DwUtility.shortClassName(c.name) })),
      mismatch: sum !== level ? game.i18n.format('DW.Sheet.ClassLevelsMismatch', { sum, level }) : null,
    };
  }

  /**
   * How the character's load stands: fine, heavy (−1 to moves) or over
   * (drop something or miss). Without gear rules, only over load is flagged.
   *
   * @return {{tier: string, warn: boolean, text: string, tooltip: string}}
   */
  _prepareLoad(weight, weightMax) {
    const automate = game.settings.get('dungeonworld', 'automateGear');
    const tier = automate ? (this.actor.system.attributes.weight.tier ?? 'ok') : (weight > weightMax ? 'over' : 'ok');
    if (tier == 'ok') {
      return { tier, warn: false, text: game.i18n.format('DW.Sheet.ToSpare', { weight: Math.max(0, weightMax - weight) }), tooltip: '' };
    }
    if (!automate) {
      return { tier, warn: true, text: game.i18n.localize('DW.Sheet.Encumbered'), tooltip: '' };
    }
    return {
      tier,
      warn: true,
      text: game.i18n.localize(tier == 'heavy' ? 'DW.Gear.Heavy' : 'DW.Gear.Over'),
      tooltip: game.i18n.localize(tier == 'heavy' ? 'DW.Gear.HeavyHint' : 'DW.Gear.OverHint'),
    };
  }

  /**
   * Armor for the header. With gear rules on and armor equipped, the total
   * comes from the gear (shown, not typed) and only the bonus is editable.
   *
   * @return {{fromGear: boolean, value: number, misc: number, tooltip: string, clumsy: number}}
   */
  _prepareArmor() {
    const ac = this.actor.system.attributes.ac;
    const automate = game.settings.get('dungeonworld', 'automateGear');
    const fromGear = automate && !!ac.fromGear;
    return {
      fromGear,
      value: Number(ac.value) || 0,
      misc: Number(ac.misc) || 0,
      tooltip: fromGear ? game.i18n.format('DW.Gear.ArmorFrom', { sources: ac.sources }) : '',
      clumsy: automate ? Number(ac.clumsy) || 0 : 0,
    };
  }

  /**
   * The Spells tab's summary: for each casting class (one per Prepare Spells
   * or Commune move), its prepared spell levels against its level +1 limit;
   * and any penalty to cast until the next preparation.
   *
   * @return {Object|null} Null for a character without spells.
   */
  _prepareSpellcasting(spellLevels) {
    if (!spellLevels.some(l => l.spells.length)) return null;
    return {
      casters: DwSpells.budgets(this.actor).map(b => ({
        moveId: b.move?.id ?? '',
        label: b.label,
        used: b.used,
        max: b.max,
        over: b.over,
      })),
      penalty: DwSpells.castPenalty(this.actor),
    };
  }

  /**
   * Modifiers in place on the character's rolls besides forward and
   * ongoing: a penalty to cast spells, to Recruit, and from their gear.
   * Shown as chips by the stats, each saying what it applies to.
   *
   * @return {{label: string, value: string, scope: string, tooltip: string, clear: string}[]}
   */
  _prepareEffects() {
    const actor = this.actor;
    const loc = (key, data) => data ? game.i18n.format(key, data) : game.i18n.localize(key);
    const effects = DwPenalties.effects(actor);
    if (game.settings.get('dungeonworld', 'automateGear')) {
      const clumsy = Number(actor.system.attributes.ac?.clumsy) || 0;
      if (clumsy) effects.push({
        label: loc('DW.Gear.Clumsy'), value: `−${clumsy}`, scope: loc('DW.Effects.AllMoves'),
        tooltip: loc('DW.Gear.ClumsyHint'), clear: '',
      });
      const tier = actor.system.attributes.weight?.tier;
      if (tier == 'heavy' || tier == 'over') effects.push({
        label: loc('DW.Effects.Load'), value: '−1', scope: loc(tier == 'over' ? 'DW.Effects.DropOrFail' : 'DW.Effects.AllMoves'),
        tooltip: loc(tier == 'over' ? 'DW.Gear.OverHint' : 'DW.Gear.HeavyHint'), clear: '',
      });
    }
    return effects;
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
        modText: DwUtility.signed(ability.mod),
        debility: !!ability.debility,
        debilityLabel: ability.debilityLabel ?? '',
      });
    }
    return abilities;
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
    // The actor's roll data, built once and shared by every item's text.
    const actorRollData = actor.getRollData();
    const itemOptions = new Map();
    const enrich = (target, key, text, item) => {
      if (!itemOptions.has(item.id)) {
        itemOptions.set(item.id, { secrets, rollData: { ...item.system, ...actorRollData }, relativeTo: item });
      }
      enrichments.push(TextEditor.implementation.enrichHTML(text ?? '', itemOptions.get(item.id))
        .then(html => target[key] = html));
    };

    const moves = [];
    const equipment = [];
    const bonds = [];
    const spellsByLevel = {};
    let startingCount = 0;
    // Spells can be cast from their row when the character has Cast a Spell.
    const canCast = actor.items.some(i => DwSpells.isCastMove(i));

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
        // A modifier in place for this move (casting or Recruit penalties).
        row.effect = DwPenalties.moveBadge(actor, item);
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
        // Gear that gets used up, or that does something when used.
        row.canUse = (Number(system.uses) > 0 || Number(system.useHeal) > 0) && DwResources.remaining(item) > 0;
        row.weight = system.weight;
        row.tagList = DwUtility.parseTags(system.tags);
        equipment.push(row);
      }
      else if (item.type == 'spell') {
        row.rollIcon = system.rollFormula ? 'formula' : 'none';
        row.prepared = !!system.prepared;
        row.canCast = canCast;
        const lowered = DwSpells.loweredBy(actor, item);
        if (lowered) row.badge = game.i18n.format('DW.Spellcasting.LoweredBadge', { move: lowered.name, level: DwSpells.preparedLevel(actor, item) });
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
    const primaryKey = DwUtility.classKey(primaryName);

    const basic = [];
    const special = [];
    const other = [];
    const classGroups = new Map();
    classGroups.set(primaryKey, { label: DwUtility.shortClassName(primaryName), moves: [], primary: true });

    for (let move of moves) {
      if (move.moveType == 'basic') basic.push(move);
      else if (move.moveType == 'special') special.push(move);
      else if (move.moveType == 'starting' || move.moveType == 'advanced') {
        const key = move.className ? DwUtility.classKey(move.className) : primaryKey;
        if (!classGroups.has(key)) {
          classGroups.set(key, { label: DwUtility.shortClassName(move.className), moves: [], primary: false });
        }
        classGroups.get(key).moves.push(move);
      }
      else other.push(move);
    }

    const sections = [];
    sections.push(this._moveSection('favorites', game.i18n.localize('DW.Sheet.Favorites'), moves.filter(m => m.favorite), {
      emptyText: game.i18n.localize('DW.Sheet.FavoritesEmpty'),
    }));
    sections.push(this._moveSection('basic', game.i18n.localize('DW.MovesBasic'), basic, { createType: 'basic' }));

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
      sections.push(this._moveSection(`class-${key || 'primary'}`, title, rows, {
        createType: group.primary ? 'starting' : null,
        hint: group.primary ? '' : game.i18n.localize('DW.Sheet.Multiclass'),
        emptyText: game.i18n.localize('DW.Sheet.NoMoves'),
      }));
    }

    sections.push(this._moveSection('special', game.i18n.localize('DW.MovesSpecial'), special, { createType: 'special' }));
    sections.push(this._moveSection('other', game.i18n.localize('DW.MovesOther'), other, {
      createType: '',
      emptyText: game.i18n.localize('DW.Sheet.NoMoves'),
    }));

    return { sections, multiclass };
  }

  /**
   * One section of the Moves tab.
   *
   * @param {string} id Section id.
   * @param {string} title
   * @param {Object[]} rows Prepared move rows.
   * @param {Object} [extra] More for the template: createType (the new
   *   move's type; null or absent means no add button), emptyText, hint.
   * @return {Object}
   */
  _moveSection(id, title, rows, extra = {}) {
    return {
      id: id,
      title: title,
      rows: rows,
      count: rows.length,
      collapsed: this._getCollapsedState()[id] ?? this._isCollapsedByDefault(id),
      ...extra,
      canCreate: extra.createType !== undefined && extra.createType !== null,
    };
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

    // Sliders and bars can be dragged and stepped with the arrow keys.
    this.trackers.activate();

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

  /**
   * Turn an item's equipped or prepared state on or off.
   * @this {DwCharacterSheet}
   */
  static async #onToggleItemField(event, target) {
    event.preventDefault();
    const item = this._getItem(target);
    const field = target.dataset.field;
    if (!item || !['equipped', 'prepared'].includes(field)) return;
    await item.update({ [`system.${field}`]: !item.system[field] });
  }

  /**
   * Edit the character's race or alignment: its name and description, in a
   * dialog, since they rarely change. The sidebar shows them in full.
   * @this {DwCharacterSheet}
   */
  static async #onEditDetail(event, target) {
    event.preventDefault();
    const kind = target.dataset.detail;
    if (!['race', 'alignment'].includes(kind)) return;
    const detail = this.actor.system.details[kind] ?? {};
    const label = kind == 'race'
      ? (game.settings.get('dungeonworld', 'raceSingle') || game.i18n.localize('DW.Race'))
      : (game.settings.get('dungeonworld', 'alignmentSingle') || game.i18n.localize('DW.Alignment'));

    const content = document.createElement('div');
    content.innerHTML = `<div class="form-group">
        <label>${DwUtility.escape(game.i18n.localize('DW.LevelUp.OwnName'))}</label>
        <input type="text" name="value" value="${DwUtility.escape(detail.value)}" autofocus>
      </div>
      <div class="dw-detail-editor">
        <label>${DwUtility.escape(game.i18n.localize(kind == 'race' ? 'DW.Sheet.RaceDescription' : 'DW.Sheet.AlignmentDescription'))}</label>
        <prose-mirror name="description" value="${DwUtility.escape(detail.description)}"></prose-mirror>
      </div>`;

    const result = await DwUtility.ask({
      classes: ['dw-detail-dialog'],
      window: { title: game.i18n.format('DW.Sheet.EditDetailTitle', { detail: label }), icon: 'fa-solid fa-pen' },
      position: { width: 520 },
      content,
      ok: { label: 'DW.Sheet.Save', callback: (event, button) => new FormDataExtended(button.form).object },
    });
    if (!result) return;
    await this.actor.update({
      [`system.details.${kind}.value`]: String(result.value ?? '').trim(),
      [`system.details.${kind}.description`]: String(result.description ?? ''),
    });
  }

  /**
   * Ask a yes/no question with checkboxes, in the sheet's dialog style.
   * @param {string} title
   * @param {string} text  Plain text, escaped here.
   * @param {{name: string, label: string, checked: boolean}[]} options
   * @param {string} confirm  The confirm button's label key.
   * @return {Promise<Object|null>} The checked options by name, or null.
   */
  async _confirmWithOptions(title, text, options, confirm) {
    const content = `<p>${DwUtility.escape(text)}</p>` + options.map(o => `
      <div class="form-group">
        <label class="checkbox">
          <input type="checkbox" name="${o.name}" ${o.checked ? 'checked' : ''}>
          ${DwUtility.escape(o.label)}
        </label>
      </div>`).join('');
    return DwUtility.ask({
      window: { title },
      position: { width: 420 },
      content,
      ok: { label: confirm, callback: (event, button) => ({ ...new FormDataExtended(button.form).object }) },
    });
  }

  /** The character's moves and spells from a class. */
  _classItems(className) {
    const fromClass = (item) => DwUtility.classKey(item.system.class) === DwUtility.classKey(className);
    return {
      moves: this.actor.items.filter(i => i.type == 'move' && i.system.class && fromClass(i)),
      spells: this.actor.items.filter(i => i.type == 'spell' && i.system.class && fromClass(i)),
    };
  }

  /**
   * Remove a class the character multiclassed into, and optionally its moves
   * and spells. The character's level is left as it is.
   * @this {DwCharacterSheet}
   */
  static async #onRemoveMulticlass(event, target) {
    event.preventDefault();
    const name = target.dataset.class;
    const multiclasses = this.actor.getFlag('dungeonworld', 'multiclasses') ?? [];
    if (!multiclasses.includes(name)) return;

    const { moves, spells } = this._classItems(name);
    const options = moves.length || spells.length
      ? [{ name: 'items', checked: true, label: game.i18n.format('DW.Sheet.RemoveClassItems', { moves: moves.length, spells: spells.length }) }]
      : [];
    const result = await this._confirmWithOptions(
      game.i18n.format('DW.Sheet.RemoveMulticlassTitle', { class: DwUtility.shortClassName(name) }),
      game.i18n.format('DW.Sheet.RemoveMulticlassText', { class: name, actor: this.actor.name }),
      options, 'DW.Sheet.Remove');
    if (!result) return;

    await this.actor.update({
      'flags.dungeonworld.multiclasses': multiclasses.filter(n => n !== name),
      ...DwUtility.deletionUpdate(`flags.dungeonworld.classLevels.${name}`),
    });
    if (result.items) {
      await this.actor.deleteEmbeddedDocuments('Item', [...moves, ...spells].map(i => i.id));
    }
  }

  /**
   * Start the character over at level 1, so they can be built again through
   * the level up dialog. Class moves and spells are removed by default;
   * equipment, bonds, race and alignment only if asked.
   * @this {DwCharacterSheet}
   */
  static async #onStartOver(event, target) {
    event.preventDefault();
    if (!game.user.isGM) return;
    await DwStartOver.run(this.actor);
  }
}
