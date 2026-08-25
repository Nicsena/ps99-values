import { eq } from 'drizzle-orm';
import { db } from '../client.js';
import { appSettings } from '../schema.js';

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
  const rows = await db.select().from(appSettings).where(eq(appSettings.name, name)).limit(1);
  return rows[0];
}

export async function upsertRow(params: UpsertSettingRowParams): Promise<void> {
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
}

export async function deleteRow(name: string): Promise<void> {
  await db.delete(appSettings).where(eq(appSettings.name, name));
}
