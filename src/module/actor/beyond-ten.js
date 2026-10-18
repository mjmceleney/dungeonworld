import { DwClassList } from "../config.js";
import { DwUtility } from "../utility.js";
import { DwLevelUp, MAX_CLASS_LEVEL } from "./level-up.js";
import { DwStartOver } from "./start-over.js";
import { DwCharacterCreator } from "./character-creator.js";

const { DialogV2 } = foundry.applications.api;
const { renderTemplate } = foundry.applications.handlebars;

/**
 * Beyond level 10. When a character with a class at level 10 has the XP for
 * another level, they choose (per the rules) to:
 *
 * - Retire to safety: they get a Retired to Safety move, and the player makes
 *   a new character to play instead.
 * - Take on an apprentice: a new character, the apprentice, is made for the
 *   same player to play alongside; the mentor stops gaining XP.
 * - Change entirely to a new class: Start over, keeping ability scores, race,
 *   HP and the moves core to who they are, then choose the new class.
 *
 * With multiclassing allowed they can instead level up in another class (one
 * not yet at level 10, or a new one).
 */
export class DwBeyondTen {

  static init() {
    // A mentor stops gaining XP.
    Hooks.on('preUpdateActor', (actor, changes) => {
      if (!actor.flags?.dungeonworld?.mentor) return;
      const xp = foundry.utils.getProperty(changes, 'system.attributes.xp.value');
      if (xp === undefined || Number(xp) <= Number(actor.system.attributes.xp.value)) return;
      foundry.utils.setProperty(changes, 'system.attributes.xp.value', actor.system.attributes.xp.value);
      ui.notifications.info(game.i18n.format('DW.Beyond.MentorNoXp', { name: actor.name }));
    });

    // A new character made for a player opens for them.
    Hooks.on('createActor', (actor) => {
      if (actor.flags?.dungeonworld?.createdFor == game.user.id) actor.sheet.render(true);
    });
  }

  /**
   * Whether the character is past what a level up can give: without
   * multiclassing, level 10; with it, a class at level 10 (they may still
   * level up in another class).
   *
   * @param {Actor} actor
   * @return {boolean}
   */
  static capped(actor) {
    const level = Number(actor.system.attributes.level?.value) || 1;
    if (!game.settings.get('dungeonworld', 'allowMulticlass')) return level >= MAX_CLASS_LEVEL;
    return DwUtility.classLevels(actor).some(c => c.level >= MAX_CLASS_LEVEL);
  }

