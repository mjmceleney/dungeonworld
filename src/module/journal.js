import { DwUtility } from "./utility.js";

/**
 * Give journals the system's fonts and colors.
 *
 * Core's journal sheets are left as they are: this only adds .dw-journal (and
 * .dw-dark for the dark theme) to their windows, which sheets.css styles. The
 * journalStyle setting picks which journals get it.
 */
export class DwJournal {
  static init() {
    Hooks.on('renderJournalEntrySheet', (app) => DwJournal.style(app));
    Hooks.on('renderJournalEntryPageSheet', (app) => DwJournal.style(app));
  }

  /** Restyle every open journal window, after the setting changes. */
  static restyleAll() {
    const { JournalEntrySheet, JournalEntryPageSheet } = foundry.applications.sheets.journal;
    for (const app of foundry.applications.instances.values()) {
      if (app instanceof JournalEntrySheet || app instanceof JournalEntryPageSheet) DwJournal.style(app);
    }
  }

  static style(app) {
    const element = app.element;
    if (!element) return;
    const styled = DwJournal.isStyled(app.document);
    // Match core's light or dark theme choice for this window.
    let dark = DwUtility.nightmode;
    if (element.classList.contains('theme-dark')) dark = true;
    else if (element.classList.contains('theme-light')) dark = false;
    element.classList.toggle('dw-journal', styled);
    element.classList.toggle('dw-dark', styled && dark);
  }

  /**
   * Whether a journal (or one of its pages) gets the system's look: all of
   * them, none, or only the system's own journals and copies imported from
   * its compendiums.
   */
  static isStyled(document) {
    const mode = game.settings.get('dungeonworld', 'journalStyle');
    if (mode === 'all') return true;
    if (mode === 'none') return false;
    const entry = document?.documentName === 'JournalEntryPage' ? document.parent : document;
    if (!entry) return false;
    const source = entry.pack ?? entry._stats?.compendiumSource ?? entry.flags?.core?.sourceId ?? '';
    return source.startsWith('dungeonworld.') || source.startsWith('Compendium.dungeonworld.');
  }
}
