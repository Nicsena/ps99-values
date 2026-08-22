import { CronService } from './CronService.js';
import { pruneJob } from './jobs/prune.job.js';
import { syncJob } from './jobs/sync.job.js';

export const cronService = new CronService();

export function registerDefaultJobs(): void {
  cronService.register([syncJob, pruneJob]);
}

export { CronService } from './CronService.js';
export type { JobDefinition, JobStatus } from './types.js';
