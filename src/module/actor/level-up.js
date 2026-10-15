import { DwClassList } from "../config.js";
import { DwUtility } from "../utility.js";

const { renderTemplate } = foundry.applications.handlebars;

/**
 * The level up and class viewer dialogs for a character.
 *
 * Shared by the character sheets, so each sheet only needs to create an
 * instance for its actor and call _onLevelUp() or _onClassView().
 */
export class DwLevelUp {

  /**
   * @param {Actor} actor The character to level up or view the class of.
   */
  constructor(actor) {
    this.actor = actor;
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
    event.preventDefault();

    if ($(event.currentTarget).hasClass('disabled-level-up')) {
      return;
    }

    const actor = this.actor;
    const actorData = this.actor.system;
    let orig_class_name = actorData.details.class;
    let char_class_name = orig_class_name.trim();
    let class_list_items = await DwClassList.getClasses(false);
    let class_list = class_list_items.map(c => c.name);

    let char_class = DwUtility.cleanClass(char_class_name);
    let char_level = Number(actorData.attributes.level.value);

    // Handle level 1 > 2.
    if (actorData.attributes.xp.value != 0) {
      char_level = char_level + 1;
    }

    // Get the original class name if this was a translation.
    if (game.babele) {
      let babele_classes = game.babele.translations.find(p => p.collection == 'dungeonworld.classes');
      if (babele_classes) {
        let babele_pack = babele_classes.entries.find(p => p.name == char_class_name);
        if (babele_pack) {
          char_class_name = babele_pack.id;
          char_class = DwUtility.cleanClass(babele_pack.id);
        }
      }
    }

    if (!class_list.includes(orig_class_name) && !class_list.includes(char_class_name)) {
      ui.notifications.warn(game.i18n.localize('DW.Notifications.noClassWarning'));
      return;
    }


    const compendium = await DwUtility.loadCompendia(`${char_class}-moves`)

    let class_item = class_list_items.find(i => i.name == orig_class_name);
    if (!class_item?.system) {
      ui.notifications.warn(game.i18n.localize('DW.Notifications.noClassWarning'));
      return;
    }
    let blurb = class_item ? class_item.system.description : null;

    // Get races.
    let races = [];
    if (!this.actor.system.details.race.value || !this.actor.system.details.race.description) {
      races = class_item.system.races;
      if (typeof races == 'object') {
        races = Object.entries(races).map(r => {
          return {
            key: r[0],
            label: r[1]['label'],
            description: r[1]['description']
          };
        });
      }
    }

    // Get alignments.
    let alignments = [];
    if (!this.actor.system.details.alignment.value || !this.actor.system.details.alignment.description) {
      alignments = class_item.system.alignments;
      if (typeof alignments == 'object') {
        alignments = Object.entries(alignments).map(a => {
          return {
            key: a[0],
            label: a[1]['label'],
            description: a[1]['description']
          };
        });
      }
    }

    // Get equipment.
    let equipment = null;
    let equipment_list = [];
    if (actorData.attributes.xp.value == 0) {
      if (typeof class_item.system.equipment == 'object') {
        let equipmentObjects = await class_item._getEquipmentObjects();
        for (let [group, group_items] of Object.entries(equipmentObjects)) {
          class_item.system.equipment[group]['objects'] = group_items;
          equipment_list = equipment_list.concat(group_items);
        }
        equipment = foundry.utils.duplicate(class_item.system.equipment);
      }
    }

    // Get ability scores.
    const noAbilityScores = game.settings.get('dungeonworld', 'noAbilityScores');
    let ability_scores = [16, 15, 13, 12, 9, 8];
    if (noAbilityScores) {
      ability_scores = [2, 1, 1, 0, 0, -1];
    }
    let ability_labels = Object.entries(CONFIG.DW.abilities).map(a => {
      return {
        short: a[0],
        long: a[1],
        disabled: Number(this.actor.system.abilities[a[0]].value) > 17
      }
    });

    // Retrieve the actor's current moves so that we can hide them.
    const actorMoves = this.actor.items.filter(i => i.type == 'move');

    // Get the item moves as the priority.
    let moves = game.items.filter(m => {
      if (m.type == 'move' && m.system.class == char_class_name) {
        const available_level = m.system.requiresLevel <= char_level;
        const not_taken = actorMoves.filter(i => i.name == m.name);
        const has_requirements = m.system.requiresMove ? actorMoves.filter(i => i.name == m.system.requiresMove).length > 0 : true;
        return available_level && not_taken.length < 1 && has_requirements;
      }
      return false;
    });
    // Get the compendium moves next.
    let moves_compendium = compendium.filter(m => {
      const available_level = m.system.requiresLevel <= char_level;
      // TODO: Babele: `const not_taken = actorMoves.filter(i => i.name == m.name || i.name === m.originalName);`
      const not_taken = actorMoves.filter(i => i.name == m.name);
      const has_requirements = m.system.requiresMove ? actorMoves.filter(i => i.name == m.system.requiresMove).length > 0 : true;
      return available_level && not_taken.length < 1 && has_requirements;
    });

    // Append compendium moves to the item moves.
    let moves_list = moves.map(m => {
      return m.name;
    })
    for (let move of moves_compendium) {
      if (!moves_list.includes(move.name)) {
        moves.push(move);
      }
    }

    // Sort the moves and build our groups.
    moves.sort((a, b) => {
      return a.system.requiresLevel - b.system.requiresLevel;
    });

    let starting_moves = [];
    let starting_move_groups = [];
    if (char_level < 2) {
      starting_moves = moves.filter(m => {
        return m.system.requiresLevel < 2;
      });

      starting_move_groups = starting_moves.reduce((groups, move) => {
        // Assign the undefined group to all Z's so that it's last.
        let group = move.system.moveGroup ? move.system.moveGroup : 'ZZZZZZZ';
        if (!groups[group]) {
          groups[group] = [];
        }

        groups[group].push(move);
        return groups;
      }, {});
    }

    let advanced_moves_2 = moves.filter(m => {
      return m.system.requiresLevel >= 2 && m.system.requiresLevel < 6;
    });

    let advanced_moves_6 = moves.filter(m => {
      return m.system.requiresLevel >= 6;
    });

    // Determine if spells can be cast.
    let cast_spells = [];
    let spells = null;
    if (char_class == 'the-wizard') {
      cast_spells.push('wizard');
    }
    else if (char_class == 'the-cleric') {
      cast_spells.push('cleric');
    }
    else {
      cast_spells.push(char_class);
    }

    if (cast_spells.length > 0) {
      // Retrieve the actor's current moves so that we can hide them.
      const actorSpells = this.actor.items.filter(i => i.type == 'spell');
      let caster_level = char_level;
      let spell_preparation_type = null;
      spells = [];
      for (let caster_class of cast_spells) {
        // Get the item spells as the priority.
        let spells_items = game.items.filter(i => {
          // Return true for custom spell items that have a class.
          return i.type == 'spell'
            && i.system.class
          // Check if this spell has either `classname` or `the classname` as its class.
            && [caster_class, `the ${caster_class}`].includes(DwUtility.cleanClass(i.system.class));
        });
        const spells_compendium = await DwUtility.loadCompendia(`${char_class}-spells`);

        // Get the compendium spells next.
        let spells_compendium_items = spells_compendium.filter(s => {
          const available_level = s.system.spellLevel <= caster_level;
          const not_taken = actorSpells.filter(i => i.name == s.name);
          return available_level && not_taken.length < 1;
        });

        // Append compendium spells to the item spells.
        let spells_list = spells.map(s => {
          return s.name;
        })
        // Add to the array, and also add to a sorted by level array.
        for (let spell of spells_compendium_items) {
          if (!spells_list.includes(spell.name)) {
            spells_items.push(spell);
          }
        }

        // Skip this class if there were no spells in it.
        if (spells_items.length < 1) {
          continue;
        }

        // Sort the spells and build our groups.
        spells_items.sort((a, b) => {
          return a.system.spellLevel - b.system.spellLevel;
        });

        let spell_groups = spells_items.reduce((groups, spell) => {
          // Default to rotes.
          let group = spell.system.spellLevel ? spell.system.spellLevel : 0;
          if (!groups[group]) {
            groups[group] = [];
          }

          groups[group].push(spell);
          return groups;
        }, {});

        // Get the description for how to prepare spells for this class.
        if (caster_class == 'wizard') {
          let move = moves.filter(m => m.name == 'Spellbook');
          if (move && move.length > 0) {
            spell_preparation_type = move[0].system.description;
          }
          else {
            move = actorMoves.filter(m => m.name == 'Spellbook');
            if (move && move.length > 0) {
              // @todo: v10 test this.
              spell_preparation_type = move[0].system.description;
            }
          }
        }
        else if (caster_class == 'cleric') {
          let move = moves.filter(m => m.name == 'Commune');
          if (move && move.length > 0) {
            spell_preparation_type = move[0].system.description;
          }
          else {
            move = actorMoves.filter(m => m.name == 'Commune');
            if (move && move.length > 0) {
              // @todo: v10 test this.
              spell_preparation_type = move[0].system.description;
            }
          }
        }

        spells.push({
          description: spell_preparation_type,
          spells: spell_groups
        });
      }
    }

    // Build the content.
    const template = 'systems/dungeonworld/templates/dialog/level-up.html';
    const templateData = {
      char_class: char_class,
      char_class_name: orig_class_name,
      blurb: blurb.length > 0 ? blurb : null,
      races: races.length > 0 ? races : null,
      alignments: alignments.length > 0 ? alignments : null,
      equipment: equipment ? equipment : null,
      ability_scores: actorData.attributes.xp.value == 0 ? ability_scores : null,
      ability_mods_only: noAbilityScores,
      ability_labels: ability_labels ? ability_labels : null,
      starting_moves: starting_moves.length > 0 ? starting_moves : null,
      starting_move_groups: starting_move_groups,
      advanced_moves_2: advanced_moves_2.length > 0 ? advanced_moves_2 : null,
      advanced_moves_6: advanced_moves_6.length > 0 ? advanced_moves_6 : null,
      cast_spells: cast_spells.length > 0 && spells.length > 0 ? true : false,
      spells: spells.length > 0 ? spells : null,
      no_ability_increase: game.settings.get('dungeonworld', 'noAbilityIncrease'),
    };
    const html = await renderTemplate(template, templateData);

    const itemData = {
      moves: moves,
      races: races,
      alignments: alignments,
      equipment: equipment_list,
      class_item: class_item,
      spells: spells,
    };

    // Initialize dialog options.
    const dlg_options = {
      width: 920,
      height: 640,
      classes: ['dw-level-up', 'dungeonworld', 'sheet'],
      resizable: true
    };

    if (DwUtility.nightmode) {
      dlg_options.classes.push('nightmode');
    }

    // Render the dialog.
    let d = new Dialog({
      title: 'Level Up',
      content: html,
      id: 'level-up',
      buttons: {
        cancel: {
          icon: '<i class="fas fa-times"></i>',
          label: game.i18n.localize("DW.Cancel"),
          callback: () => null
        },
        submit: {
          icon: '<i class="fas fa-check"></i>',
          label: game.i18n.localize("DW.Confirm"),
          callback: dlg => this._onLevelUpSave(dlg, this.actor, itemData, this)
          // callback: dlg => _onImportPower(dlg, this.actor)
        }
      },
      render: () => {
        $('.dw-level-up').find('.item-label').click(this._showItemDetails.bind(this));
      }
    }, dlg_options);
    d.render(true);
  }

