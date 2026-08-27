# From-Scratch Inconsistency Audit — Index

Generated 2026-08-23 · commit `66f3c57` · 4 independent read-only audit lenses, no prior conclusions supplied. All numbers measured against `data/ps99.db` (49,059 rap_snapshots · 174,745 exists_snapshots · 16,311 items · 15 enabled collections) or verified in source/git. Exclusions honored per owner: `/reports` route (temporary), `src/test/enabled_collections.ts` (intentional), `./.local`, `.DS_Store`, hourly cadence, per-instance DB conventions, `src/test` build/lint exclusions.

## Severity totals

| Lens | File | High | Med | Low | Total |
|---|---|---|---|---|---|
| Storage & queries | [01-storage-query.md](01-storage-query.md) | 5 | 15 | 11 | 31 |
| Sync, ingest & identity | [02-sync-ingest.md](02-sync-ingest.md) | — | — | — | (merged below) |
| Read logic & stats | [03-read-logic-stats.md](03-read-logic-stats.md) | 1 | 5 | 3 | 9 |
| Cron, settings & cache | [04-cron-settings-cache.md](04-cron-settings-cache.md) | — | — | — | (merged below) |
| HTTP API surface | [05-http-api.md](05-http-api.md) | 1 | 5 | 3 | 9 |
| Frontend contracts | [06-frontend-ui.md](06-frontend-ui.md) | 3 | 9 | 8 | 20 |
| Config, git & tooling | [07-config-tooling-git.md](07-config-tooling-git.md) | 3 | 8 | 8 | 19 |

Lens 2 (sync/ingest/read/cron/settings, 40 findings: 3 high / 20 med / 17 low) is split across files 02–04. Lens 1 cache findings are in file 04.

## The 20 worst (ranked by combined damage)

1. **13,221 same-timestamp tie groups with conflicting values** — "latest price" is arbitrary everywhere. Measured live. Manufactured by sync's shared `now` + the chroma/tier variant collapse. (01, 02)
2. **Chroma (`cv=1..6`)/tier (`tn`)/`vr` upstream dimensions received and discarded** — no storage slot, key component, or slug token exists; collapse is by design. (02)
3. **Exists JOIN pt/shiny predicate hides exists data for 2,569 non-regular variants** (measured: 2,696 items have exists-but-no-RAP). (01)
4. **Foreign keys never enforced** (`PRAGMA foreign_keys=0`) + `migrateItemsTable` can `DROP TABLE items`, orphaning all snapshot rows. (01)
5. **ath/atl/high1m/low1m computed over ≤200 points (~8 days) but labeled all-time/monthly** in API + UI. (03)
6. **Line/area charts render raw epoch-millisecond x-axis labels** site-wide (date callback only exists in the bar branch). (06)
7. **Dual slugifiers over one URL namespace** — punctuation/accent names 404 or fuzzy-resolve to the wrong item; 23 duplicate slugs resolved by unordered `LIMIT 1`. (01, 06)
8. **Variant-prefix-first URL parsing hijacks 30 live "Golden/Rainbow/Shiny …"-named items.** (01)
9. **Variant-chip/tile regex can never match current URLs** (trailing slash + lowercase) — dead feature on every detail page. (06)
10. **API errors return HTML**; three different 404/500 experiences. (05)
11. **Cross-collection name fan-out** misattributes values (14 live colliding names: Coins ×3, Diamonds ×3, Banana ×2…). (02)
12. **`totalLatestExists` is not a cross-variant total** — verified 0 items have >1 snapshot group per item_id; "Total Exists" duplicates single-variant exists; donut shares compute 100%/0. (01)
13. **Cache invalidation never wired** — `cacheDel`/`cacheDelPrefix` zero callers; stale up to 1h after syncs; sticky Redis kill-switch. (04)
14. **Partial ingest failures advance `lastSyncAt` and report success**; one malformed upstream entry discards a whole feed; unmatched entries dropped silently. (02)
15. **Age-only pruning can delete an item's only/latest snapshot** — dormant items vanish and re-baseline. (04)
16. **24h RAP % stamped onto 1M High/Low, ATH, and ATL stat cells.** (06)
17. **Filter-change race + infinite-scroll death after one error** (no AbortController; observer never re-attached). (06)
18. **Unauthenticated full-sync endpoint + silent-failure Refresh button.** (05, 06)
19. **Zero route-test coverage** — the twice-regressed homepage class is unguarded; 63 tests exercise services/db only. (07)
20. **Dead-contract cluster** — `hidden` unread, `tier` dead, `item_key` duplicate identity, `SYNC_CRON` knob + invalid local override + test pin, `cacheDel*` uncalled, CronService admin surface unwired, `lastSyncAt` write-only. (multiple)

## Cross-cutting themes

1. **The write path and the read path disagree about what an item is.** Ingest flattens upstream reality (drops cv/tn/vr, collapses variants, matches by bare name across collections) and stamps shared timestamps; reads reconstruct "latest" with a tie-ambiguous idiom and derive variant identity from COALESCEd snapshot columns instead of the authoritative item row.
2. **Labels exceed computation.** ath/atl over ≤200 points; 30D/90D buttons over ~8-day data; a "total" that isn't; a count heading over a 200-row table; tracked/volatility constants; "Updated" captions on the wrong clock.
3. **Built-then-abandoned surfaces.** Cache invalidation helpers, CronService admin API (tested, unrouted), drizzle-kit, detailPath/resolveIcon, home.ejs vs index.ejs, dead CSS generations, the tier column.
4. **The toolchain gates the wrong things.** 63 green tests, zero touching a route; src/test excluded from typecheck but linted by accident; tests/ and root configs never typechecked.

## Suggested fix order

1. Per-entry timestamps + unique index on `(item_id,pt,shiny,captured_at)` — kills the tie class at the source.
2. `ROW_NUMBER()` latest CTEs — deterministic reads.
3. Drop pt/shiny terms from the exists join — un-hides 2,569 variants.
4. Chroma/tier storage decision — stops active corruption.
5. One slugify, shipped through the API and used client-side — ends the 404/wrong-item class.
6. ath/atl relabeled or computed over true windows; totalExists aggregated over (collection,name).
7. Route smoke tests + JSON-aware error handler.
8. README/AGENTS.md so this list stops regenerating.
