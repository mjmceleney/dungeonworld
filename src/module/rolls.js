import { DwUtility } from "./utility.js";
import { DwMoveActions } from "./move-actions.js";
import { DwSpells } from "./spells.js";
import { DwRecruit } from "./recruit.js";
import { DwSocket } from "./socket.js";
const { renderTemplate } = foundry.applications.handlebars;
const { DialogV2 } = foundry.applications.api;

/** The dice of a move. */
const DICE = '2d6';

/** The chat card for moves and rolls. */
const TEMPLATE = 'systems/dungeonworld/templates/chat/chat-move.html';

/**
 * Rolling moves, stats and formulas to chat.
 *
 * Each roll passes its actor and item along explicitly, since several rolls
 * can be under way at once (each waiting on a dialog or the dice).
 */
export class DwRolls {

  /**
   * Check whether a formula can be evaluated, without rolling any dice or
   * prompting for manual dice entry. Unresolved strings (such as `str` or
   * `bond`) are invalid.
   */
  static isValidFormula(formula, rollData) {
    try {
      new Roll(formula, rollData).evaluateSync({ strict: false });
      return true;
    }
    catch (error) {
      return false;
    }
  }

  /** A formula with a modifier added: "2d6" and -1 gives "2d6-1". */
  static addTerm(formula, modifier) {
    const n = Number(modifier) || 0;
    if (!n) return formula;
    return `${formula}${n < 0 ? n : '+' + n}`;
  }

  /** Forward and ongoing, as terms to add to a roll. */
  static getModifiers(actor) {
    const forward = Number(actor.system.attributes?.forward?.value) || 0;
    const ongoing = Number(actor.system.attributes?.ongoing?.value) || 0;
    return DwRolls.addTerm(DwRolls.addTerm('', forward), ongoing);
  }

  /**
   * The result ("failure", "partial" or "success") a total falls in, per
   * CONFIG.DW.rollResults.
   * @param {number} total
   * @return {string|null}
   */
  static resultFor(total) {
    for (const [key, { start, end }] of Object.entries(CONFIG.DW.rollResults)) {
      if ((start == null || total >= start) && (end == null || total <= end)) return key;
    }
    return null;
  }

  /**
   * What a move's text says about each stat, from list items such as "by
   * powering through, +Str" (Defy Danger). Keyed by ability, e.g. {str: "by
   * powering through"}.
   *
   * @param {Item} item
   * @return {Object<string, string>}
   */
  static statHints(item) {
    const hints = {};
    const html = `${item?.system?.description ?? ''}${item?.system?.choices ?? ''}`;
    if (!html.includes('<li')) return hints;
    const doc = new DOMParser().parseFromString(html, 'text/html');
    for (const li of doc.querySelectorAll('li')) {
      const text = li.textContent.replace(/\s+/g, ' ').trim();
      const match = text.match(/^(.*?)[\s,;:–—-]*\+\s*(str|dex|con|int|wis|cha)\b[.!]?$/i);
      if (!match) continue;
      const hint = match[1].replace(/^(\.\.\.|…)\s*/, '').trim();
      hints[match[2].toLowerCase()] ??= hint;
    }
    return hints;
  }

  /**
   * Ask which stat to roll for a move whose stat depends on how the
   * character acts. Each stat shows its modifier and, when the move's text
   * says, what it's for.
   *
   * @param {Actor} actor
   * @param {Item} item
   * @return {Promise<string|null>} The ability key, or null if dismissed.
   */
  static async askStat(actor, item) {
    const hints = DwRolls.statHints(item);
    const stats = Object.entries(actor.system.abilities ?? {});

    const content = document.createElement('div');
    content.innerHTML = `<p>${game.i18n.format('DW.Dialog.askContent', { name: DwUtility.escape(item.name) })}</p>`
      + '<div class="dw-ask-stats">'
      + stats.map(([key, ability]) => {
        const mod = Number(ability.mod) || 0;
        const debility = ability.debility ? `<span class="dw-ask-debility">${DwUtility.escape(ability.debilityLabel)}</span>` : '';
        return `<button type="button" class="dw-ask-stat" data-action="${key}">
          <span class="dw-ask-abbr">${DwUtility.escape(game.i18n.localize(`DW.${key.toUpperCase()}`))}</span>
          <span class="dw-ask-mod">${DwUtility.signed(mod)}</span>
          <span class="dw-ask-hint">${DwUtility.escape(hints[key] ?? '')}${debility}</span>
        </button>`;
      }).join('')
      + '</div>';

    const classes = ['dw-ask-dialog'];
    if (DwUtility.nightmode) classes.push('nightmode');
    // The stats are the buttons; the footer's copies are hidden.
    return DialogV2.wait({
      classes,
      window: { title: game.i18n.localize('DW.Dialog.askTitle') },
      position: { width: 400 },
      content,
      buttons: stats.map(([key]) => ({ action: key, label: `DW.${key.toUpperCase()}`, callback: () => key })),
      rejectClose: false,
    });
  }