  /** Whether another class (one they have, or a new one) can take a level. */
  static async #canAdvance(actor) {
    if (!game.settings.get('dungeonworld', 'allowMulticlass')) return false;
    const levels = DwUtility.classLevels(actor);
    if (levels.some(c => c.name && c.level < MAX_CLASS_LEVEL)) return true;
    const classes = await DwClassList.getClasses(false);
    return classes.some(c => !c.system.secret && !levels.some(l => DwUtility.sameClass(l.name, c.name)));
  }

  /**
   * Choose what happens beyond level 10.
   *
   * @param {Actor} actor
   */
  static async show(actor) {
    const escape = (value) => Handlebars.escapeExpression(String(value ?? ''));
    const choices = [];
    if (await DwBeyondTen.#canAdvance(actor)) choices.push('advance');
    choices.push('retire', 'apprentice', 'reclass');

    const content = document.createElement('div');
    content.innerHTML = `<p>${escape(game.i18n.format('DW.Beyond.Intro', { name: actor.name }))}</p>
      <div class="dw-beyond-choices">${choices.map(choice => `
        <button type="button" class="dw-beyond-choice" data-action="${choice}">
          <strong>${escape(game.i18n.localize(`DW.Beyond.${choice}`))}</strong>
          <span>${escape(game.i18n.localize(`DW.Beyond.${choice}Hint`))}</span>
        </button>`).join('')}</div>`;

    // The choices are the buttons; the footer's copies are hidden.
    const choice = await DialogV2.wait({
      classes: ['dw-beyond-dialog'],
      window: { title: game.i18n.localize('DW.Beyond.Title'), icon: 'fa-solid fa-crown' },
      position: { width: 480 },
      content,
      buttons: choices.map(c => ({ action: c, label: `DW.Beyond.${c}`, callback: () => c })),
      rejectClose: false,
    });

    switch (choice) {
      case 'advance': return new DwLevelUp(actor)._onLevelUp({ preventDefault() {}, currentTarget: null });
      case 'retire': return DwBeyondTen.retire(actor);
      case 'apprentice': return DwBeyondTen.apprentice(actor);
      case 'reclass': return DwBeyondTen.reclass(actor);
    }
  }

  /** The XP left over once this level's worth is spent. */
  static #spendXp(actor) {
    const xp = Number(actor.system.attributes.xp.value) || 0;
    const max = Number(actor.system.attributes.xp.max) || 0;
    return Math.max(0, xp - max);
  }

  /**
   * Retire to safety: add the Retired to Safety move, and offer to make the
   * player's new character.
   */
  static async retire(actor) {
    const confirm = await DialogV2.wait({
      window: { title: game.i18n.localize('DW.Beyond.retire'), icon: 'fa-solid fa-house-chimney' },
      position: { width: 420 },
      content: `<p>${Handlebars.escapeExpression(game.i18n.format('DW.Beyond.RetireConfirm', { name: actor.name }))}</p>
        <label class="checkbox"><input type="checkbox" name="newCharacter" checked> ${Handlebars.escapeExpression(game.i18n.localize('DW.Beyond.MakeNew'))}</label>`,
      buttons: [
        { action: 'retire', label: 'DW.Beyond.retire', icon: 'fa-solid fa-check', default: true,
          callback: (event, button) => ({ newCharacter: button.form.elements.newCharacter.checked }) },
        { action: 'cancel', label: 'DW.Cancel', icon: 'fa-solid fa-xmark', callback: () => null },
      ],
      rejectClose: false,
    });
    if (!confirm) return;

    if (!actor.items.some(i => i.type == 'move' && i.flags?.dungeonworld?.retired)) {
      await actor.createEmbeddedDocuments('Item', [{
        name: game.i18n.localize('DW.Beyond.RetiredMove'),
        type: 'move',
        img: 'icons/environment/settlement/house-cottage.webp',
        flags: { dungeonworld: { retired: true } },
        system: { moveType: 'special', rollType: '', description: game.i18n.localize('DW.Beyond.RetiredMoveText') },
      }]);
    }
    await actor.update({
      'system.attributes.xp.value': DwBeyondTen.#spendXp(actor),
      'flags.dungeonworld.retired': true,
    });
    await DwBeyondTen.#post(actor, 'DW.Beyond.retire', game.i18n.format('DW.Beyond.RetiredPost', { name: actor.name }));
    if (confirm.newCharacter) await DwBeyondTen.createCharacter(actor, game.i18n.localize('DW.Beyond.NewCharacterName'));
  }

  /**
   * Take on an apprentice: a new character for the same player, played
   * alongside; the mentor stops gaining XP.
   */
  static async apprentice(actor) {
    const yes = await DialogV2.confirm({
      window: { title: game.i18n.localize('DW.Beyond.apprentice'), icon: 'fa-solid fa-user-graduate' },
      content: `<p>${Handlebars.escapeExpression(game.i18n.format('DW.Beyond.ApprenticeConfirm', { name: actor.name }))}</p>`,
      rejectClose: false,
    });
    if (!yes) return;
    await actor.update({
      'system.attributes.xp.value': DwBeyondTen.#spendXp(actor),
      'flags.dungeonworld.mentor': true,
    });
    await DwBeyondTen.#post(actor, 'DW.Beyond.apprentice', game.i18n.format('DW.Beyond.ApprenticePost', { name: actor.name }));
    await DwBeyondTen.createCharacter(actor, game.i18n.format('DW.Beyond.ApprenticeName', { name: actor.name }), { apprenticeOf: actor.id });
  }

  /**
   * Change entirely to a new class: Start over (keeping what the rules
   * keep), then choose the new class in the character creator.
   */
  static async reclass(actor) {
    if (!await DwStartOver.run(actor, { reclass: true })) return;
    await DwBeyondTen.#post(actor, 'DW.Beyond.reclass', game.i18n.format('DW.Beyond.ReclassPost', { name: actor.name }));
    new DwCharacterCreator(actor).render(true);
  }

  /**
   * Make a new character for the player(s) of an existing one. A player
   * who can't create actors has the GM make it.
   *
   * @param {Actor} source The character whose players get the new one.
   * @param {string} name
   * @param {{apprenticeOf?: string}} [options]
   */
  static async createCharacter(source, name, { apprenticeOf = null } = {}) {
    const players = game.users.filter(u => !u.isGM && source.testUserPermission(u, 'OWNER'));
    const ownership = { default: 0 };
    for (const user of players) ownership[user.id] = CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER;
    const data = {
      name,
      type: 'character',
      img: source.img,
      folder: source.folder?.id ?? null,
      ownership,
      flags: { dungeonworld: { createdFor: game.user.isGM ? (players[0]?.id ?? game.user.id) : game.user.id, apprenticeOf } },
    };
    if (Actor.implementation.canUserCreate(game.user)) return Actor.implementation.create(data);
    if (!game.users.activeGM) return ui.notifications.warn(game.i18n.localize('DW.Party.NeedsGM'));
    game.socket.emit('system.dungeonworld', { createCharacter: data });
  }

  /** Make a character a player asked for, on the active GM's client. */
  static async createRemote(data) {
    if (!game.users.activeGM?.isSelf || data?.type != 'character') return;
    await Actor.implementation.create(data);
  }

  static async #post(actor, titleKey, text) {
    const chatData = {
      speaker: ChatMessage.getSpeaker({ actor }),
      content: await renderTemplate('systems/dungeonworld/templates/chat/chat-move.html', {
        actor,
        title: game.i18n.localize(titleKey),
        details: `<p>${Handlebars.escapeExpression(text)}</p>`,
      }),
    };
    DwUtility.applyMessageMode(chatData);
    await ChatMessage.create(chatData);
  }
}
