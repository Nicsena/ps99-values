# Pet Simulator 99 Values - AGENTS.md

## Project Overview

**Pet Simulator 99 Values** is a web application for tracking market data from the Roblox game Pet Simulator 99, developed by BIG Games.

The application retrieves item, RAP (Recent Average Price), and exist-count data from the public BIG Games Pet Simulator 99 API located at `https://ps99.biggamesapi.io/`. It tracks item RAP and exists counts on an hourly basis for enabled collections and stores the data locally in a database. It also maintains historical market data so that RAP and exists counts can be viewed over time.

## Stack

The application is built using Node.js and TypeScript. It uses Express 5 with EJS for server-side rendered pages. SQLite is used as the local database through Drizzle ORM with `better-sqlite3`. Drizzle Kit is used for database schema management and migrations, while Drizzle Studio is used to inspect the database through a web-based UI. Redis is used for caching data with `ioredis`, with the database serving as the persistent source of truth. Zod is used for runtime validation and application configuration. Dotenv is used for environment variable configuration, and node-cron is used for scheduled synchronization and maintenance jobs. The project uses Vitest for testing, ESLint for linting, and Prettier for code formatting. `rimraf` is used to clean build output. 

## Project History

The application was originally created using AI during the OpenCode OX Alpha free week, which runs from August 20, 2026 through August 26, 2026. AI continues to be used extensively throughout development during the free week, with manual changes also being made as needed.

Development after the free week may be significantly slower or may stop, depending on whether continued AI-assisted development is available. If development continues without AI assistance, changes may need to be made manually.

## Current Development State

The codebase is in an inconsistent, transitional state. Multiple refactors/redesigns across many parts of the application are planned.

A deep, from-scratch audit of the codebase was performed against commit `66f3c57` (Aug 23, 2026); reports live in `ai/reports/inconsistency-audit/` (index: `README.md`). **Consult these reports when planning or performing work**, especially when modifying sync, database/query, search, API, or slug functionality.

## Config / environment

- All env vars are validated in `src/config.ts` via a Zod schema. The parsed result is frozen and imported as `config`.

- New env vars must be added to the Zod schema **and** `.env.example`.

- Current vars: `PORT`, `DB_PATH`, `REDIS_URL`, `SYNC_CRON`, `CACHE_DISABLED`, `LOG_LEVEL`, `LOG_FORMAT`.

## Logging

The application provides a leveled, namespaced logger at `src/logger.ts`. The default log level is `info`, controlled by the `LOG_LEVEL` env var (`silent | debug | info | warn | error | exception`). The `DEBUG=sync,cron` env var gates `debug` output to listed namespaces (only active when `LOG_LEVEL` is unset or `debug`). The `LOG_FORMAT` env var selects output style: `text` (default, `[time] [ns] msg`), `json` (one JSON object per line with `ts`/`level`/`ns`/`msg` and an `err` field for `Error` instances), or `pretty` (chalk-colored `[time] [level] [ns] msg`, opt-in colors). Timestamps are ISO-8601 by default and honor the `TZ` env var; when `TZ` is unset, UTC `Z` is used. The timestamp can also be customized programmatically via `createLogger({ formatTimestamp })`; a small `formats` helper ships common formatters (`iso`, `isoUtc`, `epoch`, `none`, `local`). When `formatTimestamp` is set, it takes over and `TZ` is ignored for that logger. The level can be changed at runtime via `log.setLevel(level)` and queried via `log.isLevelEnabled(level)`; both throw on unknown level names. Children created before a parent's `setLevel` call are not affected; children created after see the new level. Two timing helpers are available: `log.timer(label, level?)` returns a `done()` closure that logs `"<label> finished in <N>ms"`, and `log.timerFn(label, fn, level?)` wraps an async or sync function, logs the success duration, and on error logs `"<label> failed after <N>ms"` and rethrows. `LOG_LEVEL` and `LOG_FORMAT` are also declared in `src/config.ts`'s Zod schema and `.env.example`; the logger reads the env directly, while the schema exists to document and validate the supported values.

All production `console.*` call sites under `src/` (excluding `src/test/`, which is excluded from build/typecheck) were migrated to `createLogger`. Per-module namespaces are created at module top-level and chained with `child()` where appropriate: `app`, `routes.api`, `cache`, `sync`, `sync.catalog`, `sync.ingest`, `sync.matching`, `sync.retry`, `cron`, `cron.jobs.sync`, `cron.jobs.prune`. The remaining direct `console.*` calls are bootstrap-only — the three `console.warn` warnings inside `src/logger.ts`'s `resolveConfig()` (unknown `LOG_LEVEL` / `LOG_FORMAT` / `TZ`) and the `console.error` in `src/config.ts` for invalid env — all of which fire before the logger is constructed.

