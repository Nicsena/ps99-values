export interface RapVariant {
  id: string;
  pt: number;
  shiny: boolean;
}

// API itemKey encoding: "Name[:golden|rainbow][:shiny]". This is the single
// translation point between structured variant dims and the string keys used
// by API routes and detail resolution. The URL slug grammar lives separately
// in src/util/slug.ts; pages.ts bridges the two via buildRapItemKey after a
// slug has been resolved into structured dims.
// API itemKey encoding: "Name[:golden|rainbow][:shiny][:color]". This is the
// single translation point between structured variant dims and the string keys
// used by API routes and detail resolution. Color tokens are lowercase names
// from the item's own stored colorVariants list (e.g. "Huge Chroma Phoenix:blue");
// there are no variant URLs anymore — detail pages are addressed by exact base
// slug only (see src/util/slug.ts and ai/plans/slug-redesign.md).
export function buildRapItemKey(
  name: string,
  pt: number,
  shiny: boolean,
  color?: string | null,
): string {
  let key = name.trim();
  if (pt === 1) key += ':golden';
  else if (pt === 2) key += ':rainbow';
  if (shiny) key += ':shiny';
  const colorToken = color?.trim().toLowerCase();
  if (colorToken) key += `:${colorToken}`;
  return key;
}

export interface VariantDims {
  variant: number;
  shiny: boolean;
  chroma: number;
  tier: number;
}

// Translates an upstream feed entry's configData into variant dimensions.
// Upstream fields (inferred from observed payloads, undocumented):
//   pt — pet type: 1 golden / 2 rainbow; sh — shiny flag;
//   cv — chroma level 1..6; tn — tier number.
// Unknown/out-of-range values collapse to the neutral dimension.
export function parseVariantFromRap(configData: {
  id: string;
  pt?: number;
  sh?: number | boolean;
  cv?: number;
  tn?: number;
}): VariantDims {
  const variant = configData.pt === 1 || configData.pt === 2 ? configData.pt : 0;
  const shiny = Boolean(configData.sh);
  const cv = configData.cv;
  const chroma =
    typeof cv === 'number' && Number.isInteger(cv) && cv >= 1 && cv <= 6 ? cv : 0;
  const tn = configData.tn;
  const tier = typeof tn === 'number' && Number.isInteger(tn) && tn >= 0 ? tn : 0;
  return { variant, shiny, chroma, tier };
}
