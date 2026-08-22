import { sqliteTable, text, integer, index, uniqueIndex } from 'drizzle-orm/sqlite-core';

export const collections = sqliteTable('collections', {
  name: text('name').primaryKey(),
  enabled: integer('enabled', { mode: 'boolean' }).notNull().default(false),
  dateSynced: integer('date_synced', { mode: 'timestamp' }),
});

export const items = sqliteTable(
  'items',
  {
    id: text('id').primaryKey(),
    collectionName: text('collection_name')
      .notNull()
      .references(() => collections.name),
    name: text('name').notNull(),
    slug: text('slug'),
    description: text('description'),
    category: text('category'),
    configData: text('config_data'),
    dateSynced: integer('date_synced', { mode: 'timestamp' })
      .notNull()
      .$defaultFn(() => new Date())
      .$onUpdateFn(() => new Date()),
  },
  (t) => [
    uniqueIndex('items_collection_name_uq').on(t.collectionName, t.name),
    index('items_slug_idx').on(t.slug),
  ],
);

export const rapSnapshots = sqliteTable(
  'rap_snapshots',
  {
    id: text('id').primaryKey(),
    itemId: text('item_id')
      .notNull()
      .references(() => items.id),
    itemKey: text('item_key').notNull(),
    pt: integer('pt').notNull().default(0),
    shiny: integer('shiny', { mode: 'boolean' }).notNull().default(false),
    value: integer('value').notNull(),
    capturedAt: integer('captured_at', { mode: 'timestamp' }).notNull(),
  },
  (t) => [index('rap_snapshots_item_idx').on(t.itemId, t.pt, t.shiny, t.capturedAt)],
);

export const existsSnapshots = sqliteTable(
  'exists_snapshots',
  {
    id: text('id').primaryKey(),
    itemId: text('item_id')
      .notNull()
      .references(() => items.id),
    itemKey: text('item_key').notNull(),
    pt: integer('pt').notNull().default(0),
    shiny: integer('shiny', { mode: 'boolean' }).notNull().default(false),
    value: integer('value').notNull(),
    capturedAt: integer('captured_at', { mode: 'timestamp' }).notNull(),
  },
  (t) => [index('exists_snapshots_item_idx').on(t.itemId, t.pt, t.shiny, t.capturedAt)],
);

export type Collection = typeof collections.$inferSelect;
export type NewCollection = typeof collections.$inferInsert;
export type Item = typeof items.$inferSelect;
export type NewItem = typeof items.$inferInsert;
export type RapSnapshot = typeof rapSnapshots.$inferSelect;
export type NewRapSnapshot = typeof rapSnapshots.$inferInsert;
export type ExistsSnapshot = typeof existsSnapshots.$inferSelect;
export type NewExistsSnapshot = typeof existsSnapshots.$inferInsert;