  /**
   * Import moves.
   */
  async _onLevelUpSave(dlg, actor, itemData) {
    let $selected = $(dlg[0]).find('input:checked,select');

    if ($selected.length <= 0) {
      return;
    }

    let move_ids = [];
    let equipment_ids = [];
    let spell_ids = [];
    let abilities = [];
    let race = null;
    let alignment = null;
    for (let input of $selected) {
      if (input.dataset.itemId) {
        if (input.dataset.type == 'move') {
          move_ids.push(input.dataset.itemId);
        }
        else if (input.dataset.type == 'equipment') {
          equipment_ids.push(input.dataset.itemId);
        }
        else if (input.dataset.type == 'spell') {
          spell_ids.push(input.dataset.itemId);
        }
      }
      else if (input.dataset.race) {
        race = itemData.races[input.dataset.race];
      }
      else if (input.dataset.alignment) {
        alignment = itemData.alignments[input.dataset.alignment];
      }
      else if (input.dataset.ability) {
        let val = $(input).find('option:selected').val();
        let abl = input.dataset.ability;
        if (val != null) {
          abilities[`abilities.${abl}.value`] = val;
        }
      }
      else if (input.dataset.type == 'ability-increase') {
        let abl = $(input).val();
        abilities[`abilities.${abl}.value`] = Number(actor.system.abilities[abl].value) + 1;
      }
    }

    // Add selected moves.
    let new_moves = null;
    if (move_ids.length > 0) {
      let moves = itemData.moves.filter(m => move_ids.includes(m.id));

      // Prepare moves for saving.
      new_moves = moves.map(m => {
        return foundry.utils.duplicate(m);
      });
    }

    // Add selected equipment.
    let new_equipment = null;
    if (equipment_ids.length > 0) {
      let equipment = itemData.equipment.filter(e => equipment_ids.includes(e.id));
      new_equipment = equipment.map(e => {
        return foundry.utils.duplicate(e);
      });
    }

    // Add selected spell.
    let new_spells = null;
    if (spell_ids.length > 0) {
      let spells = [];
      if (typeof itemData.spells == 'object') {
        // Loop over casting classes.
        for (let [key, obj] of Object.entries(itemData.spells)) {
          // Loop over spells by level.
          for (let [spellLevel, spellsByLevel] of Object.entries(obj.spells)) {
            spells = spells.concat(spellsByLevel.filter(s => spell_ids.includes(s.id)));
          }
        }
        // Append to the update array.
        new_spells = spells.map(s => {
          return foundry.utils.duplicate(s);
        });
      }
    }

    const system = {};
    if (race) {
      system['details.race'] = {
        value: race.label,
        description: race.description
      };
    }
    if (alignment) {
      system['details.alignment'] = {
        value: alignment.label,
        description: alignment.description
      }
    }
    if (abilities != []) {
      for (let [key, update] of Object.entries(abilities)) {
        system[key] = update;
      }
    }

    // Adjust level.
    if (Number(actor.system.attributes.xp.value) > 0) {
      const xpRequired = actor.system.attributes.xp.max ?? Number(actor.system.attributes.level.value ?? 1) + 7;
      let xp = Number(actor.system.attributes.xp.value) - xpRequired;
      system['attributes.xp.value'] = xp > -1 ? xp : 0;
      system['attributes.level.value'] = Number(actor.system.attributes.level.value) + 1;
    }

    //Set Level 1 bonds
    let newbonds = [];
    if (Number(actor.system.attributes.xp.value) == 0) {
      let theclass = DwUtility.cleanClass(actor.system.details.class);

      for (let i = 1; i < 7; i++) {
        if (game.i18n.localize("DW." + theclass + ".Bond" + i ) != "DW." + theclass + ".Bond" + i ) {
          newbonds.push({name: game.i18n.localize("DW." + theclass + ".Bond" + i), type: 'bond', system: ''});
        }
      }
    }

    // Adjust hp.
    if (itemData.class_item.system.hp) {
      const noConstitutionToHP = game.settings.get('dungeonworld', 'noConstitutionToHP');
      let constitution = 0;
      if (!noConstitutionToHP) {
        constitution = actor.system.abilities.con.value;
        if (system['abilities.con.value']) {
          constitution = system['abilities.con.value'];
        }
      }
      system['attributes.hp.max'] = Number(itemData.class_item.system.hp) + Number(constitution);
      const hpDelta = Math.max(system['attributes.hp.max'] - actor.system.attributes.hp.max, 0);
      system['attributes.hp.value'] = hpDelta > 0 ? actor.system.attributes.hp.value + hpDelta : actor.system.attributes.hp.value;
    }

    // Adjust load.
    if (itemData.class_item.system.load) {
      const noSTRToMaxLoad = game.settings.get('dungeonworld', 'noSTRToMaxLoad');
      if (noSTRToMaxLoad) {
        system['attributes.weight.max'] = Number(itemData.class_item.system.load)
      } else {
        let strength = actor.system.abilities.str.value;
        if (system['abilities.str.value']) {
          strength = system['abilities.str.value'];
        }
        system['attributes.weight.max'] = Number(itemData.class_item.system.load) + Number(DwUtility.getAbilityMod(strength));
      }
    }

    // Adjust damage die.
    if (itemData.class_item.system.damage) {
      system['attributes.damage.value'] = itemData.class_item.system.damage;
    }

    // Create all new items in a single operation.
    const new_items = [
      ...newbonds,
      ...(new_moves ?? []),
      ...(new_equipment ?? []),
      ...(new_spells ?? []),
    ];
    if (new_items.length > 0) {
      await actor.createEmbeddedDocuments('Item', new_items);
    }

    await actor.update({ system: system, 'flags.dungeonworld.levelup': false });
  }

