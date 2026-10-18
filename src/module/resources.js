import { DwUtility } from "./utility.js";

const { DialogV2 } = foundry.applications.api;
const { renderTemplate } = foundry.applications.handlebars;

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
   * The character's gear matching a resource name, by name or tag ("ammo"
   * matches a Bundle of Arrows tagged "3 ammo"), with something left.
   * Equipped gear comes first.
   *
   * @param {Actor} actor
   * @param {string} name
   * @return {Item[]}
   */
  static find(actor, name) {
    const wanted = String(name ?? '').trim().toLowerCase();
    if (!wanted) return [];
    return actor.items.filter(item => {
      if (item.type != 'equipment' || DwResources.remaining(item) <= 0) return false;
      if (item.name.toLowerCase().includes(wanted)) return true;
      try {
        const tags = item.system.tags ? JSON.parse(item.system.tags) : [];
        return Array.isArray(tags) && tags.some(t => String(t?.value ?? t).toLowerCase().includes(wanted));
      } catch (e) {
        return false;
      }
    }).sort((a, b) => Number(!!b.system.equipped) - Number(!!a.system.equipped));
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
    if (heal) {
      const target = item.system.useTarget == 'other' ? await DwResources.#chooseTarget(actor, item) : actor;
      if (!target) return;
      const choice = item.system.useCure ? await DwResources.#healOrCure(target, heal, item) : { heal };
      if (!choice) return;
      if (choice.debility) {
        await DwResources.#apply(target, { debility: choice.debility });
        effect = game.i18n.format('DW.Use.Cured', { target: target.name, debility: target.system.abilities[choice.debility]?.debilityLabel || choice.debility });
      }
      else {
        await DwResources.#apply(target, { heal: choice.heal });
        effect = game.i18n.format('DW.Use.Healed', { target: target.name, heal: choice.heal });
      }
    }

    // Counted first: an item used up is removed.
    const left = Math.max(0, DwResources.remaining(item) - 1);
    await DwResources.spend(item, 1);
    const chatData = {
      speaker: ChatMessage.getSpeaker({ actor }),
      content: await renderTemplate('systems/dungeonworld/templates/chat/chat-move.html', {
        actor,
        image: item.img,
        title: game.i18n.format('DW.Use.Title', { item: item.name }),
        details: item.system.description,
        resultLabel: effect || null,
        result: effect ? 'success' : null,
        flavor: game.i18n.format('DW.Use.Left', { count: left }),
      }),
    };
    DwUtility.applyMessageMode(chatData);
    await ChatMessage.create(chatData);
  }

  /**
   * Who an item that treats someone else is used on: the targeted token,
   * else a choice of the characters and hirelings.
   */
  static async #chooseTarget(actor, item) {
    const targeted = [...game.user.targets].map(t => t.actor).filter(Boolean);
    if (targeted.length == 1) return targeted[0];
    const escape = (value) => Handlebars.escapeExpression(String(value ?? ''));
    const people = game.actors.filter(a => ['character', 'hireling'].includes(a.type))
      .sort((a, b) => (a.id == actor.id) - (b.id == actor.id) || a.name.localeCompare(b.name));
    const content = document.createElement('div');
    content.innerHTML = `<p>${escape(game.i18n.format('DW.Use.Who', { item: item.name }))}</p>
      <div class="form-group"><select name="target">${people.map(a => `<option value="${a.id}">${escape(a.name)}</option>`).join('')}</select></div>`;
    const id = await DialogV2.wait({
      window: { title: item.name },
      position: { width: 360 },
      content,
      buttons: [
        { action: 'ok', label: 'DW.Use.Treat', icon: 'fa-solid fa-hand-holding-medical', default: true,
          callback: (event, button) => button.form.elements.target.value },
        { action: 'cancel', label: 'DW.Cancel', icon: 'fa-solid fa-xmark', callback: () => null },
      ],
      rejectClose: false,
    });
    return id ? game.actors.get(id) : null;
  }

  /** Heal, or remove one of the target's debilities instead. */
  static async #healOrCure(target, heal, item) {
    const debilities = Object.entries(target.system.abilities ?? {}).filter(([, a]) => a.debility);
    if (!debilities.length) return { heal };
    const escape = (value) => Handlebars.escapeExpression(String(value ?? ''));
    const choice = await DialogV2.wait({
      window: { title: item.name },
      position: { width: 380 },
      content: `<p>${escape(game.i18n.localize('DW.Use.HealOrCure'))}</p>`,
      buttons: [
        { action: 'heal', label: game.i18n.format('DW.Use.HealButton', { heal }), icon: 'fa-solid fa-heart', default: true },
        ...debilities.map(([key, a]) => ({ action: key, label: game.i18n.format('DW.Use.CureButton', { debility: a.debilityLabel || key }), icon: 'fa-solid fa-hand-sparkles' })),
      ],
      rejectClose: false,
    });
    if (!choice) return null;
    return choice == 'heal' ? { heal } : { debility: choice };
  }

  /** Heal someone or clear a debility, through the GM if it isn't ours. */
  static async #apply(target, change) {
    if (target.isOwner) return DwResources.applyChange(target, change);
    if (!game.users.activeGM) return ui.notifications.warn(game.i18n.localize('DW.Party.NeedsGM'));
    game.socket.emit('system.dungeonworld', { resourceChange: { actor: target.uuid, ...change } });
  }

  /** Apply a heal or cure: on this client, or the GM's for another's actor. */
  static async applyChange(target, { heal = 0, debility = null } = {}) {
    if (heal) {
      const hp = target.system.attributes.hp;
      const amount = Math.min(heal, Math.max(0, Number(hp.max) - Number(hp.value)));
      if (amount > 0) await target.applyDamage(amount, { op: 'heal' });
    }
    if (debility && target.system.abilities?.[debility]) {
      await target.update({ [`system.abilities.${debility}.debility`]: false });
    }
  }

  /** A player's heal or cure for someone else's character, on the active GM. */
  static async applyRemote(data) {
    if (!game.users.activeGM?.isSelf) return;
    const target = await fromUuid(data?.actor);
    if (target) await DwResources.applyChange(target, { heal: Number(data.heal) || 0, debility: data.debility ?? null });
  }
}
