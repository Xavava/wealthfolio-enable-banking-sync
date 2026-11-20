import { generateKeyPairSync } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import { EnableBankingClient, NetworkBlockedError, PRIVATE_KEY_SECRET } from '../src/lib/enable-banking-client';
import { runSync } from '../src/lib/sync';
import {
  APP_ID,
  IBAN_CHECKING,
  book,
  config,
  connect,
  createHarness,
  mapAll,
  type Harness,
} from './harness';

let h: Harness;

beforeEach(() => {
  h = createHarness();
});

describe('end-to-end sync against a fake Enable Banking API', () => {
  it('connects, imports new movements once and skips them on the next sync', async () => {
    const { connections: connected } = await connect(h.host);
    expect(connected[0].accounts.map((a) => [a.uid, a.iban])).toEqual([
      ['checking-1', IBAN_CHECKING],
      ['savings-1', 'ES7921000813610123456789'],
    ]);

    const first = await runSync({ host: h.host, config, connections: mapAll(connected), now: new Date('2026-11-20T10:00:00') });
    expect(first.report.imported).toBe(5); // 3 booked checking + 2 savings; the pending one waits
    expect(first.report.accounts.map((a) => [a.account, a.status, a.fetched, a.imported, a.pending])).toEqual([
      ['Cuenta Nómina', 'ok', 4, 3, 1],
      ['Cuenta Ahorro', 'ok', 2, 2, 0],
    ]);
    expect(first.report.accounts[0].notes?.join(' ')).toMatch(/pendiente/);
    expect(h.activities.stored.map((r) => `${r.accountId}:${r.activityType}`)).toEqual([
      'wf-checking:WITHDRAWAL',
      'wf-checking:TRANSFER_OUT',
      'wf-checking:DEPOSIT',
      'wf-savings:TRANSFER_IN',
      'wf-savings:INTEREST',
    ]);
    // First sync: the longest history from the chosen date (date_to is ignored there).
    const firstQuery = h.bank.transactionRequests()[0].query;
    expect(firstQuery.get('date_from')).toBe('2026-08-01');
    expect(firstQuery.get('strategy')).toBe('longest');
    expect(firstQuery.get('date_to')).toBeNull();
    expect(first.connections[0].accounts[0].lastSyncedDate).toBe('2026-11-20');

    h.bank.requests = [];
    const second = await runSync({ host: h.host, config, connections: first.connections, now: new Date('2026-11-21T09:00:00') });
    expect(second.report.imported).toBe(0);
    expect(second.report.duplicates).toBe(5);
    expect(h.activities.stored).toHaveLength(5);
    // Later syncs ask for the exact range. The pending movement (booking date
    // 2026-11-10) is read again; otherwise a week back.
    const checkingQuery = h.bank.transactionRequests('checking')[0].query;
    expect(checkingQuery.get('date_from')).toBe('2026-11-10');
    expect(checkingQuery.get('date_to')).toBe('2026-11-21');
    expect(checkingQuery.get('strategy')).toBeNull();
    expect(h.bank.transactionRequests('savings')[0].query.get('date_from')).toBe('2026-11-13');
  });

  it('keeps account mappings and history when the bank is reconnected', async () => {
    const { connections: connected } = await connect(h.host);
    const synced = await runSync({ host: h.host, config, connections: mapAll(connected), now: new Date('2026-11-20T10:00:00') });
    const { connections: renewed, replaced } = await connect(h.host, synced.connections);
    expect(replaced?.sessionId).toBe('session-1');
    expect(renewed).toHaveLength(1);
    expect(renewed[0].sessionId).toBe('session-2');
    expect(renewed[0].accounts.map((a) => [a.uid, a.wealthfolioAccountId, a.lastSyncedDate])).toEqual([
      ['checking-2', 'wf-checking', '2026-11-20'],
      ['savings-2', 'wf-savings', '2026-11-20'],
    ]);
  });

  it('flags expired consents without calling the bank', async () => {
    const { connections: connected } = await connect(h.host);
    const expired = mapAll(connected).map((c) => ({ ...c, validUntil: '2026-01-01T00:00:00Z' }));
    h.bank.requests = [];
    const { report } = await runSync({ host: h.host, config, connections: expired, now: new Date('2026-11-20T10:00:00') });
    expect(report.accounts.every((a) => a.status === 'reconnect')).toBe(true);
    expect(h.bank.requests).toHaveLength(0);
  });

  it('does not advance the sync window when Wealthfolio rejects the import', async () => {
    const { connections: connected } = await connect(h.host);
    h.activities.failImport = true;
    const { report, connections } = await runSync({ host: h.host, config, connections: mapAll(connected), now: new Date('2026-11-20T10:00:00') });
    expect(report.importError).toMatch(/boom/);
    expect(report.accounts.every((a) => a.status === 'error')).toBe(true);
    expect(connections[0].accounts.every((a) => !a.lastSyncedDate)).toBe(true);
  });

  it('sends rows Wealthfolio can read: cash movements carry an empty symbol', async () => {
    const { connections: connected } = await connect(h.host);
    await runSync({ host: h.host, config, connections: mapAll(connected), now: new Date('2026-11-20T10:00:00') });
    expect(h.activities.stored.length).toBeGreaterThan(0);
    expect(h.activities.stored.every((r) => r.symbol === '')).toBe(true);
  });

  it('reports a rejected validation call instead of failing the whole sync', async () => {
    const { connections: connected } = await connect(h.host);
    h.activities.failCheckCall = true;
    const { report, connections } = await runSync({ host: h.host, config, connections: mapAll(connected), now: new Date('2026-11-20T10:00:00') });
    expect(report.importError).toBe('Wealthfolio no pudo validar los movimientos: No se pudo completar la operación. [internal]');
    expect(report.accounts.map((a) => a.status)).toEqual(['error', 'error']);
    expect(report.imported).toBe(0);
    // Nothing advances, so the next sync reads the same movements again…
    expect(connections[0].accounts.every((a) => !a.lastSyncedDate)).toBe(true);
    // …but what was read from the bank is kept.
    expect(connections[0].accounts[0].bankBalance?.amount).toBe('1480.00');
  });

  it('reports a clear error when the private key does not match the application', async () => {
    const other = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey;
    h.secrets.set(PRIVATE_KEY_SECRET, other.export({ type: 'pkcs8', format: 'pem' }).toString());
    await expect(new EnableBankingClient(h.host, APP_ID).getApplication()).rejects.toThrow(/Invalid JWT.*clave privada/s);
  });
});

