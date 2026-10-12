import type { CellValue } from 'exceljs';
import { InventoryError } from '../domain/stockService';
import { hashBytes } from '../delivery/deliveryService';
import type { DemandImport } from './types';
function scalar(value: CellValue): string | number | undefined {
  if (typeof value === 'string' || typeof value === 'number') return value;
  if (value && typeof value === 'object') {
    if ('formula' in value || 'sharedFormula' in value) return scalar(value.result as CellValue);
    if ('richText' in value) return value.richText.map(part => part.text).join('');
  }
  return undefined;
}
export async function readDemandExcel(bytes: ArrayBuffer): Promise<DemandImport> {
  if (!bytes.byteLength || bytes.byteLength > 20 * 1024 * 1024) throw new InventoryError('Kies een Excel-bestand van maximaal 20 MB.');
  const { default: ExcelJS } = await import('exceljs');
  const workbook = new ExcelJS.Workbook();
  try { await workbook.xlsx.load(bytes); }
  catch { throw new InventoryError('Dit Excel-bestand kan niet worden geopend. Kies een geldige XLSX- of XLSM-kopie.'); }
  const sheet = workbook.getWorksheet('Adviesbestelling in weken');
  if (!sheet || sheet.rowCount > 1000) throw new InventoryError('Het verwachte tabblad Adviesbestelling in weken ontbreekt of heeft een afwijkende indeling.');
  // ExcelJS's value object omits a zero formula result; the public result getter preserves it.
  const value = (address: string) => { const cell = sheet.getCell(address); return scalar(cell.type === ExcelJS.ValueType.Formula ? cell.result as CellValue : cell.value); };
  for (const [cell, expected] of [['A9', 'Art.nr.'], ['D9', 'InvLij'], ['E9', '#'], ['F9', 'Tas']] as const) if (value(cell) !== expected) throw new InventoryError(`De Excel-indeling is gewijzigd bij ${cell}. Controleer het bewonersoverzicht.`);
  const sourceWeeks = value('J4');
  if (typeof sourceWeeks !== 'number' || !Number.isSafeInteger(sourceWeeks) || sourceWeeks < 1 || sourceWeeks > 52) throw new InventoryError('Het aantal weken in de Excel ontbreekt of is ongeldig.');
  const rows: DemandImport['rows'] = [];
  for (let index = 10; index <= sheet.rowCount; index++) {
    const article = value(`A${index}`);
    if (article === undefined || article === '' || article === 0) continue;
    const articleNumber = String(article).trim();
    if (!articleNumber) continue;
    if (!/^\d{4,10}$/.test(articleNumber)) throw new InventoryError(`Controleer artikelnummer op regel ${index}.`);
    const name = value(`C${index}`); const dailyPieces = value(`D${index}`);
    const packsPerBox = value(`E${index}`); const piecesPerPack = value(`F${index}`);
    const manualDailyUse = sheet.getCell(`D${index}`).value === null || sheet.getCell(`D${index}`).value === '';
    if (!manualDailyUse && (typeof dailyPieces !== 'number' || !Number.isFinite(dailyPieces) || dailyPieces < 0)) throw new InventoryError(`Daggebruik op regel ${index} is niet beschikbaar. Laat Excel alles opnieuw berekenen en sla het bestand op. Een ontbrekende uitkomst wordt niet als nul gebruikt.`);
    if (typeof name !== 'string' || !name.trim() || name.length > 160 || typeof packsPerBox !== 'number' || !Number.isSafeInteger(packsPerBox) || packsPerBox < 1 || typeof piecesPerPack !== 'number' || !Number.isSafeInteger(piecesPerPack) || piecesPerPack < 1) throw new InventoryError(`Productgegevens of doosinhoud op regel ${index} ontbreken. Controleer de Excel.`);
    rows.push({ articleNumber, name, dailyPieces: typeof dailyPieces === 'number' ? dailyPieces : undefined, packsPerBox, piecesPerPack, ...(manualDailyUse ? { manualDailyUse: true } : {}) });
  }
  if (!rows.length) throw new InventoryError('Geen producttotalen in dit bewonersoverzicht gevonden.');
  return { hash: await hashBytes(bytes), sourceWeeks, rows };
}
