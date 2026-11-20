import { generateKeyPairSync, verify } from 'node:crypto';
import type { ActivityImport, NetworkRequest, NetworkResponse } from '@wealthfolio/addon-sdk';
import { beforeEach, describe, expect, it } from 'vitest';
import { completeBankAuthorization, startBankAuthorization } from '../src/lib/connect';
import type { EbTransaction } from '../src/lib/eb-types';
import {
  EnableBankingClient,
  JWT_SECRET,
  PRIVATE_KEY_SECRET,
  resetTokenCache,
} from '../src/lib/enable-banking-client';
import type { BankConnection } from '../src/lib/state';
import { runSync, type SyncHost } from '../src/lib/sync';

const APP_ID = '0377783c-3414-4bb1-a7d4-0c3eb54cd4b0';
const IBAN_CHECKING = 'ES9121000418450200051332';
const IBAN_SAVINGS = 'ES7921000813610123456789';
const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const PEM = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();

function book(overrides: Partial<EbTransaction>): EbTransaction {
  return {
    transaction_amount: { amount: '10.00', currency: 'EUR' },
    credit_debit_indicator: 'DBIT',
    status: 'BOOK',
    booking_date: '2026-11-10',
    ...overrides,
  };
}

/** In-memory stand-in for api.enablebanking.com behind the Wealthfolio network broker. */
class FakeEnableBanking {
  sessionCounter = 0;
  requests: Array<{ method: string; path: string; query: URLSearchParams }> = [];
  transactions: Record<string, EbTransaction[]> = {
    checking: [
      book({ entry_reference: 'C1', creditor: { name: 'MERCADONA' } }),
      book({ entry_reference: 'C2', creditor_account: { iban: IBAN_SAVINGS }, transaction_amount: { amount: '500.00', currency: 'EUR' } }),
      book({ entry_reference: 'C3', status: 'PDNG' }),
      book({ entry_reference: 'C4', credit_debit_indicator: 'CRDT', debtor: { name: 'ACME SL' }, transaction_amount: { amount: '2000.00', currency: 'EUR' } }),
    ],
    savings: [
      book({ entry_reference: 'S1', credit_debit_indicator: 'CRDT', debtor_account: { iban: IBAN_CHECKING }, transaction_amount: { amount: '500.00', currency: 'EUR' } }),
      book({ credit_debit_indicator: 'CRDT', remittance_information: ['ABONO INTERESES'], transaction_amount: { amount: '1.23', currency: 'EUR' } }),
    ],
  };

  constructor(private readonly secrets: Map<string, string>) {}

  private checkAuth(request: NetworkRequest) {
    const headerNames = Object.keys(request.headers ?? {}).map((h) => h.toLowerCase());
    if (headerNames.includes('authorization')) throw new Error('broker rejects raw Authorization headers');
    if (request.auth?.type !== 'bearer' || request.auth.secretKey !== JWT_SECRET) return false;
    const token = this.secrets.get(JWT_SECRET) ?? '';
    const [header, payload, signature] = token.split('.');
    const decoded = JSON.parse(Buffer.from(header, 'base64url').toString());
    return (
      decoded.kid === APP_ID &&
      verify('RSA-SHA256', Buffer.from(`${header}.${payload}`), publicKey, Buffer.from(signature, 'base64url'))
    );
  }

