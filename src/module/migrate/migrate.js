import { DwUtility } from "../utility.js";
import { DwMoves } from "../moves.js";

export class MigrateDw {

  static async runMigration() {
    // Only a GM can update world data and settings.
    if (!game.user.isGM) return;

    // Each update, in order. The setting holds how many have been applied.
    const migrations = [
      // 1: Assign basic/special moves on actors.
      () => this.updateSpecialMoves(),
      // 2: Move each character's custom resource into the trackers list.
      () => this.migrateResourceToTrackers(),
      // 3: Player characters' tokens are linked to the character. New
      // characters already are; this fixes ones made before that.
      () => this.linkCharacterPrototypes(),
      // 4: Last Breath is "just roll", with nothing added, rather than a
      // prompt for a modifier.
      () => this.plainLastBreath(),
      // 5: class gear groups for what a character starts with ("Starting
      // gear") were checklists to tick; they're now included.
      () => this.includeStartingGear(),
      // 6: fix "sing charm" (for "using charm") in copies of Defy Danger
      // taken from the compendium before it was corrected.
      () => this.fixDefyDangerTypo(),
      // 7: copies of moves and gear taken from the compendium before they
      // spent resources or healed: Volley and Blot Out the Sun spend ammo;
      // healing potions, bandages and poultices heal when used.
      () => this.addResources(),
      // 8: moves that ignore the clumsy tag on armor (Fighter's and
      // Paladin's Armored, Barbarian's Full Plate and Packing Steel).
      () => this.addIgnoreClumsy(),
      // 9: moves that prepare a spell as if it were one level lower
      // (Wizard's Prodigy and Master, Cleric's Chosen One and Anointed).
      () => this.addLowerSpells(),
      // 10: moves the system automates (Recover, Cast a Spell and so on) are
      // set up by their Automation setting rather than recognized by name.
      () => this.addAutomation(),
      // 11: Recover's dialog and a move's spent resource (Volley's ammo) are
      // now effect lines.
      () => this.addMoveActions(),
      // 12: healing moves are wired together. Hospitaller, Healing Song and
      // the like add to heals; Lay on Hands and Arcane Art heal from their
      // card, so their text no longer rolls the dice.
      () => this.addHealing(),
      // 13: spells have effects too: the Cure spells and Heal heal,
      // Contagion gives a disease.
      () => this.syncEffects(),
      // 14: Arcane Art's text doesn't roll its dice either: the heal is its
      // card's button, and the 1d4 is rolled with the ally's damage.
      () => this.fixArcaneArtRolls(),
      // 15: more compendium moves and spells have effects (Defend's hold,
      // Aid's +1 or -2, Bless, Invisibility...). New batches go in the
      // packs, and add another syncEffects step to copy them into the world.
      () => this.syncEffects(),
    ];

    const applied = game.settings.get('dungeonworld', 'systemMigrationVersion');
    for (let version = applied; version < migrations.length; version++) {
      await migrations[version]();
      await game.settings.set('dungeonworld', 'systemMigrationVersion', version + 1);
    }

    // With update 3, offer to link tokens already placed. Asked once it's
    // recorded, so reloading during the question doesn't ask again.
    if (applied < 3) await this.linkCharacterTokens({ ask: true });
  }

