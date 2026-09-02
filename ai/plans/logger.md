# Logger Module Plan

Status: **Approved (planning)** — not yet implemented
Created: 2026-09-01
Scope: introduce a leveled, namespaced logger module at `src/logger.ts`. No migrations of existing `console.*` call sites in this change.

## Goal

Add a single, focused logger module so future code (and follow-up PRs) has a leveled, namespaced logging primitive with:

- Level filtering via `LOG_LEVEL` (and per-namespace `DEBUG` gating).
- `LOG_FORMAT=text|json` output modes.
- ISO-8601 timestamps by default, with `TZ` env var support for offset-aware output.
- Programmatic timestamp customization via `createLogger({ formatTimestamp })`.
- A small `formats` helper that ships the common timestamp formatters (winston-style).

Existing `console.*` call sites stay untouched in this PR; the migration is a separate follow-up.

## Explicit non-goals

- No changes to `console.*` call sites in `src/`, `src/test/`, `public/js/`, or `views/`.
- No new runtime dependencies in `package.json`.
- No additions to the Zod config schema in `src/config.ts` or to `.env.example` — `LOG_LEVEL`, `LOG_FORMAT`, `DEBUG`, and `TZ` are read ad-hoc by the logger so this PR stays non-invasive.
- No whole-line `printf`-style customization (winston's full `format` chain). The time field is the only customizable piece.
- No `LOG_TIME_FORMAT` env var. Format customization is programmatic only.
- No changes to cron, sync, ingest, routes, or the inconsistency audit reports.

## Reference loggers (decision basis)

Cross-checked against **pino**, **winston**, and **bunyan** docs. All three agree on severity-ascending order `debug < info < warn < error < fatal`, default `info`, and `Error` as a first-class loggable carrying `name`/`message`/`stack`. Two numeric conventions exist (higher=more-severe in pino/bunyan; lower=more-severe in winston); the plan uses higher=more-severe to match pino/bunyan/RFC 5424.

- **pino** defaults: unix epoch ms; ISO-8601 is opt-in via `timestamp: stdTimeFunctions.isoTime`.
- **winston** defaults: no timestamp; when added, `new Date().toISOString()`; `format.timestamp({ format: fn })` accepts a function-typed custom formatter.
- **bunyan** defaults: ISO-8601 UTC with `Z` and ms precision. The closest reference to our default behavior.

`exception` is a deliberate rename of pino/bunyan's `fatal` (no flush-on-exit behavior, matching bunyan, not pino).

For timestamp formatting, this plan sits between pino (epoch, fast) and bunyan (ISO-8601, human-friendly) by adopting **bunyan-style ISO-8601 by default with `TZ` support** and adding **winston-style function-typed customization** for operators who need something different.

## Public surface

```ts
export type LogLevel = 'silent' | 'debug' | 'info' | 'warn' | 'error' | 'exception';
export type LogFormat = 'text' | 'json';

export type TimestampFormatter = (date: Date) => string;

export interface Logger {
  debug(...args: unknown[]): void;
  info(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  error(...args: unknown[]): void;
  exception(err: Error, ...context: unknown[]): void;
  child(suffix: string): Logger;
}

export interface CreateLoggerOptions {
  namespace?: string;
  level?: LogLevel;
  format?: LogFormat;
  namespaces?: ReadonlySet<string>;
  /** When set, takes over the time formatting entirely. `TZ` is ignored. */
  formatTimestamp?: TimestampFormatter;
}

export function createLogger(opts?: CreateLoggerOptions): Logger;
export function rootLogger(): Logger;

/** Built-in timestamp formatters. */
export const formats: {
  /** ISO-8601 with TZ-respecting offset; UTC `Z` when `TZ` is unset. The default. */
  iso(): TimestampFormatter;
  /** Always UTC ISO-8601 with `Z`. Ignores `TZ`. */
  isoUtc(): TimestampFormatter;
  /** Unix epoch milliseconds. Always UTC, no offset. Pino's default. */
  epoch(): TimestampFormatter;
  /** No timestamp. Returns the empty string; emit path drops the time field/prefix. */
  none(): TimestampFormatter;
  /** `YYYY-MM-DD HH:mm:ss.SSS` in process-local time. No offset. */
  local(): TimestampFormatter;
};
```

## Behavior

### Level order (numeric weights)

```
silent    = 0
debug     = 1
info      = 2
warn      = 3
error     = 4
exception = 5
```

A message at level `L` is emitted when `L >= configuredLevel && configuredLevel !== 'silent'`. The `exception` method bypasses the threshold and always writes to `console.error` (gated only by `silent`).

### `LOG_LEVEL` env var

- Unset → `info` (default). Matches pino/winston/bunyan defaults.
- `LOG_LEVEL=debug` → enables debug output.
- `LOG_LEVEL=silent` → silences everything, including `exception`.
- Unknown values → fall back to `info` and emit a single startup `console.warn`.

### `DEBUG` env var (per-namespace override)

- Comma-separated, e.g. `DEBUG=sync,cron`. Only active when `LOG_LEVEL` is unset or `debug`.
- When active, the `debug` method is gated to listed namespaces. The other methods are unaffected.
- Pattern borrowed from the `debug` npm package, not from pino/winston/bunyan (which have no built-in equivalent).

### `LOG_FORMAT` env var

- Accepted values: `'text'` (default), `'json'`. Case-insensitive.
- Unknown values → fall back to `text` and emit a single startup `console.warn`.

**Text mode output:**

```
[time] [ns] <args joined by space>
```

When the time formatter returns `''` (e.g. `formats.none()`), the `[time] ` prefix and its trailing space are dropped. When the namespace is also empty, the line is just `<args>`.

**Json mode output:** each call writes a single `JSON.stringify` of:

```json
{
  "ts": "2026-09-01T12:34:56.789-07:00",
  "level": "info",
  "ns": "sync",
  "msg": "started sync (0 */1 * * *)"
}
```

- `ts` — the timestamp from the active formatter (omitted when the formatter returns `''`).
- `level` — the level name.
- `ns` — full namespace (joined with `.`); omitted when empty.
- `msg` — the formatted message (space-joined args, `Error` serialization below).
- For `Error` args, an additional structured field is added instead of collapsing into `msg`:
  ```json
  "err": { "name": "Error", "message": "boom", "stack": "Error: boom\n  at …" }
  ```

### Timestamps

The active time source is selected in this order:

1. If `createLogger({ formatTimestamp })` is set → that function is used. `TZ` is ignored for that logger.
2. Otherwise → the env-driven default: ISO-8601 with `TZ`-resolved offset.

**Default ISO-8601 format:**

- `TZ` unset → `2026-09-01T19:34:56.789Z` (UTC, identical to bunyan's default).
- `TZ=America/Los_Angeles` → `2026-09-01T12:34:56.789-07:00` (or `-08:00` depending on DST).
- `TZ=Europe/London` → `2026-09-01T20:34:56.789+01:00` (or `+00:00`).
- `TZ=Not/A_Zone` → falls back to UTC and emits one startup `console.warn('[logger] unknown TZ "Not/A_Zone"')`.

Implementation uses `Intl.DateTimeFormat` with `formatToParts()` for predictable assembly. `DateTimeFormat` instances are constructed once at first use and cached.

### `Error` formatting (pino/winston/bunyan-aligned)

`Error` instances are detected via `err instanceof Error` for all methods.

- **Text mode** — `error(err)`, `warn(err)`, `info(err)`, `debug(err)` render as `${err.name}: ${err.message}\n${err.stack}`. Multi-line because the stack contains `\n`; matches current `console.error(err)` behavior in this codebase and the CLI rendering of pino's `err` serializer.
- **Json mode** — emits an `err: { name, message, stack }` field rather than collapsing into `msg`. Matches pino's `pino.stdSerializers.err` and bunyan's `err` field.
- **`exception(err, ...context)`** uses the same `Error` serialization, then appends any trailing context args. Always to `console.error`.

### Non-`Error` object args

- Plain objects: `JSON.stringify(arg)`, with a `try/catch` fallback to `String(arg)` for circular refs.
- Multiple args: space-joined in `msg` in both modes (no `printf`-style interpolation; matches pino v6+ default).

### Output targets

- `error` → `console.error`
- `warn` → `console.warn`
- `info` / `debug` → `console.log`
- `exception` → `console.error`

No per-level routing (single destination). Matches the current project's `console.*` usage.

### `formats` helper

| Helper | Example output | Notes |
| --- | --- | --- |
| `formats.iso()` | `2026-09-01T12:34:56.789-07:00` (or `Z` if `TZ` unset) | The default. Honors `TZ`. |
| `formats.isoUtc()` | `2026-09-01T19:34:56.789Z` | Always UTC. Ignores `TZ`. |
| `formats.epoch()` | `1756828496789` | Unix epoch ms. Pino's default. |
| `formats.none()` | `''` (omitted from output) | Suppresses the timestamp. |
| `formats.local()` | `2026-09-01 12:34:56.789` | Process-local time. Space separator, no offset. |

Each helper returns a fresh `TimestampFormatter` per call. `formats.iso()` and `formats.local()` use cached `Intl.DateTimeFormat` instances internally; per-call cost is just `formatToParts(date)`.

### `child(suffix)`

Returns a new logger whose namespace is the parent namespace joined with `.`. Inherits the parent's `formatTimestamp` (and any other options) — the format is per-logger and persists across `child()`.

### `rootLogger()`

Reads `LOG_LEVEL`, `LOG_FORMAT`, `DEBUG`, and `TZ` lazily on first call so tests that mutate `process.env.*` before importing get the right configuration. Cache the parsed values for the lifetime of the process.

## Files

- `src/logger.ts` (new, ~180–220 lines).
- `tests/logger.test.ts` (new).
- `AGENTS.md` (modified: `## Logging` section).
- `ai/plans/logger.md` (this file, modified).

No other files are added or modified in this PR.

## Tests — `tests/logger.test.ts`

### Level / DEBUG (7)

1. Default level `info`: `debug` suppressed, `info+` emitted.
2. `LOG_LEVEL=warn` silences `debug`/`info`, keeps `warn`/`error`/`exception`.
3. `LOG_LEVEL=error` silences `debug`/`info`/`warn`, keeps `error`/`exception`.
4. `LOG_LEVEL=exception` silences everything except `exception`.
5. `LOG_LEVEL=silent` silences `exception` too.
6. `DEBUG=sync` enables `debug` only for the `sync` namespace when level is `debug`.
7. `child()` joins namespaces with `.`.

### `LOG_FORMAT` (5)

8. Unknown `LOG_LEVEL` falls back to `info` and emits one startup `console.warn`.
9. `logger.exception(new Error('boom'))` writes to `console.error` with namespace prefix and the formatted message+stack.
10. `logger.exception(err, 'context', 42)` appends `context 42` after the message line.
11. `Error` to `error()` in text mode renders name, message, and stack.
12. `Error` to `error()` in json mode emits `err: { name, message, stack }` as a structured field.
13. `LOG_FORMAT=text` (default) produces prefixed text, not JSON.
14. `LOG_FORMAT=json` produces one parseable line per call with `ts`/`level`/`ns`/`msg` fields and no embedded `\n` in `msg` for non-Error args.
15. `LOG_FORMAT=invalid` falls back to `text` and emits a startup warning.
16. Non-`Error` object args in json mode are stringified into `msg`.
17. Multiple non-Error args are space-joined in `msg` in both modes.

### Timestamps (8)

18. Text mode includes an ISO-8601 timestamp matching `/^\[\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z?[+\-]\d{2}:\d{2}\|\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z\]/`.
19. With `TZ=America/Los_Angeles`, the timestamp ends with `-07:00` or `-08:00` (DST-safe).
20. With `TZ=Europe/London`, the timestamp ends with `+01:00` or `+00:00` (DST-safe).
21. With `TZ=Not/A_Zone`, the logger falls back to UTC and emits a startup warning.
22. Json mode `ts` with no `TZ` ends in `Z` (preserves the documented default).
23. Json mode `ts` with `TZ=America/Los_Angeles` ends with the offset (not `Z`).

### `formatTimestamp` (5)

24. `formatTimestamp` is called with a `Date` and its return value is used verbatim in text mode.
25. `formatTimestamp` overrides `TZ` even when `TZ=America/Los_Angeles` is set.
26. `formatTimestamp` is honored in json mode (`ts` is the formatter's return value).
27. `formatTimestamp` is inherited by `child()` loggers.
28. `formatTimestamp` returning `''` suppresses the time field/prefix in both modes.

### `formats` helper (5)

29. `formats.iso()` matches the env-driven default when `TZ` is unset (ends in `Z`).
30. `formats.isoUtc()` always ends in `Z`, even with `TZ=America/Los_Angeles` set.
31. `formats.epoch()` returns a numeric string parseable as a number close to `Date.now()`.
32. `formats.none()` produces no time (text mode output is `[ns] <args>`, json mode has no `ts` key).
33. `formats.local()` matches `/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3}$/`.

## Documentation

One-paragraph addition to `AGENTS.md` under a new `## Logging` section, placed after `## Config / environment`:

> The application provides a leveled, namespaced logger at `src/logger.ts`. The default log level is `info`, controlled by the `LOG_LEVEL` env var (`silent | debug | info | warn | error | exception`). The `DEBUG=sync,cron` env var gates `debug` output to listed namespaces (only active when `LOG_LEVEL` is unset or `debug`). The `LOG_FORMAT` env var selects output style: `text` (default, `[time] [ns] msg`) or `json` (one JSON object per line with `ts`/`level`/`ns`/`msg` and an `err` field for `Error` instances). Timestamps are ISO-8601 by default and honor the `TZ` env var; when `TZ` is unset, UTC `Z` is used. The timestamp can also be customized programmatically via `createLogger({ formatTimestamp })`; a small `formats` helper ships common formatters (`iso`, `isoUtc`, `epoch`, `none`, `local`). When `formatTimestamp` is set, it takes over and `TZ` is ignored for that logger. Existing `console.*` call sites are intentionally not migrated to the logger in this change; a follow-up PR will replace them.

## Verification

- `npm run typecheck`
- `npm run lint`
- `npm test -- logger` and the full suite (`npm test`) to confirm no incidental breakage
- `npm run build`

## Follow-ups (called out, not done)

1. Migrate the existing `console.*` call sites (~25 occurrences in `src/services/sync/**`, `src/services/cron/**`, `src/cache/index.ts`, `src/app.ts`, `src/index.ts`, `src/routes/api.ts`, `src/config.ts`) to `createLogger(...).info/.warn/.error/.exception`.
2. Add `LOG_LEVEL`, `LOG_FORMAT`, and `TZ` to the Zod schema in `src/config.ts` and `.env.example` (currently read ad-hoc inside the logger to keep this PR non-invasive).
3. Request-logging middleware for Express.
4. Optional: structured metadata in `child(meta: Record<string, unknown>)` to align with pino/winston/bunyan if future use cases need it.
5. Optional: pino-style `fatal` flush-on-exit behavior if the project ever needs log durability across crashes.
6. Optional: full `format` chain (winston parity, L2 from the planning discussion) if operators need whole-line customization.

## Pretty mode (implemented)

`LOG_FORMAT=pretty` ships a third output mode that wraps the text output in ANSI colors via `chalk` v5.

- **Triggered by**: `LOG_FORMAT=pretty`.
- **Chalk version**: `chalk` v5 (ESM-only, matches this project's `type: "module"` setup).
- **What's colored**: the level label (e.g. `info`, `warn`, `error`, `exception`) and the namespace. Timestamps and message bodies stay plain.
- **NO_COLOR**: not honored. `LOG_FORMAT=pretty` is itself the opt-in; selecting pretty means "I want colors." Operators who want plain text use `LOG_FORMAT=text`. `chalk.level` is forced to `1` in `resolveConfig()` so colors are emitted regardless of TTY.
- **Color mapping**:
  - `debug` → gray
  - `info` → blue
  - `warn` → yellow
  - `error` → red
  - `exception` → red bold
  - `silent` → no output
  - namespace → cyan
- **Json and plain text modes are unchanged.** Pretty mode is an additive third value for `LOG_FORMAT`.

## Iteration 2 (implemented): runtime level control

`setLevel(level)` and `isLevelEnabled(level)` on the `Logger` interface. Pino/winston/bunyan all have a way to change the level at runtime; this is a focused subset of that pattern.

- `setLevel(level: LogLevel): void` — mutates the logger's effective level. Children created before the call are not affected. Children created after the call see the new level. Throws `TypeError` on unknown level names.
- `isLevelEnabled(level: LogLevel): boolean` — returns whether a call at that level would emit. Reuses the existing `isEnabled` logic.
- No new env vars. Programmatic only.

## Iteration 3 (implemented): timer and timerFn

Two timing helpers on the `Logger` interface.

- `timer(label: string, level?: LogLevel): () => void` — returns a `done` closure that logs `"<label> finished in <N>ms"` at the given level. Default level is `info`.
- `timerFn<T>(label: string, fn: () => Promise<T> | T, level?: LogLevel): Promise<T>` — calls `fn()`, awaits the result, logs the success message at the given level, returns the result. On error (sync throw or async reject), logs `"<label> failed after <N>ms"` at `error` level with the error attached, and rethrows.
- Both validate the level name (throw `TypeError` on unknown).
- Both respect the current `LOG_LEVEL` and `LOG_FORMAT`.

**Reference**: No reference Node logger (pino/winston/bunyan) ships `timer()` or `timerFn()`. Winston's `profiler(label)` API exists but is a one-shot two-call shape with no error handling and no level control; the design here is strictly more usable.

## Deferred from iteration 2

The following were considered for iteration 2 but pulled out as too much for the current PR:

- **Splat / printf-style interpolation** (`log.info('user %s did %s', name, action)` via `util.format`). Useful for callers that want printf-style; can be added when there's a real need.
- **Redaction** (pino-style `redact: ['*.password']` to scrub sensitive paths from json output). Useful for defense-in-depth when logging upstream errors; can be added when there's a real need.

## Deferred from iteration 3

- **Winston-style `profiler(label)`** parity. The two-call start/end shape is more error-prone than the closure-based `timer()`. Skipped.

## Risks / open questions

- `LOG_LEVEL` / `LOG_FORMAT` / `DEBUG` / `TZ` are read lazily on first `rootLogger()` call. Tests that mutate `process.env.*` after the first call won't see the change. Acceptable; documented in this plan.
- Text-mode `Error` output is multi-line (stack has `\n`). Matches current `console.error(err)` output and pino's CLI rendering.
- `exception` is named differently from pino/bunyan's `fatal` and does **not** flush on exit. The divergence is intentional; can be revisited if a future use case requires it.
- `LOG_FORMAT=json` writes via `console.log`/`console.error`, not `stdout.write` directly. Line-buffering and async-write performance are not on par with pino's SonicBoom; not relevant at this project's log volume.
- `Intl.DateTimeFormat` with `longOffset` produces `GMT-07:00` / `GMT` for UTC. The plan normalizes `GMT` → `Z` and `GMT-07:00` → `-07:00`. Behavior is consistent across Node 16+ but ICU data on the host affects the result for non-trivial zones; the test for `TZ=Not/A_Zone` is the safety net.
- `formats.local()` returns process-local time, which is host-dependent. Documented behavior; not a bug. If a future use case needs `TZ`-aware local-style output, that's a separate helper.
