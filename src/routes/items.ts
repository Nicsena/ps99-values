import { Router, type Request, type Response, type NextFunction } from 'express';
import { getItemDetailBySlug } from '../services/rapService.js';
import { getEnabledCollections } from '../db/queries/collectionsRepo.js';

export const itemsRouter = Router();

itemsRouter.get('/', async (_req: Request, res: Response, next: NextFunction) => {
    try {
        const rows = await getEnabledCollections();
        const collections = rows.map((row) => row.name).sort((a, b) => a.localeCompare(b));
        res.render('items', { collections });
    } catch (err) {
        next(err);
    }
});

itemsRouter.get('/:slug', async (req: Request, res: Response, next: NextFunction) => {
    try {
        const slug = Array.isArray(req.params.slug) ? req.params.slug[0] : req.params.slug;
        // Exact base-slug match only; there are no variant URLs. The page
        // itself lists every stored variant of the item.

        const detail = await getItemDetailBySlug(slug);

        if (!detail) {
            res.locals.slug = slug;
            return next();
        }

        return res.render('item', {
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
});

itemsRouter.use((req: Request, res: Response, next: NextFunction) => {
    const slug = res.locals.slug || null;

    if (slug) {
        return res.status(404).render('errors/404', { title: "PS99 Values", itemSlug: slug });
    } else {
        next();
    }

});