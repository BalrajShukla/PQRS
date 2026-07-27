import { cleanDOI, normalizeSpaces, parseCsvText } from './utils.js';

export function parseBatchCsv(text) {
  const rows = parseCsvText(text);
  return rows.map((row, idx) => ({
    rowNumber: idx + 2,
    doi: cleanDOI(row.doi || row.DOI || row.doi_input || row.identifier || ''),
    fileName: normalizeSpaces(row.file || row.filename || row.manuscript || row.pdf || row.file_name || ''),
    url: normalizeSpaces(row.url || row.URL || row.link || ''),
  }));
}

export function buildBatchJobs({ pdfFiles, csvRows, fallbackDoi, fallbackUrl }) {
  const jobs = [];
  const files = [...pdfFiles];
  const fileMap = new Map(files.map(f => [f.name.toLowerCase(), f]));

  if (csvRows.length) {
    for (const row of csvRows) {
      const file = row.fileName ? fileMap.get(row.fileName.toLowerCase()) : files.shift();
      if (!file) continue;
      jobs.push({ file, doi: row.doi || fallbackDoi, url: row.url || fallbackUrl || '' });
    }
    return jobs.slice(0, 25);
  }

  return files.slice(0, 25).map(file => ({ file, doi: fallbackDoi, url: fallbackUrl || '' }));
}

export async function readFileArrayBuffer(file) {
  return await file.arrayBuffer();
}

export function getConcurrencyLimit() {
  const hw = navigator.hardwareConcurrency || 4;
  return Math.max(1, Math.min(4, hw - 1 || 1));
}
