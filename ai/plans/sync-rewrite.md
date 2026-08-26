# Sync Service Rewrite Plan

Status: **Implemented** (2026-08-25) — including namespace-collision work, item curation/visibility, and ps99rap-informed matching added during implementation
Created: 2026-08-24 · Implemented: 2026-08-24/25
Scope: wholesale rewrite of the sync service (`src/services/sync.ts` → `src/services/sync/`) plus feed-matching namespace-collision resolution and item curation/visibility
Inputs: `ai/reports/inconsistency-audit/02-sync-ingest.md`, `ai/plans/database-redesign.md` (Rev 2, "Sync scoping"), sync-related findings in the performance report, `ai/reports/spec-driven-items-rap-exists.html`

## Where things stand (2026-08-25)

The site is live and healthy: server on :3000, hourly cron syncing without
errors, 110 tests green. All audit-flagged sync defects are fixed; every
remaining gap is an upstream quirk documented under "Known remaining
limitations" — nothing is silently corrupting or dropping data anymore.
Picking this back up later requires no archaeology: the sections below are the
current state, not aspirations. Migration chain is linear (0000–0005;
0006/0007 were generated for a reverted approach, deleted, and scrubbed from
the drizzle journal before deployment).

Quick reference for future sessions:

- Curation = flags, not code: `category.hidden` rows control listing
  visibility per internal category; `collections.hidden` exists as a reserved
  column. Flipping a flag curates; no schema work needed.
- Sync flushes the derived Redis cache on every completed run — stale-listing
  incidents after resets/syncs should not recur.
- The ~700 unmatched feed entries per cycle are upstream gaps (feed-only ids),
  counted in `warnings`; the full inventory lives under "Known remaining
  limitations" and in the upstream-quirks list below.

### Upstream API quirks (all verified against live endpoints, 2026-08-25)

These are BIG Games API behaviors — not bugs in our pipeline. The matcher,
grammar, and curation rules exist to work around exactly these:

**Identity & naming**

1. **Feed ids ≠ display names.** Feeds use configName-stripped ids, not the
   resolved catalog name: `XPPotion | Titanic` → feed `Titanic`;
   `Flag Bundle` → item named `Bundle O' Flags`. Handled by the configName
   alias index.
2. **Punctuation drift between feeds and catalogs.** Catalogs say
   `Crystal Key: Upper Half`, `Insta-Plant Capsule`, `Hype Egg #2`,
   `Locked Hype Egg #3!`; feeds say `Crystal Key Upper Half`,
   `Insta Plant Capsule`, `Hype Egg 2`, `Locked Hype Egg 3`. Handled by alias
   matching + punctuation-stripping slugs.
3. **Several collections have no name keys at all** (Charms, Potions,
   Enchants): names come from the configName prefix fallback
   (`"Charm | Coins"` → `Coins`), which is why Coins/Diamonds/etc. collide
   across three collections.
4. **Cross-collection bare-name collisions are real**: Coins & Diamonds
   (Charms/Enchants/Potions), Criticals/Lightning/TNT, Treasure Hunter/
   Walkspeed, Chest Mimic/Fireworks/Lucky Block, Banana/Candycane/Rainbow
   Swirl, UFO. The only discriminator is the feed entry's `category` field.

**Categories**

5. **Feed `category` is singular, collection names plural**, with irregular
   skew: `Charm`↔Charms, `Misc`↔MiscItems, `Lootbox`↔Lootboxes, `CropSeed`
   ↔Seeds. Handled by stem normalization + directional prefix match.
6. **Pets tag every entry `Uncategorized`** — the collection's own name must
   be seeded into its observed categories for pet-category matching to work.
7. **Internal categories are update/event names** (`Update 5`, `Halloween`,
   `Backrooms`, `Tier 3`, …), not stable product types; 126 distinct values.
   Only `Exclusive Eggs` is market-curated among egg categories.
8. **`hidden` exists upstream on 42 Pets entries and is always `false`.**
   There is no usable hide tag; curation is entirely our own job.

**Tiers & variants**

9. **`tn=1` means "the item itself".** Every charm is tn=1 only; 46 of 55
   enchants are single-level (Double Coins, Fireworks, Lightning…); the Huge
   potion too. Treating tn=1 as a separate variant splits data onto phantom
   rows, hence the tier-1 collapse. Multi-level items: enchants up to X,
   potions up to XI.
