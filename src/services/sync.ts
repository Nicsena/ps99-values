import { fetchCollection, fetchCollections, fetchExists, fetchRap, type RapEntry } from './biggames.js';
import { parseVariantFromRap, type VariantDims } from './itemKey.js';import {
  parseColorVariants,
  parseGoldenImageId,
  parseImageId,
  parseShinyImageId,
  resolveItemNaming,
} from './collectionSpecs.js';

// UpsertItemParams takes pre-serialized color-variant JSON.
function serializeColorVariants(colors: ReturnType<typeof parseColorVariants>): string | null {
  return colors ? JSON.stringify(colors) : null;
}
import { getSetting, setSetting } from './settings.js';
import {
  countCollections,
  enableCollections,
  getEnabledCollections,
  markSynced,
  upsertCollectionNames,
} from '../db/queries/collectionsRepo.js';
import {
  getBaseItemsWithCollection,
  repairVariantDisplayNames,
  repairVariantSlugs,
  upsertItem,
  variantLabel,
} from '../db/queries/itemsRepo.js';
import { readColorVariants } from './collectionSpecs.js';
import {
  getLatestValues,
  insertSnapshots,
  pruneSnapshotsOlderThan,
} from '../db/queries/snapshotsRepo.js';

export interface SyncResult {
  collections: number;
  itemsUpserted: number;
  snapshotsInserted: number;
  existsInserted: number;
  /** Feed/collection fetch failures; empty when the run was fully healthy. */
  errors: string[];
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
    await enableCollections(DEFAULT_ENABLED_COLLECTIONS);
  }
  return names.length;
}

export async function bootstrapIfNeeded(): Promise<void> {
  try {
    if ((await countCollections()) === 0) {
      await seedCollections();
    }
    const slugged = await repairVariantSlugs();
    if (slugged > 0) console.log(`[sync] assigned ${slugged} chroma variant slugs`);
    const renamed = await repairVariantDisplayNames();
    if (renamed > 0) console.log(`[sync] updated ${renamed} chroma variant display names`);
  } catch (err) {
    console.error('[sync] bootstrap failed:', err);
  }
}

interface PendingSnapshot {
  itemId: number;
  value: number;
  capturedAt: Date;
}

