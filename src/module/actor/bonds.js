import { DwUtility } from "../utility.js";

const { DialogV2 } = foundry.applications.api;

/** A blank in a bond's text, such as "_______________". */
const BLANK = /_{3,}/g;

/**
 * Bonds: choosing a new character's bonds, and filling in the blanks in
 * bonds ("_____ owes me their life") with the other characters, linked so
 * the names stay clickable, or with any name typed in.
 */
export class DwBonds {

  /** Whether a bond still has a blank to fill. */
  static hasBlank(bond) {
    return new RegExp(BLANK.source).test(bond?.name ?? '');
  }

  /**
   * A class's bonds, as written in the language files ("DW.the-fighter.Bond1"
   * and so on).
   *
   * @param {string} className
   * @return {string[]}
   */
  static classBonds(className) {
    const slug = DwUtility.cleanClass(String(className ?? '').trim());
    const bonds = [];
    for (let i = 1; i < 10; i++) {
      const key = `DW.${slug}.Bond${i}`;
      if (!game.i18n.has(key)) continue;
      // Some are written with a stray comma at the end.
      bonds.push(game.i18n.localize(key).trim().replace(/,$/, ''));
    }
    return bonds;
  }

  /**
   * The characters a bond can name: other player characters first, then any
   * other character.
   *
   * @param {Actor} actor
   * @return {Actor[]}
   */
  static #candidates(actor) {
    const isPlayers = (a) => game.users.some(u => !u.isGM && a.testUserPermission(u, 'OWNER'));
    return game.actors
      .filter(a => a.type == 'character' && a.id != actor.id)
      .sort((a, b) => (isPlayers(b) - isPlayers(a)) || a.name.localeCompare(b.name));
  }

  /** The markup for one blank: a character to choose, or a name to type. */
  static #blankHtml(characterOptions) {
    const escape = (value) => Handlebars.escapeExpression(String(value ?? ''));
    return `<span class="dw-bond-blank">
        <select data-blank-actor aria-label="${escape(game.i18n.localize('DW.BondFill.Character'))}">${characterOptions}</select>
        <input type="text" data-blank-text placeholder="${escape(game.i18n.localize('DW.BondFill.OrName'))}">
      </span>`;
  }

  /** A bond's text with each blank filled from its controls in an element. */
  static #fillFrom(text, element) {
    const blanks = [...element.querySelectorAll('.dw-bond-blank')];
    let n = 0;
    return text.replace(BLANK, (blank) => {
      const controls = blanks[n++];
      const picked = game.actors.get(controls?.querySelector('[data-blank-actor]')?.value);
      const typed = String(controls?.querySelector('[data-blank-text]')?.value ?? '').trim();
      if (picked) return `@UUID[${picked.uuid}]{${picked.name}}`;
      return typed || blank;
    });
  }

  /**
   * Choose a new character's bonds. Each bond added is one of the class's
   * (with its blanks filled in) or a blank one to write; add as many as you
   * like.
   *
   * @param {Actor} actor
   * @param {string[]} templates The class's bonds.
   * @return {Promise<number>} How many bonds were added.
   */
  static async choose(actor, templates = []) {
    const escape = (value) => Handlebars.escapeExpression(String(value ?? ''));
    const characterOptions = '<option value=""></option>'
      + DwBonds.#candidates(actor).map(a => `<option value="${a.id}">${escape(a.name)}</option>`).join('');
    const sourceOptions = `<option value="">${escape(game.i18n.localize('DW.BondChoose.Pick'))}</option>`
      + templates.map((text, i) => `<option value="${i}">${escape(text)}</option>`).join('')
      + `<option value="own">${escape(game.i18n.localize('DW.BondChoose.Own'))}</option>`;

    const content = document.createElement('div');
    content.innerHTML = `<p>${game.i18n.localize(templates.length ? 'DW.BondChoose.Intro' : 'DW.BondChoose.IntroNoClass')}</p>
      <ol class="dw-bond-rows"></ol>
      <button type="button" class="dw-bond-add"><i class="fa-solid fa-plus" inert></i> ${escape(game.i18n.localize('DW.BondChoose.Add'))}</button>`;

    // A row: which bond, then that bond's text to fill in or write.
    const addRow = (list) => {
      const row = document.createElement('li');
      row.className = 'dw-bond-row';
      row.innerHTML = `<div class="dw-bond-row-head">
          <select class="dw-bond-source" aria-label="${escape(game.i18n.localize('DW.BondChoose.Which'))}">${sourceOptions}</select>
          <button type="button" class="dw-bond-remove" data-tooltip="${escape(game.i18n.localize('DW.BondChoose.Remove'))}" aria-label="${escape(game.i18n.localize('DW.BondChoose.Remove'))}"><i class="fa-solid fa-trash" inert></i></button>
        </div>
        <div class="dw-bond-body"></div>`;
      const source = row.querySelector('.dw-bond-source');
      const body = row.querySelector('.dw-bond-body');
      source.addEventListener('change', () => {
        if (source.value == 'own') {
          body.innerHTML = `<input type="text" class="dw-bond-own-text" placeholder="${escape(game.i18n.localize('DW.BondFill.OwnPlaceholder'))}">`;
          body.querySelector('input').focus();
        }
        else if (source.value !== '') {
          const parts = escape(templates[Number(source.value)]).split(BLANK);
          body.innerHTML = `<p class="dw-bond-fill">${parts.map((text, i) => i == 0 ? text : DwBonds.#blankHtml(characterOptions) + text).join('')}</p>`;
        }
        else body.innerHTML = '';
      });
      row.querySelector('.dw-bond-remove').addEventListener('click', () => row.remove());
      list.append(row);
      source.focus();
    };

    const result = await DialogV2.wait({
      classes: ['dw-bond-fill-dialog', 'dw-bond-choose-dialog'],
      window: { title: game.i18n.localize('DW.BondChoose.Title'), icon: 'fa-solid fa-link' },
      position: { width: 620 },
      content,
      render: (event, dialog) => {
        const list = dialog.element.querySelector('.dw-bond-rows');
        dialog.element.querySelector('.dw-bond-add').addEventListener('click', () => addRow(list));
        addRow(list);
      },
      buttons: [
        { action: 'save', label: 'DW.BondChoose.Save', icon: 'fa-solid fa-check', default: true,
          callback: (event, button) => [...button.form.querySelectorAll('.dw-bond-row')].map(row => {
            const source = row.querySelector('.dw-bond-source').value;
            if (source == 'own') return String(row.querySelector('.dw-bond-own-text')?.value ?? '').trim();
            if (source === '') return '';
            return DwBonds.#fillFrom(templates[Number(source)], row);
          }).filter(Boolean) },
        { action: 'skip', label: 'DW.BondChoose.Skip', icon: 'fa-solid fa-xmark', callback: () => [] },
      ],
      rejectClose: false,
    });
    if (!Array.isArray(result) || !result.length) return 0;
    await actor.createEmbeddedDocuments('Item', result.map(name => ({ name, type: 'bond' })));
    return result.length;
  }

  /**
   * Ask who goes in each blank of the character's bonds, then write the
   * names in.
   *
   * @param {Actor} actor
   * @return {Promise<boolean>} Whether any bond changed.
   */
  static async fill(actor) {
    const bonds = actor.items.filter(i => i.type == 'bond' && DwBonds.hasBlank(i));
    if (!bonds.length) {
      ui.notifications.info(game.i18n.localize('DW.BondFill.None'));
      return false;
    }
    const escape = (value) => Handlebars.escapeExpression(String(value ?? ''));
    const characterOptions = '<option value=""></option>'
      + DwBonds.#candidates(actor).map(a => `<option value="${a.id}">${escape(a.name)}</option>`).join('');

    const content = document.createElement('div');
    content.innerHTML = `<p>${game.i18n.localize('DW.BondFill.Intro')}</p>`
      + bonds.map(bond => {
        const parts = escape(bond.name).split(BLANK);
        const html = parts.map((text, i) => i == 0 ? text : DwBonds.#blankHtml(characterOptions) + text).join('');
        return `<p class="dw-bond-fill" data-bond-id="${bond.id}">${html}</p>`;
      }).join('');

    const result = await DialogV2.wait({
      classes: ['dw-bond-fill-dialog'],
      window: { title: game.i18n.localize('DW.BondFill.Title'), icon: 'fa-solid fa-link' },
      position: { width: 560 },
      content,
      buttons: [
        { action: 'save', label: 'DW.Sheet.Save', icon: 'fa-solid fa-check', default: true,
          callback: (event, button) => bonds.map(bond => {
            const element = button.form.querySelector(`[data-bond-id="${bond.id}"]`);
            return { _id: bond.id, name: DwBonds.#fillFrom(bond.name, element) };
          }).filter((update, i) => update.name != bonds[i].name) },
        { action: 'cancel', label: 'DW.Cancel', icon: 'fa-solid fa-xmark', callback: () => null },
      ],
      rejectClose: false,
    });
    if (!Array.isArray(result) || !result.length) return false;
    await actor.updateEmbeddedDocuments('Item', result);
    return true;
  }
}
