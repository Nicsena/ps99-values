import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import Database from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { config } from '../config.js';
import * as schema from './schema.js';

mkdirSync(dirname(config.dbPath), { recursive: true });

export const sqlite = new Database(config.dbPath);
sqlite.pragma('journal_mode = WAL');

export const db: BetterSQLite3Database<typeof schema> = drizzle(sqlite, { schema });

const statements = [
  `CREATE TABLE IF NOT EXISTS collections (
    name TEXT PRIMARY KEY,
    enabled INTEGER NOT NULL DEFAULT 0,
    date_synced INTEGER
  )`,
  `CREATE TABLE IF NOT EXISTS items (
    id TEXT PRIMARY KEY,
    collection_name TEXT NOT NULL REFERENCES collections(name),
    name TEXT NOT NULL,
    description TEXT,
    category TEXT,
    config_data TEXT,
    date_synced INTEGER NOT NULL DEFAULT (unixepoch())
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS items_collection_name_uq ON items (collection_name, name)`,
  `CREATE TABLE IF NOT EXISTS rap_snapshots (
    id TEXT PRIMARY KEY,
    item_id TEXT NOT NULL REFERENCES items(id),
    item_key TEXT NOT NULL,
    pt INTEGER NOT NULL DEFAULT 0,
    shiny INTEGER NOT NULL DEFAULT 0,
    value INTEGER NOT NULL,
    captured_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS rap_snapshots_item_idx ON rap_snapshots (item_id, pt, shiny, captured_at)`,
  `CREATE TABLE IF NOT EXISTS app_settings (
    name TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    type TEXT NOT NULL,
    protected INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL DEFAULT (unixepoch()),
    updated_at INTEGER NOT NULL DEFAULT (unixepoch())
  )`,
];

export function ensureSchema(): void {
  const run = sqlite.transaction(() => {
    for (const statement of statements) {
      sqlite.exec(statement);
    }
  });
  run();
}
