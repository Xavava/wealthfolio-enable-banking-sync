import { useQueryClient } from '@tanstack/react-query';
import { QueryKeys } from '@wealthfolio/addon-sdk';
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@wealthfolio/ui';
import { LoaderCircle, RefreshCw } from 'lucide-react';
import { useState } from 'react';
import { useText } from '../i18n';
import type { Text } from '../lib/messages';
import { store, type SyncReport, type SyncStatus } from '../lib/state';
import { runSync } from '../lib/sync';
import { QK, useAddonCtx, useSaveConnections, type AddonState } from '../hooks/use-addon-data';

function StatusBadge({ status }: { status: SyncStatus }) {
  const { t } = useText();
  if (status === 'ok') return <Badge variant="success-subtle">{t('syncCard.statusOk')}</Badge>;
  if (status === 'reconnect') return <Badge variant="warning-subtle">{t('syncCard.statusReconnect')}</Badge>;
  if (status === 'blocked') return <Badge variant="warning-subtle">{t('syncCard.statusBlocked')}</Badge>;
  return <Badge variant="destructive-subtle">{t('syncCard.statusError')}</Badge>;
}

function ReportView({ report }: { report: SyncReport }) {
  const { t, rich, render, formatDay, formatWhen } = useText();
  return (
    <div className="space-y-3">
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
      {report.importError && (
        <Alert variant="destructive">
          <AlertDescription>{render(report.importError)}</AlertDescription>
        </Alert>
      )}
      {report.accounts.length > 0 && (
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
              {report.accounts.map((row, index) => (
                <tr key={index} className="border-t align-top">
                  <td className="px-3 py-2">
                    <div className="font-medium">{row.wealthfolioAccount ?? row.account}</div>
                    <div className="text-muted-foreground text-xs">
                      {row.wealthfolioAccount ? [row.bank, row.iban ?? row.account].join(' · ') : row.bank}
                    </div>
                    {row.message && (
                      <div
                        className={`mt-1 max-w-md text-xs ${row.status === 'ok' ? 'text-muted-foreground' : 'text-amber-600 dark:text-amber-400'}`}
                      >
                        {render(row.message)}
                      </div>
                    )}
                    {row.notes?.map((note: Text, i) => (
                      <div key={i} className="text-muted-foreground mt-1 max-w-md text-xs">
                        {render(note)}
                      </div>
                    ))}
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">{formatDay(row.dateFrom)}</td>
                  <td className="px-3 py-2 text-end tabular-nums">{row.fetched}</td>
                  <td className="px-3 py-2 text-end tabular-nums">{row.imported}</td>
                  <td className="px-3 py-2 text-end tabular-nums">{row.duplicates}</td>
                  <td className="px-3 py-2">
                    <StatusBadge status={row.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {report.invalidRows.length > 0 && (
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
      )}
    </div>
  );
}

export function SyncCard({ state }: { state: AddonState }) {
  const ctx = useAddonCtx();
  const { t, render, errorText } = useText();
  const queryClient = useQueryClient();
  const saveConnections = useSaveConnections();
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<Text>('');
  const [error, setError] = useState<string | null>(null);

  const mapped = state.connections.flatMap((c) => c.accounts).filter((a) => a.wealthfolioAccountId);
  const detectInterest = state.config.detectInterest ?? true;
  const detectOwnTransfers = state.config.detectOwnTransfers ?? true;

  const sync = async () => {
    if (running) return;
    setRunning(true);
    setError(null);
    setProgress(t('syncCard.preparing'));
    try {
      const { report, connections } = await runSync({
        host: ctx.api,
        config: state.config,
        connections: state.connections,
        detectInterest,
        detectOwnTransfers,
        onProgress: setProgress,
        transferLabels: { from: t('sync.transferFrom'), to: t('sync.transferTo') },
      });
      await saveConnections(connections);
      await store.saveLastReport(ctx.api.storage, report);
      await queryClient.invalidateQueries({ queryKey: QK.state });
      await queryClient.invalidateQueries({ queryKey: QK.valuations });
      if (report.imported > 0) {
        ctx.api.query.invalidateQueries(QueryKeys.ACTIVITIES);
        ctx.api.query.invalidateQueries(QueryKeys.ACCOUNTS);
        ctx.api.query.invalidateQueries(QueryKeys.HOLDINGS);
      }
      const failures = report.accounts.filter((a) => a.status !== 'ok').length;
      if (failures > 0 || report.importError) {
        ctx.api.toast.error(t('syncCard.toastIssues', { n: report.imported }));
      } else {
        ctx.api.toast.success(
          report.imported > 0
            ? t('syncCard.toastImported', { n: report.imported })
            : t('syncCard.toastUpToDate'),
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
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center justify-between gap-3 text-base">
          <span>{t('syncCard.title')}</span>
          <Button size="lg" onClick={sync} disabled={running || mapped.length === 0}>
            {running ? <LoaderCircle className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
            {running ? t('syncCard.syncing') : t('syncCard.syncNow')}
          </Button>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {mapped.length === 0 && (
          <p className="text-muted-foreground text-sm">{t('syncCard.noMapped')}</p>
        )}
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
        {state.lastReport && !running && <ReportView report={state.lastReport} />}
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
      </CardContent>
    </Card>
  );
}
