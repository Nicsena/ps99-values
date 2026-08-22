import { sql } from 'drizzle-orm';
import { db } from '../db/client.js';
import { items } from '../db/schema.js';
import { cacheGet, cacheSet } from '../cache.js';
import { buildRapItemKey } from './itemKey.js';

export interface ListItemRow {
  itemKey: string;
  name: string;
  category: string | null;
  collectionName: string;
  rap: number | null;
  pt: number;
  shiny: boolean;
}

export interface ListItemsResult {
  rows: ListItemRow[];
  total: number;
}

export interface ItemVariant {
  pt: number;
  shiny: boolean;
  rap: number | null;
  itemKey: string;
}

export interface ItemHistoryPoint {
  capturedAt: string;
  value: number;
}

export interface ItemDetail {
  item: {
    id: string;
    name: string;
    description: string | null;
    category: string | null;
    collectionName: string;
  };
  currentRap: number | null;
  variants: ItemVariant[];
  history: ItemHistoryPoint[];
}

interface RawListRow {
  name: string;
  category: string | null;
  collectionName: string;
  itemKey: string;
  rap: number | null;
  pt: number;
  shiny: number;
}

function mapListRow(row: RawListRow): ListItemRow {
  return {
    itemKey: row.itemKey,
    name: row.name,
    category: row.category,
    collectionName: row.collectionName,
    rap: row.rap === null ? null : row.rap,
    pt: row.pt,
    shiny: Number(row.shiny) !== 0,
  };
}

const LATEST_CTE = sql`WITH latest AS (
  SELECT item_id, pt, shiny, item_key, value FROM rap_snapshots
  GROUP BY item_id, pt, shiny HAVING captured_at = MAX(captured_at)
)`;

export async function listItems(params: {
  search?: string;
  sort?: string;
  order?: string;
  page?: number;
  pageSize?: number;
}): Promise<ListItemsResult> {
  const search = (params.search ?? '').trim().toLowerCase();
  const sort = params.sort === 'rap' ? 'rap' : 'name';
  const order = params.order === 'desc' ? 'desc' : 'asc';
  const pageSizeRaw = Number(params.pageSize ?? 25);
  const pageSize =
    Number.isFinite(pageSizeRaw) && pageSizeRaw >= 1 && pageSizeRaw <= 100
      ? Math.floor(pageSizeRaw)
      : 25;
  const pageRaw = Number(params.page ?? 1);
  const page = Number.isFinite(pageRaw) && pageRaw >= 1 ? Math.floor(pageRaw) : 1;

  const cacheKey = `rap:list:${search}:${sort}:${order}:${page}:${pageSize}`;
  const cached = await cacheGet<ListItemsResult>(cacheKey);
  if (cached) return cached;

  const where =
    search.length > 0
      ? sql` WHERE LOWER(i.name) LIKE ${`%${search}%`}`
      : sql``;

  const orderBy =
    sort === 'name'
      ? sql` ORDER BY LOWER(i.name) ${sql.raw(order)}`
      : sql` ORDER BY l.value ${sql.raw(order)}, LOWER(i.name) ASC`;

  const offset = (page - 1) * pageSize;

  const rawRows = (await db.all<RawListRow>(sql`${LATEST_CTE}
    SELECT i.name, i.category, i.collection_name AS collectionName,
           COALESCE(l.item_key, i.name) AS itemKey,
           l.value AS rap, COALESCE(l.pt, 0) AS pt, COALESCE(l.shiny, 0) AS shiny
    FROM items i
    LEFT JOIN latest l ON l.item_id = i.id${where}${orderBy}
    LIMIT ${pageSize} OFFSET ${offset}`)) as RawListRow[];

  const countRows = (await db.all<{ total: number }>(sql`
    SELECT COUNT(*) AS total FROM items i${where}`)) as { total: number }[];

  const result: ListItemsResult = {
    rows: rawRows.map(mapListRow),
    total: countRows[0]?.total ?? 0,
  };

  await cacheSet(cacheKey, result, 900);
  return result;
}

function parseItemKey(
  itemKey: string,
): { name: string; pt: number; shiny: boolean } | null {
  const parts = itemKey.split(':');
  const name = parts[0].trim();
  if (!name) return null;
  let pt = 0;
  let shiny = false;
  for (const flag of parts.slice(1)) {
    if (flag === 'golden' && pt === 0) pt = 1;
    else if (flag === 'rainbow' && pt === 0) pt = 2;
    else if (flag === 'shiny') shiny = true;
    else return null;
  }
  return { name, pt, shiny };
}

async function loadHistory(itemId: string, pt: number, shiny: boolean): Promise<ItemHistoryPoint[]> {
  const shinyInt = shiny ? 1 : 0;
  const rows = (await db.all<{ captured_at: number; value: number }>(
    sql`SELECT captured_at, value FROM (
          SELECT captured_at, value FROM rap_snapshots
          WHERE item_id = ${itemId} AND pt = ${pt} AND shiny = ${shinyInt}
          ORDER BY captured_at DESC LIMIT 200
        ) ORDER BY captured_at ASC`,
  )) as { captured_at: number; value: number }[];
  return rows.map((r) => ({
    capturedAt: new Date(Number(r.captured_at) * 1000).toISOString(),
    value: r.value,
  }));
}

export async function getItemDetail(itemKey: string): Promise<ItemDetail | null> {
  const parsed = parseItemKey(decodeURIComponent(itemKey));
  if (!parsed) return null;

  const found = await db
    .select()
    .from(items)
    .where(sql`LOWER(${items.name}) = ${parsed.name.toLowerCase()}`)
    .limit(1);

  const item = found[0];
  if (!item) return null;

  const variantRows = (await db.all<{
    pt: number;
    shiny: number;
    rap: number | null;
  }>(sql`${LATEST_CTE}
    SELECT l.pt, l.shiny, l.value AS rap FROM latest l
    WHERE l.item_id = ${item.id} ORDER BY l.pt ASC, l.shiny ASC`)) as {
    pt: number;
    shiny: number;
    rap: number | null;
  }[];

  const variants: ItemVariant[] = variantRows.map((row) => ({
    pt: row.pt,
    shiny: Number(row.shiny) !== 0,
    rap: row.rap,
    itemKey: buildRapItemKey(item.name, row.pt, Number(row.shiny) !== 0),
  }));

  const currentRap =
    variants.find((v) => v.pt === parsed.pt && v.shiny === parsed.shiny)?.rap ?? null;

  const historyKey = `rap:history:${itemKey}`;
  let history = await cacheGet<ItemHistoryPoint[]>(historyKey);
  if (!history) {
    history = await loadHistory(item.id, parsed.pt, parsed.shiny);
    await cacheSet(historyKey, history, 3600);
  }

  return {
    item: {
      id: item.id,
      name: item.name,
      description: item.description,
      category: item.category,
      collectionName: item.collectionName,
    },
    currentRap,
    variants,
    history,
  };
}
