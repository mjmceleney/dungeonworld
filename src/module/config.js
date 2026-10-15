import { DwUtility } from "./utility.js";

export const DW = {};

DW.abilities = {
  "str": "DW.AbilityStr",
  "dex": "DW.AbilityDex",
  "con": "DW.AbilityCon",
  "int": "DW.AbilityInt",
  "wis": "DW.AbilityWis",
  "cha": "DW.AbilityCha"
};

DW.debilities = {
  "str": "DW.DebilityStr",
  "dex": "DW.DebilityDex",
  "con": "DW.DebilityCon",
  "int": "DW.DebilityInt",
  "wis": "DW.DebilityWis",
  "cha": "DW.DebilityCha"
};

DW.rollResults = {
  failure: {
    start: null,
    end: 6,
    label: 'DW.failure'
  },
  partial: {
    start: 7,
    end: 9,
    label: 'DW.partial'
  },
  success: {
    start: 10,
    end: null,
    label: 'DW.success'
  }
};

export class DwClassList {
  /**
   * Promise resolving to the sorted, de-duplicated list of class items. Kept
   * between calls because loading compendium documents requires a server
   * round-trip. Cleared by DwClassList.invalidate() when class items change.
   */
  static _cache = null;

  static async getClasses(labels_only = true) {
    if (!this._cache) {
      this._cache = this._loadClasses().catch(err => {
        this._cache = null;
        throw err;
      });
    }
    const classes = await this._cache;
    return labels_only ? classes.map(c => c.name) : [...classes];
  }

  static invalidate() {
    this._cache = null;
  }

  static async _loadClasses() {
    // First, retrieve any custom or overridden classes so that we can
    // prioritize those.
    let classes = game.items.filter(item => item.type == 'class');

    classes.push(...(await DwUtility.loadCompendia('classes')));

    // Reduce duplicates. Because item classes happen first, this will prevent
    // duplicate compendium entries from overriding the items.
    const charClassNames = new Set();
    classes = classes.filter(charClass => {
      if (charClassNames.has(charClass.name)) return false;
      charClassNames.add(charClass.name);
      return true;
    });

    // Sort the class objects list.
    classes.sort((a, b) => {
      const aSort = a.name.toLowerCase();
      const bSort = b.name.toLowerCase();
      if (aSort < bSort) {
        return -1;
      }
      if (aSort > bSort) {
        return 1;
      }
      return 0;
    });

    return classes;
  }
}
