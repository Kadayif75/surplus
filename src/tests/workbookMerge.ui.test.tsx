// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import { OrdersPage } from '../orders/OrdersPage';
import { DeliveryPage } from '../delivery/DeliveryPage';
import { inventory } from '../data/inventoryRepository';
import type { InventorySnapshot } from '../domain/types';
import { mergeFixture } from './mergeFixtures';
let container: HTMLDivElement; let root: Root; let data: InventorySnapshot; let downloads: Blob[];
const downloadButton = () => [...container.querySelectorAll('button')].find(button => button.textContent?.trim() === 'Samengevoegd Excel downloaden')!;
async function settled(check: () => void) { await vi.waitFor(async () => { await act(async () => {}); check(); }, { timeout: 10000 }); }
async function upload(location: string, bytes: ArrayBuffer, name = 'bewoners.xlsm') {
  const input = [...container.querySelectorAll('label')].find(label => label.textContent?.startsWith(`${location}: Excel kiezen`))!.querySelector('input')!;
  const file = new File(['fixture'], name); Object.defineProperty(file, 'arrayBuffer', { value: async () => bytes }); Object.defineProperty(input, 'files', { configurable: true, value: [file] });
  await act(async () => input.dispatchEvent(new Event('change', { bubbles: true })));
  await settled(() => expect(container.textContent).not.toContain('Bestand lezen'));
}
beforeEach(async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }); container = document.createElement('div'); document.body.append(container); root = createRoot(container);
  await inventory.initialize(); await inventory.resetDemo(); data = await inventory.snapshot(); downloads = [];
  const NativeURL = URL; vi.stubGlobal('URL', class extends NativeURL { static createObjectURL(blob: Blob) { downloads.push(blob); return 'blob:local-test'; } static revokeObjectURL() {} });
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  await act(async () => root.render(<OrdersPage data={data} />));
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
describe('Eenvoudig samenvoegscherm met echte Excel-merge en lokale opslag', () => {
  it('drie bestanden geven direct het overzicht en de originele XLSM-download, zonder extra velden of vinkjes', async () => {
    expect(container.querySelectorAll('input')).toHaveLength(3); expect(container.querySelector('input[type="checkbox"]')).toBeNull();
    expect(downloadButton().disabled).toBe(true);
    await upload('Rood', await mergeFixture('ROOD', 2)); await upload('Oranje', await mergeFixture('ORANJE', 3)); expect(downloadButton().disabled).toBe(true);
    await upload('Groen', await mergeFixture('GROEN', 4)); await settled(() => expect(downloadButton().disabled).toBe(false));
    expect(container.textContent).toContain('3 bewoners samengevoegd'); expect(container.textContent).toContain('TENA Discreet Mini'); expect(container.querySelectorAll('input')).toHaveLength(3);
    await act(async () => downloadButton().click()); await settled(() => expect(downloads).toHaveLength(1));
    expect(downloads[0].type).toBe('application/vnd.ms-excel.sheet.macroenabled.12'); expect(await inventory.snapshot()).toEqual(data);
    const order = (await inventory.db.orders.toArray())[0]; expect(order.lines[0].allocations.map(item => item.boxes)).toEqual([2,3,4]); expect(JSON.stringify(order)).not.toContain('ROOD-1');
    await act(async () => downloadButton().click()); await settled(() => expect(downloads).toHaveLength(2)); expect(await inventory.db.orders.count()).toBe(1);
    await act(async () => root.render(<DeliveryPage data={data} />)); await settled(() => expect(container.textContent).toContain(order.reference));
    expect(container.textContent).toContain('Samengevoegd');
  });
  it('een vervangend of onleesbaar bestand verwijdert het oude resultaat en toont maar één melding', async () => {
    await upload('Rood', await mergeFixture('R', 1)); await upload('Oranje', await mergeFixture('O', 1)); await upload('Groen', await mergeFixture('G', 1)); await settled(() => expect(downloadButton().disabled).toBe(false));
    await upload('Groen', new ArrayBuffer(1)); expect(downloadButton().disabled).toBe(true); expect(container.querySelectorAll('[role="alert"]')).toHaveLength(1); expect(container.textContent).not.toContain('3 bewoners samengevoegd');
    expect(await inventory.db.orders.count()).toBe(0);
  });
  it('een lege bestelling kan gewoon als gecombineerd bewonersdocument worden gedownload', async () => {
    await upload('Rood', await mergeFixture('R', 0)); await upload('Oranje', await mergeFixture('O', 0)); await upload('Groen', await mergeFixture('G', 0)); await settled(() => expect(downloadButton().disabled).toBe(false));
    expect(container.textContent).toContain('geen te bestellen producten'); await act(async () => downloadButton().click()); await settled(() => expect(downloads).toHaveLength(1)); expect(await inventory.db.orders.count()).toBe(0);
  });
});
