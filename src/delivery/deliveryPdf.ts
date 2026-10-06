import type { PDFDocumentProxy } from 'pdfjs-dist';
import { InventoryError } from '../domain/stockService';

export const MAX_DOCUMENT_BYTES = 20 * 1024 * 1024;
export const MAX_PDF_PAGES = 10;
export interface DeliveryPdf {
  pageCount: number;
  renderPage: (pageNumber: number, signal: AbortSignal) => Promise<HTMLCanvasElement>;
  destroy: () => Promise<void>;
}
export function checkDocumentFile(file: Pick<File, 'name' | 'type' | 'size'>): 'pdf' | 'image' {
  if (file.size > MAX_DOCUMENT_BYTES) throw new InventoryError('Dit bestand is groter dan 20 MB. Kies een kleiner bestand.');
  if (file.type === 'application/pdf' || /\.pdf$/i.test(file.name)) return 'pdf';
  if (file.type.startsWith('image/') || /\.(jpe?g|jfif|png|webp)$/i.test(file.name)) return 'image';
  throw new InventoryError('Kies een PDF of afbeelding (JPG, PNG of WebP).');
}
export function checkPdfPages(count: number) {
  if (!Number.isSafeInteger(count) || count < 1) throw new InventoryError('Deze PDF bevat geen leesbare pagina’s.');
  if (count > MAX_PDF_PAGES) throw new InventoryError(`Deze PDF heeft ${count} pagina’s. Het maximum is ${MAX_PDF_PAGES} pagina’s per pakbon. Splits het bestand per levering.`);
}
export async function openDeliveryPdf(bytes: Uint8Array, signal: AbortSignal): Promise<DeliveryPdf> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const { default: workerUrl } = await import('pdfjs-dist/legacy/build/pdf.worker.min.mjs?url');
  if (signal.aborted) throw new DOMException('Geannuleerd', 'AbortError');
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
  const base = new URL(`${import.meta.env.BASE_URL}pdfjs/`, document.baseURI).href;
  const task = pdfjs.getDocument({ data: bytes, stopAtErrors: true,
    cMapUrl: `${base}cmaps/`, standardFontDataUrl: `${base}standard_fonts/`,
    wasmUrl: `${base}wasm/`, iccUrl: `${base}iccs/`, canvasMaxAreaInBytes: 24 * 1024 * 1024 });
  let disposed = false;
  const destroy = async () => { if (!disposed) { disposed = true; signal.removeEventListener('abort', abort); await task.destroy(); } };
  const abort = () => { void destroy().catch(() => {}); };
  signal.addEventListener('abort', abort, { once: true });
  try {
    const pdf = await task.promise;
    if (signal.aborted) throw new DOMException('Geannuleerd', 'AbortError');
    checkPdfPages(pdf.numPages);
    return { pageCount: pdf.numPages, renderPage: (number, control) => renderPdfPage(pdf, number, control), destroy };
  } catch (e) {
    await destroy();
    if (signal.aborted) throw new DOMException('Geannuleerd', 'AbortError');
    if (e instanceof InventoryError) throw e;
    if (e instanceof Error && e.name === 'PasswordException') throw new InventoryError('Deze PDF is beveiligd met een wachtwoord. Upload een onbeveiligde kopie.');
    throw new InventoryError('Deze PDF kan niet worden geopend. Controleer of het bestand volledig en geldig is.');
  }
}
export async function renderPdfPage(pdf: Pick<PDFDocumentProxy, 'getPage'>, number: number, signal: AbortSignal): Promise<HTMLCanvasElement> {
  if (signal.aborted) throw new DOMException('Geannuleerd', 'AbortError');
  const page = await pdf.getPage(number);
  const canvas = document.createElement('canvas');
  let success = false;
  try {
    if (signal.aborted) throw new DOMException('Geannuleerd', 'AbortError');
    const natural = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({ scale: 2400 / Math.max(natural.width, natural.height) });
    canvas.width = Math.ceil(viewport.width); canvas.height = Math.ceil(viewport.height);
    const context = canvas.getContext('2d');
    if (!context) throw new InventoryError('Deze browser kan PDF-pagina’s niet tekenen.');
    const render = page.render({ canvas, canvasContext: context, viewport, background: '#ffffff' });
    const cancel = () => render.cancel();
    signal.addEventListener('abort', cancel, { once: true });
    try { if (signal.aborted) cancel(); await render.promise; }
    finally { signal.removeEventListener('abort', cancel); }
    if (signal.aborted) throw new DOMException('Geannuleerd', 'AbortError');
    success = true;
    return canvas;
  } finally { page.cleanup(); if (!success) { canvas.width = 0; canvas.height = 0; } }
}
