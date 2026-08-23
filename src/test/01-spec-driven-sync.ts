import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

type ConfigData = Record<string, unknown>;

interface CollectionEntry {
  configName: string;
  category: string;
  configData: ConfigData;
}

interface ItemDraft {
  collectionName: string;
  configName: string;
  name: string;
  nameSource: string;
  description: string | null;
  thumbnail: string | null;
}

interface CollectionSpec {
  nameKeys?: string[];
  descKey?: string | null;
  thumbKeys?: string[];
}

const DEFAULT_SPEC: Required<Pick<CollectionSpec, 'nameKeys' | 'thumbKeys'>> & {
  descKey?: string | null;
} = {
  nameKeys: ['DisplayName', 'Name', 'name', 'Title'],
  thumbKeys: ['Icon', 'icon', 'thumbnail'],
};

const SPECS: Record<string, CollectionSpec> = {
  Pets: { nameKeys: ['name'], descKey: 'indexDesc', thumbKeys: ['thumbnail'] },
  Eggs: { nameKeys: ['name'], descKey: null, thumbKeys: ['icon'] },
  Rebirths: { descKey: 'BoostDesc' },
  Buffs: { nameKeys: ['AssociatedItemID', ...DEFAULT_SPEC.nameKeys] },
};

function firstString(cd: ConfigData, keys: string[] | undefined): string | null {
  if (!keys) return null;
  for (const key of keys) {
    const value = cd[key];
    if (typeof value === 'string' && value.length > 0) return value;
  }
  return null;
}

function stripPrefix(configName: string): string {
  const parts = configName.split('|');
  return (parts[parts.length - 1] ?? configName).trim();
}

function resolveSpec(collectionName: string): CollectionSpec {
  return { ...SPECS[collectionName], ...(SPECS[collectionName] ? {} : DEFAULT_SPEC) };
}

const dataDir = './data/game';
const outDir = './data/test';
mkdirSync(outDir, { recursive: true });

import ENABLED_COLLECTIONS from "./enabled_collections.js"

const items: ItemDraft[] = [];
const stats: Record<string, { total: number; fallbackToConfigName: number }> = {};

for (const col of ENABLED_COLLECTIONS) {
  const entries: CollectionEntry[] = JSON.parse(
    readFileSync(join(dataDir, `collection-${col}.json`), 'utf8'),
  ).data;

  const spec = resolveSpec(col);
  let fallbackToConfigName = 0;

  for (const entry of entries) {
    const cd = entry.configData ?? {};
    let name = firstString(cd, spec.nameKeys);
    let nameSource: string;
    if (name) {
      nameSource = String(spec.nameKeys?.find((k) => cd[k] === name));
    } else {
      name = stripPrefix(entry.configName);
      nameSource = 'configName';
      fallbackToConfigName += 1;
    }
    const description =
      spec.descKey === null ? null : firstString(cd, spec.descKey ? [spec.descKey] : ['Desc']);
    const thumbnail = firstString(cd, spec.thumbKeys);
    items.push({
      collectionName: col,
      configName: entry.configName,
      name,
      nameSource,
      description,
      thumbnail,
    });
  }

  stats[col] = { total: entries.length, fallbackToConfigName };
}

writeFileSync(
  join(outDir, 'spec-driven-items.json'),
  JSON.stringify({ approach: 'spec-driven', stats, itemCount: items.length, sample: items.slice(0, 20), items }, null, 4),
);
console.log('[01] wrote', items.length, 'item drafts ->', join(outDir, 'spec-driven-items.json'));

