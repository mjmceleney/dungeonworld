import { DwUtility } from "./utility.js";
import { DwResources } from "./resources.js";
import { DwSpells } from "./spells.js";
import { DwSocket } from "./socket.js";
import { STATS } from "./config.js";

/**
 * A move's or spell's effects (system.actions): lines such as "heal someone
 * else 1d8 on a 10+" or "spend 1 ammo on a 7-9". Each line offered for the
 * result is a button on the move's chat card, which applies it. A spell's
 * effects are on the Cast a Spell card when it's cast, for the cast's result.
 *
 * Effects for an ally or anyone (heal, damage, forward...) ask who before
 * the roll, so the card knows who they're for; skipping that leaves them off
 * the card. The rest (hold, XP, a spell, a resource) are always the
 * character's own.
 */
export class DwMoveActions {

  /**
   * Each kind of line, and which of its settings apply: target (the
   * character, an ally or anyone; see TARGETS), stat (a debility, or the
   * player picks), condition (a status such as Diseased, or the player
   * picks), name (gear's name or tag) and amount ("formula": dice, blank for all;
   * "dice": dice; "count": how many, 0 for any; "number"). With transfer,
   * what's done to an ally or anyone can pass to the character (Lay on Hands'
   * 7-9: the damage healed, or the disease removed).
   */
  static TYPES = {
    heal: { label: 'DW.MoveActions.Heal', target: true, amount: 'formula', transfer: true },
    damage: { label: 'DW.MoveActions.Damage', target: true, amount: 'dice' },
    removeDebility: { label: 'DW.MoveActions.RemoveDebility', target: true, stat: true, amount: 'count', transfer: true },
    takeDebility: { label: 'DW.MoveActions.TakeDebility', stat: true },
    removeCondition: { label: 'DW.MoveActions.RemoveCondition', target: true, condition: true, transfer: true },
    addCondition: { label: 'DW.MoveActions.AddCondition', target: true, condition: true },
    forward: { label: 'DW.MoveActions.Forward', target: true, amount: 'number' },
    ongoing: { label: 'DW.MoveActions.Ongoing', target: true, amount: 'number' },
    hold: { label: 'DW.MoveActions.Hold', amount: 'number' },
    xp: { label: 'DW.MoveActions.Xp', amount: 'number' },
    spend: { label: 'DW.MoveActions.Spend', name: true, amount: 'number' },
    loseSpell: { label: 'DW.MoveActions.LoseSpell' },
  };

  /**
   * Who a line is for: the character making the move, an ally (a character
   * or hireling), or anyone on the scene. Allies and anyone are chosen
   * before the roll.
   */
  static TARGETS = {
    self: 'DW.MoveActions.TargetSelf',
    ally: 'DW.MoveActions.TargetAlly',
    any: 'DW.MoveActions.TargetAny',
  };

  /**
   * A move's lines. Lines from before allies and anyone were told apart
   * ("someone else") are read as an ally for help, and anyone for harm.
   */
  static lines(item) {
    const actions = item?.system?.actions;
    return (Array.isArray(actions) ? actions : Object.values(actions ?? {}))
      .filter(line => DwMoveActions.TYPES[line?.type])
      .map(line => line.target != 'other' ? line
        : { ...line, target: ['damage', 'addCondition'].includes(line.type) ? 'any' : 'ally' });
  }

