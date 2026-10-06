import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { InventoryDatabase } from '../data/db';
import { LocalInventoryRepository } from '../data/inventoryRepository';
import { seedLocations, seedProducts } from '../data/seed';
import { parseDeliveryLine, parseMetadata, reconcileReadings, spatialRows } from '../delivery/deliveryParser';
import { nameConsistent, positiveInteger, resolveProduct, validateDeliveryLine } from '../delivery/deliveryValidation';
import { determineDestination } from '../delivery/destinationService';
import { confirmDelivery, createDraft, DuplicateDeliveryError } from '../delivery/deliveryService';
import { emptyLine } from '../delivery/DeliveryReview';
import type { DeliveryLine, DeliveryDraft } from '../delivery/types';

const parsed = parseDeliveryLine('2 COL 760364 TENA Discreet Mini 6x30p')!;
const line = (patch: Partial<DeliveryLine> = {}): DeliveryLine => ({ ...emptyLine(), ...parsed, secondReading: { ...parsed },
  productId: 'tena-760364', destinationLocationId: 'H1', manuallyReviewed: true, ...patch });
const products = seedProducts.map(p => ({ ...p, assortmentVerified: true }));
describe('Pakbon uitlezen en betrouwbaarheid', () => {
  it('artikelnummer, aantal en doosinhoud blijven exact behouden', () => {
    expect(parseDeliveryLine('2| COL 79157202 TENA Pants Normal M 4x18p, NEU CAR')).toMatchObject({ articleNumber: '79157202', quantityText: '2', unit: 'COL', packsPerBoxText: '4', piecesPerPackText: '18' });
    expect(resolveProduct('79157202', products, [])).toBeUndefined();
  });
  it('onbekend artikel wordt niet door productnaam automatisch gekoppeld', () => { expect(resolveProduct('999999', products, [])).toBeUndefined(); expect(validateDeliveryLine(line({ productId: '' }), products, seedLocations, []).confidence).toBe('Niet herkend'); });
  it('bevestigde alias wordt exact gekoppeld', () => { expect(resolveProduct('76153109', products, [{ articleNumber: '76153109', productId: 'tena-761531', verified: true, reason: 'Medewerker' }])?.id).toBe('tena-761531'); });
  it('onbevestigde alias wordt niet gebruikt', () => { expect(resolveProduct('76153109', products, [{ articleNumber: '76153109', productId: 'tena-761531', verified: false, reason: '' }])).toBeUndefined(); });
  it('OCR spelfout verlaagt zekerheid', () => { expect(validateDeliveryLine(line({ detectedProductName: 'TENA Discreet Mmi' }), products, seedLocations, []).confidence).toBe('Controle nodig'); });
  it.each(['TENA Men Level 1', 'TENA Discreet Mini Plus', 'TENA Discreet Mini Extra'])('tegenstrijdige naam %s verlaagt zekerheid', name => { expect(nameConsistent(name, products[0])).toBe(false); });
  it.each(['0','-1','1.5','1,5','','12?','9007199254740992'])('ongeldig aantal %s kan nooit worden geboekt', quantityText => { expect(positiveInteger(quantityText)).toBeUndefined(); expect(validateDeliveryLine(line({ quantityText }), products, seedLocations, []).canBook).toBe(false); });
  it.each(['1','2','37'])('geldig aantal %s wordt omgerekend', quantityText => { expect(validateDeliveryLine(line({ quantityText }), products, seedLocations, []).quantityPacks).toBe(Number(quantityText) * 6); });
  it('losse verpakkingen worden niet als dozen vermenigvuldigd', () => { expect(validateDeliveryLine(line({ quantityText: '1', unit: 'verpakking' }), products, seedLocations, []).quantityPacks).toBe(1); });
  it('onbekende eenheid of afwijkende verpakking blokkeert', () => { expect(validateDeliveryLine(line({ unit: 'onbekend' }), products, seedLocations, []).canBook).toBe(false); expect(validateDeliveryLine(line({ piecesPerPackText: '50' }), products, seedLocations, []).canBook).toBe(false); });
  it('geen verborgen aanvulling van ontbrekende aantallen', () => { expect(parseDeliveryLine('760364 TENA Discreet Mini 6x30p')?.quantityText).toBe(''); });
  it('beide uitlezingen en alle databasecontroles vereist voor hoge zekerheid', () => {
    const high = validateDeliveryLine(line(), products, seedLocations, []); expect(high.confidence).toBe('Hoge zekerheid'); expect(Object.values(high.checks).every(Boolean)).toBe(true);
    expect(validateDeliveryLine(line({ secondReading: { ...parsed, quantityText: '3' } }), products, seedLocations, []).confidence).toBe('Controle nodig');
    expect(validateDeliveryLine(line({ secondReading: undefined }), products, seedLocations, []).confidence).toBe('Controle nodig');
    expect(validateDeliveryLine(line(), seedProducts, seedLocations, []).confidence).toBe('Controle nodig');
  });
  it('bekend artikel met verkeerd gekozen product kan niet worden geboekt', () => { expect(validateDeliveryLine(line({ productId: 'tena-750651', aliasConfirmed: true, packsPerBoxText: '6', piecesPerPackText: '24' }), products, seedLocations, []).canBook).toBe(false); });
  it('handmatig gecontroleerde alias is boekbaar terwijl automatische zekerheid beperkt blijft', () => {
    const validation = validateDeliveryLine(line({ articleNumber: '76036499', aliasConfirmed: true, secondReading: undefined }), seedProducts, seedLocations, []);
    expect(validation.confidence).toBe('Controle nodig'); expect(validation.canBook).toBe(true); expect(validation.blockingReasons).toEqual([]);
  });
  it('vinkjes kunnen verkeerde doosinhoud en ontbrekende bestemming niet oplossen', () => {
    const parsed = parseDeliveryLine('1 COL 79167102 TENA Pants Normal L 4x18p')!;
    const validation = validateDeliveryLine(line({ ...parsed, productId: 'tena-750776', aliasConfirmed: true, manuallyReviewed: true, destinationLocationId: '' }), seedProducts, seedLocations, []);
    expect(validation.canBook).toBe(false);
    expect(validation.blockingReasons.join(' ')).toContain('TENA Men Level 2 (6 × 20)');
    expect(validation.blockingReasons.join(' ')).toContain('Kies bij Bestemming');
    expect(validation.blockingReasons.join(' ')).not.toContain('Vink de regelcontrole');
  });
  it('toont een bestaand conflicterend artikel ook na handmatige bevestiging', () => {
    const validation = validateDeliveryLine(line({ productId: 'tena-750651', aliasConfirmed: true, piecesPerPackText: '24' }), seedProducts, seedLocations, []);
    expect(validation.blockingReasons.join(' ')).toContain('al gekoppeld aan TENA Discreet Mini');
    expect(validation.canBook).toBe(false);
  });
  it('bekende barcode van ander product blokkeert', () => { expect(validateDeliveryLine(line({ gtin: 'known' }), products, seedLocations, [], false, [{ id: 'test', rawValue: 'known', productId: 'tena-750651', verified: true, isDemo: false, symbology: 'CODE_128', packagingLevel: 'verpakking', quantityInStockUnits: 1 }]).canBook).toBe(false); });
  it('beide sets regels worden behouden bij conflict en ontbrekende regels', () => { const merged = reconcileReadings([parsed], [{ ...parsed, articleNumber: '999999' }]); expect(merged).toHaveLength(2); expect(merged.every(l => !l.secondReading)).toBe(true); });
  it('herhaalde artikelregels blijven zichtbaar en vragen controle', () => { expect(reconcileReadings([parsed,parsed],[parsed,parsed])).toHaveLength(2); expect(validateDeliveryLine(line(), products, seedLocations, [], true).confidence).toBe('Controle nodig'); });
  it('kolommen worden op fysieke hoogte samengevoegd', () => {
    const bbox = (x: number,y: number) => ({ x0:x, x1:x+20,y0:y,y1:y+12 });
    expect(spatialRows([{text:'760364',bbox:bbox(200,50)},{text:'2',bbox:bbox(20,50)},{text:'COL',bbox:bbox(80,50)},{text:'TENA',bbox:bbox(300,50)},{text:'1',bbox:bbox(20,80)}])).toEqual(['2 COL 760364 TENA','1']);
  });
  it('alleen expliciet gelabelde referentie wordt pakbonnummer', () => { expect(parseMetadata(['K000014266','Afzender Essity Netherlands B.V.','Afleverdatum 22-9-2026','Aantal colli 16'])).toEqual({ deliveryNumber: '', supplier: 'Essity Netherlands B.V.', deliveryDate: '2026-09-22', declaredColli: 16 }); });
  it('opdrachtdatum wordt nooit voor leverdatum aangezien',()=>{expect(parseMetadata(['Opdrachtdatum 18-9-2026','Afleverdatum 22-9-2026']).deliveryDate).toBe('2026-09-22');expect(parseMetadata(['Opdrachtdatum 18-9-2026']).deliveryDate).toBe('');});
});
describe('Bestemming door medewerker', () => {
  it('geen productlocatie wordt automatisch gekozen, ook niet met één of meerdere regels', () => {
    const rule = { id:'r',productId:'tena-760364',locationId:'H1',verified:true,reason:'Test' };
    expect(determineDestination('tena-760364', {destinationLocationId:''}, seedLocations, [rule]).verified).toBe(false);
    expect(determineDestination('tena-760364', {destinationLocationId:''}, seedLocations, [rule,{...rule,id:'r2',locationId:'H2'}]).verified).toBe(false);
  });
  it('alleen geldige handmatig gekozen bestemming is bevestigd', () => { expect(determineDestination('tena-760364', {destinationLocationId:'H2'}, seedLocations).verified).toBe(true); expect(determineDestination('tena-760364', {destinationLocationId:'H9'}, seedLocations).verified).toBe(false); });
});
describe('Volledige ontvangsttransactie', () => {
  let repo: LocalInventoryRepository;
  let draft: DeliveryDraft;
  beforeEach(async () => { repo = new LocalInventoryRepository(new InventoryDatabase(`delivery-${crypto.randomUUID()}`)); await repo.initialize(); draft = { ...createDraft(), deliveryNumber: 'TEST-123', supplier: 'Fictieve leverancier', deliveryDate: '2026-09-22', completenessConfirmed: true, lines: [line()] }; });
  afterEach(async () => { await repo.db.delete(); });
  it('uitlezen en annuleren veranderen geen voorraad', async () => { const before = await repo.snapshot(); parseDeliveryLine(parsed.rawText); createDraft(); expect(await repo.snapshot()).toEqual(before); expect(await repo.db.deliveries.count()).toBe(0); });
  it.each([1,2,3])('ontvangst en twintig dubbele bevestigingen run %i boeken eenmaal', async () => {
    const notes = await Promise.all(Array.from({length:20}, () => confirmDelivery(repo.db,draft)));
    expect(new Set(notes.map(n => n.id)).size).toBe(1); expect(await repo.db.deliveries.count()).toBe(1);
    expect((await repo.db.stocks.get(['tena-760364','H1']))?.quantityPacks).toBe(22); expect((await repo.listMovements()).filter(m => m.inputSource === 'delivery')).toHaveLength(1);
  });
  it('dezelfde leverancier en pakbonnummer met nieuwe foto wordt geblokkeerd', async () => { await confirmDelivery(repo.db,draft); await expect(confirmDelivery(repo.db,{...draft,id:crypto.randomUUID(),operationId:crypto.randomUUID(),lines:[line({quantityText:'1'})]})).rejects.toBeInstanceOf(DuplicateDeliveryError); });
  it('dezelfde inhoud met gewijzigd nummer wordt via fingerprint geblokkeerd', async () => { await confirmDelivery(repo.db,draft); await expect(confirmDelivery(repo.db,{...draft,id:crypto.randomUUID(),operationId:crypto.randomUUID(),deliveryNumber:'ander'})).rejects.toBeInstanceOf(DuplicateDeliveryError); });
  it('dezelfde foto met gewijzigde inhoud wordt geblokkeerd', async () => { draft.imageHash='hash'; await confirmDelivery(repo.db,draft); await expect(confirmDelivery(repo.db,{...draft,id:crypto.randomUUID(),operationId:crypto.randomUUID(),deliveryNumber:'ander',lines:[line({quantityText:'1'})]})).rejects.toBeInstanceOf(DuplicateDeliveryError); });
  it('heropenen na commit hergebruikt dezelfde ontvangst', async () => { const note = await confirmDelivery(repo.db,draft); const name = repo.db.name; repo.db.close(); repo = new LocalInventoryRepository(new InventoryDatabase(name)); expect((await confirmDelivery(repo.db,draft)).id).toBe(note.id); expect((await repo.listMovements()).filter(m => m.inputSource === 'delivery')).toHaveLength(1); });
  it('schema-upgrade van versie 1 behoudt bestaande voorraad en mutaties',async()=>{
    const name=repo.db.name; await repo.db.delete();
    const old=new Dexie(name);old.version(1).stores({products:'id, &tenaArticleNumber',locations:'id',mappings:'id, &rawValue, productId',stocks:'[productId+locationId], productId, locationId',movements:'id, &operationId, createdAt, productId, locationId',meta:'key'});
    await old.table('products').bulkPut(seedProducts);await old.table('locations').bulkPut(seedLocations);
    await old.table('stocks').put({productId:'tena-760364',locationId:'H1',quantityPacks:17});
    await old.table('movements').put({id:'old',operationId:'old',productId:'tena-760364',locationId:'H1',quantityPacks:7,type:'IN',stockBefore:10,stockAfter:17,createdAt:'2026-09-30T12:00:00Z',actor:'Demogebruiker',inputSource:'productSearch',isDemoBarcode:false});
    await old.table('meta').put({key:'seedVersion',value:1});old.close();
    repo=new LocalInventoryRepository(new InventoryDatabase(name));await repo.initialize();
    expect((await repo.db.stocks.get(['tena-760364','H1']))?.quantityPacks).toBe(17);expect((await repo.db.movements.get('old'))?.stockAfter).toBe(17);expect(await repo.db.products.count()).toBe(8);expect(await repo.db.deliveries.count()).toBe(0);
  });
  it('gewijzigde opdracht met zelfde operationId wordt geweigerd', async () => { await confirmDelivery(repo.db,draft); await expect(confirmDelivery(repo.db,{...draft,lines:[line({quantityText:'1'})]})).rejects.toThrow('andere gegevens'); });
  it('opslagfout bij tweede mutatie draait hele ontvangst terug en retry slaagt', async () => {
    draft.lines.push(line({id:crypto.randomUUID(),destinationLocationId:'H2'})); const before = await repo.snapshot();
    let calls=0; const fail = () => { if (++calls === 2) throw new Error('Geforceerd'); }; repo.db.movements.hook('creating',fail);
    await expect(confirmDelivery(repo.db,draft)).rejects.toThrow('Geforceerd'); expect(await repo.snapshot()).toEqual(before); expect(await repo.db.deliveries.count()).toBe(0);
    repo.db.movements.hook('creating').unsubscribe(fail); await confirmDelivery(repo.db,draft); expect((await repo.listMovements()).filter(m => m.inputSource === 'delivery')).toHaveLength(2);
  });
  it.each(['manuallyReviewed','completenessConfirmed'])('ontbrekende controle %s blokkeert voorraad', async field => {
    if(field==='manuallyReviewed') draft.lines[0].manuallyReviewed=false; else draft.completenessConfirmed=false;
    const before = await repo.snapshot(); await expect(confirmDelivery(repo.db,draft)).rejects.toThrow(); expect(await repo.snapshot()).toEqual(before);
  });
  it('ontbrekende of ongeldige bestemming blokkeert alles', async () => { draft.lines[0].destinationLocationId='H9'; await expect(confirmDelivery(repo.db,draft)).rejects.toThrow(); expect(await repo.db.deliveries.count()).toBe(0); });
  it('herhaalde regels tellen apart op na bewuste controle', async () => { draft.lines.push(line({id:crypto.randomUUID(),quantityText:'1'})); const note = await confirmDelivery(repo.db,draft); expect(note.lines).toHaveLength(2); expect((await repo.db.stocks.get(['tena-760364','H1']))?.quantityPacks).toBe(28); });
  it('nieuwe producten en nulposities worden alleen bij bevestiging aangemaakt', async () => {
    const product = {...products[0],id:'received-999999',tenaArticleNumber:'999999',name:'Fictief product'};
    draft.lines=[line({articleNumber:'999999',detectedProductName:'Fictief product',productId:product.id,newProduct:product})];
    expect(await repo.db.products.get(product.id)).toBeUndefined(); await confirmDelivery(repo.db,draft); expect(await repo.db.products.get(product.id)).toEqual(product); expect((await repo.db.stocks.get([product.id,'H1']))?.quantityPacks).toBe(12);
  });
  it('alias wordt alleen na expliciete koppeling en bevestiging opgeslagen', async () => {
    draft.lines=[line({articleNumber:'76036401',aliasConfirmed:false})]; await expect(confirmDelivery(repo.db,draft)).rejects.toThrow(); expect(await repo.db.articleAliases.count()).toBe(0);
    draft.lines[0].aliasConfirmed=true; await confirmDelivery(repo.db,draft); expect((await repo.db.articleAliases.get('76036401'))?.productId).toBe('tena-760364');
  });
  it('overslaan vraagt reden en bewaart auditspoor', async () => { draft.lines.push(line({id:crypto.randomUUID(),excluded:true,exclusionReason:''})); await expect(confirmDelivery(repo.db,draft)).rejects.toThrow('reden'); draft.lines[1].exclusionReason='Emballage'; const note=await confirmDelivery(repo.db,draft); expect(note.excludedLines).toHaveLength(1); expect(note.lines).toHaveLength(1); });
  it('volledige reset wist ook ontvangsten en aliassen', async () => { await confirmDelivery(repo.db,draft); await repo.resetDemo(); expect(await repo.db.deliveries.count()).toBe(0); expect(await repo.db.articleAliases.count()).toBe(0); });
});
