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
