const CONFIG = {
  storageKeys: {
    apiKey: 'pqrs_api_key',
    model: 'pqrs_model',
    theme: 'pqrs_theme',
  },
  defaultModel: 'gemini-2.5-pro',
  maxBatchFiles: 25,
  pdfJsCandidates: [
    {
      src: 'https://cdn.jsdelivr.net/npm/pdfjs-dist/build/pdf.min.js',
      workerSrc: 'https://cdn.jsdelivr.net/npm/pdfjs-dist/build/pdf.worker.min.js',
    },
    {
      src: 'https://unpkg.com/pdfjs-dist/build/pdf.min.js',
      workerSrc: 'https://unpkg.com/pdfjs-dist/build/pdf.worker.min.js',
    },
  ],
  tesseractCandidates: [
    'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js',
    'https://unpkg.com/tesseract.js@5/dist/tesseract.min.js',
  ],
  xlsxCandidates: [
    'https://cdn.jsdelivr.net/npm/xlsx/dist/xlsx.full.min.js',
    'https://unpkg.com/xlsx/dist/xlsx.full.min.js',
  ],
};

const state = {
  rows: [],
  busy: false,
};

const el = (id) => document.getElementById(id);

function log(msg) {
  const area = el('log');
  const line = `[${new Date().toLocaleTimeString()}] ${msg}`;
  area.textContent += (area.textContent ? '\n' : '') + line;
  area.scrollTop = area.scrollHeight;
}

function setStatus(text) {
  const badge = el('statusBadge');
  if (badge) badge.textContent = text;
}

function setTheme(theme) {
  document.documentElement.dataset.theme = theme;
  localStorage.setItem(CONFIG.storageKeys.theme, theme);
}

function normalizeSpaces(value) {
  return String(value ?? '')
    .replace(/\s+/g, ' ')
    .replace(/\u00A0/g, ' ')
    .trim();
}

function safeString(value, fallback = 'Not reported') {
  const s = normalizeSpaces(value);
  return s ? s : fallback;
}

function asArray(value) {
  if (Array.isArray(value)) return value;
  if (value == null || value === '') return [];
  if (typeof value === 'string') return value.split(';').map((x) => x.trim()).filter(Boolean);
  return [String(value)];
}

function semicolonListFromArray(value) {
  return asArray(value)
    .map((x) => normalizeSpaces(x).replace(/^[-•\d.\)\s]+/, '').trim())
    .filter(Boolean)
    .join('; ');
}

