// One-off formatters. Loaded as <script src="/js/format.js" defer> before
// the page scripts that need them. The functions are top-level
// declarations in this file; in a non-module script they are accessible
// to subsequent <script> blocks on the same page via the standard
// non-module-script hoisting. Nothing is attached to window.

function isNum(n) {
  return n !== null && n !== undefined && !isNaN(Number(n)) && isFinite(Number(n));
}

function trimZeros(s) {
  return s.replace(/\.0+$/, '').replace(/(\.\d*[1-9])0+$/, '$1');
}

function fmtCompact(n) {
  if (!isNum(n)) return '\u2014';
  var v = Number(n);
  var abs = Math.abs(v);
  var sign = v < 0 ? '-' : '';
  if (abs >= 1e12) return sign + trimZeros((abs / 1e12).toFixed(2)) + 'T';
  if (abs >= 1e9) return sign + trimZeros((abs / 1e9).toFixed(2)) + 'B';
  if (abs >= 1e6) return sign + trimZeros((abs / 1e6).toFixed(2)) + 'M';
  if (abs >= 1e3) return sign + trimZeros((abs / 1e3).toFixed(2)) + 'K';
  return v.toLocaleString();
}

function fmtSignedCompact(n) {
  if (!isNum(n)) return 'N/A';
  var v = Number(n);
  if (v === 0) return '+0';
  return (v > 0 ? '+' : '-') + fmtCompact(Math.abs(v));
}

function fmtPct(n) {
  if (!isNum(n)) return 'N/A';
  var v = Number(n);
  if (v === 0) return '+0%';
  return (v > 0 ? '+' : '') + trimZeros(v.toFixed(1)) + '%';
}

var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function fmtDateTime(iso) {
  if (!iso) return '\u2014';
  var d = new Date(iso);
  if (isNaN(d.getTime())) return '\u2014';
  var h = d.getHours();
  var ampm = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  return (
    MONTHS[d.getMonth()] + ' ' + d.getDate() + ', ' + d.getFullYear() +
    ', ' + h + ':' + String(d.getMinutes()).padStart(2, '0') + ' ' + ampm
  );
}

function relTime(iso) {
  if (!iso) return null;
  var d = new Date(iso);
  if (isNaN(d.getTime())) return null;
  var secs = Math.max(0, Math.floor((Date.now() - d.getTime()) / 1000));
  if (secs < 60) return 'just now';
  if (secs < 3600) return Math.floor(secs / 60) + 'm ago';
  var hours = Math.floor(secs / 3600);
  if (hours < 24) return hours + 'h ago';
  return Math.floor(hours / 24) + 'd ago';
}
