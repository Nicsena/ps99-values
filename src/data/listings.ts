import { sql } from 'drizzle-orm';
import { db } from '../db/client.js';
import { findItemByNameLower, type ItemRow } from './itemsRepo.js';
import { loadHistory } from './snapshotsRepo.js';

export const LATEST_CTE = sql`WITH latest AS (
  SELECT item_id, pt, shiny, item_key, value FROM rap_snapshots
  GROUP BY item_id, pt, shiny HAVING captured_at = MAX(captured_at)
)`;

const LATEST_EXISTS_CTE = sql`, latest_exists AS (
  SELECT item_id, pt, shiny, item_key, value FROM exists_snapshots
  GROUP BY item_id, pt, shiny HAVING captured_at = MAX(captured_at)
)`;

export interface RawListRow {
  name: string;
  category: string | null;
  collectionName: string;
  itemKey: string;
  rap: number | null;
  pt: number;
  shiny: number;
}

export interface RawVariantRow {
  pt: number;
  shiny: number;
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
  category: string | null;
  collectionName: string;
  itemKey: string;
  rap: number | null;
  pt: number;
  shiny: number;
  existsCount: number | null;
}

function buildFilteredWhere(params: FilteredListRowsParams): ReturnType<typeof sql> {
  const clauses: ReturnType<typeof sql>[] = [];

  if (params.q.length > 0) {
    clauses.push(sql`LOWER(i.name) LIKE ${`%${params.q.toLowerCase()}%`}`);
  }
  if (params.shiny === 'no') {
    clauses.push(sql`COALESCE(l.shiny, 0) = 0`);
  } else if (params.shiny === 'yes') {
    clauses.push(sql`COALESCE(l.shiny, 0) = 1`);
  }
  if (params.pt === 'regular') {
    clauses.push(sql`COALESCE(l.pt, 0) = 0`);
  } else if (params.pt === 'golden') {
    clauses.push(sql`COALESCE(l.pt, 0) = 1`);
  } else if (params.pt === 'rainbow') {
    clauses.push(sql`COALESCE(l.pt, 0) = 2`);
  }
  if (params.category !== 'all') {
    clauses.push(sql`LOWER(i.category) = LOWER(${params.category})`);
  }
  if (params.collection !== 'all') {
    clauses.push(sql`i.collection_name = ${params.collection}`);
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
    clauses.push(sql`i.collection_name != 'Pets'`);
  }

  if (clauses.length === 0) return sql``;
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
      return sql` ORDER BY i.date_synced DESC`;
    case 'oldest':
      return sql` ORDER BY i.date_synced ASC`;
  }
}

export async function listRowsFiltered(
  params: FilteredListRowsParams,
): Promise<RawFilteredRow[]> {
  const where = buildFilteredWhere(params);
  const orderBy = buildFilteredOrderBy(params.sort);
  const offset = (params.page - 1) * params.pageSize;

  return (await db.all<RawFilteredRow>(sql`${LATEST_CTE}${LATEST_EXISTS_CTE}
    SELECT i.name, i.category, i.collection_name AS collectionName,
           COALESCE(l.item_key, i.name) AS itemKey,
           l.value AS rap, COALESCE(l.pt, 0) AS pt, COALESCE(l.shiny, 0) AS shiny,
           e.value AS existsCount
    FROM items i
    LEFT JOIN latest l ON l.item_id = i.id
    LEFT JOIN latest_exists e ON e.item_id = i.id
      AND e.pt = COALESCE(l.pt, 0) AND e.shiny = COALESCE(l.shiny, 0)${where}${orderBy}
    LIMIT ${params.pageSize} OFFSET ${offset}`)) as RawFilteredRow[];
}

export async function countItemsFiltered(params: FilteredListRowsParams): Promise<number> {
  const where = buildFilteredWhere(params);
  const rows = (await db.all<{ total: number }>(sql`${LATEST_CTE}${LATEST_EXISTS_CTE}
    SELECT COUNT(*) AS total
    FROM items i
    LEFT JOIN latest l ON l.item_id = i.id
    LEFT JOIN latest_exists e ON e.item_id = i.id
      AND e.pt = COALESCE(l.pt, 0) AND e.shiny = COALESCE(l.shiny, 0)${where}`)) as {
    total: number;
  }[];
  return rows[0]?.total ?? 0;
}

export interface ListRowsParams {
  search: string;
  sort: 'name' | 'rap';
  order: 'asc' | 'desc';
  page: number;
  pageSize: number;
}

export async function listRowsRaw(params: ListRowsParams): Promise<RawListRow[]> {
  const where =
    params.search.length > 0
      ? sql` WHERE LOWER(i.name) LIKE ${`%${params.search}%`}`
      : sql``;

  const orderBy =
    params.sort === 'name'
      ? sql` ORDER BY LOWER(i.name) ${sql.raw(params.order)}`
      : sql` ORDER BY l.value ${sql.raw(params.order)}, LOWER(i.name) ASC`;

  const offset = (params.page - 1) * params.pageSize;

  return (await db.all<RawListRow>(sql`${LATEST_CTE}
    SELECT i.name, i.category, i.collection_name AS collectionName,
           COALESCE(l.item_key, i.name) AS itemKey,
           l.value AS rap, COALESCE(l.pt, 0) AS pt, COALESCE(l.shiny, 0) AS shiny
    FROM items i
    LEFT JOIN latest l ON l.item_id = i.id${where}${orderBy}
    LIMIT ${params.pageSize} OFFSET ${offset}`)) as RawListRow[];
}

export async function itemByName(name: string): Promise<ItemRow | undefined> {
  return findItemByNameLower(name);
}

export async function variantsForItem(itemId: string): Promise<RawVariantRow[]> {
  return (await db.all<RawVariantRow>(sql`${LATEST_CTE}${LATEST_EXISTS_CTE}
    SELECT l.pt, l.shiny, l.value AS rap, e.value AS "exists" FROM latest l
    LEFT JOIN latest_exists e ON e.item_id = l.item_id AND e.pt = l.pt AND e.shiny = l.shiny
    WHERE l.item_id = ${itemId} ORDER BY l.pt ASC, l.shiny ASC`)) as RawVariantRow[];
}

export async function historyFor(
  itemId: string,
  pt: number,
  shinyInt: number,
  limit = 200,
): Promise<{ captured_at: number; value: number }[]> {
  return loadHistory(itemId, pt, shinyInt, limit);
}
