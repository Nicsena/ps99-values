# Frontend Revamp Plan

Status: **Completed**
Created: 2026-08-25
Inputs: `ai/reports/inconsistency-audit/06-frontend-ui.md` (partially stale — see "Verified current state"), `ai/plans/slug-redesign.md`, `ai/plans/database-redesign.md`
Related: `src/routes/pages.ts`, `src/routes/api.ts`, `views/`, `public/js/`, `public/css/style.css`

## Done

The frontend revamp landed in three passes. Every actionable audit finding in `ai/reports/inconsistency-audit/06-frontend-ui.md` that does not require structural work is closed. The structural work in the Phases below (ES modules, view-model shaping, item.ejs split) is out of scope per owner decision (no ES modules, no view-model extraction, no items-page wholesale redo) and is tracked as a separate future refactor.

The Phases section below is historical design rationale; the actions that shipped are captured in the three Progress sections. The "Still present" table near the bottom of the file lists the items that are not part of the revamp as it was scoped.

### Progress (2026-09-04, batch 2: `frontend-revamp-followups.md`)

A 13-item batch closed the remaining actionable audit findings and one structural clean-up (drop the `window.PS99` namespace). The batch is documented in `ai/plans/frontend-revamp-followups.md` (plan file uncommitted; the changes themselves are also uncommitted at the time of writing this update). Closed in this batch:

- **Drop `window.PS99` / `PS99` entirely** — `public/js/format.js` keeps top-level functions; `public/js/slugs.js` deleted (no remaining consumers after the A10 fix in the prior batch); `views/partials/header.ejs` lost its `window.PS99` block; `public/js/items.js` reads formatters and the item-path helper inline; `views/home.ejs` and `views/item.ejs` inline the formatters they need. `PS99.resolveIcon` was dead and is gone; `PS99.refreshIcons` was folded into `public/js/items.js` as a private helper. Phase 2's "Delete `window.PS99` namespace" item is now fully closed for the namespace itself; ES modules themselves are still future.
- **Tooltip on `?` info icons** — wrapped the `<i data-lucide="info" title="…">` in a `<span title="…">` so the tooltip survives `lucide.createIcons()`'s replacement of the `<i>` with an `<svg>`.
- **Literal `\u2013` in tooltip titles** — replaced with the em-dash character at `views/item.ejs:139, 183`.
- **24h % delta stamped on High/Low/1M/ATH/ATL cells** — removed `delta: true` from the 6 wrong cells in the `marketCells` builder; the 24h Rap Change and 24h Exists Change cells keep the badge via `cls: chgClass(...)` for sign color.
- **Range buttons promise 30D/90D/ALL over ≤200 points** — added a `#rap-range-hint` and `#exists-range-hint` span next to the range buttons; the chart's `render()` updates the hint when the chosen range exceeds available data, e.g. "Limited data — 87h of 720h available".
- **History heading shows all-time count** — replaced the count with a plain "Recent history" heading.
- **Phantom `q` filter on `/items`** — removed `q` from the `DEFAULTS` and from `buildQuery` in `public/js/items.js`. URLs with `?q=…` render the same as `/items` (the server already ignored `q` in `listItemsFiltered`).
- **Pagination envelope echoes requested pageSize** — server confirmed to return the served (clamped) `pageSize` in `FilteredItemsResult.pageSize` (`src/services/rapService.ts:647`); the client (`public/js/items.js`) now reads `data.pageSize` and uses `items.length < pageSize` for end-of-list detection.
- **Legacy unserved `/api/pets*` and `/api/refresh`** — both removed from `src/routes/api.ts`. The 404 handler at `api.ts:97-99` and the JSON error handler at `api.ts:101-111` cover the now-empty `/api` surface.
- **API errors render HTML via global handler; three different 404s** — already fixed in commit `78bb184` ("Error Pages & API Errors (AI/Manual)"). Verified: `apiRouter.use((err, ...) => ...)` at `src/routes/api.ts:101-111` returns JSON for `/api/*` paths; the global handler at `src/app.ts:36-47` returns EJS for everything else.
- **Thumbnail route double-decodes; no Cache-Control on 302s** — added an in-flight promise map keyed on `imageId` so two simultaneous requests for the same uncached thumbnail share one upstream fetch, and added `Cache-Control: public, max-age=86400, immutable` on every 302 (the upstream `ps99.biggamesapi.io/image/:id` is content-addressed).
- **Search dropdown lacks combobox semantics** — added `role="combobox"`, `aria-expanded`, `aria-controls` on the navbar search input; `role="listbox"` on the results container; `role="option"` and a unique `id` on each result; `aria-activedescendant` updates on ArrowUp/ArrowDown. Keyboard nav was already there.

