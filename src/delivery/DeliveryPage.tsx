import { useEffect, useRef, useState } from 'react';
import { liveQuery } from 'dexie';
import { inventory } from '../data/inventoryRepository';
import type { InventorySnapshot, StockPosition } from '../domain/types';
import { InventoryError } from '../domain/stockService';
import type { ArticleAlias, DeliveryDraft, DeliveryNote } from './types';
import { createDraft, confirmDelivery, DuplicateDeliveryError, hashBytes } from './deliveryService';
import { resolveProduct, validateDeliveryLine } from './deliveryValidation';
import { analyzeDeliveryImage } from './deliveryOcr';
import { analyzeDeliveryPages } from './deliveryDocumentOcr';
import { checkDocumentFile, openDeliveryPdf, type DeliveryPdf } from './deliveryPdf';
import { DeliveryScanner } from './DeliveryScanner';
import { DeliveryReview, emptyLine } from './DeliveryReview';

export function DeliveryPage({ data }: { data: InventorySnapshot }) {
  const [draft, setDraft] = useState<DeliveryDraft>(createDraft);
  const [aliases, setAliases] = useState<ArticleAlias[]>([]);
  const [canvas, setCanvas] = useState<HTMLCanvasElement>();
  const [preview, setPreview] = useState('');
  const [pageCount, setPageCount] = useState(0);
  const [pageNumber, setPageNumber] = useState(1);
  const [loading, setLoading] = useState(false);
  const pdf = useRef<DeliveryPdf | undefined>(undefined);
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
    return () => { alive.current = false; generation.current++; controller.current?.abort(); void pdf.current?.destroy(); subscription.unsubscribe(); };
  }, []);
  function reset() {
    generation.current++; controller.current?.abort(); void pdf.current?.destroy(); pdf.current = undefined; lock.current = false; setPageCount(0); setPageNumber(1); setLoading(false); setReading(false); setBusy(false); setProgress('');
    setCanvas(undefined); setPreview(''); setDraft(createDraft()); setScanner(false); setCompleted(undefined); setDuplicate(undefined); setError(''); retryDraft.current = undefined; receiptBefore.current = undefined;
  }
  async function chooseFile(file?: File) {
    if (!file) return;
    controller.current?.abort(); void pdf.current?.destroy(); pdf.current = undefined;
    const token = ++generation.current; const control = new AbortController(); controller.current = control;
    setError(''); setScanner(false); setLoading(true); setCanvas(undefined); setPreview(''); setPageCount(0); setPageNumber(1); setDraft(createDraft()); setDuplicate(undefined);
    let opened: DeliveryPdf | undefined;
    try {
      const kind = checkDocumentFile(file); const bytes = await file.arrayBuffer(); const imageHash = await hashBytes(bytes);
      if (control.signal.aborted) return;
      let image: HTMLCanvasElement;
      if (kind === 'pdf') {
        opened = await openDeliveryPdf(new Uint8Array(bytes), control.signal);
        image = await opened.renderPage(1, control.signal);
      } else {
        const bitmap = await createImageBitmap(file);
        try {
          const scale = Math.min(1, 2400 / Math.max(bitmap.width, bitmap.height));
          image = document.createElement('canvas'); image.width = Math.round(bitmap.width * scale); image.height = Math.round(bitmap.height * scale);
          image.getContext('2d')!.drawImage(bitmap, 0, 0, image.width, image.height);
        } finally { bitmap.close(); }
      }
      if (!alive.current || generation.current !== token) { image.width = 0; image.height = 0; return; }
      const thumbnail = image.toDataURL('image/jpeg', .95);
      pdf.current = opened; setPageCount(opened?.pageCount ?? 0); opened = undefined;
      setCanvas(image); setPreview(thumbnail); setDraft({ ...createDraft(), imageHash });
    } catch (e) { if (alive.current && generation.current === token && !control.signal.aborted) setError(e instanceof InventoryError ? e.message : 'Dit bestand kan niet worden geopend. Kies een geldige PDF, JPG- of PNG-afbeelding.'); }
    finally { await opened?.destroy(); if (alive.current && generation.current === token) setLoading(false); }
  }
  async function showPage(number: number) {
    if (!pdf.current || loading || reading || busy) return;
    const token = ++generation.current; const control = new AbortController(); controller.current = control; setLoading(true); setError('');
    try {
      const image = await pdf.current.renderPage(number, control.signal);
      if (!alive.current || generation.current !== token) { image.width = 0; image.height = 0; return; }
      const thumbnail = image.toDataURL('image/jpeg', .95);
      if (canvas) { canvas.width = 0; canvas.height = 0; }
      setCanvas(image); setPreview(thumbnail); setPageNumber(number);
    } catch { if (alive.current && generation.current === token && !control.signal.aborted) setError('Deze PDF-pagina kan niet worden getoond. Upload het bestand opnieuw.'); }
    finally { if (alive.current && generation.current === token) setLoading(false); }
  }
  function rotate() {
    if (!canvas) return;
    const rotated = document.createElement('canvas'); rotated.width = canvas.height; rotated.height = canvas.width;
    const context = rotated.getContext('2d')!; context.translate(rotated.width, 0); context.rotate(Math.PI / 2); context.drawImage(canvas, 0, 0);
    setCanvas(rotated); setPreview(rotated.toDataURL('image/jpeg', .95));
  }
  async function read() {
    if (!canvas || lock.current || loading) return;
    lock.current = true; setReading(true); setError(''); const token = ++generation.current;
    const control = new AbortController(); controller.current = control;
    try {
      const update = (message: string) => { if (alive.current && token === generation.current) setProgress(message); };
      const source = pdf.current;
      const result = source ? await analyzeDeliveryPages(source.pageCount, (number, signal) => source.renderPage(number, signal), control.signal, update) : { ...await analyzeDeliveryImage(canvas, control.signal, update), emptyPages: [] };
      if (!alive.current || token !== generation.current) return;
      setDraft(current => ({ ...current, ...result.metadata, lines: result.lines.map(line => ({ ...line, id: crypto.randomUUID(), productId: resolveProduct(line.articleNumber, data.products, aliases)?.id ?? '', destinationLocationId: '', manuallyReviewed: false, aliasConfirmed: false, excluded: false, exclusionReason: '' })), completenessConfirmed: false }));
      if (!result.lines.length) setError('Geen productregels betrouwbaar gevonden. Controleer het hele document en voeg regels handmatig toe of kies een scherpere foto.');
      else if (result.emptyPages.length) setError(`Geen productregels gevonden op PDF-pagina ${result.emptyPages.join(', ')}. Controleer deze pagina’s en voeg ontbrekende regels handmatig toe voordat je de volledigheid bevestigt.`);
    } catch (e) {
      if (alive.current && token === generation.current && !control.signal.aborted) setError(e instanceof InventoryError ? e.message : 'Uitlezen is niet gelukt. Er zijn geen gedeeltelijke resultaten overgenomen. Probeer opnieuw of voer de pakbon handmatig in.');
    } finally { if (token === generation.current) lock.current = false; if (alive.current && token === generation.current) { setReading(false); setProgress(''); } }
  }
  const received = draft.lines.filter(l => !l.excluded);
  const validations = received.map(l => validateDeliveryLine(l, data.products, data.locations, aliases, received.filter(other => other.articleNumber === l.articleNumber).length > 1, data.mappings));
  const ready = !!draft.deliveryNumber.trim() && !!draft.supplier.trim() && draft.completenessConfirmed && received.length > 0 && validations.every(v => v.canBook) && draft.lines.every(l => !l.excluded || !!l.exclusionReason.trim());
  const pendingActions = [
    ...(!draft.deliveryNumber.trim() ? ['Vul het pakbon-/leveringsnummer in.'] : []),
    ...(!draft.supplier.trim() ? ['Vul de leverancier in.'] : []),
    ...(!received.length ? ['Neem minimaal één productregel op.'] : []),
    ...draft.lines.flatMap((line, index) => line.excluded
      ? (!line.exclusionReason.trim() ? [`Regel ${index + 1}: geef een reden voor overslaan.`] : [])
      : validations[received.indexOf(line)].blockingReasons.map(reason => `Regel ${index + 1}: ${reason}`)),
    ...(!draft.completenessConfirmed ? ['Vink onderaan aan dat je de volledige pakbon hebt vergeleken.'] : []),
  ];
  async function confirm() {
    if (lock.current) return;
    lock.current = true; setBusy(true); setError('');
    const command = retryDraft.current ?? structuredClone(draft);
    if (!retryDraft.current) receiptBefore.current = structuredClone(data.stocks);
    try {
      const result = await confirmDelivery(inventory.db, command);
      if (!alive.current) return;
      setCompleted(result); void pdf.current?.destroy(); pdf.current = undefined; setPageCount(0); setCanvas(undefined); setPreview(''); retryDraft.current = undefined; receiptBefore.current = undefined;
    } catch (e) {
      if (!alive.current) return;
      if (e instanceof DuplicateDeliveryError) { setDuplicate(e.previous); setError(e.message); retryDraft.current = undefined; receiptBefore.current = undefined; }
      else if (e instanceof InventoryError) { setError(e.message); retryDraft.current = undefined; receiptBefore.current = undefined; }
      else { retryDraft.current = command; setError('Opslaan is niet gelukt of de uitkomst is nog onzeker. Probeer dezelfde ontvangst opnieuw. De app voorkomt dat deze twee keer wordt geboekt.'); }
    } finally { lock.current = false; if (alive.current) setBusy(false); }
  }
  if (completed) return <><div className="page-heading"><div><h1>Ontvangst bevestigd</h1><p>De voorraad is bijgewerkt. Het tijdelijke document is uit het geheugen verwijderd.</p></div></div><section className="card"><h2>{completed.supplier} · {completed.deliveryNumber}</h2><div className="success" role="status">{completed.lines.reduce((sum,l) => sum + l.quantityPacks, 0)} verpakkingen toegevoegd.</div>{completed.lines.map(line => <p key={line.id}>{line.quantityPacks} verpakkingen {line.productName} → {data.locations.find(l => l.id === line.locationId)?.name}</p>)}<div className="actions"><button className="primary" onClick={reset}>Volgende pakbon</button></div></section></>;
  return <>
    <div className="page-heading"><div><p className="eyebrow">Binnenkomende levering</p><h1>Pakbon verwerken</h1><p>Foto of PDF kiezen → uitlezen → controleren → ontvangst bevestigen.</p></div></div>
    <p className="notice">Tekstherkenning vindt op dit apparaat plaats. Foto’s en PDF’s worden niet naar een OCR-dienst gestuurd en worden niet opgeslagen. Voorraad en historie blijven in deze browser.</p>
    {error && <p className="error" role="alert">{error}</p>}
    {duplicate && <section className="card"><h2>Eerder verwerkt</h2><p>{duplicate.supplier} · {duplicate.deliveryNumber} · {new Date(duplicate.processedAt).toLocaleString('nl-NL')}</p>{duplicate.lines.map(l => <p key={l.id}>{l.productName}: {l.quantityPacks} verpakkingen</p>)}<p>Er is niets opnieuw geboekt.</p></section>}
    {!draft.lines.length && !reading && !loading && <section className="card"><h2>Pakbon invoeren</h2><div className="actions"><button className="primary" onClick={() => setScanner(true)}>Pakbon scannen</button><button className="secondary" onClick={() => photoInput.current?.click()}>Foto maken</button><button onClick={() => fileInput.current?.click()}>Foto of PDF uploaden</button></div><p className="small">Maximaal 20 MB. PDF: één pakbon per bestand, maximaal 10 pagina’s.</p><div className="actions"><button onClick={() => setDraft({ ...draft, lines: [emptyLine()] })}>Handmatig invoeren</button></div><input className="visually-hidden" ref={fileInput} type="file" accept="image/*,.jfif,application/pdf,.pdf" aria-label="Pakbonfoto of PDF kiezen" onChange={e => { void chooseFile(e.target.files?.[0]); e.target.value = ''; }} /><input className="visually-hidden" ref={photoInput} type="file" accept="image/*" capture="environment" aria-label="Pakbonfoto maken" onChange={e => { void chooseFile(e.target.files?.[0]); e.target.value = ''; }} /></section>}
    {loading && <section className="card" role="status"><p>Document wordt geopend…</p><button onClick={reset}>Openen annuleren</button></section>}
    {scanner && <DeliveryScanner captured={file => void chooseFile(file)} close={() => setScanner(false)} />}
    <div className="delivery-layout">
      {preview && <aside className="card delivery-photo"><h2>{pageCount ? `PDF-pagina ${pageNumber} van ${pageCount}` : 'Controleer de foto'}</h2>{pageCount > 1 && <div className="actions"><button disabled={loading || reading || busy || pageNumber <= 1} onClick={() => void showPage(pageNumber - 1)}>Vorige pagina</button><button disabled={loading || reading || busy || pageNumber >= pageCount} onClick={() => void showPage(pageNumber + 1)}>Volgende pagina</button></div>}<img src={preview} alt={`Tijdelijke pakbon${pageCount ? `, PDF-pagina ${pageNumber}` : 'foto'}`} /><details className="validation-details"><summary>Document vergroten voor regelcontrole</summary><div className="delivery-image-scroll"><img src={preview} alt="Vergrote tijdelijke pakbon; schuif om alle regels te bekijken" style={{ width: canvas?.width }} /></div></details><p>{pageCount ? 'Alle PDF-pagina’s worden uitgelezen. Controleer elke pagina, ook pagina’s waarop geen producten zijn herkend.' : 'Vergelijk alle regels met de foto. Draai deze vóór het uitlezen als de tekst niet rechtop staat.'}</p><div className="actions">{!pageCount && <button disabled={loading || reading || busy || !!retryDraft.current || !!draft.lines.length} onClick={rotate}>Foto 90° draaien</button>}{!draft.lines.length && <button className="primary" disabled={loading || reading} onClick={() => void read()}>Pakbon uitlezen</button>}</div></aside>}
      <div>
        {reading && <section className="card" role="status"><h2>Pakbon wordt uitgelezen</h2><p>{progress}</p><div className="actions"><button onClick={reset}>Uitlezen annuleren</button></div></section>}
        {!!draft.lines.length && <><DeliveryReview draft={draft} data={data} aliases={aliases} change={setDraft} disabled={busy || !!retryDraft.current || !!duplicate} />
          <section className="card delivery-final"><h2>Voorraad na bevestiging</h2><p>Alle aantallen hieronder zijn ongeopende verpakkingen.</p><div className="table-wrap"><table><thead><tr><th>Product</th><th>Bestemming</th><th>Ontvangen</th><th>Voorraad</th></tr></thead><tbody>{received.map((line,index) => {
            const product = line.newProduct ?? data.products.find(p => p.id === line.productId); const quantity = validations[index].quantityPacks;
            const before = ((busy || retryDraft.current) && receiptBefore.current ? receiptBefore.current : data.stocks).find(s => s.productId === line.productId && s.locationId === line.destinationLocationId)?.quantityPacks ?? (line.newProduct ? 0 : undefined);
            const earlier = received.slice(0,index).reduce((sum,other,i) => other.productId === line.productId && other.destinationLocationId === line.destinationLocationId ? sum + (validations[i].quantityPacks ?? 0) : sum, 0);
            return <tr key={line.id}><td>{product?.name ?? 'Nog niet gekoppeld'}<small>Pakboncode {line.articleNumber || 'ontbreekt'}</small></td><td>{data.locations.find(l => l.id === line.destinationLocationId)?.name ?? 'Nog niet vastgesteld'}</td><td>{quantity ?? 'Controle nodig'}</td><td>{before !== undefined && quantity !== undefined ? `${before + earlier} → ${before + earlier + quantity}` : 'Controle nodig'}</td></tr>;
          })}</tbody></table></div><div className="actions"><button className="primary" disabled={busy || !!duplicate || (!retryDraft.current && !ready)} onClick={() => void confirm()}>{busy ? 'Ontvangst opslaan…' : retryDraft.current ? 'Dezelfde ontvangst opnieuw proberen' : 'Ontvangst bevestigen'}</button></div>{!retryDraft.current && (ready ? <p className="success" role="status">Alle opgenomen regels zijn gecontroleerd en de pakbon is volledig. Je kunt de ontvangst bevestigen.</p> : <div className="notice"><strong>Nog te doen voor ontvangstbevestiging:</strong><ul>{pendingActions.map(action => <li key={action}>{action}</li>)}</ul></div>)}</section>
        </>}
      </div>
    </div>
    {(canvas || draft.lines.length > 0 || duplicate) && <div className="actions"><button disabled={busy || !!retryDraft.current} onClick={reset}>Annuleren / nieuwe pakbon</button></div>}
  </>;
}
