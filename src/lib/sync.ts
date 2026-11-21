import type { ActivityImport, HostAPI } from '@wealthfolio/addon-sdk';
import { pickBalance } from './balance';
import type { EbTransaction } from './eb-types';
import {
  EnableBankingClient,
  EnableBankingError,
  NetworkBlockedError,
  type TransactionsStrategy,
} from './enable-banking-client';
import { mapTransactions, maskIban, pendingDate, transactionDate, type TransferLabels } from './mapping';
import { errorToText, msg, type Text } from './messages';
import {
  addDays,
  isExpired,
  isValidStartDate,
  MIN_START_DATE,
  minDate,
  toDateOnly,
  toIsoDate,
  type AddonConfig,
  type BankConnection,
  type InvalidRowInfo,
  type LinkedAccount,
  type SyncAccountResult,
  type SyncReport,
} from './state';
import { findOwnTransferPairs, type TransferCandidate } from './transfers';

/** Days re-read before the last sync, to catch movements the bank books late. */
export const OVERLAP_DAYS = 7;

/**
 * How far back a held-back movement (pending or rejected) is retried. Banks
 * rarely give more history to an unattended request, so older ones are dropped
 * with a warning instead of anchoring every later sync.
 */
export const MAX_RETRY_DAYS = 89;

export type SyncHost = Pick<HostAPI, 'network' | 'secrets' | 'activities' | 'accounts'>;

export interface SyncOptions {
  host: SyncHost;
  config: AddonConfig;
  connections: BankConnection[];
  detectInterest?: boolean;
  detectOwnTransfers?: boolean;
  now?: Date;
  onProgress?: (message: Text) => void;
  /** Words for a transfer with no description, in the user's language. */
  transferLabels?: TransferLabels;
}

export interface SyncOutcome {
  report: SyncReport;
  connections: BankConnection[];
}

/** Days of history most banks still give once the hour after authorising is over. */
export const USUAL_HISTORY_DAYS = 90;

/**
 * Ask Enable Banking for the longest history the bank keeps on an account's first
 * sync, or when the start is older than the usual 90 days (e.g. after months
 * without syncing). Otherwise ask for the exact range: "longest" may cost extra
 * calls to the bank, which caps unattended reads at about 4 a day.
 */
export function fetchStrategy(account: LinkedAccount, dateFrom: string, today: string): TransactionsStrategy {
  if (!account.lastSyncedDate) return 'longest';
  return dateFrom < addDays(today, -(USUAL_HISTORY_DAYS - 1)) ? 'longest' : 'default';
}

/** Date of a movement for history purposes: its booking date, else the earliest it carries. */
function movementDate(tx: EbTransaction): string | null {
  return transactionDate(tx) ?? pendingDate(tx);
}

/**
 * First date to download: a week before the last sync, or earlier when a
 * pending or rejected movement is waiting, but never before the chosen start.
 */
export function syncStartDate(account: LinkedAccount): string {
  let start = account.lastSyncedDate ? addDays(account.lastSyncedDate, -OVERLAP_DAYS) : account.syncFrom;
  if (account.retryFrom && account.retryFrom < start) start = account.retryFrom;
  return start > account.syncFrom ? start : account.syncFrom;
}

const DUPLICATE_ERROR_FIELD = '_duplicate';

function rowErrors(row: ActivityImport): string[] {
  return Object.entries(row.errors ?? {})
    .filter(([field]) => field !== DUPLICATE_ERROR_FIELD)
    .flatMap(([field, messages]) => messages.map((message) => `${field}: ${message}`));
}

function isDuplicateRow(row: ActivityImport): boolean {
  return Boolean(row.duplicateOfId || row.errors?.[DUPLICATE_ERROR_FIELD]?.length);
}

function isInvalidRow(row: ActivityImport): boolean {
  return !row.isValid || rowErrors(row).length > 0;
}

interface AccountWork {
  account: LinkedAccount;
  result: SyncAccountResult;
  rows: ActivityImport[];
  /** Dates that must be read again next time (pending and rejected movements). */
  holdDates: string[];
  /** Rows that were new after validation and were sent to import. */
  freshRows: number;
  /** Do not mark the account as synced (first sync where the bank returned nothing). */
  keepWindow: boolean;
}

