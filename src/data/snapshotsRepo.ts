import { lt, sql } from 'drizzle-orm';
import { db } from '../db/client.js';
import { existsSnapshots, rapSnapshots } from '../db/schema.js';

export interface LatestRapValueRow {
  item_id: string;
  pt: number;
  shiny: number;
  value: number;
}

export type LatestRapValues = Map<string, number>;

export interface RapSnapshotInsert {
  id: string;
  itemId: string;
  itemKey: string;
  pt: number;
  shiny: boolean;
  value: number;
  capturedAt: Date;
}

export interface HistoryRawPoint {
  captured_at: number;
  value: number;
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

export async function getLatestRapValues(): Promise<LatestRapValues> {
  const latestRows = (await db.all<LatestRapValueRow>(
    sql`SELECT item_id, pt, shiny, value FROM rap_snapshots GROUP BY item_id, pt, shiny HAVING captured_at = MAX(captured_at)`,
  )) as LatestRapValueRow[];
  return new Map(
    latestRows.map((r) => [`${r.item_id}:${r.pt}:${Number(r.shiny)}`, r.value]),
  );
}

export async function insertRapSnapshots(rows: RapSnapshotInsert[]): Promise<void> {
  if (rows.length === 0) return;
  for (const batch of chunk(rows, 500)) {
    await db.insert(rapSnapshots).values(batch);
  }
}

export async function getLatestExistsValues(): Promise<LatestRapValues> {
  const latestRows = (await db.all<LatestRapValueRow>(
    sql`SELECT item_id, pt, shiny, value FROM exists_snapshots GROUP BY item_id, pt, shiny HAVING captured_at = MAX(captured_at)`,
  )) as LatestRapValueRow[];
  return new Map(
    latestRows.map((r) => [`${r.item_id}:${r.pt}:${Number(r.shiny)}`, r.value]),
  );
}

export async function insertExistsSnapshots(rows: RapSnapshotInsert[]): Promise<void> {
  if (rows.length === 0) return;
  for (const batch of chunk(rows, 500)) {
    await db.insert(existsSnapshots).values(batch);
  }
}

export async function loadHistory(
  itemId: string,
  pt: number,
  shinyInt: number,
  limit = 200,
): Promise<HistoryRawPoint[]> {
  return (await db.all<HistoryRawPoint>(
    sql`SELECT captured_at, value FROM (
          SELECT captured_at, value FROM rap_snapshots
          WHERE item_id = ${itemId} AND pt = ${pt} AND shiny = ${shinyInt}
          ORDER BY captured_at DESC LIMIT ${limit}
        ) ORDER BY captured_at ASC`,
  )) as HistoryRawPoint[];
}

export async function loadExistsHistory(
  itemId: string,
  pt: number,
  shinyInt: number,
  limit = 200,
): Promise<HistoryRawPoint[]> {
  return (await db.all<HistoryRawPoint>(
    sql`SELECT captured_at, value FROM (
          SELECT captured_at, value FROM exists_snapshots
          WHERE item_id = ${itemId} AND pt = ${pt} AND shiny = ${shinyInt}
          ORDER BY captured_at DESC LIMIT ${limit}
        ) ORDER BY captured_at ASC`,
  )) as HistoryRawPoint[];
}

export async function countRapSnapshots(
  itemId: string,
  pt: number,
  shinyInt: number,
): Promise<number> {
  const rows = (await db.all<{ total: number }>(
    sql`SELECT COUNT(*) AS total FROM rap_snapshots
        WHERE item_id = ${itemId} AND pt = ${pt} AND shiny = ${shinyInt}`,
  )) as { total: number }[];
  return rows[0]?.total ?? 0;
}

export async function countExistsSnapshots(
  itemId: string,
  pt: number,
  shinyInt: number,
): Promise<number> {
  const rows = (await db.all<{ total: number }>(
    sql`SELECT COUNT(*) AS total FROM exists_snapshots
        WHERE item_id = ${itemId} AND pt = ${pt} AND shiny = ${shinyInt}`,
  )) as { total: number }[];
  return rows[0]?.total ?? 0;
}

export async function pruneSnapshotsOlderThan(cutoffDate: Date): Promise<number> {
  const rapResult = await db.delete(rapSnapshots).where(lt(rapSnapshots.capturedAt, cutoffDate));
  const existsResult = await db
    .delete(existsSnapshots)
    .where(lt(existsSnapshots.capturedAt, cutoffDate));
  return rapResult.changes + existsResult.changes;
}
