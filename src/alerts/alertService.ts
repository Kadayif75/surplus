import type { InventoryDatabase } from '../data/db';
import { InventoryError } from '../domain/stockService';
import { defaultAlertSettings, minimumFor, productLimitKey, type AlertSettings } from './types';

export const alertTables = (db: InventoryDatabase) => [db.alertSettings, db.alertStates, db.stockAlerts];
export const alertEvaluationTables = (db: InventoryDatabase) => [...alertTables(db), db.stocks, db.products, db.locations];
// Runs inside the same transaction as a stock change. Network calls never run here.
export async function captureStockAlerts(db: InventoryDatabase) {
  const settings = await db.alertSettings.get('settings');
  if (!settings) return;
  const products = await db.products.toArray(); const locations = await db.locations.toArray();
  for (const stock of await db.stocks.toArray()) {
    const key: [string, string] = [stock.productId, stock.locationId];
    const state = await db.alertStates.get(key);
    const minimum = minimumFor(settings, ...key);
    const product = products.find(item => item.id === stock.productId); const location = locations.find(item => item.id === stock.locationId);
    const low = minimum !== undefined && stock.quantityPacks <= minimum && product && location;
    if (!low) {
      if (state) {
        // An in-flight request may already have reached Resend; keep its eventual receipt.
        const alert = await db.stockAlerts.get(state.episodeId);
        if (alert?.status === 'pending' && alert.leaseUntil <= Date.now()) await db.stockAlerts.update(alert.id, { status: 'cancelled', lastError: undefined });
        await db.alertStates.delete(key);
      }
    } else if (!state) {
      const id = crypto.randomUUID();
      await db.stockAlerts.add({ id, kind: 'low-stock', productId: stock.productId, locationId: stock.locationId,
        productName: product.name, articleNumber: product.tenaArticleNumber, locationName: location.name,
        quantity: stock.quantityPacks, minimum, detectedAt: new Date().toISOString(),
        status: 'pending', attempts: 0, nextAttemptAt: 0, leaseUntil: 0 });
      await db.alertStates.put({ productId: stock.productId, locationId: stock.locationId, episodeId: id });
    }
  }
}
export function normalizeServiceUrl(value: string) {
  if (!value.trim()) return '';
  let url: URL; try { url = new URL(value.trim()); } catch { throw new InventoryError('Vul een geldige URL van de mailserver in.'); }
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if ((url.protocol !== 'https:' && !(local && url.protocol === 'http:')) || url.username || url.password || url.search || url.hash) throw new InventoryError('Gebruik HTTPS voor de mailserver, of HTTP op localhost tijdens de lokale demo.');
  return url.href.replace(/\/$/, '');
}
export async function saveAlertSettings(db: InventoryDatabase, input: AlertSettings) {
  await db.transaction('rw', alertEvaluationTables(db), async () => {
    const rooms = await db.locations.toArray(); const products = await db.products.toArray();
    const keys = new Set(products.flatMap(p => rooms.map(l => productLimitKey(p.id, l.id))));
    const validMinimum = (value: number) => Number.isSafeInteger(value) && value >= 0 && value <= 1000000;
    if (Object.entries(input.roomMinimums).some(([key, value]) => !rooms.some(room => room.id === key) || !validMinimum(value)) || Object.entries(input.productMinimums).some(([key, value]) => !keys.has(key) || !validMinimum(value))) throw new InventoryError('Gebruik voor minimumvoorraad een geheel aantal van 0 tot en met 1.000.000.');
    const serviceUrl = normalizeServiceUrl(input.serviceUrl);
    if (input.emailEnabled && !serviceUrl) throw new InventoryError('Stel eerst de mailserver in om e-mailmeldingen aan te zetten.');
    await db.alertSettings.put({ ...defaultAlertSettings(), ...input, id: 'settings', serviceUrl });
    await captureStockAlerts(db);
  });
}
