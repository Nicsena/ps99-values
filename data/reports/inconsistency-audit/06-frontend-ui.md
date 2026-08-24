# 06 · Frontend Contracts & UI — 20 findings (3 high / 9 med / 8 low)

Lens: EJS templates, public/js, CSS, client state, robustness. Both sides of every contract read.

## 1. Route ↔ frontend fetch contracts

- **[HIGH] item.ejs:411, 432 — variant-chip injection + tile-active regex can never match.** Both use `location.pathname.match(/^\/items\/([a-z-]+)\//)` — requires a trailing slash and lowercase-only segment. Real URLs are single-segment mixed-case (`/items/Shiny-Golden-HugeAngelCat`). Net: RAINBOW/GOLDEN/SHINY chips never render; `.variant-tile.active` never applies. Dead feature on every item page.
- **[MED] items.js:117-159 — in-flight request swallows filter changes.** `resetAndLoad()` wipes the grid/observer, then `loadPage` no-ops if a previous fetch is still pending (`if (loading) return`). URL updates, grid empties, the older response lands and renders rows for the old filters. No AbortController (contrast search.js:85-86), no sequence token.
- **[MED] items.js:225-235 + 136-144 — infinite scroll permanently dies after a recovered error.** Scroll-error → `done=true` → observer disconnects; Retry resets `done` and refetches but never re-calls `observer.observe(sentinel)`.
- **[LOW] items.js:89-91 — unguarded fallback dereferences bare `PS99.slugify`** (throws if slugs.js failed to load; the ternary guard only protects `PS99.itemPath`).
- **[LOW] items.js:97 vs search.js:72 — href attribute values never escaped while text is** (`escapeHtml` applied to display only; a name containing `"` terminates the attribute).
- **[LOW] search.js:144-146 — focus handler is a logical no-op** (`if (!resultsBox.hidden) resultsBox.hidden = false`).
- **[LOW] search.js:96-98 — network failures render "No matches"**, indistinguishable from a genuine empty result.

## 2. Dead / unserved / duplicated endpoints & helpers

- **[MED] api.ts:12-24 — `GET /api/pets` fully unserved**, divergent thinner contract (no displayName/slug/imageId/exists).
- **[MED] api.ts:26-41 — `GET /api/pets/:itemKey/history` fully unserved**, with a third unique history shape (reversed + field-stripped).
- **[LOW] app.ts:17 — `app.locals.detailPath` registered, never dereferenced** (client uses PS99.itemPath) — two parallel slug-path generators, one orphaned.
- **[LOW] header.ejs:48 — `PS99.resolveIcon` exported, never called** (only refreshIcons is consumed).
- **[LOW] items.js:15-26 — `q` is a phantom filter** — participates in state/API but no UI control sets or displays it; deep-link `/items?q=cat` filters silently with no indication or way to clear except URL editing.

## 3. Response shape & semantics drift

- **[HIGH] app.ts:27-45 — API errors return HTML** (see 05-http-api.md for the full mechanism).
- **[MED] api.ts:17-20 — pagination envelope lies** (echoes requested pageSize, serves clamped).
- **[MED] app.ts — unknown `/api/*` and unknown HTML paths get Express's plain-text default 404** while known-page misses get the styled EJS 404 — three experiences.
- **[MED] rapService.ts:310, 313 — `tracked` / `volatility30d` hardcoded stubs** rendered as genuine analytics with tooltips.
- **[MED] schema.ts:20 — `hidden` flag never enforced on any read surface** (listRowsRaw, listRowsFiltered, findItemBySlug, similarItemsFor all ignore it).
- **[LOW] api.ts:68-70 vs rapService.ts:583 — duplicated search limit clamping.**
- **[LOW] api.ts:14-16 — silent coercion of invalid sort/order/page params.**

## 4. URL contracts

