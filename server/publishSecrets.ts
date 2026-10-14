import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

const values = { RESEND_API_KEY: process.env.RESEND_API_KEY ?? '', APP_TOKEN: process.env.APP_TOKEN ?? '', ALERT_TO: process.env.ALERT_TO ?? '' };
if (!values.RESEND_API_KEY || values.APP_TOKEN.length < 32 || !values.ALERT_TO) throw new Error('Vul eerst de lokale .env.mail in.');
const redact = (value: string) => Object.values(values).reduce((text, secret) => secret ? text.split(secret).join('[afgeschermd]') : text, value);
try {
  const output = execFileSync(process.execPath, [resolve('node_modules/wrangler/bin/wrangler.js'), 'secret', 'bulk'], {
    input: JSON.stringify(values), encoding: 'utf8', env: { ...process.env, CI: 'true' }, maxBuffer: 1024 * 1024,
  });
  console.log(redact(output));
} catch (error) {
  const result = error as { stdout?: string; stderr?: string };
  console.error(redact(`${result.stdout ?? ''}\n${result.stderr ?? ''}`)); process.exitCode = 1;
}
