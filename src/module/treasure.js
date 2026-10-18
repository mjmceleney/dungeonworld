const { DialogV2 } = foundry.applications.api;
const { FormDataExtended } = foundry.applications.ux;

/**
 * Roll a monster's treasure, per the rules: its damage die, rolled twice
 * (take the higher) for a hoarder, plus 1d4 each for lording over others and
 * for being ancient and noteworthy. The total is looked up on the Treasure
 * table. Some kinds of monster always add something, noted with the result.
 */
export class DwTreasure {

  /**
   * The modifiers a monster can have. `tag` is the monster tag that turns it
   * on by default; `dice` is added to the roll; `note` goes with the result.
   */
  static MODIFIERS = [
    { key: 'hoarder', tag: 'hoarder' },
    { key: 'farFromHome', note: true },
    { key: 'magical', tag: 'magical', note: true },
    { key: 'divine', tag: 'divine', note: true },
    { key: 'planar', tag: 'planar', note: true },
    { key: 'lord', dice: '1d4' },
    { key: 'ancient', dice: '1d4' },
  ];

  /**
   * The monster's damage die, without flat bonuses: "d10+3" gives "d10",
   * "2d8kh+2" gives "2d8kh".
   *
   * @param {string} damage
   * @return {string}
   */
  static damageDie(damage) {
    let formula = String(damage ?? '').trim().replace(/^b\[(.*)\]$/i, '$1');
    formula = formula.replace(/(\s*[+-]\s*\d+)+$/, '').trim();
    return formula || 'd6';
  }

  /**
   * The Treasure table: the world's, else the one in the system's Tables
   * compendium (whose results have inline rolls), else the older one.
   *
   * @return {Promise<RollTable|null>}
   */
  static async findTable() {
    const name = 'treasure';
    const world = game.tables.find(t => t.name.trim().toLowerCase() == name);
    if (world) return world;
    for (const id of ['dungeonworld.tables', 'dungeonworld.rollable-tables']) {
      const pack = game.packs.get(id);
      const entry = pack?.index.find(e => e.name.trim().toLowerCase() == name);
      if (entry) return pack.getDocument(entry._id);
    }
    return null;
  }

  /**
   * Ask which modifiers apply, starting from the monster's tags, then roll.
   *
   * @param {Actor} actor An NPC.
   */
  static async prompt(actor) {
    const tags = DwTreasure.#tags(actor);
    const escape = (value) => Handlebars.escapeExpression(String(value ?? ''));
    const die = DwTreasure.damageDie(actor.system.attributes?.damage?.value);

    const content = document.createElement('div');
    content.innerHTML = `<p>${game.i18n.format('DW.Treasure.Intro', { name: escape(actor.name) })}</p>
      <div class="form-group">
        <label>${game.i18n.localize('DW.Treasure.Die')}</label>
        <input type="text" name="die" value="${escape(die)}">
      </div>
      <fieldset class="dw-treasure-modifiers">
        <legend>${game.i18n.localize('DW.Treasure.Modifiers')}</legend>
        ${DwTreasure.MODIFIERS.map(m => `
        <label class="checkbox">
          <input type="checkbox" name="${m.key}" ${m.tag && tags.has(m.tag) ? 'checked' : ''}>
          <span><strong>${game.i18n.localize(`DW.Treasure.${m.key}`)}</strong>: ${game.i18n.localize(`DW.Treasure.${m.key}Effect`)}</span>
        </label>`).join('')}
      </fieldset>`;

    const choices = await DialogV2.wait({
      classes: ['dw-treasure-dialog'],
      window: { title: game.i18n.localize('DW.Treasure.Title'), icon: 'fa-solid fa-gem' },
      position: { width: 460 },
      content,
      buttons: [
        { action: 'roll', label: 'DW.Treasure.Roll', icon: 'fa-solid fa-dice', default: true,
          callback: (event, button) => new FormDataExtended(button.form).object },
        { action: 'cancel', label: 'DW.Cancel', icon: 'fa-solid fa-xmark', callback: () => null },
      ],
      rejectClose: false,
    });
    if (choices && typeof choices == 'object') await DwTreasure.roll(actor, choices);
  }

  /**
   * Roll the treasure and post the table's result.
   *
   * @param {Actor} actor
   * @param {Object} choices The die to roll and which modifiers apply.
   */
  static async roll(actor, choices) {
    let die = String(choices.die ?? '').trim() || DwTreasure.damageDie(actor.system.attributes?.damage?.value);
    let formula = choices.hoarder ? `{${die}, ${die}}kh` : die;
    for (const modifier of DwTreasure.MODIFIERS) {
      if (modifier.dice && choices[modifier.key]) formula += ` + ${modifier.dice}`;
    }

    let roll;
    try {
      roll = await new Roll(formula).evaluate();
    }
    catch (error) {
      return ui.notifications.error(game.i18n.format('DW.Treasure.BadFormula', { formula }));
    }

    const notes = DwTreasure.MODIFIERS
      .filter(m => m.note && choices[m.key])
      .map(m => `<li>${game.i18n.localize(`DW.Treasure.${m.key}Note`)}</li>`);
    const flavor = `<strong>${game.i18n.format('DW.Treasure.Flavor', { name: Handlebars.escapeExpression(actor.name) })}</strong>`
      + (notes.length ? `<ul class="dw-treasure-notes">${notes.join('')}</ul>` : '');

    const table = await DwTreasure.findTable();
    if (!table) {
      return roll.toMessage({ flavor, speaker: ChatMessage.getSpeaker({ actor }) });
    }
    // The table runs to 18; anything higher is the best result.
    const ranges = table.results.map(r => r.range?.[1] ?? 0);
    const top = Math.max(...ranges, 1);
    const results = table.getResultsForRoll(Math.min(Math.max(roll.total, 1), top));
    return table.toMessage(results, {
      roll,
      messageData: { flavor, speaker: ChatMessage.getSpeaker({ actor }) },
    });
  }

  /** The monster's tags, lower case. */
  static #tags(actor) {
    let tags = [];
    try {
      tags = actor.system.tags ? JSON.parse(actor.system.tags) : [];
    } catch (e) {
      tags = [];
    }
    return new Set((Array.isArray(tags) ? tags : []).map(t => String(t?.value ?? t).trim().toLowerCase()));
  }
}
