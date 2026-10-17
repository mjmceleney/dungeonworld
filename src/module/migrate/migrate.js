export class MigrateDw {

  static async runMigration() {
    // Only a GM can update world data and settings.
    if (!game.user.isGM) return;

    // Retrieve the version.
    let version = game.settings.get('dungeonworld', 'systemMigrationVersion');

    // Update 1: Assign basic/special moves on actors.
    if (version < 1) {
      this.updateSpecialMoves();
      version = 1;
      await game.settings.set('dungeonworld', 'systemMigrationVersion', version);
    }

    // Update 2: Move each character's custom resource into the trackers list.
    if (version < 2) {
      await this.migrateResourceToTrackers();
      version = 2;
      await game.settings.set('dungeonworld', 'systemMigrationVersion', version);
    }

    // Update 3: Player characters' tokens are linked to the character. New
    // characters already are; this fixes ones made before that.
    if (version < 3) {
      await this.linkCharacterPrototypes();
      version = 3;
      await game.settings.set('dungeonworld', 'systemMigrationVersion', version);
      await this.linkCharacterTokens({ ask: true });
    }
  }

  /**
   * Link every player character's prototype token, so tokens placed from now
   * on are the character rather than a copy. NPCs are left as they are.
   */
  static async linkCharacterPrototypes() {
    const updates = game.actors
      .filter(a => a.type == 'character' && !a.prototypeToken.actorLink)
      .map(a => ({ _id: a.id, 'prototypeToken.actorLink': true }));
    if (updates.length) await Actor.implementation.updateDocuments(updates);
  }

  /**
   * Link player characters' tokens already placed on scenes. A linked token
   * shows the character itself, so changes made only on the token (such as
   * HP lost on that copy) stop showing; core keeps them, and they'd come back
   * if the token were unlinked again. Also callable later, e.g. from a macro:
   * game.dungeonworld.MigrateDw.linkCharacterTokens().
   *
   * @param {object} [options]
   * @param {boolean} [options.ask=false]  Ask the GM first.
   * @return {Promise<number>} How many tokens were linked.
   */
  static async linkCharacterTokens({ ask = false } = {}) {
    if (!game.user.isGM) return 0;
    const byScene = new Map();
    let changed = 0;
    for (const scene of game.scenes) {
      const tokens = scene.tokens.filter(t => !t.actorLink && t.baseActor?.type == 'character');
      if (!tokens.length) continue;
      byScene.set(scene, tokens);
      // Changes made only on the token: its delta's stats, items or effects.
      changed += tokens.filter(t => {
        const delta = t._source.delta ?? {};
        return !foundry.utils.isEmpty(delta.system ?? {}) || delta.items?.length || delta.effects?.length
          || delta.name || delta.img;
      }).length;
    }
    const count = [...byScene.values()].reduce((sum, tokens) => sum + tokens.length, 0);
    if (!count) return 0;

    if (ask) {
      const DialogV2 = foundry.applications.api.DialogV2;
      const yes = await DialogV2.confirm({
        window: { title: game.i18n.localize('DW.Migration.LinkTokensTitle') },
        content: `<p>${game.i18n.format('DW.Migration.LinkTokensText', { count })}</p>`
          + (changed ? `<p>${game.i18n.format('DW.Migration.LinkTokensChanged', { changed })}</p>` : '')
          + `<p>${game.i18n.localize('DW.Migration.LinkTokensLater')}</p>`,
        yes: { label: 'DW.Migration.LinkTokensYes' },
        no: { label: 'DW.Migration.LinkTokensNo' },
        rejectClose: false,
      });
      if (!yes) return 0;
    }

    for (const [scene, tokens] of byScene) {
      await scene.updateEmbeddedDocuments('Token', tokens.map(t => ({ _id: t.id, actorLink: true })));
    }
    ui.notifications.info(game.i18n.format('DW.Migration.LinkTokensDone', { count }));
    return count;
  }

  /**
   * Copy the single custom resource (system.attributes.resource1) into the
   * character sheet's trackers list, for characters that used it. The old
   * field is left in place for the legacy sheet.
   */
  static async migrateResourceToTrackers() {
    for (let actor of game.actors.filter(a => a.type == 'character')) {
      const resource = actor.system.attributes?.resource1;
      if (!resource || actor.flags?.dungeonworld?.trackers) continue;
      const label = (resource.label ?? '').trim();
      const value = Number(resource.value) || 0;
      const max = Number(resource.max) || 0;
      const used = value !== 0 || max !== 0 || (label !== '' && label !== 'Custom Resource');
      if (!used) continue;

      const id = foundry.utils.randomID();
      await actor.update({
        [`flags.dungeonworld.trackers.${id}`]: { label: label || 'Custom Resource', value, max, sort: 0 },
      });
    }
  }

  static async updateSpecialMoves() {
    const basicMoves = [
      'Aid or Interfere',
      'Parley',
      'Defend',
      'Defy Danger',
      'Discern Realities',
      'Hack & Slash',
      'Spout Lore',
      'Volley'
    ];

    const specialMoves = [
      'Bolster',
      'Carouse',
      'Encumbrance',
      'End of Session',
      'Last Breath',
      'Level Up',
      'Make Camp',
      'Outstanding Warrants',
      'Recover',
      'Recruit',
      'Supply',
      'Take Watch',
      'Undertake A Perilous Journey'
    ];

    // Query actors.
    let actors = game.actors.filter(a => a.type == 'character');
    for (let actor of actors) {
      // Query moves on this actor.
      let items = actor.items.filter(i => i.type == 'move');
      // Iterate through each move and update them as needed.
      for (let item of items) {
        let moveType = null;

        // Basic moves.
        if (basicMoves.includes(item.name)) {
          moveType = 'basic';
        }
        // Special moves.
        else if (specialMoves.includes(item.name)) {
          moveType = 'special';
        }

        // If this is a valid move, update it.
        if (moveType) {
          await actor.updateEmbeddedDocuments("Item", {
            _id: item.id,
            name: item.name,
            data: {
              moveType: moveType
            }
          });
        }
      }
    }

  }

  /*
   * Manual migration function.
   *
   * This function should not be part of an automatic migration. It is instead
   * a template that can be used if the IDs on class equipment groups get out
   * of sync, with the intent that an older version of the equipment compendiums
   * are pulled from a previous commit to use as a mapping.
   */
  static async updateClassCompendiums() {
    let classes = [];
    let itemsCurrent = [];
    let itemsOld = [];
    let itemMap = {};
    // Grab compendium data.
    for (let pack of game.packs) {
      if (pack.metadata.name.includes('equipment')) {
        if (pack.metadata.name.includes('old')) {
          itemsOld = itemsOld.concat(await pack.getDocuments());
        }
        else {
          itemsCurrent = itemsCurrent.concat(await pack.getDocuments());
        }
      }
      else if (pack.metadata.name.includes('classes')) {
        classes = await pack.getDocuments();
      }
    }
    // Build a mapping of old > new items.
    for (let oldItem of itemsOld) {
      let newItem = itemsCurrent.find(i => i.name == oldItem.name);
      if (newItem?.id) {
        itemMap[oldItem.id] = newItem.id;
      }
    }
    // Get the class compendium data.
    for (let charClass of classes) {
      let classItem = charClass.system;
      let hasUpdate = false;
      for (let [k,v] of Object.entries(classItem.system.equipment)) {
        v.items = v.items.map(i => {
          return itemMap[i];
        });
      }
      let updates = {
        _id: classItem.id,
        "system.equipment": classItem.system.equipment
      };
      await charClass.update(updates);
    }
  }

}
