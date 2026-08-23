import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

process.env.DB_PATH = join(tmpdir(), `ps99-rapservice-test-${Date.now()}-${process.pid}.db`);

type ClientModule = typeof import('../src/db/client.js');
type SchemaModule = typeof import('../src/db/schema.js');
type RapServiceModule = typeof import('../src/services/rapService.js');
type ListingsModule = typeof import('../src/db/queries/listings.js');
type SnapshotsRepoModule = typeof import('../src/db/queries/snapshotsRepo.js');

let client: ClientModule;
let schema: SchemaModule;
let rapService: RapServiceModule;
let listings: ListingsModule;
let snapshotsRepo: SnapshotsRepoModule;

const DAY_MS = 86_400_000;
const NOW = 1_700_000_000_000;

const sec = (ms: number): number => Math.floor(ms / 1000);

beforeAll(async () => {
  client = await import('../src/db/client.js');
  client.ensureSchema();
  schema = await import('../src/db/schema.js');
  rapService = await import('../src/services/rapService.js');
  listings = await import('../src/db/queries/listings.js');
  snapshotsRepo = await import('../src/db/queries/snapshotsRepo.js');
});

afterAll(async () => {
  client?.sqlite.close();
  await rm(process.env.DB_PATH!, { force: true });
  await rm(`${process.env.DB_PATH!}-wal`, { force: true });
  await rm(`${process.env.DB_PATH!}-shm`, { force: true });
});

describe('buildMergedHistory', () => {
  it('merges series, carries forward values and computes chg/pct newest-first', () => {
    const rapRows = [
      { captured_at: sec(NOW), value: 150 },
      { captured_at: sec(NOW - DAY_MS * 2), value: 100 },
      { captured_at: sec(NOW - DAY_MS), value: 150 },
    ];
    const existsRows = [{ captured_at: sec(NOW - DAY_MS), value: 5 }];

    const merged = rapService.buildMergedHistory(rapRows, existsRows);

    expect(merged.map((p) => p.capturedAt)).toEqual([
      new Date(sec(NOW) * 1000).toISOString(),
      new Date(sec(NOW - DAY_MS) * 1000).toISOString(),
      new Date(sec(NOW - DAY_MS * 2) * 1000).toISOString(),
    ]);
    expect(merged[0]).toEqual({
      capturedAt: new Date(sec(NOW) * 1000).toISOString(),
      rap: 150,
      exists: 5,
      rapChg: 0,
      rapPct: 0,
    });
    expect(merged[1]).toEqual({
      capturedAt: new Date(sec(NOW - DAY_MS) * 1000).toISOString(),
      rap: 150,
      exists: 5,
      rapChg: 50,
      rapPct: 50,
    });
    expect(merged[2]).toEqual({
      capturedAt: new Date(sec(NOW - DAY_MS * 2) * 1000).toISOString(),
      rap: 100,
      exists: null,
      rapChg: null,
      rapPct: null,
    });
  });

  it('uses exact matches over carry-forward when timestamps collide', () => {
    const rapRows = [
      { captured_at: 10, value: 100 },
      { captured_at: 20, value: 120 },
    ];
    const existsRows = [{ captured_at: 20, value: 7 }];

    const merged = rapService.buildMergedHistory(rapRows, existsRows);

    expect(merged[0].rap).toBe(120);
    expect(merged[0].exists).toBe(7);
    expect(merged[1].exists).toBeNull();
  });

  it('returns null pct when previous rap is zero', () => {
    const merged = rapService.buildMergedHistory(
      [
        { captured_at: 10, value: 0 },
        { captured_at: 20, value: 50 },
      ],
      [],
    );
    expect(merged[0].rapChg).toBe(50);
    expect(merged[0].rapPct).toBeNull();
  });

  it('rounds pct to two decimals', () => {
    const merged = rapService.buildMergedHistory(
      [
        { captured_at: 10, value: 3 },
        { captured_at: 20, value: 10 },
      ],
      [],
    );
    expect(merged[0].rapChg).toBe(7);
    expect(merged[0].rapPct).toBe(233.33);
  });
});

