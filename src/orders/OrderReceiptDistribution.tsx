import { useState } from 'react';
import type { OrderPlan } from './types';
import type { DeliveryDraft, DeliveryLine } from '../delivery/types';
import type { InventorySnapshot } from '../domain/types';
import { validateDeliveryLine } from '../delivery/deliveryValidation';
import { distributeDeliveryLine } from './orderDelivery';

function SplitLine({ line, order, draft, data, change, disabled }: { line: DeliveryLine; order: OrderPlan; draft: DeliveryDraft; data: InventorySnapshot; change: (draft: DeliveryDraft) => void; disabled: boolean }) {
  const [values, setValues] = useState<Record<string, string>>({}); const [error, setError] = useState('');
  const item = order.lines.find(candidate => candidate.product.id === line.productId);
  const quantity = validateDeliveryLine(line, data.products, data.locations, []).quantityPacks;
  const remaining = item?.allocations.filter(allocation => allocation.orderedPacks > allocation.receivedPacks) ?? [];
  const fullQuantity = remaining.reduce((sum, allocation) => sum + allocation.orderedPacks - allocation.receivedPacks, 0);
  const unique = draft.lines.filter(candidate => !candidate.excluded && candidate.productId === line.productId).length === 1;
  const canSuggest = unique && !!quantity && quantity === fullQuantity;
  function split(quantities: Record<string, number>) { try { change(distributeDeliveryLine(draft, line.id, quantities, data)); setError(''); } catch (e) { setError(e instanceof Error ? e.message : 'Controleer de verdeling.'); } }
  return <section className="card"><h3>Verdeling: {item?.product.name ?? `pakboncode ${line.articleNumber || '(ontbreekt)'}`}</h3>{!item ? <p>Kies hieronder bij Product in voorraad eerst het product uit de bestelling en bevestig zo nodig de afwijkende pakboncode.</p> : <><p>Op deze pakbonregel: {quantity ?? 'aantal nog controleren'} verpakkingen. Nog te ontvangen voor dit product: {fullQuantity} verpakkingen.</p>
    {canSuggest ? <button disabled={disabled} onClick={() => split(Object.fromEntries(remaining.map(allocation => [allocation.locationId, allocation.orderedPacks - allocation.receivedPacks])))}>Verdeling uit bestelling overnemen</button> : <p>Dit is een deellevering, afwijkend aantal of herhaalde productregel. De medewerker bepaalt de verdeling; de app verdeelt dit niet automatisch.</p>}
    <fieldset className="delivery-fieldset" disabled={disabled}><div className="form-grid">{remaining.map(allocation => <label key={allocation.locationId}>{data.locations.find(location => location.id === allocation.locationId)?.name}: ontvangen verpakkingen<input inputMode="numeric" value={values[allocation.locationId] ?? '0'} onChange={e => setValues(current => ({ ...current, [allocation.locationId]: e.target.value }))} /><small>Nog {allocation.orderedPacks - allocation.receivedPacks} verpakkingen ({(allocation.orderedPacks - allocation.receivedPacks) / item.product.packsPerBox} dozen)</small></label>)}</div><button onClick={() => split(Object.fromEntries(remaining.map(allocation => [allocation.locationId, /^\d+$/.test(values[allocation.locationId] ?? '0') ? Number(values[allocation.locationId] ?? '0') : NaN])))}>Eigen verdeling toepassen</button></fieldset></>}{error && <p className="error" role="alert">{error}</p>}</section>;
}
export function OrderReceiptDistribution({ order, draft, data, change, disabled }: { order: OrderPlan; draft: DeliveryDraft; data: InventorySnapshot; change: (draft: DeliveryDraft) => void; disabled: boolean }) {
  return <section><h2>Verdelen volgens bestelling {order.reference}</h2><p>Neem bij een volledige productlevering de opgeslagen verdeling over. Controleer daarna iedere bestemmingsregel en bevestig de ontvangst. Alle onderstaande aantallen zijn verpakkingen.</p>{draft.lines.filter(line => !line.excluded && !line.destinationLocationId).map(line => <SplitLine key={line.id} line={line} order={order} draft={draft} data={data} change={change} disabled={disabled} />)}</section>;
}
