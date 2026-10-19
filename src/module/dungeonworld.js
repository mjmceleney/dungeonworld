/**
 * A simple and flexible system for world-building using an arbitrary collection of character and item attributes
 * Author: Atropos
 * Software License: GNU GPLv3
 */

// Import Modules
import { DW } from "./config.js";
import { DwClassList } from "./config.js";
import { ActorDw } from "./actor/actor.js";
import { ItemDw } from "./item/item.js";
import { DwItemSheet } from "./item/item-sheet.js";
import { DwActorSheet } from "./actor/actor-sheet.js";
import { DwCharacterSheet } from "./actor/character-sheet.js";
import { DwNpcSheet } from "./actor/npc-sheet.js";
import { DwActorNpcSheet } from "./actor/actor-npc-sheet.js";
import { DwHirelingSheet } from "./actor/hireling-sheet.js";
import { DwClassItemSheet } from "./item/class-item-sheet.js";
import { DwRegisterHelpers } from "./handlebars.js";
import { preloadHandlebarsTemplates } from "./templates.js";
import { DwUtility } from "./utility.js";
import { CombatSidebarDw } from "./combat/combat.js";
import { MigrateDw } from "./migrate/migrate.js";
import { DwJournal } from "./journal.js";
import { DwLastBreath } from "./last-breath.js";
import { DwZeroHp } from "./zero-hp.js";
import { DwSocket } from "./socket.js";
import { DwPartyMoves } from "./party-moves.js";
import { DwTreasure } from "./treasure.js";
import { DwMoveActions } from "./move-actions.js";
import { DwInlineRolls } from "./inline-rolls.js";
import { DwBeyondTen } from "./actor/beyond-ten.js";
import { DwFronts } from "./fronts.js";

import * as chat from "./chat.js";
import { BUILD_ID } from "./build-info.js";

// Load this build's stylesheet rather than a cached copy of an older one.
DwUtility.bustStylesheetCache(BUILD_ID);
console.log(`Dungeon World | build ${BUILD_ID}`);

const { Actors, Items } = foundry.documents.collections;
const { ActorSheet, ItemSheet } = foundry.appv1.sheets;

/* -------------------------------------------- */
/*  Foundry VTT Initialization                  */
/* -------------------------------------------- */

