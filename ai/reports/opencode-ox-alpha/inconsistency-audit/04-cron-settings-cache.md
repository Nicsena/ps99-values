# 04 · Cron, Settings, Cache & Repo Semantics — findings from the services lens (§4–7) + storage cache findings

## 1. Cron service

- **[MED] CronService.ts:57-85 — TOCTOU double-start race in `startJob`.** `handles.has(name)` is checked before several `await getSetting(...)` calls; two concurrent invocations both pass and register two schedulers for the same job — doubled firing frequency until restart. `handles.set` happens last.
- **[MED] CronService + repo-wide grep — enable/disable and schedule settings have no runtime effect; control surface is dead code.** `stopJob`/`startJob` (post-startup)/`listJobs`/`isRunning` are called only by tests; `setSetting`/`deleteSetting` never called from any route. Changing `cron.jobs.sync.enabled` or `.schedule` in the DB does nothing until restart; there is no way to disable a job without restarting.
- **[MED] config.ts:8,25 + settings.ts:11-13 + jobs/*.ts:7 — three drifting sources of truth for schedules.** `SYNC_CRON` env (parsed, never read), `DEFAULT_SETTINGS['cron.jobs.sync.schedule']`, and `syncJob.defaultSchedule` all independently state the schedule (currently agreeing at `'0 */1 * * *'`; prune `'30 3 * * *'`). Editing one silently does nothing. Note: the local `.env` override value `"0/30 * * * *"` fails `node-cron validate()` — inert only because the knob is dead.
- **[LOW] index.ts:15-19 — shutdown never stops cron tasks.** SIGTERM closes HTTP only; an imminent tick can start a full sync inside the 5s grace window (better-sqlite3 writes are synchronous).
- **[LOW] sync.ts:104-105 + CronService.ts:80 — intentional disable logs as hourly ERROR.** `sync.enabled=false` → runSync throws → cron wrapper logs `[cron] job sync failed:` every hour.
- **[LOW] CronService.ts:76-81 — overlapping ticks possible for slow jobs.** Only `syncAll`'s promise guard protects sync; `pruneSnapshots` has no in-flight guard.

## 2. Snapshot repo / SQL semantics

- **[MED] snapshotsRepo.ts:35-42, 51-58 (+ listings CTEs) — latest-value query relies on the bare-column + HAVING-MAX idiom with tie ambiguity.** With guaranteed same-`now` ties (variant collapse), "current" values feeding the dedupe map and listings are nondeterministic. The `ROW_NUMBER()` fix exists in `HOUR_EXISTS_CTE` but isn't applied here.
- **[MED] snapshotsRepo.ts:121-127 — retention pruning can delete an item's ONLY/latest snapshot.** Pure age-based, no keep-latest clause: dormant/delisted items vanish from listings (LEFT JOIN finds nothing) and re-baseline history when they return.
- **[LOW] listings.ts:16-23, 207-220 — `existsPerHour` mixes clocks** (anchor via DB `unixepoch()-3600`, denominator via JS `Date.now()`) **and has an arbitrary 600s gate** silently nulling rates when the last pre-hour snapshot is <10 min old. Negative rates emitted unclamped.
- **[LOW] snapshotsRepo.ts:121-126 — prune DELETE lacks a `captured_at` index** (EQP: full SCAN; 49k/174k rows).

## 3. Settings service

- **[MED] settings.ts:47-60 — `getSetting` swallows all errors and conflates them with "unset".** DB failure → `null` → fail-open callers (`sync.enabled` disabled only on `=== false`; cron `!== false`) proceed on infrastructure errors. Corrupt JSON silently becomes default (deserialize catch → null). `Number(raw)` can yield `NaN` cast to `T`.
- **[LOW] settings.ts:62-79, 7 — protected flag is a dead feature with asymmetric upsert** (nothing ever passes `protected: true`; the conflict branch omits it). `serialize(value,'boolean')` stringifies any truthy value to `'true'`. `'sync.lastSyncAt': null` default is meaningless (indistinguishable from "never synced"); the key is write-only in practice.

## 4. Cache layer

- **[MED] cache/index.ts:61-86 — `cacheDel`/`cacheDelPrefix` exported, zero call sites: no invalidation anywhere.** After every sync, `rap:list:*` (900s), `v3:items:*` (900s), `v3:search:*` (300s), and `v4:detail:*` (**3600s** — equal to the sync interval) serve pre-sync data.
- **[MED] cache/index.ts:5, 17, 27 — sticky `unavailable` latch with no recovery path.** Any single `'error'` event disables caching for the process lifetime; `retryStrategy: () => null` prevents reconnects; `warned` never resets. One transient blip during a deploy permanently degrades to DB-only.
- **[LOW] rapService.ts:184, 534, 584 — inconsistent key versioning (`rap:list:` unprefixed vs `v3:`/`v4:`) and unbounded user input in keys.**
