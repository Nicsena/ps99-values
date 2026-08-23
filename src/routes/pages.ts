import { Router, type Request, type Response, type NextFunction } from 'express';
import { getItemDetail } from '../services/rapService.js';
import { buildRapItemKey } from '../services/itemKey.js';
import { getEnabledCollections } from '../data/collectionsRepo.js';
import { findItemBySlug } from '../data/itemsRepo.js';
import { splitDetailSlug, type DetailSlugCandidate } from '../util/slug.js';

export const pagesRouter = Router();

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
  '/items/:detailSlug',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const raw = Array.isArray(req.params.detailSlug)
        ? req.params.detailSlug[0]
        : req.params.detailSlug;
      const candidates = splitDetailSlug(raw);
      if (candidates.length === 0) {
        return void notFound(res, 'Unknown item variant.');
      }
      let item = null;
      let matched: DetailSlugCandidate | null = null;
      for (const candidate of candidates) {
        const found = await findItemBySlug(candidate.itemSlug);
        if (found) {
          item = found;
          matched = candidate;
          break;
        }
      }
      if (!item || !matched) {
        return void notFound(res, `Item "${raw}" not found.`);
      }
      const detail = await getItemDetail(
        buildRapItemKey(item.name, matched.pt, matched.shiny),
      );
      if (!detail) {
        return void notFound(res, `Item "${matched.itemSlug}" not found.`);
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