  /**
   * Ask for the modifier of a move that rolls +bond (or another modifier the
   * player knows).
   *
   * @param {Item} item
   * @return {Promise<number|null>} The modifier, or null if dismissed.
   */
  static async askModifier(item) {
    const classes = ['dungeonworld', 'dw-dialog'];
    if (DwUtility.nightmode) classes.push('nightmode');
    const content = await renderTemplate('systems/dungeonworld/templates/chat/roll-dialog.html', {
      title: game.i18n.format('DW.Dialog.bondContent', { name: DwUtility.escape(item.name) }),
      bond: null,
    });
    return DialogV2.wait({
      classes,
      window: { title: game.i18n.localize('DW.Dialog.bondTitle') },
      content,
      buttons: [{
        action: 'roll',
        label: 'DW.Roll',
        icon: 'fa-solid fa-dice',
        default: true,
        callback: (event, button) => Number(button.form.elements.bond?.value) || 0,
      }],
      rejectClose: false,
    });
  }

  /**
   * The roll penalties a character's gear gives: −1 per clumsy item they're
   * using, and −1 when carrying load+1 or load+2. Past load+2 they must drop
   * something and roll at −1, or miss; they're asked which.
   *
   * @param {Actor} actor
   * @return {Promise<{formula: string, fail: boolean}|null>} Terms to add to
   *   the roll, or fail for an automatic miss; null if they backed out.
   */
  static async gearPenalties(actor) {
    const result = { formula: '', fail: false };
    if (actor.type != 'character' || !game.settings.get('dungeonworld', 'automateGear')) return result;
    const attributes = actor.system.attributes;

    const clumsy = Number(attributes.ac?.clumsy) || 0;
    if (clumsy > 0) result.formula += `-${clumsy}[${game.i18n.localize('DW.Gear.Clumsy')}]`;

    const tier = attributes.weight?.tier;
    if (tier == 'heavy') {
      result.formula += `-1[${game.i18n.localize('DW.Gear.Load')}]`;
    }
    else if (tier == 'over') {
      const choice = await DialogV2.wait({
        window: { title: game.i18n.localize('DW.Gear.OverloadTitle') },
        position: { width: 420 },
        content: `<p>${game.i18n.format('DW.Gear.OverloadText', {
          weight: attributes.weight.value,
          load: attributes.weight.max,
        })}</p>`,
        buttons: [
          { action: 'drop', label: 'DW.Gear.OverloadDrop', icon: 'fa-solid fa-hand-holding', default: true },
          { action: 'fail', label: 'DW.Gear.OverloadFail', icon: 'fa-solid fa-xmark' },
        ],
        rejectClose: false,
      });
      if (!choice) return null;
      if (choice == 'fail') result.fail = true;
      else result.formula += `-1[${game.i18n.localize('DW.Gear.Load')}]`;
    }
    return result;
  }

