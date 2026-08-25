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

describe('parseItemKey', () => {
  it('parses variant flags', () => {
    expect(rapService.parseItemKey('Dragon')).toEqual({ name: 'Dragon', pt: 0, shiny: false, color: undefined });
    expect(rapService.parseItemKey('Dragon:golden:shiny')).toEqual({
      name: 'Dragon',
      pt: 1,
      shiny: true,
      color: undefined,
    });
  });

  it('accepts a chroma color token and lowercases it', () => {
    expect(rapService.parseItemKey('Huge Chroma Phoenix:shiny:blue')).toEqual({
      name: 'Huge Chroma Phoenix',
      pt: 0,
      shiny: true,
      color: 'blue',
    });
  });

  it('rejects keys with multiple unknown tokens', () => {
    expect(rapService.parseItemKey('X:mega:blue')).toBeNull();
    expect(rapService.parseItemKey(':golden')).toBeNull();
  });
});

describe('data layer helpers', () => {
  let itemId: number;
  let goldenVariantId: number;

  beforeAll(async () => {
    await client.db.insert(schema.collections).values({ name: 'Pets', enabled: true });
    const itemsRepo = await import('../src/db/queries/itemsRepo.js');
    // One row per variant: primary row + golden row, each with its own slug.
    itemId = await itemsRepo.upsertItem({ collectionName: 'Pets', name: 'Testicorn' });
    goldenVariantId = await itemsRepo.upsertItem({
      collectionName: 'Pets',
      name: 'Testicorn',
      variant: 1,
    });

    const snap = (itemIdArg: number, metric: 'rap' | 'exists', value: number, at: number) =>
      client.db.insert(schema.snapshots).values({
        itemId: itemIdArg,
        metric,
        value,
        capturedAt: new Date(at * 1000),
      });

    // Offsets chosen so each floored second is distinct (unique index).
    await snap(itemId, 'rap', 100, sec(NOW - 5000));
    await snap(itemId, 'rap', 150, sec(NOW - 4000));
    await snap(itemId, 'rap', 175, sec(NOW - 3000));
    await snap(itemId, 'rap', 999, sec(NOW - 2000));
    await snap(goldenVariantId, 'rap', 500, sec(NOW - 1000));

    await snap(itemId, 'exists', 5, sec(NOW - 5000));
    await snap(itemId, 'exists', 8, sec(NOW - 3000));
    await snap(itemId, 'exists', 12, sec(NOW - 2000));
    await snap(goldenVariantId, 'exists', 20, sec(NOW - 1000));

    emptyItemId = await itemsRepo.upsertItem({ collectionName: 'Pets', name: 'Emptycorn' });
  });

  let emptyItemId: number;

  it('assigns per-variant slugs at write time', async () => {
    const rows = await client.db.select().from(schema.items);
    const regular = rows.find((r) => r.id === itemId);
    const golden = rows.find((r) => r.id === goldenVariantId);
    expect(regular?.slug).toBe('testicorn');
    expect(golden?.slug).toBe('golden-testicorn');
    // Display-name prefixes ("Golden …") are applied by sync, not by upsertItem.
    expect(golden?.variant).toBe(1);
    void golden;
  });

  it('loads exists history ascending for a variant', async () => {
    const rows = await listings.existsHistoryFor(itemId);
    expect(rows.map((r) => r.value)).toEqual([5, 8, 12]);
  });

  it('counts true totals per variant row', async () => {
    await expect(snapshotsRepo.countSnapshots(itemId, 'rap')).resolves.toBe(4);
    await expect(snapshotsRepo.countSnapshots(itemId, 'exists')).resolves.toBe(3);
    await expect(snapshotsRepo.countSnapshots(goldenVariantId, 'rap')).resolves.toBe(1);
    await expect(snapshotsRepo.countSnapshots(null, 'rap')).resolves.toBe(0);
  });

  it('sums latest exists across variants', async () => {
    await expect(listings.totalLatestExists(itemId)).resolves.toBe(12 + 20);
  });

  it('returns null total when item has no exists snapshots', async () => {
    await expect(listings.totalLatestExists(emptyItemId)).resolves.toBeNull();
  });

  it('finds items and variants by exact canonical slug match', async () => {
    const itemsRepo = await import('../src/db/queries/itemsRepo.js');
    const exact = await itemsRepo.findItemBySlug('testicorn');
    expect(exact?.id).toBe(itemId);
    // Variant slugs are first-class addresses in the same table.
    const golden = await itemsRepo.findItemBySlug('golden-testicorn');
    expect(golden?.id).toBe(goldenVariantId);
    expect(golden?.variant).toBe(1);
    await expect(itemsRepo.findItemBySlug('does-not-exist')).resolves.toBeUndefined();
  });

  it('keeps slugs unique across sibling variant rows', async () => {
    const itemsRepo = await import('../src/db/queries/itemsRepo.js');
    const rows = await client.db.select().from(schema.items);
    const testicorns = rows.filter((r) => r.name === 'Testicorn').map((r) => r.slug);
    expect(new Set(testicorns).size).toBe(testicorns.length);

    // Re-upserting the same variant keeps its slug stable.
    const again = await itemsRepo.upsertItem({
      collectionName: 'Pets',
      name: 'Testicorn',
      variant: 1,
    });
    expect(again).toBe(goldenVariantId);
    void itemsRepo;
  });
});

