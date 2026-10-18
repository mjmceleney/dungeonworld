import { DwUtility } from "./utility.js";

const { DialogV2 } = foundry.applications.api;
const { FormDataExtended } = foundry.applications.ux;
const { renderTemplate } = foundry.applications.handlebars;

/**
 * Recover: resting in comfort and safety. After a day all HP comes back;
 * after three days (two under a healer's care) one debility goes. A long rest
 * can clear several, so the player picks however many apply.
 */
export class DwRecover {

  /** Whether a move is Recover. */
  static isRecover(item) {
    return item?.type == 'move' && item.name.trim().toLowerCase() == 'recover';
  }

  /**
   * Ask what the rest restored, then apply it and post it to chat.
   *
   * @param {Actor} actor
   * @param {Item|null} move
   */
  static async prompt(actor, move = null) {
    const escape = (value) => Handlebars.escapeExpression(String(value ?? ''));
    const hp = actor.system.attributes.hp;
    const debilities = Object.entries(actor.system.abilities ?? {}).filter(([, a]) => a.debility);

    const content = document.createElement('div');
    content.innerHTML = `<p>${game.i18n.localize('DW.Recover.Intro')}</p>
      <label class="checkbox dw-recover-option">
        <input type="checkbox" name="hp" ${Number(hp.value) < Number(hp.max) ? 'checked' : ''}>
        ${escape(game.i18n.format('DW.Recover.Hp', { value: hp.value, max: hp.max }))}
      </label>
      <fieldset class="dw-recover-debilities">
        <legend>${game.i18n.localize('DW.Recover.Debilities')}</legend>
        <p class="hint">${game.i18n.localize('DW.Recover.DebilityHint')}</p>
        ${debilities.length ? debilities.map(([key, ability]) => `
        <label class="checkbox dw-recover-option">
          <input type="checkbox" name="debility.${key}">
          ${escape(ability.debilityLabel || key)} (${escape(game.i18n.localize(`DW.${key.toUpperCase()}`))})
        </label>`).join('') : `<p>${game.i18n.localize('DW.Recover.NoDebilities')}</p>`}
      </fieldset>`;

    const result = await DialogV2.wait({
      classes: ['dw-recover-dialog'],
      window: { title: move?.name ?? game.i18n.localize('DW.Recover.Title'), icon: 'fa-solid fa-bed' },
      position: { width: 420 },
      content,
      buttons: [
        { action: 'apply', label: 'DW.Recover.Apply', icon: 'fa-solid fa-check', default: true,
          callback: (event, button) => foundry.utils.expandObject(new FormDataExtended(button.form).object) },
        { action: 'cancel', label: 'DW.Cancel', icon: 'fa-solid fa-xmark', callback: () => null },
      ],
      rejectClose: false,
    });
    if (!result || typeof result != 'object') return;

    const update = {};
    const lines = [];
    if (result.hp && Number(hp.value) < Number(hp.max)) {
      update['system.attributes.hp.value'] = Number(hp.max);
      lines.push(game.i18n.format('DW.Recover.HealedTo', { max: hp.max }));
    }
    const cleared = debilities.filter(([key]) => result.debility?.[key]);
    for (const [key] of cleared) update[`system.abilities.${key}.debility`] = false;
    if (cleared.length) {
      lines.push(game.i18n.format('DW.Recover.Cleared', { list: cleared.map(([key, a]) => a.debilityLabel || key).join(', ') }));
    }
    if (!lines.length) return;
    await actor.update(update);

    const chatData = {
      speaker: ChatMessage.getSpeaker({ actor }),
      content: await renderTemplate('systems/dungeonworld/templates/chat/chat-move.html', {
        actor,
        image: move?.img,
        title: move?.name ?? game.i18n.localize('DW.Recover.Title'),
        details: `<ul>${lines.map(l => `<li>${escape(l)}</li>`).join('')}</ul>`,
      }),
    };
    DwUtility.applyMessageMode(chatData);
    await ChatMessage.create(chatData);
  }
}
