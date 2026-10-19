/**
 * Changes players ask the active GM to make for them, such as a heal for
 * someone else's character or a choice on another player's chat card.
 *
 * The sender can't be verified, so each kind of request has its own handler,
 * which makes only that kind of change, worked out on the GM's side.
 */
export class DwSocket {

  static #handlers = new Map();

  /**
   * Handle a kind of request, on the active GM's client.
   *
   * @param {string} kind
   * @param {(payload: Object) => any} handler
   */
  static register(kind, handler) {
    DwSocket.#handlers.set(kind, handler);
  }

  static init() {
    game.socket.on('system.dungeonworld', (data) => {
      if (!game.users.activeGM?.isSelf) return;
      for (const [kind, payload] of Object.entries(data ?? {})) {
        DwSocket.#handlers.get(kind)?.(payload);
      }
    });
  }

  /**
   * Ask the active GM's client to make a change. With no GM online, warns
   * that one is needed instead.
   *
   * @param {string} kind  A registered kind of request.
   * @param {Object} payload
   * @return {boolean} Whether it was sent.
   */
  static askGM(kind, payload) {
    if (!game.users.activeGM) {
      ui.notifications.warn(game.i18n.localize('DW.NeedsGM'));
      return false;
    }
    game.socket.emit('system.dungeonworld', { [kind]: payload });
    return true;
  }
}