## Project Structure

Note: The current structure may be different later in development or during refactors/redesigns and may not always reflect the newest changes.

```md
├── src/
│   ├── index.ts          # entry point: initApp → listen → cron start
│   ├── app.ts            # express wiring: schema bootstrap, routes, error handler
│   ├── config.ts         # Zod-validated env config (frozen)
│   ├── routes/           # pages.ts (EJS), api.ts (JSON under /api)
│   ├── services/
│   │   ├── biggames.ts   # BIG Games API client
│   │   ├── sync.ts       # ingest + first-run bootstrap
│   │   ├── rapService.ts # RAP data access
│   │   ├── settings.ts   # app_settings read/write
│   │   ├── itemKey.ts    # variant key build/parse
│   │   ├── collectionSpecs.ts
│   │   └── cron/         # CronService + jobs/*.job.ts
│   ├── db/
│   │   ├── schema.ts     # Drizzle table definitions + inferred types
│   │   ├── client.ts     # sqlite connection + ensureSchema() DDL/migrations
│   │   ├── appSettingsSchema.ts
│   │   └── queries/      # itemsRepo, collectionsRepo, snapshotsRepo, settingsRepo, listings
│   ├── cache/index.ts    # optional Redis cache (fail-open)
│   └── test/             # (deprecated) one-off scripts; see scripts/ at repo root
├── views/                # EJS templates
├── public/               # static assets: css/, img/, js/ (plain browser JS)
├── data/                  # SQLite database and application data
├── ai/
│   ├── reports/           # generated audits, investigations, and development reports
│   └── plans/             # development and refactoring plans
├── scripts/              # one-off manual scripts (run with `npx tsx scripts/<name>.ts`)
│   └── old/              # dormant scripts, may be consulted for reference
└── tests/                 # Vitest automated tests
```

## Database

The application uses SQLite as its persistent database, with WAL mode and foreign-key enforcement enabled. The database path is configured through `DB_PATH` and the database is created automatically when needed.

The database schema is currently in a transitional state and is planned to be redesigned again as part of the broader refactor. The current schema, database queries, and consumers of the data should not automatically be treated as the final data model.

The existing database implementation contains legacy schema handling and migration logic from previous schema changes. Consult the inconsistency audit reports in `ai/reports/inconsistency-audit/` before modifying the schema or related database code.

The intended database schema and data model will be documented here after the planned database refactor is established.

## Data and Architecture Principles

- The BIG Games Pet Simulator 99 API is the upstream source for item, RAP, and exists data.
- SQLite is the persistent source of truth for application data.
- Redis is a cache only and must never be treated as persistent storage.
- Historical market data must remain associated with the correct canonical item and variant identity.
- Data shared between synchronization, database queries, search, server-rendered pages, and JSON API routes should have a clearly defined canonical representation.
- Avoid maintaining multiple representations of the same data unless there is a clear architectural reason.
- When changing a shared data representation, identify and update all producers and consumers.
- Do not solve inconsistencies between layers by adding another transformation or compatibility layer unless the compatibility requirement is intentional.

## Commands

| Task | Command |
| --- | --- |
| Dev server | `npm run dev` |
| Build / run | `npm run build`, `npm start` |
| Clean build output | `npm run clean` |
| Generate migrations | `npm run db:generate` |
| Apply migrations | `npm run db:migrate` |
| Push schema changes | `npm run db:push` |
| Open Drizzle Studio | `npm run db:studio` |
| Tests | `npm test` / `npm run test:watch` |
| Lint | `npm run lint` / `npm run lint:fix` |
| Format | `npm run format` |
| Typecheck | `npm run typecheck` |

Run the relevant typecheck, lint, and tests after making changes. Before considering a change complete, verify that the project builds and the affected tests pass.

- `db:generate` generates Drizzle migration files from schema changes.
- `db:migrate` applies generated migrations to the database.
- `db:push` directly synchronizes the current Drizzle schema with the database without generating migration files. Use this intentionally during development or schema redesigns; do not substitute it for migrations when a migration history is required.
- `db:studio` opens Drizzle Studio for inspecting the database through a web-based UI.

## Testing

The project uses Vitest for automated testing. Automated tests are located under `tests/` and use the `*.test.ts` naming convention. Existing tests cover areas including `itemKey`, `cron`, `sync`, `slug`, `settings`, `config`, and `rapService`.

One-off manual scripts live at the repo root under `scripts/`:
- `scripts/` (top level) — modern one-off helpers. Currently: `reseed.ts` (wipe and rebuild the local database) and `sri.ts` (compute SRI hashes for CDN URLs).
- `scripts/old/` — dormant scripts that are not currently in use but may be consulted for reference.

