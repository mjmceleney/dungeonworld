import { DwClassList } from "../config.js";
import { DwUtility } from "../utility.js";
import { DwRolls } from "../rolls.js";
import { DwLevelUp } from "./level-up.js";

const { TextEditor } = foundry.applications.ux;
const { renderTemplate } = foundry.applications.handlebars;

/**
 * Extend the basic ActorSheet with some very simple modifications
 * @extends {ActorSheet}
 */
export class DwActorSheet extends foundry.appv1.sheets.ActorSheet {

  /** @inheritdoc */
  constructor(...args) {
    super(...args);

    this.tagify = null;
  }

  /** @override */
  static get defaultOptions() {
    let options = foundry.utils.mergeObject(super.defaultOptions, {
      classes: ["dungeonworld", "sheet", "actor"],
      width: 840,
      height: 780,
      tabs: [{ navSelector: ".sheet-tabs", contentSelector: ".sheet-body", initial: "moves" }]
    });

    if (DwUtility.nightmode) {
      options.classes.push('nightmode');
    }

    return options;
  }

  /* -------------------------------------------- */

  /** @override */
  get template() {
    const path = "systems/dungeonworld/templates/sheet";
    return `${path}/${this.actor.type}-sheet.html`;
  }

  /* -------------------------------------------- */

  /** @inheritdoc */
  async close(options={}) {
    await super.close(options);

    if (this.tagify) this.tagify.destroy();
  }

  /* -------------------------------------------- */

  /** @override */
  async getData(options) {
    let isOwner = false;
    let isEditable = this.isEditable;
    let context = super.getData(options);
    let items = {};
    let effects = {};
    let actorData = {};

    isOwner = this.document.isOwner;
    isEditable = this.isEditable;

    // The Actor's data
    actorData = this.actor.toObject(false);
    context.actor = actorData;
    context.system = actorData.system;

    // Owned Items
    context.items = actorData.items;
    for ( let i of context.items ) {
      const item = this.actor.items.get(i._id);
      i.labels = item.labels;
    }
    context.items.sort((a, b) => (a.sort || 0) - (b.sort || 0));

    // Flags
    context.rollModes = {
      def: 'DW.Normal',
      adv: 'DW.Advantage',
      dis: 'DW.Disadvantage'
    };

    // Copy Active Effects
    // TODO: Test and refactor this.
    effects = this.object.effects.map(e => foundry.utils.deepClone(e));
    context.effects = effects;

    context.dtypes = ["String", "Number", "Boolean"];
    for (let attr of Object.values(context.system.attributes)) {
      attr.isCheckbox = attr.dtype === "Boolean";
    }

    // Prepare enrichment options.
    context.enrichmentOptions = {
      async: true,
      documents: true,
      secrets: this.actor.isOwner,
      rollData: this.actor.getRollData(),
      relativeTo: this.actor
    };

    // Prepare items, enrich fields, and load the class list concurrently.
    const details = context.system.details;
    const isCharacter = this.actor.type == 'character';
    const enrich = (text) => TextEditor.enrichHTML(text, context.enrichmentOptions);
    const [biographyEnriched, classlist, lookEnriched, alignmentEnriched, raceEnriched] = await Promise.all([
      enrich(details.biography),
      isCharacter ? DwClassList.getClasses() : null,
      isCharacter ? enrich(details.look) : null,
      isCharacter ? enrich(details.alignment.description) : null,
      isCharacter ? enrich(details.race.description) : null,
      this._prepareCharacterItems(context),
      this._prepareNpcItems(context),
    ]);

    // Enrich the bio field.
    details.biographyEnriched = biographyEnriched;

    // Add classlist.
    if (isCharacter) {
      context.system.classlist = classlist;

      let xpSvg = {
        radius: 16,
        circumference: 100,
        offset: 100,
      };

      // Handle enriched fields.
      details.lookEnriched = lookEnriched;
      details.alignment.enriched = alignmentEnriched;
      details.race.enriched = raceEnriched;

      // Set a warning for tokens.
      context.system.isToken = this.actor.token != null;
      if (!context.system.isToken) {
        // Add levelup choice.
        let level = context.system.attributes.level.value ?? 1;
        let xpRequired = context.system.attributes.xp.max ?? Number(level) + 7;
        context.xpRequired = xpRequired;
        let levelup = Number(context.system.attributes.xp.value) >= xpRequired && Number(level) < 10;

        // Handle the first level (special case).
        if (Number(level) === 1) {
          let hasStarting = context.startingMoves.length > 0;
          if (!hasStarting) {
            levelup = true;
          }
        }

        // Set the template variable.
        context.system.levelup = levelup && context.system.classlist.includes(context.system.details.class);

        // Calculate xp bar length.
        let currentXp = Number(context.system.attributes.xp.value);
        let nextLevel = Number(context.system.attributes.xp.max);
        xpSvg = DwUtility.getProgressCircle({ current: currentXp, max: nextLevel, radius: 16 });
      }
      else {
        context.system.levelup = false;
      }

      context.system.xpSvg = xpSvg;
    }

    // Stats.
    context.system.statSettings = {
      'str': 'DW.STR',
      'dex': 'DW.DEX',
      'con': 'DW.CON',
      'int': 'DW.INT',
      'wis': 'DW.WIS',
      'cha': 'DW.CHA'
    };

    // Add item icon setting.
    context.system.itemIcons = game.settings.get('dungeonworld', 'itemIcons');

    // Check if ability scores are disabled
    context.system.noAbilityScores = game.settings.get('dungeonworld', 'noAbilityScores');

    // Setup select options.
    context.selects = {};
    if (this.actor.type == 'character') {
      context.selects.damages = {
        d4: 'd4',
        d6: 'd6',
        d8: 'd8',
        d10: 'd10',
        d12: 'd12',
      };
    }

    // Return data to the sheet
    let returnData = {
      actor: this.object,
      cssClass: isEditable ? "editable" : "locked",
      editable: isEditable,
      system: context.system,
      moves: context.moves,
      rollModes: context.rollModes,
      basicMoves: context.basicMoves,
      advancedMoves: context.advancedMoves,
      startingMoves: context.startingMoves,
      specialMoves: context.specialMoves,
      equipment: context.equipment,
      spells: context.spells,
      bonds: context.bonds,
      effects: effects,
      items: items,
      flags: this.object?.flags,
      selects: context.selects,
      limited: this.object.limited,
      options: this.options,
      owner: isOwner,
      title: this.title,
      xpRequired: context.xpRequired,
      rollData: context.enrichmentOptions.rollData
    };

    // Return template data
    return returnData;
  }

