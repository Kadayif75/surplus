// @vitest-environment jsdom
/// <reference types="node" />
import 'fake-indexeddb/auto';
import fs from 'node:fs/promises';
import JSZip from 'jszip';
import ExcelJS from 'exceljs';
import { describe, it, expect } from 'vitest';
import { readMergeWorkbook, mergeResidentWorkbooks } from '../orders/workbookMerge';
import { mergeFixture } from './mergeFixtures';
import { mergedOrderPlan, saveMergedOrder } from '../orders/mergedOrderService';
import { InventoryDatabase } from '../data/db';
import { LocalInventoryRepository } from '../data/inventoryRepository';
import { confirmDelivery, createDraft } from '../delivery/deliveryService';
import { emptyLine } from '../delivery/DeliveryReview';

async function sources() { return { H1: await readMergeWorkbook(await mergeFixture('ROOD', 2)), H2: await readMergeWorkbook(await mergeFixture('ORANJE', 3)), H3: await readMergeWorkbook(await mergeFixture('GROEN', 4)) }; }
async function open(bytes: Uint8Array<ArrayBuffer>) { const workbook = new ExcelJS.Workbook(); await workbook.xlsx.load(bytes.buffer); return workbook; }
describe('Origineel document samenvoegen', () => {
  it('neemt alle bewoners en beide dag/nachtregels over, met bestaande tabbladen en orderkolom', async () => {
    const input = await sources(); const merged = await mergeResidentWorkbooks(input); const workbook = await open(merged.bytes);
    expect(merged.residentCount).toBe(3); expect(merged.extension).toBe('xlsm');
    expect(workbook.worksheets.map(sheet => sheet.name)).toEqual(['Bewonersoverzicht','Adviesbestelling in weken','Bedkaart','Lijst','check','Totaal']);
    const residents = workbook.getWorksheet('Bewonersoverzicht')!; expect(['A8','A10','A12'].map(cell => residents.getCell(cell).value)).toEqual(['ROOD-1','ORANJE-1','GROEN-1']);
    expect(['S8','S9','S10','S11','S12','S13'].map(cell => residents.getCell(cell).value)).toEqual([2,1,2,1,2,1]);
    expect(residents.getCell('B12').formula).toBe('A12&"_D"'); expect(residents.getCell('AB12').formula).toBe('ROW(A12)');
    expect(workbook.getWorksheet('Adviesbestelling in weken')!.getCell('M11').value).toBe(9); expect(merged.items[0].quantities).toEqual({ H1: 2, H2: 3, H3: 4 });
  });
  it('behoudt alle andere ZIP-onderdelen byte voor byte en wijzigt de bron niet bij herhaald samenvoegen', async () => {
    const input = await sources(); const originalXml = await input.H1.zip.file('xl/worksheets/sheet1.xml')!.async('string');
    const first = await mergeResidentWorkbooks(input); const second = await mergeResidentWorkbooks(input); const output = await JSZip.loadAsync(first.bytes);
    expect(await input.H1.zip.file('xl/worksheets/sheet1.xml')!.async('string')).toBe(originalXml);
    expect(first.residentCount).toBe(second.residentCount); expect(first.items).toEqual(second.items);
    const changed = new Set(['xl/workbook.xml','xl/worksheets/sheet1.xml','xl/worksheets/sheet2.xml']);
    expect(Object.keys(output.files).sort()).toEqual(Object.keys(input.H1.zip.files).sort());
    for (const name of Object.keys(input.H1.zip.files).filter(name => !changed.has(name))) expect(await output.file(name)?.async('uint8array')).toEqual(await input.H1.zip.file(name)?.async('uint8array'));
  });
  it('breidt alleen het bestaande bewonersgedeelte, validatie en printbereik uit bij meer bewoners', async () => {
    const input = { H1: await readMergeWorkbook(await mergeFixture('R', 1, 2)), H2: await readMergeWorkbook(await mergeFixture('O', 1, 2)), H3: await readMergeWorkbook(await mergeFixture('G', 1, 2)) };
    const result = await mergeResidentWorkbooks(input); const workbook = await open(result.bytes); const sheet = workbook.getWorksheet('Bewonersoverzicht')!;
    expect(result.residentCount).toBe(6); expect(sheet.getCell('A18').value).toBe('G-2'); expect(sheet.getCell('A19').value).toBe('G-2');
    expect(sheet.getCell('R18').dataValidation.type).toBe('list'); expect(sheet.getCell('R19').dataValidation.type).toBe('list'); expect(sheet.pageSetup.printArea).toBe('A1:Y19');
    expect(sheet.getCell('R18').fill).toEqual(sheet.getCell('R8').fill);
  });
  it('een expliciete bestelling nul blijft nul; bij leeg wordt het advies uit de daadwerkelijke bewonersregels berekend', async () => {
    const input = { H1: await readMergeWorkbook(await mergeFixture('R', 0)), H2: await readMergeWorkbook(await mergeFixture('O')), H3: await readMergeWorkbook(await mergeFixture('G')) };
    const result = await mergeResidentWorkbooks(input); expect(result.items[0].quantities).toEqual({ H1: 0, H2: 1, H3: 1 });
    const sheet = (await open(result.bytes)).getWorksheet('Adviesbestelling in weken')!; expect(sheet.getCell('D11').result).toBe(9); expect(sheet.getCell('M11').value).toBe(2); expect(sheet.getCell('J11').result).toBe(1);
  });
  it('ongelijke periodes geven één concrete fout zonder extra invoerformulieren', async () => {
    const input = await sources(); input.H3 = await readMergeWorkbook(await mergeFixture('G', 1, 1, 3)); await expect(mergeResidentWorkbooks(input)).rejects.toThrow('aantal weken verschilt');
  });
  it('behoudt Zakken als besteleenheid en rekent verpakkingen niet nogmaals naar dozen om', async () => {
    const input = { H1: await readMergeWorkbook(await mergeFixture('R', 2, 1, 2, 'Zakken')), H2: await readMergeWorkbook(await mergeFixture('O', 3, 1, 2, 'Zakken')), H3: await readMergeWorkbook(await mergeFixture('G', 4, 1, 2, 'Zakken')) };
    const merged = await mergeResidentWorkbooks(input); const repo = new LocalInventoryRepository(new InventoryDatabase(`merge-units-${crypto.randomUUID()}`)); await repo.initialize();
    try { const plan = mergedOrderPlan(merged, await repo.snapshot()); expect(merged.orderUnit).toBe('verpakking'); expect(plan.lines[0].allocations.map(item => item.orderedPacks)).toEqual([2,3,4]); expect((await open(merged.bytes)).getWorksheet('Adviesbestelling in weken')!.getCell('M9').value).toBe('Zakken'); }
    finally { await repo.db.delete(); }
  });
  it('een download bewaart alleen productverdeling, maakt geen assortiment aan en verandert geen voorraad', async () => {
    const repo = new LocalInventoryRepository(new InventoryDatabase(`merge-${crypto.randomUUID()}`)); await repo.initialize();
    try {
      const before = await repo.snapshot(); const merged = await mergeResidentWorkbooks(await sources()); const plan = mergedOrderPlan(merged, before);
      await saveMergedOrder(repo.db, plan); await saveMergedOrder(repo.db, plan); expect(await repo.db.orders.count()).toBe(1); expect(await repo.snapshot()).toEqual(before); expect(JSON.stringify(await repo.db.orders.toArray())).not.toContain('ROOD-1');
      const draft = { ...createDraft(), orderId: plan.id, deliveryNumber: 'MERGE-RECEIPT', supplier: 'Leverancier', completenessConfirmed: true, lines: [{ ...emptyLine(), articleNumber: '760364', productId: 'tena-760364', detectedProductName: 'TENA Discreet Mini', quantityText: '6', unit: 'verpakking' as const, manuallyReviewed: true, destinationLocationId: 'H1' }] };
      await confirmDelivery(repo.db, draft); expect((await repo.db.orders.get(plan.id))?.status).toBe('Besteld'); expect((await repo.db.orders.get(plan.id))?.lines[0].allocations[0].receivedPacks).toBe(6);
    } finally { await repo.db.delete(); }
  });
  it.skipIf(!process.env.SV_REAL_BEWONERS)('werkelijke XLSM behoudt VBA, tekeningen, stijlen, verborgen bladen en alle oorspronkelijke package-onderdelen', async () => {
    const bytes = Uint8Array.from(await fs.readFile(process.env.SV_REAL_BEWONERS!)).buffer;
    const input = await readMergeWorkbook(bytes); const result = await mergeResidentWorkbooks({ H1: input, H2: await readMergeWorkbook(bytes), H3: await readMergeWorkbook(bytes) });
    expect(result.residentCount).toBe(input.residentRows.length * 3); const output = await JSZip.loadAsync(result.bytes);
    expect(Object.keys(output.files).sort()).toEqual(Object.keys(input.zip.files).sort());
    for (const name of Object.keys(input.zip.files).filter(name => !['xl/workbook.xml','xl/worksheets/sheet1.xml','xl/worksheets/sheet2.xml'].includes(name))) expect(await output.file(name)?.async('uint8array')).toEqual(await input.zip.file(name)?.async('uint8array'));
    const workbook = await open(result.bytes); expect(workbook.worksheets).toHaveLength(6); expect(workbook.getWorksheet('Lijst')!.state).toBe('hidden');
    if (process.env.SV_MERGE_QA_OUTPUT) await fs.writeFile(process.env.SV_MERGE_QA_OUTPUT, result.bytes);
  }, 60000);
});
