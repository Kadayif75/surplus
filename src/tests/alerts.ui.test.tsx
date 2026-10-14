// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AlertsPage } from '../alerts/AlertsPage';
import { inventory } from '../data/inventoryRepository';
import { defaultAlertSettings, productLimitKey } from '../alerts/types';
import { setMailAccess } from '../alerts/alertSender';
let root: Root; let container: HTMLDivElement;
const click = async (text: string) => { const button = [...container.querySelectorAll('button')].find(b => b.textContent === text)!; await act(async () => button.click()); };
async function fill(input: HTMLInputElement, value: string) { await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value); input.dispatchEvent(new Event('input', { bubbles: true })); }); }
beforeEach(async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }); await inventory.initialize(); await inventory.resetDemo(); sessionStorage.clear();
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
  await act(async () => root.render(<AlertsPage data={await inventory.snapshot()} settings={defaultAlertSettings()} alerts={[]} />));
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); sessionStorage.clear(); });
describe('Minimumvoorraad instellen', () => {
  it('slaat ruimtestandaard en productafwijking op zonder voorraadwijziging of e-mail', async () => {
    const before = await inventory.snapshot(); const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
    const inputs = [...container.querySelectorAll<HTMLInputElement>('input[type="number"]')]; await fill(inputs[0], '5');
    await fill(container.querySelector<HTMLInputElement>('input[aria-label="Minimum TENA Discreet Mini in Rood"]')!, '2');
    await click('Minimumvoorraden opslaan');
    await vi.waitFor(() => expect(container.textContent).toContain('Minimumvoorraden opgeslagen'));
    const saved = await inventory.db.alertSettings.get('settings'); expect(saved?.roomMinimums).toEqual({ H1: 5 }); expect(saved?.productMinimums[productLimitKey('tena-760364', 'H1')]).toBe(2);
    expect(await inventory.snapshot()).toEqual(before); expect(fetcher).not.toHaveBeenCalled();
  });
  it('bewaart geen Resend-sleutel als toegangscode', () => { expect(() => setMailAccess('re_this_is_only_a_test_key')).toThrow('uitsluitend op de server'); expect(sessionStorage.length).toBe(0); });
  it('laat e-mail uit wanneer de verbinding niet bevestigd kan worden', async () => {
    const checkbox = container.querySelector<HTMLInputElement>('input[type="checkbox"]')!; await act(async () => checkbox.click());
    await fill(container.querySelector<HTMLInputElement>('input[type="url"]')!, 'http://127.0.0.1:8787'); await fill(container.querySelector<HTMLInputElement>('input[type="password"]')!, 'local-access-code-'.repeat(3));
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ code: 'unauthorized' }, { status: 401 })));
    await click('E-mailinstellingen opslaan'); await vi.waitFor(() => expect(container.querySelector('[role="alert"]')?.textContent).toContain('weigert toegang'));
    expect((await inventory.db.alertSettings.get('settings'))?.emailEnabled).not.toBe(true);
  });
});
