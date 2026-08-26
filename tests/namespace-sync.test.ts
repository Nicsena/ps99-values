import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type * as Schema from '../src/db/schema.js';
import type * as Biggames from '../src/services/biggames.js';

const mocks = vi.hoisted(() => ({
  fetchCollections: vi.fn<() => Promise<string[]>>(),
  fetchCollection: vi.fn<(name: string) => Promise<Biggames.FeedResult<Biggames.CollectionEntry>>>(),
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

const dbPath = join(tmpdir(), `ps99-namespace-test-${Date.now()}-${process.pid}.db`);

type ClientModule = typeof import('../src/db/client.js');
type SyncModule = typeof import('../src/services/sync/index.js');

let client: ClientModule;
let sync: SyncModule;
let schema: typeof Schema;

function entry(
  collection: string,
  configName: string,
  category: string,
  configData: Record<string, unknown> = {},
): Biggames.CollectionEntry {
  return { configName, category, collection, configData };
}

const catalogs: Record<string, Biggames.CollectionEntry[]> = {
  Pets: [
    entry('Pets', 'Banana', 'Uncategorized', { name: 'Banana' }),
    entry('Pets', 'Rainbow Swirl', 'Uncategorized', { name: 'Rainbow Swirl' }),
  ],
  Fruits: [
    entry('Fruits', 'Fruit | Banana', 'Fruits'),
    entry('Fruits', 'Fruit | Apple', 'Fruits'),
  ],
  Enchants: [
    entry('Enchants', 'Enchant | Coins', 'Enchants'),
    entry('Enchants', 'Enchant | Magnet', 'Enchants'),
    // Single-level enchant: only ever tn=1 upstream.
    entry('Enchants', 'Enchant | Double Coins', 'Exclusive'),
  ],
  Seeds: [entry('Seeds', 'Seed | Coin', 'Seeds', { name: 'Coin Plant Seed' })],
  Charms: [
    entry('Charms', 'Charm | Coins', 'Charms'),
    entry('Charms', 'Charm | TNT', 'Charms'),
  ],
  Potions: [
    entry('Potions', 'Potion | Coins', 'Potions'),
    entry('Potions', 'Potion | Huge', 'Potions'),
  ],
  MiscItems: [
    entry('MiscItems', 'Rainbow Swirl', 'Miscellaneous'),
    entry('MiscItems', 'TNT', 'Boosts'),
    // Flag names already carry their own suffix — no collision.
    entry('MiscItems', 'Coins Flag', 'Flags', { DisplayName: 'Coins Flag' }),
  ],
  Hoverboards: [entry('Hoverboards', 'Hoverboard | UFO', 'Hoverboards')],
  Ultimates: [entry('Ultimates', 'Ultimate | UFO', 'Ultimates')],
};

beforeAll(async () => {
  process.env.DB_PATH = dbPath;
  client = await import('../src/db/client.js');
  client.ensureSchema();
  schema = await import('../src/db/schema.js');
  sync = await import('../src/services/sync/index.js');

  mocks.fetchCollections.mockResolvedValue(Object.keys(catalogs));
  mocks.fetchCollection.mockImplementation(async (name) => feed(catalogs[name] ?? []));
  mocks.fetchRap.mockResolvedValue(feed([
    { category: 'Pet', value: 10, configData: { id: 'Banana', sh: true } },
    { category: 'Pet', value: 11, configData: { id: 'Banana' } },
    { category: 'Fruit', value: 20, configData: { id: 'Banana' } },
    { category: 'Fruit', value: 21, configData: { id: 'Banana', sh: true } },
    { category: 'Enchant', value: 30, configData: { id: 'Coins', tn: 3 } },
    { category: 'Enchant', value: 31, configData: { id: 'Coins', tn: 1 } },
    { category: 'Enchant', value: 32, configData: { id: 'Double Coins', tn: 1 } },
    { category: 'Charm', value: 40, configData: { id: 'Coins', tn: 1 } },
    { category: 'Charm', value: 41, configData: { id: 'TNT', tn: 1 } },
    { category: 'Potion', value: 60, configData: { id: 'Coins', tn: 2 } },
    { category: 'Potion', value: 61, configData: { id: 'Coins', tn: 1 } },
    { category: 'Seed', value: 80, configData: { id: 'Coin' } },
    { category: 'Misc', value: 50, configData: { id: 'Rainbow Swirl' } },
    { category: 'Misc', value: 51, configData: { id: 'TNT' } },
    { category: 'Misc', value: 52, configData: { id: 'Coins Flag' } },
    { category: 'Hoverboard', value: 70, configData: { id: 'UFO' } },
    { category: 'Ultimate', value: 71, configData: { id: 'UFO' } },
  ]));
  mocks.fetchExists.mockResolvedValue(feed([]));
});

afterAll(async () => {
  client?.sqlite.close();
  await rm(dbPath, { force: true });
  await rm(`${dbPath}-wal`, { force: true });
  await rm(`${dbPath}-shm`, { force: true });
});

async function row(collection: string, name: string, where?: Partial<Schema.Item>) {
  const rows = await client.db.select().from(schema.items).where(eqName(name));
  return rows.find(
    (r) =>
      r.collectionName === collection &&
      (where?.variant === undefined || r.variant === where.variant) &&
      (where?.shiny === undefined || r.shiny === where.shiny) &&
      (where?.tier === undefined || r.tier === where.tier),
  );
}

// drizzle eq helper kept local to avoid extra imports at top
import { eq } from 'drizzle-orm';
function eqName(name: string) {
  return eq(schema.items.name, name);
}

describe('namespace grammar end-to-end', () => {
  let result: import('../src/services/sync/index.js').SyncResult;

  it('syncs with grammar applied and feeds matched by category', async () => {
    result = await sync.syncAll();
    expect(result.errors).toEqual([]);
    expect(result.warnings.rap.ambiguousNames).toBe(0);
  });

  it('renames colliding fruit rows but keeps pets plain', async () => {
    const fruit = await row('Fruits', 'Banana');
    const pet = await row('Pets', 'Banana');
    expect(fruit?.displayName).toBe('Banana Fruit');
    expect(fruit?.slug).toBe('banana-fruit');
    expect(pet?.displayName).toBe('Banana');
    expect(pet?.slug).toBe('banana');

    const shinyFruit = await row('Fruits', 'Banana', { shiny: true });
    expect(shinyFruit?.displayName).toBe('Shiny Banana Fruit');
    expect(shinyFruit?.slug).toBe('shiny-banana-fruit');

    // Non-colliding fruits are still grammar'd (unconditional token).
    expect((await row('Fruits', 'Apple'))?.slug).toBe('apple-fruit');
  });

  it('addresses multi-level enchant tiers with bare Roman numerals', async () => {
    // Tier 1 collapses onto the base row, which is renamed to the tier-I
    // form so level 1 stays visible: "Coins I Enchant".
    const base = await row('Enchants', 'Coins');
    expect(base?.displayName).toBe('Coins I Enchant');
    expect(base?.slug).toBe('coins-i-enchant');
    expect(await snapshotValue(base!.id)).toBe(31);

    const tier3 = await row('Enchants', 'Coins', { tier: 3 });
    expect(tier3?.displayName).toBe('Coins III Enchant');
    expect(tier3?.slug).toBe('coins-iii-enchant');
    expect(await snapshotValue(tier3!.id)).toBe(30);

    const tier1Rows = await client.db
      .select()
      .from(schema.items)
      .where(eq(schema.items.name, 'Coins'));
    expect(
      tier1Rows.filter((r) => r.collectionName === 'Enchants' && r.tier === 1),
    ).toHaveLength(0);

    // Non-colliding enchants are still grammar'd.
    expect((await row('Enchants', 'Magnet'))?.slug).toBe('magnet-enchant');
  });

  it('collapses single-level enchants onto the base row with no tier naming', async () => {
    // "Double Coins" only ever has tn=1 upstream — the game shows no tier in
    // its name, so its data lives on the plain base row.
    const base = await row('Enchants', 'Double Coins');
    expect(base?.displayName).toBe('Double Coins Enchant');
    expect(base?.slug).toBe('double-coins-enchant');
    expect(await snapshotValue(base!.id)).toBe(32);

    const tierRows = await client.db
      .select()
      .from(schema.items)
      .where(eq(schema.items.name, 'Double Coins'));
    expect(tierRows.every((r) => r.tier === 0)).toBe(true);
  });

  it('collapses single-level charms onto the base row too', async () => {
    // Charms only ever carry tn=1 — same collapse rule as single-level
    // enchants.
    const charm = await row('Charms', 'Coins');
    expect(charm?.displayName).toBe('Coins Charm');
    expect(charm?.slug).toBe('coins-charm');
    expect(await snapshotValue(charm!.id)).toBe(40);

    const tierRows = await client.db
      .select()
      .from(schema.items)
      .where(eq(schema.items.name, 'Coins'));
    expect(tierRows.filter((r) => r.collectionName === 'Charms' && r.tier > 0)).toHaveLength(0);
  });

  it('keeps misc items plain when the whole collision group has tokens', async () => {
    // TNT collides with Charms (both tokened): MiscItems is keepsPlain, so
    // the bare "TNT"/tnt stays with MiscItems and Charms takes the token.
    const misc = await row('MiscItems', 'TNT');
    expect(misc?.displayName).toBe('TNT');
    expect(misc?.slug).toBe('tnt');
    expect(await snapshotValue(misc!.id)).toBe(51);

    const charm = await row('Charms', 'TNT');
    expect(charm?.displayName).toBe('TNT Charm');
    expect(charm?.slug).toBe('tnt-charm');
  });

  it('addresses potion tiers with the potion token', async () => {
    // Tier 1 collapses onto the base row, renamed to the tier-I form.
    const base = await row('Potions', 'Coins');
    expect(base?.displayName).toBe('Coins I Potion');
    expect(base?.slug).toBe('coins-i-potion');
    expect(await snapshotValue(base!.id)).toBe(61);

    const tier2 = await row('Potions', 'Coins', { tier: 2 });
    expect(tier2?.displayName).toBe('Coins II Potion');
    expect(tier2?.slug).toBe('coins-ii-potion');
    expect(await snapshotValue(tier2!.id)).toBe(60);

    // Non-colliding potions are still grammar'd; single-level "Huge" keeps
    // its data on the base row with no tier naming.
    const huge = await row('Potions', 'Huge');
    expect(huge?.slug).toBe('huge-potion');
    const hugeTiers = await client.db
      .select()
      .from(schema.items)
      .where(eq(schema.items.name, 'Huge'));
    expect(hugeTiers.every((r) => r.tier === 0)).toBe(true);
  });

  it('strips "Plant" from seed names and resolves their bare feed ids', async () => {
    const seed = await row('Seeds', 'Coin Seed');
    expect(seed?.displayName).toBe('Coin Seed');
    expect(seed?.slug).toBe('coin-seed');

    // Feed id is bare "Coin" with category "Seed": category filter excludes
    // the charm/enchant/potion candidates, then the suffixed lookup finds
    // "Coin Seed".
    expect(await snapshotValue(seed!.id)).toBe(80);
  });

  it('splits the UFO hoverboard from the UFO ultimate', async () => {
    const board = await row('Hoverboards', 'UFO');
    const ultimate = await row('Ultimates', 'UFO');
    expect(board?.displayName).toBe('UFO Hoverboard');
    expect(board?.slug).toBe('ufo-hoverboard');
    expect(ultimate?.displayName).toBe('UFO Ultimate');
    expect(ultimate?.slug).toBe('ufo-ultimate');
    // Feed entries attribute by category, not alphabetically.
    expect(await snapshotValue(board!.id)).toBe(70);
    expect(await snapshotValue(ultimate!.id)).toBe(71);
  });

  it('suffixes colliding misc items only, keeping flags untouched', async () => {
    const swirl = await row('MiscItems', 'Rainbow Swirl');
    const petSwirl = await row('Pets', 'Rainbow Swirl');
    expect(swirl?.slug).toBe('rainbow-swirl-item');
    expect(petSwirl?.slug).toBe('rainbow-swirl');
    expect(await snapshotValue(swirl!.id)).toBe(50);

    expect((await row('Charms', 'Coins'))?.slug).toBe('coins-charm');

    const flag = await row('MiscItems', 'Coins Flag');
    expect(flag?.slug).toBe('coins-flag');
    expect(flag?.displayName).toBe('Coins Flag');
    expect(await snapshotValue(flag!.id)).toBe(52);
  });
});

async function snapshotValue(itemId: number): Promise<number | null> {
  const snaps = await client.db
    .select()
    .from(schema.snapshots)
    .where(eq(schema.snapshots.itemId, itemId));
  return snaps.length > 0 ? snaps[0].value : null;
}
