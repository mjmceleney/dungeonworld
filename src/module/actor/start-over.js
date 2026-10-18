import { DwUtility } from "../utility.js";

const { DialogV2 } = foundry.applications.api;
const { FormDataExtended } = foundry.applications.ux;

/**
 * Start a character over at level 1, so they can be built again through the
 * level 1 builder. Used by the GM's Start over button, and by "Change to a
 * new class" beyond level 10.
 *
 * Changing class (reclass) follows the rules: ability scores, race, HP and
 * whatever moves are core to the character stay; the other class moves go,
 * replaced by the new class's starting moves.
 */
export class DwStartOver {

  /**
   * Ask what to clear, then start over.
   *
   * @param {Actor} actor
   * @param {{reclass?: boolean}} [options]
   * @return {Promise<boolean>} Whether the character was started over.
   */
  static async run(actor, { reclass = false } = {}) {
    const escape = (value) => Handlebars.escapeExpression(String(value ?? ''));
    const items = actor.items;
    const count = (filter) => items.filter(filter).length;
    const classMoves = items.filter(i => i.type == 'move' && i.system.class);
    const option = (name, checked, label) => `<div class="form-group"><label class="checkbox">
        <input type="checkbox" name="${name}" ${checked ? 'checked' : ''}> ${escape(label)}</label></div>`;

    const content = document.createElement('div');
    content.innerHTML = `<p>${escape(game.i18n.format(reclass ? 'DW.Reclass.Text' : 'DW.Sheet.StartOverText', { actor: actor.name }))}</p>`
      + (reclass
        // Changing class: pick the moves that are core to who they are.
        ? (classMoves.length ? `<fieldset class="dw-reclass-keep"><legend>${escape(game.i18n.localize('DW.Reclass.KeepMoves'))}</legend>`
            + classMoves.map(m => option(`keep.${m.id}`, false, m.name)).join('') + '</fieldset>' : '')
          + option('keepHp', true, game.i18n.localize('DW.Reclass.KeepHp'))
        : option('moves', true, game.i18n.format('DW.Sheet.StartOverMoves', { count: classMoves.length })))
      + option('spells', true, game.i18n.format('DW.Sheet.StartOverSpells', { count: count(i => i.type == 'spell') }))
      + option('equipment', false, game.i18n.format('DW.Sheet.StartOverEquipment', { count: count(i => i.type == 'equipment') }))
      + option('bonds', false, game.i18n.format('DW.Sheet.StartOverBonds', { count: count(i => i.type == 'bond') }))
      + (reclass ? '' : option('details', false, game.i18n.localize('DW.Sheet.StartOverDetails')));

    const result = await DialogV2.wait({
      classes: ['dw-start-over-dialog'],
      window: { title: game.i18n.localize(reclass ? 'DW.Reclass.Title' : 'DW.Sheet.StartOverTitle') },
      position: { width: 460 },
      content,
      buttons: [
        { action: 'confirm', label: reclass ? 'DW.Reclass.Confirm' : 'DW.Sheet.StartOver', icon: 'fa-solid fa-check', default: true,
          callback: (event, button) => foundry.utils.expandObject(new FormDataExtended(button.form).object) },
        { action: 'cancel', label: 'DW.Cancel', icon: 'fa-solid fa-xmark', callback: () => null },
      ],
      rejectClose: false,
    });
    if (!result || typeof result != 'object') return false;

    // Changing class removes every class move not kept; starting over removes
    // them all when asked.
    const removeMove = (move) => reclass ? !result.keep?.[move.id] : !!result.moves;
    const remove = items.filter(i =>
      (i.type == 'move' && i.system.class && removeMove(i))
      || (result.spells && i.type == 'spell')
      || (result.equipment && i.type == 'equipment')
      || (result.bonds && i.type == 'bond'));
    if (remove.length) await actor.deleteEmbeddedDocuments('Item', remove.map(i => i.id));

    const update = {
      'system.attributes.level.value': 1,
      'system.attributes.xp.value': 0,
      'flags.dungeonworld.levelup': false,
      ...DwUtility.deletionUpdate('flags.dungeonworld.multiclasses'),
      ...DwUtility.deletionUpdate('flags.dungeonworld.classLevels'),
    };
    if (result.details) {
      update['system.details.race'] = { value: '', description: '' };
      update['system.details.alignment'] = { value: '', description: '' };
    }
    // The builder then leaves their HP as it is.
    if (reclass && result.keepHp) update['flags.dungeonworld.keepHp'] = true;
    await actor.update(update);
    return true;
  }
}