describe('computeStats', () => {
  const baseRapRows = [
    { captured_at: sec(NOW - 40 * DAY_MS), value: 90 },
    { captured_at: sec(NOW - 25 * DAY_MS), value: 100 },
    { captured_at: sec(NOW - 12 * 3600_000), value: 200 },
    { captured_at: sec(NOW - 6 * 3600_000), value: 180 },
    { captured_at: sec(NOW - 3600_000), value: 220 },
  ];
  const baseExistsRows = [
    { captured_at: sec(NOW - 30 * 3600_000), value: 4 },
    { captured_at: sec(NOW - 2 * 3600_000), value: 5 },
  ];

  const baseStats = () =>
    rapService.computeStats(baseRapRows, baseExistsRows, NOW, {
      currentRap: 220,
      exists: 5,
      rapPoints: 9,
      existsPoints: 4,
    });

  it('computes 24h change against last snapshot older than 24h', () => {
    const stats = baseStats();
    expect(stats.rapChange24h).toBe(220 - 100);
    expect(stats.existsChange24h).toBe(5 - 4);
    expect(stats.rapChangePct24h).toBe(120);
    expect(stats.existsChangePct24h).toBe(25);
  });

  it('returns null change when no baseline older than 24h', () => {
    const recentOnly = [{ captured_at: sec(NOW - 3600_000), value: 200 }];
    const s = rapService.computeStats(recentOnly, [], NOW, {
      currentRap: 200,
      exists: null,
      rapPoints: 1,
      existsPoints: 0,
    });
    expect(s.rapChange24h).toBeNull();
    expect(s.existsChange24h).toBeNull();
    expect(s.rapChangePct24h).toBeNull();
    expect(s.existsChangePct24h).toBeNull();
  });

  it('computes window extremes and update counts', () => {
    const stats = baseStats();
    expect(stats.high24h).toBe(220);
    expect(stats.low24h).toBe(180);
    expect(stats.updates24h).toBe(3);
    expect(stats.high1m).toBe(220);
    expect(stats.low1m).toBe(100);
    expect(stats.ath).toBe(220);
    expect(stats.atl).toBe(90);
  });

  it('computes marketCap and rapPerCopy with placeholders', () => {
    const stats = baseStats();
    expect(stats.marketCap).toBe(1100);
    expect(stats.rapPerCopy).toBe(44);
    expect(stats.tracked).toBe(0);
    expect(stats.volatility30d).toBe(0);
    expect(stats.rapPoints).toBe(9);
    expect(stats.existsPoints).toBe(4);
  });

  it('omits marketCap/rapPerCopy when exists is missing or zero', () => {
    const s = rapService.computeStats(baseRapRows, [], NOW, {
      currentRap: 100,
      exists: 0,
      rapPoints: 5,
      existsPoints: 0,
    });
    expect(s.marketCap).toBe(0);
    expect(s.rapPerCopy).toBeNull();
  });
});

describe('data layer helpers', () => {
  let itemId: string;

  beforeAll(async () => {
    await client.db.insert(schema.collections).values({ name: 'Pets', enabled: true });
    itemId = 'item-1111-2222';
    await client.db.insert(schema.items).values({
      id: itemId,
      collectionName: 'Pets',
      name: 'Testicorn',
      description: null,
      category: null,
    });

    const rapSnap = (id: string, pt: number, shiny: boolean, value: number, at: number) =>
      client.db.insert(schema.rapSnapshots).values({
        id,
        itemId,
        itemKey: 'Testicorn',
        pt,
        shiny,
        value,
        capturedAt: new Date(at * 1000),
      });
    const existsSnap = (id: string, pt: number, shiny: boolean, value: number, at: number) =>
      client.db.insert(schema.existsSnapshots).values({
        id,
        itemId,
        itemKey: 'Testicorn',
        pt,
        shiny,
        value,
        capturedAt: new Date(at * 1000),
      });

    await rapSnap('r1', 0, false, 100, sec(NOW - 3000));
    await rapSnap('r2', 0, false, 150, sec(NOW - 2000));
    await rapSnap('r3', 0, false, 175, sec(NOW - 1000));
    await rapSnap('r4', 0, false, 999, sec(NOW - 500));
    await rapSnap('r5', 1, false, 500, sec(NOW - 100));

    await existsSnap('e1', 0, false, 5, sec(NOW - 3000));
    await existsSnap('e2', 0, false, 8, sec(NOW - 2000));
    await existsSnap('e3', 0, false, 12, sec(NOW - 1000));
    await existsSnap('e4', 1, false, 20, sec(NOW - 100));  });

  it('loads exists history ascending for a variant', async () => {
    const rows = await listings.existsHistoryFor(itemId, 0, 0);
    expect(rows.map((r) => r.value)).toEqual([5, 8, 12]);
  });

  it('counts true totals per variant', async () => {
    await expect(snapshotsRepo.countRapSnapshots(itemId, 0, 0)).resolves.toBe(4);
    await expect(snapshotsRepo.countExistsSnapshots(itemId, 0, 0)).resolves.toBe(3);
    await expect(snapshotsRepo.countRapSnapshots(itemId, 1, 0)).resolves.toBe(1);
    await expect(snapshotsRepo.countExistsSnapshots(itemId, 0, 1)).resolves.toBe(0);
  });

  it('sums latest exists across variants', async () => {
    await expect(listings.totalLatestExists(itemId)).resolves.toBe(12 + 20);
  });

  it('returns null total when item has no exists snapshots', async () => {
    await client.db.insert(schema.items).values({
      id: 'item-empty-3333',
      collectionName: 'Pets',
      name: 'Emptycorn',
    });
    await expect(listings.totalLatestExists('item-empty-3333')).resolves.toBeNull();
  });

  it('finds items by slug with exact and fuzzy fallback', async () => {
    const itemsRepo = await import('../src/db/queries/itemsRepo.js');
    const exact = await itemsRepo.findItemBySlug('Testicorn');
    expect(exact?.id).toBe(itemId);
    const fuzzy = await itemsRepo.findItemBySlug('testicorn');
    expect(fuzzy?.id).toBe(itemId);
    await expect(itemsRepo.findItemBySlug('does-not-exist')).resolves.toBeUndefined();
  });
});
