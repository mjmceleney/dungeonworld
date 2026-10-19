import { DwHirelingSheet } from "./actor/hireling-sheet.js";
import { DwMoveActions } from "./move-actions.js";
import { DwSpells } from "./spells.js";
import { DwGmMoves } from "./gm-moves.js";
import { DwRecruit } from "./recruit.js";
import { DwUtility } from "./utility.js";
import { DwSocket } from "./socket.js";

const { renderTemplate } = foundry.applications.handlebars;

// Damage button markup, rendered once and reused for every message.
let damageButtonsHtml = null;

export const getDamageButtons = function() {
  damageButtonsHtml ??= renderTemplate('systems/dungeonworld/templates/parts/chat-buttons.html', {});
  return damageButtonsHtml;
}

export const appendDamageButtons = async function(message, html) {
  if (!message.rolls?.length) return;
  // Exit early if this is a rollable table.
  if (message.flags?.core?.RollTable) return;
  // Messages from older versions have the buttons saved in their content.
  if (message.flags?.dungeonworld?.damageButtons) return;
  // The buttons are GM-only.
  if (!game.user.isGM || !game.settings.get('dungeonworld', 'enableDamageButtons')) return;
  const content = html.querySelector('.message-content');
  if (!content || content.querySelector('.chat-damage-buttons')) return;
  content.insertAdjacentHTML('beforeend', await getDamageButtons());
}

export const displayChatActionButtons = function(message, html, data) {
  html = $(html);
  const chatCard = html.find(".dw.chat-card");

  // Hide damage buttons if necessary.
  if (!game.user.isGM || !game.settings.get('dungeonworld', 'enableDamageButtons')) {
    html.find('.chat-damage-buttons').hide();
  }
  if (!game.user.isGM) html.find('[data-gm-only]').hide();

  if ( chatCard.length > 0 ) {
    // If the user is the message author or the actor owner, proceed.
    let actor = game.actors.get(data.message.speaker.actor);
    // Exit early from further operations if this is a GM user.
    if ( game.user.isGM ) return;
    if ((data.author.id === game.user.id) || ( actor && actor.isOwner )) return;
    // Otherwise conceal action buttons.
    chatCard.find("button[data-action], .button-disabled").each((i, btn) => {
      btn.style.display = "none"
    });
  }
}

export const activateChatListeners = function(html) {
  html = $(html);
  html.on('click', 'button[data-action]', (event) => _onChatCardAction(event));
}

/** The damage buttons, and how each applies the roll. */
const DAMAGE_OPS = {
  'damage': 'full',
  'half-damage': 'half',
  'double-damage': 'double',
  'heal': 'heal',
};

function _onChatCardAction(event) {
  event.preventDefault();

  // Extract card data
  const button = event.currentTarget;
  const card = button.closest(".chat-card");
  const messageId = button.closest(".message").dataset.messageId;
  const message =  game.messages.get(messageId);
  const action = button.dataset.action;
  const actor = card ? _getChatCardActor(card) : null;

  // Choices on a move's card, for the character's owner.
  const ownerActions = {
    xp: () => _chatActionMarkXp(actor, message),
    // Cast a Spell's 7-9 choices.
    castPenalty: () => _chatActionCastChoice(actor, message, action, button.dataset.spellId),
    forgetSpell: () => _chatActionCastChoice(actor, message, action, button.dataset.spellId),
    // Recruit: turning the applicants away.
    turnAway: () => _chatActionTurnAway(actor, message),
    // A move's effect (a heal, Volley's ammo).
    moveAction: () => _chatActionMoveAction(actor, message, button),
  };
  if (Object.hasOwn(ownerActions, action)) {
    if (!actor?.isOwner) return;
    if (['xp', 'turnAway', 'moveAction'].includes(action)) button.disabled = true;
    ownerActions[action]();
    return;
  }

  // Validate permission to proceed with the roll
  if ( !( game.user.isGM ) ) return;

  // Chat damage.
  if (Object.hasOwn(DAMAGE_OPS, action)) _chatActionDamage(message, DAMAGE_OPS[action]);

  // On a 6-: the GM's moves, as a reminder.
  if (action == 'gmMoves') DwGmMoves.show();

  // Recruit: make a hireling who works for the recruiter.
  if (action == 'createHireling') DwHirelingSheet.createFor(actor, { found: button.dataset.found });
}

/**
 * Get the Actor which is the author of a chat card
 * @param {HTMLElement} card    The chat card being used
 * @return {Actor|null}         The Actor entity or null
 * @private
 */
function _getChatCardActor(card) {

  // Case 1 - a synthetic actor from a Token
  const tokenKey = card.dataset.tokenId;
  if (tokenKey) {
    const [sceneId, tokenId] = tokenKey.split(".");
    return game.scenes.get(sceneId)?.tokens.get(tokenId)?.actor ?? null;
  }

  // Case 2 - use Actor ID directory
  const actorId = card.dataset.actorId;
  return game.actors.get(actorId) || null;
}

