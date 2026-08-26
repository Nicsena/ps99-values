import { z } from 'zod';

const BASE_URL = 'https://ps99.biggamesapi.io';
const TIMEOUT_MS = 15000;

export interface CollectionEntry {
  configName: string;
  category: string;
  collection?: string;
  configData: Record<string, unknown>;
}

export interface RapEntry {
  category: string;
  value: number;
  configData: {
    id: string;
    pt?: number;
    sh?: number | boolean;
    cv?: number;
    tn?: number;
    vr?: unknown;
  };
}

const collectionEntrySchema = z.object({
  configName: z.string(),
  category: z.string(),
  collection: z.string().optional(),
  configData: z.looseObject({}),
});

const rapEntrySchema = z.object({
  category: z.string(),
  value: z.number(),
  configData: z
    .object({
      id: z.string(),
      pt: z.number().optional(),
      sh: z.union([z.number(), z.boolean()]).optional(),
      cv: z.number().optional(),
      tn: z.number().optional(),
      vr: z.unknown().optional(),
    })
    .loose(),
});

export interface FeedResult<T> {
  /** Entries that passed validation; malformed entries are skipped and counted. */
  data: T[];
  /** Number of entries dropped because they failed validation. */
  invalid: number;
}

async function request<T>(path: string, parse: (body: unknown) => T): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) {
    throw new Error(`Upstream ${path} failed with HTTP ${res.status}`);
  }
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    throw new Error(`Upstream ${path} returned invalid JSON`);
  }
  const status = (body as { status?: unknown }).status;
  if (status !== 'ok') {
    throw new Error(`Upstream ${path} reported error status: ${String(status)}`);
  }
  return parse(body);
}

// Per-entry tolerant: one malformed entry is skipped and counted instead of
// discarding the whole feed.
function extractData<T>(schema: z.ZodType<T>, body: unknown): FeedResult<T> {
  const parsed = z
    .object({ data: z.array(z.unknown()) })
    .loose()
    .safeParse(body);
  if (!parsed.success) {
    throw new Error(`Upstream response failed validation: ${parsed.error.message}`);
  }
  const data: T[] = [];
  let invalid = 0;
  for (const entry of parsed.data.data) {
    const result = schema.safeParse(entry);
    if (result.success) data.push(result.data);
    else invalid += 1;
  }
  return { data, invalid };
}

export async function fetchCollections(): Promise<string[]> {
  const body = await request('/api/collections', (b) => b);
  const parsed = z
    .object({ data: z.array(z.string()) })
    .loose()
    .safeParse(body);
  if (!parsed.success) {
    throw new Error(`Collections response failed validation: ${parsed.error.message}`);
  }
  return parsed.data.data;
}

export async function fetchCollection(name: string): Promise<FeedResult<CollectionEntry>> {
  return request(`/api/collection/${encodeURIComponent(name)}`, (b) =>
    extractData(collectionEntrySchema, b),
  );
}

export async function fetchRap(): Promise<FeedResult<RapEntry>> {
  return request('/api/rap', (b) => extractData(rapEntrySchema, b));
}

export async function fetchExists(): Promise<FeedResult<RapEntry>> {
  return request('/api/exists', (b) => extractData(rapEntrySchema, b));
}
