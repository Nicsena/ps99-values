# Chroma Color Labels Plan

Status: implemented (2026-08-24) — chroma slugs included: variants are addressed as `[shiny-][golden|rainbow-]<color>-<item-slug>` via per-item color maps; boot-time backfill assigns slugs to legacy rows
Created: 2026-08-24
Prerequisite: superseded — see Revision 2 of `database-redesign.md`
Scope: storage of upstream color metadata + API exposure + itemKey color token + chroma URL slugs

## Goal

Resolve upstream chroma levels (`cv` 1–6) to per-item color names so chroma variants can be identified and labeled.

## Background (verified against live upstream data, 2026-08-24)

- RAP/exists feeds carry `cv` as a bare integer; `vr` is empty. No color info exists in the feeds themselves.
- Each chroma pet's collection entry contains `configData.animations.colorVariants`: an array of `{ Id, Name, Desc, Chance }` where `Id` corresponds to the feed's `cv`.
- **The mapping is per-item, not global:**
  - Most chroma pets (Chroma Tiger/Phoenix, Huge Chroma Unicorn/Tiger/Swan/Butterfly/Phoenix/Snail/Ink Blob): Blue, Purple, Red, Orange, Yellow, Green
  - Huge Chroma Lucki / Huge Chroma Lucky Block Mimic: Yellow, Pink, Blue, Orange, Red, Purple
  - Huge Chroma Doodle Axolotl: Red, Blue, Green, Yellow, Cyan, Violet
- These pets set `"staticColorVariants": true` and `"preventGolden": true`; all chances are 1/6 today. Chroma combos are therefore limited to `{color}` and `Shiny-{color}`.
- The DB redesign's `item_variants.chroma` column already stores raw cv values; this plan only adds label resolution.

## Changes

### 1. Schema (`src/db/schema.ts` + migration)
- Add nullable `colorVariants` TEXT column on `items`.
- Content: JSON array `[{"id":1,"name":"Blue","chance":0.1667},…]`, fields **id + name + chance** (decided).
- NULL for non-chroma items (~12 items carry the data today; new ones may appear upstream).
- Generate via `npm run db:generate`; no data reset needed.

### 2. Sync (`src/services/sync.ts`, `collectionSpecs.ts`)
- In the collection-entry loop, extract + validate `animations.colorVariants`:
  - array of objects with numeric `Id` ≥ 1 and non-empty string `Name`;
  - pass through `Chance` when present and a finite number;
  - invalid/absent → NULL.
- Store serialized JSON in the new column via `upsertItem`. No additional upstream requests.

### 3. Read path (`itemsRepo.ts`, `listings.ts`, `rapService.ts`)
- Surface `v.chroma` on variant rows (read paths currently filter to primary variants only).
- In `rapService`, parse the parent item's stored JSON and resolve each chroma variant's `color` by matching cv → `id`.
- Additive response fields where applicable: `chroma: number`, `color: string | null`. Existing fields unchanged.

### 4. itemKey color token (decided)
- API itemKeys gain a `:{colorname-lowercase}` token, e.g. `"Huge Chroma Phoenix:blue"`.
- Parsing resolves the color name against the matched item's own stored color map → cv value; unknown names hard-fail (404), no silent fallback to base variant.
- `buildRapItemKey` gains an optional chroma/color parameter; `parseItemKey` accepts the token only when the resolved item defines it.

## Tests
- Sync stores colorVariants JSON for a mocked chroma entry; NULL otherwise.
- rapService resolves colors correctly, including the non-standard Lucki/Axolotl orderings.
- Unknown cv ids / unknown color tokens resolve to null color / 404 respectively.

## Verification
typecheck, lint, tests, build; boot and confirm detail responses include chroma variants with resolved colors and that `:blue`-style itemKeys resolve.

## Out of scope
- URL slugs for chroma variants: implemented (see above) — chroma rows are addressed as `[shiny-][golden|rainbow-][color-]<item-slug>`.
- Frontend rendering of chroma variants/color labels: partially done (detail-page tiles); list pages/filters still exclude chroma.
- **Future work — sync service rewrite**: `src/services/sync.ts` will be rewritten wholesale under a separate future plan. Chroma handling that rewrite must preserve:
  - `parseColorVariants()` extraction from `animations.colorVariants` at collection-sync time, stored as serialized JSON on every row of the item (base and variant rows).
  - Color resolution for variant labels/slugs goes through each item's own map (`readColorVariants` + per-item cv→name), never a global ordering.
  - Chroma rows with no resolvable color name stay NULL-slugged rather than being dropped or guessed.
- Displaying chroma variants in list pages/filters.
