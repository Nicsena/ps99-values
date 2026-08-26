import { eq, inArray } from 'drizzle-orm';
import { db } from '../client.js';
import { category, collections } from '../schema.js';

export async function listAllCollections(): Promise<{ name: string }[]> {
  return db.select({ name: collections.name }).from(collections);
}

export async function countCollections(): Promise<number> {
  const rows = await listAllCollections();
  return rows.length;
}

export async function upsertCollectionNames(names: string[]): Promise<void> {
  const existing = await listAllCollections();
  const known = new Set(existing.map((row) => row.name));
  const missing = names
    .filter((name) => !known.has(name))
    .map((name) => ({ name, enabled: false }));
  if (missing.length > 0) {
    await db.insert(collections).values(missing).onConflictDoNothing();
  }
}

export async function enableCollection(name: string): Promise<void> {
  await db.update(collections).set({ enabled: true }).where(eq(collections.name, name));
}

// Single bulk statement, so enabling is inherently all-or-nothing.
export async function enableCollections(names: readonly string[]): Promise<void> {
  if (names.length === 0) return;
  await db
    .update(collections)
    .set({ enabled: true })
    .where(inArray(collections.name, [...names]));
}

export async function markSynced(name: string): Promise<void> {
  await db.update(collections).set({ dateSynced: new Date() }).where(eq(collections.name, name));
}

/** Applies singular display names to collections; idempotent. */
export async function setCollectionDisplayNames(
  displayNames: Record<string, string>,
): Promise<void> {
  for (const [name, displayName] of Object.entries(displayNames)) {
    await db.update(collections).set({ displayName }).where(eq(collections.name, name));
  }
}

/** Seeds the singular category rows (name/hidden/createdAt); idempotent. */
export async function seedCategories(names: readonly string[]): Promise<void> {
  if (names.length === 0) return;
  await db
    .insert(category)
    .values(names.map((name) => ({ name })))
    .onConflictDoNothing();
}

/** Applies hidden flags to categories; only touches the provided names. */
export async function setCategoryHidden(flags: Map<string, boolean>): Promise<void> {
  for (const [name, hidden] of flags) {
    await db.update(category).set({ hidden }).where(eq(category.name, name));
  }
}

export async function getEnabledCollections(): Promise<{ name: string }[]> {
  return db
    .select({ name: collections.name })
    .from(collections)
    .where(eq(collections.enabled, true));
}
