import { DwUtility } from "../utility.js";

const { DialogV2 } = foundry.applications.api;
const { FormDataExtended } = foundry.applications.ux;

/**
 * How full a slider stop gets while it's dragged toward; it fills the rest of
 * the way when the band snaps into it.
 */
const DRAG_FILL = 0.6;

/**
 * The character sheet's custom trackers: counters, sliders and clocks.
 *
 * Stored in flags.dungeonworld.trackers, keyed by id. Each sheet makes one
 * DwTrackers; the sheet's tracker actions hand off to it, its context uses
 * prepare(), and its _onRender calls activate().
 */
export class DwTrackers {

  /**
   * @param {DwCharacterSheet} sheet The sheet showing the trackers.
   */
  constructor(sheet) {
    this.sheet = sheet;
  }

  /**
   * The tracker control that had focus before a change re-rendered the
   * sidebar, so focus can go back to it (and the arrow keys keep working).
   * @type {{id: string, cell: boolean, action?: string, delta?: string}|null}
   */
  #focus = null;

  /**
   * Values on their way to being saved, by tracker id, while their move
   * animates. Repeated clicks and key presses step on from these.
   * @type {Object<string, number>}
   */
  #pending = {};

  /**
   * After the sheet renders: make sliders and bars draggable and steppable
   * with the arrow keys, and put back focus that a change's render took.
   */
  activate() {
    const element = this.sheet.element;
    if (this.sheet.isEditable) {
      for (let track of element.querySelectorAll('.dw-scale--slider .dw-scale-track, .dw-scale--bar .dw-scale-track')) {
        track.addEventListener('pointerdown', event => this.#onPointerDown(event, track));
        track.addEventListener('keydown', event => this.#onKeyDown(event, track));
      }
    }
    this.#restoreFocus();
  }

  /**
   * The character's trackers, in the order they were added, ready for the
   * sidebar. Each is stored as {type, label, value, sort} plus its type's
   * settings: max (counter; 0 for none), left/right/options/display (slider),
   * or segments/marks (clock).
   *
   * @return {Object[]}
   */
  prepare() {
    const trackers = this.sheet.actor.flags?.dungeonworld?.trackers ?? {};
    return Object.entries(trackers)
      .filter(([id, tracker]) => tracker && typeof tracker == 'object')
      .map(([id, tracker]) => DwTrackers.#prepareTracker(id, tracker))
      .sort((a, b) => a.sort - b.sort);
  }

  /**
   * One tracker, ready for the sidebar. `top` is its highest value.
   *
   * - counter: counts up, to an optional max.
   * - slider: sits at one of its options between two named ends. Two options
   *   is a toggle; more show as a slider (a marker) or a bar (filled cells).
   * - clock: a pie whose segments fill as it advances, with optional marks
   *   (notches on the rim, e.g. at 6, 9 and 12) that light up once reached.
   */
  static #prepareTracker(id, tracker) {
    const clamp = (value, min, max) => Math.min(Math.max(Math.round(Number(value) || 0), min), max);
    const type = ['slider', 'clock'].includes(tracker.type) ? tracker.type : 'counter';
    const base = {
      id: id,
      type: type,
      label: tracker.label ?? '',
      sort: Number(tracker.sort) || 0,
      isCounter: type == 'counter',
      isSlider: type == 'slider',
      isClock: type == 'clock',
    };

    if (type == 'slider') {
      const options = Math.max(2, Math.round(Number(tracker.options) || 2));
      const top = options - 1;
      const value = clamp(tracker.value, 0, top);
      const display = options == 2 ? 'toggle' : (tracker.display == 'bar' ? 'bar' : 'slider');
      // A bar has a cell per step (empty at 0); a slider has a stop per option.
      const cells = display == 'bar'
        ? Array.from({ length: top }, (_, i) => ({ value: i + 1, on: i < value }))
        : Array.from({ length: options }, (_, i) => ({ value: i, on: i == value }));
      return {
        ...base, options, top, value, display, cells,
        isToggle: display == 'toggle',
        isBar: display == 'bar',
        left: tracker.left ?? '',
        right: tracker.right ?? '',
        leftOn: value == 0,
        rightOn: value == top,
      };
    }

    if (type == 'clock') {
      const segments = clamp(tracker.segments || 4, 2, 24);
      const value = clamp(tracker.value, 0, segments);
      // A notch across the rim where the mark's segment ends.
      const markValues = DwTrackers.#parseMarks(tracker.marks, segments);
      const marks = markValues.map(mark => ({
        value: mark,
        reached: value >= mark,
        d: `M${DwTrackers.#clockPoint(mark, segments, 36)} L${DwTrackers.#clockPoint(mark, segments, 53)}`,
      }));
      return { ...base, segments, top: segments, value, wedges: DwTrackers.clockWedges(segments, value), marks, markList: markValues.join(', ') };
    }

    const max = Math.max(0, Number(tracker.max) || 0);
    return { ...base, value: Number(tracker.value) || 0, max, top: max > 0 ? max : Infinity };
  }

  /**
   * A clock's wedges, clockwise from twelve o'clock, on a 100x100 viewBox:
   * each with its value (1 up), whether it's filled, and its SVG path.
   *
   * @param {number} segments
   * @param {number} value How many are filled.
   * @return {{value: number, on: boolean, d: string}[]}
   */
  static clockWedges(segments, value) {
    return Array.from({ length: segments }, (_, i) => ({
      value: i + 1,
      on: i < value,
      d: `M50,50 L${DwTrackers.#clockPoint(i, segments)} A46,46 0 0 1 ${DwTrackers.#clockPoint(i + 1, segments)} Z`,
    }));
  }

  /** The point on a clock's circle at the start of segment i. */
  static #clockPoint(i, segments, radius = 46) {
    const angle = (i / segments) * 2 * Math.PI - Math.PI / 2;
    return `${(50 + radius * Math.cos(angle)).toFixed(2)},${(50 + radius * Math.sin(angle)).toFixed(2)}`;
  }

  /**
   * A clock's marks: whole numbers from 1 to its segments, in order, from a
   * list or text like "6, 9, 12".
   */
  static #parseMarks(marks, segments) {
    const list = Array.isArray(marks) ? marks : String(marks ?? '').split(/[^0-9]+/);
    const values = list.map(Number).filter(n => Number.isInteger(n) && n >= 1 && n <= segments);
    return [...new Set(values)].sort((a, b) => a - b);
  }

