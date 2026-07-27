export async function extractPdfText(arrayBuffer, { maxPages = 12 } = {}) {
  const doc = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  const pages = Math.min(doc.numPages, maxPages);
  let fullText = '';
  for (let i = 1; i <= pages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    const pageText = content.items.map(it => it.str).join(' ');
    fullText += `\n\n--- PAGE ${i} ---\n\n` + pageText;
  }
  return { text: fullText.trim(), pages, numPages: doc.numPages };
}

export async function renderPageToCanvas(arrayBuffer, pageNumber = 1, scale = 1.4) {
  const doc = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  const page = await doc.getPage(pageNumber);
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  canvas.width = viewport.width;
  canvas.height = viewport.height;
  await page.render({ canvasContext: ctx, viewport }).promise;
  return canvas;
}