describe('movements are never lost', () => {
  it('re-reads a movement Wealthfolio rejected until it is imported, even weeks later', async () => {
    h.bank.transactions.checking = [
      book({ entry_reference: 'OLD', booking_date: '2026-10-01', transaction_amount: { amount: '13.00', currency: 'EUR' } }),
      book({ entry_reference: 'NEW', booking_date: '2026-11-19' }),
    ];
    h.bank.transactions.savings = [];
    h.activities.rejectInCheck = (row) => row.amount === '13.00';
    const { connections: connected } = await connect(h.host);

    const first = await runSync({ host: h.host, config, connections: mapAll(connected), now: new Date('2026-11-20T10:00:00') });
    expect(first.report.invalid).toBe(1);
    expect(first.report.invalidRows[0]).toMatchObject({ date: '2026-10-01', errors: ['amount: rechazado'] });
    const checking = first.connections[0].accounts[0];
    expect(checking.lastSyncedDate).toBe('2026-11-20');
    expect(checking.retryFrom).toBe('2026-10-01');
    expect(first.report.accounts[0].notes?.join(' ')).toMatch(/rechazado.*volverán a intentar/);

    // A week of overlap would start on 2026-11-14 and lose it; the hold keeps it.
    h.bank.requests = [];
    h.activities.rejectInCheck = () => false;
    const second = await runSync({ host: h.host, config, connections: first.connections, now: new Date('2026-11-21T10:00:00') });
    expect(h.bank.transactionRequests('checking')[0].query.get('date_from')).toBe('2026-10-01');
    expect(second.report.imported).toBe(1);
    expect(second.connections[0].accounts[0].retryFrom).toBeUndefined();

    h.bank.requests = [];
    await runSync({ host: h.host, config, connections: second.connections, now: new Date('2026-11-22T10:00:00') });
    expect(h.bank.transactionRequests('checking')[0].query.get('date_from')).toBe('2026-11-14');
  });

  it('holds rows the import itself skipped as invalid', async () => {
    h.bank.transactions.checking = [book({ entry_reference: 'X', booking_date: '2026-10-05' })];
    h.bank.transactions.savings = [];
    h.activities.rejectInImport = () => true;
    const { connections: connected } = await connect(h.host);
    const { report, connections } = await runSync({ host: h.host, config, connections: mapAll(connected), now: new Date('2026-11-20T10:00:00') });
    expect(report.imported).toBe(0);
    expect(report.invalid).toBe(1);
    expect(report.invalidRows[0].errors).toEqual(['date: fuera de rango']);
    expect(connections[0].accounts[0].retryFrom).toBe('2026-10-05');
  });

  it('keeps reading from a pending movement until the bank books it, however late', async () => {
    h.bank.transactions.checking = [
      book({ entry_reference: 'P', status: 'PDNG', booking_date: null, transaction_date: '2026-10-20', transaction_amount: { amount: '42.00', currency: 'EUR' } }),
    ];
    h.bank.transactions.savings = [];
    const { connections: connected } = await connect(h.host);
    const first = await runSync({ host: h.host, config, connections: mapAll(connected), now: new Date('2026-11-20T10:00:00') });
    expect(first.report.imported).toBe(0);
    expect(first.connections[0].accounts[0].retryFrom).toBe('2026-10-20');

    // Booked a month later than it happened.
    h.bank.transactions.checking = [
      book({ entry_reference: 'P', booking_date: '2026-11-21', transaction_date: '2026-10-20', transaction_amount: { amount: '42.00', currency: 'EUR' } }),
    ];
    h.bank.requests = [];
    const second = await runSync({ host: h.host, config, connections: first.connections, now: new Date('2026-11-29T10:00:00') });
    expect(h.bank.transactionRequests('checking')[0].query.get('date_from')).toBe('2026-10-20');
    expect(second.report.imported).toBe(1);
    expect(second.connections[0].accounts[0].retryFrom).toBeUndefined();
  });

  it('stops retrying movements older than the history banks give, with a warning', async () => {
    h.bank.transactions.checking = [book({ entry_reference: 'ANCIENT', booking_date: '2026-06-01' })];
    h.bank.transactions.savings = [];
    h.activities.rejectInCheck = () => true;
    const { connections: connected } = await connect(h.host, [], '2026-05-01');
    const { report, connections } = await runSync({ host: h.host, config, connections: mapAll(connected), now: new Date('2026-11-20T10:00:00') });
    expect(connections[0].accounts[0].retryFrom).toBe('2026-08-23'); // today - 89 days
    expect(report.accounts[0].notes?.join(' ')).toMatch(/01\/06\/2026.*ya no se volverán a consultar/);
  });
});

