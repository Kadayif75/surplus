import { useState } from 'react';
import type { InventorySnapshot } from '../domain/types';
import { inventory } from '../data/inventoryRepository';
import { minimumFor, productLimitKey, type AlertSettings, type StockAlert } from './types';
import { saveAlertSettings } from './alertService';
import { mailAccess, mailRequest, setMailAccess } from './alertSender';

export function AlertsPage({ data, settings, alerts }: { data: InventorySnapshot; settings: AlertSettings; alerts: StockAlert[] }) {
  const [rooms, setRooms] = useState<Record<string, string>>(() => Object.fromEntries(Object.entries(settings.roomMinimums).map(([id, value]) => [id, String(value)])));
  const [products, setProducts] = useState<Record<string, string>>(() => Object.fromEntries(Object.entries(settings.productMinimums).map(([id, value]) => [id, String(value)])));
  const [room, setRoom] = useState(data.locations[0].id);
  const [url, setUrl] = useState(settings.serviceUrl);
  const [enabled, setEnabled] = useState(settings.emailEnabled);
  const [token, setToken] = useState(mailAccess);
  const [busy, setBusy] = useState(false); const [message, setMessage] = useState(''); const [error, setError] = useState('');
  const [recipient, setRecipient] = useState('');
  const low = data.stocks.filter(stock => { const minimum = minimumFor(settings, stock.productId, stock.locationId); return minimum !== undefined && stock.quantityPacks <= minimum; });
  async function task(action: () => Promise<void>) { if (busy) return; setBusy(true); setError(''); setMessage(''); try { await action(); } catch (e) { setError(e instanceof Error ? e.message : 'De actie is niet gelukt. Probeer opnieuw.'); } finally { setBusy(false); } }
  function limits(values: Record<string, string>) {
    const entries = Object.entries(values).filter(([, value]) => value.trim() !== '');
    if (entries.some(([, value]) => !/^\d+$/.test(value.trim()))) throw new Error('Vul gehele aantallen in. Laat leeg om de standaard te gebruiken.');
    return Object.fromEntries(entries.map(([key, value]) => [key, Number(value)]));
  }
  return <>
    <div className="page-heading"><div><p className="eyebrow">Op tijd bijbestellen</p><h1>Voorraadmeldingen</h1><p>Ontvang één e-mail zodra een product op of onder zijn minimum komt.</p></div></div>
    {message && <p className="success" role="status">{message}</p>}{error && <p className="error" role="alert">{error}</p>}
    <section className="card alert-card"><h2>Nu bijbestellen</h2>{low.length ? <div className="table-wrap"><table><thead><tr><th>Product</th><th>Ruimte</th><th>Voorraad</th><th>Minimum</th></tr></thead><tbody>{low.map(stock => <tr key={productLimitKey(stock.productId, stock.locationId)}><td>{data.products.find(p => p.id === stock.productId)?.name}</td><td>{data.locations.find(l => l.id === stock.locationId)?.name}</td><td>{stock.quantityPacks}</td><td>{minimumFor(settings, stock.productId, stock.locationId)}</td></tr>)}</tbody></table></div> : <p>Geen producten op of onder een ingesteld minimum.</p>}</section>
    <form className="card alert-card settings-form" onSubmit={event => { event.preventDefault(); void task(async () => {
      await saveAlertSettings(inventory.db, { ...settings, roomMinimums: limits(rooms), productMinimums: limits(products) });
      setMessage('Minimumvoorraden opgeslagen. Producten die nu al laag staan worden ook meegenomen.');
    }); }}>
      <h2>Minimumvoorraad instellen</h2><p>Alle aantallen zijn ongeopende verpakkingen. Een minimum van 5 geeft een melding bij 5 of minder. Na aanvullen boven 5 kan bij een volgende daling opnieuw een melding volgen.</p>
      <h3>Standaard per voorraadruimte</h3><p>Deze grens geldt voor ieder product in de ruimte. Leeg betekent geen standaardgrens.</p>
      <div className="form-grid">{data.locations.map(location => <label key={location.id}>{location.name}: minimum<input type="number" min="0" max="1000000" step="1" value={rooms[location.id] ?? ''} placeholder="Geen standaardgrens" onChange={e => setRooms({ ...rooms, [location.id]: e.target.value })} /></label>)}</div>
      <details><summary>Afwijkend minimum per product</summary><label>Voorraadruimte<select value={room} onChange={e => setRoom(e.target.value)}>{data.locations.map(location => <option key={location.id} value={location.id}>{location.name}</option>)}</select></label><p>Laat een product leeg om de standaard van deze ruimte te gebruiken.</p>
        <div className="table-wrap"><table><thead><tr><th>Product</th><th>Eigen minimum</th></tr></thead><tbody>{data.products.map(product => { const key = productLimitKey(product.id, room); return <tr key={product.id}><td>{product.name}<small>{product.tenaArticleNumber}</small></td><td><input aria-label={`Minimum ${product.name} in ${data.locations.find(l => l.id === room)?.name}`} type="number" min="0" max="1000000" step="1" placeholder={rooms[room] || 'Geen grens'} value={products[key] ?? ''} onChange={e => setProducts({ ...products, [key]: e.target.value })} /></td></tr>; })}</tbody></table></div>
      </details><button className="primary" disabled={busy}>Minimumvoorraden opslaan</button>
    </form>
    <section className="card alert-card"><h2>E-mailmeldingen</h2><p>{settings.emailEnabled ? 'E-mailmeldingen staan aan.' : 'E-mailmeldingen staan uit. Lage voorraden blijven hierboven zichtbaar.'}</p><p>De app verstuurt terwijl deze open is. Bij geen verbinding blijven meldingen bewaard voor een nieuwe poging. Gebruik dezelfde browser voor voorraad en meldingen.</p>
      {!mailAccess() && settings.emailEnabled && <p className="notice">Vul de toegangscode opnieuw in om vanuit dit tabblad e-mails te versturen.</p>}
      <form className="settings-form" onSubmit={event => { event.preventDefault(); void task(async () => {
        if (enabled && !token) throw new Error('Vul de toegangscode in om e-mailmeldingen aan te zetten.');
        // Check credentials before enabling an automatic send of pending stock alerts.
        if (enabled) { const result = await mailRequest(url, token); setRecipient((result.to ?? []).join(', ')); }
        await saveAlertSettings(inventory.db, { ...settings, emailEnabled: enabled, serviceUrl: url });
        setMailAccess(token); setMessage(enabled ? 'E-mailmeldingen staan aan. Klaarstaande meldingen worden automatisch aangeboden.' : 'E-mailmeldingen staan uit.');
      }); }}>
        <label className="checkbox"><input type="checkbox" checked={enabled} onChange={e => setEnabled(e.target.checked)} />E-mailmeldingen aanzetten</label>
        <details open={!settings.serviceUrl}><summary>Verbinding met de mailserver</summary><div className="settings-form">
          <label>Mailserver-URL<input type="url" value={url} placeholder="http://127.0.0.1:8787" onChange={e => setUrl(e.target.value)} /></label>
          <label>Toegangscode<input type="password" autoComplete="off" value={token} onChange={e => setToken(e.target.value)} /></label>
          <p className="small">Gebruik APP_TOKEN uit de lokale mailserverconfiguratie. Deze code blijft alleen in dit tabblad bewaard. De Resend-API-sleutel hoort uitsluitend in de serverconfiguratie.</p>
        </div></details><button className="secondary" disabled={busy}>E-mailinstellingen opslaan</button>
      </form>
      {recipient && <p>Ontvanger: {recipient}</p>}
      <button className="text-button" disabled={busy || !url || !token} onClick={() => void task(async () => {
        const config = await mailRequest(url, token); setRecipient((config.to ?? []).join(', '));
        await mailRequest(url, token, { id: crypto.randomUUID(), kind: 'test', productName: 'Testmelding', articleNumber: 'TEST', locationName: 'Ganshoek', quantity: 0, minimum: 0, detectedAt: new Date().toISOString() });
        setMessage('Testmail door Resend geaccepteerd. Controleer de inbox en eventueel ongewenste e-mail.');
      })}>Testmail versturen</button>
    </section>
    <section className="card alert-card"><h2>Recente meldingen</h2><p className="small">“Aangeboden” betekent dat Resend de e-mail heeft geaccepteerd; aflevering in de inbox is daarmee niet bevestigd. Aantallen hieronder zijn van het moment waarop de grens werd bereikt.</p>{!alerts.length ? <p>Er zijn nog geen meldingen.</p> : <div className="table-wrap"><table><thead><tr><th>Product / ruimte</th><th>Voorraad / minimum</th><th>Status</th></tr></thead><tbody>{alerts.slice(0, 50).map(alert => <tr key={alert.id}><td>{alert.productName}<small>{alert.locationName} · {new Date(alert.detectedAt).toLocaleString('nl-NL')}</small></td><td>{alert.quantity} / {alert.minimum}</td><td>{({ pending: 'Klaar voor verzending', accepted: 'Aangeboden aan Resend', cancelled: 'Vervallen: grens niet meer bereikt', uncertain: 'Verzending onzeker: controleer Resend' })[alert.status]}{alert.lastError && <small>{alert.lastError}</small>}{alert.status === 'uncertain' && <small>Melding-ID: {alert.id}</small>}</td></tr>)}</tbody></table></div>}</section>
  </>;
}
