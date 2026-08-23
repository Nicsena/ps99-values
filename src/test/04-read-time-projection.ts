import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

type ConfigData = Record<string, unknown>;

interface CollectionEntry {
  configName: string;
  category: string;
  configData: ConfigData;
}

interface ItemView {
  collectionName: string;
  configName: string;
  displayName: string;
  rarity: string | null;
  obtainable: boolean | null;
  tradable: boolean | null;
  huge: boolean;
  extraKeys: string[];
}

const NAME_KEYS = ['DisplayName', 'Name', 'name', 'Title'] as const;

function pickString(cd: ConfigData, keys: readonly string[]): string | null {
  for (const key of keys) {
    const v = cd[key];
    if (typeof v === 'string' && v.length > 0) return v;
  }
  return null;
}

function project(collectionName: string, entry: CollectionEntry): ItemView {
  const cd = entry.configData ?? {};

  const rawRarity = (cd.rarity ?? cd.Rarity) as ConfigData | undefined;
  const rarity =
    rawRarity && typeof rawRarity === 'object'
      ? ((rawRarity._id ?? rawRarity.DisplayName ?? null) as string | null)
      : null;

  const promoted = new Set([
    ...NAME_KEYS,
    'rarity', 'Rarity', 'Desc', 'indexDesc',
    'thumbnail', 'icon', 'Icon', 'goldenThumbnail',
    'indexObtainable', 'tradable', 'Tradable', 'huge', 'hidden',
  ]);
  const extraKeys = Object.keys(cd).filter((k) => !promoted.has(k));

  return {
    collectionName,
    configName: entry.configName,
    displayName: pickString(cd, NAME_KEYS) ?? entry.configName,
    rarity,
    obtainable: typeof cd.indexObtainable === 'boolean' ? cd.indexObtainable : null,
    tradable:
      typeof cd.tradable === 'boolean' ? cd.tradable
      : typeof cd.Tradable === 'boolean' ? cd.Tradable
      : null,
    huge: cd.huge === true,
    extraKeys,
  };
}

const dataDir = './.local/game';
const outDir = './.local/test/data';
mkdirSync(outDir, { recursive: true });
mkdirSync('./.local/reports', { recursive: true });

const sampleCollections = ['Pets', 'MiscItems', 'Booths', 'Charms'];
const views: ItemView[] = [];
const keyHistogram: Record<string, number> = {};

for (const col of sampleCollections) {
  const entries: CollectionEntry[] =
    JSON.parse(readFileSync(join(dataDir, `collection-${col}.json`), 'utf8')) ?? [];
  for (const entry of entries.slice(0, 50)) {
    views.push(project(col, entry));
    for (const k of Object.keys(entry.configData ?? {})) {
      keyHistogram[k] = (keyHistogram[k] ?? 0) + 1;
    }
  }
}

writeFileSync(
  join(outDir, 'read-time-projection.json'),
  JSON.stringify(
    {
      approach: 'schema-less storage + read-time projection',
      collectionsSampled: sampleCollections,
      projectedItems: views.length,
      distinctRawKeys: Object.keys(keyHistogram).length,
      topRawKeys: Object.entries(keyHistogram)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 20)
        .map(([key, count]) => ({ key, count })),
      sampleViews: views.filter((v) => v.rarity !== null).slice(0, 15),
    },
    null,
    4,
  ),
);

console.log('[04] projected', views.length, 'item views from raw configData');
console.log('[04] report ->', join(outDir, 'read-time-projection.json'));

function esc(s: unknown): string {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

const topRawKeysHtml = Object.entries(keyHistogram)
  .sort((a, b) => b[1] - a[1])
  .slice(0, 20)
  .map(([key, count]) => `<tr><td class="mono">${esc(key)}</td><td class="total">${count.toLocaleString()}</td></tr>`)
  .join('\n');

const viewRowsHtml = views
  .filter((v) => v.rarity !== null)
  .slice(0, 15)
  .map(
    (v) =>
      `<tr><td>${esc(v.collectionName)}</td><td><b>${esc(v.displayName)}</b></td>` +
      `<td>${v.rarity ? esc(v.rarity) : '<span class="none">-</span>'}</td>` +
      `<td>${v.tradable === null ? '<span class="none">-</span>' : v.tradable}</td>` +
      `<td>${v.huge ? 'yes' : '<span class="none">-</span>'}</td>` +
      `<td class="total">${v.extraKeys.length}</td></tr>`,
  )
  .join('\n');

writeFileSync(
  './.local/reports/read-time-projection.html',
  `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Read-Time Projection</title>
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
.small{font-size:.8rem;color:#666}
</style>
</head>
<body>
<h1>Read-Time Projection (schema-less configData)</h1>
<p class="meta">Generated ${new Date().toISOString()} &middot; collections sampled: ${sampleCollections.map(esc).join(', ')}</p>
<div class="kpis">
<div class="kpi"><b>${views.length}</b><span>projected item views</span></div>
<div class="kpi"><b>${Object.keys(keyHistogram).length}</b><span>distinct raw configData keys seen</span></div>
</div>
<p class="small">Promoted columns: displayName, rarity, obtainable, tradable, huge. Top raw keys remaining behind (candidates for <code>extraConfig</code>):</p>
<table><thead><tr><th>Raw key</th><th>Occurrences</th></tr></thead><tbody>
${topRawKeysHtml}
</tbody></table>
<h2 style="margin-top:1.5rem">Sample projected views</h2>
<table><thead><tr><th>Collection</th><th>Display name</th><th>Rarity</th><th>Tradable</th><th>Huge</th><th>Extra keys</th></tr></thead><tbody>
${viewRowsHtml}
</tbody></table>
</body>
</html>`,
);
console.log('[04] html -> ./.local/reports/read-time-projection.html');