describe('first sync needs a start date chosen by the user', () => {
  it('does not sync an account until its start date is chosen, without calling the bank', async () => {
    const { connections: connected } = await connect(h.host);
    const mapped = mapAll(connected);
    mapped[0].accounts[0].syncFromConfirmed = false; // checking: date not chosen yet
    h.bank.requests = [];
    const { report, connections } = await runSync({ host: h.host, config, connections: mapped, now: new Date('2026-11-20T10:00:00') });

    expect(report.accounts[0]).toMatchObject({ account: 'Cuenta Nómina', status: 'blocked' });
    expect(report.accounts[0].message).toMatch(/Elige.*desde qué fecha.*CSV/);
    expect(h.bank.transactionRequests('checking')).toHaveLength(0);
    expect(connections[0].accounts[0].lastSyncedDate).toBeUndefined();
    // The other account is unaffected.
    expect(report.accounts[1].status).toBe('ok');
  });

  it('does not sync with an impossible start date (e.g. year 0026 from a typing slip) or a future one', async () => {
    const { connections: connected } = await connect(h.host);
    const mapped = mapAll(connected);
    mapped[0].accounts[0].syncFrom = '0026-01-01';
    mapped[0].accounts[1].syncFrom = '2026-12-01';
    h.bank.requests = [];
    const { report } = await runSync({ host: h.host, config, connections: mapped, now: new Date('2026-11-20T10:00:00') });
    expect(report.accounts.map((a) => a.status)).toEqual(['blocked', 'blocked']);
    expect(report.accounts[0].message).toMatch(/01\/01\/0026.*no es válida/);
    expect(h.bank.transactionRequests()).toHaveLength(0);
  });

  it('keeps syncing accounts that already synced, even without the flag (earlier versions)', async () => {
    const { connections: connected } = await connect(h.host);
    const mapped = mapAll(connected, { confirmDate: false }).map((c) => ({
      ...c,
      accounts: c.accounts.map((a) => ({ ...a, lastSyncedDate: '2026-11-15' })),
    }));
    const { report } = await runSync({ host: h.host, config, connections: mapped, now: new Date('2026-11-20T10:00:00') });
    expect(report.accounts.map((a) => a.status)).toEqual(['ok', 'ok']);
  });

  it('never reads existing Wealthfolio movements (only checkImport and import)', async () => {
    // The harness host has no activities.search: calling it would throw.
    const { connections: connected } = await connect(h.host);
    const { report } = await runSync({ host: h.host, config, connections: mapAll(connected), now: new Date('2026-11-20T10:00:00') });
    expect(report.accounts.map((a) => a.status)).toEqual(['ok', 'ok']);
  });

  it('does not duplicate its own movements after a reinstall (matched by ID)', async () => {
    const { connections: connected } = await connect(h.host);
    const first = await runSync({ host: h.host, config, connections: mapAll(connected), now: new Date('2026-11-20T10:00:00') });
    expect(first.report.imported).toBe(5);
    // Mappings lost (e.g. add-on reinstalled) and the same start date chosen again.
    const { connections: again } = await connect(h.host);
    const second = await runSync({ host: h.host, config, connections: mapAll(again), now: new Date('2026-11-21T10:00:00') });
    expect(second.report.imported).toBe(0);
    expect(second.report.duplicates).toBe(5);
  });
});

