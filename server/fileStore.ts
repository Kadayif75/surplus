import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { MailLedger, MailStore } from './mailGateway.ts';

// Run one server process per ledger path. Keep this directory on persistent storage.
export class FileMailStore implements MailStore {
  readonly path: string;
  constructor(path: string) { this.path = path; }
  async read(): Promise<MailLedger> {
    try {
      const value = JSON.parse(await readFile(this.path, 'utf8')) as MailLedger;
      if (!value.records || typeof value.records !== 'object' || Array.isArray(value.records) || typeof value.day !== 'string' || !Number.isSafeInteger(value.attempts)) throw new Error('Invalid mail ledger');
      return value;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { records: {}, day: '', attempts: 0 };
      throw error; // Never silently erase evidence of an earlier send.
    }
  }
  async write(value: MailLedger) {
    await mkdir(dirname(this.path), { recursive: true });
    const temporary = `${this.path}.${crypto.randomUUID()}.tmp`;
    await writeFile(temporary, JSON.stringify(value), { encoding: 'utf8', mode: 0o600, flush: true });
    await rename(temporary, this.path);
  }
}