describe('chroma detail resolution', () => {
  beforeAll(async () => {
    const itemsRepo = await import('../src/db/queries/itemsRepo.js');
    await itemsRepo.upsertItem({
      collectionName: 'Pets',
      name: 'Chromaticorn',
      // Non-standard ordering on purpose (mirrors Huge Chroma Lucki).
      colorVariants: JSON.stringify([
        { id: 1, name: 'Yellow', chance: 0.5 },
        { id: 2, name: 'Pink', chance: 0.5 },
      ]),
    });
    // Chroma variant as its own items row, addressed by its color name.
    const yellow = await itemsRepo.upsertItem({
      collectionName: 'Pets',
      name: 'Chromaticorn',
      chroma: 1,
      colorVariants: JSON.stringify([
        { id: 1, name: 'Yellow', chance: 0.5 },
        { id: 2, name: 'Pink', chance: 0.5 },
      ]),
    });
    await client.db.insert(schema.snapshots).values({
      itemId: yellow,
      metric: 'rap',
      value: 777,
      capturedAt: new Date(sec(NOW - 1000) * 1000),
    });
  });

  it('resolves color itemKeys to the matching chroma variant', async () => {
    const detail = await rapService.getItemDetail('Chromaticorn:yellow');
    expect(detail?.currentRap).toBe(777);
    expect(detail?.variants).toHaveLength(2); // primary + yellow
    const yellowVariant = detail!.variants.find((v) => v.chroma === 1);
    expect(yellowVariant?.color).toBe('Yellow');
    expect(yellowVariant?.itemKey).toBe('Chromaticorn:yellow');
    expect(yellowVariant?.slug).toBe('yellow-chromaticorn');
    const primary = detail!.variants.find((v) => v.chroma === 0);
    expect(primary?.color).toBeNull();
    expect(primary?.slug).toBe('chromaticorn');
  });

  it('hard-fails unknown color tokens without fallback', async () => {
    await expect(rapService.getItemDetail('Chromaticorn:blue')).resolves.toBeNull();
    // The slug-based entry shows the base view regardless of itemKeys.
    const base = await rapService.getItemDetailBySlug('chromaticorn');
    expect(base).not.toBeNull();
    // ':golden' parses as a pt flag, not a color; no golden row exists,
    // so resolution strictly fails instead of falling back to the base.
    await expect(rapService.getItemDetail('Chromaticorn:golden')).resolves.toBeNull();
  });

  it('lists all stored variants (including chroma) on the base detail', async () => {
    const detail = await rapService.getItemDetailBySlug('chromaticorn');
    expect(detail?.variants.map((v) => v.chroma).sort()).toEqual([0, 1]);
    // Chroma slugs resolve as first-class addresses.
    const viaSlug = await rapService.getItemDetailBySlug('yellow-chromaticorn');
    expect(viaSlug?.currentRap).toBe(777);
  });

  it('backfills chroma slugs for legacy rows with NULL slugs', async () => {
    const itemsRepo = await import('../src/db/queries/itemsRepo.js');
    // Simulate a pre-backfill row: chroma variant without a slug.
    await client.db.insert(schema.items).values({
      collectionName: 'Pets',
      name: 'Chromaticorn',
      chroma: 2,
      colorVariants: JSON.stringify([
        { id: 1, name: 'Yellow', chance: 0.5 },
        { id: 2, name: 'Pink', chance: 0.5 },
      ]),
      displayName: 'Pink Chromaticorn',
    });
    const assigned = await itemsRepo.repairVariantSlugs();
    expect(assigned).toBeGreaterThanOrEqual(1);
    const pink = await itemsRepo.findItemBySlug('pink-chromaticorn');
    expect(pink?.chroma).toBe(2);

    // Display names are repaired to "<label> <primary displayName>".
    const renamed = await itemsRepo.repairVariantDisplayNames();
    expect(renamed).toBeGreaterThanOrEqual(1);
    const pinkAfter = await itemsRepo.findItemBySlug('pink-chromaticorn');
    expect(pinkAfter?.displayName).toBe('Pink Chromaticorn');

    // Idempotent: second run assigns nothing new.
    const again = await itemsRepo.repairVariantSlugs();
    expect(again).toBe(0);
    expect(await itemsRepo.repairVariantDisplayNames()).toBe(0);
  });
});
