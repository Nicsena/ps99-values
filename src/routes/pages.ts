import { Router, type Request, type Response, type NextFunction } from 'express';
import { getItemDetail } from '../services/rapService.js';
import { getEnabledCollections } from '../data/collectionsRepo.js';

export const pagesRouter = Router();

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

pagesRouter.get('/pet/:itemKey', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const raw = req.params.itemKey;
    let itemKey = Array.isArray(raw) ? raw[0] : raw;
    try {
      itemKey = decodeURIComponent(itemKey);
    } catch {
      itemKey = Array.isArray(raw) ? raw[0] : raw;
    }
    if (!itemKey || !itemKey.trim()) {
      return void res.status(404).render('error', {
        title: 'Not Found',
        message: 'Pet not found.',
      });
    }
    const detail = await getItemDetail(itemKey);
    if (!detail) {
      return void res.status(404).render('error', {
        title: 'Not Found',
        message: `Pet "${itemKey}" not found.`,
      });
    }
    res.render('pet', {
      item: detail.item,
      currentRap: detail.currentRap,
      variants: detail.variants,
      history: detail.history,
    });
  } catch (err) {
    next(err);
  }
});
