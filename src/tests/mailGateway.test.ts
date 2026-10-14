/// <reference types="node" />
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { createMailGateway, type MailConfig, type MailLedger, type MailStore } from '../../server/mailGateway';
import { FileMailStore } from '../../server/fileStore';
import type { AlertPayload } from '../alerts/types';

const config: MailConfig = { apiKey: 're_test_only_not_a_real_key', appToken: 'test-access-code-'.repeat(3), from: 'noreply@example.com', to: ['recipient@example.com'], allowedOrigins: ['http://127.0.0.1:5173'], dailyLimit: 100 };
const payload = (): AlertPayload => ({ id: crypto.randomUUID(), kind: 'low-stock', productName: 'TENA Test', articleNumber: '123456', locationName: 'Rood', quantity: 5, minimum: 5, detectedAt: '2026-10-14T09:00:00Z' });
const request = (body: unknown = payload(), token = config.appToken, origin = config.allowedOrigins[0]) => new Request('http://localhost/alerts', { method: 'POST', headers: { Authorization: `Bearer ${token}`, Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
function memoryStore(): MailStore {
  let ledger: MailLedger = { records: {}, day: '', attempts: 0 };
  return { read: async () => structuredClone(ledger), write: async value => { ledger = structuredClone(value); } };
}
describe('Resend-server: toegang, ontvangers, herhalingen en verzendbewijs', () => {
  it('weigert ontbrekende configuratie, verkeerde toegangscode en vreemde origins vóór Resend', async () => {
    const fetcher = vi.fn(); const gateway = createMailGateway(config, memoryStore(), fetcher);
    expect((await gateway(request(payload(), 'wrong'))).status).toBe(401);
    expect((await gateway(request(payload(), config.appToken, 'https://evil.example'))).status).toBe(403);
    expect((await createMailGateway({ ...config, apiKey: '' }, memoryStore(), fetcher)(request())).status).toBe(503);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('verwerkt de CORS-preflight en geeft ontvangers alleen na authenticatie terug', async () => {
    const gateway = createMailGateway(config, memoryStore(), vi.fn());
    const preflight = await gateway(new Request('http://localhost/alerts', { method: 'OPTIONS', headers: { Origin: config.allowedOrigins[0] } }));
    expect(preflight.status).toBe(204); expect(preflight.headers.get('Access-Control-Allow-Origin')).toBe(config.allowedOrigins[0]);
    const result = await gateway(new Request('http://localhost/health', { headers: { Authorization: `Bearer ${config.appToken}` } }));
    expect(await result.json()).toEqual({ from: config.from, to: config.to });
  });
  it.each([{ quantity: -1 }, { quantity: 6 }, { minimum: 1.5 }, { productName: 'a\nb' }, { detectedAt: 'geen datum' }])('weigert ongeldige payload %j', async change => {
    const fetcher = vi.fn(); const gateway = createMailGateway(config, memoryStore(), fetcher);
    expect((await gateway(request({ ...payload(), ...change }))).status).toBe(400); expect(fetcher).not.toHaveBeenCalled();
  });
  it('ontvangers en afzender komen alleen uit serverconfiguratie; sleutel blijft uit antwoord', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ id: 'email-one' })); const gateway = createMailGateway(config, memoryStore(), fetcher);
    const event = payload(); const response = await gateway(request({ ...event, to: ['other@example.com'], from: 'other@example.com', subject: 'Injected' }));
    expect(await response.json()).toEqual({ id: 'email-one' });
    const email = JSON.parse(fetcher.mock.calls[0][1]?.body as string); expect(email.to).toEqual(config.to); expect(email.from).toBe(config.from);
    expect(email.subject).toBe('Surplus Voorraad: minimumvoorraad bereikt'); expect(email.text).toContain('5 ongeopende verpakkingen'); expect(email.text).not.toContain(config.apiKey);
    expect((fetcher.mock.calls[0][1]?.headers as Record<string, string>)['Idempotency-Key']).toBe(`surplus-stock/${event.id}`);
  });
  it('parallelle aanvragen en herstart na meer dan 24 uur versturen een bevestigd bericht niet opnieuw', async () => {
    const store = memoryStore(); const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => Response.json({ id: 'same-email' })); const gateway = createMailGateway(config, store, fetcher);
    const event = payload(); const replies = await Promise.all([gateway(request(event)), gateway(request(event))]);
    expect(await replies[0].json()).toEqual(await replies[1].json()); expect(fetcher).toHaveBeenCalledTimes(1);
    const restarted = createMailGateway(config, store, fetcher, () => Date.now() + 48 * 3600000);
    expect((await restarted(request(event))).status).toBe(200); expect(fetcher).toHaveBeenCalledTimes(1);
    expect((await restarted(request({ ...event, quantity: 4 }))).status).toBe(409);
  });
  it('bij verloren antwoord is de retry exact gelijk; na 23 uur wordt een onzekere poging geblokkeerd', async () => {
    const store = memoryStore(); const event = payload(); let clock = Date.now();
    const fetcher = vi.fn<typeof fetch>().mockRejectedValue(new Error('lost response'));
    const gateway = createMailGateway(config, store, fetcher, () => clock);
    expect((await gateway(request(event))).status).toBe(503); clock += 60000;
    expect((await gateway(request(event))).status).toBe(503); expect(fetcher.mock.calls[0][1]?.body).toBe(fetcher.mock.calls[1][1]?.body);
    clock += 24 * 3600000; const response = await gateway(request(event)); expect(response.status).toBe(409); expect(await response.json()).toEqual({ code: 'uncertain' }); expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it('een opslagfout vóór verzenden veroorzaakt geen e-mail', async () => {
    const store = memoryStore(); store.write = async () => { throw new Error('disk full'); }; const fetcher = vi.fn();
    expect((await createMailGateway(config, store, fetcher)(request())).status).toBe(503); expect(fetcher).not.toHaveBeenCalled();
  });
  it('begrensde dagelijkse verzending blokkeert nieuwe mails maar laat bestaande verzendbewijzen opvragen', async () => {
    const store = memoryStore(); const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => Response.json({ id: 'email-limited' }));
    const gateway = createMailGateway({ ...config, dailyLimit: 1 }, store, fetcher); const event = payload();
    expect((await gateway(request(event))).status).toBe(200); expect((await gateway(request())).status).toBe(429); expect((await gateway(request(event))).status).toBe(200); expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('bewaart bewijs op schijf en stopt bij een beschadigd logboek in plaats van dubbel te sturen', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'surplus-mail-test-')); const file = join(dir, 'ledger.json');
    try {
      const event = payload(); const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => Response.json({ id: 'persistent-email' }));
      expect((await createMailGateway(config, new FileMailStore(file), fetcher)(request(event))).status).toBe(200);
      expect((await createMailGateway(config, new FileMailStore(file), fetcher)(request(event))).status).toBe(200); expect(fetcher).toHaveBeenCalledTimes(1);
      expect(await readFile(file, 'utf8')).not.toContain(config.apiKey);
      await writeFile(file, 'invalid'); expect((await createMailGateway(config, new FileMailStore(file), fetcher)(request())).status).toBe(503); expect(fetcher).toHaveBeenCalledTimes(1);
    } finally {
      if (!dir.startsWith(join(tmpdir(), 'surplus-mail-test-'))) throw new Error('Unexpected temporary test path');
      await rm(dir, { recursive: true, force: true });
    }
  });
});
