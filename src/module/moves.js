import { DwUtility } from "./utility.js";

/**
 * Moves the system automates, such as Recover's dialog or Cast a Spell's
 * 7-9 choices. A move is automated by its Automation setting
 * (system.automation), never by its name, so a renamed, translated or
 * homebrew move works the same once it's set.
 */
export class DwMoves {

  /**
   * Each automation: its label on the move sheet, and the compendium moves
   * that have it (by name, for the migration that sets up existing copies).
   * Built-in ones belong to a single move, so the sheet only lists them on
   * a move that already has one.
   */
  static AUTOMATIONS = {
    castSpell: { label: 'DW.Automation.CastSpell', names: ['cast a spell'] },
    prepareSpells: { label: 'DW.Automation.PrepareSpells', names: ['prepare spells', 'commune'] },
    recruit: { label: 'DW.Automation.Recruit', names: ['recruit'], builtIn: true },
    lastBreath: { label: 'DW.Automation.LastBreath', names: ['last breath'], builtIn: true },
    journey: { label: 'DW.Automation.Journey', names: ['undertake a perilous journey'], builtIn: true },
    makeCamp: { label: 'DW.Automation.MakeCamp', names: ['make camp'], builtIn: true },
    takeWatch: { label: 'DW.Automation.TakeWatch', names: ['take watch'], builtIn: true },
  };

  /** The move sheet's choices for a move with this automation: {key: label}. */
  static choices(current = '') {
    return Object.fromEntries(Object.entries(DwMoves.AUTOMATIONS)
      .filter(([key, { builtIn }]) => !builtIn || key == current)
      .map(([key, { label }]) => [key, label]));
  }

  /**
   * Whether a move has an automation.
   *
   * @param {Item|object|null} item  An item, or a compendium index entry.
   * @param {string} key  One of AUTOMATIONS.
   */
  static is(item, key) {
    return item?.type == 'move' && item.system?.automation == key;
  }

  /** The automation a compendium move of this name has, if any. */
  static forName(name) {
    const key = DwUtility.nameKey(name);
    return Object.entries(DwMoves.AUTOMATIONS).find(([, { names }]) => names.includes(key))?.[0] ?? null;
  }

  /** The character's own move with an automation. */
  static owned(actor, key) {
    return actor?.items.find(i => DwMoves.is(i, key)) ?? null;
  }

  /**
   * A move with an automation to roll: the character's own, else the
   * world's, else the compendium's.
   *
   * @param {Actor|null} actor
   * @param {string} key
   * @return {Promise<Item|null>}
   */
  static find(actor, key) {
    return DwUtility.findMove(actor, entry => DwMoves.is(entry, key), { fields: ['system.automation'] });
  }
}
