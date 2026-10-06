import { analyzeDeliveryImage } from './deliveryOcr';
import { InventoryError } from '../domain/stockService';
import { normalizeIdentity } from './deliveryService';
import { checkPdfPages } from './deliveryPdf';

type Reading = Awaited<ReturnType<typeof analyzeDeliveryImage>>;
export async function analyzeDeliveryPages(pageCount: number, render: (page: number, signal: AbortSignal) => Promise<HTMLCanvasElement>,
  signal: AbortSignal, progress: (message: string) => void, analyze = analyzeDeliveryImage) {
  checkPdfPages(pageCount);
  const result: { lines: (Reading['lines'][number] & { sourcePage: number })[]; metadata: Reading['metadata']; emptyPages: number[] } = { lines: [], metadata: { deliveryNumber: '', supplier: '', deliveryDate: '', declaredColli: undefined }, emptyPages: [] };
  for (let number = 1; number <= pageCount; number++) {
    if (signal.aborted) throw new DOMException('Geannuleerd', 'AbortError');
    progress(`Pagina ${number} van ${pageCount}: openen…`);
    const canvas = await render(number, signal);
    try {
      const page = await analyze(canvas, signal, message => progress(`Pagina ${number} van ${pageCount}: ${message}`));
      if (signal.aborted) throw new DOMException('Geannuleerd', 'AbortError');
      // Conflicting references must never silently turn separate deliveries into one receipt.
      for (const key of ['deliveryNumber', 'supplier', 'deliveryDate'] as const) {
        const previous = result.metadata[key]; const next = page.metadata[key];
        if (previous && next && normalizeIdentity(previous) !== normalizeIdentity(next)) throw new InventoryError('De PDF bevat verschillende leveringsgegevens. Controleer of dit meerdere pakbonnen zijn en upload iedere pakbon afzonderlijk.');
        if (next) result.metadata[key] = next;
      }
      // A stated total may repeat on every page; it must not be summed automatically.
      if (page.metadata.declaredColli !== undefined && result.metadata.declaredColli === undefined) result.metadata.declaredColli = page.metadata.declaredColli;
      result.lines.push(...page.lines.map(line => ({ ...line, sourcePage: number })));
      if (!page.lines.length) result.emptyPages.push(number);
    } finally { canvas.width = 0; canvas.height = 0; }
  }
  return result;
}
