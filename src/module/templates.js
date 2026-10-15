/**
 * Define a set of template paths to pre-load
 * Pre-loaded templates are compiled and cached for fast access when rendering
 * @return {Promise}
 */
 export const preloadHandlebarsTemplates = async function() {

  // Define template paths to load
  const templatePaths = [
    // Partials.
    "systems/dungeonworld/templates/parts/chat-buttons.html",
    "systems/dungeonworld/templates/parts/sheet-moves.html",
    "systems/dungeonworld/templates/parts/sheet-level-up-move.html",
    // Frequently rendered templates, so that their first use doesn't wait on
    // a fetch.
    ...["header", "vitals", "stats", "tabs", "tab-moves", "tab-equipment", "tab-spells", "tab-character", "sidebar", "item-row"]
      .map(part => `systems/dungeonworld/templates/sheet/character/${part}.html`),
    "systems/dungeonworld/templates/sheet/character-sheet.html",
    "systems/dungeonworld/templates/sheet/npc-sheet.html",
    "systems/dungeonworld/templates/items/bond-sheet.html",
    "systems/dungeonworld/templates/items/class-sheet.html",
    "systems/dungeonworld/templates/items/equipment-sheet.html",
    "systems/dungeonworld/templates/items/move-sheet.html",
    "systems/dungeonworld/templates/items/npcMove-sheet.html",
    "systems/dungeonworld/templates/items/spell-sheet.html",
    "systems/dungeonworld/templates/items/tag-sheet.html",
    "systems/dungeonworld/templates/chat/chat-move.html",
    "systems/dungeonworld/templates/chat/roll-dialog.html",
    "systems/dungeonworld/templates/combat/combat.html",
  ];

  // Load the template parts
  return foundry.applications.handlebars.loadTemplates(templatePaths);
};