  /** Whether a line is for someone chosen before the roll (not the character). */
  static #chosen(line) {
    return !!DwMoveActions.TYPES[line.type].target && (line.target == 'ally' || line.target == 'any');
  }

  /**
   * The conditions effects can give or remove: the token status effects
   * (Diseased, Poisoned, Cursed...).
   *
   * @return {{id: string, name: string}[]}
   */
  static conditions() {
    return Array.from(CONFIG.statusEffects ?? []).filter(status => status?.id)
      .map(status => ({ id: status.id, name: game.i18n.localize(status.name ?? status.label ?? status.id) }));
  }

  /** A condition's name, or '' if there's no such condition. */
  static #conditionName(id) {
    return DwMoveActions.conditions().find(status => status.id == id)?.name ?? '';
  }

  /**
   * Whether a line is offered for a result: "always", on a hit, a 7-9 or a
   * 10+. A move without a roll (null) only has its "always" lines.
   */
  static #offered(when, result) {
    return {
      '': true,
      always: true,
      hit: result == 'success' || result == 'partial',
      partial: result == 'partial',
      success: result == 'success',
    }[when ?? ''] ?? false;
  }

  /**
   * Who effects on an ally or anyone are for, asked before the roll: the
   * targeted token, else a choice of the scene's tokens (only characters and
   * hirelings when every such effect is for an ally). The player can skip
   * choosing and roll anyway; the card then leaves those effects out.
   *
   * @param {Actor} actor
   * @param {Item[]} items The move, and the spell being cast if any.
   * @return {Promise<Actor|null|false|undefined>} The target; null if the
   *   player cancelled; false if they skipped; undefined if no line needs one.
   */
  static async chooseTarget(actor, items) {
    const needs = items.flatMap(item => DwMoveActions.lines(item)).filter(line => DwMoveActions.#chosen(line));
    if (!needs.length) return undefined;
    const name = items.at(-1).name;
    const allies = needs.every(line => line.target == 'ally');
    return DwResources.chooseTarget(actor, name, game.i18n.format('DW.MoveActions.Who', { move: name }), { allies, skip: true });
  }

  /**
   * The character's moves like Hospitaller that add to a heal from a move:
   * those whose heal bonus applies to this target (anyone, or only someone
   * else) and this move (any, or only those named). A bonus move that
   * requires another (Perfect Hospitaller, Hospitaller) replaces it.
   *
   * @param {Actor} actor The healer.
   * @param {Item} move The move (or spell) healing.
   * @param {Actor} target Who's healed.
   * @return {Item[]}
   */
  static healBonuses(actor, move, target) {
    const bonusMoves = actor.items.filter(i => i.type == 'move' && String(i.system.healBonus?.amount ?? '').trim());
    return bonusMoves.filter(bonusMove => {
      const bonus = bonusMove.system.healBonus;
      if (bonus.target == 'other' && target.uuid == actor.uuid) return false;
      const only = String(bonus.moves ?? '').split(',').map(name => DwUtility.nameKey(name)).filter(Boolean);
      if (only.length && !only.includes(DwUtility.nameKey(move.name))) return false;
      return !bonusMoves.some(other => other !== bonusMove
        && DwUtility.nameKey(other.system.requiresMove) == DwUtility.nameKey(bonusMove.name));
    });
  }

  /**
   * How many of a card's effects the player chooses: the move's (or the
   * spell's) setting, when it offers more than that; 0 for all of them.
   *
   * @param {Item[]} items The move, and the spell being cast if any.
   * @param {Object[]} offers From offers().
   */
  static choose(items, offers) {
    const choose = Math.max(0, ...items.map(item => Math.floor(Number(item?.system?.actionsChoose) || 0)));
    return choose && offers.length > choose ? choose : 0;
  }

  /**
   * The buttons a move's card offers for a result.
   *
   * @param {Actor} actor
   * @param {Item[]} items The move, and the spell being cast if any.
   * @param {string|null} result "success", "partial", "failure", or null for
   *   a move without a roll.
   * @param {string} [targetUuid] Who effects for an ally or anyone are for;
   *   blank if the player skipped choosing, which leaves those effects out.
   * @return {{index: string, label: string, type: string, target: string, amount: string, stat: string, condition: string, name: string, transfer: string}[]}
   */
  static offers(actor, items, result, targetUuid = '') {
    if (!actor) return [];
    const other = targetUuid ? fromUuidSync(targetUuid) : null;
    return items.filter(item => ['move', 'spell'].includes(item?.type))
      .flatMap((item, n) => DwMoveActions.#offersFor(actor, item, n, result, other));
  }

  /** One item's buttons; each is numbered with the item's place (n). */
  static #offersFor(actor, item, n, result, other) {
    return DwMoveActions.lines(item).flatMap((line, i) => {
      if (!DwMoveActions.#offered(line.when, result)) return [];
      const config = DwMoveActions.TYPES[line.type];
      // Skipped choosing (or no one to choose): those lines are left out.
      const target = DwMoveActions.#chosen(line) ? other : actor;
      if (!target) return [];
      const data = {
        index: `${n}-${i}`,
        type: line.type,
        target: target.uuid,
        amount: String(line.amount ?? '').trim(),
        stat: config.stat && STATS.includes(line.stat) ? line.stat : '',
        condition: config.condition && DwMoveActions.#conditionName(line.condition) ? line.condition : '',
        name: String(line.name ?? '').trim(),
        transfer: config.transfer && line.transfer && target.uuid != actor.uuid ? '1' : '',
      };
      if (line.type == 'spend' && !data.name) return [];
      // A heal of a set amount gets the healer's bonuses (Hospitaller).
      const bonuses = line.type == 'heal' && data.amount ? DwMoveActions.healBonuses(actor, item, target) : [];
      if (bonuses.length) data.amount = [data.amount, ...bonuses.map(m => String(m.system.healBonus.amount).trim())].join(' + ');
      data.label = DwMoveActions.#label(actor, target, data);
      if (bonuses.length) data.label = `${data.label} (${bonuses.map(m => m.name).join(', ')})`;
      if (data.transfer) data.label = game.i18n.format('DW.MoveActions.TransferLabel', { label: data.label, target: actor.name });
      return [data];
    });
  }

  /** A button's text, such as "Heal Aria 1d8". */
  static #label(actor, target, { type, amount, stat, condition, name }) {
    const t = {
      target: target.name,
      amount,
      debility: stat ? DwMoveActions.#debilityName(target, stat) : '',
      condition: DwMoveActions.#conditionName(condition),
    };
    const n = Number(amount) || 0;
    switch (type) {
      case 'heal': return game.i18n.format(amount ? 'DW.MoveActions.HealLabel' : 'DW.MoveActions.HealFullLabel', t);
      case 'damage': return game.i18n.format('DW.MoveActions.DamageLabel', { ...t, amount: amount || '1' });
      case 'removeDebility':
        if (stat) return game.i18n.format('DW.MoveActions.RemoveDebilityLabel', t);
        return game.i18n.format(n > 0 ? 'DW.MoveActions.RemoveCountLabel' : 'DW.MoveActions.RemoveAnyLabel', { ...t, amount: n });
      case 'takeDebility': return game.i18n.format(stat ? 'DW.MoveActions.TakeDebilityLabel' : 'DW.MoveActions.TakeAnyLabel', t);
      case 'removeCondition': return game.i18n.format(condition ? 'DW.MoveActions.RemoveConditionLabel' : 'DW.MoveActions.RemoveAnyConditionLabel', t);
      case 'addCondition': return game.i18n.format(condition ? 'DW.MoveActions.AddConditionLabel' : 'DW.MoveActions.AddAnyConditionLabel', t);
      case 'forward': return game.i18n.format('DW.MoveActions.ForwardLabel', { ...t, amount: DwUtility.signed(n || 1) });
      case 'ongoing': return game.i18n.format('DW.MoveActions.OngoingLabel', { ...t, amount: DwUtility.signed(n || 1) });
      case 'hold': return game.i18n.format('DW.MoveActions.HoldLabel', { amount: n || 1 });
      case 'xp': return game.i18n.format('DW.MoveActions.XpLabel', { amount: n || 1 });
      case 'spend': return game.i18n.format('DW.Resource.Spend', { amount: Math.max(1, n), name, left: DwResources.count(actor, name) });
      case 'loseSpell': return game.i18n.localize('DW.MoveActions.LoseSpellLabel');
    }
    return '';
  }

  /** A debility's name: the character's own (Weak), else the stat's. */
  static #debilityName(actor, stat) {
    return actor.system.abilities?.[stat]?.debilityLabel || game.i18n.localize(`DW.${stat.toUpperCase()}`);
  }

  /* -------------------------------------------- */
  /*  Applying a line                             */
  /* -------------------------------------------- */

  /**
   * Apply a card's line, for the character who made the move.
   *
   * @param {Actor} actor
   * @param {Object} data A button's dataset (see offers()).
   * @return {Promise<string|null>} What happened, for the card; null if
   *   nothing did (cancelled, or nothing to do).
   */
  static async apply(actor, data) {
    const target = (data.target && await fromUuid(data.target)) || actor;
    const amount = String(data.amount ?? '').trim();
    const n = Number(amount) || 0;
    switch (data.type) {
      case 'heal': {
        const hp = target.system.attributes?.hp;
        if (!hp) return null;
        const missing = Math.max(0, Number(hp.max) - Number(hp.value));
        const rolled = amount ? await DwMoveActions.#roll(amount, actor) : missing;
        if (rolled === null) return null;
        await DwMoveActions.change(target, { heal: rolled });
        const text = game.i18n.format('DW.MoveActions.Healed', { target: target.name, amount: DwMoveActions.#shown(amount, rolled) });
        // The damage healed (no more than they'd lost) passes to the character.
        const healed = Math.min(rolled, missing);
        if (!DwMoveActions.#transfers(data, actor, target) || !healed) return text;
        await DwMoveActions.applyChange(actor, { damage: healed });
        return `${text}; ${game.i18n.format('DW.MoveActions.Damaged', { target: actor.name, amount: healed })}`;
      }
      case 'damage': {
        const rolled = await DwMoveActions.#roll(amount || '1', actor);
        if (rolled === null) return null;
        await DwMoveActions.change(target, { damage: rolled });
        return game.i18n.format('DW.MoveActions.Damaged', { target: target.name, amount: DwMoveActions.#shown(amount, rolled) });
      }
      case 'removeDebility': {
        const has = STATS.filter(key => target.system.abilities?.[key]?.debility);
        const stats = data.stat ? has.filter(key => key == data.stat) : await DwMoveActions.#pickDebilities(target, has, n);
        if (!stats) return null;
        if (!stats.length) {
          ui.notifications.info(game.i18n.format('DW.MoveActions.NoDebility', { target: target.name }));
          return null;
        }
        await DwMoveActions.change(target, { removeDebilities: stats });
        const text = game.i18n.format('DW.MoveActions.Removed', { target: target.name, list: stats.map(s => DwMoveActions.#debilityName(target, s)).join(', ') });
        // The debilities pass to the character (those they don't have yet).
        const taken = DwMoveActions.#transfers(data, actor, target)
          ? stats.filter(stat => actor.system.abilities?.[stat] && !actor.system.abilities[stat].debility) : [];
        if (!taken.length) return text;
        await actor.update(Object.fromEntries(taken.map(stat => [`system.abilities.${stat}.debility`, true])));
        return `${text}; ${game.i18n.format('DW.MoveActions.Taken', { target: actor.name, debility: taken.map(s => DwMoveActions.#debilityName(actor, s)).join(', ') })}`;
      }
      case 'takeDebility': {
        const free = STATS.filter(key => actor.system.abilities?.[key] && !actor.system.abilities[key].debility);
        const stat = data.stat || (await DwMoveActions.#pickDebilities(actor, free, 1, 'DW.MoveActions.TakeWhich'))?.[0];
        if (!stat) return null;
        await actor.update({ [`system.abilities.${stat}.debility`]: true });
        return game.i18n.format('DW.MoveActions.Taken', { target: actor.name, debility: DwMoveActions.#debilityName(actor, stat) });
      }
      case 'removeCondition': {
        const has = DwMoveActions.conditions().filter(status => target.statuses?.has(status.id));
        const id = data.condition
          ? has.find(status => status.id == data.condition)?.id
          : await DwMoveActions.#pickCondition(target, has, 'DW.MoveActions.RemoveConditionWhich');
        if (id === null) return null;
        if (!id) {
          ui.notifications.info(data.condition
            ? game.i18n.format('DW.MoveActions.NoCondition', { target: target.name, condition: DwMoveActions.#conditionName(data.condition) })
            : game.i18n.format('DW.MoveActions.NoConditions', { target: target.name }));
          return null;
        }
        await DwMoveActions.change(target, { removeConditions: [id] });
        const name = DwMoveActions.#conditionName(id);
        const text = game.i18n.format('DW.MoveActions.ConditionRemoved', { target: target.name, condition: name });
        // The condition passes to the character.
        if (!DwMoveActions.#transfers(data, actor, target) || actor.statuses?.has(id)) return text;
        await DwMoveActions.applyChange(actor, { addConditions: [id] });
        return `${text}; ${game.i18n.format('DW.MoveActions.ConditionAdded', { target: actor.name, condition: name })}`;
      }
      case 'addCondition': {
        const id = data.condition
          || await DwMoveActions.#pickCondition(target, DwMoveActions.conditions().filter(status => !target.statuses?.has(status.id)), 'DW.MoveActions.AddConditionWhich');
        if (!id) return null;
        await DwMoveActions.change(target, { addConditions: [id] });
        return game.i18n.format('DW.MoveActions.ConditionAdded', { target: target.name, condition: DwMoveActions.#conditionName(id) });
      }
      case 'forward':
      case 'ongoing': {
        const value = n || 1;
        await DwMoveActions.change(target, { [data.type]: value });
        return game.i18n.format(data.type == 'forward' ? 'DW.MoveActions.ForwardLabel' : 'DW.MoveActions.OngoingLabel',
          { target: target.name, amount: DwUtility.signed(value) });
      }
      case 'hold':
      case 'xp': {
        const path = `system.attributes.${data.type}.value`;
        if (foundry.utils.getProperty(actor, path) === undefined) return null;
        const value = n || 1;
        await actor.update({ [path]: (Number(foundry.utils.getProperty(actor, path)) || 0) + value });
        return game.i18n.format(data.type == 'hold' ? 'DW.MoveActions.Held' : 'DW.MoveActions.XpMarked', { target: actor.name, amount: value });
      }
      case 'spend': {
        const { spent, items } = await DwResources.spendResource(actor, data.name, Math.max(1, n));
        if (!spent) {
          ui.notifications.warn(game.i18n.format('DW.Resource.None', { name: data.name, actor: actor.name }));
          return null;
        }
        return game.i18n.format('DW.Resource.Spent', { amount: spent, name: items.join(', '), left: DwResources.count(actor, data.name) });
      }
      case 'loseSpell': {
        const spell = await DwSpells.chooseSpell(actor, null, { lose: true });
        if (!spell) return null;
        await DwSpells.forget(actor, spell.id);
        return game.i18n.format('DW.Spellcasting.Lost', { spell: spell.name });
      }
    }
    return null;
  }

  /** Whether a card's line passes what it does to the character. */
  static #transfers(data, actor, target) {
    return !!data.transfer && target.uuid != actor.uuid;
  }

  /** Roll an amount ("1d8+@level", "4") as the character. Null if it isn't valid. */
  static async #roll(formula, actor) {
    try {
      const roll = await new Roll(formula, actor.getRollData()).evaluate();
      return Math.max(0, roll.total);
    }
    catch (error) {
      ui.notifications.warn(game.i18n.format('DW.MoveActions.BadAmount', { amount: formula }));
      return null;
    }
  }

  /** An amount as shown on the card: "6 (1d8)", or just "6". */
  static #shown(formula, total) {
    return formula && String(Number(formula)) != formula ? `${total} (${formula})` : String(total);
  }

  /**
   * Choose debilities from a list: up to count of them (0 for any number).
   *
   * @return {Promise<string[]|null>} The stats chosen; null if cancelled.
   */
  static async #pickDebilities(actor, stats, count, intro = 'DW.MoveActions.RemoveWhich') {
    if (!stats.length) return [];
    if (count == 1 && stats.length == 1 && intro == 'DW.MoveActions.RemoveWhich') return stats;
    const type = count == 1 ? 'radio' : 'checkbox';
    const content = document.createElement('div');
    content.innerHTML = `<p>${DwUtility.escape(game.i18n.format(intro, { target: actor.name, count: count || game.i18n.localize('DW.MoveActions.Any') }))}</p>
      ${stats.map((key, i) => `<label class="checkbox">
        <input type="${type}" name="stat" value="${key}" ${type == 'radio' && !i ? 'checked' : ''}>
        ${DwUtility.escape(DwMoveActions.#debilityName(actor, key))} (${DwUtility.escape(game.i18n.localize(`DW.${key.toUpperCase()}`))})
      </label>`).join('')}`;
    const chosen = await DwUtility.ask({
      window: { title: actor.name },
      position: { width: 360 },
      content,
      ok: { label: 'DW.MoveActions.Apply',
        callback: (event, button) => [...button.form.querySelectorAll('input[name="stat"]:checked')].map(input => input.value) },
    });
    if (!Array.isArray(chosen)) return null;
    if (count > 0 && chosen.length > count) {
      ui.notifications.warn(game.i18n.format('DW.MoveActions.TooMany', { count }));
      return null;
    }
    return chosen;
  }

  /**
   * Choose one of a list of conditions.
   *
   * @param {Actor} actor Whose conditions they are.
   * @param {{id: string, name: string}[]} conditions
   * @param {string} intro
   * @return {Promise<string|null|undefined>} The condition; null if
   *   cancelled; undefined if there were none to choose.
   */
  static async #pickCondition(actor, conditions, intro) {
    if (!conditions.length) return undefined;
    if (conditions.length == 1 && intro == 'DW.MoveActions.RemoveConditionWhich') return conditions[0].id;
    const content = document.createElement('div');
    content.innerHTML = `<p>${DwUtility.escape(game.i18n.format(intro, { target: actor.name }))}</p>
      <div class="form-group"><select name="condition">${conditions.map(status => `<option value="${DwUtility.escape(status.id)}">${DwUtility.escape(status.name)}</option>`).join('')}</select></div>`;
    const id = await DwUtility.ask({
      window: { title: actor.name },
      position: { width: 360 },
      content,
      ok: { label: 'DW.MoveActions.Apply', callback: (event, button) => button.form.elements.condition.value },
    });
    return id || null;
  }

  /**
   * Change a character (see applyChange): on this client, or the GM's for
   * someone else's. Item use (a healing potion) changes them this way too.
   */
  static async change(target, change) {
    if (target.isOwner) return DwMoveActions.applyChange(target, change);
    DwSocket.askGM('moveAction', { actor: target.uuid, ...change });
  }

  /**
   * Apply a line's change to a character: heal or damage (ignoring armor),
   * debilities removed, conditions given or removed, forward or ongoing
   * added.
   */
  static async applyChange(target, { heal = 0, damage = 0, removeDebilities = [], addConditions = [], removeConditions = [], forward = 0, ongoing = 0 } = {}) {
    for (const id of addConditions) {
      if (DwMoveActions.#conditionName(id)) await target.toggleStatusEffect(id, { active: true });
    }
    for (const id of removeConditions) {
      if (DwMoveActions.#conditionName(id)) await target.toggleStatusEffect(id, { active: false });
    }
    if (heal > 0) await target.applyDamage(heal, { op: 'heal' });
    if (damage > 0) await target.applyDamage(damage, { op: 'full', ignoreArmor: true });
    const update = {};
    for (const stat of removeDebilities) {
      if (STATS.includes(stat) && target.system.abilities?.[stat]) update[`system.abilities.${stat}.debility`] = false;
    }
    for (const [key, value] of Object.entries({ forward, ongoing })) {
      if (value && target.system.attributes?.[key]) update[`system.attributes.${key}.value`] = (Number(target.system.attributes[key].value) || 0) + value;
    }
    if (!foundry.utils.isEmpty(update)) await target.update(update);
  }

  /** A player's change to someone else's character, on the active GM. */
  static async applyRemote(data) {
    if (!game.users.activeGM?.isSelf) return;
    const target = await fromUuid(data?.actor);
    if (!target) return;
    await DwMoveActions.applyChange(target, {
      heal: Math.max(0, Number(data.heal) || 0),
      damage: Math.max(0, Number(data.damage) || 0),
      removeDebilities: Array.isArray(data.removeDebilities) ? data.removeDebilities.map(String) : [],
      addConditions: Array.isArray(data.addConditions) ? data.addConditions.map(String) : [],
      removeConditions: Array.isArray(data.removeConditions) ? data.removeConditions.map(String) : [],
      forward: Number(data.forward) || 0,
      ongoing: Number(data.ongoing) || 0,
    });
  }
}
