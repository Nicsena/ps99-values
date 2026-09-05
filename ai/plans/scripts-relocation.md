# Scripts Relocation Plan

Status: **Completed**
Created: 2026-09-04
Shipped: 2026-09-04 (uncommitted)

## Goal

Move the 11 one-off scripts currently under `src/test/` to a top-level `scripts/` directory at the repo root. The current location's name (`src/test/`) is misleading: the directory has never been part of the Vitest suite (which reads from `tests/` at the repo root), and a new contributor reading the directory name reasonably assumes the files are tests.

## Background

`src/test/` accumulated two distinct kinds of files over the project's life:

1. **Investigation scripts (9 files).** Numbered `00-fetch-*`, `01-spec-driven-sync`, `02-auto-detect-namekey`, `03-variant-keys`, `04-read-time-projection`, `05-spec-driven-items-rap-exists`. These are prototypes and probes from the sync-rewrite work. They are not currently in use but may be consulted for reference in the future. (`enabled_collections.ts` is a data file that traveled with the same investigation; it has no consumer outside the research scripts.)

2. **Modern one-offs (2 files).** `reseed.ts` and `sri.ts`. Written in this session, both used recently.

The `src/test/` directory was never wired into Vitest. The tsconfig exclude (`tsconfig.json:15`) and the AGENTS.md note are the only things keeping these files out of the build pipeline.

### What the investigation scripts are about

The numbered scripts are a research log from the **sync-rewrite work** — the work that produced commit `cf06c8f` ("Sync service rewrite", 2026-08-25) and the related `ai/plans/opencode-ox-alpha/sync-rewrite.md` plan. They are not tests; they are early prototypes that probed the upstream API and shaped the design before the production code was committed. Each step in the log corresponds to a phase of the design:

- **`00-fetch-collections.ts`, `00-fetch-rap.ts`, `00-fetch-exists.ts`** (step 0, fetch). Pull the upstream `ps99.biggamesapi.io` endpoints and write the raw responses to `.local/game/`. The first "what does the upstream actually look like?" probe — done before any parsing or storage work, to see the shape of the data the production code would have to consume. Useful for re-validating the upstream contract.
- **`01-spec-driven-sync.ts`** (step 1, spec-driven prototype). Define what the parsed feed should look like and write the matching upsert. The first attempt at structured variant storage; predates the variant-per-row schema in `src/db/schema.ts:25-73`.
- **`02-auto-detect-namekey.ts`** (step 2, name-key auto-detect). Probe the per-collection upstream payloads to figure out which `nameKeys` each collection actually uses. The result became the `SPECS` map at `src/services/collectionSpecs.ts:163-167` — Pets uses `name`, Eggs uses `name`, Rebirths uses `indexDesc`, everything else falls back to the `DEFAULT_NAME_KEYS` chain (`['DisplayName', 'Name', 'name', 'Title']`).
- **`03-variant-keys.ts`** (step 3, variant keys). Build the variant-key grammar that became `src/services/itemKey.ts`. Tests the "Name[:golden|rainbow][:shiny]" string encoding end-to-end.
- **`04-read-time-projection.ts`** (step 4, read-time projection). Read-time tests for the stats/history math (24h change, 1m window extremes, market cap, etc.) — the math that landed in `src/services/rapService.ts:294-337` (`computeStats`) and `tests/rapService.test.ts:119-183`.
- **`05-spec-driven-items-rap-exists.ts`** (step 5, full spec). End-to-end spec-driven version of the items + rap + exists pipeline. The last prototype before `src/services/sync/` got rewritten for real in commit `cf06c8f`.
- **`enabled_collections.ts`** (data file, not a script). `export default [...]` with the working list of enabled collections during the prototyping phase. Superseded by `DEFAULT_ENABLED_COLLECTIONS` in `src/services/sync/catalog.ts:34-51`; the file is kept as a reference for what the upstream actually has, so future curation decisions can be compared against the historical starting point.

Together the nine files form a numbered research log: read them in order to see how the sync-rewrite team (you + the AI) arrived at the production design. Skim them individually to see one specific decision's reasoning. The current production code is at `src/services/sync/{catalog,ingest,matching,retry,runner,index}.ts`; the prototype files here are the path that led to it.

## Target layout

```
scripts/
├── old/                                   # dormant investigation scripts (may be consulted)
│   ├── 00-fetch-collections.ts
│   ├── 00-fetch-rap.ts
│   ├── 00-fetch-exists.ts
│   ├── 01-spec-driven-sync.ts
│   ├── 02-auto-detect-namekey.ts
│   ├── 03-variant-keys.ts
│   ├── 04-read-time-projection.ts
│   ├── 05-spec-driven-items-rap-exists.ts
│   └── enabled_collections.ts
├── reseed.ts                              # modern: wipe + rebuild DB
└── sri.ts                                 # modern: SRI hash generator
```

