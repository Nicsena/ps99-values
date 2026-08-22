import { randomUUID } from 'node:crypto';
import { eq, lt, sql } from 'drizzle-orm';
import { db } from '../db/client.js';
import { collections, items, rapSnapshots } from '../db/schema.js';
import { fetchCollection, fetchCollections, fetchRap, type RapEntry } from './biggames.js';
import { buildRapItemKey, parseVariantFromRap } from './itemKey.js';
import { getSetting, setSetting } from './settings.js';

export interface SyncResult {
  collections: number;
  itemsUpserted: number;
  snapshotsInserted: number;
}

let syncing: Promise<SyncResult> | null = null;

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

async function seedCollections(): Promise<number> {
  const names = await fetchCollections();
  const existing = await db.select({ name: collections.name }).from(collections);
  const wasEmpty = existing.length === 0;
  const known = new Set(existing.map((row) => row.name));
  const missing = names.filter((name) => !known.has(name)).map((name) => ({ name, enabled: false }));
  if (missing.length > 0) {
    await db.insert(collections).values(missing).onConflictDoNothing();
  }
  if (wasEmpty) {
    await db.update(collections).set({ enabled: true }).where(eq(collections.name, 'Pets'));
  }
  return names.length;
}

export async function bootstrapIfNeeded(): Promise<void> {
  try {
    const rows = await db.select({ name: collections.name }).from(collections);
    if (rows.length === 0) {
      await seedCollections();
    }
  } catch (err) {
    console.error('[sync] bootstrap failed:', err);
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

  const enabledCollections = await db
    .select({ name: collections.name })
    .from(collections)
    .where(eq(collections.enabled, true));

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
      await db
        .insert(items)
        .values({
          id: randomUUID(),
          collectionName: name,
          name: displayName,
          description:
            typeof entry.configData.description === 'string' ? entry.configData.description : null,
          category: entry.category ?? null,
          configData: JSON.stringify(entry.configData),
        })
        .onConflictDoUpdate({
          target: [items.collectionName, items.name],
          set: {
            description:
              typeof entry.configData.description === 'string'
                ? entry.configData.description
                : null,
            category: entry.category ?? null,
            configData: JSON.stringify(entry.configData),
            dateSynced: new Date(),
          },
        });
      itemsUpserted += 1;
    }
    await db.update(collections).set({ dateSynced: new Date() }).where(eq(collections.name, name));
  }

  const enabledItems = await db
    .select({ id: items.id, name: items.name })
    .from(items)
    .innerJoin(collections, eq(collections.name, items.collectionName))
    .where(eq(collections.enabled, true));

  const byName = new Map<string, { id: string; name: string }[]>();
  for (const item of enabledItems) {
    const list = byName.get(item.name) ?? [];
    list.push(item);
    byName.set(item.name, list);
  }

  const latestRows = (await db.all<{
    item_id: string;
    pt: number;
    shiny: number;
    value: number;
  }>(
    sql`SELECT item_id, pt, shiny, value FROM rap_snapshots GROUP BY item_id, pt, shiny HAVING captured_at = MAX(captured_at)`,
  )) as { item_id: string; pt: number; shiny: number; value: number }[];
  const latestValues = new Map(
    latestRows.map((r) => [`${r.item_id}:${r.pt}:${Number(r.shiny)}`, r.value]),
  );

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

  if (pending.length > 0) {
    for (const batch of chunk(pending, 500)) {
      await db.insert(rapSnapshots).values(batch);
    }
  }

  await setSetting('sync.lastSyncAt', now.toISOString(), { type: 'json' });

  return {
    collections: collectionsSeeded,
    itemsUpserted,
    snapshotsInserted: pending.length,
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
    const result = await db.delete(rapSnapshots).where(lt(rapSnapshots.capturedAt, cutoff));
    return result.changes;
  } catch (err) {
    console.error('[sync] snapshot pruning failed:', err);
    return 0;
  }
}
