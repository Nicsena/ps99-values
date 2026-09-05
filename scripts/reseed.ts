// One-off manual reseed script. Run with: npx tsx src/test/reseed.ts
// Wipes the existing data/*.db files, re-applies migrations, and runs a full
// sync (collections + catalog + rap + exists). Intended for first-time setup
// or for a clean rebuild from upstream. Safe to re-run; idempotent.

import { rmSync, existsSync } from 'node:fs';

async function main(): Promise<void> {
  const dbPath = process.env.DB_PATH ?? './data/ps99.db';
  for (const ext of ['', '-shm', '-wal']) {
    const file = `${dbPath}${ext}`;
    if (existsSync(file)) {
      try {
        rmSync(file, { force: true });
        console.log(`[reseed] removed ${file}`);
      } catch (err) {
        console.warn(
          `[reseed] could not remove ${file}: ${err instanceof Error ? err.message : err}`,
        );
      }
    }
  }

  // Dynamic imports only — top-level imports would trigger client.js evaluation
  // (and DB open + WAL creation) before main() runs, racing the rmSync.
  const { ensureSchema } = await import('../db/client.js');
  const { bootstrapIfNeeded, syncAll } = await import('../services/sync/index.js');

  ensureSchema();
  console.log('[reseed] migrations applied');

  await bootstrapIfNeeded();
  console.log('[reseed] collections seeded');

  const result = await syncAll();
  console.log('[reseed] sync result:', JSON.stringify(result, null, 2));
}

main()
  .then(() => {
    console.log('[reseed] done');
    process.exit(0);
  })
  .catch((err) => {
    console.error('[reseed] fatal:', err);
    process.exit(1);
  });
