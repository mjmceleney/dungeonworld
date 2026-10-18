import { DwHirelingSheet } from "./actor/hireling-sheet.js";
import { DwResources } from "./resources.js";
import { DwSpells } from "./spells.js";
import { DwGmMoves } from "./gm-moves.js";
import { DwRecruit } from "./recruit.js";

const { renderTemplate } = foundry.applications.handlebars;

// Damage button markup, rendered once and reused for every message.
let damageButtonsHtml = null;

const getDamageButtons = function() {
  damageButtonsHtml ??= renderTemplate('systems/dungeonworld/templates/parts/chat-buttons.html', {});
  return damageButtonsHtml;
}

export const preloadDamageButtons = function() {
  return getDamageButtons();
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

function _onChatCardAction(event) {
  event.preventDefault();

  // Extract card data
  const button = event.currentTarget;
  const card = button.closest(".chat-card");
  const messageId = button.closest(".message").dataset.messageId;
  const message =  game.messages.get(messageId);
  const action = button.dataset.action;

  // Perform the action.
  if (action == 'xp') {
    // Recover the actor for the chat card
    const actor = card ? _getChatCardActor(card) : null;
    if ( !actor ) return;

    button.disabled = true;
    _chatActionMarkXp(actor, message);
  }

  // Cast a Spell's 7-9 choices, for the caster's owner.
  if (action == 'castPenalty' || action == 'forgetSpell') {
    const actor = card ? _getChatCardActor(card) : null;
    if (!actor?.isOwner) return;
    _chatActionCastChoice(actor, message, action, button.dataset.spellId);
    return;
  }

  // Recruit: turning the applicants away, for the recruiter's owner.
  if (action == 'turnAway') {
    const actor = card ? _getChatCardActor(card) : null;
    if (!actor?.isOwner) return;
    button.disabled = true;
    _chatActionTurnAway(actor, message);
    return;
  }

  // Spend a move's resource (Volley's ammo), for the character's owner.
  if (action == 'spendResource') {
    const actor = card ? _getChatCardActor(card) : null;
    if (!actor?.isOwner) return;
    button.disabled = true;
    _chatActionSpendResource(actor, message, button);
    return;
  }

  // Validate permission to proceed with the roll
  if ( !( game.user.isGM ) ) return;

  // Chat damage.
  if (action.includes('damage') || action == 'heal') _chatActionDamage(message, action);

  // On a 6-: the GM's moves, as a reminder.
  if (action == 'gmMoves') DwGmMoves.show();

  // Recruit: make a hireling who works for the recruiter.
  if (action == 'createHireling') DwHirelingSheet.createFor(card ? _getChatCardActor(card) : null, { found: button.dataset.found });
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
    const scene = game.scenes.get(sceneId);
    if (!scene) return null;
    const tokenData = scene.getEmbeddedDocument("Token", tokenId);
    if (!tokenData) return null;
    const token = new Token(tokenData);
    return token.actor;
  }

  // Case 2 - use Actor ID directory
  const actorId = card.dataset.actorId;
  return game.actors.get(actorId) || null;
}

async function _chatActionMarkXp(actor, message) {
  if (!actor.system || !actor.system.attributes.xp) return;

  let xp = actor.system.attributes.xp.value ?? 0;
  let updates = {
    'system.attributes.xp.value': Number(xp) + 1
  };

  // Update the actor.
  await actor.update(updates);

  // Update the chat message.
  let $content = $(message.content);
  let $button = $content.find('.xp-button');

  // Replace the button.
  let newButton = `<span class="xp-button button button-disabled">${game.i18n.localize("DW.XpMarked")} <i class="fas fa-check"></i></span>`;
  $button.replaceWith($(newButton));

  if (message.isAuthor || game.user.isGM) {
    await message.update({'content': $content[0].outerHTML});
  }
  else {
    game.socket.emit('system.dungeonworld', {
      message: message.id,
      content: $content[0].outerHTML
    });
  }
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
  // One choice per cast: replace both buttons with what was chosen.
  const $content = $('<div>').html(message.content);
  $content.find('.cast-choices').html(`<span class="button button-disabled">${Handlebars.escapeExpression(text)} <i class="fas fa-check"></i></span>`);
  const content = $content.html();
  if (message.isAuthor || game.user.isGM) await message.update({ content });
  else game.socket.emit('system.dungeonworld', { message: message.id, content });
}

async function _chatActionTurnAway(actor, message) {
  const penalty = await DwRecruit.turnAway(actor);
  const $content = $('<div>').html(message.content);
  $content.find('[data-action="turnAway"]').replaceWith(`<span class="button button-disabled">${game.i18n.format('DW.Recruit.TurnedAway', { penalty })} <i class="fas fa-check"></i></span>`);
  const content = $content.html();
  if (message.isAuthor || game.user.isGM) await message.update({ content });
  else game.socket.emit('system.dungeonworld', { message: message.id, content });
}

async function _chatActionSpendResource(actor, message, button) {
  const name = button.dataset.resource;
  const amount = Math.max(1, Number(button.dataset.amount) || 1);
  const { spent, items } = await DwResources.spendResource(actor, name, amount);
  if (!spent) {
    button.disabled = false;
    return ui.notifications.warn(game.i18n.format('DW.Resource.None', { name, actor: actor.name }));
  }

  // Mark the card, so it isn't spent twice.
  const $content = $('<div>').html(message.content);
  const left = DwResources.find(actor, name).reduce((sum, i) => sum + DwResources.remaining(i), 0);
  $content.find('.resource-button').replaceWith(`<span class="button button-disabled">${game.i18n.format('DW.Resource.Spent', { amount: spent, name: items.join(', '), left })} <i class="fas fa-check"></i></span>`);
  const content = $content.html();
  if (message.isAuthor || game.user.isGM) await message.update({ content });
  else game.socket.emit('system.dungeonworld', { message: message.id, content });
}

async function _chatActionDamage(message, action) {
  let actors = canvas.tokens.controlled.map(t => t.document.actor);
  if (!actors || actors.length < 1) return;

  // Wrap the content so that plain-text content (such as a bare roll total)
  // isn't treated as a jQuery selector.
  const $message = $('<div>').html(message.content);
  let $content = $message.text();
  // TODO: Localize this.
  let piercing = $content.match(/(\d+)\s*piercing|piercing\s*(\d+)/) ?? [];
  let dmgBonus = $content.match(/[+](\d+)\s*damage|damage\s*[+](\d+)/) ?? [];
  let options = {
    ignoreArmor: $content.toLowerCase().includes('ignores armor'),
    piercing: (piercing[1] ?? piercing[2]) ?? 0,
    dmgBonus: (dmgBonus[1] ?? dmgBonus[2]) ?? 0,
  };
  const rollTotal = message.rolls?.[0]?.total ?? $message.find('.dice-total').text() ?? 0;
  for (let actor of actors) {
    if (!actor || !actor.system.attributes.hp) return;

    switch (action) {
      case 'damage':
        options.op = 'full';
        await actor.applyDamage(rollTotal, options);
        break;

      case 'half-damage':
        options.op = 'half';
        await actor.applyDamage(rollTotal, options);
        break;

      case 'double-damage':
        options.op = 'double';
        await actor.applyDamage(rollTotal, options);
        break;

      case 'heal':
        options.op = 'heal';
        await actor.applyDamage(rollTotal, options);
        break;

      default:
        break;
    }
  }
}
