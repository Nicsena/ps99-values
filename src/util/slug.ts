import slugifyLib from 'slugify';

// Single canonical slugifier for the whole application. Produces lowercase,
// dash-separated slugs. Slugs are stored in this form at write time
// (itemsRepo) and the /items/:slug route resolves by exact indexed match,
// so this module is intentionally tiny: no URL grammar lives here anymore.
export function slugify(name: string): string {
  return slugifyLib(name, { replacement: '-', lower: true, trim: true });
}
