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
    collection TEXT NOT NULL REFERENCES collections(name),
    name TEXT NOT NULL,
    "displayName" TEXT,
    description TEXT,
    slug TEXT,
    hidden INTEGER NOT NULL DEFAULT 0,
    shiny INTEGER NOT NULL DEFAULT 0,
    variant INTEGER NOT NULL DEFAULT 0,
    tier INTEGER,
    imageId INTEGER,
    huge INTEGER NOT NULL DEFAULT 0,
    titanic INTEGER NOT NULL DEFAULT 0,
    gargantuan INTEGER NOT NULL DEFAULT 0,
    "createdAt" INTEGER NOT NULL DEFAULT (unixepoch())
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS items_variant_uq ON items (collection, name, variant, shiny)`,
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
  `CREATE TABLE IF NOT EXISTS exists_snapshots (
    id TEXT PRIMARY KEY,
    item_id TEXT NOT NULL REFERENCES items(id),
    item_key TEXT NOT NULL,
    pt INTEGER NOT NULL DEFAULT 0,
    shiny INTEGER NOT NULL DEFAULT 0,
    value INTEGER NOT NULL,
    captured_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS exists_snapshots_item_idx ON exists_snapshots (item_id, pt, shiny, captured_at)`,
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
  const fkWasOn = sqlite.pragma('foreign_keys', { simple: true }) === 1;
  if (fkWasOn) sqlite.pragma('foreign_keys = OFF');
  try {
    const run = sqlite.transaction(() => {
      migrateItemsTable();
      for (const statement of statements) {
        sqlite.exec(statement);
      }
      sqlite.exec('DROP INDEX IF EXISTS items_collection_name_uq');
      sqlite.exec('CREATE INDEX IF NOT EXISTS items_slug_idx ON items (slug)');
    });
    run();
  } finally {
    if (fkWasOn) sqlite.pragma('foreign_keys = ON');
  }
}

function migrateItemsTable(): void {
  const columns = (sqlite.prepare('PRAGMA table_info(items)').all() as { name: string }[]).map(
    (column) => column.name,
  );
  if (columns.length === 0) return;
  if (!columns.includes('name') || columns.includes('config_data')) {
    sqlite.exec('DROP TABLE items');
    return;
  }
  const needsMigration =
    columns.includes('collection_name') ||
    columns.includes('display_name') ||
    columns.includes('modified_at') ||
    !columns.includes('tier') ||
    !columns.includes('imageId') ||
    !columns.includes('description');
  if (!needsMigration) return;

  const pick = (oldName: string, fallbackSql: string): string =>
    columns.includes(oldName) ? `"${oldName}"` : fallbackSql;

  sqlite.exec(`CREATE TABLE items_new (
    id TEXT PRIMARY KEY,
    collection TEXT NOT NULL REFERENCES collections(name),
    name TEXT NOT NULL,
    "displayName" TEXT,
    description TEXT,
    slug TEXT,
    hidden INTEGER NOT NULL DEFAULT 0,
    shiny INTEGER NOT NULL DEFAULT 0,
    variant INTEGER NOT NULL DEFAULT 0,
    tier INTEGER,
    imageId INTEGER,
    huge INTEGER NOT NULL DEFAULT 0,
    titanic INTEGER NOT NULL DEFAULT 0,
    gargantuan INTEGER NOT NULL DEFAULT 0,
    "createdAt" INTEGER NOT NULL DEFAULT (unixepoch())
  )`);
  sqlite.exec(`INSERT INTO items_new (
    id, collection, name, "displayName", description, slug, hidden, shiny, variant, tier, imageId,
    huge, titanic, gargantuan, "createdAt"
  )
  SELECT
    id,
    ${pick('collection', pick('collection_name', "''"))},
    name,
    ${pick('displayName', pick('display_name', 'NULL'))},
    ${pick('description', 'NULL')},
    ${pick('slug', 'NULL')},
    ${pick('hidden', '0')},
    ${pick('shiny', '0')},
    ${pick('variant', '0')},
    ${pick('tier', 'NULL')},
    ${pick('imageId', 'NULL')},
    ${pick('huge', '0')},
    ${pick('titanic', '0')},
    ${pick('gargantuan', '0')},
    ${pick('createdAt', pick('created_at', "(unixepoch())"))}
  FROM items`);
  sqlite.exec('DROP TABLE items');
  sqlite.exec('ALTER TABLE items_new RENAME TO items');
}

