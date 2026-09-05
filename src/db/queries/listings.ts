import { sql } from 'drizzle-orm';
import { db } from '../client.js';
import { findItemByNameLower, type ItemRow } from './itemsRepo.js';
import { loadHistory, type Metric } from './snapshotsRepo.js';
import { createLogger } from '../../logger.js';

const log = createLogger({ namespace: 'db.listings' });

// Latest snapshot per item row (i.e. per variant), deterministically via
// ROW_NUMBER (no ties).
const LATEST_CTE = sql`WITH latest AS (
  SELECT item_id, value FROM (
    SELECT item_id, value,
      ROW_NUMBER() OVER (PARTITION BY item_id ORDER BY captured_at DESC) rn
    FROM snapshots WHERE metric = 'rap'
  ) WHERE rn = 1
)`;

const LATEST_EXISTS_CTE = sql`, latest_exists AS (
  SELECT item_id, value FROM (
    SELECT item_id, value,
      ROW_NUMBER() OVER (PARTITION BY item_id ORDER BY captured_at DESC) rn
    FROM snapshots WHERE metric = 'exists'
  ) WHERE rn = 1
)`;

const HOUR_EXISTS_CTE = sql`, hour_exists AS (
  SELECT item_id, value, captured_at FROM (
    SELECT item_id, value, captured_at,
      ROW_NUMBER() OVER (PARTITION BY item_id ORDER BY captured_at DESC) rn
    FROM snapshots
    WHERE metric = 'exists' AND captured_at <= unixepoch() - 3600
  ) WHERE rn = 1
)`;

function itemKeyExpr(): ReturnType<typeof sql> {
  return sql`i.name || CASE i.variant WHEN 1 THEN ':golden' WHEN 2 THEN ':rainbow' ELSE '' END || CASE WHEN i.shiny = 1 THEN ':shiny' ELSE '' END`;
}

export interface RawListRow {
  name: string;
  displayName: string;
  category: string | null;
  collectionName: string;
  itemKey: string;
  rap: number | null;
  pt: number;
  shiny: number;
}

export interface RawVariantRow {
  name: string;
  displayName: string | null;
  slug: string | null;
  pt: number;
  shiny: number;
  chroma: number;
  tier: number;
  rap: number | null;
  exists: number | null;
}

export type SortKey =
  | 'rap_desc'
  | 'rap_asc'
  | 'name_asc'
  | 'name_desc'
  | 'copies_desc'
  | 'copies_asc'
  | 'newest'
  | 'oldest';

export type ShinyFilter = 'all' | 'no' | 'yes';
export type PtFilter = 'all' | 'regular' | 'golden' | 'rainbow';
export type ExistsRange = 'all' | 'lt100' | 'lt1k' | 'lt5k' | 'gt100' | 'gt1k' | 'gt10k' | 'gt100k';

export interface FilteredListRowsParams {
  q: string;
  sort: SortKey;
  shiny: ShinyFilter;
  pt: PtFilter;
  category: string;
  collection: string;
  existsRange: ExistsRange;
  showRapZero: boolean;
  showExistsZero: boolean;
  hidePets: boolean;
  page: number;
  pageSize: number;
}

export interface RawFilteredRow {
  name: string;
  displayName: string | null ;
  slug: string | null;
  category: string | null;
  categoryName: string | null;
  collectionName: string;
  itemKey: string;
  imageId: number | null;
  rap: number | null;
  pt: number;
  shiny: number;
  existsCount: number | null;
  existsPerHour: number | null;
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (c) => `\\${c}`);
}

