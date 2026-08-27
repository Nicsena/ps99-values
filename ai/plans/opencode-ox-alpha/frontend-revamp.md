# Frontend Revamp Plan

Status: half-implemented
Created: 2026-08-25
Inputs: `ai/reports/inconsistency-audit/06-frontend-ui.md` (partially stale — see "Verified current state"), `ai/plans/slug-redesign.md`, `ai/plans/database-redesign.md`
Related: `src/routes/pages.ts`, `src/routes/api.ts`, `views/`, `public/js/`, `public/css/style.css`

## Progress (2026-08-26)

Done:
- `style.css` rewritten from scratch: token-driven (dark + light themes via `[data-theme]`), violet accent, neutral white/ink primary button, mono data numerals, all dead rules gone.
- Navbar extracted to `views/partials/navbar.ejs`; mobile breakpoint at 768px (hamburger + slide-down menu, settings moved into the menu).
- Settings dropdown with working Light / Dark / System theme switcher (localStorage + `prefers-color-scheme`, pre-paint application, cross-fade transition).
- `search.js` refactored to `attachSearch()` bound to any `[data-search-input]` (navbar + home page share one implementation).
- Home page redesigned (current: minimal portal — wordmark, sub, Browse Items CTA, live meta line, 6-feature grid; no item data rendered).
- Misc: refresh button removed, breadcrumbs no longer underline on hover, filter panel restyled (no bg/border, sort row on top), server-side `fmtCompact` util (`src/util/format.ts`).

Remaining: Phases 1–4 below (server foundations, client ES-module foundation, items page robustness, item detail rewrite), the rest of Phase 5 (a11y combobox, CDN pinning, copy pass), and Phase 6.

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

### Still present — confirmed

| Issue | Location |
|---|---|
| 710-line monolith: EJS format scriptlets duplicating `format.js`; ~310-line inline chart engine; `PAGE_DATA` island serializing history twice | `views/item.ejs` |
| 24h % delta stamped on High/Low/1M/ATH/ATL cells (`delta: true`) | `views/item.ejs:54-62` |
| Permanent `placeholder.svg` on search dropdown, variant tiles, similar tiles | `public/js/search.js:73`, `views/item.ejs:353,373` |
| Filter-change race (no AbortController); infinite scroll dies permanently after one error (observer never re-observed); `replaceState` breaks Back button; phantom `q` filter with no UI | `public/js/items.js` |
| Legacy unserved `/api/pets*` endpoints with divergent contracts | `src/routes/api.ts:17-46` |
| API errors render HTML via global handler; three different 404 experiences | `src/app.ts` |
| Pagination envelope echoes requested pageSize, serves clamped | `src/routes/api.ts:25` |
| Thumbnail route double-decodes already-decoded param; no Cache-Control on 302s | `src/routes/pages.ts:20-43` |
| CSS: two merged generations — ~20 dead rule blocks, conflicting duplicates (`.item-header-thumb` 120px vs 110px, `.chg-up/down` vs `.delta-up/down`), `.exists-rate` styled nowhere | `public/css/style.css` (1,499 lines) |
| Duplication: `escapeHtml` ×2 (`items.js:39`, `search.js:31`), month arrays ×3, compact-number fmt in `format.js` + `item.ejs` scriptlets + micro-copies in `items.js`/`search.js`; variant names ≥4 places; sort/enum whitelists triplicated (`items.ejs` ≡ `items.js` ≡ `rapService.ts`) | various |
| Pets-only copy ("Search pets…", hero, hide_pets label) on a 15-collection site | `header.ejs:23`, `home.ejs`, `items.ejs` |
| Refresh button: no `res.ok` check, silent failure, unconditional reload | `header.ejs:84-95` |
| lucide `@latest` and Chart.js `@4` unpinned, no SRI | `header.ejs:10`, `item.ejs:384` |
| Chart.js CDN failure early-returns before toolbar wiring — all controls silently dead | `views/item.ejs:~435` |
| Range buttons promise 30D/90D/ALL over ≤200 points (~8 days at hourly cadence), no "data limited" hint | `views/item.ejs:161-165,200-205` |
| History heading shows all-time count while table holds ≤200 rows | `views/item.ejs:240` |
| Exists stat caption reuses `rapUpdatedAt` (separate capture clocks) | `views/item.ejs:117,122` |
| `relTime` floors to 1 minute ("1m ago" for seconds-old data) | `public/js/format.js:56-64` |
| Literal `\u2013` in tooltip titles; `data-rel="null"` when rapUpdatedAt missing | `views/item.ejs:139,183,117` |
| Search dropdown lacks combobox semantics (role/aria-expanded/aria-activedescendant/listbox) | `public/js/search.js` |
| Dead code: `app.locals.detailPath` orphaned, `PS99.resolveIcon` zero callers, fallback branches for missing `PS99.*` | `src/app.ts:17`, `header.ejs:48`, `items.js`, `search.js` |

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
- Unauthenticated `/api/refresh` endpoint security (accepted quirk; button UX still improved in Phase 5).
- `/reports` route (accepted quirk).
