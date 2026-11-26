import { maskIban } from './mapping';
import type { BankConnection, SyncAccountResult, SyncReport } from './state';

export interface MatchedReport {
  /** Report row of each synced account, by `LinkedAccount.key`. */
  byKey: Map<string, SyncAccountResult>;
  /** Rows that belong to no account synced now (e.g. from an older report). */
  unmatched: SyncAccountResult[];
}

/**
 * Pairs each row of the last report with the account it belongs to, so the page
 * can show an account's result next to its saved state (balance, history).
 * Rows carry the account key from 1.5.2 on; before, the bank and the masked
 * IBAN (1.5.0 on) or, failing that, a name that only one account of that bank has.
 */
export function matchReportRows(connections: BankConnection[], report: SyncReport | null): MatchedReport {
  const byKey = new Map<string, SyncAccountResult>();
  const unmatched: SyncAccountResult[] = [];
  const synced = connections.flatMap((connection) =>
    connection.accounts
      .filter((account) => account.wealthfolioAccountId)
      .map((account) => ({ bank: connection.aspsp.name, account })),
  );

  for (const row of report?.accounts ?? []) {
    let candidates = row.key ? synced.filter((s) => s.account.key === row.key) : [];
    if (!row.key && row.iban) {
      candidates = synced.filter((s) => s.bank === row.bank && maskIban(s.account.iban) === row.iban);
    }
    if (!row.key && !row.iban) {
      candidates = synced.filter((s) => s.bank === row.bank && s.account.name === row.account);
    }
    const key = candidates.length === 1 ? candidates[0].account.key : undefined;
    if (key && !byKey.has(key)) byKey.set(key, row);
    else unmatched.push(row);
  }
  return { byKey, unmatched };
}
