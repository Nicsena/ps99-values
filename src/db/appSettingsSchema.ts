import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';

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

export type AppSetting = typeof appSettings.$inferSelect;
export type NewAppSetting = typeof appSettings.$inferInsert;
