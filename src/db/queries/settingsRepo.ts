import { eq } from 'drizzle-orm';
import { db } from '../client.js';
import { appSettings } from '../schema.js';
import { createLogger } from '../../logger.js';

const log = createLogger({ namespace: 'db.settings' });

export interface AppSettingRow {
  name: string;
  value: string;
  type: 'string' | 'number' | 'boolean' | 'json';
  protected: boolean;
}

export interface UpsertSettingRowParams {
  name: string;
  value: string;
  type: 'string' | 'number' | 'boolean' | 'json';
  protected?: boolean;
}

export async function getRow(name: string): Promise<AppSettingRow | undefined> {
  return log.timerFn(`get setting ${name}`, async () => {
    const rows = await db.select().from(appSettings).where(eq(appSettings.name, name)).limit(1);
    return rows[0];
  }, 'debug');
}

export async function upsertRow(params: UpsertSettingRowParams): Promise<void> {
  await log.timerFn(`set setting ${params.name}`, async () => {
    // Only overwrite `protected` when explicitly provided; otherwise an
    // unprotected write would silently clear the flag.
    const set: Record<string, unknown> = {
      value: params.value,
      type: params.type,
      updatedAt: new Date(),
    };
    if (params.protected !== undefined) set.protected = params.protected;
    await db
      .insert(appSettings)
      .values({
        name: params.name,
        value: params.value,
        type: params.type,
        protected: params.protected ?? false,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({ target: appSettings.name, set });
  }, 'debug');
}

export async function deleteRow(name: string): Promise<void> {
  await log.timerFn(`delete setting ${name}`, async () => {
    await db.delete(appSettings).where(eq(appSettings.name, name));
  }, 'debug');
}
