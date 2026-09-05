import { Router, type Request, type Response, type NextFunction } from 'express';
import { listItemsFiltered, searchItems } from '../services/rapService.js';
import { createLogger } from '../logger.js';

const log = createLogger({ namespace: 'routes.api' });

export const apiRouter = Router();

apiRouter.get('/items', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await listItemsFiltered({
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

apiRouter.use((req: Request, res: Response) => {
  return res.status(404).json({ error: { "status": 404, "message": "Not Found" }})
});

apiRouter.use((err: unknown, req: Request, res: Response, next: NextFunction) => {

  if (res.headersSent) {
    next(err);
    return;
  }

  const message = err instanceof Error ? err.message : 'Internal Server Error';
  log.error(err, 'unhandled error');
  return res.status(500).json({ error: { "status": 500, "message": message }})
});