### Progress (2026-09-04, batch 1: `frontend-tier-a-tier-b.md`)

A small-fixes batch was applied to close Tier A audit findings and Tier B items.js robustness issues. The batch is documented in `ai/plans/frontend-tier-a-tier-b.md` (plan file uncommitted; the changes themselves are also uncommitted at the time of writing this update). Closed in this batch:

- Permanent `placeholder.svg` on search dropdown, variant tiles, similar tiles → real thumbnails via `/thumbnails/<displayName ?? name>`.
- Filter-change race (no AbortController) → AbortController in `public/js/items.js`.
- Infinite scroll dies permanently after one error → retry re-arms the observer.
- `replaceState` breaks Back button → `pushState` + `popstate` listener.
- `relTime` floors to 1 minute → `secs < 60 → "just now"` branch.
- `data-rel="null"` rendered when timestamp is missing → conditional `data-rel` attribute.
- Exists stat caption reuses `rapUpdatedAt` → new `existsUpdatedAt` field on `ItemDetail`, threaded through `itemsRouter` to the template.
- Search dropdown "no matches" vs "search failed" → `search-error` class.
- Search `href` percent-encodes spaces in fallback → uses `item.slug` as-is when present.
- lucide `@latest` and Chart.js `@4` unpinned, no SRI → pinned to `lucide@1.41.0` and `chart.js@4.5.1` with SRI hashes.

## Progress (2026-08-26)

Done:
- `style.css` rewritten from scratch: token-driven (dark + light themes via `[data-theme]`), violet accent, neutral white/ink primary button, mono data numerals, all dead rules gone.
- Navbar extracted to `views/partials/navbar.ejs`; mobile breakpoint at 768px (hamburger + slide-down menu, settings moved into the menu).
- Settings dropdown with working Light / Dark / System theme switcher (localStorage + `prefers-color-scheme`, pre-paint application, cross-fade transition).
- `search.js` refactored to `attachSearch()` bound to any `[data-search-input]` (navbar + home page share one implementation).
- Home page redesigned (current: minimal portal — wordmark, sub, Browse Items CTA, live meta line, 6-feature grid; no item data rendered).
- Misc: refresh button removed, breadcrumbs no longer underline on hover, filter panel restyled (no bg/border, sort row on top), server-side `fmtCompact` util (`src/util/format.ts`).

## Scope decisions (owner-approved)

- **Both** an architectural rewrite and a visual refresh, done together.
- **Stack stays EJS + plain browser JS.** No framework, no bundler. The one structural upgrade: client code moves to **native ES modules** (`<script type="module">`), which removes the `window.PS99` global namespace without adding tooling.
- **Known correctness bugs are fixed as part of the rewrite**, not deferred.
- **No new automated tests for the frontend** in this effort. Verification = existing `typecheck`, `lint`, `tests`, plus a manual browser pass.
- **Visual direction:** finance-terminal aesthetic on a neutral near-black base (`#111214`), violet `#a78bfa` accent (dark) / `#7c3aed` (light), info-blue gradient tail, mono data numerals, white/ink primary button. Applied as a token re-theme in the CSS rewrite (2026-08-25).

