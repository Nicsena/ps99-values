import { describe, expect, it, vi } from 'vitest';
import {
  buildEntryMatcher,
  normalizeCategory,
  type CategoryIndex,
  type MatchableItem,
} from '../src/services/sync/matching.js';

vi.spyOn(console, 'warn').mockImplementation(() => {});

function item(id: number, collectionName: string, name: string): MatchableItem {
  return {
    id,
    collectionName,
    name,
    displayName: name,
    description: null,
    colorVariants: null,
    imageId: null,
    hidden: false,
    huge: false,
    titanic: false,
    gargantuan: false,
  };
}

describe('normalizeCategory', () => {
  it('stems plural forms', () => {
    expect(normalizeCategory('Charms')).toBe('charm');
    expect(normalizeCategory('Charm')).toBe('charm');
    expect(normalizeCategory('Enchant')).toBe('enchant');
    expect(normalizeCategory('Lootboxes')).toBe('lootbox');
    expect(normalizeCategory('MiscItems')).toBe('miscitem');
  });
});

// Mirrors the live upstream namespace collisions (see
// ai/reports/spec-driven-items-rap-exists.html).
const collisionItems = [
  item(1, 'Charms', 'Coins'),
  item(2, 'Enchants', 'Coins'),
  item(3, 'Potions', 'Coins'),
  item(4, 'Charms', 'Diamonds'),
  item(5, 'Fruits', 'Banana'),
  item(6, 'Pets', 'Banana'),
];

const observedCategories: CategoryIndex = new Map([
  ['Charms', new Set(['charms'])],
  ['Enchants', new Set(['enchants', 'special', 'exclusive'])],
  ['Potions', new Set(['potions'])],
  ['Fruits', new Set(['fruits'])],
  ['Pets', new Set(['uncategorized'])],
]);