  handle = async (request: NetworkRequest): Promise<NetworkResponse> => {
    const url = new URL(request.url);
    expect(url.host).toBe('api.enablebanking.com');
    const method = request.method ?? 'GET';
    this.requests.push({ method, path: url.pathname, query: url.searchParams });
    const json = (status: number, body: unknown): NetworkResponse => ({
      status,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!this.checkAuth(request)) return json(401, { message: 'Invalid JWT', error: 'UNAUTHORIZED' });

    const body = request.body ? JSON.parse(request.body) : undefined;
    if (method === 'GET' && url.pathname === '/application') {
      return json(200, { name: 'Mi app', environment: 'PRODUCTION', redirect_urls: ['https://localhost/callback'] });
    }
    if (method === 'POST' && url.pathname === '/auth') {
      expect(body).toMatchObject({ aspsp: { name: 'Banco Test', country: 'ES' }, psu_type: 'personal' });
      return json(200, { url: `https://auth.example/start?state=${body.state}`, authorization_id: 'auth-1' });
    }
    if (method === 'POST' && url.pathname === '/sessions') {
      expect(body).toEqual({ code: 'the-code' });
      this.sessionCounter += 1;
      const n = this.sessionCounter;
      return json(200, {
        session_id: `session-${n}`,
        aspsp: { name: 'Banco Test', country: 'ES' },
        access: { valid_until: '2027-05-01T00:00:00Z' },
        accounts: [
          { uid: `checking-${n}`, identification_hash: 'hash-checking', account_id: { iban: IBAN_CHECKING }, name: 'Cuenta Nómina', currency: 'EUR', cash_account_type: 'CACC' },
          { uid: `savings-${n}`, identification_hash: 'hash-savings', account_id: { iban: IBAN_SAVINGS }, name: 'Cuenta Ahorro', currency: 'EUR', cash_account_type: 'SVGS' },
        ],
      });
    }
    const match = url.pathname.match(/^\/accounts\/(checking|savings)-\d+\/transactions$/);
    if (method === 'GET' && match) {
      const all = this.transactions[match[1]];
      // Two pages to exercise continuation keys.
      if (url.searchParams.get('continuation_key') === 'page-2') {
        return json(200, { transactions: all.slice(2), continuation_key: null });
      }
      return json(200, { transactions: all.slice(0, 2), continuation_key: all.length > 2 ? 'page-2' : null });
    }
    if (method === 'DELETE' && url.pathname.startsWith('/sessions/')) return json(200, {});
    return json(404, { message: 'not found' });
  };
}

/** In-memory Wealthfolio activities store with sourceRecordId duplicate detection. */
class FakeActivities {
  stored: ActivityImport[] = [];
  failImport = false;

  private isDuplicate(row: ActivityImport) {
    return this.stored.some((s) => s.accountId === row.accountId && s.sourceRecordId === row.sourceRecordId);
  }

  checkImport = async (rows: ActivityImport[]) =>
    rows.map((row) => (this.isDuplicate(row) ? { ...row, duplicateOfId: 'existing' } : { ...row }));

