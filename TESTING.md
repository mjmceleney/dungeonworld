# V14 Compatibility Testing Checklist

Manual test pass for the changes in [PLAN.md](PLAN.md) (Phases 1–2). Tick items as you go and record anything odd in **Findings** at the bottom.

Legend: **[V14]** test on V14 · **[V13]** also re-test on V13 · **(P1.2)** etc. = the plan section that changed it.

---

## Already verified automatically

These checks ran from the command line against the V14 install (`14.369`). They don't need repeating:

- `npm ci` + `npm run build` succeed on Node 25 (gulp 4 toolchain still works).
- The built `dist/system.json` passes V14's strict `BaseSystem` package validation (35 packs, 7 languages, `type: system`, compatibility 13–14).
- All 19 templates compile with V14's Handlebars.
- All JS modules parse.
- No TinyMCE (`.tox`) rules remain in the built CSS.
- The real `ActorDw#_preCreate` code was run against V14's `PrototypeToken` schema. Six scenarios pass: new character, new NPC, compendium import keeps its values, characters forced linked/friendly, GM Prototype Token Overrides respected, unset overrides ignored.
- The bond-name `<p>` unwrapping was tested on 7 inputs (single paragraph, links, multi-paragraph, empty, plain text, whitespace, inline formatting).
- Every Foundry API and hook the system uses exists in V14:
  - `foundry.appv1.*` sheets, the global `Dialog` (deprecated, but kept until V16), `Actors/Items.registerSheet`, `renderTemplate`/`loadTemplates`, `TextEditor.enrichHTML`, `Roll#evaluate`/`evaluateSync`, `ChatMessage.getSpeaker`/`getWhisperRecipients`/`applyMode`, `fromDropData`, `assignHotbarMacro`, `createScrollingText`, `game.actors.tokens`, `CONFIG.sounds.dice`
  - hooks: `renderChatMessageHTML`, `renderChatLog`, `renderChatPopout`, `renderCombatTracker`, `hotbarDrop`
- **Still needs a real browser:** rendering, clicks, editors, sockets, multi-user behaviour. That's what this checklist covers.

---

## 0. Setup

> ⚠️ **V13 and V14 share the same data folder by default** (`%LOCALAPPDATA%\FoundryVTT`). That folder holds your real worlds (including `aldruant-dw`, last played on V13) and the released 1.9.0 copy of this system. **Opening a world in V14 upgrades it one-way.** Use a separate data folder for V14 testing and only copy worlds into it.

- [x] Build the system: `npm run build` (repeat after any source change; `dist/` is what Foundry loads).
- [x] Start V14 with its own data folder. One option is to run the V14 server directly with Node (V14 needs Node 24+; you have 25):
  ```powershell
  node "C:\Program Files\Foundry Virtual Tabletop v14\resources\app\main.mjs" --dataPath="C:\FoundryData\v14" --port=30001
  ```
  Then open `http://localhost:30001`. The first launch creates the folder and asks for your license key.
