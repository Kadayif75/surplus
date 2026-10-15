import 'fake-indexeddb/auto';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { InventoryDatabase } from '../data/db';
import { LocalInventoryRepository } from '../data/inventoryRepository';

let repo: LocalInventoryRepository;
const barcode = '7322541358826';
const productId = 'tena-794623';
beforeEach(async () => {
  repo = new LocalInventoryRepository(new InventoryDatabase(`physical-product-${crypto.randomUUID()}`));
  await repo.initialize();
});
afterEach(async () => { await repo.db.delete(); });

it('herkent de fysieke verpakking en boekt bij en af in elke ruimte', async () => {
  expect(await repo.resolveBarcode(barcode)).toMatchObject({ productId, verified: true, isDemo: false, quantityInStockUnits: 1 });
  expect(await repo.db.products.get(productId)).toMatchObject({ tenaArticleNumber: '794623', name: 'TENA Pants Maxi ProSkin Large' });
  for (const location of await repo.listLocations()) {
    const command = { productId, locationId: location.id, quantityPacks: 1, inputSource: 'camera' as const, scannedBarcode: barcode };
    const added = await repo.bookMovement({ ...command, operationId: crypto.randomUUID(), type: 'IN' });
    expect(added).toMatchObject({ stockBefore: 0, stockAfter: 1, isDemoBarcode: false });
    const removed = await repo.bookMovement({ ...command, operationId: crypto.randomUUID(), type: 'OUT' });
    expect(removed).toMatchObject({ stockBefore: 1, stockAfter: 0 });
  }
});

async function simulatePreviousVersion() {
  await repo.db.meta.delete('physicalDemoProduct794623');
  await repo.db.mappings.where('rawValue').equals(barcode).delete();
  await repo.db.stocks.where('productId').equals(productId).delete();
  await repo.db.products.delete(productId);
}

it('voegt het product toe aan een bestaande demo zonder eerdere boekingen te veranderen', async () => {
  await simulatePreviousVersion();
  await repo.bookMovement({ productId: 'tena-760364', locationId: 'H1', quantityPacks: 1, inputSource: 'productSearch', operationId: crypto.randomUUID(), type: 'OUT' });
  const before = await repo.snapshot();
  await repo.initialize();
  const after = await repo.snapshot();
  expect(after.movements).toEqual(before.movements);
  expect(after.stocks.filter(s => s.productId !== productId)).toEqual(before.stocks);
  expect(after.stocks.filter(s => s.productId === productId)).toHaveLength(3);
  expect(await repo.resolveBarcode(barcode)).toMatchObject({ productId });
  await repo.initialize();
  expect(await repo.snapshot()).toEqual(after);
});

it('behoudt een al via pakbon toegevoegd artikel en de bestaande voorraad', async () => {
  const product = (await repo.db.products.get(productId))!;
  await simulatePreviousVersion();
  await repo.db.products.add({ ...product, id: 'employee-product', name: 'Eigen productnaam' });
  await repo.db.stocks.add({ productId: 'employee-product', locationId: 'H1', quantityPacks: 7 });
  await repo.initialize();
  expect(await repo.resolveBarcode(barcode)).toMatchObject({ productId: 'employee-product' });
  expect(await repo.db.products.get(productId)).toBeUndefined();
  expect(await repo.db.products.get('employee-product')).toMatchObject({ name: 'Eigen productnaam' });
  expect(await repo.db.stocks.get(['employee-product', 'H1'])).toMatchObject({ quantityPacks: 7 });
});

it('behoudt een eerder handmatig bevestigde barcodekoppeling', async () => {
  await simulatePreviousVersion();
  await repo.addMapping({ id: 'employee-mapping', rawValue: barcode, symbology: 'EAN_13', productId: 'tena-760364', packagingLevel: 'verpakking', quantityInStockUnits: 1, isDemo: false, verified: true });
  await repo.initialize();
  expect(await repo.resolveBarcode(barcode)).toMatchObject({ id: 'employee-mapping', productId: 'tena-760364' });
});

it('houdt de echte barcode beschikbaar na een demo-reset', async () => {
  await repo.resetDemo();
  expect(await repo.resolveBarcode(barcode)).toMatchObject({ productId });
  expect((await repo.getStock()).filter(s => s.productId === productId).map(s => s.quantityPacks)).toEqual([0, 0, 0]);
});
