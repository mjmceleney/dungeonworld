import { DwRolls } from "./rolls.js";
import { DwUtility } from "./utility.js";
import { STATS } from "./config.js";

/**
 * Roll links in text: "roll+DEX" in a move's description or a journal page
 * becomes a link that rolls it, and @Move[Hack & Slash] (or
 * @Move[Hack & Slash]{label}) rolls that move.
 *
 * Who rolls: the character whose sheet the text is on; otherwise the
 * selected token's actor; otherwise the user's own character. In a move's
 * own text, "roll+DEX" rolls the move itself, so its results show.
 */
export class DwInlineRolls {

  static init() {
    CONFIG.TextEditor.enrichers.push(
      {
        id: 'dwStatRoll',
        pattern: /\broll\s*\+\s*(str|dex|con|int|wis|cha)\b/gi,
        enricher: (match, options) => DwInlineRolls.#link({
          label: match[0],
          stat: match[1].toLowerCase(),
          options,
        }),
      },
      {
        id: 'dwMoveRoll',
        pattern: /@Move\[([^\]]+)\](?:\{([^}]+)\})?/g,
        enricher: (match, options) => DwInlineRolls.#link({
          label: match[2] ?? match[1],
          move: match[1].trim(),
          options,
        }),
      },
    );

    document.addEventListener('click', event => {
      const link = event.target.closest?.('a.dw-inline-roll');
      if (!link) return;
      event.preventDefault();
      event.stopPropagation();
      DwInlineRolls.#onClick(link);
    });
  }

  /** Build a roll link, noting where the text came from. */
  static #link({ label, stat = null, move = null, options = {} }) {
    const link = document.createElement('a');
    link.classList.add('dw-inline-roll');
    link.dataset.tooltip = move
      ? game.i18n.format('DW.InlineRoll.Move', { move })
      : game.i18n.format('DW.InlineRoll.Stat', { stat: stat.toUpperCase() });
    if (stat) link.dataset.stat = stat;
    if (move) link.dataset.move = move;

    const source = options.relativeTo;
    const actor = source?.documentName == 'Actor' ? source : (source?.documentName == 'Item' ? source.parent : null);
    if (actor) link.dataset.actor = actor.uuid;
    if (source?.documentName == 'Item' && source.type == 'move') link.dataset.item = source.uuid;

    link.innerHTML = `<i class="fas fa-dice-d6" inert></i> ${DwUtility.escape(label)}`;
    return link;
  }

  /** The character to roll for. */
  static #actor(link) {
    const fromText = link.dataset.actor ? fromUuidSync(link.dataset.actor) : null;
    const candidates = [fromText, canvas.tokens?.controlled[0]?.actor, game.user.character];
    return candidates.find(a => a && a.isOwner && ['character', 'npc', 'hireling'].includes(a.type)) ?? null;
  }

  static async #onClick(link) {
    const actor = DwInlineRolls.#actor(link);
    if (!actor) return ui.notifications.warn(game.i18n.localize('DW.InlineRoll.NoActor'));

    // @Move[Name]: the actor's own move, else the world's, else a compendium's.
    if (link.dataset.move) {
      const matches = (item) => ['move', 'npcMove'].includes(item.type) && DwUtility.sameName(item.name, link.dataset.move);
      const own = actor.items.find(matches);
      if (own) return own.roll();
      const move = await DwUtility.findMove(null, matches);
      if (!move) return ui.notifications.warn(game.i18n.format('DW.InlineRoll.NoMove', { move: link.dataset.move }));
      return DwRolls.rollMove({ actor, data: move });
    }

    // "roll+DEX" in a move's own text rolls the move, when it rolls that stat
    // (or asks which), so the card shows its results.
    const stat = link.dataset.stat;
    if (link.dataset.item) {
      const item = fromUuidSync(link.dataset.item);
      const rollType = String(item?.system?.rollType ?? '').toLowerCase();
      if (item && item.parent === actor && (rollType == stat || rollType == 'ask')) return item.roll();
    }
    if (!STATS.includes(stat) || !actor.system.abilities?.[stat]) return;
    return DwRolls.rollMove({
      actor,
      data: null,
      formula: stat,
      templateData: { title: game.i18n.format('DW.InlineRoll.Stat', { stat: stat.toUpperCase() }) },
    });
  }
}
