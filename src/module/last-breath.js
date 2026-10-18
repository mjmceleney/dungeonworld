import { DwRolls } from "./rolls.js";
import { DwUtility } from "./utility.js";

const { DialogV2 } = foundry.applications.api;
const { TextEditor } = foundry.applications.ux;

/**
 * Offers the Last Breath roll when a character drops to 0 HP.
 *
 * The client that makes the change notes it in the update's options; every
 * client then sees the update, and only the character's player (or a GM, if
 * none of its owners is online) is asked.
 */
export class DwLastBreath {

  /** The move's name, as in the basic moves compendium. */
  static MOVE_NAME = 'Last Breath';

  static init() {
    Hooks.on('preUpdateActor', (actor, changes, options) => {
      if (actor.type != 'character') return;
      const hp = foundry.utils.getProperty(changes, 'system.attributes.hp.value');
      if (hp === undefined || hp === null) return;
      if (Number(hp) <= 0 && Number(actor.system.attributes.hp.value) > 0) options.dwDying = true;
    });

    Hooks.on('updateActor', (actor, changes, options) => {
      if (!options.dwDying || !game.settings.get('dungeonworld', 'lastBreathPrompt')) return;
      if (DwLastBreath.#whoAsks(actor)?.isSelf) DwLastBreath.prompt(actor);
    });
  }

  /**
   * The user to ask: the player whose character it is, else another owner
   * who's online, else the GM.
   *
   * @param {Actor} actor
   * @return {User|null}
   */
  static #whoAsks(actor) {
    const owners = game.users.filter(u => u.active && !u.isGM && actor.testUserPermission(u, 'OWNER'));
    return owners.find(u => u.character?.id === actor.id) ?? owners[0] ?? game.users.activeGM ?? null;
  }

  /**
   * The Last Breath move to roll: the character's own, else the world's,
   * else the compendium's.
   *
   * @param {Actor} actor
   * @return {Promise<Item|null>}
   */
  static async findMove(actor) {
    const isLastBreath = (item) => item.type == 'move' && item.name.trim().toLowerCase() == DwLastBreath.MOVE_NAME.toLowerCase();
    const own = actor.items.find(isLastBreath) ?? game.items.find(isLastBreath);
    if (own) return own;
    const compendium = await DwUtility.loadCompendia('basic-moves');
    return compendium.find(isLastBreath) ?? null;
  }

  /**
   * Ask whether to roll Last Breath now, showing what the move says.
   *
   * @param {Actor} actor
   */
  static async prompt(actor) {
    const move = await DwLastBreath.findMove(actor);
    const escape = (value) => Handlebars.escapeExpression(String(value ?? ''));
    const description = move
      ? await TextEditor.implementation.enrichHTML(move.system.description ?? '', { relativeTo: move })
      : '';

    const content = document.createElement('div');
    content.innerHTML = `<p><strong>${game.i18n.format('DW.LastBreath.Dying', { name: escape(actor.name) })}</strong></p>`
      + `<div class="dw-last-breath-text">${description}</div>`;

    const roll = await DialogV2.wait({
      classes: ['dw-last-breath-dialog'],
      window: { title: game.i18n.localize('DW.LastBreath.Title'), icon: 'fa-solid fa-skull' },
      position: { width: 420 },
      content,
      buttons: [
        { action: 'roll', label: 'DW.LastBreath.Roll', icon: 'fa-solid fa-dice', default: true, callback: () => true },
        { action: 'later', label: 'DW.LastBreath.Later', icon: 'fa-solid fa-xmark', callback: () => false },
      ],
      rejectClose: false,
    });
    if (roll) await DwLastBreath.roll(actor, move);
  }

  /**
   * Roll Last Breath: just 2d6, with nothing added.
   *
   * @param {Actor} actor
   * @param {Item|null} move The move, or null to use a plain roll.
   */
  static async roll(actor, move = null) {
    move ??= await DwLastBreath.findMove(actor);
    if (move && move.system.rollType == 'PLAIN') {
      return DwRolls.rollMove({ actor, data: move });
    }
    // An edited or older copy of the move that rolls something else: roll it
    // plainly anyway, with its text and results.
    return DwRolls.rollMove({
      actor,
      data: null,
      formula: 'plain',
      templateData: move ? {
        image: move.img,
        title: move.name,
        details: move.system.description,
        moveResults: move.system.moveResults,
      } : { title: game.i18n.localize('DW.LastBreath.Title') },
    });
  }
}
