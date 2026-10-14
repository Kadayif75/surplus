import type { InventoryDatabase } from '../data/db';
import { alertPayload, type AlertPayload } from './types';
import { normalizeServiceUrl } from './alertService';

const sessionKey = 'surplus-mail-access';
export function mailAccess() { try { return sessionStorage.getItem(sessionKey) ?? ''; } catch { return ''; } }
export function setMailAccess(token: string) {
  if (token.startsWith('re_')) throw new Error('Vul hier de toegangscode van de mailserver in. De Resend-sleutel hoort uitsluitend op de server.');
  if (token && token.length < 32) throw new Error('De toegangscode moet minimaal 32 tekens bevatten.');
  if (token) sessionStorage.setItem(sessionKey, token); else sessionStorage.removeItem(sessionKey);
  window.dispatchEvent(new Event('surplus-mail-access'));
}
export class MailError extends Error {
  uncertain: boolean;
  constructor(message: string, uncertain = false) { super(message); this.uncertain = uncertain; }
}
export async function mailRequest(serviceUrl: string, token: string, payload?: AlertPayload, fetcher: typeof fetch = fetch) {
  const url = normalizeServiceUrl(serviceUrl);
  if (!url || !token || token.startsWith('re_')) throw new MailError('Stel de mailserver en toegangscode in bij Voorraadmeldingen.');
  const response = await fetcher(`${url}/${payload ? 'alerts' : 'health'}`, {
    method: payload ? 'POST' : 'GET', headers: { Authorization: `Bearer ${token}`, ...(payload ? { 'Content-Type': 'application/json' } : {}) },
    body: payload ? JSON.stringify(alertPayload(payload)) : undefined, signal: AbortSignal.timeout(15000), credentials: 'omit', redirect: 'error',
  });
  const result = await response.json() as { id?: string; code?: string; from?: string; to?: string[] };
  if (!response.ok) {
    if (result.code === 'uncertain') throw new MailError('Verzending is onzeker. Controleer deze melding in Resend; er wordt niet automatisch opnieuw verstuurd.', true);
    if (response.status === 401 || response.status === 403) throw new MailError('Mailserver weigert toegang. Controleer de toegangscode en toegestane website.');
    if (response.status === 429) throw new MailError('Verzendlimiet bereikt. De melding blijft klaarstaan voor een latere poging.');
    if (result.code === 'configuration') throw new MailError('De mailserver mist geldige Resend-instellingen. Controleer de serverconfiguratie.');
    throw new MailError('De maildienst heeft de melding nog niet bevestigd. Er volgt automatisch een nieuwe poging.');
  }
  if (payload && !result.id) throw new MailError('De maildienst gaf geen verzendbewijs terug. De melding blijft klaarstaan.');
  return result;
}
export async function sendPendingAlerts(db: InventoryDatabase, token: string, fetcher: typeof fetch = fetch) {
  if (!token) return;
  // A short persistent lease prevents separate tabs from claiming the same event.
  for (let index = 0; index < 5; index++) {
    const claimed = await db.transaction('rw', [db.alertSettings, db.alertStates, db.stockAlerts, db.stocks], async () => {
      const settings = await db.alertSettings.get('settings');
      if (!settings?.emailEnabled || !settings.serviceUrl) return;
      const now = Date.now();
      const pending = await db.stockAlerts.where('status').equals('pending').toArray();
      for (const alert of pending) {
        if (alert.nextAttemptAt > now || alert.leaseUntil > now) continue;
        const state = await db.alertStates.get([alert.productId, alert.locationId]);
        if (!state || state.episodeId !== alert.id) { await db.stockAlerts.update(alert.id, { status: 'cancelled' }); continue; }
        await db.stockAlerts.update(alert.id, { leaseUntil: now + 60000, attempts: alert.attempts + 1 });
        return { alert, serviceUrl: settings.serviceUrl };
      }
    });
    if (!claimed) return;
    try {
      const result = await mailRequest(claimed.serviceUrl, token, claimed.alert, fetcher);
      await db.stockAlerts.update(claimed.alert.id, { status: 'accepted', acceptedAt: new Date().toISOString(), emailId: result.id, leaseUntil: 0, lastError: undefined });
    } catch (error) {
      const uncertain = error instanceof MailError && error.uncertain;
      const delay = Math.min(3600000, 60000 * 2 ** Math.min(claimed.alert.attempts, 6));
      await db.stockAlerts.update(claimed.alert.id, { status: uncertain ? 'uncertain' : 'pending', leaseUntil: 0, nextAttemptAt: Date.now() + delay,
        lastError: error instanceof MailError ? error.message : 'Mailserver niet bereikbaar of geen bevestiging ontvangen. De melding blijft bewaard en wordt opnieuw geprobeerd.' });
      return;
    }
  }
}
