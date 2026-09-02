import { fetchCollection, fetchCollections, type CollectionEntry } from '../biggames.js';
import {
  COLLECTION_DISPLAY_NAMES,
  HIDDEN_CATEGORIES,
  HIDDEN_ITEMS,
  NAMESPACE_RULES,
  cleanupItemName,
  namespaceNaming,
  parseColorVariants,
  parseGoldenImageId,
  parseImageId,
  parseShinyImageId,
  usableIconId,
  resolveItemNaming,
  stripNamePrefix,
  type NamespaceRule,
} from '../collectionSpecs.js';
import type { AliasIndex, CategoryIndex } from './matching.js';
import {
  countCollections,
  enableCollections,
  markSynced,
  seedCategories,
  setCategoryHidden,
  setCollectionDisplayNames,
  upsertCollectionNames,
} from '../../db/queries/collectionsRepo.js';
import { upsertItems, type UpsertItemParams } from '../../db/queries/itemsRepo.js';
import { createLogger } from '../../logger.js';
import { withRetry } from './retry.js';

const log = createLogger({ namespace: 'sync' }).child('catalog');

export const DEFAULT_ENABLED_COLLECTIONS = [
  'Pets',
  'Boosts',
  'Booths',
  'Boxes',
  'CardItems',
  'Charms',
  'Eggs',
  'Enchants',
  'Fruits',
  'Hoverboards',
  'Lootboxes',
  'MiscItems',
  'Potions',
  'Seeds',
  'Ultimates',
  'XPPotions',
] as const;

// UpsertItemParams takes pre-serialized color-variant JSON.
function serializeColorVariants(colors: ReturnType<typeof parseColorVariants>): string | null {
  return colors ? JSON.stringify(colors) : null;
}

export async function seedCollections(): Promise<number> {
  const names = await withRetry(() => fetchCollections());
  const wasEmpty = (await countCollections()) === 0;
  await upsertCollectionNames(names);
  if (wasEmpty) {
    await enableCollections(DEFAULT_ENABLED_COLLECTIONS);
  }
  // Singular collection display names + hidden curation; both idempotent.
  const known = new Set(names);
  const displayNames = Object.fromEntries(
    Object.entries(COLLECTION_DISPLAY_NAMES).filter(([name]) => known.has(name)),
  );
  await setCollectionDisplayNames(displayNames);
  return names.length;
}

// Per-collection golden/shiny asset ids, keyed by collection then resolved
// item name. Scoped per collection so a failed collection fetch cannot
// regress another collection's icons.
export interface CatalogImages {
  golden: Map<string, Map<string, number | null>>;
  shiny: Map<string, Map<string, number | null>>;
}

// Observed catalog categories per collection; used by the feed matcher to
// resolve cross-collection name collisions via the feed's category field.
export interface CatalogContext {
  images: CatalogImages;
  categories: CategoryIndex;
  /** Namespace grammar applied per collection → item name → rule. */
  grammars: Map<string, Map<string, NamespaceRule>>;
  /** ConfigName-derived alternate feed ids per collection → item name. */
  aliases: AliasIndex;
  /** Per-tier icons: collection → item name → (tier number → asset id). */
  tierIcons: Map<string, Map<string, ReadonlyMap<number, number>>>;
}

export interface CatalogResult {
  itemsUpserted: number;
  context: CatalogContext;
  errors: string[];
  invalidEntries: number;
}

