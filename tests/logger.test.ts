import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const ENV_KEYS = ['LOG_LEVEL', 'LOG_FORMAT', 'DEBUG', 'TZ'] as const;

function clearEnv(): void {
  for (const k of ENV_KEYS) delete process.env[k];
}

function setEnv(values: Partial<Record<(typeof ENV_KEYS)[number], string>>): void {
  for (const [k, v] of Object.entries(values)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
}

interface Spies {
  log: ReturnType<typeof vi.spyOn>;
  warn: ReturnType<typeof vi.spyOn>;
  error: ReturnType<typeof vi.spyOn>;
}

function spyConsole(): Spies {
  return {
    log: vi.spyOn(console, 'log').mockImplementation(() => {}),
    warn: vi.spyOn(console, 'warn').mockImplementation(() => {}),
    error: vi.spyOn(console, 'error').mockImplementation(() => {}),
  };
}

function restore(spies: Spies): void {
  spies.log.mockRestore();
  spies.warn.mockRestore();
  spies.error.mockRestore();
}

function argsOf(spy: ReturnType<typeof vi.spyOn>): unknown[] {
  return spy.mock.calls.map((c) => c.join(' '));
}

async function loadFreshLogger(): Promise<typeof import('../src/logger.js')> {
  vi.resetModules();
  return import('../src/logger.js');
}

// Regex: either an offset `±HH:MM` or `Z` after the milliseconds.
const ISO_TS = /^\[\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}(Z|[+-]\d{2}:\d{2})\]/;
const WINSTON_TS = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3}$/;

function stripTime(line: string): string {
  return line.replace(ISO_TS, '').trimStart();
}

// Returns the offset suffix of a bracketed ISO-8601 timestamp, e.g. "Z" or "+01:00" or "-07:00".
function offsetOf(line: string): string {
  const m = ISO_TS.exec(line);
  if (!m) throw new Error(`line does not start with a bracketed ISO timestamp: ${line}`);
  return m[1]!;
}

