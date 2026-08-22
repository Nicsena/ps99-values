import { randomUUID } from 'node:crypto';
import { eq, isNull } from 'drizzle-orm';
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
import { getSetting, setSetting } from './settings.js';
import {
  countCollections,
  enableCollection,
  getEnabledCollections,
  markSynced,
  upsertCollectionNames,
} from '../data/collectionsRepo.js';
import { getEnabledItemsWithCollection, upsertItem } from '../data/itemsRepo.js';
import { slugify } from '../util/slug.js';
import {
  getLatestExistsValues,
  getLatestRapValues,
  insertExistsSnapshots,
  insertRapSnapshots,
  pruneSnapshotsOlderThan,
} from '../data/snapshotsRepo.js';

export interface SyncResult {
  collections: number;
  itemsUpserted: number;
  snapshotsInserted: number;
  existsInserted: number;
}

let syncing: Promise<SyncResult> | null = null;

async function seedCollections(): Promise<number> {
  const names = await fetchCollections();
  const wasEmpty = (await countCollections()) === 0;
  await upsertCollectionNames(names);
  if (wasEmpty) {
    await enableCollection('Pets');
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
  const missing = await db
    .select({ id: items.id, name: items.name })
    .from(items)
    .where(isNull(items.slug));
  for (const row of missing) {
    await db.update(items).set({ slug: slugify(row.name) }).where(eq(items.id, row.id));
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

  for (const { name } of enabledCollections) {
    let entries;
    try {
      entries = await fetchCollection(name);
    } catch (err) {
      console.error(`[sync] failed to fetch collection ${name}:`, err);
      continue;
    }
    for (const entry of entries) {
      const displayName =
        typeof entry.configData.name === 'string' ? entry.configData.name : entry.configName;
      if (!displayName) continue;
      const description =
        typeof entry.configData.description === 'string' ? entry.configData.description : null;
      await upsertItem({
        collectionName: name,
        name: displayName,
        description,
        category: entry.category ?? null,
        configDataJson: JSON.stringify(entry.configData),
      });
      itemsUpserted += 1;
    }
    await markSynced(name);
  }

  const enabledItems = await getEnabledItemsWithCollection();

  const byName = new Map<string, { id: string; name: string }[]>();
  for (const item of enabledItems) {
    const list = byName.get(item.name) ?? [];
    list.push(item);
    byName.set(item.name, list);
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
      const previous = latestValues.get(`${item.id}:${variant.pt}:${variant.shiny ? 1 : 0}`);
      if (previous !== undefined && previous === entry.value) continue;
      pending.push({
        id: randomUUID(),
        itemId: item.id,
        itemKey: buildRapItemKey(item.name, variant.pt, variant.shiny),
        pt: variant.pt,
        shiny: variant.shiny,
        value: entry.value,
        capturedAt: now,
      });
      latestValues.set(`${item.id}:${variant.pt}:${variant.shiny ? 1 : 0}`, entry.value);
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
      const key = `${item.id}:${variant.pt}:${variant.shiny ? 1 : 0}`;
      const previous = latestExistsValues.get(key);
      if (previous !== undefined && previous === entry.value) continue;
      pendingExists.push({
        id: randomUUID(),
        itemId: item.id,
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
