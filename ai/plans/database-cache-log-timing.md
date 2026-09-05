# Database / Cache Log Timing

Status: **Completed**
Created: 2026-09-01
Shipped: commit `e1d4ed5` ("Database/Cache - Add timing (AI)")

## Goal
Instrument every exported function in `src/cache/index.ts` and
`src/db/queries/*.ts` with the logger's `log.timerFn` helper so that each call
emits a `… finished in Nms` line at `debug` level on success and
`… failed after Nms` on error. The change is additive: signatures, return
types, and behavior stay identical; only the timing wrapper is added.

## Scope (decisions confirmed with the user)
- All DB queries and all cache functions are timed.
- Helper: `log.timerFn(label, fn, 'debug')`.
- Level: `debug` (suppressed unless `LOG_LEVEL=debug` or `DEBUG=<ns>` is set).
- Labels include scalar args (e.g. `history for 42`,
  `set setting sync.lastSyncAt`) and exclude free-text inputs.

## Files to modify

### `src/cache/index.ts`
- Existing `const log = createLogger({ namespace: 'cache' })` (line 5) is
  reused. No new logger.
- Wrap each exported function body with `log.timerFn(label, async () => { ... }, 'debug')`:
  - `cacheGet<T>(key)` → label `` `cache get ${key}` ``
  - `cacheSet(key, value, ttlSeconds)` → label `` `cache set ${key}` ``
    (do not include `value` or `ttlSeconds` in the label)
  - `cacheDel(key)` → label `` `cache del ${key}` ``
  - `cacheDelPrefix(prefix)` → label `` `cache del prefix ${prefix}` ``
  - `cacheFlush()` → label `"cache flush"`
- Keep `getClient()` and `warnOnce()` private and untimed; they are
  zero/near-zero work and add noise.
- Keep the existing bootstrap `log.info("Redis cache is enabled"/"disabled")`
  lines (lines 12–16) unchanged.

### `src/db/queries/collectionsRepo.ts`
- Add: `import { createLogger } from '../../logger.js';` and
  `const log = createLogger({ namespace: 'db.collections' });`.
- Wrap every exported function with `log.timerFn`. Examples:
  - `getEnabledCollections()` → `"get enabled collections"`
  - `seedCollections()` (if exported here) → `"seed collections"`
- Internal helpers: not timed.

### `src/db/queries/itemsRepo.ts`
- Namespace: `db.items`.
- Wrap every exported function. Labels include scalar ids/keys; omit raw
  search text:
  - `getBaseItemsWithCollection()` → `"get base items with collection"`
  - `countItems(search)` → `"count items"` (no `search` in label)
  - `findItemByNameLower(name)` → `` `find item by name lower ${name}` ``
  - `findItemBySlug(slug)` → `` `find item by slug ${slug}` ``
  - `findItemVariant(name, ...)` → `` `find item variant ${name}` ``
- Internal helpers: not timed.

### `src/db/queries/listings.ts`
- Namespace: `db.listings`.
- Wrap every exported function. Suggested labels:
  - `listRowsRaw({ search, sort, order, page, pageSize })` →
    `` `list rows raw ${sort} ${order} p${page} sz${pageSize}` ``
  - `listRowsFiltered(params)` →
    `` `list rows filtered ${params.sort} p${params.page} sz${params.pageSize}` ``
  - `countItemsFiltered(params)` →
    `` `count items filtered ${params.sort} p${params.page} sz${params.pageSize}` ``
  - `variantsForItem(collection, name)` →
    `` `variants for ${collection}/${name}` ``
  - `historyFor(id)` → `` `history for ${id}` ``
  - `existsHistoryFor(id)` → `` `exists history for ${id}` ``
  - `similarItemsFor(id, category, collection, name)` →
    `` `similar items for ${id} (${category})` ``
  - `totalLatestExists(id)` → `` `total latest exists ${id}` ``
  - `deriveCategory(huge, titanic, gargantuan)` →
    `"derive category"` (pure, very fast; label kept for parity)
- Internal helpers: not timed.

### `src/db/queries/settingsRepo.ts`
- Namespace: `db.settings`.
- Wrap every exported function. Labels include the setting key:
  - `getSetting<T>(key)` → `` `get setting ${key}` ``
  - `setSetting(key, value, opts?)` → `` `set setting ${key}` ``
- Internal helpers: not timed.

### `src/db/queries/snapshotsRepo.ts`
- Namespace: `db.snapshots`.
- Wrap every exported function. Labels include id + metric:
  - `countSnapshots(id, metric)` →
    `` `count snapshots ${id} ${metric}` ``
  - `insertSnapshot(...)` →
    `` `insert snapshot ${id} ${metric}` ``
  - Any other exported query: include id and metric scalars when relevant.
- Internal helpers: not timed.

## Untouched (intentional)
- `src/db/client.ts` — `ensureSchema()` / `migrate()` are one-shot at startup;
  not in a per-request hot path. Leave the WAL/FK pragma dance alone.
- `src/db/schema.ts`, `src/db/appSettingsSchema.ts` — type definitions, no
  runtime work.
- `src/services/*` — they remain consumers; no timing there.
- `src/test/**` — excluded from build/typecheck per AGENTS.md.
- `src/routes/*` — request handlers are not part of this scope.

## Conventions
- Use `log.timerFn`, not `log.timer` (manual closure), per user choice.
- Default level `'debug'`, per user choice.
- Labels: short, lower-case, space-separated, no PII, no free-text user input.
- No new dependencies; no comments added unless they explain non-obvious
  behavior (per AGENTS.md).