  /**
   * Roll a move, spell, piece of equipment, stat or formula to chat.
   *
   * @param {Object} options
   * @param {Actor} options.actor
   * @param {Item|null} [options.data] The item to roll.
   * @param {string} [options.formula] Without an item: a formula, a stat
   *   ("str"), or "plain" for 2d6 with nothing added.
   * @param {Object} [options.templateData] Extra data for the chat card.
   * @param {Item} [options.spell] Cast a Spell: the spell being cast.
   * @param {number} [options.modifier] A +bond move's modifier, already
   *   worked out, so the player isn't asked.
   * @return {Promise<{roll: Roll|null, result: string|null}|null|undefined|false>}
   */
  static async rollMove(options = {}) {
    // TODO: Create a way to resolve this using the formula only, sans actor.
    const actor = options.actor;
    if (!actor) return false;

    // If there's no formula or item, we need to exit.
    if (!options.formula && !options.data) return false;

    const item = options.data ?? null;
    const context = { actor, item };

    // Prepare template data for the roll.
    let templateData = options.templateData ? foundry.utils.duplicate(options.templateData) : {};
    const data = {};

    // Formula-only rolls.
    if (!item) return DwRolls.rollMoveExecute(context, options.formula ?? null, data, templateData);

    // Moves.
    if (item.type == 'move' || item.type == 'npcMove') {
      // Anything the caller added (Recruit's terms) stays on the card.
      templateData = {
        ...templateData,
        image: item.img,
        title: item.name,
        trigger: null,
        details: item.system.description,
        moveResults: item.system.moveResults,
        choices: item.system.choices
      };
      // Cast a Spell for a particular spell: show the spell, so a 7-9 can
      // lose it.
      if (options.spell) {
        templateData.title = `${item.name}: ${options.spell.name}`;
        templateData.details = options.spell.system.description || templateData.details;
        templateData.castSpell = options.spell.id;
      }
      // Effects for an ally or anyone (a heal) are for whoever the player picks
      // now, before the roll.
      const target = await DwMoveActions.chooseTarget(actor, [item, options.spell].filter(Boolean));
      if (target === null) return null;
      if (target) templateData.actionTarget = target.uuid;

      if (item.type == 'npcMove' || item.system?.rollType == 'FORMULA') {
        data.roll = item.system.rollFormula;
        data.rollType = item.system.rollType ? item.system.rollType.toLowerCase() : 'npc';
      }
      else {
        data.roll = (item.system.rollType ?? '').toLowerCase();
        data.rollType = data.roll;
      }
      data.mod = item.type == 'move' ? item.system.rollMod : 0;

      // An ASK roll asks which stat to roll first.
      if (data.roll == 'ask') {
        const stat = await DwRolls.askStat(actor, item);
        if (!stat) return;
        return DwRolls.rollMoveExecute(context, stat, data, templateData);
      }
      // A +bond roll asks for the modifier, unless it's already been worked
      // out (Recruit's terms).
      if (data.roll == 'bond') {
        const bond = options.modifier !== undefined ? Number(options.modifier) || 0 : await DwRolls.askModifier(item);
        if (bond === null) return null;
        return DwRolls.rollMoveExecute(context, 'bond', data, templateData, bond);
      }
      return DwRolls.rollMoveExecute(context, data.roll, data, templateData);
    }

    // Spells and equipment roll their own formula.
    if (item.type == 'spell' || item.type == 'equipment') {
      templateData = {
        image: item.img,
        title: item.name,
        trigger: null,
        details: item.system.description,
      };
      data.roll = item.system.rollFormula;
      return DwRolls.rollMoveExecute(context, data.roll, data, templateData);
    }
  }

