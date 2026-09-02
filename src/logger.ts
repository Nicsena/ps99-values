import chalk from 'chalk';

export type LogLevel = 'silent' | 'debug' | 'info' | 'warn' | 'error' | 'exception';
export type LogFormat = 'text' | 'json' | 'pretty';

export type TimestampFormatter = (date: Date) => string;

export interface Logger {
  debug(...args: unknown[]): void;
  info(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  error(...args: unknown[]): void;
  exception(err: Error, ...context: unknown[]): void;
  child(suffix: string): Logger;
  setLevel(level: LogLevel): void;
  isLevelEnabled(level: LogLevel): boolean;
  timer(label: string, level?: LogLevel): () => void;
  timerFn<T>(label: string, fn: () => Promise<T> | T, level?: LogLevel): Promise<T>;
}

export interface CreateLoggerOptions {
  namespace?: string;
  level?: LogLevel;
  format?: LogFormat;
  namespaces?: ReadonlySet<string>;
  formatTimestamp?: TimestampFormatter;
}

const LEVEL_WEIGHTS: Readonly<Record<LogLevel, number>> = {
  silent: 0,
  debug: 1,
  info: 2,
  warn: 3,
  error: 4,
  exception: 5,
};

function parseLevel(raw: string | undefined, fallback: LogLevel): LogLevel {
  if (raw === undefined) return fallback;
  const lower = raw.toLowerCase();
  if (lower in LEVEL_WEIGHTS) return lower as LogLevel;
  // Bootstrap: the logger isn't constructed yet, so this falls through to a
  // direct console.* call. Mirrors the same pattern used in src/config.ts for
  // invalid-environment reporting.
  console.warn(`[logger] unknown LOG_LEVEL "${raw}", falling back to "${fallback}"`);
  return fallback;
}

function parseFormat(raw: string | undefined, fallback: LogFormat): LogFormat {
  if (raw === undefined) return fallback;
  const lower = raw.toLowerCase();
  if (lower === 'text' || lower === 'json' || lower === 'pretty') return lower;
  // Bootstrap: see parseLevel above.
  console.warn(`[logger] unknown LOG_FORMAT "${raw}", falling back to "${fallback}"`);
  return fallback;
}

function parseNamespaces(raw: string | undefined): ReadonlySet<string> {
  if (!raw) return new Set();
  return new Set(
    raw
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0),
  );
}

function isValidTimezone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

function resolveTimezone(): string | null {
  const raw = process.env.TZ;
  if (!raw) return null;
  if (!isValidTimezone(raw)) {
    // Bootstrap: see parseLevel above.
    console.warn(`[logger] unknown TZ "${raw}", falling back to UTC`);
    return null;
  }
  return raw;
}

function isoWithTz(date: Date, tz: string | null): string {
  if (tz === null) return date.toISOString();
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    fractionalSecondDigits: 3,
  });
  const offsetFmt = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    timeZoneName: 'longOffset',
  });
  const parts: Record<string, string> = {};
  for (const p of fmt.formatToParts(date)) parts[p.type] = p.value;
  const offsetPart =
    offsetFmt.formatToParts(date).find((p) => p.type === 'timeZoneName')?.value ?? 'GMT';
  const offset = offsetPart === 'GMT' ? 'Z' : offsetPart.replace('GMT', '');
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}.${parts.fractionalSecond ?? '000'}${offset}`;
}

function isoUtc(date: Date): string {
  return date.toISOString();
}

function epoch(date: Date): string {
  return String(date.getTime());
}

function localStyle(date: Date): string {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    fractionalSecondDigits: 3,
  });
  const parts: Record<string, string> = {};
  for (const p of fmt.formatToParts(date)) parts[p.type] = p.value;
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:${parts.second}.${parts.fractionalSecond ?? '000'}`;
}

export const formats = {
  iso(): TimestampFormatter {
    const tz = resolveTimezone();
    return (date: Date) => isoWithTz(date, tz);
  },
  isoUtc(): TimestampFormatter {
    return (date: Date) => isoUtc(date);
  },
  epoch(): TimestampFormatter {
    return (date: Date) => epoch(date);
  },
  none(): TimestampFormatter {
    return () => '';
  },
  local(): TimestampFormatter {
    return (date: Date) => localStyle(date);
  },
};