`src/test/` is removed.

## Decisions

- **Subdirectory name `old/` over `research/`.** "research" implied frozen historical evidence; the user clarified the scripts are dormant but available, not archived. "old" is shorter and doesn't make a claim about why the scripts aren't in use.
- **`enabled_collections.ts` moves with the investigation scripts.** It has no consumer outside `src/test/`; the only reason to keep it is its provenance. Moving it preserves that history. The data is also captured in `src/services/sync/catalog.ts:34-51` as `DEFAULT_ENABLED_COLLECTIONS`, so the file is safe to keep as a reference.
- **Empty `src/test/` is removed.** No `.gitkeep`. If a future contributor needs a `src/test/` directory, they can create it; the empty directory has no purpose.
- **No content changes** to any of the 11 files. The move is purely a directory relocation. `git mv` preserves history.
- **No package.json change.** Scripts are run with `npx tsx scripts/<name>.ts`. No new script entry.
- **No new `tsconfig.json` exclude for `scripts/`.** The `scripts/` directory was never in the include list, so it was never typechecked or built. The move doesn't change that. The existing `src/test/**` exclude becomes unnecessary and is dropped.

## Mechanics

11 `git mv` operations:

```
src/test/00-fetch-collections.ts             →  scripts/old/00-fetch-collections.ts
src/test/00-fetch-rap.ts                     →  scripts/old/00-fetch-rap.ts
src/test/00-fetch-exists.ts                  →  scripts/old/00-fetch-exists.ts
src/test/01-spec-driven-sync.ts              →  scripts/old/01-spec-driven-sync.ts
src/test/02-auto-detect-namekey.ts           →  scripts/old/02-auto-detect-namekey.ts
src/test/03-variant-keys.ts                  →  scripts/old/03-variant-keys.ts
src/test/04-read-time-projection.ts          →  scripts/old/04-read-time-projection.ts
src/test/05-spec-driven-items-rap-exists.ts  →  scripts/old/05-spec-driven-items-rap-exists.ts
src/test/enabled_collections.ts              →  scripts/old/enabled_collections.ts
src/test/reseed.ts                           →  scripts/reseed.ts
src/test/sri.ts                              →  scripts/sri.ts
```

After the moves, `src/test/` is empty. `rmdir` (or `Remove-Item` on PowerShell) removes the empty directory.

`tsconfig.json:15` changes from:
```json
"exclude": ["node_modules", "dist", "src/test/**"]
```
to:
```json
"exclude": ["node_modules", "dist"]
```

The `src/test/` line under the "Project Structure" block (`AGENTS.md:63`) is updated to show the new layout. The Testing section (`AGENTS.md:117-121`) is updated. The "Accepted Quirks" line at `AGENTS.md:141` ("`src/test/` exclusions") is removed because the quirk no longer applies.

## Verification

After the move:

