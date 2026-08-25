import { describe, expect, it } from 'vitest';
import { buildRapItemKey, parseVariantFromRap } from '../src/services/itemKey.js';

describe('buildRapItemKey', () => {
  it('returns plain id for normal variant', () => {
    expect(buildRapItemKey('Unicorn Dragon', 0, false)).toBe('Unicorn Dragon');
  });

  it('appends golden for pt 1', () => {
    expect(buildRapItemKey('X', 1, false)).toBe('X:golden');
  });

  it('appends rainbow for pt 2', () => {
    expect(buildRapItemKey('X', 2, false)).toBe('X:rainbow');
  });

  it('appends golden and shiny for pt 1 + shiny', () => {
    expect(buildRapItemKey('X', 1, true)).toBe('X:golden:shiny');
  });

  it('trims whitespace on id', () => {
    expect(buildRapItemKey('  A  ', 0, false)).toBe('A');
  });
});

describe('parseVariantFromRap', () => {
  it('defaults to neutral dimensions', () => {
    expect(parseVariantFromRap({ id: 'A' })).toEqual({
      variant: 0,
      shiny: false,
      chroma: 0,
      tier: 0,
    });
  });

  it.each([
    ['pt 1 golden', { pt: 1 }, 1],
    ['pt 2 rainbow', { pt: 2 }, 2],
  ])('parses %s', (_label, extra, expected) => {
    expect(parseVariantFromRap({ id: 'A', ...extra }).variant).toBe(expected);
  });

  it.each([3, -1, 0.5])('collapses out-of-range pt %s to regular', (pt) => {
    expect(parseVariantFromRap({ id: 'A', pt }).variant).toBe(0);
  });

  it.each([
    ['sh:1', { sh: 1 }],
    ['sh:true', { sh: true }],
    ["sh:'yes'", { sh: 'yes' as unknown as boolean }],
  ])('marks shiny true when %s', (_label, extra) => {
    expect(parseVariantFromRap({ id: 'A', ...extra }).shiny).toBe(true);
  });

  it.each([
    ['sh:0', { sh: 0 }],
    ['sh:false', { sh: false }],
    ['sh undefined', {}],
  ])('marks shiny false when %s', (_label, extra) => {
    expect(parseVariantFromRap({ id: 'A', ...extra }).shiny).toBe(false);
  });

  it.each([
    [1, 1],
    [6, 6],
    [4, 4],
  ])('stores chroma level %i', (cv, expected) => {
    expect(parseVariantFromRap({ id: 'A', cv }).chroma).toBe(expected);
  });

  it.each([0, 7, -2, 2.5])('collapses out-of-range cv %s to none', (cv) => {
    expect(parseVariantFromRap({ id: 'A', cv }).chroma).toBe(0);
  });

  it('stores tier number', () => {
    expect(parseVariantFromRap({ id: 'A', tn: 5 }).tier).toBe(5);
  });

  it.each([-1, 2.5])('collapses invalid tn %s to untiered', (tn) => {
    expect(parseVariantFromRap({ id: 'A', tn }).tier).toBe(0);
  });

  it('combines all dimensions independently', () => {
    expect(parseVariantFromRap({ id: 'A', pt: 1, sh: true, cv: 2, tn: 4 })).toEqual({
      variant: 1,
      shiny: true,
      chroma: 2,
      tier: 4,
    });
  });
});
