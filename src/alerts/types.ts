export interface AlertSettings {
  id: 'settings'; roomMinimums: Record<string, number>; productMinimums: Record<string, number>;
  emailEnabled: boolean; serviceUrl: string;
}
export interface AlertState { productId: string; locationId: string; episodeId: string }
export interface AlertPayload {
  id: string; kind: 'low-stock' | 'test'; productName: string; articleNumber: string;
  locationName: string; quantity: number; minimum: number; detectedAt: string;
}
export interface StockAlert extends AlertPayload {
  productId: string; locationId: string; status: 'pending' | 'accepted' | 'cancelled' | 'uncertain';
  attempts: number; nextAttemptAt: number; leaseUntil: number; lastError?: string; acceptedAt?: string; emailId?: string;
}
export const defaultAlertSettings = (): AlertSettings => ({ id: 'settings', roomMinimums: {}, productMinimums: {}, emailEnabled: false, serviceUrl: '' });
export const productLimitKey = (productId: string, locationId: string) => JSON.stringify([productId, locationId]);
export const minimumFor = (settings: AlertSettings, productId: string, locationId: string) => settings.productMinimums[productLimitKey(productId, locationId)] ?? settings.roomMinimums[locationId];
export function alertPayload(alert: AlertPayload): AlertPayload {
  return { id: alert.id, kind: alert.kind, productName: alert.productName, articleNumber: alert.articleNumber, locationName: alert.locationName, quantity: alert.quantity, minimum: alert.minimum, detectedAt: alert.detectedAt };
}