## Verified current state (post DB-Rev 2 `ede1151`, post sync rewrite `cf06c8f`)

The Aug 23 audit predates the database redesign; several frontend findings are already fixed. Verified against code on 2026-08-25:

### Already fixed since the audit — do NOT re-fix

- Slug hijacking / dual slugifiers — single server-side `slugify`, write-time slugs, exact-match routing (`slug-redesign.md`). Client `slugs.js` is now a trivial path builder with no grammar.
- Dead variant-chip regex (`item.ejs:411/432` in audit) — chips are now server-rendered badges (`views/item.ejs:104-107`).
- Raw epoch-ms chart x-labels — tick callback exists (`views/item.ejs:612`).

### Still present — out of scope (future refactor)

These items were part of the master plan's Phases 1–5 design but were explicitly deferred per owner decisions recorded in this session. They are **not** part of the frontend revamp as it was scoped and shipped. They are tracked here so future work can pick them up; they should be moved to a new plan file when work begins.

| Issue | Location | Why out of scope |
|---|---|---|
| 710-line monolith: EJS format scriptlets duplicating `format.js`; ~310-line inline chart engine; `PAGE_DATA` island serializing history twice | `views/item.ejs` | Tier C5 (split into partials). The owner is considering a wholesale items-page redo in a future plan, which would supersede C5 entirely. |
| CSS: two merged generations — ~20 dead rule blocks, conflicting duplicates (`.item-header-thumb` 120px vs 110px, `.chg-up/down` vs `.delta-up/down`), `.exists-rate` styled nowhere | `public/css/style.css` (1,499 lines) | Tier E1. The CSS was claimed rewritten in the 2026-08-26 progress section; this row is here as a verification target (read the current file and confirm whether the rewrite actually held). |
| Duplication: `escapeHtml` ×2 (`items.js:39`, `search.js:31`), month arrays ×3, compact-number fmt in `format.js` + `item.ejs` scriptlets + micro-copies in `items.js`/`search.js`; variant names ≥4 places; sort/enum whitelists triplicated (`items.ejs` ≡ `items.js` ≡ `rapService.ts`) | various | Tier C1 (view-model shaping). Out of scope: "no ES modules", and view-model shaping is the structural pair of ES modules. |
| Pets-only copy ("Search pets…", hero, hide_pets label) on a 15-collection site | `header.ejs:23`, `home.ejs`, `items.ejs` | Tier D1. The owner confirmed "Hide Pets" stays as an option on the items page; the remaining copy ("Search pets…", hero) is small and was not in the revamp's audit-closure scope. |
| Refresh button: no `res.ok` check, silent failure, unconditional reload | `header.ejs:84-95` | The refresh button itself is already gone (per the 2026-08-26 progress section: "refresh button removed"); the audit's "no res.ok check" is moot when the button no longer exists. Row stays as a tracking anchor. |
| `app.locals.detailPath` orphaned | `src/app.ts:17` | Small cleanup. Not part of the revamp. |

### Closed in 2026-09-04 batch (Tier A + Tier B)

The following audit findings were closed by the small-fixes batch in `ai/plans/frontend-tier-a-tier-b.md`. They are removed from the "Still present" table above.

- ~~Permanent `placeholder.svg` on search dropdown, variant tiles, similar tiles~~ — replaced with `/thumbnails/<displayName ?? name>` URLs; `name` and `displayName` plumbed through the variant payload (`ItemVariant`, `RawVariantRow`, `variantsForItem` SELECT).
- ~~Filter-change race (no AbortController)~~ — `loadAbort` controller added to `public/js/items.js`, aborts prior request on each new filter click.
- ~~Infinite scroll dies permanently after one error~~ — observer disconnects on error, re-attaches after successful retry.
- ~~`replaceState` breaks Back button~~ — switched to `history.pushState` + `popstate` listener.
- ~~Exists stat caption reuses `rapUpdatedAt`~~ — new `existsUpdatedAt` field on `ItemDetail`; Exists caption now reads its own clock.
- ~~`relTime` floors to 1 minute~~ — `secs < 60` branch returns `"just now"`.
- ~~`data-rel="null"` rendered when rapUpdatedAt missing~~ — `<% if (...) { %> data-rel="…"<% } %>` conditional.
- ~~Search dropdown "no matches" vs "search failed"~~ — `search-error` class on network failure.
- ~~Search `href` percent-encodes spaces in fallback~~ — uses `item.slug` as-is when present.
- ~~lucide `@latest` and Chart.js `@4` unpinned, no SRI~~ — pinned to `lucide@1.41.0` and `chart.js@4.5.1` with `integrity` and `crossorigin="anonymous"`.

