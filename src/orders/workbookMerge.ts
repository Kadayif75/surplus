import type JSZip from 'jszip';
import { InventoryError } from '../domain/stockService';
import { hashBytes } from '../delivery/deliveryService';

const NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const START = 8;
export const MERGE_LOCATIONS = ['H1', 'H2', 'H3'] as const;
function fail(message: string): never { throw new InventoryError(message); }
const elements = (root: Document | Element, name: string) => [...root.getElementsByTagNameNS(NS, name)];
const child = (root: Element, name: string) => [...root.children].find(element => element.localName === name);
function parse(xml: string): Document {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length || /<!DOCTYPE/i.test(xml)) fail('Dit Excel-bestand kan niet worden gelezen. Kies een geldige kopie van het bewonersoverzicht.');
  return doc;
}
interface Sheet { path: string; doc: Document; cells: Map<string, Element>; rows: Map<number, Element>; shared: Map<string, { address: string; formula: string }> }
export interface MergeWorkbook { hash: string; zip: JSZip; workbook: Document; sheets: Map<string, Sheet>; strings: Element[]; weeks: number; orderUnit: 'doos' | 'verpakking'; endRow: number; residentRows: number[]; macroEnabled: boolean }
export interface MergeItem { key: string; articleNumber: string; name: string; packsPerBox: number; piecesPerPack: number; quantities: Record<string, number>; totalQuantity: number }
export interface MergedWorkbook { bytes: Uint8Array<ArrayBuffer>; items: MergeItem[]; residentCount: number; weeks: number; orderUnit: 'doos' | 'verpakking'; extension: 'xlsm' | 'xlsx'; sourceHashes: Record<string, string> }
function sheetModel(path: string, doc: Document): Sheet {
  const cells = new Map(elements(doc, 'c').map(cell => [cell.getAttribute('r')!, cell]));
  const rows = new Map(elements(doc, 'row').map(row => [Number(row.getAttribute('r')), row]));
  const shared = new Map<string, { address: string; formula: string }>();
  for (const [address, cell] of cells) { const formula = child(cell, 'f'); if (formula?.getAttribute('t') === 'shared' && formula.textContent) shared.set(formula.getAttribute('si')!, { address, formula: formula.textContent }); }
  return { path, doc, cells, rows, shared };
}
function value(source: MergeWorkbook, sheet: Sheet, address: string): string | number | undefined {
  const cell = sheet.cells.get(address); if (!cell) return undefined;
  const raw = child(cell, 'v')?.textContent;
  if (cell.getAttribute('t') === 's') return source.strings[Number(raw)]?.textContent ?? '';
  if (cell.getAttribute('t') === 'inlineStr') return child(cell, 'is')?.textContent ?? '';
  if (cell.getAttribute('t') === 'e') fail('Een van de bestanden bevat een Excel-fout. Laat Excel opnieuw berekenen en sla het bestand op.');
  if (raw !== undefined && raw !== null && raw !== '') return cell.getAttribute('t') === 'str' ? raw : Number(raw);
  const reference = /^'?Totaal'?!\$?([A-Z]+)\$?(\d+)$/.exec(child(cell, 'f')?.textContent ?? '');
  if (reference) return value(source, source.sheets.get('Totaal')!, `${reference[1]}${reference[2]}`);
  return undefined;
}
const residents = (source: MergeWorkbook) => source.sheets.get('Bewonersoverzicht')!;
const advice = (source: MergeWorkbook) => source.sheets.get('Adviesbestelling in weken')!;
const columns = (address: string) => /^\$?([A-Z]+)\$?(\d+)$/.exec(address)!;
function shiftFormula(formula: string, rowDelta: number, columnDelta = 0): string {
  const toIndex = (column: string) => [...column].reduce((sum, letter) => sum * 26 + letter.charCodeAt(0) - 64, 0);
  const toColumn = (index: number): string => index > 26 ? toColumn(Math.floor((index - 1) / 26)) + String.fromCharCode(65 + (index - 1) % 26) : String.fromCharCode(64 + index);
  return formula.split(/("(?:[^"]|"")*")/).map((part, index) => index % 2 ? part : part.replace(/(?<![A-Za-z0-9_])(\$?)([A-Z]{1,3})(\$?)([1-9]\d*)(?![A-Za-z0-9_])/g, (_, absoluteColumn: string, column: string, absoluteRow: string, row: string) => `${absoluteColumn}${absoluteColumn ? column : toColumn(toIndex(column) + columnDelta)}${absoluteRow}${Number(row) + (absoluteRow ? 0 : rowDelta)}`)).join('');
}
function formulaText(sheet: Sheet, cell: Element): string | undefined {
  const formula = child(cell, 'f'); if (!formula) return undefined;
  if (formula.textContent) return formula.textContent;
  if (formula.getAttribute('t') !== 'shared') return undefined;
  const master = sheet.shared.get(formula.getAttribute('si')!); if (!master) fail('De formule-indeling van een bestand is onvolledig. Sla het bestand opnieuw op in Excel.');
  const from = columns(master.address); const to = columns(cell.getAttribute('r')!);
  const index = (column: string) => [...column].reduce((sum, letter) => sum * 26 + letter.charCodeAt(0) - 64, 0);
  return shiftFormula(master.formula, Number(to[2]) - Number(from[2]), index(to[1]) - index(from[1]));
}
export async function readMergeWorkbook(bytes: ArrayBuffer): Promise<MergeWorkbook> {
  if (!bytes.byteLength || bytes.byteLength > 20 * 1024 * 1024) fail('Kies een Excel-bestand van maximaal 20 MB.');
  const { default: Zip } = await import('jszip'); let zip: JSZip;
  try { zip = await Zip.loadAsync(bytes); } catch { return fail('Dit bestand is geen leesbaar Excel-document. Kies een XLSM- of XLSX-kopie.'); }
  const read = async (path: string) => { const file = zip.file(path); if (!file) fail('De Excel-indeling is onvolledig. Gebruik het oorspronkelijke bewonersoverzicht.'); return file.async('string'); };
  const workbook = parse(await read('xl/workbook.xml')); const rels = parse(await read('xl/_rels/workbook.xml.rels'));
  const targets = new Map([...rels.documentElement.children].map(element => [element.getAttribute('Id'), element.getAttribute('Target')!]));
  const stringsXml = zip.file('xl/sharedStrings.xml');
  const strings = stringsXml ? elements(parse(await stringsXml.async('string')), 'si') : [];
  const sheets = new Map<string, Sheet>();
  for (const entry of elements(workbook, 'sheet')) {
    const name = entry.getAttribute('name')!;
    if (!['Bewonersoverzicht', 'Adviesbestelling in weken', 'Totaal'].includes(name)) continue;
    const target = targets.get(entry.getAttributeNS(REL, 'id'));
    if (!target) fail('Een vereist Excel-tabblad kan niet worden geopend.');
    const path = target.startsWith('/') ? target.slice(1) : `xl/${target.replace(/^\.\//, '')}`;
    sheets.set(name, sheetModel(path, parse(await read(path))));
  }
  if (sheets.size !== 3) fail('Gebruik drie bestanden met de oorspronkelijke tabbladen Bewonersoverzicht, Adviesbestelling in weken en Totaal.');
  const contentTypes = await read('[Content_Types].xml');
  const source: MergeWorkbook = { hash: await hashBytes(bytes), zip, workbook, sheets, strings, weeks: 0, orderUnit: 'doos', endRow: 0, residentRows: [], macroEnabled: !!zip.file('xl/vbaProject.bin') || contentTypes.includes('macroEnabled.main+xml') };
  const unit = String(value(source, advice(source), 'M9') ?? 'Dozen').toLowerCase();
  if (!['dozen', 'zakken'].includes(unit)) fail('De besteleenheid in de Excel is niet herkend. Gebruik Dozen of Zakken.');
  source.orderUnit = unit === 'dozen' ? 'doos' : 'verpakking';
  const weeks = value(source, advice(source), 'J4');
  if (typeof weeks !== 'number' || !Number.isSafeInteger(weeks) || weeks < 1 || weeks > 52) fail('Het aantal weken ontbreekt in een bestand. Vul dit in de Excel in en sla het bestand op.');
  source.weeks = weeks;
  const end = Number(/(\d+)$/.exec(elements(residents(source).doc, 'dimension')[0]?.getAttribute('ref') ?? '')?.[1]);
  if (end < 9 || end > 5000 || value(source, residents(source), 'A6') !== 'Naam:' || value(source, advice(source), 'A9') !== 'Art.nr.') fail('Deze Excel heeft een andere indeling dan het aangeleverde bewonersoverzicht.');
  source.endRow = end;
  for (let row = START; row < end; row += 2) {
    const present = [row, row + 1].some(number => ['A', 'C', 'D', ...Array.from({ length: 20 }, (_, i) => String.fromCharCode(70 + i))].some(column => { const entry = value(source, residents(source), `${column}${number}`); return entry !== undefined && String(entry).trim() !== '' && (['A', 'C', 'D'].includes(column) || entry !== 0); }));
    if (present) source.residentRows.push(row);
  }
  return source;
}
function dailyUse(source: MergeWorkbook, row: number): number | undefined {
  const sheet = advice(source); const cell = sheet.cells.get(`D${row}`); const formula = cell ? formulaText(sheet, cell) : undefined;
  const sum = /^SUMIF\(Bewonersoverzicht!\$?([A-Z]+):\$?\1,\$?B\$?\d+,Bewonersoverzicht!\$?([A-Z]+):\$?\2\)$/i.exec(formula ?? '');
  if (sum) {
    const key = String(value(source, sheet, `B${row}`) ?? '').toLowerCase(); let total = 0;
    for (let number = START; number <= source.endRow; number++) if (String(value(source, residents(source), `${sum[1].toUpperCase()}${number}`) ?? '').toLowerCase() === key) {
      const quantity = value(source, residents(source), `${sum[2].toUpperCase()}${number}`);
      if (quantity !== undefined && quantity !== '' && (typeof quantity !== 'number' || !Number.isFinite(quantity) || quantity < 0)) fail('Een bewonersregel bevat een ongeldig aantal stuks. Corrigeer dat in Excel.');
      total += typeof quantity === 'number' ? quantity : 0;
    }
    return total;
  }
  const result = value(source, sheet, `D${row}`);
  if (result === undefined || result === '') return undefined;
  if (typeof result !== 'number' || !Number.isFinite(result) || result < 0) fail('Een verbruikstotaal is ongeldig. Laat Excel opnieuw berekenen en sla het bestand op.');
  return result;
}
interface AdviceRow { row: number; key: string; articleNumber: string; name: string; packsPerBox: number; piecesPerPack: number; daily?: number; boxes: number; explicit: boolean }
function adviceRows(source: MergeWorkbook): AdviceRow[] {
  const result: AdviceRow[] = [];
  for (const row of advice(source).rows.keys()) {
    if (row < 10) continue;
    const article = value(source, advice(source), `A${row}`);
    if (article === undefined || article === 0 || !String(article).trim()) continue;
    const articleNumber = String(article).trim(); if (!/^\d{4,10}$/.test(articleNumber)) fail('Een artikelnummer in de bestellijst is ongeldig. Controleer het Excel-bestand.');
    const name = value(source, advice(source), `C${row}`); const packs = value(source, advice(source), `E${row}`); const pieces = value(source, advice(source), `F${row}`);
    if (typeof name !== 'string' || typeof packs !== 'number' || typeof pieces !== 'number' || !Number.isSafeInteger(packs) || packs < 1 || !Number.isSafeInteger(pieces) || pieces < 1) fail('Een product mist zijn naam of doosinhoud in de Excel.');
    const daily = dailyUse(source, row); const entered = value(source, advice(source), `M${row}`); const explicit = entered !== undefined && entered !== '';
    const boxes = explicit ? entered : daily === undefined ? 0 : Math.ceil(daily * 7 * source.weeks / (source.orderUnit === 'doos' ? packs * pieces : pieces));
    if (typeof boxes !== 'number' || !Number.isSafeInteger(boxes) || boxes < 0) fail('Een bestelaantal is ongeldig of niet berekend. Gebruik hele aantallen en sla de Excel opnieuw op.');
    result.push({ row, key: JSON.stringify([articleNumber, value(source, advice(source), `B${row}`) ?? '', name, packs, pieces]), articleNumber, name, packsPerBox: packs, piecesPerPack: pieces, daily, boxes, explicit });
  }
  return result;
}
function setValue(sheet: Sheet, address: string, entry: string | number | undefined, keepFormula = false) {
  let cell = sheet.cells.get(address);
  if (!cell) {
    const number = Number(columns(address)[2]); let row = sheet.rows.get(number);
    if (!row) { row = sheet.doc.createElementNS(NS, 'row'); row.setAttribute('r', String(number)); const data = elements(sheet.doc, 'sheetData')[0]; data.insertBefore(row, [...data.children].find(item => Number(item.getAttribute('r')) > number) ?? null); sheet.rows.set(number, row); }
    cell = sheet.doc.createElementNS(NS, 'c'); cell.setAttribute('r', address); row.append(cell); sheet.cells.set(address, cell);
  }
  for (const node of [...cell.children]) if (['v', 'is'].includes(node.localName) || (!keepFormula && node.localName === 'f')) node.remove();
  cell.removeAttribute('t'); if (entry === undefined) return;
  if (typeof entry === 'number' || keepFormula) { if (typeof entry === 'string') cell.setAttribute('t', 'str'); const cached = sheet.doc.createElementNS(NS, 'v'); cached.textContent = String(entry); cell.append(cached); }
  else { cell.setAttribute('t', 'inlineStr'); const inline = sheet.doc.createElementNS(NS, 'is'); const text = sheet.doc.createElementNS(NS, 't'); text.setAttribute('xml:space', 'preserve'); text.textContent = entry; inline.append(text); cell.append(inline); }
}
function copiedRow(source: MergeWorkbook, sheet: Sheet, original: number, destination: number, owner: Document, styles: Map<string, string>): Element {
  const row = sheet.rows.get(original); if (!row) fail('Een bewonersregel ontbreekt in de Excel.');
  const copy = owner.importNode(row, true); copy.setAttribute('r', String(destination));
  for (const cell of [...copy.children]) {
    const oldAddress = cell.getAttribute('r')!; const column = columns(oldAddress)[1]; cell.setAttribute('r', `${column}${destination}`);
    const style = styles.get(column); if (style) cell.setAttribute('s', style); else cell.removeAttribute('s');
    const oldCell = sheet.cells.get(oldAddress)!; const formula = formulaText(sheet, oldCell);
    if (formula !== undefined) {
      const element = child(cell, 'f')!; element.textContent = shiftFormula(formula, destination - original);
      if (element.getAttribute('t') === 'shared') { element.removeAttribute('t'); element.removeAttribute('si'); element.removeAttribute('ref'); }
      else if (element.hasAttribute('ref')) element.setAttribute('ref', shiftFormula(element.getAttribute('ref')!, destination - original));
    } else if (cell.getAttribute('t') === 's') {
      const text = source.strings[Number(child(cell, 'v')?.textContent)]; for (const item of [...cell.children]) item.remove();
      cell.setAttribute('t', 'inlineStr'); const inline = owner.createElementNS(NS, 'is'); if (text) for (const item of [...text.children]) inline.append(owner.importNode(item, true)); cell.append(inline);
    }
  }
  return copy;
}
export async function mergeResidentWorkbooks(sources: Record<string, MergeWorkbook>): Promise<MergedWorkbook> {
  if (MERGE_LOCATIONS.some(id => !sources[id])) fail('Kies eerst de drie bewonersoverzichten.');
  const base = sources.H1;
  if (MERGE_LOCATIONS.some(id => sources[id].weeks !== base.weeks)) fail('Het aantal weken verschilt tussen de bestanden. Maak de bestelperiode in de drie Excel-bestanden gelijk.');
  if (MERGE_LOCATIONS.some(id => sources[id].orderUnit !== base.orderUnit)) fail('De besteleenheid verschilt tussen de bestanden. Kies in de drie Excel-bestanden dezelfde eenheid: Dozen of Zakken.');
  const headers = (source: MergeWorkbook) => JSON.stringify(Array.from({ length: 25 }, (_, index) => value(source, residents(source), `${String.fromCharCode(65 + index)}6`)));
  if (MERGE_LOCATIONS.some(id => headers(sources[id]) !== headers(base))) fail('De drie documenten hebben verschillende kolomindelingen. Gebruik dezelfde versie van het bewonersoverzicht.');
  const lists = MERGE_LOCATIONS.map(id => adviceRows(sources[id])); const maps = lists.map(list => new Map(list.map(row => [row.key, row])));
  if (maps.some((map, index) => map.size !== lists[index].length || map.size !== maps[0].size || [...map.keys()].some(key => !maps[0].has(key)))) fail('De productlijsten verschillen tussen de drie bestanden. Gebruik dezelfde productlijst voordat je samenvoegt.');
  const residentSheet = sheetModel(residents(base).path, parse(new XMLSerializer().serializeToString(residents(base).doc)));
  const adviceSheet = sheetModel(advice(base).path, parse(new XMLSerializer().serializeToString(advice(base).doc)));
  const outputBook = parse(new XMLSerializer().serializeToString(base.workbook));
  const records = MERGE_LOCATIONS.flatMap(id => sources[id].residentRows.map(row => ({ source: sources[id], row })));
  const end = Math.max(base.endRow, START + records.length * 2 - 1); const sheetData = elements(residentSheet.doc, 'sheetData')[0];
  const stylesFor = (row: number) => new Map([...residents(base).rows.get(row)!.children].map(cell => [columns(cell.getAttribute('r')!)[1], cell.getAttribute('s') ?? '']));
  for (const row of [...sheetData.children]) if (Number(row.getAttribute('r')) >= START) row.remove();
  for (let row = START; row <= end; row++) {
    const record = records[Math.floor((row - START) / 2)]; const offset = (row - START) % 2;
    const source = record?.source ?? base; const original = record ? record.row + offset : START + offset;
    const targetStyleRow = residents(base).rows.has(row) ? row : START + offset;
    const copy = copiedRow(source, residents(source), original, row, residentSheet.doc, stylesFor(targetStyleRow)); sheetData.append(copy);
    if (!record) {
      const model: Sheet = { ...residentSheet, rows: new Map([[row, copy]]), cells: new Map([...copy.children].map(cell => [cell.getAttribute('r')!, cell])) };
      for (const column of ['A', 'C', 'D', ...Array.from({ length: 20 }, (_, index) => String.fromCharCode(70 + index))]) setValue(model, `${column}${row}`, undefined);
      for (const cell of [...copy.children]) if (child(cell, 'f')) child(cell, 'v')?.remove();
    }
  }
  const finalResidents = sheetModel(residentSheet.path, residentSheet.doc);
  setValue(finalResidents, 'C5', 'Rood / Oranje / Groen');
  for (let row = START; row < START + records.length * 2; row++) {
    const name = value({ ...base, sheets: new Map([['Bewonersoverzicht', finalResidents], ['Totaal', base.sheets.get('Totaal')!]]) }, finalResidents, `A${row - (row - START) % 2}`) ?? '';
    const identifier = finalResidents.cells.get(`B${row}`);
    if (identifier && child(identifier, 'f')) setValue(finalResidents, `B${row}`, `${name}_${(row - START) % 2 ? 'N' : 'D'}`, true);
  }
  if (end > base.endRow) {
    const merges = elements(finalResidents.doc, 'mergeCells')[0]; const patterns = merges ? [...merges.children].map(cell => cell.getAttribute('ref')!).filter(ref => /^[A-Z]+8:[A-Z]+9$/.test(ref)) : [];
    if (merges) { for (let row = base.endRow + 1; row < end; row += 2) for (const pattern of patterns) { const cell = finalResidents.doc.createElementNS(NS, 'mergeCell'); cell.setAttribute('ref', shiftFormula(pattern, row - START)); merges.append(cell); } merges.setAttribute('count', String(merges.children.length)); }
    const expand = (text: string) => text.replace(new RegExp(`([A-Z]{1,3}\\$?)${base.endRow}(?!\\d)`, 'g'), (_, column: string) => `${column}${end}`);
    for (const name of ['dataValidation', 'conditionalFormatting', 'autoFilter']) for (const node of elements(finalResidents.doc, name)) for (const attribute of ['sqref', 'ref']) if (node.hasAttribute(attribute)) {
      const reference = node.getAttribute(attribute)!;
      node.setAttribute(attribute, name === 'dataValidation' && new RegExp(`^[A-Z]+${base.endRow}$`).test(reference) ? `${reference}:${expand(reference)}` : expand(reference));
    }
    for (const node of [...finalResidents.doc.getElementsByTagName('*')].filter(node => node.localName === 'sqref')) node.textContent = expand(node.textContent ?? '');
    for (const node of elements(outputBook, 'definedName')) if (/(?:'Bewonersoverzicht'|Bewonersoverzicht)!/.test(node.textContent ?? '')) node.textContent = expand(node.textContent!);
    const dimension = elements(finalResidents.doc, 'dimension')[0]; dimension.setAttribute('ref', dimension.getAttribute('ref')!.replace(/\d+$/, String(end)));
  }
  const items: MergeItem[] = [];
  for (const row of lists[0]) {
    const matching = maps.map(map => map.get(row.key)!); const quantities = Object.fromEntries(MERGE_LOCATIONS.map((id, index) => [id, matching[index].boxes]));
    const totalQuantity = matching.reduce((sum, item) => sum + item.boxes, 0); if (!Number.isSafeInteger(totalQuantity)) fail('Een gezamenlijk bestelaantal is te groot. Controleer de Excel-bestanden.');
    const daily = matching.some(item => item.daily !== undefined) ? matching.reduce((sum, item) => sum + (item.daily ?? 0), 0) : undefined;
    if (daily !== undefined) {
      setValue(adviceSheet, `D${row.row}`, daily, !!child(adviceSheet.cells.get(`D${row.row}`)!, 'f'));
      const boxes = daily * 7 * base.weeks / (row.packsPerBox * row.piecesPerPack); const packs = daily * 7 * base.weeks / row.piecesPerPack;
      for (const [column, number] of [['I', boxes], ['J', Math.ceil(boxes)], ['K', packs], ['L', Math.ceil(packs)]] as const) setValue(adviceSheet, `${column}${row.row}`, daily > 0 ? number : undefined, true);
    }
    setValue(adviceSheet, `M${row.row}`, totalQuantity > 0 || matching.some(item => item.explicit) ? totalQuantity : undefined);
    if (totalQuantity > 0) items.push({ key: row.key, articleNumber: row.articleNumber, name: row.name, packsPerBox: row.packsPerBox, piecesPerPack: row.piecesPerPack, quantities, totalQuantity });
  }
  setValue(adviceSheet, 'C7', 'Rood / Oranje / Groen', true);
  let calc = elements(outputBook, 'calcPr')[0]; if (!calc) { calc = outputBook.createElementNS(NS, 'calcPr'); outputBook.documentElement.append(calc); }
  calc.setAttribute('fullCalcOnLoad', '1'); calc.setAttribute('forceFullCalc', '1'); calc.setAttribute('calcMode', 'auto');
  const { default: Zip } = await import('jszip'); const output = new Zip();
  const originals = await Promise.all(Object.values(base.zip.files).map(async entry => ({ entry, bytes: await entry.async('uint8array') })));
  for (const { entry, bytes } of originals) output.file(entry.name, bytes, { dir: entry.dir, date: entry.date, comment: entry.comment, unixPermissions: entry.unixPermissions, dosPermissions: entry.dosPermissions, createFolders: false });
  output.file(finalResidents.path, new XMLSerializer().serializeToString(finalResidents.doc), { createFolders: false });
  output.file(adviceSheet.path, new XMLSerializer().serializeToString(adviceSheet.doc), { createFolders: false });
  output.file('xl/workbook.xml', new XMLSerializer().serializeToString(outputBook), { createFolders: false });
  return { bytes: Uint8Array.from(await output.generateAsync({ type: 'uint8array', compression: 'DEFLATE' })), items, residentCount: records.length, weeks: base.weeks, orderUnit: base.orderUnit, extension: base.macroEnabled ? 'xlsm' : 'xlsx', sourceHashes: Object.fromEntries(MERGE_LOCATIONS.map(id => [id, sources[id].hash])) };
}