  /**
   * Organize and classify Items for Character sheets.
   *
   * @param {Object} actorData The actor to prepare.
   *
   * @return {undefined}
   */
  async _prepareCharacterItems(sheetData) {
    // Exit early if this isn't a character.
    if (sheetData.actor.type !== 'character') return;

    const actorData = sheetData.actor;
    const secrets = this.actor.isOwner;

    // Enrichment runs concurrently; each call stores its result on the target.
    const enrichments = [];
    const enrich = (target, key, text, options) => {
      enrichments.push(TextEditor.enrichHTML(text, options).then(html => target[key] = html));
    };

    // Initialize containers.
    const moves = [];
    const basicMoves = [];
    const startingMoves = [];
    const advancedMoves = [];
    const specialMoves = [];
    const equipment = [];
    const bonds = [];
    const spells = {
      0: [],
      1: [],
      3: [],
      5: [],
      7: [],
      9: []
    };

    // Iterate through items, allocating to containers
    // let totalWeight = 0;
    for (let i of sheetData.items) {
      const item = this.actor.items.get(i._id);
      const enrichmentOptions = {
        async: true,
        documents: true,
        secrets: secrets,
        relativeTo: item,
        rollData: item.getRollData(),
      };
      if (i.system?.description) {
        enrich(i.system, 'descriptionEnriched', i.system.description, enrichmentOptions);
      }

      i.img = i.img || DEFAULT_TOKEN;
      // If this is a move, sort into various arrays.
      if (i.type === 'move') {
        enrich(i.system, 'choicesEnriched', i.system.choices, enrichmentOptions);
        for (let v of Object.values(i.system.moveResults)) {
          enrich(v, 'enriched', v.value, enrichmentOptions);
        }

        switch (i.system.moveType) {
        case 'basic':
          basicMoves.push(i);
          break;

        case 'starting':
          startingMoves.push(i);
          break;

        case 'advanced':
          advancedMoves.push(i);
          break;

        case 'special':
          specialMoves.push(i);
          break;

        default:
          moves.push(i);
          break;
        }
      }
      else if (i.type === 'spell') {
        if (i.system.spellLevel != undefined) {
          spells[i.system.spellLevel].push(i);
        }
      }
      // If this is equipment, we currently lump it together.
      else if (i.type === 'equipment') {
        equipment.push(i);
      }
      else if (i.type === 'bond') {
        enrich(i, 'nameEnriched', i.name, enrichmentOptions);
        bonds.push(i);
      }
    }
    await Promise.all(enrichments);

    // Assign and return
    sheetData.moves = moves;
    sheetData.basicMoves = basicMoves;
    sheetData.startingMoves = startingMoves;
    sheetData.advancedMoves = advancedMoves;
    sheetData.specialMoves = specialMoves;
    // Spells
    sheetData.spells = spells;
    // Equipment
    sheetData.equipment = equipment;
    // Bonds
    sheetData.bonds = bonds;
  }

