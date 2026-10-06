/// <reference types="node" />
import path from 'node:path';
import fs from 'node:fs/promises';
import { createCanvas, loadImage, type Canvas } from '@napi-rs/canvas';
import { createWorker } from 'tesseract.js';
import { describe, it, expect, vi } from 'vitest';
import { checkDocumentFile, checkPdfPages, renderPdfPage } from '../delivery/deliveryPdf';
import { analyzeDeliveryPages } from '../delivery/deliveryDocumentOcr';
import { readWithWorker } from '../delivery/deliveryOcr';
import { parseMetadata, parseDeliveryRows } from '../delivery/deliveryParser';

// Small valid documents generated entirely from fictitious data, including binary scan streams.
function testPdf(pages: ({ text: string[] } | { jpeg: Buffer; width: number; height: number })[]): Uint8Array {
  const objects: Buffer[] = [];
  const add = (value: string | Buffer) => { objects.push(typeof value === 'string' ? Buffer.from(value) : value); return objects.length; };
  add('<< /Type /Catalog /Pages 2 0 R >>'); add('');
  const font = add('<< /Type /Font /Subtype /Type1 /BaseFont /Courier >>');
  const ids: number[] = [];
  const stream = (dictionary: string, bytes: Buffer) => Buffer.concat([Buffer.from(`<< ${dictionary} /Length ${bytes.length} >>\nstream\n`), bytes, Buffer.from('\nendstream')]);
  for (const page of pages) {
    let content: string; let resources = `/Font << /F1 ${font} 0 R >>`;
    if ('text' in page) {
      content = `BT /F1 14 Tf 35 700 Td 26 TL ${page.text.map((line, i) => `${i ? 'T* ' : ''}(${line.replace(/[()\\]/g, '\\$&')}) Tj`).join('\n')} ET`;
    } else {
      const image = add(stream(`/Type /XObject /Subtype /Image /Width ${page.width} /Height ${page.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode`, page.jpeg));
      resources += ` /XObject << /Scan ${image} 0 R >>`;
      content = 'q 612 0 0 408 0 192 cm /Scan Do Q';
    }
    const contents = add(stream('', Buffer.from(content)));
    ids.push(add(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << ${resources} >> /Contents ${contents} 0 R >>`));
  }
  objects[1] = Buffer.from(`<< /Type /Pages /Count ${ids.length} /Kids [${ids.map(id => `${id} 0 R`).join(' ')}] >>`);
  const chunks = [Buffer.from('%PDF-1.4\n')]; const offsets = [0]; let size = chunks[0].length;
  objects.forEach((object, i) => { offsets.push(size); const chunk = Buffer.concat([Buffer.from(`${i+1} 0 obj\n`), object, Buffer.from('\nendobj\n')]); chunks.push(chunk); size += chunk.length; });
  chunks.push(Buffer.from(`xref\n0 ${objects.length+1}\n0000000000 65535 f \n${offsets.slice(1).map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${objects.length+1} /Root 1 0 R >>\nstartxref\n${size}\n%%EOF`));
  return new Uint8Array(Buffer.concat(chunks));
}
const rows = ['Pakbon: PDF-TEST-01', 'Leverancier: Fictieve leverancier', 'Leverdatum: 06-10-2026', '1 COL 760364 TENA Discreet Mini 6x30p'];
const reading = (text = rows) => ({ lines: parseDeliveryRows(text).map(line => ({ ...line, secondReading: { ...line } })), metadata: parseMetadata(text) });
const control = () => new AbortController();
const dummy = () => ({ width: 2400, height: 1800 }) as HTMLCanvasElement;

describe('PDF-controle en complete verwerking', () => {
  it('herkent PDF en afbeeldingen en controleert bestandsgrootte en paginalimiet', () => {
    expect(checkDocumentFile({ name: 'pakbon.PDF', type: '', size: 20 * 1024 * 1024 })).toBe('pdf');
    expect(checkDocumentFile({ name: 'scan.jfif', type: '', size: 123 })).toBe('image');
    expect(() => checkDocumentFile({ name: 'pakbon.pdf', type: 'application/pdf', size: 20 * 1024 * 1024 + 1 })).toThrow('20 MB');
    expect(() => checkDocumentFile({ name: 'document.docx', type: '', size: 10 })).toThrow('Kies een PDF');
    expect(() => checkPdfPages(10)).not.toThrow(); expect(() => checkPdfPages(11)).toThrow('maximum'); expect(() => checkPdfPages(0)).toThrow('geen leesbare');
  });
  it('neemt iedere pagina en iedere artikelherhaling mee, met paginanummer, zonder totaal te verdubbelen', async () => {
    const canvases = [dummy(), dummy()]; const render = vi.fn(async (page: number) => canvases[page-1]);
    const analyze = vi.fn().mockResolvedValue(reading([...rows, 'Aantal colli: 2']));
    const result = await analyzeDeliveryPages(2, render, control().signal, vi.fn(), analyze);
    expect(result.lines.map(line => [line.articleNumber, line.sourcePage])).toEqual([['760364', 1], ['760364', 2]]);
    expect(result.metadata.declaredColli).toBe(2); expect(canvases.every(canvas => canvas.width === 0)).toBe(true);
  });
  it('meldt een pagina zonder herkende producten voor handmatige controle', async () => {
    const analyze = vi.fn().mockResolvedValueOnce(reading()).mockResolvedValueOnce(reading(['Bijlage']));
    const result = await analyzeDeliveryPages(2, async () => dummy(), control().signal, vi.fn(), analyze);
    expect(result.emptyPages).toEqual([2]); expect(result.lines).toHaveLength(1);
  });
  it('geeft geen deelresultaat bij een fout op een latere pagina en geeft canvasgeheugen vrij', async () => {
    const canvases = [dummy(), dummy()]; const analyze = vi.fn().mockResolvedValueOnce(reading()).mockRejectedValueOnce(new Error('Onleesbaar'));
    await expect(analyzeDeliveryPages(2, async number => canvases[number-1], control().signal, vi.fn(), analyze)).rejects.toThrow('Onleesbaar');
    expect(canvases.every(canvas => canvas.width === 0)).toBe(true);
  });
  it('annuleren verwerkt geen volgende pagina', async () => {
    const abort = control(); const render = vi.fn(async () => dummy());
    const analyze = vi.fn(async () => { abort.abort(); return reading(); });
    await expect(analyzeDeliveryPages(2, render, abort.signal, vi.fn(), analyze)).rejects.toThrow('Geannuleerd');
    expect(render).toHaveBeenCalledOnce();
  });
  it('weigert het samenvoegen van verschillende pakbonnummers', async () => {
    const analyze = vi.fn().mockResolvedValueOnce(reading()).mockResolvedValueOnce(reading(['Pakbon: ANDERE-BON', rows[3]]));
    await expect(analyzeDeliveryPages(2, async () => dummy(), control().signal, vi.fn(), analyze)).rejects.toThrow('verschillende leveringsgegevens');
  });
});

describe('Werkelijke PDF.js-rendering gevolgd door Tesseract OCR', () => {
  async function recognizePdf(bytes: Uint8Array) {
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const task = pdfjs.getDocument({ data: bytes, standardFontDataUrl: `${path.resolve('node_modules/pdfjs-dist/standard_fonts')}/`, stopAtErrors: true });
    const pdf = await task.promise;
    vi.stubGlobal('document', { createElement: () => createCanvas(1, 1) });
    const worker = await createWorker('nld', 1, { langPath: path.resolve('public/ocr/language'), cacheMethod: 'none' });
    try {
      return await analyzeDeliveryPages(pdf.numPages, (number, signal) => renderPdfPage(pdf, number, signal), control().signal, vi.fn(),
        async canvas => readWithWorker(worker, (canvas as unknown as Canvas).toBuffer('image/png'), canvas.width, canvas.height));
    } finally { vi.unstubAllGlobals(); await worker.terminate(); await task.destroy(); }
  }
  it('leest een tekst-PDF van twee pagina’s inclusief beide productregels', async () => {
    const result = await recognizePdf(testPdf([{ text: rows }, { text: ['Pakbon: PDF-TEST-01', '2 COL 750651 TENA Men Level 1 6x24p'] }]));
    expect(result.lines.map(line => [line.articleNumber, line.quantityText, line.sourcePage])).toEqual([['760364', '1', 1], ['750651', '2', 2]]);
    expect(result.metadata.deliveryNumber).toBe('PDF-TEST-01'); expect(result.emptyPages).toEqual([]);
  }, 60000);
  it('leest ook een PDF met uitsluitend een gescande afbeelding', async () => {
    const image = await loadImage(await fs.readFile('src/tests/fixtures/delivery/clear.png'));
    const scan = createCanvas(image.width, image.height); scan.getContext('2d').drawImage(image, 0, 0);
    const result = await recognizePdf(testPdf([{ jpeg: scan.toBuffer('image/jpeg'), width: scan.width, height: scan.height }]));
    expect(result.lines.map(line => [line.articleNumber, line.quantityText])).toEqual([['760364', '1'], ['750651', '3'], ['761531', '1']]);
  }, 60000);
  it('weigert een beschadigd PDF-bestand', async () => {
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs'); const task = pdfjs.getDocument({ data: new TextEncoder().encode('Geen PDF') });
    try { await expect(task.promise).rejects.toThrow(); } finally { await task.destroy(); }
  });
});
