import { useEffect, useState } from 'react';
import { liveQuery } from 'dexie';
import { inventory } from '../data/inventoryRepository';
import type { InventorySnapshot } from '../domain/types';
import type { DeliveryNote } from './types';

export function DeliveryHistory({ data }: { data: InventorySnapshot }) {
  const [notes, setNotes] = useState<DeliveryNote[]>([]);
  const [error, setError] = useState('');
  useEffect(() => {
    const subscription = liveQuery(() => inventory.db.deliveries.orderBy('processedAt').reverse().toArray()).subscribe({ next: setNotes, error: () => setError('De pakbonhistorie kan niet worden geladen. Heropen de app.') });
    return () => subscription.unsubscribe();
  }, []);
  return <><div className="page-heading"><div><h1>Pakbonhistorie</h1><p>Bevestigde ontvangsten in deze browser. De originele foto's en PDF’s worden niet bewaard.</p></div></div>{error && <p className="error" role="alert">{error}</p>}{!notes.length && <p className="card">Nog geen pakbon verwerkt.</p>}{notes.map(note => <section className="card delivery-history" key={note.id}><h2>{note.supplier} · {note.deliveryNumber}</h2><p>{new Date(note.processedAt).toLocaleString('nl-NL')} · {note.status} · {note.actor}</p><p>{note.lines.length} productregels · {note.lines.reduce((sum,l) => sum + l.quantityPacks, 0)} verpakkingen · Leverdatum {note.deliveryDate || 'niet vermeld'}</p><details><summary>Producten en gekoppelde mutaties</summary>{note.lines.map((line,i) => {
    const movement = data.movements.find(m => m.id === note.movementIds[i]);
    return <div className="history-line" key={line.id}><strong>{line.productName}</strong><p>{line.sourcePage && `PDF-pagina ${line.sourcePage} · `}Pakboncode {line.articleNumber} · {line.quantityPacks} verpakkingen → {data.locations.find(l => l.id === line.locationId)?.name ?? line.locationId}</p><p>{line.confidence} · {line.manuallyReviewed ? 'Handmatig gecontroleerd' : 'Automatisch gecontroleerd'}</p><p>Voorraad: {movement ? `${movement.stockBefore} → ${movement.stockAfter}` : 'mutatie niet beschikbaar'}</p><small>Mutatie: {note.movementIds[i]}</small></div>;
  })}{note.excludedLines.map((line,i) => <p key={i}>{line.sourcePage && `PDF-pagina ${line.sourcePage} · `}Overgeslagen: {line.rawText}. Reden: {line.reason}</p>)}</details></section>)}</>;
}
