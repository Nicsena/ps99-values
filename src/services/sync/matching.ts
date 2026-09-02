// Pure feed-entry → base-item attribution. No I/O so matching rules are
// unit-testable in isolation from the database and upstream client.

import { createLogger } from '../../logger.js';

const log = createLogger({ namespace: 'sync' }).child('matching');

export interface MatchableItem {
  id: number;
  collectionName: string;
  name: string;
  displayName: string | null;
  description: string | null;
  colorVariants: string | null;
  configData: string | null;
  imageId: number | null;
  categoryName: string | null;
  hidden: boolean;
  huge: boolean;
  titanic: boolean;
  gargantuan: boolean;
}

export interface MatchWarnings {
  unmatchedEntries: number;
  ambiguousNames: number;
}

export interface EntryMatcher {
  /** Returns the attributed base item, or null when nothing matches. */
  match(upstreamId: string, category?: string): MatchableItem | null;
  warnings(): MatchWarnings;
}

/** Observed catalog categories per collection (lowercased). */
export type CategoryIndex = Map<string, ReadonlySet<string>>;

/** Alternate upstream ids per collection → item name → aliases. */
export type AliasIndex = Map<string, Map<string, readonly string[]>>;

export interface MatcherOptions {
  categories?: CategoryIndex;
  /**
   * ConfigName-derived alternate ids ("XPPotion | Titanic" → "Titanic",
   * "Flag Bundle" for the item named "Bundle O' Flags"). Feeds frequently use
   * these instead of the resolved display names.
   */
  aliases?: AliasIndex;
}

// Upstream skews between feed categories and catalog categories ("Charm" vs
// "Charms", "Lootbox" vs "Lootboxes"). Stemming plus a directional prefix
// check covers the observed pairs without a hand-maintained alias table.
export function normalizeCategory(category: string): string {
  return category
    .toLowerCase()
    .replace(/ies$/, 'y')
    .replace(/(x|s|z|ch|sh)es$/, '$1')
    .replace(/s$/, '');
}

function categoriesMatch(feedCategory: string, observed: string): boolean {
  const feed = normalizeCategory(feedCategory);
  const other = normalizeCategory(observed);
  return feed.length > 0 && (feed === other || other.startsWith(feed));
}

