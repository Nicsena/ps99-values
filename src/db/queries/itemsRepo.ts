import { and, eq, isNull, sql } from 'drizzle-orm';
import { db } from '../client.js';
import { collections, items } from '../schema.js';
import { readColorVariants } from '../../services/collectionSpecs.js';
import { slugify } from '../../util/slug.js';

export interface ItemRow {
  id: number;
  collectionName: string;
  name: string;
  displayName: string | null;
  description: string | null;
  slug: string | null;
  hidden: boolean;
  imageId: number | null;
  huge: boolean;
  titanic: boolean;
  gargantuan: boolean;
  variant: number;
  shiny: boolean;
  chroma: number;
  tier: number;
  colorVariants: string | null;
}

export interface UpsertItemParams {
  collectionName: string;
  name: string;
  displayName?: string | null;
  description?: string | null;
  imageId?: number | null;
  hidden?: boolean;
  huge?: boolean;
  titanic?: boolean;
  gargantuan?: boolean;
  /** Pre-serialized JSON of the item's chroma color list; null when none. */
  colorVariants?: string | null;
  /** Variant dimensions; defaults describe the primary (regular) variant. */
  variant?: number;
  shiny?: boolean;
  chroma?: number;
  tier?: number;
}

export interface VariantDims {
  variant: number;
  shiny: boolean;
  chroma: number;
  tier: number;
}

// Canonical base slug; stored lowercase so slug lookups are exact index hits.
function baseSlug(name: string): string {
  return slugify(name);
}

// URL grammar for non-primary variants: [shiny-][golden|rainbow-][color-]<base>.
// Chroma variants are addressed by their color name (resolved from the row's
// own colorVariants list — mappings are per-item upstream). Tiered variants
// are unaddressable this pass (NULL slug).
function variantSlugPrefix(dims: VariantDims, colorName: string | null): string | null {
  if (dims.tier !== 0) return null;
  if (dims.chroma !== 0 && !colorName) return null;
  const parts: string[] = [];
  if (dims.shiny) parts.push('shiny');
  if (dims.variant === 1) parts.push('golden');
  else if (dims.variant === 2) parts.push('rainbow');
  if (dims.chroma !== 0 && colorName) parts.push(colorName.toLowerCase());
  return parts.length > 0 ? `${parts.join('-')}-` : '';
}

// Human-readable variant label following the same token order as the slug
// grammar: Shiny · Golden/Rainbow · Color. Empty string for primary variants.
export function variantLabel(dims: VariantDims, colorName: string | null): string {
  const parts: string[] = [];
  if (dims.shiny) parts.push('Shiny');
  if (dims.variant === 1) parts.push('Golden');
  else if (dims.variant === 2) parts.push('Rainbow');
  if (dims.chroma !== 0 && colorName) parts.push(colorName);
  return parts.join(' ');
}

// Globally unique slug within items.slug. First-come keeps the clean slug;
// latecomers take a -<collection> suffix, then numeric disambiguation.
async function uniqueSlugFor(
  candidateBase: string,
  collectionName: string,
  selfId?: number,
): Promise<string> {
  const taken = async (candidate: string): Promise<boolean> => {
    const rows = await db
      .select({ id: items.id })
      .from(items)
      .where(eq(items.slug, candidate))
      .limit(1);
    return rows.length > 0 && rows[0].id !== selfId;
  };
  if (!(await taken(candidateBase))) return candidateBase;
  const scoped = `${candidateBase}-${collectionName.toLowerCase()}`;
  if (!(await taken(scoped))) return scoped;
  for (let n = 2; ; n += 1) {
    const numbered = `${scoped}-${n}`;
    if (!(await taken(numbered))) return numbered;
  }
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (c) => `\\${c}`);
}

