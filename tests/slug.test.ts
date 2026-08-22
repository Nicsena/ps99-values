import { describe, expect, it } from 'vitest';
import {
  parseVariantSlug,
  slugify,
  splitDetailSlug,
  variantToSlug,
} from '../src/util/slug.js';

describe('slugify', () => {
  it('lowercases, strips apostrophes, and collapses non-alphanumerics', () => {
    expect(slugify("Huge Cat's Delight!")).toBe('huge-cats-delight');
    expect(slugify('  Mega   -- Hippo  ')).toBe('mega-hippo');
    expect(slugify('Crown')).toBe('crown');
  });

  it('round-trips through itself', () => {
    const names = ["Titanic Cat's Eye", 'HUGE RAINBOW!!', 'Shiny-Mega-Bunny'];
    for (const name of names) {
      expect(slugify(slugify(name))).toBe(slugify(name));
    }
  });
});

describe('variantToSlug / parseVariantSlug', () => {
  it('maps every pt/shiny combination to its exact slug', () => {
    expect(variantToSlug(0, false)).toBe('regular');
    expect(variantToSlug(1, false)).toBe('golden');
    expect(variantToSlug(2, false)).toBe('rainbow');
    expect(variantToSlug(0, true)).toBe('shiny');
    expect(variantToSlug(1, true)).toBe('golden-shiny');
    expect(variantToSlug(2, true)).toBe('rainbow-shiny');
  });

  it('parses valid slugs back to pt/shiny', () => {
    expect(parseVariantSlug('regular')).toEqual({ pt: 0, shiny: false });
    expect(parseVariantSlug('golden')).toEqual({ pt: 1, shiny: false });
    expect(parseVariantSlug('rainbow')).toEqual({ pt: 2, shiny: false });
    expect(parseVariantSlug('shiny')).toEqual({ pt: 0, shiny: true });
    expect(parseVariantSlug('golden-shiny')).toEqual({ pt: 1, shiny: true });
    expect(parseVariantSlug('rainbow-shiny')).toEqual({ pt: 2, shiny: true });
  });

  it('returns null for invalid slugs', () => {
    expect(parseVariantSlug('gold')).toBeNull();
    expect(parseVariantSlug('shiny-golden')).toBeNull();
    expect(parseVariantSlug('')).toBeNull();
  });

  it('round-trips through variantToSlug', () => {
    const combos: [number, boolean][] = [
      [0, false],
      [1, false],
      [2, false],
      [0, true],
      [1, true],
      [2, true],
    ];
    for (const [pt, shiny] of combos) {
      expect(parseVariantSlug(variantToSlug(pt, shiny))).toEqual({ pt, shiny });
    }
  });
});

describe('splitDetailSlug', () => {
  it('splits single-token variants from item slug', () => {
    expect(splitDetailSlug('rainbow-gargantuan-skelemelon')).toEqual([
      { variantSlug: 'rainbow', pt: 2, shiny: false, itemSlug: 'gargantuan-skelemelon' },
    ]);
    expect(splitDetailSlug('regular-foo')).toEqual([
      { variantSlug: 'regular', pt: 0, shiny: false, itemSlug: 'foo' },
    ]);
  });

  it('prefers the longest valid variant prefix', () => {
    expect(splitDetailSlug('golden-shiny-huge-chest-mimic')[0]).toEqual({
      variantSlug: 'golden-shiny',
      pt: 1,
      shiny: true,
      itemSlug: 'huge-chest-mimic',
    });
    expect(splitDetailSlug('rainbow-shiny-foo')[0]).toEqual({
      variantSlug: 'rainbow-shiny',
      pt: 2,
      shiny: true,
      itemSlug: 'foo',
    });
  });

  it('falls back to one-token variant when two tokens are not a variant', () => {
    expect(splitDetailSlug('shiny-golden-foo')).toEqual([
      { variantSlug: 'shiny', pt: 0, shiny: true, itemSlug: 'golden-foo' },
    ]);
    expect(splitDetailSlug('golden-golden-y')).toEqual([
      { variantSlug: 'golden', pt: 1, shiny: false, itemSlug: 'golden-y' },
    ]);
  });

  it('returns candidates in priority order when both parses are possible', () => {
    const out = splitDetailSlug('golden-shiny-x');
    expect(out.map((c) => c.variantSlug)).toEqual(['golden-shiny', 'golden']);
  });

  it('returns empty array when nothing matches', () => {
    expect(splitDetailSlug('bogus-foo')).toEqual([]);
    expect(splitDetailSlug('golden')).toEqual([]);
    expect(splitDetailSlug('')).toEqual([]);
  });
});