function numberedAuthorsFromArray(value) {
  const items = asArray(value)
    .map((x) => normalizeSpaces(x).replace(/^[-•\s]+/, '').trim())
    .filter(Boolean);
  return items.map((x, i) => `${i + 1}. ${x}`).join('; ');
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function cleanDOI(input) {
  if (!input) return '';
  const raw = String(input).trim();
  const match = raw.match(/10\.\d{4,9}\/[^\s"'<>]+/i) || raw.match(/10\.\S+/i);
  if (!match) return '';
  return match[0].replace(/[)\].,;:]+$/g, '');
}

function findDoiInText(text) {
  const match = String(text || '').match(/10\.\d{4,9}\/[^\s"'<>]+/i) || String(text || '').match(/10\.\S+/i);
  return match ? cleanDOI(match[0]) : '';
}

function stripCodeFences(text) {
  return String(text || '')
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/```$/i, '')
    .trim();
}

function parseMaybeJson(text) {
  if (!text) return null;
  const cleaned = stripCodeFences(text);
  const first = cleaned.indexOf('{');
  const last = cleaned.lastIndexOf('}');
  if (first === -1 || last === -1 || last <= first) return null;
  try {
    return JSON.parse(cleaned.slice(first, last + 1));
  } catch {
    return null;
  }
}

function fetchWithTimeout(url, options = {}, timeoutMs = 20000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error('Timeout')), timeoutMs);
  return fetch(url, { ...options, signal: controller.signal }).finally(() => clearTimeout(timer));
}

async function loadScriptCandidates(candidates, globalKey) {
  if (globalKey && globalThis[globalKey]) {
    return candidates[0];
  }

  let lastError = null;

  for (const candidate of candidates) {
    try {
      await new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = candidate;
        script.crossOrigin = 'anonymous';
        script.onload = () => resolve();
        script.onerror = () => reject(new Error(`Failed to load ${candidate}`));
        document.head.appendChild(script);
      });

      if (!globalKey || globalThis[globalKey]) {
        return candidate;
      }
    } catch (err) {
      lastError = err;
    }
  }

  throw lastError || new Error('Failed to load script');
}

async function ensurePdfJs() {
  if (globalThis.pdfjsLib?.getDocument) {
    return globalThis.pdfjsLib;
  }

  let lastError = null;

  for (const candidate of CONFIG.pdfJsCandidates) {
    try {
      await new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = candidate.src;
        script.crossOrigin = 'anonymous';
        script.onload = () => resolve();
        script.onerror = () => reject(new Error(`Failed to load ${candidate.src}`));
        document.head.appendChild(script);
      });

      if (globalThis.pdfjsLib?.getDocument) {
        globalThis.pdfjsLib.GlobalWorkerOptions.workerSrc = candidate.workerSrc;
        return globalThis.pdfjsLib;
      }
    } catch (err) {
      lastError = err;
    }
  }

  throw lastError || new Error('PDF.js failed to initialize');
}

async function ensureTesseract() {
  if (globalThis.Tesseract?.recognize) return globalThis.Tesseract;
  await loadScriptCandidates(CONFIG.tesseractCandidates, 'Tesseract');
  if (!globalThis.Tesseract?.recognize) throw new Error('Tesseract failed to initialize');
  return globalThis.Tesseract;
}

async function ensureXlsx() {
  if (globalThis.XLSX?.utils) return globalThis.XLSX;
  await loadScriptCandidates(CONFIG.xlsxCandidates, 'XLSX');
  if (!globalThis.XLSX?.utils) throw new Error('XLSX failed to initialize');
  return globalThis.XLSX;
}

function readFileArrayBuffer(file) {
  return file.arrayBuffer();
}

function guessTitleFromText(text) {
  const lines = String(text || '')
    .split(/\r?\n/)
    .map((x) => normalizeSpaces(x))
    .filter(Boolean);

  for (const line of lines.slice(0, 24)) {
    if (
      line.length >= 20 &&
      line.length <= 220 &&
      !/(abstract|keywords|introduction|doi:|www\.|journal|volume|issue|copyright)/i.test(line)
    ) {
      return line;
    }
  }
  return '';
}

function guessAuthorsFromText(text) {
  const lines = String(text || '')
    .split(/\r?\n/)
    .map((x) => normalizeSpaces(x))
    .filter(Boolean);

  const candidate = lines.slice(0, 15).find((line) =>
    line.length >= 8 &&
    line.length <= 180 &&
    /,| and |;/.test(line) &&
    !/(abstract|keywords|introduction|doi:|corresponding author)/i.test(line)
  );
  return candidate || '';
}

function extractAffiliationFromText(text, authorCount = 1) {
  const lines = String(text || '')
    .split(/\r?\n/)
    .map((x) => normalizeSpaces(x))
    .filter(Boolean);

  const firstPage = lines.slice(0, 25);
  const candidate =
    firstPage.find((line) => /department|faculty|college|school|hospital|clinic|university/i.test(line) && line.includes(',')) ||
    '';

  if (!candidate) {
    return {
      department: '',
      college: '',
      university: '',
      city: '',
      country: '',
    };
  }

  const parts = candidate.split(',').map(normalizeSpaces).filter(Boolean);

  const department = parts.find((p) => /department|dept|division|unit|clinic|practice/i.test(p)) || parts[0] || '';
  const college = parts.find((p) => /college|school|institute|centre|center/i.test(p)) || '';
  const university = parts.find((p) => /university/i.test(p)) || '';

  let country = '';
  for (const p of parts.slice().reverse()) {
    if (/india|china|usa|united states|united kingdom|canada|australia|germany|france|italy|spain|brazil|japan|korea|saudi|uae|qatar|turkey|iran|pakistan|bangladesh|sri lanka|nepal|mexico|egypt|netherlands|sweden|norway|denmark|finland|ireland|singapore|malaysia|thailand|vietnam|philippines|indonesia|new zealand|south africa/i.test(p)) {
      country = p;
      break;
    }
  }
  if (!country) country = parts.at(-1) || '';

  let city = '';
  if (parts.length >= 3) {
    const maybeCity = parts.at(-3) || '';
    if (maybeCity && maybeCity !== country) city = maybeCity;
  }

  const fill = (value) => semicolonListFromArray(Array.from({ length: Math.max(authorCount, 1) }, () => value || 'Not reported'));

  return {
    department: fill(department),
    college: fill(college),
    university: fill(university),
    city: fill(city),
    country: fill(country),
  };
}

function extractSentencesContaining(text, patterns) {
  const s = String(text || '');
  const sentences = s
    .replace(/\r\n/g, '\n')
    .split(/(?<=[.!?])\s+|\n+/)
    .map((x) => normalizeSpaces(x))
    .filter(Boolean);

  return sentences.filter((sent) => patterns.some((re) => re.test(sent)));
}

function findFirstMatch(text, regexes) {
  const s = String(text || '');
  for (const re of regexes) {
    const m = s.match(re);
    if (m && m[0]) return normalizeSpaces(m[0]);
  }
  return '';
}

function extractSignalsFromText(text) {
  const s = String(text || '');

  const specialIssue = /special issue|supplement issue|supplement\b/i.test(s) ? 'Yes' : 'No';

  const studyDesign =
    /randomi[sz]ed controlled trial|randomi[sz]ed clinical trial|RCT\b/i.test(s) ? 'Randomized controlled trial' :
    /parallel[- ]group/i.test(s) ? 'Parallel-group trial' :
    /clinical trial/i.test(s) ? 'Clinical trial' :
    /cross[- ]sectional/i.test(s) ? 'Cross-sectional study' :
    /cohort/i.test(s) ? 'Cohort study' :
    /case[- ]control/i.test(s) ? 'Case-control study' :
    /systematic review/i.test(s) ? 'Systematic review' :
    /meta[- ]analysis/i.test(s) ? 'Meta-analysis' :
    /scoping review/i.test(s) ? 'Scoping review' :
    /qualitative/i.test(s) ? 'Qualitative study' :
    '';

  const guidelines = [];
  const guidelineMap = [
    ['CONSORT', /CONSORT/i],
    ['PRISMA', /PRISMA/i],
    ['STROBE', /STROBE/i],
    ['CARE', /\bCARE\b/i],
    ['SPIRIT', /SPIRIT/i],
    ['COREQ', /COREQ/i],
    ['SRQR', /SRQR/i],
    ['SQUIRE', /SQUIRE/i],
    ['ARRIVE', /ARRIVE/i],
    ['STARD', /STARD/i],
    ['TRIPOD', /TRIPOD/i],
    ['CHEERS', /CHEERS/i],
    ['TREND', /TREND/i],
  ];

  for (const [name, re] of guidelineMap) {
    if (re.test(s)) guidelines.push(name);
  }

  let reportingGuidelinesClaimed = guidelines.length ? [...new Set(guidelines)].join('; ') : 'Not reported';
  let reportingGuidelinesFollowed = 'Not reported';
  let reportingGuidelinesMissingItems = 'Not reported';

  if (guidelines.length) {
    const checklistMention = /checklist|flow diagram|supplementary file|in accordance with|consistent with|according to/i.test(s);
    reportingGuidelinesFollowed = checklistMention ? 'Yes' : 'Partially';
    reportingGuidelinesMissingItems = 'Not reported';
  }

  const ethicsSentences = extractSentencesContaining(s, [
    /ethic/i,
    /\bIEC\b/i,
    /\bIRB\b/i,
    /institutional review board/i,
    /institutional ethics committee/i,
    /ethical approval/i,
    /approved by/i,
  ]);
  const ethicsApproval = ethicsSentences.length ? ethicsSentences.join('; ') : 'Not reported';

  const regMatches = [
    ...new Set([
      ...(s.match(/\bCTRI\/\d{4}\/\d{2}\/\d{6}\b/gi) || []),
      ...(s.match(/\bNCT\d{8}\b/gi) || []),
      ...(s.match(/\bISRCTN\d+\b/gi) || []),
      ...(s.match(/\bChiCTR\d+\b/gi) || []),
      ...(s.match(/\bACTRN\d+\b/gi) || []),
      ...(s.match(/\bUMIN\d+\b/gi) || []),
      ...(s.match(/\bjRCT\d+\b/gi) || []),
      ...(s.match(/\bDRKS\d+\b/gi) || []),
      ...(s.match(/\bIRCT\d+\b/gi) || []),
      ...(s.match(/\bEUCTR\d+\b/gi) || []),
      ...(s.match(/\bRBR-\d+\b/gi) || []),
      ...(s.match(/\bPROSPERO\b[^\n;.]*/gi) || []),
      ...(s.match(/\bOSF\b[^\n;.]*/gi) || []),
    ]),
  ];

  let trialRegistration = 'Not reported';
  const humanIntervention =
    /randomi[sz]ed|clinical trial|trial\b|intervention|exodontia|surgery|procedure|participants|patients/i.test(s);

  if (regMatches.length) {
    trialRegistration = regMatches.join('; ');
  } else if (humanIntervention) {
    trialRegistration = 'Not reported';
  } else {
    trialRegistration = 'Not applicable';
  }

  const protocolMatches = [
    ...new Set([
      ...(s.match(/\bPROSPERO\b[^\n;.]*/gi) || []),
      ...(s.match(/\bOSF\b[^\n;.]*/gi) || []),
      ...(s.match(/\bClinicalTrials\.gov\b[^\n;.]*/gi) || []),
      ...(s.match(/\bCTRI\/\d{4}\/\d{2}\/\d{6}\b/gi) || []),
      ...(s.match(/\bNCT\d{8}\b/gi) || []),
      ...(s.match(/\bISRCTN\d+\b/gi) || []),
    ]),
  ];
  const protocolRegistration = protocolMatches.length ? protocolMatches.join('; ') : 'Not reported';

  const datePatterns = {
    receivedToAcceptedDays: [
      /submitted:\s*([0-9]{1,2}[-/][A-Za-z]{3}[-/][0-9]{4})\s*.*accepted:\s*([0-9]{1,2}[-/][A-Za-z]{3}[-/][0-9]{4})/i,
      /received:\s*([0-9]{1,2}[-/][A-Za-z]{3}[-/][0-9]{4})\s*.*accepted:\s*([0-9]{1,2}[-/][A-Za-z]{3}[-/][0-9]{4})/i,
    ],
    acceptedToPublishedDays: [
      /accepted:\s*([0-9]{1,2}[-/][A-Za-z]{3}[-/][0-9]{4})\s*.*published:\s*([0-9]{1,2}[-/][A-Za-z]{3}[-/][0-9]{4})/i,
    ],
  };

  const parseDate = (str) => {
    const m = String(str).match(/([0-9]{1,2})[-/](Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[-/]([0-9]{4})/i);
    if (!m) return null;
    const monthMap = { Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Oct: 9, Nov: 10, Dec: 11 };
    return new Date(Number(m[3]), monthMap[m[2].slice(0, 3)], Number(m[1]));
  };

  let receivedToAcceptedDays = 'Not reported';
  let acceptedToPublishedDays = 'Not reported';

  for (const re of datePatterns.receivedToAcceptedDays) {
    const m = s.match(re);
    if (m) {
      const d1 = parseDate(m[1]);
      const d2 = parseDate(m[2]);
      if (d1 && d2) receivedToAcceptedDays = String(Math.max(0, Math.round((d2 - d1) / 86400000)));
      break;
    }
  }

  for (const re of datePatterns.acceptedToPublishedDays) {
    const m = s.match(re);
    if (m) {
      const d1 = parseDate(m[1]);
      const d2 = parseDate(m[2]);
      if (d1 && d2) acceptedToPublishedDays = String(Math.max(0, Math.round((d2 - d1) / 86400000)));
      break;
    }
  }

  const fundingLine =
    findFirstMatch(s, [
      /financial support and sponsorship[\s\S]{0,120}/i,
      /funding[\s\S]{0,120}/i,
      /support and sponsorship[\s\S]{0,120}/i,
    ]) || '';

  let funding = 'Not reported';
  if (fundingLine) {
    if (/(nil|none|no financial|no funding|not funded)/i.test(fundingLine)) funding = 'No';
    else funding = 'Yes';
  }

  const syntaxHints = [
    ...((s.match(/\b(\w+)\s+\1\b/gi) || [])),
    ...((s.match(/\bthat that\b/gi) || [])),
    ...((s.match(/\b(?:are|is|was|were)\s+(?:is|are|was|were)\b/gi) || [])),
    ...((s.match(/\b(?:their|there|they're)\s+(?:is|are)\b/gi) || [])),
    ...((s.match(/\b(?:a|an)\s+(?=\b[a-z])/gi) || [])),
  ];
  const scientificSyntaxErrors = syntaxHints.length;
  const scientificSyntaxQuality = scientificSyntaxErrors < 3 ? 'Acceptable' : scientificSyntaxErrors <= 5 ? 'Average' : 'Poor';

  const trialOrDesignSentence = extractSentencesContaining(s, [
    /randomi[sz]ed controlled trial/i,
    /randomi[sz]ed clinical trial/i,
    /clinical trial/i,
    /parallel[- ]group/i,
    /cohort/i,
    /case[- ]control/i,
    /cross[- ]sectional/i,
    /systematic review/i,
    /meta[- ]analysis/i,
  ])[0] || '';

  const hallucinatedReferences = [];
  const torturedPhrases = [];

  return {
    special_issue: specialIssue,
    study_design: trialOrDesignSentence ? studyDesign || trialOrDesignSentence : studyDesign || 'Not reported',
    reporting_guidelines_claimed: reportingGuidelinesClaimed,
    reporting_guidelines_followed: reportingGuidelinesFollowed,
    reporting_guidelines_missing_items: reportingGuidelinesMissingItems,
    ethics_approval: ethicsApproval,
    trial_registration: trialRegistration,
    protocol_registration: protocolRegistration,
    received_to_accepted_days: receivedToAcceptedDays,
    accepted_to_published_days: acceptedToPublishedDays,
    funding,
    scientific_syntax_quality: scientificSyntaxQuality,
    scientific_syntax_errors: String(scientificSyntaxErrors),
    hallucinated_references: hallucinatedReferences,
    tortured_phrases: torturedPhrases,
  };
}

async function fetchJson(url, options = {}, timeoutMs = 20000) {
  const response = await fetchWithTimeout(
    url,
    {
      headers: {
        Accept: 'application/json',
        ...(options.headers || {}),
      },
      ...options,
    },
    timeoutMs
  );

  if (!response.ok) {
    throw new Error(`HTTP ${response.status} for ${url}`);
  }
  return response.json();
}

async function ncbiSearchCount(db, term) {
  const url = `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=${encodeURIComponent(db)}&term=${encodeURIComponent(term)}&retmode=json`;
  const data = await fetchJson(url, {}, 20000);
  const count = Number(data?.esearchresult?.count || 0);
  return Number.isFinite(count) ? count : 0;
}

async function fetchCrossrefByDoi(doi) {
  const data = await fetchJson(`https://api.crossref.org/works/${encodeURIComponent(doi)}`, {}, 20000);
  const m = data?.message || {};

  const authors = (m.author || []).map((a, i) => {
    const name = [a.given, a.family].filter(Boolean).join(' ').trim();
    return `${i + 1}. ${name || 'Not reported'}`;
  });

  const issns = Array.isArray(m.ISSN) ? m.ISSN.filter(Boolean) : [];
  const journal = m['container-title']?.[0] || m.shortContainerTitle?.[0] || '';
  const title = m.title?.[0] || '';

  return {
    doi: cleanDOI(doi),
    journal_name: journal,
    article_title: title,
    authors: authors.join('; '),
    affiliation_department: semicolonListFromArray((m.author || []).map(() => 'Not reported')),
    affiliation_college: semicolonListFromArray((m.author || []).map(() => 'Not reported')),
    affiliation_university: semicolonListFromArray((m.author || []).map(() => 'Not reported')),
    affiliation_city: semicolonListFromArray((m.author || []).map(() => 'Not reported')),
    affiliation_country: semicolonListFromArray((m.author || []).map(() => 'Not reported')),
    publisher: safeString(m.publisher),
    publisher_country: 'Not reported',
    issn_e: issns[0] || '',
    issn_p: issns[1] || '',
    published: m.published?.['date-parts']?.[0]?.[0] || m.created?.['date-parts']?.[0]?.[0] || '',
    url: m.URL || '',
  };
}

async function fetchOpenAlexByDoi(doi) {
  try {
    const data = await fetchJson(`https://api.openalex.org/works/https://doi.org/${encodeURIComponent(doi)}`, {}, 20000);
    const source = data?.primary_location?.source || {};
    const issnList = []
      .concat(source?.issn_l || [])
      .concat(source?.issn || [])
      .filter(Boolean);

    return {
      journal_name: source?.display_name || '',
      publisher: source?.host_organization_name || '',
      issn_e: issnList[0] || '',
      issn_p: issnList[1] || '',
    };
  } catch {
    return {};
  }
}

async function fetchNlmCatalogByJournal(journalName) {
  const q = normalizeSpaces(journalName);
  if (!q) return { count: 0 };
  const url = `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=nlmcatalog&term=${encodeURIComponent(q)}[Title]&retmode=json`;
  const data = await fetchJson(url, {}, 20000);
  const count = Number(data?.esearchresult?.count || 0);
  return { count: Number.isFinite(count) ? count : 0 };
}

async function fetchPubMedArticleByDoi(doi) {
  if (!doi) return { found: false, count: 0 };
  const count = await ncbiSearchCount('pubmed', `${doi}[DOI]`);
  return { found: count > 0, count };
}

async function fetchPmcByDoi(doi) {
  if (!doi) return { found: false, count: 0 };
  const count = await ncbiSearchCount('pmc', `${doi}[DOI]`);
  return { found: count > 0, count };
}

async function fetchDoajByJournal(journalName, issns = []) {
  const q = normalizeSpaces(journalName);
  if (!q && !issns.length) return false;

  const tries = [];
  if (q) tries.push(`https://doaj.org/api/v2/search/journals/${encodeURIComponent(q)}`);
  for (const issn of issns) {
    tries.push(`https://doaj.org/api/v2/search/journals/${encodeURIComponent(issn)}`);
  }

  for (const url of tries) {
    try {
      const data = await fetchJson(url, {}, 20000);
      const total = Number(data?.total || data?.results?.length || 0);
      if (total > 0) return true;
    } catch {
      // continue
    }
  }
  return false;
}

function issnNormalize(v) {
  return String(v || '').replace(/[^0-9Xx]/g, '').toUpperCase();
}

function collectStringValuesDeep(node, out = []) {
  if (node == null) return out;
  if (typeof node === 'string' || typeof node === 'number' || typeof node === 'boolean') {
    out.push(String(node));
    return out;
  }
  if (Array.isArray(node)) {
    for (const item of node) collectStringValuesDeep(item, out);
    return out;
  }
  if (typeof node === 'object') {
    for (const [k, v] of Object.entries(node)) {
      if (/issn/i.test(k) && typeof v === 'string') out.push(v);
      collectStringValuesDeep(v, out);
    }
  }
  return out;
}

async function loadIssnIndex(path) {
  try {
    const response = await fetch(path, { cache: 'no-store' });
    if (!response.ok) return null;
    return response.json();
  } catch {
    return null;
  }
}

async function issnMatchFromJson(path, issns) {
  const data = await loadIssnIndex(path);
  if (!data) return false;

  const targets = new Set(issns.map(issnNormalize).filter(Boolean));
  if (!targets.size) return false;

  const strings = collectStringValuesDeep(data, []);
  return strings.some((x) => targets.has(issnNormalize(x)));
}

async function checkIndexing({ doi, journalName, issn_e, issn_p }) {
  const issns = [issn_e, issn_p].filter(Boolean);

  let pubmed = false;
  let pmc = false;
  let medline = false;
  let doaj = false;
  let scopus = false;
  let embase = false;
  const notes = [];

  try {
    const count = await ncbiSearchCount('pubmed', `${doi}[DOI]`);
    pubmed = count > 0;
  } catch (e) {
    notes.push(`PubMed check failed: ${e.message}`);
  }

  try {
    const count = await ncbiSearchCount('pmc', `${doi}[DOI]`);
    pmc = count > 0;
  } catch (e) {
    notes.push(`PMC check failed: ${e.message}`);
  }

  try {
    const count = await ncbiSearchCount('nlmcatalog', `${journalName}[Title]`);
    medline = count > 0;
  } catch (e) {
    notes.push(`MEDLINE/NLM catalog check failed: ${e.message}`);
  }

  try {
    doaj = await fetchDoajByJournal(journalName, issns);
  } catch (e) {
    notes.push(`DOAJ check failed: ${e.message}`);
  }

  try {
    scopus = await issnMatchFromJson('./data/scopus_issn.json', issns);
  } catch (e) {
    notes.push(`Scopus ISSN file check failed: ${e.message}`);
  }

  try {
    embase = await issnMatchFromJson('./data/embase_issn.json', issns);
  } catch (e) {
    notes.push(`Embase ISSN file check failed: ${e.message}`);
  }

  return {
    pubmed,
    pmc,
    medline,
    doaj,
    scopus,
    embase,
    notes: notes.join(' | '),
  };
}

function buildPrompt({ text, base, doi, url }) {
  const t = String(text || '').slice(0, 40000);
  return `
You are extracting structured data from a scholarly manuscript PDF.

Return ONLY valid JSON. Do not wrap in markdown fences.

Use these keys exactly:
{
  "doi": "",
  "journal_name": "",
  "article_title": "",
  "authors": [],
  "affiliation_department": [],
  "affiliation_college": [],
  "affiliation_university": [],
  "affiliation_city": [],
  "affiliation_country": [],
  "orcid_ids": [],
  "publisher": "",
  "publisher_country": "",
  "special_issue": "Yes|No|Not reported",
  "study_design": "",
  "reporting_guidelines_claimed": [],
  "reporting_guidelines_followed": "Yes|Partially|No|Not reported",
  "reporting_guidelines_missing_items": [],
  "ethics_approval": "",
  "trial_registration": "",
  "protocol_registration": "",
  "received_to_accepted_days": "",
  "accepted_to_published_days": "",
  "funding": "Yes|No|Not reported",
  "journal_self_citation": "",
  "scientific_syntax_quality": "Poor|Average|Acceptable|Not reported",
  "scientific_syntax_errors": 0,
  "pubmed": "Yes|No|Not reported",
  "pmc": "Yes|No|Not reported",
  "medline": "Yes|No|Not reported",
  "scopus": "Yes|No|Not reported",
  "embase": "Yes|No|Not reported",
  "doaj": "Yes|No|Not reported",
  "hallucinated_references": [],
  "tortured_phrases": []
}

Rules:
- Use the supplied DOI and URL only as clues.
- If a field is unavailable, set it to "Not reported" or [] as appropriate.
- Authors and affiliations must be in authorship order.
- Remove superscripts, extra spaces, and markers from names.
- For trial_registration: if the study does not involve human intervention, use "Not applicable"; if it does involve intervention but registration is missing, use "Not reported".
- For ethics_approval: extract every ethics-related sentence and include committee name/number if present.
- For reporting guidelines: first list the guideline(s) claimed, then whether they were actually followed (Yes/Partially/No), then missing items.
- For scientific_syntax_errors: count spelling/grammar/tense issues approximately from the manuscript text.
- For journal_self_citation: estimate the percentage if possible; otherwise "Not reported".
- For hallucinated_references and tortured_phrases: return arrays of suspicious items if detected; otherwise [].
- Be conservative. Do not invent facts.
- Use the manuscript text as primary evidence.

Known metadata:
DOI: ${doi || 'Not reported'}
URL: ${url || 'Not reported'}
Crossref/OpenAlex metadata snapshot:
${JSON.stringify(base, null, 2)}

Manuscript text:
${t}
`.trim();
}

async function callGeminiExtract({ apiKey, model, prompt, retries = 3 }) {
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;

  const body = {
    contents: [
      {
        role: 'user',
        parts: [{ text: prompt }],
      },
    ],
    generationConfig: {
      temperature: 0,
      topK: 1,
      topP: 1,
      maxOutputTokens: 8192,
      responseMimeType: 'application/json',
    },
  };

  let lastError = null;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const response = await fetchWithTimeout(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }, 120000);

      if (response.status === 429) {
        const retryAfter = Number(response.headers.get('Retry-After') || 0);
        const waitMs = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : Math.min(8000, 1000 * (attempt + 1) * (attempt + 1));
        lastError = new Error('Gemini rate limited (HTTP 429)');
        if (attempt < retries) {
          await delay(waitMs);
          continue;
        }
        throw lastError;
      }

      if (!response.ok) {
        throw new Error(`Gemini HTTP ${response.status}`);
      }

      const json = await response.json();
      const text = json?.candidates?.[0]?.content?.parts?.map((p) => p.text || '').join('') || '';
      return parseMaybeJson(text) || parseMaybeJson(JSON.stringify(json)) || null;
    } catch (err) {
      lastError = err;
      if (attempt < retries) {
        await delay(1000 * (attempt + 1));
        continue;
      }
      throw lastError;
    }
  }

  throw lastError || new Error('Gemini extraction failed');
}