export async function countItems(search?: string): Promise<number> {
  const normalized = (search ?? '').trim().toLowerCase();
  const where =
    normalized.length > 0
      ? sql` WHERE LOWER(i.name) LIKE ${`%${escapeLike(normalized)}%`}`
      : sql``;
  const countRows = (await db.all<{ total: number }>(
    sql`SELECT COUNT(*) AS total FROM items i${where}`,
  )) as { total: number }[];
  return countRows[0]?.total ?? 0;
}

function itemRowSelect() {
  return db
    .select({
      id: items.id,
      collectionName: items.collectionName,
      name: items.name,
      displayName: items.displayName,
      description: items.description,
      slug: items.slug,
      hidden: items.hidden,
      imageId: items.imageId,
      huge: items.huge,
      titanic: items.titanic,
      gargantuan: items.gargantuan,
      variant: items.variant,
      shiny: items.shiny,
      chroma: items.chroma,
      tier: items.tier,
      colorVariants: items.colorVariants,
    })
    .from(items);
}

// Exact indexed match only; slugs are stored canonical/lowercase at write time.
export async function findItemBySlug(itemSlug: string): Promise<ItemRow | undefined> {
  const normalized = slugify(itemSlug).toLowerCase();
  if (!normalized) return undefined;
  const rows = await itemRowSelect().where(eq(items.slug, normalized)).limit(1);
  return rows[0];
}

export async function findItemByNameLower(name: string): Promise<ItemRow | undefined> {
  const rows = await itemRowSelect()
    .where(sql`LOWER(${items.name}) = ${name.toLowerCase()}`)
    .limit(1)
    ;
  // Prefer the primary row when several variants share a name.
  if (rows.length === 0) return undefined;
  const primary = rows.find((r) => r.variant === 0 && !r.shiny && r.chroma === 0 && r.tier === 0);
  return primary ?? rows[0];
}

export async function findItemVariant(
  name: string,
  dims: VariantDims,
): Promise<ItemRow | undefined> {
  const rows = await itemRowSelect().where(
    and(
      sql`LOWER(${items.name}) = ${name.toLowerCase()}`,
      eq(items.variant, dims.variant),
      eq(items.shiny, dims.shiny),
      eq(items.chroma, dims.chroma),
      eq(items.tier, dims.tier),
    ),
  ).limit(1);
  return rows[0];
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

export async function upsertItem(params: UpsertItemParams): Promise<number> {
  const dims: VariantDims = {
    variant: params.variant ?? 0,
    shiny: params.shiny ?? false,
    chroma: params.chroma ?? 0,
    tier: params.tier ?? 0,
  };

  const existing = await db
    .select({ id: items.id })
    .from(items)
    .where(
      and(
        eq(items.collectionName, params.collectionName),
        eq(items.name, params.name),
        eq(items.variant, dims.variant),
        eq(items.shiny, dims.shiny),
        eq(items.chroma, dims.chroma),
        eq(items.tier, dims.tier),
      ),
    )
    .limit(1);
  const selfId = existing[0]?.id;

  let slug: string | null = null;
  const colorName =
    dims.chroma !== 0
      ? (readColorVariants(params.colorVariants ?? null).get(dims.chroma)?.name ?? null)
      : null;
  const prefix = variantSlugPrefix(dims, colorName);
  if (prefix !== null) {
    slug = await uniqueSlugFor(`${prefix}${baseSlug(params.name)}`, params.collectionName, selfId);
  }

  const values = {
    collectionName: params.collectionName,
    name: params.name,
    displayName: params.displayName ?? null,
    description: params.description ?? null,
    slug,
    hidden: params.hidden ?? false,
    imageId: params.imageId ?? null,
    huge: params.huge ?? false,
    titanic: params.titanic ?? false,
    gargantuan: params.gargantuan ?? false,
    colorVariants: params.colorVariants ?? null,
    ...dims,
  };

  if (selfId !== undefined) {
    await db.update(items).set(values).where(eq(items.id, selfId));
    return selfId;
  }
  const inserted = await db.insert(items).values(values).returning({ id: items.id });
  return inserted[0].id;
}

export async function getBaseItemsWithCollection(): Promise<  {
    id: number;
    collectionName: string;
    name: string;
    displayName: string | null;
    description: string | null;
    colorVariants: string | null;
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
      colorVariants: items.colorVariants,
      imageId: items.imageId,
      hidden: items.hidden,
      huge: items.huge,
      titanic: items.titanic,
      gargantuan: items.gargantuan,
    })
    .from(items)
    .innerJoin(collections, eq(collections.name, items.collectionName))
    .where(
      and(
        eq(collections.enabled, true),
        eq(items.variant, 0),
        eq(items.shiny, false),
        eq(items.chroma, 0),
        eq(items.tier, 0),
      ),
    );
}