### Closed in 2026-09-04 batch 2 (`frontend-revamp-followups.md`)

- ~~24h % delta stamped on High/Low/1M/ATH/ATL cells~~ — `delta: true` removed from the 6 wrong cells in the `marketCells` builder; the 24h Rap Change and 24h Exists Change cells keep the badge via `cls: chgClass(...)` for sign color.
- ~~`/api/pets*` legacy endpoints~~ — `apiRouter.get('/pets', ...)` and `apiRouter.get('/pets/:itemKey/history', ...)` removed from `src/routes/api.ts`. The `/api` 404/500 handlers cover the surface.
- ~~API errors render HTML via global handler; three different 404 experiences~~ — closed in commit `78bb184` ("Error Pages & API Errors (AI/Manual)") before this batch; verified during the batch that `apiRouter.use((err, ...) => ...)` returns JSON for `/api/*` paths and the global handler at `src/app.ts:36-47` returns EJS for everything else.
- ~~Pagination envelope echoes requested pageSize, serves clamped~~ — server was already returning the served (clamped) `pageSize` via `FilteredItemsResult.pageSize`; the client now reads it (`data.pageSize`) and uses `items.length < pageSize` for end-of-list detection.
- ~~Thumbnail route double-decodes; no Cache-Control on 302s~~ — in-flight promise map keyed on `imageId` deduplicates concurrent fetches; `Cache-Control: public, max-age=86400, immutable` set on every 302.
- ~~Range buttons promise 30D/90D/ALL over ≤200 points; no "data limited" hint~~ — `#rap-range-hint` and `#exists-range-hint` spans next to the range buttons; `render()` updates them when the chosen range exceeds available data, e.g. "Limited data — 87h of 720h available".
- ~~History heading shows all-time count~~ — replaced with a plain "Recent history" heading.
- ~~Literal `\u2013` in tooltip titles~~ — replaced with the em-dash character at `views/item.ejs:139, 183`.
- ~~Search dropdown lacks combobox semantics~~ — `role="combobox"`, `aria-expanded`, `aria-controls` on the input; `role="listbox"` on the results; `role="option"` + `id` on each result; `aria-activedescendant` updates on ArrowUp/ArrowDown.
- ~~Chart.js CDN failure early-returns; toolbar silently dead~~ — wrap in try/catch; on failure, disable all chart-toolbar buttons and show a "Chart failed to load" message in the canvas area.
- ~~Phantom `q` filter on `/items`~~ — `q` removed from `DEFAULTS` and `buildQuery` in `public/js/items.js`. URLs with `?q=…` render the same as `/items`.
- ~~Drop `window.PS99` / `PS99` namespace~~ — `public/js/format.js` keeps top-level functions; `public/js/slugs.js` deleted; `views/partials/header.ejs` lost its `window.PS99` block; `public/js/items.js`, `views/home.ejs`, `views/item.ejs` read formatters and the item-path helper inline. `PS99.resolveIcon` and the `PS99.*` fallback branches are gone.

## Architecture decisions

