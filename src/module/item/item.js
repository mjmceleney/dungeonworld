import { DwUtility } from "../utility.js";
import { DwRolls } from "../rolls.js";
import { DwPartyMoves } from "../party-moves.js";
import { DwRecover } from "../recover.js";
import { DwSpells } from "../spells.js";
import { DwRecruit } from "../recruit.js";

export class ItemDw extends Item {
  /**
   * Augment the basic Item data model with additional dynamic data.
   */
  prepareData() {
    super.prepareData();

    // Get the Item's data
    const itemData = this;
    const actorData = this.actor ? this.actor : {};
    const data = itemData.system;

    // Clean up broken groups.
    if (itemData.type == 'class') {
      if (itemData.system.equipment) {
        for (let [group_key, group] of Object.entries(itemData.system.equipment)) {
          if (group) {
            if (DwUtility.isEmpty(group['items'])) {
              group['items'] = [];
              group['objects'] = [];
            }
          }
        }
      }
    }
  }

  async _getEquipmentObjects(force_reload = false) {
    let obj = null;
    let itemData = this;

    let items = await DwUtility.getEquipment(force_reload);
    let equipment = [];

    if (itemData.system.equipment) {
      for (let [group, group_items] of Object.entries(itemData.system.equipment)) {
        if (group_items) {
          equipment[group] = items.filter(i => group_items['items'].includes(i.id));
        }
      }
    }

    return equipment;
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
    // Recover, and preparing spells, are done in a dialog.
    if (this.actor?.type == 'character') {
      if (DwRecover.isRecover(this)) return DwRecover.prompt(this.actor, this);
      if (DwSpells.isPrepareMove(this)) return DwSpells.prepare(this.actor, this);
      if (DwRecruit.isRecruit(this)) return DwRecruit.prompt(this.actor, this);
    }
    // Casting a spell rolls Cast a Spell for it (the spell's Cast button);
    // rolling the spell itself rolls its own dice, such as damage.
    if (cast && this.type == 'spell' && this.actor) {
      return DwSpells.cast(this.actor, this);
    }
    return DwRolls.rollMove({actor: this.actor, data: this});
  }
}