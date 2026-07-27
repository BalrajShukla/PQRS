function normalizeSpaces(value) {
  return String(value ?? '')
    .replace(/\u00a0/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/\s*\^\d+\s*/g, ' ')
    .replace(/\s*\[[^\]]*\]\s*/g, ' ')
    .replace(/\s*\([^)]*\d+[^)]*\)\s*/g, ' ')
    .trim();
}

self.onmessage = async (event) => {
  const { id, arrayBuffer } = event.data;
  try {
    importScripts('https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.8.69/pdf.min.js');
    pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.8.69/pdf.worker.min.js';
    const doc = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    const pages = Math.min(doc.numPages, 12);
    let fullText = '';
    for (let i = 1; i <= pages; i++) {
      const page = await doc.getPage(i);
      const content = await page.getTextContent();
      const pageText = content.items.map(it => it.str).join(' ');
      fullText += `\n\n--- PAGE ${i} ---\n\n${pageText}`;
    }
    const text = normalizeSpaces(fullText);
    self.postMessage({ id, ok: true, result: { text, pages, numPages: doc.numPages, needsOCR: text.length < 1000 } });
  } catch (err) {
    self.postMessage({ id, ok: false, error: err?.message || String(err) });
  }
};
