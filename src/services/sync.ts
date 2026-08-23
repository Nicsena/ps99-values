import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { db } from '../db/client.js';
import { items } from '../db/schema.js';
import {
  fetchCollection,
  fetchCollections,
  fetchExists,
  fetchRap,
  type RapEntry,
} from './biggames.js';
import { buildRapItemKey, parseVariantFromRap } from './itemKey.js';
import { parseGoldenImageId, parseImageId, parseShinyImageId, resolveItemNaming } from './collectionSpecs.js';
import { buildDetailSlug } from '../util/slug.js';
import { getSetting, setSetting } from './settings.js';
import {
  countCollections,
  enableCollection,
  getEnabledCollections,
  markSynced,
  upsertCollectionNames,
} from '../db/queries/collectionsRepo.js';
import { getBaseItemsWithCollection, upsertItem } from '../db/queries/itemsRepo.js';
import { slugify } from '../util/slug.js';
import {
  getLatestExistsValues,
  getLatestRapValues,
  insertExistsSnapshots,
  insertRapSnapshots,
  pruneSnapshotsOlderThan,
} from '../db/queries/snapshotsRepo.js';

export interface SyncResult {
  collections: number;
  itemsUpserted: number;
  snapshotsInserted: number;
  existsInserted: number;
}

let syncing: Promise<SyncResult> | null = null;

const DEFAULT_ENABLED_COLLECTIONS = [
  'Pets',
  'Boosts',
  'Booths',
  'Boxes',
  'Charms',
  'MiscItems',
  'Potions',
  'Seeds',
  'Ultimates',
  'XPPotions',
  'Lootboxes',
  'Hoverboards',
  'Fruits',
  'CardItems',
] as const;

async function seedCollections(): Promise<number> {
  const names = await fetchCollections();
  const wasEmpty = (await countCollections()) === 0;
  await upsertCollectionNames(names);
  if (wasEmpty) {
    for (const name of DEFAULT_ENABLED_COLLECTIONS) {
      await enableCollection(name);
    }
  }
  return names.length;
}

export async function bootstrapIfNeeded(): Promise<void> {
  try {
    if ((await countCollections()) === 0) {
      await seedCollections();
    }
    await backfillItemSlugs();
  } catch (err) {
    console.error('[sync] bootstrap failed:', err);
  }
}

async function backfillItemSlugs(): Promise<void> {
  const rows = await db
    .select({
      id: items.id,
      name: items.name,
      slug: items.slug,
      variant: items.variant,
      shiny: items.shiny,
    })
    .from(items);
  for (const row of rows) {
    const expected = row.variant || row.shiny
      ? buildDetailSlug(row.name, row.variant, row.shiny)
      : slugify(row.name);
    if (row.slug !== expected) {
      await db.update(items).set({ slug: expected }).where(eq(items.id, row.id));
    }
  }
}

