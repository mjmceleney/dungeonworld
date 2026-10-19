# Rules Enhancements Roadmap

Ideas for supporting more of the Dungeon World rules in the system. Tick items as they're done and add notes under each one as decisions are made.

Rules reference: the Dungeon World SRD (CC-BY 3.0), at [github.com/Sagelt/Dungeon-World](https://github.com/Sagelt/Dungeon-World) and [dungeonworldsrd.com](https://www.dungeonworldsrd.com/).

**Legend:** **S** = small · **M** = medium · **L** = large · ★ = suggested first batch

**Status:** the first batch chosen on 2026-10-16 is built, but not yet tested in Foundry (see TESTING.md, section 9i). Ticked items below say what was built and what's left.

**Already supported (not repeated below):** forward, ongoing and hold counters; debilities; XP on a miss; chat damage buttons that read piercing and "ignores armor"; level-up and multiclass pickers; custom trackers (counters, sliders, clocks).

**Guidelines:**
- Automation suggests and the player confirms, unless decided otherwise. Dungeon World is fiction-first.
- Class mechanics are built as generic building blocks that a class item turns on, so custom classes and homebrew keep working. Campaign homebrew stays out of the system.

## Open questions

- [x] Is the GM side (fronts, monster maker, steadings) in scope now, or later?
  In scope: the monster maker, treasure, hirelings and fronts are done. Steadings are still open.
- [ ] Should automation apply effects directly (ammo, HP) or only suggest them?
- [ ] Use Foundry's Active Effects, or keep to the system's own fields?

---

## 1. Moves and roll results

- [ ] ★ **Clickable "choose" lists on chat cards** (M)
  "Choose 1" or "choose 2" results (Hack & Slash, Volley, Defy Danger, Parley, Defend, Make Camp watch results) show their options as checkboxes on the card, limited to the number allowed, so the table sees what was chosen. Discern Realities and Spout Lore list their questions the same way.
- [ ] ★ **Named hold, spent from a list** (M)
  Each move keeps its own hold (Defend, Trap Expert, Druid shapeshifting, Bard's Arcane Art) instead of one shared number. The move's spend options show as buttons; each spend lowers the hold and posts to chat. Could build on the tracker framework.
- [ ] **Conditional forward** (M)
  Forwards carry a short label ("when acting on the answers", "against X"). The roll dialog lists them as checkboxes so the player picks which apply.
- [ ] **Aid or Interfere linked to the target** (M)
  Roll with the number of bonds you have with the target. The result attaches +1 or −2 to that player's next roll, shown in their roll dialog.
- [x] **Stat choice on Defy Danger** (S)
  Pick the stat by how you act ("powering through" = STR, and so on), with the descriptions shown in the prompt.
  *Done:* applies to every move with roll type "Stat". The descriptions come from list items in the move's text that end in "+Str", "+Dex" and so on, so custom moves get them too.
- [x] **Inline roll links in text** (S–M)
  Text like `roll+DEX` or `@Move[Hack & Slash]` in move descriptions and journals becomes a link that rolls for the selected character.
  *Done:* in a move's own text, the link rolls the move (with its results). Chat cards don't enrich their text yet.

## 2. Vitals, death and recovery

- [x] ★ **Prompt Last Breath at 0 HP** (S)
  When a character drops to 0 HP, offer the Last Breath roll (plain 2d6, no modifier) and show its three outcomes.
  *Done:* the character's player is asked (or the GM, if no owner is online), and there's a setting to turn it off. Adds a generic **Just roll** roll type (2d6, nothing added). Migration 4 switches existing Last Breath moves to it.
- [x] **Make Camp and Recover** (M)
  Use one ration and heal half max HP (Make Camp) or the Recover amount. Clear debilities as the rules allow. Remind casters to prepare or commune.
  *Done:* Make Camp is a party card; Recover is a dialog for each player (all HP, and any number of debilities, with the days-per-debility reminder).
- [x] **Equipped armor sets armor** (S–M)
  Add up armor from equipped items (+1 for a shield) instead of typing it in. Each *clumsy* item gives −1 ongoing, and the penalties stack.
  *Done:* the best equipped "N armor", plus every "+N armor", plus an "other armor" bonus field for moves. With no armor equipped, the typed value is kept. Part of the **Apply Gear Rules** setting. The legacy sheet's armor field is overridden while gear provides armor.

## 3. Gear and load

- [x] ★ **Load tiers** (S)
  Within load is fine, up to load+2 gives −1 ongoing, over that triggers the Encumbrance move. Show the current tier and apply the penalty to rolls.
  *Done:* over load+2, each move asks whether to drop weight and roll at −1, or automatically fail. Gear penalties apply to 2d6 move rolls, not to damage or Last Breath.
- [ ] **Structured tags** (M)
  Read weapon and gear tags (*ammo N*, *uses N*, *+1 damage*, *piercing N*, *messy*, *forceful*, ranges *hand/close/reach/near/far*) into real fields. Damage rolls add tag bonuses directly, and the chat damage code no longer searches the text.
- [x] **Uses that count down** (S)
  Volley's "−1 ammo" choice, rations, healing potions and adventuring gear lower their count automatically.
  *Done:* a **Use** button on gear with uses (items can heal when used: the user or someone else, optionally "or remove a debility"); moves can name a resource their card offers to spend (Volley, Blot Out the Sun); stacks refill uses from the next item. Ideas: Burning Brand's uses (it isn't an item yet); spending poison when applying it.
- [ ] **Coin costs** (S)
  Supply, Carouse and Recruit prompt for an amount and take the coin off.

## 4. End of session and advancement

- [ ] ★ **End of Session dialog** (M)
  The GM starts it for the party. Each player answers the three group questions, says whether they fulfilled their alignment, and marks resolved bonds. XP is added, and resolved bonds can be rewritten.
- [ ] **Bonds linked to actors** (S–M)
  Drop a character onto a bond to link it. Bond counts for Aid or Interfere come from these links. The class's bond templates fill in the blanks.
  *Partly done:* **Fill in bond names** replaces the blanks with links to characters (or typed names), after character creation or from the bonds section. Still to do: counting bonds for Aid or Interfere.
- [x] **Character creation wizard** (L)
  Class, then race, name, look, the stat array (16, 15, 13, 12, 9, 8), alignment, gear choices and bonds. Reuses the level-up pickers; class items already have an `equipment` field.
  *Done:* **Create character** (on new characters) asks for name, class and look, then opens the existing level 1 builder, then fills in bond names. Class items have a new **Looks** field, filled in from the SRD for its eight classes; the Barbarian and Immolator have none.

## 5. Class mechanics (generic building blocks)

- [x] **Spell budget** (S–M)
  Prepared spell levels total at most level+1, with cantrips free. Track the "−1 ongoing to cast until you prepare or commune" penalty and a list of ongoing spells.
  *Done:* budget on the Spells tab; Prepare Spells / Commune picker that enforces it; spells cast from their row; a 7-9 applies -1 ongoing to cast or loses the spell from the card. Still to do: ongoing spells, and separate budgets for a character with two casting classes.
- [ ] **Companion actor** (M)
  Ranger's animal companion (Ferocity, Cunning, Instinct, Armor, training) and Druid shapeshift forms with their own moves.
- [ ] **Choose-from-a-list features** (M)
  One "build from options" field type for Fighter's Signature Weapon, Paladin's Quest boons and vows, the Cleric's deity and the Thief's poisons.

## 6. GM side

- [x] **Fronts** (M–L)
  Dangers with grim portents and an impending doom, plus stakes questions. Grim portents use the tracker clocks. Journal page type or actor type (to decide).
  *Done* as a GM-only **Fronts** window (button in the Journal sidebar, or `game.dungeonworld.DwFronts.open()`) listing every front with a line per danger (its portent clock and next grim portent), filterable by campaign or adventure; a front opens in full. A front has stakes questions, a cast that can link to actors, and dangers; each danger has a type from the book's lists (which fills in its impulse), grim portents as a clock and a checklist, and an impending doom. Not yet: the front's custom moves. Stored in one world setting rather than as documents, so fronts can't be linked with @UUID or put in a compendium.
- [x] **Monster maker** (M)
  Walk through the rules' monster questions (group size, size, armor, what it's known for) to work out HP, damage, armor and tags, then fill in the NPC sheet. Show instinct and monster moves more prominently on the NPC sheet.
  *Done:* opened from the NPC sheet; the answers are saved on the NPC so it can be rebuilt. NPCs have an **Instinct** field. For compendium monsters it's read from the description, and their listed moves can be added as move items.
