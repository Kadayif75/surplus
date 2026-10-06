import type { ImageLike, Worker, Page, PSM } from 'tesseract.js';
import { parseDeliveryRows, parseMetadata, reconcileReadings, spatialRows, type OcrWord } from './deliveryParser';

export function wordsFromPage(page: Pick<Page, 'blocks'>): OcrWord[] {
  return page.blocks?.flatMap(b => b.paragraphs.flatMap(p => p.lines.flatMap(l => l.words))) ?? [];
}
export async function readWithWorker(worker: Worker, image: ImageLike, width: number, height: number, progress: (message: string) => void = () => {}, wait: <T>(promise: Promise<T>) => Promise<T> = promise => promise) {
  if (width < 1 || height < 1) throw new Error('Afbeelding ontbreekt');
  progress('Eerste uitlezing: volledige pakbon…');
  await wait(worker.setParameters({ tessedit_pageseg_mode: '3' as PSM, preserve_interword_spaces: '1' }));
  const first = await wait(worker.recognize(image, {}, { text: true, blocks: true }));
  const words = wordsFromPage(first.data);
  const firstRows = words.length ? spatialRows(words) : first.data.text.split('\n');
  progress('Tweede uitlezing: andere herkenning van de tabelindeling…');
  await wait(worker.setParameters({ tessedit_pageseg_mode: '4' as PSM }));
  const second = await wait(worker.recognize(image, {}, { text: true, blocks: true }));
  const secondWords = wordsFromPage(second.data);
  const secondRows = secondWords.length ? spatialRows(secondWords) : second.data.text.split('\n');
  const firstLines = parseDeliveryRows(firstRows);
  const secondLines = parseDeliveryRows(secondRows);
  const lines = reconcileReadings(firstLines, secondLines);
  for (const rawText of firstRows.filter(row => /TENA/i.test(row) && !firstLines.some(l => l.rawText === row))) {
    lines.push({ articleNumber: '', detectedProductName: rawText, quantityText: '', unit: 'onbekend', packsPerBoxText: '', piecesPerPackText: '', rawText, secondReading: undefined });
  }
  return { lines, metadata: parseMetadata(firstRows) };
}
export async function analyzeDeliveryImage(canvas: HTMLCanvasElement, signal: AbortSignal, progress: (message: string) => void) {
  const { createWorker } = await import('tesseract.js');
  if (signal.aborted) throw new DOMException('Geannuleerd', 'AbortError');
  const base = new URL(`${import.meta.env.BASE_URL}ocr/`, document.baseURI).href;
  let worker: Worker | undefined;
  let rejectAbort!: (error: Error) => void;
  const cancelled = new Promise<never>((_, reject) => { rejectAbort = reject; });
  const wait = <T,>(promise: Promise<T>) => Promise.race([promise, cancelled]);
  const abort = () => { rejectAbort(new DOMException('Geannuleerd', 'AbortError')); };
  signal.addEventListener('abort', abort, { once: true });
  try {
    progress('Tekstherkenning op dit apparaat laden…');
    const loading = createWorker('nld', 1, { workerPath: `${base}worker.min.js`, corePath: `${base}core`, langPath: `${base}language`, cacheMethod: 'none' });
    void loading.then(late => { if (signal.aborted) void late.terminate(); }).catch(() => {});
    worker = await wait(loading);
    if (signal.aborted) throw new DOMException('Geannuleerd', 'AbortError');
    const result = await readWithWorker(worker, canvas, canvas.width, canvas.height, progress, wait);
    if (signal.aborted) throw new DOMException('Geannuleerd', 'AbortError');
    return result;
  } finally {
    signal.removeEventListener('abort', abort);
    await worker?.terminate();
  }
}
