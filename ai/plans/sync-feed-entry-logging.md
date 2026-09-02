# Per-entry debug logging for unmatched feed entries

Status: **Planning** — awaiting approval, not yet implemented
Created: 2026-09-01
Scope: add a per-feed-entry `debug` log line in the `rap` / `exists` ingest path so an operator running with `LOG_LEVEL=debug` can see which upstream ids were dropped and why. The existing aggregated `warn` summary and the `unmatchedEntries` counter are preserved unchanged.

## Background

`src/services/sync/ingest.ts:250-252` currently emits one summary line per metric:

```
[sync.ingest] rap 222 feed entries matched no known item and were skipped
[sync.ingest] exists 485 feed entries matched no known item and were skipped
```

These lines count the drops but say nothing about which ids were dropped, what variant dimensions they carried, or what the matcher considered before giving up. The upstream feed carries more items than the catalog describes (~700 per cycle); an operator investigating whether those drops are real (the catalog is behind) or noise (a token/grammar mismatch, an upstream schema change, a category rename) needs to see the actual dropped entries.

A first proposal emitted `unmatched <id> <category>` and `unmatched <id> <category> (no candidate covers category)`. That was rejected as too thin: the operator needs the metric, the value, the variant dimensions, the candidate set the matcher considered, and the reason for the drop on every line.

## Goal

Add one `log.debug(...)` line per unmatched feed entry, emitted from the ingest loop, carrying enough information to triage why it was dropped without re-deriving matcher state by hand. No change to the public matcher contract, the `unmatchedEntries` counter, the aggregated summary, or `IngestOutcome.warnings`.

## Explicit non-goals

- No change to the `EntryMatcher.match()` signature. The matcher's public contract stays `(upstreamId, category?) => MatchableItem | null`.
- No change to `IngestWarnings` / `IngestOutcome` — these are part of the sync API surface.
- No change to the aggregated summary log at `ingest.ts:250-252`. It remains the single `warn` line per metric.
- No change to the existing per-attribution `warn` lines in `matching.ts` (`name ... attributing to ...`, `... resolved via suffixed name ...`).
- No new `console.*` calls and no new top-level `log` instances; the per-entry log uses the existing `sync.ingest` namespace logger.
- No new env vars, no changes to `src/config.ts` or `.env.example`.

## Why emit from `ingest.ts`, not `matching.ts`

- The `metric` (`rap` / `exists`) is not visible inside `match()`. Threading it through would either change the matcher signature (touches `tests/matching.test.ts`, which calls `buildEntryMatcher` and `.match()` directly) or add a `setMetric(metric)` setter (extra mutable state on a module currently side-effect-free apart from counters and pre-existing `warn` lines).
- The full `entry` (`configData`, `value`, `category`) is in scope at the `ingest.ts:149` loop. Logging there is a one-liner.
- `matching.ts` stays I/O-free apart from its existing `warn` calls; the new diagnostic flows up via a small extension to `MatchWarnings` rather than via a new logger.

## Design

### 1. Extend `MatchWarnings` with a single optional diagnostic field

In `src/services/sync/matching.ts`:

```ts
export type UnmatchedReason = 'no-candidate' | 'category-mismatch';

export interface UnmatchedDetail {
  reason: UnmatchedReason;
  /** Collections the matcher considered before giving up. Empty for `no-candidate`. */
  ambiguousCandidates: string[];
  /** Whether the matcher attempted a `<id> <collectionToken>` suffixed lookup. */
  triedSuffixLookup: boolean;
}

export interface MatchWarnings {
  unmatchedEntries: number;
  ambiguousNames: number;
  /** Diagnostic for the most recent unmatched drop. Cleared on the next successful match. */
  lastUnmatched?: UnmatchedDetail;
}
```

Populated at the two unmatched-counter sites:

- `matching.ts:174-179` (no primary candidate, no alias candidate, no suffixed hit) — set `reason: 'no-candidate'`, `ambiguousCandidates: []`, `triedSuffixLookup: category !== undefined`.
- `matching.ts:197-210` (collision across collections, category not covered by any candidate, no suffixed hit) — set `reason: 'category-mismatch'`, `ambiguousCandidates: candidates.map(c => c.collectionName)` (the full pre-filter list), `triedSuffixLookup: true`.

Clear `lastUnmatched = undefined` at the top of every successful `match()` return so the field only carries data for the most recent drop. The ingest loop consumes it immediately after each `match()` call, so the "clear on success" guard is purely for shape honesty; it does not affect correctness.

`EntryMatcher.match()`'s signature and return type are unchanged. The matcher remains a pure function plus counters; the new field is informational and never consumed by tests as a contract.

### 2. Emit the per-entry debug log from the ingest loop

In `src/services/sync/ingest.ts`, replace the `if (!base) continue;` short-circuit with a debug emit that includes the metric, the full feed entry, and the matcher's diagnostic:

```ts
for (const entry of feed.data) {
  const base = matcher.match(entry.configData.id, entry.category);
  if (!base) {
    const detail = matcher.warnings().lastUnmatched;
    log.debug(
      metric,
      'unmatched',
      'id=', entry.configData.id,
      'category=', entry.category ?? '(none)',
      'value=', entry.value,
      'dims=', JSON.stringify({
        pt: entry.configData.pt,
        sh: entry.configData.sh,
        cv: entry.configData.cv,
        tn: entry.configData.tn,
      }),
      'reason=', detail?.reason ?? 'unknown',
      'candidates=[', detail?.ambiguousCandidates?.join('/') ?? '', ']',
      detail?.triedSuffixLookup ? 'suffixed=missed' : 'suffixed=skipped',
    );
    continue;
  }
  const dims = parseVariantFromRap(entry.configData);
  matched.push({ base, dims, value: entry.value });
}
```