- [x] **GM moves on a miss** (S)
  A button on a 6- result opens a GM move picker, linked to the GM moves compendium.
  *Done:* a GM-only button on 6- cards opens the GM and dungeon moves as a reference (nothing is posted, since the GM never names their move).
- [ ] **Spotlight tracker** (S–M)
  A combat tracker variant that shows who hasn't acted recently, since Dungeon World has no initiative.
- [ ] **Steadings** (M)
  A sheet with Prosperity, Population, Defenses and tags, plus the steading generator.
- [x] **Hirelings** (M)
  An actor type with Loyalty, skills (Protector, Tracker, Burglar and so on) and cost, linked to the Recruit move.
  *Done:* Order Hirelings roll (loyalty, forward, −1 while the cost is unpaid); skills post their moves with the rank filled in; the points budget by where they were found; GM-only **Create a hireling** on Recruit cards. Ideas: list a character's hirelings on their sheet; use a tracker's Guide on journeys automatically.
- [x] **Treasure roll** (S)
  Roll a hoard using the monster's damage die and modifiers, built on the existing charts.
  *Done:* from the NPC sheet, using the Treasure table (world first, then the system's). The modifiers are ticked from the monster's tags.

## 7. Party moves

- [x] **Undertake a Perilous Journey** (M)
  A dialog that assigns trailblazer, scout and quartermaster, rolls each role, and handles rations and days of travel.
  *Done as a shared chat card*, with Make Camp built the same way. Rolling either move posts the card (or joins the open one). Players join with their characters or hirelings; each owner rolls, eats and heals from it, and the GM relays other players' changes. Days of travel are left to the GM; the card tracks distance in rations.
- [ ] **Other party moves** (S–M each)
  Candidates for the same card: End of Session (see section 4), Aid or Interfere, Defend a group.
