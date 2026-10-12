/// <reference types="node" />
import 'fake-indexeddb/auto';
import fs from 'node:fs/promises';
import ExcelJS from 'exceljs';
import Dexie from 'dexie';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { InventoryDatabase } from '../data/db';
import { LocalInventoryRepository } from '../data/inventoryRepository';
import { calculateOrder, ORDER_LOCATION_IDS } from '../orders/orderCalculation';
import { saveOrder, markOrderSent } from '../orders/orderService';
import { readDemandExcel, exportOrderExcel } from '../orders/orderExcel';
import { distributeDeliveryLine, orderDeliveryProblems } from '../orders/orderDelivery';
import { confirmDelivery, createDraft } from '../delivery/deliveryService';
import { emptyLine } from '../delivery/DeliveryReview';
import type { DemandImport, OrderPlan } from '../orders/types';
import type { InventorySnapshot } from '../domain/types';
import type { DeliveryDraft } from '../delivery/types';
import { seedLocations, seedProducts } from '../data/seed';
import { parseDeliveryLine } from '../delivery/deliveryParser';

let repo: LocalInventoryRepository; let data: InventorySnapshot;
const source = (dailyPieces = 60): DemandImport => ({ hash: `fixture-${dailyPieces}`, sourceWeeks: 2, rows: [{ articleNumber: '760364', name: 'TENA Discreet Mini', dailyPieces, packsPerBox: 6, piecesPerPack: 30 }] });
const imports = () => Object.fromEntries(ORDER_LOCATION_IDS.map(id => [id, source()]));
const plan = (sources = imports(), orders: OrderPlan[] = []): OrderPlan => ({ id: crypto.randomUUID(), reference: `ORDER-${crypto.randomUUID()}`, supplier: 'Fictieve leverancier', weeks: 2, createdAt: new Date().toISOString(), status: 'Concept', sourceHashes: Object.fromEntries(Object.entries(sources).map(([id, source]) => [id, source.hash])), lines: calculateOrder(sources, 2, data, orders), reviewConfirmed: true, newProductsConfirmed: false });
function receipt(order: OrderPlan, packs: number): DeliveryDraft {
  return { ...createDraft(), orderId: order.id, deliveryNumber: crypto.randomUUID(), supplier: order.supplier, deliveryDate: '2026-10-12', completenessConfirmed: true, lines: [{ ...emptyLine(), articleNumber: '760364', productId: 'tena-760364', detectedProductName: 'TENA Discreet Mini', quantityText: String(packs), unit: 'verpakking', packsPerBoxText: '6', piecesPerPackText: '30', manuallyReviewed: true, destinationLocationId: 'H1' }] };
}
beforeEach(async () => { repo = new LocalInventoryRepository(new InventoryDatabase(`orders-${crypto.randomUUID()}`)); await repo.initialize(); data = await repo.snapshot(); });
afterEach(async () => { await repo.db.delete(); });
describe('Behoefte, voorraad en gezamenlijke bestelling', () => {
  it('rekent dagelijks stuks om en trekt voorraad af vóór afronden per locatie', () => {
    const result = calculateOrder(imports(), 2, data, []);
    expect(result[0].allocations.map(item => [item.needPacks, item.stockPacks, item.boxes, item.orderedPacks])).toEqual([[28, 10, 3, 18], [28, 6, 4, 24], [28, 4, 4, 24]]);
  });
  it('bestelt niets bij genoeg voorraad en schuift overschotten niet tussen locaties', () => {
    const sources = imports(); sources.H1 = source(1);
    const result = calculateOrder(sources, 2, data, []);
    expect(result[0].allocations.map(item => item.boxes)).toEqual([0, 4, 4]);
  });
  it('nulbehoefte is echt nul, maar ontbrekende locatie, negatief gebruik en overflow worden geweigerd', () => {
    expect(calculateOrder(Object.fromEntries(ORDER_LOCATION_IDS.map(id => [id, source(0)])), 2, data, [])).toEqual([]);
    expect(() => calculateOrder({ H1: source() }, 2, data, [])).toThrow('Upload');
    expect(() => calculateOrder({ ...imports(), H1: source(-1) }, 2, data, [])).toThrow('daggebruik');
    expect(() => calculateOrder({ ...imports(), H1: source(Number.MAX_VALUE) }, 2, data, [])).toThrow('behoefte');
  });
  it('bewaart verdeling en bronnen zonder voorraad te wijzigen; dubbele opslag is idempotent', async () => {
    const command = plan(); const before = await repo.snapshot();
    const results = await Promise.all(Array.from({ length: 10 }, () => saveOrder(repo.db, command, imports())));
    expect(new Set(results.map(item => item.id)).size).toBe(1); expect(await repo.db.orders.count()).toBe(1); expect(await repo.snapshot()).toEqual(before);
    await expect(saveOrder(repo.db, { ...command, weeks: 3 }, imports())).rejects.toThrow('andere gegevens');
  });
  it('gecontroleerde voorraad en nieuwe producten zijn verplicht', async () => {
    await expect(saveOrder(repo.db, { ...plan(), reviewConfirmed: false }, imports())).rejects.toThrow('Controleer');
    const sources = Object.fromEntries(ORDER_LOCATION_IDS.map(id => [id, { ...source(), rows: [{ ...source().rows[0], articleNumber: '999999', name: 'Fictief nieuw product' }] }]));
    const command = plan(sources);
    await expect(saveOrder(repo.db, command, sources)).rejects.toThrow('Bevestig eerst');
    expect(await repo.db.products.get('received-999999')).toBeUndefined();
    await saveOrder(repo.db, { ...command, newProductsConfirmed: true }, sources);
    expect((await repo.db.products.get('received-999999'))?.assortmentVerified).toBe(true);
    expect(await repo.db.stocks.where('productId').equals('received-999999').count()).toBe(3);
  });
  it('veranderde voorraad blokkeert een oud bestelplan', async () => {
    const command = plan(); await repo.db.stocks.put({ productId: 'tena-760364', locationId: 'H1', quantityPacks: 20 });
    await expect(saveOrder(repo.db, command, imports())).rejects.toThrow('veranderd'); expect(await repo.db.orders.count()).toBe(0);
  });
  it('beginvoorraad van een nieuw product verlaagt de bestelling en wordt met openingsmutaties opgeslagen', async () => {
    const sources = Object.fromEntries(ORDER_LOCATION_IDS.map(id => [id, { ...source(), rows: [{ ...source().rows[0], articleNumber: '999999', name: 'Fictief nieuw product' }] }]));
    const initialStocks = ORDER_LOCATION_IDS.map(locationId => ({ productId: 'received-999999', locationId, quantityPacks: 10 }));
    const command = { ...plan(sources), initialStocks, newProductsConfirmed: true, lines: calculateOrder(sources, 2, data, [], initialStocks) };
    expect(command.lines[0].allocations.map(item => item.boxes)).toEqual([3, 3, 3]);
    await saveOrder(repo.db, command, sources);
    expect((await repo.db.stocks.get(['received-999999', 'H1']))?.quantityPacks).toBe(10);
    expect(await repo.db.movements.where('productId').equals('received-999999').count()).toBe(3);
  });
  it('dubbele actieve artikelcodes en naamconflicten worden niet stil samengevoegd', () => {
    const duplicate = { ...source(), rows: [source().rows[0], source().rows[0]] };
    expect(() => calculateOrder({ ...imports(), H1: duplicate }, 2, data, [])).toThrow('meerdere keren');
    const conflict = { ...source(), rows: [{ ...source().rows[0], name: 'TENA Men Level 2' }] };
    expect(() => calculateOrder({ ...imports(), H1: conflict }, 2, data, [])).toThrow('past niet bij artikel');
  });
  it('viercijferige codes uit aanvullende producten behouden hun exacte tekst', () => {
    expect(parseDeliveryLine('1 COL 4238 TENA Wash Cream 10x1p')?.articleNumber).toBe('4238');
  });
  it('deduceert onderweg alleen na markeren als Besteld en houdt rekening met deelleveringen', async () => {
    const command = await saveOrder(repo.db, plan(), imports());
    expect(calculateOrder(imports(), 2, data, [command])[0].allocations[0].boxes).toBe(3);
    await markOrderSent(repo.db, command.id); let order = (await repo.db.orders.get(command.id))!;
    expect(calculateOrder(imports(), 2, data, [order])[0].allocations.map(item => item.boxes)).toEqual([0, 0, 0]);
    await confirmDelivery(repo.db, receipt(order, 6)); order = (await repo.db.orders.get(command.id))!; data = await repo.snapshot();
    const next = calculateOrder(imports(), 2, data, [order])[0].allocations[0]; expect(next.stockPacks).toBe(16); expect(next.incomingPacks).toBe(12); expect(next.boxes).toBe(0);
  });
  it('fout tijdens nieuwe producttoevoeging rolt het hele bestelplan terug', async () => {
    const sources = Object.fromEntries(ORDER_LOCATION_IDS.map(id => [id, { ...source(), rows: [{ ...source().rows[0], articleNumber: '999999', name: 'Fictief nieuw product' }] }]));
    const fail = () => { throw new Error('Opslagfout'); }; repo.db.stocks.hook('creating', fail);
    await expect(saveOrder(repo.db, { ...plan(sources), newProductsConfirmed: true }, sources)).rejects.toThrow('Opslagfout'); repo.db.stocks.hook('creating').unsubscribe(fail);
    expect(await repo.db.products.get('received-999999')).toBeUndefined(); expect(await repo.db.orders.count()).toBe(0);
  });
});
describe('Ontvangst verdelen en openstaande aantallen', () => {
  it('volledige levering splitst exact over drie locaties en boekt eenmaal', async () => {
    const order = await saveOrder(repo.db, plan(), imports()); await markOrderSent(repo.db, order.id);
    const original = receipt(order, 66); original.lines[0].destinationLocationId = '';
    let draft = distributeDeliveryLine(original, original.lines[0].id, { H1: 18, H2: 24, H3: 24 }, data);
    expect(draft.lines.every(line => !line.manuallyReviewed)).toBe(true); expect(draft.completenessConfirmed).toBe(false);
    draft = { ...draft, completenessConfirmed: true, lines: draft.lines.map(line => ({ ...line, manuallyReviewed: true })) };
    const first = await confirmDelivery(repo.db, draft); const second = await confirmDelivery(repo.db, draft); expect(second.id).toBe(first.id);
    expect((await repo.db.orders.get(order.id))?.status).toBe('Ontvangen');
    expect((await repo.db.orders.get(order.id))?.lines[0].allocations.map(item => item.receivedPacks)).toEqual([18, 24, 24]);
    expect((await repo.snapshot()).stocks.filter(item => item.productId === 'tena-760364').map(item => item.quantityPacks)).toEqual([28, 30, 28]);
  });
  it('deellevering en retry bewaren het restant en verhogen het niet dubbel', async () => {
    const order = await saveOrder(repo.db, plan(), imports()); await markOrderSent(repo.db, order.id);
    const draft = receipt(order, 6); await confirmDelivery(repo.db, draft); await confirmDelivery(repo.db, draft);
    const updated = (await repo.db.orders.get(order.id))!; expect(updated.status).toBe('Besteld'); expect(updated.lines[0].allocations[0].receivedPacks).toBe(6);
    const tooMuch = receipt(order, 18); expect(orderDeliveryProblems(updated, tooMuch, data).join(' ')).toContain('nog 12');
    await expect(confirmDelivery(repo.db, tooMuch)).rejects.toThrow('nog 12');
  });
  it('verdeelde som, gehele aantallen, bestemming en onbekend bestelproduct worden bewaakt', async () => {
    const order = await saveOrder(repo.db, plan(), imports()); await markOrderSent(repo.db, order.id);
    const draft = receipt(order, 6);
    expect(() => distributeDeliveryLine(draft, draft.lines[0].id, { H1: 5 }, data)).toThrow('precies 6');
    expect(() => distributeDeliveryLine(draft, draft.lines[0].id, { H1: 2.5, H2: 3.5 }, data)).toThrow('geheel');
    expect(() => distributeDeliveryLine(draft, draft.lines[0].id, { H9: 6 }, data)).toThrow('geldige');
    draft.lines[0].productId = 'tena-750651'; await expect(confirmDelivery(repo.db, draft)).rejects.toThrow('product uit deze bestelling');
  });
  it('ontvangstfout na orderbijwerking rolt order, ontvangst en voorraad terug', async () => {
    const order = await saveOrder(repo.db, plan(), imports()); await markOrderSent(repo.db, order.id);
    const before = await repo.snapshot(); const fail = () => { throw new Error('Ontvangstfout'); }; repo.db.deliveries.hook('creating', fail);
    await expect(confirmDelivery(repo.db, receipt(order, 6))).rejects.toThrow('Ontvangstfout'); repo.db.deliveries.hook('creating').unsubscribe(fail);
    expect(await repo.snapshot()).toEqual(before); expect((await repo.db.orders.get(order.id))?.lines[0].allocations[0].receivedPacks).toBe(0);
  });
  it('reset verwijdert ook bestellingen en behoudt de kleurnamen', async () => {
    await saveOrder(repo.db, plan(), imports()); await repo.resetDemo(); expect(await repo.db.orders.count()).toBe(0); expect((await repo.listLocations()).map(location => location.name)).toEqual(['Rood', 'Oranje', 'Groen']);
  });
  it('upgrade vanaf schema 2 houdt standen en eigen locatienamen intact', async () => {
    const name = `upgrade-orders-${crypto.randomUUID()}`; const old = new Dexie(name);
    old.version(2).stores({ products: 'id, &tenaArticleNumber', locations: 'id', mappings: 'id, &rawValue, productId', stocks: '[productId+locationId], productId, locationId', movements: 'id, &operationId, createdAt, productId, locationId', meta: 'key', deliveries: 'id, &operationId, &identityKey, &fingerprint, imageHash, processedAt', articleAliases: '&articleNumber, productId', productLocationRules: 'id, productId, locationId' });
    await old.table('products').bulkPut(seedProducts); await old.table('locations').bulkPut(seedLocations.map(location => ({ ...location, name: location.id === 'H2' ? 'Eigen ruimtenaam' : `Voorraadruimte ${location.id.slice(1)}` })));
    await old.table('stocks').put({ productId: 'tena-760364', locationId: 'H1', quantityPacks: 17 }); await old.table('meta').put({ key: 'seedVersion', value: 1 }); old.close();
    const upgraded = new LocalInventoryRepository(new InventoryDatabase(name));
    try { await upgraded.initialize(); expect((await upgraded.db.stocks.get(['tena-760364', 'H1']))?.quantityPacks).toBe(17); expect((await upgraded.listLocations()).map(location => location.name)).toEqual(['Rood', 'Eigen ruimtenaam', 'Groen']); expect(await upgraded.db.orders.count()).toBe(0); }
    finally { await upgraded.db.delete(); }
  });
});
async function excelFixture(withResult = true, daily = 60) {
  const workbook = new ExcelJS.Workbook(); const sheet = workbook.addWorksheet('Adviesbestelling in weken');
  sheet.getCell('J4').value = 2; for (const [cell, value] of [['A9', 'Art.nr.'], ['D9', 'InvLij'], ['E9', '#'], ['F9', 'Tas']] as const) sheet.getCell(cell).value = value;
  sheet.getCell('A11').value = '760364'; sheet.getCell('C11').value = 'TENA Discreet Mini'; sheet.getCell('D11').value = withResult ? { formula: String(daily), result: daily } : { formula: String(daily) }; sheet.getCell('E11').value = 6; sheet.getCell('F11').value = 30;
  const residents = workbook.addWorksheet('Bewonersoverzicht'); residents.getCell('A1').value = 'FICTIEVE BEWONERSNAAM NIET OPSLAAN';
  return new Uint8Array(await workbook.xlsx.writeBuffer()).buffer;
}
describe('Excel-invoer en gezamenlijk bestelbestand', () => {
  it('leest alleen de producttotalen in het resultaat en bewaart geen bewoners', async () => {
    const result = await readDemandExcel(await excelFixture()); expect(result.sourceWeeks).toBe(2); expect(result.rows).toEqual(source().rows); expect(JSON.stringify(result)).not.toContain('BEWONERSNAAM'); expect(result.hash).toHaveLength(64);
  });
  it('ontbrekende opgeslagen formule-uitkomst wordt geen nul', async () => { await expect(readDemandExcel(await excelFixture(false))).rejects.toThrow('opnieuw berekenen'); });
  it('een opgeslagen formule-uitkomst van nul blijft geldig nul', async () => { expect((await readDemandExcel(await excelFixture(true, 0))).rows[0].dailyPieces).toBe(0); });
  it('export bevat totaal en alle drie locaties met numerieke aantallen en zonder bewoners', async () => {
    const workbook = new ExcelJS.Workbook(); await workbook.xlsx.load((await exportOrderExcel(plan(), { H1: 'Rood', H2: 'Oranje', H3: 'Groen' })).buffer);
    const sheet = workbook.getWorksheet('Bestelling en verdeling')!; expect(sheet.getCell('E6').value).toBe(11); expect(['F6', 'G6', 'H6'].map(cell => sheet.getCell(cell).value)).toEqual([3, 4, 4]); expect(sheet.getCell('A6').value).toBe('760364'); expect(workbook.worksheets).toHaveLength(1);
  });
  it.skipIf(!process.env.SV_REAL_BEWONERS)('aangeleverde XLSM wordt alleen gelezen, zonder macro-uitvoering of bewerking', async () => {
    const bytes = await fs.readFile(process.env.SV_REAL_BEWONERS!); const result = await readDemandExcel(Uint8Array.from(bytes).buffer); expect(result.sourceWeeks).toBe(2); expect(result.rows.some(row => row.articleNumber === '791628')).toBe(true); expect(JSON.stringify(result)).not.toContain('Bewonersoverzicht!');
  });
});
