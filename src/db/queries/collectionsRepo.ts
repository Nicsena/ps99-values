import { eq, inArray } from 'drizzle-orm';
import { db } from '../client.js';
import { category, collections } from '../schema.js';
import { createLogger } from '../../logger.js';

const log = createLogger({ namespace: 'db.collections' });

export async function listAllCollections(): Promise<{ name: string }[]> {
  return log.timerFn('list all collections', async () => {
    return db.select({ name: collections.name }).from(collections);
  }, 'debug');
}

export async function countCollections(): Promise<number> {
  return log.timerFn('count collections', async () => {
    const rows = await listAllCollections();
    return rows.length;
  }, 'debug');
}

export async function upsertCollectionNames(names: string[]): Promise<void> {
  await log.timerFn(`upsert collection names (${names.length})`, async () => {
    const existing = await listAllCollections();
    const known = new Set(existing.map((row) => row.name));
    const missing = names
      .filter((name) => !known.has(name))
      .map((name) => ({ name, enabled: false }));
    if (missing.length > 0) {
      await db.insert(collections).values(missing).onConflictDoNothing();
    }
  }, 'debug');
}

export async function enableCollection(name: string): Promise<void> {
  await log.timerFn(`enable collection ${name}`, async () => {
    await db.update(collections).set({ enabled: true }).where(eq(collections.name, name));
  }, 'debug');
}

// Single bulk statement, so enabling is inherently all-or-nothing.
export async function enableCollections(names: readonly string[]): Promise<void> {
  await log.timerFn(`enable collections (${names.length})`, async () => {
    if (names.length === 0) return;
    await db
      .update(collections)
      .set({ enabled: true })
      .where(inArray(collections.name, [...names]));
  }, 'debug');
}

export async function markSynced(name: string): Promise<void> {
  await log.timerFn(`mark synced ${name}`, async () => {
    await db.update(collections).set({ dateSynced: new Date() }).where(eq(collections.name, name));
  }, 'debug');
}

/** Applies singular display names to collections; idempotent. */
export async function setCollectionDisplayNames(
  displayNames: Record<string, string>,
): Promise<void> {
  const count = Object.keys(displayNames).length;
  await log.timerFn(`set collection display names (${count})`, async () => {
    for (const [name, displayName] of Object.entries(displayNames)) {
      await db.update(collections).set({ displayName }).where(eq(collections.name, name));
    }
  }, 'debug');
}

/** Seeds the singular category rows (name/hidden/createdAt); idempotent. */
export async function seedCategories(names: readonly string[]): Promise<void> {
  await log.timerFn(`seed categories (${names.length})`, async () => {
    if (names.length === 0) return;
    await db
      .insert(category)
      .values(names.map((name) => ({ name })))
      .onConflictDoNothing();
  }, 'debug');
}

/** Applies hidden flags to categories; only touches the provided names. */
export async function setCategoryHidden(flags: Map<string, boolean>): Promise<void> {
  await log.timerFn(`set category hidden (${flags.size})`, async () => {
    for (const [name, hidden] of flags) {
      await db.update(category).set({ hidden }).where(eq(category.name, name));
    }
  }, 'debug');
}

export async function getEnabledCollections(): Promise<{ name: string }[]> {
  return log.timerFn('get enabled collections', async () => {
    return db
      .select({ name: collections.name })
      .from(collections)
      .where(eq(collections.enabled, true));
  }, 'debug');
}
