import { DwUtility } from "../utility.js";
import { DwRolls } from "../rolls.js";
import { DwPartyMoves } from "../party-moves.js";
import { DwSpells } from "../spells.js";
import { DwRecruit } from "../recruit.js";

export class ItemDw extends Item {
  /**
   * Augment the basic Item data model with additional dynamic data.
   */
  prepareData() {
    super.prepareData();

    // Clean up broken class gear groups.
    if (this.type == 'class') {
      for (const group of Object.values(this.system.equipment ?? {})) {
        if (group && DwUtility.isEmpty(group.items)) {
          group.items = [];
          group.objects = [];
        }
      }
    }
  }

  /** @override */
  async _preUpdate(changes, options, user) {
    const allowed = await super._preUpdate(changes, options, user);
    if (allowed === false) return false;

    // Bond names are edited with ProseMirror, which wraps everything in a
    // paragraph. Strip a single wrapping <p> so the name stays inline.
    if (this.type == 'bond' && typeof changes.name == 'string') {
      const match = changes.name.trim().match(/^<p>([\s\S]*)<\/p>$/);
      if (match && match[1].trim() && !match[1].includes('<p>')) changes.name = match[1].trim();
    }
  }

  /** @override */
  getRollData() {
    return this.actor ? {
      ...super.getRollData(),
      ...this.actor.getRollData()
    } : super.getRollData();
  }

  /**
   * Roll the item to Chat, creating a chat card which contains follow up attack or damage roll options
   * @return {Promise}
   */
   async roll({ configureDialog = true, cast = false } = {}) {
    // Party moves (a perilous journey, making camp) are played out on a
    // shared chat card that the character joins.
    const party = DwPartyMoves.typeFor(this);
    if (party && this.actor && ['character', 'hireling'].includes(this.actor.type)) {
      return DwPartyMoves.start(party, this.actor);
    }
    // Preparing spells and Recruit are done in a dialog.
    if (this.actor?.type == 'character') {
      if (DwSpells.isPrepareMove(this)) return DwSpells.prepare(this.actor, this);
      if (DwRecruit.isRecruit(this)) return DwRecruit.prompt(this.actor, this);
    }
    // Casting a spell rolls Cast a Spell for it (the spell's Cast button);
    // rolling the spell itself rolls its own dice, such as damage.
    if (cast && this.type == 'spell' && this.actor) {
      return DwSpells.cast(this.actor, this);
    }
    // Rolling Cast a Spell itself asks which spell, so the card shows it and
    // a 7-9 can lose it. With none to choose from, it's rolled as it is.
    if (DwSpells.isCastMove(this) && this.actor?.type == 'character') {
      const spell = await DwSpells.chooseSpell(this.actor, this);
      if (spell === null) return;
      if (spell) return DwSpells.cast(this.actor, spell, this);
    }
    return DwRolls.rollMove({actor: this.actor, data: this});
  }
}