import { DwRolls } from "./rolls.js";
import { DwUtility } from "./utility.js";
import { DwResources } from "./resources.js";

const { renderTemplate } = foundry.applications.handlebars;

const TEMPLATE = 'systems/dungeonworld/templates/chat/party-move.html';

/** The flag holding a party card's state. */
const FLAG = 'flags.dungeonworld.party';

/**
 * Party moves: Undertake a Perilous Journey and Make Camp, played on a chat
 * card that the whole table shares.
 *
 * Players join with any of their characters or hirelings, using the card's
 * Join button (or a journey job's Take this job). Each character's owner then rolls and spends from the
 * card: a journey's roles roll+WIS and use up rations; at camp each camper
 * eats, takes their watch and heals on waking.
 *
 * The card's state is kept in its message's flags. Only the message's author
 * and GMs can change a message, so other players' changes go through the
 * active GM.
 */
export class DwPartyMoves {

  /** The party moves, and the move each one comes from. */
  static TYPES = {
    journey: {
      move: 'undertake a perilous journey',
      icon: 'fa-solid fa-route',
      roles: ['trailblazer', 'scout', 'quartermaster'],
    },
    camp: {
      move: 'make camp',
      icon: 'fa-solid fa-campground',
    },
  };

  /** The moves rolled from the card. */
  static ROLLED_MOVES = {
    journey: 'undertake a perilous journey',
    watch: 'take watch',
  };

  static init() {
    Hooks.on('renderChatMessageHTML', (message, html) => {
      if (message.flags?.dungeonworld?.party) DwPartyMoves.#renderCard(message, html);
    });
  }

  /**
   * The party move a move item starts, if any.
   *
   * @param {Item} item
   * @return {string|null} "journey" or "camp".
   */
  static typeFor(item) {
    if (item?.type != 'move') return null;
    const name = item.name.trim().toLowerCase();
    return Object.entries(DwPartyMoves.TYPES).find(([, type]) => type.move == name)?.[0] ?? null;
  }

  /**
   * Start a party move, or join the one already under way: the most recent
   * card of that kind that hasn't been finished.
   *
   * @param {string} type "journey" or "camp".
   * @param {Actor|null} actor A character to bring along.
   * @return {Promise<ChatMessage|null>}
   */
  static async start(type, actor = null) {
    if (!(type in DwPartyMoves.TYPES)) return null;
    const open = game.messages.contents.slice(-30).reverse()
      .find(m => m.flags?.dungeonworld?.party?.type == type && !m.flags.dungeonworld.party.closed);
    if (open) {
      if (actor) await DwPartyMoves.join(open, actor);
      return open;
    }

    const party = { type, members: {}, roles: {}, rolls: {}, distance: 0, closed: false };
    if (actor) party.members[actor.id] = { sort: 0 };
    const chatData = {
      speaker: ChatMessage.getSpeaker({ actor }),
      content: `<div class="dw-party-card" data-party="${type}"><p>${game.i18n.localize(`DW.Party.${type}.Title`)}</p></div>`,
      flags: { dungeonworld: { party } },
    };
    return ChatMessage.create(chatData);
  }

  /** Bring a character along, after the others. */
  static async join(message, actor) {
    const party = message.flags.dungeonworld.party;
    if (party.members?.[actor.id]) return;
    const sorts = Object.values(party.members ?? {}).filter(Boolean).map(m => m.sort ?? 0);
    await DwPartyMoves.update(message, {
      [`${FLAG}.members.${actor.id}`]: { sort: sorts.length ? Math.max(...sorts) + 1 : 0 },
    });
  }

  /**
   * Change a party card. The author and GMs change it directly; anyone else
   * asks the active GM to.
   *
   * @param {ChatMessage} message
   * @param {Object} changes Flattened changes, all under the party flag.
   */
  static async update(message, changes) {
    if (message.canUserModify(game.user, 'update')) return message.update(changes);
    if (!game.users.activeGM) {
      return ui.notifications.warn(game.i18n.localize('DW.Party.NeedsGM'));
    }
    game.socket.emit('system.dungeonworld', { partyUpdate: { message: message.id, changes } });
  }

  /**
   * Apply a player's change to a party card, on the active GM's client.
   *
   * @param {{message: string, changes: Object}} data
   */
  static async applyRemote(data) {
    if (!game.users.activeGM?.isSelf) return;
    const message = game.messages.get(data?.message);
    if (!message?.flags?.dungeonworld?.party) return;
    // Only the card's own state can be changed this way.
    const changes = Object.fromEntries(Object.entries(data.changes ?? {}).filter(([key]) => key.startsWith(`${FLAG}.`)));
    if (!foundry.utils.isEmpty(changes)) await message.update(changes);
  }