function esc(s: unknown): string {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

const totalFallback = Object.values(stats).reduce((a, s) => a + s.fallbackToConfigName, 0);

const statRowsHtml = Object.entries(stats)
  .sort((a, b) => b[1].total - a[1].total)
  .map(([col, s]) => {
    const pct = s.total ? Math.round((100 * (s.total - s.fallbackToConfigName)) / s.total) : 0;
    return `<tr><td class="col">${esc(col)}</td><td class="total">${s.total}</td>` +
      `<td class="total">${s.fallbackToConfigName || '<span class="none">0</span>'}</td>` +
      `<td><div class="bar"><div class="fill" style="width:${pct}%"></div></div><span class="pct">${pct}%</span></td></tr>`;
  })
  .join('\n');

const itemRowsHtml = items
  .map(
    (item) =>
      `<tr${item.nameSource === 'configName' ? ' class="fallback"' : ''}><td>${esc(item.collectionName)}</td>` +
      `<td class="mono">${esc(item.configName)}</td>` +
      `<td><b>${esc(item.name)}</b></td>` +
      `<td><span class="src ${item.nameSource === 'configName' ? 'warn' : 'ok'}">${esc(item.nameSource)}</span></td>` +
      `<td class="desc">${item.description ? esc(item.description) : '<span class="none">-</span>'}</td>` +
      `<td class="mono">${item.thumbnail ? esc(item.thumbnail) : '<span class="none">-</span>'}</td></tr>`,
  )
  .join('\n');

writeFileSync(
  './data/reports/spec-driven-items.html',
  `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Spec-Driven Item Sync Report</title>
<style>
body{font-family:'Segoe UI',system-ui,sans-serif;margin:2rem;background:#f6f7f9;color:#222}
h1{margin-bottom:.2rem}h2{margin-top:2rem}
.meta{color:#666;margin-bottom:1.5rem}
.kpis{display:flex;gap:1rem;margin:1rem 0;flex-wrap:wrap}
.kpi{background:#fff;border-radius:8px;padding:1rem 1.5rem;box-shadow:0 1px 3px rgba(0,0,0,.08)}
.kpi b{display:block;font-size:1.6rem}.kpi span{color:#666;font-size:.8rem}
table{border-collapse:collapse;width:100%;background:#fff;box-shadow:0 1px 3px rgba(0,0,0,.08);margin-bottom:1rem}
th,td{padding:.45rem .7rem;border-bottom:1px solid #e5e7eb;text-align:left;font-size:.83rem}
th{background:#111827;color:#fff;position:sticky;top:0;z-index:1}
tr:hover td{background:#f0f4ff}tr.fallback td{background:#fff7ed}
td.col{font-weight:600;white-space:nowrap}td.total{text-align:right}
.mono{font-family:Consolas,monospace;font-size:.78rem}
.desc{max-width:340px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.none{color:#bbb}
.src{padding:1px 8px;border-radius:10px;font-size:.75rem;font-family:Consolas,monospace}
.src.ok{background:#d1fae5}.src.warn{background:#fee2e2}
.bar{display:inline-block;width:120px;height:8px;background:#e5e7eb;border-radius:4px;vertical-align:middle;margin-right:6px}
.fill{height:100%;background:#10b981;border-radius:4px}
.pct{font-size:.78rem;color:#555}
.small{font-size:.8rem;color:#666}
</style>
</head>
<body>
<h1>Spec-Driven Item Sync &mdash; Resolved Items</h1>
<p class="meta">Generated ${new Date().toISOString()} from <code>data/game/collection-*.json</code> (approach: ${esc('spec-driven')})</p>
<div class="kpis">
<div class="kpi"><b>${items.length}</b><span>items resolved</span></div>
<div class="kpi"><b>${Object.keys(stats).length}</b><span>enabled collections</span></div>
<div class="kpi"><b style="color:${totalFallback ? '#dc2626' : '#10b981'}">${totalFallback}</b><span>fell back to configName</span></div>
</div>
<h2>Per-collection resolution</h2>
<table><thead><tr><th>Collection</th><th>Items</th><th>configName fallbacks</th><th>Resolved via spec</th></tr></thead>
<tbody>
${statRowsHtml}
</tbody></table>
<h2>All items (${items.length})</h2>
<p class="small">Rows highlighted orange used the configName fallback.</p>
<table><thead><tr><th>Collection</th><th>configName</th><th>Resolved name</th><th>Name source</th><th>Description</th><th>Thumbnail</th></tr></thead>
<tbody>
${itemRowsHtml}
</tbody></table>
</body>
</html>`,
);
console.log('[01] html -> ./data/reports/spec-driven-items.html');
