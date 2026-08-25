import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { config } from '../config.js';
import * as schema from './schema.js';

mkdirSync(dirname(config.dbPath), { recursive: true });

export const sqlite = new Database(config.dbPath);
sqlite.pragma('journal_mode = WAL');
sqlite.pragma('foreign_keys = ON');

export const db: BetterSQLite3Database<typeof schema> = drizzle(sqlite, { schema });

// drizzle-kit migrations are the sole schema truth; the generated SQL lives in
// <repo>/drizzle and resolves correctly from both src/ and dist/ builds.
const migrationsFolder = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'drizzle');

export function ensureSchema(): void {
  // Migrations rebuild tables (e.g. the Revision-2 items/snapshots swap), which
  // cannot run with FK enforcement on. Enforcement is restored afterwards.
  const fkWasOn = sqlite.pragma('foreign_keys', { simple: true }) === 1;
  if (fkWasOn) sqlite.pragma('foreign_keys = OFF');
  try {
    migrate(db, { migrationsFolder });
  } finally {
    if (fkWasOn) sqlite.pragma('foreign_keys = ON');
  }
}
