import { DwRolls } from "./rolls.js";
import { DwUtility } from "./utility.js";
import { DwMoves } from "./moves.js";
import { DwPenalties } from "./penalties.js";

/**
 * Spellcasting, per the Wizard's and Cleric's moves:
 *
 * - Prepare Spells / Commune: prepared spells' levels total at most the
 *   caster's level +1; cantrips and rotes (level 0) are always prepared
 *   and don't count, and no spell can be above the caster's level. The
 *   caster's level is their level in that class (a Cleric 5 / Thief 3 casts
 *   as a level 5 Cleric), or for granted casting (Divine Favor) the levels
 *   since the move was taken, in its class if they have it. Going over the
 *   limit is allowed, with a warning.
 * - Cast a Spell on a 7-9 offers, among its choices, -1 ongoing to cast
 *   until the next preparation, or losing the spell until then. Both can be
 *   applied from the chat card.
 */
export class DwSpells {

  /** Whether a move is Cast a Spell. */
  static isCastMove(item) {
    return DwMoves.is(item, 'castSpell');
  }

  /** Whether a move is the one that prepares spells (Prepare Spells, Commune). */
  static isPrepareMove(item) {
    return DwMoves.is(item, 'prepareSpells');
  }

  /** The -N to cast spells the character has taken until they prepare. */
  static castPenalty(actor) {
    return DwPenalties.get(actor, 'cast');
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
    if (granting) return DwSpells.grantedCasterLevel(actor, granting);
    return overall;
  }

  /**
   * The casting level a move that grants casting (Divine Favor) gives: 1 when
   * it was taken, +1 per level since. When the move is from one of the
   * character's classes, only levels in that class count: a Paladin 5 /
   * Paragon 3 who took Divine Favor at Paladin 2 casts as a level 4 Cleric.
   * Otherwise (taken through Multiclass Dabbler, say) every level counts.
   *
   * @param {Actor} actor
   * @param {Item|object} move
   * @param {{overall?: number, classLevels?: {name: string, level: number}[]}} [at]
   *   The levels to count to, if not the character's current ones (a level up
   *   in progress).
   * @return {number}
   */
  static grantedCasterLevel(actor, move, { overall, classLevels } = {}) {
    overall ??= Math.max(1, Number(actor.system.attributes.level?.value) || 1);
    classLevels ??= DwUtility.classLevels(actor);
    const flags = move.flags?.dungeonworld ?? {};
    // Taken before the level was recorded: count from the current level.
    const takenAt = Number(flags.takenAtLevel ?? overall);
    const cls = move.system.class && classLevels.find(c => DwUtility.sameClass(c.name, move.system.class));
    if (!cls) return Math.max(1, overall - takenAt + 1);
    // Taken before its class level was recorded: the class level then was at
    // most the overall level, and multiclassing usually comes later.
    const takenAtClass = Number(flags.takenAtClassLevel ?? Math.min(takenAt, cls.level));
    return Math.max(1, cls.level - takenAtClass + 1);
  }

  /**
   * Whether a move lets spells be prepared as if they were lower level (the
   * Wizard's Prodigy and Master, the Cleric's Chosen One and Anointed), per
   * its Lowers Spells setting.
   */
  static isLowerMove(item) {
    return item?.type == 'move' && Number(item.system.lowerSpells?.count) > 0;
  }

