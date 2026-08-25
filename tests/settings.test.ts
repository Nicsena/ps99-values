import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const dbPath = join(tmpdir(), `ps99-settings-test-${Date.now()}-${process.pid}.db`);

type ClientModule = typeof import('../src/db/client.js');
type SettingsModule = typeof import('../src/services/settings.js');
type SchemaModule = typeof import('../src/db/schema.js');

let client: ClientModule;
let settings: SettingsModule;
let appSettings: SchemaModule['appSettings'];

beforeAll(async () => {
  process.env.DB_PATH = dbPath;
  client = await import('../src/db/client.js');
  client.ensureSchema();
  const schema = await import('../src/db/schema.js');
  appSettings = schema.appSettings;
  settings = await import('../src/services/settings.js');
});

afterAll(async () => {
  client?.sqlite.close();
  await rm(dbPath, { force: true });
  await rm(`${dbPath}-wal`, { force: true });
  await rm(`${dbPath}-shm`, { force: true });
});

describe('settings service', () => {
  it('returns defaults when no row exists', async () => {
    expect(await settings.getSetting<boolean>('sync.enabled')).toBe(true);
    expect(await settings.getSetting<number>('snapshot.retentionDays')).toBe(90);
    expect(await settings.getSetting<null>('sync.lastSyncAt')).toBeNull();
  });

  it('roundtrips a number setting', async () => {
    expect(await settings.setSetting('test.number', 42)).toBe(true);
    expect(await settings.getSetting<number>('test.number')).toBe(42);
  });

  it('roundtrips a boolean setting', async () => {
    expect(await settings.setSetting('test.bool', false)).toBe(true);
    expect(await settings.getSetting<boolean>('test.bool')).toBe(false);
    expect(await settings.setSetting('test.bool', true)).toBe(true);
    expect(await settings.getSetting<boolean>('test.bool')).toBe(true);
  });

  it('roundtrips a json object setting', async () => {
    const value = { nested: [1, 2, { key: 'value' }] };
    expect(await settings.setSetting('test.json', value)).toBe(true);
    expect(await settings.getSetting<typeof value>('test.json')).toEqual(value);
  });

  it('protects a setting from overwrite and deletion', async () => {
    expect(await settings.setSetting('test.protected', 'original', { protected: true })).toBe(true);
    expect(await settings.setSetting('test.protected', 'changed')).toBe(false);
    expect(await settings.deleteSetting('test.protected')).toBe(false);
    expect(await settings.getSetting<string>('test.protected')).toBe('original');
  });

  it('allows deleting a non-protected setting', async () => {
    expect(await settings.setSetting('test.deletable', 'x')).toBe(true);
    expect(await settings.deleteSetting('test.deletable')).toBe(true);
    expect(await settings.getSetting('test.deletable')).toBeNull();
  });

  it('returns null for unknown settings', async () => {
    expect(await settings.getSetting('does.not.exist')).toBeNull();
  });

  it('persists rows in the underlying table', async () => {
    const rows = await client.db.select().from(appSettings);
    const names = rows.map((r) => r.name);
    expect(names).toContain('test.protected');
    expect(names).not.toContain('test.deletable');
  });
});
