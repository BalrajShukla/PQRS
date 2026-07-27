import { CONFIG } from './config.js';
import { cleanDOI, normalizeSpaces, parseMaybeJson, toCsv, splitSemicolonList, safeString, semicolonListFromArray, scoreSyntax, downloadBlob, delay } from './utils.js';
import { resolveBaseMetadata, fetchPubMedArticleByDoi, fetchPmcByDoi, fetchNlmCatalogByJournal } from './metadata.js';
import { extractPdfText } from './pdf.js';
import { ocrPdf } from './ocr.js';
import { analyzeManuscript } from './analysis.js';
import { parseBatchCsv, buildBatchJobs, readFileArrayBuffer, getConcurrencyLimit } from './batch.js';
import { checkIndexing } from './indexing.js';
import { downloadCsv, downloadXlsx } from './export.js';

pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.8.69/pdf.worker.min.js';

const el = (id) => document.getElementById(id);
const state = {
  rows: [],
  busy: false,
  workerPool: [],
};

function log(msg) {
  const area = el('log');
  const line = `[${new Date().toLocaleTimeString()}] ${msg}`;
  area.textContent += (area.textContent ? '\n' : '') + line;
  area.scrollTop = area.scrollHeight;
}

function setStatus(text) {
  el('statusBadge').textContent = text;
}

function setTheme(theme) {
  document.documentElement.dataset.theme = theme;
  localStorage.setItem(CONFIG.storageKeys.theme, theme);
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
}

function updateModeUi() {
  const mode = el('modeSelect').value;
  el('csvWrap').classList.toggle('hidden', mode !== 'batch');
  el('urlWrap').classList.toggle('hidden', false);
}

function renderTable(rows) {
  const thead = el('resultsTable').querySelector('thead');
  const tbody = el('resultsTable').querySelector('tbody');
  thead.innerHTML = '';
  tbody.innerHTML = '';
  el('resultsCount').textContent = `${rows.length} row${rows.length === 1 ? '' : 's'}`;
  if (!rows.length) return;
  const headers = Object.keys(rows[0]);
  thead.innerHTML = `<tr>${headers.map(h => `<th>${h.replace(/_/g, ' ')}</th>`).join('')}</tr>`;
  tbody.innerHTML = rows.map(r => `<tr>${headers.map(h => `<td>${String(r[h] ?? '')}</td>`).join('')}</tr>`).join('');
  el('downloadCsv').disabled = false;
  el('downloadXlsx').disabled = false;
}

async function runWorkerExtraction(arrayBuffer) {
  return new Promise((resolve, reject) => {
    const worker = new Worker('./js/worker.js');
    const id = crypto.randomUUID();
    worker.onmessage = (event) => {
      if (event.data.id !== id) return;
      worker.terminate();
      if (event.data.ok) resolve(event.data.result);
      else reject(new Error(event.data.error));
    };
    worker.onerror = (err) => {
      worker.terminate();
      reject(err.error || new Error(err.message || 'Worker failed'));
    };
    worker.postMessage({ id, arrayBuffer }, [arrayBuffer]);
  });
}

async function processSingleJob(job, idx, total) {
  const apiKey = el('apiKey').value.trim();
  const model = el('modelSelect').value;
  const doi = cleanDOI(job.doi || el('doiInput').value);
  const url = normalizeSpaces(job.url || el('urlInput').value);

  log(`(${idx + 1}/${total}) Loading ${job.file.name}`);
  const buffer = await readFileArrayBuffer(job.file);
  const extracted = await runWorkerExtraction(buffer.slice(0));
  let text = extracted.text || '';
  if (extracted.needsOCR || text.length < 1000) {
    log(`(${idx + 1}/${total}) OCR fallback for ${job.file.name}`);
    text = await ocrPdf(buffer, { pages: [1, 2] });
  }

  log(`(${idx + 1}/${total}) Fetching DOI metadata`);
  const base = await resolveBaseMetadata({ doi, url });
  const pubmed = await fetchPubMedArticleByDoi(base.doi).catch(() => ({ found: false, count: 0 }));
  const pmc = await fetchPmcByDoi(base.doi).catch(() => ({ found: false, count: 0 }));
  const catalog = await fetchNlmCatalogByJournal(base.journalName).catch(() => null);
  const result = await analyzeManuscript({ apiKey, model, doi: base.doi, doiMeta: base, text, url });
  const indexing = await checkIndexing({ doi: base.doi, journalName: base.journalName, published: base.published });

  result.pubmed_indexed_at_publication = indexing.pubmed;
  result.pmc_indexed_at_publication = indexing.pmc;
  result.medline_indexed_at_publication = indexing.medline;
  result.scopus_indexed_at_publication = indexing.scopus;
  result.embase_indexed_at_publication = indexing.embase;
  result.doaj_indexed_at_publication = indexing.doaj;
  result.indexing_notes = indexing.notes || '';
  result.input_file = job.file.name;
  result.pubmed_count = pubmed.count ?? 0;
  result.pmc_count = pmc.count ?? 0;
  result.nlm_catalog_hits = catalog?.count ?? 0;
  return result;
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
      csvRows = parseBatchCsv(csvText);
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
        const current = cursor++;
        const job = jobs[current];
        try {
          const res = await processSingleJob(job, current, jobs.length);
          results[current] = res;
          log(`Completed ${job.file.name}`);
        } catch (err) {
          results[current] = { input_file: job.file.name, error: err?.message || String(err) };
          log(`Error in ${job.file.name}: ${err?.message || err}`);
        }
      }
    }

    await Promise.all(Array.from({ length: Math.min(concurrency, jobs.length) }, workerLoop));
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

loadSettings();
updateModeUi();
wireEvents();
log('PQRS loaded. Ready for PDF and DOI extraction.');
