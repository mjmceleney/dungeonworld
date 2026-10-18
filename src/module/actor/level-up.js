import { DwClassList, ABILITY_ICONS } from "../config.js";
import { DwUtility } from "../utility.js";
import { DwBonds } from "./bonds.js";
import { DwClassGear } from "../item/class-gear.js";

const { HandlebarsApplicationMixin, ApplicationV2 } = foundry.applications.api;

/** The move that explains how each casting class prepares its spells. */
const PREPARATION_MOVES = {
  'the-wizard': 'Spellbook',
  'the-cleric': 'Commune',
};

const PARTIALS = 'systems/dungeonworld/templates/dialog/parts';

/** The highest level a class can reach. */
export const MAX_CLASS_LEVEL = 10;

/** Damage dice from smallest to largest. */
const DAMAGE_DICE = ['d4', 'd6', 'd8', 'd10', 'd12'];

/**
 * The level up, class viewer and follow-up picker window, in the same style
 * as the sheets.
 *
 * Renders the context it's given with the level up template (or the template
 * option). On submit it passes its form element to the onSubmit option, then
 * closes. When a control marked data-refresh changes, the refresh option
 * returns new HTML for .dw-advance-choices, so the rest of the form keeps its
 * choices. onClose runs however the window closes.
 */
class DwLevelUpWindow extends HandlebarsApplicationMixin(ApplicationV2) {

  /** @override */
  static DEFAULT_OPTIONS = {
    tag: "form",
    classes: ["dw-v2", "dw-levelup-window"],
    position: {
      width: 920,
      height: 680,
    },
    window: {
      resizable: true,
    },
    form: {
      handler: DwLevelUpWindow.#onSubmit,
      closeOnSubmit: true,
    },
    actions: {
      cancel: DwLevelUpWindow.#onCancel,
    },
  };

  /** @override */
  static PARTS = {
    body: {
      template: "systems/dungeonworld/templates/dialog/level-up.html",
      templates: [
        `${PARTIALS}/level-up-move.html`,
        `${PARTIALS}/level-up-starting.html`,
        `${PARTIALS}/level-up-advanced.html`,
        `${PARTIALS}/level-up-spells.html`,
        `${PARTIALS}/level-up-advancement.html`,
        `${PARTIALS}/grant-choices.html`,
      ],
      scrollable: [".dw-levelup-body"],
    },
  };

  /** Counts refreshes, so a slow one can't overwrite a later one. */
  #refreshCount = 0;

  /** @inheritdoc */
  _configureRenderParts(options) {
    const parts = super._configureRenderParts(options);
    if (this.options.template) parts.body.template = this.options.template;
    return parts;
  }

  /** @inheritdoc */
  _initializeApplicationOptions(options) {
    options = super._initializeApplicationOptions(options);
    // Match core's light or dark theme choice, as the sheets do.
    let dark = DwUtility.nightmode;
    if (options.classes.includes('theme-dark')) dark = true;
    else if (options.classes.includes('theme-light')) dark = false;
    if (dark) options.classes.push('dw-dark');
    return options;
  }

  /** @override */
  async _prepareContext(options) {
    return this.options.context;
  }

  /** @inheritdoc */
  _onRender(context, options) {
    super._onRender(context, options);
    for (const select of this.element.querySelectorAll('select[data-ability]')) {
      select.addEventListener('change', () => this.#limitAbilityScores());
    }
    for (const control of this.element.querySelectorAll('[data-refresh]')) {
      control.addEventListener('change', event => this.#refresh(event.currentTarget));
    }
    // "Choose two": once two are picked, the rest wait until one is unpicked.
    for (const group of this.element.querySelectorAll('.dw-gear-group[data-gear-count]')) {
      const count = Number(group.dataset.gearCount) || 0;
      if (!count) continue;
      const boxes = [...group.querySelectorAll('input[type="checkbox"][data-gear-option]')];
      const limit = () => {
        const full = boxes.filter(b => b.checked).length >= count;
        for (const box of boxes) {
          box.disabled = full && !box.checked;
          box.closest('.dw-choice')?.classList.toggle('is-disabled', box.disabled);
        }
      };
      for (const box of boxes) box.addEventListener('change', limit);
      limit();
    }
    // Typing your own race or alignment picks it.
    for (const field of this.element.querySelectorAll('[data-own-choice]')) {
      field.addEventListener('input', () => {
        const radio = this.element.querySelector(`input[type="radio"][name="${field.dataset.ownChoice}"][data-own]`);
        if (radio) radio.checked = true;
      });
    }
  }

  /** @inheritdoc */
  _onClose(options) {
    super._onClose(options);
    this.options.onClose?.();
  }

  /** Re-render the choices that depend on the changed control. */
  async #refresh(control) {
    if (!this.options.refresh) return;
    const count = ++this.#refreshCount;
    const html = await this.options.refresh(this.element, control);
    if (count !== this.#refreshCount || html == null) return;
    const target = this.element.querySelector('.dw-advance-choices');
    if (target) target.innerHTML = html;
  }

  /**
   * Each score in the list can only be assigned once, so disable the scores
   * that the other abilities already have. With the modifiers-only setting the
   * list has repeats (+1 twice), which can each be assigned.
   */
  #limitAbilityScores() {
    const selects = [...this.element.querySelectorAll('select[data-ability]')];
    for (const select of selects) {
      const taken = selects.filter(s => s !== select).map(s => parseInt(s.value)).filter(v => !isNaN(v));
      const counts = {};
      for (const option of select.options) {
        const value = parseInt(option.value);
        if (!isNaN(value)) counts[value] = (counts[value] ?? 0) + 1;
      }
      for (const option of select.options) {
        const value = parseInt(option.value);
        if (isNaN(value)) continue;
        option.disabled = taken.filter(v => v === value).length >= counts[value];
      }
    }
  }

  static async #onSubmit(event, form) {
    await this.options.onSubmit?.(form);
  }

