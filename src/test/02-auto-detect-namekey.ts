import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

type ConfigData = Record<string, unknown>;

interface CollectionEntry {
  configName: string;
  configData: ConfigData;
}

const NAME_KEY_PRIORITY = ['name', 'DisplayName', 'Name', 'Title', 'AssociatedItemID'];
const COVERAGE_THRESHOLD = 0.5;

interface DetectionResult {
  collection: string;
  totalItems: number;
  chosenKey: string | null;
  coverage: Record<string, number>;
}

function detectNameKey(entries: CollectionEntry[]): { chosenKey: string | null; coverage: Record<string, number> } {
  const counts: Record<string, number> = {};
  for (const key of NAME_KEY_PRIORITY) counts[key] = 0;

  for (const entry of entries) {
    const cd = entry.configData ?? {};
    for (const key of NAME_KEY_PRIORITY) {
      if (typeof cd[key] === 'string' && (cd[key] as string).length > 0) counts[key] += 1;
    }
  }

  const total = entries.length || 1;
  const coverage: Record<string, number> = {};
  for (const key of NAME_KEY_PRIORITY) coverage[key] = counts[key] / total;

  let bestKey: string | null = null;
  for (const key of NAME_KEY_PRIORITY) {
    if (coverage[key] >= COVERAGE_THRESHOLD) {
      bestKey = key;
      break;
    }
  }
  return { chosenKey: bestKey, coverage };
}

const dataDir = './data/game';
const outDir = './data/test';
mkdirSync(outDir, { recursive: true });

const ENABLED_COLLECTIONS = new Set([
  'Pets', 'Boosts', 'Booths', 'Boxes', 'Charms', 'MiscItems', 'Potions',
  'Seeds', 'Ultimates', 'XPPotions', 'Lootboxes', 'Hoverboards', 'Fruits',
  'CardItems', 'Shovels', 'Sprinklers', 'ZoneFlags',
]);

const results: DetectionResult[] = [];

for (const file of readdirSync(dataDir).filter((f) => f.startsWith('collection-'))) {
  const collection = file.replace('collection-', '').replace('.json', '');
  if (!ENABLED_COLLECTIONS.has(collection)) continue;
  const entries: CollectionEntry[] = JSON.parse(readFileSync(join(dataDir, file), 'utf8')).data ?? [];
  const { chosenKey, coverage } = detectNameKey(entries);
  results.push({ collection, totalItems: entries.length, chosenKey, coverage });
}

results.sort((a, b) => a.collection.localeCompare(b.collection));

writeFileSync(
  join(outDir, 'auto-detected-namekeys.json'),
  JSON.stringify(
    {
      approach: 'auto-detection',
      priorityOrder: NAME_KEY_PRIORITY,
      threshold: COVERAGE_THRESHOLD,
      results,
    },
    null,
    4,
  ),
);

for (const r of results) {
  console.log(`[02] ${r.collection.padEnd(14)} -> ${(r.chosenKey ?? 'configName fallback').padEnd(20)}`);
}
console.log('[02] report ->', join(outDir, 'auto-detected-namekeys.json'));

function esc(s: unknown): string {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

const detectRowsHtml = results
  .map((r) => {
    const covCells = Object.entries(r.coverage)
      .map(([k, v]) => {
        const pct = Math.round(v * 100);
        const cls = pct === 100 ? 'full' : pct >= 50 ? 'half' : pct > 0 ? 'low' : 'zero';
        return `<span class="key ${cls}">${esc(k)} ${pct}%</span>`;
      })
      .join(' ');
    const fallback = r.chosenKey === null;
    return `<tr${fallback ? ' class="warnrow"' : ''}><td class="col">${esc(r.collection)}</td>` +
      `<td class="total">${r.totalItems}</td>` +
      `<td>${fallback ? '<span class="src warn">configName fallback</span>' : `<span class="src ok">${esc(r.chosenKey)}</span>`}</td>` +
      `<td>${covCells || '<span class="none">-</span>'}</td></tr>`;
  })
  .join('\n');

writeFileSync(
  './data/reports/auto-detected-namekeys.html',
  `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Auto-Detected Name Keys</title>
<style>
body{font-family:'Segoe UI',system-ui,sans-serif;margin:2rem;background:#f6f7f9;color:#222}
h1{margin-bottom:.2rem}
.meta{color:#666;margin-bottom:1.5rem}
.kpis{display:flex;gap:1rem;margin:1rem 0;flex-wrap:wrap}
.kpi{background:#fff;border-radius:8px;padding:1rem 1.5rem;box-shadow:0 1px 3px rgba(0,0,0,.08)}
.kpi b{display:block;font-size:1.6rem}.kpi span{color:#666;font-size:.8rem}
table{border-collapse:collapse;width:100%;background:#fff;box-shadow:0 1px 3px rgba(0,0,0,.08);margin-bottom:1rem}
th,td{padding:.45rem .7rem;border-bottom:1px solid #e5e7eb;text-align:left;font-size:.83rem}
th{background:#111827;color:#fff}
tr:hover td{background:#f0f4ff}tr.warnrow td{background:#fff7ed}
td.col{font-weight:600;white-space:nowrap}td.total{text-align:right}
.none{color:#bbb}
.src{padding:1px 8px;border-radius:10px;font-size:.75rem;font-family:Consolas,monospace}
.src.ok{background:#d1fae5}.src.warn{background:#fee2e2}
.key{display:inline-block;padding:1px 7px;margin:1px 2px;border-radius:10px;background:#e5e7eb;font-family:Consolas,monospace;font-size:.75rem}
.key.full{background:#d1fae5}.key.half{background:#fef3c7}.key.low{background:#fee2e2}.key.zero{opacity:.45}
.small{font-size:.8rem;color:#555}
</style>
</head>
<body>
<h1>Auto-Detected Name Keys by Collection</h1>
<p class="meta">Generated ${new Date().toISOString()} from <code>data/test/auto-detected-namekeys.json</code> &middot; priority: ${NAME_KEY_PRIORITY.map(esc).join(' &rarr; ')} &middot; threshold ${Math.round(COVERAGE_THRESHOLD * 100)}%</p>
<div class="kpis">
<div class="kpi"><b>${results.length}</b><span>collections analyzed</span></div>
<div class="kpi"><b>${results.filter((r) => r.chosenKey).length}</b><span>resolved a name key</span></div>
<div class="kpi"><b style="color:#dc2626">${results.filter((r) => !r.chosenKey).length}</b><span>need configName fallback</span></div>
</div>
<p class="small">Orange rows have no candidate key above the coverage threshold.</p>
<table><thead><tr><th>Collection</th><th>Items</th><th>Chosen key</th><th>Coverage per candidate</th></tr></thead>
<tbody>
${detectRowsHtml}
</tbody></table>
</body>
</html>`,
);
console.log('[02] html -> ./data/reports/auto-detected-namekeys.html');
