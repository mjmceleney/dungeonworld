import { DwUtility } from "./utility.js";
import { DwMoveActions } from "./move-actions.js";

const { DialogV2 } = foundry.applications.api;

/**
 * Gear that gets used up: ammo, rations, potions, bandages, poison and the
 * like. Items count their uses, or their quantity when they have no uses;
 * a stack of multi-use items (two packs of rations) refills its uses from
 * the next one in the stack. Gear that runs out is removed.
 *
 * Moves can spend a resource from their chat card (Volley's ammo on a 7-9),
 * and items with uses have a Use button, which can also heal.
 */
export class DwResources {

  /** The uses a fresh item of this kind has, remembered on first use. */
  static #fullUses(item) {
    return Number(item.flags?.dungeonworld?.fullUses) || Number(item.system.uses) || 1;
  }

  /** Whether an item counts uses (rather than just its quantity). */
  static #hasUses(item) {
    return Number(item.system.uses) > 0 || Number(item.flags?.dungeonworld?.fullUses) > 0;
  }

  /** How many uses an item has left, across its whole stack. */
  static remaining(item) {
    const uses = Number(item.system.uses) || 0;
    const quantity = Math.max(0, Number(item.system.quantity) || 0);
    // An item with no uses is counted by quantity; one whose uses ran out
    // has none left.
    if (!DwResources.#hasUses(item)) return quantity;
    if (uses <= 0) return 0;
    return uses + Math.max(0, quantity - 1) * DwResources.#fullUses(item);
  }

  /**
   * The character's gear matching a resource name, as a whole word in its
   * name or a tag ("ammo" matches a Bundle of Arrows tagged "3 ammo";
   * "ration" matches Dungeon Rations but not an Inspiration Draught), with
   * something left. Equipped gear comes first.
   *
   * @param {Actor} actor
   * @param {string} name
   * @return {Item[]}
   */
  static find(actor, name) {
    if (!DwUtility.nameKey(name)) return [];
    return actor.items.filter(item => {
      if (item.type != 'equipment' || DwResources.remaining(item) <= 0) return false;
      if (DwUtility.hasWord(item.name, name)) return true;
      return DwUtility.parseTags(item.system.tags).some(tag => DwUtility.hasWord(tag, name));
    }).sort((a, b) => Number(!!b.system.equipped) - Number(!!a.system.equipped));
  }

  /** How much of a resource the character has left, across all their gear. */
  static count(actor, name) {
    return DwResources.find(actor, name).reduce((sum, item) => sum + DwResources.remaining(item), 0);
  }

  /**
   * Use up some of an item: its uses first, then the next in its stack.
   * Once nothing is left the item is removed; more can be added later.
   *
   * @param {Item} item
   * @param {number} amount
   * @return {Promise<number>} How much was actually spent.
   */
  static async spend(item, amount = 1) {
    let uses = Number(item.system.uses) || 0;
    let quantity = Math.max(0, Number(item.system.quantity) || 0);
    const hasUses = DwResources.#hasUses(item);
    const full = DwResources.#fullUses(item);
    let spent = 0;
    while (spent < amount) {
      if (!hasUses) {
        if (quantity <= 0) break;
        quantity--;
      }
      else if (uses > 1) uses--;
      else if (uses == 1 && quantity > 1) { quantity--; uses = full; }
      else if (uses == 1) uses = 0;
      else break;
      spent++;
    }
    if (!spent) return 0;
    const empty = hasUses ? uses <= 0 : quantity <= 0;
    if (empty) {
      await item.delete();
      return spent;
    }
    const update = { 'system.uses': uses, 'system.quantity': quantity };
    if (hasUses) update['flags.dungeonworld.fullUses'] = full;
    await item.update(update);
    return spent;
  }

  /**
   * Spend a resource from a move: from the first matching item, then the
   * next, until the amount is paid.
   *
   * @return {Promise<{spent: number, items: string[]}>}
   */
  static async spendResource(actor, name, amount = 1) {
    let left = amount;
    const names = [];
    for (const item of DwResources.find(actor, name)) {
      if (left <= 0) break;
      const spent = await DwResources.spend(item, left);
      if (spent) names.push(item.name);
      left -= spent;
    }
    return { spent: amount - left, items: names };
  }

  /* -------------------------------------------- */
  /*  Using an item                               */
  /* -------------------------------------------- */

  /**
   * Use an item: spend one use and, if it heals, heal whoever it's for (or
   * remove a debility instead, when the item allows it). Posts to chat.
   *
   * @param {Actor} actor The user of the item.
   * @param {Item} item
   */
  static async use(actor, item) {
    if (DwResources.remaining(item) <= 0) {
      return ui.notifications.warn(game.i18n.format('DW.Use.Empty', { item: item.name }));
    }
    const heal = Math.max(0, Number(item.system.useHeal) || 0);
    let effect = '';
    // Skipping who it's for (bandaging an NPC, say) still uses it up, but
    // heals no one: the table handles what it does.
    const target = heal && item.system.useTarget == 'other'
      ? await DwResources.chooseTarget(actor, item.name, game.i18n.format('DW.Use.Who', { item: item.name }), { skip: true }) : actor;
    if (target === null) return;
    if (heal && target) {
      const choice = item.system.useCure ? await DwResources.#healOrCure(target, heal, item) : { heal };
      if (!choice) return;
      if (choice.debility) {
        await DwMoveActions.change(target, { removeDebilities: [choice.debility] });
        effect = game.i18n.format('DW.Use.Cured', { target: target.name, debility: target.system.abilities[choice.debility]?.debilityLabel || choice.debility });
      }
      else {
        await DwMoveActions.change(target, { heal: choice.heal });
        effect = game.i18n.format('DW.Use.Healed', { target: target.name, heal: choice.heal });
      }
    }

    // Counted first: an item used up is removed.
    const left = Math.max(0, DwResources.remaining(item) - 1);
    await DwResources.spend(item, 1);
    await DwUtility.postCard(actor, {
      image: item.img,
      title: game.i18n.format('DW.Use.Title', { item: item.name }),
      details: item.system.description,
      resultLabel: effect || null,
      result: effect ? 'success' : null,
      flavor: game.i18n.format('DW.Use.Left', { count: left }),
    });
  }

  /**
   * Who an item (or a move) is used on: the targeted token, else a choice of
   * the tokens on the scene. For allies (a heal), only characters and
   * hirelings; otherwise anyone there (damage, a condition). With no one
   * suitable on the scene, a choice of the world's characters and hirelings.
   *
   * @param {Actor} actor The user.
   * @param {string} title The dialog's title.
   * @param {string} prompt The question asked.
   * @param {{allies?: boolean, skip?: boolean}} [options] skip: offer to
   *   go on without choosing anyone.
   * @return {Promise<Actor|null|false>} The target; null if cancelled; false
   *   if skipped.
   */
  static async chooseTarget(actor, title, prompt, { allies = true, skip = false } = {}) {
    const isAlly = (a) => ['character', 'hireling'].includes(a?.type);
    const fits = (a) => !!a && (!allies || isAlly(a));
    const targeted = [...game.user.targets].map(t => t.actor).filter(fits);
    if (targeted.length == 1) return targeted[0];

    // Tokens the user can see, each with its own actor (three goblins are
    // three targets), named as on the scene.
    let choices = (canvas.scene?.tokens ?? []).filter(t => (!t.hidden || game.user.isGM) && fits(t.actor))
      .map(t => ({ uuid: t.actor.uuid, name: t.name || t.actor.name }));
    if (!choices.length) choices = game.actors.filter(isAlly).map(a => ({ uuid: a.uuid, name: a.name }));
    choices = [...new Map(choices.map(c => [c.uuid, c])).values()]
      .sort((a, b) => (a.uuid == actor.uuid) - (b.uuid == actor.uuid) || a.name.localeCompare(b.name));
    // Tell apart tokens with the same name: Goblin, Goblin (2)...
    const seen = new Map();
    for (const choice of choices) {
      const count = (seen.get(choice.name) ?? 0) + 1;
      seen.set(choice.name, count);
      if (count > 1) choice.name = `${choice.name} (${count})`;
    }

    const content = document.createElement('div');
    content.innerHTML = `<p>${DwUtility.escape(prompt)}</p>
      <div class="form-group"><select name="target">${choices.map(c => `<option value="${DwUtility.escape(c.uuid)}">${DwUtility.escape(c.name)}</option>`).join('')}</select></div>`;
    const uuid = await DwUtility.ask({
      window: { title },
      position: { width: 360 },
      content,
      ok: {
        label: allies ? 'DW.Use.Treat' : 'DW.MoveActions.TargetButton',
        icon: allies ? 'fa-solid fa-hand-holding-medical' : 'fa-solid fa-crosshairs',
        callback: (event, button) => button.form.elements.target.value,
      },
      buttons: skip ? [{ action: 'skip', label: 'DW.MoveActions.Skip', icon: 'fa-solid fa-forward', callback: () => 'skip' }] : [],
    });
    if (uuid == 'skip') return false;
    return uuid ? fromUuidSync(uuid) : null;
  }

  /** Heal, or remove one of the target's debilities instead. */
  static async #healOrCure(target, heal, item) {
    const debilities = Object.entries(target.system.abilities ?? {}).filter(([, a]) => a.debility);
    if (!debilities.length) return { heal };
    const choice = await DialogV2.wait({
      window: { title: item.name },
      position: { width: 380 },
      content: `<p>${DwUtility.escape(game.i18n.localize('DW.Use.HealOrCure'))}</p>`,
      buttons: [
        { action: 'heal', label: game.i18n.format('DW.Use.HealButton', { heal }), icon: 'fa-solid fa-heart', default: true },
        ...debilities.map(([key, a]) => ({ action: key, label: game.i18n.format('DW.Use.CureButton', { debility: a.debilityLabel || key }), icon: 'fa-solid fa-hand-sparkles' })),
      ],
      rejectClose: false,
    });
    if (!choice) return null;
    return choice == 'heal' ? { heal } : { debility: choice };
  }
}
