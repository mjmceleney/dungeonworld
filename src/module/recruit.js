import { DwRolls } from "./rolls.js";
import { DwUtility } from "./utility.js";
import { DwMoves } from "./moves.js";
import { DwPenalties } from "./penalties.js";

/**
 * Recruit: putting out word that you're looking to hire help.
 *
 * Before rolling, the player says what they made known (each +1: generous
 * pay, what they're setting out to do, a share of what they find) and
 * whether they have a useful reputation (+1), and where they're recruiting.
 * Turning applicants away on a 7-9 or a miss gives -1 forward to Recruit,
 * which the next Recruit roll uses up.
 */
export class DwRecruit {

  /** What the player can make known, each +1. */
  static TERMS = ['pay', 'purpose', 'share', 'reputation'];

  /** Where hirelings can be found (the hireling sheet's points ranges). */
  static PLACES = ['village', 'town', 'keep', 'city'];

  static isRecruit(item) {
    return DwMoves.is(item, 'recruit');
  }

  /** The -1 forward to Recruit from turning applicants away. */
  static penalty(actor) {
    return DwPenalties.get(actor, 'recruit');
  }

  /**
   * Ask what was made known and where, then roll.
   *
   * @param {Actor} actor
   * @param {Item} move
   */
  static async prompt(actor, move) {
    const penalty = DwRecruit.penalty(actor);
    const content = document.createElement('div');
    content.innerHTML = `<p>${DwUtility.escape(game.i18n.localize('DW.Recruit.Intro'))}</p>
      <fieldset class="dw-recruit-terms">
        ${DwRecruit.TERMS.map(term => `<label class="checkbox">
          <input type="checkbox" name="${term}">
          <span>${DwUtility.escape(game.i18n.localize(`DW.Recruit.Term.${term}`))}</span>
          <strong>+1</strong>
        </label>`).join('')}
      </fieldset>
      <div class="form-group">
        <label>${DwUtility.escape(game.i18n.localize('DW.Recruit.Where'))}</label>
        <select name="found">
          <option value=""></option>
          ${DwRecruit.PLACES.map(p => `<option value="${p}">${DwUtility.escape(game.i18n.localize(`DW.Hireling.Found.${p}`))}</option>`).join('')}
        </select>
      </div>
      ${penalty ? `<p class="dw-recruit-penalty">${DwUtility.escape(game.i18n.format('DW.Recruit.PenaltyNote', { penalty }))}</p>` : ''}
      <p class="dw-recruit-total"></p>`;

    // The total so far, as terms are ticked.
    const render = (event, dialog) => {
      const total = dialog.element.querySelector('.dw-recruit-total');
      const update = () => {
        const bonus = [...dialog.element.querySelectorAll('.dw-recruit-terms input:checked')].length - penalty;
        total.textContent = game.i18n.format('DW.Recruit.Total', { bonus: DwUtility.signed(bonus) });
      };
      dialog.element.querySelectorAll('.dw-recruit-terms input').forEach(i => i.addEventListener('change', update));
      update();
    };

    const result = await DwUtility.ask({
      classes: ['dw-recruit-dialog'],
      window: { title: move.name, icon: 'fa-solid fa-bullhorn' },
      position: { width: 440 },
      content,
      render,
      ok: { label: 'DW.Recruit.Roll', icon: 'fa-solid fa-dice',
        callback: (event, button) => {
          const form = button.form;
          return {
            terms: DwRecruit.TERMS.filter(t => form.elements[t]?.checked),
            found: form.elements.found?.value ?? '',
          };
        } },
    });
    if (!result) return;

    // The terms offered go on the card, and set up the hireling made from it.
    const offered = result.terms.map(t => game.i18n.localize(`DW.Recruit.Short.${t}`));
    if (penalty) offered.push(game.i18n.format('DW.Recruit.PenaltyShort', { penalty }));
    const outcome = await DwRolls.rollMove({
      actor,
      data: move,
      modifier: result.terms.length - penalty,
      templateData: {
        flavor: offered.join(', '),
        recruitFound: result.found,
      },
    });
    // The roll uses up the -1 forward.
    if (outcome) await DwPenalties.clear(actor, 'recruit');
    return outcome;
  }

  /** Turn applicants away: -1 forward to the next Recruit. */
  static turnAway(actor) {
    return DwPenalties.add(actor, 'recruit');
  }
}
