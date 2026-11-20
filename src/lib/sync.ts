import type { ActivityImport, HostAPI } from '@wealthfolio/addon-sdk';
import { pickBalance } from './balance';
import { EnableBankingClient, EnableBankingError, NetworkBlockedError } from './enable-banking-client';
import { mapTransactions, pendingDate } from './mapping';
import {
  addDays,
  formatIsoDate,
  isExpired,
  isValidStartDate,
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
  onProgress?: (message: string) => void;
}

export interface SyncOutcome {
  report: SyncReport;
  connections: BankConnection[];
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

function errorMessage(error: unknown): string {
  // Host API rejections may carry a stable `code` (SDK 3.13.1); their message is
  // localized and generic, so show the code too.
  const code =
    error && typeof error === 'object' && typeof (error as { code?: unknown }).code === 'string'
      ? (error as { code: string }).code
      : undefined;
  if (error instanceof Error) return code && !error.message.includes(code) ? `${error.message} [${code}]` : error.message;
  if (typeof error === 'string') return error;
  const message = (error as { message?: unknown } | null)?.message;
  if (typeof message === 'string') return code ? `${message} [${code}]` : message;
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
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
  try {
    for (const account of await host.accounts.getAll()) accountTypes.set(account.id, account.accountType);
  } catch {
    // Only used to recognise credit card accounts when pairing transfers.
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
      const result: SyncAccountResult = {
        bank,
        account: account.name,
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
        result.message = 'El consentimiento del banco ha caducado. Pulsa «Renovar» para volver a autorizarlo.';
        continue;
      }

      const dateFrom = syncStartDate(account);
      result.dateFrom = dateFrom;

      // First sync into this Wealthfolio account: the user must choose the start date.
      // Wealthfolio only recognises a movement already imported from a CSV when every
      // value matches, comment included, so an overlapping start would duplicate it.
      if (!account.lastSyncedDate && !account.syncFromConfirmed) {
        result.status = 'blocked';
        result.message =
          'Elige en «Bancos conectados» desde qué fecha importar esta cuenta: el día siguiente al ' +
          'último movimiento que ya tengas en esa cuenta de Wealthfolio (por ejemplo, de un CSV).';
        continue;
      }
      if (!account.lastSyncedDate && !isValidStartDate(account.syncFrom, today)) {
        result.status = 'blocked';
        result.message =
          `La fecha de inicio (${formatIsoDate(account.syncFrom)}) no es válida: tiene que ser ` +
          'posterior al 01/01/2000 y no futura. Corrígela en «Bancos conectados».';
        continue;
      }

      if (dateFrom > today) {
        result.message = 'La fecha de inicio es posterior a hoy: todavía no hay nada que importar.';
        continue;
      }

      // Once Wealthfolio refuses one request it refuses them all: don't repeat it.
      if (networkBlocked) {
        result.status = 'error';
        result.message = 'No se ha consultado: Wealthfolio no deja salir las peticiones (ver la primera cuenta con error).';
        continue;
      }

      onProgress?.(`Descargando movimientos de ${bank} · ${account.name} desde ${formatIsoDate(dateFrom)}…`);
      try {
        const transactions = await client.getAllTransactions(account.uid, dateFrom, today);
        result.fetched = transactions.length;
        const mapped = await mapTransactions(transactions, {
          wealthfolioAccountId: account.wealthfolioAccountId,
          accountIban: account.iban,
          syncedIbans,
          bankName: bank,
          detectInterest: options.detectInterest ?? true,
        });
        const pending = mapped.skipped.filter((s) => s.reason === 'pending');
        result.pending = pending.length;
        const holdDates = pending.map((s) => pendingDate(s.tx) ?? dateFrom);
        work.push({ account, result, rows: mapped.rows, holdDates, freshRows: 0 });
      } catch (error) {
        if (error instanceof NetworkBlockedError) networkBlocked = true;
        result.status =
          error instanceof EnableBankingError && error.needsReconnect ? 'reconnect' : 'error';
        result.message = errorMessage(error);
        continue;
      }

      // The balance is informative: read it at most once a day (PSD2 caps unattended reads).
      if (!account.bankBalance || toDateOnly(account.bankBalance.fetchedAt) !== today) {
        try {
          const balance = pickBalance(await client.getBalances(account.uid), now.toISOString());
          if (balance) account.bankBalance = balance;
        } catch (error) {
          result.notes!.push(`No se pudo leer el saldo del banco: ${errorMessage(error)}`);
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
  const recordInvalid = (entry: AccountWork, original: ActivityImport, errors: string[]) => {
    entry.result.invalid += 1;
    const date = String(original.date ?? '').slice(0, 10);
    if (date) entry.holdDates.push(date);
    invalidRows.push({
      account: `${entry.result.bank} · ${entry.result.account}`,
      date,
      amount: `${original.activityType} ${original.amount ?? ''} ${original.currency ?? ''}`.trim(),
      comment: original.comment ?? '',
      errors: errors.length > 0 ? errors : ['Fila no válida'],
    });
  };

  let importError: string | undefined;
  let importSucceeded = true;
  let validationFailed = false;
  let ownTransfers = 0;

  if (allRows.length > 0) {
    onProgress?.(`Validando ${allRows.length} movimiento(s) con Wealthfolio…`);
    // A rejected call (not a rejected row) must not abort the sync: report it, keep
    // the balances read so far and leave every window where it was.
    const checked = await host.activities.checkImport(allRows).catch((error: unknown) => {
      validationFailed = true;
      importSucceeded = false;
      importError = `Wealthfolio no pudo validar los movimientos: ${errorMessage(error)}`;
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
      onProgress?.(`Importando ${fresh.length} movimiento(s) nuevo(s)…`);
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
          importError =
            'Wealthfolio rechazó la importación' +
            (firstErrors.length ? `: ${firstErrors.join('; ')}` : '.');
        }
      } catch (error) {
        importSucceeded = false;
        importError = `Error al importar: ${errorMessage(error)}`;
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
    account.lastSyncedDate = today;
    account.lastSyncedAt = new Date().toISOString();

    const hold = minDate(entry.holdDates);
    if (!hold) {
      delete account.retryFrom;
    } else if (hold < oldestRetry) {
      account.retryFrom = oldestRetry;
      result.notes!.push(
        `Hay movimientos pendientes o rechazados del ${formatIsoDate(hold)} que ya no se volverán a ` +
          `consultar (más de ${MAX_RETRY_DAYS} días). Revísalos a mano.`,
      );
    } else {
      account.retryFrom = hold;
    }

    if (result.pending) {
      result.notes!.push(
        `${result.pending} movimiento(s) pendiente(s): se importarán cuando el banco los contabilice.`,
      );
    }
    if (result.invalid > 0) {
      result.notes!.push(
        `${result.invalid} movimiento(s) rechazado(s) por Wealthfolio: se volverán a intentar en la próxima sincronización.`,
      );
    }
    if (result.ownTransfers) {
      result.notes!.push(`${result.ownTransfers} movimiento(s) registrado(s) como traspaso entre tus cuentas.`);
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
