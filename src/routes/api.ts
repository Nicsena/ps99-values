import { Router, type Request, type Response, type NextFunction } from 'express';
import {
  listItems,
  listItemsFiltered,
  getItemDetail,
  searchItems,
} from '../services/rapService.js';
import { syncAll } from '../services/sync/index.js';

export const apiRouter = Router();

function parsePage(value: unknown): number | undefined {
  const n = Number(value);
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : undefined;
}

apiRouter.get('/pets', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const search = typeof req.query.q === 'string' ? req.query.q : '';
    const sort = req.query.sort === 'rap' ? 'rap' : 'name';
    const order = req.query.order === 'desc' ? 'desc' : 'asc';
    const page = parsePage(req.query.page) ?? 1;
    const pageSize = parsePage(req.query.pageSize) ?? 25;
    const { rows, total } = await listItems({ search, sort, order, page, pageSize });
    res.json({ items: rows, total, page, pageSize });
  } catch (err) {
    next(err);
  }
});

apiRouter.get('/pets/:itemKey/history', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const raw = req.params.itemKey;
    const itemKey = Array.isArray(raw) ? raw[0] : raw;
    const detail = await getItemDetail(itemKey);
    if (!detail) {
      return void res.status(404).json({ status: 'error', error: 'Item not found' });
    }
    const history = [...detail.history]
      .reverse()
      .map(({ capturedAt, rap, exists }) => ({ capturedAt, rap, exists }));
    res.json({ history });
  } catch (err) {
    next(err);
  }
});

apiRouter.get('/items', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await listItemsFiltered({
      q: req.query.q,
      sort: req.query.sort,
      shiny: req.query.shiny,
      pt: req.query.pt,
      category: req.query.category,
      collection: req.query.collection,
      exists: req.query.exists,
      show_rap_zero: req.query.show_rap_zero,
      show_exists_zero: req.query.show_exists_zero,
      hide_pets: req.query.hide_pets,
      page: req.query.page,
      pageSize: req.query.pageSize,
    });
    res.json(result);
  } catch (err) {
    next(err);
  }
});

apiRouter.get('/search', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const q = typeof req.query.q === 'string' ? req.query.q : '';
    const limitRaw = Number(req.query.limit ?? 8);
    const limit =
      Number.isFinite(limitRaw) && limitRaw >= 1 ? Math.min(Math.floor(limitRaw), 10) : 8;
    const result = await searchItems(q, limit);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

apiRouter.post('/refresh', async (_req: Request, res: Response) => {
  try {
    const result = await syncAll();
    res.json({ status: 'ok', ...result });
  } catch (err) {
    res
      .status(500)
      .json({ status: 'error', error: err instanceof Error ? err.message : String(err) });
  }
});