  /** How many spells a move like Prodigy lowers, and by how many levels. */
  static #lowerSetting(move) {
    return {
      count: Math.max(0, Math.floor(Number(move.system.lowerSpells?.count) || 0)),
      levels: Math.max(1, Math.floor(Number(move.system.lowerSpells?.levels) || 1)),
    };
  }

  /** The spells (by name) a move like Prodigy lowers, as chosen when preparing. */
  static #lowerChoices(move) {
    const chosen = move.flags?.dungeonworld?.lowerSpells;
    return (Array.isArray(chosen) ? chosen : []).map(String).slice(0, DwSpells.#lowerSetting(move).count);
  }

  /** The character's moves like Prodigy for a class's spells. */
  static lowerMoves(actor, className = '') {
    return actor.items.filter(i => DwSpells.isLowerMove(i) && DwSpells.#ofClass(i, className));
  }

  /** The move like Prodigy that lowers a spell, if any. */
  static loweredBy(actor, spell) {
    return actor.items.find(i => DwSpells.isLowerMove(i) && DwSpells.#ofClass(spell, i.system.class)
      && DwSpells.#lowerChoices(i).some(name => DwUtility.nameKey(name) == DwUtility.nameKey(spell.name))) ?? null;
  }

  /** The level a spell is prepared at: lower for Prodigy's spell. */
  static preparedLevel(actor, spell) {
    return DwSpells.#lowered(spell, DwSpells.loweredBy(actor, spell));
  }

  /** A spell's level, less what the move lowering it (if any) takes off. */
  static #lowered(spell, move) {
    const level = Math.max(0, Number(spell.system.spellLevel) || 0);
    return move ? Math.max(0, level - DwSpells.#lowerSetting(move).levels) : level;
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
        .reduce((sum, i) => sum + DwSpells.preparedLevel(actor, i), 0);
      const short = DwUtility.shortClassName(className);
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

  /**
   * Cast a spell: roll Cast a Spell, showing the spell, so a 7-9 can lose
   * that spell.
   *
   * @param {Actor} actor
   * @param {Item} spell
   * @param {Item} [move] The Cast a Spell move, if not the spell's class's.
   */
  static async cast(actor, spell, move = DwSpells.castMove(actor, spell)) {
    if (!move) return ui.notifications.warn(game.i18n.localize('DW.Spellcasting.NoCastMove'));
    if (!spell.system.prepared && DwSpells.preparedLevel(actor, spell) > 0) {
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
    return {
      penalty: DwSpells.castPenalty(actor) + 1,
      spellId: spell?.id ?? '',
      lose: spell ? game.i18n.format('DW.Spellcasting.Lose', { spell: spell.name }) : '',
    };
  }

  /**
   * Choose one of the character's spells: one they can cast (prepared, or
   * always prepared like a cantrip), or with lose, one they've prepared.
   * Only spells of the move's class, if it has one.
   *
   * @param {Actor} actor
   * @param {Item|null} move
   * @param {{lose?: boolean}} [options]
   * @return {Promise<Item|null|undefined>} The spell; null if cancelled;
   *   undefined if there are none to choose from.
   */
  static async chooseSpell(actor, move, { lose = false } = {}) {
    const className = move?.system?.class ?? '';
    const spells = actor.items.filter(i => i.type == 'spell' && DwSpells.#ofClass(i, className)
      && (lose ? i.system.prepared && DwSpells.preparedLevel(actor, i) > 0 : i.system.prepared || DwSpells.preparedLevel(actor, i) == 0))
      .sort((a, b) => Number(a.system.spellLevel) - Number(b.system.spellLevel) || a.name.localeCompare(b.name));
    if (!spells.length) {
      if (lose) ui.notifications.warn(game.i18n.localize('DW.Spellcasting.NothingToLose'));
      return undefined;
    }
    // Grouped under their level's heading (Cantrips/Rotes, 1st Level Spells...).
    const groups = Map.groupBy(spells, s => Math.max(0, Number(s.system.spellLevel) || 0));
    const options = [...groups].map(([level, list]) => `<optgroup label="${DwUtility.escape(game.i18n.localize(`DW.Spells${level}`))}">
        ${list.map(s => `<option value="${s.id}">${DwUtility.escape(s.name)}</option>`).join('')}
      </optgroup>`).join('');
    const content = document.createElement('div');
    content.innerHTML = `<p>${DwUtility.escape(game.i18n.localize(lose ? 'DW.Spellcasting.WhichLose' : 'DW.Spellcasting.WhichCast'))}</p>
      <div class="form-group"><select name="spell">${options}</select></div>`;
    const id = await DwUtility.ask({
      window: { title: move?.name ?? actor.name, icon: 'fa-solid fa-wand-sparkles' },
      position: { width: 360 },
      content,
      ok: { label: lose ? 'DW.Spellcasting.LoseButton' : 'DW.Spellcasting.CastButton',
        callback: (event, button) => button.form.elements.spell.value },
    });
    return id ? actor.items.get(id) ?? null : null;
  }

  /* -------------------------------------------- */

  /** Take another -1 to cast spells, until the next preparation. */
  static addPenalty(actor) {
    return DwPenalties.add(actor, 'cast');
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
   * casting penalty. Moves like Prodigy choose their spell here too, and the
   * spells are grouped by the level they're prepared at.
   *
   * @param {Actor} actor
   * @param {Item|null} move The move that prepares them; its class decides
   *   which spells and which level.
   */
  static async prepare(actor, move = null) {
    const className = move?.system?.class ?? '';
    const level = DwSpells.casterLevel(actor, className);
    const max = level + 1;
    const spells = actor.items.filter(i => i.type == 'spell' && DwSpells.#ofClass(i, className))
      .sort((a, b) => (Number(a.system.spellLevel) - Number(b.system.spellLevel)) || a.name.localeCompare(b.name));
    if (!spells.length) return ui.notifications.warn(game.i18n.localize('DW.Spellcasting.NoSpells'));

    // Moves like Prodigy, each with the spells it lowers (by name), one per
    // spell it can choose ('' for none yet).
    const lowerMoves = DwSpells.lowerMoves(actor, className);
    const lowering = new Map(lowerMoves.map(m => {
      const chosen = DwSpells.#lowerChoices(m);
      return [m.id, Array.from({ length: DwSpells.#lowerSetting(m).count }, (_, i) => chosen[i] ?? '')];
    }));
    const lowerable = spells.filter(s => Number(s.system.spellLevel) > 0);
    const loweredBy = (spell) => lowerMoves.find(m => lowering.get(m.id).some(name => DwUtility.nameKey(name) == DwUtility.nameKey(spell.name))) ?? null;
    const levelOf = (spell) => DwSpells.#lowered(spell, loweredBy(spell));

    // Ticked spells, kept as the groups are redrawn.
    const checked = new Set(spells.filter(s => s.system.prepared).map(s => s.id));

    // One group per level the spells are prepared at, each with a subtotal.
    const groupsHtml = () => {
      const groups = new Map();
      for (const spell of spells) {
        const spellLevel = levelOf(spell);
        if (!groups.has(spellLevel)) groups.set(spellLevel, []);
        groups.get(spellLevel).push(spell);
      }
      return [...groups].sort(([a], [b]) => a - b).map(([spellLevel, list]) => {
        const always = spellLevel == 0;
        const tooHigh = spellLevel > level;
        const heading = always ? game.i18n.localize('DW.Spellcasting.AlwaysGroup')
          : game.i18n.format('DW.Spellcasting.LevelGroup', { level: spellLevel });
        return `<section class="dw-prepare-group ${tooHigh ? 'is-locked' : ''}" data-level="${spellLevel}">
          <header class="dw-prepare-group-head">
            <span>${DwUtility.escape(heading)}</span>
            <span class="dw-prepare-subtotal">${tooHigh ? DwUtility.escape(game.i18n.format('DW.Spellcasting.TooHighGroup', { level })) : ''}</span>
          </header>
          ${list.sort((a, b) => a.name.localeCompare(b.name)).map(spell => {
            const by = loweredBy(spell);
            const note = by ? game.i18n.format('DW.Spellcasting.LoweredNote', { move: by.name, level: Number(spell.system.spellLevel) }) : '';
            return `<label class="checkbox dw-prepare-spell">
              <input type="checkbox" name="${spell.id}" data-level="${spellLevel}" ${always || (checked.has(spell.id) && !tooHigh) ? 'checked' : ''} ${always || tooHigh ? 'disabled' : ''}>
              <span class="dw-prepare-name">${DwUtility.escape(spell.name)}</span>
              ${note ? `<span class="dw-prepare-level">${DwUtility.escape(note)}</span>` : ''}
            </label>`;
          }).join('')}
        </section>`;
      }).join('');
    };

    // The spell choices for each move like Prodigy.
    const lowerHtml = lowerMoves.length ? `<div class="dw-prepare-lower">
        ${lowerMoves.map(m => {
          const { count, levels } = DwSpells.#lowerSetting(m);
          const by = levels == 1 ? game.i18n.localize('DW.Spellcasting.LowerByOne') : game.i18n.format('DW.Spellcasting.LowerByMany', { levels });
          const hint = game.i18n.format(count == 1 ? 'DW.Spellcasting.LowerHintOne' : 'DW.Spellcasting.LowerHintMany', { count, by });
          return `<div class="dw-prepare-lower-move">
            <p class="dw-prepare-lower-hint"><strong>${DwUtility.escape(m.name)}</strong>: ${DwUtility.escape(hint)}</p>
            ${lowering.get(m.id).map((chosen, slot) => `<select data-move-id="${m.id}" data-slot="${slot}" aria-label="${DwUtility.escape(m.name)}">
              <option value="">${DwUtility.escape(game.i18n.localize('DW.Spellcasting.LowerChoose'))}</option>
              ${lowerable.map(s => `<option value="${DwUtility.escape(s.name)}" ${DwUtility.nameKey(chosen) == DwUtility.nameKey(s.name) ? 'selected' : ''}>${DwUtility.escape(s.name)} (${Number(s.system.spellLevel)})</option>`).join('')}
            </select>`).join('')}
          </div>`;
        }).join('')}
      </div>` : '';

    const short = DwUtility.shortClassName(className);
    const content = document.createElement('div');
    content.innerHTML = `<p>${DwUtility.escape(game.i18n.format(short ? 'DW.Spellcasting.PrepareIntroClass' : 'DW.Spellcasting.PrepareIntro', { max, level, class: short }))}</p>
      ${lowerHtml}
      <div class="dw-prepare-groups">${groupsHtml()}</div>
      <div class="dw-prepare-summary">
        <div class="dw-prepare-meter"><div class="dw-prepare-meter-fill"></div></div>
        <p class="dw-prepare-count"></p>
        <p class="dw-prepare-math"></p>
      </div>`;

    // The math, kept up to date as spells are ticked and Prodigy's spell
    // changes.
    const render = (event, dialog) => {
      const root = dialog.element;
      const groupsEl = root.querySelector('.dw-prepare-groups');
      const update = () => {
        const picked = [...groupsEl.querySelectorAll('input:not([disabled])')].filter(b => b.checked);
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
      groupsEl.addEventListener('change', event => {
        const box = event.target.closest('input[type="checkbox"]');
        if (!box || box.disabled) return;
        if (box.checked) checked.add(box.name);
        else checked.delete(box.name);
        update();
      });
      // Each choice is a different spell: choosing one that's already chosen
      // clears the other choice.
      const selects = [...root.querySelectorAll('.dw-prepare-lower select')];
      for (const select of selects) {
        select.addEventListener('change', () => {
          for (const other of selects) {
            if (other !== select && select.value && DwUtility.nameKey(other.value) == DwUtility.nameKey(select.value)) other.value = '';
          }
          for (const s of selects) lowering.get(s.dataset.moveId)[Number(s.dataset.slot)] = s.value;
          groupsEl.innerHTML = groupsHtml();
          update();
        });
      }
      update();
    };

    const result = await DwUtility.ask({
      classes: ['dw-prepare-dialog'],
      window: { title: move?.name ?? game.i18n.localize('DW.Spellcasting.Prepare'), icon: 'fa-solid fa-book-open' },
      position: { width: 480 },
      content,
      render,
      ok: { label: 'DW.Spellcasting.PrepareButton',
        callback: (event, button) => [...button.form.querySelectorAll('.dw-prepare-groups input')]
          .filter(b => b.checked && !b.disabled).map(b => b.name) },
    });
    if (!Array.isArray(result)) return;

    // Remember the spells the moves lower.
    const moveUpdates = lowerMoves
      .map(m => ({ move: m, chosen: lowering.get(m.id).filter(Boolean) }))
      .filter(({ move, chosen }) => chosen.join('\n') != DwSpells.#lowerChoices(move).join('\n'))
      .map(({ move, chosen }) => ({ _id: move.id, 'flags.dungeonworld.lowerSpells': chosen }));

    // Level 0 spells are always prepared; spells above the caster's level
    // can't be.
    const chosen = new Set(result);
    const isPrepared = (spell) => {
      const spellLevel = levelOf(spell);
      return spellLevel == 0 || (spellLevel <= level && chosen.has(spell.id));
    };
    const updates = spells
      .map(spell => ({ _id: spell.id, 'system.prepared': isPrepared(spell) }))
      .filter((u, i) => u['system.prepared'] != !!spells[i].system.prepared);
    if (updates.length || moveUpdates.length) await actor.updateEmbeddedDocuments('Item', [...moveUpdates, ...updates]);
    await DwPenalties.clear(actor, 'cast');

    const prepared = spells.filter(isPrepared);
    const used = prepared.reduce((sum, s) => sum + levelOf(s), 0);
    if (used > max) ui.notifications.warn(game.i18n.format('DW.Spellcasting.OverWarning', { used, max }));

    await DwUtility.postCard(actor, {
      image: move?.img,
      title: move?.name ?? game.i18n.localize('DW.Spellcasting.Prepare'),
      details: `<p>${DwUtility.escape(game.i18n.format('DW.Spellcasting.PreparedList', { used, max }))}</p>`
        + `<ul>${prepared.map(s => `<li>${DwUtility.escape(s.name)}${levelOf(s) ? ` (${levelOf(s)})` : ''}</li>`).join('')}</ul>`,
    });
  }
}
