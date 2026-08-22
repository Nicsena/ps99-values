import { cacheGet, cacheSet } from '../cache/index.js';
import { buildRapItemKey } from './itemKey.js';
import {
  countItemsFiltered,
  historyFor,
  itemByName,
  listRowsFiltered,
  listRowsRaw,
  variantsForItem,
  type ExistsRange,
  type PtFilter,
  type RawListRow,
  type ShinyFilter,
  type SortKey,
} from '../data/listings.js';
import { countItems } from '../data/itemsRepo.js';

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
  exists: number | null;
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

  const [rawRows, total] = await Promise.all([
    listRowsRaw({ search, sort, order, page, pageSize }),
    countItems(search),
  ]);

  const result: ListItemsResult = {
    rows: rawRows.map(mapListRow),
    total,
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
  const rows = await historyFor(itemId, pt, shinyInt);
  return rows.map((r) => ({
    capturedAt: new Date(Number(r.captured_at) * 1000).toISOString(),
    value: r.value,
  }));
}

export async function getItemDetail(itemKey: string): Promise<ItemDetail | null> {
  const parsed = parseItemKey(decodeURIComponent(itemKey));
  if (!parsed) return null;

  const item = await itemByName(parsed.name);
  if (!item) return null;

  const variantRows = await variantsForItem(item.id);

  const variants: ItemVariant[] = variantRows.map((row) => ({
    pt: row.pt,
    shiny: Number(row.shiny) !== 0,
    rap: row.rap,
    exists: row.exists === null || row.exists === undefined ? null : row.exists,
    itemKey: buildRapItemKey(item.name, row.pt, Number(row.shiny) !== 0),
  }));

  const currentRap =
    variants.find((v) => v.pt === parsed.pt && v.shiny === parsed.shiny)?.rap ?? null;

  const historyKey = `v2:history:${itemKey}`;
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

export interface FilteredItem {
  itemKey: string;
  name: string;
  category: string | null;
  collectionName: string;
  rap: number | null;
  exists: number | null;
  pt: number;
  shiny: boolean;
}

export interface FilteredItemsParams {
  q?: unknown;
  sort?: unknown;
  shiny?: unknown;
  pt?: unknown;
  category?: unknown;
  collection?: unknown;
  exists?: unknown;
  show_rap_zero?: unknown;
  show_exists_zero?: unknown;
  hide_pets?: unknown;
  page?: unknown;
  pageSize?: unknown;
}

export interface FilteredItemsResult {
  items: FilteredItem[];
  total: number;
  page: number;
  pageSize: number;
}

const SORT_KEYS: SortKey[] = [
  'rap_desc',
  'rap_asc',
  'name_asc',
  'name_desc',
  'copies_desc',
  'copies_asc',
  'newest',
  'oldest',
];
const SHINY_FILTERS: ShinyFilter[] = ['all', 'no', 'yes'];
const PT_FILTERS: PtFilter[] = ['all', 'regular', 'golden', 'rainbow'];
const EXISTS_RANGES: ExistsRange[] = [
  'all',
  'lt100',
  'lt1k',
  'lt5k',
  'gt100',
  'gt1k',
  'gt10k',
  'gt100k',
];

function oneOf<T extends string>(value: unknown, allowed: T[], fallback: T): T {
  return typeof value === 'string' && (allowed as string[]).includes(value) ? (value as T) : fallback;
}

function parseFlag(value: unknown): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') return value === '1' || value.toLowerCase() === 'true';
  if (typeof value === 'number') return value === 1;
  return false;
}

function parsePositiveInt(value: unknown, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : fallback;
}

function normalizeFilteredParams(params: FilteredItemsParams): {
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
} {
  const q = typeof params.q === 'string' ? params.q.trim() : '';
  const sort = oneOf(params.sort, SORT_KEYS, 'rap_desc');
  const shiny = oneOf(params.shiny, SHINY_FILTERS, 'all');
  const pt = oneOf(params.pt, PT_FILTERS, 'all');
  const category =
    typeof params.category === 'string' &&
    ['all', 'huge', 'titanic', 'gargantuan'].includes(params.category)
      ? params.category
      : 'all';
  const collection =
    typeof params.collection === 'string' && params.collection.trim().length > 0
      ? params.collection.trim()
      : 'all';
  const existsRange = oneOf(params.exists, EXISTS_RANGES, 'all');

  const pageSizeRaw = parsePositiveInt(params.pageSize, 24);
  const pageSize = pageSizeRaw > 50 ? 50 : pageSizeRaw;
  const page = parsePositiveInt(params.page, 1);

  return {
    q,
    sort,
    shiny,
    pt,
    category,
    collection,
    existsRange,
    showRapZero: parseFlag(params.show_rap_zero),
    showExistsZero: parseFlag(params.show_exists_zero),
    hidePets: parseFlag(params.hide_pets),
    page,
    pageSize,
  };
}

export async function listItemsFiltered(
  rawParams: FilteredItemsParams,
): Promise<FilteredItemsResult> {
  const normalized = normalizeFilteredParams(rawParams);

  const cacheKey = `v2:items:${JSON.stringify(normalized)}`;
  const cached = await cacheGet<FilteredItemsResult>(cacheKey);
  if (cached) return cached;

  const [rows, total] = await Promise.all([
    listRowsFiltered(normalized),
    countItemsFiltered(normalized),
  ]);

  const result: FilteredItemsResult = {
    items: rows.map((row) => ({
      itemKey: row.itemKey,
      name: row.name,
      category: row.category,
      collectionName: row.collectionName,
      rap: row.rap,
      exists: row.existsCount,
      pt: row.pt,
      shiny: Number(row.shiny) !== 0,
    })),
    total,
    page: normalized.page,
    pageSize: normalized.pageSize,
  };

  await cacheSet(cacheKey, result, 900);
  return result;
}

export async function searchItems(
  q: string,
  limit: number,
): Promise<{ items: { itemKey: string; name: string; category: string | null; rap: number | null }[] }> {
  const trimmed = q.trim();
  const boundedLimit = Math.min(Math.max(1, limit), 10);
  const cacheKey = `v2:search:${trimmed}:${boundedLimit}`;
  const cached = await cacheGet<{ items: { itemKey: string; name: string; category: string | null; rap: number | null }[] }>(cacheKey);
  if (cached) return cached;

  const { items } = await listItemsFiltered({
    q: trimmed,
    sort: 'name_asc',
    show_rap_zero: true,
    show_exists_zero: true,
    pageSize: boundedLimit,
    page: 1,
  });

  const mapped = items.map((i) => ({
    itemKey: i.itemKey,
    name: i.name,
    category: i.category,
    rap: i.rap,
  }));
  const payload = { items: mapped };
  await cacheSet(cacheKey, payload, 300);
  return payload;
}
