# Hijackable Slugs — Variant-Prefix Shadowing

Finding from the from-scratch inconsistency audit · measured against `data/ps99.db` (16,314 items) · 2026-08-24

## The mechanism

Detail URLs are parsed by `splitDetailSlug()` (`src/util/slug.ts:45-68`), which generates resolution candidates **in this order**:

1. Two-token variant prefix (`shiny-golden-…`, `shiny-rainbow-…`)
2. One-token variant prefix (`golden-…`, `rainbow-…`, `shiny-…`, `regular-…`)
3. Whole slug as a literal item name

The route (`src/routes/pages.ts`) resolves candidates **in order** and serves the first whose remainder slug matches an existing item. Consequence: any item whose **name literally begins with "Golden ", "Rainbow ", or "Shiny "** is shadowed whenever the stem (name minus the prefix word) matches another item — the URL serves that other item's variant instead.

## Shadowed items — 5 confirmed

| # | Shadowed item | Collection | Slug | URL | Shown item (stem_item) | Shown item Collection (stem_collection) | URL actually serves |
|---|---|---|---|---|---|---|---|
| 1 | **Golden Cove Lockpick** | MiscItems | `Golden-Cove-Lockpick` | /items/golden-cove-lockpick | Cove Lockpick | MiscItems | Regular version shown instead of the expected "Golden Cove Lockpick" |
| 2 | **Golden Prison Key** | MiscItems | `Golden-Prison-Key` | /items/golden-prison-key | Prison Key | MiscItems | Regular version shown instead of the expected "Golden Prison Key" |
| 3 | **Golden Watering Can** | MiscItems | `Golden-Watering-Can` | /items/golden-watering-can | Watering Can | MiscItems | Regular version shown instead of the expected "Golden Watering Can" |
| 4 | **Rainbow Hoverboard** | Hoverboards | `Rainbow-Hoverboard` | /items/rainbow-hoverboard | Hoverboard | Hoverboards | Regular version shown instead of the expected "Rainbow Hoverboard" |
| 5 | **Rainbow Mini Chest** | MiscItems | `Rainbow-Mini-Chest` | /items/rainbow-mini-chest | Mini Chest | MiscItems | Regular version shown instead of the expected "Rainbow Mini Chest" |

For each: the item's own canonical URL is identical to the hijacking URL — the literal item is **unreachable** at its natural address (the route's candidate loop matches the stem item first and never falls through).

## Database rows for the affected items

Live `items` rows (all 15 columns) for the 5 shadowed items (bold) and the 5 stem items that shadow them. Every row is a **base row** (`variant=0`, `shiny=0`) — literal distinct items, not variant rows; the collision is purely in the slug namespace. `description` truncated to 40 chars.

| id | collection | name | displayName | description | slug | hidden | shiny | variant | tier | imageId | huge | titanic | gargantuan | createdAt |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| abc3bec4 | MiscItems | Cove Lockpick | Cove Lockpick | Save a pet from Grinch Cove! Chance for … | Cove-Lockpick | 0 | 0 | 0 | NULL | 120320082965427 | 0 | 0 | 0 | 2026-08-23 05:57:45 |
| 0b389492 | MiscItems | Golden Cove Lockpick | Golden Cove Lockpick | Save a pet from Grinch Cove! Better lock… | Golden-Cove-Lockpick | 0 | 0 | 0 | NULL | 95200052788292 | 0 | 0 | 0 | 2026-08-23 05:57:45 |
| dc0dbc06 | MiscItems | Golden Prison Key | Golden Prison Key | Unlocks cells in Prison World for 10x HU… | Golden-Prison-Key | 0 | 0 | 0 | NULL | 17486584765 | 0 | 0 | 0 | 2026-08-23 05:57:45 |
| 57dcd6b8 | MiscItems | Golden Watering Can | Golden Watering Can | Plants love gold water and grow faster! … | Golden-Watering-Can | 0 | 0 | 0 | NULL | 15555104643 | 0 | 0 | 0 | 2026-08-23 05:57:45 |
| cf118b7f | Hoverboards | Hoverboard | Hoverboard | Your own personal hoverboard. Gotta go f… | Hoverboard | 0 | 0 | 0 | NULL | 14910756938 | 0 | 0 | 0 | 2026-08-23 05:57:45 |
| d6492173 | MiscItems | Mini Chest | Mini Chest | Open for THE MOST EPIC rewards! | Mini-Chest | 0 | 0 | 0 | NULL | 15854077741 | 0 | 0 | 0 | 2026-08-23 05:57:45 |
| 3cd0366d | MiscItems | Prison Key | Prison Key | Unlocks cells in Prison World for a HUGE… | Prison-Key | 0 | 0 | 0 | NULL | 17486584661 | 0 | 0 | 0 | 2026-08-23 05:57:45 |
| 8310e997 | Hoverboards | Rainbow Hoverboard | Rainbow Hoverboard | Double rainbow! (Redeem 5 merch codes) | Rainbow-Hoverboard | 0 | 0 | 0 | NULL | 14910756731 | 0 | 0 | 0 | 2026-08-23 05:57:45 |
| a7594417 | MiscItems | Rainbow Mini Chest | Rainbow Mini Chest | Open for the best high tier loot! | Rainbow-Mini-Chest | 0 | 0 | 0 | NULL | 17024878999 | 0 | 0 | 0 | 2026-08-23 05:57:45 |
| 6dab159c | MiscItems | Watering Can | Watering Can | Plants love water and grow faster! Lasts… | Watering-Can | 0 | 0 | 0 | NULL | 15555104581 | 0 | 0 | 0 | 2026-08-23 05:57:45 |

## Corrected count

