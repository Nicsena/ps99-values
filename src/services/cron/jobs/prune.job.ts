import { pruneSnapshots } from '../../sync/index.js';
import type { JobDefinition } from '../types.js';

export const pruneJob: JobDefinition = {
  name: 'prune',
  description: 'Prune expired RAP/exists snapshots',
  defaultSchedule: '30 3 * * *',
  run: async () => {
    const pruned = await pruneSnapshots();
    console.log(`[cron] pruned ${pruned} snapshots`);
    return pruned;
  },
};
