type ConfigData = Record<string, unknown>;

export interface CollectionSpec {
  nameKeys?: readonly string[];
  descKey?: string | null;
}

const DEFAULT_NAME_KEYS = ['DisplayName', 'Name', 'name', 'Title'] as const;

const SPECS: Record<string, CollectionSpec> = {
  Pets: { nameKeys: ['name'], descKey: 'indexDesc' },
  Eggs: { nameKeys: ['name'], descKey: null },
  Rebirths: { descKey: 'BoostDesc' },
};

function firstString(configData: ConfigData, keys: readonly string[]): string | null {
  for (const key of keys) {
    const value = configData[key];
    if (typeof value === 'string' && value.length > 0) return value;
  }
  return null;
}

export function stripNamePrefix(configName: string): string {
  const parts = configName.split('|');
  return (parts[parts.length - 1] ?? configName).trim();
}

const THUMBNAIL_KEYS = ['thumbnail', 'icon', 'Icon', 'goldenThumbnail', 'PageIcon'] as const;
const GOLDEN_THUMBNAIL_KEYS = ['goldenThumbnail', 'GoldIcon'] as const;
const SHINY_THUMBNAIL_KEYS = ['ShinyIcon'] as const;

function extractAssetId(value: unknown): number | null {
  if (typeof value !== 'string') return null;
  const match = value.match(/rbxassetid:\/\/(\d+)/i);
  return match ? Number(match[1]) : null;
}

export function parseImageId(configData: ConfigData): number | null {
  for (const key of THUMBNAIL_KEYS) {
    const id = extractAssetId(configData[key]);
    if (id !== null) return id;
  }
  return null;
}

export function parseGoldenImageId(configData: ConfigData): number | null {
  for (const key of GOLDEN_THUMBNAIL_KEYS) {
    const id = extractAssetId(configData[key]);
    if (id !== null) return id;
  }
  return null;
}

export function parseShinyImageId(configData: ConfigData): number | null {
  for (const key of SHINY_THUMBNAIL_KEYS) {
    const id = extractAssetId(configData[key]);
    if (id !== null) return id;
  }
  return null;
}

export interface ResolvedNaming {
  name: string;
  description: string | null;
  usedFallback: boolean;
}

export function resolveItemNaming(
  collectionName: string,
  configName: string,
  configData: ConfigData,
): ResolvedNaming {
  const spec = SPECS[collectionName] ?? {};

  const name =
    firstString(configData, spec.nameKeys ?? DEFAULT_NAME_KEYS) ?? stripNamePrefix(configName);

  const description =
    spec.descKey === null
      ? null
      : firstString(configData, spec.descKey ? [spec.descKey] : ['Desc']);

  return { name, description, usedFallback: !spec.nameKeys?.some((k) => configData[k] === name) };
}

// --- Chroma colors ---

export interface ColorVariantInfo {
  id: number;
  name: string;
  chance: number | null;
}

// Extracts the per-item chroma color list from an entry's
// `animations.colorVariants` ([{Id, Name, Chance}, …]). The `Id` values match
// the `cv` field in RAP/exists feed entries. The mapping is per-item and NOT
// global — different pets order colors differently. Returns null when absent
// or invalid.
export function parseColorVariants(configData: ConfigData): ColorVariantInfo[] | null {
  const animations = configData.animations;
  const raw = (animations as { colorVariants?: unknown } | undefined)?.colorVariants;
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const out: ColorVariantInfo[] = [];
  for (const entry of raw) {
    if (typeof entry !== 'object' || entry === null) continue;
    const record = entry as Record<string, unknown>;
    const id = record.Id;
    const name = record.Name;
    if (typeof id !== 'number' || !Number.isInteger(id) || id < 1) continue;
    if (typeof name !== 'string' || name.trim().length === 0) continue;
    const chance = typeof record.Chance === 'number' && Number.isFinite(record.Chance)
      ? record.Chance
      : null;
    out.push({ id, name: name.trim(), chance });
  }
  return out.length > 0 ? out : null;
}

export type ColorVariantMap = Map<number, ColorVariantInfo>;

// Reads a stored items.colorVariants JSON column into a lookup keyed by
// chroma level. Invalid/absent data yields an empty map.
export function readColorVariants(json: string | null | undefined): ColorVariantMap {
  const map: ColorVariantMap = new Map();
  if (!json) return map;
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return map;
  }
  if (!Array.isArray(parsed)) return map;
  for (const entry of parsed) {
    if (typeof entry !== 'object' || entry === null) continue;
    const record = entry as Record<string, unknown>;
    const id = record.id;
    const name = record.name;
    if (typeof id !== 'number' || !Number.isInteger(id) || id < 1) continue;
    if (typeof name !== 'string' || name.trim().length === 0) continue;
    const chance =
      typeof record.chance === 'number' && Number.isFinite(record.chance) ? record.chance : null;
    map.set(id, { id, name: name.trim(), chance });
  }
  return map;
}

// Resolves a color token (e.g. "blue") to its chroma level within one item's
// stored color list. Case-insensitive; undefined when not found.
export function resolveChromaForColor(
  colorMap: ColorVariantMap,
  colorToken: string,
): number | undefined {
  const wanted = colorToken.trim().toLowerCase();
  for (const info of colorMap.values()) {
    if (info.name.toLowerCase() === wanted) return info.id;
  }
  return undefined;
}
