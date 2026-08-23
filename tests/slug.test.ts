import { describe, expect, it } from 'vitest';
import {
  buildDetailSlug,
  parseVariantSlug,
  slugify,
  splitDetailSlug,
  variantToSlug,
} from '../src/util/slug.js';

describe('slugify', () => {
  it('preserves case and uses dash replacement', () => {
    expect(slugify('Huge Cosmic Axolotl')).toBe('Huge-Cosmic-Axolotl');
    expect(slugify('  Mega   -- Hippo  ')).toBe('Mega-Hippo');
    expect(slugify('Crown')).toBe('Crown');
    expect(slugify("Huge Cat's Delight!")).toBe("Huge-Cat's-Delight!");
  });

  it('is deterministic', () => {
    const names = ['Huge Cat', 'MEGA Hippo', "Dragon's Heart", 'Crown'];
    for (const name of names) {
      expect(slugify(slugify(name))).toBe(slugify(name));
    }
  });
});

describe('variantToSlug / parseVariantSlug', () => {
  it('omits regular variants entirely', () => {
    expect(variantToSlug(0, false)).toBe('');
  });

  it('maps non-regular combinations to exact slugs', () => {
    expect(variantToSlug(1, false)).toBe('Golden');
    expect(variantToSlug(2, false)).toBe('Rainbow');
    expect(variantToSlug(0, true)).toBe('Shiny');
    expect(variantToSlug(1, true)).toBe('Shiny-Golden');
    expect(variantToSlug(2, true)).toBe('Shiny-Rainbow');
  });

  it('parses valid variant slugs back to pt/shiny', () => {
    expect(parseVariantSlug('Golden')).toEqual({ pt: 1, shiny: false, variantSlug: 'Golden' });
    expect(parseVariantSlug('shiny-rainbow')).toEqual({ pt: 2, shiny: true, variantSlug: 'Shiny-Rainbow' });
    expect(parseVariantSlug('shiny')).toEqual({ pt: 0, shiny: true, variantSlug: 'Shiny' });
  });

  it('treats empty as the regular variant', () => {
    expect(parseVariantSlug('')).toEqual({ pt: 0, shiny: false, variantSlug: '' });
    expect(parseVariantSlug('regular')).toBeNull();
  });

  it('returns null for invalid slugs', () => {
    expect(parseVariantSlug('golden-rainbow')).toBeNull();
    expect(parseVariantSlug('mega')).toBeNull();
  });
});

describe('splitDetailSlug', () => {
  it('treats a bare item slug as the regular variant', () => {
    expect(splitDetailSlug('Gargantuan-Skelemelon')).toEqual([
      { variantSlug: '', pt: 0, shiny: false, itemSlug: 'Gargantuan-Skelemelon' },
    ]);
  });

  it('splits a single-token variant prefix from the item slug', () => {
    expect(splitDetailSlug('Rainbow-Gargantuan-Skelemelon')).toEqual([
      { variantSlug: 'Rainbow', pt: 2, shiny: false, itemSlug: 'Gargantuan-Skelemelon' },
      { variantSlug: '', pt: 0, shiny: false, itemSlug: 'Rainbow-Gargantuan-Skelemelon' },
    ]);
  });

  it('prefers the longest valid variant prefix', () => {
    expect(splitDetailSlug('Shiny-Golden-Foo')[0]).toEqual({
      variantSlug: 'Shiny-Golden',
      pt: 1,
      shiny: true,
      itemSlug: 'Foo',
    });
    expect(splitDetailSlug('Shiny-Rainbow-Foo')[0]).toEqual({
      variantSlug: 'Shiny-Rainbow',
      pt: 2,
      shiny: true,
      itemSlug: 'Foo',
    });
  });

  it('falls back to one-token variant when two tokens are not a variant', () => {
    const out = splitDetailSlug('Golden-Rainbow-Foo');
    expect(out[0]).toEqual({ variantSlug: 'Golden', pt: 1, shiny: false, itemSlug: 'Rainbow-Foo' });
    expect(out.at(-1)).toEqual({ variantSlug: '', pt: 0, shiny: false, itemSlug: 'Golden-Rainbow-Foo' });
  });

  it('always includes the whole slug as a base candidate last', () => {
    const out = splitDetailSlug('Golden-Foo');
    expect(out.at(-1)).toEqual({ variantSlug: '', pt: 0, shiny: false, itemSlug: 'Golden-Foo' });
  });
});

describe('buildDetailSlug', () => {
  it('returns only the name for regular items', () => {
    expect(buildDetailSlug('Huge Floppa')).toBe('Huge-Floppa');
    expect(buildDetailSlug('Huge Floppa', 0, false)).toBe('Huge-Floppa');
  });

  it('prepends the variant when present', () => {
    expect(buildDetailSlug('Huge Floppa', 1, false)).toBe('Golden-Huge-Floppa');
    expect(buildDetailSlug('Huge Floppa', 0, true)).toBe('Shiny-Huge-Floppa');
    expect(buildDetailSlug('Huge Floppa', 2, true)).toBe('Shiny-Rainbow-Huge-Floppa');
  });

  it('round-trips through splitDetailSlug', () => {
    for (const [pt, shiny] of [
      [0, false],
      [1, false],
      [2, false],
      [0, true],
      [1, true],
      [2, true],
    ] as const) {
      const detail = buildDetailSlug('Testicorn', pt, shiny);
      const candidates = splitDetailSlug(detail);
      expect(candidates.length).toBeGreaterThan(0);
      expect(candidates.some((c) => c.pt === pt && c.shiny === shiny && c.itemSlug === slugify('Testicorn'))).toBe(true);
    }
  });
});
