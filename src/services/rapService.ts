import { cacheGet, cacheSet } from '../cache/index.js';
import { buildRapItemKey } from './itemKey.js';
import {
  countItemsFiltered,
  existsHistoryFor,
  historyFor,
  listRowsFiltered,
  listRowsRaw,
  similarItemsFor,
  totalLatestExists,
  variantsForItem,
  type ExistsRange,
  type PtFilter,
  type RawListRow,
  type ShinyFilter,
  type SortKey,
} from '../data/listings.js';
import {
  countExistsSnapshots,
  countRapSnapshots,
  type HistoryRawPoint,
} from '../data/snapshotsRepo.js';
import { countItems, findItemByNameLower, findItemVariant } from '../data/itemsRepo.js';
import { deriveCategory } from '../data/listings.js';

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
  rap: number | null;
  exists: number | null;
  rapChg: number | null;
  rapPct: number | null;
}

export interface ItemStats {
  rapChange24h: number | null;
  existsChange24h: number | null;
  rapChangePct24h: number | null;
  existsChangePct24h: number | null;
  high24h: number | null;
  low24h: number | null;
  high1m: number | null;
  low1m: number | null;
  marketCap: number | null;
  rapPerCopy: number | null;
  tracked: number;
  ath: number | null;
  atl: number | null;
  volatility30d: number;
  updates24h: number;
  rapPoints: number;
  existsPoints: number;
}

export interface ItemDetail {
  item: {
    id: string;
    name: string;
    displayName: string | null;
    slug: string | null;
    description: string | null;
    category: string | null;
    collectionName: string;
  };
  currentRap: number | null;
  rapUpdatedAt: string | null;
  exists: number | null;
  totalExists: number | null;
  similarItems: SimilarItem[];
  variants: ItemVariant[];
  stats: ItemStats;
  history: ItemHistoryPoint[];
}

export interface SimilarItem {
  name: string;
  slug: string | null;
  category: string | null;
  rap: number | null;
  exists: number | null;
}

const DAY_MS = 86_400_000;
const MONTH_MS = 30 * DAY_MS;

