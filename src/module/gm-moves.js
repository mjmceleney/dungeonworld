const { DialogV2 } = foundry.applications.api;

/**
 * A reminder of the GM's moves, for when a player rolls a 6-. It's only a
 * reference for the GM: nothing is posted, since the GM never speaks the
 * name of their move.
 */
export class DwGmMoves {

  /** The GM moves and dungeon moves, as numbered keys in the language file. */
  static LISTS = { gm: 12, dungeon: 7 };

  /** The open reference window, so a second click brings it forward. */
  static #dialog = null;

  static show() {
    if (!game.user.isGM) return;
    if (DwGmMoves.#dialog?.rendered) return DwGmMoves.#dialog.bringToFront();

    const escape = (value) => Handlebars.escapeExpression(String(value ?? ''));
    const list = (kind) => Array.from({ length: DwGmMoves.LISTS[kind] }, (_, i) => `DW.GmMoves.${kind}${i + 1}`)
      .filter(key => game.i18n.has(key))
      .map(key => `<li>${escape(game.i18n.localize(key))}</li>`).join('');

    const content = document.createElement('div');
    content.innerHTML = `<p class="dw-gm-moves-intro">${escape(game.i18n.localize('DW.GmMoves.Intro'))}</p>
      <h3>${escape(game.i18n.localize('DW.GmMoves.GmTitle'))}</h3>
      <ul class="dw-gm-moves-list">${list('gm')}</ul>
      <h3>${escape(game.i18n.localize('DW.GmMoves.DungeonTitle'))}</h3>
      <ul class="dw-gm-moves-list">${list('dungeon')}</ul>
      <p class="dw-gm-moves-hint">${escape(game.i18n.localize('DW.GmMoves.Hint'))}</p>`;

    DwGmMoves.#dialog = new DialogV2({
      classes: ['dw-gm-moves-dialog'],
      window: { title: game.i18n.localize('DW.GmMoves.Title'), icon: 'fa-solid fa-skull' },
      position: { width: 400 },
      content,
      buttons: [{ action: 'close', label: 'DW.GmMoves.Close', icon: 'fa-solid fa-check', default: true }],
    });
    DwGmMoves.#dialog.render({ force: true });
  }
}