  /* -------------------------------------------- */
  /*  Rendering                                   */
  /* -------------------------------------------- */

  /** Fill in a party card from its message's state. */
  static async #renderCard(message, html) {
    const card = html.querySelector('.dw-party-card');
    if (!card) return;
    const context = await DwPartyMoves.#prepareContext(message);
    card.innerHTML = await renderTemplate(TEMPLATE, context);
    DwPartyMoves.#activateListeners(message, card);
  }

  static async #prepareContext(message) {
    const party = message.flags.dungeonworld.party;
    const type = party.type;
    const canManage = message.canUserModify(game.user, 'update') || game.user.isGM;
    const loc = (key, data) => data ? game.i18n.format(`DW.Party.${key}`, data) : game.i18n.localize(`DW.Party.${key}`);

    const members = Object.entries(party.members ?? {})
      .filter(([, member]) => member)
      .map(([id, member]) => ({ id, member, actor: game.actors.get(id) }))
      .filter(m => m.actor)
      .sort((a, b) => (a.member.sort ?? 0) - (b.member.sort ?? 0));

    const context = {
      type,
      title: loc(`${type}.Title`),
      icon: DwPartyMoves.TYPES[type].icon,
      intro: loc(`${type}.Intro`),
      closed: !!party.closed,
      canManage,
      canJoin: !party.closed && DwPartyMoves.#joinable(party).length > 0,
    };

    if (type == 'journey') {
      const rolls = party.rolls ?? {};
      context.roles = DwPartyMoves.TYPES.journey.roles.map(role => {
        const actor = game.actors.get(party.roles?.[role]);
        const roll = rolls[role];
        // A job no one does counts as having rolled a 6.
        const result = roll?.result ?? (actor ? null : 'failure');
        return {
          role,
          label: loc(`journey.${role}`),
          hint: loc(`journey.${role}Hint`),
          actor: actor ? { id: actor.id, name: actor.name, img: actor.img } : null,
          canRoll: !party.closed && actor && actor.isOwner && !roll,
          canTake: !party.closed && !actor && DwPartyMoves.#joinable(party, role).length > 0,
          canClear: !party.closed && actor && (actor.isOwner || canManage),
          roll: roll ? { total: roll.total, label: CONFIG.DW.rollResults[roll.result]?.label ?? roll.result } : null,
          result,
          outcome: result ? loc(`journey.${role}${result.capitalize()}`) : '',
        };
      });
      const quartermaster = context.roles.find(r => r.role == 'quartermaster');
      const distance = Math.max(0, Number(party.distance) || 0);
      const rations = Math.max(0, distance - (quartermaster.result == 'success' ? 1 : 0));
      context.distance = distance;
      context.rations = rations;
      context.rationsReady = distance > 0 && context.roles.every(r => r.result);
      context.members = members.map(({ id, member, actor }) => ({
        id,
        name: actor.name,
        img: actor.img,
        role: context.roles.find(r => r.actor?.id == id)?.label ?? '',
        canAct: !party.closed && actor.isOwner,
        canRemove: !party.closed && (actor.isOwner || canManage),
        ate: member.ate ?? null,
        rationsLeft: DwPartyMoves.#rationCount(actor),
      }));
    }
    else {
      // A priest in camp adds their skill to everyone's healing (Ministry).
      const priest = Math.max(0, ...members.map(m => m.actor.type == 'hireling' ? Number(m.actor.system.skills?.priest) || 0 : 0));
      context.priest = priest;
      context.members = members.map(({ id, member, actor }, index) => {
        const hp = actor.system.attributes?.hp ?? {};
        const isCharacter = actor.type == 'character';
        const xp = actor.system.attributes?.xp ?? {};
        return {
          id,
          name: actor.name,
          img: actor.img,
          watchNumber: index + 1,
          first: index == 0,
          last: index == members.length - 1,
          canAct: !party.closed && actor.isOwner,
          canRemove: !party.closed && (actor.isOwner || canManage),
          canMove: !party.closed && canManage,
          ate: member.ate ?? null,
          rationsLeft: DwPartyMoves.#rationCount(actor),
          watch: member.watch ? { total: member.watch.total, label: CONFIG.DW.rollResults[member.watch.result]?.label ?? member.watch.result, result: member.watch.result } : null,
          healed: member.healed ?? null,
          heal: Math.floor((Number(hp.max) || 0) / 2) + priest,
          hp: `${hp.value ?? 0}/${hp.max ?? 0}`,
          canLevel: isCharacter && Number(xp.value) >= Number(xp.max) && Number(actor.system.attributes.level?.value) < 10,
          prepares: isCharacter && actor.items.some(i => i.type == 'spell'),
        };
      });
    }
    return context;
  }

  /**
   * The player characters and hirelings this user controls that can join,
   * or take a journey job: not already on the card, or (for a job) not
   * already doing that job. The user's own character comes first.
   *
   * @param {Object} party
   * @param {string|null} role
   * @return {Actor[]}
   */
  static #joinable(party, role = null) {
    const own = game.user.character?.id;
    return game.actors
      .filter(a => ['character', 'hireling'].includes(a.type) && a.isOwner)
      .filter(a => role ? party.roles?.[role] != a.id : !party.members?.[a.id])
      .sort((a, b) => ((b.id == own) - (a.id == own)) || (a.type == 'character' ? 0 : 1) - (b.type == 'character' ? 0 : 1) || a.name.localeCompare(b.name));
  }

  /**
   * Ask which of the user's characters to bring. With only one, it's them.
   *
   * @param {Actor[]} actors
   * @param {string} title
   * @return {Promise<Actor|null>}
   */
  static async #chooseActor(actors, title) {
    if (actors.length <= 1) return actors[0] ?? null;
    const DialogV2 = foundry.applications.api.DialogV2;
    const escape = (value) => Handlebars.escapeExpression(String(value ?? ''));
    const content = document.createElement('div');
    content.innerHTML = `<div class="dw-pick-actors">${actors.map(a => `
      <button type="button" class="dw-pick-actor" data-action="${a.id}">
        <img src="${escape(a.img)}" alt="" width="32" height="32">
        <span>${escape(a.name)}</span>
        <span class="dw-pick-type">${escape(game.i18n.localize(`TYPES.Actor.${a.type}`))}</span>
      </button>`).join('')}</div>`;
    // The characters are the buttons; the footer's copies are hidden.
    const id = await DialogV2.wait({
      classes: ['dw-pick-actor-dialog'],
      window: { title },
      position: { width: 340 },
      content,
      buttons: actors.map(a => ({ action: a.id, label: a.name, callback: () => a.id })),
      rejectClose: false,
    });
    return id ? game.actors.get(id) ?? null : null;
  }

  /* -------------------------------------------- */
  /*  Actions                                     */
  /* -------------------------------------------- */

  static #activateListeners(message, card) {
    card.querySelectorAll('[data-party-action]').forEach(element => {
      const event = element.tagName == 'INPUT' ? 'change' : 'click';
      element.addEventListener(event, ev => {
        ev.preventDefault();
        ev.stopPropagation();
        DwPartyMoves.#onAction(message, element);
      });
    });

  }

  /**
   * Give a journey role to a character, who joins the journey. A character
   * can't have two jobs, so any other role of theirs is freed.
   */
  static async #assignRole(message, role, actor) {
    const party = message.flags.dungeonworld.party;
    if (!DwPartyMoves.TYPES.journey.roles.includes(role)) return;
    const changes = { [`${FLAG}.roles.${role}`]: actor.id };
    for (const [other, id] of Object.entries(party.roles ?? {})) {
      if (other != role && id == actor.id) {
        changes[`${FLAG}.roles.${other}`] = null;
        changes[`${FLAG}.rolls.${other}`] = null;
      }
    }
    changes[`${FLAG}.rolls.${role}`] = null;
    if (!party.members?.[actor.id]) {
      const sorts = Object.values(party.members ?? {}).filter(Boolean).map(m => m.sort ?? 0);
      changes[`${FLAG}.members.${actor.id}`] = { sort: sorts.length ? Math.max(...sorts) + 1 : 0 };
    }
    await DwPartyMoves.update(message, changes);
  }

  static async #onAction(message, element) {
    const party = message.flags.dungeonworld.party;
    const action = element.dataset.partyAction;
    const id = element.closest('[data-actor-id]')?.dataset.actorId;
    const actor = id ? game.actors.get(id) : null;
    const role = element.closest('[data-role]')?.dataset.role;

    switch (action) {
      case 'join': {
        const chosen = await DwPartyMoves.#chooseActor(DwPartyMoves.#joinable(party), game.i18n.localize('DW.Party.ChooseJoin'));
        if (chosen) await DwPartyMoves.join(message, chosen);
        break;
      }
      case 'take': {
        if (!role) break;
        const chosen = await DwPartyMoves.#chooseActor(DwPartyMoves.#joinable(party, role),
          game.i18n.format('DW.Party.ChooseRole', { role: game.i18n.localize(`DW.Party.journey.${role}`) }));
        if (chosen) await DwPartyMoves.#assignRole(message, role, chosen);
        break;
      }
      case 'clearRole':
        if (role) await DwPartyMoves.update(message, { [`${FLAG}.roles.${role}`]: null, [`${FLAG}.rolls.${role}`]: null });
        break;
      case 'rollRole': {
        const roleActor = game.actors.get(party.roles?.[role]);
        if (!roleActor?.isOwner) return;
        const outcome = await DwPartyMoves.#rollMove(roleActor, DwPartyMoves.ROLLED_MOVES.journey, 'wis');
        if (outcome?.result) {
          await DwPartyMoves.update(message, { [`${FLAG}.rolls.${role}`]: { total: outcome.roll?.total ?? null, result: outcome.result } });
        }
        break;
      }
      case 'distance':
        await DwPartyMoves.update(message, { [`${FLAG}.distance`]: Math.max(0, Math.round(Number(element.value) || 0)) });
        break;
      case 'eat': {
        if (!actor?.isOwner) return;
        const count = party.type == 'journey' ? Math.max(0, Number(element.dataset.count) || 0) : 1;
        const eaten = await DwPartyMoves.#eat(actor, count);
        await DwPartyMoves.update(message, { [`${FLAG}.members.${actor.id}.ate`]: eaten });
        break;
      }
      case 'watch': {
        if (!actor?.isOwner) return;
        const outcome = await DwPartyMoves.#rollMove(actor, DwPartyMoves.ROLLED_MOVES.watch, 'wis');
        if (outcome?.result) {
          await DwPartyMoves.update(message, { [`${FLAG}.members.${actor.id}.watch`]: { total: outcome.roll?.total ?? null, result: outcome.result } });
        }
        break;
      }
      case 'heal': {
        if (!actor?.isOwner) return;
        const amount = Math.max(0, Number(element.dataset.amount) || 0);
        const hp = actor.system.attributes.hp;
        const healed = Math.max(0, Math.min(amount, (Number(hp.max) || 0) - (Number(hp.value) || 0)));
        if (healed > 0) await actor.applyDamage(healed, { op: 'heal' });
        await DwPartyMoves.update(message, { [`${FLAG}.members.${actor.id}.healed`]: healed });
        break;
      }
      case 'up':
      case 'down':
        await DwPartyMoves.#moveWatch(message, id, action == 'up' ? -1 : 1);
        break;
      case 'remove': {
        if (!id) return;
        // Removed members are left as null, which the socket can carry.
        const changes = { [`${FLAG}.members.${id}`]: null };
        for (const [other, holder] of Object.entries(party.roles ?? {})) {
          if (holder == id) {
            changes[`${FLAG}.roles.${other}`] = null;
            changes[`${FLAG}.rolls.${other}`] = null;
          }
        }
        await DwPartyMoves.update(message, changes);
        break;
      }
      case 'close':
        await DwPartyMoves.update(message, { [`${FLAG}.closed`]: true });
        break;
      case 'reopen':
        await DwPartyMoves.update(message, { [`${FLAG}.closed`]: false });
        break;
    }
  }

  /** Swap a camper with the one before or after them in the watch order. */
  static async #moveWatch(message, id, step) {
    const members = Object.entries(message.flags.dungeonworld.party.members ?? {})
      .filter(([, member]) => member)
      .sort(([, a], [, b]) => (a.sort ?? 0) - (b.sort ?? 0))
      .map(([key]) => key);
    const from = members.indexOf(id);
    const to = from + step;
    if (from < 0 || to < 0 || to >= members.length) return;
    [members[from], members[to]] = [members[to], members[from]];
    const changes = {};
    members.forEach((key, sort) => changes[`${FLAG}.members.${key}.sort`] = sort);
    await DwPartyMoves.update(message, changes);
  }

  /**
   * Roll one of the character's moves (theirs, the world's or the
   * compendium's), falling back to a plain stat roll.
   *
   * @return {Promise<{roll: Roll|null, result: string|null}|null>}
   */
  static async #rollMove(actor, name, stat) {
    const matches = (item) => item.type == 'move' && item.name.trim().toLowerCase() == name;
    let move = actor.items.find(matches) ?? game.items.find(matches);
    if (!move) move = (await DwUtility.loadCompendia('basic-moves')).find(matches);
    if (move) return DwRolls.rollMove({ actor, data: move });
    return DwRolls.rollMove({ actor, data: null, formula: stat, templateData: { title: name } });
  }

  /** How many rations a character has left (items tagged or named "ration"). */
  static #rationCount(actor) {
    return DwResources.find(actor, 'ration').reduce((sum, item) => sum + DwResources.remaining(item), 0);
  }

  /**
   * Use up rations, from one item after another.
   *
   * @return {Promise<number>} How many were eaten.
   */
  static async #eat(actor, count) {
    if (count <= 0) return 0;
    const { spent } = await DwResources.spendResource(actor, 'ration', count);
    if (spent < count) {
      ui.notifications.warn(game.i18n.format('DW.Party.OutOfRations', { name: actor.name, count: count - spent }));
    }
    return spent;
  }
}
