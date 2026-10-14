import { useEffect, useState } from 'react';
import { liveQuery } from 'dexie';
import { inventory } from '../data/inventoryRepository';
import { defaultAlertSettings, type StockAlert } from './types';
import { mailAccess, sendPendingAlerts } from './alertSender';

export function useAlerts() {
  const [view, setView] = useState({ settings: defaultAlertSettings(), alerts: [] as StockAlert[], loaded: false });
  const [error, setError] = useState('');
  useEffect(() => {
    let busy = false; let stopped = false;
    async function flush() {
      if (busy || stopped || navigator.onLine === false) return;
      busy = true;
      try { await sendPendingAlerts(inventory.db, mailAccess()); setError(''); }
      catch { if (!stopped) setError('De meldingenwachtrij kon niet worden bijgewerkt. Voorraadmeldingen worden opnieuw geprobeerd.'); }
      finally { busy = false; }
    }
    const subscription = liveQuery(async () => ({ settings: await inventory.db.alertSettings.get('settings') ?? defaultAlertSettings(), alerts: await inventory.db.stockAlerts.orderBy('detectedAt').reverse().toArray(), loaded: true }))
      .subscribe({ next: data => { setView(data); void flush(); }, error: () => setError('Voorraadmeldingen kunnen niet uit de lokale opslag worden gelezen.') });
    const interval = window.setInterval(() => void flush(), 30000);
    const trigger = () => void flush();
    window.addEventListener('online', trigger); window.addEventListener('focus', trigger); window.addEventListener('surplus-mail-access', trigger);
    return () => { stopped = true; subscription.unsubscribe(); clearInterval(interval); window.removeEventListener('online', trigger); window.removeEventListener('focus', trigger); window.removeEventListener('surplus-mail-access', trigger); };
  }, []);
  return { ...view, error };
}
