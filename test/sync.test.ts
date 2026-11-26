import { generateKeyPairSync } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import { EnableBankingClient, NetworkBlockedError, PRIVATE_KEY_SECRET } from '../src/lib/enable-banking-client';
import { mapTransactions } from '../src/lib/mapping';
import { NAME_WAIT_DAYS, runSync } from '../src/lib/sync';
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
import { errorEs, textEs } from './i18n';

let h: Harness;

beforeEach(() => {
  h = createHarness();
});

describe('end-to-end sync against a fake Enable Banking API', () => {
  it('labels each report row with its Wealthfolio account and masked IBAN', async () => {
    const { connections: connected } = await connect(h.host);
    const progress: string[] = [];
    const { report } = await runSync({
      host: h.host,
      config,
      connections: mapAll(connected),
      now: new Date('2026-11-20T10:00:00'),
      onProgress: (text) => progress.push(textEs(text)),
    });
    expect(report.accounts.map((a) => [a.key, a.wealthfolioAccount, a.iban, a.account])).toEqual([
      ['hash-checking', 'wf-checking', 'ES91 •••• 1332', 'Cuenta Nómina'],
      ['hash-savings', 'wf-savings', 'ES79 •••• 6789', 'Cuenta Ahorro'],
    ]);
    expect(progress.some((p) => p.includes('Banco Test · wf-checking'))).toBe(true);
    // The full IBAN never goes into the stored report.
    expect(JSON.stringify(report)).not.toContain(IBAN_CHECKING);
  });

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
    expect(first.report.accounts[0].notes?.map(textEs).join(' ')).toMatch(/pendiente/);
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
    // The interest (2026-11-10) came without a payer's name: it waits for it, so its
    // date is read again instead of only a week back.
    expect(h.bank.transactionRequests('savings')[0].query.get('date_from')).toBe('2026-11-10');
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
    expect(textEs(report.importError)).toMatch(/boom/);
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
    expect(textEs(report.importError)).toBe('Wealthfolio no pudo validar los movimientos: No se pudo completar la operación. [internal]');
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
    const error = await new EnableBankingClient(h.host, APP_ID).getApplication().catch((e: unknown) => e);
    expect(errorEs(error)).toMatch(/Invalid JWT.*clave privada/s);
  });
});

