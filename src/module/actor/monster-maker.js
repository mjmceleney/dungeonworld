import { DwUtility } from "../utility.js";

const { HandlebarsApplicationMixin, ApplicationV2 } = foundry.applications.api;
const { FormDataExtended } = foundry.applications.ux;

/** Damage dice from smallest to largest, for "one size" changes. */
const DICE = ['d4', 'd6', 'd8', 'd10', 'd12'];

/**
 * The rules' monster questions. Each option's effects:
 * tags, hp, armor, damage (a bonus), piercing, die (the starting die),
 * step (die sizes up or down), best/worst (roll damage twice), move (asks
 * for a move), quality (asks for a special quality), and some with a choice:
 * gods (+2 damage, HP or both), metal (+1 or +3 piercing), ranged (near/far).
 */
const QUESTIONS = {
  group: { multiple: false, options: {
    horde: { tags: ['horde'], die: 'd6', hp: 3 },
    group: { tags: ['group'], die: 'd8', hp: 6 },
    solitary: { tags: ['solitary'], die: 'd10', hp: 12 },
  } },
  size: { multiple: false, options: {
    tiny: { tags: ['tiny', 'hand'], damage: -2 },
    small: { tags: ['small', 'close'] },
    human: { tags: ['close'] },
    large: { tags: ['large', 'close', 'reach'], hp: 4, damage: 1 },
    huge: { tags: ['huge', 'reach'], hp: 8, damage: 3 },
  } },
  defense: { multiple: false, options: {
    cloth: { armor: 0 },
    leather: { armor: 1 },
    mail: { armor: 2 },
    plate: { armor: 3 },
    magic: { armor: 4, tags: ['magical'] },
  } },
  knownFor: { multiple: true, options: {
    strength: { damage: 2, tags: ['forceful'] },
    offense: { best: true },
    defense: { armor: 1 },
    deft: { piercing: 1 },
    endurance: { hp: 4 },
    deceit: { tags: ['stealthy'], move: true },
    adaptation: { quality: true },
    gods: { tags: ['divine'], gods: true },
    magic: { tags: ['magical'], move: true },
  } },
  attack: { multiple: true, options: {
    vicious: { damage: 2 },
    reach: { tags: ['reach'] },
    weak: { step: -1 },
    metal: { tags: ['messy'], metal: true },
    ignoresArmor: { tags: ['ignores armor'] },
    ranged: { ranged: true },
  } },
  describe: { multiple: true, options: {
    devious: { tags: ['devious'], step: -1, move: true },
    organized: { tags: ['organized'], move: true },
    intelligent: { tags: ['intelligent'] },
    cautious: { tags: ['cautious'], armor: 1 },
    hoarder: { tags: ['hoarder'] },
    planar: { tags: ['planar'], move: true },
    alive: { hp: 4 },
    construct: { tags: ['construct'], quality: true },
    terrifying: { tags: ['terrifying'], quality: true },
    amorphous: { tags: ['amorphous'], armor: 1, hp: 3 },
    ancient: { step: 1 },
    abhors: { worst: true },
  } },
};

/** Answers for a new monster. */
const DEFAULTS = { group: 'group', size: 'human', defense: 'cloth' };

/**
 * Build a monster's stats by answering the rules' monster questions, then
 * write them to an NPC: HP, armor, damage, tags, special qualities, instinct
 * and moves. The answers are kept on the NPC, so it can be rebuilt later.
 */
export class DwMonsterMaker extends HandlebarsApplicationMixin(ApplicationV2) {

  /**
   * @param {Actor} actor The NPC to build.
   * @param {Object} options
   */
  constructor(actor, options = {}) {
    super(options);
    this.actor = actor;
  }

  /** @override */
  static DEFAULT_OPTIONS = {
    tag: "form",
    classes: ["dw-v2", "dw-levelup-window", "dw-monster-maker"],
    position: {
      width: 880,
      height: 760,
    },
    window: {
      resizable: true,
      icon: "fa-solid fa-dragon",
    },
    form: {
      handler: DwMonsterMaker.#onSubmit,
      closeOnSubmit: true,
    },
    actions: {
      cancel: function() { this.close(); },
    },
  };

  /** @override */
  static PARTS = {
    body: {
      template: "systems/dungeonworld/templates/dialog/monster-maker.html",
      scrollable: [".dw-levelup-body"],
    },
  };

  /** @override */
  get title() {
    return game.i18n.format('DW.MonsterMaker.Title', { name: this.actor.name });
  }

  /** @inheritdoc */
  _initializeApplicationOptions(options) {
    options = super._initializeApplicationOptions(options);
    let dark = DwUtility.nightmode;
    if (options.classes.includes('theme-dark')) dark = true;
    else if (options.classes.includes('theme-light')) dark = false;
    if (dark) options.classes.push('dw-dark');
    return options;
  }

  /* -------------------------------------------- */

