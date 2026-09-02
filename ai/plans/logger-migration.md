# Plan: Migrate application code to `src/logger.ts`

**Status:** Completed. All per-site changes, tests, docs, and verification have landed. See "Summary" at the bottom for the final state.

## Goal

Replace every non-test `console.*` call in `src/` with the existing leveled/namespaced
logger at `src/logger.ts:1`, so all production output goes through one configurable
pipeline (level via `LOG_LEVEL`, format via `LOG_FORMAT`, namespace filtering via
`DEBUG`). Tests under `src/test/` keep their `console.*` calls (already excluded
from build/typecheck per AGENTS.md). No behavior change for the default config.

## Decisions (resolved with user)

- Migrate all application code `console.*` sites to `createLogger` (this PR is the
  follow-up referenced by the "intentionally not migrated" note in AGENTS.md).
- Use finer-grained namespaces: `app`, `routes.api`, `sync`, `sync.catalog`,
  `sync.ingest`, `sync.matching`, `sync.retry`, `cron`, `cron.jobs.sync`,
  `cron.jobs.prune`, `cache`.
- Leave `src/logger.ts:42,50,77` bootstrap warnings as direct `console.warn` —
  they fire before the logger config is resolved. Document with a brief comment.
- Add `LOG_LEVEL` and `LOG_FORMAT` to the Zod schema in `src/config.ts` and to
  `.env.example`.

## Files to change

| File | Current `console.*` sites | Namespace |
| --- | --- | --- |
| `src/app.ts` | `app.ts:41` | `app` |
| `src/index.ts` | `index.ts:9, 16, 26` | `app` |
| `src/config.ts` | `config.ts:16` | see below |
| `src/routes/api.ts` | `api.ts:106` | `routes.api` |
| `src/cache/index.ts` | `cache/index.ts:10, 12, 18` | `cache` |
| `src/services/cron/CronService.ts` | `CronService.ts:72, 79, 80, 83, 92` | `cron` |
| `src/services/cron/jobs/sync.job.ts` | `sync.job.ts:10` | `cron.jobs.sync` |
| `src/services/cron/jobs/prune.job.ts` | `prune.job.ts:10` | `cron.jobs.prune` |
| `src/services/sync/index.ts` | `index.ts:30, 41` | `sync` |
| `src/services/sync/runner.ts` | `runner.ts:36` | `sync` |
| `src/services/sync/catalog.ts` | `catalog.ts:147, 150, 198, 362` | `sync.catalog` |
| `src/services/sync/ingest.ts` | `ingest.ts:123, 133, 248, 253` | `sync.ingest` |
| `src/services/sync/matching.ts` | `matching.ts:127, 150` | `sync.matching` |
| `src/services/sync/retry.ts` | `retry.ts:20` | `sync.retry` |
| `src/config.ts` (Zod schema) | — | add `LOG_LEVEL`, `LOG_FORMAT` |
| `.env.example` | — | add the same two vars |
| `AGENTS.md` | — | update Logging section to reflect schema + coverage |

## Mapping rules

Each module gets its own logger instance created at module top-level (no per-call
construction). Child namespaces come from `parent.child('sub')` so the full
namespace is `cron.jobs.sync` etc.

Level conversions:

- `console.error(err, ...)` for a caught/rethrown exception → `log.error(err, ...context)`.
- `console.error(msg, err)` style catches → `log.error(err, msg)` so the structured
  `err` field carries the stack in json mode (matches `tests/logger.test.ts:218`).
- `console.warn(...)` → `log.warn(...)`.
- `console.log(...)` → `log.info(...)` (matches the default `info` level).
- `console.log("REDIS CACHE IS ENABLED")` → `log.info('Redis cache is enabled')` /
  same for disabled. The banner is fired once at import; keep it as `info`.
- Existing prefixes like `[sync] …`, `[cron] …` are dropped from message bodies;
  the namespace tag replaces them (`[sync.ingest] …` is emitted automatically by
  the logger).

Bootstrap exceptions: `src/logger.ts:42, 50, 77` (`console.warn('[logger] unknown
LOG_LEVEL …')` etc.) stay as direct `console.warn` because they fire before the
logger config can be resolved. Document in a comment.

## Per-site changes

### `src/services/cron/CronService.ts`

- `CronService.ts:72` `invalid schedule` → `log.error('invalid schedule', expression, 'for job', name, 'not starting')`.
- `CronService.ts:79` `${name} completed` → `log.info(name, 'completed')`.
- `CronService.ts:80` `job ${name} failed` → `log.error(err, 'job', name, 'failed')`
  so the error is structured.
