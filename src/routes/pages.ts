import { Router, type Request, type Response, type NextFunction } from 'express';
import { listItems, getItemDetail } from '../services/rapService.js';

export const pagesRouter = Router();

function parsePage(value: unknown): number | undefined {
  const n = Number(value);
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : undefined;
}

pagesRouter.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const search = typeof req.query.q === 'string' ? req.query.q : '';
    const sort = req.query.sort === 'rap' ? 'rap' : 'name';
    const order = req.query.order === 'desc' ? 'desc' : 'asc';
    const page = parsePage(req.query.page) ?? 1;
    const { rows, total } = await listItems({ search, sort, order, page });
    res.render('index', {
      items: rows,
      search,
      sort,
      order,
      page,
      totalPages: Math.max(1, Math.ceil(total / 25)),
      total,
    });
  } catch (err) {
    next(err);
  }
});

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
