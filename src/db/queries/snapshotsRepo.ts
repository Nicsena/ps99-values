import { lt, sql } from 'drizzle-orm';
import { db } from '../client.js';
import { snapshots } from '../schema.js';

export type Metric = 'rap' | 'exists';

export type LatestValues = Map<number, number>;

export interface SnapshotInsert {
  itemId: number;
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

// Deterministic latest-per-item via ROW_NUMBER; no bare-column MAX() ties.
export async function getLatestValues(metric: Metric): Promise<LatestValues> {
  const rows = (await db.all<{ item_id: number; value: number }>(
    sql`SELECT item_id, value FROM (
          SELECT item_id, value,
            ROW_NUMBER() OVER (PARTITION BY item_id ORDER BY captured_at DESC) AS rn
          FROM snapshots WHERE metric = ${metric}
        ) WHERE rn = 1`,
  )) as { item_id: number; value: number }[];
  return new Map(rows.map((r) => [r.item_id, r.value]));
}

// Batch insert; each chunk is a single multi-row INSERT.
// Timestamps are stored at second precision, so two syncs within the same
// second target the same point; those conflicts take the newer value rather
// than dropping it. Returns the number of rows written.
// Note: better-sqlite3 rejects promise-returning transaction callbacks, so
// chunks are not wrapped in one cross-chunk transaction.
export async function insertSnapshots(
  metric: Metric,
  rows: SnapshotInsert[],
): Promise<number> {
  if (rows.length === 0) return 0;
  let written = 0;
  for (const batch of chunk(rows, 250)) {
    const result = await db
      .insert(snapshots)
      .values(batch.map((row) => ({ ...row, metric })))
      .onConflictDoUpdate({
        target: [snapshots.itemId, snapshots.metric, snapshots.capturedAt],
        set: { value: sql`excluded.value` },
      })
      .returning({ id: snapshots.id });
    written += result.length;
  }
  return written;
}

export async function loadHistory(
  itemId: number | null | undefined,
  metric: Metric,
  limit = 200,
): Promise<HistoryRawPoint[]> {
  if (!itemId) return [];
  return (await db.all<HistoryRawPoint>(
    sql`SELECT captured_at, value FROM (
          SELECT captured_at, value FROM snapshots
          WHERE item_id = ${itemId} AND metric = ${metric}
          ORDER BY captured_at DESC LIMIT ${limit}
        ) ORDER BY captured_at ASC`,
  )) as HistoryRawPoint[];
}

export async function countSnapshots(
  itemId: number | null | undefined,
  metric: Metric,
): Promise<number> {
  if (!itemId) return 0;
  const rows = (await db.all<{ total: number }>(
    sql`SELECT COUNT(*) AS total FROM snapshots
        WHERE item_id = ${itemId} AND metric = ${metric}`,
  )) as { total: number }[];
  return rows[0]?.total ?? 0;
}

export async function pruneSnapshotsOlderThan(cutoffDate: Date): Promise<number> {
  const result = await db.delete(snapshots).where(lt(snapshots.capturedAt, cutoffDate));
  return result.changes;
}
