import { DwUtility } from "../utility.js";
import { DwRolls } from "../rolls.js";

/**
 * Helper class to handle rendering the custom combat tracker.
 */
export class CombatSidebarDw {
  // This must be called in the `init` hook in order for the other hooks to
  // fire correctly.
  startup() {
    // CONFIG.debug.hooks = true;

    // Add support for damage rolls via event delegation.
    Hooks.on('ready', () => {
      // Damage rolls from the combat tracker.
      $('body').on('click', '.dw-rollable', (event) => {
        event.preventDefault();
        const button = event.currentTarget;
        const combatantId = button.closest('.actor-elem')?.dataset.combatantId;
        const actor = combatantId ? game.combat?.combatants.get(combatantId)?.actor : null;
        if (!actor || !button.dataset.roll) return;
        DwRolls.rollMove({
          actor,
          data: null,
          formula: button.dataset.roll,
          templateData: {
            title: button.dataset.label,
            flavor: button.dataset.flavor,
            rollType: 'damage',
          },
        });
      });

      // HP change in the combat tracker.
      $('body').on('change', '.ct-item input', (event) => {
        event.preventDefault();

        // Get the input and actor element.
        const dataset = event.currentTarget.dataset;
        let $input = $(event.currentTarget);
        let $actorRow = $input.parents('.combatant.actor-elem');

        // If there isn't an actor element, don't proceed.
        if (!$actorRow.length) return;

        // Retrieve the combatant's actor, or exit if not valid.
        const actor = game.combat?.combatants.get($actorRow.data('combatant-id'))?.actor;
        if (!actor) return;

        // Check for bad numbers, otherwise convert into a Number type.
        let value = $input.val();
        if (dataset.dtype == 'Number') {
          value = Number(value);
          if (Number.isNaN(value)) {
            $input.val(actor.system.attributes.hp.value);
            return false;
          }
        }

        // If this started with a "+" or "-", handle it as a relative change.
        // Otherwise, set it absolutely.
        const relative = /^[+-]/.test($input.val().trim());
        actor.update({
          [$input.attr('name')]: relative ? Number(actor.system.attributes.hp.value) + value : value,
        });
      });

      // Add drag events.
      if (game.user.isGM) {
        $('body')
          // Initiate the drag event.
          .on('dragstart', '#combat .combatant.actor-elem', (event) => {
            // Set the drag data for later usage.
            let dragData = event.currentTarget.dataset;
            event.originalEvent.dataTransfer.setData('text/plain', JSON.stringify(dragData));

            // Store the combatant type for reference. We have to do this
            // because dragover doesn't have access to the drag data, so we
            // store it as a new type entry that can be split later.
            event.originalEvent.dataTransfer.setData(`newtype--${dragData.actorType}`, '');
          })
          // Add a class on hover, if the actor types match.
          .on('dragover', '#combat .combatant.actor-elem', (event) => {
            // Get the drop target.
            let $dropTarget = $(event.originalEvent.target).parents('.combatant');

            // Exit early if we don't need to make any changes.
            if ($dropTarget.hasClass('drop-hover') || !$dropTarget.data('combatant-id')) return;

            // Retrieve the actor type for the drop target, exit early if
            // it doesn't exist.
            const oldType = $dropTarget.data('actor-type');
            if (!oldType) return;

            // Retrieve the actor type for the actor being dragged. If the
            // type matches, add a css class to let the user know this is a
            // valid drop target.
            const newType = event.originalEvent.dataTransfer.types.find(t => t.includes('newtype'))?.split('--')[1] ?? null;
            if (newType == oldType) $dropTarget.addClass('drop-hover');
            return false;
          })
          // Remove the class on drag leave.
          .on('dragleave', '#combat .combatant.actor-elem', (event) => {
            // Get the drop target and remove any hover classes on it when
            // the mouse leaves it.
            $(event.originalEvent.target).parents('.combatant').removeClass('drop-hover');
            return false;
          })
          // Update initiative on drop.
          .on('drop', '#combat .combatant.actor-elem', async (event) => {
            const combat = game.combat;
            if (!combat) return;

            // Retrieve the drop target, remove any hover classes.
            let $dropTarget = $(event.originalEvent.target).parents('.combatant');
            $dropTarget.removeClass('drop-hover');

            // Attempt to retrieve and parse the data transfer from the drag.
            let data;
            try {
              data = JSON.parse(event.originalEvent.dataTransfer.getData('text/plain'));
            } catch (err) {
              return false;
            }

            // The combatant being dropped, and the others of its type.
            const dropped = combat.combatants.get(data.combatantId);
            const group = this.getCombatantsData()[dropped?.actor?.type];
            if (!group) return;

            // The combatant being dropped onto. Without one, nothing moves.
            const target = group.find(c => c.id == $dropTarget.data('combatant-id'));
            if (!target || target.initiative === null) return;

            // Place the dropped combatant just after the target, then number
            // everyone of its type in increments of 10.
            const position = (c) => c.id == dropped.id ? Number(target.initiative) + 1 : Number(c.initiative);
            const updates = group
              .sort((a, b) => position(a) - position(b))
              .map((c, index) => ({ _id: c.id, initiative: index * 10 }));
            await combat.updateEmbeddedDocuments('Combatant', updates);
          });
      }
    });

    // Re-render combat when what the tracker shows (name, image, HP, armor
    // and damage) changes for an actor in the current combat.
    Hooks.on('updateActor', (actor, changes) => {
      const shown = changes.name !== undefined || changes.img !== undefined
        || foundry.utils.hasProperty(changes, 'system.attributes');
      if (shown && game.combat?.combatants.some(c => c.actorId === actor.id)) {
        ui.combat.render();
      }
    });

    // Pre-roll initiative for new combatants. Because DW doesn't use
    // initiative, set them in increments of 10. However, the system still has
    // initiative formula using a d20, in case the reroll initiative button
    // is used.
    Hooks.on('preCreateCombatant', (document, data, options, userId) => {
      if (data.initiative) return;
      const actorType = document.actor?.type ?? 'character';

      // Go after the others of this type.
      const inits = document.parent.combatants
        .filter(c => c.actor?.type == actorType)
        .map(c => Number(c.initiative) || 0);
      document.updateSource({ initiative: inits.length ? Math.max(...inits) + 10 : 0 });
    });

    // When the combat tracker is rendered, we need to completely replace
    // its HTML with a custom version.
    Hooks.on('renderCombatTracker', async (app, html, options) => {
      // Find the combat element, which is where combatants are stored.
      let newHtml = $(html).find('#combat');
      if (newHtml.length < 1) {
        newHtml = $(html);
      }

      // If there's as combat, we can proceed.
      if (!game.combat) return;

      // Retrieve a list of the combatants grouped by actor type and sorted
      // by their initiative count.
      const combatants = this.getCombatantsData();

      // Add a counter for the total number of moves all characters have made.
      const moveTotal = (combatants.character ?? [])
        .reduce((total, c) => total + (Number(c.flags.dungeonworld?.moveCount) || 0), 0);

      // Render the template and update the markup with our new version.
      const content = await foundry.applications.handlebars.renderTemplate('systems/dungeonworld/templates/combat/combat.html', {
        combatants: combatants,
        moveTotal: moveTotal
      });
      newHtml.find('.combat-tracker').remove();
      newHtml.find('.combat-tracker-header').after(content);

      // Drag handler for the combat tracker.
      if (game.user.isGM) {
        newHtml.find('.combatant.actor-elem').attr('draggable', true).addClass('draggable');
      }
    });
  }

