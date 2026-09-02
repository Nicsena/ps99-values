import { pruneSnapshots } from '../../sync/index.js';
import { createLogger } from '../../../logger.js';
import type { JobDefinition } from '../types.js';

const log = createLogger({ namespace: 'cron' }).child('jobs').child('prune');

export const pruneJob: JobDefinition = {
  name: 'prune',
  description: 'Prune expired RAP/exists snapshots',
  defaultSchedule: '30 3 * * *',
  run: async () => {
    const pruned = await pruneSnapshots();
    log.info(`pruned ${pruned} snapshots`);
    return pruned;
  },
};
