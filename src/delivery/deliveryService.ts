import type { InventoryDatabase } from '../data/db';
import type { Movement, Product } from '../domain/types';
import { calculateStock, InventoryError } from '../domain/stockService';
import { positiveInteger, validateDeliveryLine } from './deliveryValidation';
import type { DeliveryDraft, DeliveryNote } from './types';

export class DuplicateDeliveryError extends InventoryError {
  readonly previous: DeliveryNote;
  constructor(previous: DeliveryNote) { super('Deze pakbon lijkt al verwerkt te zijn.'); this.previous = previous; }
}
export const normalizeIdentity = (value: string) => value.trim().toLowerCase().replace(/\s+/g, ' ');
export async function hashBytes(bytes: BufferSource) {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
}
export function validateNewProduct(product: Product) {
  if (!product.id || !/^\d{5,10}$/.test(product.tenaArticleNumber) || !product.name.trim() || product.name.length > 160 ||
    !positiveInteger(String(product.packsPerBox)) || !positiveInteger(String(product.piecesPerPack)) || !product.assortmentVerified || product.stockUnit !== 'verpakking') {
    throw new InventoryError('Controleer artikelnummer, productnaam en verpakking van het nieuwe product.');
  }
}
export function createDraft(): DeliveryDraft {
  return { id: crypto.randomUUID(), operationId: crypto.randomUUID(), deliveryNumber: '', supplier: '', deliveryDate: '',
    createdAt: new Date().toISOString(), imageHash: '', lines: [], completenessConfirmed: false };
}
export async function confirmDelivery(db: InventoryDatabase, draft: DeliveryDraft): Promise<DeliveryNote> {
  if (!draft.operationId || !draft.id || !draft.deliveryNumber.trim() || !draft.supplier.trim()) throw new InventoryError('Vul leverancier en pakbon-/leveringsnummer in.');
  if (draft.deliveryDate && (!/^\d{4}-\d{2}-\d{2}$/.test(draft.deliveryDate) || !Number.isFinite(Date.parse(draft.deliveryDate)) || new Date(draft.deliveryDate).toISOString().slice(0,10) !== draft.deliveryDate)) throw new InventoryError('Controleer de leverdatum.');
  if (!draft.completenessConfirmed) throw new InventoryError('Controleer dat alle productregels van de volledige pakbon zijn opgenomen.');
  if (!draft.lines.length || !draft.lines.some(l => !l.excluded)) throw new InventoryError('Voeg minimaal één productregel toe.');
  if (draft.lines.some(l => l.excluded && !l.exclusionReason.trim())) throw new InventoryError('Geef een reden voor elke overgeslagen regel.');
  const signature = JSON.stringify(draft);
  const identityKey = JSON.stringify([normalizeIdentity(draft.supplier), normalizeIdentity(draft.deliveryNumber)]);
  // Across re-photographs and reordered rows. Include article as supplied and exclusions too.
  const fingerprint = await hashBytes(new TextEncoder().encode(JSON.stringify([
    normalizeIdentity(draft.supplier), draft.deliveryDate,
    draft.lines.map(l => [l.articleNumber.trim(), l.productId, l.quantityText, l.unit, l.packsPerBoxText, l.piecesPerPackText, l.excluded]).sort((a,b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
  ])));
  return db.transaction('rw', [db.deliveries, db.products, db.locations, db.stocks, db.movements, db.articleAliases, db.mappings], async () => {
    const existing = await db.deliveries.where('operationId').equals(draft.operationId).first();
    if (existing) {
      if (existing.commandSignature !== signature) throw new InventoryError('Deze ontvangst is al bevestigd met andere gegevens.');
      return existing;
    }
    const previous = await db.deliveries.where('identityKey').equals(identityKey).first()
      ?? await db.deliveries.where('fingerprint').equals(fingerprint).first()
      ?? (draft.imageHash ? await db.deliveries.where('imageHash').equals(draft.imageHash).first() : undefined);
    if (previous) throw new DuplicateDeliveryError(previous);
    const locations = await db.locations.toArray();
    let products = await db.products.toArray();
    const aliases = await db.articleAliases.toArray();
    const mappings = await db.mappings.toArray();
    const received = draft.lines.filter(l => !l.excluded);
    // Validate all staged changes before any writes. Nothing can survive a later failure.
    const staged = new Map<string, Product>();
    for (const line of received) if (line.newProduct) {
      validateNewProduct(line.newProduct);
      if (line.newProduct.id !== line.productId || line.newProduct.tenaArticleNumber !== line.articleNumber) throw new InventoryError('Het nieuwe product moet bij het gelezen artikelnummer horen.');
      if (products.some(p => p.id === line.newProduct!.id || p.tenaArticleNumber === line.newProduct!.tenaArticleNumber)) throw new InventoryError('Dit nieuwe product bestaat inmiddels. Kies het bestaande product.');
      const other = staged.get(line.newProduct.id);
      if (other && JSON.stringify(other) !== JSON.stringify(line.newProduct)) throw new InventoryError('Hetzelfde nieuwe product heeft verschillende gegevens.');
      staged.set(line.newProduct.id, line.newProduct);
    }
    products = [...products, ...staged.values()];
    const validations = received.map(line => validateDeliveryLine(line, products, locations, aliases, received.filter(l => l.articleNumber === line.articleNumber).length > 1, mappings));
    if (validations.some(v => !v.canBook)) throw new InventoryError('Controleer elke productkoppeling, hoeveelheid, verpakking en bestemming en vink de regelcontrole aan.');
    for (const product of staged.values()) {
      await db.products.add(product);
      await db.stocks.bulkAdd(locations.map(l => ({ productId: product.id, locationId: l.id, quantityPacks: 0 })));
    }
    const processedAt = new Date().toISOString();
    const movementIds: string[] = [];
    const lines: DeliveryNote['lines'] = [];
    for (let i = 0; i < received.length; i++) {
      const line = received[i]; const validation = validations[i];
      const product = products.find(p => p.id === line.productId)!;
      if (line.articleNumber !== product.tenaArticleNumber && line.aliasConfirmed) {
        const priorAlias = await db.articleAliases.get(line.articleNumber);
        if (priorAlias && priorAlias.productId !== product.id) throw new InventoryError('Dit artikelnummer is al aan een ander product gekoppeld.');
        await db.articleAliases.put({ articleNumber: line.articleNumber, productId: product.id, verified: true, reason: 'Handmatig bevestigd bij ontvangst' });
      }
      const stock = await db.stocks.get([product.id, line.destinationLocationId]);
      if (!stock) throw new InventoryError('De voorraadpositie ontbreekt. De ontvangst is niet opgeslagen.');
      const quantityPacks = validation.quantityPacks!;
      const stockAfter = calculateStock(stock.quantityPacks, 'IN', quantityPacks);
      const movement: Movement = { id: crypto.randomUUID(), operationId: `${draft.operationId}:${line.id}`, productId: product.id,
        locationId: line.destinationLocationId, type: 'IN', quantityPacks, stockBefore: stock.quantityPacks, stockAfter,
        createdAt: processedAt, actor: 'Demogebruiker', inputSource: 'delivery', isDemoBarcode: false };
      await db.stocks.put({ ...stock, quantityPacks: stockAfter });
      await db.movements.add(movement); movementIds.push(movement.id);
      lines.push({ id: line.id, articleNumber: line.articleNumber, productId: product.id, productName: product.name,
        quantityPacks, locationId: line.destinationLocationId, confidence: validation.confidence,
        manuallyReviewed: line.manuallyReviewed, checks: validation.checks, rawText: line.rawText });
    }
    const note: DeliveryNote = { id: draft.id, operationId: draft.operationId, identityKey, fingerprint,
      imageHash: draft.imageHash || undefined, deliveryNumber: draft.deliveryNumber.trim(), supplier: draft.supplier.trim(),
      deliveryDate: draft.deliveryDate, createdAt: draft.createdAt, processedAt, actor: 'Demogebruiker', status: 'Verwerkt',
      lines, excludedLines: draft.lines.filter(l => l.excluded).map(l => ({ rawText: l.rawText, reason: l.exclusionReason })),
      movementIds, commandSignature: signature };
    await db.deliveries.add(note);
    return note;
  });
}
