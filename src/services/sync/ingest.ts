import { type FeedResult, type RapEntry } from '../biggames.js';
import { parseVariantFromRap, type VariantDims } from '../itemKey.js';
import {
  namespaceNaming,
  namespaceTierNaming,
  readColorVariants,
  type NamespaceRule,
} from '../collectionSpecs.js';
import {
  findVariantIds,
  itemIdentityKey,
  upsertItems,
  variantLabel,
  type UpsertItemParams,
} from '../../db/queries/itemsRepo.js';
import {
  getLatestValues,
  insertSnapshots,
  type Metric,
  type SnapshotInsert,
} from '../../db/queries/snapshotsRepo.js';
import type { CatalogContext } from './catalog.js';
import {
  buildEntryMatcher,
  type EntryMatcher,
  type MatchableItem,
} from './matching.js';
import { createLogger } from '../../logger.js';
import { withRetry } from './retry.js';

const log = createLogger({ namespace: 'sync' }).child('ingest');

export interface IngestWarnings {
  unmatchedEntries: number;
  ambiguousNames: number;
  malformedEntries: number;
}

export interface IngestOutcome {
  /** False when the feed could not be fetched at all after retries. */
  ok: boolean;
  inserted: number;
  warnings: IngestWarnings;
  error?: string;
}

interface DesiredValue {
  base: MatchableItem;
  dims: VariantDims;
  value: number;
}

function identityOf(desired: DesiredValue): string {
  return itemIdentityKey(desired.base.collectionName, desired.base.name, desired.dims);
}

// Builds the params for creating a missing variant row from its base item and
// the feed's variant dimensions (prefixed displayName, per-variant icon).
// Namespace grammar: rows of grammar'd items keep the collection's slug stem,
// and tiered rows are addressed with Roman numerals
// ("<item>-tier-<iii>-<token>" / "<Item> Tier <III> <Token>").
function variantRowParams(desired: DesiredValue, context: CatalogContext): UpsertItemParams {
  const { base, dims } = desired;
  const { images } = context;
  const colorName =
    dims.chroma !== 0
      ? (readColorVariants(base.colorVariants).get(dims.chroma)?.name ?? null)
      : null;
  const label = variantLabel(dims, colorName);
  const baseName = base.displayName ?? base.name;
  const rule = context.grammars.get(base.collectionName)?.get(base.name);
  let displayName = label ? `${label} ${baseName}` : baseName;
  let slugStem: string | undefined;
  if (rule) {
    if (dims.tier > 0) {
      const tierNaming = namespaceTierNaming(base.name, rule, dims.tier);
      displayName = label ? `${label} ${tierNaming.displayName}` : tierNaming.displayName;
      slugStem = tierNaming.slugStem;
    } else {
      slugStem = namespaceNaming(base.name, rule).slugStem;
    }
  }
  const goldenId =
    dims.variant === 1 ? (images.golden.get(base.collectionName)?.get(base.name) ?? null) : null;
  const shinyId =
    !dims.variant && dims.shiny
      ? (images.shiny.get(base.collectionName)?.get(base.name) ?? null)
      : null;
  // Each tier has its own upstream icon (configData.Tiers[tier - 1].Icon).
  const tierIconId = context.tierIcons
    .get(base.collectionName)
    ?.get(base.name)
    ?.get(dims.tier);
  return {
    collectionName: base.collectionName,
    name: base.name,
    displayName,
    slug: slugStem,
    description: base.description,
    imageId: goldenId ?? shinyId ?? tierIconId ?? base.imageId,
    hidden: base.hidden,
    huge: base.huge,
    titanic: base.titanic,
    gargantuan: base.gargantuan,
    colorVariants: base.colorVariants,
    categoryName: base.categoryName,
    ...dims,
  };
}

