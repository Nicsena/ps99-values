import { randomUUID } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { db } from '../db/client.js';
import { collections, items } from '../db/schema.js';

export interface ItemRow {
  id: string;
  collectionName: string;
  name: string;
  description: string | null;
  category: string | null;
  configData: string | null;
}

export interface UpsertItemParams {
  collectionName: string;
  name: string;
  description: string | null;
  category: string | null;
  configDataJson: string;
}

export async function countItems(search?: string): Promise<number> {
  const normalized = (search ?? '').trim().toLowerCase();
  const where =
    normalized.length > 0
      ? sql` WHERE LOWER(i.name) LIKE ${`%${normalized}%`}`
      : sql``;
  const countRows = (await db.all<{ total: number }>(
    sql`SELECT COUNT(*) AS total FROM items i${where}`,
  )) as { total: number }[];
  return countRows[0]?.total ?? 0;
}

export async function findItemByNameLower(name: string): Promise<ItemRow | undefined> {
  const found = await db
    .select()
    .from(items)
    .where(sql`LOWER(${items.name}) = ${name.toLowerCase()}`)
    .limit(1);
  return found[0];
}

export async function upsertItem(params: UpsertItemParams): Promise<void> {
  await db
    .insert(items)
    .values({
      id: randomUUID(),
      collectionName: params.collectionName,
      name: params.name,
      description: params.description,
      category: params.category,
      configData: params.configDataJson,
    })
    .onConflictDoUpdate({
      target: [items.collectionName, items.name],
      set: {
        description: params.description,
        category: params.category,
        configData: params.configDataJson,
        dateSynced: new Date(),
      },
    });
}

export async function getEnabledItemsWithCollection(): Promise<
  { id: string; name: string }[]
> {
  return db
    .select({ id: items.id, name: items.name })
    .from(items)
    .innerJoin(collections, eq(collections.name, items.collectionName))
    .where(eq(collections.enabled, true));
}
