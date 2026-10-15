# Foundry VTT V14 Compatibility Plan

Goal: make the Dungeon World system run cleanly on Foundry V14 (current stable 14.369) while keeping V13 support if practical.

**Summary.** V14 does not remove the V1 Application framework. `foundry.appv1.*`, `Dialog` and the jQuery-based sheets are deprecated, with removal scheduled for V16. That makes V14 support a small, targeted change set (Phases 1–3). The full ApplicationV2 / DataModel migration (Phase 5) is the larger job, which must be done before V16 but isn't needed for V14.

Status key: `[ ]` todo · `[x]` done · `[~]` in progress / needs verification

---

## Phase 0: Environment setup

- [ ] Install Foundry V14 separately from V13. V14 can't be updated in place: uninstall and reinstall, or use a separate install directory. V14 requires Node 24+ (local Node is v25.2.1, which works).
- [ ] Copy an existing V13 test world into the V14 data directory. Never open the original world in V14, because the world migration is one-way.
- [ ] Update `foundry-config.yaml` (from `example.foundry-config.yaml`) / symlinks so `dist/` is served to the V14 install (`npm run symlinks:create`).
- [ ] Run `npm ci`, then confirm `npm run build` still works (gulp 4 on Node 24+). `node_modules` isn't installed yet. Phase 1's SCSS was checked with a standalone `sass` compile.
- [ ] Baseline: launch the world on V14 **before** making changes and record console errors and deprecation warnings in the "Findings" section at the bottom.

## Phase 1: Required changes

### 1.1 Manifest: [src/yaml/system.yml](src/yaml/system.yml)

- [x] Update `compatibility` to `minimum: "13"`, `verified: "14.369"`, `maximum: "14"`. Nothing in Phase 1 is V14-only, so V13 support stays.
- [x] Add `type: system` (confirmed in the V14 `BaseSystem` schema; V13 ignores unknown fields).
- [ ] Bump `version` and the `download` URL when cutting the release (Phase 3).

### 1.2 Rich-text editors: TinyMCE removed (#12330)

In the V14 source, the `{{editor}}` helper and `FormApplication#_activateEditor` already **default to ProseMirror**, so the old templates wouldn't hard-break on V14. On V13 they still got TinyMCE. Setting the engine explicitly gives both versions the same editor.

- [x] Add `engine="prosemirror"` to all 14 `{{editor}}` calls in `templates/sheet/` and `templates/items/`.
- [x] Class sheet: switch `system.description` to `system.descriptionEnriched`, which the base `DwItemSheet#getData` already provides.
- [x] **Bond sheet:** the editor writes to the item **name**, and ProseMirror wraps content in `<p>`. Bond names are rendered as enriched HTML (`{{{item.nameEnriched}}}`, so links in bond text work), so the editor stays. Instead, `ItemDw#_preUpdate` ([item.js](src/module/item/item.js)) unwraps a single `<p>…</p>` from bond names. It skips multi-paragraph and empty values.
- [x] Remove dead TinyMCE styles (`_editor.scss`, `_sheet-wrapper.scss`, `_nightmode.scss`).
- [x] Add basic ProseMirror sizing in [_editor.scss](src/styles/src/global/components/_editor.scss) (`.editor.prosemirror` min-height 170px, menu/container flex). The SCSS compiles.
- [ ] **Test:** check visually on both versions: small editors (look/alignment/race), editor menu buttons, saving.
- [ ] **Test:** the dynamic `moveResults` editors save to `system.moveResults.<key>.value`.
- [ ] **Test:** edit an existing bond and a new bond; confirm the name has no `<p>` and the sheet and dialogs display it correctly.

### 1.3 Roll visibility: chat message modes replace roll modes (#8856)

In the V14 source, reading `core.rollMode` logs a deprecation warning (removal in V16). The replacement is the `core.messageMode` setting (`public` / `gm` / `blind` / `self` / `ic`) plus `ChatMessage.applyMode(chatData, mode)`.

