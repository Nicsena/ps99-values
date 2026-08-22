export interface JobDefinition {
  name: string;
  description: string;
  defaultSchedule: string;
  run: () => Promise<unknown>;
}

export interface JobStatus {
  name: string;
  description: string;
  running: boolean;
  schedule: string;
  enabled: boolean;
}
