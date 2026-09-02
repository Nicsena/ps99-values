import { createTask, validate } from 'node-cron';
import { getSetting } from '../settings.js';
import { createLogger } from '../../logger.js';
import type { JobDefinition, JobStatus } from './types.js';

const log = createLogger({ namespace: 'cron' });

interface TaskHandle {
  stop(): void;
}

type Scheduler = (expression: string, fn: () => void) => TaskHandle;

function defaultScheduler(expression: string, fn: () => void): TaskHandle {
  const task = createTask(expression, fn);
  void task.start();
  return {
    stop: () => {
      task.stop();
      task.destroy();
    },
  };
}

export class CronService {
  private readonly scheduler: Scheduler;
  private readonly jobs = new Map<string, JobDefinition>();
  private readonly handles = new Map<string, TaskHandle>();

  constructor(scheduler?: Scheduler) {
    this.scheduler = scheduler ?? defaultScheduler;
  }

  register(defs: JobDefinition[]): void {
    for (const def of defs) {
      this.jobs.set(def.name, def);
    }
  }

  async startAll(): Promise<void> {
    const masterEnabled = await getSetting<boolean>('cron.enabled');
    if (masterEnabled === false) {
      this.stopAll();
      return;
    }
    for (const name of this.jobs.keys()) {
      const jobEnabled = await getSetting<boolean>(`cron.jobs.${name}.enabled`);
      if (jobEnabled !== false) {
        await this.startJob(name);
      }
    }
  }

  stopAll(): void {
    for (const name of [...this.handles.keys()]) {
      this.stopJob(name);
    }
  }

  async startJob(name: string): Promise<boolean> {
    const def = this.jobs.get(name);
    if (!def) return false;
    if (this.handles.has(name)) return false;

    const masterEnabled = await getSetting<boolean>('cron.enabled');
    if (masterEnabled === false) return false;

    const jobEnabled = await getSetting<boolean>(`cron.jobs.${name}.enabled`);
    if (jobEnabled === false) return false;

    const scheduleSetting = await getSetting<string>(`cron.jobs.${name}.schedule`);
    const expression = scheduleSetting ?? def.defaultSchedule;

    if (!validate(expression)) {
      log.error(`invalid schedule ${expression} for job ${name} not starting`);
      return false;
    }

    const handle = this.scheduler(expression, () => {
      def
        .run()
        .then(() => log.info(`${name} completed`))
        .catch((err: unknown) => log.error(`${err} job ${name} failed`));
    });
    this.handles.set(name, handle);
    log.info(`started ${name} (${expression})`);
    return true;
  }

  stopJob(name: string): boolean {
    const handle = this.handles.get(name);
    if (!handle) return false;
    handle.stop();
    this.handles.delete(name);
    log.info(`stopped ${name}`);
    return true;
  }

  isRunning(name: string): boolean {
    return this.handles.has(name);
  }

  async listJobs(): Promise<JobStatus[]> {
    const statuses: JobStatus[] = [];
    for (const def of this.jobs.values()) {
      const enabledSetting = await getSetting<boolean>(`cron.jobs.${def.name}.enabled`);
      const scheduleSetting = await getSetting<string>(`cron.jobs.${def.name}.schedule`);
      statuses.push({
        name: def.name,
        description: def.description,
        running: this.handles.has(def.name),
        schedule: scheduleSetting ?? def.defaultSchedule,
        enabled: enabledSetting !== false,
      });
    }
    return statuses;
  }
}
