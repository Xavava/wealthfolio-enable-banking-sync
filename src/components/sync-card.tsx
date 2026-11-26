import { useQueryClient } from '@tanstack/react-query';
import { QueryKeys, type AccountValuation } from '@wealthfolio/addon-sdk';
import { Alert, AlertDescription, AlertTitle, Badge, Button } from '@wealthfolio/ui';
import { LoaderCircle, RefreshCw } from 'lucide-react';
import { useState } from 'react';
import { useText } from '../i18n';
import { maskIban } from '../lib/mapping';
import type { Text } from '../lib/messages';
import { matchReportRows } from '../lib/report';
import {
  store,
  type BankConnection,
  type LinkedAccount,
  type SyncAccountResult,
  type SyncReport,
  type SyncStatus,
} from '../lib/state';
import { runSync } from '../lib/sync';
import {
  QK,
  useAddonCtx,
  useSaveConnections,
  useValuations,
  useWealthfolioAccounts,
  type AddonState,
} from '../hooks/use-addon-data';
import { BalanceLine, balanceCheck, HistoryLine } from './account-status';
import { CollapsibleCard } from './collapsible-card';

function StatusBadge({ status }: { status: SyncStatus }) {
  const { t } = useText();
  if (status === 'ok') return <Badge variant="success-subtle">{t('syncCard.statusOk')}</Badge>;
  if (status === 'reconnect') return <Badge variant="warning-subtle">{t('syncCard.statusReconnect')}</Badge>;
  if (status === 'blocked') return <Badge variant="warning-subtle">{t('syncCard.statusBlocked')}</Badge>;
  return <Badge variant="destructive-subtle">{t('syncCard.statusError')}</Badge>;
}

/** What the last sync said about one account: message and notes. */
function RowMessages({ row }: { row: SyncAccountResult }) {
  const { render } = useText();
  return (
    <>
      {row.message && (
        <div
          className={`mt-1 text-xs ${row.status === 'ok' ? 'text-muted-foreground' : 'text-amber-600 dark:text-amber-400'}`}
        >
          {render(row.message)}
        </div>
      )}
      {row.notes?.map((note: Text, i) => (
        <div key={i} className="text-muted-foreground mt-1 text-xs">
          {render(note)}
        </div>
      ))}
    </>
  );
}

function NumberCells({ row }: { row?: SyncAccountResult }) {
  const { formatDay } = useText();
  return (
    <>
      <td className="px-3 py-2 whitespace-nowrap">{row ? formatDay(row.dateFrom) : '—'}</td>
      <td className="px-3 py-2 text-end tabular-nums">{row ? row.fetched : '—'}</td>
      <td className="px-3 py-2 text-end tabular-nums">{row ? row.imported : '—'}</td>
      <td className="px-3 py-2 text-end tabular-nums">{row ? row.duplicates : '—'}</td>
      <td className="px-3 py-2">{row && <StatusBadge status={row.status} />}</td>
    </>
  );
}

/** One synced account: its last result next to its saved state (dates, history, balance). */
function AccountResultRow({
  bank,
  account,
  name,
  row,
  valuation,
}: {
  bank: string;
  account: LinkedAccount;
  name?: string;
  row?: SyncAccountResult;
  valuation?: AccountValuation;
}) {
  const { t, formatDay, formatWhen } = useText();
  const needsStartDate = !account.lastSyncedDate && !account.syncFromConfirmed;
  return (
    <tr className="border-t align-top">
      <td className="px-3 py-2">
        <div className="font-medium">{name ?? row?.wealthfolioAccount ?? account.name}</div>
        <div className="text-muted-foreground text-xs">
          {[bank, account.iban ? maskIban(account.iban) : account.name].join(' · ')}
        </div>
        {row ? (
          <RowMessages row={row} />
        ) : (
          <div
            className={`mt-1 text-xs ${needsStartDate ? 'text-amber-600 dark:text-amber-400' : 'text-muted-foreground'}`}
          >
            {needsStartDate ? t('syncCard.needsStartDate') : t('syncCard.notSyncedYet')}
          </div>
        )}
        {account.lastSyncedAt && (
          <div className="text-muted-foreground mt-1 text-xs">
            {t('syncCard.lastGoodSync', { when: formatWhen(account.lastSyncedAt) })}
            {account.retryFrom && ` · ${t('connections.retryFrom', { date: formatDay(account.retryFrom) })}`}
          </div>
        )}
        <HistoryLine account={account} />
        <BalanceLine account={account} valuation={valuation} />
      </td>
      <NumberCells row={row} />
    </tr>
  );
}