  /**
   * Work out a monster's stats from its answers.
   *
   * @param {Object} answers
   * @return {{hp: number, armor: number, damage: string, piercing: number,
   *   damageFlavor: string, tags: string[], qualities: string[],
   *   moves: string[], instinct: string}}
   */
  static compute(answers = {}) {
    const result = { hp: 0, armor: 0, bonus: 0, piercing: 0, step: 0, best: false, worst: false };
    let die = 'd6';
    const tags = [];
    const qualities = [];
    const moves = [];
    const text = answers.text ?? {};
    const addMove = (value) => {
      const move = String(value ?? '').trim();
      if (move) moves.push(move);
    };
    addMove(answers.knownMove);

    for (const [question, { multiple, options }] of Object.entries(QUESTIONS)) {
      const chosen = multiple
        ? Object.keys(options).filter(key => answers[question]?.[key])
        : [answers[question] ?? DEFAULTS[question]].filter(key => key in options);
      for (const key of chosen) {
        const option = options[key];
        tags.push(...(option.tags ?? []));
        result.hp += option.hp ?? 0;
        result.armor += option.armor ?? 0;
        result.bonus += option.damage ?? 0;
        result.piercing += option.piercing ?? 0;
        result.step += option.step ?? 0;
        if (option.die) die = option.die;
        if (option.best) result.best = true;
        if (option.worst) result.worst = true;
        if (option.gods) {
          const gods = answers.gods ?? 'both';
          if (gods != 'hp') result.bonus += 2;
          if (gods != 'damage') result.hp += 2;
        }
        if (option.metal) result.piercing += answers.metal == 'tear' ? 3 : 1;
        if (option.ranged) {
          const ranged = answers.ranged ?? 'near';
          if (ranged != 'far') tags.push('near');
          if (ranged != 'near') tags.push('far');
        }
        const extra = String(text[`${question}-${key}`] ?? '').trim();
        if (option.move) addMove(extra);
        if (option.quality && extra) qualities.push(extra);
      }
    }

    const index = Math.min(DICE.length - 1, Math.max(0, DICE.indexOf(die) + result.step));
    const size = DICE[index];
    // Rolling twice for the better and for the worse cancel out.
    let damage = size;
    if (result.best && !result.worst) damage = `2${size}kh`;
    else if (result.worst && !result.best) damage = `2${size}kl`;
    if (result.bonus) damage += result.bonus > 0 ? `+${result.bonus}` : `${result.bonus}`;

    const attack = String(answers.attackName ?? '').trim();
    const damageFlavor = [attack, result.piercing ? `${result.piercing} piercing` : ''].filter(Boolean).join(', ');

    return {
      hp: Math.max(1, result.hp),
      armor: result.armor,
      damage,
      piercing: result.piercing,
      damageFlavor,
      tags: [...new Set(tags)],
      qualities,
      moves,
      instinct: String(answers.instinct ?? '').trim(),
    };
  }

