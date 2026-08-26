import { describe, expect, it } from 'vitest';
import {
  NAMESPACE_RULES,
  namespaceNaming,
  namespaceTierNaming,
  parseColorVariants,
  readColorVariants,
  resolveChromaForColor,
  toRoman,
} from '../src/services/collectionSpecs.js';

describe('parseColorVariants', () => {
  it('extracts id/name/chance from upstream animations', () => {
    const parsed = parseColorVariants({
      animations: {
        colorVariants: [
          { Id: 1, Name: 'Blue', Chance: 0.16666666666666666 },
          { Id: 2, Name: 'Purple' },
        ],
      },
    });
    expect(parsed).toEqual([
      { id: 1, name: 'Blue', chance: 0.16666666666666666 },
      { id: 2, name: 'Purple', chance: null },
    ]);
  });

  it('returns null when absent, empty, or invalid', () => {
    expect(parseColorVariants({})).toBeNull();
    expect(parseColorVariants({ animations: {} })).toBeNull();
    expect(parseColorVariants({ animations: { colorVariants: [] } })).toBeNull();
    expect(
      parseColorVariants({ animations: { colorVariants: [{ Id: 'x' }, { Name: 'Blue' }] } }),
    ).toBeNull();
    // Invalid entries are skipped; valid ones survive.
    expect(
      parseColorVariants({ animations: { colorVariants: [{ Id: 0, Name: 'Nope' }, { Id: 3, Name: 'Red' }] } }),
    ).toEqual([{ id: 3, name: 'Red', chance: null }]);
  });
});

describe('readColorVariants / resolveChromaForColor', () => {
  const json = JSON.stringify([
    { id: 1, name: 'Yellow', chance: 0.5 },
    { id: 4, name: 'Orange', chance: null },
  ]);

  it('round-trips stored JSON into an id-keyed map', () => {
    const map = readColorVariants(json);
    expect(map.get(1)).toEqual({ id: 1, name: 'Yellow', chance: 0.5 });
    expect(map.get(4)?.name).toBe('Orange');
    expect(readColorVariants(null).size).toBe(0);
    expect(readColorVariants('not-json').size).toBe(0);
    expect(readColorVariants('{"id":1}').size).toBe(0);
  });

  it('resolves color tokens case-insensitively per item map', () => {
    const map = readColorVariants(json);
    expect(resolveChromaForColor(map, 'yellow')).toBe(1);
    expect(resolveChromaForColor(map, 'ORANGE')).toBe(4);
    expect(resolveChromaForColor(map, 'blue')).toBeUndefined();
  });
});

describe('namespace grammar', () => {
  it('converts numbers to uppercase Roman numerals', () => {
    expect(toRoman(1)).toBe('I');
    expect(toRoman(3)).toBe('III');
    expect(toRoman(4)).toBe('IV');
    expect(toRoman(9)).toBe('IX');
    expect(toRoman(10)).toBe('X');
    expect(toRoman(14)).toBe('XIV');
    expect(toRoman(40)).toBe('XL');
    expect(toRoman(1990)).toBe('MCMXC');
    expect(toRoman(0)).toBeNull();
    expect(toRoman(-1)).toBeNull();
    expect(toRoman(4000)).toBeNull();
  });

  it('builds primary naming from the collection token', () => {
    expect(namespaceNaming('Coins', NAMESPACE_RULES.Charms)).toEqual({
      displayName: 'Coins Charm',
      slugStem: 'coins-charm',
    });
    expect(namespaceNaming('Rainbow Swirl', NAMESPACE_RULES.MiscItems)).toEqual({
      displayName: 'Rainbow Swirl Item',
      slugStem: 'rainbow-swirl-item',
    });
    expect(namespaceNaming('Banana', NAMESPACE_RULES.Fruits).slugStem).toBe('banana-fruit');
  });

  it('builds tier naming with Roman numerals and no "tier" word', () => {
    expect(namespaceTierNaming('Coins', NAMESPACE_RULES.Enchants, 3)).toEqual({
      displayName: 'Coins III Enchant',
      slugStem: 'coins-iii-enchant',
    });
    expect(namespaceTierNaming('TNT', NAMESPACE_RULES.Charms, 1).slugStem).toBe('tnt-i-charm');
  });
});
