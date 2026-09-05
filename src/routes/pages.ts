import { Router, type Request, type Response, type NextFunction } from 'express';
import { existsSync, mkdirSync } from 'node:fs';
import { rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { listItemsFiltered } from '../services/rapService.js';
import { findImageIdByName } from '../db/queries/itemsRepo.js';
import { getSetting } from '../services/settings.js';

export const pagesRouter = Router();

const rootDir = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const thumbnailsDir = join(rootDir, 'public', 'thumbnails');
mkdirSync(thumbnailsDir, { recursive: true });

// In-flight promise map keyed on imageId. Two simultaneous requests for the
// same uncached thumbnail share one upstream fetch.
const inflight = new Map<number, Promise<{ ok: boolean }>>();

async function fetchAndStore(imageId: number, filePath: string): Promise<{ ok: boolean }> {
  try {
    const upstream = await fetch(`https://ps99.biggamesapi.io/image/${imageId}`, {
      signal: AbortSignal.timeout(15000),
    });
    if (!upstream.ok) return { ok: false };
    const buffer = Buffer.from(await upstream.arrayBuffer());
    const tmpPath = `${filePath}.tmp`;
    await writeFile(tmpPath, buffer);
    await rename(tmpPath, filePath).catch(async () => {
      // Windows: rename can fail if the target was created concurrently
      if (!existsSync(filePath)) throw new Error('thumbnail rename failed');
    });
    return { ok: true };
  } catch {
    return { ok: false };
  }
}

pagesRouter.get('/thumbnails/:name', async (req: Request, res: Response, next: NextFunction) => {
  try {
    let name: string = Array.isArray(req.params.name) ? req.params.name[0] : req.params.name;
    try {
      name = decodeURIComponent(name);
    } catch {
      /* keep raw */
    }
    // Numeric names address an asset id directly — unambiguous even when
    // multiple collections contain items with the same name.
    const asId = Number(name);
    const imageId =
      Number.isInteger(asId) && asId > 0
        ? asId
        : name.trim()
          ? await findImageIdByName(name)
          : null;
    if (!imageId) {
      res.set('Cache-Control', 'public, max-age=86400, immutable');
      return void res.redirect(302, '/img/placeholder.svg');
    }

    const fileName = `${imageId}.png`;
    const filePath = join(thumbnailsDir, fileName);
    if (!existsSync(filePath)) {
      let pending = inflight.get(imageId);
      if (!pending) {
        pending = fetchAndStore(imageId, filePath);
        inflight.set(imageId, pending);
        try {
          await pending;
        } finally {
          inflight.delete(imageId);
        }
      } else {
        await pending;
      }
      if (!existsSync(filePath)) {
        res.set('Cache-Control', 'public, max-age=86400, immutable');
        return void res.redirect(302, '/img/placeholder.svg');
      }
    }
    res.set('Cache-Control', 'public, max-age=86400, immutable');
    res.redirect(302, `/thumbnails/${fileName}`);
  } catch (err) {
    next(err);
  }
});

pagesRouter.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    // Same source as the /items grid so the counts agree by construction.
    const [items, lastSyncAt] = await Promise.all([
      listItemsFiltered({}),
      getSetting<string>('sync.lastSyncAt'),
    ]);
    res.render('home', {
      itemCount: items.total,
      lastSyncAt,
    });
  } catch (err) {
    next(err);
  }
});

pagesRouter.get('/status/:code', async (req: Request, res: Response, next: NextFunction) => {
  try {
      const statusCode: number = Number(req.params.code);
      if (statusCode === 500) return res.status(statusCode).render(`errors/${statusCode}`, { title: "PS99 Values", message: "" })

      return res.status(statusCode).render(`errors/${statusCode}`, { title: "PS99 Values" })

  } catch(error) {
      next(error);
  }
});