function buildFilteredWhere(params: FilteredListRowsParams): ReturnType<typeof sql> {
  const clauses: ReturnType<typeof sql>[] = [];

  if (params.q.length > 0) {
    clauses.push(sql`LOWER(i.name) LIKE ${`%${escapeLike(params.q.toLowerCase())}%`}`);
  }
  if (params.shiny === 'no') {
    clauses.push(sql`i.shiny = 0`);
  } else if (params.shiny === 'yes') {
    clauses.push(sql`i.shiny = 1`);
  }
  if (params.pt === 'regular') {
    clauses.push(sql`i.variant = 0`);
  } else if (params.pt === 'golden') {
    clauses.push(sql`i.variant = 1`);
  } else if (params.pt === 'rainbow') {
    clauses.push(sql`i.variant = 2`);
  }
  if (params.category !== 'all') {
    if (params.category === 'huge') clauses.push(sql`i.huge = 1`);
    else if (params.category === 'titanic') clauses.push(sql`i.titanic = 1`);
    else if (params.category === 'gargantuan') clauses.push(sql`i.gargantuan = 1`);
  }
  if (params.collection !== 'all') {
    clauses.push(sql`i.collection = ${params.collection}`);
  }

  const rangeSql: Record<Exclude<ExistsRange, 'all'>, ReturnType<typeof sql>> = {
    lt100: sql`e.value < 100`,
    lt1k: sql`e.value < 1000`,
    lt5k: sql`e.value < 5000`,
    gt100: sql`e.value > 100`,
    gt1k: sql`e.value > 1000`,
    gt10k: sql`e.value > 10000`,
    gt100k: sql`e.value > 100000`,
  };
  if (params.existsRange !== 'all') {
    clauses.push(rangeSql[params.existsRange]);
  }
  if (!params.showRapZero) {
    clauses.push(sql`(l.value IS NOT NULL AND l.value > 0)`);
  }
  if (!params.showExistsZero) {
    clauses.push(sql`(e.value IS NOT NULL AND e.value > 0)`);
  }
  if (params.hidePets) {
    clauses.push(sql`i.collection != 'Pets'`);
  }

  // Items in hidden categories (non-exclusive eggs, event categories) are
  // excluded from listings — UNLESS they carry market data: several event
  // items have rap/exists and those stay visible (owner rule). Individually
  // hidden items (i.hidden) are always excluded.
  clauses.push(sql`NOT (
    EXISTS (
      SELECT 1 FROM category cg WHERE cg.name = i."categoryName" AND cg.hidden = 1
    )
    AND NOT EXISTS (
      SELECT 1 FROM snapshots s WHERE s.item_id = i.id
    )
  )`);
  clauses.push(sql`i.hidden = 0`);
  return sql` WHERE ${sql.join(clauses, sql` AND `)}`;
}

function buildFilteredOrderBy(sort: SortKey): ReturnType<typeof sql> {
  switch (sort) {
    case 'rap_desc':
      return sql` ORDER BY CASE WHEN l.value IS NULL THEN 1 ELSE 0 END, l.value DESC, LOWER(i.name) ASC`;
    case 'rap_asc':
      return sql` ORDER BY CASE WHEN l.value IS NULL THEN 1 ELSE 0 END, l.value ASC, LOWER(i.name) ASC`;
    case 'name_asc':
      return sql` ORDER BY LOWER(i.name) ASC`;
    case 'name_desc':
      return sql` ORDER BY LOWER(i.name) DESC`;
    case 'copies_desc':
      return sql` ORDER BY CASE WHEN e.value IS NULL THEN 1 ELSE 0 END, e.value DESC, LOWER(i.name) ASC`;
    case 'copies_asc':
      return sql` ORDER BY CASE WHEN e.value IS NULL THEN 1 ELSE 0 END, e.value ASC, LOWER(i.name) ASC`;
    case 'newest':
      return sql` ORDER BY i."createdAt" DESC`;
    case 'oldest':
      return sql` ORDER BY i."createdAt" ASC`;
  }
}

export function deriveCategory(
  huge: number | boolean,
  titanic: number | boolean,
  gargantuan: number | boolean,
): string | null {
  if (Number(titanic)) return 'Titanic';
  if (Number(gargantuan)) return 'Gargantuan';
  if (Number(huge)) return 'Huge';
  return null;
}

