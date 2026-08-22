import { deleteRow, getRow, upsertRow } from '../data/settingsRepo.js';

export type SettingType = 'string' | 'number' | 'boolean' | 'json';

export const DEFAULT_SETTINGS = {
  'sync.enabled': true,
  'sync.lastSyncAt': null,
  'snapshot.retentionDays': 90,
  'cron.enabled': true,
  'cron.jobs.sync.enabled': true,
  'cron.jobs.sync.schedule': '0 */4 * * *',
  'cron.jobs.prune.enabled': true,
  'cron.jobs.prune.schedule': '30 3 * * *',
} as const;

function defaultType(value: unknown): SettingType {
  if (value === null || typeof value === 'object') return 'json';
  if (typeof value === 'boolean') return 'boolean';
  if (typeof value === 'number') return 'number';
  return 'string';
}

function serialize(value: unknown, type: SettingType): string {
  if (type === 'json') return JSON.stringify(value);
  if (type === 'boolean') return value ? 'true' : 'false';
  return String(value);
}

function deserialize(raw: string | null, type: string): unknown {
  if (raw === null) return null;
  switch (type) {
    case 'json':
      try {
        return JSON.parse(raw);
      } catch {
        return null;
      }
    case 'boolean':
      return raw === 'true' || raw === '1';
    case 'number':
      return Number(raw);
    default:
      return raw;
  }
}

export async function getSetting<T>(name: string): Promise<T | null> {
  try {
    const row = await getRow(name);
    if (row) {
      return deserialize(row.value, row.type) as T;
    }
    if (name in DEFAULT_SETTINGS) {
      return DEFAULT_SETTINGS[name as keyof typeof DEFAULT_SETTINGS] as T;
    }
    return null;
  } catch {
    return null;
  }
}

export async function setSetting(
  name: string,
  value: unknown,
  opts?: { type?: SettingType; protected?: boolean },
): Promise<boolean> {
  try {
    const existing = await getRow(name);
    if (existing && existing.protected) {
      return false;
    }
    const type = opts?.type ?? defaultType(value);
    const serialized = serialize(value, type);
    await upsertRow({ name, value: serialized, type, protected: opts?.protected ?? false });
    return true;
  } catch {
    return false;
  }
}

export async function deleteSetting(name: string): Promise<boolean> {
  try {
    const existing = await getRow(name);
    if (!existing) return false;
    if (existing.protected) return false;
    await deleteRow(name);
    return true;
  } catch {
    return false;
  }
}