/** A row of the last report that belongs to no account synced now (older report). */
function OrphanRow({ row }: { row: SyncAccountResult }) {
  return (
    <tr className="border-t align-top">
      <td className="px-3 py-2">
        <div className="font-medium">{row.wealthfolioAccount ?? row.account}</div>
        <div className="text-muted-foreground text-xs">
          {row.wealthfolioAccount ? [row.bank, row.iban ?? row.account].join(' · ') : row.bank}
        </div>
        <RowMessages row={row} />
      </td>
      <NumberCells row={row} />
    </tr>
  );
}

function ReportSummary({ report }: { report: SyncReport }) {
  const { t, rich, formatWhen } = useText();
  return (
    <div className="text-muted-foreground text-sm">
      {t('syncCard.lastSync', { when: formatWhen(report.finishedAt) })} ·{' '}
      {rich('syncCard.newCount', { n: <b>{report.imported}</b> })} ·{' '}
      {t('syncCard.duplicateCount', { n: report.duplicates })}
      {(report.ownTransfers ?? 0) > 0 && <> · {t('syncCard.transferCount', { n: report.ownTransfers })}</>}
      {report.invalid > 0 && (
        <>
          {' '}
          · <span className="text-destructive">{t('syncCard.errorCount', { n: report.invalid })}</span>
        </>
      )}
    </div>
  );
}

function InvalidRows({ report }: { report: SyncReport }) {
  const { t, render, formatDay } = useText();
  if (report.invalidRows.length === 0) return null;
  return (
    <details className="rounded-md border p-3 text-sm">
      <summary className="cursor-pointer font-medium">
        {t('syncCard.invalidSummary', { n: report.invalidRows.length })}
      </summary>
      <ul className="mt-2 space-y-2">
        {report.invalidRows.slice(0, 50).map((row, index) => (
          <li key={index} className="text-xs">
            <div>
              {formatDay(row.date)} · {row.amount} · {row.account}
            </div>
            {row.comment && <div className="text-muted-foreground">{row.comment}</div>}
            <div className="text-destructive">{row.errors.map((error) => render(error)).join('; ')}</div>
          </li>
        ))}
      </ul>
    </details>
  );
}

