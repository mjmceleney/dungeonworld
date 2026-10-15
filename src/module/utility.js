export class DwUtility {
  static cleanClass(string) {
    //Lower case everything
    string = string.toLowerCase();
    //Make alphanumeric (removes all other characters)
    string = string.replace(/[^a-z0-9\s]/g, "");
    //Convert whitespaces and underscore to dash
    string = string.replace(/[\s\_]/g, "-");
    //Clean up multiple dashes or whitespaces
    string = string.replace(/[\s\-]+/g, "-");
    return string;
  };

  static isEmpty(arg) {
    return [null, false, undefined, 0, ''].includes(arg);
  }

  /**
   * Apply the user's current roll visibility (whisper/blind) to chat data.
   * V14 replaced roll modes with message modes; V13 only has roll modes.
   * @param {Object} chatData
   * @returns {Object} The modified chatData.
   */
  static applyMessageMode(chatData) {
    if (typeof ChatMessage.applyMode === 'function') {
      let mode = game.settings.get('core', 'messageMode');
      // Roll cards are never in-character, matching core behavior for rolls.
      if (mode === 'ic') mode = 'public';
      return ChatMessage.applyMode(chatData, mode);
    }
    return ChatMessage.applyRollMode(chatData, game.settings.get('core', 'rollMode'));
  }

  /**
   * Point the system stylesheets at URLs unique to this build, so browsers
   * load the current CSS instead of a cached copy from an earlier build.
   * Foundry includes them without any version in the URL: as @import rules in
   * a <style> element (V13+), or as <link> elements.
   * @param {string} buildId Id written by the build; "dev" does nothing.
   */
  static bustStylesheetCache(buildId) {
    if (!buildId || buildId === 'dev') return;
    const ours = /(systems\/dungeonworld\/styles\/dist\/[\w-]+\.css)(?=["')])/g;

    for (const style of document.querySelectorAll('style')) {
      const css = style.textContent;
      if (!css.includes('systems/dungeonworld/styles/dist/') || css.includes(`build=${buildId}`)) continue;
      style.textContent = css.replace(ours, `$1?build=${buildId}`);
    }

    for (const link of document.querySelectorAll('link[rel="stylesheet"]')) {
      const url = new URL(link.href, window.location.href);
      if (!/\/systems\/dungeonworld\/styles\/dist\/[\w-]+\.css$/.test(url.pathname)) continue;
      if (url.searchParams.get('build') === buildId) continue;
      url.searchParams.set('build', buildId);
      link.href = url.href;
    }
  }

  /**
   * Build an update that deletes a key from a document's data.
   * V14 replaced the "-=key" syntax with a ForcedDeletion operator (the old
   * syntax logs a deprecation warning there); V13 only has "-=key".
   * @param {string} path Dotted path of the key to delete, e.g. "system.races.2".
   * @returns {Object} Update data to merge into a document update.
   */
  static deletionUpdate(path) {
    const ForcedDeletion = foundry.data?.operators?.ForcedDeletion;
    if (ForcedDeletion) return { [path]: new ForcedDeletion() };
    const i = path.lastIndexOf('.');
    return { [`${path.slice(0, i)}.-=${path.slice(i + 1)}`]: null };
  }

  static async getEquipment(update = false) {
    if (typeof game.items == 'undefined') {
      return false;
    }

    // Cache results.
    if (game.dungeonworld.equipment && !update) {
      return game.dungeonworld.equipment;
    }

    // Load new results.
    let items = game.items.filter(i => i.type == 'equipment');
    for (let pack of game.packs) {
      if (pack.metadata.name.includes('equipment')) {
        if (pack) {
          items = items.concat(await pack.getDocuments());
        }
      }
    }

    game.dungeonworld.equipment = items;

    return items;
  }

  static getRollFormula(defaultFormula = '2d6') {
    // TODO: Add support for adv/dis/ongoing/forward.
    return defaultFormula;
  }

  static getAbilityMod(abilityScore, force=false) {
    const noAbilityScores = game.settings.get('dungeonworld', 'noAbilityScores');
    if (noAbilityScores && !force) {
      return abilityScore
    }
    let abilityMod = 0;

    if (abilityScore >= 18) {
      abilityMod = 3;
    }
    else if (abilityScore > 15) {
      abilityMod = 2;
    }
    else if (abilityScore > 12) {
      abilityMod = 1;
    }
    else if (abilityScore > 8) {
      abilityMod = 0;
    }
    else if (abilityScore > 5) {
      abilityMod = -1;
    }
    else if (abilityScore > 3) {
      abilityMod = -2;
    }
    else {
      abilityMod = -3;
    }

    return abilityMod;
  }

  static getAbilityScore(abilityMod, force=false) {
    const noAbilityScores = game.settings.get('dungeonworld', 'noAbilityScores');
    if (noAbilityScores && !force) {
      return abilityScore
    }

    let abilityScore = 0;

    if (abilityMod >= 3) {
      abilityScore = 18;
    }
    else if (abilityMod == 2) {
      abilityScore = 16;
    }
    else if (abilityMod == 1) {
      abilityScore = 13;
    }
    else if (abilityMod == 0) {
      abilityScore = 9;
    }
    else if (abilityMod == -1) {
      abilityScore = 8;
    }
    else if (abilityMod == -2) {
      abilityScore = 5;
    }
    else {
      abilityScore = 3;
    }

    return abilityScore;
  }

  static getProgressCircle({ current = 100, max = 100, radius = 16 }) {
    let circumference = radius * 2 * Math.PI;
    let percent = current < max ? current / max : 1;
    let percentNumber = percent * 100;
    let offset = circumference - (percent * circumference);
    let strokeWidth = 4;
    let diameter = (radius * 2) + strokeWidth;
    let colorClass = Math.round((percent * 100) / 10) * 10;

    return {
      radius: radius,
      diameter: diameter,
      strokeWidth: strokeWidth,
      circumference: circumference,
      offset: offset,
      position: diameter / 2,
      color: 'red',
      class: colorClass,
    };
  }

  static async loadCompendia(slug) {

    const compendium = []

    const noCompendiumAutoData = game.settings.get('dungeonworld', 'noCompendiumAutoData');
    if (!noCompendiumAutoData) {
      const pack_id = `dungeonworld.${slug}`;
      const pack = game.packs.get(pack_id);
      compendium.push(...(pack ? await pack.getDocuments() : []));
    }

    const compendiumPrefix = game.settings.get('dungeonworld', 'compendiumPrefix');
    if (compendiumPrefix != '') {
      const pack_id = `${compendiumPrefix.toLowerCase()}-${slug}`;
      const pack = game.packs.find(p => {return p.metadata?.name?.indexOf(pack_id) >= 0});
      compendium.push(...(pack ? await pack.getDocuments() : []));
    }

    return compendium

  }

  static get nightmode() {
    return document.querySelector('body').classList.contains('theme-dark');
  }
}