  /** The stored data for a tracker from the dialog's answers. */
  static #trackerData(result) {
    const data = { type: result.type, label: result.label };
    if (result.type == 'slider') Object.assign(data, { left: result.left, right: result.right, options: result.options, display: result.display });
    else if (result.type == 'clock') Object.assign(data, { segments: result.segments, marks: DwTrackers.#parseMarks(result.marks, result.segments) });
    else data.max = result.max;
    return data;
  }

  /** Where a new tracker starts: a slider in the middle, anything else empty. */
  static #trackerStart(data) {
    if (data.type == 'slider' && data.display != 'bar' && data.options > 2) return Math.floor((data.options - 1) / 2);
    return 0;
  }

  /**
   * Ask for a tracker's type and settings; the fields shown follow the type.
   *
   * @param {Object|null} tracker The tracker being edited, or null for a new one.
   * @return {Promise<Object|null>} "save" with the cleaned-up values,
   *   "delete", or null if cancelled.
   */
  async #dialog(tracker = null) {
    const loc = (key) => DwUtility.escape(game.i18n.localize(key));
    const type = tracker?.type ?? 'counter';
    const option = (value, label, selected) => `<option value="${value}" ${selected ? 'selected' : ''}>${loc(label)}</option>`;
    const field = (forTypes, label, input) => `
      <div class="form-group ${forTypes.map(f => `dw-for-${f}`).join(' ')}">
        <label>${loc(label)}</label>
        ${input}
      </div>`;
    const content = [
      field(['counter', 'slider', 'clock'], 'DW.Sheet.TrackerType', `<select name="type">
        ${option('counter', 'DW.Sheet.TrackerCounter', type == 'counter')}
        ${option('slider', 'DW.Sheet.TrackerSlider', type == 'slider')}
        ${option('clock', 'DW.Sheet.TrackerClock', type == 'clock')}
      </select>`),
      field(['counter', 'slider', 'clock'], 'DW.Sheet.TrackerName',
        `<input type="text" name="label" value="${DwUtility.escape(tracker?.label ?? '')}" placeholder="${loc('DW.Sheet.NewTracker')}" autofocus>`),
      field(['counter'], 'DW.Sheet.TrackerMax',
        `<input type="number" name="max" min="0" step="1" value="${tracker?.max ? tracker.max : ''}" placeholder="${loc('DW.Sheet.TrackerNoMax')}">`),
      field(['slider'], 'DW.Sheet.TrackerLeft',
        `<input type="text" name="left" value="${DwUtility.escape(tracker?.left ?? '')}" placeholder="${loc('DW.Sheet.TrackerLeftHint')}">`),
      field(['slider'], 'DW.Sheet.TrackerRight',
        `<input type="text" name="right" value="${DwUtility.escape(tracker?.right ?? '')}" placeholder="${loc('DW.Sheet.TrackerRightHint')}">`),
      field(['slider'], 'DW.Sheet.TrackerOptions',
        `<input type="number" name="options" min="2" max="20" step="1" value="${tracker?.options ?? 3}">`),
      field(['scale'], 'DW.Sheet.TrackerDisplay', `<select name="display">
        ${option('slider', 'DW.Sheet.TrackerDisplaySlider', tracker?.display != 'bar')}
        ${option('bar', 'DW.Sheet.TrackerDisplayBar', tracker?.display == 'bar')}
      </select>`),
      field(['clock'], 'DW.Sheet.TrackerSegments',
        `<input type="number" name="segments" min="2" max="24" step="1" value="${tracker?.segments ?? 4}">`),
      field(['clock'], 'DW.Sheet.TrackerMarks',
        `<input type="text" name="marks" value="${DwUtility.escape(tracker?.markList ?? '')}" placeholder="${loc('DW.Sheet.TrackerMarksHint')}">`),
      `<p class="hint dw-for-slider">${loc('DW.Sheet.TrackerSliderHint')}</p>`,
    ].join('');

