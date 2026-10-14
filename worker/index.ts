import { createHash, timingSafeEqual } from 'node:crypto';
import { createMailGateway } from '../server/mailGateway.ts';
import { DurableMailStore, type DurableStorage } from './durableStore.ts';

interface Env {
  RESEND_API_KEY: string; APP_TOKEN: string; ALERT_FROM: string; ALERT_TO: string;
  ALLOWED_ORIGINS: string; MAIL_DAILY_LIMIT: string;
  MAIL_GATEWAY: { getByName(name: string): { fetch(request: Request): Promise<Response> } };
}
export class MailGateway {
  readonly handler: (request: Request) => Promise<Response>;
  constructor(state: { storage: DurableStorage }, env: Env) {
    this.handler = createMailGateway({ apiKey: env.RESEND_API_KEY ?? '', appToken: env.APP_TOKEN ?? '',
      from: env.ALERT_FROM ?? '', to: (env.ALERT_TO ?? '').split(',').map(value => value.trim()).filter(Boolean),
      allowedOrigins: (env.ALLOWED_ORIGINS ?? '').split(',').map(value => value.trim()), dailyLimit: Number(env.MAIL_DAILY_LIMIT ?? '100'),
    }, new DurableMailStore(state.storage));
  }
  fetch(request: Request) { return this.handler(request); }
}
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const origin = request.headers.get('Origin');
    const allowed = (env.ALLOWED_ORIGINS ?? '').split(',').map(value => value.trim());
    const headers: Record<string, string> = { 'Cache-Control': 'no-store', Vary: 'Origin' };
    if (origin && !allowed.includes(origin)) return Response.json({ code: 'origin' }, { status: 403, headers });
    if (origin) headers['Access-Control-Allow-Origin'] = origin;
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: { ...headers,
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Authorization, Content-Type', 'Access-Control-Max-Age': '600' } });
    if (!env.APP_TOKEN || env.APP_TOKEN.length < 32) return Response.json({ code: 'configuration' }, { status: 503, headers });
    const actual = createHash('sha256').update(request.headers.get('Authorization') ?? '').digest();
    const expected = createHash('sha256').update(`Bearer ${env.APP_TOKEN}`).digest();
    if (!timingSafeEqual(actual, expected)) return Response.json({ code: 'unauthorized' }, { status: 401, headers });
    try { return await env.MAIL_GATEWAY.getByName('ganshoek-mail-v1').fetch(request); }
    catch { return Response.json({ code: 'unavailable' }, { status: 503, headers }); }
  },
};
