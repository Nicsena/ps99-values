# Database Redesign Plan

Status: Revision 2 (2026-08-24) — supersedes the `item_variants` layout above; implemented below
Created: 2026-08-24 · Revised: 2026-08-24
Inputs: `ai/reports/inconsistency-audit/01-storage-query.md`, `02-sync-ingest.md`

## Revision 2 — merged variant-per-row layout (current design)

The original redesign stored variants in a separate `item_variants` dimension
table. Revision 2 **reverts that one structural choice**: variant dimensions
(`variant`, `shiny`, `chroma`, `tier`) move back onto `items`, restoring
variant-per-row addressing — while keeping every other hardening from the
redesign.

### Why
- `/items/:slug` becomes a single exact indexed match in a single table:
  `/items/rainbow-gargantuan-skelemelon` ←→ `getItem(slug)` ←→ DB.
- Identity is decided at **write time** (slugs are data), not request time —
  see "Design rationale" in `slug-redesign.md`.

### Target schema
```
items (one row PER VARIANT)
  id · collection · name · displayName · description · slug (nullable)
  colorVariants JSON · hidden · imageId · huge/titanic/gargantuan · createdAt
  variant INT (0 regular/1 golden/2 rainbow) · shiny BOOL
  chroma INT (0..6) · tier INT (0 sentinel)
  UNIQUE(collection, name, variant, shiny, chroma, tier)
  UNIQUE(slug)

snapshots: itemId → items.id · metric('rap'|'exists') · value · capturedAt
           UNIQUE(itemId, metric, capturedAt)

app_settings: unchanged          ❌ item_variants: dropped
```

### Slugs
- Primary rows: `slugify(name)` (e.g. `gargantuan-skelemelon`).
- Golden/rainbow/shiny combos: prefixed grammar (`golden-…`, `shiny-rainbow-…`),
  generated at write time; global uniqueness within `items.slug`, collisions
  resolved first-come with `-<collection>` suffixes.
- Chroma/tier-only rows: NULL slug (unaddressable this pass; deferred).

### Data-carrying migration `0002`
1. Rebuild `items` with merged columns; existing rows become primaries,
   preserving ids and slugs.
2. Expand each `item_variants` row into an `items_new` row: parent metadata +
   dims + prefixed `displayName` ("Golden …"/"Shiny …") + grammar slug
   (NULL for chroma/tier rows). Variant `imageId` starts as parent's; golden/
   shiny thumbnails self-heal on the next sync.
3. Slug collisions resolved deterministically (base rows win; losers take
   `-<collection>` suffixes).
4. Rebuild `snapshots` remapping `variant_id → item_id` via
   `(collection, name, dims)` join; recreate indexes; drop `item_variants`.

### Sync scoping (per owner decision)
> **Future work — sync service rewrite.** The owner considers
> `src/services/sync.ts` too messy and expects a **wholesale rewrite** of the
> entire file under a separate future plan (not yet planned). Everything below
> describes only the mechanical changes made *for this migration*; none of the
> internal structure should be treated as keeper architecture.

Sync has a **separate future refactor/redesign** planned. This revision includes
only the mechanical changes the merged layout forces: creating variant rows
with dims/slugs/prefixed displayNames/imageIds. Matching logic, batching,
atomicity, upstream validation strategy, retry/partial-failure policy are
explicitly out of scope until that plan.

Contracts any sync rewrite must preserve (everything else is fair game):
- Exports consumed elsewhere: `bootstrapIfNeeded()` (`app.ts`),
  `syncAll()` (`routes/api.ts`, `cron/jobs/sync.job.ts`), `pruneSnapshots()`
  (`cron/jobs/prune.job.ts`), `SyncResult` shape including `errors[]`
  (spread into the `/api/refresh` response).
- Repo contracts established by Revision 2: variant rows created through
  `upsertItem` with dims (write-time grammar slugs, prefixed displayNames,
  per-variant golden/shiny imageIds, `colorVariants` JSON passthrough);
  snapshots written via `insertSnapshots`; change-detection via
  `getLatestValues`.
- Invariants: deterministic collision attribution + warning counts,
  feed-failure reporting, `sync.lastSyncAt` advances only on fully healthy
  runs, single shared run timestamp safe under the unique snapshot index.

### Code changes
- **itemsRepo**: dims on `UpsertItemParams` (+ full-identity conflict target);
  write-time slug generation; `findItemVariant(name, pt, shiny[, chroma])`;
  delete `resolveVariantId` family; `getBaseItemsWithCollection` filters
  primary dims.
- **snapshotsRepo/listings/rapService/pages**: keyed off `items.id`; no join
  chains, no fallbacks — one exact query per page hit.