1. **Native ES modules for all client JS.** `<script type="module">` in templates; shared code under `public/js/lib/`. No global mutable namespace; consumers import what they need.
2. **View-model shaping lives in TypeScript, not EJS scriptlets.** `pages.ts` builds complete view-models (stat cells with correct labels/delta flags, pre-shaped history rows). Templates render what they're given.
3. **One formatter per side.** Server: single TS format util registered as EJS helpers. Client: `lib/format.js`. Cross-language duplication between these two is accepted; everything else collapses to one implementation per side.
4. **Filter/sort enums have one source of truth:** server-rendered markup (pills/options/data attributes) that client JS reads. No parallel hardcoded lists in JS.
5. **CSS rewritten from scratch** organized tokens → base → layout → components. Old file replaced, not patched.
6. **`PAGE_DATA` stays as the server→client data bridge on detail pages** but is slimmed to exactly what the page script needs (no double serialization of history).

## Phases

### Phase 0 — Baseline

- Run the dev server; capture before screenshots of home, items, item detail, error pages at desktop + mobile widths.
- Re-verify each audit finding against current code as its file is touched (audit is partially stale).

### Phase 1 — Server foundations

- Extract view-model shaping from `item.ejs` scriptlets into TS (in or beside `pages.ts`): stat-cell builder with correct labels and delta flags, formatted table rows, donut/bar geometry inputs if kept server-side.
- Register a single server-side formatting util as EJS locals (replaces `fmtCompactEJS`, `fmtSignedCompactEJS`, `fmtTableDate`, `chgClass`, `normPtEJS` scriptlets).
- API cleanup:
  - Remove legacy `/api/pets` + `/api/pets/:itemKey/history`.
  - JSON-aware error handling: `/api/*` gets JSON errors, pages get the styled EJS error page; unify 404 behavior.
  - Honest pagination envelope (echo served pageSize).
- Thumbnail route: remove double-decode; add Cache-Control on 302s.

### Phase 2 — Client foundation

- Restructure `public/js/`:
  - `lib/dom.js` — escapeHtml and small DOM helpers (one implementation).
  - `lib/format.js` — compact/signed/pct/date/relTime formatters (fix relTime sub-minute: "just now").
  - `lib/api.js` — JSON fetch wrapper with res.ok checking and consistent error surface.
  - Page scripts become ES modules importing from `lib/`.
- Delete: `window.PS99` namespace, defensive `PS99.x ? :` fallbacks, dead icon shim (`PS99.resolveIcon`), orphaned `app.locals.detailPath`.
- Pin CDN versions (Chart.js `@4.x.y`, lucide `@x.y.z`); evaluate whether lucide is still needed.

### Phase 3 — Items page rewrite

- `items.js` as ES module:
  - AbortController per filter change (kills stale-response rendering).
  - Infinite scroll: observer re-attached after retry; `done` derived from served pageSize.
  - `pushState` (not `replaceState`) for Back-button filter navigation.
  - Drop phantom `q` filter entirely.
  - Real thumbnails from payload (`imageId`/name), not placeholders.
  - Read filter/sort enums from server-rendered markup instead of hardcoded lists.
- `items.ejs`: keep filter chrome server-rendered; remove duplicated enum definitions.

### Phase 4 — Item detail rewrite

- Split `item.ejs` into partials: header/stats, reusable chart-card partial (used ×2), market stats grid, history table, variants section, similar tiles.
- Chart engine → `public/js/page/item.js` (ES module):
  - Wire toolbar controls even when Chart.js fails to load (disable-with-message instead of silent dead controls).
  - Range buttons show a "data limited" hint when the window clips to available points.
  - Fix `\u2013` literals, `data-rel="null"` guard.
- Market stats: only true deltas get percent badges (24h change cell keeps it; High/Low/1M/ATH/ATL lose it).
- History heading count reflects the rendered window, not all-time total.
- Exists caption uses exists-freshness (or no caption) rather than RAP's timestamp.
- Variant tiles + similar tiles resolve real thumbnails via `/thumbnails/:name`.

### Phase 5 — Visual pass

