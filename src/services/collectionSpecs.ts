import { slugify } from '../util/slug.js';

type ConfigData = Record<string, unknown>;

// --- Namespace grammar ---
//
// Several upstream collections resolve to bare item names that collide across
// collections (Coins exists in Charms, Enchants AND Potions; Banana in Fruits
// and Pets; TNT in Charms and MiscItems — see
// ai/reports/spec-driven-items-rap-exists.html). Collections with a namespace
// token disambiguate their rows at write time: displayName "<Item> <Token>",
// slug "<item>-<token>". Unconditional tokens read naturally for every item of
// the collection; collision-only tokens apply solely to colliding names.
// Pets deliberately has no token — pet rows keep their bare name/slug.

export interface NamespaceRule {
  token: string;
  /** Apply only to names that collide across enabled collections. */
  collisionOnly?: boolean;
  /**
   * When a colliding group consists solely of token-having collections, the
   * designated collection keeps the bare name/slug and the others suffix
   * (MiscItems: "TNT" stays plain next to "TNT Charm"). Ignored when a
   * token-less collection is in the group — that one always keeps the plain
   * name (Pets).
   */
  keepsPlain?: boolean;
}

export const NAMESPACE_RULES: Record<string, NamespaceRule> = {
  Enchants: { token: 'enchant' },
  Charms: { token: 'charm' },
  Potions: { token: 'potion' },
  Fruits: { token: 'fruit' },
  Seeds: { token: 'seed', collisionOnly: true },
  MiscItems: { token: 'item', collisionOnly: true, keepsPlain: true },
  Hoverboards: { token: 'hoverboard', collisionOnly: true },
  Ultimates: { token: 'ultimate', collisionOnly: true },
};

