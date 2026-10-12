// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import { OrdersPage } from '../orders/OrdersPage';
import { DeliveryPage } from '../delivery/DeliveryPage';
import { inventory } from '../data/inventoryRepository';
import type { InventorySnapshot } from '../domain/types';
import type { DemandImport } from '../orders/types';
const services = vi.hoisted(() => ({ read: vi.fn(), save: vi.fn(), sent: vi.fn() }));
vi.mock('../orders/orderExcel', async original => ({ ...await original<typeof import('../orders/orderExcel')>(), readDemandExcel: services.read }));
vi.mock('../orders/orderService', async original => ({ ...await original<typeof import('../orders/orderService')>(), saveOrder: services.save, markOrderSent: services.sent }));
let container: HTMLDivElement; let root: Root; let data: InventorySnapshot;
function button(name: string) { return [...container.querySelectorAll('button')].find(button => button.textContent?.trim() === name)!; }
function input(name: string) { return [...container.querySelectorAll('label')].find(label => label.textContent?.trim().startsWith(name))!.querySelector('input,select') as HTMLInputElement | HTMLSelectElement; }
async function enter(name: string, value: string) { const element = input(name); await act(async () => { Object.getOwnPropertyDescriptor(element instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype, 'value')!.set!.call(element, value); element.dispatchEvent(new Event(element instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true })); }); }
async function check(name: string) { await act(async () => input(name).click()); }
async function click(name: string) { await act(async () => { button(name).click(); for (const service of [services.save, services.sent]) { const result = service.mock.results.at(-1); if (result) { try { await result.value; } catch { /* deliberate failures */ } } } }); }
async function settled(check: () => void) { await vi.waitFor(async () => { await act(async () => {}); check(); }); }
const source = (hash: string): DemandImport => ({ hash, sourceWeeks: 2, rows: [{ articleNumber: '760364', name: 'TENA Discreet Mini', dailyPieces: 60, packsPerBox: 6, piecesPerPack: 30 }] });
async function upload(name: string, row: DemandImport) {
  services.read.mockResolvedValueOnce(row); const file = new File(['fake'], 'fictieve-invoer.xlsx'); Object.defineProperty(file, 'arrayBuffer', { value: async () => new ArrayBuffer(4) });
  Object.defineProperty(input(`${name}: Excel kiezen`), 'files', { configurable: true, value: [file] });
  await act(async () => input(`${name}: Excel kiezen`).dispatchEvent(new Event('change', { bubbles: true })));
  await settled(() => expect(container.textContent).not.toContain('Producttotalen laden'));
}
async function prepare() { await act(async () => root.render(<OrdersPage data={data} />)); await upload('Rood', source('red')); await upload('Oranje', source('orange')); await upload('Groen', source('green')); await enter('Bestelnummer', 'UI-ORDER-01'); await enter('Leverancier bestelling', 'Fictieve leverancier'); }
beforeEach(async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }); container = document.createElement('div'); document.body.append(container); root = createRoot(container);
  await inventory.initialize(); await inventory.resetDemo(); data = await inventory.snapshot(); services.read.mockReset();
  const actual = await vi.importActual<typeof import('../orders/orderService')>('../orders/orderService'); services.save.mockReset().mockImplementation(actual.saveOrder); services.sent.mockReset().mockImplementation(actual.markOrderSent);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.restoreAllMocks(); });
