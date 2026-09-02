import { and, eq, inArray, sql } from 'drizzle-orm';
import { db } from '../client.js';
import { collections, items } from '../schema.js';
import { readColorVariants } from '../../services/collectionSpecs.js';
import { slugify } from '../../util/slug.js';
import { createLogger } from '../../logger.js';

const log = createLogger({ namespace: 'db.items' });

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
  /** Pre-serialized raw upstream configData JSON; null when unknown. */
  configData?: string | null;
  /** Upstream internal category string ("Exclusive Eggs", "Update 5", …). */
  categoryName?: string | null;
  /**
   * Desired slug stem (already slugified). When omitted, the stem derives from
   * `name`. Variant prefixes still prepend onto this stem.
   */
  slug?: string;
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

// URL grammar for non-primary variants: [shiny-][golden|rainbow-][color-]<stem>.
// Chroma variants are addressed by their color name (resolved from the row's
// own colorVariants list — mappings are per-item upstream). Tiered variants
// are addressed only when the caller supplies an explicit stem (namespace
// grammar); without one they stay unaddressable.
function variantSlugPrefix(dims: VariantDims, colorName: string | null): string | null {
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
// latecomers take a -<collection> suffix, then numeric disambiguation. The
// assigner is batch-aware: first-choice candidates are preloaded in one query,
// and slugs claimed earlier in the same batch count as taken (uniqueness is
// global across collections).
class SlugAssigner {
  private readonly taken = new Map<string, number>();

  /** Preloads candidates so the common path needs a single query per batch. */
  async preload(candidates: string[], selfOwned: Map<string, number>): Promise<void> {
    const fresh = candidates.filter((c) => !this.taken.has(c));
    for (const batch of chunkOf(fresh, 500)) {
      const rows = await db
        .select({ id: items.id, slug: items.slug })
        .from(items)
        .where(inArray(items.slug, batch));
      for (const row of rows) {
        if (row.slug !== null) this.taken.set(row.slug, row.id);
      }
    }
    for (const [candidate, id] of selfOwned) this.taken.set(candidate, id);
  }

  async assign(
    candidate: string,
    collectionName: string,
    selfId: number | undefined,
  ): Promise<string> {
    const owner = this.taken.get(candidate);
    if (owner === undefined || owner === selfId) {
      if (owner === undefined) this.taken.set(candidate, selfId ?? -1);
      return candidate;
    }
    const scoped = `${candidate}-${collectionName.toLowerCase()}`;
    if (!(await this.resolveTaken(scoped, selfId))) {
      if (!this.taken.has(scoped)) this.taken.set(scoped, selfId ?? -1);
      return scoped;
    }
    for (let n = 2; ; n += 1) {
      const numbered = `${scoped}-${n}`;
      if (!(await this.resolveTaken(numbered, selfId))) {
        if (!this.taken.has(numbered)) this.taken.set(numbered, selfId ?? -1);
        return numbered;
      }
    }
  }

  private async resolveTaken(candidate: string, selfId: number | undefined): Promise<boolean> {
    const owner = this.taken.get(candidate);
    if (owner !== undefined) return owner !== selfId;
    const rows = await db
      .select({ id: items.id })
      .from(items)
      .where(eq(items.slug, candidate))
      .limit(1);
    if (rows.length > 0) {
      this.taken.set(candidate, rows[0].id);
      return rows[0].id !== selfId;
    }
    return false;
  }
}

function chunkOf<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (c) => `\\${c}`);
}

export async function countItems(search?: string): Promise<number> {
  return log.timerFn('count items', async () => {
    const normalized = (search ?? '').trim().toLowerCase();
    const where =
      normalized.length > 0 ? sql` WHERE LOWER(i.name) LIKE ${`%${escapeLike(normalized)}%`}` : sql``;
    const countRows = (await db.all<{ total: number }>(
      sql`SELECT COUNT(*) AS total FROM items i${where}`,
    )) as { total: number }[];
    return countRows[0]?.total ?? 0;
  }, 'debug');
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
  return log.timerFn(`find item by slug ${itemSlug}`, async () => {
    const normalized = slugify(itemSlug).toLowerCase();
    if (!normalized) return undefined;
    const rows = await itemRowSelect().where(eq(items.slug, normalized)).limit(1);
    return rows[0];
  }, 'debug');
}

export async function findItemByNameLower(name: string): Promise<ItemRow | undefined> {
  return log.timerFn(`find item by name lower ${name}`, async () => {
    const rows = await itemRowSelect()
      .where(sql`LOWER(${items.name}) = ${name.toLowerCase()}`)
      .limit(1);
    // Prefer the primary row when several variants share a name.
    if (rows.length === 0) return undefined;
    const primary = rows.find((r) => r.variant === 0 && !r.shiny && r.chroma === 0 && r.tier === 0);
    return primary ?? rows[0];
  }, 'debug');
}

