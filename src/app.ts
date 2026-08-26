import express from 'express';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { ensureSchema } from './db/client.js';
import { bootstrapIfNeeded } from './services/sync/index.js';
import { pagesRouter } from './routes/pages.js';
import { apiRouter } from './routes/api.js';

const rootDir = join(dirname(fileURLToPath(import.meta.url)), '..');

export async function initApp(): Promise<express.Express> {
  ensureSchema();
  await bootstrapIfNeeded();

  const app = express();

  app.set('view engine', 'ejs');
  app.set('views', join(rootDir, 'views'));
  app.use(express.static(join(rootDir, 'public')));

  app.use('/', pagesRouter);
  app.use('/api', apiRouter);
  app.use('/reports', express.static(join(rootDir, 'ai', 'reports')));

  app.use(
    (err: unknown, _req: express.Request, res: express.Response, next: express.NextFunction) => {
      if (res.headersSent) {
        next(err);
        return;
      }
      const status =
        typeof (err as { status?: unknown })?.status === 'number'
          ? (err as { status: number }).status
          : 500;
      const message = err instanceof Error ? err.message : 'Internal Server Error';
      console.error('[app] unhandled error:', err);
      res.status(status).render('error', { title: 'Error', message });
    },
  );

  return app;
}
