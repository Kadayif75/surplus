import type { InventoryDatabase } from '../data/db';
import type { InventorySnapshot } from '../domain/types';
import type { MergedWorkbook } from './workbookMerge';
import type { OrderPlan } from './types';
import { InventoryError } from '../domain/stockService';

export function mergedOrderPlan(merged: MergedWorkbook, data: InventorySnapshot): OrderPlan {
  const id = crypto.randomUUID(); const createdAt = new Date().toISOString();
  const reference = `SAM-${createdAt.slice(0, 10).replaceAll('-', '')}-${id.slice(0, 6).toUpperCase()}`;
  const plan: OrderPlan = { id, reference, supplier: 'Samengevoegde Excel', weeks: merged.weeks, createdAt, status: 'Concept', sourceHashes: merged.sourceHashes, sourceKind: 'merged-workbooks', residentCount: merged.residentCount, reviewConfirmed: false, newProductsConfirmed: false,
    lines: merged.items.map(item => ({ product: { id: data.products.find(product => product.tenaArticleNumber === item.articleNumber)?.id ?? `received-${item.articleNumber}`, tenaArticleNumber: item.articleNumber, name: item.name, variant: '', stockUnit: 'verpakking', packsPerBox: item.packsPerBox, piecesPerPack: item.piecesPerPack, sourceReference: 'Bestelaantallen uit de samengevoegde werkboeken', assortmentVerified: false }, allocations: Object.entries(item.quantities).map(([locationId, quantity]) => ({ locationId, dailyPieces: 0, stockPacks: 0, incomingPacks: 0, needPacks: 0, boxes: merged.orderUnit === 'doos' ? quantity : quantity / item.packsPerBox, orderedPacks: merged.orderUnit === 'doos' ? quantity * item.packsPerBox : quantity, receivedPacks: 0 })) })) };
  return plan;
}
export async function saveMergedOrder(db: InventoryDatabase, plan: OrderPlan) {
  if (plan.sourceKind !== 'merged-workbooks' || !plan.id || !plan.reference) throw new InventoryError('Deze samenvoeging kan niet worden bewaard.');
  const ids = new Set<string>();
  for (const line of plan.lines) {
    if (ids.has(line.product.id)) throw new InventoryError('De Excel bevat meerdere bestelde producten met dezelfde artikelcode. De verdeellijst kan daardoor niet eenduidig worden gekoppeld.');
    ids.add(line.product.id);
    for (const allocation of line.allocations) if (!Number.isSafeInteger(allocation.orderedPacks) || allocation.orderedPacks < 0) throw new InventoryError('Een bestelaantal is te groot om te bewaren.');
  }
  if (!plan.lines.length) return;
  await db.transaction('rw', db.orders, async () => {
    const existing = await db.orders.get(plan.id); const signature = JSON.stringify(plan);
    if (existing) { if (existing.commandSignature !== signature) throw new InventoryError('Deze samenvoeging is al met andere gegevens bewaard.'); return; }
    await db.orders.add({ ...plan, commandSignature: signature });
  });
}
