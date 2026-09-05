// One-off SRI hash generator. Run with: npx tsx scripts/sri.ts <url|path> [...]
//
// For each input:
//   - If it looks like a URL (http://, https://), download it. A progress
//     bar with bytes-per-second and ETA is drawn on stderr while the
//     download streams.
//   - Otherwise, treat it as a local file path and read it from disk.
//
// The output is the file's size, then three lines of SRI hashes
// (SHA-256, SHA-384, SHA-512) in standard base64 — the encoding SRI
// uses for the `integrity="…"` attribute. Each input produces one
// block, separated by blank lines.
//
// By default, every downloaded file is also written to
// `./scripts/downloads/` (gitignored). Filenames are derived from the
// URL (host + path), with `/` and `@` replaced so the result is a
// safe filename on all platforms. Use `--no-save` to discard the
// buffer after hashing, or `--save-dir <path>` to override the
// location. Local file inputs are not affected — the input is
// already a file path; nothing to "save".

import { createHash } from 'node:crypto';
import { mkdirSync, statSync, writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { basename, isAbsolute, relative, resolve } from 'node:path';

function isUrl(value: string): boolean {
  return /^https?:\/\//i.test(value);
}

interface Progress {
  // Total bytes expected, or undefined when the server doesn't send
  // Content-Length (chunked transfer, compression without length, etc.).
  total: number | undefined;
  // Bytes received so far.
  received: number;
  // Wall-clock start time (ms).
  start: number;
  // Last time we painted the bar (ms); used to throttle redraws.
  lastDraw: number;
  // Bar width in characters (excludes the prefix/suffix text).
  width: number;
  // True after the bar has been finalized with a newline.
  done: boolean;
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(2)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function formatRate(bytesPerSec: number): string {
  return `${formatBytes(bytesPerSec)}/s`;
}

function formatEta(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '--:--';
  const s = Math.floor(seconds);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const r = s % 60;
  if (m < 60) return `${m}m${String(r).padStart(2, '0')}s`;
  const h = Math.floor(m / 60);
  return `${h}h${String(m % 60).padStart(2, '0')}m`;
}

function paintBar(p: Progress): void {
  // Throttle to ~10 Hz; the bar only needs to look alive.
  const now = Date.now();
  if (!p.done && now - p.lastDraw < 100) return;
  p.lastDraw = now;

  const elapsed = Math.max(1, (now - p.start) / 1000);
  const rate = p.received / elapsed;
  // When the read is instantaneous, the rate is just received/elapsed; the
  // eta below divides by the rate so we never want a zero rate (and we
  // also want to display "done" sensibly when the read completed).
  const eta = p.total && p.total > 0 ? (p.total - p.received) / Math.max(1, rate) : Infinity;
  const fraction = p.total && p.total > 0 ? Math.min(1, p.received / p.total) : 0;
  const filled = Math.max(0, Math.min(p.width, Math.round(fraction * p.width)));
  const bar = '█'.repeat(filled) + '░'.repeat(Math.max(0, p.width - filled));
  const totalStr = p.total ? formatBytes(p.total) : '?';
  // Carriage return so the line updates in place; no newline until done.
  const line =
    `\r  ${bar}  ${formatBytes(p.received).padStart(8)} / ${totalStr.padStart(8)}` +
    `  ${formatRate(rate).padStart(11)}  ETA ${formatEta(eta).padStart(6)}`;
  process.stderr.write(line);
}

function finishBar(p: Progress): void {
  if (p.done) return;
  // Repaint once with the final numbers, then drop a newline so the
  // next console.log on stdout lands on its own line.
  p.lastDraw = 0;
  paintBar(p);
  p.done = true;
  process.stderr.write('\n');
}

// Suppress unused-import warnings on `basename` (kept available for the
// describePath output formatting in future changes).
void basename;

async function downloadWithProgress(url: string): Promise<Buffer> {
  const res = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(60_000) });
  if (!res.ok) {
    throw new Error(`GET ${url} failed with HTTP ${res.status}`);
  }
  const contentLength = res.headers.get('content-length');
  const total = contentLength ? Number(contentLength) : undefined;

  if (!res.body) {
    // No streaming body (e.g. older Node, weird platform); fall back.
    const ab = await res.arrayBuffer();
    return Buffer.from(ab);
  }

  const progress: Progress = {
    total: Number.isFinite(total) ? total : undefined,
    received: 0,
    start: Date.now(),
    lastDraw: 0,
    width: 24,
    done: false,
  };
  // First paint so the user sees something immediately even on small files.
  paintBar(progress);

  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    if (value) {
      chunks.push(value);
      progress.received += value.byteLength;
      paintBar(progress);
    }
  }
  finishBar(progress);
  return Buffer.concat(chunks);
}

interface SRIHashes {
  sha256: string;
  sha384: string;
  sha512: string;
  size: number;
}

function computeHashes(buf: Buffer): SRIHashes {
  return {
    sha256: createHash('sha256').update(buf).digest('base64'),
    sha384: createHash('sha384').update(buf).digest('base64'),
    sha512: createHash('sha512').update(buf).digest('base64'),
    size: buf.length,
  };
}

function printBlock(label: string, h: SRIHashes, savedTo?: string): void {
  console.log(`# ${label}`);
  console.log(`# bytes: ${h.size}`);
  if (savedTo) console.log(`# saved: ${savedTo}`);
  console.log(`sha256-${h.sha256}`);
  console.log(`sha384-${h.sha384}`);
  console.log(`sha512-${h.sha512}`);
  console.log();
}

