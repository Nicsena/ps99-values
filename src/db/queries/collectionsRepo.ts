import { eq } from 'drizzle-orm';
import { db } from '../client.js';
import { collections } from '../schema.js';

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
  const missing = names.filter((name) => !known.has(name)).map((name) => ({ name, enabled: false }));
  if (missing.length > 0) {
    await db.insert(collections).values(missing).onConflictDoNothing();
  }
}

export async function enableCollection(name: string): Promise<void> {
  await db.update(collections).set({ enabled: true }).where(eq(collections.name, name));
}

export async function enableCollections(names: readonly string[]): Promise<void> {
  for (const name of names) {
    await db.update(collections).set({ enabled: true }).where(eq(collections.name, name));
  }
}

export async function markSynced(name: string): Promise<void> {
  await db.update(collections).set({ dateSynced: new Date() }).where(eq(collections.name, name));
}

export async function getEnabledCollections(): Promise<{ name: string }[]> {
  return db
    .select({ name: collections.name })
    .from(collections)
    .where(eq(collections.enabled, true));
}
