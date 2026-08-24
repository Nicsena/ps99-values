# 02 · Sync, Ingest & Identity — findings from the services lens (§1–2)

Lens: upstream ingestion, identity & translation layers. Real upstream feeds carry `pt` (1=golden, 2=rainbow), `sh` (shiny), plus `cv` (chroma 1..6), `tn` (tier), and `vr` labels — verified via `src/test/03-variant-keys.ts:30-37`.

## 1. Upstream ingestion

- **[HIGH] sync.ts:228-243 (+ itemKey.ts:15-21) — chroma (`cv`) / tier (`tn`) / `vr` variants collapse onto the base item row.** `parseVariantFromRap` reads only `pt`/`sh`; every chroma/tier entry matches `byName.get(entry.configData.id)` → `resolveItemId(item, 0, false)` → base id. Multiple snapshots for one `(item_id, pt, shiny)` share the identical `capturedAt = now` (line 214) with different values. Consequences: (a) "current RAP" for chroma/tiered items is an arbitrary pick among colliding rows; (b) history/stats polluted by interleaved distinct physical variants; (c) tiered consumables overwrite each other every hour. The test harness labels these dimensions (`03-variant-keys.ts:34-36`) — production ignores them.
- **[HIGH] schema.ts:23 + itemsRepo.ts:23-35,123-158 — `items.tier` column is dead; the tier dimension exists nowhere in the identity model** — not in items, not in snapshots, not in keys, despite the migration carefully preserving the column.
- **[MED] sync.ts:161-166, 226-227 — name-based, collection-blind matching causes cross-collection fan-out.** One upstream entry inserts snapshots into every collection containing an identically-named item (14 live collisions), fabricating data for the wrong collection.
- **[MED] sync.ts:129-138, 226-227 — silent drop of unmatched entries.** Entries whose `configData.id` ≠ any resolved `item.name` are skipped with no counter/log/metric. A naming mismatch permanently silences an item's RAP/exists; sync reports success regardless.
- **[MED] sync.ts:206-212, 250-256, 284 — partial-failure semantics: sync "succeeds" while entire datasets are missing.** `fetchRap`/`fetchExists` failure → logged, `[]`, continue; `lastSyncAt` still advances; `SyncResult` carries no failure indication.
- **[MED] snapshotsRepo.ts:44-49, 60-65 — batch inserts non-atomic across chunks.** Crash mid-loop leaves a partial hour; changed-back values in the un-inserted tail are lost from history.
- **[MED] sync.ts:214, 240, 276 — single shared `now` per run**; tie-handling depends on SQLite bare-column quirks (see 01-storage-query.md §A).
- **[LOW] sync.ts:230, 265 — variant `upsertItem` runs before the dedupe check** — thousands of redundant identical rewrites per cycle; overwrites imageId (next item).
- **[LOW] sync.ts:118-119, 181-192 — golden/shiny image maps regress on partial collection-fetch failure; Shiny-Golden gets the golden icon** (`shinyId` requires `!pt`).
- **[LOW] sync.ts:286-291 — `SyncResult.itemsUpserted` counts only base upserts**, understating variant work.
- **[LOW] sync.ts:82-100 — `backfillItemSlugs` O(16k) per-row UPDATEs at every boot**; bootstrap failures logged-and-continued (silent broken start).
- **[LOW] collectionsRepo.ts:14-21 + sync.ts:59-69 — seeding enable-loop not transactional**; mid-loop throw leaves partial defaults that won't re-seed.

## 2. Identity & translation layers

- **[MED] rapService.ts:329-331 — detail lookup falls back from requested variant to base item silently**, cached under the variant's key for 1h. Consumers get base stats labeled as the variant.
- **[MED] rapService.ts:53-59, 202-217 — `parseItemKey` is collection-blind and rejects unknown flags.** Bare-name keys are ambiguous across collections; any flag other than `golden|rainbow|shiny` → hard 404; names containing `:` break the split.
- **[MED] slug.ts:70-73 + itemsRepo.ts:92-121 — slug collisions between variant words in names and real variants** ("Golden Dog" the item vs golden variant of "Dog"). No uniqueness constraint on slug.
- **[LOW] itemKey.ts vs slug.ts vs parseItemKey — three parallel encodings of the same variant tuple** (`:golden:shiny` / `Shiny-Golden-slug` / `{pt,shiny}`), literals duplicated in ≥3 modules; a new dimension touches all plus `parseVariantSlug`.
- **[LOW] collectionSpecs.ts:84 — `usedFallback` wrong for every unspecced collection** (`!undefined === true` even when DEFAULT_NAME_KEYS matched) — spams the mismatch warning every healthy sync.
- **[LOW] listings.ts:190, 261 — `COALESCE(l.item_key, i.name)` denormalizes a derivable value** and masks drift after renames.