export function SyncCard({ state }: { state: AddonState }) {
  const ctx = useAddonCtx();
  const { t, render, errorText, formatWhen } = useText();
  const queryClient = useQueryClient();
  const saveConnections = useSaveConnections();
  const wfAccounts = useWealthfolioAccounts();
  const [running, setRunning] = useState(false);
  const [runs, setRuns] = useState(0);
  const [progress, setProgress] = useState<Text>('');
  const [error, setError] = useState<string | null>(null);

  const synced: { connection: BankConnection; account: LinkedAccount }[] = state.connections.flatMap((connection) =>
    connection.accounts.filter((a) => a.wealthfolioAccountId).map((account) => ({ connection, account })),
  );
  const names = new Map((wfAccounts.data ?? []).map((a) => [a.id, a.name]));
  const valuations = useValuations(
    synced.filter((s) => s.account.bankBalance).map((s) => s.account.wealthfolioAccountId!),
  );
  const report = state.lastReport;
  const { byKey, unmatched } = matchReportRows(state.connections, report);
  const detectInterest = state.config.detectInterest ?? true;
  const detectOwnTransfers = state.config.detectOwnTransfers ?? true;

  // Accounts with an error in the last sync or whose balance does not match.
  const toCheck =
    (report?.accounts.filter((row) => row.status !== 'ok').length ?? 0) +
    synced.filter(
      (s) => balanceCheck(s.account, valuations.data?.get(s.account.wealthfolioAccountId!))?.state === 'mismatch',
    ).length;
  const attention = Boolean(report?.importError) || toCheck > 0;

  const sync = async () => {
    if (running) return;
    setRuns((n) => n + 1); // always show the result of a sync
    setRunning(true);
    setError(null);
    setProgress(t('syncCard.preparing'));
    try {
      const { report: next, connections } = await runSync({
        host: ctx.api,
        config: state.config,
        connections: state.connections,
        detectInterest,
        detectOwnTransfers,
        onProgress: setProgress,
        transferLabels: { from: t('sync.transferFrom'), to: t('sync.transferTo') },
      });
      await saveConnections(connections);
      await store.saveLastReport(ctx.api.storage, next);
      await queryClient.invalidateQueries({ queryKey: QK.state });
      await queryClient.invalidateQueries({ queryKey: QK.valuations });
      if (next.imported > 0) {
        ctx.api.query.invalidateQueries(QueryKeys.ACTIVITIES);
        ctx.api.query.invalidateQueries(QueryKeys.ACCOUNTS);
        ctx.api.query.invalidateQueries(QueryKeys.HOLDINGS);
      }
      const failures = next.accounts.filter((a) => a.status !== 'ok').length;
      if (failures > 0 || next.importError) {
        ctx.api.toast.error(t('syncCard.toastIssues', { n: next.imported }));
      } else {
        ctx.api.toast.success(
          next.imported > 0 ? t('syncCard.toastImported', { n: next.imported }) : t('syncCard.toastUpToDate'),
        );
      }
    } catch (e) {
      setError(errorText(e));
      ctx.api.logger.error(`Sync failed: ${errorText(e)}`);
    } finally {
      setRunning(false);
      setProgress('');
    }
  };

  const saveOption = async (patch: Partial<AddonState['config']>) => {
    await store.saveConfig(ctx.api.storage, { ...state.config, ...patch });
    await queryClient.invalidateQueries({ queryKey: QK.state });
  };

  return (
    <CollapsibleCard
      id="sync"
      title={t('syncCard.title')}
      defaultOpen
      attention={attention}
      openSignal={runs}
      badge={
        toCheck > 0 ? <Badge variant="warning-subtle">{t('syncCard.toCheck', { n: toCheck })}</Badge> : undefined
      }
      summary={report ? t('syncCard.collapsedSummary', { when: formatWhen(report.finishedAt), n: report.imported }) : undefined}
      actions={
        <Button size="lg" onClick={sync} disabled={running || synced.length === 0}>
          {running ? <LoaderCircle className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
          {running ? t('syncCard.syncing') : t('syncCard.syncNow')}
        </Button>
      }
      contentClassName="space-y-4"
    >
      {synced.length === 0 && <p className="text-muted-foreground text-sm">{t('syncCard.noMapped')}</p>}
      {running && progress && (
        <div className="text-muted-foreground flex items-center gap-2 text-sm">
          <LoaderCircle className="size-4 animate-spin" /> {render(progress)}
        </div>
      )}
      {error && (
        <Alert variant="destructive">
          <AlertTitle>{t('syncCard.failedTitle')}</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      {report && !running && <ReportSummary report={report} />}
      {report?.importError && !running && (
        <Alert variant="destructive">
          <AlertDescription>{render(report.importError)}</AlertDescription>
        </Alert>
      )}
      {(synced.length > 0 || unmatched.length > 0) && (
        <div className="overflow-x-auto rounded-md border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-muted-foreground text-xs">
              <tr>
                <th className="px-3 py-2 text-start font-medium whitespace-nowrap">{t('syncCard.columnAccount')}</th>
                <th className="px-3 py-2 text-start font-medium whitespace-nowrap">{t('syncCard.columnFrom')}</th>
                <th className="px-3 py-2 text-end font-medium whitespace-nowrap">{t('syncCard.columnFetched')}</th>
                <th className="px-3 py-2 text-end font-medium whitespace-nowrap">{t('syncCard.columnNew')}</th>
                <th className="px-3 py-2 text-end font-medium whitespace-nowrap">{t('syncCard.columnExisting')}</th>
                <th className="px-3 py-2 text-start font-medium whitespace-nowrap">{t('syncCard.columnStatus')}</th>
              </tr>
            </thead>
            <tbody>
              {synced.map(({ connection, account }) => (
                <AccountResultRow
                  key={`${connection.sessionId}-${account.key}`}
                  bank={connection.aspsp.name}
                  account={account}
                  name={names.get(account.wealthfolioAccountId!)}
                  row={byKey.get(account.key)}
                  valuation={valuations.data?.get(account.wealthfolioAccountId!)}
                />
              ))}
              {unmatched.map((row, index) => (
                <OrphanRow key={`orphan-${index}`} row={row} />
              ))}
            </tbody>
          </table>
        </div>
      )}
      {report && !running && <InvalidRows report={report} />}
      <div className="space-y-1">
        <label className="text-muted-foreground flex items-center gap-2 text-xs">
          <input
            type="checkbox"
            checked={detectInterest}
            onChange={(e) => saveOption({ detectInterest: e.target.checked })}
          />
          {t('syncCard.optionInterest')}
        </label>
        <label className="text-muted-foreground flex items-start gap-2 text-xs">
          <input
            type="checkbox"
            className="mt-0.5"
            checked={detectOwnTransfers}
            onChange={(e) => saveOption({ detectOwnTransfers: e.target.checked })}
          />
          <span>{t('syncCard.optionTransfers')}</span>
        </label>
      </div>
    </CollapsibleCard>
  );
}