- **[HIGH] slugs.js:6-11 vs util/slug.ts:3-5 — divergent slug algorithms over one URL namespace.** Server preserves apostrophes/punctuation and transliterates accents; client regex-strips. `Huge Cat's Delight!` → server `Huge-Cat's-Delight!` vs client `Huge-Cat-s-Delight`; `Café Unicorn` → `Cafe-Unicorn` vs `Caf-Unicorn`. Client-built hrefs (cards, search, tiles) 404 or fuzzy-resolve to the wrong item. The correct server `item.slug` is in the API payload, unused for primary hrefs.
- **[MED] search.js:73 · item.ejs:353, 373 — search dropdown, variant tiles, and similar tiles ship permanent placeholder.svg** while /items cards and detail headers resolve real `/thumbnails/<displayName>` — same endpoint, unwired on three surfaces.
- **[MED] pages.ts:20-25 — thumbnail route double-decodes an already-decoded param** (URIError swallowed; `%XX`-looking names diverge from the DB comparison).
- **[MED] pages.ts:31-43 — thumbnail fill has no concurrency dedup**; concurrent first requests race tmp/rename; a garbage 200 body is cached forever (`existsSync` short-circuit); 302s carry no Cache-Control.
- **[LOW] item.ejs:372 — similar tiles hardcode `href="#"` pre-JS** and `data-pt="0" data-shiny="0"` (matches the server join, but no-JS visits navigate to `#`).
- **[LOW] search.js:59 — fallback href percent-encodes spaces** (`%20`), a form neither slug generator produces.
- **[LOW] item.ejs:411 vs slugs.js — variant slug casing duplicated in four places** (slugs.js, variantToSlug, parseVariantSlug, VAR_DEFS); `parseVariantSlug` lowercases before matching — safe now, fragile on edit.

## 5. EJS locals

- **[OK — verified]** `item.ejs` receives and consumes all nine locals (pages.ts:108-118) with null-safe guards (`stats||{}`, `history||[]`); `items.ejs` consumes `collections`; `error.ejs` receives title/message from both notFound() and the global handler. No ReferenceError-class mismatches in the current tree.
- **[LOW] item.ejs:117, 122 — exists stat caption reuses `rapUpdatedAt`**, asserting freshness on the RAP snapshot's schedule (separate capture clocks).
- **[LOW] item.ejs:240 — history heading shows the all-time count (`st.rapPoints`) while the table holds ≤200 rows** — count and content are different quantities presented as one.
- **[LOW] item.ejs:161-165, 200-205 vs listings.ts:321-337 — 30D/90D/ALL range buttons silently clip to the same ≤200-point window** (~8 days at hourly cadence); no "data limited" hint.

## 6. UI copy vs data reality (15 collections)

- **[MED] header.ejs:23 · error.ejs:6 · home.ejs:12,20 · items.ejs:55 — pets-only copy** ("Search pets…", "Back to pets", "every pet…rarest pets", "Hide Pets" checkbox backed by hardcoded `i.collection != 'Pets'`) on a 15-collection site.
- **[MED] rapService.ts:588-595 — search floods with variants of one pet** (one row per stored variant; a popular pet fills all 8 slots with its own Shiny/Golden/Rainbow duplicates).
- **[MED] listings.ts:91 — search matches `name` only; display names unreachable** ("No matches" for the rendered friendly name).
- **[LOW] home.ejs:12,20 — "refreshed on demand"** undersells the cron-driven cadence (minor; accurate for the button).

## 7. Client state

