/**
 * Marks tokens that drop to 0 HP: characters are Downed, everyone else
 * (NPCs, hirelings) gets the skull. The marker shows as a large overlay on
 * the token, and goes away when the actor is healed above 0 HP.
 *
 * Only the client that made the HP change applies the marker, so it happens
 * once and with that user's permissions.
 */
export class DwZeroHp {

  /** The status shown on a character at 0 HP. */
  static DOWNED = 'downed';

  static init() {
    CONFIG.statusEffects[DwZeroHp.DOWNED] = {
      id: DwZeroHp.DOWNED,
      name: 'DW.Status.Downed',
      img: 'icons/svg/unconscious.svg',
    };

    // preUpdateActor only runs on the client making the change, so the old
    // HP noted here reaches that client's updateActor and no other.
    Hooks.on('preUpdateActor', (actor, changes, options) => {
      const hp = foundry.utils.getProperty(changes, 'system.attributes.hp.value');
      if (hp === undefined || hp === null) return;
      options.dwPreviousHp = Number(actor.system.attributes.hp?.value ?? 0);
    });

    Hooks.on('updateActor', (actor, changes, options) => {
      if (options.dwPreviousHp === undefined) return;
      if (!game.settings.get('dungeonworld', 'zeroHpMarkers')) return;
      const wasDown = options.dwPreviousHp <= 0;
      const isDown = Number(actor.system.attributes.hp?.value ?? 0) <= 0;
      if (wasDown == isDown) return;
      DwZeroHp.mark(actor, isDown);
    });
  }

  /**
   * The status an actor gets at 0 HP.
   *
   * @param {Actor} actor
   * @return {string}
   */
  static statusFor(actor) {
    return actor.type == 'character' ? DwZeroHp.DOWNED : CONFIG.specialStatusEffects.DEFEATED;
  }

  /**
   * Add or remove the actor's 0 HP marker.
   *
   * @param {Actor} actor
   * @param {boolean} active
   */
  static async mark(actor, active) {
    await actor.toggleStatusEffect(DwZeroHp.statusFor(actor), { active, overlay: true });
  }
}
