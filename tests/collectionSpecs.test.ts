import { describe, expect, it } from 'vitest';
import {
  parseColorVariants,
  readColorVariants,
  resolveChromaForColor,
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