Hooks.once("init", async function() {
  console.log(`Initializing Dungeon World!`);

  game.dungeonworld = {
    ActorDw,
    ItemDw,
    rollItemMacro,
    DwUtility,
    MigrateDw,
    DwLastBreath,
    DwPartyMoves,
    DwTreasure,
    DwFronts,
  };

  // TODO: Extend the combat class.
  // CONFIG.Combat.entityClass = CombatDw;

  CONFIG.DW = DW;
  CONFIG.Actor.documentClass = ActorDw;
  CONFIG.Item.documentClass = ItemDw;

  // Register sheet application classes
  Actors.unregisterSheet("core", ActorSheet);
  Actors.registerSheet("dungeonworld", DwCharacterSheet, {
    types: ['character'],
    makeDefault: true,
    label: "DW.Sheet.Character"
  });
  // The previous character sheet stays available from Configure Sheet.
  Actors.registerSheet("dungeonworld", DwActorSheet, {
    types: ['character'],
    makeDefault: false,
    label: "DW.Sheet.Legacy"
  });
  Actors.registerSheet("dungeonworld", DwNpcSheet, {
    types: ['npc'],
    makeDefault: true,
    label: "DW.Sheet.Npc"
  });
  // The previous NPC sheet stays available from Configure Sheet.
  Actors.registerSheet("dungeonworld", DwActorNpcSheet, {
    types: ['npc'],
    makeDefault: false,
    label: "DW.Sheet.LegacyNpc"
  });
  Actors.registerSheet("dungeonworld", DwHirelingSheet, {
    types: ['hireling'],
    makeDefault: true,
    label: "DW.Sheet.Hireling"
  });
  Items.unregisterSheet("core", ItemSheet);
  Items.registerSheet("dungeonworld", DwItemSheet, { makeDefault: false });
  Items.registerSheet("dungeonworld", DwClassItemSheet, {
    types: ['class'],
    makeDefault: true
  });

  DwRegisterHelpers.init();

  let combatDw = new CombatSidebarDw();
  combatDw.startup();

  /**
   * Track the system version upon which point a migration was last applied
   */
  game.settings.register("dungeonworld", "systemMigrationVersion", {
    name: "System Migration Version",
    scope: "world",
    config: false,
    type: Number,
    default: 0
  });

  // Configurable system settings, in the order the settings window lists
  // them. Each one's name and hint come from DW.Settings.<key>.
  const reload = () => window.location.reload();
  const settings = {
    xpFormula: { type: String, default: "@attributes.level.value + 7" },
    advForward: { type: Boolean, default: false },
    disDebility: { type: Boolean, default: false, onChange: reload },
    coinWeight: { type: Number, default: 100 },
    // TODO: Remove this setting.
    itemIcons: { scope: 'client', config: false, type: Boolean, default: true },
    enableDamageButtons: { type: Boolean, default: true },
    automateGear: {
      type: Boolean,
      default: true,
      onChange: () => {
        for (const actor of game.actors) actor.reset();
        for (const app of foundry.applications.instances.values()) {
          if (app.document?.documentName == 'Actor') app.render();
        }
      },
    },
    lastBreathPrompt: { type: Boolean, default: true },
    zeroHpMarkers: { type: Boolean, default: true },
    allowMulticlass: { type: Boolean, default: false },
    alignmentSingle: { type: String, default: '' },
    alignmentPlural: { type: String, default: '' },
    raceSingle: { type: String, default: '' },
    racePlural: { type: String, default: '' },
    bondSingle: { type: String, default: '' },
    bondPlural: { type: String, default: '' },
    noCompendiumAutoData: { type: Boolean, default: false, onChange: reload },
    compendiumPrefix: { type: String, default: '', onChange: reload },
    noAbilityScores: { type: Boolean, default: false, onChange: reload },
    noAbilityIncrease: { type: Boolean, default: false },
    noConstitutionToHP: { type: Boolean, default: false },
    noSTRToMaxLoad: { type: Boolean, default: false },
    debilityLabelSTR: { type: String, default: "DW.DebilityStr" },
    debilityLabelDEX: { type: String, default: "DW.DebilityDex" },
    debilityLabelCON: { type: String, default: "DW.DebilityCon" },
    debilityLabelINT: { type: String, default: "DW.DebilityInt" },
    debilityLabelWIS: { type: String, default: "DW.DebilityWis" },
    debilityLabelCHA: { type: String, default: "DW.DebilityCha" },
    journalStyle: {
      type: String,
      choices: {
        system: game.i18n.localize("DW.Settings.journalStyle.system"),
        all: game.i18n.localize("DW.Settings.journalStyle.all"),
        none: game.i18n.localize("DW.Settings.journalStyle.none")
      },
      default: "system",
      onChange: () => DwJournal.restyleAll()
    },
  };
  for (const [key, setting] of Object.entries(settings)) {
    game.settings.register("dungeonworld", key, {
      name: game.i18n.localize(`DW.Settings.${key}.name`),
      hint: game.i18n.localize(`DW.Settings.${key}.hint`),
      scope: 'world',
      config: true,
      ...setting,
    });
  }
  DwJournal.init();
  DwLastBreath.init();
  DwZeroHp.init();
  DwPartyMoves.init();
  DwInlineRolls.init();
  DwBeyondTen.init();
  DwFronts.init();

  // Preload template partials.
  preloadHandlebarsTemplates();
  chat.getDamageButtons();
});