async function runSync(): Promise<SyncResult> {
  const enabledSetting = await getSetting<boolean>('sync.enabled');
  if (enabledSetting === false) {
    throw new Error('sync disabled');
  }

  let collectionsSeeded = 0;
  try {
    collectionsSeeded = await seedCollections();
  } catch (err) {
    console.error('[sync] collection seeding failed:', err);
  }

  const enabledCollections = await getEnabledCollections();

  let itemsUpserted = 0;
  const goldenImageIds = new Map<string, number | null>();
  const shinyImageIds = new Map<string, number | null>();

  for (const { name } of enabledCollections) {
    let entries;
    try {
      entries = await fetchCollection(name);
    } catch (err) {
      console.error(`[sync] failed to fetch collection ${name}:`, err);
      continue;
    }
    for (const entry of entries) {
      const { name: displayName, description, usedFallback } = resolveItemNaming(
        name,
        entry.configName,
        entry.configData,
      );
      if (!displayName) continue;
      if (usedFallback) {
        console.warn(`[sync] ${name}: no name key matched for "${entry.configName}", used configName`);
      }
      const cd = entry.configData;
      const imageId = parseImageId(cd);
      goldenImageIds.set(`${name}:${displayName}`, parseGoldenImageId(cd));
      shinyImageIds.set(`${name}:${displayName}`, parseShinyImageId(cd));
      await upsertItem({
        collectionName: name,
        name: displayName,
        displayName,
        description,
        imageId,
        hidden: cd.hidden === true,
        huge: cd.huge === true,
        titanic: cd.titanic === true,
        gargantuan: cd.gargantuan === true,
      });
      itemsUpserted += 1;
    }
    await markSynced(name);
  }

  const enabledItems = await getBaseItemsWithCollection();

  const byName = new Map<string, typeof enabledItems>();
  for (const item of enabledItems) {
    const list = byName.get(item.name) ?? [];
    list.push(item);
    byName.set(item.name, list);
  }

  const variantItemIds = new Map<string, string>();
  async function resolveItemId(
    base: (typeof enabledItems)[number],
    pt: number,
    shiny: boolean,
  ): Promise<string> {
    if (!pt && !shiny) return base.id;
    const key = `${base.collectionName}:${base.name}:${pt}:${shiny ? 1 : 0}`;
    const existing = variantItemIds.get(key);
    if (existing) return existing;
    const variantLabel = [shiny ? 'Shiny' : '', pt === 1 ? 'Golden' : pt === 2 ? 'Rainbow' : '']
      .filter(Boolean)
      .join(' ');
    const goldenId =
      pt === 1 ? (goldenImageIds.get(`${base.collectionName}:${base.name}`) ?? null) : null;
    const shinyId =
      !pt && shiny ? (shinyImageIds.get(`${base.collectionName}:${base.name}`) ?? null) : null;
    const id = await upsertItem({
      collectionName: base.collectionName,
      name: base.name,
      displayName: variantLabel
        ? `${variantLabel} ${base.displayName ?? base.name}`
        : (base.displayName ?? null),
      description: base.description,
      imageId: goldenId ?? shinyId ?? base.imageId,
      variant: pt,
      shiny,
      hidden: base.hidden,
      huge: base.huge,
      titanic: base.titanic,
      gargantuan: base.gargantuan,
    });
    variantItemIds.set(key, id);
    return id;
  }

  const latestValues = await getLatestRapValues();

  let rapEntries: RapEntry[] = [];
  try {
    rapEntries = await fetchRap();
  } catch (err) {
    console.error('[sync] failed to fetch RAP data:', err);
    rapEntries = [];
  }

  const now = new Date();
  const pending: {
    id: string;
    itemId: string;
    itemKey: string;
    pt: number;
    shiny: boolean;
    value: number;
    capturedAt: Date;
  }[] = [];

  for (const entry of rapEntries) {
    const matches = byName.get(entry.configData.id);
    if (!matches || matches.length === 0) continue;
    const variant = parseVariantFromRap(entry.configData);
    for (const item of matches) {
      const itemId = await resolveItemId(item, variant.pt, variant.shiny);
      const previous = latestValues.get(`${itemId}:${variant.pt}:${variant.shiny ? 1 : 0}`);
      if (previous !== undefined && previous === entry.value) continue;
      pending.push({
        id: randomUUID(),
        itemId,
        itemKey: buildRapItemKey(item.name, variant.pt, variant.shiny),
        pt: variant.pt,
        shiny: variant.shiny,
        value: entry.value,
        capturedAt: now,
      });
      latestValues.set(`${itemId}:${variant.pt}:${variant.shiny ? 1 : 0}`, entry.value);
    }
  }

  await insertRapSnapshots(pending);

  const latestExistsValues = await getLatestExistsValues();

  let existsEntries: RapEntry[] = [];
  try {
    existsEntries = await fetchExists();
  } catch (err) {
    console.error('[sync] failed to fetch exists data:', err);
    existsEntries = [];
  }

  const pendingExists: typeof pending = [];

  for (const entry of existsEntries) {
    const matches = byName.get(entry.configData.id);
    if (!matches || matches.length === 0) continue;
    const variant = parseVariantFromRap(entry.configData);
    for (const item of matches) {
      const itemId = await resolveItemId(item, variant.pt, variant.shiny);
      const key = `${itemId}:${variant.pt}:${variant.shiny ? 1 : 0}`;
      const previous = latestExistsValues.get(key);
      if (previous !== undefined && previous === entry.value) continue;
      pendingExists.push({
        id: randomUUID(),
        itemId,
        itemKey: buildRapItemKey(item.name, variant.pt, variant.shiny),
        pt: variant.pt,
        shiny: variant.shiny,
        value: entry.value,
        capturedAt: now,
      });
      latestExistsValues.set(key, entry.value);
    }
  }

  await insertExistsSnapshots(pendingExists);

  await setSetting('sync.lastSyncAt', now.toISOString(), { type: 'json' });

  return {
    collections: collectionsSeeded,
    itemsUpserted,
    snapshotsInserted: pending.length,
    existsInserted: pendingExists.length,
  };
}

export function syncAll(): Promise<SyncResult> {
  if (!syncing) {
    syncing = runSync().finally(() => {
      syncing = null;
    });
  }
  return syncing;
}

export async function pruneSnapshots(): Promise<number> {
  try {
    const retentionDays = await getSetting<number>('snapshot.retentionDays');
    const days = typeof retentionDays === 'number' && retentionDays > 0 ? retentionDays : 90;
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    return await pruneSnapshotsOlderThan(cutoff);
  } catch (err) {
    console.error('[sync] snapshot pruning failed:', err);
    return 0;
  }
}