// One metric's full ingest pipeline: fetch → match → change-dedupe → create
// missing variant rows (batched) → insert snapshots.
export async function runFeed(options: {
  metric: Extract<Metric, 'rap' | 'exists'>;
  fetch: () => Promise<FeedResult<RapEntry>>;
  enabledItems: MatchableItem[];
  context: CatalogContext;
  runTime: Date;
}): Promise<IngestOutcome> {
  const { metric, fetch, enabledItems, context, runTime } = options;

  let feed: FeedResult<RapEntry>;
  try {
    feed = await withRetry(fetch);
  } catch (err) {
    log.error(`${err} failed to fetch ${metric} data`);
    return {
      ok: false,
      inserted: 0,
      warnings: { unmatchedEntries: 0, ambiguousNames: 0, malformedEntries: 0 },
      error: `${metric === 'rap' ? 'RAP' : 'exists'} feed failed: ${String(err)}`,
    };
  }

  if (feed.invalid > 0) {
    log.warn(`${metric} skipped ${feed.invalid} malformed feed entries`);
  }

  const latest = await getLatestValues(metric);
  const matcher: EntryMatcher = buildEntryMatcher(enabledItems, {
    categories: context.categories,
    aliases: context.aliases,
  });

  // First pass: match entries to base items, keeping feed order. Dedupe is
  // deferred until after single-level collapse (below) because the collapse
  // can merge two raw combos onto one identity.
  const matched: DesiredValue[] = [];
  for (const entry of feed.data) {
    const base = matcher.match(entry.configData.id, entry.category);
    if (!base) continue;
    const dims = parseVariantFromRap(entry.configData);
    matched.push({ base, dims, value: entry.value });
  }

  // Tier-1 collapse for grammar'd items: tn=1 feed data lives on the base row
  // so no empty metadata shells appear in the frontend, and single-level items
  // ("Double Coins Enchant") get no tier naming at all. Multi-level items
  // (max observed tier > 1) additionally rename their base row to the tier-I
  // form ("Coins I Enchant" / `coins-i-enchant`) so level 1 stays visible.
  const desired: DesiredValue[] = [];
  const seenCombos = new Set<string>();
  const multiLevelBases = new Map<string, { sample: DesiredValue; rule: NamespaceRule }>();

  // Pass A: max observed tier per grammar'd base (must precede the collapse
  // decision — feed order is arbitrary).
  const maxTiers = new Map<string, number>();
  for (const d of matched) {
    if (d.dims.tier === 0) continue;
    if (!context.grammars.get(d.base.collectionName)?.has(d.base.name)) continue;
    const baseKey = identityOf({ base: d.base, dims: { ...d.dims, tier: 0 }, value: d.value });
    maxTiers.set(baseKey, Math.max(maxTiers.get(baseKey) ?? 0, d.dims.tier));
  }

  // Pass B: collapse tn=1 onto the base row for every collection — upstream
  // uses tn=1 to mean "the item itself" (seeds, potions, pets, …), so keeping
  // it as a separate row only splits data across phantom variants. Grammar'd
  // multi-level bases additionally get the tier-I rename.
  for (const d of matched) {
    const rule = context.grammars.get(d.base.collectionName)?.get(d.base.name);
    const baseKey = identityOf({ base: d.base, dims: { ...d.dims, tier: 0 }, value: d.value });
    if (d.dims.tier === 1) {
      d.dims = { ...d.dims, tier: 0 };
      if (rule && (maxTiers.get(baseKey) ?? 0) > 1 && !multiLevelBases.has(baseKey)) {
        multiLevelBases.set(baseKey, { sample: d, rule });
      }
    }
    const combo = identityOf(d);
    if (seenCombos.has(combo)) continue;
    seenCombos.add(combo);
    desired.push(d);
  }

  // Rename multi-level base rows to their tier-I form. Runs regardless of
  // value changes so naming is stable across syncs; batch is tiny (~dozens).
  if (multiLevelBases.size > 0) {
    await upsertItems(
      [...multiLevelBases.values()].map(({ sample, rule }) => {
        const naming = namespaceTierNaming(sample.base.name, rule, 1);
        return {
          collectionName: sample.base.collectionName,
          name: sample.base.name,
          displayName: naming.displayName,
          slug: naming.slugStem,
          description: sample.base.description,
          imageId: sample.base.imageId,
          hidden: sample.base.hidden,
          huge: sample.base.huge,
          titanic: sample.base.titanic,
          gargantuan: sample.base.gargantuan,
          colorVariants: sample.base.colorVariants,
          configData: sample.base.configData,
          categoryName: sample.base.categoryName,
        };
      }),
    );
  }

  // Change detection happens BEFORE any row creation: unchanged variants never
  // trigger upserts. Rows missing from the identity map are genuinely new
  // (they have no snapshot history), so every one of their values is recorded.
  const ids = await findVariantIds(
    desired.map((d) => ({
      collectionName: d.base.collectionName,
      name: d.base.name,
      dims: d.dims,
    })),
  );
  const missing = desired.filter((d) => !ids.has(identityOf(d)));
  if (missing.length > 0) {
    await upsertItems(missing.map((d) => variantRowParams(d, context)));
    const created = await findVariantIds(
      missing.map((d) => ({
        collectionName: d.base.collectionName,
        name: d.base.name,
        dims: d.dims,
      })),
    );
    for (const [key, id] of created) ids.set(key, id);
  }

  const pending: SnapshotInsert[] = [];
  for (const d of desired) {
    const itemId = ids.get(identityOf(d));
    if (itemId === undefined) continue;
    const previous = latest.get(itemId);
    if (previous !== undefined && previous === d.value) continue;
    pending.push({ itemId, value: d.value, capturedAt: runTime });
  }
  if (matcher.warnings().unmatchedEntries > 0) {
    log.warn(`${metric} ${matcher.warnings().unmatchedEntries} feed entries matched no known item and were skipped`)
  }
  if (matcher.warnings().ambiguousNames > 0) {
    log.warn(`${metric} ${matcher.warnings().ambiguousNames} feed entries had cross-collection name collisions`);

  }

  const inserted = await insertSnapshots(metric, pending);
  return {
    ok: true,
    inserted,
    warnings: {
      unmatchedEntries: matcher.warnings().unmatchedEntries,
      ambiguousNames: matcher.warnings().ambiguousNames,
      malformedEntries: feed.invalid,
    },
  };
}