async function runSync(): Promise<SyncResult> {
  const enabledSetting = await getSetting<boolean>('sync.enabled');
  if (enabledSetting === false) {
    throw new Error('sync disabled');
  }

  const errors: string[] = [];

  let collectionsSeeded = 0;
  try {
    collectionsSeeded = await seedCollections();
  } catch (err) {
    console.error('[sync] collection seeding failed:', err);
    errors.push(`collection seeding failed: ${String(err)}`);
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
      errors.push(`collection ${name} failed: ${String(err)}`);
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
        colorVariants: serializeColorVariants(parseColorVariants(cd)),
      });
      itemsUpserted += 1;
    }
    await markSynced(name);
  }

  const enabledItems = await getBaseItemsWithCollection();

  // Index base items by upstream id (the item name). Matches are sorted by
  // collection so attribution is deterministic; the feeds carry no collection
  // field, so cross-collection name collisions are attributed to the first
  // enabled collection alphabetically and reported.
  const byName = new Map<string, typeof enabledItems>();
  for (const item of [...enabledItems].sort((a, b) =>
    a.collectionName.localeCompare(b.collectionName),
  )) {
    const list = byName.get(item.name) ?? [];
    list.push(item);
    byName.set(item.name, list);
  }

  let unmatchedEntries = 0;
  let ambiguousNames = 0;

  function matchEntry(entry: RapEntry): (typeof enabledItems)[number] | null {
    const matches = byName.get(entry.configData.id);
    if (!matches || matches.length === 0) return null;
    if (matches.length > 1) {
      ambiguousNames += 1;
      console.warn(
        `[sync] name "${entry.configData.id}" matches ${matches.length} collections; attributing to "${matches[0].collectionName}"`,
      );
    }
    return matches[0];
  }

  const variantItemIds = new Map<string, number>();
  // Creates (or refreshes) the per-variant items row and returns its id.
  async function resolveVariant(
    base: (typeof enabledItems)[number],
    dims: VariantDims,
  ): Promise<number> {
    if (!dims.variant && !dims.shiny && !dims.chroma && !dims.tier) return base.id;
    const key = `${base.id}:${dims.variant}:${dims.shiny ? 1 : 0}:${dims.chroma}:${dims.tier}`;
    const existing = variantItemIds.get(key);
    if (existing !== undefined) return existing;
    const colorName =
      dims.chroma !== 0
        ? (readColorVariants(base.colorVariants).get(dims.chroma)?.name ?? null)
        : null;
    const label = variantLabel(dims, colorName);
    const baseName = base.displayName ?? base.name;
    const goldenId =
      dims.variant === 1
        ? (goldenImageIds.get(`${base.collectionName}:${base.name}`) ?? null)
        : null;
    const shinyId =
      !dims.variant && dims.shiny
        ? (shinyImageIds.get(`${base.collectionName}:${base.name}`) ?? null)
        : null;
    const id = await upsertItem({
      collectionName: base.collectionName,
      name: base.name,
      displayName: label ? `${label} ${baseName}` : baseName,
      description: base.description,
      imageId: goldenId ?? shinyId ?? base.imageId,
      hidden: base.hidden,
      huge: base.huge,
      titanic: base.titanic,
      gargantuan: base.gargantuan,
      colorVariants: base.colorVariants,
      ...dims,
    });
    variantItemIds.set(key, id);
    return id;
  }

  // Resolve variant ids first (sequential DB writes), then diff values.
  // Within one run only the first feed entry per variant is kept; all rows of
  // a run share one timestamp, which is safe because each (variant, metric,
  // timestamp) is unique and conflicting values are deduped above.
  const runTime = new Date();
  async function collectPending(
    entries: RapEntry[],
    latest: Map<number, number>,
  ): Promise<PendingSnapshot[]> {
    const seen = new Set<number>();
    const pending: PendingSnapshot[] = [];
    for (const entry of entries) {
      const base = matchEntry(entry);
      if (!base) {
        unmatchedEntries += 1;
        continue;
      }
      const dims = parseVariantFromRap(entry.configData);
      const itemId = await resolveVariant(base, dims);
      if (seen.has(itemId)) continue;
      seen.add(itemId);
      const previous = latest.get(itemId);
      if (previous !== undefined && previous === entry.value) continue;
      pending.push({ itemId, value: entry.value, capturedAt: runTime });
      latest.set(itemId, entry.value);
    }
    return pending;
  }

  const latestRapValues = await getLatestValues('rap');

  let rapEntries: RapEntry[] = [];
  let rapOk = true;
  try {
    rapEntries = await fetchRap();
  } catch (err) {
    console.error('[sync] failed to fetch RAP data:', err);
    errors.push(`RAP feed failed: ${String(err)}`);
    rapOk = false;
  }
  const snapshotsInserted = await insertSnapshots('rap', await collectPending(rapEntries, latestRapValues));

  const latestExistsValues = await getLatestValues('exists');

  let existsEntries: RapEntry[] = [];
  let existsOk = true;
  try {
    existsEntries = await fetchExists();
  } catch (err) {
    console.error('[sync] failed to fetch exists data:', err);
    errors.push(`exists feed failed: ${String(err)}`);
    existsOk = false;
  }
  const existsInserted = await insertSnapshots('exists', await collectPending(existsEntries, latestExistsValues));

  if (unmatchedEntries > 0) {
    console.warn(`[sync] ${unmatchedEntries} feed entries matched no known item and were skipped`);
  }
  if (ambiguousNames > 0) {
    console.warn(`[sync] ${ambiguousNames} feed entries had cross-collection name collisions`);
  }

  // Only advance lastSyncAt on fully healthy runs; a partial sync must not be
  // mistaken for fresh data.
  if (rapOk && existsOk) {
    await setSetting('sync.lastSyncAt', runTime.toISOString(), { type: 'json' });
  }

  return {
    collections: collectionsSeeded,
    itemsUpserted,
    snapshotsInserted,
    existsInserted,
    errors,
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
