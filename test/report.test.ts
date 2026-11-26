import { describe, expect, it } from 'vitest';
import { matchReportRows } from '../src/lib/report';
import type { BankConnection, LinkedAccount, SyncAccountResult, SyncReport } from '../src/lib/state';

const account = (key: string, iban: string | undefined, wealthfolioAccountId: string | null): LinkedAccount => ({
  key,
  uid: `uid-${key}`,
  iban,
  name: 'TITULAR',
  wealthfolioAccountId,
  syncFrom: '2026-11-01',
});

const connections: BankConnection[] = [
  {
    sessionId: 's1',
    aspsp: { name: 'BBVA', country: 'ES' },
    validUntil: '2027-05-01T00:00:00Z',
    createdAt: '2026-11-01T00:00:00Z',
    accounts: [
      account('k-op', 'ES9121000418450200051332', 'wf-op'),
      account('k-ah', 'ES7921000813610123456789', 'wf-ah'),
      account('k-off', 'ES6621000418401234567891', null),
    ],
  },
];

const row = (extra: Partial<SyncAccountResult>): SyncAccountResult => ({
  bank: 'BBVA',
  account: 'TITULAR',
  status: 'ok',
  fetched: 1,
  imported: 0,
  duplicates: 1,
  invalid: 0,
  ...extra,
});

const report = (rows: SyncAccountResult[]): SyncReport => ({
  startedAt: '',
  finishedAt: '',
  imported: 0,
  duplicates: 0,
  invalid: 0,
  accounts: rows,
  invalidRows: [],
});

describe('matching report rows with accounts', () => {
  it('uses the account key of reports from 1.5.2 on', () => {
    const { byKey, unmatched } = matchReportRows(connections, report([row({ key: 'k-ah' }), row({ key: 'k-op' })]));
    expect([...byKey.keys()].sort()).toEqual(['k-ah', 'k-op']);
    expect(unmatched).toEqual([]);
  });

  it('falls back to the bank and the masked IBAN (reports from 1.5.0)', () => {
    const { byKey } = matchReportRows(connections, report([row({ iban: 'ES91 •••• 1332', fetched: 7 })]));
    expect(byKey.get('k-op')?.fetched).toBe(7);
  });

  it('uses the bank name only when a single account has it', () => {
    // Older reports: every account is called after its holder, so it is ambiguous.
    const { byKey, unmatched } = matchReportRows(connections, report([row({})]));
    expect(byKey.size).toBe(0);
    expect(unmatched).toHaveLength(1);
  });

  it('leaves aside rows of accounts that are no longer synced', () => {
    const { byKey, unmatched } = matchReportRows(connections, report([row({ key: 'k-off' }), row({ key: 'gone' })]));
    expect(byKey.size).toBe(0);
    expect(unmatched).toHaveLength(2);
  });

  it('works without a report', () => {
    expect(matchReportRows(connections, null)).toEqual({ byKey: new Map(), unmatched: [] });
  });
});
