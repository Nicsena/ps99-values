# 01 · Storage & Query Layer — 31 findings (5 high / 15 med / 11 low)

Lens: schema ↔ DDL ↔ SQL ↔ exported types, latest-snapshot semantics, slug systems, index coverage, cache layer. All claims verified against source and live DB (EXPLAIN QUERY PLAN / SELECT).

## A. Latest-snapshot SQL semantics

- **[HIGH] snapshotsRepo.ts:37 · listings.ts:8,13 — `HAVING captured_at = MAX(captured_at)` picks an arbitrary row on timestamp ties, and ties with conflicting values are pervasive.** Measured live: **3,015 rap groups and 10,206 exists groups (100% of ties) have conflicting values at the identical max timestamp**. Example: item `052d0818-…` has 7 rows at `captured_at=1787464667` with values 92,362,398 → 384,726,438. The pattern also depends on SQLite's non-standard bare-column min/max special case. Fix: `ROW_NUMBER() OVER (PARTITION BY … ORDER BY captured_at DESC, value)`.
- **[HIGH] sync.ts:225-243 + snapshotsRepo.ts:44 — no uniqueness guard on `(item_id, pt, shiny, captured_at)`; one run stamps many conflicting values with the same `now`.** This manufactures exactly the tie population above. A unique index + `onConflictDoNothing`, or per-entry timestamps, eliminates the class.
- **[LOW] listings.ts:186-199 — `latest` CTE joins without pt/shiny predicate on the first join.** Safe only while the GROUP BY yields one row per group; a tie duplicates listing rows. ROW_NUMBER would make the invariant structural.

## B. Exists join & totals

- **[HIGH] listings.ts:196-199 — exists join keyed on `COALESCE(l.pt,0)`/`COALESCE(l.shiny,0)` suppresses exists data whenever the RAP row is missing for a non-regular variant.** Measured live: **2,696 items have exists snapshots but no rap snapshots; 2,569 are non-regular variants whose exists data is provably hidden**. Fix: join on `e.item_id = i.id` alone (item_id already disambiguates) or use `i.variant/i.shiny`.
- **[MED] listings.ts:339-348 — `totalLatestExists` does NOT total across variants.** Verified: **0 items have >1 snapshot group per item_id** under variant-per-row. `SUM(value) GROUP BY item_id, pt, shiny WHERE item_id = X` degenerates to the single variant's latest value. `ItemDetail.totalExists` presents it as an aggregate — it is a duplicate of `exists`. True cross-variant total needs grouping by (collection, name).

## C. Identity & filtering in read paths

- **[MED] listings.ts:190-191, 259-264 — variant identity read from snapshots, not the items row.** `COALESCE(l.item_key, i.name)`, `COALESCE(l.pt,0)`, `COALESCE(l.shiny,0)`: a variant-per-row item with no RAP snapshot presents as Regular and loses detail-link flags, despite authoritative `i.variant/i.shiny` on the same row.
- **[MED] listings.ts:246-270, 172-223 · itemsRepo.ts:41-51 — no enabled-collection filtering in any read path** (listRowsRaw, listRowsFiltered, countItemsFiltered, countItems). Disabling a collection (the documented mechanism) hides nothing. Contrast: `getBaseItemsWithCollection` (itemsRepo.ts:189-190) correctly gates ingest on enabled.
- **[MED] listings.ts:114-131 — exists-range filters silently drop NULL-exists rows even when `show_exists_zero=true`.** `e.value < 100` is NULL for untracked items → excluded from "rare" views.
- **[MED] sync.ts:161-166, 226-243 — cross-collection name fan-out.** `byName` indexes all enabled collections by name; 14 live colliding names (`Coins` ×3, `Diamonds` ×3, `Banana` ×2…) insert the same value into every collection's row — misattribution + tie manufacturing.

## D. Slug system