// Backfills URL slugs for chroma variant rows written before chroma slugs
// existed (or whose color list arrived later). Idempotent: only rows with
// NULL slugs are considered, and slug assignment is uniqueness-checked.
export async function repairVariantSlugs(): Promise<number> {
  const rows = await db
    .select({
      id: items.id,
      collectionName: items.collectionName,
      name: items.name,
      variant: items.variant,
      shiny: items.shiny,
      chroma: items.chroma,
      tier: items.tier,
      colorVariants: items.colorVariants,
    })
    .from(items)
    .where(and(isNull(items.slug), eq(items.tier, 0), sql`${items.chroma} != 0`));

  let assigned = 0;
  for (const row of rows) {
    const dims: VariantDims = {
      variant: row.variant,
      shiny: row.shiny,
      chroma: row.chroma,
      tier: row.tier,
    };
    const colorName =
      readColorVariants(row.colorVariants).get(row.chroma)?.name ?? null;
    const prefix = variantSlugPrefix(dims, colorName);
    if (prefix === null) continue;
    const slug = await uniqueSlugFor(`${prefix}${baseSlug(row.name)}`, row.collectionName, row.id);
    await db.update(items).set({ slug }).where(eq(items.id, row.id));
    assigned += 1;
  }
  return assigned;
}

// Repairs display names of chroma variant rows written before color labels
// existed: rewrites them to "<label> <primary displayName>" (e.g.
// "Blue Huge Chroma Phoenix") based on the sibling primary row. Idempotent.
export async function repairVariantDisplayNames(): Promise<number> {
  const chromaRows = await db
    .select({
      id: items.id,
      collectionName: items.collectionName,
      name: items.name,
      displayName: items.displayName,
      variant: items.variant,
      shiny: items.shiny,
      chroma: items.chroma,
      tier: items.tier,
      colorVariants: items.colorVariants,
    })
    .from(items)
    .where(and(eq(items.tier, 0), sql`${items.chroma} != 0`));

  const primaries = await db
    .select({
      collectionName: items.collectionName,
      name: items.name,
      displayName: items.displayName,
    })
    .from(items)
    .where(
      and(
        eq(items.variant, 0),
        eq(items.shiny, false),
        eq(items.chroma, 0),
        eq(items.tier, 0),
      ),
    );
  const primaryNames = new Map(
    primaries.map((p) => [`${p.collectionName}:${p.name}`, p.displayName ?? p.name]),
  );

  let updated = 0;
  for (const row of chromaRows) {
    const primaryDisplayName = primaryNames.get(`${row.collectionName}:${row.name}`);
    if (primaryDisplayName === undefined) continue;
    const colorName = readColorVariants(row.colorVariants).get(row.chroma)?.name ?? null;
    if (!colorName) continue;
    const label = variantLabel(
      { variant: row.variant, shiny: row.shiny, chroma: row.chroma, tier: row.tier },
      colorName,
    );
    const expected = label ? `${label} ${primaryDisplayName}` : primaryDisplayName;
    if (row.displayName === expected) continue;
    await db.update(items).set({ displayName: expected }).where(eq(items.id, row.id));
    updated += 1;
  }
  return updated;
}
