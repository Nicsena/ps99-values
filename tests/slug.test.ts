import { describe, expect, it } from 'vitest';
import { slugify } from '../src/util/slug.js';

describe('slugify', () => {
  it('produces canonical lowercase slugs', () => {
    expect(slugify('Huge Cosmic Axolotl')).toBe('huge-cosmic-axolotl');
    expect(slugify('Crown')).toBe('crown');
  });

  it('collapses whitespace and dashes', () => {
    expect(slugify('  Mega   -- Hippo  ')).toBe('mega-hippo');
  });

  it('is idempotent', () => {
    const names = ['Huge Cat', "Huge Cat's Delight!", 'ABC', 'a-b--c'];
    for (const name of names) {
      expect(slugify(slugify(name))).toBe(slugify(name));
    }
  });
});
