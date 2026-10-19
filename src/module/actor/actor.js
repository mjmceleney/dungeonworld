import { DwUtility } from '../utility.js';

/**
 * Extends the basic Actor class for Dungeon World.
 * @extends {Actor}
 */
export class ActorDw extends Actor {

  /**
   * Augment the basic actor data with additional dynamic data.
   */
  prepareData() {
    super.prepareData();
    if (this.type === 'character') this._prepareCharacterData(this);
  }

  /**
   * Prepare Character type specific data
   */
  _prepareCharacterData(actorData) {
    const data = actorData.system;

    const debilityLabels = {
      "str": game.settings.get('dungeonworld', 'debilityLabelSTR'),
      "dex": game.settings.get('dungeonworld', 'debilityLabelDEX'),
      "con": game.settings.get('dungeonworld', 'debilityLabelCON'),
      "int": game.settings.get('dungeonworld', 'debilityLabelINT'),
      "wis": game.settings.get('dungeonworld', 'debilityLabelWIS'),
      "cha": game.settings.get('dungeonworld', 'debilityLabelCHA')
    };

    const noAbilityScores = game.settings.get('dungeonworld', 'noAbilityScores');
    const disDebility = game.settings.get("dungeonworld", "disDebility");

    // Ability Scores
    for (let [a, abl] of Object.entries(data.abilities)) {
      // TODO: This is a possible formula, but would require limits on the
      // upper and lower ends.
      // abl.mod = Math.floor(abl.value * 0.4 - (abl.value < 11 ? 3.4 : 4.2));

      // @todo: This could be improved by storing old scores in a flag.
      // Convert ability scores if the no mod setting changed.
      if (noAbilityScores) {
        if (!Number.isNaN(abl.value) && abl.value > 3) {
          abl.value = DwUtility.getAbilityMod(abl.value, true);
        }
      }
      else {
        if (!Number.isNaN(abl.value) && abl.value < 4) {
          abl.value = DwUtility.getAbilityScore(abl.value, true);
        }
      }

      // Ability modifiers.
      abl.mod = DwUtility.getAbilityMod(abl.value);

      // Add labels.
      abl.label = CONFIG.DW.abilities[a];
      abl.debilityLabel = game.i18n.localize(debilityLabels[a]);
      // Adjust mod based on debility.
      if (abl.debility && !disDebility) {
        abl.mod -= 1;
      }
    }

    // Each piece of equipment with its tags, lower case, parsed once.
    const items = actorData.items ?? [];
    const equipment = items.filter(i => i.type == 'equipment')
      .map(item => ({ item, tags: DwUtility.parseTags(item.system.tags).map(tag => tag.toLowerCase()) }));

    // Calculate weight, and the damage tags of equipped weapons.
    const coin = data.attributes.coin.value ?? 0;
    const coinWeight = game.settings.get("dungeonworld", "coinWeight");
    let weight = coinWeight > 0 ? Math.floor(coin / coinWeight) : 0;
    const damage = data.attributes.damage ??= {};
    for (const { item, tags } of equipment) {
      const itemWeight = Number(item.system.weight);
      if (itemWeight > 0) {
        weight += (Number(item.system.quantity ?? 1) || 0) * itemWeight;
      }
      if (!item.system.equipped || item.system.itemType != 'weapon') continue;
      for (const tag of tags) {
        // The highest piercing and damage bonus count; any "ignores armor" does.
        const { piercing, ignoreArmor, dmgBonus } = DwUtility.damageTags(tag);
        if (piercing > (Number(damage.piercing) || 0)) damage.piercing = piercing;
        damage.ignoreArmor ||= ignoreArmor;
        if (dmgBonus > (Number(damage.dmgBonus) || 0)) damage.dmgBonus = dmgBonus;
      }
    }
    data.attributes.weight.value = weight;

    if (game.settings.get('dungeonworld', 'automateGear')) {
      this._prepareGear(data, items, equipment);
    }

    // Add base flags.
    if (!actorData.flags.dungeonworld) actorData.flags.dungeonworld = {};
    if (!actorData.flags.dungeonworld.sheetDisplay) actorData.flags.dungeonworld.sheetDisplay = {};
    if (!actorData.flags.dungeonworld.rollMode) actorData.flags.dungeonworld.rollMode = 'def';

    // Handle max XP.
    if (!data.attributes.level.value) data.attributes.level.value = 1;
    data.attributes.xp.max = this._xpRequired();
  }