  /**
   * Prepare tagging.
   *
   * @param {Object} actorData The actor to prepare.
   */
  async _prepareNpcItems(sheetData) {
    // Exit early if this isn't an npc.
    if (sheetData.actor.type != 'npc') return;

    // If there are tags, convert it into a string.
    if (sheetData.system.tags != undefined && sheetData.system.tags != '') {
      let tagArray = [];
      try {
        tagArray = JSON.parse(sheetData.system.tags);
      } catch (e) {
        tagArray = [sheetData.system.tags];
      }
      sheetData.system.tagsString = tagArray.map((item) => {
        return item.value;
      }).join(', ');
    }
    // Otherwise, set tags equal to the string.
    else {
      sheetData.system.tags = sheetData.system.tagsString;
    }

    const actorData = sheetData.actor;
    const secrets = this.actor.isOwner;
    const enrichments = [];

    // Initialize containers.
    const moves = [];
    const basicMoves = [];
    const specialMoves = [];

    // Iterate through items, allocating to containers
    // let totalWeight = 0;
    for (let i of sheetData.items) {
      const item = this.actor.items.get(i._id);
      if (i.system?.description) {
        const enrichmentOptions = {
          async: true,
          documents: true,
          secrets: secrets,
          relativeTo: item,
          rollData: item.getRollData(),
        };
        enrichments.push(TextEditor.enrichHTML(i.system.description, enrichmentOptions).then(html => i.system.descriptionEnriched = html));
      }

      i.img = i.img || DEFAULT_TOKEN;
      // If this is a move, sort into various arrays.
      if (i.type === 'npcMove') {
        switch (i.system.moveType) {
        case 'basic':
          basicMoves.push(i);
          break;

        case 'special':
          specialMoves.push(i);
          break;

        default:
          moves.push(i);
          break;
        }
      }
    }

    await Promise.all(enrichments);

    // Assign and return
    sheetData.moves = moves;
    sheetData.basicMoves = basicMoves;
    sheetData.specialMoves = specialMoves;
  }

  /* -------------------------------------------- */

  /** @override */
  activateListeners(html) {
    super.activateListeners(html);

    if (this.actor.type == 'npc') {
      this._activateTagging(html);
    }

    if (!this.options.editable) return;

    // Rollables.
    html.find('.rollable').on('click', this._onRollable.bind(this));

    // Toggle look.
    html.find('.toggle--look').on('click', this._toggleLook.bind(this, html));

    // Owned Item management
    html.find('.item-create').click(this._onItemCreate.bind(this));
    html.find('.item-edit').click(this._onItemEdit.bind(this));
    html.find('.item-delete').click(this._onItemDelete.bind(this));
    html.find('.item-equip').click(this._onEquipEquipment.bind(this));

    // Moves
    html.find('.item-label').click(this._showItemDetails.bind(this));

    // Spells.
    html.find('.prepared').click(this._onPrepareSpell.bind(this));

    // Adjust quantity/uses.
    html.find('.counter').on('click', event => this._onCounterClick(event, 'increase'));
    html.find('.counter').on('contextmenu', event => this._onCounterClick(event, 'decrease'));

    // Resources.
    html.find('.resource-control').click(this._onResouceControl.bind(this));

    // Adjust weight.
    this._adjustWeight(html);

    // Character builder dialog.
    html.find('.clickable-level-up').on('click', this._onLevelUp.bind(this));

    //class viewer
    html.find('.clickable-class-viewer').on('click', this._onClassView.bind(this));

    let isOwner = this.document.isOwner;
    if (isOwner) {
      /* Item Dragging */
      // Core handlers from foundry.js
      var handler;
      handler = ev => this._onDragStart(ev);
      html.find('li.item').each((i, li) => {
        if (li.classList.contains("inventory-header")) return;
        li.setAttribute("draggable", true);
        li.addEventListener("dragstart", handler, false);
      });
    }
  }

  /* -------------------------------------------- */