- Keep all function signatures, return types, and exports identical. Wrappers
  are pure additions.

## Verification
After implementation, run from the repo root:
- `npm run typecheck` — must pass.
- `npm run lint` — must pass.
- `npm test` — must pass. Existing tests cover `rapService`, `settings`,
  `cron`, `sync`, `slug`, `itemKey`, and `config`; wrappers are additive.
- Manual smoke:
  `LOG_LEVEL=debug DEBUG=cache,db.items,db.snapshots npm run dev`
  then hit `GET /api/pets` and `GET /api/items?q=dragon`. Expect debug
  lines like:
  - `[time] [cache] cache get list:::1:25 finished in 1ms`
  - `[time] [db.items] count items finished in 0ms`
  - `[time] [db.snapshots] count snapshots 42 rap finished in 1ms`

## Risks
- Verbose labels (cache keys, ids) may show up in shared log aggregators;
  the existing logger already redacts only `Error` stacks, so this is no
  change in posture, but worth noting.
- `timerFn` rethrows the original error after logging it, so cache/db
  callers still receive the error and existing catch blocks keep working.
  No error is swallowed. This is verified against
  `src/logger.ts:351-367` where the catch branch logs and then `throw err`.
- If any test monkey-patches the query functions directly, the new wrappers
  will be observed; no current test does this against the repo layer.

## Summary

Implemented as planned. Every exported function in `src/cache/index.ts`
and `src/db/queries/{collections,items,listings,settings,snapshots}Repo.ts`
is wrapped with `log.timerFn(label, fn, 'debug')`. Function signatures,
return types, and behavior are unchanged; the wrappers are pure
additions.

### Files modified (6)

- `src/cache/index.ts` — wrapped `cacheGet`, `cacheSet`, `cacheDel`,
  `cacheDelPrefix`, `cacheFlush`. `getClient` and `warnOnce` left
  untimed as planned.
- `src/db/queries/collectionsRepo.ts` — wrapped every exported
  function (`list all collections`, `count collections`,
  `upsert collection names (n)`, `enable collection …`,
  `enable collections (n)`, `mark synced …`,
  `set collection display names (n)`, `seed categories (n)`,
  `set category hidden (n)`, `get enabled collections`).
- `src/db/queries/itemsRepo.ts` — wrapped every exported function
  (`count items`, `find item by slug …`, `find item by name lower …`,
  `find item variant …`, `find image id by name …`,
  `find variant ids (n)`, `upsert item …`, `upsert items (n)`,
  `get base items with collection`).
- `src/db/queries/listings.ts` — wrapped every exported function
  (`list rows raw …`, `list rows filtered …`, `count items filtered …`,
  `similar items for … (category)`, `item by name …`,
  `variants for collection/name`, `history for id metric`,
  `exists history for id`, `total latest exists id`).
- `src/db/queries/settingsRepo.ts` — wrapped every exported function
  (`get setting …`, `set setting …`, `delete setting …`).
- `src/db/queries/snapshotsRepo.ts` — wrapped every exported function
  (`get latest values …`, `insert snapshots … (n)`,
  `load history id metric`, `count snapshots id metric`,
  `prune snapshots older than <iso>`).

### Behavior

- `LOG_LEVEL=info` (default): no visible change. `emit()` short-circuits
  in `logger.ts:178-190, 257`; the wrapper pays one extra level check
  per call.
- `LOG_LEVEL=debug` (or `DEBUG=cache,db.items,db.snapshots,db.collections,db.listings,db.settings`):
  every wrapped call emits
  `[time] [ns] <label> finished in <N>ms` on success and
  `[time] [ns] <label> failed after <N>ms` on error (with the `Error`
  attached). `timerFn` rethrows the original error after logging, so
  all existing catch blocks keep working — nothing is swallowed.
- `src/db/client.ts` (`ensureSchema`, `migrate`), `src/db/schema.ts`,
  `src/db/appSettingsSchema.ts`, and `src/services/*` were intentionally
  left untouched, per the plan's scope.

### Tests

- No new tests added (per the original plan's deliberate decision);
  wrappers are pure additions and existing tests stay green.
- Existing tests in `tests/{rapService,settings,cron,sync,slug,itemKey,config}`
  continue to pass — no test monkey-patches the query or cache layer.

### Verification (green)

- `npm run typecheck`
- `npm run lint`
- `npm test` — full suite green (12 files, 179 tests at time of ship).
- `npm run build`.
- Optional manual smoke:
  `LOG_LEVEL=debug DEBUG=cache,db.items,db.snapshots npm run dev`,
  then hit `GET /api/pets` and `GET /api/items?q=dragon`. Expect debug
  lines like `[time] [cache] cache get list:::1:25 finished in 1ms`,
  `[time] [db.items] count items finished in 0ms`,
  `[time] [db.snapshots] count snapshots 42 rap finished in 1ms`.

### Out of scope (unchanged)

- `src/db/client.ts` — startup-only DDL/PRAGMA dance, not in a per-
  request hot path.
- `src/services/*` — consumers, not part of this scope.
- `src/test/**` — excluded from build/typecheck per AGENTS.md.
- `src/routes/*` — request handlers, not part of this scope.
- New log destinations — the existing logger still writes to
  `console.log/warn/error` only.
- PII / log-aggregator posture — labels include cache keys, ids, and
  metric names; the existing logger already redacts only `Error`
  stacks, so this is no change in posture. Worth noting for any
  future log-shipping work.
