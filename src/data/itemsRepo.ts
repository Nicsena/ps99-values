import { randomUUID } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import { db } from '../db/client.js';
import { collections, items } from '../db/schema.js';
import { buildDetailSlug, slugify } from '../util/slug.js';

export interface ItemRow {
  id: string;
  collectionName: string;
  name: string;
  displayName: string | null;
  description: string | null;
  slug: string | null;
  hidden: boolean;
  shiny: boolean;
  variant: number;
  imageId: number | null;
  huge: boolean;
  titanic: boolean;
  gargantuan: boolean;
}

export interface UpsertItemParams {
  collectionName: string;
  name: string;
  displayName?: string | null;
  description?: string | null;
  variant?: number;
  shiny?: boolean;
  imageId?: number | null;
  hidden?: boolean;
  huge?: boolean;
  titanic?: boolean;
  gargantuan?: boolean;
}

function slugFor(name: string, variant: number, shiny: boolean): string {
  return variant || shiny ? buildDetailSlug(name, variant, shiny) : slugify(name);
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

export async function findItemVariant(
  name: string,
  variant: number,
  shiny: boolean,
): Promise<ItemRow | undefined> {
  const found = await db
    .select()
    .from(items)
    .where(
      and(
        sql`LOWER(${items.name}) = ${name.toLowerCase()}`,
        eq(items.variant, variant),
        eq(items.shiny, shiny),
      ),
    )
    .limit(1);
  return found[0];
}

export async function findImageIdByName(name: string): Promise<number | null> {
  const found = await db
    .select({ imageId: items.imageId })
    .from(items)
    .where(
      sql`(LOWER(${items.displayName}) = ${name.toLowerCase()} OR LOWER(${items.name}) = ${name.toLowerCase()}) AND ${items.imageId} IS NOT NULL`,
    )
    .limit(1);
  return found[0]?.imageId ?? null;
}

export async function findItemBySlug(itemSlug: string): Promise<ItemRow | undefined> {
  const normalized = slugify(itemSlug).toLowerCase();
  if (!normalized) return undefined;

  const exact = await db
    .select()
    .from(items)
    .where(sql`LOWER(${items.slug}) = ${normalized}`)
    .limit(1);
  if (exact[0]) return exact[0];

  const prefix = normalized.slice(0, 4);
  const candidates = (await db.all<{
    id: string;
    collection: string;
    name: string;
    slug: string | null;
  }>(
    sql`SELECT id, collection, name, slug FROM items WHERE slug LIKE ${`${prefix}%`} OR LOWER(name) LIKE ${`%${prefix.replace(/-/g, '%')}%`} LIMIT 50`,
  )) as { id: string; collection: string; name: string; slug: string | null }[];

  for (const row of candidates) {
    const rowSlug = (row.slug ?? slugFor(row.name, 0, false)).toLowerCase();
    if (rowSlug === normalized || slugify(row.name).toLowerCase() === normalized) {
      const full = await db.select().from(items).where(eq(items.id, row.id)).limit(1);
      return full[0];
    }
  }
  return undefined;
}

export async function upsertItem(params: UpsertItemParams): Promise<string> {
  const variant = params.variant ?? 0;
  const shiny = params.shiny ?? false;
  const itemSlug = slugFor(params.name, variant, shiny);
  const rows = await db
    .insert(items)
    .values({
      id: randomUUID(),
      collectionName: params.collectionName,
      name: params.name,
      displayName: params.displayName ?? null,
      description: params.description ?? null,
      slug: itemSlug,
      hidden: params.hidden ?? false,
      shiny,
      variant,
      imageId: params.imageId ?? null,
      huge: params.huge ?? false,
      titanic: params.titanic ?? false,
      gargantuan: params.gargantuan ?? false,
    })
    .onConflictDoUpdate({
      target: [items.collectionName, items.name, items.variant, items.shiny],
      set: {
        displayName: params.displayName ?? null,
        description: params.description ?? null,
        slug: itemSlug,
        hidden: params.hidden ?? false,
        huge: params.huge ?? false,
        titanic: params.titanic ?? false,
        gargantuan: params.gargantuan ?? false,
        imageId: params.imageId ?? null,
      },
    })
    .returning({ id: items.id });
  return rows[0].id;
}

export async function getBaseItemsWithCollection(): Promise<
  {
    id: string;
    collectionName: string;
    name: string;
    displayName: string | null;
    description: string | null;
    imageId: number | null;
    hidden: boolean;
    huge: boolean;
    titanic: boolean;
    gargantuan: boolean;
  }[]
> {
  return db
    .select({
      id: items.id,
      collectionName: items.collectionName,
      name: items.name,
      displayName: items.displayName,
      description: items.description,
      imageId: items.imageId,
      hidden: items.hidden,
      huge: items.huge,
      titanic: items.titanic,
      gargantuan: items.gargantuan,
    })
    .from(items)
    .innerJoin(collections, eq(collections.name, items.collectionName))
    .where(and(eq(collections.enabled, true), eq(items.variant, 0), eq(items.shiny, false)));
}



