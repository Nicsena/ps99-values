import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const BASE_URL = 'https://ps99.biggamesapi.io';
const OUT_DIR = './.local/game';
const REQUEST_INTERVAL_MS = 1000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchJson<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, { signal: AbortSignal.timeout(15000) });
  if (!res.ok) {
    throw new Error(`GET ${path} failed with HTTP ${res.status}`);
  }
  const body = (await res.json()) as { status?: string; data?: T };
  if (body.status !== 'ok' || body.data === undefined) {
    throw new Error(`GET ${path} reported error status: ${String(body.status)}`);
  }
  return body.data;
}

async function main(): Promise<void> {
  mkdirSync(OUT_DIR, { recursive: true });

  console.log('[00] fetching collection list…');
  const allCollections = await fetchJson<string[]>('/api/collections');
  console.log(`[00] api reports ${allCollections.length} collections total`);

  let saved = 0;
  let failed = 0;
  for (const name of allCollections) {
    try {
      const entries = await fetchJson<unknown[]>(`/api/collection/${encodeURIComponent(name)}`);
      const file = join(OUT_DIR, `collection-${name}.json`);
      writeFileSync(file, JSON.stringify(entries, null, 2));
      saved += 1;
      console.log(`[00] saved ${entries.length} entries -> ${file}`);
    } catch (err) {
      failed += 1;
      console.error(`[00] failed to fetch ${name}:`, err instanceof Error ? err.message : err);
    }
    await sleep(REQUEST_INTERVAL_MS);
  }

  console.log(`[00] done: ${saved} saved, ${failed} failed -> ${OUT_DIR}`);
  if (failed > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error('[00] fatal:', err);
  process.exit(1);
});