function formatPercentage(v) {
  if (v == null || v === '') return 'Not reported';
  const s = String(v).trim();
  if (!s) return 'Not reported';
  if (/%$/.test(s)) return s;
  return `${s}%`;
}

function normalizeGeminiResult(obj) {
  if (!obj || typeof obj !== 'object') return {};
  const out = { ...obj };

  if (out.authors) out.authors = numberedAuthorsFromArray(out.authors);
  if (out.affiliation_department) out.affiliation_department = semicolonListFromArray(out.affiliation_department);
  if (out.affiliation_college) out.affiliation_college = semicolonListFromArray(out.affiliation_college);
  if (out.affiliation_university) out.affiliation_university = semicolonListFromArray(out.affiliation_university);
  if (out.affiliation_city) out.affiliation_city = semicolonListFromArray(out.affiliation_city);
  if (out.affiliation_country) out.affiliation_country = semicolonListFromArray(out.affiliation_country);
  if (out.orcid_ids) out.orcid_ids = semicolonListFromArray(out.orcid_ids) || 'Not reported';
  if (out.reporting_guidelines_claimed) out.reporting_guidelines_claimed = semicolonListFromArray(out.reporting_guidelines_claimed);
  if (out.reporting_guidelines_missing_items) out.reporting_guidelines_missing_items = semicolonListFromArray(out.reporting_guidelines_missing_items);
  if (out.hallucinated_references) out.hallucinated_references = semicolonListFromArray(out.hallucinated_references);
  if (out.tortured_phrases) out.tortured_phrases = semicolonListFromArray(out.tortured_phrases);

  if (out.journal_self_citation != null) out.journal_self_citation = formatPercentage(out.journal_self_citation);
  if (out.scientific_syntax_errors != null && out.scientific_syntax_errors !== '') {
    out.scientific_syntax_errors = String(out.scientific_syntax_errors);
  }

  return out;
}

