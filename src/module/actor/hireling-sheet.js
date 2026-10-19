import { DwCharacterSheet } from "./character-sheet.js";
import { DwRolls } from "../rolls.js";
import { DwUtility } from "../utility.js";

const HIRELING_TEMPLATES = "systems/dungeonworld/templates/sheet/hireling";
const CHARACTER_TEMPLATES = "systems/dungeonworld/templates/sheet/character";

/** The hireling skills, in the rules' order. */
export const HIRELING_SKILLS = ['adept', 'burglar', 'minstrel', 'priest', 'protector', 'tracker', 'warrior'];

/**
 * The points a hireling starts with, by where they were found. They're
 * shared between loyalty and skills.
 */
const POINTS = {
  village: [2, 5],
  town: [4, 6],
  keep: [5, 8],
  city: [6, 10],
};

/** The rules' example costs. */
const COSTS = ['thrill', 'money', 'knowledge', 'fame', 'debauchery', 'good'];

/**
 * A hireling: skills with ranks, a cost and loyalty, per the rules. Their
 * HP, armor and damage matter less, but are there for when they're needed.
 * @extends {DwCharacterSheet}
 */
export class DwHirelingSheet extends DwCharacterSheet {

  /** @inheritdoc */
  constructor(options = {}) {
    super(options);
    this.tabGroups.primary = this.constructor.TAB_IDS.includes(this.tabGroups.primary) ? this.tabGroups.primary : 'skills';
  }

  /** @override */
  static DEFAULT_OPTIONS = {
    classes: ["dw-npc", "dw-hireling"],
    position: {
      width: 640,
      height: 760,
    },
    actions: {
      orderHireling: DwHirelingSheet.#onOrder,
      adjustSkill: DwHirelingSheet.#onAdjustSkill,
      useSkill: DwHirelingSheet.#onUseSkill,
    },
  };

  /** @override */
  static PARTS = {
    header: { template: `${HIRELING_TEMPLATES}/header.html` },
    stats: { template: `${HIRELING_TEMPLATES}/stats.html` },
    tabs: { template: `${CHARACTER_TEMPLATES}/tabs.html` },
    skills: { template: `${HIRELING_TEMPLATES}/tab-skills.html`, scrollable: [''] },
    description: { template: `${HIRELING_TEMPLATES}/tab-description.html`, scrollable: [''] },
  };

  /** @override */
  static TAB_IDS = ['skills', 'description'];

  /* -------------------------------------------- */

  /** @override */
  async _prepareContext(options) {
    const context = await this._prepareDocumentContext(options);
    const actor = this.actor;
    const system = actor.system;

    const biography = await this._enrich(system.details?.biography);

    const loyalty = Number(system.attributes.loyalty?.value) || 0;

    const skills = HIRELING_SKILLS.map(key => {
      const rank = Number(system.skills?.[key]) || 0;
      return {
        key,
        rank,
        has: rank > 0,
        label: game.i18n.localize(`DW.Hireling.Skill.${key}`),
        blurb: game.i18n.localize(`DW.Hireling.Skill.${key}Blurb`),
        moves: DwHirelingSheet.skillMoves(key, rank),
      };
    });
    // Skills they have first, highest rank first; the rest in the rules' order.
    skills.sort((a, b) => (b.has - a.has) || (b.has ? b.rank - a.rank : 0));

    const found = system.details?.found ?? '';
    const spent = loyalty + skills.reduce((sum, s) => sum + s.rank, 0);
    const range = POINTS[found];
    const employer = game.actors.get(system.details?.employer);

    return Object.assign(context, {
      loyalty,
      loyaltyText: DwUtility.signed(loyalty),
      forward: Number(system.attributes.loyalty?.forward) || 0,
      unpaid: !!system.details?.unpaid,
      orderModifier: DwUtility.signed(DwHirelingSheet.orderModifier(actor)),

      employers: Object.fromEntries(game.actors.filter(a => a.type == 'character').map(a => [a.id, a.name])),
      employerName: employer?.name ?? '',
      costs: COSTS.map(key => game.i18n.localize(`DW.Hireling.Cost.${key}`)),
      foundOptions: Object.fromEntries(Object.keys(POINTS).map(key => [key, `DW.Hireling.Found.${key}`])),
      points: {
        spent,
        range: range ? `${range[0]}–${range[1]}` : '',
        warn: range ? spent < range[0] || spent > range[1] : false,
      },
      highestRank: Math.max(0, ...skills.map(s => s.rank)),
      skills,
      biography,
    });
  }

