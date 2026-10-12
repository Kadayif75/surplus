import type { InventoryDatabase } from '../data/db';
import { InventoryError } from '../domain/stockService';
import type { DemandImport, OrderPlan } from './types';
import { calculateOrder } from './orderCalculation';
import { validateNewProduct } from '../delivery/deliveryService';
export async function saveOrder(db: InventoryDatabase, plan: OrderPlan, imports: Record<string, DemandImport>) {
  if (!plan.id || !plan.reference.trim() || !plan.supplier.trim() || plan.reference.length > 100 || plan.supplier.length > 160) throw new InventoryError('Vul leverancier en een uniek bestelnummer in.');
  if (!plan.reviewConfirmed) throw new InventoryError('Controleer de behoefte, actuele voorraad, artikelen en verdeling voordat je het bestelplan opslaat.');
  return db.transaction('rw', [db.orders, db.products, db.locations, db.stocks, db.movements], async () => {
    const previous = await db.orders.get(plan.id);
    const signature = JSON.stringify(plan);
    if (previous) { if (previous.commandSignature !== signature) throw new InventoryError('Dit bestelplan is al gebruikt met andere gegevens.'); return previous; }
    const orders = await db.orders.toArray();
    if (orders.some(order => order.reference.trim().toLowerCase() === plan.reference.trim().toLowerCase())) throw new InventoryError('Dit bestelnummer bestaat al. Kies de bestaande bestelling of een uniek nummer.');
    const products = await db.products.toArray(); const locations = await db.locations.toArray(); const stocks = await db.stocks.toArray();
    const actual = calculateOrder(imports, plan.weeks, { products, locations, stocks, movements: [], mappings: [] }, orders, plan.initialStocks);
    if (JSON.stringify(actual) !== JSON.stringify(plan.lines)) throw new InventoryError('Voorraad, onderweg zijnde bestellingen of productgegevens zijn veranderd. Bereken en controleer de bestelling opnieuw.');
    if (!actual.some(line => line.allocations.some(allocation => allocation.boxes > 0))) throw new InventoryError('Er is geen tekort om te bestellen.');
    const newProducts = actual.filter(line => !products.some(product => product.id === line.product.id));
    if (newProducts.length && !plan.newProductsConfirmed) throw new InventoryError('Bevestig eerst de nieuwe producten en hun artikel- en verpakkingsgegevens.');
    const initialKeys = new Set<string>();
    for (const position of plan.initialStocks ?? []) {
      const key = `${position.productId}:${position.locationId}`;
      if (initialKeys.has(key) || !newProducts.some(line => line.product.id === position.productId) || !locations.some(location => location.id === position.locationId) || !Number.isSafeInteger(position.quantityPacks) || position.quantityPacks < 0) throw new InventoryError('Controleer de beginvoorraad van de nieuwe producten. Bestaande voorraad mag hier niet worden overschreven.');
      initialKeys.add(key);
    }
    for (const line of newProducts) {
      validateNewProduct(line.product); await db.products.add(line.product);
      for (const location of locations) {
        const quantityPacks = plan.initialStocks?.find(position => position.productId === line.product.id && position.locationId === location.id)?.quantityPacks ?? 0;
        await db.stocks.add({ productId: line.product.id, locationId: location.id, quantityPacks });
        if (quantityPacks > 0) await db.movements.add({ id: crypto.randomUUID(), operationId: `${plan.id}:opening:${line.product.id}:${location.id}`, productId: line.product.id, locationId: location.id, type: 'OPENING', quantityPacks, stockBefore: 0, stockAfter: quantityPacks, createdAt: plan.createdAt, actor: 'Demogebruiker', inputSource: 'productSearch', isDemoBarcode: false });
      }
    }
    const saved: OrderPlan = { ...plan, reference: plan.reference.trim(), supplier: plan.supplier.trim(), status: 'Concept', commandSignature: signature };
    await db.orders.add(saved); return saved;
  });
}
export async function markOrderSent(db: InventoryDatabase, id: string) {
  await db.transaction('rw', db.orders, async () => {
    const order = await db.orders.get(id); if (!order) throw new InventoryError('Dit bestelplan bestaat niet.');
    if (order.status === 'Concept') await db.orders.put({ ...order, status: 'Besteld' });
  });
}