describe('how much history the bank gives', () => {
  beforeEach(() => {
    h.bank.transactions.checking = [
      book({ entry_reference: 'TOO-OLD', booking_date: '2026-08-20' }),
      book({ entry_reference: 'OLDEST', booking_date: '2026-08-26' }),
      book({ entry_reference: 'RECENT', booking_date: '2026-10-01' }),
    ];
    h.bank.transactions.savings = [];
    h.bank.historyFrom = { checking: '2026-08-25', savings: '2026-08-25' };
  });

  it('first sync gets what the bank keeps instead of nothing, and says from when', async () => {
    const { connections: connected } = await connect(h.host); // syncFrom 2026-08-01
    const { report, connections } = await runSync({ host: h.host, config, connections: mapAll(connected), now: new Date('2026-11-20T10:00:00') });

    expect(report.accounts[0]).toMatchObject({ status: 'ok', fetched: 2, imported: 2 });
    expect(report.accounts[0].notes?.join(' ')).toMatch(/movimientos desde el 26\/08\/2026 \(pediste desde el 01\/08\/2026\)/);
    expect(connections[0].accounts[0].history).toMatchObject({ requestedFrom: '2026-08-01', earliest: '2026-08-26' });
    expect(connections[0].accounts[0].lastSyncedDate).toBe('2026-11-20');
  });

  it('with the exact range the same bank would have answered nothing (why longest is used)', async () => {
    const client = new EnableBankingClient(h.host, APP_ID);
    expect(await client.getAllTransactions('checking-1', '2026-08-01', '2026-11-20')).toEqual([]);
    expect(await client.getAllTransactions('checking-1', '2026-08-01', '2026-11-20', { strategy: 'longest' })).toHaveLength(2);
  });

  it('does not mark an account as synced when the bank returns nothing at all', async () => {
    h.bank.transactions.checking = [];
    const { connections: connected } = await connect(h.host);
    const { report, connections } = await runSync({ host: h.host, config, connections: mapAll(connected), now: new Date('2026-11-20T10:00:00') });

    expect(report.accounts[0].status).toBe('blocked');
    expect(report.accounts[0].message).toMatch(/no ha devuelto ningún movimiento desde el 01\/08\/2026.*no se da por sincronizada/i);
    expect(connections[0].accounts[0].lastSyncedDate).toBeUndefined();
    expect(connections[0].accounts[0].history).toMatchObject({ requestedFrom: '2026-08-01', earliest: undefined });
    // The next sync tries the same range again.
    h.bank.requests = [];
    await runSync({ host: h.host, config, connections, now: new Date('2026-11-21T10:00:00') });
    expect(h.bank.transactionRequests('checking')[0].query.get('date_from')).toBe('2026-08-01');
  });

  it('after months without syncing, asks for the longest history again', async () => {
    const { connections: connected } = await connect(h.host);
    const stale = mapAll(connected).map((c) => ({
      ...c,
      accounts: c.accounts.map((a) => ({ ...a, lastSyncedDate: '2026-07-01' })),
    }));
    h.bank.requests = [];
    const { report } = await runSync({ host: h.host, config, connections: stale, now: new Date('2026-11-20T10:00:00') });
    const query = h.bank.transactionRequests('checking')[0].query;
    expect(query.get('strategy')).toBe('longest');
    expect(query.get('date_from')).toBe('2026-08-01'); // never before the chosen start
    expect(report.accounts[0].imported).toBe(2);
  });
});

