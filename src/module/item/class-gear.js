import { DwUtility } from "../utility.js";

/**
 * A class's starting gear, as the class item stores it in system.equipment:
 * groups keyed "0", "1", ..., each with
 *
 * - label: what the group is ("Choose your defenses").
 * - mode: "all" (you get everything in it), "radio" (choose one) or
 *   "checkbox" (choose `count` of them, or any number when count is 0).
 * - options: the choices, each giving one or more items and/or coins:
 *   [{items: [id, ...], quantities: {id: 2}, coins: 0}]. "Long sword and
 *   shield" is one option with two items.
 * - items: every item id in the group. Older classes only have this, and
 *   each item is then its own option.
 */
export class DwClassGear {

  /** The group's choices, from its options or (older classes) its items. */
  static options(group) {
    if (Array.isArray(group?.options) && group.options.length) {
      return group.options.map(option => ({
        items: (option?.items ?? []).filter(Boolean),
        quantities: option?.quantities ?? {},
        coins: Math.max(0, Number(option?.coins) || 0),
      }));
    }
    return (group?.items ?? []).filter(Boolean).map(id => ({ items: [id], quantities: {}, coins: 0 }));
  }

  /** Every item id the group's options use, for the `items` list. */
  static itemIds(options) {
    return [...new Set(options.flatMap(option => option.items))];
  }

  /**
   * How the group is chosen from, and the words that say so.
   *
   * @return {{mode: string, count: number, label: string}}
   */
  static rule(group, optionCount) {
    const mode = ['all', 'radio', 'checkbox'].includes(group?.mode) ? group.mode : 'radio';
    let count = mode == 'radio' ? 1 : Math.max(0, Math.round(Number(group?.count) || 0));
    if (mode == 'checkbox' && count >= optionCount) count = 0;
    let label;
    if (mode == 'all') label = game.i18n.localize('DW.Gear.RuleAll');
    else if (mode == 'radio') label = game.i18n.localize('DW.Gear.RuleOne');
    else if (count) label = game.i18n.format('DW.Gear.RuleCount', { count });
    else label = game.i18n.localize('DW.Gear.RuleAny');
    return { mode, count, label };
  }

  /**
   * A class's gear groups, ready to show: each option with its items'
   * documents and quantities.
   *
   * @param {Item} classItem
   * @return {Promise<Object[]>}
   */
  static async prepare(classItem) {
    const groups = classItem?.system?.equipment;
    if (!groups || typeof groups != 'object') return [];
    const documents = new Map();
    for (const item of await DwUtility.getEquipment() || []) {
      if (!documents.has(item.id)) documents.set(item.id, item);
    }

    return Object.entries(groups).filter(([, group]) => group).map(([key, group]) => {
      const options = DwClassGear.options(group).map((option, index) => {
        const items = option.items.map(id => {
          const doc = documents.get(id);
          if (!doc) return null;
          const quantity = Math.max(1, Number(option.quantities?.[id]) || 1);
          return { id, doc, quantity, name: doc.name, img: doc.img, system: doc.system };
        }).filter(Boolean);
        const parts = items.map(i => i.quantity > 1 ? `${i.quantity} × ${i.name}` : i.name);
        if (option.coins) parts.push(game.i18n.format('DW.Gear.Coins', { coins: option.coins }));
        return {
          key: String(index),
          items,
          coins: option.coins,
          label: parts.join(game.i18n.localize('DW.Gear.And')),
          empty: !parts.length,
        };
      }).filter(option => !option.empty);
      const rule = DwClassGear.rule(group, options.length);
      return {
        key,
        mode: rule.mode,
        count: rule.count,
        label: group.label || rule.label,
        rule: rule.label,
        included: rule.mode == 'all',
        radio: rule.mode == 'radio',
        options,
      };
    }).filter(group => group.options.length);
  }

  /**
   * The gear a builder form chose: item data to create (copies, with
   * quantities applied) and coins to add. Throws, with a message for the
   * player, if a group's choice isn't complete.
   *
   * @param {HTMLFormElement} form
   * @param {Object[]} groups From prepare().
   * @return {{items: Object[], coins: number}}
   */
  static chosen(form, groups) {
    const items = [];
    let coins = 0;
    const missing = [];
    for (const group of groups) {
      let picked;
      if (group.included) picked = group.options;
      else {
        const keys = [...form.querySelectorAll(`input[data-gear-group="${group.key}"]:checked`)].map(i => i.dataset.gearOption);
        picked = group.options.filter(o => keys.includes(o.key));
        const needed = group.radio ? 1 : group.count;
        if (needed && picked.length != needed) missing.push(`${group.label} (${group.rule})`);
      }
      for (const option of picked) {
        coins += option.coins;
        for (const entry of option.items) {
          const data = entry.doc.toObject();
          delete data._id;
          // "2 healing potions": two of the item.
          if (entry.quantity > 1) data.system.quantity = (Number(data.system.quantity) || 1) * entry.quantity;
          items.push(data);
        }
      }
    }
    if (missing.length) {
      throw new Error(game.i18n.format('DW.Gear.Incomplete', { groups: missing.join('; ') }));
    }
    return { items, coins };
  }
}