export async function findItemVariant(
  name: string,
  dims: VariantDims,
): Promise<ItemRow | undefined> {
  return log.timerFn(`find item variant ${name}`, async () => {
    const rows = await itemRowSelect()
      .where(
        and(
          sql`LOWER(${items.name}) = ${name.toLowerCase()}`,
          eq(items.variant, dims.variant),
          eq(items.shiny, dims.shiny),
          eq(items.chroma, dims.chroma),
          eq(items.tier, dims.tier),
        ),
      )
      .limit(1);
    return rows[0];
  }, 'debug');
}

export async function findImageIdByName(name: string): Promise<number | null> {
  return log.timerFn(`find image id by name ${name}`, async () => {
    const found = await db
      .select({ imageId: items.imageId })
      .from(items)
      .where(
        sql`(LOWER(${items.displayName}) = ${name.toLowerCase()} OR LOWER(${items.name}) = ${name.toLowerCase()}) AND ${items.imageId} IS NOT NULL`,
      )
      .limit(1);
    return found[0]?.imageId ?? null;
  }, 'debug');
}

interface NormalizedUpsert {
  params: UpsertItemParams;
  dims: VariantDims;
  /** First-choice slug candidate, or null when the variant is unaddressable. */
  candidate: string | null;
  /** Assigned slug after uniqueness resolution; null when unaddressable. */
  finalSlug?: string | null;
}

function normalizeUpsert(params: UpsertItemParams): NormalizedUpsert {
  const dims: VariantDims = {
    variant: params.variant ?? 0,
    shiny: params.shiny ?? false,
    chroma: params.chroma ?? 0,
    tier: params.tier ?? 0,
  };
  const colorName =
    dims.chroma !== 0
      ? (readColorVariants(params.colorVariants ?? null).get(dims.chroma)?.name ?? null)
      : null;
  const prefix = variantSlugPrefix(dims, colorName);
  let candidate: string | null = null;
  if (prefix !== null) {
    if (params.slug !== undefined) {
      candidate = `${prefix}${params.slug}`;
    } else if (dims.tier === 0) {
      candidate = `${prefix}${baseSlug(params.name)}`;
    }
    // Tiered rows without an explicit stem stay unaddressable.
  }
  return { params, dims, candidate };
}

// Stable identity key for an (item identity + dims) pair. Shared with the sync
// pipeline so existence lookups and upserts agree on addressing.
export function itemIdentityKey(collectionName: string, name: string, dims: VariantDims): string {
  return [collectionName, name, dims.variant, dims.shiny ? 1 : 0, dims.chroma, dims.tier].join(
    '\u0000',
  );
}

export interface VariantRef {
  collectionName: string;
  name: string;
  dims: VariantDims;
}

// Resolves ids for existing item rows matching full identities; missing keys
// are absent from the returned map.
export async function findVariantIds(refs: VariantRef[]): Promise<Map<string, number>> {
  return log.timerFn(`find variant ids (${refs.length})`, async () => {
    if (refs.length === 0) return new Map();
    const collections = [...new Set(refs.map((r) => r.collectionName))];
    const rows = await db
      .select({
        id: items.id,
        collectionName: items.collectionName,
        name: items.name,
        variant: items.variant,
        shiny: items.shiny,
        chroma: items.chroma,
        tier: items.tier,
      })
      .from(items)
      .where(inArray(items.collectionName, collections));
    const byIdentity = new Map(
      rows.map((r) => [
        itemIdentityKey(r.collectionName, r.name, {
          variant: r.variant,
          shiny: r.shiny,
          chroma: r.chroma,
          tier: r.tier,
        }),
        r.id,
      ]),
    );
    const out = new Map<string, number>();
    for (const ref of refs) {
      const key = itemIdentityKey(ref.collectionName, ref.name, ref.dims);
      const id = byIdentity.get(key);
      if (id !== undefined) out.set(key, id);
    }
    return out;
  }, 'debug');
}

// Single-row convenience wrapper around upsertItems; returns the row's id.
export async function upsertItem(params: UpsertItemParams): Promise<number> {
  return log.timerFn(`upsert item ${params.collectionName}/${params.name}`, async () => {
    await upsertItems([params]);
    const dims: VariantDims = {
      variant: params.variant ?? 0,
      shiny: params.shiny ?? false,
      chroma: params.chroma ?? 0,
      tier: params.tier ?? 0,
    };
    const ids = await findVariantIds([
      { collectionName: params.collectionName, name: params.name, dims },
    ]);
    const id = ids.get(itemIdentityKey(params.collectionName, params.name, dims));
    if (id === undefined) {
      throw new Error(
        `upsertItem: row not found after upsert (${params.collectionName}/${params.name})`,
      );
    }
    return id;
  }, 'debug');
}

