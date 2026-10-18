import { DwRolls } from "./rolls.js";
import { DwUtility } from "./utility.js";

const { DialogV2 } = foundry.applications.api;
const { renderTemplate } = foundry.applications.handlebars;

/**
 * Spellcasting, per the Wizard's and Cleric's moves:
 *
 * - Prepare Spells / Commune: prepared spells' levels total at most the
 *   caster's level +1; cantrips and rotes (level 0) are always prepared
 *   and don't count, and no spell can be above the caster's level. The
 *   caster's level is their level in that class (a Cleric 5 / Thief 3 casts
 *   as a level 5 Cleric), or for granted casting (Divine Favor) the levels
 *   since the move was taken. Going over the limit is allowed, with a
 *   warning.
 * - Cast a Spell on a 7-9 offers, among its choices, -1 ongoing to cast
 *   until the next preparation, or losing the spell until then. Both can be
 *   applied from the chat card.
 */
export class DwSpells {

  /** Whether a move is Cast a Spell. */
  static isCastMove(item) {
    return item?.type == 'move' && /^cast a spell$/i.test(item.name.trim());
  }

  /** Whether a move is the one that prepares spells. */
  static isPrepareMove(item) {
    return item?.type == 'move' && /^(prepare spells|commune)$/i.test(item.name.trim());
  }

  /** The -N to cast spells the character has taken until they prepare. */
  static castPenalty(actor) {
    return Math.max(0, Number(actor?.flags?.dungeonworld?.castPenalty) || 0);
  }

  /**
   * The level the character casts a class's spells at: their level in that
   * class; for casting a move grants (Divine Favor), the levels since it was
   * taken; otherwise their overall level.
   *
   * @param {Actor} actor
   * @param {string} className
   * @return {number}
   */
  static casterLevel(actor, className) {
    const overall = Math.max(1, Number(actor.system.attributes.level?.value) || 1);
    if (!className) return overall;
    const own = DwUtility.classLevels(actor).find(c => c.name && DwUtility.sameClass(c.name, className));
    if (own) return Math.max(1, own.level);
    const granting = actor.items.find(i => i.type == 'move' && i.system.grants?.casting
      && DwUtility.sameClass(String(i.system.grants.classes ?? '').split(',')[0], className));
    if (granting) {
      const takenAt = Number(granting.flags?.dungeonworld?.takenAtLevel ?? overall);
      return Math.max(1, overall - takenAt + 1);
    }
    return overall;
  }