  _adjustWeight(html) {
    // Adjust weight.
    let $weight = html.find('[name="system.attributes.weight.value"]');
    let $weight_cell = html.find('.cell--weight');
    if ($weight.length > 0) {
      let weight = {
        current: Number($weight.val()),
        max: Number(html.find('[name="system.attributes.weight.max"]').val())
      };
      if (weight.current > weight.max) {
        $weight_cell.addClass('encumbered');

        if (weight.current > weight.max + 2) {
          $weight_cell.addClass('overencumbered');
        }
        else {
          $weight_cell.removeClass('overencumbered');
        }
      }
      else {
        $weight.removeClass('encumbered');
      }
    }
  }

  _onResouceControl(event) {
    event.preventDefault();
    const control = $(event.currentTarget);
    const action = control.data('action');
    const attr = control.data('attr');
    // If there's an action and target attribute, update it.
    if (action && attr) {
      // Initialize data structure.
      let system = {};
      let changed = false;
      // Retrieve the existin value.
      system[attr] = Number(foundry.utils.getProperty(this.actor.system, attr));
      // Decrease the value.
      if (action == 'decrease') {
        system[attr] -= 1;
        changed = true;
      }
      // Increase the value.
      else if (action == 'increase') {
        system[attr] += 1;
        changed = true;
      }
      // If there are changes, apply to the actor.
      if (changed) {
        this.actor.update({ system: system });
      }
    }
  }

  _showItemDetails(event) {
    event.preventDefault();
    const toggler = $(event.currentTarget);
    const toggleIcon = toggler.find('i');
    const item = toggler.parents('.item');
    const description = item.find('.item-description');

    toggler.toggleClass('open');
    description.slideToggle();
  }

  async _onLevelUp(event) {
    return new DwLevelUp(this.actor)._onLevelUp(event);
  }

  async _onClassView(event) {
    return new DwLevelUp(this.actor)._onClassView(event);
  }

  /**
   * Listen for click events on spells.
   * @param {MouseEvent} event
   */
  async _onPrepareSpell(event) {
    event.preventDefault();
    const a = event.currentTarget;
    const data = a.dataset;
    const actorData = this.actor.system;
    const itemId = $(a).parents('.item').attr('data-item-id');
    const item = this.actor.items.get(itemId);

    if (item) {
      let $self = $(a);
      $self.toggleClass('unprepared');

      let update = { "system.prepared": !item.system.prepared };
      await item.update(update, {});
    }
  }

  /**
   * Listen for click events on equipment.
   * @param {MouseEvent} event
   */
  async _onEquipEquipment(event) {
    event.preventDefault();
    const a = event.currentTarget;
    const data = a.dataset;
    const actorData = this.actor.system;
    const itemId = $(a).parents('.item').attr('data-item-id');
    const item = this.actor.items.get(itemId);

    if (item) {
      let $self = $(a);
      $self.toggleClass('unequipped');

      let update =
      { "system.equipped": !item.system.equipped };
      await item.update(update, {});
    }
  }

  /**
   * Listen for click events on quantity/uses.
   * @param {MouseEvent} event
   */
  async _onCounterClick(event, changeType = 'increase') {
    event.preventDefault();
    const a = event.currentTarget;
    const dataset = a.dataset;
    const actorData = this.actor.system;
    const itemId = $(a).parents('.item').attr('data-item-id');
    const item = this.actor.items.get(itemId);

    if (!dataset.action || !item) return;

    let offset = changeType == 'increase' ? 1 : -1;
    let update = {};

    switch (dataset.action) {
    case 'uses':
      let uses = item.system?.uses ?? 0;
      update['system.uses'] = Number(uses) + offset;
      break;

    case 'quantity':
      let quantity = item.system?.quantity ?? 0;
      update['system.quantity'] = Number(quantity) + offset;
      break;

    default:
        break;
    }

    await item.update(update, {});
  }

  /**
   * Listen for click events on rollables.
   * @param {MouseEvent} event
   */
  async _onRollable(event) {
    // Initialize variables.
    event.preventDefault();
    const a = event.currentTarget;
    const data = a.dataset;
    const actorData = this.actor.system;
    const itemId = $(a).parents('.item').attr('data-item-id');
    const item = this.actor.items.get(itemId);
    let formula = null;
    let titleText = null;
    let flavorText = null;
    let templateData = {};

    // Handle rolls coming directly from the ability score.
    if ($(a).hasClass('ability-rollable') && data.roll) {
      formula = data.roll;
      flavorText = data.label;
      if (data.debility) {
        flavorText += ` (${data.debility})`;
      }

      templateData = {
        title: flavorText
      };

      // this.rollMove(formula, actorData, data, templateData);
      DwRolls.rollMove({actor: this.actor, data: null, formula: formula, templateData: templateData});
    }
    else if ($(a).hasClass('damage-rollable') && data.roll) {
      formula = data.roll;
      titleText = data.label;
      flavorText = data.flavor;
      templateData = {
        title: titleText,
        flavor: flavorText,
        rollType: 'damage'
      };

      DwRolls.rollMove({actor: this.actor, data: null, formula: formula, templateData: templateData});
    }
    else if (itemId != undefined) {
      await item.roll();
    }
  }