- **[MED] whitelists triplicated with silent fallbacks** — sorts: items.js:27-30 (`VALID_SORTS`) ≡ rapService.ts:441-450 (`SORT_KEYS`) ≡ items.ejs options; exists ranges: items.ejs pills ≡ `EXISTS_RANGES`; shiny/pt/category enums likewise. Server `oneOf()` silently falls back to defaults — future drift degrades into "my filter does nothing" instead of an error.
- **[MED] header.ejs:85-94 + api.ts:78 — Refresh: silent failure + unconditional reload + unauthenticated full-sync endpoint.** No res.ok check, no timeout, no progress, no error surface; double-submit guarded only.
- **[LOW] items.js:71 — `history.replaceState` breaks Back-button filter navigation.**
- **[LOW] items.js:132 — `done` computed from the client's hardcoded PAGE_SIZE=24** instead of the server-echoed pageSize (breaks silently if PAGE_SIZE exceeds the server clamp of 50).
- **[LOW] item.ejs:479 — Chart.js CDN failure silently disables all chart controls** (early return before toolbar wiring); Chart.js pinned `@4`, lucide `@latest`, neither with SRI.
- **[LOW] search.js:104-129 — dropdown lacks combobox semantics** (no role/aria-expanded/aria-activedescendant/listbox).
- **[verified OK]** pill `data-group`/`data-value` values ⊆ backend enums; checkbox '0'/'1' flags match `parseFlag`; PAGE_SIZE 24 ≤ server cap 50; exists ranges match `EXISTS_RANGES`; `/` hotkey correctly skipped in editable targets; double-submit guards on refresh and grid loads; in-flight search aborts.

## 8. CSS/class contracts

- **[MED] items.js:105 — `.exists-rate` used, no rule exists** (the "+123/hr" badge renders unstyled).
- **[MED] style.css — ~20 dead rule blocks** (verified absent from EJS + JS template strings): `.page-head`, `.big-rap`, `.search-form`/`.input`, `.btn-ghost.disabled` (JS toggles the attribute, never this class), `.sort-link`, `.item-link`, `.empty`, `.pagination`/`.page-info`, `.variant-list*`, `#historyChart`, `.badge.golden/.rainbow/.shiny` (live badges are badge-cat/collection/variant), `.info-block .rap-updated`, `.inline-stats/.inline-stat`, `.variant-meta*`, `.stat-grid/.stat-card`, `.chg-up/.chg-down` (live: delta-up/down), `.charts-grid`, `.chart-container`, `.history-heading` — the fossil record of the pets-era table UI.
- **[LOW] style.css duplicate blocks with conflicting values** — `.item-header-thumb` 120px (:791) vs 110px (:949), `.item-header-info` (:801 vs :956), `.item-description`/`.item-desc-empty` (:811 vs :960-967), `.history-count` (:905 vs :1025), navbar-search padding (:371 vs :1462). Two generations merged end-to-end; later silently wins.
- **[LOW] item.ejs:694-700 — exists mini-strip strokes purple but fills cyan unconditionally** (copy-paste from the RAP branch).

## 9. Robustness

- **[HIGH] item.ejs:589-659 — line/area charts render raw epoch-ms x-axis labels.** Labels are epoch-ms numbers on Chart.js's default category scale; the tick `callback` converting to dates exists only in the bar branch (`:655-657`). Tooltips convert correctly (proof of awareness). Primary visualization unreadable on every item page.
- **[MED] item.ejs:54-62 — the RAP 24h percent is stamped onto 24h High/Low, 1M High/Low, All-Time High, and All-Time Low cells** (`delta:true` in the marketCells schema). Users attribute a 24h delta to an all-time low.
- **[MED] item.ejs:240 vs listings.ts:325 — price-history heading count vs ≤200-row table** (see §5).
- **[MED] item.ejs:161-165, 200-205 — range buttons promise 30D/90D/ALL over data capped at ~200 points.**
- **[MED] item.ejs:353, 373 — variant tiles + similar tiles ship permanent placeholders** (no JS swaps in /thumbnails; header proves the endpoint works).
- **[LOW] item.ejs:139, 183 — literal `\u2013` shown in tooltip titles** (HTML attribute, not a JS string).
- **[LOW] item.ejs:117, 122 — `data-rel="null"` rendered when rapUpdatedAt is missing.**
- **[LOW] format.js:56-64 — `relTime` floors to 1 minute** ("1m ago" for seconds-old data), compounding the misattributed exists caption.
- **[LOW] index.ts:15-19 — shutdown never stops cronService**; in-flight sync can block the 5s drain.
- **[verified OK]** search keyboard handling (wrap-around, Escape+blur, Enter activates, `/` skipped in editables); double-submit guards; in-flight search aborts; thumbnail misses redirect to placeholder; atomic thumbnail writes with Windows fallback.