  static #onCancel() {
    this.close();
  }
}

/**
 * The level up and class viewer dialogs for a character.
 *
 * Shared by the character sheets, so each sheet only needs to create an
 * instance for its actor and call _onLevelUp() or _onClassView().
 */
export class DwLevelUp {

  /**
   * @param {Actor} actor The character to level up or view the class of.
   */
  constructor(actor) {
    this.actor = actor;
  }

  /**
   * Open the level up or class viewer window, replacing one that's already
   * open for this character.
   */
  static async #open(id, title, context, onSubmit = null, extra = {}) {
    await foundry.applications.instances.get(id)?.close();
    return new DwLevelUpWindow({ id, window: { title }, context, onSubmit, ...extra }).render({ force: true });
  }

  /** Ability labels and icons for the ability score sections. */
  #abilityLabels() {
    return Object.entries(CONFIG.DW.abilities).map(([key, label]) => {
      const value = Number(this.actor.system.abilities[key].value);
      return {
        short: key,
        long: label,
        icon: ABILITY_ICONS[key] ?? 'fa-circle',
        value: value,
        next: value + 1,
        disabled: value > 17
      };
    });
  }

  /* -------------------------------------------- */
  /*  Classes, moves and spells                   */
  /* -------------------------------------------- */

  /** Each class's moves, loaded once per level up. */
  #classMovesCache = new Map();

  /**
   * How to look a class up: its name as shown, the name its moves use (the
   * untranslated name, with Babele), its compendium slug and its class item.
   */
  #resolveClass(name, classes) {
    const shown = (name ?? '').trim();
    let lookup = shown;
    const translations = game.babele?.translations.find(p => p.collection == 'dungeonworld.classes');
    const translated = translations?.entries.find(p => p.name == shown);
    if (translated) lookup = translated.id;
    const item = classes.find(c => c.name == name)
      ?? classes.find(c => c.name == shown)
      ?? classes.find(c => c.name == lookup)
      ?? null;
    return { name: shown, lookup, slug: DwUtility.cleanClass(lookup), item: item?.system ? item : null };
  }

  /** A class's name for use inside a sentence: "Cleric", not "The Cleric". */
  static #shortName(name) {
    return (name ?? '').replace(/^the\s+/i, '');
  }

  /** Whether two class names are the same class ("The Thief" and "Thief"). */
  static #sameClass(a, b) {
    const clean = name => DwUtility.cleanClass(name ?? '').replace(/^the-/, '');
    return clean(a) === clean(b);
  }

  /**
   * Every move of a class: the world's move items first, then compendium moves
   * they don't override, by required level.
   */
  async #classMoves(cls) {
    if (this.#classMovesCache.has(cls.slug)) return this.#classMovesCache.get(cls.slug);
    const moves = game.items.filter(m => m.type == 'move' && m.system.class == cls.lookup);
    const names = new Set(moves.map(m => m.name));
    for (const move of await DwUtility.loadCompendia(`${cls.slug}-moves`)) {
      // TODO: Babele: also compare against `move.originalName`.
      if (!names.has(move.name)) moves.push(move);
    }
    moves.sort((a, b) => a.system.requiresLevel - b.system.requiresLevel);
    this.#classMovesCache.set(cls.slug, moves);
    return moves;
  }

  /** The moves the character could take at a level: not taken, requirements met. */
  #availableMoves(moves, level) {
    const owned = this.actor.items.filter(i => i.type == 'move').map(i => i.name);
    return moves.filter(m => m.system.requiresLevel <= level
      && !owned.includes(m.name)
      && (!m.system.requiresMove || owned.includes(m.system.requiresMove)));
  }

  /** Starting moves by move group; moves outside a group come last. */
  static #startingGroups(moves) {
    const starting = moves.filter(m => m.system.requiresLevel < 2);
    if (!starting.length) return null;
    return starting.reduce((groups, move) => {
      const group = move.system.moveGroup ? move.system.moveGroup : 'ZZZZZZZ';
      (groups[group] ??= []).push(move);
      return groups;
    }, {});
  }

  /**
   * A class's spells up to a level that the character doesn't have yet, by
   * spell level, with how the class prepares them. Null if it has none.
   */
  async #classSpells(cls, level) {
    const owned = this.actor.items.filter(i => i.type == 'spell').map(i => i.name);
    const spells = game.items.filter(i => i.type == 'spell' && i.system.class
      && DwLevelUp.#sameClass(i.system.class, cls.lookup));
    const names = new Set(spells.map(s => s.name));
    for (const spell of await DwUtility.loadCompendia(`${cls.slug}-spells`)) {
      if (!names.has(spell.name)) spells.push(spell);
    }
    const available = spells.filter(s => (s.system.spellLevel ?? 0) <= level && !owned.includes(s.name));
    if (!available.length) return null;

    available.sort((a, b) => a.system.spellLevel - b.system.spellLevel);
    const groups = available.reduce((groups, spell) => {
      (groups[spell.system.spellLevel ? spell.system.spellLevel : 0] ??= []).push(spell);
      return groups;
    }, {});

    const preparation = PREPARATION_MOVES[cls.slug];
    let description = null;
    if (preparation) {
      const move = (await this.#classMoves(cls)).find(m => m.name == preparation)
        ?? this.actor.items.find(i => i.type == 'move' && i.name == preparation);
      description = move?.system.description ?? null;
    }
    return { className: cls.name, description, spells: groups };
  }

  /** Remember documents by ID, so the save can find what was picked. */
  static #remember(pool, documents) {
    for (const doc of documents ?? []) pool.set(doc.id, doc);
  }

  /** Every spell in a list of #classSpells() results. */
  static #spellDocs(casters) {
    return (casters ?? []).flatMap(c => Object.values(c.spells).flat());
  }

  /** Classes the character has multiclassed into. */
  get #multiclasses() {
    return this.actor.getFlag('dungeonworld', 'multiclasses') ?? [];
  }

  /* -------------------------------------------- */
  /*  Level up                                    */
  /* -------------------------------------------- */

  async _onLevelUp(event) {
    event.preventDefault();

    if ($(event.currentTarget).hasClass('disabled-level-up')) {
      return;
    }

    const actor = this.actor;
    const actorData = this.actor.system;
    const isNewCharacter = actorData.attributes.xp.value == 0;
    // The level being reached. A new character (no XP yet) is building level 1.
    const level = Number(actorData.attributes.level.value) + (isNewCharacter ? 0 : 1);

    const classes = await DwClassList.getClasses(false);
    const primary = this.#resolveClass(actorData.details.class, classes);
    const class_item = primary.item;

    // A new character needs a known class for everything they choose. A level
    // up can still raise an ability or multiclass without one.
    if (!class_item && isNewCharacter) {
      ui.notifications.warn(game.i18n.localize('DW.Notifications.noClassWarning'));
      return;
    }

    // Everything that can be picked, by ID, for the save.
    const pool = new Map();
    const blurb = class_item?.system.description ?? null;

    // Get races and alignments, if the character doesn't have them yet.
    const entries = list => (typeof list == 'object' && list)
      ? Object.entries(list).map(([key, entry]) => ({ key, label: entry.label, description: entry.description }))
      : [];
    const details = this.actor.system.details;
    const races = class_item && (!details.race.value || !details.race.description) ? entries(class_item.system.races) : [];
    const alignments = class_item && (!details.alignment.value || !details.alignment.description) ? entries(class_item.system.alignments) : [];

    // Starting gear: each group says what to take from it.
    const equipment = isNewCharacter ? await DwClassGear.prepare(class_item) : [];

    // Get ability scores.
    const noAbilityScores = game.settings.get('dungeonworld', 'noAbilityScores');
    const ability_scores = noAbilityScores ? [2, 1, 1, 0, 0, -1] : [16, 15, 13, 12, 9, 8];

    const templateData = {
      viewer: false,
      actorId: actor.id,
      char_class_name: actorData.details.class,
      level_label: isNewCharacter
        ? game.i18n.localize('DW.LevelUp.NewCharacter')
        : game.i18n.format('DW.LevelUp.ToLevel', { level }),
      // The class's story only when it's new to the character.
      blurb: isNewCharacter && blurb?.length > 0 ? blurb : null,
      races: races.length > 0 ? races : null,
      alignments: alignments.length > 0 ? alignments : null,
      equipment: equipment.length ? equipment : null,
      ability_scores: isNewCharacter ? ability_scores : null,
      ability_mods_only: noAbilityScores,
      ability_labels: this.#abilityLabels(),
      // Each level after the first raises one ability, unless that's off.
      ability_increase: !isNewCharacter && !game.settings.get('dungeonworld', 'noAbilityIncrease'),
    };

    // Classes the character advances in: their own, then any multiclasses.
    const own = [class_item ? primary : null, ...this.#multiclasses.map(n => this.#resolveClass(n, classes))]
      .filter(c => c?.item);
    let spells = [];

    if (isNewCharacter) {
      const moves = this.#availableMoves(await this.#classMoves(primary), level);
      DwLevelUp.#remember(pool, moves);
      templateData.starting_move_groups = DwLevelUp.#startingGroups(moves);
      templateData.starting_moves = templateData.starting_move_groups ? true : null;
      const caster = await this.#classSpells(primary, level);
      if (caster) spells.push(caster);
    }
    else {
      // Spells come with the class that gains this level (in the advancement
      // below). Moves like Divine Favor grow every level, at their own
      // casting level.
      for (const caster of await this.#grantedCasters(own, level, classes)) spells.push(caster);
      const classLevels = DwUtility.classLevels(actor);

      // This level's advancement: an advanced move from a class they have, or
      // (with the Allow Multiclassing setting) a new class's starting moves.
      // Secret classes are never offered.
      const allowMulticlass = game.settings.get('dungeonworld', 'allowMulticlass');
      const others = allowMulticlass
        ? classes.filter(c => !own.some(o => o.item === c) && !c.system.secret).map(c => c.name)
        : [];
      // A class at level 10 can't advance further; the level goes to another
      // class (or a new one, multiclassing).
      const open = own.filter(c => (classLevels.find(l => DwUtility.sameClass(l.name, c.name))?.level ?? 0) < MAX_CLASS_LEVEL);
      const mode = open.length ? 'advanced' : 'multiclass';
      const classNames = mode == 'advanced' ? open.map(c => c.name) : others;
      // Nothing to choose (an unknown class, no multiclassing): the level up
      // still raises an ability.
      templateData.advancement = classNames.length ? {
        mode,
        allowMulticlass,
        own: open.map(c => c.name),
        others,
        classes: classNames,
        className: classNames[0],
        section: await this.#advancementContext(mode, classNames[0], classLevels, classes, pool),
      } : null;
    }

    // Name each class's spells when there's more than one.
    if (spells.length > 1) {
      for (const caster of spells) caster.heading ??= game.i18n.format('DW.LevelUp.ClassSpells', { class: DwLevelUp.#shortName(caster.className) });
    }
    DwLevelUp.#remember(pool, DwLevelUp.#spellDocs(spells));
    templateData.cast_spells = spells.length > 0;
    templateData.spells = spells.length > 0 ? spells : null;

    const itemData = {
      pool,
      races: races,
      alignments: alignments,
      gear: equipment,
      class_item: class_item,
      classes,
      level,
    };

    await DwLevelUp.#open(
      `dw-level-up-${actor.id}`,
      `${game.i18n.localize('DW.LevelUp.Title')}: ${actor.name}`,
      templateData,
      form => this._onLevelUpSave(form, this.actor, itemData),
      { refresh: (form, control) => this.#refreshAdvancement(form, control, templateData.advancement, DwUtility.classLevels(actor), classes, pool) }
    );
  }

  /**
   * What the advancement offers for a mode and class, at the class level it
   * reaches: the class's advanced moves and spells, or (multiclass) its
   * starting moves and its spells as a new character of that class would get
   * them.
   * @param {{name: string, level: number}[]} classLevels  From DwUtility.classLevels().
   */
  async #advancementContext(mode, className, classLevels, classes, pool) {
    if (!className) return { multiclass: mode == 'multiclass' };
    const cls = this.#resolveClass(className, classes);
    const short = DwLevelUp.#shortName(cls.name);
    const from = mode == 'multiclass' ? 0 : (classLevels.find(c => DwUtility.sameClass(c.name, cls.name))?.level ?? 0);
    const reach = from + 1;
    const moves = this.#availableMoves(await this.#classMoves(cls), reach);
    DwLevelUp.#remember(pool, moves);

    const caster = await this.#classSpells(cls, reach);
    if (caster) caster.heading = game.i18n.format('DW.LevelUp.ClassSpells', { class: short });
    DwLevelUp.#remember(pool, DwLevelUp.#spellDocs(caster ? [caster] : []));
    const level_hint = from
      ? game.i18n.format('DW.LevelUp.ClassLevelTo', { class: short, from, to: reach })
      : game.i18n.format('DW.LevelUp.ClassLevelNew', { class: short });

    if (mode == 'multiclass') {
      return {
        multiclass: true,
        level_hint,
        starting_move_groups: DwLevelUp.#startingGroups(moves),
        spells: caster ? [caster] : null,
      };
    }

    const advanced_2 = moves.filter(m => m.system.requiresLevel >= 2 && m.system.requiresLevel < 6);
    const advanced_6 = moves.filter(m => m.system.requiresLevel >= 6);
    return {
      multiclass: false,
      level_hint,
      advanced_moves_2: advanced_2.length ? advanced_2 : null,
      advanced_moves_6: advanced_6.length ? advanced_6 : null,
      spells: caster ? [caster] : null,
    };
  }

  /**
   * The mode or class changed: offer the right classes for the mode, then
   * return the new choices.
   */
  async #refreshAdvancement(form, control, advancement, classLevels, classes, pool) {
    const mode = form.querySelector('[name="dw-advance-mode"]:checked')?.value ?? advancement.mode;
    const select = form.querySelector('[name="dw-advance-class"]');
    if (control.name == 'dw-advance-mode') {
      const names = mode == 'multiclass' ? advancement.others : advancement.own;
      select.replaceChildren(...names.map(name => new Option(name, name)));
    }
    const context = await this.#advancementContext(mode, select.value, classLevels, classes, pool);
    return foundry.applications.handlebars.renderTemplate(`${PARTIALS}/level-up-advancement.html`, context);
  }

  /**
   * Import moves.
   * @param {HTMLFormElement} form The level up window's form.
   */
  /**
   * A race or alignment the player wrote themselves. Throws, with a message
   * for the player, if it has no name.
   *
   * @param {HTMLFormElement} form
   * @param {string} kind "race" or "alignment".
   * @return {{label: string, description: string}}
   */
  static #ownChoice(form, kind) {
    const label = String(form.querySelector(`[name="own-${kind}-name"]`)?.value ?? '').trim();
    const description = String(form.querySelector(`[name="own-${kind}-description"]`)?.value ?? '').trim();
    if (!label) throw new Error(game.i18n.localize(`DW.LevelUp.Own${kind.capitalize()}Missing`));
    const escape = (text) => Handlebars.escapeExpression(text);
    return { label, description: description ? `<p>${escape(description)}</p>` : '' };
  }

  async _onLevelUpSave(form, actor, itemData) {
    // The advancement controls only steer what's offered.
    const selected = [...form.querySelectorAll('input:checked, select')]
      .filter(input => !input.name?.startsWith('dw-advance-'));

    if (selected.length <= 0) {
      return;
    }

    // Starting gear first: an incomplete choice stops the save here.
    const gear = itemData.gear?.length ? DwClassGear.chosen(form, itemData.gear) : null;

    let item_ids = [];
    let abilities = [];
    let race = null;
    let alignment = null;
    for (let input of selected) {
      if (input.dataset.itemId) {
        if (['move', 'spell'].includes(input.dataset.type)) {
          item_ids.push(input.dataset.itemId);
        }
      }
      else if (input.dataset.race) {
        race = input.dataset.race == 'own' ? DwLevelUp.#ownChoice(form, 'race') : itemData.races[input.dataset.race];
      }
      else if (input.dataset.alignment) {
        alignment = input.dataset.alignment == 'own' ? DwLevelUp.#ownChoice(form, 'alignment') : itemData.alignments[input.dataset.alignment];
      }
      else if (input.dataset.ability) {
        let val = input.value;
        let abl = input.dataset.ability;
        // Abilities left at "—" keep their current score.
        if (val !== '') {
          abilities[`abilities.${abl}.value`] = val;
        }
      }
      else if (input.dataset.type == 'ability-increase') {
        let abl = input.value;
        abilities[`abilities.${abl}.value`] = Number(actor.system.abilities[abl].value) + 1;
      }
    }

    // Add the selected moves and spells.
    const new_moves = item_ids.map(id => itemData.pool.get(id)).filter(Boolean).map(doc => foundry.utils.duplicate(doc));
    // A move that grants spellcasting remembers the level it was taken at, so
    // its casting level can grow from there.
    for (const move of new_moves) {
      if (move.type == 'move' && move.system.grants?.casting) {
        foundry.utils.setProperty(move, 'flags.dungeonworld.takenAtLevel', itemData.level);
      }
    }

    // The chosen gear, and any coins that came with it.
    const new_equipment = gear?.items ?? null;

    const system = {};
    if (race) {
      system['details.race'] = {
        value: race.label,
        description: race.description
      };
    }
    if (alignment) {
      system['details.alignment'] = {
        value: alignment.label,
        description: alignment.description
      }
    }
    if (abilities != []) {
      for (let [key, update] of Object.entries(abilities)) {
        system[key] = update;
      }
    }

    // Adjust level.
    if (Number(actor.system.attributes.xp.value) > 0) {
      const xpRequired = actor.system.attributes.xp.max ?? Number(actor.system.attributes.level.value ?? 1) + 7;
      let xp = Number(actor.system.attributes.xp.value) - xpRequired;
      system['attributes.xp.value'] = xp > -1 ? xp : 0;
      system['attributes.level.value'] = Number(actor.system.attributes.level.value) + 1;
    }

    // A new character chooses their bonds after the level up: the class's
    // bonds are offered, alongside bonds of their own.
    const isNewCharacter = Number(actor.system.attributes.xp.value) == 0;

    // HP, load and damage come from the character's own class, when it's known.
    const class_item = itemData.class_item;

    // Adjust hp: max HP is the class's base HP plus Constitution. On a level
    // up, only when it's still exactly that beforehand; anything else means
    // something custom changed it (a house rule, a homebrew move), so leave
    // it alone. A new character always gets it.
    // Someone who changed class beyond level 10 keeps their HP.
    const keepHp = !!actor.flags?.dungeonworld?.keepHp;
    if (class_item?.system.hp && !keepHp) {
      const noConstitutionToHP = game.settings.get('dungeonworld', 'noConstitutionToHP');
      const currentCon = noConstitutionToHP ? 0 : Number(actor.system.abilities.con.value);
      const newCon = noConstitutionToHP ? 0 : Number(system['abilities.con.value'] ?? currentCon);
      const baseHp = Number(class_item.system.hp);
      const currentMax = Number(actor.system.attributes.hp.max);
      const isNewCharacter = Number(actor.system.attributes.xp.value) == 0;

      if (isNewCharacter || currentMax === baseHp + currentCon) {
        system['attributes.hp.max'] = baseHp + newCon;
        const hpDelta = Math.max(system['attributes.hp.max'] - currentMax, 0);
        system['attributes.hp.value'] = Number(actor.system.attributes.hp.value) + hpDelta;
      }
      else if (newCon !== currentCon) {
        ui.notifications.info(game.i18n.format('DW.LevelUp.CustomMaxHp', { max: currentMax, expected: baseHp + currentCon }));
      }
    }

    // Adjust load.
    if (class_item?.system.load) {
      const noSTRToMaxLoad = game.settings.get('dungeonworld', 'noSTRToMaxLoad');
      if (noSTRToMaxLoad) {
        system['attributes.weight.max'] = Number(class_item.system.load)
      } else {
        let strength = actor.system.abilities.str.value;
        if (system['abilities.str.value']) {
          strength = system['abilities.str.value'];
        }
        system['attributes.weight.max'] = Number(class_item.system.load) + Number(DwUtility.getAbilityMod(strength));
      }
    }

    // Multiclassing adds the class, so its advanced moves are offered later.
    if (gear?.coins) system['attributes.coin.value'] = (Number(actor.system.attributes.coin?.value) || 0) + gear.coins;
    const update = { system: system, 'flags.dungeonworld.levelup': false };
    if (keepHp) Object.assign(update, DwUtility.deletionUpdate('flags.dungeonworld.keepHp'));
    const mode = form.querySelector('[name="dw-advance-mode"]:checked')?.value;
    const advancing = form.querySelector('[name="dw-advance-class"]')?.value;
    const multiclasses = mode == 'multiclass' && advancing && !this.#multiclasses.includes(advancing)
      ? [...this.#multiclasses, advancing]
      : this.#multiclasses;
    if (multiclasses !== this.#multiclasses) update['flags.dungeonworld.multiclasses'] = multiclasses;

    // Damage die: the largest of their classes', so multiclassing into a
    // class with a bigger die raises it (and later level ups keep it).
    const dice = [class_item, ...multiclasses.map(name => this.#resolveClass(name, itemData.classes ?? []).item)]
      .map(c => c?.system?.damage)
      .filter(die => DAMAGE_DICE.includes(die));
    if (dice.length) {
      system['attributes.damage.value'] = dice.reduce((best, die) => DAMAGE_DICE.indexOf(die) > DAMAGE_DICE.indexOf(best) ? die : best);
    }
    // The class chosen for this level gains it; a new class starts at 1.
    if (advancing && system['attributes.level.value']) {
      const levels = {};
      for (const c of DwUtility.classLevels(actor)) levels[c.name] = c.level;
      const key = Object.keys(levels).find(name => DwUtility.sameClass(name, advancing));
      if (key) levels[key] += 1;
      else levels[advancing] = 1;
      update['flags.dungeonworld.classLevels'] = levels;
    }

    // Create all new items in a single operation.
    const new_items = [
      ...new_moves,
      ...(new_equipment ?? []),
    ];
    let created = [];
    if (new_items.length > 0) {
      created = await actor.createEmbeddedDocuments('Item', new_items);
    }

    await actor.update(update);

    // Moves that grant another class's move or spell: pick it next, one at a
    // time. Not awaited, so the level up window closes first.
    const grants = created.filter(i => i.type == 'move'
      && (i.system.grants?.kind || i.system.grants?.moves || i.system.grants?.casting));
    const picking = grants.length ? this.#pickGrants(grants, itemData.level) : Promise.resolve();

    if (isNewCharacter) {
      picking.then(() => DwBonds.choose(actor, DwBonds.classBonds(actor.system.details.class)));
    }
  }

  async #pickGrants(moves, level) {
    try {
      for (const move of moves) {
        const grants = move.system.grants;
        if (grants.moves) await this.#addGrantedMoves(move);
        if (grants.kind) await this.#pickGrant(move, this.#grantLevel(move, level));
        if (grants.casting) await this.#pickGrantedSpells(move, 1);
      }
    }
    catch (err) {
      console.error('Dungeon World | Picking a granted move failed', err);
    }
  }

  /* -------------------------------------------- */
  /*  Moves that grant another class's move       */
  /* -------------------------------------------- */

  /**
   * Open the picker for what a move grants, and wait until it's closed.
   * @param {Item} move  A move with system.grants.kind 'move' or 'spell'.
   * @param {number} level  The level to pick at, before the move's offset.
   */
  async #pickGrant(move, level) {
    const { kind, classes: allowed = '', levelOffset = 0 } = move.system.grants;
    const pickLevel = Math.max(1, level + Number(levelOffset || 0));
    const classes = await DwClassList.getClasses(false);
    const own = this.actor.system.details.class;

    // The listed classes, or any class other than the character's own. A
    // secret class is only offered when the move names it.
    const listed = allowed.split(',').map(n => n.trim()).filter(Boolean);
    const candidates = listed.length
      ? classes.filter(c => listed.some(n => DwLevelUp.#sameClass(n, c.name)))
      : classes.filter(c => !c.system.secret && !DwLevelUp.#sameClass(c.name, own) && !DwLevelUp.#sameClass(c.name, move.system.class));

    // Only offer classes that have something left to pick.
    const pool = new Map();
    const sections = new Map();
    for (const candidate of candidates) {
      const section = await this.#grantContext(kind, this.#resolveClass(candidate.name, classes), pickLevel, pool);
      if (section.groups || section.spells) sections.set(candidate.name, section);
    }
    if (!sections.size) {
      ui.notifications.info(game.i18n.format('DW.LevelUp.NothingToPick', { move: move.name }));
      return;
    }

    const names = [...sections.keys()];
    const context = {
      pick: 'dw-grant-pick',
      move_name: move.name,
      move_description: move.system.description,
      title: game.i18n.localize(kind == 'spell' ? 'DW.LevelUp.PickSpell' : 'DW.LevelUp.PickMove'),
      level_label: game.i18n.format(kind == 'spell' ? 'DW.LevelUp.PickSpellLevel' : 'DW.LevelUp.PickLevel', { level: pickLevel }),
      classes: names,
      className: names[0],
      section: sections.get(names[0]),
    };

    await new Promise(resolve => {
      DwLevelUp.#open(
        `dw-grant-${this.actor.id}`,
        `${move.name}: ${this.actor.name}`,
        context,
        async form => {
          const id = form.querySelector('[name="dw-grant-pick"]:checked')?.dataset.itemId;
          const picked = id && pool.get(id);
          if (picked) await this.actor.createEmbeddedDocuments('Item', [foundry.utils.duplicate(picked)]);
        },
        {
          template: 'systems/dungeonworld/templates/dialog/grant-picker.html',
          position: { width: 820, height: 640 },
          onClose: resolve,
          refresh: (form, control) => foundry.applications.handlebars.renderTemplate(
            `${PARTIALS}/grant-choices.html`, sections.get(control.value) ?? {}),
        }
      );
    });
  }

  /**
   * The level a granting move picks at: the character's level in the move's
   * own class (a Bard 3's Multiclass Dabbler uses 3), or their level overall
   * if they have no levels in it.
   */
  #grantLevel(move, level) {
    return DwUtility.classLevels(this.actor).find(c => DwUtility.sameClass(c.name, move.system.class))?.level ?? level;
  }

  /** The class a move's granted moves and spells come from: the first listed. */
  #grantSource(move, classes) {
    const name = (move.system.grants?.classes ?? '').split(',').map(n => n.trim()).find(Boolean);
    const item = name && classes.find(c => DwLevelUp.#sameClass(c.name, name));
    return item ? this.#resolveClass(item.name, classes) : null;
  }

  /**
   * Spells from the character's moves that grant casting (Divine Favor), at
   * each one's casting level: 1 at the level it was taken, +1 per level since.
   * Classes the character already casts as are skipped.
   */
  async #grantedCasters(own, level, classes) {
    const casters = [];
    const moves = this.actor.items.filter(i => i.type == 'move' && i.system.grants?.casting);
    for (const move of moves) {
      const cls = this.#grantSource(move, classes);
      if (!cls || own.some(o => DwLevelUp.#sameClass(o.name, cls.name))) continue;
      if (casters.some(c => DwLevelUp.#sameClass(c.className, cls.name))) continue;
      // Taken before the level was recorded: count from the current level.
      const takenAt = Number(move.flags?.dungeonworld?.takenAtLevel ?? this.actor.system.attributes.level.value);
      const castLevel = Math.max(1, level - takenAt + 1);
      const caster = await this.#classSpells(cls, castLevel);
      if (!caster) continue;
      caster.heading = game.i18n.format('DW.LevelUp.GrantedSpells', { class: DwLevelUp.#shortName(cls.name), move: move.name, level: castLevel });
      casters.push(caster);
    }
    return casters;
  }

  /** Add the moves a move names (Commune and Cast a Spell for Divine Favor). */
  async #addGrantedMoves(move) {
    const classes = await DwClassList.getClasses(false);
    const cls = this.#grantSource(move, classes);
    if (!cls) return;
    const wanted = move.system.grants.moves.split(',').map(n => n.trim().toLowerCase()).filter(Boolean);
    const owned = this.actor.items.filter(i => i.type == 'move').map(i => i.name.toLowerCase());
    const moves = (await this.#classMoves(cls))
      .filter(m => wanted.includes(m.name.toLowerCase()) && !owned.includes(m.name.toLowerCase()));
    if (moves.length) await this.actor.createEmbeddedDocuments('Item', moves.map(m => foundry.utils.duplicate(m)));
  }

  /**
   * Choose spells from a move that grants casting, as that class at a level.
   * Rotes are included; the rest are checkboxes, as for the class itself.
   */
  async #pickGrantedSpells(move, castLevel) {
    const classes = await DwClassList.getClasses(false);
    const cls = this.#grantSource(move, classes);
    const caster = cls && await this.#classSpells(cls, castLevel);
    if (!caster) return;
    const pool = new Map();
    DwLevelUp.#remember(pool, DwLevelUp.#spellDocs([caster]));

    const context = {
      move_name: move.name,
      move_description: move.system.description,
      title: game.i18n.format('DW.LevelUp.PickGrantedSpells', { class: DwLevelUp.#shortName(cls.name) }),
      level_label: game.i18n.format('DW.LevelUp.CastingLevel', { level: castLevel, class: DwLevelUp.#shortName(cls.name) }),
      // The title names the class already.
      classes: [],
      className: null,
      section: { spells: [caster] },
    };

    await new Promise(resolve => {
      DwLevelUp.#open(
        `dw-grant-${this.actor.id}`,
        `${move.name}: ${this.actor.name}`,
        context,
        async form => {
          const spells = [...form.querySelectorAll('input[data-type="spell"]:checked')]
            .map(input => pool.get(input.dataset.itemId)).filter(Boolean);
          if (spells.length) await this.actor.createEmbeddedDocuments('Item', spells.map(s => foundry.utils.duplicate(s)));
        },
        {
          template: 'systems/dungeonworld/templates/dialog/grant-picker.html',
          position: { width: 820, height: 640 },
          onClose: resolve,
        }
      );
    });
  }

  /**
   * What one class offers a grant: its moves up to the level (not moves that
   * grant moves themselves), or its spells.
   */
  async #grantContext(kind, cls, level, pool) {
    if (kind == 'spell') {
      const caster = await this.#classSpells(cls, level);
      DwLevelUp.#remember(pool, DwLevelUp.#spellDocs(caster ? [caster] : []));
      return { pick: 'dw-grant-pick', spells: caster ? [caster] : null };
    }

    const moves = this.#availableMoves(await this.#classMoves(cls), level)
      .filter(m => !m.system.grants?.kind);
    DwLevelUp.#remember(pool, moves);
    const groups = [
      { title: game.i18n.localize('DW.LevelUp.Starting'), moves: moves.filter(m => m.system.requiresLevel < 2) },
      { title: game.i18n.localize('DW.LevelUp.Levels2'), moves: moves.filter(m => m.system.requiresLevel >= 2 && m.system.requiresLevel < 6) },
      { title: game.i18n.localize('DW.LevelUp.Levels6'), moves: moves.filter(m => m.system.requiresLevel >= 6) },
    ].filter(g => g.moves.length);
    return { pick: 'dw-grant-pick', groups: groups.length ? groups : null };
  }

  // @todo abstract the logic in this method so that we can combine it with onLevelUp as much as possible.
  async _onClassView(event) {
    event.preventDefault();

    const actor = this.actor;
    const actorData = this.actor.system;
    let orig_class_name = actorData.details.class;
    let char_class_name = orig_class_name.trim();
    let class_list_items = await DwClassList.getClasses(false);
    let class_list = class_list_items.map(c => c.name);

    let char_class = DwUtility.cleanClass(char_class_name);

    // Get the original class name if this was a translation.
    if (game.babele) {
      let babele_classes = game.babele.translations.find(p => p.collection == 'dungeonworld.classes');
      if (babele_classes) {
        let babele_pack = babele_classes.entries.find(p => p.name == char_class_name);
        if (babele_pack) {
          char_class_name = babele_pack.id;
          char_class = DwUtility.cleanClass(babele_pack.id);
        }
      }
    }

    if (!class_list.includes(orig_class_name) && !class_list.includes(char_class_name)) {
      ui.notifications.warn(game.i18n.localize('DW.Notifications.noClassWarning'));
      return;
    }

    const compendium = await DwUtility.loadCompendia(`${char_class}-moves`)

    let class_item = class_list_items.find(i => i.name == orig_class_name);
    if (!class_item?.system) {
      ui.notifications.warn(game.i18n.localize('DW.Notifications.noClassWarning'));
      return;
    }
    let blurb = class_item ? class_item.system.description : null;

    // Get races.
    let races = [];
      races = class_item.system.races;
      if (typeof races == 'object') {
        races = Object.entries(races).map(r => {
          return {
            key: r[0],
            label: r[1]['label'],
            description: r[1]['description']
          };
        });
      }

    // Get alignments.
    let alignments = [];
      alignments = class_item.system.alignments;
      if (typeof alignments == 'object') {
        alignments = Object.entries(alignments).map(a => {
          return {
            key: a[0],
            label: a[1]['label'],
            description: a[1]['description']
          };
        });
      }

    // Starting gear.
    const equipment = await DwClassGear.prepare(class_item);

    // Get ability scores.
    const noAbilityScores = game.settings.get('dungeonworld', 'noAbilityScores');
    let ability_scores = [16, 15, 13, 12, 9, 8];
    if (noAbilityScores) {
      ability_scores = [2, 1, 1, 0, 0, -1];
    }
    let ability_labels = this.#abilityLabels();

    // Retrieve the actor's current moves so that we can hide them.
    const actorMoves = this.actor.items.filter(i => i.type == 'move');

    // Get the item moves as the priority.
    let moves = game.items.filter(m => m.type == 'move' && m.system.class == char_class_name);
    // Get the compendium moves next.
    let moves_compendium = compendium.filter(m => {
      return true;
    });

    // Append compendium moves to the item moves.
    let moves_list = moves.map(m => {
      return m.name;
    })
    for (let move of moves_compendium) {
      if (!moves_list.includes(move.name)) {
        moves.push(move);
      }
    }

    // Sort the moves and build our groups.
    moves.sort((a, b) => {
      return a.system.requiresLevel - b.system.requiresLevel;
    });

    let starting_moves = [];
    let starting_move_groups = [];
      starting_moves = moves.filter(m => {
        return m.system.requiresLevel < 2;
      });

      starting_move_groups = starting_moves.reduce((groups, move) => {
        // Assign the undefined group to all Z's so that it's last.
        let group = move.system.moveGroup ? move.system.moveGroup : 'ZZZZZZZ';
        if (!groups[group]) {
          groups[group] = [];
        }

        groups[group].push(move);
        return groups;
      }, {});

    let advanced_moves_2 = moves.filter(m => {
      return m.system.requiresLevel >= 2 && m.system.requiresLevel < 6;
    });

    let advanced_moves_6 = moves.filter(m => {
      return m.system.requiresLevel >= 6;
    });

    // Determine if spells can be cast.
    let cast_spells = [];
    let spells = null;
    if (char_class == 'the-wizard') {
      cast_spells.push('wizard');
    }
    else if (char_class == 'the-cleric') {
      cast_spells.push('cleric');
    }
    else {
      cast_spells.push(char_class);
    }

    if (cast_spells.length > 0) {
      // Retrieve the actor's current moves so that we can hide them.
      let spell_preparation_type = null;
      spells = [];
      for (let caster_class of cast_spells) {
        // Get the item spells as the priority.
        let spells_items = game.items.filter(i => {
          // Return true for custom spell items that have a class.
          return i.type == 'spell'
            && i.system.class
          // Check if this spell has either `classname` or `the classname` as its class.
            && [caster_class, `the ${caster_class}`].includes(DwUtility.cleanClass(i.system.class));
        });
        const spells_compendium = await DwUtility.loadCompendia(`${char_class}-spells`);

        // Get the compendium spells next.
        let spells_compendium_items = spells_compendium;

        // Append compendium spells to the item spells.
        let spells_list = spells.map(s => {
          return s.name;
        })
        // Add to the array, and also add to a sorted by level array.
        for (let spell of spells_compendium_items) {
          if (!spells_list.includes(spell.name)) {
            spells_items.push(spell);
          }
        }

        // Skip this class if there were no spells in it.
        if (spells_items.length < 1) {
          continue;
        }

        // Sort the spells and build our groups.
        spells_items.sort((a, b) => {
          return a.system.spellLevel - b.system.spellLevel;
        });

        let spell_groups = spells_items.reduce((groups, spell) => {
          // Default to rotes.
          let group = spell.system.spellLevel ? spell.system.spellLevel : 0;
          if (!groups[group]) {
            groups[group] = [];
          }

          groups[group].push(spell);
          return groups;
        }, {});

        // Get the description for how to prepare spells for this class.
        if (caster_class == 'wizard') {
          let move = moves.filter(m => m.name == 'Spellbook');
          if (move && move.length > 0) {
            spell_preparation_type = move[0].system.description;
          }
          else {
            move = actorMoves.filter(m => m.name == 'Spellbook');
            if (move && move.length > 0) {
              // @todo: v10 test this.
              spell_preparation_type = move[0].system.description;
            }
          }
        }
        else if (caster_class == 'cleric') {
          let move = moves.filter(m => m.name == 'Commune');
          if (move && move.length > 0) {
            spell_preparation_type = move[0].system.description;
          }
          else {
            move = actorMoves.filter(m => m.name == 'Commune');
            if (move && move.length > 0) {
              // @todo: v10 test this.
              spell_preparation_type = move[0].system.description;
            }
          }
        }

        spells.push({
          description: spell_preparation_type,
          spells: spell_groups
        });
      }
    }

    // Build the content. The viewer only lists the class: no ability scores
    // to choose, and every race, alignment, move and spell.
    const templateData = {
      viewer: true,
      char_class: char_class,
      char_class_name: orig_class_name,
      blurb: blurb?.length > 0 ? blurb : null,
      races: races.length > 0 ? races : null,
      alignments: alignments.length > 0 ? alignments : null,
      equipment: equipment.length ? equipment : null,
      starting_moves: starting_moves.length > 0 ? starting_moves : null,
      starting_move_groups: starting_move_groups,
      advanced_moves_2: advanced_moves_2.length > 0 ? advanced_moves_2 : null,
      advanced_moves_6: advanced_moves_6.length > 0 ? advanced_moves_6 : null,
      cast_spells: cast_spells.length > 0 && spells.length > 0 ? true : false,
      spells: spells.length > 0 ? spells : null,
    };

    await DwLevelUp.#open(
      `dw-class-viewer-${actor.id}`,
      `${game.i18n.localize('DW.ClassViewer')}: ${orig_class_name}`,
      templateData
    );
  }
}