- `CronService.ts:83` `started ${name} (${expression})` → `log.info('started', name, '(', expression, ')')`.
- `CronService.ts:92` `stopped ${name}` → `log.info('stopped', name)`.

### `src/services/sync/*`

- `services/sync/index.ts:30` `bootstrap failed` → `sync.error(err, 'bootstrap failed')`.
- `services/sync/index.ts:41` `snapshot pruning failed` → `sync.error(err, 'snapshot pruning failed')`.
- `services/sync/runner.ts:36` `collection seeding failed` → `sync.error(err, 'collection seeding failed')`.
- `services/sync/catalog.ts:147` `${name}: skipped ${feed.invalid} malformed catalog entries`
  → `sync.catalog.warn(name, 'skipped', feed.invalid, 'malformed catalog entries')`.
- `services/sync/catalog.ts:150` `failed to fetch collection ${name}`
  → `sync.catalog.error(err, 'failed to fetch collection', name)`.
- `services/sync/catalog.ts:198` `no name key matched for "${entry.configName}", used configName`
  → `sync.catalog.warn(name, 'no name key matched for', entry.configName, 'used configName')`.
- `services/sync/catalog.ts:362` `failed to upsert catalog for ${catalog.collection}`
  → `sync.catalog.error(err, 'failed to upsert catalog for', catalog.collection)`.
- `services/sync/ingest.ts:123` `failed to fetch ${metric} data`
  → `sync.ingest.error(err, 'failed to fetch', metric, 'data')`.
- `services/sync/ingest.ts:133` `${metric}: skipped ${feed.invalid} malformed feed entries`
  → `sync.ingest.warn(metric, 'skipped', feed.invalid, 'malformed feed entries')`.
- `services/sync/ingest.ts:248/253` matcher-count warnings
  → `sync.ingest.warn(metric, matcher.warnings().unmatchedEntries, 'feed entries matched no known item and were skipped')`
  and the ambiguous-names variant.
- `services/sync/matching.ts:127, 150` ambiguity/suffixed warnings
  → `sync.matching.warn(...)` (logger captured at module top, used by closure).
- `services/sync/retry.ts:20` `attempt ${attempt}/${attempts} failed, retrying`
  → `sync.retry.warn('attempt', attempt, '/', attempts, 'failed, retrying:', err)`.

### `src/services/cron/jobs/*`

- `sync.job.ts:10` → `cron.jobs.sync.info('sync done: collections=', result.collections, 'items=', result.itemsUpserted, 'snapshots=', result.snapshotsInserted)`.
- `prune.job.ts:10` → `cron.jobs.prune.info('pruned', pruned, 'snapshots')`.

### `src/cache/index.ts`

- `cache/index.ts:10` "REDIS CACHE IS ENABLED" → `cache.info('Redis cache is enabled')`.
- `cache/index.ts:12` "REDIS CACHE IS DISABLED" → `cache.info('Redis cache is disabled')`.
- `cache/index.ts:18` warn-once → `cache.warn('Redis unavailable, serving from DB')`.

### `src/app.ts` / `src/index.ts` / `src/config.ts` / `src/routes/api.ts`

- `app.ts:41` unhandled error in EJS pipeline → `app.error(err, 'unhandled error')`.
- `index.ts:9` `listening on …` → `app.info(...)`.
- `index.ts:16` `Received ${signal}` → `app.info('Received', signal)`.
- `index.ts:26` fatal startup → `app.error(err, 'Fatal startup error')`.
- `config.ts:16` invalid env → keep as `console.error` (fires before the logger
  can be constructed; pattern matches `src/logger.ts:42,50,77`). Add a short
  comment.
- `routes/api.ts:106` unhandled error → `routes.api.error(err, 'unhandled error')`.

## `config.ts` + `.env.example` additions

```ts
LOG_LEVEL: z.enum(['silent', 'debug', 'info', 'warn', 'error', 'exception']).default('info'),
LOG_FORMAT: z.enum(['text', 'json', 'pretty']).default('text'),
```

`config` gains `logLevel` / `logFormat`. `src/logger.ts` continues to read env
directly (already does), so this is purely for documentation and validation.
Keeping the logger independent avoids a circular import (`logger.ts` is imported
by `app.ts` after `config.ts` is frozen).

