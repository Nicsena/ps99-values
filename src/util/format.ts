// Server-side number formatting. Mirrors public/js/lib format helpers — the
// client keeps its own copy (see plans/frontend-revamp.md, one formatter per
// side). Keep the two in sync.

function trimZeros(s: string): string {
  return s.replace(/\.0+$/, '').replace(/(\.\d*[1-9])0+$/, '$1');
}

export function fmtCompact(n: number | null | undefined): string {
  if (n === null || n === undefined || Number.isNaN(Number(n))) return '\u2014';
  const v = Number(n);
  const abs = Math.abs(v);
  const sign = v < 0 ? '-' : '';
  if (abs >= 1e12) return sign + trimZeros((abs / 1e12).toFixed(2)) + 'T';
  if (abs >= 1e9) return sign + trimZeros((abs / 1e9).toFixed(2)) + 'B';
  if (abs >= 1e6) return sign + trimZeros((abs / 1e6).toFixed(2)) + 'M';
  if (abs >= 1e3) return sign + trimZeros((abs / 1e3).toFixed(2)) + 'K';
  return v.toLocaleString();
}