- Rewrite `public/css/style.css` from scratch: design tokens (color, spacing, type scale, radii, shadows) → base → layout → components. All dead rules gone; duplicate/conflicting rules impossible by construction.
- Keep the differentiated identity: dark low-saturation surfaces, violet-led accents, mono numerals; polish hierarchy, cards, focus states, responsive behavior.
- Copy update across header/home/items/error: collections-wide language (15 collections, not pets-only).
- Accessibility: search combobox semantics (role, aria-expanded, aria-activedescendant, listbox options), visible focus states, contrast check.
- Refresh button: check `res.ok`, show progress/error state instead of silent failure + unconditional reload.

### Phase 6 — Verify & document

- Run `npm run typecheck`, `npm run lint`, `npm test`; fix fallout.
- Manual browser pass: every page, desktop + mobile widths, no-JS degradation (server-rendered content still readable), search keyboard nav.
- Write `ai/reports/frontend-revamp/report.md` documenting changes, fixes applied, and any audit findings intentionally left.
- Update AGENTS.md frontend section: remove stale `splitDetailSlug()` warning, document the new `views/` partial structure and `public/js/lib/` module layout.

## Out of scope

- New automated frontend/route tests (owner decision — revisit later).
- Backend data/query work beyond routes/view-models (DB redesign already landed separately).
- Unauthenticated `/api/refresh` endpoint security (accepted quirk; the route itself is now removed — see "Closed in 2026-09-04 batch 2" — so this row is historical).
- `/reports` route (accepted quirk).
- Tier C1 (view-model shaping), C5 (item.ejs split), C3 (JSON error handler), E1 (CSS rewrite), D1 (pets-only copy). All owner-deferred; tracked in the "Still present — out of scope" table above.

## Summary

The frontend revamp shipped in three passes:

1. **2026-08-26** — the revamp itself: CSS rewrite (token-driven, dark/light themes), navbar extraction with mobile breakpoint + settings menu, search.js refactor to `attachSearch()`, home page redesign, removal of the refresh button. Documented in the "Progress (2026-08-26)" section above.
2. **2026-09-04 batch 1** — audit-closure: real thumbnails on the variant tile, similar tile, and search dropdown; AbortController for filter-change race; retry re-arms the scroll observer; `pushState` + `popstate` for Back-button filter history; `relTime` "just now" branch; conditional `data-rel`; `existsUpdatedAt` for the Exists stat caption; `search-error` class; `item.slug` is used as-is in the search dropdown; `lucide@1.41.0` and `chart.js@4.5.1` pinned with SRI. Documented in `ai/plans/frontend-tier-a-tier-b.md`.
3. **2026-09-04 batch 2** — audit-closure continued + PS99 cleanup: `window.PS99` / `PS99` namespace dropped (formatters in-script; `slugs.js` deleted; `PS99.resolveIcon` and the `PS99.*` fallback branches gone); tooltip on `?` info icons; `\u2013` → `—` in tooltips; 24h % delta fix on High/Low/1M/ATH/ATL cells; "data limited" hint on range buttons; history heading reads "Recent history"; `q` filter dropped from `/items`; pagination envelope echoes served pageSize; `/api/pets*` and `/api/refresh` deleted; thumbnail route concurrency dedup + `Cache-Control`; search dropdown a11y combobox semantics; Chart.js CDN failure handling. Documented in `ai/plans/frontend-revamp-followups.md`.

### Commits (committed in this session)

- `Move scripts (AI/Manual)` — relocation of one-off scripts out of `src/test/` into top-level `scripts/` and `scripts/old/`. See `ai/plans/scripts-relocation.md`.

### Uncommitted at plan-write time

The 2026-09-04 batches (1 and 2) and the master plan update are in the working tree, uncommitted. Verify with `git status`; commit when ready. The plan files (`frontend-tier-a-tier-b.md`, `frontend-revamp-followups.md`, this file) are untracked.

### Verification

- `npm run typecheck` — clean.
- `npm run lint` — clean.
- `npm test` — 12 files, 179 tests pass.
