import { CONFIG } from './config.js';
import { cleanDOI, normalizeSpaces } from './utils.js';

async function fetchText(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

function containsAny(haystack, needles) {
  const h = normalizeSpaces(haystack).toLowerCase();
  return needles.some(n => h.includes(normalizeSpaces(n).toLowerCase()));
}

export async function checkIndexing({ doi, journalName, published }) {
  const d = cleanDOI(doi);
  const pubYear = published ? new Date(published).getFullYear() : null;

  const result = {
    pubmed: 'Not reported',
    pmc: 'Not reported',
    medline: 'Not reported',
    scopus: 'Not reported',
    embase: 'Not reported',
    doaj: 'Not reported',
    notes: '',
  };

  if (d) {
    try {
      const xml = await fetchText(CONFIG.endpoints.pubmedSearch(`"${d}"[DOI]`));
      const count = Number((xml.match(/<Count>(\d+)<\/Count>/)?.[1]) || 0);
      result.pubmed = count > 0 ? 'Yes' : 'No';
    } catch { result.pubmed = 'Not reported'; }

    try {
      const json = await fetchJson(CONFIG.endpoints.pmcSearch(`"${d}"[DOI]`));
      const count = Number(json?.esearchresult?.count || 0);
      result.pmc = count > 0 ? 'Yes' : 'No';
    } catch { result.pmc = 'Not reported'; }
  }

  // Date-aware journal indexing best effort using NLM Catalog / title clues.
  if (journalName) {
    try {
      const xml = await fetchText(CONFIG.endpoints.nlmCatalogSearch(`"${journalName}"[Title]`));
      const count = Number((xml.match(/<Count>(\d+)<\/Count>/)?.[1]) || 0);
      result.medline = count > 0 ? 'Yes' : 'No';
      result.notes = 'MEDLINE/NLM Catalog check is best-effort and based on the journal title record available through NCBI E-utilities.';
    } catch { result.medline = 'Not reported'; }
  }

  // User-supplied JSON lists for Scopus and Embase are expected in /data.
  try {
    const scopus = await fetch('./data/scopus_issn.json').then(r => r.json());
    if (Array.isArray(scopus) && journalName) {
      const hay = JSON.stringify(scopus);
      result.scopus = containsAny(hay, [journalName]) ? 'Yes' : 'No';
    }
  } catch { result.scopus = 'Not reported'; }

  try {
    const embase = await fetch('./data/embase_issn.json').then(r => r.json());
    if (Array.isArray(embase) && journalName) {
      const hay = JSON.stringify(embase);
      result.embase = containsAny(hay, [journalName]) ? 'Yes' : 'No';
    }
  } catch { result.embase = 'Not reported'; }

  try {
    const doaj = await fetch(`https://doaj.org/api/v2/search/journals/${encodeURIComponent(journalName)}`);
    result.doaj = doaj.ok ? 'Yes' : 'No';
  } catch { result.doaj = 'Not reported'; }

  return result;
}
