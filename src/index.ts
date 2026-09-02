import { config } from './config.js';
import { initApp } from './app.js';
import { cronService, registerDefaultJobs } from './services/cron/index.js';
import { createLogger } from './logger.js';

const log = createLogger({ namespace: 'app' });

async function main(): Promise<void> {
  const app = await initApp();

  const server = app.listen(config.port, () => {
    log.info(`ps99-values listening on http://localhost:${config.port}`);
  });

  registerDefaultJobs();
  await cronService.startAll();

  function shutdown(signal: string): void {
    log.info(`Received ${signal}, shutting down...`);
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 5000).unref();
  }

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((err) => {
  log.exception(err, 'Fatal startup error');
  process.exit(1);
});
