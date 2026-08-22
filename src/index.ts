import { config } from './config.js';
import { initApp } from './app.js';
import { cronService, registerDefaultJobs } from './services/cron/index.js';

async function main(): Promise<void> {
  const app = await initApp();

  const server = app.listen(config.port, () => {
    console.log(`ps99-values listening on http://localhost:${config.port}`);
  });

  registerDefaultJobs();
  await cronService.startAll();

  function shutdown(signal: string): void {
    console.log(`Received ${signal}, shutting down...`);
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 5000).unref();
  }

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((err) => {
  console.error('Fatal startup error:', err);
  process.exit(1);
});