describe('when Wealthfolio does not let requests out', () => {
  it('explains how to approve the host instead of a generic error', async () => {
    h.bank.blocked = true;
    const error = await new EnableBankingClient(h.host, APP_ID).getApplication().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(NetworkBlockedError);
    const message = (error as Error).message;
    expect(message).toMatch(/Ajustes → Complementos/);
    expect(message).toMatch(/marca api\.enablebanking\.com en «Hosts de red»/);
    expect(message).toMatch(/\(Detalle: No se pudo completar la operación\. \[internal\]\)$/);
  });

  it('reports it once and does not keep asking for the other accounts', async () => {
    const { connections: connected } = await connect(h.host);
    h.bank.blocked = true;
    const { report, connections } = await runSync({ host: h.host, config, connections: mapAll(connected), now: new Date('2026-11-20T10:00:00') });
    expect(report.accounts.map((a) => a.status)).toEqual(['error', 'error']);
    expect(report.accounts[0].message).toMatch(/Hosts de red/);
    expect(report.accounts[1].message).toMatch(/^No se ha consultado/);
    expect(h.bank.blockedAttempts).toBe(1);
    expect(connections[0].accounts.every((a) => !a.lastSyncedDate)).toBe(true);
  });

  it('does not mistake an error answered by Enable Banking for a blocked request', async () => {
    h.bank.balances.checking = 'error'; // HTTP 500 from the API
    const { connections: connected } = await connect(h.host);
    const { report } = await runSync({ host: h.host, config, connections: mapAll(connected), now: new Date('2026-11-20T10:00:00') });
    expect(report.accounts[0].notes?.join(' ')).toMatch(/ASPSP error/);
    expect(report.accounts[0].notes?.join(' ')).not.toMatch(/Hosts de red/);
  });
});

describe('renewing the bank consent', () => {
  it('keeps held-back movements, the chosen start date and the balance', async () => {
    h.bank.transactions.checking = [
      book({ entry_reference: 'P', status: 'PDNG', booking_date: null, transaction_date: '2026-10-20' }),
    ];
    const { connections: connected } = await connect(h.host);
    const synced = await runSync({ host: h.host, config, connections: mapAll(connected), now: new Date('2026-11-20T10:00:00') });
    const before = synced.connections[0].accounts[0];
    expect(before.retryFrom).toBe('2026-10-20');

    const { connections: renewed } = await connect(h.host, synced.connections);
    const after = renewed[0].accounts[0];
    expect(after.uid).toBe('checking-2');
    expect(after).toMatchObject({
      retryFrom: '2026-10-20',
      syncFromConfirmed: true,
      bankBalance: before.bankBalance,
      lastSyncedDate: '2026-11-20',
    });
  });
});