export interface NamespaceNaming {
  displayName: string;
  /** Slug stem for the primary row (variant prefixes prepend onto this). */
  slugStem: string;
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

export function namespaceNaming(itemName: string, rule: NamespaceRule): NamespaceNaming {
  return {
    displayName: `${itemName} ${capitalize(rule.token)}`,
    slugStem: `${slugify(itemName)}-${rule.token}`,
  };
}

// Tiered feeds are addressed with Roman numerals attached directly to the
// item name — no "tier" word ("<Item> <III> <Token>" /
// "<item>-<iii>-<token>"), matching how the game displays them
// ("Coins III Enchant"). Single-level items (max observed tier 1) never get
// tier naming at all: their feed data collapses onto the base row
// (handled by the ingest pipeline).
export function namespaceTierNaming(
  itemName: string,
  rule: NamespaceRule,
  tier: number,
): NamespaceNaming {
  const roman = toRoman(tier) ?? String(tier);
  return {
    displayName: `${itemName} ${roman} ${capitalize(rule.token)}`,
    slugStem: `${slugify(itemName)}-${roman.toLowerCase()}-${rule.token}`,
  };
}

const ROMAN_TABLE: readonly (readonly [number, string])[] = [
  [1000, 'M'],
  [900, 'CM'],
  [500, 'D'],
  [400, 'CD'],
  [100, 'C'],
  [90, 'XC'],
  [50, 'L'],
  [40, 'XL'],
  [10, 'X'],
  [9, 'IX'],
  [5, 'V'],
  [4, 'IV'],
  [1, 'I'],
];

/** Uppercase Roman numeral for 1..3999; null outside that range. */
export function toRoman(value: number): string | null {
  if (!Number.isInteger(value) || value < 1 || value > 3999) return null;
  let out = '';
  for (const [amount, symbol] of ROMAN_TABLE) {
    while (value >= amount) {
      out += symbol;
      value -= amount;
    }
  }
  return out;
}

export interface CollectionSpec {
  nameKeys?: readonly string[];
  descKey?: string | null;
}

// Internal categories flagged as clutter (events, boosts, card-pack shells
// that ride in the Eggs catalog). Items in hidden categories are excluded
// from listings UNLESS they carry market data (rap/exists) — several such
// items do, and those stay visible (owner rule).
export const HIDDEN_CATEGORIES: readonly string[] = [
  'Event',
  'Events',
  'Boosts',
  'CardPacks',
];

// Individually hidden items, keyed "Collection/Name" (exact match). Unlike
// category hiding, this is absolute: the item never appears in listings even
// when it has market data. Data is still synced and stored.
export const HIDDEN_ITEMS: readonly string[] = [
  'XPPotions/Garden XP Token',
  'XPPotions/Pet XP Token',
  'XPPotions/Ultra Titanic XP Potion',
  'XPPotions/Unit XP Token I',
  'XPPotions/Unit XP Token II',
  'XPPotions/Unit XP Token III',
];

// Singular human-readable display names for collections (owner-specified).
export const COLLECTION_DISPLAY_NAMES: Record<string, string> = {
  CardItems: 'Cards',
  Boxes: 'Box',
  Charms: 'Charm',
  Eggs: 'Egg',
  Enchants: 'Enchant',
  Fruits: 'Fruit',
  Hoverboards: 'Hoverboard',
  Lootboxes: 'Lootbox',
  MiscItems: 'Misc',
  Pets: 'Pet',
  Potions: 'Potion',
  Seeds: 'Seeds',
  Ultimates: 'Ultimate',
  XPPotions: 'XPPotion',
};

// Per-collection cleanups applied to resolved item names. Seeds upstream
// names are "<X> Plant Seed"; the "Plant" infix carries no meaning.
const NAME_CLEANUPS: Record<string, ((name: string) => string) | undefined> = {
  Seeds: (name) => name.replace(/\s+Plant\b/g, ''),
};

export function cleanupItemName(collectionName: string, name: string): string {
  return NAME_CLEANUPS[collectionName]?.(name) ?? name;
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
// Structured entries carry icons inside arrays: enchant tiers
// (`Tiers[].Icon`) and boxes (`Icons[].Icon`).
const ICON_ARRAY_KEYS = ['Tiers', 'Icons'] as const;

function extractAssetId(value: unknown): number | null {
  if (typeof value !== 'string') return null;
  const match = value.match(/rbxassetid:\/\/(\d+)/i);
  return match ? Number(match[1]) : null;
}

// Upstream points every tier of the multi-level enchants at this same asset,
// which renders as a cartoon blob face — their default icon placeholder, not
// a real item icon. Treat it as "no icon" so those rows fall back to the
// site placeholder instead.
const PLACEHOLDER_ASSET_IDS: ReadonlySet<number> = new Set([13824100032]);

export function usableIconId(value: unknown): number | null {
  const id = extractAssetId(value);
  return id !== null && !PLACEHOLDER_ASSET_IDS.has(id) ? id : null;
}

export function parseImageId(configData: ConfigData): number | null {
  for (const key of THUMBNAIL_KEYS) {
    const id = usableIconId(configData[key]);
    if (id !== null) return id;
  }
  for (const key of ICON_ARRAY_KEYS) {
    const arr = configData[key];
    if (!Array.isArray(arr)) continue;
    for (const entry of arr) {
      if (typeof entry !== 'object' || entry === null) continue;
      const id = usableIconId((entry as Record<string, unknown>).Icon);
      if (id !== null) return id;
    }
  }
  return null;
}

export function parseGoldenImageId(configData: ConfigData): number | null {
  for (const key of GOLDEN_THUMBNAIL_KEYS) {
    const id = usableIconId(configData[key]);
    if (id !== null) return id;
  }
  return null;
}

export function parseShinyImageId(configData: ConfigData): number | null {
  for (const key of SHINY_THUMBNAIL_KEYS) {
    const id = usableIconId(configData[key]);
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
  const nameKeys = spec.nameKeys ?? DEFAULT_NAME_KEYS;

  const name = firstString(configData, nameKeys) ?? stripNamePrefix(configName);

  const description =
    spec.descKey === null
      ? null
      : firstString(configData, spec.descKey ? [spec.descKey] : ['Desc']);

  return { name, description, usedFallback: !nameKeys.some((k) => configData[k] === name) };
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
    const chance =
      typeof record.Chance === 'number' && Number.isFinite(record.Chance) ? record.Chance : null;
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