All scripts in `scripts/` are run with `npx tsx scripts/<name>.ts` (or `npx tsx scripts/old/<name>.ts`). They are not part of the TypeScript program, the build, the lint, or the Vitest suite.

## Frontend

The application uses server-side rendered EJS templates in `views/` with shared `header.ejs` and `footer.ejs` partials.

Client-side JavaScript in `public/js/` uses plain browser JavaScript without a frontend framework or bundler. Shared client-side functionality is provided through JavaScript files in `public/js/`. Chart.js 4 is loaded from a CDN for charts on item detail pages.

The frontend uses a hand-written stylesheet at `public/css/style.css`. There is currently no CSS framework or CSS preprocessor.

The frontend contains known inconsistencies, particularly around slug handling and item detail resolution. Slug handling currently has known correctness issues: the frontend and backend contain separate slug implementations, and `splitDetailSlug()` can contribute to slug hijacking where certain crafted or conflicting slugs cause the item detail page to display the wrong item.

**Do not assume the current slug parsing or resolution behavior is correct. Consult the inconsistency audit before modifying slug-related code.**

### Accepted Quirks

The following are known and currently accepted behaviors. Do not change them silently as part of unrelated work:

- `/reports` route
- Hourly synchronization cadence
- Unauthenticated sync trigger

## Development Guidelines

- Read relevant existing code before making changes.
- Consult `ai/reports/inconsistency-audit/README.md` and the relevant audit reports before modifying areas identified by the audit.
- Do not assume existing implementations represent the final architecture when working on areas planned for refactoring.
- Prefer fixing underlying data/model inconsistencies rather than adding compatibility logic around inconsistent implementations.
- Keep changes focused on the requested task and avoid unrelated refactors unless they are necessary.
- Do not introduce new frameworks, libraries, or architectural patterns without a clear reason.
- Do not assume AI-generated or existing code is correct simply because it is already present. Verify behavior against the intended requirements, surrounding code, tests, database schema, and relevant audit reports.
- During the current transition, do not assume `src/db/schema.ts`, migration files, startup schema logic, and the actual SQLite database are all synchronized.
- Before changing database structures, inspect the current schema, migrations, queries, and consumers together.
- The planned database redesign should establish a clear canonical schema and migration strategy rather than continuing to add compatibility layers indefinitely.

## Refactoring Guidelines

The project is undergoing substantial refactoring. When refactoring an existing subsystem, identify its current dependencies and consumers before changing its interfaces or data structures.

When multiple implementations represent the same data differently, establish the intended canonical representation before attempting to synchronize them.

Do not preserve known inconsistencies merely because existing code depends on them. If compatibility is required, explicitly identify the compatibility requirement before implementing it.

## Comment Guidelines

- Use comments when they provide useful context that is not obvious from the code, such as explaining non-obvious behavior, compatibility requirements, workarounds, or important design decisions.
- Avoid comments that merely restate what the code already clearly does.
- Keep comments accurate when modifying the code; remove or update comments that become outdated.

## Other Guidelines

- Don't commit secrets, `.env`, or the SQLite database file.
- `ai/reports/` holds generated audit/report artifacts. These reports are documentation and historical evidence, not dead code. Do not delete or rewrite existing reports simply because the code changes. When new audits are performed, create new detailed reports rather than modifying historical findings. Reports that are no longer useful for active reference may be moved to `.local/ai/old-reports`.
- `ai/reports/` is intentionally committed to the repository to preserve development and audit history, even though the repository may grow as a result.
- `ai/plans/` contains plans and design documents for planned or ongoing refactors and other development work. Consult relevant plans before working on areas covered by them, but verify that the plans are still applicable to the current codebase.
- When an audit report identifies a known inconsistency, do not assume the inconsistency should be preserved. Treat the report as evidence of the current or historical state unless the report explicitly defines a required behavior.
- When changing a data structure, schema, identifier, or response shape, search the codebase for all consumers before making the change.
- When a change affects multiple layers, update all affected consumers rather than leaving different parts of the application with incompatible representations.
- Preserve existing functionality unless a change is explicitly requested or required by the work being performed.
- Prefer simple, straightforward, and maintainable solutions. Avoid unnecessary abstractions, indirection, complexity, or over-engineering, especially when a simpler implementation is sufficient.
- Favor readability and ease of maintenance over clever or overly abstract implementations.
- Remove obsolete code when it is made unnecessary by a refactor rather than keeping duplicate implementations without a clear compatibility requirement.
- Validate external input and data received from upstream APIs before using it.