describe('logger', () => {
  let original: Record<(typeof ENV_KEYS)[number], string | undefined>;
  let spies: Spies;

  beforeEach(() => {
    original = {
      LOG_LEVEL: process.env.LOG_LEVEL,
      LOG_FORMAT: process.env.LOG_FORMAT,
      DEBUG: process.env.DEBUG,
      TZ: process.env.TZ,
    };
    clearEnv();
    spies = spyConsole();
  });

  afterEach(() => {
    restore(spies);
    setEnv(original);
    vi.resetModules();
  });

  // ---------- Level / DEBUG ----------

  it('default level is info: debug suppressed, info+ emitted', async () => {
    const { createLogger } = await loadFreshLogger();
    const log = createLogger({ namespace: 'sync' });
    log.debug('d');
    log.info('i');
    log.warn('w');
    log.error('e');
    expect(argsOf(spies.log).map(stripTime)).toEqual(['[sync] i']);
    expect(argsOf(spies.warn).map(stripTime)).toEqual(['[sync] w']);
    expect(argsOf(spies.error).map(stripTime)).toEqual(['[sync] e']);
  });

  it('LOG_LEVEL=warn silences debug and info, keeps warn/error/exception', async () => {
    setEnv({ LOG_LEVEL: 'warn' });
    const { createLogger } = await loadFreshLogger();
    const log = createLogger({ namespace: 'x' });
    log.debug('d');
    log.info('i');
    log.warn('w');
    log.error('e');
    log.exception(new Error('boom'));
    expect(argsOf(spies.log)).toEqual([]);
    expect(argsOf(spies.warn).map(stripTime)).toEqual(['[x] w']);
    const errLines = argsOf(spies.error);
    expect(errLines).toHaveLength(2);
    expect(stripTime(errLines[0] as string)).toBe('[x] e');
    expect(stripTime(errLines[1] as string)).toContain('[x]');
    expect(stripTime(errLines[1] as string)).toContain('Error: boom');
  });

  it('LOG_LEVEL=error silences debug/info/warn, keeps error/exception', async () => {
    setEnv({ LOG_LEVEL: 'error' });
    const { createLogger } = await loadFreshLogger();
    const log = createLogger({ namespace: 'x' });
    log.debug('d');
    log.info('i');
    log.warn('w');
    log.error('e');
    expect(argsOf(spies.log)).toEqual([]);
    expect(argsOf(spies.warn)).toEqual([]);
    expect(argsOf(spies.error).map(stripTime)).toEqual(['[x] e']);
  });

  it('LOG_LEVEL=exception silences everything except exception', async () => {
    setEnv({ LOG_LEVEL: 'exception' });
    const { createLogger } = await loadFreshLogger();
    const log = createLogger({ namespace: 'x' });
    log.debug('d');
    log.info('i');
    log.warn('w');
    log.error('e');
    log.exception(new Error('boom'));
    expect(argsOf(spies.log)).toEqual([]);
    expect(argsOf(spies.warn)).toEqual([]);
    const errLines = argsOf(spies.error);
    expect(errLines).toHaveLength(1);
    expect(stripTime(errLines[0] as string)).toContain('Error: boom');
  });

  it('LOG_LEVEL=silent silences exception too', async () => {
    setEnv({ LOG_LEVEL: 'silent' });
    const { createLogger } = await loadFreshLogger();
    const log = createLogger({ namespace: 'x' });
    log.debug('d');
    log.info('i');
    log.warn('w');
    log.error('e');
    log.exception(new Error('boom'));
    expect(argsOf(spies.log)).toEqual([]);
    expect(argsOf(spies.warn)).toEqual([]);
    expect(argsOf(spies.error)).toEqual([]);
  });

  it('DEBUG=sync gates debug to that namespace only when level is debug', async () => {
    setEnv({ LOG_LEVEL: 'debug', DEBUG: 'sync' });
    const { createLogger } = await loadFreshLogger();
    const sync = createLogger({ namespace: 'sync' });
    const other = createLogger({ namespace: 'cache' });
    sync.debug('hello');
    other.debug('nope');
    sync.info('info shows');
    expect(argsOf(spies.log).map(stripTime)).toEqual(['[sync] hello', '[sync] info shows']);
  });

  it('child() joins namespaces with .', async () => {
    const { createLogger } = await loadFreshLogger();
    const log = createLogger({ namespace: 'sync' }).child('ingest');
    log.info('hi');
    expect(stripTime(argsOf(spies.log)[0] as string)).toBe('[sync.ingest] hi');
  });

  // ---------- LOG_FORMAT / Error / Json ----------

  it('unknown LOG_LEVEL falls back to info and emits a startup warning', async () => {
    setEnv({ LOG_LEVEL: 'bogus' });
    const { createLogger } = await loadFreshLogger();
    const log = createLogger({ namespace: 'x' });
    log.debug('d');
    log.info('i');
    expect(argsOf(spies.log).map(stripTime)).toEqual(['[x] i']);
    expect(argsOf(spies.warn)).toEqual([
      expect.stringContaining('unknown LOG_LEVEL "bogus"'),
    ]);
  });

  it('exception(err) writes to console.error with namespace prefix and stack', async () => {
    const { createLogger } = await loadFreshLogger();
    const log = createLogger({ namespace: 'sync' });
    log.exception(new Error('boom'));
    const errOutput = argsOf(spies.error).join('\n');
    expect(errOutput).toContain('[sync]');
    expect(errOutput).toContain('Error: boom');
    expect(errOutput).toContain('at ');
  });

  it('exception(err, context, 42) appends context after the message line', async () => {
    const { createLogger } = await loadFreshLogger();
    const log = createLogger({ namespace: 'sync' });
    log.exception(new Error('boom'), 'while fetching', 42);
    const errOutput = argsOf(spies.error).join('\n');
    expect(errOutput).toContain('Error: boom');
    expect(errOutput).toContain('while fetching 42');
  });

  it('Error to error() in text mode renders name, message, and stack', async () => {
    const { createLogger } = await loadFreshLogger();
    const log = createLogger({ namespace: 'x' });
    const err = new TypeError('bad input');
    log.error(err);
    const text = argsOf(spies.error).join('\n');
    expect(text).toContain('[x]');
    expect(text).toContain('TypeError: bad input');
    expect(text).toContain('at ');
  });

  it('Error to error() in json mode emits err: { name, message, stack }', async () => {
    setEnv({ LOG_FORMAT: 'json' });
    const { createLogger } = await loadFreshLogger();
    const log = createLogger({ namespace: 'x' });
    const err = new TypeError('bad input');
    log.error(err);
    const lines = argsOf(spies.error);
    expect(lines).toHaveLength(1);
    const record = JSON.parse(lines[0] as string);
    expect(record.level).toBe('error');
    expect(record.ns).toBe('x');
    expect(typeof record.ts).toBe('string');
    expect(record.err).toEqual({
      name: 'TypeError',
      message: 'bad input',
      stack: expect.stringContaining('TypeError: bad input'),
    });
  });

  it('LOG_FORMAT=text (default) produces prefixed text, not JSON', async () => {
    const { createLogger } = await loadFreshLogger();
    const log = createLogger({ namespace: 'x' });
    log.info('hello', 'world');
    const line = argsOf(spies.log)[0] as string;
    expect(stripTime(line)).toBe('[x] hello world');
    expect(line).toMatch(ISO_TS);
  });

  it('LOG_FORMAT=json produces one parseable line per call with ts/level/ns/msg', async () => {
    setEnv({ LOG_FORMAT: 'json' });
    const { createLogger } = await loadFreshLogger();
    const log = createLogger({ namespace: 'sync' });
    log.info('started', 'sync', '(0 */1 * * *)');
    const lines = argsOf(spies.log);
    expect(lines).toHaveLength(1);
    const record = JSON.parse(lines[0] as string);
    expect(record.level).toBe('info');
    expect(record.ns).toBe('sync');
    expect(record.msg).toBe('started sync (0 */1 * * *)');
    expect(typeof record.ts).toBe('string');
    expect(new Date(record.ts).toString()).not.toBe('Invalid Date');
  });

  it('LOG_FORMAT=invalid falls back to text and emits a startup warning', async () => {
    setEnv({ LOG_FORMAT: 'yaml' });
    const { createLogger } = await loadFreshLogger();
    const log = createLogger({ namespace: 'x' });
    log.info('hello');
    expect(stripTime(argsOf(spies.log)[0] as string)).toBe('[x] hello');
    expect(argsOf(spies.warn)).toEqual([
      expect.stringContaining('unknown LOG_FORMAT "yaml"'),
    ]);
  });

  it('non-Error object args in json mode are stringified into msg', async () => {
    setEnv({ LOG_FORMAT: 'json' });
    const { createLogger } = await loadFreshLogger();
    const log = createLogger({ namespace: 'x' });
    log.info('payload:', { a: 1, b: 'two' });
    const lines = argsOf(spies.log);
    const record = JSON.parse(lines[0] as string);
    expect(record.msg).toBe('payload: {"a":1,"b":"two"}');
  });

  it('multiple non-Error args are space-joined in msg in both modes', async () => {
    const { createLogger } = await loadFreshLogger();
    const textLog = createLogger({ namespace: 'a' });
    textLog.info('one', 2, true);
    expect(stripTime(argsOf(spies.log)[0] as string)).toBe('[a] one 2 true');

    setEnv({ LOG_FORMAT: 'json' });
    const { createLogger: createLogger2 } = await loadFreshLogger();
    const jsonLog = createLogger2({ namespace: 'a' });
    jsonLog.info('one', 2, true);
    const record = JSON.parse(argsOf(spies.log).at(-1) as string);
    expect(record.msg).toBe('one 2 true');
  });

  // ---------- Timestamps (TZ) ----------

  it('text mode includes an ISO-8601 timestamp by default', async () => {
    const { createLogger } = await loadFreshLogger();
    const log = createLogger({ namespace: 'x' });
    log.info('hi');
    const line = argsOf(spies.log)[0] as string;
    expect(line).toMatch(ISO_TS);
  });

  it('TZ=America/Los_Angeles produces an offset matching the IANA zone', async () => {
    setEnv({ TZ: 'America/Los_Angeles' });
    const { createLogger } = await loadFreshLogger();
    const log = createLogger({ namespace: 'x' });
    log.info('hi');
    const line = argsOf(spies.log)[0] as string;
    expect(line).toMatch(ISO_TS);
    // DST-safe: LA is either -07:00 (PDT) or -08:00 (PST).
    expect(offsetOf(line)).toMatch(/^-0[78]:00$/);
  });

  it('TZ=Europe/London produces an offset matching the IANA zone', async () => {
    setEnv({ TZ: 'Europe/London' });
    const { createLogger } = await loadFreshLogger();
    const log = createLogger({ namespace: 'x' });
    log.info('hi');
    const line = argsOf(spies.log)[0] as string;
    expect(line).toMatch(ISO_TS);
    expect(offsetOf(line)).toMatch(/^(Z|\+0[01]:00)$/);
  });

  it('TZ=Not/A_Zone falls back to UTC and emits a startup warning', async () => {
    setEnv({ TZ: 'Not/A_Zone' });
    const { createLogger } = await loadFreshLogger();
    const log = createLogger({ namespace: 'x' });
    log.info('hi');
    const line = argsOf(spies.log)[0] as string;
    expect(line).toMatch(ISO_TS);
    expect(offsetOf(line)).toBe('Z');
    expect(argsOf(spies.warn)).toEqual([expect.stringContaining('unknown TZ "Not/A_Zone"')]);
  });

  it('json mode ts with no TZ ends in Z (UTC)', async () => {
    setEnv({ LOG_FORMAT: 'json' });
    const { createLogger } = await loadFreshLogger();
    const log = createLogger({ namespace: 'x' });
    log.info('hi');
    const record = JSON.parse(argsOf(spies.log)[0] as string);
    expect(record.ts).toMatch(/Z$/);
  });

  it('json mode ts with TZ=America/Los_Angeles ends with the offset', async () => {
    setEnv({ LOG_FORMAT: 'json', TZ: 'America/Los_Angeles' });
    const { createLogger } = await loadFreshLogger();
    const log = createLogger({ namespace: 'x' });
    log.info('hi');
    const record = JSON.parse(argsOf(spies.log)[0] as string);
    expect(record.ts).toMatch(/-0[78]:00$/);
  });

  // ---------- formatTimestamp option ----------

  it('formatTimestamp return value is used verbatim in text mode', async () => {
    const { createLogger } = await loadFreshLogger();
    const log = createLogger({
      namespace: 'x',
      formatTimestamp: () => 'T0',
    });
    log.info('hi');
    expect(argsOf(spies.log)).toEqual(['[T0] [x] hi']);
  });

  it('formatTimestamp overrides TZ even when TZ is set', async () => {
    setEnv({ TZ: 'America/Los_Angeles' });
    const { createLogger } = await loadFreshLogger();
    const log = createLogger({
      namespace: 'x',
      formatTimestamp: () => 'OVERRIDE',
    });
    log.info('hi');
    expect(argsOf(spies.log)).toEqual(['[OVERRIDE] [x] hi']);
  });

  it('formatTimestamp is honored in json mode', async () => {
    setEnv({ LOG_FORMAT: 'json' });
    const { createLogger } = await loadFreshLogger();
    const log = createLogger({
      namespace: 'x',
      formatTimestamp: () => 'CUSTOM',
    });
    log.info('hi');
    const record = JSON.parse(argsOf(spies.log)[0] as string);
    expect(record.ts).toBe('CUSTOM');
  });

  it('formatTimestamp is inherited by child loggers', async () => {
    const { createLogger } = await loadFreshLogger();
    const log = createLogger({
      namespace: 'parent',
      formatTimestamp: () => 'P',
    }).child('child');
    log.info('hi');
    expect(argsOf(spies.log)).toEqual(['[P] [parent.child] hi']);
  });

  it('formatTimestamp returning "" suppresses the time field and prefix', async () => {
    const { createLogger } = await loadFreshLogger();
    const textLog = createLogger({
      namespace: 'x',
      formatTimestamp: () => '',
    });
    textLog.info('hi');
    expect(argsOf(spies.log)).toEqual(['[x] hi']);

    setEnv({ LOG_FORMAT: 'json' });
    const { createLogger: createLogger2 } = await loadFreshLogger();
    const jsonLog = createLogger2({
      namespace: 'x',
      formatTimestamp: () => '',
    });
    jsonLog.info('hi');
    const record = JSON.parse(argsOf(spies.log).at(-1) as string);
    expect(record.ts).toBeUndefined();
  });

  // ---------- formats helper ----------

  it('formats.iso() matches the env-driven default when TZ is unset', async () => {
    const { createLogger, formats } = await loadFreshLogger();
    const log = createLogger({ namespace: 'x', formatTimestamp: formats.iso() });
    log.info('hi');
    const line = argsOf(spies.log)[0] as string;
    expect(line).toMatch(ISO_TS);
  });

  it('formats.isoUtc() always ends in Z, even with TZ=America/Los_Angeles', async () => {
    setEnv({ TZ: 'America/Los_Angeles' });
    const { createLogger, formats } = await loadFreshLogger();
    const log = createLogger({ namespace: 'x', formatTimestamp: formats.isoUtc() });
    log.info('hi');
    const line = argsOf(spies.log)[0] as string;
    expect(offsetOf(line)).toBe('Z');
  });

  it('formats.epoch() returns a numeric string close to Date.now()', async () => {
    const { formats } = await loadFreshLogger();
    const before = Date.now();
    const out = formats.epoch()(new Date());
    const after = Date.now();
    const n = Number(out);
    expect(Number.isFinite(n)).toBe(true);
    expect(n).toBeGreaterThanOrEqual(before);
    expect(n).toBeLessThanOrEqual(after);
  });

  it('formats.none() produces no time in either mode', async () => {
    const { createLogger, formats } = await loadFreshLogger();
    const textLog = createLogger({ namespace: 'x', formatTimestamp: formats.none() });
    textLog.info('hi');
    expect(argsOf(spies.log)).toEqual(['[x] hi']);

    setEnv({ LOG_FORMAT: 'json' });
    const { createLogger: createLogger2, formats: formats2 } = await loadFreshLogger();
    const jsonLog = createLogger2({ namespace: 'x', formatTimestamp: formats2.none() });
    jsonLog.info('hi');
    const record = JSON.parse(argsOf(spies.log).at(-1) as string);
    expect(record.ts).toBeUndefined();
    expect(record.msg).toBe('hi');
  });

  it('formats.local() matches the YYYY-MM-DD HH:mm:ss.SSS pattern', async () => {
    const { formats } = await loadFreshLogger();
    const out = formats.local()(new Date());
    expect(out).toMatch(WINSTON_TS);
  });

  // ---------- Pretty mode (LOG_FORMAT=pretty) ----------

  // Strip ANSI escape codes for substring assertions on un-colored output.
  // eslint-disable-next-line no-control-regex
  const ANSI = /\x1b\[[0-9;]*m/g;
  const stripAnsi = (s: string) => s.replace(ANSI, '');

  it('LOG_FORMAT=pretty is accepted (no startup warning) and writes through the right console method', async () => {
    setEnv({ LOG_FORMAT: 'pretty', FORCE_COLOR: '1' });
    const { createLogger } = await loadFreshLogger();
    const log = createLogger({ namespace: 'x' });
    log.info('hi');
    log.warn('careful');
    log.error('oops');
    // No startup warning about LOG_FORMAT.
    expect(argsOf(spies.warn).filter((s) => String(s).includes('unknown LOG_FORMAT'))).toEqual([]);
    // info→console.log, warn→console.warn, error→console.error.
    expect(argsOf(spies.log).length).toBe(1);
    expect(argsOf(spies.warn).length).toBe(1);
    expect(argsOf(spies.error).length).toBe(1);
  });

  it('pretty mode emits ANSI escape codes around the level and namespace', async () => {
    setEnv({ LOG_FORMAT: 'pretty' });
    const { createLogger } = await loadFreshLogger();
    const log = createLogger({ namespace: 'demo' });
    log.info('hello');
    const line = argsOf(spies.log)[0] as string;
    // Level "info" wrapped in ANSI (chalk.blue).
    // eslint-disable-next-line no-control-regex
    expect(line).toMatch(/\x1b\[34minfo\x1b\[39m/);
    // Namespace "demo" wrapped in ANSI (chalk.cyan).
    // eslint-disable-next-line no-control-regex
    expect(line).toMatch(/\x1b\[36m\[demo\]\x1b\[39m/);
    // Message body is plain.
    const stripped = stripAnsi(line);
    expect(stripped).toContain('hello');
  });

  it('pretty mode produces a [level] token in the line (after stripping ANSI)', async () => {
    setEnv({ LOG_FORMAT: 'pretty' });
    const { createLogger } = await loadFreshLogger();
    const log = createLogger({ namespace: 'x' });
    log.info('hello');
    const stripped = stripAnsi(argsOf(spies.log)[0] as string).replace(ISO_TS, '').trimStart();
    expect(stripped).toBe('[info] [x] hello');
  });

  it('pretty mode maps each level to its chalk color and shows the right label', async () => {
    setEnv({ LOG_FORMAT: 'pretty' });
    const { createLogger } = await loadFreshLogger();
    const log = createLogger({ namespace: 'x' });
    log.debug('d');
    log.info('i');
    log.warn('w');
    log.error('e');
    log.exception(new Error('boom'));
    const lines = [
      ...argsOf(spies.log),
      ...argsOf(spies.warn),
      ...argsOf(spies.error),
    ];
    const labels = lines.map(
      (l) => stripAnsi(String(l)).match(/\[(debug|info|warn|error|exception)\]/)?.[1],
    );
    expect(labels).toEqual(['info', 'warn', 'error', 'exception']);
    // Each visible label is wrapped in ANSI codes.
    // eslint-disable-next-line no-control-regex
    for (const l of lines) expect(String(l)).toMatch(/\x1b\[/);
  });

  it('LOG_FORMAT=invalid still falls back to text', async () => {
    setEnv({ LOG_FORMAT: 'yaml' });
    const { createLogger } = await loadFreshLogger();
    const log = createLogger({ namespace: 'x' });
    log.info('hello');
    expect(stripTime(argsOf(spies.log)[0] as string)).toBe('[x] hello');
    expect(argsOf(spies.warn)).toEqual([expect.stringContaining('unknown LOG_FORMAT "yaml"')]);
  });

  // ---------- setLevel / isLevelEnabled ----------

  it('setLevel("debug") enables debug output that was previously filtered at the default level', async () => {
    const { createLogger } = await loadFreshLogger();
    const log = createLogger({ namespace: 'x' });
    log.debug('hidden');
    expect(argsOf(spies.log)).toEqual([]);
    log.setLevel('debug');
    log.debug('visible');
    expect(argsOf(spies.log).map(stripTime)).toEqual(['[x] visible']);
  });

  it('setLevel("silent") silences everything, including exception', async () => {
    const { createLogger } = await loadFreshLogger();
    const log = createLogger({ namespace: 'x' });
    log.setLevel('silent');
    log.info('i');
    log.warn('w');
    log.error('e');
    log.exception(new Error('boom'));
    expect(argsOf(spies.log)).toEqual([]);
    expect(argsOf(spies.warn)).toEqual([]);
    expect(argsOf(spies.error)).toEqual([]);
  });

  it('setLevel throws on an unknown level name', async () => {
    const { createLogger } = await loadFreshLogger();
    const log = createLogger({ namespace: 'x' });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(() => log.setLevel('bogus' as any)).toThrow(TypeError);
  });

  it('isLevelEnabled reflects the current level and is true for all higher-severity levels', async () => {
    const { createLogger } = await loadFreshLogger();
    const log = createLogger({ namespace: 'x' });
    expect(log.isLevelEnabled('debug')).toBe(false);
    expect(log.isLevelEnabled('info')).toBe(true);
    expect(log.isLevelEnabled('warn')).toBe(true);
    expect(log.isLevelEnabled('error')).toBe(true);
    expect(log.isLevelEnabled('exception')).toBe(true);
    log.setLevel('debug');
    expect(log.isLevelEnabled('debug')).toBe(true);
    log.setLevel('error');
    expect(log.isLevelEnabled('warn')).toBe(false);
    expect(log.isLevelEnabled('error')).toBe(true);
  });

  it('isLevelEnabled throws on an unknown level name', async () => {
    const { createLogger } = await loadFreshLogger();
    const log = createLogger({ namespace: 'x' });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(() => log.isLevelEnabled('bogus' as any)).toThrow(TypeError);
  });

  it('setLevel on a parent does not affect a child created before the call', async () => {
    const { createLogger } = await loadFreshLogger();
    const parent = createLogger({ namespace: 'parent' });
    const child = parent.child('child');
    parent.setLevel('debug');
    child.debug('hidden');
    expect(argsOf(spies.log)).toEqual([]);
    parent.debug('visible');
    expect(argsOf(spies.log).map(stripTime)).toEqual(['[parent] visible']);
  });

  it('setLevel on a parent affects a child created after the call', async () => {
    const { createLogger } = await loadFreshLogger();
    const parent = createLogger({ namespace: 'parent' });
    parent.setLevel('debug');
    const child = parent.child('child');
    child.debug('visible');
    expect(argsOf(spies.log).map(stripTime)).toEqual(['[parent.child] visible']);
  });

  it('setLevel works in pretty mode', async () => {
    setEnv({ LOG_FORMAT: 'pretty' });
    const { createLogger } = await loadFreshLogger();
    const log = createLogger({ namespace: 'x' });
    log.setLevel('debug');
    log.debug('visible');
    // Strip ANSI and time to get the level + namespace + message tokens.
    const stripped = stripAnsi(argsOf(spies.log)[0] as string).replace(ISO_TS, '').trimStart();
    expect(stripped).toBe('[debug] [x] visible');
  });

  // ---------- timer ----------

  it('timer() returns a done() that logs "<label> finished in <N>ms" at info (default)', async () => {
    const { createLogger } = await loadFreshLogger();
    const log = createLogger({ namespace: 'x' });
    const done = log.timer('db query');
    // Small busy-wait so the elapsed time is > 0.
    const start = Date.now();
    while (Date.now() - start < 5) {
      /* spin */
    }
    done();
    const lines = argsOf(spies.log);
    expect(lines).toHaveLength(1);
    const stripped = stripTime(lines[0] as string);
    expect(stripped).toMatch(/^\[x\] db query finished in \d+ms$/);
  });

  it('timer(level) honors the level parameter (debug is filtered at default)', async () => {
    const { createLogger } = await loadFreshLogger();
    const log = createLogger({ namespace: 'x' });
    log.timer('task', 'debug')();
    expect(argsOf(spies.log)).toEqual([]);
  });

  it('timer(level) emits when setLevel includes that level', async () => {
    const { createLogger } = await loadFreshLogger();
    const log = createLogger({ namespace: 'x' });
    log.setLevel('debug');
    log.timer('task', 'debug')();
    const stripped = stripTime(argsOf(spies.log)[0] as string);
    expect(stripped).toMatch(/^\[x\] task finished in \d+ms$/);
  });

  it('timer() can be called multiple times (each logs independently)', async () => {
    const { createLogger } = await loadFreshLogger();
    const log = createLogger({ namespace: 'x' });
    const done = log.timer('tick');
    done();
    done();
    expect(argsOf(spies.log)).toHaveLength(2);
  });

  it('timer() throws on an unknown level', async () => {
    const { createLogger } = await loadFreshLogger();
    const log = createLogger({ namespace: 'x' });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(() => log.timer('task', 'bogus' as any)).toThrow(TypeError);
  });

  it('timer() in json mode produces a structured record', async () => {
    setEnv({ LOG_FORMAT: 'json' });
    const { createLogger } = await loadFreshLogger();
    const log = createLogger({ namespace: 'x' });
    log.timer('db query')();
    const record = JSON.parse(argsOf(spies.log)[0] as string);
    expect(record.level).toBe('info');
    expect(record.ns).toBe('x');
    expect(record.msg).toMatch(/^db query finished in \d+ms$/);
  });

  // ---------- timerFn ----------

  it('timerFn() resolves with the function return value and logs success at info', async () => {
    const { createLogger } = await loadFreshLogger();
    const log = createLogger({ namespace: 'x' });
    const result = await log.timerFn('add', () => 2 + 3);
    expect(result).toBe(5);
    expect(argsOf(spies.log)).toHaveLength(1);
    expect(stripTime(argsOf(spies.log)[0] as string)).toMatch(
      /^\[x\] add finished in \d+ms$/,
    );
  });

  it('timerFn() awaits async functions and returns the awaited value', async () => {
    const { createLogger } = await loadFreshLogger();
    const log = createLogger({ namespace: 'x' });
    const result = await log.timerFn('fetch', async () => {
      await new Promise((resolve) => setTimeout(resolve, 1));
      return 'data';
    });
    expect(result).toBe('data');
    expect(argsOf(spies.log)).toHaveLength(1);
  });

  it('timerFn() honors the level parameter (debug is filtered at default)', async () => {
    const { createLogger } = await loadFreshLogger();
    const log = createLogger({ namespace: 'x' });
    const result = await log.timerFn('task', () => 1, 'debug');
    expect(result).toBe(1);
    expect(argsOf(spies.log)).toEqual([]);
  });

  it('timerFn() catches synchronous throws, logs at error, and rethrows', async () => {
    const { createLogger } = await loadFreshLogger();
    const log = createLogger({ namespace: 'x' });
    const err = new Error('sync boom');
    await expect(
      log.timerFn('op', () => {
        throw err;
      }),
    ).rejects.toBe(err);
    const errLines = argsOf(spies.error);
    expect(errLines).toHaveLength(1);
    expect(stripTime(errLines[0] as string)).toMatch(/^\[x\] op failed after \d+ms Error: sync boom/);
  });

  it('timerFn() catches async rejections, logs at error, and rethrows', async () => {
    const { createLogger } = await loadFreshLogger();
    const log = createLogger({ namespace: 'x' });
    const err = new Error('async boom');
    await expect(
      log.timerFn('op', async () => {
        throw err;
      }),
    ).rejects.toBe(err);
    const errLines = argsOf(spies.error);
    expect(errLines).toHaveLength(1);
    expect(stripTime(errLines[0] as string)).toMatch(/^\[x\] op failed after \d+ms Error: async boom/);
  });

  it('timerFn() with setLevel("error") skips the success log but still logs the error', async () => {
    const { createLogger } = await loadFreshLogger();
    const log = createLogger({ namespace: 'x' });
    log.setLevel('error');
    const err = new Error('boom');
    await expect(
      log.timerFn('op', () => {
        throw err;
      }),
    ).rejects.toBe(err);
    expect(argsOf(spies.log)).toEqual([]);
    expect(argsOf(spies.error)).toHaveLength(1);
  });

  it('timerFn() throws on an unknown level', async () => {
    const { createLogger } = await loadFreshLogger();
    const log = createLogger({ namespace: 'x' });
    await expect(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      log.timerFn('op', () => 1, 'bogus' as any),
    ).rejects.toBeInstanceOf(TypeError);
  });

  it('timerFn() in json mode produces structured success and error records', async () => {
    setEnv({ LOG_FORMAT: 'json' });
    const { createLogger } = await loadFreshLogger();
    const log = createLogger({ namespace: 'x' });
    await log.timerFn('add', () => 5);
    const success = JSON.parse(argsOf(spies.log).at(-1) as string);
    expect(success.level).toBe('info');
    expect(success.msg).toMatch(/^add finished in \d+ms$/);

    const err = new Error('boom');
    await expect(
      log.timerFn('op', () => {
        throw err;
      }),
    ).rejects.toBe(err);
    const failure = JSON.parse(argsOf(spies.error).at(-1) as string);
    expect(failure.level).toBe('error');
    expect(failure.msg).toMatch(/^op failed after \d+ms Error: boom$/);
    expect(failure.err).toEqual({
      name: 'Error',
      message: 'boom',
      stack: expect.stringContaining('Error: boom'),
    });
  });
});
