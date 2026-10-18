import { DwUtility } from "./utility.js";
import { DwResources } from "./resources.js";
import { DwSpells } from "./spells.js";
const { renderTemplate } = foundry.applications.handlebars;

export class DwRolls {

  constructor() {
    this.actor = null;
    this.actorData = null;
    this.item = null;
  }

  static getRollFormula(defaultFormula = '2d6') {
    // TODO: Incorporate adv/dis/ongoing/forward.
    return defaultFormula;
  }

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

  static getModifiers(actor) {
    let forward = Number(actor.system.attributes?.forward?.value) ?? 0;
    let ongoing = Number(actor.system.attributes?.ongoing?.value) ?? 0;
    let result = '';
    if (forward) result += `+${forward}`;
    if (ongoing) result += `+${ongoing}`;
    return result;
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
    const DialogV2 = foundry.applications.api.DialogV2;
    const escape = (value) => Handlebars.escapeExpression(String(value ?? ''));
    const hints = DwRolls.statHints(item);
    const stats = Object.entries(actor.system.abilities ?? {});

    const content = document.createElement('div');
    content.innerHTML = `<p>${game.i18n.format('DW.Dialog.askContent', { name: escape(item.name) })}</p>`
      + '<div class="dw-ask-stats">'
      + stats.map(([key, ability]) => {
        const mod = Number(ability.mod) || 0;
        const debility = ability.debility ? `<span class="dw-ask-debility">${escape(ability.debilityLabel)}</span>` : '';
        return `<button type="button" class="dw-ask-stat" data-action="${key}">
          <span class="dw-ask-abbr">${escape(game.i18n.localize(`DW.${key.toUpperCase()}`))}</span>
          <span class="dw-ask-mod">${mod < 0 ? '−' + Math.abs(mod) : '+' + mod}</span>
          <span class="dw-ask-hint">${escape(hints[key] ?? '')}${debility}</span>
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
      const DialogV2 = foundry.applications.api.DialogV2;
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
   * The resource a move's card offers to spend for this result, if any
   * (Volley: 1 ammo on a 7-9), with how much the character has left.
   *
   * @param {Actor} actor
   * @param {Item|null} item
   * @param {string|null} result "success", "partial", "failure", or null
   *   for a move without a roll.
   * @return {{name: string, amount: number, left: number}|null}
   */
  static resourceOffer(actor, item, result) {
    const resource = item?.system?.resource;
    if (!resource?.name || !resource.when || !actor) return null;
    const offered = {
      always: true,
      hit: result == 'success' || result == 'partial',
      partial: result == 'partial',
      success: result == 'success',
    }[resource.when];
    if (!offered) return null;
    const left = DwResources.find(actor, resource.name).reduce((sum, i) => sum + DwResources.remaining(i), 0);
    return { name: resource.name, amount: Math.max(1, Number(resource.amount) || 1), left };
  }

  static async rollMove(options = {}) {
    let dice = this.getRollFormula('2d6');

    // TODO: Create a way to resolve this using the formula only, sans actor.
    // If there's no actor, we need to exit.
    if (!options.actor) {
      return false;
    }

    // If there's no formula or item, we need to exit.
    if (!options.formula && !options.data) {
      return false;
    }

    // Grab the actor data.
    this.actor = options.actor;
    this.actorData = this.actor ? this.actor.system : {};
    let actorType = this.actor.type;

    // Grab the item data, if any.
    this.item = options?.data;

    // Grab the formula, if any.
    let formula = options.formula ?? null;
    let label = options?.data?.label ?? '';

    // Prepare template data for the roll.
    let templateData = options.templateData ? foundry.utils.duplicate(options.templateData): {};
    let data = {};

    let dlgOptions = {
      classes: ['dungeonworld', 'dw-dialog']
    };

    if (DwUtility.nightmode) dlgOptions.classes.push('nightmode');

    // Handle item rolls (moves).
    if (this.item) {
      // Handle moves.
      if (this.item.type == 'move' || this.item.type == 'npcMove') {
        formula = dice;
        // Anything the caller added (Recruit's terms) stays on the card.
        templateData = {
          ...templateData,
          image: this.item.img,
          title: this.item.name,
          trigger: null,
          details: this.item.system.description,
          moveResults: this.item.system.moveResults,
          choices: this.item.system.choices
        };
        // Cast a Spell for a particular spell: show the spell, so a 7-9 can
        // lose it.
        if (options.spell) {
          templateData.title = `${this.item.name}: ${options.spell.name}`;
          templateData.details = options.spell.system.description || templateData.details;
          templateData.castSpell = options.spell.id;
        }

        if (this.item.type == 'npcMove' || this.item.system?.rollType == 'FORMULA') {
          data.roll = this.item.system.rollFormula;
          data.rollType = this.item.system.rollType ? this.item.system.rollType.toLowerCase() : 'npc';
        }
        else {
          data.roll = this.item.system.rollType.toLowerCase();
          data.rollType = this.item.system.rollType.toLowerCase();
        }
        data.mod = this.item.type == 'move' ? this.item.system.rollMod : 0;
        // If this is an ASK roll, ask which stat to roll first.
        if (data.roll == 'ask') {
          const { actor, item } = this;
          const stat = await DwRolls.askStat(actor, item);
          if (!stat) return;
          // Another roll may have started while the dialog was open.
          this.actor = actor;
          this.actorData = actor.system;
          this.item = item;
          return this.rollMoveExecute(stat, data, templateData);
        }
        // If this is a PROMPT roll, render a different bond to let the user
        // enter their bond value.
        else if (data.roll == 'bond') {
          // A modifier already worked out (Recruit's terms) needs no prompt.
          if (options.modifier !== undefined) {
            return this.rollMoveExecute('bond', data, templateData, { bond: { value: Number(options.modifier) || 0 } });
          }
          let template = 'systems/dungeonworld/templates/chat/roll-dialog.html';
          let dialogData = {
            title: game.i18n.format('DW.Dialog.bondContent', {name: this.item.name}),
            bond: null
          };
          const html = await renderTemplate(template, dialogData);
          return new Promise(resolve => {
            new Dialog({
              title: game.i18n.localize('DW.Dialog.bondTitle'),
              content: html,
              buttons: {
                submit: {
                  label: 'Roll',
                  callback: html => {
                    resolve(this.rollMoveExecute('bond', data, templateData, html[0].querySelector("form")));
                  }
                }
              },
              close: () => resolve(null),
            }, dlgOptions).render(true);
          })

        }
        // Otherwise, grab the data from the move and pass it along.
        else {
          return this.rollMoveExecute(data.roll, data, templateData);
        }
      }
      // Handle spells.
      else if (this.item.type == 'spell') {
        templateData = {
          image: this.item.img,
          title: this.item.name,
          trigger: null,
          details: this.item.system.description
        };
        data.roll = this.item.system.rollFormula;
        return this.rollMoveExecute(data.roll, data, templateData);
      }
      // Handle equipment.
      else if (this.item.type == 'equipment') {
        templateData = {
          image: this.item.img,
          title: this.item.name,
          trigger: null,
          details: this.item.system.description,
          tags: this.item.system.tags
        }
        data.roll = this.item.system.rollFormula;
        return this.rollMoveExecute(data.roll, data, templateData);
      }
    }
    // Handle formula-only rolls.
    else {
      return this.rollMoveExecute(formula, data, templateData);
    }
  }

  /**
   * Post a move's 6- result without rolling, for a character who chose to
   * fail rather than drop weight. It isn't a roll, so no XP is offered.
   */
  static async #postAutomaticMiss(actor, templateData, chatData) {
    const template = 'systems/dungeonworld/templates/chat/chat-move.html';
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
    chatData.content = await renderTemplate(template, templateData);
    return ChatMessage.create(chatData);
  }

  static async rollMoveExecute(roll, dataset, templateData, form = null) {
    // Render the roll.
    let template = 'systems/dungeonworld/templates/chat/chat-move.html';
    let dice = DwUtility.getRollFormula('2d6');
    let forwardUsed = false;
    let rollModeUsed = false;
    // What was rolled and its result, for callers such as party moves.
    let outcome = null;
    let resultRangeNeeded = false;
    let rollData = this.actor.getRollData();
    // GM rolls.
    let chatData = {
      user: game.user.id,
      speaker: ChatMessage.getSpeaker({ actor: this.actor })
    };
    DwUtility.applyMessageMode(chatData);
    // Define tags.
    let baseTags = this.item?.system?.tags ?? this.actor?.system?.tags;
    let tags = [];
    let hasPiercingTag = false;
    let hasDmgBonusTag = false;
    let hasIgnoreArmorTag = false;
    if (baseTags && baseTags.length > 0) {
      tags = JSON.parse(baseTags);
      if (baseTags.includes('piercing')) {
        hasPiercingTag = true;
      }
      if (baseTags.includes('damage')) {
        hasDmgBonusTag = true;
      }
      if (baseTags.includes('ignores armor')) {
        hasIgnoreArmorTag = true;
      }
    }
    // Add piercing and armor tags.
    if (this.item?.system?.itemType == 'weapon' || templateData?.rollType == 'damage') {
      let piercing = this.actor.system.attributes.damage?.piercing ?? 0;
      let dmgBonus = this.actor.system.attributes.damage?.dmgBonus ?? 0;
      let ignoreArmor = this.actor.system.attributes.damage?.ignoreArmor ?? false;
      if (piercing > 0 && !hasPiercingTag) tags.push({value: `${piercing} piercing`});
      if (ignoreArmor && !hasIgnoreArmorTag) tags.push({value: `ignores armor`});
      if (dmgBonus > 0 && !hasDmgBonusTag) tags.push({value: `+${dmgBonus} damage`});
      if (this.actor.type == 'npc' && templateData?.flavor) tags.push({value: templateData.flavor});
    }
    templateData.tags = JSON.stringify(tags);
    // Handle dice rolls.
    if (!DwUtility.isEmpty(roll)) {
      // Test if the roll is a formula.
      let validRoll = DwRolls.isValidFormula(roll.trim(), rollData);
      // Roll can be either a formula like `2d6+3` or a raw stat like `str`.
      let formula = validRoll ? roll.trim() : '';
      // Just 2d6, with no stat or modifiers of any kind (Last Breath).
      if (!validRoll && roll.toLowerCase() == 'plain') {
        formula = dice;
        resultRangeNeeded = true;
      }
      // Handle bond (user input).
      else if (!validRoll || dataset?.rollType == 'formula') {
        if (roll.toLowerCase() == 'bond') {
          const bond = Number(form.bond?.value) || 0;
          formula = bond ? `${dice}${bond < 0 ? bond : '+' + bond}` : dice;
          if (dataset.value && dataset.value != 0) {
            formula += `+${dataset.value}`;
          }
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
          // Determine if the stat toggle is in effect.
          let toggleModifier = 0;
          formula = `${dice}+${this.actorData.abilities[roll].mod}${toggleModifier ? '+' + toggleModifier : ''}`;
          if (dataset.mod && dataset.mod != 0) {
            formula += `+${dataset.mod}`;
          }
        }

        // Handle formula overrides.
        let formulaOverride = this.actor.system.attributes?.rollFormula?.value;
        if (formulaOverride && formula.includes('2d6')) {
          let overrideIsValid = DwRolls.isValidFormula(formulaOverride.trim(), rollData);

          if (overrideIsValid) formula = formula.replace('2d6', formulaOverride);
        }

        if (formula.includes('2d6') || formulaOverride && formula.includes(formulaOverride)) {
          resultRangeNeeded = true;
        }

        // Handle adv/dis.
        let rollMode = this.actor.flags?.dungeonworld?.rollMode ?? 'def';
        const debilityIsActive = this.actorData.abilities[roll] !== undefined ? this.actorData.abilities[roll].debility : false;
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
        switch (rollMode) {
          case 'adv':
            rollModeUsed = true;
            if (formula.includes('2d6')) {
              formula = formula.replace('2d6', '3d6kh2');
            }
            else if (formula.includes('d6')) {
              // Match the first d6 as (n)d6.
              formula = formula.replace(/(\d*)(d6)/, (match, p1, p2, offset, string) => {
                let keep = p1 ? Number(p1) : 1;
                let count = keep + 1;
                return `${count}d6kh${keep}`; // Ex: 2d6 -> 3d6kh2
              });
            }
            break;

          case 'dis':
            rollModeUsed = true;
            if (formula.includes('2d6')) {
              formula = formula.replace('2d6', '3d6kl2');
            }
            else if (formula.includes('d6')) {
              formula = formula.replace(/(\d*)(d6)/, (match, p1, p2, offset, string) => {
                let keep = p1 ? Number(p1) : 1;
                let count = keep + 1;
                return `${count}d6kl${keep}`;
              });
            }
            break;
        }

        // Append the modifiers.
        let modifiers = DwRolls.getModifiers(this.actor);
        formula = `${formula}${modifiers}`;
        forwardUsed = Number(this.actor.system.attributes?.forward?.value) != 0;

        // Gear penalties apply to moves: clumsy items and a heavy load.
        if (resultRangeNeeded) {
          const actor = this.actor;
          const penalties = await DwRolls.gearPenalties(actor);
          if (!penalties) return;
          this.actor = actor;
          this.actorData = actor.system;
          if (penalties.fail) {
            await DwRolls.#postAutomaticMiss(actor, templateData, chatData);
            return { roll: null, result: 'failure' };
          }
          formula += penalties.formula;
          // Casting after a 7-9 that disturbed the spell: -1 per time, until
          // the next Prepare Spells or Commune.
          const castPenalty = DwSpells.isCastMove(this.item) ? DwSpells.castPenalty(actor) : 0;
          if (castPenalty) formula += `-${castPenalty}[${game.i18n.localize('DW.Spellcasting.PenaltyTerm')}]`;
        }
      }
      if (formula != null) {
        // Do the roll.
        let roll = new Roll(`${formula}`, rollData);
        await (roll.evaluate());
        let rollType = templateData.rollType ?? 'none';
        // Add success notification.
        if (resultRangeNeeded || rollType == 'move') {
          // Retrieve the result ranges.
          let resultRanges = CONFIG.DW.rollResults;
          let resultType = null;
          // Iterate through each result range until we find a match.
          for (let [resultKey, resultRange] of Object.entries(resultRanges)) {
            // Grab the start and end.
            let start = resultRange.start;
            let end = resultRange.end;
            // If both are present, roll must be between them.
            if (start && end) {
              if (roll.total >= start && roll.total <= end) {
                resultType = resultKey;
                break;
              }
            }
            // If start only, treat it as greater than or equal to.
            else if (start) {
              if (roll.total >= start) {
                resultType = resultKey;
                break;
              }
            }
            // If end only, treat it as less than or equal to.
            else if (end) {
              if (roll.total <= end) {
                resultType = resultKey;
                break;
              }
            }
          }

          // Handle XP.
          const token = canvas.tokens.controlled.find(t => t.actorId == this.actor.id);
          // @todo determine if this should be the canvas ID or the actor ID.
          templateData.tokenId = token ? `${canvas.scene.id}.${token.id}` : null;
          templateData.xp = resultType == 'failure' ? true : false;
          // On a 6- the GM makes a move; the GM gets a reminder of them.
          templateData.gmMoves = resultType == 'failure';
          // Whoever answers the Recruit call (even on a miss) can be hired.
          templateData.recruit = this.item?.type == 'move' && this.item.name.trim().toLowerCase() == 'recruit';
          // On a 7-9 or a miss, turning them away costs -1 forward to Recruit.
          templateData.recruitTurnAway = templateData.recruit && resultType != 'success';
          templateData.resource = DwRolls.resourceOffer(this.actor, this.item, resultType);
          templateData.cast = DwSpells.castOffer(this.actor, this.item, resultType, this.actor.items.get(templateData.castSpell ?? ''));

          // Update the templateData.
          templateData.resultLabel = resultRanges[resultType]?.label ?? resultType;
          templateData.result = resultType;
          templateData.resultDetails = null;
          if (templateData?.moveResults && templateData.moveResults[resultType]?.value) {
            templateData.resultDetails = templateData.moveResults[resultType].value;
          }
        }
        outcome = { roll, result: templateData.result ?? null };
        // Render it.
        templateData.actor = this.actor;
        roll.render().then(r => {
          templateData.rollDw = r;
          templateData.roll = roll;
          renderTemplate(template, templateData).then(content => {
            chatData.content = content;
            if (game.dice3d) {
              game.dice3d.showForRoll(roll, game.user, true, chatData.whisper, chatData.blind).then(displayed => ChatMessage.create(chatData));
            }
            else {
              chatData.sound = CONFIG.sounds.dice;
              ChatMessage.create(chatData);
            }
          });
        });
      }
    }
    else {
      templateData.resource = DwRolls.resourceOffer(this.actor, this.item, null);
      templateData.actor ??= this.actor;
      renderTemplate(template, templateData).then(content => {
        chatData.content = content;
        ChatMessage.create(chatData);
      });
    }

    // Update the combat flags.
    if (game.combat && game.combat.combatants) {
      let combatant = game.combat.combatants.find(c => c.actor.id == this.actor.id);
      if (combatant) {
        let moveCount = combatant.flags.dungeonworld ? combatant.flags.dungeonworld.moveCount : 0;
        moveCount = moveCount ? Number(moveCount) + 1 : 1;
        // Emit a socket for the GM client.
        if (!game.user.isGM) {
          game.socket.emit('system.dungeonworld', {
            combatantUpdate: { _id: combatant.id, 'flags.dungeonworld.moveCount': moveCount }
          });
        }
        else {
          await game.combat.updateEmbeddedDocuments('Combatant', [{ _id: combatant.id, 'flags.dungeonworld.moveCount': moveCount }]);
        }
      }
    }

    // Update forward.
    if (forwardUsed || rollModeUsed) {
      let updates = {};
      if (forwardUsed) updates['system.attributes.forward.value'] = 0;
      if (rollModeUsed && game.settings.get('dungeonworld', 'advForward')) {
        updates['flags.dungeonworld.rollMode'] = 'def';
      }
      await this.actor.update(updates);
    }
    return outcome;
  }
}