describe('own transfers without IBAN', () => {
  it('pairs a card repayment between two synced accounts as an internal transfer', async () => {
    h.accountTypes['wf-savings'] = 'CREDIT_CARD';
    h.bank.transactions.checking = [
      book({ entry_reference: 'LIQ', booking_date: '2026-11-03', remittance_information: ['LIQUIDACION TARJETA 4B'], transaction_amount: { amount: '321.45', currency: 'EUR' } }),
      book({ entry_reference: 'SHOP', booking_date: '2026-11-04', creditor: { name: 'ZARA' }, transaction_amount: { amount: '59.90', currency: 'EUR' } }),
    ];
    h.bank.transactions.savings = [
      book({ entry_reference: 'PAY', credit_debit_indicator: 'CRDT', booking_date: '2026-11-05', remittance_information: ['PAGO RECIBIDO'], transaction_amount: { amount: '321.45', currency: 'EUR' } }),
      book({ entry_reference: 'REFUND', credit_debit_indicator: 'CRDT', booking_date: '2026-11-06', remittance_information: ['DEVOLUCION ZARA'], transaction_amount: { amount: '19.99', currency: 'EUR' } }),
    ];
    const { connections: connected } = await connect(h.host);
    const { report } = await runSync({ host: h.host, config, connections: mapAll(connected), now: new Date('2026-11-20T10:00:00') });

    expect(report.ownTransfers).toBe(1);
    const byRef = Object.fromEntries(h.activities.stored.map((r) => [String(r.sourceRecordId).split('|')[0], r]));
    expect(byRef['ref:LIQ']).toMatchObject({ activityType: 'TRANSFER_OUT', isExternal: false });
    expect(byRef['ref:PAY']).toMatchObject({ activityType: 'TRANSFER_IN', isExternal: false });
    expect(byRef['ref:SHOP'].activityType).toBe('WITHDRAWAL');
    expect(byRef['ref:REFUND'].activityType).toBe('DEPOSIT');
  });

  it('can be turned off', async () => {
    h.accountTypes['wf-savings'] = 'CREDIT_CARD';
    h.bank.transactions.checking = [book({ entry_reference: 'LIQ', transaction_amount: { amount: '321.45', currency: 'EUR' } })];
    h.bank.transactions.savings = [
      book({ entry_reference: 'PAY', credit_debit_indicator: 'CRDT', transaction_amount: { amount: '321.45', currency: 'EUR' } }),
    ];
    const { connections: connected } = await connect(h.host);
    const { report } = await runSync({ host: h.host, config, connections: mapAll(connected), detectOwnTransfers: false, now: new Date('2026-11-20T10:00:00') });
    expect(report.ownTransfers).toBe(0);
    expect(h.activities.stored.map((r) => r.activityType)).toEqual(['WITHDRAWAL', 'DEPOSIT']);
  });
});

describe('bank balance', () => {
  it('stores the booked balance and reads it at most once a day', async () => {
    const { connections: connected } = await connect(h.host);
    const first = await runSync({ host: h.host, config, connections: mapAll(connected), now: new Date('2026-11-20T10:00:00') });
    expect(first.connections[0].accounts[0].bankBalance).toMatchObject({ amount: '1480.00', type: 'ITBD', referenceDate: '2026-11-20' });
    expect(first.connections[0].accounts[1].bankBalance).toMatchObject({ amount: '501.23', type: 'CLBD' });

    h.bank.requests = [];
    await runSync({ host: h.host, config, connections: first.connections, now: new Date('2026-11-20T18:00:00') });
    expect(h.bank.requests.filter((r) => r.path.endsWith('/balances'))).toHaveLength(0);

    await runSync({ host: h.host, config, connections: first.connections, now: new Date('2026-11-21T08:00:00') });
    expect(h.bank.requests.filter((r) => r.path.endsWith('/balances'))).toHaveLength(2);
  });

  it('does not fail the sync when the bank cannot give the balance', async () => {
    h.bank.balances.checking = 'error';
    const { connections: connected } = await connect(h.host);
    const { report, connections } = await runSync({ host: h.host, config, connections: mapAll(connected), now: new Date('2026-11-20T10:00:00') });
    expect(report.accounts[0].status).toBe('ok');
    expect(report.accounts[0].imported).toBe(3);
    expect(report.accounts[0].notes?.join(' ')).toMatch(/No se pudo leer el saldo/);
    expect(connections[0].accounts[0].bankBalance).toBeUndefined();
  });
});