interface FreshRow {
  row: ActivityImport;
  original: ActivityImport;
  work: AccountWork;
}

export async function runSync(options: SyncOptions): Promise<SyncOutcome> {
  const { host, config, onProgress } = options;
  const now = options.now ?? new Date();
  const today = toIsoDate(now);
  const startedAt = now.toISOString();
  const connections: BankConnection[] = structuredClone(options.connections);
  const client = new EnableBankingClient(host, config.applicationId);
  const detectOwnTransfers = options.detectOwnTransfers ?? true;

  const accountTypes = new Map<string, string>();
  const accountNames = new Map<string, string>();
  try {
    for (const account of await host.accounts.getAll()) {
      accountTypes.set(account.id, account.accountType);
      accountNames.set(account.id, account.name);
    }
  } catch {
    // Types pair credit card transfers and names label the report: both optional.
  }

  const syncedIbans = new Set(
    connections.flatMap((c) =>
      c.accounts.filter((a) => a.wealthfolioAccountId && a.iban).map((a) => a.iban as string),
    ),
  );

  const results: SyncAccountResult[] = [];
  const work: AccountWork[] = [];
  let networkBlocked = false;

  // 1. Download booked movements (and the balance) of every mapped account.
  for (const connection of connections) {
    const bank = connection.aspsp.name;
    for (const account of connection.accounts) {
      if (!account.wealthfolioAccountId) continue;
      // Banks often name every account after its holder, so the report shows the
      // Wealthfolio account and the masked IBAN to tell them apart.
      const wealthfolioAccount = accountNames.get(account.wealthfolioAccountId);
      const result: SyncAccountResult = {
        bank,
        account: account.name,
        wealthfolioAccount,
        iban: account.iban ? maskIban(account.iban) : undefined,
        status: 'ok',
        fetched: 0,
        imported: 0,
        duplicates: 0,
        invalid: 0,
        pending: 0,
        ownTransfers: 0,
        notes: [],
      };
      results.push(result);

      if (isExpired(connection, now)) {
        result.status = 'reconnect';
        result.message = msg('sync.consentExpired');
        continue;
      }

      const dateFrom = syncStartDate(account);
      result.dateFrom = dateFrom;

      // First sync into this Wealthfolio account: the user must choose the start date.
      // Wealthfolio only recognises a movement already imported from a CSV when every
      // value matches, comment included, so an overlapping start would duplicate it.
      if (!account.lastSyncedDate && !account.syncFromConfirmed) {
        result.status = 'blocked';
        result.message = msg('sync.chooseStartDate');
        continue;
      }
      if (!account.lastSyncedDate && !isValidStartDate(account.syncFrom, today)) {
        result.status = 'blocked';
        result.message = msg('sync.invalidStartDate', { startDate: account.syncFrom, minDate: MIN_START_DATE });
        continue;
      }

      if (dateFrom > today) {
        result.message = msg('sync.futureStart');
        continue;
      }

      // Once Wealthfolio refuses one request it refuses them all: don't repeat it.
      if (networkBlocked) {
        result.status = 'error';
        result.message = msg('sync.skippedNetwork');
        continue;
      }

      const strategy = fetchStrategy(account, dateFrom, today);
      onProgress?.(
        msg('sync.progressDownload', { bank, account: wealthfolioAccount ?? account.name, fromDate: dateFrom }),
      );
      let keepWindow = false;
      try {
        const transactions = await client.getAllTransactions(account.uid, dateFrom, today, { strategy });
        result.fetched = transactions.length;

        if (strategy === 'longest') {
          const earliest = minDate(transactions.map(movementDate));
          account.history = { requestedFrom: dateFrom, earliest, checkedAt: now.toISOString() };
          if (!earliest) {
            // BBVA answers "nothing" rather than an error when it does not keep the
            // history asked for. Marking the account as synced would skip that history
            // for good, so leave it as it was.
            keepWindow = !account.lastSyncedDate;
            result.status = keepWindow ? 'blocked' : result.status;
            result.message = msg(keepWindow ? 'sync.noMovementsFirstSync' : 'sync.noMovements', {
              fromDate: dateFrom,
            });
          } else if (earliest > dateFrom) {
            result.notes!.push(msg('sync.historyPartial', { earliestDate: earliest, fromDate: dateFrom }));
          } else {
            result.notes!.push(msg('sync.historyFull', { earliestDate: earliest }));
          }
        }
        const mapped = await mapTransactions(transactions, {
          wealthfolioAccountId: account.wealthfolioAccountId,
          accountIban: account.iban,
          syncedIbans,
          bankName: bank,
          detectInterest: options.detectInterest ?? true,
          transferLabels: options.transferLabels,
        });
        const pending = mapped.skipped.filter((s) => s.reason === 'pending');
        result.pending = pending.length;
        const holdDates = pending.map((s) => pendingDate(s.tx) ?? dateFrom);
        work.push({ account, result, rows: mapped.rows, holdDates, freshRows: 0, keepWindow });
      } catch (error) {
        if (error instanceof NetworkBlockedError) networkBlocked = true;
        result.status =
          error instanceof EnableBankingError && error.needsReconnect ? 'reconnect' : 'error';
        result.message = errorToText(error);
        continue;
      }

      // The balance is informative: read it at most once a day (PSD2 caps unattended reads).
      if (!account.bankBalance || toDateOnly(account.bankBalance.fetchedAt) !== today) {
        try {
          const balance = pickBalance(await client.getBalances(account.uid), now.toISOString());
          if (balance) account.bankBalance = balance;
        } catch (error) {
          result.notes!.push(msg('sync.balanceFailed', { detail: errorToText(error) }));
        }
      }
    }
  }

  // 2. Validate everything with Wealthfolio and keep the valid, new rows.
  const allRows: ActivityImport[] = [];
  const owners: AccountWork[] = [];
  for (const entry of work) {
    for (const row of entry.rows) {
      allRows.push({ ...row, lineNumber: allRows.length + 1 });
      owners.push(entry);
    }
  }

  const invalidRows: InvalidRowInfo[] = [];
  const recordInvalid = (entry: AccountWork, original: ActivityImport, errors: Text[]) => {
    entry.result.invalid += 1;
    const date = String(original.date ?? '').slice(0, 10);
    if (date) entry.holdDates.push(date);
    invalidRows.push({
      account: `${entry.result.bank} · ${entry.result.wealthfolioAccount ?? entry.result.account}`,
      date,
      amount: `${original.activityType} ${original.amount ?? ''} ${original.currency ?? ''}`.trim(),
      comment: original.comment ?? '',
      errors: errors.length > 0 ? errors : [msg('sync.invalidRow')],
    });
  };

  let importError: Text | undefined;
  let importSucceeded = true;
  let validationFailed = false;
  let ownTransfers = 0;

  if (allRows.length > 0) {
    onProgress?.(msg('sync.progressValidate', { n: allRows.length }));
    // A rejected call (not a rejected row) must not abort the sync: report it, keep
    // the balances read so far and leave every window where it was.
    const checked = await host.activities.checkImport(allRows).catch((error: unknown) => {
      validationFailed = true;
      importSucceeded = false;
      importError = msg('sync.validateFailed', { detail: errorToText(error) });
      return [] as ActivityImport[];
    });
    const fresh: FreshRow[] = [];

    checked.forEach((row, index) => {
      const line = row.lineNumber ?? index + 1;
      const owner = owners[line - 1] ?? owners[index];
      const original = allRows[line - 1] ?? row;
      if (isInvalidRow(row)) recordInvalid(owner, original, rowErrors(row));
      else if (isDuplicateRow(row)) owner.result.duplicates += 1;
      else fresh.push({ row, original, work: owner });
    });

    // 2b. Withdrawal + deposit between two of your accounts without an IBAN → transfer.
    if (detectOwnTransfers && fresh.length > 1) {
      const candidates: TransferCandidate[] = fresh.map((f, key) => ({
        key,
        accountId: f.original.accountId,
        activityType: f.original.activityType,
        date: String(f.original.date ?? '').slice(0, 10),
        amount: String(f.original.amount ?? ''),
        currency: f.original.currency ?? '',
        comment: f.original.comment,
      }));
      for (const [outKey, inKey] of findOwnTransferPairs(candidates, { accountTypes })) {
        for (const [key, type] of [
          [outKey, 'TRANSFER_OUT'],
          [inKey, 'TRANSFER_IN'],
        ] as const) {
          const f = fresh[key];
          f.row = {
            ...f.row,
            activityType: type,
            isExternal: false,
            metadata: { ...(f.row.metadata ?? f.original.metadata ?? {}), ownTransferMatch: 'amount-date' },
          };
          f.work.result.ownTransfers = (f.work.result.ownTransfers ?? 0) + 1;
        }
        ownTransfers += 1;
      }
    }

    for (const f of fresh) f.work.freshRows += 1;

    // 3. Import the new rows.
    if (fresh.length > 0) {
      onProgress?.(msg('sync.progressImport', { n: fresh.length }));
      try {
        const result = await host.activities.import(fresh.map((f) => f.row));
        if (result.summary.success) {
          const byLine = new Map<number, ActivityImport>();
          for (const row of result.activities ?? []) {
            if (row.lineNumber !== undefined) byLine.set(row.lineNumber, row);
          }
          fresh.forEach((f, index) => {
            const outcome =
              (f.row.lineNumber !== undefined ? byLine.get(f.row.lineNumber) : undefined) ??
              result.activities?.[index];
            if (outcome && isDuplicateRow(outcome)) f.work.result.duplicates += 1;
            else if (outcome && isInvalidRow(outcome)) recordInvalid(f.work, f.original, rowErrors(outcome));
            else f.work.result.imported += 1;
          });
        } else {
          importSucceeded = false;
          const firstErrors = (result.activities ?? []).flatMap(rowErrors).slice(0, 3);
          importError = firstErrors.length
            ? msg('sync.importRejectedDetail', { detail: firstErrors.join('; ') })
            : msg('sync.importRejected');
        }
      } catch (error) {
        importSucceeded = false;
        importError = msg('sync.importFailed', { detail: errorToText(error) });
      }
    }
  }

  // 4. Advance the window only for accounts whose movements were stored, and keep
  //    the date of anything held back so the next sync reads it again.
  const oldestRetry = addDays(today, -MAX_RETRY_DAYS);
  for (const entry of work) {
    const { account, result } = entry;
    if (!importSucceeded && (entry.freshRows > 0 || (validationFailed && entry.rows.length > 0))) {
      result.status = 'error';
      result.message = importError;
      continue;
    }
    if (entry.keepWindow) continue;
    account.lastSyncedDate = today;
    account.lastSyncedAt = new Date().toISOString();

    const hold = minDate(entry.holdDates);
    if (!hold) {
      delete account.retryFrom;
    } else if (hold < oldestRetry) {
      account.retryFrom = oldestRetry;
      result.notes!.push(msg('sync.heldTooOld', { holdDate: hold, days: MAX_RETRY_DAYS }));
    } else {
      account.retryFrom = hold;
    }

    if (result.pending) {
      result.notes!.push(msg('sync.pendingNote', { n: result.pending }));
    }
    if (result.invalid > 0) {
      result.notes!.push(msg('sync.rejectedNote', { n: result.invalid }));
    }
    if (result.ownTransfers) {
      result.notes!.push(msg('sync.ownTransfersNote', { n: result.ownTransfers }));
    }
  }

  for (const result of results) if (result.notes?.length === 0) delete result.notes;

  const report: SyncReport = {
    startedAt,
    finishedAt: new Date().toISOString(),
    imported: results.reduce((sum, r) => sum + r.imported, 0),
    duplicates: results.reduce((sum, r) => sum + r.duplicates, 0),
    invalid: results.reduce((sum, r) => sum + r.invalid, 0),
    ownTransfers,
    accounts: results,
    invalidRows,
    importError,
  };
  return { report, connections };
}
