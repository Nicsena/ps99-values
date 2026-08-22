import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import type * as Schema from '../src/db/schema.js';
import type * as Biggames from '../src/services/biggames.js';

const mocks = vi.hoisted(() => ({
  fetchCollections: vi.fn<() => Promise<string[]>>(),
  fetchCollection: vi.fn<(name: string) => Promise<Biggames.CollectionEntry[]>>(),
  fetchRap: vi.fn<() => Promise<Biggames.RapEntry[]>>(),
}));

vi.mock('../src/services/biggames.js', () => ({
  fetchCollections: mocks.fetchCollections,
  fetchCollection: mocks.fetchCollection,
  fetchRap: mocks.fetchRap,
}));

const dbPath = join(tmpdir(), `ps99-sync-test-${Date.now()}-${process.pid}.db`);

type ClientModule = typeof import('../src/db/client.js');
type SyncModule = typeof import('../src/services/sync.js');
type SettingsModule = typeof import('../src/services/settings.js');

let client: ClientModule;
let sync: SyncModule;
let settings: SettingsModule;
let schema: typeof Schema;

const petEntries: Biggames.CollectionEntry[] = [
  {
    configName: 'Unicorn',
    category: 'Pet',
    collection: 'Pets',
    configData: { id: 'Unicorn', name: 'Unicorn', description: 'A unicorn' },
  },
  {
    configName: 'Dragon',
    category: 'Pet',
    collection: 'Pets',
    configData: { id: 'Dragon', name: 'Dragon' },
  },
];

const eggEntries: Biggames.CollectionEntry[] = [];

beforeAll(async () => {
  process.env.DB_PATH = dbPath;
  client = await import('../src/db/client.js');
  client.ensureSchema();
  schema = await import('../src/db/schema.js');
  sync = await import('../src/services/sync.js');
  settings = await import('../src/services/settings.js');
  mocks.fetchCollections.mockResolvedValue(['Pets', 'Eggs', 'Decor']);
  mocks.fetchCollection.mockImplementation(async (name) =>
    name === 'Pets' ? petEntries : eggEntries,
  );
});

afterAll(async () => {
  client?.sqlite.close();
  await rm(dbPath, { force: true });
  await rm(`${dbPath}-wal`, { force: true });
  await rm(`${dbPath}-shm`, { force: true });
});

describe('syncAll', () => {
  it('seeds collections with only Pets enabled and inserts initial snapshots', async () => {
    mocks.fetchRap.mockResolvedValue([
      { category: 'Pet', value: 100, configData: { id: 'Unicorn' } },
      { category: 'Pet', value: 200, configData: { id: 'Dragon', pt: 1 } },
    ]);

    const result = await sync.syncAll();

    expect(result.collections).toBe(3);
    expect(result.itemsUpserted).toBe(2);
    expect(result.snapshotsInserted).toBe(2);

    const cols = await client.db.select().from(schema.collections);
    const byName = new Map(cols.map((c) => [c.name, c]));
    expect(byName.get('Pets')?.enabled).toBe(true);
    expect(byName.get('Eggs')?.enabled).toBe(false);
    expect(byName.get('Decor')?.enabled).toBe(false);

    const items = await client.db.select().from(schema.items).where(eq(schema.items.collectionName, 'Pets'));
    const itemNames = items.map((i) => i.name).sort();
    expect(itemNames).toEqual(['Dragon', 'Unicorn']);

    const snapshots = await client.db.select().from(schema.rapSnapshots);
    expect(snapshots).toHaveLength(2);
    const snapByKey = new Map(snapshots.map((s) => [s.itemKey, s]));
    expect(snapByKey.get('Unicorn')?.value).toBe(100);
    expect(snapByKey.get('Dragon:golden')?.value).toBe(200);
  });

  it('inserts a snapshot only for changed values on re-sync', async () => {
    mocks.fetchRap.mockResolvedValue([
      { category: 'Pet', value: 150, configData: { id: 'Unicorn' } },
      { category: 'Pet', value: 200, configData: { id: 'Dragon', pt: 1 } },
    ]);

    const result = await sync.syncAll();

    expect(result.snapshotsInserted).toBe(1);

    const unicorn = await client.db
      .select()
      .from(schema.items)
      .where(eq(schema.items.name, 'Unicorn'));
    const snapshots = await client.db.select().from(schema.rapSnapshots);
    const unicornSnaps = snapshots.filter((s) => s.itemId === unicorn[0].id);

    expect(snapshots).toHaveLength(3);
    expect(unicornSnaps.map((s) => s.value).sort((a, b) => a - b)).toEqual([100, 150]);

    const dragon = await client.db.select().from(schema.items).where(eq(schema.items.name, 'Dragon'));
    const dragonSnaps = snapshots.filter((s) => s.itemId === dragon[0].id);
    expect(dragonSnaps).toHaveLength(1);
    expect(dragonSnaps[0].value).toBe(200);
  });

  it('prunes snapshots older than the retention window', async () => {
    const unicorn = await client.db
      .select()
      .from(schema.items)
      .where(eq(schema.items.name, 'Unicorn'));

    const oldCapturedAt = new Date(Date.now() - 100 * 24 * 60 * 60 * 1000);
    await client.db.insert(schema.rapSnapshots).values({
      id: 'old-snapshot-1',
      itemId: unicorn[0].id,
      itemKey: 'Unicorn',
      pt: 0,
      shiny: false,
      value: 50,
      capturedAt: oldCapturedAt,
    });

    await settings.setSetting('snapshot.retentionDays', 90);

    const before = await client.db.select().from(schema.rapSnapshots);
    expect(before.some((s) => s.id === 'old-snapshot-1')).toBe(true);

    const deleted = await sync.pruneSnapshots();

    expect(deleted).toBeGreaterThanOrEqual(1);
    const after = await client.db.select().from(schema.rapSnapshots);
    expect(after.some((s) => s.id === 'old-snapshot-1')).toBe(false);
    expect(after.length).toBe(before.length - 1);
    expect(after.some((s) => s.value === 150)).toBe(true);
  });

  it('falls back to 90 day retention when setting is not positive', async () => {
    await settings.setSetting('snapshot.retentionDays', 0);
    const deletedZero = await sync.pruneSnapshots();
    expect(deletedZero).toBe(0);

    await settings.deleteSetting('snapshot.retentionDays');
    const deletedDefault = await sync.pruneSnapshots();
    expect(deletedDefault).toBe(0);
    const remaining = await client.db.select().from(schema.rapSnapshots);
    expect(remaining.length).toBeGreaterThan(0);
  });
});
