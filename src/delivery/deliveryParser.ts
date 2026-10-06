import type { ParsedDeliveryLine } from './types';

export interface OcrWord { text: string; bbox: { x0: number; x1: number; y0: number; y1: number } }
// Reunite columns using their physical row positions, not the order of OCR blocks.
export function spatialRows(words: OcrWord[]): string[] {
  const groups: { y: number; height: number; words: OcrWord[] }[] = [];
  for (const word of [...words].sort((a, b) => (a.bbox.y0 + a.bbox.y1) / 2 - (b.bbox.y0 + b.bbox.y1) / 2)) {
    const y = (word.bbox.y0 + word.bbox.y1) / 2;
    const height = word.bbox.y1 - word.bbox.y0;
    const group = groups.find(g => Math.abs(g.y - y) <= Math.max(4, Math.min(g.height, height) * .55));
    if (group) group.words.push(word);
    else groups.push({ y, height, words: [word] });
  }
  return groups.map(g => g.words.sort((a, b) => a.bbox.x0 - b.bbox.x0).map(w => w.text).join(' '));
}
export function parseDeliveryLine(rawText: string): ParsedDeliveryLine | undefined {
  // Never strip suffixes from supplier article numbers or repair digit substitutions.
  const article = /\b(\d{5,10})\s+((?:TENA\b).*)/i.exec(rawText)
    ?? /\b(\d{5,10})\s+([^|]*[a-z][^|]*)/i.exec(rawText);
  if (!article) return undefined;
  const prefix = rawText.slice(0, article.index).replace(/[|]/g, ' ').trim();
  const before = /(?:^|\s)(-?\d+(?:[.,]\d+)?)\s*(COL|DOOS|DOZEN|VERPAKKING(?:EN)?|PAK(?:KEN)?|PACKS?)\s*$/i.exec(prefix);
  const after = /\s+(-?\d+(?:[.,]\d+)?)\s*(COL|DOOS|DOZEN|VERPAKKING(?:EN)?|PAK(?:KEN)?|PACKS?)\s*$/i.exec(article[2]);
  const quantity = before ?? after;
  const packaging = /\b(\d+)\s*[x×]\s*(\d+)\s*(?:p\b|pcs\b|st(?:uks)?\b)/i.exec(article[2]);
  const detectedProductName = article[2].slice(0, packaging?.index ?? after?.index ?? article[2].length).trim();
  const unitText = quantity?.[2].toUpperCase();
  return {
    articleNumber: article[1], detectedProductName, quantityText: quantity?.[1] ?? '',
    unit: unitText ? /^(COL|DOOS|DOZEN)$/.test(unitText) ? 'COL' : 'verpakking' : 'onbekend',
    packsPerBoxText: packaging?.[1] ?? '', piecesPerPackText: packaging?.[2] ?? '', rawText,
  };
}
export function parseDeliveryRows(rows: string[]) {
  return rows.map(parseDeliveryLine).filter((line): line is ParsedDeliveryLine => !!line);
}
export function sameReading(a: ParsedDeliveryLine, b?: ParsedDeliveryLine): boolean {
  if (!b) return false;
  return a.articleNumber === b.articleNumber && a.quantityText === b.quantityText && a.unit === b.unit &&
    a.packsPerBoxText === b.packsPerBoxText && a.piecesPerPackText === b.piecesPerPackText &&
    a.detectedProductName.toLowerCase().replace(/\W/g, '') === b.detectedProductName.toLowerCase().replace(/\W/g, '');
}
export function reconcileReadings(first: ParsedDeliveryLine[], second: ParsedDeliveryLine[]) {
  // Keep every occurrence. Repeated articles must be reviewed; never deduplicate stock silently.
  const available = [...second];
  const lines = first.map(line => {
    const index = available.findIndex(other => other.articleNumber === line.articleNumber);
    return { ...line, secondReading: index < 0 ? undefined : available.splice(index, 1)[0] };
  });
  for (const line of available) lines.push({ ...line, secondReading: undefined });
  return lines;
}
export function parseMetadata(rows: string[]) {
  const text = rows.join('\n');
  const deliveryNumber = /(?:pakbon(?:nummer|nr\.?)?|leveringsnummer)\s*[:#]?\s*([a-z0-9][a-z0-9\-/]+)/i.exec(text)?.[1] ?? '';
  const supplier = /(?:afzender|leverancier)\s*[:]?\s*(.+)/i.exec(text)?.[1]?.trim() ?? '';
  const date = /\b(?:afleverdatum|leverdatum)\s*[:]?\s*(\d{1,2})[-/](\d{1,2})[-/](\d{4})/i.exec(text)
    ?? /\bdatum\s*[:]?\s*(\d{1,2})[-/](\d{1,2})[-/](\d{4})/i.exec(text);
  const deliveryDate = date ? `${date[3]}-${date[2].padStart(2, '0')}-${date[1].padStart(2, '0')}` : '';
  const colli = /aantal\s+colli\s*[:]?\s*(\d+)/i.exec(text)?.[1];
  return { deliveryNumber, supplier, deliveryDate, declaredColli: colli ? Number(colli) : undefined };
}
