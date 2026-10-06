/** CSV parse / stringify - used for the bundled price dataset and report exports. */

export function parseCsv(text, { hasHeader = true } = {}) {
  const rows = [];
  let cur = [];
  let field = '';
  let inQuotes = false;
  const src = text.replace(/^\uFEFF/, '');
  for (let i = 0; i < src.length; i += 1) {
    const ch = src[i];
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') { field += '"'; i += 1; } else inQuotes = false;
      } else field += ch;
      continue;
    }
    if (ch === '"') { inQuotes = true; continue; }
    if (ch === ',') { cur.push(field); field = ''; continue; }
    if (ch === '\n') { cur.push(field); rows.push(cur); cur = []; field = ''; continue; }
    if (ch === '\r') continue;
    field += ch;
  }
  if (field.length || cur.length) { cur.push(field); rows.push(cur); }
  const clean = rows.filter((r) => r.length > 1 || (r.length === 1 && r[0].trim() !== ''));
  if (!hasHeader) return clean;
  const header = clean.shift();
  return clean.map((r) => Object.fromEntries(header.map((h, i) => [h.trim(), r[i]])));
}

export function toCsv(rows, columns) {
  if (!rows.length) return '';
  const cols = columns || Object.keys(rows[0]);
  const esc = (v) => {
    if (v === null || v === undefined) return '';
    const s = String(v);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [cols.join(',')];
  for (const r of rows) lines.push(cols.map((c) => esc(r[c])).join(','));
  return lines.join('\n') + '\n';
}