  /**
   * What an option does, in a few words: "+4 HP, +1 damage, large, reach".
   *
   * @param {Object} option
   * @return {string}
   */
  static #describe(option, base) {
    const parts = [];
    const loc = (key, data) => data ? game.i18n.format(`DW.MonsterMaker.Effect.${key}`, data) : game.i18n.localize(`DW.MonsterMaker.Effect.${key}`);
    // Base values (how it fights, its defense) are shown as they are; the
    // rest add to them.
    const amount = (value) => base ? `${value}` : (value < 0 ? `${value}` : `+${value}`);
    if (option.die) parts.push(loc('Die', { die: option.die }));
    if (option.hp) parts.push(loc('Hp', { hp: amount(option.hp) }));
    if (option.armor !== undefined) parts.push(loc('Armor', { armor: amount(option.armor) }));
    if (option.damage) parts.push(loc('Damage', { damage: option.damage > 0 ? `+${option.damage}` : `${option.damage}` }));
    if (option.piercing) parts.push(loc('Piercing', { piercing: option.piercing }));
    if (option.step) parts.push(loc(option.step > 0 ? 'StepUp' : 'StepDown'));
    if (option.best) parts.push(loc('Best'));
    if (option.worst) parts.push(loc('Worst'));
    if (option.metal) parts.push(loc('Metal'));
    if (option.gods) parts.push(loc('Gods'));
    if (option.ranged) parts.push(loc('Ranged'));
    if (option.move) parts.push(loc('Move'));
    if (option.quality) parts.push(loc('Quality'));
    parts.push(...(option.tags ?? []));
    return parts.join(', ');
  }

  /**
   * The follow-up choice an option asks for, if any: which bonus the gods
   * give, how it deals with metal, and how far it can attack.
   */
  static #select(option, answers) {
    const choices = (keys) => Object.fromEntries(keys.map(([key, label]) => [key, `DW.MonsterMaker.${label}`]));
    if (option.gods) return { name: 'gods', value: answers.gods ?? 'both',
      choices: choices([['both', 'GodsBoth'], ['damage', 'GodsDamage'], ['hp', 'GodsHp']]) };
    if (option.metal) return { name: 'metal', value: answers.metal ?? 'pierce',
      choices: choices([['pierce', 'MetalPierce'], ['tear', 'MetalTear']]) };
    if (option.ranged) return { name: 'ranged', value: answers.ranged ?? 'near',
      choices: choices([['near', 'RangedNear'], ['far', 'RangedFar'], ['both', 'RangedBoth']]) };
    return null;
  }

  /** The answers saved on the NPC, or a new monster's. */
  #savedAnswers() {
    const saved = this.actor.getFlag('dungeonworld', 'monsterMaker');
    if (saved) {
      // The instinct may have been edited on the sheet since.
      const answers = foundry.utils.deepClone(saved);
      answers.instinct = this.actor.system.details?.instinct || answers.instinct;
      return answers;
    }
    return { ...DEFAULTS, instinct: this.options.instinct ?? this.actor.system.details?.instinct ?? '' };
  }

  /** @override */
  async _prepareContext(options) {
    const answers = this.#savedAnswers();
    const text = answers.text ?? {};
    const questions = Object.entries(QUESTIONS).map(([id, { multiple, options }]) => ({
      id,
      multiple,
      title: game.i18n.localize(`DW.MonsterMaker.Q.${id}`),
      hint: multiple ? game.i18n.localize('DW.MonsterMaker.ChooseAll') : '',
      options: Object.entries(options).map(([key, option]) => ({
        key,
        name: multiple ? `${id}.${key}` : id,
        value: multiple ? 'true' : key,
        checked: multiple ? !!answers[id]?.[key] : (answers[id] ?? DEFAULTS[id]) == key,
        label: game.i18n.localize(`DW.MonsterMaker.${id}.${key}`),
        effect: DwMonsterMaker.#describe(option, id == 'group' || id == 'defense'),
        // Some answers ask for more: a move, a special quality or a choice.
        textName: option.move || option.quality ? `text.${id}-${key}` : null,
        textValue: text[`${id}-${key}`] ?? '',
        textLabel: option.move ? game.i18n.localize('DW.MonsterMaker.WriteMove') : game.i18n.localize('DW.MonsterMaker.WriteQuality'),
        select: DwMonsterMaker.#select(option, answers),
      })),
    }));
    return {
      answers,
      questions,
      preview: this.#preview(DwMonsterMaker.compute(answers)),
    };
  }

  /** The stats summary shown at the top. */
  #preview(stats) {
    return {
      hp: stats.hp,
      armor: stats.armor,
      damage: stats.damage,
      damageFlavor: stats.damageFlavor,
      tags: stats.tags.join(', '),
      qualities: stats.qualities.join(', '),
      moves: stats.moves.length,
    };
  }

  /** The form's current answers. */
  #readAnswers() {
    return foundry.utils.expandObject(new FormDataExtended(this.element).object);
  }

  /** @inheritdoc */
  _onRender(context, options) {
    super._onRender(context, options);
    // Keep the summary up to date as answers change.
    const update = () => {
      const preview = this.#preview(DwMonsterMaker.compute(this.#readAnswers()));
      for (const [key, value] of Object.entries(preview)) {
        const element = this.element.querySelector(`[data-preview="${key}"]`);
        if (element) element.textContent = value === '' ? '—' : value;
      }
    };
    this.element.addEventListener('change', update);
    this.element.addEventListener('input', update);
  }

  /**
   * Write the monster's stats to the NPC, and add any new moves.
   * @this {DwMonsterMaker}
   */
  static async #onSubmit(event, form, formData) {
    const answers = foundry.utils.expandObject(formData.object);
    const stats = DwMonsterMaker.compute(answers);
    const actor = this.actor;
    const tags = stats.tags.map(value => ({ value }));
    await actor.update({
      'system.attributes.hp.value': stats.hp,
      'system.attributes.hp.max': stats.hp,
      'system.attributes.ac.value': stats.armor,
      'system.attributes.damage.value': stats.damage,
      'system.attributes.damage.piercing': stats.damageFlavor,
      'system.tags': JSON.stringify(tags),
      'system.tagsString': stats.tags.join(', '),
      'system.attributes.specialQualities.value': stats.qualities.join(', '),
      'system.details.instinct': stats.instinct,
      'flags.dungeonworld.monsterMaker': answers,
    });

    const existing = new Set(actor.items.filter(i => i.type == 'npcMove').map(i => i.name.trim().toLowerCase()));
    const moves = stats.moves
      .filter(name => !existing.has(name.toLowerCase()))
      .map(name => ({ name, type: 'npcMove', system: { moveType: 'basic' } }));
    if (moves.length) await actor.createEmbeddedDocuments('Item', moves);
  }
}
