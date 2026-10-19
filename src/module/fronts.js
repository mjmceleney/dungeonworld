import { DwUtility } from "./utility.js";
import { DwTrackers } from "./actor/trackers.js";

const { HandlebarsApplicationMixin, ApplicationV2, DialogV2 } = foundry.applications.api;
const { FormDataExtended } = foundry.applications.ux;

/**
 * The rules' danger types, by category. Each type's name and impulse are
 * DW.Fronts.Type.<key> and DW.Fronts.TypeImpulse.<key>.
 */
const DANGER_TYPES = {
  organization: ['misguidedGood', 'thievesGuild', 'cult', 'religiousOrganization', 'corruptGovernment', 'cabal'],
  planar: ['god', 'demonPrince', 'elementalLord', 'forceOfChaos', 'choirOfAngels', 'constructOfLaw'],
  arcane: ['lordOfTheUndead', 'powerMadWizard', 'sentientArtifact', 'ancientCurse', 'chosenOne', 'dragon'],
  horde: ['wanderingBarbarians', 'humanoidVermin', 'undergroundDwellers', 'plagueOfTheUndead'],
  place: ['abandonedTower', 'unholyGround', 'elementalVortex', 'darkPortal', 'shadowland', 'placeOfPower'],
};

/** The rules' impending dooms. */
const DOOMS = ['tyranny', 'pestilence', 'destruction', 'usurpation', 'impoverishment', 'chaos'];

/** Campaign fronts span the campaign; adventure fronts, one adventure. */
const KINDS = ['campaign', 'adventure'];

/** The setting holding every front. */
const SETTING = 'fronts';

/**
 * Fronts, per the rules: a front has its cast and stakes questions, and
 * groups dangers. Each danger has a type and impulse, grim portents that
 * come to pass if no one acts, and the impending doom they lead to.
 *
 * Every front is in one world setting, which only the GM changes. This
 * window lists them all, each danger with its portent clock; a front opens
 * in full, with the portents as checklists, and its edit mode is a form that
 * saves as it's changed.
 *
 * Stored as {frontId: {name, kind, description, sort, dangers, stakes,
 * cast}}, each danger {name, type, impulse, description, sort, portents,
 * doom, doomText}. The lists are keyed by id, each entry with a sort, so
 * edits are merged by id: an edit that arrives after its row was removed is
 * dropped rather than landing on another row.
 */
export class DwFronts extends HandlebarsApplicationMixin(ApplicationV2) {

  /** Register the setting and the Journal sidebar's Fronts button. */
  static init() {
    game.settings.register('dungeonworld', SETTING, {
      scope: 'world',
      config: false,
      type: Object,
      default: {},
      onChange: () => foundry.applications.instances.get('dw-fronts')?.render(),
    });
    Hooks.on('renderJournalDirectory', (app, html) => {
      const actions = html.querySelector('.header-actions');
      if (!game.user.isGM || !actions || actions.querySelector('.dw-fronts-open')) return;
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'dw-fronts-open';
      button.innerHTML = `<i class="fa-solid fa-chess-rook" inert></i> <span>${DwUtility.escape(game.i18n.localize('DW.Fronts.Title'))}</span>`;
      button.addEventListener('click', () => DwFronts.open());
      actions.append(button);
    });
  }

  /** Open the Fronts window (GM only). */
  static open() {
    if (!game.user.isGM) return;
    const app = foundry.applications.instances.get('dw-fronts') ?? new DwFronts();
    return app.render({ force: true });
  }

