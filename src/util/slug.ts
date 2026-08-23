import slugifyLib from 'slugify';

export function slugify(name: string): string {
  return slugifyLib(name, { replacement: '-', lower: false });
}

export function variantToSlug(pt: number, shiny: boolean): string {
  const base = pt === 1 ? 'Golden' : pt === 2 ? 'Rainbow' : '';
  return [shiny ? 'Shiny' : '', base].filter(Boolean).join('-');
}

export interface VariantSlugParts {
  pt: number;
  shiny: boolean;
  variantSlug: string;
}

export function parseVariantSlug(slug: string): VariantSlugParts | null {
  const normalized = slug.trim().toLowerCase();
  switch (normalized) {
    case '':
      return { pt: 0, shiny: false, variantSlug: '' };
    case 'golden':
      return { pt: 1, shiny: false, variantSlug: 'Golden' };
    case 'rainbow':
      return { pt: 2, shiny: false, variantSlug: 'Rainbow' };
    case 'shiny':
      return { pt: 0, shiny: true, variantSlug: 'Shiny' };
    case 'shiny-golden':
      return { pt: 1, shiny: true, variantSlug: 'Shiny-Golden' };
    case 'shiny-rainbow':
      return { pt: 2, shiny: true, variantSlug: 'Shiny-Rainbow' };
    default:
      return null;
  }
}

export interface DetailSlugCandidate {
  variantSlug: string;
  pt: number;
  shiny: boolean;
  itemSlug: string;
}

export function splitDetailSlug(detailSlug: string): DetailSlugCandidate[] {
  const parts = detailSlug.split('-').filter((p) => p.length > 0);
  if (parts.length === 0) return [];

  const out: DetailSlugCandidate[] = [];
  const push = (variantSlug: string, itemSlug: string) => {
    const variant = parseVariantSlug(variantSlug);
    if (variant && itemSlug) {
      out.push({ variantSlug: variant.variantSlug, pt: variant.pt, shiny: variant.shiny, itemSlug });
    }
  };

  if (parts.length >= 3) {
    push(parts.slice(0, 2).join('-'), parts.slice(2).join('-'));
  }
  if (parts.length >= 2) {
    push(parts[0], parts.slice(1).join('-'));
  }
  push('', parts.join('-'));

  return out.filter(
    (candidate, index) => out.findIndex((c) => c.variantSlug === candidate.variantSlug && c.itemSlug === candidate.itemSlug) === index,
  );
}

export function buildDetailSlug(name: string, pt = 0, shiny = false): string {
  const variant = variantToSlug(pt, shiny);
  return [variant, slugify(name)].filter(Boolean).join('-');
}