// Batched upsert of item rows (one multi-row INSERT ... ON CONFLICT per chunk).
// Slugs are assigned first-come in list order with a single preloaded uniqueness
// check; existing rows are updated in place (ids preserved).
export async function upsertItems(paramsList: UpsertItemParams[]): Promise<number> {
  return log.timerFn(`upsert items (${paramsList.length})`, async () => {
    if (paramsList.length === 0) return 0;

    const normalized = paramsList.map(normalizeUpsert);

    // Load existing rows for the involved collections to learn current ids/slugs.
    const collections = [...new Set(normalized.map((n) => n.params.collectionName))];
    const existingRows = await db
      .select({
        id: items.id,
        collectionName: items.collectionName,
        name: items.name,
        slug: items.slug,
        variant: items.variant,
        shiny: items.shiny,
        chroma: items.chroma,
        tier: items.tier,
      })
      .from(items)
      .where(inArray(items.collectionName, collections));
    const existingByIdentity = new Map(
      existingRows.map((r) => [
        itemIdentityKey(r.collectionName, r.name, {
          variant: r.variant,
          shiny: r.shiny,
          chroma: r.chroma,
          tier: r.tier,
        }),
        { id: r.id, slug: r.slug },
      ]),
    );

    // Slug pass: preload all first-choice candidates in one bulk query, then
    // assign sequentially so earlier rows win collisions deterministically. A row
    // whose stored slug already equals its candidate keeps it.
    const assigner = new SlugAssigner();
    const candidates = [
      ...new Set(normalized.map((n) => n.candidate).filter((c): c is string => c !== null)),
    ];
    const selfOwned = new Map<string, number>();
    for (const n of normalized) {
      if (n.candidate === null) continue;
      const existing = existingByIdentity.get(
        itemIdentityKey(n.params.collectionName, n.params.name, n.dims),
      );
      if (existing && existing.slug === n.candidate) selfOwned.set(n.candidate, existing.id);
    }
    await assigner.preload(candidates, selfOwned);

    for (const n of normalized) {
      if (n.candidate === null) {
        n.finalSlug = null;
        continue;
      }
      const existing = existingByIdentity.get(
        itemIdentityKey(n.params.collectionName, n.params.name, n.dims),
      );
      n.finalSlug = await assigner.assign(n.candidate, n.params.collectionName, existing?.id);
    }

    // Write pass: chunked multi-row upserts against the full identity index.
    // createdAt is intentionally untouched on conflict.
    for (const batch of chunkOf(normalized, 100)) {
      await db
        .insert(items)
        .values(
          batch.map(({ params, dims, finalSlug }) => ({
            collectionName: params.collectionName,
            name: params.name,
            displayName: params.displayName ?? null,
            description: params.description ?? null,
            slug: finalSlug ?? null,
            hidden: params.hidden ?? false,
            imageId: params.imageId ?? null,
            huge: params.huge ?? false,
            titanic: params.titanic ?? false,
            gargantuan: params.gargantuan ?? false,
            colorVariants: params.colorVariants ?? null,
            configData: params.configData ?? null,
            categoryName: params.categoryName ?? null,
            ...dims,
          })),
        )
        .onConflictDoUpdate({
          target: [
            items.collectionName,
            items.name,
            items.variant,
            items.shiny,
            items.chroma,
            items.tier,
          ],
          set: {
            displayName: sql`excluded."displayName"`,
            description: sql`excluded."description"`,
            slug: sql`excluded."slug"`,
            hidden: sql`excluded."hidden"`,
            imageId: sql`excluded."imageId"`,
            huge: sql`excluded."huge"`,
            titanic: sql`excluded."titanic"`,
            gargantuan: sql`excluded."gargantuan"`,
            colorVariants: sql`excluded."colorVariants"`,
            configData: sql`excluded."configData"`,
            categoryName: sql`excluded."categoryName"`,
          },
        });
    }
    return paramsList.length;
  }, 'debug');
}

export async function getBaseItemsWithCollection(): Promise<
  {
    id: number;
    collectionName: string;
    name: string;
    displayName: string | null;
    description: string | null;
    colorVariants: string | null;
    configData: string | null;
    imageId: number | null;
    hidden: boolean;
    huge: boolean;
    titanic: boolean;
    gargantuan: boolean;
    categoryName: string | null;
  }[]
> {
  return log.timerFn('get base items with collection', async () => {
    return db
      .select({
        id: items.id,
        collectionName: items.collectionName,
        name: items.name,
        displayName: items.displayName,
        description: items.description,
        colorVariants: items.colorVariants,
        configData: items.configData,
        imageId: items.imageId,
        hidden: items.hidden,
        huge: items.huge,
        titanic: items.titanic,
        gargantuan: items.gargantuan,
        categoryName: items.categoryName,
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
  }, 'debug');
}
