# Frontend Revamp Followups

Status: **Completed**
Created: 2026-09-04

## Goal

Apply 13 frontend fixes in one batch. The batch closes every actionable audit finding still open in `ai/reports/opencode-ox-alpha/inconsistency-audit/06-frontend-ui.md` plus one structural change (drop the `window.PS99` / `PS99` namespace) and one bug fix (tooltip on `?` info icons). The master plan `ai/plans/opencode-ox-alpha/frontend-revamp.md` remains "Status: half-implemented" — its Phases 1–5 structural work (C1, C3, C5, E1) is still future. This batch is the audit-closure half.

## Background

The master plan's "Still present" tracking table (post the 2026-09-04 batch) lists 11 items. After this batch, 7 of them are closed. The remaining 4 (710-line `item.ejs` monolith, CSS duplication, format/view-model duplication, pets-only copy) are all structural refactors that pair with Tier C1, C3, C5, E1 — out of scope for this audit-closure batch.

The C3 finding (API errors / three 404s) is already closed in commit `78bb184` ("Error Pages & API Errors (AI/Manual)"), predating this session. The current code routes `/api/*` errors through `apiRouter.use((err, ...) => ...)` at `src/routes/api.ts:101-111`, which returns JSON; non-`/api` errors fall through to the global handler at `src/app.ts:36-47`, which renders EJS. The master plan update acknowledges this.

User-stated constraints:
- No `window.PS99` / `PS99` (drop entirely).
- No `window.ps99<Name>` either. Formatters live in `public/js/format.js` as a `<script defer>`-loaded module; top-level functions are accessible across scripts via standard non-module-script hoisting. `format.js` does not assign anything to `window`.
- No ES modules.
- Hide Pets checkbox stays on the items page.
- B4 (`q` filter) — no redirect. The page just stops honoring `q`; URLs with `?q=…` render the same as `/items`.
- Variant-label-rendering cleanup is out (deferred).

## Decisions

1. **PS99 drop shape: keep `format.js` as a script with top-level functions.** `format.js` does not assign to `window`. Other scripts and templates that need a formatter reference it as a top-level identifier (the browser hoists non-module top-level function declarations). The `var PS99 = …; window.PS99 = …;` lines in `format.js`, `slugs.js`, and `header.ejs` are removed. `PS99.resolveIcon` is dead and removed. `PS99.refreshIcons` is folded into `public/js/items.js` as a private helper.
2. **`slugs.js` is deleted.** It defined `PS99.itemPath` and was the only source of that function. After the prior batch's A10 fix, no other script reads `PS99.itemPath`. Deletion removes the last place a `window.PS99 = …` assignment is defined outside `header.ejs`.
3. **Tooltip fix: wrap the `<i data-lucide="info">` in a `<span title="…">`.** The browser shows the tooltip on the span. The SVG (rendered by `lucide.createIcons()`) is just the visual; the `title` survives on the wrapper.
4. **B4 (`q` filter): drop on both client and server, no redirect.** The page just doesn't honor `q`. URLs with `?q=…` continue to render the same as `/items` (the server ignores `q`; the client doesn't send it). No 301.
5. **Variant-label-rendering cleanup is out** (deferred).
6. **C6 (a11y combobox) is in.** Adds `role="combobox"`, `aria-expanded`, `aria-activedescendant`, `role="listbox"` to the search dropdown markup. Keyboard nav is already there.
7. **B11 deletes `/api/pets*` and `/api/refresh`.** Both routes are dead surface.
8. **No new automated tests** (per master plan §"Out of scope").
9. **C3 is not in this batch.** Already fixed in commit `78bb184`. The master plan update acknowledges this.

## Items (13)

| # | Item | Tier | File(s) | Time |
|---|---|---|---|---|
| 1 | Drop `window.PS99` / `PS99` entirely; keep `format.js` as a script | structural | 7 files | 30 min |
| 2 | Real thumbnails on variant tile *(already in working tree)* | A | `views/item.ejs` + listings/rapService | 10 min |
| 3 | Real thumbnails on similar tile *(already in working tree)* | A | `views/item.ejs` | 5 min |
| 4 | Real thumbnails on search dropdown *(already in working tree)* | A | `public/js/search.js` | 5 min |
| 5 | Tooltip on `?` info icons (wrap in `<span title="…">`) | A | `views/item.ejs` | 10 min |
| 6 | A8a — literal `\u2013` re-grep (likely no-op) | A | `views/item.ejs` | 5 min |
| 7 | A8b — 24h % delta fix on High/Low/1M/ATH/ATL cells | A | `views/item.ejs` | 10 min |
| 8 | Range buttons "data limited" hint | A | `views/item.ejs` | 15 min |
| 9 | History heading count fix | A | `views/item.ejs` | 5 min |
| 10 | B4 — drop `q` filter from `/items` (no redirect) | B | `public/js/items.js` | 5 min |
| 11 | B5 — server-echoed pageSize in `done` | B | `public/js/items.js` | 5 min |
| 12 | B6 — verify server, fix whichever side is wrong | B | `src/services/rapService.ts`, `src/routes/api.ts` | 10 min |
| 13 | B11 — delete legacy `/api/pets*` and `/api/refresh` | B | `src/routes/api.ts` | 5 min |
| 14 | C4 — thumbnail route concurrency + Cache-Control | C | `src/routes/pages.ts` | 30 min |
| 15 | C6 — a11y combobox on search dropdown | C | `public/js/search.js` | 15 min |
| 16 | D3 — Chart.js CDN failure handling | D | `views/item.ejs` | 15 min |

