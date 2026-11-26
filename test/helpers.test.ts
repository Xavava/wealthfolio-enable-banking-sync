import { describe, expect, it } from 'vitest';
import { compareBalances, pickBalance, withOutdated } from '../src/lib/balance';
import { pendingDate } from '../src/lib/mapping';
import { daysBetween, formatIsoDate, isValidStartDate, toDateOnly } from '../src/lib/state';
import { syncStartDate } from '../src/lib/sync';
import { findOwnTransferPairs, type TransferCandidate } from '../src/lib/transfers';

const cards = new Map([
  ['card', 'CREDIT_CARD'],
  ['checking', 'CASH'],
  ['savings', 'CASH'],
  ['prepaid', 'CASH'],
]);

function tx(partial: Partial<TransferCandidate> & Pick<TransferCandidate, 'key' | 'accountId' | 'activityType'>): TransferCandidate {
  return { date: '2026-11-03', amount: '100.00', currency: 'EUR', ...partial };
}

describe('findOwnTransferPairs', () => {
  it('pairs a withdrawal and a deposit into a credit card account', () => {
    const pairs = findOwnTransferPairs(
      [
        tx({ key: 0, accountId: 'checking', activityType: 'WITHDRAWAL', comment: 'CARGO' }),
        tx({ key: 1, accountId: 'card', activityType: 'DEPOSIT', date: '2026-11-05', amount: '100' }),
      ],
      { accountTypes: cards },
    );
    expect(pairs).toEqual([[0, 1]]);
  });

  it('pairs cash accounts only when a description says it is internal', () => {
    const rows = (comment?: string) => [
      tx({ key: 0, accountId: 'checking', activityType: 'WITHDRAWAL', comment }),
      tx({ key: 1, accountId: 'prepaid', activityType: 'DEPOSIT' }),
    ];
    expect(findOwnTransferPairs(rows('RECARGA TARJETA PREPAGO'), { accountTypes: cards })).toEqual([[0, 1]]);
    expect(findOwnTransferPairs(rows('Traspaso a cuenta ahorro'), { accountTypes: cards })).toEqual([[0, 1]]);
    expect(findOwnTransferPairs(rows('Liquidación de tarjeta'), { accountTypes: cards })).toEqual([[0, 1]]);
    // An ordinary "transferencia" can just as well be a payment to someone else.
    expect(findOwnTransferPairs(rows('TRANSFERENCIA A JUAN'), { accountTypes: cards })).toEqual([]);
    expect(findOwnTransferPairs(rows(undefined), { accountTypes: cards })).toEqual([]);
  });

  it('requires different accounts, same currency and amount, and at most 3 days apart', () => {
    const base = tx({ key: 0, accountId: 'checking', activityType: 'WITHDRAWAL', comment: 'TRASPASO' });
    const ctx = { accountTypes: cards };
    expect(findOwnTransferPairs([base, tx({ key: 1, accountId: 'checking', activityType: 'DEPOSIT' })], ctx)).toEqual([]);
    expect(findOwnTransferPairs([base, tx({ key: 1, accountId: 'savings', activityType: 'DEPOSIT', currency: 'USD' })], ctx)).toEqual([]);
    expect(findOwnTransferPairs([base, tx({ key: 1, accountId: 'savings', activityType: 'DEPOSIT', amount: '100.01' })], ctx)).toEqual([]);
    expect(findOwnTransferPairs([base, tx({ key: 1, accountId: 'savings', activityType: 'DEPOSIT', date: '2026-11-07' })], ctx)).toEqual([]);
    expect(findOwnTransferPairs([base, tx({ key: 1, accountId: 'savings', activityType: 'DEPOSIT', date: '2026-11-06' })], ctx)).toEqual([[0, 1]]);
  });

  it('leaves ambiguous matches alone', () => {
    const pairs = findOwnTransferPairs(
      [
        tx({ key: 0, accountId: 'checking', activityType: 'WITHDRAWAL', comment: 'TRASPASO' }),
        tx({ key: 1, accountId: 'savings', activityType: 'DEPOSIT' }),
        tx({ key: 2, accountId: 'card', activityType: 'DEPOSIT' }),
      ],
      { accountTypes: cards },
    );
    expect(pairs).toEqual([]);
  });

  it('ignores rows that are already transfers or interest', () => {
    const pairs = findOwnTransferPairs(
      [
        tx({ key: 0, accountId: 'checking', activityType: 'TRANSFER_OUT', comment: 'TRASPASO' }),
        tx({ key: 1, accountId: 'card', activityType: 'INTEREST' }),
      ],
      { accountTypes: cards },
    );
    expect(pairs).toEqual([]);
  });
});