  /**
   * The XP needed for the next level, from the XP formula setting. Plain
   * arithmetic (such as the default formula) is computed directly, which is
   * much cheaper than building and evaluating a Roll.
   * @returns {number}
   */
  _xpRequired() {
    const formula = game.settings.get('dungeonworld', 'xpFormula');
    const rollData = this.getRollData();
    const replaced = Roll.replaceFormulaData(formula, rollData);
    if (/^[\d\s.+\-*/()]+$/.test(replaced)) {
      try {
        const total = Roll.safeEval(replaced);
        if (Number.isFinite(total)) return total;
      }
      catch (error) {
        // Fall back to a Roll below.
      }
    }
    try {
      const roll = new Roll(formula, rollData);
      roll.evaluateSync();
      if (Number.isFinite(roll.total)) return roll.total;
    }
    catch (error) {
      console.warn(`Dungeon World | Invalid XP formula "${formula}"`, error);
    }
    return Number(this.system.attributes.level.value) + 7;
  }

  /**
   * Work out what the character's gear does, per the rules.
   *
   * Armor: armor doesn't stack, so the best equipped "N armor" counts, plus
   * every equipped "+N armor" (a shield), plus ac.misc for moves and other
   * bonuses. Characters with no equipped armor keep the armor typed in.
   * Each equipped clumsy item gives −1 to moves (ac.clumsy).
   *
   * Load (weight.tier): "ok" up to load, "heavy" (−1) at load+1 or load+2,
   * and "over" beyond that.
   *
   * @param {Object} data The character's system data.
   * @param {Collection} items
   * @param {{item: Item, tags: string[]}[]} equipment The equipment, with its
   *   tags in lower case.
   */
  _prepareGear(data, items, equipment) {
    const ac = data.attributes.ac;
    let best = null;
    let bonus = 0;
    let clumsy = 0;
    const sources = [];
    // Moves like Armored ignore clumsy on worn armor, or on everything.
    const ignore = new Set(items.filter(i => i.type == 'move').map(i => i.system?.ignoreClumsy).filter(Boolean));

    for (const { item, tags } of equipment) {
      if (!item.system?.equipped) continue;
      let isClumsy = false;
      for (const text of tags) {
        if (text == 'clumsy') isClumsy = true;
        const match = text.match(/^(\+)?\s*(\d+)\s*armou?r$|^armou?r\s*(\+)?\s*(\d+)$/);
        if (!match) continue;
        const adds = !!(match[1] ?? match[3]);
        const value = Number(match[2] ?? match[4]) || 0;
        if (adds) {
          bonus += value;
          sources.push(`${item.name} +${value}`);
        }
        else if (best === null || value > best.value) best = { value, name: item.name };
      }
      const ignored = ignore.has('all') || (ignore.has('armor') && item.system.itemType == 'armor');
      if (isClumsy && !ignored) clumsy++;
    }

    const misc = Number(ac.misc) || 0;
    if (best || bonus) {
      if (best) sources.unshift(`${best.name} ${best.value}`);
      if (misc) sources.push(`${game.i18n.localize('DW.Gear.ArmorMisc')} ${DwUtility.signed(misc)}`);
      ac.fromGear = true;
      ac.value = Math.max(0, (best?.value ?? 0) + bonus + misc);
      ac.sources = sources.join(', ');
    }
    ac.clumsy = clumsy;

    const weight = data.attributes.weight;
    const load = Number(weight.max) || 0;
    weight.tier = weight.value <= load ? 'ok' : (weight.value <= load + 2 ? 'heavy' : 'over');
  }