- **[HIGH] slug.ts:45-68 — `splitDetailSlug` prefers variant-prefix parses; 30 live items named "Golden/Rainbow/Shiny …" are hijackable.** `/items/Golden-Axe` resolves as (Golden, `axe`) before literal "Golden-Axe". Whole-slug match should be tried first.
- **[HIGH] itemsRepo.ts:92-121 + slug.ts:4 — 23 duplicate slugs across collections resolved by unordered `LIMIT 1`; `LOWER(slug)` lookups defeat `items_slug_idx` (EQP: SCAN items).** Slugs computed from name only, mixed-case stored, lowercased on lookup — the index can't serve the exact-match fast path.
- **[MED] rapService.ts:329-331 + listings.ts:304-306 — cross-collection detail resolution is rowid luck.** `findItemByNameLower` is unscoped/unordered; everything downstream (variantsForItem) scopes to the accidentally-chosen collection.
- **[LOW] schema.ts:32-35 — slug not unique.** "Huge Cat" vs "Huge Cat!" both → `Huge-Cat`; exact-match LIMIT 1 arbitrary.
- **[LOW] sync.ts:82-100 — `backfillItemSlugs` O(16k) per-row UPDATEs at every boot**, mixed-case algorithm that lookups then lowercase.

## E. Schema vs DDL vs types

- **[HIGH] client.ts:69-85, 92-94 — foreign keys never enforced (`PRAGMA foreign_keys` = 0); `migrateItemsTable` can `DROP TABLE items`, orphaning all snapshot rows** (223,804 total) with dangling item_ids that pollute LATEST aggregates forever.
- **[MED] client.ts:131 — migration fallback inserts `''` as collection**, violating `REFERENCES collections(name)` silently.
- **[MED] schema.ts:23 — `tier` dead column.** Never written (absent from UpsertItemParams), never read; 0 non-null rows live; carried through DDL + drizzle + migration.
- **[MED] schema.ts:20 — `hidden` write-only.** Populated by sync, no read path filters it.
- **[MED] schema.ts vs client.ts — dual DDL sources.** `createdAt` defaults differ (JS clock vs unixepoch()); `items_slug_idx` created outside the statements array; no drizzle-kit path; hand-rolled ensureSchema is the sole truth.
- **[LOW] appSettingsSchema.ts excluded from the drizzle `schema` object** — `db.query.appSettings` blind; one-schema convention broken.
- **[LOW] settingsRepo.ts:32-37 — `updatedAt` managed twice; `protected` silently dropped on conflict-update**, contradicting setSetting's contract.
- **[LOW] listings.ts:27 — `RawListRow.displayName: string` nullability lie** (column nullable; cast through `unknown` at :200/:265).
- **[LOW] snapshotsRepo.ts:45/61 — `item_key` duplicates identity encoded by item_id**, frozen at insert, diverges after renames; `COALESCE(l.item_key, i.name)` serves stale identities.

## F. Cache layer

- **[MED] cache/index.ts:61-85 — `cacheDel`/`cacheDelPrefix` exported, zero callers.** Up to 1h stale reads after every sync (detail TTL 3600s = sync interval).
- **[MED] cache/index.ts:5,17,27 — sticky `unavailable` latch**: one error disables caching until restart; `retryStrategy: () => null` blocks reconnects.
- **[LOW] rapService.ts:184/325/534/584 — four key schemes (`rap:list:`, `v3:items:`, `v4:detail:`, `v3:search:`)**; searchItems pollutes `v3:items:` with search-shaped entries; raw `q` in keys → unbounded cardinality.

## G. Misc storage

- **[LOW] snapshotsRepo.ts:121-126 — prune DELETE full-scans both tables** (no `captured_at` index; EQP verified SCAN).
- **[LOW] listings.ts:16-23 — `hour_exists` window sort spills to temp b-tree** (~174k rows per /api/items request).
- **[LOW] listings.ts:217 — negative `existsPerHour` unclamped.**
- **[LOW] itemsRepo.ts:45 · listings.ts:91,249 — LIKE wildcards unescaped** (`q="%"` matches everything; cache-key cardinality).
- **[LOW] listings.ts:254-255 vs 172+ — `sql.raw(order)` safe-by-distance** in one function, structurally safe in the sibling. Inconsistent patterns.
- **[LOW] client.ts:78, 8 — legacy `DROP INDEX` runs every boot; `mkdirSync` at module import.**