    // Show only the fields for the chosen type. Display only matters for a
    // slider with more than two options (two is always a toggle).
    const render = (event, dialog) => {
      const form = dialog.element.querySelector('form');
      if (!form) return;
      const sync = () => {
        const chosen = form.elements.type.value;
        const scale = chosen == 'slider' && Number(form.elements.options.value) > 2;
        for (const element of form.querySelectorAll('[class*="dw-for-"]')) {
          const show = element.classList.contains(`dw-for-${chosen}`) || (scale && element.classList.contains('dw-for-scale'));
          element.style.display = show ? '' : 'none';
        }
      };
      form.addEventListener('input', sync);
      form.addEventListener('change', sync);
      sync();
    };

    const buttons = [{
      action: 'save',
      label: 'DW.Sheet.Save',
      icon: 'fa-solid fa-check',
      default: true,
      callback: (event, button) => ({ action: 'save', ...new FormDataExtended(button.form).object }),
    }];
    if (tracker) {
      buttons.push({
        action: 'delete',
        label: 'DW.Sheet.DeleteTracker',
        icon: 'fa-solid fa-trash',
        callback: () => ({ action: 'delete' }),
      });
    }
    buttons.push({ action: 'cancel', label: 'DW.Cancel', icon: 'fa-solid fa-xmark', callback: () => null });

    const result = await DialogV2.wait({
      window: { title: game.i18n.localize(tracker ? 'DW.Sheet.EditTracker' : 'DW.Sheet.AddTracker') },
      position: { width: 380 },
      content: content,
      buttons: buttons,
      render: render,
      rejectClose: false,
    });
    if (!result || result.action !== 'save') return result ?? null;

