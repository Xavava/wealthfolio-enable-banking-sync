import { generateKeyPairSync, verify } from 'node:crypto';
import type {
  ActivityImport,
  NetworkRequest,
  NetworkResponse,
} from '@wealthfolio/addon-sdk';
import { expect } from 'vitest';
import { completeBankAuthorization, startBankAuthorization } from '../src/lib/connect';
import type { EbBalance, EbTransaction } from '../src/lib/eb-types';
import {
  EnableBankingClient,
  JWT_SECRET,
  PRIVATE_KEY_SECRET,
  resetTokenCache,
} from '../src/lib/enable-banking-client';
import type { BankConnection } from '../src/lib/state';
import type { SyncHost } from '../src/lib/sync';

export const APP_ID = '0377783c-3414-4bb1-a7d4-0c3eb54cd4b0';
export const IBAN_CHECKING = 'ES9121000418450200051332';
export const IBAN_SAVINGS = 'ES7921000813610123456789';
const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
export const PEM = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();

export function book(overrides: Partial<EbTransaction>): EbTransaction {
  return {
    transaction_amount: { amount: '10.00', currency: 'EUR' },
    credit_debit_indicator: 'DBIT',
    status: 'BOOK',
    booking_date: '2026-11-10',
    ...overrides,
  };
}

