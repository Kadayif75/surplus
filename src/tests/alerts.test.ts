import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { InventoryDatabase } from '../data/db';
import { LocalInventoryRepository } from '../data/inventoryRepository';
import { saveAlertSettings } from '../alerts/alertService';
import { defaultAlertSettings, productLimitKey } from '../alerts/types';
import { sendPendingAlerts } from '../alerts/alertSender';
import { confirmDelivery, createDraft } from '../delivery/deliveryService';
import { emptyLine } from '../delivery/DeliveryReview';

let repo: LocalInventoryRepository;
const productId = 'tena-760364';
const rules = (minimum = 5) => ({ ...defaultAlertSettings(), productMinimums: { [productLimitKey(productId, 'H1')]: minimum } });
const change = (quantityPacks: number, type: 'IN' | 'OUT' = 'OUT') => repo.bookMovement({ operationId: crypto.randomUUID(), productId, locationId: 'H1', type, quantityPacks, inputSource: 'productSearch' });
beforeEach(async () => { repo = new LocalInventoryRepository(new InventoryDatabase(`alerts-${crypto.randomUUID()}`)); await repo.initialize(); });
afterEach(async () => { await repo.db.delete(); vi.restoreAllMocks(); });
describe('Minimumvoorraad en een melding per lage-voorraadperiode', () => {
  it('is standaard uit en laat bestaande voorraad ongemoeid', async () => { await change(6); expect(await repo.db.stockAlerts.count()).toBe(0); });
  it('signaleert bij exact de grens, niet opnieuw bij verder dalen; aanvullen maakt een nieuwe melding mogelijk', async () => {
    await saveAlertSettings(repo.db, rules()); await change(4); expect(await repo.db.stockAlerts.count()).toBe(0);
    await change(1); expect(await repo.db.stockAlerts.count()).toBe(1); await change(2); expect(await repo.db.stockAlerts.count()).toBe(1);
    await change(3, 'IN'); expect((await repo.db.stockAlerts.toArray())[0].status).toBe('cancelled');
    await change(1); expect(await repo.db.stockAlerts.count()).toBe(2); expect((await repo.db.stockAlerts.where('status').equals('pending').first())?.quantity).toBe(5);
  });
  it('gebruikt een productafwijking boven de ruimtestandaard en behandelt nul als een echte grens', async () => {
    await saveAlertSettings(repo.db, { ...rules(0), roomMinimums: { H1: 9 } });
    expect((await repo.db.stockAlerts.toArray()).some(a => a.productId === productId)).toBe(false);
    await change(9); expect((await repo.db.stockAlerts.toArray()).some(a => a.productId === productId)).toBe(false);
    await change(1); expect((await repo.db.stockAlerts.toArray()).find(a => a.productId === productId)?.minimum).toBe(0);
    expect((await repo.db.stockAlerts.toArray()).every(a => a.locationId === 'H1')).toBe(true);
  });
  it('signaleert bestaande tekorten bij instellen en cancelt ongestuurde meldingen bij verwijderen van de grens', async () => {
    await saveAlertSettings(repo.db, rules(12)); await saveAlertSettings(repo.db, rules(15)); expect(await repo.db.stockAlerts.count()).toBe(1);
    await saveAlertSettings(repo.db, defaultAlertSettings()); expect((await repo.db.stockAlerts.toArray())[0].status).toBe('cancelled');
  });
  it.each([-1, 1.5, Number.NaN, 1000001])('weigert ongeldig minimum %s zonder bestaande instellingen te veranderen', async minimum => {
    await saveAlertSettings(repo.db, rules()); await expect(saveAlertSettings(repo.db, rules(minimum))).rejects.toThrow('geheel');
    expect((await repo.db.alertSettings.get('settings'))?.productMinimums).toEqual(rules().productMinimums);
  });
  it('boekt voorraad en melding atomair en maakt geen dubbele melding bij retries', async () => {
    await saveAlertSettings(repo.db, rules()); const before = await repo.snapshot();
    const fail = () => { throw new Error('outbox fault'); }; repo.db.stockAlerts.hook('creating', fail);
    await expect(change(5)).rejects.toThrow('outbox fault'); expect(await repo.snapshot()).toEqual(before); expect(await repo.db.alertStates.count()).toBe(0);
    repo.db.stockAlerts.hook('creating').unsubscribe(fail);
    const command = { operationId: crypto.randomUUID(), productId, locationId: 'H1', type: 'OUT' as const, quantityPacks: 5, inputSource: 'productSearch' as const };
    await Promise.all([repo.bookMovement(command), repo.bookMovement(command)]); expect(await repo.db.stockAlerts.count()).toBe(1);
  });
  it('ontvangst van een pakbon heft de lage-voorraadperiode op zonder nieuwe e-mail', async () => {
    await saveAlertSettings(repo.db, rules()); await change(6);
    const draft = { ...createDraft(), supplier: 'Test', deliveryNumber: 'ALERT-RECEIPT', completenessConfirmed: true, lines: [{ ...emptyLine(), productId, articleNumber: '760364', detectedProductName: 'TENA Discreet Mini', unit: 'verpakking' as const, quantityText: '2', destinationLocationId: 'H1', manuallyReviewed: true }] };
    await confirmDelivery(repo.db, draft); expect(await repo.db.alertStates.count()).toBe(0); expect(await repo.db.stockAlerts.count()).toBe(1);
    await change(1); expect(await repo.db.stockAlerts.count()).toBe(2);
  });
  it('een reset wist de drempels en wachtrij', async () => { await saveAlertSettings(repo.db, rules(12)); await repo.resetDemo(); expect(await repo.db.stockAlerts.count()).toBe(0); expect(await repo.db.alertSettings.count()).toBe(0); });
  it('bewaart versie-3 voorraad bij upgrade naar versie 4', async () => {
    const name = `old-alerts-${crypto.randomUUID()}`; const old = new Dexie(name);
    old.version(3).stores({ stocks: '[productId+locationId], productId, locationId', orders: 'id, reference, status, createdAt' });
    await old.table('stocks').put({ productId, locationId: 'H1', quantityPacks: 42 }); old.close();
    const upgraded = new InventoryDatabase(name);
    try { expect((await upgraded.stocks.get([productId, 'H1']))?.quantityPacks).toBe(42); expect(await upgraded.stockAlerts.count()).toBe(0); } finally { await upgraded.delete(); }
  });
});
describe('Veilig versturen na vastleggen voorraad', () => {
  async function prepare() { await saveAlertSettings(repo.db, { ...rules(10), emailEnabled: true, serviceUrl: 'http://127.0.0.1:8787' }); }
  it('zonder toegangscode of met uitgeschakelde e-mail wordt niets verstuurd', async () => {
    await prepare(); const fetcher = vi.fn(); await sendPendingAlerts(repo.db, '', fetcher); expect(fetcher).not.toHaveBeenCalled();
    await saveAlertSettings(repo.db, { ...rules(10), emailEnabled: false, serviceUrl: 'http://127.0.0.1:8787' }); await sendPendingAlerts(repo.db, 'token', fetcher); expect(fetcher).not.toHaveBeenCalled();
  });
  it('twee tabbladen claimen slechts één melding en versturen uitsluitend productgegevens', async () => {
    await prepare(); const fetcher = vi.fn(async () => Response.json({ id: 'email-1' }));
    await Promise.all([sendPendingAlerts(repo.db, 'token', fetcher), sendPendingAlerts(repo.db, 'token', fetcher)]);
    expect(fetcher).toHaveBeenCalledTimes(1); const sent = JSON.parse((fetcher.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
    expect(Object.keys(sent).sort()).toEqual(['id','kind','productName','articleNumber','locationName','quantity','minimum','detectedAt'].sort());
    expect((await repo.db.stockAlerts.toArray())[0].status).toBe('accepted');
  });
  it('een netwerkfout bewaart de melding en de retry gebruikt exact dezelfde inhoud', async () => {
    await prepare(); const fetcher = vi.fn<typeof fetch>().mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(Response.json({ id: 'email-retry' }));
    await sendPendingAlerts(repo.db, 'token', fetcher); const alert = (await repo.db.stockAlerts.toArray())[0]; expect(alert.status).toBe('pending'); expect(alert.lastError).toContain('bewaard');
    await repo.db.stockAlerts.update(alert.id, { nextAttemptAt: 0 }); await change(1); await sendPendingAlerts(repo.db, 'token', fetcher);
    expect(fetcher.mock.calls[0][1]?.body).toBe(fetcher.mock.calls[1][1]?.body); expect((await repo.db.stockAlerts.get(alert.id))?.status).toBe('accepted');
  });
  it('versturen stopt als de voorraad inmiddels boven de grens is en bij onzekere oude verzending', async () => {
    await prepare(); await change(1, 'IN'); const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ code: 'uncertain' }, { status: 409 }));
    await sendPendingAlerts(repo.db, 'token', fetcher); expect(fetcher).not.toHaveBeenCalled();
    await change(1); await sendPendingAlerts(repo.db, 'token', fetcher); await sendPendingAlerts(repo.db, 'token', fetcher);
    expect(fetcher).toHaveBeenCalledTimes(1); expect(await repo.db.stockAlerts.where('status').equals('uncertain').count()).toBe(1);
  });
});
