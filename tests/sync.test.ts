import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import type * as Schema from '../src/db/schema.js';
import type * as Biggames from '../src/services/biggames.js';

const mocks = vi.hoisted(() => ({
  fetchCollections: vi.fn<() => Promise<string[]>>(),
  fetchCollection:
    vi.fn<(name: string) => Promise<Biggames.FeedResult<Biggames.CollectionEntry>>>(),
  fetchRap: vi.fn<() => Promise<Biggames.FeedResult<Biggames.RapEntry>>>(),
  fetchExists: vi.fn<() => Promise<Biggames.FeedResult<Biggames.RapEntry>>>(),
}));

vi.mock('../src/services/biggames.js', () => ({
  fetchCollections: mocks.fetchCollections,
  fetchCollection: mocks.fetchCollection,
  fetchRap: mocks.fetchRap,
  fetchExists: mocks.fetchExists,
}));

const feed = <T>(data: T[], invalid = 0): Biggames.FeedResult<T> => ({ data, invalid });

const dbPath = join(tmpdir(), `ps99-sync-test-${Date.now()}-${process.pid}.db`);

type ClientModule = typeof import('../src/db/client.js');
type SyncModule = typeof import('../src/services/sync/index.js');
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
    configData: {
      id: 'Unicorn',
      name: 'Unicorn',
      description: 'A unicorn',
      animations: {
        colorVariants: [
          { Id: 1, Name: 'Blue', Chance: 0.5 },
          { Id: 2, Name: 'Green' },
        ],
      },
    },
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
  sync = await import('../src/services/sync/index.js');
  settings = await import('../src/services/settings.js');
  mocks.fetchCollections.mockResolvedValue(['Pets', 'Eggs', 'Decor']);
  mocks.fetchCollection.mockImplementation(async (name) =>
    name === 'Pets' ? feed(petEntries) : feed(eggEntries),
  );
});

afterAll(async () => {
  client?.sqlite.close();
  await rm(dbPath, { force: true });
  await rm(`${dbPath}-wal`, { force: true });
  await rm(`${dbPath}-shm`, { force: true });
});

// Backdate snapshots so a follow-up sync lands on a different timestamp
// second (timestamps are stored at second precision).
async function ageSnapshots(seconds: number): Promise<void> {
  const snaps = await client.db.select().from(schema.snapshots);
  for (const s of snaps) {
    await client.db
      .update(schema.snapshots)
      .set({ capturedAt: new Date(s.capturedAt.getTime() - seconds * 1000) })
      .where(eq(schema.snapshots.id, s.id));
  }
}

// One row per variant; find a specific variant row of an item by dims.
async function itemRow(
  name: string,
  dims?: Partial<{ variant: number; shiny: boolean }>,
): Promise<Schema.Item | undefined> {
  const rows = await client.db.select().from(schema.items).where(eq(schema.items.name, name));
  return rows.find((r) => r.variant === (dims?.variant ?? 0) && r.shiny === (dims?.shiny ?? false));
}