  /** Whether a spell belongs to a class (spells without a class fit any). */
  static #ofClass(spell, className) {
    return !className || !spell.system.class || DwUtility.sameClass(spell.system.class, className);
  }

  /**
   * The character's casting classes, from their Prepare Spells / Commune
   * moves: each with its caster level, limit, and the prepared levels used.
   * A character with spells but no such move gets one entry for all spells.
   *
   * @param {Actor} actor
   * @return {{move: Item|null, className: string, label: string, level: number,
   *   used: number, max: number, over: boolean}[]}
   */
  static budgets(actor) {
    const moves = actor.items.filter(i => DwSpells.isPrepareMove(i));
    const entries = moves.length ? moves.map(move => ({ move, className: move.system.class ?? '' })) : [{ move: null, className: '' }];
    return entries.map(({ move, className }) => {
      const level = DwSpells.casterLevel(actor, className);
      const used = actor.items
        .filter(i => i.type == 'spell' && i.system.prepared && DwSpells.#ofClass(i, className))
        .reduce((sum, i) => sum + Math.max(0, Number(i.system.spellLevel) || 0), 0);
      const short = String(className).replace(/^the\s+/i, '');
      return {
        move,
        className,
        label: move ? (short ? `${move.name} (${short} ${level})` : move.name) : game.i18n.localize('DW.Spellcasting.Prepare'),
        level,
        used,
        max: level + 1,
        over: used > level + 1,
      };
    });
  }

  /**
   * The character's Cast a Spell move for a spell: one of the spell's own
   * class if they have more than one.
   */
  static castMove(actor, spell = null) {
    const moves = actor.items.filter(i => DwSpells.isCastMove(i));
    if (spell?.system?.class) {
      const own = moves.find(m => DwUtility.sameClass(m.system.class, spell.system.class));
      if (own) return own;
    }
    return moves[0] ?? null;
  }

  /** Whether a Cast a Spell move is the Cleric's (spells are revoked, not forgotten). */
  static #revokes(move) {
    return /cleric/i.test(move?.system?.class ?? '') || /deity/i.test(move?.system?.description ?? '');
  }

  /**
   * Cast a spell: roll Cast a Spell, showing the spell, so a 7-9 can lose
   * that spell.
   *
   * @param {Actor} actor
   * @param {Item} spell
   */
  static async cast(actor, spell) {
    const move = DwSpells.castMove(actor, spell);
    if (!move) return ui.notifications.warn(game.i18n.localize('DW.Spellcasting.NoCastMove'));
    if (!spell.system.prepared && Number(spell.system.spellLevel) > 0) {
      ui.notifications.warn(game.i18n.format('DW.Spellcasting.NotPrepared', { spell: spell.name }));
    }
    return DwRolls.rollMove({ actor, data: move, spell });
  }

  /**
   * What a Cast a Spell card offers on a 7-9: the penalty, and losing the
   * spell that was cast (when it's known).
   *
   * @return {Object|null}
   */
  static castOffer(actor, move, result, spell = null) {
    if (result != 'partial' || !DwSpells.isCastMove(move)) return null;
    const revokes = DwSpells.#revokes(move);
    return {
      penalty: DwSpells.castPenalty(actor) + 1,
      spellId: spell?.id ?? '',
      forget: spell ? game.i18n.format(revokes ? 'DW.Spellcasting.Revoke' : 'DW.Spellcasting.Forget', { spell: spell.name }) : '',
    };
  }

  /* -------------------------------------------- */

  /** Take another -1 to cast spells, until the next preparation. */
  static async addPenalty(actor) {
    const penalty = DwSpells.castPenalty(actor) + 1;
    await actor.setFlag('dungeonworld', 'castPenalty', penalty);
    return penalty;
  }

  /** Lose a spell until the next preparation. */
  static async forget(actor, spellId) {
    const spell = actor.items.get(spellId);
    if (!spell) return null;
    await spell.update({ 'system.prepared': false });
    return spell;
  }

  /**
   * Prepare Spells or Commune: choose this class's spells within its limit.
   * Cantrips and rotes are always prepared; spells above the caster's level
   * can't be. Going over the limit is allowed, with a warning. Clears the
   * casting penalty.
   *
   * @param {Actor} actor
   * @param {Item|null} move The move that prepares them; its class decides
   *   which spells and which level.
   */
  static async prepare(actor, move = null) {
    const escape = (value) => Handlebars.escapeExpression(String(value ?? ''));
    const className = move?.system?.class ?? '';
    const level = DwSpells.casterLevel(actor, className);
    const max = level + 1;
    const spells = actor.items.filter(i => i.type == 'spell' && DwSpells.#ofClass(i, className))
      .sort((a, b) => (Number(a.system.spellLevel) - Number(b.system.spellLevel)) || a.name.localeCompare(b.name));
    if (!spells.length) return ui.notifications.warn(game.i18n.localize('DW.Spellcasting.NoSpells'));

    // One group per spell level, each with a subtotal.
    const groups = new Map();
    for (const spell of spells) {
      const spellLevel = Math.max(0, Number(spell.system.spellLevel) || 0);
      if (!groups.has(spellLevel)) groups.set(spellLevel, []);
      groups.get(spellLevel).push(spell);
    }
    const short = String(className).replace(/^the\s+/i, '');
    const content = document.createElement('div');
    content.innerHTML = `<p>${escape(game.i18n.format(short ? 'DW.Spellcasting.PrepareIntroClass' : 'DW.Spellcasting.PrepareIntro', { max, level, class: short }))}</p>
      <div class="dw-prepare-groups">${[...groups].map(([spellLevel, list]) => {
        const always = spellLevel == 0;
        const tooHigh = spellLevel > level;
        const heading = always ? game.i18n.localize('DW.Spellcasting.AlwaysGroup')
          : game.i18n.format('DW.Spellcasting.LevelGroup', { level: spellLevel });
        return `<section class="dw-prepare-group ${tooHigh ? 'is-locked' : ''}" data-level="${spellLevel}">
          <header class="dw-prepare-group-head">
            <span>${escape(heading)}</span>
            <span class="dw-prepare-subtotal">${tooHigh ? escape(game.i18n.format('DW.Spellcasting.TooHighGroup', { level })) : ''}</span>
          </header>
          ${list.map(spell => `<label class="checkbox dw-prepare-spell">
            <input type="checkbox" name="${spell.id}" data-level="${spellLevel}" ${always || (spell.system.prepared && !tooHigh) ? 'checked' : ''} ${always || tooHigh ? 'disabled' : ''}>
            <span class="dw-prepare-name">${escape(spell.name)}</span>
          </label>`).join('')}
        </section>`;
      }).join('')}</div>
      <div class="dw-prepare-summary">
        <div class="dw-prepare-meter"><div class="dw-prepare-meter-fill"></div></div>
        <p class="dw-prepare-count"></p>
        <p class="dw-prepare-math"></p>
      </div>`;

    // The math, kept up to date as spells are ticked.
    const render = (event, dialog) => {
      const root = dialog.element;
      const boxes = [...root.querySelectorAll('.dw-prepare-groups input:not([disabled])')];
      const update = () => {
        const picked = boxes.filter(b => b.checked);
        const used = picked.reduce((sum, b) => sum + Number(b.dataset.level), 0);
        const over = used - max;
        for (const group of root.querySelectorAll('.dw-prepare-group:not(.is-locked)')) {
          const groupLevel = Number(group.dataset.level);
          if (!groupLevel) continue;
          const count = [...group.querySelectorAll('input:checked')].length;
          group.querySelector('.dw-prepare-subtotal').textContent = count
            ? game.i18n.format('DW.Spellcasting.Subtotal', { count, level: groupLevel, total: count * groupLevel })
            : '';
        }
        const summary = root.querySelector('.dw-prepare-summary');
        summary.classList.toggle('is-over', over > 0);
        root.querySelector('.dw-prepare-meter-fill').style.width = `${Math.min(100, Math.round(100 * used / max))}%`;
        root.querySelector('.dw-prepare-count').textContent = over > 0
          ? game.i18n.format('DW.Spellcasting.BudgetOver', { used, max, over })
          : game.i18n.format('DW.Spellcasting.BudgetLeft', { used, max, left: max - used });
        root.querySelector('.dw-prepare-math').textContent = picked.length
          ? picked.map(b => `${b.closest('label').querySelector('.dw-prepare-name').textContent} (${b.dataset.level})`).join(' + ') + ` = ${used}`
          : game.i18n.localize('DW.Spellcasting.NonePicked');
      };
      boxes.forEach(b => b.addEventListener('change', update));
      update();
    };

    const result = await DialogV2.wait({
      classes: ['dw-prepare-dialog'],
      window: { title: move?.name ?? game.i18n.localize('DW.Spellcasting.Prepare'), icon: 'fa-solid fa-book-open' },
      position: { width: 480 },
      content,
      render,
      buttons: [
        { action: 'prepare', label: 'DW.Spellcasting.PrepareButton', icon: 'fa-solid fa-check', default: true,
          callback: (event, button) => [...button.form.querySelectorAll('.dw-prepare-groups input')]
            .filter(b => b.checked && !b.disabled).map(b => b.name) },
        { action: 'cancel', label: 'DW.Cancel', icon: 'fa-solid fa-xmark', callback: () => null },
      ],
      rejectClose: false,
    });
    if (!Array.isArray(result)) return;

    // Level 0 spells are always prepared; spells above the caster's level
    // can't be.
    const chosen = new Set(result);
    const isPrepared = (spell) => {
      const spellLevel = Number(spell.system.spellLevel) || 0;
      return spellLevel == 0 || (spellLevel <= level && chosen.has(spell.id));
    };
    const updates = spells
      .map(spell => ({ _id: spell.id, 'system.prepared': isPrepared(spell) }))
      .filter((u, i) => u['system.prepared'] != !!spells[i].system.prepared);
    if (updates.length) await actor.updateEmbeddedDocuments('Item', updates);
    if (DwSpells.castPenalty(actor)) await actor.unsetFlag('dungeonworld', 'castPenalty');

    const prepared = spells.filter(isPrepared);
    const used = prepared.reduce((sum, s) => sum + (Number(s.system.spellLevel) || 0), 0);
    if (used > max) ui.notifications.warn(game.i18n.format('DW.Spellcasting.OverWarning', { used, max }));

    const chatData = {
      speaker: ChatMessage.getSpeaker({ actor }),
      content: await renderTemplate('systems/dungeonworld/templates/chat/chat-move.html', {
        actor,
        image: move?.img,
        title: move?.name ?? game.i18n.localize('DW.Spellcasting.Prepare'),
        details: `<p>${escape(game.i18n.format('DW.Spellcasting.PreparedList', { used, max }))}</p>`
          + `<ul>${prepared.map(s => `<li>${escape(s.name)}${Number(s.system.spellLevel) ? ` (${Number(s.system.spellLevel)})` : ''}</li>`).join('')}</ul>`,
      }),
    };
    DwUtility.applyMessageMode(chatData);
    await ChatMessage.create(chatData);
  }
}
