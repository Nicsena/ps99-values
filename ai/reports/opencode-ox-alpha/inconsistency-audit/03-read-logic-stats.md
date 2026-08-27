# 03 · Read Logic & Stats — findings from the services lens (§3)

Lens: rapService read assembly, stats computation, list/search, caching.

- **[HIGH] rapService.ts:284-289 + snapshotsRepo.ts:67-95 (LIMIT 200) — `ath`/`atl`/`high1m`/`low1m` are computed over at most the last 200 points, not their named windows.** 200 rows ≈ 8 days at hourly cadence (less for fast movers, since change-only snapshots inflate row counts). These fields are exposed as "All-Time High/Low" and "1M High/Low" in the API and rendered as truth on the detail page. Materially wrong for any item older than ~8 days.
- **[MED] rapService.ts + cache/index.ts — cache never invalidated after sync.** `cacheDel`/`cacheDelPrefix` (cache/index.ts:61-86) have zero call sites. After each hourly sync: list caches (900s), search (300s), and detail caches (**3600s**) keep serving pre-sync data — detail staleness can equal the entire sync interval. The Refresh button appears broken.
- **[MED] rapService.ts:310, 313 — `tracked: 0` and `volatility30d: 0` are hardcoded stubs served as real statistics**, rendered with explanatory tooltips on the detail page ("30D Rap Volatility: 0").
- **[MED] rapService.ts:184, 534, 584 — inconsistent cache-key versioning and unbounded key cardinality.** Legacy list uses unprefixed `rap:list:` while others use `v3:`/`v4:` (schema bumps can't invalidate the legacy family); search/list keys embed raw user `q`/`search` strings unnormalized → pollutable key space.
- **[MED] itemsRepo.ts:41-51 + listings.ts:172-270 — neither list path filters disabled collections.** Items from disabled collections remain listed/searchable/counted, contradicting ingest-side `enabled = true` gating.
- **[MED] rapService.ts:173-180, 494 — search matches `name` only; `displayName` is never searched.** Variant rows prepend "Golden"/"Rainbow" and spec-driven names diverge from ids — users typing the friendly display name get "No matches" while the name renders in results.
- **[LOW] rapService.ts:226-249 — 24h window edge semantics.** Baseline uses strict `< cutoffMs`, extremes use `>=`; a sample exactly 24h old is eligible as high/low but never as baseline. Delisted items (newest snapshot >24h old) get "24h change" computed between two stale points instead of null.
- **[LOW] rapService.ts:567-609 — `searchItems` double-caches** (inner `listItemsFiltered` cache + own `v3:search:` cache) and re-clamps the limit already clamped in the route.
- **[LOW] rapService.ts:160 — dead mapping:** `rap: row.rap === null ? null : row.rap`.
- **[verified OK]** `pctChange` and merged-history pct guard divide-by-zero (`baseline/prevRap !== 0`, rapService.ts:143, 251-254); `rapPerCopy` rejects `exists <= 0` (306-309); `marketCap` null-safe.