describe('syncAll', () => {
  it('seeds collections with only Pets enabled and inserts initial snapshots', async () => {
    mocks.fetchRap.mockResolvedValue(
      feed([
        { category: 'Pet', value: 100, configData: { id: 'Unicorn' } },
        { category: 'Pet', value: 200, configData: { id: 'Dragon', pt: 1 } },
      ]),
    );
    mocks.fetchExists.mockResolvedValue(
      feed([
        { category: 'Pet', value: 5, configData: { id: 'Unicorn' } },
        { category: 'Pet', value: 3, configData: { id: 'Dragon', pt: 1 } },
      ]),
    );

    const result = await sync.syncAll();

    expect(result.collections).toBe(3);
    expect(result.itemsUpserted).toBe(2);
    expect(result.snapshotsInserted).toBe(2);
    expect(result.existsInserted).toBe(2);
    expect(result.errors).toEqual([]);
    expect(result.warnings.rap).toEqual({
      unmatchedEntries: 0,
      ambiguousNames: 0,
      malformedEntries: 0,
    });

    const cols = await client.db.select().from(schema.collections);
    const byName = new Map(cols.map((c) => [c.name, c]));
    expect(byName.get('Pets')?.enabled).toBe(true);
    // Eggs is part of the default enabled set.
    expect(byName.get('Eggs')?.enabled).toBe(true);
    expect(byName.get('Decor')?.enabled).toBe(false);

    // One row per variant: Unicorn primary + Dragon regular/golden.
    const items = await client.db.select().from(schema.items);
    const names = items.map((i) => i.name).sort();
    expect(names).toEqual(['Dragon', 'Dragon', 'Unicorn']);

    const unicorn = await itemRow('Unicorn');
    const dragonRegular = await itemRow('Dragon');
    const dragonGolden = await itemRow('Dragon', { variant: 1 });
    expect(unicorn?.slug).toBe('unicorn');
    expect(dragonRegular?.slug).toBe('dragon');
    // Variant slugs are stored at write time using the grammar.
    expect(dragonGolden?.slug).toBe('golden-dragon');
    expect(dragonGolden?.displayName).toBe('Golden Dragon');

    // Chroma color lists are stored per item; items without one get NULL.
    expect(JSON.parse(unicorn!.colorVariants ?? 'null')).toEqual([
      { id: 1, name: 'Blue', chance: 0.5 },
      { id: 2, name: 'Green', chance: null },
    ]);
    expect(dragonRegular?.colorVariants).toBeNull();

    const snaps = await client.db.select().from(schema.snapshots);
    const rapSnaps = snaps.filter((s) => s.metric === 'rap');
    expect(rapSnaps).toHaveLength(2);
    const existsSnaps = snaps.filter((s) => s.metric === 'exists');
    expect(existsSnaps).toHaveLength(2);

    expect(rapSnaps.find((s) => s.itemId === unicorn!.id)?.value).toBe(100);
    expect(rapSnaps.find((s) => s.itemId === dragonGolden!.id)?.value).toBe(200);
    expect(existsSnaps.find((s) => s.itemId === unicorn!.id)?.value).toBe(5);
    expect(existsSnaps.find((s) => s.itemId === dragonGolden!.id)?.value).toBe(3);
  });

  it('inserts a snapshot only for changed values on re-sync', async () => {
    await ageSnapshots(10);
    mocks.fetchRap.mockResolvedValue(
      feed([
        { category: 'Pet', value: 150, configData: { id: 'Unicorn' } },
        { category: 'Pet', value: 200, configData: { id: 'Dragon', pt: 1 } },
      ]),
    );
    mocks.fetchExists.mockResolvedValue(
      feed([
        { category: 'Pet', value: 5, configData: { id: 'Unicorn' } },
        { category: 'Pet', value: 3, configData: { id: 'Dragon', pt: 1 } },
      ]),
    );

    const result = await sync.syncAll();

    expect(result.snapshotsInserted).toBe(1);
    expect(result.existsInserted).toBe(0);

    const snaps = await client.db.select().from(schema.snapshots);
    const rapSnaps = snaps.filter((s) => s.metric === 'rap');
    expect(rapSnaps).toHaveLength(3);

    const unicorn = await itemRow('Unicorn');
    expect(
      rapSnaps
        .filter((s) => s.itemId === unicorn!.id)
        .map((s) => s.value)
        .sort((a, b) => a - b),
    ).toEqual([100, 150]);

    const existsSnaps = snaps.filter((s) => s.metric === 'exists');
    expect(existsSnaps).toHaveLength(2);
  });

  it('inserts exists snapshots when values change between runs', async () => {
    await ageSnapshots(10);
    mocks.fetchRap.mockResolvedValue(
      feed([{ category: 'Pet', value: 150, configData: { id: 'Unicorn' } }]),
    );
    mocks.fetchExists.mockResolvedValue(
      feed([{ category: 'Pet', value: 7, configData: { id: 'Unicorn' } }]),
    );

    const result = await sync.syncAll();

    expect(result.existsInserted).toBe(1);

    const snaps = await client.db.select().from(schema.snapshots);
    const unicorn = await itemRow('Unicorn');
    const unicornExists = snaps.filter((s) => s.metric === 'exists' && s.itemId === unicorn!.id);
    expect(unicornExists.map((s) => s.value).sort((a, b) => a - b)).toEqual([5, 7]);
  });

  it('stores chroma and tier variants as their own rows instead of collapsing them', async () => {
    await ageSnapshots(10);
    mocks.fetchRap.mockResolvedValue(
      feed([
        { category: 'Pet', value: 300, configData: { id: 'Dragon', cv: 1 } },
        { category: 'Pet', value: 400, configData: { id: 'Dragon', cv: 2 } },
        { category: 'Pet', value: 500, configData: { id: 'Dragon', tn: 3 } },
      ]),
    );
    mocks.fetchExists.mockResolvedValue(feed([]));

    await sync.syncAll();

    const items = await client.db.select().from(schema.items);
    const dragons = items.filter((i) => i.name === 'Dragon');
    const combos = dragons
      .map((r) => [r.chroma, r.tier] as const)
      .sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    expect(combos).toContainEqual([1, 0]);
    expect(combos).toContainEqual([2, 0]);
    expect(combos).toContainEqual([0, 3]);

    // Chroma/tier-only rows are not URL-addressable yet.
    expect(dragons.find((r) => r.chroma === 1)?.slug).toBeNull();
    expect(dragons.find((r) => r.tier === 3)?.slug).toBeNull();

    const snaps = await client.db.select().from(schema.snapshots);
    const values = snaps.filter((s) => s.metric === 'rap').map((s) => s.value);
    expect(values).toContain(300);
    expect(values).toContain(400);
    expect(values).toContain(500);
  });

  it('reports feed failures and does not advance lastSyncAt', async () => {
    const before = await settings.getSetting<string>('sync.lastSyncAt');

    mocks.fetchRap.mockRejectedValue(new Error('boom'));
    mocks.fetchExists.mockResolvedValue(
      feed([{ category: 'Pet', value: 9, configData: { id: 'Unicorn' } }]),
    );

    const result = await sync.syncAll();

    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain('RAP feed failed');
    expect(await settings.getSetting<string>('sync.lastSyncAt')).toBe(before);
  });

  it('advances lastSyncAt on healthy runs', async () => {
    mocks.fetchRap.mockResolvedValue(
      feed([{ category: 'Pet', value: 150, configData: { id: 'Unicorn' } }]),
    );
    mocks.fetchExists.mockResolvedValue(
      feed([{ category: 'Pet', value: 9, configData: { id: 'Unicorn' } }]),
    );

    const result = await sync.syncAll();
    expect(result.errors).toEqual([]);
    expect(await settings.getSetting<string>('sync.lastSyncAt')).not.toBeNull();
  });

  it('skips malformed feed entries and counts them instead of discarding the feed', async () => {
    await ageSnapshots(10);
    mocks.fetchRap.mockResolvedValue(
      feed([{ category: 'Pet', value: 160, configData: { id: 'Unicorn' } }], 2),
    );
    mocks.fetchExists.mockResolvedValue(
      feed([{ category: 'Pet', value: 9, configData: { id: 'Unicorn' } }]),
    );

    const result = await sync.syncAll();

    expect(result.errors).toEqual([]);
    expect(result.snapshotsInserted).toBe(1);
    expect(result.warnings.rap.malformedEntries).toBe(2);
  });

  it('reports unmatched entries in warnings', async () => {
    await ageSnapshots(10);
    mocks.fetchRap.mockResolvedValue(
      feed([
        { category: 'Pet', value: 165, configData: { id: 'Unicorn' } },
        { category: 'Pet', value: 999, configData: { id: 'MysteryItem' } },
      ]),
    );
    mocks.fetchExists.mockResolvedValue(
      feed([{ category: 'Pet', value: 9, configData: { id: 'Unicorn' } }]),
    );

    const result = await sync.syncAll();

    expect(result.warnings.rap.unmatchedEntries).toBe(1);
    expect(result.snapshotsInserted).toBe(1);
  });

  it('recovers from a transient feed failure via retry', async () => {
    await ageSnapshots(10);
    mocks.fetchRap.mockRejectedValueOnce(new Error('flaky'));
    mocks.fetchRap.mockResolvedValue(
      feed([{ category: 'Pet', value: 170, configData: { id: 'Unicorn' } }]),
    );
    mocks.fetchExists.mockResolvedValue(
      feed([{ category: 'Pet', value: 9, configData: { id: 'Unicorn' } }]),
    );

    const result = await sync.syncAll();

    expect(result.errors).toEqual([]);
    expect(result.snapshotsInserted).toBe(1);
  });

  it('prunes snapshots older than the retention window', async () => {
    const oldCapturedAt = new Date(Date.now() - 100 * 24 * 60 * 60 * 1000);
    const unicorn = await itemRow('Unicorn');
    await client.db.insert(schema.snapshots).values({
      itemId: unicorn!.id,
      metric: 'rap',
      value: 50,
      capturedAt: oldCapturedAt,
    });

    await settings.setSetting('snapshot.retentionDays', 90);

    const before = await client.db.select().from(schema.snapshots);
    const deleted = await sync.pruneSnapshots();

    expect(deleted).toBeGreaterThanOrEqual(1);
    const after = await client.db.select().from(schema.snapshots);
    expect(after.length).toBe(before.length - 1);
    expect(after.some((s) => s.value === 50)).toBe(false);
  });

  it('falls back to 90 day retention when setting is not positive', async () => {
    await settings.setSetting('snapshot.retentionDays', 0);
    expect(await sync.pruneSnapshots()).toBe(0);

    await settings.deleteSetting('snapshot.retentionDays');
    expect(await sync.pruneSnapshots()).toBe(0);
    const remaining = await client.db.select().from(schema.snapshots);
    expect(remaining.length).toBeGreaterThan(0);
  });
});