  /**
   * Update items in the world and on every actor.
   *
   * @param {(item: Item) => Object|null} updateFor  An item's update, or null
   *   to leave it as it is.
   */
  static async #updateItems(updateFor) {
    const worldUpdates = game.items.map(updateFor).filter(Boolean);
    if (worldUpdates.length) await Item.implementation.updateDocuments(worldUpdates);
    for (const actor of game.actors) {
      const updates = actor.items.map(updateFor).filter(Boolean);
      if (updates.length) await actor.updateEmbeddedDocuments('Item', updates);
    }
  }

  /**
   * Existing copies of the compendium's automated moves, by name, get their
   * Automation setting; the Cleric's Cast a Spell also revokes lost spells.
   * Moves already set up are left alone.
   */
  static async addAutomation() {
    await MigrateDw.#updateItems(item => {
      if (item.type != 'move' || item.system.automation) return null;
      const automation = DwMoves.forName(item.name);
      if (!automation) return null;
      return { _id: item.id, 'system.automation': automation };
    });
  }

  /**
   * Recover (set up as such, or by name) gets its effects: heal fully, and
   * remove debilities. A move's resource becomes a line that spends it.
   * Moves that already have effects are left alone.
   */
  static async addMoveActions() {
    await MigrateDw.#updateItems(item => {
      if (item.type != 'move' || item.system.actions?.length) return null;
      const actions = [];
      const update = { _id: item.id };
      const recover = item.system.automation == 'recover'
        || (!item.system.automation && DwUtility.nameKey(item.name) == 'recover');
      if (recover) {
        actions.push(
          { type: 'heal', target: 'self', amount: '', stat: '', name: '', when: 'always' },
          { type: 'removeDebility', target: 'self', amount: '', stat: '', name: '', when: 'always' },
        );
        if (item.system.automation == 'recover') update['system.automation'] = '';
      }
      const resource = item.system.resource;
      if (resource?.name && resource.when) {
        actions.push({ type: 'spend', target: 'self', amount: String(resource.amount ?? 1), stat: '', name: resource.name, when: resource.when });
        update['system.resource.name'] = '';
      }
      if (!actions.length) return null;
      update['system.actions'] = actions;
      return update;
    });
  }

  /**
   * Existing copies of the compendium's healing moves, by name: bonuses for
   * Hospitaller and the like, effects for Lay on Hands and Arcane Art, and
   * their text's dice rolls (now rolled by the card) taken out. Settings
   * already made are kept; only the rolls are taken out of the text.
   */
  static async addHealing() {
    const bonuses = {
      'hospitaller': { amount: '1d8', target: 'other', moves: '' },
      'perfect hospitaller': { amount: '2d8', target: 'other', moves: '' },
      'healing song': { amount: '1d8', target: 'any', moves: 'Arcane Art' },
      'healing chorus': { amount: '2d8', target: 'any', moves: 'Arcane Art' },
      'devoted healer': { amount: '@level.value', target: 'other', moves: '' },
    };
    const line = (type, when, transfer, extra = {}) =>
      ({ type, target: 'ally', amount: '', stat: '', condition: '', name: '', when, transfer, ...extra });
    const actions = {
      'lay on hands': [
        line('heal', 'success', false, { amount: '1d8' }),
        line('removeCondition', 'success', false, { condition: 'disease' }),
        line('heal', 'partial', true, { amount: '1d8' }),
        line('removeCondition', 'partial', true, { condition: 'disease' }),
      ],
      'arcane art': [line('heal', 'hit', false, { amount: '1d8' })],
    };
    // "Additional healing roll: [[/roll 1d8]]", and "[[1d8]]" in "heal [[1d8]]".
    const rollLine = /\s*<p>(Additional healing roll|Healing roll):\s*\[\[\/roll [^\]]+\]\]<\/p>/;
    const healRoll = /(heal )\[\[(1d8)\]\]/gi;
    await MigrateDw.#updateItems(item => {
      if (item.type != 'move') return null;
      const key = DwUtility.nameKey(item.name);
      const update = {};
      if (bonuses[key] && !String(item.system.healBonus?.amount ?? '').trim()) update['system.healBonus'] = bonuses[key];
      if (actions[key] && !item.system.actions?.length) {
        update['system.actions'] = actions[key];
        if (key == 'lay on hands') update['system.actionsChoose'] = 1;
      }
      const description = item.system.description ?? '';
      const text = bonuses[key] ? description.replace(rollLine, '') : key == 'arcane art' ? description.replace(healRoll, '$1$2') : description;
      if (text != description) update['system.description'] = text;
      if (key == 'lay on hands') {
        for (const result of ['success', 'partial']) {
          const value = item.system.moveResults?.[result]?.value ?? '';
          const fixed = value.replace(healRoll, '$1$2');
          if (fixed != value) update[`system.moveResults.${result}.value`] = fixed;
        }
      }
      return foundry.utils.isEmpty(update) ? null : { _id: item.id, ...update };
    });
  }

  /**
   * Take the dice rolls out of Arcane Art's text ("Heal [[1d8]] damage",
   * "+ [[1d4]] forward to damage"). Only those rolls are changed.
   */
  static async fixArcaneArtRolls() {
    const fix = (text) => text.replace(/(heal )\[\[(1d8)\]\]/gi, '$1$2').replace(/\+ ?\[\[(1d4)\]\]( forward to damage)/gi, '+$1$2');
    await MigrateDw.#updateItems(item => {
      if (item.type != 'move' || DwUtility.nameKey(item.name) != 'arcane art') return null;
      const description = item.system.description ?? '';
      const fixed = fix(description);
      return fixed != description ? { _id: item.id, 'system.description': fixed } : null;
    });
  }

  /**
   * Copy the compendium's effect settings into world copies of its moves and
   * spells (same type and name, and class when several share a name) that
   * don't have them yet: effects, how many to choose, heal bonus, and a roll
   * the compendium has but the copy lacks. The packs are the one place these
   * settings live, so a new batch of them only needs this run again. When
   * effects are added, a description line rolling what the card's buttons
   * now roll ("Self damage roll: [[/roll 1d6]]") is taken out.
   */
  static async syncEffects() {
    const fields = ['system.class', 'system.actions', 'system.actionsChoose', 'system.healBonus', 'system.rollType'];
    const sources = new Map();
    for (const pack of game.packs.filter(p => p.metadata.type == 'Item' && p.metadata.packageName == 'dungeonworld')) {
      for (const entry of await pack.getIndex({ fields })) {
        if (entry.type != 'move' && entry.type != 'spell') continue;
        const key = `${entry.type}:${DwUtility.nameKey(entry.name)}`;
        if (!sources.has(key)) sources.set(key, []);
        sources.get(key).push(entry);
      }
    }
    const rollLine = /\s*<p>[^<]*roll:\s*\[\[\/roll [^\]]+\]\]<\/p>/i;
    await MigrateDw.#updateItems(item => {
      const candidates = sources.get(`${item.type}:${DwUtility.nameKey(item.name)}`);
      if (!candidates) return null;
      const source = (candidates.find(e => DwUtility.sameClass(e.system?.class ?? '', item.system.class ?? '')) ?? candidates[0]).system ?? {};
      const update = {};
      if (source.actions?.length && !item.system.actions?.length) {
        update['system.actions'] = source.actions;
        if (Number(source.actionsChoose) && !Number(item.system.actionsChoose)) update['system.actionsChoose'] = Number(source.actionsChoose);
        const description = item.system.description ?? '';
        if (rollLine.test(description)) update['system.description'] = description.replace(rollLine, '');
      }
      if (source.healBonus?.amount && !item.system.healBonus?.amount) update['system.healBonus'] = source.healBonus;
      if (source.rollType && !item.system.rollType) update['system.rollType'] = source.rollType;
      return foundry.utils.isEmpty(update) ? null : { _id: item.id, ...update };
    });
  }

  /**
   * Existing copies of the compendium's moves like Prodigy, by name and
   * class. Copies already set up are left alone.
   */
  static async addLowerSpells() {
    const moves = {
      'prodigy': /wizard/i,
      'master': /wizard/i,
      'chosen one': /cleric/i,
      'anointed': /cleric/i,
    };
    const updateFor = (item) => {
      const cls = moves[DwUtility.nameKey(item.name)];
      return item.type == 'move' && cls?.test(item.system.class ?? '') && !Number(item.system.lowerSpells?.count)
        ? { _id: item.id, 'system.lowerSpells': { count: 1, levels: 1 } } : null;
    };
    await MigrateDw.#updateItems(updateFor);
  }

  /**
   * Existing copies of the moves that ignore clumsy on armor: those whose
   * text says so and that aren't set up yet.
   */
  static async addIgnoreClumsy() {
    const updateFor = (item) => item.type == 'move' && !item.system.ignoreClumsy
      && /ignore the clumsy tag on (any )?armor/i.test(item.system.description ?? '')
      ? { _id: item.id, 'system.ignoreClumsy': 'armor' } : null;
    await MigrateDw.#updateItems(updateFor);
  }

  /**
   * Give existing copies of the compendium's resource moves and healing gear
   * their new settings. Copies already set up (or customized) are left alone.
   */
  static async addResources() {
    const moves = {
      'volley': { name: 'ammo', amount: 1, when: 'partial' },
      'blot out the sun': { name: 'ammo', amount: 1, when: 'always' },
    };
    const gear = {
      'healing potion': { useHeal: 10, useTarget: 'self', useCure: true },
      'bandages': { useHeal: 4, useTarget: 'other', useCure: false },
      'poultices and herbs': { useHeal: 7, useTarget: 'other', useCure: false },
    };
    const updateFor = (item) => {
      const name = DwUtility.nameKey(item.name);
      if (item.type == 'move' && moves[name] && !item.system.resource?.name) {
        return { _id: item.id, 'system.resource': moves[name] };
      }
      if (item.type == 'equipment' && gear[name] && !Number(item.system.useHeal)) {
        const data = { _id: item.id };
        for (const [key, value] of Object.entries(gear[name])) data[`system.${key}`] = value;
        return data;
      }
      return null;
    };
    await MigrateDw.#updateItems(updateFor);
  }

  /**
   * Correct the typo in Defy Danger's description, in the world's items and
   * every actor's. Only that phrase is changed, so edited moves keep their
   * edits.
   */
  static async fixDefyDangerTypo() {
    const typo = /(<li>\s*)sing charm/;
    await MigrateDw.#updateItems(item => item.type == 'move' && typo.test(item.system.description ?? '')
      ? { _id: item.id, 'system.description': item.system.description.replace(typo, '$1using charm') } : null);
  }

  /**
   * In the world's class items, make gear groups labeled as what you start
   * with ("Starting gear", "Start with these") included rather than ticked.
   * Other groups are left as they are.
   */
  static async includeStartingGear() {
    const updates = [];
    for (const item of game.items.filter(i => i.type == 'class')) {
      const update = { _id: item.id };
      for (const [key, group] of Object.entries(item.system.equipment ?? {})) {
        if (group?.mode == 'checkbox' && /^\s*(starting gear|start with)/i.test(group.label ?? '')) {
          update[`system.equipment.${key}.mode`] = 'all';
        }
      }
      if (Object.keys(update).length > 1) updates.push(update);
    }
    if (updates.length) await Item.implementation.updateDocuments(updates);
  }

  /**
   * Make copies of Last Breath that still prompt for a modifier (the old
   * compendium version) roll plain 2d6 instead.
   */
  static async plainLastBreath() {
    await MigrateDw.#updateItems(item => item.type == 'move' && DwUtility.sameName(item.name, 'last breath') && item.system.rollType == 'BOND'
      ? { _id: item.id, 'system.rollType': 'PLAIN' } : null);
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

    const moveTypeFor = (name) => basicMoves.includes(name) ? 'basic' : (specialMoves.includes(name) ? 'special' : null);

    // Update each character's basic and special moves in one operation.
    for (const actor of game.actors.filter(a => a.type == 'character')) {
      const updates = actor.items
        .filter(i => i.type == 'move' && moveTypeFor(i.name))
        .map(i => ({ _id: i.id, 'system.moveType': moveTypeFor(i.name) }));
      if (updates.length) await actor.updateEmbeddedDocuments('Item', updates);
    }
  }

}