/** In-memory stand-in for api.enablebanking.com behind the Wealthfolio network broker. */
export class FakeEnableBanking {
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
  balances: Record<string, EbBalance[] | 'error'> = {
    checking: [
      { balance_amount: { amount: '1490.00', currency: 'EUR' }, balance_type: 'CLAV' },
      { balance_amount: { amount: '1480.00', currency: 'EUR' }, balance_type: 'ITBD', reference_date: '2026-11-20' },
    ],
    savings: [{ balance_amount: { amount: '501.23', currency: 'EUR' }, balance_type: 'CLBD' }],
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

  transactionRequests(kind?: 'checking' | 'savings') {
    return this.requests.filter(
      (r) => r.path.endsWith('/transactions') && (!kind || r.path.includes(`/${kind}-`)),
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
    const match = url.pathname.match(/^\/accounts\/(checking|savings)-\d+\/(transactions|balances)$/);
    if (method === 'GET' && match && match[2] === 'transactions') {
      const all = this.transactions[match[1]];
      // Two pages to exercise continuation keys.
      if (url.searchParams.get('continuation_key') === 'page-2') {
        return json(200, { transactions: all.slice(2), continuation_key: null });
      }
      return json(200, { transactions: all.slice(0, 2), continuation_key: all.length > 2 ? 'page-2' : null });
    }
    if (method === 'GET' && match && match[2] === 'balances') {
      const balances = this.balances[match[1]];
      if (balances === 'error') return json(500, { message: 'ASPSP error' });
      return json(200, { balances });
    }
    if (method === 'DELETE' && url.pathname.startsWith('/sessions/')) return json(200, {});
    return json(404, { message: 'not found' });
  };
}

/**
 * In-memory Wealthfolio activities store with sourceRecordId duplicate detection.
 * It offers only checkImport and import, the two functions the manifest declares:
 * calling anything else (e.g. search) fails the test.
 */
export class FakeActivities {
  stored: ActivityImport[] = [];
  failImport = false;
  /** Rows checkImport rejects. */
  rejectInCheck: (row: ActivityImport) => boolean = () => false;
  /** Rows import skips as invalid while the import as a whole succeeds. */
  rejectInImport: (row: ActivityImport) => boolean = () => false;
  imports: ActivityImport[][] = [];

  /** Makes the next checkImport call fail as a whole, like a host error. */
  failCheckCall = false;

  /**
   * Wealthfolio deserializes each row into a Rust struct whose `date`, `symbol`,
   * `activityType` and `currency` are required strings and `isDraft`/`isValid`
   * required booleans (the SDK type marks `symbol` optional). A row without them
   * fails the whole call with a generic internal error.
   */
  private assertHostShape(rows: ActivityImport[]) {
    for (const row of rows) {
      const record = row as unknown as Record<string, unknown>;
      for (const field of ['date', 'symbol', 'activityType', 'currency']) {
        if (typeof record[field] !== 'string') throw hostError(`missing field \`${field}\``);
      }
      for (const field of ['isDraft', 'isValid']) {
        if (typeof record[field] !== 'boolean') throw hostError(`missing field \`${field}\``);
      }
    }
  }

  private isDuplicate(row: ActivityImport) {
    return this.stored.some((s) => s.accountId === row.accountId && s.sourceRecordId === row.sourceRecordId);
  }

  checkImport = async (rows: ActivityImport[]) => {
    this.assertHostShape(rows);
    if (this.failCheckCall) throw hostError('database is locked');
    return rows.map((row) => {
      if (this.rejectInCheck(row)) return { ...row, isValid: false, errors: { amount: ['rechazado'] } };
      return this.isDuplicate(row) ? { ...row, duplicateOfId: 'existing' } : { ...row };
    });
  };

  import = async (rows: ActivityImport[]) => {
    this.assertHostShape(rows);
    this.imports.push(rows);
    if (this.failImport) {
      return {
        activities: rows.map((r) => ({ ...r, isValid: false, errors: { amount: ['boom'] } })),
        importRunId: 'run',
        summary: { total: rows.length, imported: 0, skipped: rows.length, duplicates: 0, assetsCreated: 0, success: false },
      };
    }
    const outcome = rows.map((r) => {
      if (this.rejectInImport(r)) return { ...r, isValid: false, errors: { date: ['fuera de rango'] } };
      if (this.isDuplicate(r)) return { ...r, duplicateOfId: 'existing' };
      this.stored.push(r);
      return r;
    });
    return {
      activities: outcome,
      importRunId: 'run',
      summary: {
        total: rows.length,
        imported: outcome.filter((r) => r.isValid && !r.duplicateOfId).length,
        skipped: 0,
        duplicates: outcome.filter((r) => r.duplicateOfId).length,
        assetsCreated: 0,
        success: true,
      },
    };
  };
}

/** A rejected host call: generic localized message plus a stable code, as in SDK 3.13.1. */
function hostError(detail: string): Error {
  return Object.assign(new Error('No se pudo completar la operación.'), { code: 'internal', detail });
}

export interface Harness {
  secrets: Map<string, string>;
  bank: FakeEnableBanking;
  activities: FakeActivities;
  accountTypes: Record<string, string>;
  host: SyncHost;
}

export function createHarness(): Harness {
  resetTokenCache();
  const secrets = new Map([[PRIVATE_KEY_SECRET, PEM]]);
  const bank = new FakeEnableBanking(secrets);
  const activities = new FakeActivities();
  const accountTypes: Record<string, string> = { 'wf-checking': 'CASH', 'wf-savings': 'CASH' };
  const host = {
    network: { request: bank.handle },
    secrets: {
      get: async (key: string) => secrets.get(key) ?? null,
      set: async (key: string, value: string) => void secrets.set(key, value),
      delete: async (key: string) => void secrets.delete(key),
    },
    accounts: {
      getAll: async () =>
        Object.entries(accountTypes).map(([id, accountType]) => ({ id, accountType, currency: 'EUR', name: id })),
    },
    activities: { checkImport: activities.checkImport, import: activities.import } as unknown as SyncHost['activities'],
  } as unknown as SyncHost;
  return { secrets, bank, activities, accountTypes, host };
}

export async function connect(host: SyncHost, existing: BankConnection[] = [], syncFrom = '2026-08-01') {
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
    syncFrom,
  );
}

/** Maps both bank accounts to Wealthfolio accounts, as if the user also chose the start date. */
export function mapAll(connections: BankConnection[], options: { confirmDate?: boolean } = {}): BankConnection[] {
  const confirmDate = options.confirmDate ?? true;
  return connections.map((c) => ({
    ...c,
    accounts: c.accounts.map((a) => ({
      ...a,
      wealthfolioAccountId: a.key === 'hash-checking' ? 'wf-checking' : 'wf-savings',
      syncFromConfirmed: confirmDate,
    })),
  }));
}

export const config = { applicationId: APP_ID, country: 'ES' };