The call uses the existing `log` at `ingest.ts:31` (`createLogger({ namespace: 'sync' }).child('ingest')`). No new imports.

### Output shape

With `LOG_LEVEL=debug` (or `LOG_LEVEL=debug DEBUG=sync.ingest`), per dropped feed entry:

```
[time] [sync.ingest] rap unmatched id=MysteryItem category=Pet value=999999 dims={"pt":0,"cv":0,"tn":1} reason=no-candidate candidates=[ ] suffixed=skipped
[time] [sync.ingest] exists unmatched id=Coins category=Currency value=123 dims={"pt":0,"sh":false,"cv":0,"tn":1} reason=category-mismatch candidates=[Charms/Enchants/Potions] suffixed=missed
```

The existing aggregated summary is unchanged:

```
[time] [sync.ingest] rap 222 feed entries matched no known item and were skipped
[time] [sync.ingest] exists 485 feed entries matched no known item and were skipped
```

### Performance

Per-entry cost is one extra `if (!base)` branch with a single `log.debug` call. `emit()` short-circuits when `debug` is not enabled (`logger.ts:178-190`, `logger.ts:257`), so production runs at the default `info` level pay nothing beyond a function call and a level check. The `JSON.stringify` over four small fields is the only allocation when debug is off, and the `dims=` argument is built unconditionally in the proposal above — see "Open questions" for a possible lazy-evaluation tweak.

## Files

- `src/services/sync/matching.ts` — extend `MatchWarnings` with `lastUnmatched?: UnmatchedDetail`; populate it at the two drop sites; clear it on successful match.
- `src/services/sync/ingest.ts` — emit the per-entry `log.debug(...)` line at the `if (!base) continue;` branch.
- `ai/plans/feed-entry-debug-log.md` (this file).
- No changes to `tests/`, `views/`, `public/`, `AGENTS.md`, `.env.example`, `package.json`, or Drizzle schema.

## Tests

The plan is to **not add new tests** for the per-entry log line itself. Justification:

- The existing tests in `tests/matching.test.ts` assert on `warnings().unmatchedEntries` and `warnings().ambiguousNames`. The new `lastUnmatched` field is additive and is `undefined` until populated; existing assertions continue to pass.
- `tests/sync.test.ts:305-321` (`'reports unmatched entries in warnings'`) exercises the ingest-loop drop path end-to-end. The new `log.debug` goes to `console.log` (not `console.warn`) and is not asserted on. The test continues to pass without modification.
- `tests/log-namespace.test.ts` only asserts on existing `warn` lines; the new line is `debug` and is not part of any namespace-identity test.

One watch-out: `tests/matching.test.ts:178` uses `expect(matcher.warnings()).toEqual({ unmatchedEntries: 0, ambiguousNames: 0 })` on a fresh matcher. Because `lastUnmatched` is `undefined` until a drop happens, Vitest's `toEqual` ignores `undefined` properties on objects, so the assertion passes unchanged. If a future Vitest version changes that behavior, the fix is to add `lastUnmatched: undefined` to the literal or to compare with `{ unmatchedEntries: 0, ambiguousNames: 0, lastUnmatched: undefined }` — both are one-line changes.

## Verification

1. `npm run typecheck`
2. `npm run lint`
3. `npm test` — full suite, including `matching.test.ts`, `sync.test.ts`, `log-namespace.test.ts`, and `logger.test.ts`.
4. Optional manual smoke: `LOG_LEVEL=debug DEBUG=sync.ingest npm run dev`, watch the cron-driven sync output, confirm per-entry `unmatched ...` lines appear alongside the existing aggregated summary.

## Risks / open questions

- **`dims` formatting.** `JSON.stringify` of the variant fields is stable and machine-parseable but dense. A key=value form (`pt=0 sh=false cv=0 tn=1`) is friendlier when grepping. Defaulting to `JSON.stringify` because it's a single shape downstream tools can rely on; the switch to key=value is a one-line change. *Decision: start with `JSON.stringify`; revisit if real output is too noisy.*
- **Eager `dims` allocation.** The `JSON.stringify(...)` argument is built on every drop, even when `debug` is off. Real cost is one small-object stringify per dropped entry (~hundreds per cycle), negligible. If profiling later shows it matters, gate the call on `log.isLevelEnabled('debug')` — but doing that now is premature optimization. *Decision: build unconditionally for readability; revisit if a profile points here.*
- **Field placement of the diagnostic.** `lastUnmatched` on `MatchWarnings` is the minimal-surface option. A separate `matcher.diagnostics()` accessor would make the debug-only intent explicit but adds API. *Decision: put it on `MatchWarnings`; mark with a JSDoc `@internal`-style comment in the implementation phase.*
- **Why not also include `vr` (raw variant blob).** The `vr` field on `configData` is `unknown` and untyped in `biggames.ts:22`. Including it in the debug line would surface untyped upstream noise. Skipping it keeps the line predictable; if a future investigation needs it, add it as a separate `vr=` field at that point.
- **No value formatting (thousands separators).** The aggregated `warn` summary doesn't use them, so the per-entry line matches house style. *Decision: no separators.*
- **Single `lastUnmatched` vs. an array.** Storing only the most recent drop is sufficient because `ingest.ts` reads and consumes it immediately. An array would need explicit clearing on every successful match and is harder to reason about. *Decision: single-value, cleared on success.*
