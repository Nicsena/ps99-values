import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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

function argsOf(spy: ReturnType<typeof vi.spyOn>): string[] {
  return spy.mock.calls.map((c) => c.map((a) => String(a)).join(' '));
}

const TS = /^\[\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}(Z|[+-]\d{2}:\d{2})\]/;
function stripTime(line: string): string {
  return line.replace(TS, '').trimStart();
}

describe('logger namespaces', () => {
  let spies: Spies;

  beforeEach(() => {
    spies = spyConsole();
  });

  afterEach(() => {
    restore(spies);
    vi.resetModules();
  });

  it('sync catalog module emits the [sync.catalog] namespace', async () => {
    const { createLogger } = await import('../src/logger.js');
    const log = createLogger({ namespace: 'sync' }).child('catalog');
    log.warn('Pets', 'skipped', 2, 'malformed catalog entries');
    const lines = argsOf(spies.warn).map(stripTime);
    expect(lines).toEqual(['[sync.catalog] Pets skipped 2 malformed catalog entries']);
  });

  it('sync ingest module emits the [sync.ingest] namespace', async () => {
    const { createLogger } = await import('../src/logger.js');
    const log = createLogger({ namespace: 'sync' }).child('ingest');
    log.warn('rap', 3, 'feed entries matched no known item and were skipped');
    const lines = argsOf(spies.warn).map(stripTime);
    expect(lines).toEqual([
      '[sync.ingest] rap 3 feed entries matched no known item and were skipped',
    ]);
  });

  it('sync matching module emits the [sync.matching] namespace', async () => {
    const { createLogger } = await import('../src/logger.js');
    const log = createLogger({ namespace: 'sync' }).child('matching');
    log.warn('Coin', 'matches', 'Pets/Fruits', 'attributing to', 'Pets');
    const lines = argsOf(spies.warn).map(stripTime);
    expect(lines).toEqual(['[sync.matching] Coin matches Pets/Fruits attributing to Pets']);
  });

  it('sync retry module emits the [sync.retry] namespace', async () => {
    const { createLogger } = await import('../src/logger.js');
    const log = createLogger({ namespace: 'sync' }).child('retry');
    log.warn('attempt', 1, '/', 3, 'failed, retrying:', new Error('boom'));
    const lines = argsOf(spies.warn).map(stripTime);
    expect(lines[0]).toContain('[sync.retry]');
    expect(lines[0]).toContain('attempt 1 / 3 failed, retrying:');
    expect(lines[0]).toContain('Error: boom');
  });

  it('cron.jobs.sync emits the [cron.jobs.sync] namespace', async () => {
    const { createLogger } = await import('../src/logger.js');
    const log = createLogger({ namespace: 'cron' }).child('jobs').child('sync');
    log.info('sync done: collections=', 3, 'items=', 10, 'snapshots=', 4);
    const lines = argsOf(spies.log).map(stripTime);
    expect(lines).toEqual(['[cron.jobs.sync] sync done: collections= 3 items= 10 snapshots= 4']);
  });

  it('cron.jobs.prune emits the [cron.jobs.prune] namespace', async () => {
    const { createLogger } = await import('../src/logger.js');
    const log = createLogger({ namespace: 'cron' }).child('jobs').child('prune');
    log.info('pruned', 12, 'snapshots');
    const lines = argsOf(spies.log).map(stripTime);
    expect(lines).toEqual(['[cron.jobs.prune] pruned 12 snapshots']);
  });

  it('cache emits the [cache] namespace and an Error object captures stack', async () => {
    const { createLogger } = await import('../src/logger.js');
    const log = createLogger({ namespace: 'cache' });
    log.info('Redis cache is enabled');
    log.error(new Error('redis down'), 'unhandled error');
    expect(argsOf(spies.log).map(stripTime)).toEqual(['[cache] Redis cache is enabled']);
    const errLines = argsOf(spies.error).map(stripTime);
    expect(errLines[0]).toContain('[cache]');
    expect(errLines[0]).toContain('unhandled error');
    expect(errLines[0]).toContain('Error: redis down');
    expect(errLines[0]).toContain('at ');
  });

  it('routes.api emits the [routes.api] namespace', async () => {
    const { createLogger } = await import('../src/logger.js');
    const log = createLogger({ namespace: 'routes.api' });
    log.error(new Error('boom'), 'unhandled error');
    const lines = argsOf(spies.error).map(stripTime);
    expect(lines[0]).toContain('[routes.api]');
    expect(lines[0]).toContain('unhandled error');
    expect(lines[0]).toContain('Error: boom');
  });

  it('app emits the [app] namespace for startup and shutdown', async () => {
    const { createLogger } = await import('../src/logger.js');
    const log = createLogger({ namespace: 'app' });
    log.info('ps99-values listening on http://localhost:3000');
    log.info('Received', 'SIGTERM');
    expect(argsOf(spies.log).map(stripTime)).toEqual([
      '[app] ps99-values listening on http://localhost:3000',
      '[app] Received SIGTERM',
    ]);
  });
});