  import = async (rows: ActivityImport[]) => {
    if (this.failImport) {
      return {
        activities: rows.map((r) => ({ ...r, isValid: false, errors: { amount: ['boom'] } })),
        importRunId: 'run',
        summary: { total: rows.length, imported: 0, skipped: rows.length, duplicates: 0, assetsCreated: 0, success: false },
      };
    }
    const fresh = rows.filter((r) => !this.isDuplicate(r));
    this.stored.push(...fresh);
    return {
      activities: rows,
      importRunId: 'run',
      summary: { total: rows.length, imported: fresh.length, skipped: 0, duplicates: rows.length - fresh.length, assetsCreated: 0, success: true },
    };
  };
}

let secrets: Map<string, string>;
let bank: FakeEnableBanking;
let activities: FakeActivities;
let host: SyncHost;

beforeEach(() => {
  resetTokenCache();
  secrets = new Map([[PRIVATE_KEY_SECRET, PEM]]);
  bank = new FakeEnableBanking(secrets);
  activities = new FakeActivities();
  host = {
    network: { request: bank.handle },
    secrets: {
      get: async (key: string) => secrets.get(key) ?? null,
      set: async (key: string, value: string) => void secrets.set(key, value),
      delete: async (key: string) => void secrets.delete(key),
    },
    activities: activities as unknown as SyncHost['activities'],
  } as SyncHost;
});

async function connect(existing: BankConnection[] = []) {
  const client = new EnableBankingClient(host, APP_ID);
  const pending = await startBankAuthorization(client, {
    aspsp: { name: 'Banco Test', country: 'ES' },
    consentDays: 90,
    redirectUrl: 'https://localhost/callback',
  });
  return completeBankAuthorization(
    client,
    pending,
    `https://localhost/callback?state=${pending.state}&code=the-code`,
    existing,
    '2026-08-01',
  );
}

function mapAll(connections: BankConnection[]): BankConnection[] {
  return connections.map((c) => ({
    ...c,
    accounts: c.accounts.map((a) => ({ ...a, wealthfolioAccountId: a.key === 'hash-checking' ? 'wf-checking' : 'wf-savings' })),
  }));
}

const config = { applicationId: APP_ID, country: 'ES' };

describe('end-to-end sync against a fake Enable Banking API', () => {
  it('connects, imports new movements once and skips them on the next sync', async () => {
    const { connections: connected } = await connect();
    expect(connected[0].accounts.map((a) => [a.uid, a.iban])).toEqual([
      ['checking-1', IBAN_CHECKING],
      ['savings-1', IBAN_SAVINGS],
    ]);

    const first = await runSync({ host, config, connections: mapAll(connected), now: new Date('2026-11-20T10:00:00') });
    expect(first.report.imported).toBe(5); // 3 booked checking + 2 savings; the pending one waits
    expect(first.report.accounts.map((a) => [a.account, a.status, a.fetched, a.imported])).toEqual([
      ['Cuenta Nómina', 'ok', 4, 3],
      ['Cuenta Ahorro', 'ok', 2, 2],
    ]);
    expect(first.report.accounts[0].message).toMatch(/pendiente/);
    expect(activities.stored.map((r) => `${r.accountId}:${r.activityType}`)).toEqual([
      'wf-checking:WITHDRAWAL',
      'wf-checking:TRANSFER_OUT',
      'wf-checking:DEPOSIT',
      'wf-savings:TRANSFER_IN',
      'wf-savings:INTEREST',
    ]);
    const firstQuery = bank.requests.find((r) => r.path.endsWith('/transactions'))!.query;
    expect(firstQuery.get('date_from')).toBe('2026-08-01');
    expect(firstQuery.get('date_to')).toBe('2026-11-20');
    expect(first.connections[0].accounts[0].lastSyncedDate).toBe('2026-11-20');

    bank.requests = [];
    const second = await runSync({ host, config, connections: first.connections, now: new Date('2026-11-21T09:00:00') });
    expect(second.report.imported).toBe(0);
    expect(second.report.duplicates).toBe(5);
    expect(activities.stored).toHaveLength(5);
    // Re-reads a week before the last sync to catch late bookings.
    expect(bank.requests.find((r) => r.path.endsWith('/transactions'))!.query.get('date_from')).toBe('2026-11-13');
  });

  it('keeps account mappings and history when the bank is reconnected', async () => {
    const { connections: connected } = await connect();
    const synced = await runSync({ host, config, connections: mapAll(connected), now: new Date('2026-11-20T10:00:00') });
    const { connections: renewed, replaced } = await connect(synced.connections);
    expect(replaced?.sessionId).toBe('session-1');
    expect(renewed).toHaveLength(1);
    expect(renewed[0].sessionId).toBe('session-2');
    expect(renewed[0].accounts.map((a) => [a.uid, a.wealthfolioAccountId, a.lastSyncedDate])).toEqual([
      ['checking-2', 'wf-checking', '2026-11-20'],
      ['savings-2', 'wf-savings', '2026-11-20'],
    ]);
  });

  it('flags expired consents without calling the bank', async () => {
    const { connections: connected } = await connect();
    const expired = mapAll(connected).map((c) => ({ ...c, validUntil: '2026-01-01T00:00:00Z' }));
    bank.requests = [];
    const { report } = await runSync({ host, config, connections: expired, now: new Date('2026-11-20T10:00:00') });
    expect(report.accounts.every((a) => a.status === 'reconnect')).toBe(true);
    expect(bank.requests).toHaveLength(0);
  });

  it('does not advance the sync window when Wealthfolio rejects the import', async () => {
    const { connections: connected } = await connect();
    activities.failImport = true;
    const { report, connections } = await runSync({ host, config, connections: mapAll(connected), now: new Date('2026-11-20T10:00:00') });
    expect(report.importError).toMatch(/boom/);
    expect(report.accounts.every((a) => a.status === 'error')).toBe(true);
    expect(connections[0].accounts.every((a) => !a.lastSyncedDate)).toBe(true);
  });

  it('reports a clear error when the private key does not match the application', async () => {
    const other = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey;
    secrets.set(PRIVATE_KEY_SECRET, other.export({ type: 'pkcs8', format: 'pem' }).toString());
    await expect(new EnableBankingClient(host, APP_ID).getApplication()).rejects.toThrow(/Invalid JWT.*clave privada/s);
  });
});
