# Slug Redesign Plan

Status: implemented — exact-slug-only resolution; variant URLs restored as **stored slugs** on per-variant `items` rows (see Revision 2 in `database-redesign.md`)
Created: 2026-08-24 · Revised: 2026-08-24
Inputs: `ai/reports/inconsistency-audit/01-storage-query.md` (§D), `02-sync-ingest.md` (§2), `hijackable-slugs.md`
Related: `chroma-colors.md` (itemKey color token)

## Design rationale: DB-slug lookup vs parse-at-read

Why resolving `/items/:slug` by a pure database lookup is strictly better than
the earlier implementation, where the route parsed the URL string into
candidates and validated them against the database:

| | Parse-at-read | DB-slug lookup |
|---|---|---|
| Identity decided at | Request time — code interprets the URL string | Write time — sync stores the answer |
| `/items/Golden-Axe` | Ambiguous: "item named Golden Axe" or "golden Axe"? Code guesses with ordered candidates | Unambiguous: exactly one row owns that slug |
| Wrong-answer failure mode | Silent wrong-item rendering (looks correct) | Clean 404 |
| Queries per request | Candidate loop: up to 3+ lookups + dim validation | Exactly 1 indexed exact match |
| New variant types (chroma…) | Extend the URL grammar → reopen the hijack surface | Store more slugs; route untouched |

The strategic point: **the URL grammar becomes data instead of code.**
Ambiguity is resolved exactly once, when sync writes rows (first-come keeps the
clean slug; latecomers take deterministic `-<collection>` suffixes). The worst
possible failure at read time is a clean 404 — silent misattribution is
structurally impossible.

Tradeoffs accepted: collision handling lives in write-time logic; slug values
depend on the enabled-collection set; grammar changes require backfills rather
than code-only deploys. These are rare, batched, and testable — versus
read-time parsing bugs which fire silently per request.

## Future work: sync service rewrite

`src/services/sync.ts` is expected to be **rewritten wholesale** under a
separate future plan (not yet planned; the owner considers the current file too
messy). Slug-related behavior must survive that rewrite regardless of internal
structure:

- Variant slugs are assigned at write time by `upsertItem` (itemsRepo) — the
  rewrite must continue creating variant rows through it with dims, never by
  hand-building rows or reusing base-item slugs for variants.
- Grammar: `[shiny-][golden|rainbow-][color-]<base>`; chroma color tokens
  resolve through each item's own stored `colorVariants` map (never a global
  vocabulary); tier-only rows stay NULL-slugged.
- Uniqueness is global across `items.slug` (first-come, `-<collection>` then
  numeric suffixes); boot-time repairs `repairVariantSlugs()` /
  `repairVariantDisplayNames()` are idempotent and safe to keep calling.
- Base items are upserted before feeds are processed in each run — this
  ordering is what makes "items win collisions" hold; preserve it or replace
  it with something equally deterministic.

## Design decision (revised 2026-08-24)

> **Superseded in part (same day):** the "no variant URLs" stance was reversed
> once variant slugs became *stored data* — per-variant rows now carry their
> own grammar slugs, so `/items/rainbow-gargantuan-skelemelon` resolves by the
> same single exact lookup, just against more rows. The core decision below
> (exact-match-only resolution, no parse-time peeling) still holds; only the
> "variants have no URLs" clause is obsolete. Chroma color tokens were
> subsequently implemented as stored slug tokens too.

**Variant URLs are dropped entirely.** Detail slugs resolve by exact base-slug match only:

- `/items/:slug` → one exact indexed lookup (`WHERE slug = ?`). No peeling, no candidates, no anti-hijack logic — identity ambiguity is structurally impossible because nothing is ever interpreted out of the URL segment.
- `/items/golden-dragon` 404s unless an item is literally named "Golden Dragon" (whose stored slug is exactly `golden-dragon`).
- Legacy prefixed forms are not redirected or supported.
- The detail page's Variants card remains the way to see per-variant data; those tiles become display-only since deep links to individual variants no longer exist.
- Chroma color tokens in URLs: retired along with the rest of the prefix grammar (`{shiny}-{color}-{item}` format from earlier planning is void). If chroma deep links are ever needed, revisit as a separate decision.

## Slug lifecycle (DB-side authority)

Slugs are owned by the database, assigned at write time by sync:

1. **Write time (sync → `upsertItem` → `uniqueSlugFor`)** — availability is checked against the DB before assignment:
   - base slug (`dragon`) if free;
   - else collection-scoped (`dragon-miscitems`);
   - else numeric counter (`dragon-miscitems-2`).
   Deterministic given the enabled-collection set, so re-syncs are stable.
2. **Boot** — `repairDuplicateSlugs()` converges any rows written before uniqueness enforcement (deterministic winner per group: lowest collection name, then id; losers move to their collection-scoped slug).
3. **Read time** — pure exact indexed match against `items.slug`. A slug that isn't in the DB means the item doesn't exist; there is no interpretation layer between URL and row.

Note: an item's slug can change when a *new* collection later claims its base slug; existing items keep their slugs (only newcomers get suffixes).

## Remaining changes to implement (simplification of current code)

1. **`src/util/slug.ts`** — delete `detailSlugCandidates()`, `variantPrefix()`, and the prefix logic in `buildDetailSlug()`; module reduces to canonical lowercase `slugify()`.
2. **`src/db/queries/itemsRepo.ts`** — delete `resolveDetailSlug()` / `hasVariantRow()`; keep `findItemBySlug` (exact lookup), `uniqueSlugFor`, `repairDuplicateSlugs`.
3. **`src/routes/pages.ts`** — single route body: `findItemBySlug(raw)` → miss = 404; remove 301 canonicalization; fetch detail through a structured internal entry point instead of round-tripping an itemKey string.
4. **`src/services/rapService.ts`** — split `getItemDetail`: public key-based entry stays for API compat (`/api/pets/:key/history`), delegating to an identity-based internal function.
5. **Frontend** — `public/js/slugs.js`: `itemPath(slug)` without prefix args; `items.js` / `search.js` pass `item.slug`; `views/item.ejs`: remove chip generation + tile navigation/active-state code (tiles static); similar-tile links use plain slugs.
6. **Tests** — `tests/slug.test.ts` reduced to slugifier behavior; resolution tests in `tests/rapService.test.ts` become exact-match-only (including asserting prefixed forms do not resolve variants).

## Kept from the implemented redesign

Canonical lowercase slugifier; write-time global slug uniqueness + boot repair; server-sourced slugs in client JS; exact-match 404s; itemKey ↔ slug documented as separate encodings bridged only in route code.

## Problem summary (historical context)

Audit HIGH findings that motivated this work:
- **#8 — hijackable URLs**: prefix-first parsing made 30 live "Golden/Rainbow/Shiny …"-named items resolvable as the wrong item. Resolved structurally: variant tokens no longer exist in URL segments at all.
- **#7 — dual slugifiers**: frontend reimplemented slugification. Resolved: client JS consumes server-provided slugs; backend owns the one canonical slugifier.
- Cross-collection duplicate slugs resolved by unordered `LIMIT 1`. Resolved: global uniqueness enforced at write time + boot repair.