  /**
   * Roll data with shortcuts: each attribute and ability at the top level
   * (@str, @hp), with .val for .value, and @attr and @abil for the groups.
   * Built from copies, so the actor's own data isn't changed.
   * @override
   */
  getRollData() {
    const rollData = { ...super.getRollData() };

    for (const prop of ['attributes', 'abilities']) {
      if (!rollData[prop]) continue;
      rollData[prop] = Object.fromEntries(Object.entries(rollData[prop]).map(([k, v]) => [
        k,
        v && typeof v == 'object' ? { ...v, val: v.value } : v,
      ]));
      Object.assign(rollData, rollData[prop]);
    }

    if (rollData.attributes) rollData.attr = rollData.attributes;
    if (rollData.abilities) rollData.abil = rollData.abilities;

    return rollData;
  }

  async applyDamage(amount, options = {op: 'full', ignoreArmor: false, piercing: 0, dmgBonus: 0}) {
    let newAmount = Number(amount);

    // Apply dmgbonus.
    if (options.op !== 'heal') {
      newAmount += Number(options.dmgBonus) || 0;
    }

    switch (options.op) {
      case 'half':
        newAmount = Math.floor(newAmount / 2);
        break;

      case 'double':
        newAmount = newAmount * 2;
        break;

      default:
        break;
    }

    let hp = this.system?.attributes?.hp?.value ?? 0;
    let hpMax = this.system?.attributes?.hp?.max ?? 1;
    let armor = this.system?.attributes?.ac?.value ?? 0;
    let piercing = options?.ignoreArmor ? armor : (Number(options?.piercing) || 0);
    let reduced = armor;

    if (!hp && !amount) return;

    // Reduce armor if needed.
    if (options.piercing && options.piercing > 0) reduced = Math.max(armor - options.piercing, 0);
    if (options.ignoreArmor) reduced = 0;

    // Reduce damage by armor.
    if (options.op !== 'heal' && !options.ignoreArmor) {
      newAmount = Math.max(newAmount - reduced, 0);
    }

    // Adjust hp.
    let newHp = options.op === 'heal' ? hp + newAmount : hp - newAmount;
    if (newHp > hpMax) newHp = hpMax;

    if (newHp !== hp) {
      const update = {'system.attributes.hp.value': newHp};
      // Set options.dw so that we can update scrolling text in
      // preUpdate and onUpdate.
      const context = {
        dw: {
          armor: {
            reduced: reduced,
            value: armor,
            piercing: piercing,
          },
        },
      };
      return this.update(update, context);
    }
  }

  /**
   * Scrolling text helper method.
   *
   * @param {number} delta Difference to display.
   * @param {number} max Maximum value to calculate against.
   * @param {string} suffix Text to display
   * @param {object} overrideOptions Override options to pass to the token method.
   */
  showScrollingText(delta, max, suffix="", overrideOptions={}) {
    // Show scrolling text of hp update
    const tokens = (this.isToken ? [this.token?.object] : this.getActiveTokens(true)).filter(Boolean);
    if (tokens.length > 0) {
      if (!delta) delta = 0;

      let color = 0x999999;
      if (delta < 0) {
        color = 0xcc0000;
      }
      else if (delta > 0) {
        color = 0x00cc00;
      }

      for ( let token of tokens ) {
        const pct = delta !== 0 ? Math.clamp(Math.abs(delta) / max, 0, 1) : 0.25;
        let content = delta !== 0 ? delta.signedString() + " " + suffix : suffix;
        let textOptions = {
          anchor: CONST.TEXT_ANCHOR_POINTS.CENTER,
          direction: CONST.TEXT_ANCHOR_POINTS.TOP,
          fontSize: 16 + (32 * pct), // Range between [16, 48]
          fill: color,
          stroke: 0x000000,
          strokeThickness: 4,
          // jitter: 1,
          duration: 3000
        };
        canvas.interface.createScrollingText(token.center, content, foundry.utils.mergeObject(textOptions, overrideOptions));
      }
    }
  }

