import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

type ConfigData = Record<string, unknown>;

interface RapEntry {
  category: string;
  value: number;
  configData: ConfigData;
}

interface VariantRow {
  kind: 'rap' | 'exists';
  itemName: string;
  variantKey: string;
  pt: number;
  shiny: boolean;
  label: string | null;
  value: number;
}

function variantKey(cd: ConfigData): string {
  const parts = Object.entries(cd)
    .filter(([k]) => k !== 'id')
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${String(v)}`);
  return parts.length > 0 ? parts.join(';') : 'base';
}

function parseVariant(cd: ConfigData): { pt: number; shiny: boolean; label: string | null } {
  const pt = typeof cd.pt === 'number' ? cd.pt : 0;
  const shiny = cd.sh === true || cd.sh === 1;
  let label: string | null = null;
  if (typeof cd.vr === 'string') label = cd.vr;
  else if (typeof cd.cv === 'number') label = `Chroma #${cd.cv}`;
  else if (typeof cd.tn === 'number') label = `Tier ${cd.tn}`;
  return { pt, shiny, label };
}

const dataDir = './data/game';
const outDir = './data/test';
mkdirSync(outDir, { recursive: true });

import ENABLED_COLLECTIONS from "./enabled_collections.js"
const enabledCollections = new Set(ENABLED_COLLECTIONS);

const knownNames = new Set<string>();
for (const col of enabledCollections) {
  const entries: { configData?: ConfigData }[] =
    JSON.parse(readFileSync(join(dataDir, `collection-${col}.json`), 'utf8')).data ?? [];
  for (const e of entries) {
    const name = e.configData?.name;
    if (typeof name === 'string') knownNames.add(name);
    if (typeof e.configData?.DisplayName === 'string') knownNames.add(e.configData.DisplayName);
  }
}

const rows: VariantRow[] = [];
let unmatched = 0;

for (const kind of ['rap', 'exists'] as const) {
  const entries: RapEntry[] = JSON.parse(readFileSync(join(dataDir, `${kind}.json`), 'utf8')).data ?? [];
  for (const entry of entries) {
    const id = entry.configData?.id;
    if (typeof id !== 'string') continue;
    if (!knownNames.has(id)) {
      unmatched += 1;
      continue;
    }
    const { pt, shiny, label } = parseVariant(entry.configData);
    rows.push({
      kind,
      itemName: id,
      variantKey: variantKey(entry.configData),
      pt,
      shiny,
      label,
      value: entry.value,
    });
  }
}

const keyCounts: Record<string, number> = {};
for (const row of rows) keyCounts[row.variantKey] = (keyCounts[row.variantKey] ?? 0) + 1;
const topKeys = Object.entries(keyCounts).sort((a, b) => b[1] - a[1]).slice(0, 15);

writeFileSync(
  join(outDir, 'variant-keys.json'),
  JSON.stringify(
    {
      approach: 'variant-key derivation',
      matchedRows: rows.length,
      unmatchedEntries: unmatched,
      distinctVariantKeys: Object.keys(keyCounts).length,
      topVariantKeys: topKeys.map(([key, count]) => ({ key, count })),
      sampleRows: rows.filter((r) => r.label !== null).slice(0, 20),
    },
    null,
    4,
  ),
);

console.log('[03] matched:', rows.length, '| unmatched:', unmatched);
console.log('[03] distinct variant keys:', Object.keys(keyCounts).length);
console.log('[03] report ->', join(outDir, 'variant-keys.json'));

function esc(s: unknown): string {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

const topKeysHtml = topKeys
  .map(([key, count]) => `<tr><td class="mono">${esc(key)}</td><td class="total">${count.toLocaleString()}</td></tr>`)
  .join('\n');

const labelSamplesHtml = rows
  .filter((r) => r.label !== null)
  .slice(0, 12)
  .map(
    (r) =>
      `<tr><td><span class="src ok">${esc(r.kind)}</span></td><td>${esc(r.itemName)}</td><td class="mono">${esc(r.variantKey)}</td>` +
      `<td>${r.label ? esc(r.label) : '<span class="none">-</span>'}</td>` +
      `<td class="total">${r.value.toLocaleString()}</td></tr>`,
  )
  .join('\n');

writeFileSync(
  './data/reports/variant-keys.html',
  `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Variant Key Derivation</title>
<style>
body{font-family:'Segoe UI',system-ui,sans-serif;margin:2rem;background:#f6f7f9;color:#222}
h1{margin-bottom:.2rem}h2{margin-top:2rem}
.meta{color:#666;margin-bottom:1.5rem}
.kpis{display:flex;gap:1rem;margin:1rem 0;flex-wrap:wrap}
.kpi{background:#fff;border-radius:8px;padding:1rem 1.5rem;box-shadow:0 1px 3px rgba(0,0,0,.08)}
.kpi b{display:block;font-size:1.6rem}.kpi span{color:#666;font-size:.8rem}
table{border-collapse:collapse;width:100%;background:#fff;box-shadow:0 1px 3px rgba(0,0,0,.08);margin-bottom:1rem}
th,td{padding:.45rem .7rem;border-bottom:1px solid #e5e7eb;text-align:left;font-size:.83rem}
th{background:#111827;color:#fff}
tr:hover td{background:#f0f4ff}
td.total{text-align:right}
.mono{font-family:Consolas,monospace;font-size:.78rem}
.none{color:#bbb}
.src{padding:1px 8px;border-radius:10px;font-size:.75rem;font-family:Consolas,monospace}
.src.ok{background:#d1fae5}
</style>
</head>
<body>
<h1>Variant Key Derivation (rap + exists)</h1>
<p class="meta">Generated ${new Date().toISOString()} from <code>data/game/rap.json</code> and <code>data/game/exists.json</code></p>
<div class="kpis">
<div class="kpi"><b>${rows.length.toLocaleString()}</b><span>matched variant rows</span></div>
<div class="kpi"><b style="color:#dc2626">${unmatched.toLocaleString()}</b><span>unmatched entries (disabled collections)</span></div>
<div class="kpi"><b>${Object.keys(keyCounts).length}</b><span>distinct variant keys</span></div>
</div>
<h2>Top ${topKeys.length} most common variant keys</h2>
<table><thead><tr><th>Variant key</th><th>Rows</th></tr></thead><tbody>
${topKeysHtml}
</tbody></table>
<h2>Sample labeled variants (cv / vr / tn dimensions)</h2>
<table><thead><tr><th>Kind</th><th>Item</th><th>Variant key</th><th>Label</th><th>Value</th></tr></thead><tbody>
${labelSamplesHtml}
</tbody></table>
</body>
</html>`,
);
console.log('[03] html -> ./data/reports/variant-keys.html');