- [x] Stop the server. Link the dev build into the V14 data folder (a junction doesn't need admin):
  ```powershell
  New-Item -ItemType Junction -Path "C:\FoundryData\v14\Data\systems\dungeonworld" -Target "C:\Users\mcele\Documents\StableDiffusion\dungeonworld\dist"
  ```
- [x] Copy a test world (never move it):
  ```powershell
  Copy-Item -Recurse "$env:LOCALAPPDATA\FoundryVTT\Data\worlds\aldruant-dw" "C:\FoundryData\v14\Data\worlds\aldruant-dw"
  ```
  Also create a fresh empty Dungeon World world for clean-slate tests.
- [x] Create at least one **player** user in each world. For multi-user tests, use a second browser or a private window logged in as the player. For the two-GM test, add a second GM (or Assistant GM) user.
- [x] Open the browser console (F12) for every session. Set the filter to show warnings.

## 1. Startup and setup screen [V14]

- [x] Setup screen: Dungeon World shows **no** compatibility warning (verified 14.369).
- [x] The copied world launches; any core world migration completes without errors.
- [x] Console on load: no red errors from `systems/dungeonworld/…`.
- [x] Record every **deprecation warning** that mentions dungeonworld files in Findings. Expected and fine for now: "V1 Application framework is deprecated" (removal in V16) and the `template.json` deprecation. Anything mentioning `rollMode` is **not** expected (P1.3).
- [x] Fresh world: system migration runs; class list loads (the class picker in the level-up dialog is populated).

## 2. Rich-text editors (P1.2) [V14] [V13]

For each editor: open it with the edit button, type text with some **bold**, a list and a link to another document (drag one in). Save, close and reopen the sheet; the text should persist and render, and the link should be clickable.

- [x] Character sheet: **Look**, **Alignment** description, **Race** description, **Biography** (bio tab)
- [x] NPC sheet: **Biography**
- [x] Move item: **Description**, each **move result** editor (10-, 7-9, 6- / whichever exist), **Choices**. Confirm each result saves to its own field and not into another.
- [x] NPC move item: description
- [x] Equipment, Spell, Tag items: description
- [x] Class item: description (now shows enriched content; links should render as links when not editing)
- [x] Editor sizing looks right: small editors (look/alignment/race) aren't collapsed or overflowing; the menu bar fits.
- [x] **Dark theme** (core settings → theme dark): editor menu buttons are readable (transparent background, white icons). The night-mode styles follow core's dark theme.

## 3. Bonds (P1.2) [V14] [V13]

- [x] Add a new bond on a character, edit its text in the bond item sheet, save.
- [ ] The bond list on the character sheet shows the text with **no stray `<p>`** and no extra spacing.
- [ ] Edit an **existing** bond from the copied world; same result.
- [ ] A bond containing a link to an actor (`@UUID[...]`) renders as a clickable link on the character sheet.
- [ ] (Optional) Check the item name in the actor's item data (e.g. from the console: `game.actors.getName("X").items.filter(i => i.type === "bond").map(i => i.name)`): no `<p>` tags.

## 4. Roll visibility (P1.3) [V14] [V13]

Log in as **GM** and as a **player** at the same time. For each mode, the player makes a roll from their character sheet; check what both clients see.

On V14 the mode selector is the chat-message visibility mode next to the chat box (public / GM / blind / self / in-character).

| Roll type (player makes it) | Public | GM only | Blind | Self | In-character (V14) |
|---|---|---|---|---|---|
| Ability roll (e.g. +STR) | [ ] | [ ] | [ ] | [ ] | [ ] |
| Move roll (e.g. Hack and Slash) | [ ] | [ ] | [ ] | [ ] | [ ] |
| Damage roll | [ ] | [ ] | [ ] | [ ] | [ ] |
| Bond roll / "ask" dialog roll | [ ] | [ ] | [ ] | [ ] | [ ] |

Expected results:
- **Public:** both see the full card.
- **GM:** GM sees the full card; the player sees it as a whisper to GM.
- **Blind:** GM sees the full card; the player does **not** see the result (formula `???`, total `?`, no tooltip).
- **Self:** only the player sees it.
- **In-character:** behaves exactly like **Public**. The card is **not** styled as IC speech.

Also:
- [ ] Plain `/r 2d6` and `/gmr 2d6` from the chat box: the card re-renders with damage buttons for the GM; visibility is correct. (Known V14 core bug: `/gmroll` may show `???` to the player. Ignore that one.)
- [ ] Rollable table draw: no damage buttons are appended.
- [ ] With **Dice So Nice** installed (if you use it): dice animate and the card posts afterwards, with the same visibility.
- [ ] Console: **no** `core.rollMode is deprecated` warning when rolling (V14).
- [ ] Note in Findings whether V14 already hides blind content without our `renderChatMessageHTML` masking (this decides whether that hook can be removed later).

## 5. Character creation (P2) [V14] [V13]

- [ ] **GM creates a character** (empty world): basic and special moves are added **once**, sorted alphabetically; Look is pre-filled with the Eyes/Hair/Body/Skin/Clothes list; the level-up button is available.
- [ ] Prototype token (Configure Token on the actor): **linked**, **friendly**, vision on, bar 1 = HP, bar 2 = XP, bars display on owner hover.
- [ ] **Player creates a character** while a GM is logged in: moves added once, **no errors on either client's console**.
- [ ] **Two GMs logged in**, one creates a character: moves added once (previously each GM client added a set).
- [ ] **Duplicate** an existing character that has a custom Look and its moves: the copy keeps its Look and has **no duplicate moves**.
- [ ] World items: create a world `move` item with move type *basic*, named the same as a compendium basic move; create a character. Only one copy is added (the world one).
- [ ] Setting "No compendium auto data" on: only world basic moves are added; no errors.

## 6. NPCs, compendium imports and token overrides (P2) [V14] [V13]

- [ ] **Create an NPC:** token is not linked, **hostile**, bar 1 = HP, no bar 2, bars on owner hover.
- [ ] **Import a monster** from a Monsters compendium: its token settings match the compendium (not overwritten); stats, moves and description intact.
- [ ] Drag a compendium monster to the canvas: token appears correctly.
- [ ] **GM Prototype Token Overrides** (Core settings → Prototype Token Overrides, if present): set e.g. Display Bars = Always and Disposition = Neutral for Characters. Create a character: the override wins over the system defaults, but the token is still linked.

## 7. Scrolling text / permissions (P2) [V14]

Change a character's HP and armor-reduced damage from the sheet while on a scene with its token.

- [ ] GM sees the scrolling HP text over the token.
- [ ] The owning player sees it.
- [ ] A player with **Observer** permission on that actor sees it.
- [ ] A player with **Limited** or **None** permission does **not** see it.

## 8. Chat card buttons [V14] [V13]

- [ ] GM: damage/heal buttons on roll cards apply to the selected token(s); HP updates.
- [ ] The "enable damage buttons" setting off: buttons hidden.
- [ ] Player who **owns the actor but didn't make the roll** (e.g. GM rolled for their character): action buttons on that card are visible. This was broken before (`actor.owner` → `actor.isOwner` fix).
- [ ] Player who doesn't own the actor: action buttons are hidden.
- [ ] Buttons work in a **popped-out chat** window as well.

## 9. General regression [V14] (then a quick pass on [V13])

**Character sheet**
- [ ] Every tab renders; stats, HP, armor, load and XP fields save.
- [ ] Counters (left-click +, right-click −), resource controls, equip toggles, prepare spells.
- [ ] Item create / edit / delete; drag items from sidebar and compendium onto the sheet; sort by drag.
- [ ] Tags (Tagify) on equipment: add/remove tags; display on the sheet.
- [ ] Clicking an item label expands its description.
- [ ] Roll mode flag (advantage / disadvantage radio on the sheet) works, and resets after use when the "advantage forward" setting is on.

**Level up**
- [ ] Level-up dialog opens (new character and normal level-up).
- [ ] Ability score selects disable already-used values (also with the "no ability scores" setting on).
- [ ] Applying the level-up updates moves, stats and HP; the sheet re-renders.
- [ ] Class viewer opens.

**Items and hotbar**
- [ ] Class item sheet: equipment groups, drag-drop equipment into a group, delete equipment.
- [ ] Drag an owned move to the hotbar → macro created → clicking it rolls the move.
- [ ] Dragging an unowned (sidebar) item to the hotbar shows the "only owned items" warning.

**Combat tracker**
- [ ] Add combatants (PCs and NPCs); the tracker renders with the Dungeon World layout.
- [ ] A player making a move increments their move counter (needs a GM logged in; socket path).
- [ ] The GM making a move for a PC increments it directly.
- [ ] Manual edits to the counters save. Drag/drop in the tracker works.
- [ ] HP display respects token bar visibility (player can't see hostile NPC HP when bars are owner-only).

**Settings and compendia**
- [ ] Toggle each Dungeon World system setting (several reload the page): no errors after reload.
- [ ] Custom labels (alignment / race / bond / debility names) show on the sheet.
- [ ] Open every compendium; open a few entries of each type (items, monsters, journals, rollable tables); roll on a table.

## 9b. Redesigned character sheet (ApplicationV2, Phase 5.4) [V14] [V13]

Characters now open with the new **Dungeon World Character Sheet**. The previous sheet is still available as **Legacy Character Sheet** from the sheet's ⋮ menu → Configure Sheet. Test with a few characters, including one with moves from two classes.

**Layout and theme**
- [ ] Header, vitals, abilities, tabs and sidebar lay out as in the mockup; the window resizes and the tab content and sidebar scroll on their own.
- [ ] Light theme is parchment; dark theme (core color scheme, or the sheet's own theme in Configure Sheet) is dark, with readable text everywhere.

**Header and vitals**
- [ ] Name, class (suggestions list), level, XP, HP, max HP, armor, damage die + misc, max load and coin save on change.
- [ ] The −/+ buttons change XP, HP, coin, forward, ongoing, hold and the custom resource.
- [ ] Portrait click opens the file picker. Class book button opens the class viewer.
- [ ] Level up: greyed with a reason ("Needs N more XP", "Class not recognized", "Maximum level", "Unlinked token") until available, then highlighted. Clicking it opens the level-up dialog; applying it updates the sheet.
- [ ] A character with moves from another class shows a "+ Class" tag in the header.
- [ ] HP, armor and damage sit in the header (option C layout). Load and coin are in a summary bar at the top of the Equipment tab; load shows "N to spare", or "Encumbered" in red when over.

**Abilities and roll modifiers**
- [ ] Clicking an ability card rolls it. Editing the score updates the modifier.
- [ ] The debility toggle (Weak, Shaky…) highlights and lowers the modifier (unless the debilities-impose-disadvantage setting is on). Custom debility labels show.
- [ ] Roll mode Normal / Advantage / Disadvantage saves and affects the next roll.
- [ ] With the "no ability scores" setting on, the cards still work.

**Moves tab**
- [ ] Sections: Favorites, Basic, one per class (your class first, then any others labelled *Multiclass*), Special, Other. Special and Other start collapsed.
- [ ] Starting moves come before advanced moves in each class section; advanced moves show an "L2+"/"L6+" badge.
- [ ] Collapse and expand sections; the state persists after closing and reopening the sheet, and for other users viewing the same character.
- [ ] Star a move: it appears in Favorites; unstar removes it.
- [ ] Click a move's name: description, 10+/7–9/6- results and choices expand. The die button rolls; book-icon moves post their card.
- [ ] Search filters moves by name across all sections, opens collapsed sections with matches, hides empty ones, and shows "No moves match" when nothing does. The search survives a re-render (e.g. star a move while searching).
- [ ] The + on a section creates a move of that type; edit and delete appear on hover.

**Equipment, spells, character tabs and sidebar**
- [ ] Equipment: roll, equip toggle, uses/quantity counters (left-click +, right-click −), weight, tags in the details.
- [ ] Spells: grouped by level; add per level; prepared toggle; roll.
- [ ] Character tab: look and biography editors save.
- [ ] Sidebar order is Trackers, Race, Alignment, Bonds. Race and alignment names and descriptions save; add, edit and delete bonds.
- [ ] Trackers (top of the sidebar): Hold is always the first row (can't be renamed or deleted). The small + in the card header opens a dialog for the name and an optional maximum; Save adds it, Cancel or closing adds nothing, and a blank name becomes "New tracker". On the sheet each tracker shows its name, −/+ and value, and "/ max" as plain text when it has one. −/+ stay within 0 and the max; typing a value directly also works. The edit icon reopens the dialog: rename, change or clear the max (a value above a lowered max is reduced to it), or Delete. They persist after reopening.
- [ ] Migration: as GM, load a world where a character used the old custom resource (non-zero value or max, or a renamed label). It appears as a tracker. Characters that never used it get no tracker.
- [ ] The roll formula override is on the Character tab and still replaces 2d6 when set.

**Drag and drop, permissions**
- [ ] Drag items from the sidebar and compendiums onto the sheet; reorder by dragging rows; drag a move to the hotbar and the macro rolls it.
- [ ] As an observer (not owner): everything is read-only, but tabs, section toggles, move details and search still work.
- [ ] Switch a character to the Legacy sheet and back: both work, and the level-up dialog works from both.
- [ ] Console: no errors from `systems/dungeonworld/…`.

## 9c. Redesigned NPC sheet (ApplicationV2) [V14] [V13]

NPCs now open with the **Dungeon World NPC Sheet**; the previous one is available as **Legacy NPC Sheet** from Configure Sheet. Test a few compendium monsters and a new NPC.

- [ ] Header: portrait (click to change) with the art as a faded banner; name shrinks to fit; tags (Tagify: add, remove, suggestions from tag items) and special qualities save.
- [ ] Stats band: HP −/+ and max, armor, damage formula and piercing note save. The damage button rolls the formula, and the piercing note shows as a tag on the chat card.
- [ ] Moves tab: Basic and Special sections (both open by default, collapsible); an Other section only when an NPC move has no type. Each move shows its roll formula; the roll button rolls it; book-icon moves post their card. No favorite stars on NPC moves. + adds an NPC move of that type; edit/delete on hover; search works.
- [ ] Description tab: the editor saves.
- [ ] Drag NPC moves from the sidebar or a compendium onto the sheet; reorder by dragging.
- [ ] Light and dark themes; read-only view for players without ownership.
- [ ] Switch an NPC to the Legacy sheet and back.

## 9d. Item sheets in the new style [V14] [V13]

Item sheets (move, NPC move, spell, equipment, bond, tag, class) now share the character sheet's style: a header with image, name and a type line (e.g. "Move · Advanced · The Fighter"), tabs, and label/field rows.

- [ ] Each type opens with its fields; everything saves on change; light and dark themes are readable.
- [ ] Move: description, 10+/7–9/6- and choices editors; roll type (Formula reveals the formula field), modifier, class, move type, requires level/move, move group.
- [ ] Spell: class, level, prepared, roll formula. Equipment: item type, tags (Tagify), equipped, magic, quantity, uses, weight, price, damage override for weapons.
- [ ] Bond: the bond text editor saves without a wrapping `<p>`. Tag: name and description.
- [ ] Class: races and alignments (add/delete/edit), settings, equipment groups (add/delete, label, mode, drag equipment in, remove with ×).
- [ ] The stylesheet is now `styles/dist/sheets.css` (was `character-sheet.css`); after updating, fully restart Foundry so it picks up the manifest change.

## 9e. Journals in the system's fonts and colors [V14] [V13]

Journal windows stay Foundry's; the system only adds a class to them, which gives the title and page text Metamorphous headings, Alegreya body text, the parchment (or dark) palette, chip-style inline rolls, and banded tables. Setting **Journal Style** (world): Dungeon World journals (default), All journals, or None.

- [ ] Default: a journal from GM Screen, Charts or GM Moves/Principals (in the compendium, and once imported into the world) has the new look; a journal you created yourself doesn't.
- [ ] Light and dark themes are both readable, including inline rolls (`[[/r d6]]`) and the GM Screen tables.
- [ ] Editing a styled text page: the editor text uses the same fonts.
- [ ] Switching the setting restyles open journals right away (All / None / back to default).
- [ ] The journal sidebar, page controls and window frame look exactly as before.

## 9f. Level up and class viewer in the new style [V14] [V13]

Both are now ApplicationV2 windows in the sheets' style (one template, `dialog/level-up.html`). Every choice is a card that's outlined when picked; included starting moves and rotes show "Included". What gets saved is unchanged.

- [ ] New character (0 XP): header says "New character" and shows the class description. Race, alignment, ability scores (each score usable once; with "no ability scores" the +1s and 0s can each be used twice), equipment groups (radio or checkbox per group, Details expands), starting moves (choose-one groups are radios; the rest are included), spells. Confirm applies everything, as before: bonds, HP, load, damage die.
- [ ] Level up (XP ≥ needed): header says "Level N", no class description. Raise one ability (18+ is disabled), advanced moves under "Levels 2–10" (and "Levels 6–10" at level 6+), spells. Confirm raises the level and subtracts XP.
- [ ] Ability scores left at "—" keep their current value (previously they could be saved as blank).
- [ ] Max HP on a level up: if it's exactly class HP + CON beforehand, it's recalculated (raising CON raises max and current HP). If it's anything else (e.g. lowered by hand for a homebrew move), it's left alone, with a notice only if CON was raised. A new character always gets class HP + CON.
- [ ] Cancel and the window's close button change nothing. Opening level up again while it's open replaces the window.
- [ ] Class viewer (from the class name): the class's races, alignments, equipment, moves and spells without inputs or a footer. World moves from other classes no longer appear in it.
- [ ] Light and dark themes are both readable. The legacy sheet's level up button opens the same new window.

## 9g. Multiclassing and moves from other classes [V14] [V13]

- [ ] Setting **Allow Multiclassing** (world, off by default). Off: no Advanced move / Multiclass switch at level up; a single-class character just sees their class's moves (no class picker); characters who already multiclassed can still pick between their classes. Multiclass Dabbler, Divine Favor and similar moves work either way. An unrecognized class with it off only raises an ability. Turn it on for the checks below.

A level up (not a new character) has a **This level** card: **Advanced move** (from your class, or one you've multiclassed into) or **Multiclass** (any other class), plus a **From** class picker. Changing either swaps only the moves below it; the ability increase and spells keep their choices. Multiclassed classes are stored in `flags.dungeonworld.multiclasses`.

- [ ] Advanced move, your own class: same moves as before. Spells for every casting class you have are listed (named per class when there's more than one).
- [ ] Multiclass into the Wizard (e.g. from the Bard): the Wizard's starting moves (included), rotes, and 1st level spells to choose. Confirm adds them, raises the level and records the class; no HP, load, damage or bond changes.
- [ ] Next level up: the Wizard is in the Advanced move list and offers its 2–10 moves; the Multiclass list no longer has it.
- [ ] Moves that grant another class's move open a picker after the level up window closes (Skip adds nothing):
  - Multiclass Dabbler/Initiate/Master: any class but your own, moves up to your level − 1, never other multiclass moves.
  - Barbarian's Appetite for Destruction / Kill 'Em All: only the Fighter, Bard and Thief.
  - Druid's Hunter's Brother / Stalker's Sister: only the Ranger. Ranger's Special Trick: any other class.
  - Wizard's Expanded Spellbook: a spell from another casting class (the Cleric), up to your level.
- [ ] Move sheet, Details: **Grants** (nothing / a move / a spell), **From classes**, **Level offset**. A homebrew move with Grants set opens the picker too.
- [ ] Paladin's Divine Favor (and Ranger's God Amidst the Wastes): taking it adds the Cleric's Commune and Cast a Spell, then opens "Choose Cleric spells" as a level 1 cleric (rotes included, 1st level spells to pick). At each later level up, the spells section has "Cleric spells (Divine Favor, as level N)", one level higher each time. Move sheet fields: **Also gain** and **Cast its spells**, using the first class in From classes.
- [ ] Class levels: each level up raises the class chosen in "This level" (a new class starts at 1); the overall level still rises and drives XP. The card shows e.g. "Wizard level 1 → 2", and that class's moves **and spells** are offered up to its class level. Only the advancing class offers new spells (Divine Favor-style spells still grow every level). Existing characters: each multiclass counts as 1, the main class has the rest.
- [ ] Sheet with two or more classes: header shows "Bard 3", "Wizard 1" pills; the Character tab has editable **Class levels**, with a warning if they don't add up to the character's level. Multiclass Dabbler on a Bard 3 / Wizard 1 picks moves up to level 2 (Bard level − 1).
- [ ] Character tab, × next to a multiclass: asks first, removes it from the classes and class levels, and (ticked by default) its moves and spells. The level is unchanged, so the mismatch warning shows until it's lowered.
- [ ] Character tab (GM only), **Start over…**: back to level 1 with 0 XP, multiclasses and class levels cleared. Removes class moves and spells by default (basic and special moves stay); equipment, bonds and race/alignment only when ticked. The level 1 builder is then available.
- [ ] Class sheet, Class Settings: **Secret class**. A secret class isn't in the Multiclass list or in "any other class" pickers (Dabbler, Special Trick), but is offered when a move's From classes names it. Players don't see it in the sheet's class suggestions (the GM does). A character of that class levels up in it as normal.
- [ ] A character whose class isn't recognized can level up once they have the XP: ability increase and Multiclass only (Advanced move is greyed out). The sheet's level up button allows it; a new character with an unknown class still can't use the builder.

## 10. V13 regression (short)

Keep `minimum: "13"` only if this passes. Use a separate V13 data folder or a copied world as well, and don't overwrite the 1.9.0 system in your real data folder.

- [ ] Sections 2, 3, 4 (public/GM/blind/self), 5, 6, 8 on V13.
- [ ] Console: no errors from `systems/dungeonworld/…`. In particular, `ChatMessage.applyRollMode` works (it's the V13 fallback in `DwUtility.applyMessageMode`).

---

## Findings

| # | Version | Area / section | What happened (+ console message) | Severity |
|---|---|---|---|---|
| 1 | | | | |
