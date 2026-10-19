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

  /** Escape text for use in HTML. */
  static escape(value) {
    return Handlebars.escapeExpression(String(value ?? ''));
  }

  /** A number with an explicit sign: "+2", "−1". */
  static signed(value) {
    const n = Number(value ?? 0) || 0;
    return n < 0 ? `−${Math.abs(n)}` : `+${n}`;
  }

  /**
   * The text of each tag in an item's or actor's tags field. Tags are stored
   * as JSON from Tagify ([{value: "close"}, ...]); anything that isn't valid
   * JSON is treated as a single tag.
   * @param {string} tags
   * @returns {string[]}
   */
  static parseTags(tags) {
    if (!tags) return [];
    let list;
    try {
      list = JSON.parse(tags);
    } catch (e) {
      list = [tags];
    }
    if (!Array.isArray(list)) list = [list];
    return list.map(tag => String(tag?.value ?? tag ?? '').trim()).filter(Boolean);
  }

  /**
   * Normalize a class name so that "The Fighter", "Fighter" and "fighter"
   * match.
   */
  static classKey(name) {
    return DwUtility.cleanClass(String(name ?? '').trim()).replace(/^the-/, '');
  }

  /** A name, for matching: "Hold Person " and "hold person" match. */
  static nameKey(name) {
    return String(name ?? '').trim().toLowerCase();
  }

  /** Whether two names are the same, ignoring case and surrounding space. */
  static sameName(a, b) {
    return DwUtility.nameKey(a) === DwUtility.nameKey(b);
  }

  /**
   * Whether a resource word appears in some text as a whole word, or its
   * plural: "ration" matches "Dungeon Rations" but not "Inspiration".
   */
  static hasWord(text, word) {
    const wanted = DwUtility.nameKey(word);
    if (!wanted) return false;
    const escaped = wanted.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`(^|[^a-z0-9])${escaped}(e?s)?([^a-z0-9]|$)`, 'i').test(String(text ?? ''));
  }

  /** A class's name for use inside a sentence: "Cleric", not "The Cleric". */
  static shortClassName(name) {
    return String(name ?? '').trim().replace(/^the\s+/i, '');
  }

  /**
   * What some text (a weapon's tag, a damage roll's card) says about damage:
   * "N piercing", "ignores armor" and "+N damage". Case is ignored.
   * @param {string} text
   * @returns {{piercing: number, ignoreArmor: boolean, dmgBonus: number}}
   */
  static damageTags(text) {
    text = String(text ?? '').toLowerCase();
    const piercing = text.match(/(\d+)\s*piercing|piercing\s*(\d+)/) ?? [];
    const dmgBonus = text.match(/[+](\d+)\s*damage|damage\s*[+](\d+)/) ?? [];
    return {
      piercing: Number(piercing[1] ?? piercing[2]) || 0,
      ignoreArmor: text.includes('ignores armor'),
      dmgBonus: Number(dmgBonus[1] ?? dmgBonus[2]) || 0,
    };
  }

  /**
   * Add the system's dark theme class to an ApplicationV2's options when the
   * window uses core's dark theme, either from its own theme setting or from
   * the global color scheme.
   * @param {Object} options The application's initialized options.
   * @returns {Object} The options.
   */
  static applyThemeClass(options) {
    let dark = DwUtility.nightmode;
    if (options.classes.includes('theme-dark')) dark = true;
    else if (options.classes.includes('theme-light')) dark = false;
    if (dark) options.classes.push('dw-dark');
    return options;
  }

  /**
   * HP for a sheet: the values, how full it is, and whether it's running low.
   * @param {Object} system An actor's system data.
   */
  static hpContext(system) {
    const hp = Number(system.attributes.hp.value ?? 0);
    const hpMax = Number(system.attributes.hp.max ?? 0);
    const ratio = hpMax > 0 ? hp / hpMax : 1;
    return {
      hp,
      hpMax,
      hpPct: hpMax > 0 ? Math.max(0, Math.min(100, Math.round(100 * ratio))) : 0,
      hpState: ratio <= 0.25 ? 'low' : (ratio <= 0.5 ? 'mid' : 'high'),
    };
  }

  /**
   * Turn a tags field into a Tagify widget, suggesting tag items from the
   * world and the Tags compendium. Tagify writes the tags back into the field
   * and fires its change event.
   * @param {HTMLInputElement} input
   * @param {boolean} editable
   * @returns {Tagify}
   */
  static tagify(input, editable) {
    const tags = game.items.filter(item => item.type == 'tag').map(item => item.name);
    for (const pack of game.packs) {
      if (pack.metadata.type == 'Item' && pack.metadata.name == 'tags') {
        tags.push(...(pack.index?.map(entry => entry.name) ?? []));
      }
    }
    if (!editable) input.readOnly = true;
    return new Tagify(input, {
      whitelist: [...new Set(tags.map(tag => tag.toLowerCase()))].sort(),
      maxTags: 'Infinity',
      dropdown: {
        maxItems: 20,           // The most suggestions shown.
        classname: "tags-look", // Lets the dropdown be styled.
        enabled: 0,             // Show suggestions on focus.
        closeOnSelect: false,   // Keep the suggestions open after a pick.
      },
    });
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
   * Ask for something in a dialog with a confirm button and Cancel.
   * @param {Object} options DialogV2.wait options, with the confirm button
   *   (label, callback, and optionally icon) as `ok` and any buttons to show
   *   between it and Cancel as `buttons`.
   * @returns {Promise<any>} The clicked button's callback result; null if
   *   cancelled or closed.
   */
  static ask({ ok, buttons = [], ...options }) {
    return foundry.applications.api.DialogV2.wait({
      ...options,
      buttons: [
        { action: 'ok', icon: 'fa-solid fa-check', default: true, ...ok },
        ...buttons,
        { action: 'cancel', label: 'DW.Cancel', icon: 'fa-solid fa-xmark', callback: () => null },
      ],
      rejectClose: false,
    });
  }

  /**
   * Post a move card (no roll) to chat for an actor, with the user's current
   * message mode.
   * @param {Actor} actor
   * @param {Object} templateData Data for the card: title, image, details...
   * @returns {Promise<ChatMessage>}
   */
  static async postCard(actor, templateData) {
    const chatData = {
      speaker: ChatMessage.getSpeaker({ actor }),
      content: await foundry.applications.handlebars.renderTemplate(
        'systems/dungeonworld/templates/chat/chat-move.html', { actor, ...templateData }),
    };
    DwUtility.applyMessageMode(chatData);
    return ChatMessage.create(chatData);
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

  /* -------------------------------------------- */
  /*  Compendium documents                        */
  /* -------------------------------------------- */

  /**
   * Each pack's documents, by pack id. Loading a pack's documents is a
   * server round-trip for the whole pack, so they're kept until something in
   * the pack changes (see clearPackCache).
   * @type {Map<string, Promise<Document[]>>}
   */
  static #packCache = new Map();

  /**
   * Every document in a pack, loaded once.
   * @param {CompendiumCollection} pack
   * @returns {Promise<Document[]>}
   */
  static packDocuments(pack) {
    if (!this.#packCache.has(pack.collection)) {
      const loading = pack.getDocuments().catch(err => {
        this.#packCache.delete(pack.collection);
        throw err;
      });
      this.#packCache.set(pack.collection, loading);
    }
    return this.#packCache.get(pack.collection);
  }

  /** Forget a pack's loaded documents, after something in it changed. */
  static clearPackCache(packId) {
    this.#packCache.delete(packId);
  }

  /**
   * The packs for a kind of content: the system's own (unless the setting
   * turns them off) and, with a compendium prefix set, the matching custom
   * pack.
   * @param {string} slug E.g. "basic-moves" or "the-wizard-spells".
   * @returns {CompendiumCollection[]}
   */
  static compendiaFor(slug) {
    const packs = [];
    if (!game.settings.get('dungeonworld', 'noCompendiumAutoData')) {
      const pack = game.packs.get(`dungeonworld.${slug}`);
      if (pack) packs.push(pack);
    }
    const compendiumPrefix = game.settings.get('dungeonworld', 'compendiumPrefix');
    if (compendiumPrefix != '') {
      const packId = `${compendiumPrefix.toLowerCase()}-${slug}`;
      const pack = game.packs.find(p => p.metadata?.name?.includes(packId));
      if (pack) packs.push(pack);
    }
    return packs;
  }

  /** Every document in the packs for a kind of content. */
  static async loadCompendia(slug) {
    const documents = await Promise.all(this.compendiaFor(slug).map(pack => this.packDocuments(pack)));
    return documents.flat();
  }

  /**
   * One document from the packs for a kind of content, found from the packs'
   * indexes, so only that document is loaded.
   * @param {string} slug
   * @param {(entry: {name: string, type: string, system: Object}) => boolean} matches
   * @param {{fields?: string[]}} [options]  Data matches needs beyond name
   *   and type, added to the indexes.
   * @returns {Promise<Document|null>}
   */
  static async findInCompendia(slug, matches, { fields = [] } = {}) {
    return DwUtility.#findInPacks(this.compendiaFor(slug), matches, fields);
  }

  static async #findInPacks(packs, matches, fields = []) {
    for (const pack of packs) {
      const index = fields.length ? await pack.getIndex({ fields }) : pack.index;
      const entry = index.find(e => matches({ name: e.name ?? '', type: e.type, system: e.system ?? {} }));
      if (entry) return pack.getDocument(entry._id);
    }
    return null;
  }

  /**
   * A move: the actor's own, else the world's, else the basic moves
   * compendium's, else any of the system's other item compendiums'.
   *
   * @param {Actor|null} actor
   * @param {(item: {name: string, type: string, system: Object}) => boolean} matches
   * @param {{fields?: string[]}} [options]  As for findInCompendia.
   * @returns {Promise<Item|null>}
   */
  static async findMove(actor, matches, { fields = [] } = {}) {
    const found = actor?.items.find(matches) ?? game.items.find(matches)
      ?? await DwUtility.findInCompendia('basic-moves', matches, { fields });
    if (found) return found;
    const basic = new Set(this.compendiaFor('basic-moves'));
    const others = game.packs.filter(p => p.metadata.type == 'Item' && p.metadata.packageName == 'dungeonworld' && !basic.has(p));
    return DwUtility.#findInPacks(others, matches, fields);
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
    const packs = game.packs.filter(pack => pack.metadata.name.includes('equipment'));
    const documents = await Promise.all(packs.map(pack => this.packDocuments(pack)));
    const items = [...game.items.filter(i => i.type == 'equipment'), ...documents.flat()];

    game.dungeonworld.equipment = items;

    return items;
  }

  /**
   * An ability score's modifier: 18 is +3, 16-17 +2, 13-15 +1, 9-12 0,
   * 6-8 -1, 4-5 -2, 3 or less -3. With the No Ability Scores setting the
   * value already is the modifier, unless force.
   */
  static getAbilityMod(abilityScore, force=false) {
    if (game.settings.get('dungeonworld', 'noAbilityScores') && !force) return abilityScore;
    if (abilityScore >= 18) return 3;
    const above = [[15, 2], [12, 1], [8, 0], [5, -1], [3, -2]];
    return above.find(([score]) => abilityScore > score)?.[1] ?? -3;
  }

  /** A score for a modifier (the reverse of getAbilityMod). */
  static getAbilityScore(abilityMod, force=false) {
    if (game.settings.get('dungeonworld', 'noAbilityScores') && !force) return abilityMod;
    if (abilityMod >= 3) return 18;
    const scores = [[2, 16], [1, 13], [0, 9], [-1, 8], [-2, 5]];
    return scores.find(([mod]) => abilityMod == mod)?.[1] ?? 3;
  }

  static getProgressCircle({ current = 100, max = 100, radius = 16 }) {
    const circumference = radius * 2 * Math.PI;
    const percent = current < max ? current / max : 1;
    const strokeWidth = 4;
    const diameter = (radius * 2) + strokeWidth;

    return {
      radius: radius,
      diameter: diameter,
      strokeWidth: strokeWidth,
      circumference: circumference,
      offset: circumference - (percent * circumference),
      position: diameter / 2,
      color: 'red',
      class: Math.round((percent * 100) / 10) * 10,
    };
  }

  /**
   * A character's level in each of their classes: their own class first, then
   * any they've multiclassed into. Each level up raises one class, so these
   * add up to the character's level. Without recorded class levels, each
   * multiclass counts as level 1 and their own class has the rest.
   * @param {Actor} actor
   * @returns {{name: string, level: number, primary: boolean}[]}
   */
  static classLevels(actor) {
    const overall = Math.max(1, Number(actor.system.attributes.level.value) || 1);
    const stored = actor.flags?.dungeonworld?.classLevels ?? {};
    const multiclasses = actor.flags?.dungeonworld?.multiclasses ?? [];
    const others = multiclasses.map(name => ({ name, level: Math.max(1, Number(stored[name] ?? 1)), primary: false }));
    const name = (actor.system.details.class ?? '').trim();
    const taken = others.reduce((sum, c) => sum + c.level, 0);
    const level = Math.max(1, Number(stored[name] ?? overall - taken));
    return [{ name, level, primary: true }, ...others];
  }

  /** Whether two class names are the same class ("The Thief" and "Thief"). */
  static sameClass(a, b) {
    return DwUtility.classKey(a) === DwUtility.classKey(b);
  }

  static get nightmode() {
    return document.querySelector('body').classList.contains('theme-dark');
  }
}