describe('Drie Excel-invoeren tot bestelling en verdeelde ontvangst', () => {
  it('maakt één gecontroleerd bestelplan en volgt bij volledige levering de verdeling Rood/Oranje/Groen', async () => {
    await prepare(); expect(button('Bestelplan opslaan').disabled).toBe(true); expect(container.textContent).toContain('11 dozen gezamenlijk bestellen');
    await check('Ik heb de drie locaties'); await click('Bestelplan opslaan');
    expect(container.textContent).toContain('Bestelplan opgeslagen'); expect(await inventory.snapshot()).toEqual(data);
    await settled(() => expect(button('Ik heb deze bestelling verstuurd')).toBeDefined()); await click('Ik heb deze bestelling verstuurd');
    const order = (await inventory.db.orders.toArray())[0]; expect(order.status).toBe('Besteld');
    await act(async () => root.render(<DeliveryPage data={data} />)); await settled(() => expect(input('Bijbehorende bestelling').textContent).toContain('UI-ORDER-01'));
    await enter('Bijbehorende bestelling', order.id); await click('Handmatig invoeren');
    await enter('Pakbon-/leveringsnummer', 'UI-RECEIPT-01'); await enter('Leverancier', 'Fictieve leverancier');
    await enter('Artikelnummer op pakbon', '760364'); await enter('Gelezen productnaam', 'TENA Discreet Mini'); await enter('Aantal op de bon', '11'); await enter('Eenheid', 'COL'); await enter('Verpakkingen per doos', '6'); await enter('Stuks per verpakking', '30');
    await click('Verdeling uit bestelling overnemen'); expect(container.querySelectorAll('.delivery-line')).toHaveLength(3);
    expect((container.querySelectorAll('.delivery-line select')[2] as HTMLSelectElement).value).toBe('H1');
    const checks = [...container.querySelectorAll('label')].filter(label => label.textContent?.startsWith('Ik heb artikel, product')).map(label => label.querySelector('input')!);
    for (const checkbox of checks) await act(async () => checkbox.click()); await check('Ik heb de volledige pakbon'); expect(button('Ontvangst bevestigen').disabled).toBe(false);
    await click('Ontvangst bevestigen'); await settled(() => expect(container.textContent).toContain('Ontvangst bevestigd'));
    expect((await inventory.db.orders.get(order.id))?.status).toBe('Ontvangen'); expect((await inventory.db.orders.get(order.id))?.lines[0].allocations.map(item => item.receivedPacks)).toEqual([18, 24, 24]);
    expect(container.textContent).toContain('18 verpakkingen TENA Discreet Mini → Rood');
  });
  it('ontbrekend daggebruik vraagt expliciet invoer of gecontroleerd nul en houdt de rest van de behoefte intact', async () => {
    await prepare(); await upload('Rood', { ...source('red'), rows: [...source('red').rows, { articleNumber: '4238', name: 'Fictieve aanvullende flacon', packsPerBox: 10, piecesPerPack: 1, manualDailyUse: true }] });
    await check('Ik heb de drie locaties'); expect(button('Bestelplan opslaan').disabled).toBe(true); expect(container.textContent).toContain('Vul ontbrekende producttotalen');
    await check('Ik bevestig dat voor alle aanvullende producten'); expect((input('Ik heb de drie locaties') as HTMLInputElement).checked).toBe(false);
    await check('Ik heb de drie locaties'); expect(button('Bestelplan opslaan').disabled).toBe(false); expect(container.textContent).toContain('11 dozen gezamenlijk bestellen');
  });
  it('bij minder ontvangen blijft de verdeling handmatig en wordt niet automatisch voorgesteld', async () => {
    await prepare(); await check('Ik heb de drie locaties'); await click('Bestelplan opslaan'); await settled(() => expect(button('Ik heb deze bestelling verstuurd')).toBeDefined()); await click('Ik heb deze bestelling verstuurd');
    const order = (await inventory.db.orders.toArray())[0]; await act(async () => root.render(<DeliveryPage data={data} />)); await settled(() => expect(input('Bijbehorende bestelling').textContent).toContain('UI-ORDER-01')); await enter('Bijbehorende bestelling', order.id); await click('Handmatig invoeren');
    await enter('Artikelnummer op pakbon', '760364'); await enter('Aantal op de bon', '2'); await enter('Eenheid', 'COL'); await enter('Verpakkingen per doos', '6'); await enter('Stuks per verpakking', '30');
    expect(button('Verdeling uit bestelling overnemen')).toBeUndefined(); expect(container.textContent).toContain('De medewerker bepaalt de verdeling');
    await enter('Rood: ontvangen verpakkingen', '6'); await enter('Oranje: ontvangen verpakkingen', '6'); await click('Eigen verdeling toepassen');
    expect(container.querySelectorAll('.delivery-line')).toHaveLength(2); expect(await inventory.snapshot()).toEqual(data); expect(button('Ontvangst bevestigen').disabled).toBe(true);
  });
  it('wijziging van periode trekt de eerdere controle in', async () => { await prepare(); await check('Ik heb de drie locaties'); await enter('Aantal weken', '3'); expect(button('Bestelplan opslaan').disabled).toBe(true); expect((input('Ik heb de drie locaties') as HTMLInputElement).checked).toBe(false); });
});