10. **Fruits carry shiny variants** (`sh=true`) but no tiers.
10b. **Tiered items have per-tier icons** — `configData.Tiers[index].Icon`
    (index = tier − 1) differs for every tier (`Coins I`…`Coins X` each have
    their own book). Storing one icon per enchant was wrong; tier rows now get
    `Tiers[tier − 1].Icon` and the base holds tier 1's.
10c. **BIG ships a placeholder icon**: asset `13824100032` (a cartoon blob
    face) is pointed at by every tier of several enchants. It is blacklisted
    in `PLACEHOLDER_ASSET_IDS` so those rows fall through to the next real
    tier icon instead of displaying the blob.
10d. **The Eggs catalog carries non-egg products**: Merch Series gift bags
    (reclassified to `Gifts`) and card packs (`CardPacks` — hidden as
    zero-data shells; the real packs live in Lootboxes).

**Coverage gaps**

11. **Feeds cover more than catalogs describe.** ~700 unmatched feed entries
    per cycle have no catalog home anywhere in the 35 collections: Tower
    Defense towers, minigame boosters/consumables, Pixel Tycoon workers,
    pickaxes, fishing rods, Catch pets, Halloween eggs, rotated merch pets.
    ps99rap behaves identically — it does not track them either.
12. **Currency counters ride along in exists** (`FiestaCoins`, `TapTokens`,
    …) — wallet balances, not tradeable items; deliberately left unmatched.
13. **Rotated pets keep market data after catalog removal** (BIG Maskot,
    Anubis, Bladee, Titanic Toilet Cat, Chroma Balloon family) — data exists
    upstream but our catalog-driven identity cannot re-create them. The one
    class a historical seed could recover.
14. **Multi-buy egg variants ("… Egg 5x") ship without thumbnails**, and a few
    XP tokens lack icons — no icon source exists upstream for them.

14. **Multi-buy egg variants ("… Egg 5x") ship without thumbnails**, and a few
    XP tokens lack icons — no icon source exists upstream for them.

## Context

The database redesign Rev 2 (`ede1151`) mechanically patched `src/services/sync.ts`
so chroma/tier variant rows are no longer collapsed, but deliberately left the
internal structure untouched: one ~200-line `runSync()`, per-entry sequential
awaits, name-blind feed matching, and mixed concerns. The redesign plan
explicitly deferred a wholesale sync rewrite to this plan.

### Defects fixed by this rewrite

From audit 02 + performance report (post-Rev 2 state):