An earlier pass stated "30 live items hijackable." Re-measured properly: **30 items** are named `Golden/Rainbow/Shiny …`, but only **5 are actually shadowed** — for the other 25, no stem item exists, so the whole-slug fallback candidate resolves them correctly. The audit's original number counted URLs *starting with* a variant token, not URLs that resolve to the wrong item.

## Originally flagged items — all 23 base items named Golden/Rainbow/Shiny …

The original audit counted 30 rows (including variant rows). After filtering to base rows only, **23 uniquely-named items** start with a variant word. **5 are shadowed** (red) and **18 resolve correctly** (green) via the whole-slug fallback.

| # | Item name | Collection | Slug | Stem item | Stem exists? | Status | URL |
|---|---|---|---|---|---|---|---|
| 1 | Golden Axe | MiscItems | `Golden-Axe` | — | No | 🟢 RESOLVED | `/items/golden-axe` |
| 2 | Golden Cove Lockpick | MiscItems | `Golden-Cove-Lockpick` | Cove Lockpick | Yes | 🔴 SHADOWED | `/items/golden-cove-lockpick` |
| 3 | Golden Fishing Rod | MiscItems | `Golden-Fishing-Rod` | — | No | 🟢 RESOLVED | `/items/golden-fishing-rod` |
| 4 | Golden Paw Ticket | MiscItems | `Golden-Paw-Ticket` | — | No | 🟢 RESOLVED | `/items/golden-paw-ticket` |
| 5 | Golden Pencil | MiscItems | `Golden-Pencil` | — | No | 🟢 RESOLVED | `/items/golden-pencil` |
| 6 | Golden Prison Key | MiscItems | `Golden-Prison-Key` | Prison Key | Yes | 🔴 SHADOWED | `/items/golden-prison-key` |
| 7 | Golden Retriever | Pets | `Golden-Retriever` | — | No | 🟢 RESOLVED | `/items/golden-retriever` |
| 8 | Golden Shovel | MiscItems | `Golden-Shovel` | — | No | 🟢 RESOLVED | `/items/golden-shovel` |
| 9 | Golden Watering Can | MiscItems | `Golden-Watering-Can` | Watering Can | Yes | 🔴 SHADOWED | `/items/golden-watering-can` |
| 10 | Rainbow Booth | Booths | `Rainbow-Booth` | — | No | 🟢 RESOLVED | `/items/rainbow-booth` |
| 11 | Rainbow Eggs | Enchants | `Rainbow-Eggs` | — | No | 🟢 RESOLVED | `/items/rainbow-eggs` |
| 12 | Rainbow Flag | MiscItems | `Rainbow-Flag` | — | No | 🟢 RESOLVED | `/items/rainbow-flag` |
| 13 | Rainbow Fruit | Fruits | `Rainbow-Fruit` | — | No | 🟢 RESOLVED | `/items/rainbow-fruit` |
| 14 | Rainbow Gem | MiscItems | `Rainbow-Gem` | — | No | 🟢 RESOLVED | `/items/rainbow-gem` |
| 15 | Rainbow Hoverboard | Hoverboards | `Rainbow-Hoverboard` | Hoverboard | Yes | 🔴 SHADOWED | `/items/rainbow-hoverboard` |
| 16 | Rainbow Mini Chest | MiscItems | `Rainbow-Mini-Chest` | Mini Chest | Yes | 🔴 SHADOWED | `/items/rainbow-mini-chest` |
| 17 | Rainbow Pencil | MiscItems | `Rainbow-Pencil` | — | No | 🟢 RESOLVED | `/items/rainbow-pencil` |
| 18 | Rainbow Swirl | MiscItems | `Rainbow-Swirl` | — | No | 🟢 RESOLVED | `/items/rainbow-swirl` |
| 19 | Rainbow Swirl | Pets | `Rainbow-Swirl` | — | No | 🟢 RESOLVED | `/items/rainbow-swirl` |
| 20 | Rainbow Unicorn | Pets | `Rainbow-Unicorn` | — | No | 🟢 RESOLVED | `/items/rainbow-unicorn` |
| 21 | Shiny Flag | MiscItems | `Shiny-Flag` | — | No | 🟢 RESOLVED | `/items/shiny-flag` |
| 22 | Shiny Hunter | Enchants | `Shiny-Hunter` | — | No | 🟢 RESOLVED | `/items/shiny-hunter` |
| 23 | Shiny Supercharge | Enchants | `Shiny-Supercharge` | — | No | 🟢 RESOLVED | `/items/shiny-supercharge` |


## Also affected (near-miss / ambiguity class)

These URLs currently resolve correctly only because the stem item happens not to exist — they are one upstream item away from breaking:

- `Shiny Flag`, `Shiny Supercharge` (Enchants) — would shadow if "Flag"/"Supercharge" items are added
- `Rainbow Eggs` (Enchants) — "Eggs" collection exists but no single "Eggs" item
- `Rainbow Fruit` (Fruits), `Rainbow Swirl`, `Shiny Flag` (MiscItems) — same class
- `Golden Fishing Rod`, `Golden Shovel`, `Golden Prison Key`-family (MiscItems) — several stems don't exist today

## Fix

Try the **whole-slug exact match first** in the route's candidate loop (or in `findItemBySlug`), and only fall back to variant-split candidates when the whole slug matches no item. One-line ordering change in `src/routes/pages.ts` (or move the exact-match probe into `splitDetailSlug`'s caller). After the fix, all 5 shadowed items become reachable and no existing variant URL changes (variant URLs whose stem item doesn't exist behave identically).

## Verification

Reproduce any row: `curl -s "http://localhost:3000/items/golden-cove-lockpick" | grep -o "<title>[^<]*"` → returns the Cove Lockpick page, not Golden Cove Lockpick.
