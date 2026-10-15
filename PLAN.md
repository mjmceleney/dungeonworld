# Foundry VTT V14 Compatibility Plan

Goal: make the Dungeon World system run cleanly on Foundry V14 (current stable 14.369) while keeping V13 support if practical.

**Summary.** V14 does not remove the V1 Application framework. `foundry.appv1.*`, `Dialog` and the jQuery-based sheets are deprecated, with removal scheduled for V16. That makes V14 support a small, targeted change set (Phases 1–3). The full ApplicationV2 / DataModel migration (Phase 5) is the larger job, which must be done before V16 but isn't needed for V14.

Status key: `[ ]` todo · `[x]` done · `[~]` in progress / needs verification

---

## Phase 0: Environment setup

- [x] Foundry V14 (14.369) installed at `C:\Program Files\Foundry Virtual Tabletop v14`.
- [x] `npm ci` + `npm run build` work on Node 25.2.1 (gulp 4 toolchain OK).
- [ ] **V13 and V14 share the default data folder** (`%LOCALAPPDATA%\FoundryVTT`), which holds live worlds (e.g. `aldruant-dw`). Run V14 with its own `--dataPath`, junction `dist/` into it, and copy worlds in. Steps are in [TESTING.md §0](TESTING.md). (`npm run symlinks:create` only links Foundry's source into the repo for IntelliSense; it doesn't deploy the system.)

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

- [x] `actor.permission` misuse. In V13/V14 it returns the current user's level as a number, not a `{userId: level}` map.
  - [x] `ActorDw#_onUpdate` scrolling text: the three-line check is now `this.testUserPermission(game.user, "OBSERVER")` (GMs always pass).
  - [x] `createActor` hook: the owner/GM detection is removed (see below). It was also hiding a latent crash: `u.document.active` would have thrown once the owner check stopped short-circuiting.
- [x] **`createActor` hook rewritten** ([dungeonworld.js](src/module/dungeonworld.js)):
  - Runs only on the creating user's client (`userId === game.user.id`). Before, every connected client ran it: multiple GMs added duplicate moves, and non-owner players hit permission errors on `setFlag`. This resolves the old `@todo` about multiple GMs/owners.
  - Character-only now. The NPC branch only did dead `token.*` updates.
  - World-item basic/special moves are now skipped if the actor already has a move with that name. Previously only compendium moves were deduplicated, so duplicating a character re-added world moves.
  - The default look is only set when `look` is empty. Previously, duplicating a character wiped its look.
  - The `levelup` flag and look are saved in a single `actor.update` instead of `setFlag` + `update`.
- [x] Dead `token.*` updates moved into `ActorDw#_preCreate` ([actor.js](src/module/actor/actor.js)) as `prototypeToken` defaults:
  - bar1 = HP, bar2 = XP (characters) / none (NPCs), `displayBars` = owner hover, disposition friendly / hostile.
  - Each value is only applied if the creation data doesn't set it, so compendium monsters keep their own token config.
  - Characters still force `actorLink`, friendly disposition and vision, as before.
  - `_preCreate` now calls `super._preCreate` (it didn't before).
- [x] Removed the unused `browserDefaultColor` variable.
- [x] Found during testing: `_preCreate` token defaults now also skip anything set in core's **Prototype Token Overrides** world setting (`foundry.data.PrototypeTokenOverrides`). Before, our defaults ran after core applied the GM's overrides and would have overwritten them. This includes the forced character disposition and vision; `actorLink` is still always forced.
- [x] Found during testing: [chat.js](src/module/chat.js) `actor.owner` → `actor.isOwner`. `owner` doesn't exist, so actor owners other than the roller never saw a card's action buttons.
- Correction to an earlier note: the nightmode theme is **not** dead. `DwUtility.nightmode` follows core's dark theme (`body.theme-dark`), so the Phase 1 ProseMirror dark-mode override is live. Check it in dark mode.

**Phase 2 tests** (add to the smoke test):
- [ ] New character as GM: basic moves added once, look defaulted, level-up available, token linked with HP/XP bars.
- [ ] New character as a player with a second GM client connected: moves added once, no console errors on either client.
- [ ] Duplicate a character: look and moves are not reset or duplicated.
- [ ] New NPC: HP bar, hostile. Import a compendium monster: its token settings are unchanged.
- [ ] HP/armor scrolling text appears for owners and observers, not for limited/none.

## Phase 3: Test pass and release

- [x] Automated / static checks (all pass): build, V14 manifest validation, Handlebars compile of all templates, JS syntax, real `_preCreate` vs the V14 `PrototypeToken` schema, bond unwrap cases, and an API/hook existence audit against the V14 source. Details are at the top of [TESTING.md](TESTING.md).
- [ ] Manual test pass in V14, then the V13 regression: **[TESTING.md](TESTING.md)**. Record issues in its Findings table.

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
   - [~] Ported; needs the manual test in [TESTING.md §9b](TESTING.md). Notes:
     - One template part per sheet, chosen by item type in `_configureRenderParts`. Templates render a `<div>` root, since the application element is the form.
     - Tabs use `tabGroups` + the built-in `tab` action, not `static TABS`, so they don't depend on V13-vs-V14 differences.
     - `{{editor}}` → `<prose-mirror toggled>`; image picking → the core `editImage` action.
     - Class sheet: race, alignment and equipment-group add/delete are actions that update the item directly and re-index keys. This replaces the DOM edits and the `_updateObject` re-indexing. The `_class-sheet--equipment-group.html` partial is gone.
     - Equipment drop areas handle `drop` themselves (and stop propagation), so they don't depend on whether the base sheet binds a `DragDrop`.
4. **Actor sheets → `ActorSheetV2`** (`actor-sheet.js` ~1,630 lines, `actor-npc-sheet.js`). Convert `activateListeners` to `actions` / `_onRender`, `getData` to `_prepareContext`, and `{{editor}}` to `<prose-mirror>` elements.
   - [~] **Character sheet:** built as a new, redesigned V2 sheet (`character-sheet.js`, templates in `templates/sheet/character/`, styles in `_character-v2.scss`) instead of a 1:1 port. Needs the manual test in [TESTING.md §9b](TESTING.md). The design is in the mockup: https://claude.ai/artifact/SAbndXnqEMXVVmKNZe8yWz
     - The old sheet stays registered as "Legacy Character Sheet" (not default) as a fallback.
     - Level up and the class viewer moved to `actor/level-up.js` (`DwLevelUp`), used by both sheets. The dialogs themselves are still V1 `Dialog` (item 2 above).
     - The new sheet doesn't carry the `.dungeonworld` class, so no legacy styles apply. It uses its own light (parchment) and dark palettes.
     - New per-character state: `flags.dungeonworld.favorite` on moves and `flags.dungeonworld.sheetDisplay.collapsed.<section>` on the actor.
   - [ ] NPC sheet: still V1 (`DwActorNpcSheet` extends the legacy sheet).
   - [ ] Later: the level-up dialog's multiclass picker and unknown-class support (see the mockup's decision notes), then remove the legacy sheet.
5. **Remove jQuery** from `chat.js`, `combat/combat.js`, `dungeonworld.js`.
6. **Combat tracker.** Replace the global `$('body').on(...)` delegation with hooks scoped to the tracker element.

---

## Open questions

- Keep V13 support (`minimum: "13"`) or go V14-only? Plan assumes we keep V13.
- Release as 1.10.0 or 2.0.0?

## Findings

_Record console errors and warnings from the Phase 0 baseline and the Phase 3 smoke tests here._
