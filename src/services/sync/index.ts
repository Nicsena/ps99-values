import { countCollections } from '../../db/queries/collectionsRepo.js';
import { pruneSnapshotsOlderThan } from '../../db/queries/snapshotsRepo.js';
import { getSetting } from '../settings.js';
import { createLogger } from '../../logger.js';
import { seedCollections } from './catalog.js';
import { runSync, type SyncResult } from './runner.js';

export type { SyncResult };

const log = createLogger({ namespace: 'sync' });

let syncing: Promise<SyncResult> | null = null;

// Single-flight: concurrent calls share the in-flight run.
export function syncAll(): Promise<SyncResult> {
  if (!syncing) {
    syncing = runSync().finally(() => {
      syncing = null;
    });
  }
  return syncing;
}

// First-run bootstrap: seed the collection list when the table is empty.
// The slug/display-name repair loops from earlier schema generations were
// removed — slugs and names are written correctly at upsert time.
export async function bootstrapIfNeeded(): Promise<void> {
  try {
    if ((await countCollections()) === 0) {
      await seedCollections();
    }
  } catch (err) {
    log.error(`${err} bootstrap failed`);
  }
}

export async function pruneSnapshots(): Promise<number> {
  try {
    const retentionDays = await getSetting<number>('snapshot.retentionDays');
    const days = typeof retentionDays === 'number' && retentionDays > 0 ? retentionDays : 90;
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    return await pruneSnapshotsOlderThan(cutoff);
  } catch (err) {
    log.error(`${err} snapshot pruning failed`);
    return 0;
  }
}
