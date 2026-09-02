import express from 'express';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { ensureSchema } from './db/client.js';
import { bootstrapIfNeeded } from './services/sync/index.js';
import { pagesRouter } from './routes/pages.js';
import { itemsRouter } from './routes/items.js';
import { apiRouter } from './routes/api.js';
import { createLogger } from './logger.js';

const log = createLogger({ namespace: 'app' });

const rootDir = join(dirname(fileURLToPath(import.meta.url)), '..');

export async function initApp(): Promise<express.Express> {
  ensureSchema();
  await bootstrapIfNeeded();

  const app = express();

  app.set('view engine', 'ejs');
  app.set('views', join(rootDir, 'views'));
  app.use(express.static(join(rootDir, 'public')));

  app.use('/', pagesRouter);
  app.use('/items', itemsRouter);

  app.use('/api', apiRouter);
  app.use('/reports', express.static(join(rootDir, 'ai', 'reports')));


  app.use((req: express.Request, res: express.Response) => {
    return res.status(404).render('errors/404', { title: "PS99 Values"});
  });

  app.use((err: unknown, req: express.Request, res: express.Response, next: express.NextFunction) => {

      if (res.headersSent) {
        next(err);
        return;
      }

      const message = err instanceof Error ? err.message : 'Internal Server Error';
      log.error(err, 'unhandled error');
      return res.status(500).render("errors/500", { title: "PS99 Values", message });
    },
  );

  return app;
}