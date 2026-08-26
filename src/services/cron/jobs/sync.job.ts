import { syncAll } from '../../sync/index.js';
import type { JobDefinition } from '../types.js';

export const syncJob: JobDefinition = {
  name: 'sync',
  description: 'Fetch collections/items/RAP/exists from BigGames API',
  defaultSchedule: '0 */1 * * *',
  run: async () => {
    const result = await syncAll();
    console.log(
      `[cron] sync done: collections=${result.collections} items=${result.itemsUpserted} snapshots=${result.snapshotsInserted}`,
    );
    return result;
  },
};