async function resolveBaseMetadata({ doi, url, text }) {
  const fromTextDoi = findDoiInText(text);
  const finalDoi = cleanDOI(doi || fromTextDoi || '');

  const base = {
    doi: finalDoi || 'Not reported',
    journal_name: 'Not reported',
    article_title: 'Not reported',
    authors: 'Not reported',
    affiliation_department: 'Not reported',
    affiliation_college: 'Not reported',
    affiliation_university: 'Not reported',
    affiliation_city: 'Not reported',
    affiliation_country: 'Not reported',
    orcid_ids: 'Not reported',
    publisher: 'Not reported',
    publisher_country: 'Not reported',
    issn_e: '',
    issn_p: '',
    special_issue: 'Not reported',
    study_design: 'Not reported',
    reporting_guidelines_claimed: 'Not reported',
    reporting_guidelines_followed: 'Not reported',
    reporting_guidelines_missing_items: 'Not reported',
    ethics_approval: 'Not reported',
    trial_registration: 'Not reported',
    protocol_registration: 'Not reported',
    received_to_accepted_days: 'Not reported',
    accepted_to_published_days: 'Not reported',
    funding: 'Not reported',
    journal_self_citation: 'Not reported',
    scientific_syntax_quality: 'Not reported',
    scientific_syntax_errors: 'Not reported',
    pubmed: 'Not reported',
    pmc: 'Not reported',
    medline: 'Not reported',
    scopus: 'Not reported',
    embase: 'Not reported',
    doaj: 'Not reported',
    hallucinated_references: 'Not reported',
    tortured_phrases: 'Not reported',
    url: url || 'Not reported',
  };

  if (finalDoi) {
    try {
      const crossref = await fetchCrossrefByDoi(finalDoi);
      Object.assign(base, crossref);
    } catch (err) {
      log(`Crossref lookup failed: ${err.message}`);
    }

    try {
      const openalex = await fetchOpenAlexByDoi(finalDoi);
      if (!base.journal_name || base.journal_name === 'Not reported') base.journal_name = openalex.journal_name || base.journal_name;
      if (!base.publisher || base.publisher === 'Not reported') base.publisher = openalex.publisher || base.publisher;
      if (!base.issn_e) base.issn_e = openalex.issn_e || '';
      if (!base.issn_p) base.issn_p = openalex.issn_p || '';
    } catch {
      // ignore
    }
  }

  if ((!base.article_title || base.article_title === 'Not reported') && text) {
    const titleGuess = guessTitleFromText(text);
    if (titleGuess) base.article_title = titleGuess;
  }

  if ((!base.authors || base.authors === 'Not reported') && text) {
    const authorGuess = guessAuthorsFromText(text);
    if (authorGuess) base.authors = numberedAuthorsFromArray(authorGuess.split(/,\s*/));
  }

  return base;
}

