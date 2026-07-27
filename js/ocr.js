import { normalizeSpaces } from './utils.js';
import { renderPageToCanvas } from './pdf.js';

export async function ocrPdf(arrayBuffer, { pages = [1, 2] } = {}) {
  if (!window.Tesseract) throw new Error('Tesseract.js was not loaded');
  let text = '';
  for (const p of pages) {
    const canvas = await renderPageToCanvas(arrayBuffer, p, 1.6);
    const { data } = await Tesseract.recognize(canvas, 'eng', {
      logger: () => {},
    });
    text += `\n\n--- OCR PAGE ${p} ---\n\n${data.text || ''}`;
  }
  return normalizeSpaces(text);
}
