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
