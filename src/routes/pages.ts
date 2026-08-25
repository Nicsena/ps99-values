import { Router, type Request, type Response, type NextFunction } from 'express';
import { existsSync, mkdirSync } from 'node:fs';
import { rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getItemDetailBySlug } from '../services/rapService.js';
import { getEnabledCollections } from '../db/queries/collectionsRepo.js';
import { findImageIdByName } from '../db/queries/itemsRepo.js';

export const pagesRouter = Router();

const rootDir = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const thumbnailsDir = join(rootDir, 'public', 'thumbnails');
mkdirSync(thumbnailsDir, { recursive: true });

pagesRouter.get('/thumbnails/:name', async (req: Request, res: Response, next: NextFunction) => {
  try {
    let name: string = Array.isArray(req.params.name) ? req.params.name[0] : req.params.name;
    try {
      name = decodeURIComponent(name);
    } catch {
      /* keep raw */
    }
    const imageId = name.trim() ? await findImageIdByName(name) : null;
    if (!imageId) return void res.redirect(302, '/img/placeholder.svg');

    const fileName = `${imageId}.png`;
    const filePath = join(thumbnailsDir, fileName);
    if (!existsSync(filePath)) {
      const upstream = await fetch(`https://ps99.biggamesapi.io/image/${imageId}`, {
        signal: AbortSignal.timeout(15000),
      });
      if (!upstream.ok) return void res.redirect(302, '/img/placeholder.svg');
      const buffer = Buffer.from(await upstream.arrayBuffer());
      const tmpPath = `${filePath}.tmp`;
      await writeFile(tmpPath, buffer);
      await rename(tmpPath, filePath).catch(async () => {
        // Windows: rename can fail if the target was created concurrently
        if (!existsSync(filePath)) throw new Error('thumbnail rename failed');
      });
    }
    res.redirect(302, `/thumbnails/${fileName}`);
  } catch (err) {
    next(err);
  }
});

function notFound(res: Response, message: string): void {
  res.status(404).render('error', {
    title: 'Not Found',
    message,
  });
}

pagesRouter.get('/', (_req: Request, res: Response, next: NextFunction) => {
  try {
    res.render('home');
  } catch (err) {
    next(err);
  }
});

pagesRouter.get(
  '/items',
  async (_req: Request, res: Response, next: NextFunction) => {
    try {
      const rows = await getEnabledCollections();
      const collections = rows.map((row) => row.name).sort((a, b) => a.localeCompare(b));
      res.render('items', { collections });
    } catch (err) {
      next(err);
    }
  },
);

pagesRouter.get(
  '/items/:slug',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const raw = Array.isArray(req.params.slug) ? req.params.slug[0] : req.params.slug;
      // Exact base-slug match only; there are no variant URLs. The page
      // itself lists every stored variant of the item.
      const detail = await getItemDetailBySlug(raw);
      if (!detail) {
        return void notFound(res, `Item "${raw}" not found.`);
      }
      res.render('item', {
        item: detail.item,
        currentRap: detail.currentRap,
        rapUpdatedAt: detail.rapUpdatedAt,
        exists: detail.exists,
        totalExists: detail.totalExists,
        variants: detail.variants,
        stats: detail.stats,
        history: detail.history,
        similarItems: detail.similarItems,
      });
    } catch (err) {
      next(err);
    }
  },
);

