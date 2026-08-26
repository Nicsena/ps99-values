import { getEnabledCollections } from '../../db/queries/collectionsRepo.js';
import { getBaseItemsWithCollection } from '../../db/queries/itemsRepo.js';
import { cacheFlush } from '../../cache/index.js';
import { fetchExists, fetchRap } from '../biggames.js';
import { setSetting, getSetting } from '../settings.js';
import { syncCatalog, seedCollections } from './catalog.js';
import { runFeed, type IngestWarnings } from './ingest.js';

export interface SyncResult {
  collections: number;
  itemsUpserted: number;
  snapshotsInserted: number;
  existsInserted: number;
  /** Feed/collection fetch failures; empty when the run was fully healthy. */
  errors: string[];
  /** Per-feed skip counters (unmatched, ambiguous, malformed entries). */
  warnings: {
    rap: IngestWarnings;
    exists: IngestWarnings;
    malformedCatalogEntries: number;
  };
}

export async function runSync(): Promise<SyncResult> {
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
  const catalog = await syncCatalog(enabledCollections);
  errors.push(...catalog.errors);

  // Fresh read so entries for newly created primary rows are matched.
  const enabledItems = await getBaseItemsWithCollection();

  // Both feeds share one run timestamp; safe under the
  // (item_id, metric, captured_at) unique index + conflict-update insert.
  const runTime = new Date();

  const rap = await runFeed({
    metric: 'rap',
    fetch: fetchRap,
    enabledItems,
    context: catalog.context,
    runTime,
  });
  if (rap.error) errors.push(rap.error);

  const exists = await runFeed({
    metric: 'exists',
    fetch: fetchExists,
    enabledItems,
    context: catalog.context,
    runTime,
  });
  if (exists.error) errors.push(exists.error);

  const warnings = {
    rap: rap.warnings,
    exists: exists.warnings,
    malformedCatalogEntries: catalog.invalidEntries,
  };

  // Only advance lastSyncAt when both feeds were fetched successfully; a
  // partial sync must not be mistaken for fresh data.
  if (rap.ok && exists.ok) {
    await setSetting('sync.lastSyncAt', runTime.toISOString(), { type: 'json' });
  }

  // Sync changed (or first-populated) the data behind every cached query —
  // flush the derived cache wholesale. This also evicts stale zero-result
  // entries written while the database was still empty during bootstrap.
  await cacheFlush();

  return {
    collections: collectionsSeeded,
    itemsUpserted: catalog.itemsUpserted,
    snapshotsInserted: rap.inserted,
    existsInserted: exists.inserted,
    errors,
    warnings,
  };
}