  // @todo abstract the logic in this method so that we can combine it with onLevelUp as much as possible.
  async _onClassView(event) {
    event.preventDefault();

    const actor = this.actor;
    const actorData = this.actor.system;
    let orig_class_name = actorData.details.class;
    let char_class_name = orig_class_name.trim();
    let class_list_items = await DwClassList.getClasses(false);
    let class_list = class_list_items.map(c => c.name);

    let char_class = DwUtility.cleanClass(char_class_name);

    // Get the original class name if this was a translation.
    if (game.babele) {
      let babele_classes = game.babele.translations.find(p => p.collection == 'dungeonworld.classes');
      if (babele_classes) {
        let babele_pack = babele_classes.entries.find(p => p.name == char_class_name);
        if (babele_pack) {
          char_class_name = babele_pack.id;
          char_class = DwUtility.cleanClass(babele_pack.id);
        }
      }
    }

    if (!class_list.includes(orig_class_name) && !class_list.includes(char_class_name)) {
      ui.notifications.warn(game.i18n.localize('DW.Notifications.noClassWarning'));
      return;
    }

    const compendium = await DwUtility.loadCompendia(`${char_class}-moves`)

    let class_item = class_list_items.find(i => i.name == orig_class_name);
    if (!class_item?.system) {
      ui.notifications.warn(game.i18n.localize('DW.Notifications.noClassWarning'));
      return;
    }
    let blurb = class_item ? class_item.system.description : null;

    // Get races.
    let races = [];
      races = class_item.system.races;
      if (typeof races == 'object') {
        races = Object.entries(races).map(r => {
          return {
            key: r[0],
            label: r[1]['label'],
            description: r[1]['description']
          };
        });
      }

    // Get alignments.
    let alignments = [];
      alignments = class_item.system.alignments;
      if (typeof alignments == 'object') {
        alignments = Object.entries(alignments).map(a => {
          return {
            key: a[0],
            label: a[1]['label'],
            description: a[1]['description']
          };
        });
      }

    // Get equipment.
    let equipment = null;
    let equipment_list = [];
      if (typeof class_item.system.equipment == 'object') {
        let equipmentObjects = await class_item._getEquipmentObjects();
        for (let [group, group_items] of Object.entries(equipmentObjects)) {
          class_item.system.equipment[group]['objects'] = group_items;
          equipment_list = equipment_list.concat(group_items);
        }
        equipment = foundry.utils.duplicate(class_item.system.equipment);
      }

    // Get ability scores.
    const noAbilityScores = game.settings.get('dungeonworld', 'noAbilityScores');
    let ability_scores = [16, 15, 13, 12, 9, 8];
    if (noAbilityScores) {
      ability_scores = [2, 1, 1, 0, 0, -1];
    }
    let ability_labels = Object.entries(CONFIG.DW.abilities).map(a => {
      return {
        short: a[0],
        long: a[1],
        disabled: Number(this.actor.system.abilities[a[0]].value) > 17
      }
    });

    // Retrieve the actor's current moves so that we can hide them.
    const actorMoves = this.actor.items.filter(i => i.type == 'move');

    // Get the item moves as the priority.
    let moves = game.items.filter(m => {
      return true;
    });
    // Get the compendium moves next.
    let moves_compendium = compendium.filter(m => {
      return true;
    });

    // Append compendium moves to the item moves.
    let moves_list = moves.map(m => {
      return m.name;
    })
    for (let move of moves_compendium) {
      if (!moves_list.includes(move.name)) {
        moves.push(move);
      }
    }

    // Sort the moves and build our groups.
    moves.sort((a, b) => {
      return a.system.requiresLevel - b.system.requiresLevel;
    });

    let starting_moves = [];
    let starting_move_groups = [];
      starting_moves = moves.filter(m => {
        return m.system.requiresLevel < 2;
      });

      starting_move_groups = starting_moves.reduce((groups, move) => {
        // Assign the undefined group to all Z's so that it's last.
        let group = move.system.moveGroup ? move.system.moveGroup : 'ZZZZZZZ';
        if (!groups[group]) {
          groups[group] = [];
        }

        groups[group].push(move);
        return groups;
      }, {});

    let advanced_moves_2 = moves.filter(m => {
      return m.system.requiresLevel >= 2 && m.system.requiresLevel < 6;
    });

    let advanced_moves_6 = moves.filter(m => {
      return m.system.requiresLevel >= 6;
    });

    // Determine if spells can be cast.
    let cast_spells = [];
    let spells = null;
    if (char_class == 'the-wizard') {
      cast_spells.push('wizard');
    }
    else if (char_class == 'the-cleric') {
      cast_spells.push('cleric');
    }
    else {
      cast_spells.push(char_class);
    }

    if (cast_spells.length > 0) {
      // Retrieve the actor's current moves so that we can hide them.
      let spell_preparation_type = null;
      spells = [];
      for (let caster_class of cast_spells) {
        // Get the item spells as the priority.
        let spells_items = game.items.filter(i => {
          // Return true for custom spell items that have a class.
          return i.type == 'spell'
            && i.system.class
          // Check if this spell has either `classname` or `the classname` as its class.
            && [caster_class, `the ${caster_class}`].includes(DwUtility.cleanClass(i.system.class));
        });
        const spells_compendium = await DwUtility.loadCompendia(`${char_class}-spells`);

        // Get the compendium spells next.
        let spells_compendium_items = spells_compendium;

        // Append compendium spells to the item spells.
        let spells_list = spells.map(s => {
          return s.name;
        })
        // Add to the array, and also add to a sorted by level array.
        for (let spell of spells_compendium_items) {
          if (!spells_list.includes(spell.name)) {
            spells_items.push(spell);
          }
        }

        // Skip this class if there were no spells in it.
        if (spells_items.length < 1) {
          continue;
        }

        // Sort the spells and build our groups.
        spells_items.sort((a, b) => {
          return a.system.spellLevel - b.system.spellLevel;
        });

        let spell_groups = spells_items.reduce((groups, spell) => {
          // Default to rotes.
          let group = spell.system.spellLevel ? spell.system.spellLevel : 0;
          if (!groups[group]) {
            groups[group] = [];
          }

          groups[group].push(spell);
          return groups;
        }, {});

        // Get the description for how to prepare spells for this class.
        if (caster_class == 'wizard') {
          let move = moves.filter(m => m.name == 'Spellbook');
          if (move && move.length > 0) {
            spell_preparation_type = move[0].system.description;
          }
          else {
            move = actorMoves.filter(m => m.name == 'Spellbook');
            if (move && move.length > 0) {
              // @todo: v10 test this.
              spell_preparation_type = move[0].system.description;
            }
          }
        }
        else if (caster_class == 'cleric') {
          let move = moves.filter(m => m.name == 'Commune');
          if (move && move.length > 0) {
            spell_preparation_type = move[0].system.description;
          }
          else {
            move = actorMoves.filter(m => m.name == 'Commune');
            if (move && move.length > 0) {
              // @todo: v10 test this.
              spell_preparation_type = move[0].system.description;
            }
          }
        }

        spells.push({
          description: spell_preparation_type,
          spells: spell_groups
        });
      }
    }

    // Build the content.
    const template = 'systems/dungeonworld/templates/dialog/class-viewer.html';
    const templateData = {
      char_class: char_class,
      char_class_name: orig_class_name,
      blurb: blurb.length > 0 ? blurb : null,
      races: races.length > 0 ? races : null,
      alignments: alignments.length > 0 ? alignments : null,
      equipment: equipment ? equipment : null,
      ability_scores: actorData.attributes.xp.value == 0 ? ability_scores : null,
      ability_mods_only: noAbilityScores,
      ability_labels: ability_labels ? ability_labels : null,
      starting_moves: starting_moves.length > 0 ? starting_moves : null,
      starting_move_groups: starting_move_groups,
      advanced_moves_2: advanced_moves_2.length > 0 ? advanced_moves_2 : null,
      advanced_moves_6: advanced_moves_6.length > 0 ? advanced_moves_6 : null,
      cast_spells: cast_spells.length > 0 && spells.length > 0 ? true : false,
      spells: spells.length > 0 ? spells : null,
      no_ability_increase: game.settings.get('dungeonworld', 'noAbilityIncrease'),
    };
    const html = await renderTemplate(template, templateData);

    const itemData = {
      moves: moves,
      races: races,
      alignments: alignments,
      equipment: equipment_list,
      class_item: class_item,
      spells: spells,
    };

    // Initialize dialog options.
    const dlg_options = {
      width: 920,
      height: 640,
      classes: ['dw-level-up', 'dungeonworld', 'sheet'],
      resizable: true
    };

    if (DwUtility.nightmode) {
      dlg_options.classes.push('nightmode');
    }

    // Render the dialog.
    let d = new Dialog({
      title: game.i18n.localize("DW.ClassViewer"),
      content: html,
      id: char_class_name,
      buttons: {},
      render: () => {
        $('.dw-level-up').find('.item-label').click(this._showItemDetails.bind(this));
      }
    }, dlg_options);
    d.render(true);


  }
}