  /**
   * Post a move's 6- result without rolling, for a character who chose to
   * fail rather than drop weight. It isn't a roll, so no XP is offered.
   */
  static async #postAutomaticMiss(actor, templateData, chatData) {
    const failure = CONFIG.DW.rollResults.failure;
    Object.assign(templateData, {
      actor,
      result: 'failure',
      resultLabel: failure?.label ?? 'failure',
      resultDetails: templateData.moveResults?.failure?.value || null,
      flavor: game.i18n.localize('DW.Gear.AutomaticMiss'),
      xp: false,
      gmMoves: true,
    });
    chatData.content = await renderTemplate(TEMPLATE, templateData);
    return ChatMessage.create(chatData);
  }

  /** Render a roll's card and post it, after the 3D dice if they're used. */
  static async #postRoll(roll, templateData, chatData) {
    templateData.rollDw = await roll.render();
    templateData.roll = roll;
    chatData.content = await renderTemplate(TEMPLATE, templateData);
    if (game.dice3d) await game.dice3d.showForRoll(roll, game.user, true, chatData.whisper, chatData.blind);
    else chatData.sound = CONFIG.sounds.dice;
    return ChatMessage.create(chatData);
  }

  /** The tags shown on a roll's card, with the character's damage tags. */
  static #cardTags(actor, item, templateData) {
    const tags = DwUtility.parseTags(item?.system?.tags ?? actor.system?.tags);
    const has = (text) => tags.some(tag => tag.toLowerCase().includes(text));
    // Add piercing and armor tags.
    if (item?.system?.itemType == 'weapon' || templateData?.rollType == 'damage') {
      const damage = actor.system.attributes?.damage ?? {};
      const piercing = damage.piercing ?? 0;
      const dmgBonus = damage.dmgBonus ?? 0;
      if (piercing > 0 && !has('piercing')) tags.push(`${piercing} piercing`);
      if (damage.ignoreArmor && !has('ignores armor')) tags.push('ignores armor');
      if (dmgBonus > 0 && !has('damage')) tags.push(`+${dmgBonus} damage`);
      if (actor.type == 'npc' && templateData?.flavor) tags.push(templateData.flavor);
    }
    return JSON.stringify(tags.map(value => ({ value })));
  }

  /**
   * Roll and post to chat.
   *
   * @param {{actor: Actor, item: Item|null}} context Who rolls, and what.
   * @param {string|null} roll A formula, a stat ("str"), "bond" or "plain".
   * @param {Object} dataset The move's roll settings (mod, rollType).
   * @param {Object} templateData Data for the chat card.
   * @param {number} [bond] A +bond roll's modifier.
   * @return {Promise<{roll: Roll|null, result: string|null}|null|undefined>}
   */
  static async rollMoveExecute({ actor, item }, roll, dataset, templateData, bond = 0) {
    let forwardUsed = false;
    let rollModeUsed = false;
    // What was rolled and its result, for callers such as party moves.
    let outcome = null;
    let resultRangeNeeded = false;
    const rollData = actor.getRollData();
    const abilities = actor.system.abilities ?? {};
    // GM rolls.
    const chatData = {
      user: game.user.id,
      speaker: ChatMessage.getSpeaker({ actor })
    };
    DwUtility.applyMessageMode(chatData);
    templateData.tags = DwRolls.#cardTags(actor, item, templateData);

    // Handle dice rolls.
    if (!DwUtility.isEmpty(roll)) {
      // Test if the roll is a formula.
      const validRoll = DwRolls.isValidFormula(roll.trim(), rollData);
      // Roll can be either a formula like `2d6+3` or a raw stat like `str`.
      let formula = validRoll ? roll.trim() : '';
      // Just 2d6, with no stat or modifiers of any kind (Last Breath).
      if (!validRoll && roll.toLowerCase() == 'plain') {
        formula = DICE;
        resultRangeNeeded = true;
      }
      else if (!validRoll || dataset?.rollType == 'formula') {
        // Handle bond (user input).
        if (roll.toLowerCase() == 'bond') {
          formula = DwRolls.addTerm(DwRolls.addTerm(DICE, bond), dataset.mod);
        }
        else if (dataset?.rollType == 'formula') {
          formula = roll;
        }
        // Handle ability scores (no input).
        else if (roll.match(/(\d*)d\d+/g)) {
          formula = roll;
        }
        // Handle moves.
        else {
          if (!abilities[roll]) {
            ui.notifications.warn(game.i18n.format('DW.Notifications.invalidRoll', { roll }));
            return null;
          }
          formula = DwRolls.addTerm(DwRolls.addTerm(DICE, abilities[roll].mod), dataset.mod);
        }

        // Handle formula overrides.
        const formulaOverride = actor.system.attributes?.rollFormula?.value;
        if (formulaOverride && formula.includes(DICE)) {
          if (DwRolls.isValidFormula(formulaOverride.trim(), rollData)) formula = formula.replace(DICE, formulaOverride);
        }

        if (formula.includes(DICE) || formulaOverride && formula.includes(formulaOverride)) {
          resultRangeNeeded = true;
        }

        // Handle adv/dis.
        let rollMode = actor.flags?.dungeonworld?.rollMode ?? 'def';
        const debilityIsActive = abilities[roll]?.debility ?? false;
        if (game.settings.get("dungeonworld", "disDebility") && debilityIsActive) {
          // If the roll had advantage, the debility disadvantage cancels it out,
          // otherwise the debility gives disadvantage
          if (rollMode === "adv") {
            rollModeUsed = true;
            rollMode = "def";
          } else {
            rollMode = "dis";
          }
        }
        if (rollMode == 'adv' || rollMode == 'dis') {
          rollModeUsed = true;
          const keep = rollMode == 'adv' ? 'kh' : 'kl';
          // One more die, keeping the highest (or lowest): 2d6 -> 3d6kh2.
          if (formula.includes(DICE)) {
            formula = formula.replace(DICE, `3d6${keep}2`);
          }
          else if (formula.includes('d6')) {
            formula = formula.replace(/(\d*)(d6)/, (match, count) => {
              const dice = count ? Number(count) : 1;
              return `${dice + 1}d6${keep}${dice}`;
            });
          }
        }

        // Append the modifiers.
        formula = `${formula}${DwRolls.getModifiers(actor)}`;
        forwardUsed = (Number(actor.system.attributes?.forward?.value) || 0) != 0;

        // Gear penalties apply to moves: clumsy items and a heavy load.
        if (resultRangeNeeded) {
          const penalties = await DwRolls.gearPenalties(actor);
          if (!penalties) return;
          if (penalties.fail) {
            await DwRolls.#postAutomaticMiss(actor, templateData, chatData);
            return { roll: null, result: 'failure' };
          }
          formula += penalties.formula;
          // Casting after a 7-9 that disturbed the spell: -1 per time, until
          // the next Prepare Spells or Commune.
          const castPenalty = DwSpells.isCastMove(item) ? DwSpells.castPenalty(actor) : 0;
          if (castPenalty) formula += `-${castPenalty}[${game.i18n.localize('DW.Spellcasting.PenaltyTerm')}]`;
        }
      }

      // Do the roll.
      const evaluated = await new Roll(formula, rollData).evaluate();
      const rollType = templateData.rollType ?? 'none';
      // Add success notification.
      if (resultRangeNeeded || rollType == 'move') {
        const resultType = DwRolls.resultFor(evaluated.total);

        // Handle XP.
        const token = canvas.tokens.controlled.find(t => t.actor?.id == actor.id);
        // @todo determine if this should be the canvas ID or the actor ID.
        templateData.tokenId = token ? `${canvas.scene.id}.${token.id}` : null;
        templateData.xp = resultType == 'failure';
        // On a 6- the GM makes a move; the GM gets a reminder of them.
        templateData.gmMoves = resultType == 'failure';
        // Whoever answers the Recruit call (even on a miss) can be hired.
        templateData.recruit = DwRecruit.isRecruit(item);
        // On a 7-9 or a miss, turning them away costs -1 forward to Recruit.
        templateData.recruitTurnAway = templateData.recruit && resultType != 'success';
        // The move's effects, and the spell's when one is cast.
        const sources = [item, actor.items.get(templateData.castSpell ?? '')].filter(Boolean);
        templateData.actions = DwMoveActions.offers(actor, sources, resultType, templateData.actionTarget);
        templateData.actionsChoose = DwMoveActions.choose(sources, templateData.actions);
        templateData.cast = DwSpells.castOffer(actor, item, resultType, actor.items.get(templateData.castSpell ?? ''));

        // Update the templateData.
        templateData.resultLabel = CONFIG.DW.rollResults[resultType]?.label ?? resultType;
        templateData.result = resultType;
        templateData.resultDetails = templateData.moveResults?.[resultType]?.value || null;
      }
      outcome = { roll: evaluated, result: templateData.result ?? null };
      // Post it. Not awaited, so the dice animation doesn't hold up the rest.
      templateData.actor = actor;
      DwRolls.#postRoll(evaluated, templateData, chatData)
        .catch(err => console.error('Dungeon World | Posting a roll failed', err));
    }
    else {
      templateData.actions = DwMoveActions.offers(actor, [item].filter(Boolean), null, templateData.actionTarget);
      templateData.actionsChoose = DwMoveActions.choose([item], templateData.actions);
      templateData.actor ??= actor;
      renderTemplate(TEMPLATE, templateData).then(content => {
        chatData.content = content;
        return ChatMessage.create(chatData);
      }).catch(err => console.error('Dungeon World | Posting a move failed', err));
    }

    // Update the combat flags.
    const combatant = game.combat?.combatants.find(c => c.actor?.id == actor.id);
    if (combatant) {
      const moveCount = (Number(combatant.flags.dungeonworld?.moveCount) || 0) + 1;
      // Ask the GM's client, which can update the combat.
      if (!game.user.isGM) {
        DwSocket.askGM('combatantUpdate', { combatant: combatant.id, moveCount });
      }
      else {
        await combatant.update({ 'flags.dungeonworld.moveCount': moveCount });
      }
    }

    // Update forward.
    if (forwardUsed || rollModeUsed) {
      const updates = {};
      if (forwardUsed) updates['system.attributes.forward.value'] = 0;
      if (rollModeUsed && game.settings.get('dungeonworld', 'advForward')) {
        updates['flags.dungeonworld.rollMode'] = 'def';
      }
      if (!foundry.utils.isEmpty(updates)) await actor.update(updates);
    }
    return outcome;
  }
}