  /**
   * Listen for toggling the look column.
   * @param {MouseEvent} event
   */
  async _toggleLook(html, event) {
    // Add a class to the sidebar.
    html.find('.sheet-look').toggleClass('closed');

    // Add a class to the toggle button.
    let $look = html.find('.toggle--look');
    $look.toggleClass('closed');

    // Update flags.
    let closed = $look.hasClass('closed');
    await this.actor.update({'flags.dungeonworld.sheetDisplay.sidebarClosed': closed});
  }

  /* -------------------------------------------- */
  /**
   * Handle creating a new Owned Item for the actor using initial data defined in the HTML dataset
   * @param {Event} event   The originating click event
   * @private
   */
  async _onItemCreate(event) {
    event.preventDefault();
    const header = event.currentTarget;
    const type = header.dataset.type;
    const data = foundry.utils.duplicate(header.dataset);
    data.moveType = data.movetype;
    data.spellLevel = data.level;
    const name = type == 'bond' ? game.i18n.localize("DW.BondDefault") : `New ${type.capitalize()}`;
    const itemData = {
      name: name,
      type: type,
      system: data
    };
    delete itemData.system["type"];
    await this.actor.createEmbeddedDocuments('Item', [itemData], {});
  }

  /* -------------------------------------------- */

  /**
   * Handle editing an existing Owned Item for the Actor
   * @param {Event} event   The originating click event
   * @private
   */
  _onItemEdit(event) {
    event.preventDefault();
    const li = event.currentTarget.closest(".item");
    const item = this.actor.items.get(li.dataset.itemId);
    item.sheet.render(true);
  }

  /* -------------------------------------------- */

  /**
   * Handle deleting an existing Owned Item for the Actor
   * @param {Event} event   The originating click event
   * @private
   */
  _onItemDelete(event) {
    event.preventDefault();
    const li = event.currentTarget.closest(".item");
    let item = this.actor.items.get(li.dataset.itemId);
    item.delete();
  }

  /* -------------------------------------------- */

  async _activateTagging(html) {
    // Build the tags list.
    let tags = game.items.filter(item => item.type == 'tag').map(item => item.name);
    for (let c of game.packs) {
      if (c.metadata.type && c.metadata.type == 'Item' && c.metadata.name == 'tags') {
        let items = c?.index ? c.index.map(indexedItem => {
          return indexedItem.name;
        }) : [];
        tags = tags.concat(items);
      }
    }
    // Reduce duplicates.
    let tagNames = [...new Set(tags.map(tag => tag.toLowerCase()))];

    // Sort the tagnames list.
    tagNames.sort((a, b) => {
      const aSort = a.toLowerCase();
      const bSort = b.toLowerCase();
      if (aSort < bSort) {
        return -1;
      }
      if (aSort > bSort) {
        return 1;
      }
      return 0;
    });

    // Tagify!
    var $input = html.find('.tags-input-source');
    if (!this.isEditable) $input.prop('readonly', true);
    if ($input.length > 0) {
      // init Tagify script on the above inputs
      this.tagify = new Tagify($input[0], {
        whitelist: tagNames,
        maxTags: 'Infinity',
        dropdown: {
          maxItems: 20,           // <- mixumum allowed rendered suggestions
          classname: "tags-look", // <- custom classname for this dropdown, so it could be targeted
          enabled: 0,             // <- show suggestions on focus
          closeOnSelect: false    // <- do not hide the suggestions dropdown once an item has been selected
        }
      });

      // @todo this version of tagify updates has a strange race condition.
      // We've temporarily switched to just using the `system.tags` name prop.

      // // Update document with the changes.
      // this.tagify.on('change', e => {
      //   // Grab the raw tags.
      //   let newTags = e.detail.value;
      //   // Parse it into a string.
      //   let tagArray = [];
      //   try {
      //     tagArray = JSON.parse(newTags);
      //   } catch (e) {
      //     tagArray = [newTags];
      //   }
      //   let newTagsString = tagArray.map((item) => {
      //     return item.value;
      //   }).join(', ');

      //   // Apply the update.
      //   this.document.update({
      //     'system.tags': newTags,
      //     'system.tagsString': newTagsString
      //   }, {render: false});
      // });
    }
  }
}
