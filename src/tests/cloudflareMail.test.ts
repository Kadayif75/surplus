/// <reference types="node" />
import { afterEach, describe, expect, it, vi } from 'vitest';
import worker, { MailGateway } from '../../worker/index';
import { DurableMailStore, type DurableStorage } from '../../worker/durableStore';
import { createMailGateway } from '../../server/mailGateway';

function storage() {
  const values = new Map<string, unknown>();
  const api: DurableStorage = { get: async <T>(key: string) => structuredClone(values.get(key)) as T | undefined,
    put: async entries => { for (const [key, value] of Object.entries(entries)) values.set(key, structuredClone(value)); } };
  return { values, api };
}
const token = 'worker-test-access-'.repeat(3);
const env = { APP_TOKEN: token, RESEND_API_KEY: 're_test_not_real', ALERT_FROM: 'noreply@example.com', ALERT_TO: 'recipient@example.com', ALLOWED_ORIGINS: 'https://kadayif75.github.io', MAIL_DAILY_LIMIT: '2' };
const config = { appToken: token, apiKey: env.RESEND_API_KEY, from: env.ALERT_FROM, to: [env.ALERT_TO], allowedOrigins: [env.ALLOWED_ORIGINS], dailyLimit: 2 };
const payload = () => ({ id: crypto.randomUUID(), kind: 'low-stock', productName: 'TENA Test', articleNumber: '123456', locationName: 'Rood', minimum: 5, quantity: 4, detectedAt: '2026-10-14T09:00:00Z' });
const request = (event = payload()) => new Request('https://mail.example/alerts', { method: 'POST', headers: { Origin: env.ALLOWED_ORIGINS, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(event) });
afterEach(() => vi.unstubAllGlobals());
describe('Gratis Cloudflare-adapter met SQLite-backed Durable Object', () => {
  it('houdt afzonderlijke verzendbewijzen intact en bewaart de globale daglimiet na herstart', async () => {
    const saved = storage(); const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => Response.json({ id: crypto.randomUUID() }));
    const first = payload(); const second = payload();
    const gateway = createMailGateway(config, new DurableMailStore(saved.api), fetcher);
    const response = await gateway(request(first)); const proof = await response.json(); expect(response.status).toBe(200);
    expect((await gateway(request(second))).status).toBe(200);
    expect(saved.values.has(`alert:${first.id}`)).toBe(true); expect(saved.values.has(`alert:${second.id}`)).toBe(true);
    const restarted = createMailGateway(config, new DurableMailStore(saved.api), fetcher);
    expect(await (await restarted(request(first))).json()).toEqual(proof); expect((await restarted(request())).status).toBe(429); expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it('gebruikt één vast Durable Object voor concurrerende aanvragen, ook vanuit aparte Worker-aanroepen', async () => {
    const saved = storage(); const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => Response.json({ id: 'durable-proof' })); vi.stubGlobal('fetch', fetcher);
    const object = new MailGateway({ storage: saved.api }, env as ConstructorParameters<typeof MailGateway>[1]);
    const getByName = vi.fn(() => object); const bindings = { ...env, MAIL_GATEWAY: { getByName } }; const event = payload();
    const results = await Promise.all([worker.fetch(request(event), bindings), worker.fetch(request(event), bindings)]);
    expect(results.every(reply => reply.status === 200)).toBe(true); expect(fetcher).toHaveBeenCalledTimes(1);
    expect(getByName.mock.calls.map(call => (call as unknown as [string])[0])).toEqual(['ganshoek-mail-v1', 'ganshoek-mail-v1']);
  });
  it('weigert vreemde origins en verkeerde codes vóór het Durable Object; preflight verstuurt niets', async () => {
    const getByName = vi.fn(); const bindings = { ...env, MAIL_GATEWAY: { getByName } };
    expect((await worker.fetch(new Request('https://mail.example/health'), bindings)).status).toBe(401);
    expect((await worker.fetch(new Request('https://mail.example/health', { headers: { Origin: 'https://evil.example' } }), bindings)).status).toBe(403);
    const preflight = await worker.fetch(new Request('https://mail.example/alerts', { method: 'OPTIONS', headers: { Origin: env.ALLOWED_ORIGINS } }), bindings);
    expect(preflight.status).toBe(204); expect(preflight.headers.get('Access-Control-Allow-Origin')).toBe(env.ALLOWED_ORIGINS); expect(getByName).not.toHaveBeenCalled();
  });
  it('gebruikt de door Cloudflare ondersteunde manual-redirectmodus en volgt geen Resend-redirect met geheimen', async () => {
    const saved = storage(); const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 302, headers: { Location: 'https://other.example' } }));
    const response = await createMailGateway(config, new DurableMailStore(saved.api), fetcher)(request());
    expect(response.status).toBe(502); expect(fetcher).toHaveBeenCalledTimes(1); expect(fetcher.mock.calls[0][1]?.redirect).toBe('manual');
  });
});