`.env.example` gets:
```
LOG_LEVEL=info
LOG_FORMAT=text
```

## Behavior preserved

- `LOG_LEVEL=warn` (current default is `info`) silences `info`; nothing else changes.
- `LOG_FORMAT=json` switches structured output without code changes
  (covered by `tests/logger.test.ts:218`).
- `DEBUG=sync,cron` gates debug-level output to those namespaces; no code changes
  because the module-level loggers pass their namespace through.

## Tests

- `tests/cron.test.ts` does not assert on `console.*` output — no changes needed.
- `tests/logger.test.ts` is unaffected.
- Inspect `tests/namespace-sync.test.ts` and `tests/sync.test.ts` for any
  `console.*` assertions and adjust if they reference the old `[sync] …` text.

Add `tests/log-namespace.test.ts` that spies on `console.log/warn/error` and
asserts a representative call from each migrated module shows the expected
namespace tag (`sync.ingest`, `cron.jobs.sync`, etc.). Pattern from
`tests/logger.test.ts:23`.

## Verification

1. `npm run lint`
2. `npm run typecheck`
3. `npm test`
4. `npm run build`
5. Manual smoke: `npm run dev`, hit `/api/refresh`, confirm output reads
   `[time] [app] listening on http://localhost:3000` then
   `[time] [cron.jobs.sync] sync done: …` with the old `[sync] …` / `[cron] …`
   prefixes gone from message bodies (the namespace tag replaces them).

## Out of scope

- New log destinations (file/remote sinks) — existing logger writes to
  `console.log/warn/error` only.
- Migration of `src/test/*.ts` scripts — excluded from build/typecheck and not
  part of the runtime.
- Changes to log level/format semantics in `src/logger.ts` itself.
- The `src/logger.ts:42, 50, 77` bootstrap warnings — kept as `console.warn`
  because they fire before the logger exists; documented in a brief comment.

## Summary

Implemented as planned. All production `console.*` call sites under `src/` (excluding `src/test/`, which is excluded from build/typecheck per AGENTS.md) were migrated to `createLogger` with the per-module namespaces listed above. `LOG_LEVEL` and `LOG_FORMAT` were added to the Zod schema in `src/config.ts` and to `.env.example`.

### Files migrated (16)

- `src/app.ts`, `src/index.ts` → `app`
- `src/routes/api.ts` → `routes.api`
- `src/cache/index.ts` → `cache`
- `src/services/cron/CronService.ts` → `cron`
- `src/services/cron/jobs/sync.job.ts` → `cron.jobs.sync`
- `src/services/cron/jobs/prune.job.ts` → `cron.jobs.prune`
- `src/services/sync/index.ts`, `src/services/sync/runner.ts` → `sync`
- `src/services/sync/catalog.ts` → `sync.catalog`
- `src/services/sync/ingest.ts` → `sync.ingest`
- `src/services/sync/matching.ts` → `sync.matching`
- `src/services/sync/retry.ts` → `sync.retry`

### Remaining bootstrap-only `console.*` (documented in code)

- `src/logger.ts:45,54,82` — `parseLevel` / `parseFormat` / `resolveTimezone` warnings (fire before the logger is constructed).
- `src/config.ts:21` — invalid-env `console.error` (fires before the logger is constructed).

### Config / docs

- `src/config.ts` — added `LOG_LEVEL` and `LOG_FORMAT` to the Zod schema; `config` exposes `logLevel` and `logFormat`.
- `.env.example` — added `LOG_LEVEL=info` and `LOG_FORMAT=text`.
- `AGENTS.md` — updated the Logging section to list the new env vars, the namespace layout, and the remaining bootstrap-only `console.*` sites.

### Tests

- New `tests/log-namespace.test.ts` — 9 tests, one per migrated namespace, asserting the expected `[namespace] message` line and (for error logs) the structured `err` field carries the stack.
- No existing tests required updates; neither `tests/sync.test.ts` nor `tests/namespace-sync.test.ts` assert on `console.*` output.

### Verification (all green)

- `npm run typecheck`
- `npm run lint`
- `npm test` — 12 files, 179 tests passing
- `npm run build`

### Out of scope (unchanged)

- New log destinations (file/remote sinks) — the logger still writes to `console.log/warn/error` only.
- `src/test/*.ts` scripts — left as `console.*` (excluded from build/typecheck and not part of the runtime).
- Changes to log level/format semantics in `src/logger.ts` itself.