function standardizeRow(row) {
  return {
    input_file: safeString(row.input_file),
    doi: safeString(row.doi),
    journal_name: safeString(row.journal_name),
    article_title: safeString(row.article_title),
    authors: safeString(row.authors),
    affiliation_department: safeString(row.affiliation_department),
    affiliation_college: safeString(row.affiliation_college),
    affiliation_university: safeString(row.affiliation_university),
    affiliation_city: safeString(row.affiliation_city),
    affiliation_country: safeString(row.affiliation_country),
    orcid_ids: safeString(row.orcid_ids),
    publisher: safeString(row.publisher),
    publisher_country: safeString(row.publisher_country),
    issn_e: safeString(row.issn_e, ''),
    issn_p: safeString(row.issn_p, ''),
    special_issue: safeString(row.special_issue),
    study_design: safeString(row.study_design),
    reporting_guidelines_claimed: safeString(row.reporting_guidelines_claimed),
    reporting_guidelines_followed: safeString(row.reporting_guidelines_followed),
    reporting_guidelines_missing_items: safeString(row.reporting_guidelines_missing_items),
    ethics_approval: safeString(row.ethics_approval),
    trial_registration: safeString(row.trial_registration),
    protocol_registration: safeString(row.protocol_registration),
    received_to_accepted_days: safeString(row.received_to_accepted_days),
    accepted_to_published_days: safeString(row.accepted_to_published_days),
    funding: safeString(row.funding),
    journal_self_citation: safeString(row.journal_self_citation),
    scientific_syntax_quality: safeString(row.scientific_syntax_quality),
    scientific_syntax_errors: safeString(row.scientific_syntax_errors),
    pubmed: safeString(row.pubmed),
    pmc: safeString(row.pmc),
    medline: safeString(row.medline),
    scopus: safeString(row.scopus),
    embase: safeString(row.embase),
    doaj: safeString(row.doaj),
    hallucinated_references: safeString(row.hallucinated_references),
    tortured_phrases: safeString(row.tortured_phrases),
    indexing_notes: safeString(row.indexing_notes),
  };
}

