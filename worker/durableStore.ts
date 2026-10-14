import type { MailLedger, MailRecord, MailStore } from '../server/mailGateway.ts';

export interface DurableStorage {
  get<T>(key: string): Promise<T | undefined>;
  put(entries: Record<string, unknown>): Promise<void>;
}
// Store only the requested email and the global daily counter, never read the whole history.
export class DurableMailStore implements MailStore {
  readonly storage: DurableStorage;
  constructor(storage: DurableStorage) { this.storage = storage; }
  async read(key?: string): Promise<MailLedger> {
    if (!key?.startsWith('alert:')) throw new Error('An email key is required');
    const quota = await this.storage.get<{ day: string; attempts: number }>('quota');
    const record = await this.storage.get<MailRecord>(key);
    return { records: record ? { [key]: record } : {}, day: quota?.day ?? '', attempts: quota?.attempts ?? 0 };
  }
  async write(ledger: MailLedger) {
    const entries = Object.entries(ledger.records);
    if (entries.length !== 1 || !entries[0][0].startsWith('alert:')) throw new Error('Exactly one email record is required');
    // Multi-key put is atomic and durable before the gateway calls Resend.
    await this.storage.put({ [entries[0][0]]: entries[0][1], quota: { day: ledger.day, attempts: ledger.attempts } });
  }
}