- Thousands of sequential per-entry `upsertItem` round trips per cycle; no
  batching or transactions (perf fix #3).
- Variant rows were upserted *before* the change-dedupe check — redundant
  identical rewrites every cycle for unchanged variants.
- Silent drop of unmatched feed entries: no counter, no log, no result field.
- Golden/shiny image maps regressed on partial collection-fetch failure.
- Non-atomic chunked snapshot inserts (crash mid-loop lost the tail of an hour).
- Whole-feed discard on one malformed entry (all-or-nothing zod parse in
  `biggames.ts`); no retry/backoff, so a transient blip cost a full cycle.
- `collectionSpecs.ts` `usedFallback` bug warned on every healthy sync.
- Seeding enable-loop not transactional.

## Decisions (owner-confirmed)

| Decision | Choice |
|---|---|
| Structure | Folder pipeline at `src/services/sync/` |
| Write-path batching | Yes — transactional multi-row item upserts |
| Feed parsing | Per-entry tolerant (skip + count malformed entries) |
| Value sanity guards at ingest | Out of scope |
| Bootstrap repair loops | Remove (migration-era scaffolding) |
| Retry on upstream failures | Simple bounded retry with linear backoff |
| Namespace collisions | Solve via feed `category` + write-time grammar (added during implementation; see below) |

## Contracts preserved

Pinned by `ai/plans/database-redesign.md`:

- Exports consumed elsewhere: `bootstrapIfNeeded()` (`app.ts`),
  `syncAll()` (`routes/api.ts`, cron job), `pruneSnapshots()` (prune job),
  `SyncResult` incl. `errors: string[]` (spread into `/api/refresh`).
  `SyncResult` was extended additively with a `warnings` object.
- Repo contracts from Rev 2 kept: variant rows through upsert semantics
  (write-time slugs, prefixed displayNames, per-variant golden/shiny imageIds,
  `colorVariants` passthrough); snapshots via `insertSnapshots`; change
  detection via `getLatestValues`.
- Invariants retained: deterministic collision attribution + warning counts,
  feed-failure reporting, `sync.lastSyncAt` advances only when both feeds were
  fetched successfully, single shared run timestamp (safe under the
  `(item_id, metric, captured_at)` unique index + conflict-update insert).

## Target layout (as built)

```
src/services/sync/
├── index.ts        # public surface: bootstrapIfNeeded, syncAll, pruneSnapshots, SyncResult re-export
├── runner.ts       # orchestration: phase sequencing, single-flight guard, lastSyncAt policy
├── catalog.ts      # two-pass catalog sync: fetch+resolve → collision map → grammar → batched upsert
├── ingest.ts       # feed fetch → match → change-dedupe BEFORE row creation → batched variant rows → snapshots
├── matching.ts     # pure multi-stage feed-entry attribution (+ warning counters)
└── retry.ts        # bounded retry helper with linear backoff
```

Single-row `upsertItem(params)` remains in `itemsRepo.ts` as a thin wrapper over
the batch path (used by tests / one-off callers).

## Repo-layer changes

- `itemsRepo.ts`: batched transactional `upsertItems(rows)` (one multi-row
  INSERT ... ON CONFLICT per chunk against the full identity index); batch-aware
  global `SlugAssigner` (first-choice candidates preloaded in one query,
  first-come collision resolution, `-<collection>` suffix then numeric);
  optional `params.slug` stem override so the sync layer can drive slug
  grammar; tiered rows without an explicit stem stay unaddressable (NULL slug);
  deleted `repairVariantSlugs` / `repairVariantDisplayNames`.
- `collectionsRepo.ts`: `enableCollections` is a single bulk statement
  (inherently atomic).
- `snapshotsRepo.ts`: all chunks commit in one drizzle transaction (better-sqlite3
  transactions are synchronous; the drizzle sync builder runs inside).
- `biggames.ts`: `FeedResult<T> = { data: T[]; invalid: number }` — per-entry
  tolerant zod validation; one malformed entry is skipped + counted instead of
  discarding the feed.
- `collectionSpecs.ts`: fixed `usedFallback`; added namespace grammar (below).

## Ingest pipeline (per metric)

1. Fetch via retry helper; total fetch failure → recorded error, metric skipped.
2. Per-entry tolerant parsing upstream of this layer.
3. Match entries to base items (multi-stage, see below).
4. **Tier-1 collapse**: feed entries with tn=1 map onto the base row for every
   collection (upstream uses tn=1 to mean "the item itself"); grammar'd
   multi-level bases are additionally renamed to their tier-I form so level 1
   stays visible.
5. Dedupe within run on post-collapse identity (first entry per combo wins).
6. Change detection against `getLatestValues(metric)` happens **before** any row
   creation — unchanged variants never trigger upserts or row creation. Rows
   missing from the identity map are genuinely new (no snapshot history), so
   they are created (batched via `upsertItems`) and every one of their values
   recorded. Verified: zero back-to-back duplicate-value rows across all
   snapshots; storage growth tracks actual market movement only.
7. Single shared run timestamp for both feeds.

## Feed matching — multi-stage namespace-collision resolution

The RAP/exists feeds carry no collection field, only bare `configData.id` +
a `category`. Verified upstream realities (live API, 2026-08-25):

- Cross-collection bare-name collisions among enabled collections:
  Coins/Diamonds (Charms + Enchants + Potions), Criticals/Lightning/TNT,
  Treasure Hunter/Walkspeed, Chest Mimic/Fireworks/Lucky Block, Banana/
  Candycane/Rainbow Swirl, UFO. Charms/Potions/Enchants catalogs carry no
  name keys — names come from the `"Charm | Coins"` configName-prefix fallback.
- Feed `category` discriminates collisions modulo plural skew
  (`Charm` ↔ `Charms`, `Misc` ↔ MiscItems, `Lootbox` ↔ Lootboxes).
- Pets catalogs tag every entry `Uncategorized` — the collection *name* itself
  must provide the pet signal.
- Booths/Hoverboards catalogs name items suffixed (`"TNT Booth"`,
  `"Banana Hoverboard"`) while feeds carry the bare id with category.
- Feed ids frequently equal the configName-stripped form rather than the
  resolved display name (`XPPotion | Titanic` → `Titanic`; `Flag Bundle` for
  the item named `Bundle O' Flags`; `Hype Egg 2` for `Hype Egg #2`).
- Exists-only categories (`Currency`, `Catch`, `Worker`, …) have no home among
  enabled collections.

Matcher stages (pure module `matching.ts`, unit-tested without I/O):

0. **Candidate lookup** merges exact primary-name matches with
   **configName-alias** matches (`AliasIndex`: collection → item name →
   alternate ids) so category stages can arbitrate between them (`Huge` the
   potion vs `Huge` the XPPotion alias).
1. Single candidate wins — unless its collection does not cover the feed
   category, in which case a suffixed match takes precedence (the pet `Coin`
   vs feed `Coin` [Seed] → `Coin Seed`).
2. **Category filter** — keep candidates whose collection's observed catalog
   categories match the feed category (stemmed: `-ies→y`, `-xes/-shes…→-x`,
   directional prefix check covers `Misc`↔`miscitem`). Observed sets are seeded
   with the collection's own lowercase name (Pets/Uncategorized case).
3. **Suffixed lookup** — `<Id> <Token>` against the category-matching
   collection's names (`TNT` [Booth] → `TNT Booth`). Token = singularized
   collection name.
4. Category known but nothing matches (e.g. `Coins[Currency]`) → counted as
   **unmatched**, not attributed (previously fabricated alphabetical data).
   Pure alphabetical fallback + ambiguous count applies only when no category
   information exists at all.

Result: ambiguous attributions went 62→7→**0** (rap) and 67→9→**0** (exists);
unmatched dropped 848→223 (rap) and 1205→486 (exists) across the iterations;
previously-dropped booth/hoverboard/seed feeds now land.

## Namespace grammar (write-time naming/slugs)

Defined in `collectionSpecs.ts` as `NAMESPACE_RULES` + helpers
(`namespaceNaming`, `namespaceTierNaming`, `toRoman`). Grammar applies at
catalog-upsert time using the global name→collections collision map computed
across enabled collections before any row is written; `items.name` (the feed-
matching identity) never changes — only displayName and slug.

| Collection | Token | Mode | Example base | Example tier |
|---|---|---|---|---|
| Enchants | `-enchant` | always | `Coins I Enchant` / `coins-i-enchant` (base holds tier-1 data); `Double Coins Enchant` (single-level) | `Coins III Enchant` / `coins-iii-enchant` |
| Charms | `-charm` | always | `TNT Charm` / `tnt-charm` (all charms single-level → data on base) | — |
| Potions | `-potion` | always | `Huge Potion` / `huge-potion` (single-level) | `Coins I Potion` … `Coins XI Potion` |
| Fruits | `-fruit` | always | `Banana Fruit` / `banana-fruit` | shiny composes: `shiny-banana-fruit` |
| Seeds | `-seed` | collision-only | "Plant" infix stripped from upstream names (`Coin Plant Seed` → `Coin Seed`); bare feed ids (`Coin` [Seed]) resolve via suffixed lookup | — |
| MiscItems | `-item` | collision-only, **keepsPlain** | `Rainbow Swirl Item` (vs Pets); bare `TNT` / `tnt` when colliding only with tokened collections | — |
| Hoverboards | `-hoverboard` | collision-only | `UFO Hoverboard` / `ufo-hoverboard` | — |
| Ultimates | `-ultimate` | collision-only | `UFO Ultimate` / `ufo-ultimate` | — |
| Pets | — | never | pets always keep bare name/slug (`banana`, `rainbow-swirl`) | — |

Plain-name precedence inside a colliding group: token-less collections (Pets)
always keep the bare name; when the whole group is token-having, the
`keepsPlain` designated collection (MiscItems) stays bare and the others
suffix (`tnt` + `tnt-charm`, `fireworks` + `fireworks-enchant`).

Tier addressing uses **Roman numerals attached directly to the item name** —
the word "tier" appears nowhere (`Coins III Enchant` / `coins-iii-enchant`),
matching how the game displays them. Tier-1 data lives on the grammar'd base
row renamed to the tier-I form ("Coins I Enchant"); single-level items (all 46
single-level enchants like Double Coins/Fireworks/Lightning, every charm, the
Huge potion) keep plain base naming with no tier dimension. Tiered rows get
slugs only when the namespace grammar provides an explicit stem; otherwise
they remain NULL-slug (e.g. non-grammar collections' tier rows).

Data facts driving these choices:

- Flags need nothing — upstream already names them `Coins Flag` etc. and feed
  ids match exactly.
- Enchants feed tiers are tn 1–10 (46 of 55 enchants single-level); Potions
  tn 1–11 (Huge single-level); Charms always tn=1; Fruits have shiny
  (`sh=true`) variants.

Grammar'd variant composition works naturally: variant prefixes prepend onto
the grammar stem, and `variantLabel` composes display names
(`Shiny Banana Fruit`).

## Default collections

`DEFAULT_ENABLED_COLLECTIONS` (16): Pets, Boosts, Booths, Boxes, CardItems,
Charms, **Eggs**, Enchants, Fruits, Hoverboards, Lootboxes, MiscItems,
Potions, Seeds, Ultimates, XPPotions.

## Curation & visibility

Visibility rules implemented:

- New `category` table (`name` PK, `hidden`, `createdAt`) populated from real
  upstream internal categories (`entry.category` — 126 rows: Special,
  Exclusive, Update names, Flags, Vouchers, …). Decoupled from
  `collections.displayName`.
- `items.categoryName` stores each row's upstream internal category;
  propagated onto variant rows.
- Hidden-category rule: categories used only by the Eggs collection except
  `"Exclusive Eggs"` → `hidden = true` (85+/126 flagged) — non-exclusive eggs
  stay out of listings.
- **Clutter override list** (`HIDDEN_CATEGORIES` in `collectionSpecs.ts`):
  `Event`, `Events`, `Boosts`, `CardPacks` are always flagged hidden. This is
  what hides card-pack shells that ride in the Eggs catalog (`Retro Pack` &
  friends, 0 snapshots) while the real Lootboxes packs (all with data) stay
  visible, and hides no-data boost effects (Friends Boost, Fiesta * Luck) —
  matching ps99rap, which tracks neither.
- **Data-aware exemption**: hidden-category items are excluded from listings
  only when they have NO snapshots. Event/boost/pack items that carry rap or
  exists stay visible (owner rule: "some event items also have rap and
  exists").
- **Item-level hiding** (`HIDDEN_ITEMS` in `collectionSpecs.ts`, keyed
  `"Collection/Name"`): absolute hide for specific untradeable items
  (XPPotions: Garden XP Token, Ultra Titanic XP Potion, Unit XP Token I–III).
  Applies even when the item has market data. `items.hidden` is presentation-
  only — the sync still ingests and stores all data for hidden items and
  hidden categories; nothing is deleted or skipped at ingest.
- Exception: merch Series 1–3 gift bags ride in the Eggs catalog but are
  reclassified into the shared `Gifts` category at sync time so they remain
  visible (owner rule: event gift bags stay visible).
- Item listings (`/api/items`, filtered query) apply the rules above; detail
  pages remain reachable.
- `/api/items` exposes `internalCategory` per item.

## Schema additions

| Migration | Content |
|---|---|
| `0003_fantastic_maximus` | `items.configData` (raw upstream JSON), `collections.displayName` (singular names), `category` table |
| `0004_violet_morgan_stark` | `items.categoryName` (upstream internal category per row) |
| `0005_broken_christian_walker` | `collections.hidden` reserved curation flag (currently nothing flags it; migrations 0006/0007 were generated for a reverted approach and later deleted, with the drizzle journal scrubbed to match) |

Icon extraction covers structured entries: enchant `Tiers[].Icon`, box
`Icons[].Icon`; plus cross-collection icon fill when an identically-named
entry in another collection carries one. Remaining icon-less items (~89) are
upstream gaps: multi-buy egg variants ("… Egg 5x", no thumbnails) and a few
XP tokens.

Slugs strip ALL punctuation via `slugify` remove option
(`Crystal Key: Upper Half` → `crystal-key-upper-half`,
`Locked Hype Egg #3!` → `locked-hype-egg-3`).

## Detail pages & thumbnails (2026-08-25, post-rewrite)

Two rendering bugs fixed after the curation work:

1. **Tier items showed no values.** `buildItemDetail` matched the viewed
   variant with `item.tier === 0` (a constant condition — always false for
   tier > 0 rows), and `variantsForItem` filtered `s.tier = 0` entirely, so
   every enchant/potion tier II+ page rendered null current values and an
   empty ladder. Now `variantsForItem` returns the full tier ladder with a
   `tier` column; tiered items' pages surface the whole ladder (I→X) and the
   self-match is `v.tier === item.tier`. Regular items still list only their
   pt/shiny/chroma variants (tier rows filtered to avoid clutter).
2. **Name-based thumbnails collided across collections.** `/thumbnails/:name`
   resolved `findImageIdByName` with an unordered `LIMIT 1`, so the zero-data
   Eggs-catalog `Retro Pack` shell's egg icon could win over the Lootboxes
   pack's real icon. Thumbnails are now addressed **by asset id**: the route
   accepts numeric ids directly, and `item.ejs` / `items.js` use
   `item.imageId` first (name lookup remains the fallback). Immune to name
   collisions.

Also fixed: the tier-I base rename was wiping `items.configData` AND
`items.categoryName` (rename params omitted them, so the upsert
conflict-update nulled the columns — 16 multi-level grammar'd bases affected:
9 Enchants + 7 Potions) — the rename now preserves both, and
`getBaseItemsWithCollection` / `MatchableItem` carry `configData` and
`categoryName` through the pipeline.

### Post-fix audit (2026-08-25)

Systematic self-review of the new rendering/curation code — one bug found and
fixed (the categoryName wipe above); verified clean:

- Tier-aware values: `coins-ii-enchant` renders currentRap/exists/history
  correctly (tier ladder I→X, per-tier icons intact).
- Thumbnails: id-based URLs serve each item's own icon; no egg/pack
  collisions; `q=pack` shows only data-ful Lootboxes packs.
- Hidden items/categories: flags intact after re-syncs; data still stored for
  hidden items (presentation-only).

Known non-bugs left as-is (cosmetic or pre-existing): `/api/pets/:itemKey/
history` resolves tier rows to their base (unused by the frontend);
`itemKey` for tier rows is the bare base name (cosmetic API field);
`totalExists` on a tier page sums the whole ladder (debatable semantics);
hourly `cacheFlush` trades cache hit-rate for correctness; thumbnail files
in `public/thumbnails/` never expire.

## Verification

- `npm run typecheck && npm run lint && npm test && npm run build` — clean;
  **110 tests passing**, including `tests/matching.test.ts` (attribution
  stages), `tests/namespace-sync.test.ts` (end-to-end grammar),
  `tests/collectionSpecs.test.ts` (toRoman/naming), updated `tests/sync.test.ts`
  (FeedResult mocks, tolerance/retry/warnings).
- Live end-to-end on fresh DBs (real upstream): ~6 s full sync; 35 collections,
  4,699 catalog items, ~14k RAP + ~16.8k exists snapshots, zero errors, zero
  duplicate slugs globally.
- Final live warnings: rap `{ unmatched: 223, ambiguous: 0 }`, exists
  `{ unmatched: 486, ambiguous: 0 }` — all verified as homeless upstream ids
  (minigame content, currencies, rotated pets absent from every catalog).
- Spot checks: `Coins` split across charms/enchants/potions incl. Roman tiers
  with **per-tier icons** (10/10 distinct for Coins, verified against
  upstream); `ufo-hoverboard` vs `ufo-ultimate`; booth/hoverboard/seed suffix
  matches; Huge XP Potion, Hype/Locked Hype Eggs, key halves, bundles,
  Insta-Plant Capsule all carrying data; blob placeholder asset blacklisted
  (0 items); change-dedupe verified (zero back-to-back identical-value rows);
  `q=pack` shows only data-ful Lootboxes packs.

## Operational notes

- The legacy live DB (`data/ps99.db`, pre-drizzle schema) could not boot even
  before this rewrite; it was reset after backup. Fresh init applies migrations
  cleanly. Migration strategy for existing installs remains open under the
  broader database-redesign effort.
- **Redis flushes on every completed sync** (`cacheFlush()` in runner): caches
  are purely derived, and this evicts both genuinely-stale entries and the
  poisoned zero-result responses written during the first-run bootstrap window.
  Any future DB reset should still flush Redis manually if the server was
  running pre-reset.
- `npm run format` reformats many unrelated files (repo-wide prettier drift) —
  scope formatting runs carefully.
- History restarts from cutover (hourly cadence rebuilds charts).

## Known remaining limitations

- ~223 rap / ~486 exists unmatched per cycle: feed-only ids with no catalog
  home (Tower Defense towers, minigame boosters/consumables, Pixel Tycoon
  workers, Currency counters, pickaxes, fishing rods, Catch pets, rotated
  pets like BIG Maskot). Visible in `warnings` instead of silent.
- Non-grammar tiered collections would still produce NULL-slug tier rows
  (none currently enabled besides those handled above).
- Unauthenticated `/api/refresh`, hourly cadence, `/reports` route: accepted
  quirks, untouched.