// The RAP/exists feeds carry no collection field, so entries are matched by
// bare item name. Resolution stages for namespace collisions:
//   1. Category filter — pick the candidate whose collection's observed
//      categories match the feed entry's category ("Coins" as Charm vs
//      Enchant vs Potion).
//   2. Suffixed lookup — some catalogs name items "<Id> <Token>" while feeds
//      carry the bare id ("TNT" [Booth] → "TNT Booth" in Booths). When the
//      category identifies a collection, try that suffixed name there.
//   3. When a category is known but matches no candidate's domain (e.g.
//      exists-only "Currency" entries), the entry counts as unmatched rather
//      than being attributed arbitrarily. Pure alphabetical fallback applies
//      only when no category information exists at all.
export function buildEntryMatcher(
  items: MatchableItem[],
  optionsOrCategories: MatcherOptions | CategoryIndex = {},
): EntryMatcher {
  // Accept a bare category index for the common single-index case.
  const options: MatcherOptions = optionsOrCategories instanceof Map
    ? { categories: optionsOrCategories }
    : optionsOrCategories;
  const categoriesByCollection = options.categories;
  const byName = new Map<string, MatchableItem[]>();
  for (const item of [...items].sort((a, b) => a.collectionName.localeCompare(b.collectionName))) {
    const list = byName.get(item.name) ?? [];
    list.push(item);
    byName.set(item.name, list);
  }

  // Alias index: feed ids that match no primary name ("Titanic",
  // "Enchant Bundle") resolve to their item through here.
  const byAlias = new Map<string, MatchableItem[]>();
  if (options.aliases) {
    for (const item of items) {
      const aliases = options.aliases.get(item.collectionName)?.get(item.name) ?? [];
      for (const alias of aliases) {
        const list = byAlias.get(alias) ?? [];
        if (!list.some((existing) => existing.id === item.id)) list.push(item);
        byAlias.set(alias, list);
      }
    }
  }

  // Primary-name matches take precedence, but alias matches are merged in so
  // the category stages can arbitrate ("Huge" the potion vs "Huge" the
  // XPPotion alias for "Huge XP Potion").
  function candidatesFor(upstreamId: string): MatchableItem[] {
    const primary = byName.get(upstreamId) ?? [];
    const aliased = byAlias.get(upstreamId) ?? [];
    if (aliased.length === 0) return primary;
    const merged = [...primary];
    for (const candidate of aliased) {
      if (!merged.some((existing) => existing.id === candidate.id)) merged.push(candidate);
    }
    return merged;
  }

  let unmatchedEntries = 0;
  let ambiguousNames = 0;

  function attribute(upstreamId: string, candidates: MatchableItem[]): MatchableItem | null {
    const first = candidates[0];
    if (candidates.length > 1) {
      ambiguousNames += 1;
      log.warn(`name ${upstreamId} matches ${candidates.map((c) => c.collectionName).join('/')} attributing to ${first.collectionName}`)
    }
    return first;
  }

  // "Booths" → "Booth", "Hoverboards" → "Hoverboard".
  function collectionToken(collection: string): string {
    const stem = normalizeCategory(collection);
    return stem.charAt(0).toUpperCase() + stem.slice(1);
  }

  function suffixedLookup(
    upstreamId: string,
    category: string,
  ): MatchableItem | null {
    if (!categoriesByCollection) return null;
    for (const [collection, observed] of categoriesByCollection) {
      const coversCategory = [...observed].some((value) => categoriesMatch(category, value));
      if (!coversCategory) continue;
      const hit = byName.get(`${upstreamId} ${collectionToken(collection)}`);
      if (hit && hit.length > 0) {
        log.warn(`${upstreamId} [${category}] resolved via suffixed name ${hit[0].name} (${collection})`)
        return hit[0];
      }
    }
    return null;
  }

  function collectionObservedCovers(
    candidate: MatchableItem,
    category: string,
  ): boolean {
    const observed = categoriesByCollection?.get(candidate.collectionName);
    if (!observed) return true; // no signal — don't disqualify
    for (const value of observed) {
      if (categoriesMatch(category, value)) return true;
    }
    return false;
  }

  return {
    match(upstreamId: string, category?: string): MatchableItem | null {
      const candidates = candidatesFor(upstreamId);
      if (candidates.length === 0) {
        const suffixed = category !== undefined ? suffixedLookup(upstreamId, category) : null;
        if (suffixed) return suffixed;
        unmatchedEntries += 1;
        return null;
      }
      if (candidates.length === 1) {
        const [candidate] = candidates;
        // A single bare-name match whose collection doesn't cover the feed
        // category (e.g. the pet "Coin" vs feed "Coin" [Seed]) loses to a
        // category-matching suffixed name ("Coin Seed") when one exists.
        if (
          category !== undefined &&
          !collectionObservedCovers(candidate, category)
        ) {
          const suffixed = suffixedLookup(upstreamId, category);
          if (suffixed) return suffixed;
        }
        return candidate;
      }

      // Namespace collision across collections: prefer candidates whose
      // collection actually contains items of the feed entry's category.
      if (category && categoriesByCollection) {
        const resolved = candidates.filter((candidate) =>
          collectionObservedCovers(candidate, category),
        );
        if (resolved.length >= 1) return attribute(upstreamId, resolved);

        const suffixed = suffixedLookup(upstreamId, category);
        if (suffixed) return suffixed;

        // The category belongs to a domain none of the candidates cover:
        // honest unmatched instead of fabricated attribution.
        unmatchedEntries += 1;
        return null;
      }
      return attribute(upstreamId, candidates);
    },
    warnings: () => ({ unmatchedEntries, ambiguousNames }),
  };
}
