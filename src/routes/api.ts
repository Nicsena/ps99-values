import { Router, type Request, type Response, type NextFunction } from 'express';
import { listItems, getItemDetail } from '../services/rapService.js';
import { syncAll } from '../services/sync.js';

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
    res.json({ history: detail.history });
  } catch (err) {
    next(err);
  }
});

apiRouter.post('/refresh', async (_req: Request, res: Response) => {
  try {
    const result = await syncAll();
    res.json({ status: 'ok', ...result });
  } catch (err) {
    res.status(500).json({ status: 'error', error: err instanceof Error ? err.message : String(err) });
  }
});
