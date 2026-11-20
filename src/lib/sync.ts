import type { ActivityImport, HostAPI } from '@wealthfolio/addon-sdk';
import { EnableBankingClient, EnableBankingError } from './enable-banking-client';
import { mapTransactions } from './mapping';
import {
  addDays,
  isExpired,
  toIsoDate,
  type AddonConfig,
  type BankConnection,
  type InvalidRowInfo,
  type LinkedAccount,
  type SyncAccountResult,
  type SyncReport,
} from './state';

/** Days re-read before the last sync, to catch movements the bank books late. */
export const OVERLAP_DAYS = 7;

export type SyncHost = Pick<HostAPI, 'network' | 'secrets' | 'activities'>;

export interface SyncOptions {
  host: SyncHost;
  config: AddonConfig;
  connections: BankConnection[];
  detectInterest?: boolean;
  now?: Date;
  onProgress?: (message: string) => void;
}

export interface SyncOutcome {
  report: SyncReport;
  connections: BankConnection[];
}

export function syncStartDate(account: LinkedAccount): string {
  if (!account.lastSyncedDate) return account.syncFrom;
  const withOverlap = addDays(account.lastSyncedDate, -OVERLAP_DAYS);
  return withOverlap > account.syncFrom ? withOverlap : account.syncFrom;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
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

interface PendingRows {
  connectionIndex: number;
  accountIndex: number;
  result: SyncAccountResult;
  rows: ActivityImport[];
}

export async function runSync(options: SyncOptions): Promise<SyncOutcome> {
  const { host, config, onProgress } = options;
  const now = options.now ?? new Date();
  const today = toIsoDate(now);
  const startedAt = now.toISOString();
  const connections: BankConnection[] = structuredClone(options.connections);
  const client = new EnableBankingClient(host, config.applicationId);

  const syncedIbans = new Set(
    connections.flatMap((c) =>
      c.accounts.filter((a) => a.wealthfolioAccountId && a.iban).map((a) => a.iban as string),
    ),
  );

  const results: SyncAccountResult[] = [];
  const pending: PendingRows[] = [];

  // 1. Download booked movements for every mapped account.
  for (const [connectionIndex, connection] of connections.entries()) {
    const bank = connection.aspsp.name;
    for (const [accountIndex, account] of connection.accounts.entries()) {
      if (!account.wealthfolioAccountId) continue;
      const result: SyncAccountResult = {
        bank,
        account: account.name,
        status: 'ok',
        fetched: 0,
        imported: 0,
        duplicates: 0,
        invalid: 0,
      };
      results.push(result);

      if (isExpired(connection, now)) {
        result.status = 'reconnect';
        result.message = 'El consentimiento del banco ha caducado. Pulsa «Renovar» para volver a autorizarlo.';
        continue;
      }

      const dateFrom = syncStartDate(account);
      result.dateFrom = dateFrom;
      onProgress?.(`Descargando movimientos de ${bank} · ${account.name} desde ${dateFrom}…`);
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
        const pendingCount = mapped.skipped.filter((s) => s.reason === 'pending').length;
        if (pendingCount > 0) {
          result.message = `${pendingCount} movimiento(s) pendiente(s) se importarán cuando el banco los contabilice.`;
        }
        pending.push({ connectionIndex, accountIndex, result, rows: mapped.rows });
      } catch (error) {
        result.status =
          error instanceof EnableBankingError && error.needsReconnect ? 'reconnect' : 'error';
        result.message = errorMessage(error);
      }
    }
  }

  // 2. Validate everything with Wealthfolio, then import only valid, new rows.
  const allRows: ActivityImport[] = [];
  const owners: PendingRows[] = [];
  for (const entry of pending) {
    for (const row of entry.rows) {
      allRows.push({ ...row, lineNumber: allRows.length + 1 });
      owners.push(entry);
    }
  }

  const invalidRows: InvalidRowInfo[] = [];
  let importError: string | undefined;
  let importSucceeded = true;

  if (allRows.length > 0) {
    onProgress?.(`Validando ${allRows.length} movimiento(s) con Wealthfolio…`);
    const checked = await host.activities.checkImport(allRows);
    const toImport: ActivityImport[] = [];
    const importOwners: PendingRows[] = [];

    checked.forEach((row, index) => {
      const ownerIndex = (row.lineNumber ?? index + 1) - 1;
      const owner = owners[ownerIndex] ?? owners[index];
      const errors = rowErrors(row);
      if (!row.isValid || errors.length > 0) {
        owner.result.invalid += 1;
        const original = allRows[ownerIndex] ?? row;
        invalidRows.push({
          account: `${owner.result.bank} · ${owner.result.account}`,
          date: String(original.date ?? ''),
          amount: `${original.activityType} ${original.amount ?? ''} ${original.currency ?? ''}`.trim(),
          comment: original.comment ?? '',
          errors: errors.length > 0 ? errors : ['Fila no válida'],
        });
      } else if (isDuplicateRow(row)) {
        owner.result.duplicates += 1;
      } else {
        toImport.push(row);
        importOwners.push(owner);
      }
    });

    if (toImport.length > 0) {
      onProgress?.(`Importando ${toImport.length} movimiento(s) nuevo(s)…`);
      try {
        const result = await host.activities.import(toImport);
        if (result.summary.success) {
          const skippedIds = new Set(
            result.activities.filter(isDuplicateRow).map((row) => row.sourceRecordId),
          );
          toImport.forEach((row, index) => {
            const owner = importOwners[index];
            if (skippedIds.has(row.sourceRecordId)) owner.result.duplicates += 1;
            else owner.result.imported += 1;
          });
        } else {
          importSucceeded = false;
          const firstErrors = result.activities.flatMap(rowErrors).slice(0, 3);
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

  // 3. Advance the sync window only for accounts whose movements were stored.
  for (const entry of pending) {
    if (!importSucceeded && entry.rows.length > 0) {
      entry.result.status = 'error';
      entry.result.message = importError;
      continue;
    }
    const account = connections[entry.connectionIndex].accounts[entry.accountIndex];
    account.lastSyncedDate = today;
    account.lastSyncedAt = new Date().toISOString();
  }

  const report: SyncReport = {
    startedAt,
    finishedAt: new Date().toISOString(),
    imported: results.reduce((sum, r) => sum + r.imported, 0),
    duplicates: results.reduce((sum, r) => sum + r.duplicates, 0),
    invalid: results.reduce((sum, r) => sum + r.invalid, 0),
    accounts: results,
    invalidRows,
    importError,
  };
  return { report, connections };
}