- [x] Add `DwUtility.applyMessageMode(chatData)` ([utility.js](src/module/utility.js)). On V14 it uses `messageMode` + `ChatMessage.applyMode`; on V13 it falls back to `ChatMessage.applyRollMode`. The new in-character (`ic`) mode is mapped to `public`, because our roll cards are HTML content without a `rolls` array and would otherwise be styled as IC speech.
- [x] Replace the duplicated 4-line whisper/blind blocks in [rolls.js](src/module/rolls.js) and [actor.js](src/module/actor/actor.js) with the helper.
- [ ] **Test:** each mode (public, GM, blind, self, and IC on V14) with a GM and a player client, for move rolls, ability rolls, damage rolls, and the bond/ask dialog rolls.
- [ ] **Test:** rollable-table and plain `/r` rolls (the `createChatMessage` hook re-renders them and appends damage buttons, [dungeonworld.js:364-394](src/module/dungeonworld.js#L364-L394)).
- [ ] **Decide after testing:** the manual masking in the `renderChatMessageHTML` hook ([dungeonworld.js:396-406](src/module/dungeonworld.js#L396-L406)). V14 core now hides content itself via `ChatMessage#isContentVisible`. If blind cards are already hidden from players on V14, keep the hook only for V13 or remove it.
- Note: the 14.359 notes list a known core bug where `/gmroll` results show `???` to the player. Don't chase that in our code.

### 1.4 Watch list: confirm against the console

- [x] ~~`game.i18n.format()`~~: in V14 it's a silent alias of `localize()` (no warning). No change needed.
- [ ] `@readonly` members are now enforced (#12613). Watch for "Cannot assign to read only property" errors, especially in `prepareData` / `getData`, where we mutate `context` objects.
- [ ] `ready` hook now fires after scene transitions (#13856). Class list loading and migrations run in `ready`, so confirm they still work.
- [ ] The Combat Tracker customization ([combat/combat.js](src/module/combat/combat.js)) uses `renderCombatTracker` and jQuery body listeners. Confirm the move counter, drag/drop and the HP display still render.
- [ ] Compendium packs load (`.db` LevelDB folders in `dist/packs`). Confirm `DwUtility.loadCompendia` and the class list.

## Phase 2: Fix existing bugs found during the audit

These bugs are already broken on V13 too. They're cheap to fix while we're testing.

- [ ] `actor.permission` is misused. On V10+ it's a number (the current user's level), not a `{userId: level}` map.
  - [ ] [dungeonworld.js:497](src/module/dungeonworld.js#L497): `Object.entries(actor.permission)` always gives `[]`, so `isOwner` is always false. Replace with `actor.isOwner` (or `actor.testUserPermission(game.user, "OWNER")`).
  - [ ] [actor.js:430-431](src/module/actor/actor.js#L430-L431): `this.permission.default` is always undefined. Use `this.ownership.default >= CONST.DOCUMENT_OWNERSHIP_LEVELS.OBSERVER` and `this.testUserPermission(game.user, "OBSERVER")`.
- [ ] Dead `token.*` updates in the `createActor` hook ([dungeonworld.js:486-490, 513-516](src/module/dungeonworld.js#L486-L490)). `token` was renamed `prototypeToken` in V10. `ActorDw#_preCreate` ([actor.js:~405](src/module/actor/actor.js#L405)) already sets prototype token data, so move any missing fields (bars, displayBars, disposition) there and delete these lines.
- [ ] Remove the leftover `browserDefaultColor` variable ([dungeonworld.js:140-143](src/module/dungeonworld.js#L140-L143)). It's unused since the nightmode setting was removed.

## Phase 3: Test pass and release

### Smoke test checklist (run on V14, then again on V13 if `minimum` stays 13)

- [ ] World loads with no errors; review the deprecation warnings
- [ ] Create a character: basic moves auto-added, look defaulted, token linked
- [ ] Create an NPC: token defaults correct
- [ ] Character sheet: every tab renders; edit and save look/alignment/race/biography; counters, resources, equip, prepare spells, item create/edit/delete, item drag-drop, tags (Tagify)
- [ ] NPC sheet: biography editor, moves, rolls
- [ ] Each item sheet type (move, npcMove, equipment, spell, bond, tag, class): description/choices/moveResults editors save
- [ ] Class item sheet: equipment drop area and delete
- [ ] Level up: open the dialog, ability score selects disable correctly (the `renderDialog` hook), apply level up
- [ ] Rolls: ability, move (with and without advantage/forward), damage, bond/ask dialogs (`rolls.js` `new Dialog`)
- [ ] Chat: damage/heal buttons apply to selected tokens; scrolling text on HP change
- [ ] Hotbar: drag an owned item, then run the macro
- [ ] Combat: add combatants, move counter increments (as GM and as player via socket), HP bars visibility
- [ ] Each system setting toggles without errors (several reload the page)
- [ ] Each compendium opens; import an item and an actor

### Release

- [ ] Update [CHANGELOG.md](CHANGELOG.md) and add `release-notes/<version>.md`
- [ ] Bump the version via the gulp task; build; tag

## Phase 4 (optional, low effort): Reduce deprecation noise

- [ ] `template.json` deprecated (#13429). Generated from [src/yaml/template.yml](src/yaml/template.yml). Leave it for V14 unless the warnings get noisy. It's fully replaced in Phase 5.

## Phase 5 (future, before V16): Modernization

This phase isn't needed for V14. Track it separately; each item is a sizeable PR.

1. **DataModels.** Replace `template.yml` with `TypeDataModel` classes (`module/data/`) registered in `CONFIG.Actor.dataModels` / `CONFIG.Item.dataModels`. Move derived data out of `ActorDw#prepareData`. Remove `template.json` from the build.
2. **Dialogs → `DialogV2`.** `rolls.js` (ask/bond dialogs), `actor-sheet.js` level-up dialogs (×2). Replace the global `renderDialog` hook with listeners inside the dialog's render callback.
3. **Item sheets → `ItemSheetV2` + `HandlebarsApplicationMixin`** (`item-sheet.js`, `class-item-sheet.js`, ~630 lines). Start here; they're smaller than the actor sheet.
4. **Actor sheets → `ActorSheetV2`** (`actor-sheet.js` ~1,630 lines, `actor-npc-sheet.js`). Convert `activateListeners` to `actions` / `_onRender`, `getData` to `_prepareContext`, and `{{editor}}` to `<prose-mirror>` elements.
5. **Remove jQuery** from `chat.js`, `combat/combat.js`, `dungeonworld.js`.
6. **Combat tracker.** Replace the global `$('body').on(...)` delegation with hooks scoped to the tracker element.

---

## Open questions

- Keep V13 support (`minimum: "13"`) or go V14-only? Plan assumes we keep V13.
- Release as 1.10.0 or 2.0.0?

## Findings

_Record console errors and warnings from the Phase 0 baseline and the Phase 3 smoke tests here._
