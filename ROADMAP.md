# Rules Enhancements Roadmap

Ideas for supporting more of the Dungeon World rules in the system. Tick items as they're done and add notes under each one as decisions are made.

Rules reference: the Dungeon World SRD (CC-BY 3.0), at [github.com/Sagelt/Dungeon-World](https://github.com/Sagelt/Dungeon-World) and [dungeonworldsrd.com](https://www.dungeonworldsrd.com/).

**Legend:** **S** = small · **M** = medium · **L** = large · ★ = suggested first batch

**Already supported (not repeated below):** forward, ongoing and hold counters; debilities; XP on a miss; chat damage buttons that read piercing and "ignores armor"; level-up and multiclass pickers; custom trackers (counters, sliders, clocks).

**Guidelines:**
- Automation suggests and the player confirms, unless decided otherwise. Dungeon World is fiction-first.
- Class mechanics are built as generic building blocks that a class item turns on, so custom classes and homebrew keep working. Campaign homebrew stays out of the system.

## Open questions

- [ ] Is the GM side (fronts, monster maker, steadings) in scope now, or later?
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
- [ ] **Stat choice on Defy Danger** (S)
  Pick the stat by how you act ("powering through" = STR, and so on), with the descriptions shown in the prompt.
- [ ] **Inline roll links in text** (S–M)
  Text like `roll+DEX` or `@Move[Hack & Slash]` in move descriptions and journals becomes a link that rolls for the selected character.

## 2. Vitals, death and recovery

- [ ] ★ **Prompt Last Breath at 0 HP** (S)
  When a character drops to 0 HP, offer the Last Breath roll (plain 2d6, no modifier) and show its three outcomes.
- [ ] **Make Camp and Recover** (M)
  Use one ration and heal half max HP (Make Camp) or the Recover amount. Clear debilities as the rules allow. Remind casters to prepare or commune.
- [ ] **Equipped armor sets armor** (S–M)
  Add up armor from equipped items (+1 for a shield) instead of typing it in. Each *clumsy* item gives −1 ongoing, and the penalties stack.

## 3. Gear and load

- [ ] ★ **Load tiers** (S)
  Within load is fine, up to load+2 gives −1 ongoing, over that triggers the Encumbrance move. Show the current tier and apply the penalty to rolls.
- [ ] **Structured tags** (M)
  Read weapon and gear tags (*ammo N*, *uses N*, *+1 damage*, *piercing N*, *messy*, *forceful*, ranges *hand/close/reach/near/far*) into real fields. Damage rolls add tag bonuses directly, and the chat damage code no longer searches the text.
- [ ] **Uses that count down** (S)
  Volley's "−1 ammo" choice, rations, healing potions and adventuring gear lower their count automatically.
- [ ] **Coin costs** (S)
  Supply, Carouse and Recruit prompt for an amount and take the coin off.

## 4. End of session and advancement

- [ ] ★ **End of Session dialog** (M)
  The GM starts it for the party. Each player answers the three group questions, says whether they fulfilled their alignment, and marks resolved bonds. XP is added, and resolved bonds can be rewritten.
- [ ] **Bonds linked to actors** (S–M)
  Drop a character onto a bond to link it. Bond counts for Aid or Interfere come from these links. The class's bond templates fill in the blanks.
- [ ] **Character creation wizard** (L)
  Class, then race, name, look, the stat array (16, 15, 13, 12, 9, 8), alignment, gear choices and bonds. Reuses the level-up pickers; class items already have an `equipment` field.

## 5. Class mechanics (generic building blocks)

- [ ] **Spell budget** (S–M)
  Prepared spell levels total at most level+1, with cantrips free. Track the "−1 ongoing to cast until you prepare or commune" penalty and a list of ongoing spells.
- [ ] **Companion actor** (M)
  Ranger's animal companion (Ferocity, Cunning, Instinct, Armor, training) and Druid shapeshift forms with their own moves.
- [ ] **Choose-from-a-list features** (M)
  One "build from options" field type for Fighter's Signature Weapon, Paladin's Quest boons and vows, the Cleric's deity and the Thief's poisons.

## 6. GM side

- [ ] **Fronts** (M–L)
  Dangers with grim portents and an impending doom, plus stakes questions. Grim portents use the tracker clocks. Journal page type or actor type (to decide).
- [ ] **Monster maker** (M)
  Walk through the rules' monster questions (group size, size, armor, what it's known for) to work out HP, damage, armor and tags, then fill in the NPC sheet. Show instinct and monster moves more prominently on the NPC sheet.
- [ ] **GM moves on a miss** (S)
  A button on a 6- result opens a GM move picker, linked to the GM moves compendium.
- [ ] **Spotlight tracker** (S–M)
  A combat tracker variant that shows who hasn't acted recently, since Dungeon World has no initiative.
- [ ] **Steadings** (M)
  A sheet with Prosperity, Population, Defenses and tags, plus the steading generator.
- [ ] **Hirelings** (M)
  An actor type with Loyalty, skills (Protector, Tracker, Burglar and so on) and cost, linked to the Recruit move.
- [ ] **Treasure roll** (S)
  Roll a hoard using the monster's damage die and modifiers, built on the existing charts.

## 7. Party moves

- [ ] **Undertake a Perilous Journey** (M)
  A dialog that assigns trailblazer, scout and quartermaster, rolls each role, and handles rations and days of travel.