export function buildMergedHistory(
  rapRows: HistoryRawPoint[],
  existsRows: HistoryRawPoint[],
): ItemHistoryPoint[] {
  const byTs = new Map<number, { rap?: number; exists?: number }>();
  for (const row of rapRows) {
    const ts = Number(row.captured_at);
    const entry = byTs.get(ts) ?? {};
    entry.rap = row.value;
    byTs.set(ts, entry);
  }
  for (const row of existsRows) {
    const ts = Number(row.captured_at);
    const entry = byTs.get(ts) ?? {};
    entry.exists = row.value;
    byTs.set(ts, entry);
  }

  let lastRap: number | null = null;
  let lastExists: number | null = null;
  const chrono = [...byTs.keys()].sort((a, b) => a - b).map((ts) => {
    const entry = byTs.get(ts)!;
    const rap = entry.rap !== undefined ? entry.rap : lastRap;
    const exists = entry.exists !== undefined ? entry.exists : lastExists;
    lastRap = rap;
    lastExists = exists;
    return { ts, rap, exists };
  });

  let prevRap: number | null = null;
  const points = chrono.map(({ ts, rap, exists }) => {
    let rapChg: number | null = null;
    let rapPct: number | null = null;
    if (rap !== null && prevRap !== null) {
      rapChg = rap - prevRap;
      if (prevRap !== 0) {
        rapPct = Math.round((rapChg / prevRap) * 10000) / 100;
      }
    }
    prevRap = rap;
    return { capturedAt: new Date(ts * 1000).toISOString(), rap, exists, rapChg, rapPct };
  });

  return points.reverse();
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

export function parseItemKey(
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

export interface ComputeStatsOptions {
  currentRap: number | null;
  exists: number | null;
  rapPoints: number;
  existsPoints: number;
}

function changeOverWindow(
  rows: HistoryRawPoint[],
  nowMs: number,
): { change: number | null; baseline: number | null } {
  if (rows.length === 0) return { change: null, baseline: null };
  const cutoffMs = nowMs - DAY_MS;
  let latest: number | null = null;
  let baseline: number | null = null;
  let latestTs = -Infinity;
  let baselineTs = -Infinity;
  for (const row of rows) {
    const tsMs = Number(row.captured_at) * 1000;
    if (tsMs > latestTs) {
      latestTs = tsMs;
      latest = row.value;
    }
    if (tsMs < cutoffMs && tsMs > baselineTs) {
      baselineTs = tsMs;
      baseline = row.value;
    }
  }
  if (latest === null || baseline === null) return { change: null, baseline };
  return { change: latest - baseline, baseline };
}

function pctChange(change: number | null, baseline: number | null): number | null {
  if (change === null || baseline === null || baseline === 0) return null;
  return Math.round((change / baseline) * 10000) / 100;
}

function extremesInWindow(
  rows: HistoryRawPoint[],
  nowMs: number,
  windowMs: number,
): { high: number | null; low: number | null; count: number } {
  const cutoffMs = nowMs - windowMs;
  let high: number | null = null;
  let low: number | null = null;
  let count = 0;
  for (const row of rows) {
    if (Number(row.captured_at) * 1000 >= cutoffMs) {
      count += 1;
      high = high === null || row.value > high ? row.value : high;
      low = low === null || row.value < low ? row.value : low;
    }
  }
  return { high, low, count };
}

export function computeStats(
  rapRows: HistoryRawPoint[],
  existsRows: HistoryRawPoint[],
  nowMs: number,
  opts: ComputeStatsOptions,
): ItemStats {
  const day24 = extremesInWindow(rapRows, nowMs, DAY_MS);
  const month1 = extremesInWindow(rapRows, nowMs, MONTH_MS);

  let ath: number | null = null;
  let atl: number | null = null;
  for (const row of rapRows) {
    ath = ath === null || row.value > ath ? row.value : ath;
    atl = atl === null || row.value < atl ? row.value : atl;
  }

  const { currentRap, exists } = opts;
  const rapChange = changeOverWindow(rapRows, nowMs);
  const existsChange = changeOverWindow(existsRows, nowMs);

  return {
    rapChange24h: rapChange.change,
    existsChange24h: existsChange.change,
    rapChangePct24h: pctChange(rapChange.change, rapChange.baseline),
    existsChangePct24h: pctChange(existsChange.change, existsChange.baseline),
    high24h: day24.high,
    low24h: day24.low,
    high1m: month1.high,
    low1m: month1.low,
    marketCap:
      currentRap === null || exists === null ? null : currentRap * exists,
    rapPerCopy:
      currentRap === null || exists === null || exists <= 0
        ? null
        : currentRap / exists,
    tracked: 0,
    ath,
    atl,
    volatility30d: 0,
    updates24h: day24.count,
    rapPoints: opts.rapPoints,
    existsPoints: opts.existsPoints,
  };
}

export async function getItemDetail(itemKey: string): Promise<ItemDetail | null> {
  const decoded = decodeURIComponent(itemKey);
  const parsed = parseItemKey(decoded);
  if (!parsed) return null;

  const detailCacheKey = `v4:detail:${decoded}`;
  const cached = await cacheGet<ItemDetail>(detailCacheKey);
  if (cached) return cached;

  const item =
    (await findItemVariant(parsed.name, parsed.pt, parsed.shiny)) ??
    (await findItemByNameLower(parsed.name));
  if (!item) return null;

  const shinyInt = parsed.shiny ? 1 : 0;
  const [variantRows, rapRows, existsRows, rapPoints, existsPoints, totalExists, similarRows] =
    await Promise.all([
      variantsForItem(item.collectionName, item.name),
      historyFor(item.id, parsed.pt, shinyInt),
      existsHistoryFor(item.id, parsed.pt, shinyInt),
      countRapSnapshots(item.id, parsed.pt, shinyInt),
      countExistsSnapshots(item.id, parsed.pt, shinyInt),
      totalLatestExists(item.id),
      similarItemsFor(
        item.id,
        deriveCategory(item.huge, item.titanic, item.gargantuan),
        item.collectionName,
        item.name,
      ),
    ]);

  const variants: ItemVariant[] = variantRows.map((row) => ({
    pt: row.pt,
    shiny: Number(row.shiny) !== 0,
    rap: row.rap,
    exists: row.exists === null || row.exists === undefined ? null : row.exists,
    itemKey: buildRapItemKey(item.name, row.pt, Number(row.shiny) !== 0),
  }));

  const currentRap =
    variants.find((v) => v.pt === parsed.pt && v.shiny === parsed.shiny)?.rap ?? null;
  const exists =
    variants.find((v) => v.pt === parsed.pt && v.shiny === parsed.shiny)?.exists ?? null;

  const nowMs = Date.now();
  const stats = computeStats(rapRows, existsRows, nowMs, {
    currentRap,
    exists,
    rapPoints,
    existsPoints,
  });

  const latestRapTs = rapRows[rapRows.length - 1]?.captured_at;
  const detail: ItemDetail = {
    item: {
      id: item.id,
      name: item.name,
      displayName: item.displayName,
      slug: item.slug ?? null,
      description: item.description ?? null,
      category: deriveCategory(item.huge, item.titanic, item.gargantuan),
      collectionName: item.collectionName,
    },
    currentRap,
    rapUpdatedAt:
      latestRapTs === undefined ? null : new Date(Number(latestRapTs) * 1000).toISOString(),
    exists,
    totalExists,
    similarItems: similarRows.map((row) => ({
      name: row.name,
      slug: row.slug ?? null,
      category: row.category,
      rap: row.rap ?? null,
      exists: row.exists ?? null,
    })),
    variants,
    stats,
    history: buildMergedHistory(rapRows, existsRows),
  };

  await cacheSet(detailCacheKey, detail, 3600);
  return detail;
}

export interface FilteredItem {
  itemKey: string;
  name: string;
  slug: string | null;
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
    showRapZero: params.show_rap_zero === undefined ? true : parseFlag(params.show_rap_zero),
    showExistsZero: params.show_exists_zero === undefined ? true : parseFlag(params.show_exists_zero),
    hidePets: parseFlag(params.hide_pets),
    page,
    pageSize,
  };
}

export async function listItemsFiltered(
  rawParams: FilteredItemsParams,
): Promise<FilteredItemsResult> {
  const normalized = normalizeFilteredParams(rawParams);

  const cacheKey = `v3:items:${JSON.stringify(normalized)}`;
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
      slug: row.slug ?? null,
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
): Promise<{
  items: {
    itemKey: string;
    name: string;
    slug: string | null;
    pt: number;
    shiny: boolean;
    category: string | null;
    rap: number | null;
  }[];
}> {
  const trimmed = q.trim();
  const boundedLimit = Math.min(Math.max(1, limit), 10);
  const cacheKey = `v3:search:${trimmed}:${boundedLimit}`;
  const cached = await cacheGet<{ items: { itemKey: string; name: string; slug: string | null; pt: number; shiny: boolean; category: string | null; rap: number | null }[] }>(cacheKey);
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
    slug: i.slug,
    pt: i.pt,
    shiny: i.shiny,
    category: i.category,
    rap: i.rap,
  }));
  const payload = { items: mapped };
  await cacheSet(cacheKey, payload, 300);
  return payload;
}
