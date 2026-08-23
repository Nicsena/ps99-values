import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

interface SpecItem {
  collectionName: string;
  configName: string;
  name: string;
  nameSource: string;
}

interface MarketEntry {
  category: string;
  value: number;
  configData: { id?: unknown; [k: string]: unknown };
}

interface CollectionStat {
  collection: string;
  items: number;
  itemsWithRap: number;
  itemsWithExists: number;
  rapVariantRows: number;
  existsVariantRows: number;
  coveragePct: number;
}

const dataDir = './.local/game';
const testDir = './.local/test/data';
mkdirSync('./.local/reports', { recursive: true });
const reportPath = './.local/reports/spec-driven-items-rap-exists.html';
mkdirSync(testDir, { recursive: true });

const specItems: { items: SpecItem[] } = JSON.parse(
  readFileSync('./.local/test/data/spec-driven-items.json', 'utf8'),
);

const rapEntries: MarketEntry[] = JSON.parse(readFileSync(join(dataDir, 'rap.json'), 'utf8')) ?? [];
const existsEntries: MarketEntry[] = JSON.parse(readFileSync(join(dataDir, 'exists.json'), 'utf8')) ?? [];

const itemsByCollection = new Map<string, SpecItem[]>();
for (const item of specItems.items) {
  const list = itemsByCollection.get(item.collectionName) ?? [];
  list.push(item);
  itemsByCollection.set(item.collectionName, list);
}

function marketIndex(entries: MarketEntry[]) {
  const byId = new Map<string, MarketEntry[]>();
  for (const e of entries) {
    if (typeof e.configData?.id !== 'string') continue;
    const list = byId.get(e.configData.id) ?? [];
    list.push(e);
    byId.set(e.configData.id, list);
  }
  return byId;
}

const rapById = marketIndex(rapEntries);
const existsById = marketIndex(existsEntries);

const allNames = new Set<string>();
for (const item of specItems.items) allNames.add(item.name);