  /** @override */
  async _preCreate(data, options, user) {
    const allowed = await super._preCreate(data, options, user);
    if (allowed === false) return false;

    const isCharacter = this.type === "character";

    // Never override the GM's core Prototype Token Overrides setting.
    const overrides = foundry.data.PrototypeTokenOverrides?.overrides ?? {};
    const isOverridden = path => [overrides.base, overrides[this.type]]
      .some(o => o && foundry.utils.getProperty(o, path) != null);

    // Apply a default unless the GM overrides it. Unless forced, also skip it
    // when the creation data sets it, so compendium imports and duplicates
    // keep their own token settings.
    const prototypeToken = {};
    const setDefault = (path, value, force = false) => {
      if (isOverridden(path)) return;
      if (!force && foundry.utils.hasProperty(data, `prototypeToken.${path}`)) return;
      foundry.utils.setProperty(prototypeToken, path, value);
    };

    setDefault("bar1.attribute", "attributes.hp");
    setDefault("bar2.attribute", isCharacter ? "attributes.xp" : null);
    setDefault("displayBars", CONST.TOKEN_DISPLAY_MODES.OWNER_HOVER);

    // Characters are always linked, friendly, and have vision.
    if (isCharacter) {
      prototypeToken.actorLink = true;
      setDefault("disposition", CONST.TOKEN_DISPOSITIONS.FRIENDLY, true);
      setDefault("sight.enabled", true, true);
    }
    // Each hireling is someone in particular, on the characters' side.
    else if (this.type === "hireling") {
      setDefault("actorLink", true);
      setDefault("disposition", CONST.TOKEN_DISPOSITIONS.FRIENDLY);
    }
    else {
      setDefault("disposition", CONST.TOKEN_DISPOSITIONS.HOSTILE);
    }

    this.updateSource({ prototypeToken });
  }

  /** @override */
  async _preUpdate(data, options, userId) {
    const allowed = await super._preUpdate(data, options, userId);
    if (allowed === false) return false;
    // Note the HP before the change for the scrolling text. The update's
    // options go to every client, so only what's needed is kept.
    options.dw ??= {};
    const hp = this.system.attributes?.hp;
    options.dw.preUpdate ??= { hp: { value: hp?.value ?? null, max: hp?.max ?? null } };
  }

  /** @override */
  async _onUpdate(updateData, options, userId) {
    await super._onUpdate(updateData, options, userId);
    const context = options?.dw?.preUpdate ?? false;

    if (!options.diff || !context || updateData.system === undefined) return; // Nothing to do.

    // Exit early if this user can't at least observe the actor.
    if (!this.testUserPermission(game.user, "OBSERVER")) return;

    // Prepare the scrolling text update.
    if (updateData.system?.attributes?.hp?.value !== undefined) {
      let hp = {
        original: context.hp?.value ?? null,
        current: updateData.system.attributes.hp.value ?? null,
        max: context.hp?.max ?? updateData.system.attributes.hp.max
      }

      if (!isNaN(hp.original) && !isNaN(hp.current)) {
        hp.delta = hp.current - hp.original;

        if (hp.delta !== 0) {
          this.showScrollingText(hp.delta, hp.max, game.i18n.localize('DW.HP'), {anchor: CONST.TEXT_ANCHOR_POINTS.TOP});
        }

        if (hp.delta < 0 && options?.dw?.armor?.reduced) {
          let armorContext = {
            reduced: options.dw.armor.reduced,
            piercing: options.dw.armor?.piercing ?? 0
          };

          let textToShow = game.i18n.format('DW.Scrolling.armorReduced', armorContext);
          if (armorContext.piercing > 0) {
            textToShow = textToShow + '\r\n' + game.i18n.format('DW.Scrolling.armorPiercing', armorContext);
          }
          this.showScrollingText(null, null, textToShow, {anchor: CONST.TEXT_ANCHOR_POINTS.CENTER});
        }
      }
    }
  }
}
