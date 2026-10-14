import { createServer } from 'node:http';
import { resolve } from 'node:path';
import { createMailGateway } from './mailGateway.ts';
import { FileMailStore } from './fileStore.ts';

const port = Number(process.env.MAIL_PORT ?? '8787');
const host = process.env.MAIL_HOST ?? '127.0.0.1';
const gateway = createMailGateway({ apiKey: process.env.RESEND_API_KEY ?? '', appToken: process.env.APP_TOKEN ?? '',
  from: process.env.ALERT_FROM ?? 'noreply@barbr.pw', to: (process.env.ALERT_TO ?? '').split(',').map(value => value.trim()).filter(Boolean),
  allowedOrigins: (process.env.ALLOWED_ORIGINS ?? 'http://127.0.0.1:5173,http://localhost:5173').split(',').map(value => value.trim()),
  dailyLimit: Number(process.env.MAIL_DAILY_LIMIT ?? '100'),
}, new FileMailStore(resolve(process.env.MAIL_DATA_FILE ?? 'server/.data/mail-ledger.json')));

const server = createServer(async (incoming, outgoing) => {
  try {
    const chunks: Buffer[] = []; let size = 0;
    for await (const chunk of incoming) { size += chunk.length; if (size > 8192) { outgoing.writeHead(413); outgoing.end(); return; } chunks.push(chunk); }
    const headers = new Headers();
    for (const [key, value] of Object.entries(incoming.headers)) if (value) headers.set(key, Array.isArray(value) ? value.join(',') : value);
    const method = incoming.method ?? 'GET';
    // The fixed local base prevents an untrusted Host header from influencing routing.
    const request = new Request(`http://localhost:${port}${incoming.url ?? '/'}`, { method, headers, body: ['GET', 'HEAD'].includes(method) ? undefined : Buffer.concat(chunks) });
    const response = await gateway(request);
    outgoing.writeHead(response.status, Object.fromEntries(response.headers.entries()));
    outgoing.end(Buffer.from(await response.arrayBuffer()));
  } catch { outgoing.writeHead(500, { 'Content-Type': 'application/json' }); outgoing.end('{"code":"server"}'); }
});
server.requestTimeout = 20000; server.headersTimeout = 10000;
server.listen(port, host, () => console.log(`Surplus-mailserver: http://${host}:${port}. Sleutels worden uitsluitend uit de serveromgeving geladen.`));