interface FetchedCatalog {
  collection: string;
  golden: Map<string, number | null>;
  shiny: Map<string, number | null>;
  observed: Set<string>;
  /** Resolved bare item names in catalog order (may repeat across collections). */
  itemNames: string[];
  descriptions: Map<string, string | null>;
  imageIds: Map<string, number | null>;
  flags: Map<string, { hidden: boolean; huge: boolean; titanic: boolean; gargantuan: boolean }>;
  colorVariantsJson: Map<string, string | null>;
  /** Raw upstream configData JSON per item (first occurrence wins). */
  configDataJson: Map<string, string>;
  /** Raw upstream internal category per item (first occurrence wins). */
  internalCategories: Map<string, string>;
  /** Per-tier icons from configData.Tiers (tier number → asset id). */
  tierIcons: Map<string, Map<number, number>>;
  /** Raw upstream category strings observed in this collection. */
  rawCategories: Set<string>;
  /** configName-derived alternate ids per item (feeds often use these). */
  aliases: Map<string, Set<string>>;
  imageWarnings: Set<string>;
}

// Fetches and upserts the item catalog for every enabled collection. Runs in
// two passes so namespace grammar can see the global name→collections map
// before any row is written.
export async function syncCatalog(
  enabledCollections: readonly { name: string }[],
): Promise<CatalogResult> {
  const errors: string[] = [];
  let invalidEntries = 0;
  const images: CatalogImages = { golden: new Map(), shiny: new Map() };
  const categories: CategoryIndex = new Map();
  const aliases: AliasIndex = new Map();
  // Raw upstream category strings ("Pet", "Misc", "Special", …) across all
  // fetched collections; seeded into the category table after pass 1.
  const upstreamCategories = new Set<string>();

  // Pass 1: fetch and resolve names.
  const fetched: FetchedCatalog[] = [];
  for (const { name } of enabledCollections) {
    let entries: CollectionEntry[];
    try {
      const feed = await withRetry(() => fetchCollection(name));
      entries = feed.data;
      if (feed.invalid > 0) {
        invalidEntries += feed.invalid;
        log.warn(`${name} skipped ${feed.invalid} malformed catalog entries`);
      }
    } catch (err) {
      log.error(`${err} failed to fetch collection ${name}`);
      errors.push(`collection ${name} failed: ${String(err)}`);
      continue;
    }

    // Seed observed categories with the collection's own name: some catalogs
    // tag every entry "Uncategorized" (Pets), so the name itself is the only
    // reliable signal that e.g. a feed entry of category "Pet" belongs here.
    const observed = new Set<string>([name.toLowerCase()]);
    const golden = new Map<string, number | null>();
    const shiny = new Map<string, number | null>();
    const itemNames: string[] = [];
    const descriptions = new Map<string, string | null>();
    const imageIds = new Map<string, number | null>();
    const flags = new Map<string, { hidden: boolean; huge: boolean; titanic: boolean; gargantuan: boolean }>();
    const colorVariantsJson = new Map<string, string | null>();
    const configDataJson = new Map<string, string>();
    const internalCategories = new Map<string, string>();
    const tierIcons = new Map<string, Map<number, number>>();
    const rawCategories = new Set<string>();
    const aliases = new Map<string, Set<string>>();
    const imageWarnings = new Set<string>();

    for (const entry of entries) {
      if (typeof entry.category === 'string' && entry.category.length > 0) {
        observed.add(entry.category.toLowerCase());
        upstreamCategories.add(entry.category);
        rawCategories.add(entry.category);
      }
      const {
        name: resolvedName,
        description,
        usedFallback,
      } = resolveItemNaming(name, entry.configName, entry.configData);
      if (!resolvedName) continue;
      const itemName = cleanupItemName(name, resolvedName);
      // Merch Series gift bags ride in the Eggs catalog but are misc merch
      // items — reclassify them into the shared (visible) Gifts category so
      // the eggs-except-exclusive rule never hides them.
      let internalCategory = entry.category;
      if (name === 'Eggs' && /gift/i.test(itemName)) internalCategory = 'Gifts';
      if (typeof internalCategory === 'string' && internalCategory.length > 0) {
        observed.add(internalCategory.toLowerCase());
        upstreamCategories.add(internalCategory);
        rawCategories.add(internalCategory);
      }
      if (usedFallback && !imageWarnings.has(itemName)) {
        imageWarnings.add(itemName);
        log.warn(`${name} no name key matched for ${entry.configName} used configName`);
      }
      const cd = entry.configData;
      const alias = stripNamePrefix(entry.configName);
      if (alias && alias !== itemName) {
        if (!aliases.has(itemName)) aliases.set(itemName, new Set());
        aliases.get(itemName)!.add(alias);
      }
      if (!itemNames.includes(itemName)) itemNames.push(itemName);
      if (!configDataJson.has(itemName)) configDataJson.set(itemName, JSON.stringify(cd));
      if (Array.isArray(cd.Tiers)) {
        const tiers = new Map<number, number>();
        for (const [idx, tier] of cd.Tiers.entries()) {
          if (typeof tier !== 'object' || tier === null) continue;
          const id = usableIconId((tier as Record<string, unknown>).Icon);
          if (id !== null) tiers.set(idx + 1, id);
        }
        if (tiers.size > 0) tierIcons.set(itemName, tiers);
      }
      if (!internalCategories.has(itemName) && typeof internalCategory === 'string' && internalCategory) {
        internalCategories.set(itemName, internalCategory);
      }
      golden.set(itemName, parseGoldenImageId(cd));
      shiny.set(itemName, parseShinyImageId(cd));
      descriptions.set(itemName, description);
      imageIds.set(itemName, parseImageId(cd));
      flags.set(itemName, {
        hidden: cd.hidden === true,
        huge: cd.huge === true,
        titanic: cd.titanic === true,
        gargantuan: cd.gargantuan === true,
      });
      colorVariantsJson.set(itemName, serializeColorVariants(parseColorVariants(cd)));
    }
    categories.set(name, observed);
    fetched.push({
      collection: name,
      golden,
      shiny,
      observed,
      itemNames,
      descriptions,
      imageIds,
      flags,
      colorVariantsJson,
      configDataJson,
      internalCategories,
      tierIcons,
      rawCategories,
      aliases,
      imageWarnings,
    });
  }

  // Names present in more than one fetched collection.
  const collidingNames = new Set<string>();
  const membersByName = new Map<string, string[]>();
  const seenIn = new Map<string, string>();
  for (const catalog of fetched) {
    for (const itemName of catalog.itemNames) {
      const first = seenIn.get(itemName);
      if (first === undefined) seenIn.set(itemName, catalog.collection);
      else if (first !== catalog.collection) collidingNames.add(itemName);
      const members = membersByName.get(itemName) ?? [];
      if (!members.includes(catalog.collection)) members.push(catalog.collection);
      membersByName.set(itemName, members);
    }
  }

  // Decides whether a collection's namespace grammar applies to an item.
  // Unconditional rules always apply to their own non-colliding items; for
  // colliding names the plain slug is ceded to token-less collections (Pets),
  // and when the whole group is token-having, a `keepsPlain` designated
  // collection (MiscItems) stays bare while the others suffix.
  function grammarApplies(collection: string, itemName: string): boolean {
    const rule = NAMESPACE_RULES[collection];
    if (!rule) return false;
    const members = membersByName.get(itemName) ?? [collection];
    if (members.length <= 1) return !rule.collisionOnly;
    if (!collidingNames.has(itemName)) return false;
    if (rule.collisionOnly && !collidingNames.has(itemName)) return false;
    const tokenless = members.some((m) => m !== collection && !NAMESPACE_RULES[m]);
    if (tokenless) return true;
    if (rule.keepsPlain) {
      const designated = members.find((m) => NAMESPACE_RULES[m]?.keepsPlain);
      return designated !== collection;
    }
    return true;
  }

  await seedCategories([...upstreamCategories].sort());

  // Visibility rule (mirrors ps99rap): within the Eggs collection every
  // internal category except "Exclusive Eggs" is non-market clutter and gets
  // flagged hidden — but only when no other collection shares the category.
  const catUsage = new Map<string, { collections: Set<string>; raw: string }>();
  for (const catalog of fetched) {
    for (const raw of catalog.rawCategories) {
      const usage = catUsage.get(raw.toLowerCase()) ?? { collections: new Set<string>(), raw };
      usage.collections.add(catalog.collection);
      catUsage.set(raw.toLowerCase(), usage);
    }
  }
  const hiddenFlags = new Map<string, boolean>();
  for (const [lower, usage] of catUsage) {
    const eggsOnly = usage.collections.size === 1 && usage.collections.has('Eggs');
    hiddenFlags.set(usage.raw, eggsOnly && lower !== 'exclusive eggs');
  }
  // Clutter categories are always flagged; listings still show their items
  // that carry market data.
  for (const raw of HIDDEN_CATEGORIES) {
    if (catUsage.has(raw.toLowerCase())) hiddenFlags.set(raw, true);
  }
  await setCategoryHidden(hiddenFlags);

  // Items whose own catalog entry lacks an icon inherit one from another
  // collection's identically-named entry (first non-null wins).
  const iconIndex = new Map<string, number>();
  for (const catalog of fetched) {
    for (const [name, id] of catalog.imageIds) {
      if (id !== null && !iconIndex.has(name)) iconIndex.set(name, id);
    }
  }

  // Pass 2: apply namespace grammar and upsert per collection.
  let itemsUpserted = 0;
  const grammars = new Map<string, Map<string, NamespaceRule>>();
  const contextTierIcons = new Map<string, Map<string, ReadonlyMap<number, number>>>();

  for (const catalog of fetched) {
    const grammarFor = new Map<string, NamespaceRule>();
    const rows: UpsertItemParams[] = [];
    for (const itemName of catalog.itemNames) {
      const applies =
        NAMESPACE_RULES[catalog.collection] !== undefined &&
        grammarApplies(catalog.collection, itemName);
      const rule = applies ? NAMESPACE_RULES[catalog.collection]! : null;
      const naming = rule ? namespaceNaming(itemName, rule) : null;
      if (rule) grammarFor.set(itemName, rule);
      rows.push({
        collectionName: catalog.collection,
        name: itemName,
        displayName: naming ? naming.displayName : itemName,
        slug: naming ? naming.slugStem : undefined,
        description: catalog.descriptions.get(itemName) ?? null,
        imageId:
          catalog.tierIcons.get(itemName)?.get(1) ??
          catalog.imageIds.get(itemName) ??
          iconIndex.get(itemName) ??
          null,
        ...((catalog.flags.get(itemName) ?? { hidden: false, huge: false, titanic: false, gargantuan: false })),
        // Absolute item-level hide (owner-curated list) OR the upstream flag.
        hidden:
          (catalog.flags.get(itemName)?.hidden ?? false) ||
          HIDDEN_ITEMS.includes(`${catalog.collection}/${itemName}`),
        colorVariants: catalog.colorVariantsJson.get(itemName) ?? null,
        configData: catalog.configDataJson.get(itemName) ?? null,
        categoryName: catalog.internalCategories.get(itemName) ?? null,
      });
    }

    try {
      itemsUpserted += await upsertItems(rows);
    } catch (err) {
      log.error(`${err} failed to upsert catalog for ${catalog.collection}`);
      errors.push(`catalog upsert for ${catalog.collection} failed: ${String(err)}`);
      continue;
    }
    images.golden.set(catalog.collection, catalog.golden);
    images.shiny.set(catalog.collection, catalog.shiny);
    if (grammarFor.size > 0) grammars.set(catalog.collection, grammarFor);
    if (catalog.aliases.size > 0) {
      aliases.set(
        catalog.collection,
        new Map([...catalog.aliases].map(([name, set]) => [name, [...set]])),
      );
    }
    if (catalog.tierIcons.size > 0) contextTierIcons.set(catalog.collection, catalog.tierIcons);
    await markSynced(catalog.collection);
  }

  return { itemsUpserted, context: { images, categories, grammars, aliases, tierIcons: contextTierIcons }, errors, invalidEntries };
}