describe('balances', () => {
  const fetchedAt = '2026-11-20T09:00:00.000Z';

  it('prefers booked balances and keeps the sign and reference date', () => {
    const picked = pickBalance(
      [
        { balance_amount: { amount: '900.00', currency: 'EUR' }, balance_type: 'CLAV' },
        { balance_amount: { amount: '-12.50', currency: 'EUR' }, balance_type: 'CLBD', reference_date: '2026-11-19' },
      ],
      fetchedAt,
    );
    expect(picked).toEqual({ amount: '-12.50', currency: 'EUR', type: 'CLBD', referenceDate: '2026-11-19', fetchedAt });
  });

  it('ignores balances without a usable amount', () => {
    expect(pickBalance([{ balance_amount: { amount: 'n/a', currency: 'EUR' } }], fetchedAt)).toBeNull();
    expect(pickBalance([], fetchedAt)).toBeNull();
  });

  it('compares to the cent and recognises an inverted sign', () => {
    const bank = { amount: '1480.00', currency: 'EUR', type: 'ITBD', fetchedAt };
    expect(compareBalances(bank, { cashBalance: 1480.004, accountCurrency: 'EUR' })).toEqual({ state: 'match' });
    expect(compareBalances(bank, { cashBalance: -1480, accountCurrency: 'EUR' })).toEqual({ state: 'match-inverted' });
    expect(compareBalances(bank, { cashBalance: 1467.66, accountCurrency: 'EUR' })).toEqual({ state: 'mismatch', difference: -12.34 });
    expect(compareBalances(bank, { cashBalance: 1480, accountCurrency: 'USD' })).toEqual({ state: 'unknown', reason: 'currency' });
    expect(compareBalances(undefined, { cashBalance: 1, accountCurrency: 'EUR' })).toEqual({ state: 'unknown', reason: 'no-bank' });
  });

  it('tells a difference from an out-of-date bank balance only when movements came in after it', () => {
    const mismatch = { state: 'mismatch', difference: -12.34 } as const;
    expect(withOutdated(mismatch, true)).toEqual({ state: 'outdated', difference: -12.34 });
    expect(withOutdated(mismatch, undefined)).toEqual(mismatch);
    // A balance that still matches is shown as matching, out of date or not.
    expect(withOutdated({ state: 'match' }, true)).toEqual({ state: 'match' });
  });
});

describe('dates', () => {
  it('computes the next start from overlap, hold and the chosen start', () => {
    const account = { key: 'k', uid: 'u', name: 'n', wealthfolioAccountId: 'w', syncFrom: '2026-09-01' };
    expect(syncStartDate(account)).toBe('2026-09-01');
    expect(syncStartDate({ ...account, lastSyncedDate: '2026-11-20' })).toBe('2026-11-13');
    expect(syncStartDate({ ...account, lastSyncedDate: '2026-11-20', retryFrom: '2026-10-02' })).toBe('2026-10-02');
    expect(syncStartDate({ ...account, lastSyncedDate: '2026-11-20', retryFrom: '2026-08-02' })).toBe('2026-09-01');
    expect(syncStartDate({ ...account, lastSyncedDate: '2026-09-03' })).toBe('2026-09-01');
  });

  it('accepts only complete, real start dates from 2000 up to today', () => {
    const today = '2026-11-20';
    expect(isValidStartDate('2026-01-01', today)).toBe(true);
    expect(isValidStartDate('2026-11-20', today)).toBe(true);
    expect(isValidStartDate('2000-01-01', today)).toBe(true);
    // What a browser reports while the year is being typed.
    for (const partial of ['0002-01-01', '0020-01-01', '0202-01-01', '0026-01-01']) {
      expect(isValidStartDate(partial, today)).toBe(false);
    }
    expect(isValidStartDate('2026-11-21', today)).toBe(false);
    expect(isValidStartDate('2026-02-30', today)).toBe(false);
    expect(isValidStartDate('', today)).toBe(false);
    expect(isValidStartDate(undefined, today)).toBe(false);
  });

  it('reads pending dates and plain or timestamped host dates', () => {
    expect(pendingDate({ transaction_amount: { amount: '1', currency: 'EUR' }, transaction_date: '2026-10-20', value_date: '2026-10-22' })).toBe('2026-10-20');
    expect(pendingDate({ transaction_amount: { amount: '1', currency: 'EUR' } })).toBeNull();
    expect(toDateOnly('2026-11-03')).toBe('2026-11-03');
    expect(toDateOnly(null)).toBeNull();
    expect(toDateOnly('not a date')).toBeNull();
    expect(daysBetween('2026-02-27', '2026-03-02')).toBe(3);
    expect(formatIsoDate('2026-09-16')).toBe('16/09/2026');
  });
});