1. `git status` shows 11 renames plus 2 modifications (AGENTS.md, tsconfig.json). No content diffs in the moved files.
2. `npm run typecheck && npm run lint && npm test` — all green. None of the moved files were ever in the TypeScript program, so the build pipeline is unaffected.
3. `npx tsx scripts/sri.ts --help` — prints the help text. Same behavior as before the move.
4. `npx tsx scripts/reseed.ts` — wipes `data/ps99.db` (and WAL) and re-runs the full sync. Same behavior as before the move.
5. `npx tsx scripts/old/00-fetch-collections.ts` — fetches the upstream collection list and writes to `.local/game/`. Same behavior as before the move (dormant scripts are still runnable; the directory name doesn't disable them).

## Out of scope (intentional)

- No content edits to any of the 11 files.
- No new scripts.
- No commit / no push.
- No CI / pipeline changes.
- No rename of `scripts/old/` to a stronger "do not edit" name. The convention is documented in AGENTS.md; enforcement is by convention.
- No `.gitkeep` for `src/test/`. The empty directory is removed.
- No `package.json` entries for the scripts. They are run with `npx tsx scripts/<name>.ts`.

## Risks

- **Empty `src/test/` removal**. I check the directory is empty before `rmdir`. If anything is left over (a stray file, a `.gitkeep`), the move wasn't exhaustive and I should re-grep. Standard safety.
- **`enabled_collections.ts` placement**. Per the decisions above. If you'd rather put it elsewhere (e.g. a new `data/` directory for misc data files), the plan can be adjusted before execution.
- **AGENTS.md wording**. The proposed wording is below in this document; I'll show it to you before applying in case you want to tighten or rewrite.

## Proposed AGENTS.md wording

Replace the current `## Testing` block (lines 117–121) with:

> ## Testing
>
> The project uses Vitest for automated testing. Automated tests are located under `tests/` and use the `*.test.ts` naming convention. Existing tests cover areas including `itemKey`, `cron`, `sync`, `slug`, `settings`, `config`, and `rapService`.
>
> One-off manual scripts live at the repo root under `scripts/`:
> - `scripts/` (top level) — modern one-off helpers. Currently: `reseed.ts` (wipe and rebuild the local database) and `sri.ts` (compute SRI hashes for CDN URLs).
> - `scripts/old/` — dormant scripts that are not currently in use but may be consulted for reference.
>
> All scripts in `scripts/` are run with `npx tsx scripts/<name>.ts` (or `npx tsx scripts/old/<name>.ts`). They are not part of the TypeScript program, the build, the lint, or the Vitest suite.

And remove the `## Frontend` line `- `src/test/` exclusions` (line 141) from the "Accepted Quirks" list — the quirk no longer applies.

## Open questions

1. AGENTS.md wording — trust the draft above, or want a specific line?
2. Anything left in `src/test/` I should be aware of (hidden files, `.gitkeep`, a stray file)?
3. Confirm `scripts/old/` as the name.

Plan is final once those are answered. Ready to apply when you exit plan mode.

## Summary

Implemented and verified. The 11 one-off scripts that lived under `src/test/` (a directory whose name was misleading — it has never been part of the Vitest suite) have been moved to a top-level `scripts/` directory at the repo root. The `src/test/` directory is gone.

### Files modified (14 total)

- **9 `git mv` renames** (history preserved, no content change):
  - `src/test/00-fetch-collections.ts` → `scripts/old/00-fetch-collections.ts`
  - `src/test/00-fetch-rap.ts` → `scripts/old/00-fetch-rap.ts`
  - `src/test/00-fetch-exists.ts` → `scripts/old/00-fetch-exists.ts`
  - `src/test/01-spec-driven-sync.ts` → `scripts/old/01-spec-driven-sync.ts`
  - `src/test/02-auto-detect-namekey.ts` → `scripts/old/02-auto-detect-namekey.ts`
  - `src/test/03-variant-keys.ts` → `scripts/old/03-variant-keys.ts`
  - `src/test/04-read-time-projection.ts` → `scripts/old/04-read-time-projection.ts`
  - `src/test/05-spec-driven-items-rap-exists.ts` → `scripts/old/05-spec-driven-items-rap-exists.ts`
  - `src/test/enabled_collections.ts` → `scripts/old/enabled_collections.ts`
- **2 new files** (untracked at the time, so no rename was possible):
  - `scripts/reseed.ts`
  - `scripts/sri.ts`
- **`src/test/`** — removed (empty after the moves).
- **`tsconfig.json:15`** — `exclude` no longer contains `"src/test/**"`. New: `["node_modules", "dist"]`.
- **`AGENTS.md`** — three updates:
  - Project Structure block (line 63): the `src/test/` line is replaced with a `scripts/` block listing `scripts/`, `scripts/old/`, `reseed.ts`, `sri.ts`.
  - Testing section (lines 117–121): rewritten to describe the new convention (modern helpers in `scripts/`, dormant scripts in `scripts/old/`, run with `npx tsx scripts/<name>.ts`).
  - Accepted Quirks (line 141): the "`src/test/` exclusions" line is removed — the quirk no longer applies.
- **`scripts/sri.ts`** — in-place edit. The help text and the top-of-file comment referenced the old path `src/test/sri.ts`; updated to `scripts/sri.ts`. 5 occurrences total.
- **`ai/plans/scripts-relocation.md`** — this plan file.

### Behavior

- **Production build is unaffected.** None of the moved files were ever in the TypeScript program; `npm run typecheck`, `npm run lint`, and `npm test` all stay green.
- **Scripts are still runnable from their new paths.** `npx tsx scripts/sri.ts --help` works; `npx tsx scripts/reseed.ts` works; `npx tsx scripts/old/00-fetch-collections.ts` still works (the dormant scripts remain runnable; the directory name does not disable them).
- **Empty `src/test/` is removed.** No `.gitkeep`; if a future contributor needs a `src/test/` directory, they can create it.
- **AGENTS.md now accurately documents the layout.** A new contributor reading AGENTS.md will know that `scripts/` is the home for one-off manual scripts and that `scripts/old/` is the home for dormant ones.

### Verification (green)

- `npm run typecheck` — clean.
- `npm run lint` — clean.
- `npm test` — 12 files, 179 tests pass.
- `npx tsx scripts/sri.ts --help` — prints the corrected help text (referencing `scripts/sri.ts`, not the old path).
- `git status --porcelain` after the move shows 9 `R` renames, 2 `A` new-files, 4 `M` modifications (AGENTS.md, tsconfig.json, scripts/sri.ts, plus pre-existing in-flight edits from prior work), and 1 untracked file (this plan).
- Pre-flight `Get-ChildItem -LiteralPath src\test -Force` showed exactly 11 files, no hidden state.

### Out of scope (unchanged from the original "Out of scope" list)

- No commit / no push. Per AGENTS.md and your workflow.
- No CI / pipeline changes.
- No new `package.json` entries.
- No rename of `scripts/old/` to a stronger "do not edit" name. The convention is documented in AGENTS.md; enforcement is by convention.
- The two new files (`reseed.ts`, `sri.ts`) are the only new content in `scripts/`. The 9 historical files and the data file are the only new content in `scripts/old/`. Nothing else was created.

## Follow-up: `sri.ts` --save-dir default and --no-save flag

After the relocation, `scripts/sri.ts` was enhanced to support keeping the downloaded file at a known location. Originally the download buffer was discarded after hashing; the new default saves it under `./scripts/downloads/` (gitignored), and `--no-save` opts out.

### Files modified (this follow-up)

- `scripts/sri.ts`:
  - New `--save-dir <path>` flag overrides the default save location.
  - New `--no-save` flag discards the buffer after hashing (matches the pre-follow-up behavior).
  - Default `saveDir` is now `resolve('./scripts/downloads')`. The directory is created with `mkdirSync({ recursive: true })` on first use.
  - `printBlock` accepts an optional `savedTo` argument; when present, a `# saved: <path>` line is added to the block (between `# bytes:` and the SRI hashes).
  - Filenames are derived from the URL via `deriveFilename(url)`: the `https://`/`http://` prefix is dropped, `/` becomes `-`, `@` becomes `@@`, so the result is portable across Windows / macOS / Linux. Examples:
    - `https://unpkg.com/lucide@1.41.0/dist/umd/lucide.min.js` → `unpkg.com-lucide@@1.41.0-dist-umd-lucide.min.js`
    - `https://cdn.jsdelivr.net/npm/chart.js@4.5.1/dist/chart.umd.js` → `cdn.jsdelivr.net-npm-chart.js@@4.5.1-dist-chart.umd.js`
  - Local file inputs are not affected by either flag — the input is already a file path; nothing to "save" or "discard."
  - Help text and the top-of-file comment were updated to describe the new default and flags.

- `eslint.config.js`:
  - Added `scripts/downloads/**` to the `ignores` list. Without this, ESLint tried to parse the downloaded `lucide.min.js` (a minified bundle) and hit a "Maximum call stack size exceeded" parser error. The `.gitignore` already excludes the directory; the eslint-config exclude is the matching build-tool exclude.

### Behavior

- **Default**: `npx tsx scripts/sri.ts <url>` downloads, hashes, writes the file to `./scripts/downloads/<derived-filename>`, and emits the SRI block with a `# saved:` line. The directory is created on first use.
- **`--no-save`**: `npx tsx scripts/sri.ts --no-save <url>` matches the pre-follow-up behavior. The buffer is dropped after hashing; no file is written; no `# saved:` line.
- **`--save-dir <path>`**: `npx tsx scripts/sri.ts --save-dir <path> <url>` writes to the given directory instead of the default.
- **Local file inputs**: `npx tsx scripts/sri.ts ./some/file.js` reads the file, hashes, and prints the SRI block. No file is written regardless of `--save-dir` or `--no-save`. The default `saveDir` value is harmless because the URL branch is the only one that uses it.

### Verification (green)

- `npm run typecheck` — clean.
- `npm run lint` — clean.
- `npm test` — 12 files, 179 tests pass.
- `npx tsx scripts/sri.ts https://unpkg.com/lucide@1.41.0/dist/umd/lucide.min.js` (no flags) — wrote the file to `./scripts/downloads/unpkg.com-lucide@@1.41.0-dist-umd-lucide.min.js` (429,464 bytes). The SHA-256 of the saved file, computed independently with `Get-FileHash`, decodes to base64 as `/D7Cdm/d++JpBay9Okbiuteo+Kx+9fMONwe1q7dQz5o=` — the same value the script printed. End-to-end correctness verified.
- `npx tsx scripts/sri.ts --no-save <url>` — output has no `# saved:` line; `./scripts/downloads` is not created.
- `npx tsx scripts/sri.ts ./local/file.js` — local input; no `# saved:` line; `./scripts/downloads` is not created.
- `git status --porcelain` does not list `scripts/downloads/...` (the directory is gitignored; the new exclude in `eslint.config.js` matches the .gitignore entry at line 122).
- `git check-ignore -v .\scripts\downloads\unpkg.com-…` confirms the rule: `scripts/downloads/` at `.gitignore:122`.
