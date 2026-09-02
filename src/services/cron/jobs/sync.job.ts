import { syncAll } from '../../sync/index.js';
import { createLogger } from '../../../logger.js';
import type { JobDefinition } from '../types.js';

const log = createLogger({ namespace: 'cron' }).child('jobs').child('sync');

export const syncJob: JobDefinition = {
  name: 'sync',
  description: 'Fetch collections/items/RAP/exists from BigGames API',
  defaultSchedule: '0 */1 * * *',
  run: async () => {
    const result = await syncAll();
    log.info(`sync done: collections=${result.collections} items=${result.itemsUpserted} snapshots=${result.snapshotsInserted}`);
    return result;
  },
};