    const chosen = ['slider', 'clock'].includes(result.type) ? result.type : 'counter';
    const label = String(result.label ?? '').trim();
    return {
      action: 'save',
      type: chosen,
      // A slider can go without a name: its ends say what it is.
      label: label || (chosen == 'slider' ? '' : game.i18n.localize('DW.Sheet.NewTracker')),
      max: Math.max(0, Number(result.max) || 0),
      left: String(result.left ?? '').trim(),
      right: String(result.right ?? '').trim(),
      options: Math.min(20, Math.max(2, Math.round(Number(result.options) || 2))),
      display: result.display == 'bar' ? 'bar' : 'slider',
      segments: Math.min(24, Math.max(2, Math.round(Number(result.segments) || 4))),
      marks: String(result.marks ?? ''),
    };
  }

  /** Add a tracker at the end of the list, after asking for its settings. */
  async add(event, target) {
    event.preventDefault();
    const result = await this.#dialog();
    if (result?.action !== 'save') return;

    const sorts = this.prepare().map(t => t.sort);
    const sort = sorts.length ? Math.max(...sorts) + 1 : 0;
    const id = foundry.utils.randomID();
    const data = DwTrackers.#trackerData(result);
    await this.sheet.actor.update({
      [`flags.dungeonworld.trackers.${id}`]: { ...data, value: DwTrackers.#trackerStart(data), sort: sort },
    });
  }

  /** Change a tracker's settings, or delete it. */
  async edit(event, target) {
    event.preventDefault();
    const id = target.closest('[data-tracker-id]')?.dataset.trackerId;
    const tracker = this.prepare().find(t => t.id == id);
    if (!tracker) return;

    const result = await this.#dialog(tracker);
    if (result?.action === 'delete') {
      await this.sheet.actor.update(DwUtility.deletionUpdate(`flags.dungeonworld.trackers.${id}`));
    }
    else if (result?.action === 'save') {
      // Keep the value within the new range; a new type starts over.
      const data = DwTrackers.#trackerData(result);
      const top = DwTrackers.#prepareTracker(id, { ...data, value: 0 }).top;
      const value = data.type == tracker.type
        ? Math.min(Math.max(tracker.value, 0), top)
        : DwTrackers.#trackerStart(data);
      await this.sheet.actor.update({ [`flags.dungeonworld.trackers.${id}`]: { ...data, value } });
    }
  }

  /** Step a tracker's value up or down by one, staying within its range. */
  async adjust(event, target) {
    event.preventDefault();
    const id = target.closest('[data-tracker-id]')?.dataset.trackerId;
    const tracker = this.prepare().find(t => t.id == id);
    const delta = Number(target.dataset.delta ?? 0);
    if (!tracker || !delta) return;
    await this.setValue(id, this.#current(tracker) + delta);
  }

  /**
   * Set a slider or clock to the value clicked. On a bar or a clock, clicking
   * the last filled cell or segment empties it.
   */
  async set(event, target) {
    event.preventDefault();
    if (!this.sheet.isEditable) return;
    const id = target.closest('[data-tracker-id]')?.dataset.trackerId;
    const tracker = this.prepare().find(t => t.id == id);
    let value = Number(target.dataset.value);
    if (!tracker || Number.isNaN(value)) return;
    if ('toggle' in target.dataset && value === tracker.value) value -= 1;
    await this.setValue(id, value);
  }

  /** A tracker's value, counting a change that's still animating. */
  #current(tracker) {
    return this.#pending[tracker.id] ?? tracker.value;
  }

  /**
   * Save a tracker's value, if it changed. On a slider or bar the move plays
   * first (see #animateScale); a drag has already shown it, so it passes
   * animate: false.
   */
  async setValue(id, value, { animate = true } = {}) {
    const tracker = this.prepare().find(t => t.id == id);
    if (!tracker) return;
    const from = this.#current(tracker);
    value = Math.min(Math.max(value, 0), tracker.top);
    if (value === from) return;
    const active = document.activeElement;
    const row = this.sheet.element?.querySelector(`[data-tracker-id="${id}"]`);
    if (row?.contains(active)) {
      this.#focus = {
        id: id,
        cell: active.matches('.dw-scale-cell, .dw-scale-half'),
        action: active.dataset.action,
        delta: active.dataset.delta,
      };
    }
    this.#pending[id] = value;
    try {
      if (animate) await this.#animateScale(row, from, value);
      // A later step may have replaced this one while it played.
      if (this.#pending[id] !== value) return;
      await this.sheet.actor.update({ [`flags.dungeonworld.trackers.${id}.value`]: value });
    }
    finally {
      if (this.#pending[id] === value) delete this.#pending[id];
    }
  }

  /**
   * Play a slider or bar moving from one slot to another, before the save
   * re-renders it: the dots drain and fill, and on a slider the band appears
   * stretched between the two stops and snaps into the new one. Resolves
   * when it's done; does nothing for other trackers.
   *
   * @param {HTMLElement} row  The tracker's row.
   * @param {number} from
   * @param {number} to
   */
  async #animateScale(row, from, to) {
    const track = row?.querySelector('.dw-scale--slider .dw-scale-track, .dw-scale--bar .dw-scale-track');
    if (!track) return;
    const cells = [...track.querySelectorAll('.dw-scale-cell')];
    const isBar = !!track.closest('.dw-scale--bar');
    DwTrackers.#snapping(track);
    // The fills follow the "on" class, animated by the stylesheet.
    for (const cell of cells) {
      const slot = Number(cell.dataset.value);
      cell.style.removeProperty('--dw-fill');
      cell.classList.toggle('on', isBar ? slot <= to : slot === to);
    }

    const band = track.querySelector('.dw-scale-band');
    if (band && cells[from] && cells[to]) {
      const left = track.getBoundingClientRect().left;
      const center = (i) => {
        const rect = cells[i].getBoundingClientRect();
        return rect.left + rect.width / 2 - left;
      };
      const step = cells.length > 1 ? center(1) - center(0) : 1;
      const place = (a, b) => {
        band.style.left = `${Math.min(a, b)}px`;
        band.style.width = `${Math.abs(b - a)}px`;
        band.style.setProperty('--dw-stretch', Math.min(Math.abs(b - a) / step, 1).toFixed(3));
      };
      // Stretched from the old stop to the new one, at once...
      band.style.transition = 'none';
      band.style.opacity = '1';
      place(center(from), center(to));
      band.getBoundingClientRect();
      // ...then snapping into the new one.
      band.style.transition = '';
      band.style.opacity = '';
      place(center(to), center(to));
    }
    await new Promise(resolve => setTimeout(resolve, 110));
  }

  /**
   * Mark a track as snapping for the length of the snap, so the new stop fills
   * as the band arrives rather than straight away (see _trackers.scss).
   */
  static #snapping(track) {
    track.classList.add('snapping');
    setTimeout(() => track.classList.remove('snapping'), 150);
  }

  /** Put focus back on the tracker control that had it before the render. */
  #restoreFocus() {
    const focus = this.#focus;
    this.#focus = null;
    const row = focus && this.sheet.element.querySelector(`[data-tracker-id="${focus.id}"]`);
    if (!row) return;
    let target;
    if (focus.cell) {
      // The current slot: the marked stop, the last filled cell, or the chosen half.
      const slots = [...row.querySelectorAll('.dw-scale-cell, .dw-scale-half')];
      target = slots.findLast(slot => slot.classList.contains('on')) ?? slots[0];
    }
    else if (focus.action) {
      const delta = focus.delta ? `[data-delta="${focus.delta}"]` : '';
      target = row.querySelector(`[data-action="${focus.action}"]${delta}`);
    }
    target?.focus();
  }

  /**
   * Drag a slider's marker, or a bar's fill. While dragging, the slots show
   * where the pointer is between them: a slider's stops grow and shrink as it
   * passes (the one it would land on is marked), with a band stretched from
   * the starting stop to the pointer; a bar fills up to it. On release the
   * band snaps into the nearest slot, which saves. A press that doesn't move
   * is left to the click (setTracker).
   *
   * @param {PointerEvent} event
   * @param {HTMLElement} track
   */
  #onPointerDown(event, track) {
    if (event.button !== 0) return;
    const id = track.closest('[data-tracker-id]')?.dataset.trackerId;
    const tracker = this.prepare().find(t => t.id == id);
    if (!tracker) return;

    const cells = [...track.querySelectorAll('.dw-scale-cell')];
    const band = track.querySelector('.dw-scale-band');
    const isBar = tracker.display == 'bar';
    const startX = event.clientX;
    let value = tracker.value;
    let dragging = false;

    // Where the pointer is, from 0 to the top value, between whole slots. A
    // bar's slots are its edges (empty at the left, full at the right); a
    // slider's are the centers of its stops.
    const centers = cells.map(cell => {
      const rect = cell.getBoundingClientRect();
      return rect.left + rect.width / 2;
    });
    const position = (x) => {
      if (isBar) {
        const rect = track.getBoundingClientRect();
        return Math.min(Math.max((x - rect.left) / rect.width, 0), 1) * tracker.top;
      }
      if (x <= centers[0]) return 0;
      const i = centers.findIndex((center, n) => n < centers.length - 1 && x < centers[n + 1]);
      if (i < 0) return tracker.top;
      return i + (x - centers[i]) / (centers[i + 1] - centers[i]);
    };
    // Each slot's fill (0 to 1) for a position: a slider's stops by how near
    // it is (up to `most`), a bar's cells by how much of them it covers.
    const show = (p, most = 1) => {
      for (const cell of cells) {
        const slot = Number(cell.dataset.value);
        const fill = isBar ? Math.min(Math.max(p - (slot - 1), 0), 1) : most * Math.max(0, 1 - Math.abs(p - slot));
        cell.style.setProperty('--dw-fill', fill.toFixed(3));
        if (!isBar) cell.classList.toggle('on', slot === Math.round(p));
      }
    };
    // The band runs from one point to another along the track (in pixels from
    // its left), thinning until it's stretched as far as the next stop.
    const step = centers.length > 1 ? centers[1] - centers[0] : 1;
    const stretch = (from, to) => {
      if (!band) return;
      band.style.left = `${Math.min(from, to)}px`;
      band.style.width = `${Math.abs(to - from)}px`;
      band.style.setProperty('--dw-stretch', Math.min(Math.abs(to - from) / step, 1).toFixed(3));
    };
    const fromLeft = (x) => x - track.getBoundingClientRect().left;

    const move = (e) => {
      if (!dragging) {
        if (Math.abs(e.clientX - startX) < 4) return;
        dragging = true;
        track.classList.add('dragging');
        // Keep following the pointer past the ends of the track.
        try { track.setPointerCapture(e.pointerId); } catch (err) { /* pointer already gone */ }
      }
      const p = position(e.clientX);
      value = Math.round(p);
      show(p, DRAG_FILL);
      const x = Math.min(Math.max(e.clientX, centers[0]), centers.at(-1));
      stretch(fromLeft(centers[tracker.value]), fromLeft(x));
    };
    const end = () => {
      track.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', end);
      window.removeEventListener('pointercancel', end);
      if (!dragging) return;
      // Snap into the nearest slot (animated), then save. The stop fills
      // completely as the band reaches it.
      track.classList.remove('dragging');
      DwTrackers.#snapping(track);
      show(value);
      if (!isBar) stretch(fromLeft(centers[value]), fromLeft(centers[value]));
      // The release also makes a click; don't let it set a value of its own.
      const swallow = (e) => { e.stopPropagation(); e.preventDefault(); };
      track.addEventListener('click', swallow, { capture: true, once: true });
      setTimeout(() => track.removeEventListener('click', swallow, { capture: true }), 0);
      setTimeout(() => this.setValue(id, value, { animate: false }), 110);
    };
    track.addEventListener('pointermove', move);
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);
  }

  /**
   * Arrow keys step a slider or bar; Home and End go to the ends.
   *
   * @param {KeyboardEvent} event
   * @param {HTMLElement} track
   */
  #onKeyDown(event, track) {
    const id = track.closest('[data-tracker-id]')?.dataset.trackerId;
    const tracker = this.prepare().find(t => t.id == id);
    if (!tracker) return;
    const current = this.#current(tracker);
    const values = { ArrowLeft: current - 1, ArrowDown: current - 1, ArrowRight: current + 1, ArrowUp: current + 1, Home: 0, End: tracker.top };
    if (!(event.key in values)) return;
    event.preventDefault();
    this.setValue(id, values[event.key]);
  }
}