  /**
   * A player's move counter, on the active GM's client. Only the move count
   * of a combatant in the current combat changes.
   * @param {{combatant: string, moveCount: number}} data
   */
  static async applyRemoteMoveCount(data) {
    const combatant = game.combat?.combatants.get(data?.combatant);
    const moveCount = Number(data?.moveCount);
    if (!combatant || !Number.isInteger(moveCount) || moveCount < 0) return;
    await combatant.update({ 'flags.dungeonworld.moveCount': moveCount });
  }

  /**
   * Retrieve the combatants of the current combat, grouped by actor type and
   * sorted by initiative.
   * @returns {Object<string, Combatant[]>}
   */
  getCombatantsData() {
    // If there isn't a combat, exit and return an empty list.
    if (!game.combat) {
      return {};
    }

    const orphanedIds = [];
    const groups = {};
    for (const combatant of game.combat.combatants) {
      // If this is for a combatant that has had its token/actor deleted,
      // queue it for removal from the combat.
      if (!combatant.actor) {
        orphanedIds.push(combatant.id);
        continue;
      }

      const group = combatant.actor.type;
      groups[group] ??= [];

      // Player characters always show their health. For others, it depends
      // on the token's bar display mode: owner modes for the owner and GM,
      // none for the GM, and anything else for everyone.
      let displayHealth = true;
      if (group != 'character') {
        const mode = combatant.token?.displayBars ?? CONST.TOKEN_DISPLAY_MODES.OWNER;
        const modeName = Object.entries(CONST.TOKEN_DISPLAY_MODES).find(([, value]) => value == mode)?.[0] ?? 'OWNER';
        if (modeName.includes('OWNER')) displayHealth = combatant.isOwner || game.user.isGM;
        else if (modeName == 'NONE') displayHealth = game.user.isGM;
      }

      // Set a property based on the health mode earlier.
      combatant.displayHealth = displayHealth;
      // Whether fields like HP are shown as inputs or text.
      combatant.editable = combatant.isOwner || game.user.isGM;

      // Build the radial progress circle settings for the template.
      combatant.healthSvg = DwUtility.getProgressCircle({
        current: combatant.actor.system.attributes.hp.value,
        max: combatant.actor.system.attributes.hp.max,
        radius: 16
      });

      // If this is the GM or the owner, push to the combatants list.
      // Otherwise, only push if the token isn't hidden in the scene.
      if (game.user.isGM || combatant.isOwner || !combatant.token?.hidden) {
        groups[group].push(combatant);
      }
    }

    // Remove orphaned combatants in a single operation. Only the active GM
    // does this, so two GMs don't both try.
    if (orphanedIds.length > 0 && game.users.activeGM?.isSelf) {
      game.combat.deleteEmbeddedDocuments('Combatant', orphanedIds);
    }

    // Sort the combatants in each group by initiative.
    for (const group of Object.values(groups)) {
      group.sort((a, b) => Number(a.initiative) - Number(b.initiative));
    }

    return groups;
  }
}