export async function listRowsFiltered(
  params: FilteredListRowsParams,
): Promise<RawFilteredRow[]> {
  return log.timerFn(
    `list rows filtered ${params.sort} p${params.page} sz${params.pageSize}`,
    async () => {
      const where = buildFilteredWhere(params);
      const orderBy = buildFilteredOrderBy(params.sort);
      const offset = (params.page - 1) * params.pageSize;

      const rows = (await db.all<Omit<RawFilteredRow, 'category' | 'existsPerHour'> & {
        huge: number;
        titanic: number;
        gargantuan: number;
        imageId: number | null;
        existsHourValue: number | null;
        existsHourAt: number | null;
      }>(sql`${LATEST_CTE}${LATEST_EXISTS_CTE}${HOUR_EXISTS_CTE}
        SELECT i.name, i."displayName" AS displayName, i.slug AS slug, i.imageId AS imageId,
               i.huge, i.titanic, i.gargantuan,
               i.collection AS collectionName, i."categoryName" AS categoryName,
               ${itemKeyExpr()} AS itemKey,
               l.value AS rap, i.variant AS pt, i.shiny AS shiny,
               e.value AS existsCount,
               h.value AS existsHourValue, h.captured_at AS existsHourAt
        FROM items i
        LEFT JOIN latest l ON l.item_id = i.id
        LEFT JOIN latest_exists e ON e.item_id = i.id
        LEFT JOIN hour_exists h ON h.item_id = i.id${where}${orderBy}
        LIMIT ${params.pageSize} OFFSET ${offset}`)) as unknown as (RawFilteredRow & {
        huge: number;
        titanic: number;
        gargantuan: number;
        existsHourValue: number | null;
        existsHourAt: number | null;
      })[];
      const nowSec = Math.floor(Date.now() / 1000);
      for (const row of rows) {
        row.category = deriveCategory(row.huge, row.titanic, row.gargantuan);
        if (
          row.existsCount !== null &&
          row.existsHourValue !== null &&
          row.existsHourAt !== null &&
          nowSec - Number(row.existsHourAt) >= 600
        ) {
          const hours = (nowSec - Number(row.existsHourAt)) / 3600;
          row.existsPerHour = Math.round((row.existsCount - row.existsHourValue) / hours);
        } else {
          row.existsPerHour = null;
        }
      }
      return rows;
    },
    'debug',
  );
}

export async function countItemsFiltered(params: FilteredListRowsParams): Promise<number> {
  return log.timerFn(
    `count items filtered ${params.sort} p${params.page} sz${params.pageSize}`,
    async () => {
      const where = buildFilteredWhere(params);
      const rows = (await db.all<{ total: number }>(sql`${LATEST_CTE}${LATEST_EXISTS_CTE}
        SELECT COUNT(*) AS total
        FROM items i
        LEFT JOIN latest l ON l.item_id = i.id
        LEFT JOIN latest_exists e ON e.item_id = i.id${where}`)) as {
        total: number;
      }[];
      return rows[0]?.total ?? 0;
    },
    'debug',
  );
}

export interface ListRowsParams {
  search: string;
  sort: 'name' | 'rap';
  order: 'asc' | 'desc';
  page: number;
  pageSize: number;
}

export async function listRowsRaw(params: ListRowsParams): Promise<RawListRow[]> {
  return log.timerFn(
    `list rows raw ${params.sort} ${params.order} p${params.page} sz${params.pageSize}`,
    async () => {
      const where =
        params.search.length > 0
          ? sql` WHERE LOWER(i.name) LIKE ${`%${escapeLike(params.search)}%`}`
          : sql``;

      const orderBy =
        params.sort === 'name'
          ? sql` ORDER BY LOWER(i.name) ${sql.raw(params.order)}`
          : sql` ORDER BY l.value ${sql.raw(params.order)}, LOWER(i.name) ASC`;

      const offset = (params.page - 1) * params.pageSize;

      const rows = (await db.all<Omit<RawListRow, 'category'> & { huge: number; titanic: number; gargantuan: number }>(sql`${LATEST_CTE}
        SELECT i.name, i."displayName" AS displayName, i.huge, i.titanic, i.gargantuan, i.collection AS collectionName,
               ${itemKeyExpr()} AS itemKey,
               l.value AS rap, i.variant AS pt, i.shiny AS shiny
        FROM items i
        LEFT JOIN latest l ON l.item_id = i.id${where}${orderBy}
        LIMIT ${params.pageSize} OFFSET ${offset}`)) as unknown as RawListRow[];
      for (const row of rows as unknown as (RawListRow & { huge: number; titanic: number; gargantuan: number })[]) {
        row.category = deriveCategory(row.huge, row.titanic, row.gargantuan);
      }
      return rows;
    },
    'debug',
  );
}

export interface RawSimilarItemRow {
  name: string;
  slug: string | null;
  category: string | null;
  rap: number | null;
  exists: number | null;
}