describe('category-based collision resolution', () => {
  it('resolves a three-way name collision via the feed category', () => {
    const matcher = buildEntryMatcher(collisionItems, observedCategories);
    expect(matcher.match('Coins', 'Charm')?.id).toBe(1);
    expect(matcher.match('Coins', 'Enchant')?.id).toBe(2);
    expect(matcher.match('Coins', 'Potion')?.id).toBe(3);
    expect(matcher.warnings().ambiguousNames).toBe(0);
  });

  it('resolves singular/plural and prefix-skewed pairs', () => {
    const items = [item(1, 'Lootboxes', 'Gift'), item(2, 'MiscItems', 'Gift')];
    const categories: CategoryIndex = new Map([
      ['Lootboxes', new Set(['lootboxes'])],
      ['MiscItems', new Set(['vouchers', 'gifts'])],
    ]);
    const matcher = buildEntryMatcher(items, categories);
    expect(matcher.match('Gift', 'Lootbox')?.id).toBe(1);
    expect(matcher.match('Gift', 'Gift')?.id).toBe(2);
  });

  it('resolves pet-named collisions via the collection-name stem', () => {
    // Pets' catalog tags entries "Uncategorized"; the collection name itself
    // must carry the "Pet" signal (live case: Banana/Candycane in Fruits+Pets).
    const items = [item(1, 'Fruits', 'Banana'), item(2, 'Pets', 'Banana')];
    const categories: CategoryIndex = new Map([
      ['Fruits', new Set(['fruits'])],
      ['Pets', new Set(['pets', 'uncategorized'])],
    ]);
    const matcher = buildEntryMatcher(items, categories);
    expect(matcher.match('Banana', 'Fruit')?.id).toBe(1);
    expect(matcher.match('Banana', 'Pet')?.id).toBe(2);
  });

  it('falls back to alphabetical attribution when no category index exists', () => {
    const matcher = buildEntryMatcher([item(2, 'Misc', 'Coins'), item(1, 'Booths', 'Coins')]);
    expect(matcher.match('Coins', 'TotallyUnknown')?.collectionName).toBe('Booths');
    expect(matcher.warnings().ambiguousNames).toBe(1);
  });

  it('counts unresolvable collisions as unmatched when a category index exists', () => {
    // No candidate covers the feed category and no suffixed name exists:
    // honest unmatched beats fabricated alphabetical attribution.
    const matcher = buildEntryMatcher(
      [item(1, 'Aaa', 'X'), item(2, 'Bbb', 'X')],
      new Map([
        ['Aaa', new Set(['zzz'])],
        ['Bbb', new Set(['zzz'])],
      ]),
    );
    expect(matcher.match('X', 'Nomatch')).toBeNull();
    expect(matcher.warnings().unmatchedEntries).toBe(1);
    expect(matcher.warnings().ambiguousNames).toBe(0);
  });

  it('prefers a category-matched suffixed name over an unmatched single candidate', () => {
    // Live case: Pets has an item literally named "Coin"; the feed id
    // "Coin" with category "Seed" belongs to "Coin Seed" in Seeds.
    const items = [item(1, 'Pets', 'Coin'), item(2, 'Seeds', 'Coin Seed')];
    const categories: CategoryIndex = new Map([
      ['Pets', new Set(['pets'])],
      ['Seeds', new Set(['seeds'])],
    ]);
    const matcher = buildEntryMatcher(items, categories);
    expect(matcher.match('Coin', 'Seed')?.id).toBe(2);
    // The pet itself keeps its normal feed entries.
    expect(matcher.match('Coin', 'Pet')?.id).toBe(1);
  });

  it('resolves feed ids through configName-derived aliases', () => {
    // Live cases: "XPPotion | Titanic" → feed id "Titanic"; the item named
    // "Bundle O' Flags" has configName "Flag Bundle".
    const items = [
      item(1, 'XPPotions', 'Titanic XP Potion'),
      item(2, 'MiscItems', "Bundle O' Flags"),
      item(3, 'MiscItems', 'Flag Cape'),
    ];
    const matcher = buildEntryMatcher(items, {
      aliases: new Map([
        ['XPPotions', new Map([['Titanic XP Potion', ['Titanic']]])],
        ['MiscItems', new Map([["Bundle O' Flags", ['Flag Bundle']]])],
      ]),
    });
    expect(matcher.match('Titanic')?.id).toBe(1);
    expect(matcher.match('Flag Bundle')?.id).toBe(2);
    expect(matcher.match('Flag Cape')?.id).toBe(3);
  });

  it('resolves bare feed ids to "<Id> <Token>" catalog names via category', () => {
    // Live case: Booths catalogs name items "TNT Booth" while feeds carry
    // bare id "TNT" with category "Booth".
    const items = [
      item(1, 'Charms', 'TNT'),
      item(2, 'MiscItems', 'TNT'),
      item(3, 'Booths', 'TNT Booth'),
      item(4, 'Hoverboards', 'Banana Hoverboard'),
      item(5, 'Fruits', 'Banana'),
      item(6, 'Pets', 'Banana'),
    ];
    const categories: CategoryIndex = new Map([
      ['Charms', new Set(['charms'])],
      ['MiscItems', new Set(['boosts'])],
      ['Booths', new Set(['booths'])],
      ['Hoverboards', new Set(['hoverboards'])],
      ['Fruits', new Set(['fruits'])],
      ['Pets', new Set(['pets', 'uncategorized'])],
    ]);
    const matcher = buildEntryMatcher(items, categories);

    expect(matcher.match('TNT', 'Booth')?.id).toBe(3);
    expect(matcher.match('Banana', 'Hoverboard')?.id).toBe(4);
    expect(matcher.match('Banana', 'Fruit')?.id).toBe(5);
    expect(matcher.match('Banana', 'Pet')?.id).toBe(6);

    // Exists-only "Currency" entries have no home: unmatched.
    expect(matcher.match('Coins', 'Currency')).toBeNull();
  });
});

describe('buildEntryMatcher', () => {
  it('matches an upstream id to the single item with that name', () => {
    const matcher = buildEntryMatcher([item(1, 'Pets', 'Unicorn')]);
    expect(matcher.match('Unicorn')?.id).toBe(1);
    expect(matcher.warnings()).toEqual({ unmatchedEntries: 0, ambiguousNames: 0 });
  });

  it('counts entries that match no known item', () => {
    const matcher = buildEntryMatcher([item(1, 'Pets', 'Unicorn')]);
    expect(matcher.match('Mystery')).toBeNull();
    expect(matcher.match('Mystery')).toBeNull();
    expect(matcher.warnings().unmatchedEntries).toBe(2);
  });

  it('attributes cross-collection collisions to the first collection alphabetically', () => {
    // Listed out of alphabetical order on purpose.
    const matcher = buildEntryMatcher([
      item(2, 'Misc', 'Coins'),
      item(1, 'Booths', 'Coins'),
      item(3, 'Charms', 'Coins'),
    ]);
    expect(matcher.match('Coins')?.collectionName).toBe('Booths');
    expect(matcher.warnings().ambiguousNames).toBe(1);
  });

  it('does not count a unique match as ambiguous', () => {
    const matcher = buildEntryMatcher([item(1, 'Pets', 'Dragon'), item(2, 'Misc', 'Coins')]);
    matcher.match('Dragon');
    matcher.match('Coins');
    expect(matcher.warnings()).toEqual({ unmatchedEntries: 0, ambiguousNames: 0 });
  });
});
