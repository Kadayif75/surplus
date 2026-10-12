import { useEffect, useRef, useState } from 'react';
import { liveQuery } from 'dexie';
import { inventory } from '../data/inventoryRepository';
import type { InventorySnapshot } from '../domain/types';
import type { OrderPlan } from './types';
import { MERGE_LOCATIONS, readMergeWorkbook, mergeResidentWorkbooks, type MergeWorkbook, type MergedWorkbook } from './workbookMerge';
import { mergedOrderPlan, saveMergedOrder } from './mergedOrderService';

export function OrdersPage({ data }: { data: InventorySnapshot }) {
  const [sources, setSources] = useState<Record<string, MergeWorkbook>>({}); const [fileNames, setFileNames] = useState<Record<string, string>>({});
  const [result, setResult] = useState<MergedWorkbook>(); const [error, setError] = useState(''); const [working, setWorking] = useState(false); const [loading, setLoading] = useState<string[]>([]);
  const [downloading, setDownloading] = useState(false); const [downloaded, setDownloaded] = useState(false); const [orders, setOrders] = useState<OrderPlan[]>([]);
  const alive = useRef(true); const tokens = useRef<Record<string, number>>({}); const generation = useRef(0); const lock = useRef(false); const savedPlan = useRef<OrderPlan | undefined>(undefined);
  useEffect(() => { alive.current = true; const subscription = liveQuery(() => inventory.db.orders.orderBy('createdAt').reverse().toArray()).subscribe({ next: setOrders, error: () => {} }); return () => { alive.current = false; generation.current++; subscription.unsubscribe(); }; }, []);
  useEffect(() => {
    if (MERGE_LOCATIONS.some(id => !sources[id])) { setWorking(false); return; }
    const token = ++generation.current; setWorking(true); setError('');
    void mergeResidentWorkbooks(sources).then(merged => { if (alive.current && generation.current === token) setResult(merged); }).catch(e => { if (alive.current && generation.current === token) setError(e instanceof Error ? e.message : 'Samenvoegen is niet gelukt.'); }).finally(() => { if (alive.current && generation.current === token) setWorking(false); });
    return () => { if (generation.current === token) generation.current++; };
  }, [sources]);
  async function choose(id: string, file?: File) {
    if (!file) return;
    const token = (tokens.current[id] ?? 0) + 1; tokens.current[id] = token; generation.current++; savedPlan.current = undefined;
    setResult(undefined); setError(''); setDownloaded(false); setFileNames(current => ({ ...current, [id]: file.name }));
    setSources(current => { const next = { ...current }; delete next[id]; return next; }); setLoading(current => [...current.filter(key => key !== id), id]);
    try {
      if (!/\.(xlsx|xlsm)$/i.test(file.name)) throw new Error('Kies een XLSM- of XLSX-bewonersoverzicht.');
      if (file.size > 20 * 1024 * 1024) throw new Error('Kies een Excel-bestand van maximaal 20 MB.');
      const source = await readMergeWorkbook(await file.arrayBuffer());
      if (alive.current && tokens.current[id] === token) setSources(current => ({ ...current, [id]: source }));
    } catch (e) { if (alive.current && tokens.current[id] === token) setError(e instanceof Error ? e.message : 'Dit bestand kan niet worden gelezen.'); }
    finally { if (alive.current && tokens.current[id] === token) setLoading(current => current.filter(key => key !== id)); }
  }
  async function download() {
    if (!result || lock.current) return; lock.current = true; setDownloading(true); setError('');
    try {
      const plan = savedPlan.current ?? mergedOrderPlan(result, data); savedPlan.current = plan;
      try { await saveMergedOrder(inventory.db, plan); } catch { if (alive.current) setError('Het Excel-document kan worden gedownload, maar de verdeellijst voor latere ontvangst kon niet worden bewaard.'); }
      if (!alive.current) return;
      const type = result.extension === 'xlsm' ? 'application/vnd.ms-excel.sheet.macroEnabled.12' : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
      const url = URL.createObjectURL(new Blob([result.bytes], { type })); const anchor = document.createElement('a'); anchor.href = url; anchor.download = `Bewonersoverzicht-samengevoegd.${result.extension}`; document.body.append(anchor); anchor.click(); anchor.remove(); setTimeout(() => URL.revokeObjectURL(url), 30000); setDownloaded(true);
    } catch { if (alive.current) setError('Downloaden is niet gelukt. Probeer het opnieuw.'); }
    finally { lock.current = false; if (alive.current) setDownloading(false); }
  }
  const names = Object.fromEntries(data.locations.map(location => [location.id, location.name]));
  return <><div className="page-heading"><div><h1>Bewonersoverzichten samenvoegen</h1><p>Drie Excel-bestanden inlezen en één document downloaden in jullie bestaande opmaak.</p></div></div>
    <section className="card"><div className="form-grid">{MERGE_LOCATIONS.map(id => <label key={id}>{names[id]}: Excel kiezen<input type="file" accept=".xlsm,.xlsx" disabled={downloading} onChange={e => { void choose(id, e.target.files?.[0]); e.target.value = ''; }} /><small>{loading.includes(id) ? 'Bestand lezen…' : sources[id] ? `${fileNames[id]} · ${sources[id].residentRows.length} bewoners` : 'Nog geen bestand gekozen'}</small></label>)}</div>
      {working && <p role="status">De drie documenten worden samengevoegd…</p>}
      {error && <p className="error" role="alert">{error}</p>}
      {result && <p>{result.residentCount} bewoners samengevoegd. Tabbladen, opmaak en bestandstype blijven behouden.</p>}
      <div className="actions"><button className="primary" disabled={!result || working || !!loading.length || downloading} onClick={() => void download()}>{downloading ? 'Download voorbereiden…' : 'Samengevoegd Excel downloaden'}</button></div>
      {downloaded && <p className="success" role="status">Het samengevoegde document is klaar. Gebruik het via jullie normale bestelwijze.</p>}
    </section>
    {result && <section className="card"><h2>Gezamenlijke bestelling</h2>{!result.items.length ? <p>Er staan geen te bestellen producten in deze bestanden.</p> : <div className="table-wrap"><table><thead><tr><th>Product</th>{MERGE_LOCATIONS.map(id => <th key={id}>{names[id]}</th>)}<th>Totaal {result.orderUnit === 'doos' ? 'dozen' : 'verpakkingen'}</th></tr></thead><tbody>{result.items.map(item => <tr key={item.key}><td>{item.name}<small>{item.articleNumber}</small></td>{MERGE_LOCATIONS.map(id => <td key={id}>{item.quantities[id]}</td>)}<td><strong>{item.totalQuantity}</strong></td></tr>)}</tbody></table></div>}<p className="small">Ingevulde aantallen in de kolom Bestelling worden overgenomen; bij een lege bestelling wordt het bestaande Excel-advies gebruikt.</p></section>}
    {!!orders.length && <details className="card validation-details"><summary>Eerdere bestellingen en samenvoegingen</summary>{orders.map(order => <p key={order.id}>{order.reference} · {new Date(order.createdAt).toLocaleDateString('nl-NL')} · {order.sourceKind === 'merged-workbooks' && order.status === 'Concept' ? 'Samengevoegd' : order.status}</p>)}<p className="small">Bij binnenkomst kun je de bijbehorende samenvoeging kiezen bij Pakbon verwerken. De verdeling per locatie is bewaard.</p></details>}
  </>;
}
