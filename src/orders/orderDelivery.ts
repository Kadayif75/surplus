import type { OrderPlan } from './types';
import type { DeliveryDraft } from '../delivery/types';
import type { InventorySnapshot } from '../domain/types';
import { InventoryError } from '../domain/stockService';
import { validateDeliveryLine } from '../delivery/deliveryValidation';

export function orderDeliveryProblems(order: OrderPlan | undefined, draft: DeliveryDraft, data: InventorySnapshot): string[] {
  if (!draft.orderId) return [];
  if (!order || order.id !== draft.orderId || (order.status !== 'Besteld' && !(order.sourceKind === 'merged-workbooks' && order.status === 'Concept'))) return ['Kies een nog openstaande bestelling of samenvoeging.'];
  const amounts = new Map<string, number>(); const problems: string[] = [];
  for (const line of draft.lines.filter(item => !item.excluded)) {
    const item = order.lines.find(candidate => candidate.product.id === line.productId);
    const allocation = item?.allocations.find(candidate => candidate.locationId === line.destinationLocationId);
    if (!item) { problems.push(`Artikel ${line.articleNumber || '(ontbreekt)'} is nog niet gekoppeld aan een product uit deze bestelling. Controleer de productkeuze.`); continue; }
    if (!line.destinationLocationId) continue;
    if (!allocation) { problems.push(`${item.product.name} is niet voor deze bestemming besteld. Controleer de verdeling.`); continue; }
    const quantity = validateDeliveryLine(line, data.products, data.locations, []).quantityPacks;
    if (quantity !== undefined) { const key = `${item.product.id}:${allocation.locationId}`; amounts.set(key, (amounts.get(key) ?? 0) + quantity); }
  }
  for (const item of order.lines) for (const allocation of item.allocations) {
    const quantity = amounts.get(`${item.product.id}:${allocation.locationId}`) ?? 0;
    if (quantity > allocation.orderedPacks - allocation.receivedPacks) problems.push(`${item.product.name} naar ${data.locations.find(location => location.id === allocation.locationId)?.name ?? allocation.locationId}: ${quantity} verpakkingen toegewezen, maar nog ${allocation.orderedPacks - allocation.receivedPacks} te ontvangen. Controleer eerdere leveringen en verdeling.`);
  }
  return [...new Set(problems)];
}
export function distributeDeliveryLine(draft: DeliveryDraft, lineId: string, quantities: Record<string, number>, data: InventorySnapshot): DeliveryDraft {
  const line = draft.lines.find(item => item.id === lineId);
  if (!line || line.excluded) throw new InventoryError('Kies een opgenomen productregel.');
  const validation = validateDeliveryLine(line, data.products, data.locations, []);
  if (!validation.checks['Verpakking komt overeen'] || validation.quantityPacks === undefined) throw new InventoryError('Koppel eerst het juiste product en controleer aantal en doosinhoud.');
  const destinations = Object.entries(quantities).filter(([, amount]) => amount !== 0);
  if (!destinations.length || destinations.some(([id, amount]) => !data.locations.some(location => location.id === id) || !Number.isSafeInteger(amount) || amount < 0) || destinations.reduce((sum, [, amount]) => sum + amount, 0) !== validation.quantityPacks) throw new InventoryError(`Verdeel precies ${validation.quantityPacks} ontvangen verpakkingen over geldige locaties. Nul is toegestaan; andere aantallen moeten positief en geheel zijn.`);
  const split = destinations.map(([destinationLocationId, quantity]) => ({ ...line, id: crypto.randomUUID(), unit: 'verpakking' as const, quantityText: String(quantity), destinationLocationId, manuallyReviewed: false }));
  return { ...draft, completenessConfirmed: false, lines: draft.lines.flatMap(item => item.id === lineId ? split : [item]) };
}