async function analyzeManuscript({ apiKey, model, doi, baseMeta, text, url }) {
  const prompt = buildPrompt({ text, base: baseMeta, doi, url });
  let extracted = null;

  if (apiKey && text && text.trim().length > 0) {
    try {
      extracted = await callGeminiExtract({ apiKey, model, prompt, retries: 3 });
    } catch (err) {
      log(`Gemini extraction failed: ${err.message}`);
    }
  }

  const gem = normalizeGeminiResult(extracted || {});
  const merged = {
    ...baseMeta,
    ...gem,
  };

  merged.doi = safeString(merged.doi, 'Not reported');
  merged.journal_name = safeString(merged.journal_name, 'Not reported');
  merged.article_title = safeString(merged.article_title, 'Not reported');
  merged.authors = safeString(merged.authors, 'Not reported');
  merged.affiliation_department = safeString(merged.affiliation_department, 'Not reported');
  merged.affiliation_college = safeString(merged.affiliation_college, 'Not reported');
  merged.affiliation_university = safeString(merged.affiliation_university, 'Not reported');
  merged.affiliation_city = safeString(merged.affiliation_city, 'Not reported');
  merged.affiliation_country = safeString(merged.affiliation_country, 'Not reported');
  merged.orcid_ids = safeString(merged.orcid_ids, 'Not reported');
  merged.publisher = safeString(merged.publisher, 'Not reported');
  merged.publisher_country = safeString(merged.publisher_country, 'Not reported');
  merged.special_issue = safeString(merged.special_issue, 'Not reported');
  merged.study_design = safeString(merged.study_design, 'Not reported');
  merged.reporting_guidelines_claimed = safeString(merged.reporting_guidelines_claimed, 'Not reported');
  merged.reporting_guidelines_followed = safeString(merged.reporting_guidelines_followed, 'Not reported');
  merged.reporting_guidelines_missing_items = safeString(merged.reporting_guidelines_missing_items, 'Not reported');
  merged.ethics_approval = safeString(merged.ethics_approval, 'Not reported');
  merged.trial_registration = safeString(merged.trial_registration, 'Not reported');
  merged.protocol_registration = safeString(merged.protocol_registration, 'Not reported');
  merged.received_to_accepted_days = safeString(merged.received_to_accepted_days, 'Not reported');
  merged.accepted_to_published_days = safeString(merged.accepted_to_published_days, 'Not reported');
  merged.funding = safeString(merged.funding, 'Not reported');
  merged.journal_self_citation = safeString(merged.journal_self_citation, 'Not reported');
  merged.scientific_syntax_quality = safeString(merged.scientific_syntax_quality, 'Not reported');
  merged.scientific_syntax_errors = safeString(merged.scientific_syntax_errors, 'Not reported');
  merged.pubmed = safeString(merged.pubmed, 'Not reported');
  merged.pmc = safeString(merged.pmc, 'Not reported');
  merged.medline = safeString(merged.medline, 'Not reported');
  merged.scopus = safeString(merged.scopus, 'Not reported');
  merged.embase = safeString(merged.embase, 'Not reported');
  merged.doaj = safeString(merged.doaj, 'Not reported');
  merged.hallucinated_references = safeString(merged.hallucinated_references, 'Not reported');
  merged.tortured_phrases = safeString(merged.tortured_phrases, 'Not reported');

  return merged;
}

function parseCsv(text) {
  const rows = [];
  const lines = String(text || '').replace(/\r\n/g, '\n').split('\n').filter((x) => x.trim() !== '');
  if (!lines.length) return rows;

  const parseLine = (line) => {
    const out = [];
    let cur = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i += 1) {
      const ch = line[i];
      const next = line[i + 1];
      if (ch === '"' && inQuotes && next === '"') {
        cur += '"';
        i += 1;
      } else if (ch === '"') {
        inQuotes = !inQuotes;
      } else if (ch === ',' && !inQuotes) {
        out.push(cur);
        cur = '';
      } else {
        cur += ch;
      }
    }
    out.push(cur);
    return out.map((x) => x.trim());
  };

  const headers = parseLine(lines[0]).map((x) => x.toLowerCase());
  for (const line of lines.slice(1)) {
    const values = parseLine(line);
    const row = {};
    headers.forEach((h, i) => {
      row[h] = values[i] ?? '';
    });
    rows.push(row);
  }
  return rows;
}

function buildBatchJobs({ pdfFiles, csvRows, fallbackDoi, fallbackUrl }) {
  const files = [...pdfFiles].slice(0, CONFIG.maxBatchFiles);
  return files.map((file, idx) => {
    const row = csvRows?.[idx] || {};
    return {
      file,
      doi: row.doi || row.DOI || fallbackDoi || '',
      url: row.url || row.URL || fallbackUrl || '',
    };
  });
}

function getConcurrencyLimit() {
  const cores = Number(navigator.hardwareConcurrency || 2);
  return Math.max(1, Math.min(4, Math.floor(cores / 2) || 1));
}

async function extractPdfText(buffer, maxPages = 10) {
  await ensurePdfJs();
  const pdf = await globalThis.pdfjsLib.getDocument({
    data: buffer,
    useWorkerFetch: false,
    isEvalSupported: false,
  }).promise;

  const limit = Math.min(pdf.numPages, maxPages);
  let text = '';

  for (let i = 1; i <= limit; i += 1) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    const pageText = content.items.map((item) => item.str).join(' ');
    text += `${pageText}\n`;
  }

  return {
    text,
    pages: pdf.numPages,
    needsOCR: text.trim().length < 700,
  };
}

async function ocrPdf(buffer, pageNumbers = [1]) {
  await ensurePdfJs();
  await ensureTesseract();

  const pdf = await globalThis.pdfjsLib.getDocument({
    data: buffer,
    useWorkerFetch: false,
    isEvalSupported: false,
  }).promise;

  let out = '';

  for (const pno of pageNumbers) {
    if (pno < 1 || pno > pdf.numPages) continue;

    const page = await pdf.getPage(pno);
    const viewport = page.getViewport({ scale: 1.6 });

    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    canvas.width = viewport.width;
    canvas.height = viewport.height;

    await page.render({ canvasContext: ctx, viewport }).promise;
    const res = await globalThis.Tesseract.recognize(canvas, 'eng');
    out += `${res?.data?.text || ''}\n`;
  }

  return out.trim();
}

