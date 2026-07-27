import { CONFIG } from './config.js';
import { normalizeSpaces, cleanDOI, isoFromCrossrefParts, orcidFromText, simpleJournalVariants } from './utils.js';

async function fetchJson(url, options = {}) {
  const res = await fetch(url, options);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function fetchText(url, options = {}) {
  const res = await fetch(url, options);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

function getCrossrefIssn(message = {}) {
  const issns = [];
  if (Array.isArray(message.ISSN)) issns.push(...message.ISSN);
  if (Array.isArray(message['issn-type'])) {
    for (const item of message['issn-type']) {
      if (item?.type === 'electronic' && item?.value) issns.push(`e-ISSN: ${item.value}`);
      if (item?.type === 'print' && item?.value) issns.push(`p-ISSN: ${item.value}`);
    }
  }
  return issns;
}

export async function fetchCrossrefMetadata(doi) {
  const d = cleanDOI(doi);
  if (!d) return null;
  try {
    const data = await fetchJson(CONFIG.endpoints.crossref(d));
    const m = data.message || {};
    return {
      source: 'CrossRef',
      doi: d,
      journalName: normalizeSpaces(m['container-title']?.[0] || ''),
      articleTitle: normalizeSpaces(m.title?.[0] || ''),
      publisher: normalizeSpaces(m.publisher || ''),
      publisherCountry: 'Not reported',
      issn: getCrossrefIssn(m).join('; '),
      authors: (m.author || []).map(a => normalizeSpaces([a.given, a.family].filter(Boolean).join(' '))),
      orcids: (m.author || []).map(a => a.ORCID ? String(a.ORCID).replace(/^https?:\/\/orcid\.org\//, '') : 'Not reported'),
      published: isoFromCrossrefParts(m.published?.['date-parts']?.[0] || m.created?.['date-parts']?.[0]),
      received: '',
      accepted: '',
      url: m.URL || '',
      raw: m,
    };
  } catch {
    return null;
  }
}

export async function fetchOpenAlexMetadata(doi) {
  const d = cleanDOI(doi);
  if (!d) return null;
  try {
    const data = await fetchJson(CONFIG.endpoints.openalex(d));
    return {
      source: 'OpenAlex',
      doi: d,
      journalName: normalizeSpaces(data.host_venue?.display_name || ''),
      articleTitle: normalizeSpaces(data.title || ''),
      publisher: normalizeSpaces(data.primary_location?.source?.publisher || ''),
      publisherCountry: 'Not reported',
      issn: [data.host_venue?.issn_l, ...(data.host_venue?.issn || [])].filter(Boolean).join('; '),
      authors: (data.authorships || []).map(x => normalizeSpaces(x.author?.display_name || '')),
      orcids: (data.authorships || []).map(x => x.author?.orcid ? x.author.orcid.replace('https://orcid.org/', '') : 'Not reported'),
      published: data.publication_date || '',
      raw: data,
    };
  } catch {
    return null;
  }
}

export async function fetchPubMedArticleByDoi(doi) {
  const d = cleanDOI(doi);
  if (!d) return { found: false, count: 0 };
  const xml = await fetchText(CONFIG.endpoints.pubmedSearch(`"${d}"[DOI]`));
  const count = Number((xml.match(/<Count>(\d+)<\/Count>/)?.[1]) || 0);
  const idList = [...xml.matchAll(/<Id>(\d+)<\/Id>/g)].map(m => m[1]);
  return { found: count > 0, count, pmids: idList, rawXml: xml };
}

export async function fetchPmcByDoi(doi) {
  const d = cleanDOI(doi);
  if (!d) return { found: false, count: 0 };
  const json = await fetchJson(CONFIG.endpoints.pmcSearch(`"${d}"[DOI]`));
  const count = Number(json?.esearchresult?.count || 0);
  const ids = json?.esearchresult?.idlist || [];
  return { found: count > 0, count, ids, raw: json };
}

export async function fetchNlmCatalogByJournal(journalTitle) {
  const title = normalizeSpaces(journalTitle);
  if (!title) return null;
  try {
    const xml = await fetchText(CONFIG.endpoints.nlmCatalogSearch(`"${title}"[Title]`));
    const count = Number((xml.match(/<Count>(\d+)<\/Count>/)?.[1]) || 0);
    const ids = [...xml.matchAll(/<Id>(\d+)<\/Id>/g)].map(m => m[1]);
    return { count, ids, rawXml: xml };
  } catch {
    return null;
  }
}

export async function fetchOrcidCandidatesByName(name) {
  const q = normalizeSpaces(name);
  if (!q) return [];
  try {
    const data = await fetchJson(CONFIG.endpoints.orcidSearch(`given-and-family-names:"${q}"`), {
      headers: { Accept: 'application/json' },
    });
    const results = data?.expanded-result || data?.result || [];
    return results.slice(0, 3);
  } catch {
    return [];
  }
}

export async function resolveBaseMetadata({ doi, url }) {
  const d = cleanDOI(doi);
  const crossref = await fetchCrossrefMetadata(d);
  const openalex = await fetchOpenAlexMetadata(d);
  const best = crossref || openalex || { doi: d, source: 'None' };
  return {
    doi: d || normalizeSpaces(doi),
    source: best.source,
    journalName: best.journalName || openalex?.journalName || crossref?.journalName || '',
    articleTitle: best.articleTitle || openalex?.articleTitle || crossref?.articleTitle || '',
    publisher: best.publisher || openalex?.publisher || crossref?.publisher || '',
    publisherCountry: best.publisherCountry || '',
    issn: best.issn || openalex?.issn || crossref?.issn || '',
    authors: best.authors || openalex?.authors || crossref?.authors || [],
    orcids: best.orcids || openalex?.orcids || crossref?.orcids || [],
    published: best.published || openalex?.published || crossref?.published || '',
    url: url || crossref?.url || '',
    crossref: crossref?.raw || null,
    openalex: openalex?.raw || null,
  };
}

export function normalizeAuthorsFromMetadata(meta) {
  return (meta.authors || []).map(v => normalizeSpaces(v)).filter(Boolean);
}

export function normalizeOrcidsFromMetadata(meta) {
  return (meta.orcids || []).map(v => v && v !== 'Not reported' ? v : 'Not reported');
}
