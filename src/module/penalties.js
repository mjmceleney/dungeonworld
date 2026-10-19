import { DwMoves } from "./moves.js";

/**
 * Penalties a character carries until something happens, each kept in a flag
 * on the actor:
 *
 * - cast: -1 ongoing to cast spells per Cast a Spell 7-9 that chose it, until
 *   they next prepare spells.
 * - recruit: -1 forward to Recruit per applicant turned away, until they
 *   next Recruit.
 */
export class DwPenalties {

  /**
   * Each penalty: its flag, the move it applies to (an automation), and the
   * text the sheet shows for it.
   */
  static TYPES = {
    cast: {
      flag: 'castPenalty',
      move: 'castSpell',
      label: 'DW.Effects.Cast',
      scope: 'DW.Effects.UntilPrepare',
      hint: 'DW.Effects.CastHint',
      badge: 'DW.Effects.OngoingBadge',
    },
    recruit: {
      flag: 'recruitPenalty',
      move: 'recruit',
      label: 'DW.Effects.Recruit',
      scope: 'DW.Effects.NextRoll',
      hint: 'DW.Effects.RecruitHint',
      badge: 'DW.Effects.ForwardBadge',
    },
  };

  /** The penalty's size: 0 for none. */
  static get(actor, type) {
    const flag = DwPenalties.TYPES[type]?.flag;
    return flag ? Math.max(0, Number(actor?.flags?.dungeonworld?.[flag]) || 0) : 0;
  }

  /** Take another -1. Returns the new penalty. */
  static async add(actor, type) {
    const penalty = DwPenalties.get(actor, type) + 1;
    await actor.setFlag('dungeonworld', DwPenalties.TYPES[type].flag, penalty);
    return penalty;
  }

  /** End the penalty. */
  static async clear(actor, type) {
    if (DwPenalties.get(actor, type)) await actor.unsetFlag('dungeonworld', DwPenalties.TYPES[type].flag);
  }

  /**
   * The character sheet's list of penalties in place, named for the
   * character's own move.
   *
   * @return {{label: string, value: string, scope: string, tooltip: string, clear: string, penalty: string}[]}
   */
  static effects(actor) {
    return Object.entries(DwPenalties.TYPES).flatMap(([type, config]) => {
      const penalty = DwPenalties.get(actor, type);
      if (!penalty) return [];
      return [{
        label: DwMoves.owned(actor, config.move)?.name ?? game.i18n.localize(config.label),
        value: `−${penalty}`,
        scope: game.i18n.localize(config.scope),
        tooltip: game.i18n.format(config.hint, { penalty }),
        clear: 'clearPenalty',
        penalty: type,
      }];
    });
  }

  /** The badge for a move a penalty applies to, or null. */
  static moveBadge(actor, item) {
    for (const [type, config] of Object.entries(DwPenalties.TYPES)) {
      if (!DwMoves.is(item, config.move)) continue;
      const penalty = DwPenalties.get(actor, type);
      if (penalty) return { text: game.i18n.format(config.badge, { penalty }), tooltip: game.i18n.format(config.hint, { penalty }) };
    }
    return null;
  }
}