async function processSingleJob(job, idx, total) {
  const apiKey = el('apiKey').value.trim();
  const model = el('modelSelect').value;
  const doiInput = cleanDOI(job.doi || el('doiInput').value || '');
  const url = normalizeSpaces(job.url || el('urlInput').value || '');

  log(`(${idx + 1}/${total}) Loading ${job.file.name}`);
  const buffer = await readFileArrayBuffer(job.file);

  let extracted;
  try {
    extracted = await extractPdfText(buffer, 10);
  } catch (err) {
    log(`(${idx + 1}/${total}) PDF parse failed for ${job.file.name}: ${err.message}`);
    throw err;
  }

  let text = extracted.text || '';
  if (extracted.needsOCR || text.trim().length < 700) {
    log(`(${idx + 1}/${total}) OCR fallback for ${job.file.name}`);
    try {
      text = await ocrPdf(buffer, [1, 2]);
    } catch (err) {
      log(`(${idx + 1}/${total}) OCR failed for ${job.file.name}: ${err.message}`);
    }
  }

  const textSignals = extractSignalsFromText(text);
  const baseMeta = await resolveBaseMetadata({ doi: doiInput, url, text });

  const authorCount = asArray(baseMeta.authors).length || asArray(guessAuthorsFromText(text).split(/,\s*/)).length || 1;
  const affiliation = extractAffiliationFromText(text, authorCount);

  const mergedBase = {
    ...baseMeta,
    ...textSignals,
    affiliation_department: affiliation.department || baseMeta.affiliation_department,
    affiliation_college: affiliation.college || baseMeta.affiliation_college,
    affiliation_university: affiliation.university || baseMeta.affiliation_university,
    affiliation_city: affiliation.city || baseMeta.affiliation_city,
    affiliation_country: affiliation.country || baseMeta.affiliation_country,
  };

  const resolvedDoi = cleanDOI(mergedBase.doi || doiInput || findDoiInText(text) || '');

  let indexing = {
    pubmed: 'Not reported',
    pmc: 'Not reported',
    medline: 'Not reported',
    scopus: 'Not reported',
    embase: 'Not reported',
    doaj: 'Not reported',
    notes: '',
  };

  try {
    const issns = [mergedBase.issn_e, mergedBase.issn_p].filter(Boolean);
    const [pubmed, pmc, nlm] = await Promise.all([
      fetchPubMedArticleByDoi(resolvedDoi).catch(() => ({ found: false, count: 0 })),
      fetchPmcByDoi(resolvedDoi).catch(() => ({ found: false, count: 0 })),
      fetchNlmCatalogByJournal(mergedBase.journal_name).catch(() => ({ count: 0 })),
    ]);

    const scopus = await issnMatchFromJson('./data/scopus_issn.json', issns).catch(() => false);
    const embase = await issnMatchFromJson('./data/embase_issn.json', issns).catch(() => false);
    const doaj = await fetchDoajByJournal(mergedBase.journal_name, issns).catch(() => false);

    indexing = {
      pubmed: pubmed.found ? 'Yes' : 'No',
      pmc: pmc.found ? 'Yes' : 'No',
      medline: nlm.count > 0 ? 'Yes' : 'No',
      scopus: scopus ? 'Yes' : 'No',
      embase: embase ? 'Yes' : 'No',
      doaj: doaj ? 'Yes' : 'No',
      notes: '',
    };
  } catch (err) {
    indexing.notes = err.message || 'Indexing check failed';
  }

  let result = {
    input_file: job.file.name,
    doi: resolvedDoi || 'Not reported',
    journal_name: mergedBase.journal_name || 'Not reported',
    article_title: mergedBase.article_title || 'Not reported',
    authors: mergedBase.authors || 'Not reported',
    affiliation_department: mergedBase.affiliation_department || 'Not reported',
    affiliation_college: mergedBase.affiliation_college || 'Not reported',
    affiliation_university: mergedBase.affiliation_university || 'Not reported',
    affiliation_city: mergedBase.affiliation_city || 'Not reported',
    affiliation_country: mergedBase.affiliation_country || 'Not reported',
    orcid_ids: mergedBase.orcid_ids || 'Not reported',
    publisher: mergedBase.publisher || 'Not reported',
    publisher_country: mergedBase.publisher_country || 'Not reported',
    issn_e: mergedBase.issn_e || '',
    issn_p: mergedBase.issn_p || '',
    special_issue: mergedBase.special_issue || 'Not reported',
    study_design: mergedBase.study_design || 'Not reported',
    reporting_guidelines_claimed: mergedBase.reporting_guidelines_claimed || 'Not reported',
    reporting_guidelines_followed: mergedBase.reporting_guidelines_followed || 'Not reported',
    reporting_guidelines_missing_items: mergedBase.reporting_guidelines_missing_items || 'Not reported',
    ethics_approval: mergedBase.ethics_approval || 'Not reported',
    trial_registration: mergedBase.trial_registration || 'Not reported',
    protocol_registration: mergedBase.protocol_registration || 'Not reported',
    received_to_accepted_days: mergedBase.received_to_accepted_days || 'Not reported',
    accepted_to_published_days: mergedBase.accepted_to_published_days || 'Not reported',
    funding: mergedBase.funding || 'Not reported',
    journal_self_citation: mergedBase.journal_self_citation || 'Not reported',
    scientific_syntax_quality: mergedBase.scientific_syntax_quality || 'Not reported',
    scientific_syntax_errors: mergedBase.scientific_syntax_errors || 'Not reported',
    pubmed: indexing.pubmed,
    pmc: indexing.pmc,
    medline: indexing.medline,
    scopus: indexing.scopus,
    embase: indexing.embase,
    doaj: indexing.doaj,
    hallucinated_references: mergedBase.hallucinated_references || 'Not reported',
    tortured_phrases: mergedBase.tortured_phrases || 'Not reported',
    indexing_notes: indexing.notes || '',
  };

  if (apiKey && text.trim().length > 0) {
    try {
      const analyzed = await analyzeManuscript({
        apiKey,
        model,
        doi: resolvedDoi,
        baseMeta: {
          ...mergedBase,
          ...indexing,
        },
        text,
        url,
      });
      result = {
        ...result,
        ...analyzed,
        ...indexing,
        input_file: job.file.name,
        doi: resolvedDoi || analyzed.doi || 'Not reported',
      };
    } catch (err) {
      log(`Gemini analysis failed for ${job.file.name}: ${err.message}`);
    }
  }

  return standardizeRow(result);
}

