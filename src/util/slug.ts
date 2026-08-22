export function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/'/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function variantToSlug(pt: number, shiny: boolean): string {
  const base = pt === 1 ? 'golden' : pt === 2 ? 'rainbow' : '';
  if (!base) return shiny ? 'shiny' : 'regular';
  return shiny ? `${base}-shiny` : base;
}

export function parseVariantSlug(
  slug: string,
): { pt: number; shiny: boolean } | null {
  switch (slug) {
    case 'regular':
      return { pt: 0, shiny: false };
    case 'golden':
      return { pt: 1, shiny: false };
    case 'rainbow':
      return { pt: 2, shiny: false };
    case 'shiny':
      return { pt: 0, shiny: true };
    case 'golden-shiny':
      return { pt: 1, shiny: true };
    case 'rainbow-shiny':
      return { pt: 2, shiny: true };
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
  const parts = detailSlug.split('-');
  const out: DetailSlugCandidate[] = [];
  const push = (variantSlug: string, itemSlug: string) => {
    const variant = parseVariantSlug(variantSlug);
    if (variant && itemSlug) {
      out.push({ variantSlug, pt: variant.pt, shiny: variant.shiny, itemSlug });
    }
  };
  if (parts.length >= 3) {
    push(parts.slice(0, 2).join('-'), parts.slice(2).join('-'));
  }
  if (parts.length >= 2) {
    push(parts[0], parts.slice(1).join('-'));
  }
  return out;
}
