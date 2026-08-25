import { sqliteTable, text, integer, uniqueIndex } from 'drizzle-orm/sqlite-core';

export const collections = sqliteTable('collections', {
  name: text('name').primaryKey(),
  enabled: integer('enabled', { mode: 'boolean' }).notNull().default(false),
  dateSynced: integer('date_synced', { mode: 'timestamp' }),
});

// One row per variant of an upstream item. Variant dimensions live directly on
// the row so every addressable variant has its own identity and slug.
export const items = sqliteTable(
  'items',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    collectionName: text('collection')
      .notNull()
      .references(() => collections.name),
    name: text('name').notNull(),
    displayName: text('displayName'),
    description: text('description'),
    // Canonical slug, stored lowercase at write time so lookups can use exact
    // indexed matches instead of LOWER() scans. Nullable: chroma/tier-only
    // variants are not URL-addressable yet (slugs deferred).
    slug: text('slug'),
    // JSON array [{id, name, chance}] from upstream animations.colorVariants;
    // maps chroma levels (cv) to color names. NULL for non-chroma items.
    colorVariants: text('colorVariants'),
    hidden: integer('hidden', { mode: 'boolean' }).notNull().default(false),
    imageId: integer('imageId'),
    huge: integer('huge', { mode: 'boolean' }).notNull().default(false),
    titanic: integer('titanic', { mode: 'boolean' }).notNull().default(false),
    gargantuan: integer('gargantuan', { mode: 'boolean' }).notNull().default(false),
    // Variant dimensions (upstream pt / sh / cv / tn). tier uses a 0 sentinel
    // instead of NULL because SQLite treats NULLs as distinct in unique indexes.
    variant: integer('variant').notNull().default(0),
    shiny: integer('shiny', { mode: 'boolean' }).notNull().default(false),
    chroma: integer('chroma').notNull().default(0),
    tier: integer('tier').notNull().default(0),
    createdAt: integer('createdAt', { mode: 'timestamp' })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [
    uniqueIndex('items_identity_uq').on(
      t.collectionName,
      t.name,
      t.variant,
      t.shiny,
      t.chroma,
      t.tier,
    ),
    uniqueIndex('items_slug_uq').on(t.slug),
  ],
);

// Merged market snapshots for both metrics, keyed directly to items rows. The
// unique index makes duplicate (item, metric, timestamp) rows structurally
// impossible and serves as the covering index for latest/history/prune queries.
export const snapshots = sqliteTable(
  'snapshots',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    itemId: integer('item_id')
      .notNull()
      .references(() => items.id, { onDelete: 'cascade' }),
    metric: text('metric', { enum: ['rap', 'exists'] }).notNull(),
    value: integer('value').notNull(),
    capturedAt: integer('captured_at', { mode: 'timestamp' }).notNull(),
  },
  (t) => [uniqueIndex('snapshots_unique_idx').on(t.itemId, t.metric, t.capturedAt)],
);

export const appSettings = sqliteTable('app_settings', {
  name: text('name').primaryKey(),
  value: text('value').notNull(),
  type: text('type').notNull().$type<'string' | 'number' | 'boolean' | 'json'>(),
  protected: integer('protected', { mode: 'boolean' }).notNull().default(false),
  createdAt: integer('created_at', { mode: 'timestamp' })
    .notNull()
    .$defaultFn(() => new Date()),
  updatedAt: integer('updated_at', { mode: 'timestamp' })
    .notNull()
    .$defaultFn(() => new Date())
    .$onUpdateFn(() => new Date()),
});

export type Collection = typeof collections.$inferSelect;
export type NewCollection = typeof collections.$inferInsert;
export type Item = typeof items.$inferSelect;
export type NewItem = typeof items.$inferInsert;
export type Snapshot = typeof snapshots.$inferSelect;
export type NewSnapshot = typeof snapshots.$inferInsert;
export type AppSetting = typeof appSettings.$inferSelect;
export type NewAppSetting = typeof appSettings.$inferInsert;
