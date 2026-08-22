import { schedule } from 'node-cron';
import { config } from './config.js';
import { initApp } from './app.js';
import { syncAll, pruneSnapshots } from './services/sync.js';

async function main(): Promise<void> {
  const app = await initApp();

  const server = app.listen(config.port, () => {
    console.log(`ps99-values listening on http://localhost:${config.port}`);
  });

  schedule(config.syncCron, () => {
    syncAll()
      .then((result) => {
        console.log(
          `[cron] sync done: collections=${result.collections} items=${result.itemsUpserted} snapshots=${result.snapshotsInserted}`,
        );
        return pruneSnapshots();
      })
      .then((pruned) => {
        if (pruned > 0) console.log(`[cron] pruned ${pruned} snapshots`);
      })
      .catch(console.error);
  });

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
