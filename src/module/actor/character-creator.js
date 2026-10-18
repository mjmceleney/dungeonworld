import { DwClassList } from "../config.js";
import { DwUtility } from "../utility.js";
import { DwLevelUp } from "./level-up.js";

const { HandlebarsApplicationMixin, ApplicationV2 } = foundry.applications.api;
const { FormDataExtended, TextEditor } = foundry.applications.ux;

/**
 * The first steps of making a character: a name, a class and a look. Then
 * the level 1 builder (the level up window) takes over for race, alignment,
 * ability scores, gear, moves, spells and bonds, and finally the bonds'
 * blanks are filled in with the other characters.
 */
export class DwCharacterCreator extends HandlebarsApplicationMixin(ApplicationV2) {

  /**
   * @param {Actor} actor A new character.
   * @param {Object} options
   */
  constructor(actor, options = {}) {
    super(options);
    this.actor = actor;
    /** Choices so far, kept across re-renders when the class changes. */
    this.choices = {
      name: actor.name,
      className: actor.system.details.class ?? '',
      look: {},
      lookText: '',
    };
  }

  /** @override */
  static DEFAULT_OPTIONS = {
    tag: "form",
    classes: ["dw-v2", "dw-levelup-window", "dw-creator"],
    position: {
      width: 900,
      height: 760,
    },
    window: {
      resizable: true,
      icon: "fa-solid fa-user-plus",
    },
    form: {
      handler: DwCharacterCreator.#onSubmit,
      closeOnSubmit: true,
    },
    actions: {
      cancel: function() { this.close(); },
    },
  };

  /** @override */
  static PARTS = {
    body: {
      template: "systems/dungeonworld/templates/dialog/character-creator.html",
      scrollable: [".dw-levelup-body"],
    },
  };

  /** @override */
  get title() {
    return game.i18n.format('DW.Creator.Title', { name: this.actor.name });
  }

  /** @inheritdoc */
  _initializeApplicationOptions(options) {
    options = super._initializeApplicationOptions(options);
    let dark = DwUtility.nightmode;
    if (options.classes.includes('theme-dark')) dark = true;
    else if (options.classes.includes('theme-light')) dark = false;
    if (dark) options.classes.push('dw-dark');
    return options;
  }

  /**
   * A class's look options: one group per line, options separated by commas
   * or "or".
   *
   * @param {string} text
   * @return {string[][]}
   */
  static parseLooks(text) {
    return String(text ?? '').split(/\r?\n/)
      .map(line => line.split(/\s*,\s*(?:or\s+)?|\s+or\s+/i).map(s => s.trim()).filter(Boolean))
      .filter(group => group.length);
  }

  /** @override */
  async _prepareContext(options) {
    const all = await DwClassList.getClasses(false);
    // Secret classes aren't something you start as (as with multiclassing),
    // so no one is offered them here. A GM can still set one on the sheet.
    const classes = all.filter(c => !c.system.secret);
    const chosen = classes.find(c => c.name == this.choices.className) ?? null;

    const summaries = await Promise.all(classes.map(async c => {
      // The first paragraph of the class's description is enough to choose by.
      const html = await TextEditor.implementation.enrichHTML(c.system.description ?? '', { relativeTo: c });
      const doc = new DOMParser().parseFromString(html, 'text/html');
      const first = [...doc.querySelectorAll('p')].map(p => p.textContent.trim()).find(Boolean) ?? '';
      return {
        name: c.name,
        label: c.name.replace(/^the\s+/i, ''),
        img: c.img,
        checked: c === chosen,
        blurb: first.length > 260 ? `${first.slice(0, 257).trim()}…` : first,
        hp: c.system.hp,
        damage: c.system.damage,
        load: c.system.load,
      };
    }));

    const looks = chosen ? DwCharacterCreator.parseLooks(chosen.system.looks).map((options, index) => ({
      index,
      options: options.map(option => ({ value: option, checked: this.choices.look[index] == option })),
    })) : [];

    return {
      choices: this.choices,
      classes: summaries,
      chosen: chosen ? chosen.name.replace(/^the\s+/i, '') : '',
      looks,
      noClasses: !classes.length,
    };
  }

  /** Remember what's been chosen, so a re-render keeps it. */
  #remember() {
    const data = foundry.utils.expandObject(new FormDataExtended(this.element).object);
    this.choices.name = String(data.name ?? this.choices.name);
    this.choices.lookText = String(data.lookText ?? '');
    this.choices.look = data.look ?? {};
    const className = data.className ?? this.choices.className;
    const changed = className != this.choices.className;
    this.choices.className = className;
    // Another class has other looks.
    if (changed) this.choices.look = {};
    return changed;
  }

  /** @inheritdoc */
  _onRender(context, options) {
    super._onRender(context, options);
    for (const input of this.element.querySelectorAll('input[name="className"]')) {
      input.addEventListener('change', () => {
        if (this.#remember()) this.render();
      });
    }
  }

  /**
   * Save the name, class and look, then open the level 1 builder.
   * @this {DwCharacterCreator}
   */
  static async #onSubmit(event, form, formData) {
    this.#remember();
    const { name, className, look, lookText } = this.choices;
    // Throwing keeps the window open; the message is shown to the user.
    if (!className) throw new Error(game.i18n.localize('DW.Creator.NoClass'));
    const picks = Object.keys(look).sort((a, b) => a - b).map(key => look[key]).filter(Boolean);
    const lookParts = [...picks, lookText.trim()].filter(Boolean);
    const update = {
      'system.details.class': className,
    };
    if (name.trim()) update.name = name.trim();
    if (lookParts.length) update['system.details.look'] = `<p>${Handlebars.escapeExpression(lookParts.join(', '))}</p>`;
    await this.actor.update(update);

    // The builder needs the class's name exactly as the class list has it.
    const levelUp = new DwLevelUp(this.actor);
    levelUp._onLevelUp({ preventDefault() {}, currentTarget: null });
  }
}
