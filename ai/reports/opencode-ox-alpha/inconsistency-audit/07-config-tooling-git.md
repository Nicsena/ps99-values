# 07 · Config, Tooling, Tests & Repo — 19 findings (3 high / 8 med / 8 low)

Lens: configuration reality, build gates, session archaeology, orphans, docs, tests. Verified against the working tree, live DB, and git history.

## 1. Config surface

- **[HIGH] .env:3 — local `SYNC_CRON="0/30 * * * *"` is an invalid node-cron v4 expression.** Verified: `validate('0/30 * * * *') === false` (`'0 */1 * * *'` validates true). Inert today because nothing consumes `config.syncCron` — but the moment anyone wires it into a scheduler, CronService logs and silently refuses to start the sync job (CronService.ts:71-74). Fix the value or delete the line.
- **[HIGH] .env.example:4 + config.ts:8,25 + tests/config.test.ts:9 — `SYNC_CRON` is a dead knob contradicting the real scheduling layer.** Defined, defaulted, documented in the example, and pinned by a test — yet `grep -rn syncCron src tests` hits only definition sites. The actual schedule comes from `syncJob.defaultSchedule` (sync.job.ts:7) overridden only by the `app_settings` row `cron.jobs.sync.schedule` (CronService.ts:68-69). An operator setting `SYNC_CRON=0 0 * * 5` sees zero effect — a three-layer contradiction (env → config → settings DB).
- **[MED] sync.ts:42-57 vs live DB vs src/test/enabled_collections.ts — enabled-collection lists disagree across three layers.** Live DB: **15** enabled including `Enchants`; both `DEFAULT_ENABLED_COLLECTIONS` (14) and the src/test list (14) omit it. A fresh bootstrap silently produces a 14-collection instance different from production, and `Enchants`' enablement exists only as an untracked DB row (`git log -S Enchants` shows no source change).
- **[MED] live app_settings vs code defaults — nothing persisted.** `SELECT name,value,type FROM app_settings` returns exactly one row (`sync.lastSyncAt`). All cron knobs fall through to code defaults; "what the DB says" and "what DEFAULT_SETTINGS says" can silently diverge the moment one row is written.
- **[MED] sync.ts:103-106 + CronService.ts:65-66 — two overlapping kill-switch generations.** `sync.enabled` (throws inside runSync) vs `cron.jobs.sync.enabled` (checked at startJob). Disabling via `sync.enabled` leaves the job scheduled to throw every hour instead of not starting — surfaced as recurring cron ERROR logs.
- **[LOW] settings.ts:11-13 vs jobs/*.ts:7 — schedule defaults duplicated as dual sources of truth** (currently agreeing; CronService prefers the settings row, so editing the job default alone does nothing).
- **[LOW] sync.ts:284 — `sync.lastSyncAt` stored with `type:'json'` although it is an ISO string** (live DB confirms the quoted-string form). Round-trips, but the declared type misrepresents the payload.
- **[LOW] config.ts:7 — `REDIS_URL` accepts any non-empty string** (no URL validation); `.env` uses `127.0.0.1` vs `.env.example`'s `localhost` (cosmetic drift).
- **[verified OK]** Every `process.env` read flows through config.ts; `PORT`/`DB_PATH`/`REDIS_URL` all consumed; all cron expressions that are actually consumed validate; hourly cadence identical across config.ts, sync.job.ts, settings.ts, .env.example.

## 2. Build / typecheck / lint

- **[MED] tsconfig.json:14-15 — `npm run typecheck` covers only `src` minus `src/test`.** `tests/` (908 lines), `vitest.config.ts`, `drizzle.config.ts`, `eslint.config.js` are never typechecked by any gate; ESLint covers them, producing linted-but-not-typed code.
- **[MED] tsconfig.json:15 vs eslint.config.js:8 — `src/test` exclusion applied inconsistently.** tsconfig excludes it; eslint's `ignores` (`dist, node_modules, data, .local`) does not mention it — verified `npx eslint src/test/enabled_collections.ts` lints the file (passes today only because the scripts happen to be clean). One sloppy script breaks `npm run lint` despite the tsconfig exclusion suggesting otherwise.
- **[MED] drizzle.config.ts + package.json:35 — drizzle-kit installed/configured, never invoked.** No `./drizzle` dir, no generate/migrate scripts; schema reality is `ensureSchema()` raw DDL. The config also points only at `schema.ts`, which lacks `app_settings` — even if run, it would generate a schema that drops the settings table.
- **[LOW] cache/index.ts:61-86 — `cacheDel`/`cacheDelPrefix` dead exports** (see also: invalidation was never wired after syncs).
- **[verified OK]** `tsc --noEmit` clean; `eslint .` clean; no stale `dist/` inside the repo (moved outside); no dead runtime deps; no conflicting `@types` (`@types/node-cron` correctly removed in 37ab0df — node-cron v4 ships its own types).

## 3. Session archaeology

- **[HIGH] working tree (uncommitted) — deletion of `views/index.ejs` + `.gitignore` simplification left dangling.** `git status`: index.ejs (74 lines, orphaned since `/` was rerouted) deleted, 6-line gitignore cleanup pending. A careless checkout loses the cleanup or resurrects the dead template. Neither change is committed.
- **[MED] ref `refs/t3/checkpoints/…/turn/45` (commit 3f01afb) — unreachable foreign-author checkpoint commit** re-adding the entire tree, visible in `git log --all` as a phantom parallel history.
- **[MED] commits 295a262 ("Frontend: More Changes?") and 873a60f ("Prompt:") — large unexplained changes** (charts/slugs UI, schema work) with zero descriptive messages; the `(AI)`/`(No AI)` suffix convention appears only in later commits and is inconsistently applied. Bisect/blame archaeology is guesswork — the direct enabler of lost changes.
- **[verified OK]** No revert/contradiction commit pairs currently in history; `enabled_collections` move left no duplicate copies; branch synced with origin/main apart from the two uncommitted changes.

## 4. Orphans & exposure

- **[MED] data/reports/read-time-projection.html + spec-driven-items-rap-exists.html (git-tracked) — stale internal experiment reports, publicly served.** Outputs of the *old* pipeline (a0d8345 era); current src/test/04/05 write to `./.local/reports`, never `data/reports`. Yet they remain tracked and are served verbatim by the `/reports` static mount — frozen, unregenerable-from-repo-state QA output presented as if current. (The `/reports` route itself is intentional/temporary per owner — the *tracked stale content* is the finding.)
- **[LOW] views/index.ejs at HEAD — tracked-but-unreferenced view** (orphaned; the deletion exists only uncommitted).
- **[verified OK]** `.DS_Store` untracked and ignored everywhere; `public/thumbnails*`, `*.db*`, `.env`, `.local/`, `local/` all correctly ignored (`git check-ignore` verified per-path); `.env` contains no secrets; no other unreferenced files (slugify, ejs, ioredis, all repos, all views except index.ejs are reachable).

## 5. Docs vs reality

- **[HIGH] README.md:1-6 — six lines total documents none of the operational model.** Missing: setup steps, `.env` variables and semantics (including the misleading dead `SYNC_CRON`), npm scripts (`typecheck`/`lint`/`dev` vs `start` implying a dist build), the entire DB-backed settings control plane (`cron.enabled`, `cron.jobs.*.schedule/enabled`, `snapshot.retentionDays` — discoverable only by reading DEFAULT_SETTINGS), the fact that DB rows override code defaults, and the src/test offline-analysis workflow requiring `.local/game/collection-*.json` inputs. For a system whose primary control plane is a SQLite table with no UI, this is the documentation.
- **[LOW] No AGENTS.md/conventions file exists.** A minimal one ("homepage is home.ejs; schedules live in app_settings not env; enabled collections are DB rows; reports are throwaway") would have prevented the pages.ts re-revert and the SYNC_CRON confusion — the single highest-leverage fix for session drift.
- **[LOW] Enabled-collection management convention undocumented** — three competing definitions with no note on which is authoritative (in practice: direct DB edits, since Enchants proves it).

## 6. Tests vs production

- **[HIGH] tests/ (whole dir) — zero route coverage.** No test imports `pagesRouter` or `apiRouter`; all 63 passing tests exercise services/db only. The exact homepage-crash bug class is unguarded — a 10-line smoke test ("GET / returns 200") would have caught it before commit.
- **[MED] tests/cron.test.ts:95-129 — 40+ lines pin the CronService lifecycle API (`listJobs`/`startJob`/`stopJob`) that no production route consumes** — tested-but-unwired admin surface (or dead-weight assurance for a feature that doesn't exist yet).
- **[LOW] tests/config.test.ts:9 — pins the dead `SYNC_CRON` default**, cementing the illusion that the env var controls syncing.
- **[LOW] tests/rapService.test.ts:6 — inconsistent DB_PATH setup pattern** (module top-level vs others' beforeAll dynamic-import) — both work only because client.ts reads config at module evaluation; the ordering hazard is non-obvious.
- **[LOW] tests/rapService.test.ts:254 — asserts cross-pt `totalLatestExists` behavior that is impossible under the variant-per-row schema** (each item_id maps to exactly one (pt,shiny) group) — the test and the schema disagree, and the schema won silently.
- **[LOW] tests/{cron,sync,settings,rapService}.test.ts — temp-DB bootstrap ritual triplicated/quadruplicated** (tmpdir path + env + dynamic import + WAL/shm teardown). A shared `withTempDb()` helper would remove ~60 lines and one independent-rot risk per file.
- **[verified OK]** `npx vitest run` → 7 files, 63/63 passing; tmpdir SQLite isolation with WAL/shm teardown uniform; sync tests cover seeding, dedup-on-unchanged, retention fallback; slug/itemKey round-trip properties well covered; `vi.mock` of biggames prevents network access in CI.

## Severity summary

| Severity | Count |
|---|---|
| High | 3 |
| Medium | 8 |
| Low | 8 |
| **Total** | **19** |

## Top 10 by confusion cost

1. **[HIGH]** `SYNC_CRON` dead knob — documented, defaulted, validated, tested, and completely unused; local override value invalid besides.
2. **[HIGH]** README omits the entire settings-DB control plane that actually governs the app.
3. **[HIGH]** Uncommitted `views/index.ejs` deletion + `.gitignore` edit dangling in the working tree.
4. **[MED]** 15-vs-14 enabled-collections divergence (live DB vs both source lists; Enchants untraceable).
5. **[MED]** drizzle-kit configured but never used; hand-rolled DDL duplicating schema.ts; app_settings invisible to it.
6. **[MED]** `src/test` excluded from tsconfig but not eslint — inconsistent exclusion of intentional scripts.
7. **[MED]** `tests/` and root configs outside the typecheck gate entirely.
8. **[MED]** Stale tracked `data/reports/*.html` publicly served via the intentional `/reports` route.
9. **[MED]** Tested-but-unreachable CronService/settings admin surface (no routes consume it).
10. **[MED]** Phantom T3 checkpoint commit in `--all` history + "Prompt:"/"More Changes?" commit messages.