/* -------------------------------------------- */
/*  Card edits                                  */
/* -------------------------------------------- */

/** A disabled button saying what was chosen. */
const doneButton = (text, classes = '') =>
  `<span class="${classes} button button-disabled">${DwUtility.escape(text)} <i class="fas fa-check"></i></span>`;

/**
 * The changes a choice makes to a card: each replaces the buttons for that
 * choice with what was chosen. Only these can be made through the GM.
 */
const CARD_EDITS = {
  xp: ($content) => $content.find('.xp-button').replaceWith(doneButton(game.i18n.localize("DW.XpMarked"), 'xp-button')),
  // One choice per cast: replace both buttons with what was chosen.
  castChoice: ($content, text) => $content.find('.cast-choices').html(doneButton(text)),
  turnAway: ($content, text) => $content.find('[data-action="turnAway"]').replaceWith(doneButton(text)),
  // One effect applied. Once as many as the move says to choose are, the
  // rest go.
  moveAction: ($content, text, index) => {
    const $button = $content.find(`.move-action-button[data-index="${String(index).replace(/[^\w-]/g, '')}"]`);
    const $row = $button.closest('.move-actions');
    $button.replaceWith(doneButton(text, 'move-action-done'));
    const choose = Number($row.attr('data-choose')) || 0;
    if (choose && $row.find('.move-action-done').length >= choose) $row.find('.move-action-button, .move-actions-choose').remove();
    return $button;
  },
};

/** A card's content with an edit made, or null if the card has nothing to edit. */
function _editedContent(message, edit, text, index) {
  const $content = $('<div>').html(message.content);
  const edited = CARD_EDITS[edit]($content, text, index);
  return edited.length ? $content.html() : null;
}

/**
 * Make an edit to a card. Only the message's author and GMs can change a
 * message, so other players ask the active GM to.
 */
async function _editCard(message, edit, text = '', index = '') {
  if (message.isAuthor || game.user.isGM) {
    const content = _editedContent(message, edit, text, index);
    if (content !== null) await message.update({ content });
    return;
  }
  DwSocket.askGM('cardEdit', { message: message.id, edit, text, index });
}

/** A player's edit to a card, on the active GM's client. */
export async function applyRemoteCardEdit(data) {
  const message = game.messages.get(data?.message);
  if (!message || !Object.hasOwn(CARD_EDITS, data.edit)) return;
  const content = _editedContent(message, data.edit, String(data.text ?? ''), String(data.index ?? ''));
  if (content !== null) await message.update({ content });
}

/* -------------------------------------------- */
/*  Actions                                     */
/* -------------------------------------------- */

async function _chatActionMarkXp(actor, message) {
  if (!actor.system?.attributes?.xp) return;
  await actor.update({ 'system.attributes.xp.value': (Number(actor.system.attributes.xp.value) || 0) + 1 });
  await _editCard(message, 'xp');
}

async function _chatActionCastChoice(actor, message, action, spellId) {
  let text;
  if (action == 'castPenalty') {
    const penalty = await DwSpells.addPenalty(actor);
    text = game.i18n.format('DW.Spellcasting.PenaltyTaken', { penalty });
  }
  else {
    const spell = await DwSpells.forget(actor, spellId);
    if (!spell) return;
    text = game.i18n.format('DW.Spellcasting.Lost', { spell: spell.name });
  }
  await _editCard(message, 'castChoice', text);
}

async function _chatActionTurnAway(actor, message) {
  const penalty = await DwRecruit.turnAway(actor);
  await _editCard(message, 'turnAway', game.i18n.format('DW.Recruit.TurnedAway', { penalty }));
}

async function _chatActionMoveAction(actor, message, button) {
  const text = await DwMoveActions.apply(actor, button.dataset);
  // Nothing done (cancelled): it can be tried again.
  if (!text) {
    button.disabled = false;
    return;
  }
  await _editCard(message, 'moveAction', text, button.dataset.index);
}

async function _chatActionDamage(message, op) {
  const actors = canvas.tokens.controlled.map(t => t.document.actor);
  if (!actors.length) return;

  // Wrap the content so that plain-text content (such as a bare roll total)
  // isn't treated as a jQuery selector.
  const $message = $('<div>').html(message.content);
  // TODO: Localize this.
  const options = { op, ...DwUtility.damageTags($message.text()) };
  const rollTotal = message.rolls?.[0]?.total ?? $message.find('.dice-total').text() ?? 0;
  for (const actor of actors) {
    // Skip tokens without HP, such as objects, and carry on with the rest.
    if (!actor?.system.attributes?.hp) continue;
    await actor.applyDamage(rollTotal, options);
  }
}