13 unique items, ~190 minutes, 10 files.

## Files modified

| File | Items | Approx net lines |
|---|---|---|
| `views/item.ejs` | #2 (done), #3 (done), #5, #6, #7, #8, #9, #16 | +30 / -20 |
| `public/js/items.js` | #1, #10, #11 | +15 / -10 |
| `public/js/search.js` | #1, #4 (done), #15 | +20 / -5 |
| `public/js/format.js` | #1 | 0 / -3 |
| `public/js/slugs.js` | #1 | -47 (file deleted) |
| `views/partials/header.ejs` | #1 | 0 / -12 |
| `views/home.ejs` | #1 (inline formatters) | +10 / -5 |
| `src/services/rapService.ts` | #2 (done), #12 | +3 / 0 |
| `src/routes/api.ts` | #12, #13 | +3 / -10 |
| `src/routes/pages.ts` | #14 | +10 / -2 |

10 files. Net ~0 lines.

## Behavior (after the batch)

- No `window.PS99` / `PS99` anywhere in the JS. The `PS99Values` product name in templates is unaffected.
- Formatters are in-script. `public/js/format.js` exposes top-level functions accessible across scripts via standard hoisting. Templates that need them have inlined copies.
- Tooltips on `?` info icons show on hover (via `<span title="…">` wrapper).
- 24h % delta badge appears only on the 24h Rap Change and 24h Exists Change cells. High/Low/1M/ATH/ATL cells lose the badge.
- Range buttons show a "data limited" hint when the window exceeds available data.
- History heading reads "Recent history" (no count).
- `/items` doesn't honor `q` (no redirect; URLs with `?q=…` render the same as `/items`).
- `done` in `items.js` uses server-echoed `pageSize` (per B6 verification).
- `/api/pets*` and `/api/refresh` are deleted.
- Thumbnail route has an in-flight promise map + `Cache-Control: public, max-age=86400, immutable` on 302s.
- Search dropdown has combobox ARIA semantics.
- Chart.js CDN failure shows a visible error and disables the chart toolbar.

## Verification (green)

- `npm run typecheck` — clean.
- `npm run lint` — clean.
- `npm test` — 12 files, 179 tests pass.
- Manual browser pass on `/`, `/items`, `/items/<slug>`, search dropdown:
  - Tooltips show on `?` icons.
  - 24h % delta badge appears only on 24h change cells.
  - Range buttons show "data limited" hint on charts with limited data.
  - History heading reads "Recent history".
  - Search dropdown has `role="combobox"` and `role="listbox"` (verify in DevTools).
  - No `PS99` references in DevTools console.
  - `/api/pets*` and `/api/refresh` return 404.
  - `/items?q=cat` renders the same as `/items`.

## Out of scope (deliberately, this batch)

- Variant-label-rendering cleanup (deferred per user).
- Tier C1 (view-model shaping), C5 (item.ejs split), C3 (already fixed in commit `78bb184`).
- ES modules.
- Tier E1 (CSS rewrite; verify the revamp's claim separately).
- D1 (Hide Pets copy change).
- New automated frontend tests.

## Summary

Implemented and verified. The 13 frontend changes in this batch close every actionable audit finding in `06-frontend-ui.md` that does not require structural work. The structural work (C1, C3, C5, E1) is still in the master plan as future.

The 8 files that were uncommitted from the prior session (the recent tier-a-tier-b batch) are part of this batch's logical scope — items #2, #3, #4 in the table above are the changes that were already in the working tree from the prior session. The current code in the working tree after this batch represents 16 items of net work (8 from the prior session + 13 in this batch, with some overlap on `public/js/items.js`, `public/js/search.js`, and `views/item.ejs`).

### Files in commit (uncommitted at plan-write time, to be committed by user)

10 files modified + 1 file deleted:

- `views/item.ejs` — 8 changes
- `public/js/items.js` — 3 changes
- `public/js/search.js` — 3 changes
- `public/js/format.js` — 1 change (PS99 namespace removal)
- `public/js/slugs.js` — 1 change (file deleted)
- `views/partials/header.ejs` — 1 change (PS99 namespace removal)
- `views/home.ejs` — 1 change (formatters inlined)
- `src/services/rapService.ts` — 1 or 2 changes (B6 verify/fix)
- `src/routes/api.ts` — 2 changes (B6 verify/fix, B11 delete)
- `src/routes/pages.ts` — 1 change (C4)

The `ai/plans/opencode-ox-alpha/frontend-revamp.md` master plan is updated separately to reflect the 7 closed items.
