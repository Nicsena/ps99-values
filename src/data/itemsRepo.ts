import { randomUUID } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { db } from '../db/client.js';
import { collections, items } from '../db/schema.js';
import { slugify } from '../util/slug.js';

export interface ItemRow {
  id: string;
  collectionName: string;
  name: string;
  slug: string | null;
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

export async function findItemBySlug(itemSlug: string): Promise<ItemRow | undefined> {
  const normalized = slugify(itemSlug);
  if (!normalized) return undefined;

  const exact = await db.select().from(items).where(eq(items.slug, normalized)).limit(1);
  if (exact[0]) return exact[0];

  const prefix = normalized.slice(0, 4);
  const candidates = (await db.all<{
    id: string;
    collection_name: string;
    name: string;
    slug: string | null;
    description: string | null;
    category: string | null;
    config_data: string | null;
  }>(
    sql`SELECT * FROM items WHERE slug LIKE ${`${prefix}%`} OR LOWER(name) LIKE ${`%${prefix.replace(/-/g, '%')}%`} LIMIT 50`,
  )) as {
    id: string;
    collection_name: string;
    name: string;
    slug: string | null;
    description: string | null;
    category: string | null;
    config_data: string | null;
  }[];
  for (const row of candidates) {
    if (
      slugify(row.slug ?? row.name) === normalized ||
      slugify(row.name) === normalized
    ) {
      return {
        id: row.id,
        collectionName: row.collection_name,
        name: row.name,
        slug: row.slug,
        description: row.description,
        category: row.category,
        configData: row.config_data,
      };
    }
  }
  return undefined;
}

export async function upsertItem(params: UpsertItemParams): Promise<void> {
  const itemSlug = slugify(params.name);
  await db
    .insert(items)
    .values({
      id: randomUUID(),
      collectionName: params.collectionName,
      name: params.name,
      slug: itemSlug,
      description: params.description,
      category: params.category,
      configData: params.configDataJson,
    })
    .onConflictDoUpdate({
      target: [items.collectionName, items.name],
      set: {
        slug: itemSlug,
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
