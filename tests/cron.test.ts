import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const dbPath = join(tmpdir(), `ps99-cron-test-${Date.now()}-${process.pid}.db`);

type ClientModule = typeof import('../src/db/client.js');
type SettingsModule = typeof import('../src/services/settings.js');

let client: ClientModule;
let settings: SettingsModule;

beforeAll(async () => {
  process.env.DB_PATH = dbPath;
  client = await import('../src/db/client.js');
  client.ensureSchema();
  settings = await import('../src/services/settings.js');
});

afterAll(async () => {
  client?.sqlite.close();
  await rm(dbPath, { force: true });
  await rm(`${dbPath}-wal`, { force: true });
  await rm(`${dbPath}-shm`, { force: true });
});

describe('CronService', () => {
  it('registers, starts all with defaults, and supports runtime overrides', async () => {
    const { CronService } = await import('../src/services/cron/CronService.js');

    const expressions: string[] = [];
    const fakeScheduler = (expression: string) => {
      expressions.push(expression);
      return { stop() {} };
    };

    const service = new CronService(fakeScheduler);
    service.register([
      { name: 'a', description: 'Job A', defaultSchedule: '0 */6 * * *', run: async () => null },
      { name: 'b', description: 'Job B', defaultSchedule: '15 2 * * *', run: async () => null },
    ]);

    await service.startAll();
    expect(expressions).toContain('0 */6 * * *');
    expect(expressions).toContain('15 2 * * *');
    expect(service.isRunning('a')).toBe(true);
    expect(service.isRunning('b')).toBe(true);

    service.stopAll();
    expressions.length = 0;
    expect(await settings.setSetting('cron.jobs.a.schedule', '*/5 * * * *')).toBe(true);
    await service.startAll();
    expect(expressions).toContain('*/5 * * * *');

    service.stopAll();
    expressions.length = 0;
    expect(await settings.setSetting('cron.jobs.b.enabled', false)).toBe(true);
    await service.startAll();
    expect(expressions).not.toContain('15 2 * * *');
    expect(expressions).not.toContain('0 */6 * * *');
    expect(service.isRunning('b')).toBe(false);
  });

  it('master disable stops previously-running jobs and starts nothing', async () => {
    const { CronService } = await import('../src/services/cron/CronService.js');

    const expressions: string[] = [];
    const stopped: string[] = [];
    const service = new CronService((expression) => {
      expressions.push(expression);
      return { stop: () => stopped.push(expression) };
    });
    service.register([
      { name: 'a', description: 'Job A', defaultSchedule: '0 */6 * * *', run: async () => null },
      { name: 'b', description: 'Job B', defaultSchedule: '15 2 * * *', run: async () => null },
    ]);

    await settings.setSetting('cron.jobs.a.schedule', '0 */6 * * *');
    await settings.setSetting('cron.jobs.b.enabled', true);
    await service.startAll();
    expect(service.isRunning('a')).toBe(true);
    expect(service.isRunning('b')).toBe(true);

    await settings.setSetting('cron.enabled', false);
    expressions.length = 0;
    stopped.length = 0;
    await service.startAll();
    expect(expressions).toHaveLength(0);
    expect(stopped).toHaveLength(2);
    expect(service.isRunning('a')).toBe(false);
    expect(service.isRunning('b')).toBe(false);
  });

  it('supports startJob/stopJob/isRunning lifecycle and listJobs shape', async () => {
    const { CronService } = await import('../src/services/cron/CronService.js');

    const service = new CronService(() => ({ stop() {} }));
    service.register([
      { name: 'a', description: 'Job A', defaultSchedule: '0 */6 * * *', run: async () => null },
    ]);
    await settings.setSetting('cron.enabled', true);
    await settings.setSetting('cron.jobs.a.enabled', true);
    await settings.deleteSetting('cron.jobs.a.schedule');

    expect(service.isRunning('a')).toBe(false);
    expect(await service.startJob('a')).toBe(true);
    expect(service.isRunning('a')).toBe(true);
    expect(await service.startJob('a')).toBe(false);
    expect(service.stopJob('a')).toBe(true);
    expect(service.isRunning('a')).toBe(false);
    expect(service.stopJob('a')).toBe(false);
    expect(await service.startJob('nope')).toBe(false);

    await service.startJob('a');
    const jobs = await service.listJobs();
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toEqual({
      name: 'a',
      description: 'Job A',
      running: true,
      schedule: '0 */6 * * *',
      enabled: true,
    });

    await settings.setSetting('cron.jobs.a.enabled', false);
    const disabled = await service.listJobs();
    expect(disabled[0]?.enabled).toBe(false);
  });
});
