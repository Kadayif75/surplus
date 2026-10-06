import type { InventorySnapshot } from '../domain/types';
import type { ArticleAlias, DeliveryDraft, DeliveryLine } from './types';
import { nameConsistent, positiveInteger, resolveProduct, validateDeliveryLine } from './deliveryValidation';

export function emptyLine(): DeliveryLine {
  return { id: crypto.randomUUID(), articleNumber: '', detectedProductName: '', quantityText: '', unit: 'onbekend', packsPerBoxText: '', piecesPerPackText: '', rawText: 'Handmatig toegevoegd', productId: '', destinationLocationId: '', manuallyReviewed: false, aliasConfirmed: false, excluded: false, exclusionReason: '' };
}
export function DeliveryReview({ draft, data, aliases, change, disabled }: { draft: DeliveryDraft; data: InventorySnapshot; aliases: ArticleAlias[]; change: (draft: DeliveryDraft) => void; disabled: boolean }) {
  function update(index: number, patch: Partial<DeliveryLine>, keepReviewed = false) {
    change({ ...draft, completenessConfirmed: false, lines: draft.lines.map((l,i) => {
      if (i !== index) return l;
      const updated = { ...l, manuallyReviewed: keepReviewed ? l.manuallyReviewed : false, ...patch };
      if (updated.newProduct) updated.newProduct = { ...updated.newProduct, name: updated.detectedProductName.trim(), packsPerBox: positiveInteger(updated.packsPerBoxText) ?? 0, piecesPerPack: positiveInteger(updated.piecesPerPackText) ?? 0 };
      return updated;
    }) });
  }
  const activeLines = draft.lines.filter(l => !l.excluded);
  const colli = activeLines.filter(l => l.unit === 'COL').reduce((sum,l) => sum + (positiveInteger(l.quantityText) ?? 0), 0);
  const allColliKnown = activeLines.every(l => l.unit === 'COL' && positiveInteger(l.quantityText) !== undefined);
  return <fieldset className="delivery-fieldset" disabled={disabled}>
    <section className="card"><h2>Levering controleren</h2><p>Vul ontbrekende gegevens aan. Controleer de hele bon, ook als een regel goed lijkt uitgelezen.</p><div className="form-grid delivery-fields">
      <label>Pakbon-/leveringsnummer<input value={draft.deliveryNumber} onChange={e => change({ ...draft, deliveryNumber: e.target.value, completenessConfirmed: false })} maxLength={100} placeholder="Neem een uniek nummer van de bon over" /></label>
      <label>Leverancier<input value={draft.supplier} onChange={e => change({ ...draft, supplier: e.target.value, completenessConfirmed: false })} maxLength={160} /></label>
      <label>Leverdatum indien vermeld<input type="date" value={draft.deliveryDate} onChange={e => change({ ...draft, deliveryDate: e.target.value, completenessConfirmed: false })} /></label>
    </div>{draft.declaredColli !== undefined && <p className={allColliKnown && colli !== draft.declaredColli ? 'error' : 'notice'}>Totaal op bon: {draft.declaredColli} COL · Opgenomen: {colli} COL. Controleer ontbrekende regels en overige emballage.</p>}
    </section>
    {draft.lines.map((line,index) => {
      const product = line.newProduct ?? data.products.find(p => p.id === line.productId);
      const validation = validateDeliveryLine(line, data.products, data.locations, aliases, activeLines.filter(l => l.articleNumber === line.articleNumber).length > 1, data.mappings);
      const resolved = resolveProduct(line.articleNumber, data.products, aliases);
      const needsAlias = !!product && product.tenaArticleNumber !== line.articleNumber && resolved?.id !== product.id;
      const suggestions = !product ? data.products.filter(p => nameConsistent(line.detectedProductName, p)) : [];
      return <section className={`card delivery-line ${line.excluded ? 'excluded' : ''}`} key={line.id}>
        <div className="line-title"><h2>Regel {index + 1}: {product?.name ?? 'Product nog niet gekoppeld'}</h2><span className={`confidence ${validation.confidence === 'Hoge zekerheid' ? 'high' : ''}`}>{line.excluded ? 'Overgeslagen' : validation.confidence}</span></div>
        <p className="delivery-original"><strong>Gelezen:</strong> {line.rawText || 'Niet met voldoende zekerheid herkend'}</p>
        {!line.excluded && <>
          {suggestions.length > 0 && <p className="notice">Mogelijk: {suggestions.map(p => `${p.name} (${p.tenaArticleNumber})`).join(', ')}. Kies en bevestig zelf de koppeling.</p>}
          <div className="form-grid delivery-fields">
            <label>Artikelnummer op pakbon<input value={line.articleNumber} inputMode="numeric" onChange={e => {
              const articleNumber = e.target.value; const found = resolveProduct(articleNumber, data.products, aliases);
              update(index, { articleNumber, productId: found?.id ?? '', aliasConfirmed: false, newProduct: undefined });
            }} /></label>
            <label>Gelezen productnaam<input value={line.detectedProductName} onChange={e => update(index, { detectedProductName: e.target.value })} /></label>
            <label>Product in voorraad<select value={line.newProduct ? '__new' : line.productId} onChange={e => update(index, { productId: e.target.value, newProduct: undefined, aliasConfirmed: false })}><option value="">Kies het juiste product</option>{line.newProduct && <option value="__new">Nieuw: {line.newProduct.name}</option>}{data.products.map(p => <option value={p.id} key={p.id}>{p.name} · {p.tenaArticleNumber}</option>)}</select></label>
            <label>Aantal op de bon<input value={line.quantityText} inputMode="numeric" onChange={e => update(index, { quantityText: e.target.value })} placeholder="Geen aantal herkend" /></label>
            <label>Eenheid<select value={line.unit} onChange={e => update(index, { unit: e.target.value as DeliveryLine['unit'] })}><option value="onbekend">Niet herkend — kies</option><option value="COL">COL / doos</option><option value="verpakking">Verpakking</option></select></label>
            <label>Verpakkingen per doos<input value={line.packsPerBoxText} inputMode="numeric" onChange={e => update(index, { packsPerBoxText: e.target.value })} placeholder="Controleer op bon of doos" /></label>
            <label>Stuks per verpakking<input value={line.piecesPerPackText} inputMode="numeric" onChange={e => update(index, { piecesPerPackText: e.target.value })} /></label>
            <label>Bestemming<select value={line.destinationLocationId} onChange={e => update(index, { destinationLocationId: e.target.value })}><option value="">Bestemming nog niet vastgesteld</option>{data.locations.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}</select></label>
          </div>
          {product && <p className="notice">Assortiment: {product.packsPerBox} verpakkingen per doos, {product.piecesPerPack} stuks per verpakking. {validation.quantityPacks !== undefined ? `Ontvangst: ${validation.quantityPacks} verpakkingen.` : 'Controleer aantal en eenheid.'}</p>}
          {needsAlias && <label className="checkbox delivery-check"><input type="checkbox" checked={line.aliasConfirmed} onChange={e => update(index, { aliasConfirmed: e.target.checked })} />Ik bevestig dat pakboncode {line.articleNumber || '(ontbreekt)'} hetzelfde product is als {product?.name} ({product?.tenaArticleNumber}).</label>}
          {!product && <div className="actions"><button onClick={() => {
            const packs = positiveInteger(line.packsPerBoxText); const pieces = positiveInteger(line.piecesPerPackText);
            if (!/^\d{5,10}$/.test(line.articleNumber) || !line.detectedProductName.trim() || !packs || !pieces) return;
            const newProduct = { id: `received-${line.articleNumber}`, tenaArticleNumber: line.articleNumber, name: line.detectedProductName.trim(), variant: '', stockUnit: 'verpakking' as const,
              packsPerBox: packs, piecesPerPack: pieces, sourceReference: 'Handmatig gecontroleerde ontvangst', assortmentVerified: true };
            update(index, { productId: newProduct.id, newProduct, aliasConfirmed: true });
          }} disabled={!/^\d{5,10}$/.test(line.articleNumber) || !line.detectedProductName.trim() || !positiveInteger(line.packsPerBoxText) || !positiveInteger(line.piecesPerPackText)}>Nieuw product voorbereiden</button></div>}
          {line.newProduct && <p className="notice">Nieuw product wordt bij ontvangstbevestiging toegevoegd. Controleer naam, artikelnummer en verpakking op de bon en op het product.</p>}
          <details className="validation-details"><summary>Waarom deze zekerheid?</summary><ul>{Object.entries(validation.checks).map(([label,ok]) => <li key={label}>{ok ? 'Ja' : 'Controle nodig'}: {label}</li>)}</ul>{line.secondReading && <p>Tweede uitlezing: {line.secondReading.rawText}</p>}</details>
          <label className="checkbox delivery-check"><input type="checkbox" checked={line.manuallyReviewed} onChange={e => update(index, { manuallyReviewed: e.target.checked }, true)} />Ik heb artikel, product, aantal, verpakking en bestemming van deze regel gecontroleerd.</label>
        </>}
        <label className="checkbox delivery-check"><input type="checkbox" checked={line.excluded} onChange={e => update(index, { excluded: e.target.checked })} />Deze regel overslaan (bijvoorbeeld emballage)</label>
        {line.excluded && <label>Reden voor overslaan<input value={line.exclusionReason} onChange={e => update(index, { exclusionReason: e.target.value })} required /></label>}
      </section>;
    })}
    <button className="secondary" onClick={() => change({ ...draft, completenessConfirmed: false, lines: [...draft.lines, emptyLine()] })}>Ontbrekende regel toevoegen</button>
    <section className="card delivery-complete"><label className="checkbox"><input type="checkbox" checked={draft.completenessConfirmed} onChange={e => change({ ...draft, completenessConfirmed: e.target.checked })} />Ik heb de volledige pakbon vergeleken: alle productregels en aantallen zijn opgenomen of bewust met reden overgeslagen.</label></section>
  </fieldset>;
}