const stats: CollectionStat[] = [];
for (const [collection, items] of [...itemsByCollection.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
  let itemsWithRap = 0;
  let itemsWithExists = 0;
  let rapRows = 0;
  let existsRows = 0;
  for (const item of items) {
    const r = rapById.get(item.name) ?? [];
    const e = existsById.get(item.name) ?? [];
    if (r.length > 0) itemsWithRap += 1;
    if (e.length > 0) itemsWithExists += 1;
    rapRows += r.length;
    existsRows += e.length;
  }
  stats.push({
    collection,
    items: items.length,
    itemsWithRap,
    itemsWithExists,
    rapVariantRows: rapRows,
    existsVariantRows: existsRows,
    coveragePct: items.length ? Math.round((100 * itemsWithRap) / items.length) : 0,
  });
}

const unmatchedRap = new Map<string, { category: string; count: number }>();
for (const [id, entries] of rapById) {
  if (!allNames.has(id)) {
    unmatchedRap.set(id, { category: entries[0]?.category ?? '?', count: entries.length });
  }
}
const unmatchedExists = new Map<string, { category: string; count: number }>();
for (const [id, entries] of existsById) {
  if (!allNames.has(id)) {
    unmatchedExists.set(id, { category: entries[0]?.category ?? '?', count: entries.length });
  }
}

const nameCounts = new Map<string, Set<string>>();
for (const item of specItems.items) {
  const set = nameCounts.get(item.name) ?? new Set<string>();
  set.add(item.collectionName);
  nameCounts.set(item.name, set);
}
const collisions = [...nameCounts.entries()]
  .filter(([, cols]) => cols.size > 1)
  .map(([name, cols]) => ({ name, collections: [...cols].sort() }));

const result = {
  approach: 'name matching: spec-driven items vs rap + exists',
  totals: {
    items: specItems.items.length,
    itemsWithRap: stats.reduce((a, s) => a + s.itemsWithRap, 0),
    itemsWithExists: stats.reduce((a, s) => a + s.itemsWithExists, 0),
    rapEntriesTotal: rapEntries.length,
    existsEntriesTotal: existsEntries.length,
    unmatchedRapIds: unmatchedRap.size,
    unmatchedExistsIds: unmatchedExists.size,
    crossCollectionNameCollisions: collisions.length,
  },
  perCollection: stats,
  unmatchedRap: [...unmatchedRap.entries()]
    .map(([id, v]) => ({ id, ...v }))
    .sort((a, b) => b.count - a.count || a.id.localeCompare(b.id)),
  unmatchedExists: [...unmatchedExists.entries()]
    .map(([id, v]) => ({ id, ...v }))
    .sort((a, b) => b.count - a.count || a.id.localeCompare(b.id)),
  collisions,
};

writeFileSync(join(testDir, 'spec-driven-items-rap-exists.json'), JSON.stringify(result, null, 4));

function esc(s: unknown): string {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

const statRows = stats
  .map(
    (s) =>
      `<tr><td class="col">${esc(s.collection)}</td><td class="total">${s.items}</td>` +
      `<td class="total">${s.itemsWithRap}</td><td class="total">${s.itemsWithExists}</td>` +
      `<td><div class="bar"><div class="fill" style="width:${s.coveragePct}%"></div></div><span class="pct">${s.coveragePct}%</span></td></tr>`,
  )
  .join('\n');

function unmatchedTable(rows: { id: string; category: string; count: number }[], limit: number): string {
  return rows
    .slice(0, limit)
    .map(
      (r) =>
        `<tr><td>${esc(r.id)}</td><td>${esc(r.category)}</td><td class="total">${r.count}</td></tr>`,
    )
    .join('\n');
}

const collisionRows = collisions
  .map(
    (c) =>
      `<tr><td>${esc(c.name)}</td><td>${c.collections.map(esc).join(', ')}</td></tr>`,
  )
  .join('\n');

const t = result.totals;
const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Spec Items vs RAP &amp; Exists</title>
<style>
body{font-family:'Segoe UI',system-ui,sans-serif;margin:2rem;background:#f6f7f9;color:#222}
h1{margin-bottom:.2rem}h2{margin-top:2rem;border-bottom:2px solid #111827;padding-bottom:.3rem}
.meta{color:#666;margin-bottom:1.5rem}
.kpis{display:flex;gap:1rem;margin:1rem 0;flex-wrap:wrap}
.kpi{background:#fff;border-radius:8px;padding:1rem 1.5rem;box-shadow:0 1px 3px rgba(0,0,0,.08)}
.kpi b{display:block;font-size:1.6rem}.kpi span{color:#666;font-size:.8rem}
table{border-collapse:collapse;width:100%;background:#fff;box-shadow:0 1px 3px rgba(0,0,0,.08);margin-bottom:1rem}
th,td{padding:.45rem .7rem;border-bottom:1px solid #e5e7eb;text-align:left;font-size:.83rem}
th{background:#111827;color:#fff}
tr:hover td{background:#f0f4ff}
td.col{font-weight:600;white-space:nowrap}td.total{text-align:right}
.bar{display:inline-block;width:120px;height:8px;background:#e5e7eb;border-radius:4px;vertical-align:middle;margin-right:6px}
.fill{height:100%;background:#10b981;border-radius:4px}
.pct{font-size:.78rem;color:#555}
.small{font-size:.8rem;color:#666}
</style>
</head>
<body>
<h1>Spec-Driven Item Names vs RAP &amp; Exists Entries</h1>
<p class="meta">Generated ${new Date().toISOString()} from <code>.local/test/data/spec-driven-items.json</code>, <code>rap.json</code>, <code>exists.json</code></p>

<div class="kpis">
<div class="kpi"><b>${t.items.toLocaleString()}</b><span>spec-resolved items</span></div>
<div class="kpi"><b>${t.itemsWithRap.toLocaleString()}</b><span>matched in rap</span></div>
<div class="kpi"><b>${t.itemsWithExists.toLocaleString()}</b><span>matched in exists</span></div>
<div class="kpi"><b style="color:#dc2626">${t.unmatchedRapIds.toLocaleString()}</b><span>rap ids unmatched</span></div>
<div class="kpi"><b style="color:#dc2626">${t.unmatchedExistsIds.toLocaleString()}</b><span>exists ids unmatched</span></div>
<div class="kpi"><b style="color:${t.crossCollectionNameCollisions ? '#d97706' : '#10b981'}">${t.crossCollectionNameCollisions}</b><span>cross-collection name collisions</span></div>
</div>

<h2>Per-collection match coverage</h2>
<table>
<thead><tr><th>Collection</th><th>Items</th><th>With RAP</th><th>With Exists</th><th>RAP coverage</th></tr></thead>
<tbody>
${statRows}
</tbody>
</table>

<h2>Unmatched RAP ids (first 25 of ${t.unmatchedRapIds})</h2>
<p class="small">Expected: mostly disabled collections (Pets excluded eggs etc.). Unexpected ones may indicate renamed items.</p>
<table>
<thead><tr><th>configData.id</th><th>Category</th><th>Variants</th></tr></thead>
<tbody>
${unmatchedTable(result.unmatchedRap, 25)}
</tbody>
</table>

<h2>Unmatched Exists ids (first 25 of ${t.unmatchedExistsIds})</h2>
<table>
<thead><tr><th>configData.id</th><th>Category</th><th>Variants</th></tr></thead>
<tbody>
${unmatchedTable(result.unmatchedExists, 25)}
</tbody>
</table>

<h2>Cross-collection name collisions (${collisions.length})</h2>
<table>
<thead><tr><th>Name</th><th>Collections</th></tr></thead>
<tbody>
${collisionRows}
</tbody>
</table>
</body>
</html>`;

writeFileSync(reportPath, html);

console.log('[05] json ->', join(testDir, 'spec-driven-items-rap-exists.json'));
console.log('[05] html ->', reportPath);
console.log('[05] rap matched:', t.itemsWithRap, '/', t.items, '| exists matched:', t.itemsWithExists, '| collisions:', t.crossCollectionNameCollisions);
