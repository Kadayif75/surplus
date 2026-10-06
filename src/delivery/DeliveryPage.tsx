import { useEffect, useRef, useState } from 'react';
import { liveQuery } from 'dexie';
import { inventory } from '../data/inventoryRepository';
import type { InventorySnapshot, StockPosition } from '../domain/types';
import { InventoryError } from '../domain/stockService';
import type { ArticleAlias, DeliveryDraft, DeliveryNote } from './types';
import { createDraft, confirmDelivery, DuplicateDeliveryError, hashBytes } from './deliveryService';
import { resolveProduct, validateDeliveryLine } from './deliveryValidation';
import { analyzeDeliveryImage } from './deliveryOcr';
import { DeliveryScanner } from './DeliveryScanner';
import { DeliveryReview, emptyLine } from './DeliveryReview';

export function DeliveryPage({ data }: { data: InventorySnapshot }) {
  const [draft, setDraft] = useState<DeliveryDraft>(createDraft);
  const [aliases, setAliases] = useState<ArticleAlias[]>([]);
  const [canvas, setCanvas] = useState<HTMLCanvasElement>();
  const [preview, setPreview] = useState('');
  const [scanner, setScanner] = useState(false);
  const [busy, setBusy] = useState(false);
  const [reading, setReading] = useState(false);
  const [progress, setProgress] = useState('');
  const [error, setError] = useState('');
  const [completed, setCompleted] = useState<DeliveryNote>();
  const [duplicate, setDuplicate] = useState<DeliveryNote>();
  const fileInput = useRef<HTMLInputElement>(null);
  const photoInput = useRef<HTMLInputElement>(null);
  const controller = useRef<AbortController | undefined>(undefined);
  const alive = useRef(true);
  const generation = useRef(0);
  const lock = useRef(false);
  const retryDraft = useRef<DeliveryDraft | undefined>(undefined);
  const receiptBefore = useRef<StockPosition[] | undefined>(undefined);
  useEffect(() => {
    alive.current = true;
    const subscription = liveQuery(() => inventory.db.articleAliases.toArray()).subscribe({ next: setAliases, error: () => setError('Productkoppelingen kunnen niet worden geladen. Heropen de app.') });
    return () => { alive.current = false; generation.current++; controller.current?.abort(); subscription.unsubscribe(); };
  }, []);
  function reset() {
    generation.current++; controller.current?.abort(); setReading(false); setBusy(false); setProgress('');
    setCanvas(undefined); setPreview(''); setDraft(createDraft()); setScanner(false); setCompleted(undefined); setDuplicate(undefined); setError(''); retryDraft.current = undefined; receiptBefore.current = undefined;
  }
  async function chooseFile(file?: File) {
    if (!file) return;
    const token = ++generation.current; setError(''); setScanner(false);
    try {
      if (file.size > 20 * 1024 * 1024) throw new InventoryError('Deze afbeelding is groter dan 20 MB. Kies een kleinere foto.');
      if (!file.type.startsWith('image/') && !/\.(jpe?g|jfif|png|webp)$/i.test(file.name)) throw new InventoryError('Kies een foto of afbeelding (JPG, PNG of WebP). PDF wordt nog niet ondersteund.');
      const bitmap = await createImageBitmap(file);
      const scale = Math.min(1, 2400 / Math.max(bitmap.width, bitmap.height));
      const image = document.createElement('canvas'); image.width = Math.round(bitmap.width * scale); image.height = Math.round(bitmap.height * scale);
      image.getContext('2d')!.drawImage(bitmap, 0, 0, image.width, image.height); bitmap.close();
      const imageHash = await hashBytes(await file.arrayBuffer());
      if (!alive.current || generation.current !== token) return;
      setCanvas(image); setPreview(image.toDataURL('image/jpeg', .95)); setDraft({ ...createDraft(), imageHash }); setDuplicate(undefined);
    } catch (e) { if (alive.current && generation.current === token) setError(e instanceof InventoryError ? e.message : 'Deze afbeelding kan niet worden geopend. Maak een nieuwe foto of kies een JPG- of PNG-bestand.'); }
  }
  function rotate() {
    if (!canvas) return;
    const rotated = document.createElement('canvas'); rotated.width = canvas.height; rotated.height = canvas.width;
    const context = rotated.getContext('2d')!; context.translate(rotated.width, 0); context.rotate(Math.PI / 2); context.drawImage(canvas, 0, 0);
    setCanvas(rotated); setPreview(rotated.toDataURL('image/jpeg', .95));
  }
  async function read() {
    if (!canvas || lock.current) return;
    lock.current = true; setReading(true); setError(''); const token = ++generation.current;
    const control = new AbortController(); controller.current = control;
    try {
      const result = await analyzeDeliveryImage(canvas, control.signal, message => { if (alive.current && token === generation.current) setProgress(message); });
      if (!alive.current || token !== generation.current) return;
      setDraft(current => ({ ...current, ...result.metadata, lines: result.lines.map(line => ({ ...line, id: crypto.randomUUID(), productId: resolveProduct(line.articleNumber, data.products, aliases)?.id ?? '', destinationLocationId: '', manuallyReviewed: false, aliasConfirmed: false, excluded: false, exclusionReason: '' })), completenessConfirmed: false }));
      if (!result.lines.length) setError('Geen productregels betrouwbaar gevonden. Draai de foto, maak een scherpere foto of voeg regels handmatig toe.');
    } catch {
      if (alive.current && token === generation.current && !control.signal.aborted) setError('Uitlezen is niet gelukt. Controleer je verbinding voor het laden van de app, probeer een scherpere foto of voer regels handmatig in.');
    } finally { lock.current = false; if (alive.current && token === generation.current) { setReading(false); setProgress(''); } }
  }
  const received = draft.lines.filter(l => !l.excluded);
  const validations = received.map(l => validateDeliveryLine(l, data.products, data.locations, aliases, received.filter(other => other.articleNumber === l.articleNumber).length > 1, data.mappings));
  const ready = !!draft.deliveryNumber.trim() && !!draft.supplier.trim() && draft.completenessConfirmed && received.length > 0 && validations.every(v => v.canBook) && draft.lines.every(l => !l.excluded || !!l.exclusionReason.trim());
  async function confirm() {
    if (lock.current) return;
    lock.current = true; setBusy(true); setError('');
    const command = retryDraft.current ?? structuredClone(draft);
    if (!retryDraft.current) receiptBefore.current = structuredClone(data.stocks);
    try {
      const result = await confirmDelivery(inventory.db, command);
      if (!alive.current) return;
      setCompleted(result); setCanvas(undefined); setPreview(''); retryDraft.current = undefined; receiptBefore.current = undefined;
    } catch (e) {
      if (!alive.current) return;
      if (e instanceof DuplicateDeliveryError) { setDuplicate(e.previous); setError(e.message); retryDraft.current = undefined; receiptBefore.current = undefined; }
      else if (e instanceof InventoryError) { setError(e.message); retryDraft.current = undefined; receiptBefore.current = undefined; }
      else { retryDraft.current = command; setError('Opslaan is niet gelukt of de uitkomst is nog onzeker. Probeer dezelfde ontvangst opnieuw. De app voorkomt dat deze twee keer wordt geboekt.'); }
    } finally { lock.current = false; if (alive.current) setBusy(false); }
  }
  if (completed) return <><div className="page-heading"><div><h1>Ontvangst bevestigd</h1><p>De voorraad is bijgewerkt. De foto is uit het geheugen verwijderd.</p></div></div><section className="card"><h2>{completed.supplier} · {completed.deliveryNumber}</h2><div className="success" role="status">{completed.lines.reduce((sum,l) => sum + l.quantityPacks, 0)} verpakkingen toegevoegd.</div>{completed.lines.map(line => <p key={line.id}>{line.quantityPacks} verpakkingen {line.productName} → {data.locations.find(l => l.id === line.locationId)?.name}</p>)}<div className="actions"><button className="primary" onClick={reset}>Volgende pakbon</button></div></section></>;
  return <>
    <div className="page-heading"><div><p className="eyebrow">Binnenkomende levering</p><h1>Pakbon verwerken</h1><p>Foto maken → uitlezen → controleren → ontvangst bevestigen.</p></div></div>
    <p className="notice">Tekstherkenning vindt op dit apparaat plaats. De foto wordt niet naar een OCR-dienst gestuurd en wordt niet opgeslagen. Voorraad en historie blijven in deze browser.</p>
    {error && <p className="error" role="alert">{error}</p>}
    {duplicate && <section className="card"><h2>Eerder verwerkt</h2><p>{duplicate.supplier} · {duplicate.deliveryNumber} · {new Date(duplicate.processedAt).toLocaleString('nl-NL')}</p>{duplicate.lines.map(l => <p key={l.id}>{l.productName}: {l.quantityPacks} verpakkingen</p>)}<p>Er is niets opnieuw geboekt.</p></section>}
    {!draft.lines.length && !reading && <section className="card"><h2>Pakbon invoeren</h2><div className="actions"><button className="primary" onClick={() => setScanner(true)}>Pakbon scannen</button><button className="secondary" onClick={() => photoInput.current?.click()}>Foto maken</button><button onClick={() => fileInput.current?.click()}>Afbeelding uploaden</button></div><div className="actions"><button onClick={() => setDraft({ ...draft, lines: [emptyLine()] })}>Handmatig invoeren</button></div><input className="visually-hidden" ref={fileInput} type="file" accept="image/*,.jfif" aria-label="Pakbonafbeelding kiezen" onChange={e => { void chooseFile(e.target.files?.[0]); e.target.value = ''; }} /><input className="visually-hidden" ref={photoInput} type="file" accept="image/*" capture="environment" aria-label="Pakbonfoto maken" onChange={e => { void chooseFile(e.target.files?.[0]); e.target.value = ''; }} /></section>}
    {scanner && <DeliveryScanner captured={file => void chooseFile(file)} close={() => setScanner(false)} />}
    <div className="delivery-layout">
      {preview && <aside className="card delivery-photo"><h2>Controleer de foto</h2><img src={preview} alt="Tijdelijke foto van de ingevoerde pakbon" /><details className="validation-details"><summary>Foto vergroten voor regelcontrole</summary><div className="delivery-image-scroll"><img src={preview} alt="Vergrote tijdelijke pakbonfoto; schuif om alle regels te bekijken" style={{ width: canvas?.width }} /></div></details><p>Vergelijk alle regels met de foto. Draai deze vóór het uitlezen als de tekst niet rechtop staat.</p><div className="actions"><button disabled={reading || busy || !!retryDraft.current || !!draft.lines.length} onClick={rotate}>Foto 90° draaien</button>{!draft.lines.length && <button className="primary" disabled={reading} onClick={() => void read()}>Pakbon uitlezen</button>}</div></aside>}
      <div>
        {reading && <section className="card" role="status"><h2>Pakbon wordt uitgelezen</h2><p>{progress}</p><div className="actions"><button onClick={reset}>Uitlezen annuleren</button></div></section>}
        {!!draft.lines.length && <><DeliveryReview draft={draft} data={data} aliases={aliases} change={setDraft} disabled={busy || !!retryDraft.current || !!duplicate} />
          <section className="card delivery-final"><h2>Voorraad na bevestiging</h2><p>Alle aantallen hieronder zijn ongeopende verpakkingen.</p><div className="table-wrap"><table><thead><tr><th>Product</th><th>Bestemming</th><th>Ontvangen</th><th>Voorraad</th></tr></thead><tbody>{received.map((line,index) => {
            const product = line.newProduct ?? data.products.find(p => p.id === line.productId); const quantity = validations[index].quantityPacks;
            const before = ((busy || retryDraft.current) && receiptBefore.current ? receiptBefore.current : data.stocks).find(s => s.productId === line.productId && s.locationId === line.destinationLocationId)?.quantityPacks ?? (line.newProduct ? 0 : undefined);
            const earlier = received.slice(0,index).reduce((sum,other,i) => other.productId === line.productId && other.destinationLocationId === line.destinationLocationId ? sum + (validations[i].quantityPacks ?? 0) : sum, 0);
            return <tr key={line.id}><td>{product?.name ?? 'Nog niet gekoppeld'}<small>Pakboncode {line.articleNumber || 'ontbreekt'}</small></td><td>{data.locations.find(l => l.id === line.destinationLocationId)?.name ?? 'Nog niet vastgesteld'}</td><td>{quantity ?? 'Controle nodig'}</td><td>{before !== undefined && quantity !== undefined ? `${before + earlier} → ${before + earlier + quantity}` : 'Controle nodig'}</td></tr>;
          })}</tbody></table></div><div className="actions"><button className="primary" disabled={busy || !!duplicate || (!retryDraft.current && !ready)} onClick={() => void confirm()}>{busy ? 'Ontvangst opslaan…' : retryDraft.current ? 'Dezelfde ontvangst opnieuw proberen' : 'Ontvangst bevestigen'}</button></div>{!ready && !retryDraft.current && <p className="small">Controleer alle regels, kies de bestemmingen en bevestig dat de pakbon volledig is.</p>}</section>
        </>}
      </div>
    </div>
    {(canvas || draft.lines.length > 0 || duplicate) && <div className="actions"><button disabled={busy || !!retryDraft.current} onClick={reset}>Annuleren / nieuwe pakbon</button></div>}
  </>;
}
