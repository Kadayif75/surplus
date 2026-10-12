import type { InventorySnapshot, StockPosition } from '../domain/types';
import { InventoryError } from '../domain/stockService';
import type { DemandImport, OrderLine, OrderPlan } from './types';
import { nameConsistent } from '../delivery/deliveryValidation';
export const ORDER_LOCATION_IDS = ['H1', 'H2', 'H3'] as const;
export function safeCount(value: number, label: string) {
  if (!Number.isSafeInteger(value) || value < 0) throw new InventoryError(`Controleer ${label}: een geheel, niet-negatief aantal is vereist.`);
  return value;
}
export function calculateOrder(imports: Record<string, DemandImport>, weeks: number, data: InventorySnapshot, orders: OrderPlan[], initialStocks: StockPosition[] = []): OrderLine[] {
  if (!Number.isSafeInteger(weeks) || weeks < 1 || weeks > 52) throw new InventoryError('Kies een bestelperiode van 1 tot en met 52 hele weken.');
  if (ORDER_LOCATION_IDS.some(id => !imports[id] || !data.locations.some(location => location.id === id))) throw new InventoryError('Upload voor Rood, Oranje en Groen elk een bewonersoverzicht.');
  for (const stock of initialStocks) safeCount(stock.quantityPacks, 'de beginvoorraad van nieuwe producten');
  const rowsByArticle = new Map<string, OrderLine>();
  for (const locationId of ORDER_LOCATION_IDS) for (const row of imports[locationId].rows) {
    const dailyPieces = row.dailyPieces;
    if (typeof dailyPieces !== 'number' || !Number.isFinite(dailyPieces) || dailyPieces < 0) throw new InventoryError(`Controleer het daggebruik van ${row.name}. Vul ontbrekende producttotalen in of bevestig expliciet dat er geen behoefte is.`);
    if (dailyPieces === 0) continue;
    if (!/^\d{4,10}$/.test(row.articleNumber) || !row.name.trim() || !Number.isSafeInteger(row.packsPerBox) || row.packsPerBox < 1 || !Number.isSafeInteger(row.piecesPerPack) || row.piecesPerPack < 1) throw new InventoryError(`Controleer artikel en doosinhoud van ${row.name}.`);
    const existing = data.products.find(product => product.tenaArticleNumber === row.articleNumber);
    if (existing && !nameConsistent(row.name, existing)) throw new InventoryError(`De Excel-naam ${row.name} past niet bij artikel ${row.articleNumber} (${existing.name}). Controleer de artikelcode en het gekozen product.`);
    if (existing && (existing.packsPerBox !== row.packsPerBox || existing.piecesPerPack !== row.piecesPerPack)) throw new InventoryError(`Doosinhoud van artikel ${row.articleNumber} wijkt af van het assortiment. Controleer de Excel en het product.`);
    const product = existing ?? { id: `received-${row.articleNumber}`, tenaArticleNumber: row.articleNumber, name: row.name, variant: '', stockUnit: 'verpakking' as const, packsPerBox: row.packsPerBox, piecesPerPack: row.piecesPerPack, sourceReference: 'Handmatig gecontroleerd bestelplan uit producttotalen', assortmentVerified: true };
    let line = rowsByArticle.get(row.articleNumber);
    if (line && (line.product.name !== product.name || line.product.packsPerBox !== product.packsPerBox || line.product.piecesPerPack !== product.piecesPerPack || (!existing && line.product.name !== row.name))) throw new InventoryError(`Verschillende productgegevens voor artikel ${row.articleNumber}. Controleer de drie bestanden.`);
    if (!line) { line = { product, allocations: [] }; rowsByArticle.set(row.articleNumber, line); }
    if (line.allocations.some(allocation => allocation.locationId === locationId)) throw new InventoryError(`Artikel ${row.articleNumber} staat meerdere keren in dezelfde locatie-invoer.`);
    const stock = data.stocks.find(position => position.productId === product.id && position.locationId === locationId);
    if (existing && !stock) throw new InventoryError(`De voorraadpositie van ${product.name} ontbreekt.`);
    const stockPacks = safeCount(stock?.quantityPacks ?? initialStocks.find(position => position.productId === product.id && position.locationId === locationId)?.quantityPacks ?? 0, 'de aanwezige voorraad');
    const incomingPacks = safeCount(orders.filter(order => order.status === 'Besteld').flatMap(order => order.lines).filter(item => item.product.id === product.id).flatMap(item => item.allocations).filter(allocation => allocation.locationId === locationId).reduce((total, allocation) => total + allocation.orderedPacks - allocation.receivedPacks, 0), 'de onderweg zijnde voorraad');
    const needPacks = safeCount(Math.ceil(dailyPieces * 7 * weeks / row.piecesPerPack), 'de behoefte');
    const boxes = safeCount(Math.ceil(Math.max(0, needPacks - stockPacks - incomingPacks) / row.packsPerBox), 'het aantal dozen');
    line.allocations.push({ locationId, dailyPieces, stockPacks, incomingPacks, needPacks, boxes, orderedPacks: safeCount(boxes * row.packsPerBox, 'de bestelde verpakkingen'), receivedPacks: 0 });
  }
  const result = [...rowsByArticle.values()].sort((a, b) => a.product.tenaArticleNumber.localeCompare(b.product.tenaArticleNumber));
  safeCount(result.reduce((sum, line) => sum + line.allocations.reduce((count, allocation) => count + allocation.boxes, 0), 0), 'het gezamenlijke aantal dozen');
  return result;
}