  /** @override */
  _prepareSheetTabs() {
    const tabs = super._prepareSheetTabs();
    tabs.skills.label = 'DW.Hireling.Skills';
    return tabs;
  }

  /**
   * A skill's moves, with its rank worked into the text.
   *
   * @param {string} key
   * @param {number} rank
   * @return {{name: string, text: string}[]}
   */
  static skillMoves(key, rank) {
    const moves = [];
    for (let i = 1; i <= 2; i++) {
      const nameKey = `DW.Hireling.Skill.${key}Move${i}`;
      if (!game.i18n.has(nameKey)) continue;
      moves.push({
        index: i,
        name: game.i18n.localize(nameKey),
        text: game.i18n.format(`DW.Hireling.Skill.${key}Move${i}Text`, { skill: rank, double: rank * 2 }),
      });
    }
    return moves;
  }

  /**
   * What's added to an Order Hirelings roll: loyalty, plus any forward, and
   * −1 while their cost goes unpaid.
   *
   * @param {Actor} actor
   * @return {number}
   */
  static orderModifier(actor) {
    const loyalty = actor.system.attributes.loyalty ?? {};
    return (Number(loyalty.value) || 0) + (Number(loyalty.forward) || 0) - (actor.system.details?.unpaid ? 1 : 0);
  }

  /* -------------------------------------------- */

  /**
   * Order Hirelings: roll+loyalty. Loyalty forward is used up.
   * @this {DwHirelingSheet}
   */
  static async #onOrder(event, target) {
    event.preventDefault();
    const actor = this.actor;
    const modifier = DwHirelingSheet.orderModifier(actor);
    await DwRolls.rollMove({
      actor,
      data: null,
      formula: DwRolls.addTerm('2d6', modifier),
      templateData: {
        title: game.i18n.localize('DW.Hireling.Order'),
        details: `<p>${game.i18n.localize('DW.Hireling.OrderText')}</p>`,
        rollType: 'move',
        moveResults: {
          success: { value: `<p>${game.i18n.localize('DW.Hireling.OrderSuccess')}</p>` },
          partial: { value: `<p>${game.i18n.localize('DW.Hireling.OrderPartial')}</p>` },
          failure: { value: '' },
        },
      },
    });
    if (Number(actor.system.attributes.loyalty?.forward)) {
      await actor.update({ 'system.attributes.loyalty.forward': 0 });
    }
  }

  /**
   * Raise or lower a skill's rank.
   * @this {DwHirelingSheet}
   */
  static async #onAdjustSkill(event, target) {
    event.preventDefault();
    const key = target.dataset.skill;
    if (!HIRELING_SKILLS.includes(key)) return;
    const delta = Number(target.dataset.delta) || 1;
    const rank = Math.min(10, Math.max(0, (Number(this.actor.system.skills?.[key]) || 0) + delta));
    await this.actor.update({ [`system.skills.${key}`]: rank });
  }

  /**
   * Post a skill's move to chat, with the hireling's rank in its text.
   * @this {DwHirelingSheet}
   */
  static async #onUseSkill(event, target) {
    event.preventDefault();
    const key = target.dataset.skill;
    const index = Number(target.dataset.move);
    const rank = Number(this.actor.system.skills?.[key]) || 0;
    const move = DwHirelingSheet.skillMoves(key, rank).find(m => m.index === index);
    if (!move) return;
    await DwUtility.postCard(this.actor, {
      image: this.actor.img,
      title: `${move.name} (${game.i18n.localize(`DW.Hireling.Skill.${key}`)} ${rank})`,
      details: `<p>${move.text}</p>`,
    });
  }

  /* -------------------------------------------- */

  /**
   * Create a hireling working for a character, and open their sheet. Used by
   * the Recruit move's chat card.
   *
   * @param {Actor|null} employer
   * @param {{found?: string}} [options] Where they were found (village, town,
   *   keep or city), which sets their points budget.
   * @return {Promise<Actor|null>}
   */
  static async createFor(employer, { found = '' } = {}) {
    if (!Actor.implementation.canUserCreate(game.user)) {
      ui.notifications.warn(game.i18n.localize('DW.Hireling.CannotCreate'));
      return null;
    }
    const actor = await Actor.implementation.create({
      name: game.i18n.localize('DW.Hireling.New'),
      type: 'hireling',
      system: { details: { employer: employer?.id ?? '', found: Object.keys(POINTS).includes(found) ? found : '' } },
    });
    actor?.sheet.render(true);
    return actor;
  }
}