interface ResolvedConfig {
  level: LogLevel;
  format: LogFormat;
  namespaces: ReadonlySet<string>;
  formatTimestamp: TimestampFormatter;
}

let cached: ResolvedConfig | null = null;

function resolveConfig(): ResolvedConfig {
  if (cached) return cached;
  const level = parseLevel(process.env.LOG_LEVEL, 'info');
  const format = parseFormat(process.env.LOG_FORMAT, 'text');
  const namespaces = parseNamespaces(process.env.DEBUG);
  // Pretty mode is opt-in via LOG_FORMAT=pretty; the user has chosen colors.
  // Override chalk's TTY/auto-detection so colors are emitted regardless of
  // whether stdout is a TTY.
  chalk.level = 1;
  cached = { level, format, namespaces, formatTimestamp: formats.iso() };
  return cached;
}

function isEnabled(
  messageLevel: LogLevel,
  config: ResolvedConfig,
  namespace: string,
): boolean {
  if (config.level === 'silent') return false;
  if (messageLevel === 'exception') return true;
  if (LEVEL_WEIGHTS[messageLevel] < LEVEL_WEIGHTS[config.level]) return false;
  if (config.level === 'debug' && config.namespaces.size > 0) {
    if (messageLevel === 'debug' && !config.namespaces.has(namespace)) return false;
  }
  return true;
}

function formatArg(arg: unknown): string {
  if (arg instanceof Error) {
    return `${arg.name}: ${arg.message}\n${arg.stack ?? ''}`;
  }
  if (typeof arg === 'string') return arg;
  if (typeof arg === 'number' || typeof arg === 'boolean' || typeof arg === 'bigint') {
    return String(arg);
  }
  if (arg === null) return 'null';
  if (arg === undefined) return 'undefined';
  try {
    return JSON.stringify(arg);
  } catch {
    return String(arg);
  }
}

function formatArgForMsg(arg: unknown): string {
  // For json mode's `msg` field: keep Error rendering compact (no stack) since
  // the structured `err` field carries the full stack.
  if (arg instanceof Error) return `${arg.name}: ${arg.message}`;
  return formatArg(arg);
}

function formatArgs(args: readonly unknown[]): string {
  return args.map(formatArg).join(' ');
}

function formatMsg(args: readonly unknown[]): string {
  return args.map(formatArgForMsg).join(' ');
}

function serializeError(err: Error): { name: string; message: string; stack: string } {
  return {
    name: err.name,
    message: err.message,
    stack: err.stack ?? `${err.name}: ${err.message}`,
  };
}

// Per-level color mapping for pretty mode. chalk.level is forced on in
// resolveConfig() so these colors are emitted regardless of TTY.
function colorizeLevel(level: LogLevel): string {
  switch (level) {
    case 'debug':
      return chalk.gray(level);
    case 'info':
      return chalk.blue(level);
    case 'warn':
      return chalk.yellow(level);
    case 'error':
      return chalk.red(level);
    case 'exception':
      return chalk.red.bold(level);
    case 'silent':
      return level;
  }
}

function emit(
  level: LogLevel,
  namespace: string,
  args: readonly unknown[],
  config: ResolvedConfig,
): void {
  if (!isEnabled(level, config, namespace)) return;
  const errArg = args.find((a) => a instanceof Error);
  const time = config.formatTimestamp(new Date());
  if (config.format === 'json') {
    const record: Record<string, unknown> = {
      level,
      msg: formatMsg(args),
    };
    if (time) record.ts = time;
    if (namespace) record.ns = namespace;
    if (errArg) record.err = serializeError(errArg as Error);
    const line = JSON.stringify(record);
    if (level === 'warn' || level === 'error' || level === 'exception') {
      console.error(line);
    } else {
      console.log(line);
    }
    return;
  }
  const nsPart = namespace ? `[${namespace}] ` : '';
  const timePart = time ? `[${time}] ` : '';
  if (config.format === 'pretty') {
    const levelPart = `[${colorizeLevel(level)}] `;
    const nsColored = namespace ? `${chalk.cyan(`[${namespace}]`)} ` : '';
    const line = timePart + levelPart + nsColored + formatArgs(args);
    if (level === 'error' || level === 'exception') {
      console.error(line);
    } else if (level === 'warn') {
      console.warn(line);
    } else {
      console.log(line);
    }
    return;
  }
  const line = timePart + nsPart + formatArgs(args);
  if (level === 'error' || level === 'exception') {
    console.error(line);
  } else if (level === 'warn') {
    console.warn(line);
  } else {
    console.log(line);
  }
}