  /** @override */
  static DEFAULT_OPTIONS = {
    id: 'dw-fronts',
    tag: 'form',
    classes: ['dw-v2', 'dw-fronts'],
    position: { width: 960, height: 780 },
    window: { title: 'DW.Fronts.Title', icon: 'fa-solid fa-chess-rook', resizable: true },
    form: { handler: DwFronts.#onSubmit, submitOnChange: true, closeOnSubmit: false },
    actions: {
      filter: DwFronts.#onFilter,
      openFront: DwFronts.#onOpenFront,
      back: DwFronts.#onBack,
      addFront: DwFronts.#onAddFront,
      toggleEdit: DwFronts.#onToggleEdit,
      deleteFront: DwFronts.#onDeleteFront,
      addDanger: DwFronts.#onAddDanger,
      removeDanger: DwFronts.#onRemoveDanger,
      addEntry: DwFronts.#onAddEntry,
      removeEntry: DwFronts.#onRemoveEntry,
      togglePortent: DwFronts.#onTogglePortent,
      openActor: DwFronts.#onOpenActor,
    },
  };

  /** @override */
  static PARTS = {
    board: {
      template: 'systems/dungeonworld/templates/dialog/fronts.html',
      scrollable: ['.dw-fronts-scroll'],
    },
  };

  /** @inheritdoc */
  _initializeApplicationOptions(options) {
    // Match core's light or dark theme choice.
    return DwUtility.applyThemeClass(super._initializeApplicationOptions(options));
  }

  /** The id of the front shown in full, or null for the list. */
  #open = null;

  /** Whether the open front is shown as a form. */
  #editing = false;

  /** Which fronts are shown: "all", or a kind. */
  #filter = 'all';

  /** Saves, one after another, so none overwrites another's change. */
  #queue = Promise.resolve();

  /* -------------------------------------------- */
  /*  Data                                        */
  /* -------------------------------------------- */

  /**
   * A copy of every front, to change and save. Fields a front or danger was
   * saved without are filled in, since edits only go to fields they have.
   */
  static #stored() {
    const fronts = foundry.utils.deepClone(game.settings.get('dungeonworld', SETTING) ?? {});
    for (const front of Object.values(fronts)) {
      for (const [key, value] of Object.entries(DwFronts.#frontDefaults())) front[key] ??= value;
      for (const danger of Object.values(front.dangers)) {
        for (const [key, value] of Object.entries(DwFronts.#dangerDefaults())) danger[key] ??= value;
      }
    }
    return fronts;
  }

  /** A new front's dangers, stakes and cast. */
  static #frontDefaults() {
    return { dangers: {}, stakes: {}, cast: {} };
  }

  /** A new danger's grim portents and impending doom. */
  static #dangerDefaults() {
    return { portents: {}, doom: '', doomText: '' };
  }

  /** A list's entries in order. */
  static #sorted(list) {
    return Object.entries(list ?? {})
      .map(([id, entry]) => ({ ...entry, id }))
      .sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0));
  }

  /** The next sort value for a new entry in a list. */
  static #nextSort(list) {
    return Math.max(0, ...Object.values(list ?? {}).map(entry => Number(entry.sort) || 0)) + 1;
  }

  /** A danger's impulse from its type, or '' for a type of the GM's own. */
  static #impulseFor(type) {
    return type ? game.i18n.localize(`DW.Fronts.TypeImpulse.${type}`) : '';
  }

  static #newDanger(sort = 1) {
    return { name: game.i18n.localize('DW.Fronts.NewDanger'), type: '', impulse: '', description: '', sort, ...DwFronts.#dangerDefaults() };
  }

  /** New entries for each list: a grim portent, a stakes question, a cast member. */
  static #newEntry(list, sort) {
    if (list == 'cast') return { name: '', actor: '', sort };
    if (list == 'portents') return { text: '', done: false, sort };
    return { text: '', sort };
  }

  /** The edits in the open forms, as {frontId: changes}. */
  #readForm() {
    return foundry.utils.expandObject(new FormDataExtended(this.element).object).fronts ?? {};
  }

  /**
   * Copy edits onto the fronts, only where the fronts already have that
   * field, so removed fronts and rows stay removed.
   */
  static #merge(target, edits) {
    for (const [key, value] of Object.entries(edits ?? {})) {
      if (!(key in target)) continue;
      const current = target[key];
      if (current && typeof current == 'object' && value && typeof value == 'object') DwFronts.#merge(current, value);
      else if (typeof current != 'object') target[key] = value;
    }
  }

  /**
   * Save the form's edits and then a change, after any saves already under
   * way. Each save starts from what's stored at the time.
   *
   * @param {Object} edits From #readForm(), read when the change was asked for.
   * @param {(fronts: Object) => void} [change]
   */
  #save(edits, change = () => {}) {
    this.#queue = this.#queue.then(async () => {
      const fronts = DwFronts.#stored();
      // A danger whose type changed takes the new type's impulse, unless the
      // GM wrote their own.
      const before = Object.values(fronts).flatMap(front => Object.values(front.dangers ?? {}));
      const types = new Map(before.map(danger => [danger, { type: danger.type, impulse: danger.impulse }]));
      DwFronts.#merge(fronts, edits);
      for (const [danger, old] of types) {
        if (danger.type == old.type) continue;
        if (!old.impulse || old.impulse == DwFronts.#impulseFor(old.type)) danger.impulse = DwFronts.#impulseFor(danger.type);
      }
      change(fronts);
      await game.settings.set('dungeonworld', SETTING, fronts);
    }).catch(err => console.error('Dungeon World | Saving fronts failed', err));
    return this.#queue;
  }

  /* -------------------------------------------- */
  /*  Context                                     */
  /* -------------------------------------------- */

  /** @override */
  async _prepareContext(options) {
    const stored = DwFronts.#stored();
    const all = DwFronts.#sorted(stored);
    // The list shows while the open front isn't there: deleted, or a new
    // one not saved yet.
    const open = all.find(front => front.id == this.#open);
    if (open) {
      const actors = this.#editing ? game.actors.contents
        .filter(a => ['npc', 'character', 'hireling'].includes(a.type))
        .sort((a, b) => a.name.localeCompare(b.name)) : [];
      return { front: this.#prepareFront(open, actors, this.#editing) };
    }
    return {
      filters: ['all', ...KINDS].map(key => ({
        key,
        label: key == 'all' ? 'DW.Fronts.FilterAll' : `DW.Fronts.Kind.${key}`,
        active: this.#filter == key,
        count: key == 'all' ? all.length : all.filter(front => front.kind == key).length,
      })),
      empty: !all.length,
      fronts: all
        .filter(front => this.#filter == 'all' || front.kind == this.#filter)
        .map(front => this.#prepareFront(front, [], false)),
    };
  }

  /**
   * A danger's grim portents: the list, how many have come to pass, the
   * clock, and the next one still to come.
   */
  static #preparePortents(danger) {
    const portents = DwFronts.#sorted(danger.portents);
    const done = portents.filter(p => p.done).length;
    const total = portents.length;
    return {
      portents,
      done,
      total,
      // A clock needs two segments or more; a single portent just fills.
      wedges: total > 1 ? DwTrackers.clockWedges(total, done) : null,
      full: total > 0 && done == total,
      next: portents.find(p => !p.done)?.text ?? '',
    };
  }

  /** A front, ready for its list row or its full view. */
  #prepareFront(front, actors, editing) {
    const option = (value, label, current) => ({ value, label, selected: value == current });
    return {
      id: front.id,
      name: front.name,
      kind: front.kind,
      kindLabel: `DW.Fronts.Kind.${front.kind}`,
      kinds: KINDS.map(key => option(key, `DW.Fronts.Kind.${key}`, front.kind)),
      description: front.description,
      editing,
      dangers: DwFronts.#sorted(front.dangers).map(danger => ({
        ...danger,
        ...DwFronts.#preparePortents(danger),
        typeLabel: danger.type ? game.i18n.localize(`DW.Fronts.Type.${danger.type}`) : '',
        doomLabel: danger.doom ? game.i18n.localize(`DW.Fronts.Doom.${danger.doom}`) : '',
        // For the form: the types grouped by category, and the dooms.
        typeGroups: editing ? Object.entries(DANGER_TYPES).map(([category, types]) => ({
          label: `DW.Fronts.Category.${category}`,
          options: types.map(type => option(type, `DW.Fronts.Type.${type}`, danger.type)),
        })) : null,
        dooms: editing ? DOOMS.map(key => option(key, `DW.Fronts.Doom.${key}`, danger.doom)) : null,
      })),
      stakes: DwFronts.#sorted(front.stakes),
      cast: DwFronts.#sorted(front.cast).map(member => ({
        ...member,
        actorName: game.actors.get(member.actor)?.name ?? '',
        actors: editing ? actors.map(a => option(a.id, a.name, member.actor)) : null,
      })),
    };
  }

  /* -------------------------------------------- */
  /*  Actions                                     */
  /* -------------------------------------------- */

  /** The front, danger and entry ids an element is inside. */
  static #ids(target) {
    return {
      front: target.closest('[data-front]')?.dataset.front,
      danger: target.closest('[data-danger]')?.dataset.danger,
      list: target.closest('[data-list]')?.dataset.list,
      entry: target.closest('[data-entry]')?.dataset.entry,
    };
  }

  /**
   * An entry's list: a danger's grim portents, or the front's stakes or
   * cast. Null if there's no such front or danger.
   */
  static #list(fronts, { front, danger, list }) {
    const parent = list == 'portents' ? fronts[front]?.dangers?.[danger] : fronts[front];
    if (!parent || !['portents', 'stakes', 'cast'].includes(list)) return null;
    return parent[list] ??= {};
  }

  /** @this {DwFronts} */
  static #onSubmit(event, form, formData) {
    return this.#save(foundry.utils.expandObject(formData.object).fronts ?? {});
  }

  /** @this {DwFronts} */
  static #onFilter(event, target) {
    this.#filter = target.dataset.filter;
    this.render();
  }

  /** Show a front in full. @this {DwFronts} */
  static #onOpenFront(event, target) {
    this.#open = DwFronts.#ids(target).front;
    this.#editing = false;
    this.render();
  }

  /** Back to the list, after saving any edits. @this {DwFronts} */
  static async #onBack() {
    await this.#save(this.#readForm());
    this.#open = null;
    this.#editing = false;
    this.render();
  }

  /** @this {DwFronts} */
  static async #onAddFront() {
    const id = foundry.utils.randomID();
    // A new front opens as a form.
    this.#open = id;
    this.#editing = true;
    await this.#save(this.#readForm(), fronts => {
      fronts[id] = {
        name: game.i18n.localize('DW.Fronts.NewName'),
        kind: 'adventure',
        description: '',
        sort: DwFronts.#nextSort(fronts),
        ...DwFronts.#frontDefaults(),
        dangers: { [foundry.utils.randomID()]: DwFronts.#newDanger() },
      };
    });
  }

  /** @this {DwFronts} */
  static async #onToggleEdit() {
    await this.#save(this.#readForm());
    this.#editing = !this.#editing;
    this.render();
  }

  /** @this {DwFronts} */
  static async #onDeleteFront(event, target) {
    const { front } = DwFronts.#ids(target);
    const edits = this.#readForm();
    const name = DwFronts.#stored()[front]?.name ?? '';
    const yes = await DialogV2.confirm({
      window: { title: game.i18n.localize('DW.Fronts.Delete') },
      content: `<p>${DwUtility.escape(game.i18n.format('DW.Fronts.DeleteConfirm', { name }))}</p>`,
      rejectClose: false,
    });
    if (!yes) return;
    // Back to the list.
    this.#open = null;
    this.#editing = false;
    await this.#save(edits, fronts => { delete fronts[front]; });
  }

  /** @this {DwFronts} */
  static async #onAddDanger(event, target) {
    const { front } = DwFronts.#ids(target);
    await this.#save(this.#readForm(), fronts => {
      const dangers = fronts[front] && (fronts[front].dangers ??= {});
      if (dangers) dangers[foundry.utils.randomID()] = DwFronts.#newDanger(DwFronts.#nextSort(dangers));
    });
  }

  /** @this {DwFronts} */
  static async #onRemoveDanger(event, target) {
    const { front, danger } = DwFronts.#ids(target);
    const edits = this.#readForm();
    const name = DwFronts.#stored()[front]?.dangers?.[danger]?.name ?? '';
    const yes = await DialogV2.confirm({
      window: { title: game.i18n.localize('DW.Fronts.RemoveDanger') },
      content: `<p>${DwUtility.escape(game.i18n.format('DW.Fronts.RemoveDangerConfirm', { name }))}</p>`,
      rejectClose: false,
    });
    if (!yes) return;
    await this.#save(edits, fronts => { delete fronts[front]?.dangers?.[danger]; });
  }

  /** Add a grim portent, stakes question or cast member. @this {DwFronts} */
  static async #onAddEntry(event, target) {
    const ids = DwFronts.#ids(target);
    await this.#save(this.#readForm(), fronts => {
      const list = DwFronts.#list(fronts, ids);
      if (list) list[foundry.utils.randomID()] = DwFronts.#newEntry(ids.list, DwFronts.#nextSort(list));
    });
  }

  /** @this {DwFronts} */
  static async #onRemoveEntry(event, target) {
    const ids = DwFronts.#ids(target);
    await this.#save(this.#readForm(), fronts => {
      const list = DwFronts.#list(fronts, ids);
      if (list) delete list[ids.entry];
    });
  }

  /** Mark a grim portent as come to pass, or not. @this {DwFronts} */
  static async #onTogglePortent(event, target) {
    const ids = DwFronts.#ids(target);
    await this.#save(this.#readForm(), fronts => {
      const portent = DwFronts.#list(fronts, { ...ids, list: 'portents' })?.[ids.entry];
      if (portent) portent.done = !portent.done;
    });
  }

  /** @this {DwFronts} */
  static #onOpenActor(event, target) {
    game.actors.get(target.dataset.actor)?.sheet.render(true);
  }
}