- **Frontend/API**: variant tiles link via their own slugs; additive `slug` on
  API `ItemVariant`.
- **Tests**: variant-row sync (names/images), slug grammar/collision cases,
  route resolution, cross-sibling totals.

---

# Original Revision 1 (historical — superseded by Revision 2)

Status: draft, pending review
Created: 2026-08-24
Scope: DB schema + repos + sync ingest (read paths updated minimally for correctness)
Inputs: `ai/reports/inconsistency-audit/01-storage-query.md`, `02-sync-ingest.md`

## Decisions

- **Fresh start**: no data migration; existing (~8 days) history is discarded and the app re-bootstraps from upstream. Existing data is polluted by tie/fan-out bugs (audit #1, #11).
- **Identity model**: base item + variant dimensions. One canonical `items` row per upstream item scoped to collection; variants become structured rows in a new `item_variants` table. Fixes chroma/tier collapse (audit HIGH), cross-collection fan-out, and enables true cross-variant totals.
- **Schema management**: adopt drizzle-kit migrations. `src/db/schema.ts` becomes sole truth; delete hand-rolled `ensureSchema()`/`migrateItemsTable()` legacy DDL in `client.ts`.
- **Merged snapshots table**: RAP + exists share one `snapshots` table with a `metric` column (alternative considered: two tables — rejected as duplicated DDL/latest/prune logic).

## 1. New canonical schema (`src/db/schema.ts`)

### collections — unchanged
```ts
collections = sqliteTable('collections', {
  name: text('name').primaryKey(),
  enabled: integer('enabled', { mode: 'boolean' }).notNull().default(false),
  dateSynced: integer('date_synced', { mode: 'timestamp' }),
})
```

### items — one row per upstream item, no variant columns
```ts
items = sqliteTable('items', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  collectionName: text('collection').notNull().references(() => collections.name),
  name: text('name').notNull(),
  displayName: text('displayName'),
  description: text('description'),
  slug: text('slug').notNull(),                 // canonical, lowercase at write time
  hidden: integer('hidden', { mode: 'boolean' }).notNull().default(false),
  imageId: integer('imageId'),
  huge: integer('huge', { mode: 'boolean' }).notNull().default(false),
  titanic: integer('titanic', { mode: 'boolean' }).notNull().default(false),
  gargantuan: integer('gargantuan', { mode: 'boolean' }).notNull().default(false),
  createdAt: integer('createdAt', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
}, (t) => [
  uniqueIndex('items_identity_uq').on(t.collectionName, t.name),
])
```

Changes vs current:
- Drops `variant`, `shiny` (move to `item_variants`) and dead `tier` column.
- Integer autoincrement PK replaces random UUID strings.
- `slug` NOT NULL, stored canonical/lowercase at write time (fixes audit §D `LOWER(slug)` index-defeating lookups).
- `UNIQUE(collection, name)` ends cross-collection ambiguity in lookups.

### item_variants — new
```ts
itemVariants = sqliteTable('item_variants', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  itemId: integer('item_id').notNull().references(() => items.id, { onDelete: 'cascade' }),
  variant: integer('variant').notNull().default(0),   // 0 regular · 1 golden · 2 rainbow (upstream pt)
  shiny: integer('shiny', { mode: 'boolean' }).notNull().default(false), // upstream sh
  chroma: integer('chroma').notNull().default(0),     // upstream cv, 1..6; 0 = none
  tier: integer('tier').notNull().default(0),         // upstream tn; 0 sentinel so uq index works
}, (t) => [
  uniqueIndex('item_variants_uq').on(t.itemId, t.variant, t.shiny, t.chroma, t.tier),
])
```

Notes:
- `tier` uses a `0` sentinel instead of NULL because SQLite treats NULLs as distinct in unique indexes (duplicate rows would slip through).
- Upstream `vr` label is noted but not stored initially; revisit if a consumer needs it.

### snapshots — merged RAP + exists
```ts
snapshots = sqliteTable('snapshots', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  variantId: integer('variant_id').notNull().references(() => itemVariants.id, { onDelete: 'cascade' }),
  metric: text('metric', { enum: ['rap', 'exists'] }).notNull(),
  value: integer('value').notNull(),
  capturedAt: integer('captured_at', { mode: 'timestamp' }).notNull(),
}, (t) => [
  uniqueIndex('snapshots_unique_idx').on(t.variantId, t.metric, t.capturedAt),
])
```

Notes:
- Unique index makes timestamp ties structurally impossible; inserts use `.onConflictDoNothing()`. It doubles as the covering index for latest/history/prune queries (audit §G prune full-scan).
- Replaces `rap_snapshots` + `exists_snapshots`; drops UUID PKs and denormalized `item_key` (audit §E).

### app_settings — unchanged columns
Registered in the exported drizzle schema object so `db.query.appSettings` works (fixes audit low finding). Fix `protected` being silently dropped on conflict-update in settingsRepo while touching that layer.

## 2. Schema management (`src/db/client.ts`)
- drizzle-kit is authoritative: generate initial migration via `npm run db:generate`; apply with drizzle `migrate()` at startup.
- Delete `ensureSchema()`, `migrateItemsTable()`, per-boot `DROP INDEX`, and dual-DDL statements.
- Enforce `PRAGMA foreign_keys = ON` at connection time (audit HIGH: FKs never enforced today).

## 3. Repo layer rewrite
- **snapshotsRepo**: rewritten for merged table:
  - `getLatestValues(metric)`, `loadHistory(variantId, metric)`, `countSnapshots(variantId, metric)`, `pruneSnapshotsOlderThan(cutoff)`.
  - Latest queries use `ROW_NUMBER()` window CTEs — deterministic reads, no bare-column `HAVING MAX()` idiom.
  - Transactional batch inserts with `.onConflictDoNothing()` (fixes non-atomic chunked inserts).
- **itemsRepo**:
  - `upsertItem` becomes base-item only (no variant params); new `resolveVariantId(itemId, {variant, shiny, chroma, tier})` upserting into `item_variants`.
  - Exact-match indexed slug/name lookups (no `LOWER()` scans); remove fuzzy-prefix fallback path.
  - Remove `backfillItemSlugs` boot loop from sync (slugs written at upsert time).
- **collectionsRepo**: transactional enable-loop seeding.

## 4. Sync ingest rewrite (`sync.ts`, `biggames.ts`, `itemKey.ts`)
- Extend `RapEntry` zod schema to parse `pt`, `sh`, `cv`, `tn` (note `vr`). Stops active corruption from collapsed chroma/tier variants (audit HIGH).
- Match RAP/exists entries against base items by `(collection, name)`:
  - Single match → use it.
  - Multi-match (14 live cross-collection collisions) → deterministic attribution (one ordered rule) + warning counter. Known upstream limitation; mitigated, not solved.
- Dedupe within a run before insert; shared run timestamp acceptable now that `(variantId, metric, capturedAt)` is unique.
- Failure semantics: feed-fetch failures recorded in `SyncResult`; `sync.lastSyncAt` only advances when both feeds succeeded (audit MED #14).
- Replace `buildRapItemKey`/`parseVariantFromRap` with a single variant-dimension module; update `tests/itemKey.test.ts`.

## 5. Read-path updates (minimal-correctness)
`listings.ts` + `rapService.ts` adjusted to the new model while keeping API/page response shapes stable:
- Variant labels read from authoritative `item_variants` rows, not `COALESCE`d snapshot columns (audit §C).
- Exists joins keyed on variant/item id alone — un-hides 2,569 suppressed non-regular variants (audit §B).
- Latest-snapshot CTEs become `ROW_NUMBER()` window queries.
- `totalExists` aggregates across all variants of a `(collection, name)` group (audit §B med).
- Slug parsing/resolution redesign stays out of scope (separate work item); this change only stores canonical slugs.

## 6. Reset & verification
1. Delete `data/*.db`; first boot re-bootstraps from upstream.
2. Update `tests/sync.test.ts`, `tests/itemKey.test.ts`, `tests/rapService.test.ts`; add repo tests (variant resolution, snapshot uniqueness/dedupe, latest determinism, collision attribution).
3. Run `npm run typecheck && npm run lint && npm test && npm run build`.
4. Boot dev server; verify `/`, `/api/items`, item detail pages render correctly against fresh bootstrapped data.

## Risks / notes
- Read-path changes are the largest surface: `listings.ts` assumes variant-per-row items in several places. Response shapes kept identical; internal SQL changes substantially.
- Cross-collection name collisions are an upstream limitation; deterministic attribution + warning only.
- History resets to zero after cutover; charts/stats start thin and rebuild hourly.
- `/reports` route, hourly cadence, unauthenticated sync trigger remain accepted quirks — untouched here.

## Implementation order
1. Extend `biggames.ts` entry parsing (`pt`, `sh`, `cv`, `tn`).
2. New `schema.ts` + drizzle-kit migration setup; `client.ts` cleanup (FK pragma, delete legacy DDL).
3. Rewrite `snapshotsRepo`, `itemsRepo` (+ `collectionsRepo` transactional seeding).
4. Rewrite sync ingest (variant dims, matching, atomicity, failure semantics).
5. Minimal-correctness updates to `listings.ts` / `rapService.ts` (stable response shapes).
6. Reset DB, bootstrap, verify endpoints; tests + typecheck + lint + build.