function renderTable(rows) {
  const thead = el('resultsTable').querySelector('thead');
  const tbody = el('resultsTable').querySelector('tbody');
  thead.innerHTML = '';
  tbody.innerHTML = '';

  el('resultsCount').textContent = `${rows.length} row${rows.length === 1 ? '' : 's'}`;
  if (!rows.length) {
    el('downloadCsv').disabled = true;
    el('downloadXlsx').disabled = true;
    return;
  }

  const headers = Object.keys(rows[0]);
  thead.innerHTML = `<tr>${headers.map((h) => `<th>${h.replace(/_/g, ' ')}</th>`).join('')}</tr>`;
  tbody.innerHTML = rows.map((row) => `<tr>${headers.map((h) => `<td>${String(row[h] ?? '')}</td>`).join('')}</tr>`).join('');

  el('downloadCsv').disabled = false;
  el('downloadXlsx').disabled = false;
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function csvEscape(value) {
  const s = String(value ?? '');
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function toCsv(rows) {
  if (!rows.length) return '';
  const headers = Object.keys(rows[0]);
  const lines = [headers.join(',')];
  for (const row of rows) {
    lines.push(headers.map((h) => csvEscape(row[h] ?? '')).join(','));
  }
  return lines.join('\n');
}

async function downloadCsv(rows) {
  const csv = toCsv(rows);
  downloadBlob(new Blob([csv], { type: 'text/csv;charset=utf-8' }), 'pqrs_results.csv');
}

async function downloadXlsx(rows) {
  await ensureXlsx();
  const worksheet = globalThis.XLSX.utils.json_to_sheet(rows);
  const workbook = globalThis.XLSX.utils.book_new();
  globalThis.XLSX.utils.book_append_sheet(workbook, worksheet, 'PQRS');
  const array = globalThis.XLSX.write(workbook, { bookType: 'xlsx', type: 'array' });
  downloadBlob(
    new Blob([array], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
    'pqrs_results.xlsx'
  );
}

function loadSettings() {
  el('apiKey').value = localStorage.getItem(CONFIG.storageKeys.apiKey) || '';
  el('modelSelect').value = localStorage.getItem(CONFIG.storageKeys.model) || CONFIG.defaultModel;
  setTheme(localStorage.getItem(CONFIG.storageKeys.theme) || 'light');
}

function saveSettings() {
  localStorage.setItem(CONFIG.storageKeys.apiKey, el('apiKey').value.trim());
  localStorage.setItem(CONFIG.storageKeys.model, el('modelSelect').value);
  log('Settings saved in this browser.');
}

function clearSettings() {
  localStorage.removeItem(CONFIG.storageKeys.apiKey);
  localStorage.removeItem(CONFIG.storageKeys.model);
  localStorage.removeItem(CONFIG.storageKeys.theme);
  loadSettings();
  log('Settings cleared.');
}

function updateModeUi() {
  const mode = el('modeSelect').value;
  el('csvWrap').classList.toggle('hidden', mode !== 'batch');
}

async function runBatch() {
  if (state.busy) return;

  const apiKey = el('apiKey').value.trim();
  if (!apiKey) {
    alert('Please save a Gemini API key first.');
    return;
  }

  const pdfFiles = [...el('pdfInput').files];
  if (!pdfFiles.length) {
    alert('Please upload at least one PDF.');
    return;
  }

  if (pdfFiles.length > CONFIG.maxBatchFiles) {
    alert(`Please upload no more than ${CONFIG.maxBatchFiles} PDFs at a time.`);
    return;
  }

  state.busy = true;
  el('runBtn').disabled = true;
  setStatus('Running');
  el('log').textContent = '';
  state.rows = [];
  renderTable([]);

  try {
    const mode = el('modeSelect').value;
    const csvFile = el('csvInput').files[0];
    let csvRows = [];

    if (mode === 'batch' && csvFile) {
      const csvText = await csvFile.text();
      csvRows = parseCsv(csvText);
      log(`Parsed ${csvRows.length} CSV rows.`);
    }

    const jobs = buildBatchJobs({
      pdfFiles,
      csvRows,
      fallbackDoi: el('doiInput').value,
      fallbackUrl: el('urlInput').value,
    });

    if (!jobs.length) throw new Error('No batch jobs could be created from the uploaded files/CSV.');

    log(`Processing ${jobs.length} manuscript(s). Limit: ${CONFIG.maxBatchFiles}.`);
    const concurrency = getConcurrencyLimit();
    log(`Using up to ${concurrency} concurrent worker(s) for extraction.`);

    const results = [];
    let cursor = 0;

    async function workerLoop() {
      while (cursor < jobs.length) {
        const current = cursor;
        cursor += 1;
        const job = jobs[current];
        try {
          const res = await processSingleJob(job, current, jobs.length);
          results[current] = res;
          log(`Completed ${job.file.name}`);
        } catch (err) {
          results[current] = standardizeRow({
            input_file: job.file.name,
            doi: cleanDOI(job.doi || '') || 'Not reported',
            journal_name: 'Not reported',
            article_title: 'Not reported',
            authors: 'Not reported',
            affiliation_department: 'Not reported',
            affiliation_college: 'Not reported',
            affiliation_university: 'Not reported',
            affiliation_city: 'Not reported',
            affiliation_country: 'Not reported',
            orcid_ids: 'Not reported',
            publisher: 'Not reported',
            publisher_country: 'Not reported',
            special_issue: 'Not reported',
            study_design: 'Not reported',
            reporting_guidelines_claimed: 'Not reported',
            reporting_guidelines_followed: 'Not reported',
            reporting_guidelines_missing_items: 'Not reported',
            ethics_approval: 'Not reported',
            trial_registration: 'Not reported',
            protocol_registration: 'Not reported',
            received_to_accepted_days: 'Not reported',
            accepted_to_published_days: 'Not reported',
            funding: 'Not reported',
            journal_self_citation: 'Not reported',
            scientific_syntax_quality: 'Not reported',
            scientific_syntax_errors: 'Not reported',
            pubmed: 'Not reported',
            pmc: 'Not reported',
            medline: 'Not reported',
            scopus: 'Not reported',
            embase: 'Not reported',
            doaj: 'Not reported',
            hallucinated_references: 'Not reported',
            tortured_phrases: 'Not reported',
            indexing_notes: err?.message || String(err),
          });
          log(`Error in ${job.file.name}: ${err?.message || err}`);
        }
      }
    }

    const n = Math.min(concurrency, jobs.length);
    await Promise.all(Array.from({ length: n }, () => workerLoop()));

    state.rows = results.filter(Boolean);
    renderTable(state.rows);
    log('All jobs finished.');
    setStatus('Done');
  } catch (err) {
    console.error(err);
    log(`Fatal error: ${err?.message || err}`);
    setStatus('Error');
    alert(err?.message || String(err));
  } finally {
    state.busy = false;
    el('runBtn').disabled = false;
  }
}

function wireEvents() {
  el('themeToggle').addEventListener('click', () => {
    const current = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    setTheme(current);
  });

  el('saveSettings').addEventListener('click', saveSettings);
  el('clearSettings').addEventListener('click', clearSettings);
  el('modeSelect').addEventListener('change', updateModeUi);
  el('runBtn').addEventListener('click', runBatch);
  el('downloadCsv').addEventListener('click', () => downloadCsv(state.rows));
  el('downloadXlsx').addEventListener('click', () => downloadXlsx(state.rows));
}

try {
  loadSettings();
  updateModeUi();
  wireEvents();
  log('PQRS loaded. Ready for PDF and DOI extraction.');
} catch (err) {
  console.error(err);
  const area = el('log');
  if (area) area.textContent = `Initialization error: ${err?.message || err}`;
  const badge = el('statusBadge');
  if (badge) badge.textContent = 'Initialization error';
}