export async function similarItemsFor(
  itemId: number,
  category: string | null,
  collectionName: string,
  excludeName: string,
): Promise<RawSimilarItemRow[]> {
  return log.timerFn(`similar items for ${itemId} (${category ?? 'collection'})`, async () => {
    const match = category
      ? sql`(CASE WHEN ${category} = 'Titanic' THEN i.titanic WHEN ${category} = 'Gargantuan' THEN i.gargantuan ELSE i.huge END) = 1`
      : sql`i.collection = ${collectionName}`;
    const rows = (await db.all<Omit<RawSimilarItemRow, 'category'> & { huge: number; titanic: number; gargantuan: number }>(sql`${LATEST_CTE}${LATEST_EXISTS_CTE}
      SELECT i.name, i.slug AS slug, i.huge, i.titanic, i.gargantuan,
             l.value AS rap, e.value AS "exists"
      FROM items i
      LEFT JOIN latest l ON l.item_id = i.id
      LEFT JOIN latest_exists e ON e.item_id = i.id
      WHERE i.id != ${itemId} AND LOWER(i.name) != LOWER(${excludeName}) AND ${match}
      ORDER BY CASE WHEN l.value IS NULL THEN 1 ELSE 0 END, l.value DESC, LOWER(i.name) ASC
      LIMIT 8`)) as unknown as RawSimilarItemRow[];
    for (const row of rows as unknown as (RawSimilarItemRow & { huge: number; titanic: number; gargantuan: number })[]) {
      row.category = deriveCategory(row.huge, row.titanic, row.gargantuan);
    }
    return rows;
  }, 'debug');
}

export async function itemByName(name: string): Promise<ItemRow | undefined> {
  return log.timerFn(`item by name ${name}`, async () => {
    return findItemByNameLower(name);
  }, 'debug');
}

// All rows sharing the base (collection, name), each with its own latest
// values. Includes tiered rows (tier surfaced so callers can separate the
// ladder from regular variants); chroma rows are included (colors resolved in
// rapService).
export async function variantsForItem(
  collectionName: string,
  name: string,
): Promise<RawVariantRow[]> {
  return log.timerFn(`variants for ${collectionName}/${name}`, async () => {
    return (await db.all<RawVariantRow>(sql`${LATEST_CTE}${LATEST_EXISTS_CTE}
      SELECT s.name AS name, s."displayName" AS displayName, s.slug AS slug,
             s.variant AS pt, s.shiny AS shiny, s.chroma AS chroma, s.tier AS tier,
             l.value AS rap, e.value AS "exists"
      FROM items s
      LEFT JOIN latest l ON l.item_id = s.id
      LEFT JOIN latest_exists e ON e.item_id = s.id
      WHERE s.collection = ${collectionName} AND LOWER(s.name) = LOWER(${name})
      ORDER BY s.tier ASC, pt ASC, shiny ASC, chroma ASC`)) as RawVariantRow[];
  }, 'debug');
}

export async function historyFor(
  itemId: number,
  metric: Metric = 'rap',
  limit = 200,
): Promise<{ captured_at: number; value: number }[]> {
  return log.timerFn(`history for ${itemId} ${metric}`, async () => {
    return loadHistory(itemId, metric, limit);
  }, 'debug');
}

export async function existsHistoryFor(
  itemId: number,
  limit = 200,
): Promise<{ captured_at: number; value: number }[]> {
  return log.timerFn(`exists history for ${itemId}`, async () => {
    return loadHistory(itemId, 'exists', limit);
  }, 'debug');
}

// True cross-variant total: sums the latest exists value of every sibling row
// sharing the base (collection, name).
export async function totalLatestExists(itemId: number): Promise<number | null> {
  return log.timerFn(`total latest exists ${itemId}`, async () => {
    const rows = (await db.all<{ total: number | null }>(
      sql`SELECT SUM(value) AS total FROM (
            SELECT value FROM (
              SELECT item_id, value,
                ROW_NUMBER() OVER (PARTITION BY item_id ORDER BY captured_at DESC) rn
              FROM snapshots
              WHERE metric = 'exists'
                AND item_id IN (
                  SELECT id FROM items
                  WHERE collection = (SELECT collection FROM items WHERE id = ${itemId})
                    AND name = (SELECT name FROM items WHERE id = ${itemId})
                )
            ) WHERE rn = 1
          )`,
    )) as { total: number | null }[];
    return rows[0]?.total ?? null;
  }, 'debug');
}