function makeLogger(
  namespace: string,
  baseConfig: ResolvedConfig,
  overrides: Partial<ResolvedConfig>,
  initialLevel: LogLevel = overrides.level ?? baseConfig.level,
): Logger {
  // Per-logger mutable level. Children snapshot the parent's level at the
  // time of `child()`; subsequent `setLevel` on the parent does not
  // retroactively change pre-existing children, but a child created after
  // the parent's `setLevel` call sees the new value.
  const levelRef: { current: LogLevel } = { current: initialLevel };
  const local: ResolvedConfig = {
    level: initialLevel,
    format: overrides.format ?? baseConfig.format,
    namespaces: overrides.namespaces ?? baseConfig.namespaces,
    formatTimestamp: overrides.formatTimestamp ?? baseConfig.formatTimestamp,
  };
  return {
    debug: (...args) => emit('debug', namespace, args, local),
    info: (...args) => emit('info', namespace, args, local),
    warn: (...args) => emit('warn', namespace, args, local),
    error: (...args) => emit('error', namespace, args, local),
    exception: (err, ...context) => emit('exception', namespace, [err, ...context], local),
    child: (suffix) => {
      const next = namespace ? `${namespace}.${suffix}` : suffix;
      return makeLogger(next, baseConfig, overrides, levelRef.current);
    },
    setLevel: (level: LogLevel) => {
      if (!(level in LEVEL_WEIGHTS)) {
        throw new TypeError(`[logger] unknown level "${level}"`);
      }
      levelRef.current = level;
      local.level = level;
    },
    isLevelEnabled: (level: LogLevel) => {
      if (!(level in LEVEL_WEIGHTS)) {
        throw new TypeError(`[logger] unknown level "${level}"`);
      }
      return isEnabled(level, local, namespace);
    },
    timer: (label: string, level: LogLevel = 'info') => {
      if (!(level in LEVEL_WEIGHTS)) {
        throw new TypeError(`[logger] unknown level "${level}"`);
      }
      const start = Date.now();
      return () => {
        const ms = Date.now() - start;
        emit(level, namespace, [`${label} finished in ${ms}ms`], local);
      };
    },
    timerFn: async <T>(label: string, fn: () => Promise<T> | T, level: LogLevel = 'info') => {
      if (!(level in LEVEL_WEIGHTS)) {
        throw new TypeError(`[logger] unknown level "${level}"`);
      }
      const start = Date.now();
      try {
        const result = await fn();
        const ms = Date.now() - start;
        emit(level, namespace, [`${label} finished in ${ms}ms`], local);
        return result;
      } catch (err) {
        const ms = Date.now() - start;
        const errorArg = err instanceof Error ? err : new Error(String(err));
        emit('error', namespace, [`${label} failed after ${ms}ms`, errorArg], local);
        throw err;
      }
    },
  };
}

export function createLogger(opts: CreateLoggerOptions = {}): Logger {
  const baseConfig = resolveConfig();
  const overrides: Partial<ResolvedConfig> = {};
  if (opts.level !== undefined) overrides.level = opts.level;
  if (opts.format !== undefined) overrides.format = opts.format;
  if (opts.namespaces !== undefined) overrides.namespaces = opts.namespaces;
  if (opts.formatTimestamp !== undefined) overrides.formatTimestamp = opts.formatTimestamp;
  return makeLogger(opts.namespace ?? '', baseConfig, overrides);
}

export function rootLogger(): Logger {
  return createLogger();
}