// Stable filename from a URL: host + path, with separators replaced
// so the result is safe on every filesystem. `https://` is dropped,
// `/` becomes `-`, `@` becomes `@@`, and any other non-alphanumeric
// run is kept (preserves the `.js` / `.min` extensions at the tail).
// Two downloads of the same URL produce the same filename; the second
// overwrites the first, which is the desired behavior.
function deriveFilename(url: string): string {
  let u = url;
  if (u.startsWith('https://')) u = u.slice('https://'.length);
  else if (u.startsWith('http://')) u = u.slice('http://'.length);
  // Replace `/` with `-` and `@` with `@@` so the file is portable.
  // Keep `.` in the final extension intact.
  return u.replace(/\//g, '-').replace(/@/g, '@@');
}

function saveToDir(saveDir: string, filename: string, buf: Buffer): string {
  mkdirSync(saveDir, { recursive: true });
  const fullPath = resolve(saveDir, filename);
  writeFileSync(fullPath, buf);
  return fullPath;
}

function describePath(p: string): string {
  return isAbsolute(p) ? p : relative(process.cwd(), resolve(p)) || p;
}

async function readFileWithProgress(file: string): Promise<Buffer> {
  const abs = resolve(file);
  const stat = statSync(abs);
  // Local reads are essentially instantaneous for any reasonable size.
  // Paint a single 100% bar so the output is visually consistent with
  // the download case, but skip rate/ETA which would divide by ~0.
  const progress: Progress = {
    total: stat.size,
    received: stat.size,
    start: Date.now(),
    lastDraw: 0,
    width: 24,
    done: false,
  };
  paintBar(progress);
  finishBar(progress);
  return readFile(abs);
}

function printHelp(): void {
  console.log(
    [
      'Usage: npx tsx scripts/sri.ts [options] <url-or-path> [...]',
      '',
      'Options:',
      '  --save-dir <path>   Keep every downloaded file at <path>. The buffer',
      '                       is hashed and then written to a file derived',
      '                       from the URL (host + path, with separators',
      '                       replaced for filesystem safety). Created if',
      '                       missing. Has no effect on local file inputs.',
      '                       Default: ./scripts/downloads (gitignored).',
      '  --no-save           Discard the buffer after hashing. Useful when',
      '                       you only want the SRI output, not the file.',
      '  --help, -h          Show this help.',
      '',
      'Each argument is either an http(s):// URL (downloaded) or a local',
      'file path (read from disk). For each input, prints:',
      '  - the source',
      '  - the size in bytes',
      '  - sha256-<base64>',
      '  - sha384-<base64>',
      '  - sha512-<base64>',
      '',
      'All three SRI algorithms are printed. The base64 is the standard',
      'encoding (the one SRI uses for the integrity="…" attribute).',
      '',
      'Downloads show a progress bar with bytes-per-second and ETA on',
      'stderr; the hash output is on stdout. Local reads also draw a',
      'progress bar (one paint for small files).',
      '',
      'Examples:',
      '  npx tsx scripts/sri.ts https://unpkg.com/lucide@1.41.0/dist/umd/lucide.min.js',
      '  npx tsx scripts/sri.ts --no-save https://unpkg.com/lucide@1.41.0/dist/umd/lucide.min.js',
      '  npx tsx scripts/sri.ts --save-dir ./downloads \\',
      '    https://unpkg.com/lucide@1.41.0/dist/umd/lucide.min.js \\',
      '    https://cdn.jsdelivr.net/npm/chart.js@4.5.1/dist/chart.umd.js',
      '  npx tsx scripts/sri.ts ./public/lucide.min.js',
    ].join('\n'),
  );
}

async function processOne(input: string, saveDir: string | undefined): Promise<void> {
  let buf: Buffer;
  let label: string;
  let savedTo: string | undefined;
  if (isUrl(input)) {
    buf = await downloadWithProgress(input);
    label = input;
    if (saveDir) {
      savedTo = saveToDir(saveDir, deriveFilename(input), buf);
    }
  } else {
    buf = await readFileWithProgress(input);
    label = describePath(input);
    // Local file inputs are not duplicated into --save-dir; the input
    // path is already the file's location.
  }
  printBlock(label, computeHashes(buf), savedTo);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
    printHelp();
    if (args.length === 0) process.exit(2);
    return;
  }

  // Default save directory: ./scripts/downloads (gitignored). Pass
  // --no-save to opt out and discard the buffer after hashing. Pass
  // --save-dir <path> to override.
  let saveDir: string | undefined = resolve('./scripts/downloads');
  const inputs: string[] = [];
  for (let i = 0; i < args.length; i += 1) {
    const a = args[i];
    if (a === '--save-dir') {
      const v = args[++i];
      if (!v) {
        process.stderr.write('[sri] --save-dir expects a <path> argument\n');
        process.exit(2);
      }
      saveDir = resolve(v);
    } else if (a === '--no-save') {
      saveDir = undefined;
    } else if (a.startsWith('--')) {
      process.stderr.write(`[sri] unknown flag: ${a}\n`);
      process.exit(2);
    } else {
      inputs.push(a);
    }
  }
  if (inputs.length === 0) {
    process.stderr.write('[sri] no inputs given\n');
    process.exit(2);
  }
  for (const input of inputs) {
    await processOne(input, saveDir);
  }
}

main().catch((err) => {
  process.stderr.write(`[sri] fatal: ${err instanceof Error ? err.message : err}\n`);
  process.exit(1);
});

void basename;
