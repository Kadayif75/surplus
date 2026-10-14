/// <reference types="node" />
import { createHash, timingSafeEqual } from 'node:crypto';
import type { AlertPayload } from '../src/alerts/types.ts';

export interface MailConfig { apiKey: string; appToken: string; from: string; to: string[]; allowedOrigins: string[]; dailyLimit: number }
interface Email { from: string; to: string[]; subject: string; text: string }
export interface MailRecord { signature: string; email: Email; startedAt: number; emailId?: string }
export interface MailLedger { records: Record<string, MailRecord>; day: string; attempts: number }
export interface MailStore { read(): Promise<MailLedger>; write(value: MailLedger): Promise<void> }
const json = (status: number, body: object) => Response.json(body, { status });
const emailAddress = /^[^\s<>@,]+@[^\s<>@,]+\.[^\s<>@,]+$/;
export function validConfig(config: MailConfig) {
  return /^re_[A-Za-z0-9_-]+$/.test(config.apiKey) && config.appToken.length >= 32 && !config.appToken.startsWith('re_') && emailAddress.test(config.from) && config.to.length > 0 && config.to.length <= 5 && config.to.every(value => emailAddress.test(value)) && Number.isSafeInteger(config.dailyLimit) && config.dailyLimit > 0 && config.dailyLimit <= 1000;
}
function parsePayload(value: unknown): AlertPayload | undefined {
  if (!value || typeof value !== 'object') return;
  const body = value as Record<string, unknown>;
  const text = (key: string, max: number) => typeof body[key] === 'string' && (body[key] as string).length > 0 && (body[key] as string).length <= max && !/[\u0000-\u001f\u007f]/.test(body[key] as string);
  if (!text('id', 80) || !/^[a-zA-Z0-9-]{16,80}$/.test(body.id as string) || !['test', 'low-stock'].includes(String(body.kind)) || !text('productName', 160) || !text('articleNumber', 80) || !text('locationName', 80) || !text('detectedAt', 40)) return;
  if (![body.quantity, body.minimum].every(v => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 && v <= 1000000) || (body.quantity as number) > (body.minimum as number) || !Number.isFinite(Date.parse(body.detectedAt as string))) return;
  // Only these fields can influence the email. Recipients, sender and subject are server-controlled.
  return { id: body.id as string, kind: body.kind as AlertPayload['kind'], productName: body.productName as string, articleNumber: body.articleNumber as string, locationName: body.locationName as string, quantity: body.quantity as number, minimum: body.minimum as number, detectedAt: body.detectedAt as string };
}
export function buildEmail(config: MailConfig, payload: AlertPayload): Email {
  return { from: config.from, to: [...config.to], subject: payload.kind === 'test' ? 'Surplus Voorraad: testmelding' : 'Surplus Voorraad: minimumvoorraad bereikt',
    text: payload.kind === 'test' ? 'Dit is een testmelding van Surplus Voorraad. De verbinding met Resend werkt. Er is geen voorraad gewijzigd.' : [
      'Een product heeft de ingestelde minimumvoorraad bereikt.', '', `Ruimte: ${payload.locationName}`, `Product: ${payload.productName}`, `Artikelnummer: ${payload.articleNumber}`,
      `Voorraad bij signalering: ${payload.quantity} ongeopende verpakkingen`, `Ingesteld minimum: ${payload.minimum} verpakkingen`,
      `Gesignaleerd op: ${new Date(payload.detectedAt).toLocaleString('nl-NL', { timeZone: 'Europe/Amsterdam' })} (Nederlandse tijd)`, '',
      'Controleer de actuele voorraad en eventuele openstaande bestellingen in de browser waarin de voorraad wordt bijgehouden. Bestel zo nodig bij via de gebruikelijke werkwijze.',
      'Deze melding plaatst zelf geen bestelling. De voorraad kan inmiddels gewijzigd zijn.', '', `Melding-ID: ${payload.id}`,
    ].join('\n') };
}
export function createMailGateway(config: MailConfig, store: MailStore, fetcher: typeof fetch = fetch, now: () => number = Date.now) {
  let queue: Promise<unknown> = Promise.resolve();
  async function send(payload: AlertPayload) {
    const state = await store.read();
    const signature = createHash('sha256').update(JSON.stringify(payload)).digest('hex');
    const key = `alert:${payload.id}`; let record = state.records[key];
    if (record && record.signature !== signature) return json(409, { code: 'conflict' });
    if (record?.emailId) return json(200, { id: record.emailId });
    // Resend retains idempotency keys for 24h. Never blindly retry an ambiguous send beyond that window.
    if (record && now() - record.startedAt >= 23 * 3600000) return json(409, { code: 'uncertain' });
    const day = new Date(now()).toISOString().slice(0, 10);
    if (state.day !== day) { state.day = day; state.attempts = 0; }
    if (state.attempts >= config.dailyLimit) return json(429, { code: 'rate_limit' });
    record ??= { signature, email: buildEmail(config, payload), startedAt: now() };
    state.records[key] = record; state.attempts += 1;
    await store.write(state); // Must be durable BEFORE any external side effect.
    try {
      const response = await fetcher('https://api.resend.com/emails', { method: 'POST', headers: {
        Authorization: `Bearer ${config.apiKey}`, 'Content-Type': 'application/json', 'Idempotency-Key': `surplus-stock/${payload.id}`,
      }, body: JSON.stringify(record.email), signal: AbortSignal.timeout(10000), redirect: 'error' });
      if (!response.ok) return json(response.status === 429 ? 429 : 502, { code: 'provider' });
      const data = await response.json() as { id?: unknown };
      if (typeof data.id !== 'string' || !data.id) return json(502, { code: 'provider' });
      record.emailId = data.id; await store.write(state);
      return json(200, { id: data.id });
    } catch { return json(503, { code: 'unavailable' }); }
  }
  return async (request: Request): Promise<Response> => {
    const origin = request.headers.get('Origin');
    const cors: Record<string, string> = { 'Cache-Control': 'no-store', 'Vary': 'Origin', 'X-Content-Type-Options': 'nosniff' };
    if (origin && !config.allowedOrigins.includes(origin)) return json(403, { code: 'origin' });
    if (origin) cors['Access-Control-Allow-Origin'] = origin;
    const respond = (response: Response) => { for (const [key, value] of Object.entries(cors)) response.headers.set(key, value); return response; };
    if (request.method === 'OPTIONS') return respond(new Response(null, { status: 204, headers: { 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Authorization, Content-Type', 'Access-Control-Max-Age': '600' } }));
    if (!validConfig(config)) return respond(json(503, { code: 'configuration' }));
    const provided = createHash('sha256').update(request.headers.get('Authorization') ?? '').digest();
    const expected = createHash('sha256').update(`Bearer ${config.appToken}`).digest();
    if (!timingSafeEqual(provided, expected)) return respond(json(401, { code: 'unauthorized' }));
    const path = new URL(request.url).pathname;
    if (path === '/health' && request.method === 'GET') return respond(json(200, { from: config.from, to: config.to }));
    if (path !== '/alerts' || request.method !== 'POST') return respond(json(404, { code: 'not_found' }));
    if (!(request.headers.get('Content-Type') ?? '').startsWith('application/json')) return respond(json(415, { code: 'content_type' }));
    let payload: AlertPayload | undefined;
    try { const body = await request.text(); if (body.length > 8192) return respond(json(413, { code: 'size' })); payload = parsePayload(JSON.parse(body)); } catch { return respond(json(400, { code: 'payload' })); }
    if (!payload) return respond(json(400, { code: 'payload' }));
    const job = queue.then(() => send(payload));
    queue = job.catch(() => {});
    try { return respond(await job); } catch { return respond(json(503, { code: 'storage' })); }
  };
}
