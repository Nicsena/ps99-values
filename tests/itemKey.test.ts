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
  it('defaults to pt 0 and not shiny', () => {
    expect(parseVariantFromRap({ id: 'A' })).toEqual({ id: 'A', pt: 0, shiny: false });
  });

  it('parses pt 1 as golden', () => {
    expect(parseVariantFromRap({ id: 'A', pt: 1 })).toEqual({ id: 'A', pt: 1, shiny: false });
  });

  it('parses pt 2 as rainbow', () => {
    expect(parseVariantFromRap({ id: 'A', pt: 2 })).toEqual({ id: 'A', pt: 2, shiny: false });
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
});
