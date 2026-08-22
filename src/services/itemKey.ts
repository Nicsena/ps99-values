export function buildRapItemKey(id: string, pt: number, shiny: boolean): string {
  let key = id.trim();
  if (pt === 1) key += ':golden';
  else if (pt === 2) key += ':rainbow';
  if (shiny) key += ':shiny';
  return key;
}

export interface RapVariant {
  id: string;
  pt: number;
  shiny: boolean;
}

export function parseVariantFromRap(configData: {
  id: string;
  pt?: number;
  sh?: number | boolean;
}): RapVariant {
  const pt = configData.pt === 1 || configData.pt === 2 ? configData.pt : 0;
  return { id: configData.id, pt, shiny: Boolean(configData.sh) };
}