Hooks.once("ready", async function() {
  // Wait to register hotbar drop hook on ready so that modules could register earlier if they want to
  Hooks.on("hotbarDrop", (bar, data, slot) => {
    //overwrite the default drop-to-hotbar behaviour for items
    if (data.type == "Item") {
      createDwMacro(data, slot);
      return false;
    }
    else {
      return true
    }
  });

  DW.classlist = await DwClassList.getClasses();
  CONFIG.DW = DW;

  // Add a lang class to the body.
  const lang = game.settings.get('core', 'language');
  $('html').addClass(`lang-${lang}`);

  // Run migrations.
  MigrateDw.runMigration();

  // Update config.
  for (let [k,v] of Object.entries(CONFIG.DW.rollResults)) {
    CONFIG.DW.rollResults[k].label = game.i18n.localize(v.label);
  }

  // Changes players ask the active GM to make for them (see DwSocket).
  // A new character (an apprentice) a player asked for.
  DwSocket.register('createCharacter', data => DwBeyondTen.createRemote(data));
  // A player's move effect or item use (a heal, a debility removed) on
  // someone else's character.
  DwSocket.register('moveAction', data => DwMoveActions.applyRemote(data));
  // A player's change to a party move card.
  DwSocket.register('partyUpdate', data => DwPartyMoves.applyRemote(data));
  // A player's choice on a chat card, such as marking XP.
  DwSocket.register('cardEdit', data => chat.applyRemoteCardEdit(data));
  // The move counter, when a player made a move in combat.
  DwSocket.register('combatantUpdate', data => CombatSidebarDw.applyRemoteMoveCount(data));
  DwSocket.init();
});

Hooks.on('renderChatMessageHTML', (app, html, data) => {
  // Determine visibility.
  let chatData = app;
  const whisper = chatData.whisper || [];
  const isBlind = whisper.length && chatData.blind;
  const isVisible = (whisper.length) ? game.user.isGM || whisper.includes(game.user.id) || (!isBlind) : true;
  if (!isVisible) {
    html.querySelectorAll('.dice-formula').forEach(e => e.innerText = '???');
    html.querySelectorAll('.dice-total').forEach(e => e.innerText = '?');
    html.querySelectorAll('.dice-tooltip').forEach(e => e.remove());
  }

  // Add damage buttons to plain roll messages (e.g. /roll). Done at render
  // time rather than by rewriting the message, which cost a database write and
  // a re-render on every client for each roll.
  chat.appendDamageButtons(app, html);

  chat.displayChatActionButtons(app, html, data);
});

Hooks.on('renderChatLog', (app, html, data) => chat.activateChatListeners(html));
Hooks.on('renderChatPopout', (app, html, data) => chat.activateChatListeners(html));

/* -------------------------------------------- */
/*  Foundry VTT Setup                           */
/* -------------------------------------------- */

/**
 * This function runs after game data has been requested and loaded from the servers, so documents exist
 */
Hooks.once("setup", function() {

  // Localize CONFIG objects once up-front
  const toLocalize = [
    "abilities", "debilities"
  ];
  for (let o of toLocalize) {
    CONFIG.DW[o] = Object.entries(CONFIG.DW[o]).reduce((obj, e) => {
      obj[e[0]] = game.i18n.localize(e[1]);
      return obj;
    }, {});
  }
});

/* -------------------------------------------- */
/*  Actor Updates                               */
/* -------------------------------------------- */
Hooks.on('createActor', async (actor, options, userId) => {
  // Only the user who created the actor sets it up, so other connected clients
  // (including additional GMs) don't add duplicate moves.
  if (userId !== game.user.id) return;
  if (actor.type != 'character') return;

  // Prepare updates object.
  let updates = {};

  // Allow the character to levelup up when their level changes.
  updates['flags.dungeonworld.levelup'] = true;

  // Get the item moves as the priority, then the compendium moves, skipping
  // any the actor already has.
  const moves = [];
  const names = new Set(actor.items.filter(i => i.type == 'move').map(i => i.name));
  const worldMoves = game.items.filter(i => i.type == 'move' && (i.system.moveType == 'basic' || i.system.moveType == 'special'));
  const compendium = await DwUtility.loadCompendia('basic-moves');
  for (let move of [...worldMoves, ...compendium]) {
    if (!names.has(move.name)) {
      moves.push(move);
      names.add(move.name);
    }
  }

  // Sort the moves alphabetically.
  moves.sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));

  // Add default look, unless the actor already has one (e.g. a duplicate).
  if (!actor.system.details?.look) {
    updates['system.details.look'] = game.i18n.localize('DW.DefaultLook');
  }

  await actor.update(updates);

  // Add the moves to the actor.
  if (moves.length > 0) {
    await actor.createEmbeddedDocuments('Item', moves.map(m => m.toObject()));
  }
});

