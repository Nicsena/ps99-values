import { syncAll } from '../../sync.js';
import type { JobDefinition } from '../types.js';

export const syncJob: JobDefinition = {
  name: 'sync',
  description: 'Fetch collections/items/RAP/exists from BigGames API',
  defaultSchedule: '*/30 * * * *',
  run: async () => {
    const result = await syncAll();
    console.log(
      `[cron] sync done: collections=${result.collections} items=${result.itemsUpserted} snapshots=${result.snapshotsInserted}`,
    );
    return result;
  },
};