describe('movements are never lost', () => {
  it('re-reads a movement Wealthfolio rejected until it is imported, even weeks later', async () => {
    // With names, so none waits for one (that would also hold the window).
    h.bank.transactions.checking = [
      book({ entry_reference: 'OLD', booking_date: '2026-10-01', creditor: { name: 'SHOP' }, transaction_amount: { amount: '13.00', currency: 'EUR' } }),
      book({ entry_reference: 'NEW', booking_date: '2026-11-19', creditor: { name: 'SHOP' } }),
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
    expect(first.report.accounts[0].notes?.map(textEs).join(' ')).toMatch(/rechazado.*volverán a intentar/);

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
      book({ entry_reference: 'P', booking_date: '2026-11-21', transaction_date: '2026-10-20', creditor: { name: 'SHOP' }, transaction_amount: { amount: '42.00', currency: 'EUR' } }),
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
    expect(report.accounts[0].notes?.map(textEs).join(' ')).toMatch(/01\/06\/2026.*ya no se volverán a consultar/);
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
    expect(textEs(report.accounts[0].message)).toMatch(/Elige.*desde qué fecha.*CSV/);
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
    expect(textEs(report.accounts[0].message)).toMatch(/01\/01\/0026.*no es válida/);
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

  it('never reads existing Wealthfolio movements (only checkImport, import and update)', async () => {
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
    expect(report.accounts[0].notes?.map(textEs).join(' ')).toMatch(/movimientos desde el 26\/08\/2026 \(pediste desde el 01\/08\/2026\)/);
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
    expect(textEs(report.accounts[0].message)).toMatch(/no ha devuelto ningún movimiento desde el 01\/08\/2026.*no se da por sincronizada/i);
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
    const message = errorEs(error);
    expect(message).toMatch(/Ajustes → Complementos/);
    expect(message).toMatch(/marca api\.enablebanking\.com en «Hosts de red»/);
    expect(message).toMatch(/\(Detalle: No se pudo completar la operación\. \[internal\]\)$/);
  });

  it('reports it once and does not keep asking for the other accounts', async () => {
    const { connections: connected } = await connect(h.host);
    h.bank.blocked = true;
    const { report, connections } = await runSync({ host: h.host, config, connections: mapAll(connected), now: new Date('2026-11-20T10:00:00') });
    expect(report.accounts.map((a) => a.status)).toEqual(['error', 'error']);
    expect(textEs(report.accounts[0].message)).toMatch(/Hosts de red/);
    expect(textEs(report.accounts[1].message)).toMatch(/^No se ha consultado/);
    expect(h.bank.blockedAttempts).toBe(1);
    expect(connections[0].accounts.every((a) => !a.lastSyncedDate)).toBe(true);
  });

  it('does not mistake an error answered by Enable Banking for a blocked request', async () => {
    h.bank.balances.checking = 'error'; // HTTP 500 from the API
    const { connections: connected } = await connect(h.host);
    const { report } = await runSync({ host: h.host, config, connections: mapAll(connected), now: new Date('2026-11-20T10:00:00') });
    expect(report.accounts[0].notes?.map(textEs).join(' ')).toMatch(/ASPSP error/);
    expect(report.accounts[0].notes?.map(textEs).join(' ')).not.toMatch(/Hosts de red/);
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
    expect(report.accounts[0].notes?.map(textEs).join(' ')).toMatch(/No se pudo leer el saldo/);
    expect(connections[0].accounts[0].bankBalance).toBeUndefined();
  });
});

describe('card payments the bank names later', () => {
  const cardPayment = (overrides: Parameters<typeof book>[0] = {}) =>
    book({
      entry_reference: 'CARD',
      booking_date: '2026-11-19',
      remittance_information: ['PAGO CON TARJETA EN SUPERMERCADOS'],
      transaction_amount: { amount: '23.45', currency: 'EUR' },
      ...overrides,
    });
  const notes = (r: { notes?: unknown[] }) => (r.notes ?? []).map((n) => textEs(n as Parameters<typeof textEs>[0])).join(' ');
  const CONCEPT = 'PAGO CON TARJETA EN SUPERMERCADOS';
  const NAMED = 'MERCADONA · PAGO CON TARJETA EN SUPERMERCADOS';

  beforeEach(() => {
    h.bank.transactions.savings = [];
  });

  it("imports it at once with the bank's description and puts the shop's name in front when it arrives", async () => {
    h.bank.transactions.checking = [cardPayment()];
    const { connections: connected } = await connect(h.host);
    const first = await runSync({ host: h.host, config, connections: mapAll(connected), now: new Date('2026-11-20T10:00:00') });
    expect(first.report.accounts[0]).toMatchObject({ imported: 1, notesWaiting: 1 });
    expect(h.activities.stored.map((r) => r.comment)).toEqual([CONCEPT]);
    expect(notes(first.report.accounts[0])).toMatch(
      /1 movimiento\(s\) todavía sin el nombre del comercio, ordenante o beneficiario.*14 días/,
    );
    expect(first.connections[0].accounts[0]).toMatchObject({
      retryFrom: '2026-11-19',
      pendingNotes: {
        'ref:CARD|2026-11-19|-23.45': { date: '2026-11-19', activityType: 'WITHDRAWAL', currency: 'EUR', amount: '23.45' },
      },
    });

    // Renewing the consent keeps the list.
    const { connections: renewed } = await connect(h.host, first.connections);
    expect(renewed[0].accounts[0].pendingNotes).toEqual(first.connections[0].accounts[0].pendingNotes);

    // Still no name: nothing changes.
    const second = await runSync({ host: h.host, config, connections: renewed, now: new Date('2026-11-21T10:00:00') });
    expect(h.activities.updates).toHaveLength(0);
    expect(second.report.accounts[0]).toMatchObject({ imported: 0, duplicates: 1, notesWaiting: 1 });

    h.bank.transactions.checking = [cardPayment({ creditor: { name: 'MERCADONA' } })];
    const third = await runSync({ host: h.host, config, connections: second.connections, now: new Date('2026-11-23T10:00:00') });
    expect(h.activities.updates).toEqual([
      {
        id: 'act-1',
        accountId: 'wf-checking',
        activityType: 'WITHDRAWAL',
        activityDate: '2026-11-19T00:00:00+00:00',
        currency: 'EUR',
        comment: NAMED,
      },
    ]);
    expect(h.activities.stored.map((r) => r.comment)).toEqual([NAMED]);
    expect(third.report.accounts[0]).toMatchObject({ imported: 0, notesWritten: 1, notesWaiting: 0 });
    expect(notes(third.report.accounts[0])).toMatch(/1 nota\(s\) actualizada\(s\) con el nombre delante/);
    expect(third.connections[0].accounts[0].pendingNotes).toBeUndefined();
    expect(third.connections[0].accounts[0].retryFrom).toBeUndefined();

    // Updated once: later syncs leave it alone.
    await runSync({ host: h.host, config, connections: third.connections, now: new Date('2026-11-24T10:00:00') });
    expect(h.activities.updates).toHaveLength(1);
  });

  it(`leaves the bank's description after ${NAME_WAIT_DAYS} days without the name, and says so`, async () => {
    h.bank.transactions.checking = [cardPayment({ booking_date: '2026-11-01' })];
    const { connections: connected } = await connect(h.host);
    const day13 = await runSync({ host: h.host, config, connections: mapAll(connected), now: new Date('2026-11-14T10:00:00') });
    expect(day13.report.accounts[0]).toMatchObject({ imported: 1, notesWaiting: 1 });

    const day14 = await runSync({ host: h.host, config, connections: day13.connections, now: new Date('2026-11-15T10:00:00') });
    expect(h.bank.transactionRequests('checking').at(-1)?.query.get('date_from')).toBe('2026-11-01');
    expect(h.activities.updates).toHaveLength(0);
    expect(h.activities.stored.map((r) => r.comment)).toEqual([CONCEPT]);
    expect(day14.report.accounts[0]).toMatchObject({ notesWithoutName: 1, notesWaiting: 0 });
    expect(notes(day14.report.accounts[0])).toMatch(
      /1 movimiento\(s\) se queda\(n\) sin el nombre del comercio, ordenante o beneficiario, porque el banco no lo ha mandado en 14 días: 01\/11\/2026 23\.45 EUR\./,
    );
    expect(day14.connections[0].accounts[0].pendingNotes).toBeUndefined();

    // A name arriving later changes nothing.
    h.bank.transactions.checking = [cardPayment({ booking_date: '2026-11-01', creditor: { name: 'MERCADONA' } })];
    await runSync({ host: h.host, config, connections: day14.connections, now: new Date('2026-11-16T10:00:00') });
    expect(h.activities.updates).toHaveLength(0);
  });

  it(`does not follow payments older than ${NAME_WAIT_DAYS} days`, async () => {
    h.bank.transactions.checking = [cardPayment({ booking_date: '2026-10-01' })];
    const { connections: connected } = await connect(h.host);
    const { report, connections } = await runSync({ host: h.host, config, connections: mapAll(connected), now: new Date('2026-11-20T10:00:00') });
    expect(h.activities.stored.map((r) => r.comment)).toEqual([CONCEPT]);
    expect(report.accounts[0]).toMatchObject({ imported: 1, notesWaiting: 0 });
    expect(connections[0].accounts[0].pendingNotes).toBeUndefined();
  });

  it('updates the activity Wealthfolio names when validating, not the id the import returns', async () => {
    h.bank.transactions.checking = [cardPayment()];
    const { connections: connected } = await connect(h.host);
    const first = await runSync({ host: h.host, config, connections: mapAll(connected), now: new Date('2026-11-20T10:00:00') });
    expect(first.connections[0].accounts[0].pendingNotes?.['ref:CARD|2026-11-19|-23.45']).not.toHaveProperty('activityId');

    h.bank.transactions.checking = [cardPayment({ creditor: { name: 'MERCADONA' } })];
    await runSync({ host: h.host, config, connections: first.connections, now: new Date('2026-11-21T10:00:00') });
    expect(h.activities.updates.map((u) => [u.id, u.comment])).toEqual([['act-1', NAMED]]);
  });

  it('drops the wrong activity id a list saved by 1.7.0 carries', async () => {
    h.bank.transactions.checking = [cardPayment()];
    const { connections: connected } = await connect(h.host);
    const first = await runSync({ host: h.host, config, connections: mapAll(connected), now: new Date('2026-11-20T10:00:00') });
    const saved = first.connections.map((c) => ({
      ...c,
      accounts: c.accounts.map((a) => ({
        ...a,
        pendingNotes: a.pendingNotes && {
          'ref:CARD|2026-11-19|-23.45': { ...a.pendingNotes['ref:CARD|2026-11-19|-23.45'], activityId: 'import-1' },
        },
      })),
    }));

    // Still no name: the list is saved again without the id.
    const second = await runSync({ host: h.host, config, connections: saved, now: new Date('2026-11-21T10:00:00') });
    expect(second.connections[0].accounts[0].pendingNotes?.['ref:CARD|2026-11-19|-23.45']).not.toHaveProperty('activityId');

    h.bank.transactions.checking = [cardPayment({ creditor: { name: 'MERCADONA' } })];
    const third = await runSync({ host: h.host, config, connections: saved, now: new Date('2026-11-21T10:00:00') });
    expect(h.activities.updates.map((u) => u.id)).toEqual(['act-1']);
    expect(third.report.accounts[0]).toMatchObject({ notesWritten: 1, notesWaiting: 0 });
  });

  it('retries when Wealthfolio refuses the change, says so and gives up after 30 days', async () => {
    h.bank.transactions.checking = [cardPayment({ booking_date: '2026-11-10' })];
    const { connections: connected } = await connect(h.host);
    const first = await runSync({ host: h.host, config, connections: mapAll(connected), now: new Date('2026-11-12T10:00:00') });

    h.activities.failUpdate = true;
    h.bank.transactions.checking = [cardPayment({ booking_date: '2026-11-10', creditor: { name: 'MERCADONA' } })];
    const refused = await runSync({ host: h.host, config, connections: first.connections, now: new Date('2026-11-13T10:00:00') });
    expect(refused.report.accounts[0]).toMatchObject({ notesWritten: 0, notesWaiting: 1 });
    expect(notes(refused.report.accounts[0])).toMatch(/No se pudo escribir la nota del movimiento del 10\/11\/2026 \(23\.45 EUR\).*Se volverá a intentar/);

    const late = await runSync({ host: h.host, config, connections: refused.connections, now: new Date('2026-12-10T10:00:00') });
    expect(late.report.accounts[0]).toMatchObject({ notesWaiting: 0 });
    expect(notes(late.report.accounts[0])).toMatch(/se deja de intentar: 10\/11\/2026 23\.45 EUR/);
    expect(late.connections[0].accounts[0].pendingNotes).toBeUndefined();
  });

  it('a new Wealthfolio account starts without pending notes', async () => {
    h.bank.transactions.checking = [cardPayment()];
    const { connections: connected } = await connect(h.host);
    const first = await runSync({ host: h.host, config, connections: mapAll(connected), now: new Date('2026-11-20T10:00:00') });
    h.accountTypes['wf-other'] = 'CASH';
    const moved = first.connections.map((c) => ({
      ...c,
      accounts: c.accounts.map((a) => ({ ...a, wealthfolioAccountId: 'wf-other', lastSyncedDate: undefined, syncFrom: '2026-11-15' })),
    }));
    h.bank.transactions.checking = [cardPayment({ creditor: { name: 'MERCADONA' } })];
    const second = await runSync({ host: h.host, config, connections: moved, now: new Date('2026-11-21T10:00:00') });
    expect(h.activities.updates).toHaveLength(0);
    expect(second.connections[0].accounts[0].pendingNotes).toBeUndefined();
    expect(h.activities.stored.filter((r) => r.accountId === 'wf-other').map((r) => r.comment)).toEqual([NAMED]);
  });

  it('does not follow named movements nor transfers between your accounts (round-ups)', async () => {
    const roundUp = { booking_date: '2026-11-19', transaction_amount: { amount: '0.55', currency: 'EUR' } };
    h.bank.transactions.checking = [
      cardPayment({ entry_reference: 'NAMED', creditor: { name: 'MERCADONA' } }),
      book({ entry_reference: 'RND', remittance_information: ['TRASPASO PROGRAMA TU CUENTA // TRASPASO A CUENTA'], ...roundUp }),
    ];
    h.bank.transactions.savings = [
      book({ entry_reference: 'RNDIN', credit_debit_indicator: 'CRDT', remittance_information: ['TRASPASO PROGRAMA TU CUENTA // TRASPASO DESDE CUENTA'], ...roundUp }),
    ];
    const { connections: connected } = await connect(h.host);
    const { report, connections } = await runSync({ host: h.host, config, connections: mapAll(connected), now: new Date('2026-11-20T10:00:00') });
    expect(report.ownTransfers).toBe(1);
    expect(report.accounts.map((a) => a.notesWaiting)).toEqual([0, 0]);
    expect(h.activities.stored.map((r) => r.comment)).toEqual([
      NAMED,
      'TRASPASO PROGRAMA TU CUENTA // TRASPASO A CUENTA',
      'TRASPASO PROGRAMA TU CUENTA // TRASPASO DESDE CUENTA',
    ]);
    expect(connections[0].accounts.map((a) => a.pendingNotes)).toEqual([undefined, undefined]);
  });
});

describe('other movements the bank names later (payroll)', () => {
  const PAYROLL = 'ABONO DE NOMINA POR TRANSFERENCIA // INGRESO POR NÓMINA O PENSIÓN';
  const payroll = (overrides: Parameters<typeof book>[0] = {}) =>
    book({
      entry_reference: 'PAY',
      credit_debit_indicator: 'CRDT',
      booking_date: '2026-11-26',
      remittance_information: [`${PAYROLL} // ACME SEGUROS SOCIEDA`],
      transaction_amount: { amount: '1866.00', currency: 'EUR' },
      ...overrides,
    });
  const named = () =>
    payroll({ debtor: { name: 'ACME SEGUROS SA' }, remittance_information: [`${PAYROLL} // TRF ACME SEGUROS, S.A.`] });
  const notes = (r: { notes?: unknown[] }) => (r.notes ?? []).map((n) => textEs(n as Parameters<typeof textEs>[0])).join(' ');

  beforeEach(() => {
    h.bank.transactions.savings = [];
  });

  it("imports it at once and rewrites the note with what the bank sends when the payer's name arrives", async () => {
    h.bank.transactions.checking = [payroll()];
    const { connections: connected } = await connect(h.host);
    const first = await runSync({ host: h.host, config, connections: mapAll(connected), now: new Date('2026-11-26T17:00:00') });
    expect(first.report.accounts[0]).toMatchObject({ imported: 1, notesWaiting: 1 });
    expect(first.connections[0].accounts[0].pendingNotes).toEqual({
      'ref:PAY|2026-11-26|1866.00': { date: '2026-11-26', activityType: 'DEPOSIT', currency: 'EUR', amount: '1866.00' },
    });

    // A list saved by 1.8.0 marked it as not a card payment: that mark goes.
    const saved = first.connections.map((c) => ({
      ...c,
      accounts: c.accounts.map((a) => ({
        ...a,
        pendingNotes: a.pendingNotes && {
          'ref:PAY|2026-11-26|1866.00': { ...a.pendingNotes['ref:PAY|2026-11-26|1866.00'], kind: 'other' as const },
        },
      })),
    }));
    const second = await runSync({ host: h.host, config, connections: saved, now: new Date('2026-11-27T10:00:00') });
    expect(second.connections[0].accounts[0].pendingNotes?.['ref:PAY|2026-11-26|1866.00']).not.toHaveProperty('kind');

    h.bank.transactions.checking = [named()];
    const third = await runSync({ host: h.host, config, connections: second.connections, now: new Date('2026-11-30T10:00:00') });
    expect(h.activities.updates).toEqual([
      {
        id: 'act-1',
        accountId: 'wf-checking',
        activityType: 'DEPOSIT',
        activityDate: '2026-11-26T00:00:00+00:00',
        currency: 'EUR',
        comment: `ACME SEGUROS SA · ${PAYROLL} // TRF ACME SEGUROS, S.A.`,
      },
    ]);
    expect(third.report.accounts[0]).toMatchObject({ notesWritten: 1, notesWaiting: 0 });
    expect(notes(third.report.accounts[0])).toMatch(/1 nota\(s\) actualizada\(s\) con el nombre delante/);
    expect(third.connections[0].accounts[0].pendingNotes).toBeUndefined();
  });

  it(`leaves it as it is after ${NAME_WAIT_DAYS} days without the name, and says so like a card payment`, async () => {
    h.bank.transactions.checking = [payroll({ booking_date: '2026-11-01' })];
    const { connections: connected } = await connect(h.host);
    const day13 = await runSync({ host: h.host, config, connections: mapAll(connected), now: new Date('2026-11-14T10:00:00') });
    expect(day13.report.accounts[0]).toMatchObject({ imported: 1, notesWaiting: 1 });

    const day14 = await runSync({ host: h.host, config, connections: day13.connections, now: new Date('2026-11-15T10:00:00') });
    expect(h.activities.updates).toHaveLength(0);
    expect(day14.report.accounts[0]).toMatchObject({ notesWithoutName: 1, notesWaiting: 0 });
    expect(notes(day14.report.accounts[0])).toMatch(
      /1 movimiento\(s\) se queda\(n\) sin el nombre del comercio, ordenante o beneficiario, porque el banco no lo ha mandado en 14 días: 01\/11\/2026 1866\.00 EUR\./,
    );
    expect(day14.connections[0].accounts[0].pendingNotes).toBeUndefined();
  });

  it('does not follow a transfer from another synced account (by IBAN)', async () => {
    h.bank.transactions.checking = [];
    h.bank.transactions.savings = [
      book({ entry_reference: 'S1', credit_debit_indicator: 'CRDT', booking_date: '2026-11-19', debtor_account: { iban: IBAN_CHECKING } }),
    ];
    const { connections: connected } = await connect(h.host);
    const { report, connections } = await runSync({ host: h.host, config, connections: mapAll(connected), now: new Date('2026-11-20T10:00:00') });
    expect(h.activities.stored.map((r) => r.activityType)).toEqual(['TRANSFER_IN']);
    expect(report.accounts[1]).toMatchObject({ imported: 1, notesWaiting: 0 });
    expect(connections[0].accounts[1].pendingNotes).toBeUndefined();
  });
});