// Clear cached item lists when the underlying items change, in the world or
// in a compendium. Items embedded on actors are never part of these lists, so
// ignore them.
const invalidateItemCaches = (item) => {
  if (item.parent) return;
  if (item.pack) DwUtility.clearPackCache(item.pack);
  if (item.type == 'equipment') {
    game.dungeonworld.equipment = null;
  }
  else if (item.type == 'class') {
    DwClassList.invalidate();
  }
};
Hooks.on('createItem', invalidateItemCaches);
Hooks.on('updateItem', invalidateItemCaches);
Hooks.on('deleteItem', invalidateItemCaches);

Hooks.on('preUpdateActor', (actor, updateData, options, id) => {
  if (actor.type != 'character') return;
  // Allow the character to level up when their level goes up, as part of the
  // same update.
  // The level up itself clears it in the same update.
  if (foundry.utils.hasProperty(updateData, 'flags.dungeonworld.levelup')) return;
  const level = foundry.utils.getProperty(updateData, 'system.attributes.level.value');
  if (level !== undefined && Number(level) > Number(actor.system.attributes.level.value)) {
    foundry.utils.setProperty(updateData, 'flags.dungeonworld.levelup', true);
  }
});

/* -------------------------------------------- */
/*  Hotbar Macros                               */
/* -------------------------------------------- */

/**
 * Create a Macro from an Item drop.
 * Get an existing item macro if one exists, otherwise create a new one.
 * @param {Object} data     The dropped data
 * @param {number} slot     The hotbar slot to use
 * @returns {Promise}
 */
async function createDwMacro(data, slot) {
  // First, determine if this is a valid owned item.
  if (data.type !== "Item") return;
  if (!data.uuid.includes('Actor.') && !data.uuid.includes('Token.')) {
    return ui.notifications.warn("You can only create macro buttons for owned Items");
  }
  // If it is, retrieve it based on the uuid.
  const item = await Item.fromDropData(data);

  // Create the macro command
  // @todo refactor this to use uuids and folders.
  const command = `game.dungeonworld.rollItemMacro("${item.name}");`;
  let macro = game.macros.find(m => (m.name === item.name) && (m.command === command));
  if (!macro) {
    macro = await Macro.create({
      name: item.name,
      type: "script",
      img: item.img,
      command: command,
      flags: {
        "dungeonworld.itemMacro": true,
        "dungeonworld.itemUuid": data.uuid
      }
    });
  }
  game.user.assignHotbarMacro(macro, slot);
  return false;
}

/**
 * Create a Macro from an Item drop.
 * Get an existing item macro if one exists, otherwise create a new one.
 * @param {string} itemData
 * @return {Promise}
 */
function rollItemMacro(itemData) {
  // Reconstruct the drop data so that we can load the item.
  // @todo this section isn't currently used, the name section below is used.
  if (itemData.includes('Actor.') || itemData.includes('Token.')) {
    const dropData = {
      type: 'Item',
      uuid: itemData
    };
    Item.fromDropData(dropData).then(item => {
      // Determine if the item loaded and if it's an owned item.
      if (!item || !item.parent) {
        const itemName = item?.name ?? itemData;
        return ui.notifications.warn(`Could not find item ${itemName}. You may need to delete and recreate this macro.`);
      }

      // Trigger the item roll
      item.roll();
    });
  }
  // Load item by name from the actor.
  else {
    const speaker = ChatMessage.getSpeaker();
    const itemName = itemData;
    let actor;
    if (speaker.token) actor = game.actors.tokens[speaker.token];
    if (!actor) actor = game.actors.get(speaker.actor);
    const item = actor ? actor.items.find(i => i.name === itemName) : null;
    if (!item) return ui.notifications.warn(`Your controlled Actor does not have an item named ${itemName}`);

    // Trigger the item roll
    return item.roll();
  }
}
