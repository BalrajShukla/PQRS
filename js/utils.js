export function normalizeSpaces(value) {
  return String(value ?? '')
    .replace(/\u00a0/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/\s*\^\d+\s*/g, ' ')
    .replace(/\s*\[[^\]]*\]\s*/g, ' ')
    .replace(/\s*\([^)]*\d+[^)]*\)\s*/g, ' ')
    .trim();
}

export function cleanDOI(input) {
  const txt = String(input ?? '').trim();
  const m = txt.match(/10\.\d{4,9}\/[^\s"'<>]+/i);
  if (!m) return '';
  return m[0].replace(/[).,;]+$/g, '').trim();
}

export function splitSemicolonList(value) {
  if (!value) return '';
  if (Array.isArray(value)) return value.map(v => normalizeSpaces(v)).filter(Boolean).join('; ');
  return String(value)
    .split(/\s*;\s*/)
    .map(v => normalizeSpaces(v))
    .filter(Boolean)
    .join('; ');
}

export function semicolonListFromArray(arr) {
  return (arr ?? [])
    .map(v => normalizeSpaces(v))
    .filter(Boolean)
    .join('; ');
}

export function parseMaybeJson(text) {
  if (!text) return null;
  try {
    const a = JSON.parse(text);
    return a;
  } catch {
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start >= 0 && end > start) {
      try { return JSON.parse(text.slice(start, end + 1)); } catch { return null; }
    }
    return null;
  }
}

export function daysBetween(a, b) {
  if (!a || !b) return null;
  const d1 = new Date(a);
  const d2 = new Date(b);
  if (Number.isNaN(d1.getTime()) || Number.isNaN(d2.getTime())) return null;
  return Math.max(0, Math.round((d2 - d1) / 86400000));
}

export function isoFromCrossrefParts(parts) {
  if (!parts) return '';
  const p = Array.isArray(parts) ? parts : [parts];
  const [y, m, d] = p;
  const yy = String(y ?? '').padStart(4, '0');
  const mm = String(m ?? '1').padStart(2, '0');
  const dd = String(d ?? '1').padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

export function authorNameClean(name) {
  return normalizeSpaces(String(name ?? '').replace(/\s*\d+\s*$/g, '').replace(/\s*[†‡*,]+\s*$/g, ''));
}

export function orcidFromText(text) {
  const matches = String(text ?? '').match(/\b\d{4}-\d{4}-\d{4}-\d{3}[\dX]\b/g);
  return matches ? [...new Set(matches)] : [];
}

export function dedupe(arr) {
  return [...new Set((arr ?? []).filter(Boolean))];
}

export function escapeCsv(value) {
  const s = String(value ?? '');
  if (/[",\n;]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}

export function toCsv(rows) {
  const headers = rows.length ? Object.keys(rows[0]) : [];
  const lines = [headers.map(escapeCsv).join(',')];
  for (const row of rows) {
    lines.push(headers.map(h => escapeCsv(row[h])).join(','));
  }
  return lines.join('\n');
}

export function downloadBlob(filename, blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

export function simpleJournalVariants(name) {
  const n = normalizeSpaces(name).toLowerCase();
  if (!n) return [];
  return dedupe([
    n,
    n.replace(/journal of /g, 'j '),
    n.replace(/ of /g, ' '),
    n.replace(/\./g, ''),
  ]);
}

export function scoreSyntax(text) {
  const s = normalizeSpaces(text);
  if (!s) return { rating: 'Acceptable', errors: 0 };
  const sentences = s.split(/[.!?]+/).map(x => x.trim()).filter(Boolean);
  let errors = 0;
  for (const sentence of sentences.slice(0, 150)) {
    if (!/[A-Z]/.test(sentence[0] || '')) errors += 1;
    if (/\b(is|are|was|were|has|have|does|do)\b/i.test(sentence) && /\b([A-Za-z]+)\s+\1\b/.test(sentence)) errors += 1;
    if (/[\u2018\u2019]/.test(sentence)) errors += 0;
    if (/\b(it|they|he|she)\b/i.test(sentence) && /\b(am|is|are|was|were)\b/i.test(sentence)) errors += 0;
  }
  if (errors < 3) return { rating: 'Acceptable', errors };
  if (errors <= 5) return { rating: 'Average', errors };
  return { rating: 'Poor', errors };
}

export function parseCsvText(text) {
  const parsed = Papa.parse(text, { header: true, skipEmptyLines: true });
  return parsed.data || [];
}

export function chunkText(text, size = 12000) {
  const s = String(text ?? '');
  const chunks = [];
  for (let i = 0; i < s.length; i += size) chunks.push(s.slice(i, i + size));
  return chunks;
}

export function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export function safeString(v, fallback = 'Not reported') {
  const s = normalizeSpaces(v);
  return s || fallback;
}
