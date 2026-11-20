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
import { store, type SyncReport, type SyncStatus } from '../lib/state';
import { runSync } from '../lib/sync';
import { QK, useAddonCtx, useSaveConnections, type AddonState } from '../hooks/use-addon-data';
import { errorText, formatDate, formatDateTime } from './ui-bits';

function StatusBadge({ status }: { status: SyncStatus }) {
  if (status === 'ok') return <Badge variant="success-subtle">OK</Badge>;
  if (status === 'reconnect') return <Badge variant="warning-subtle">Renovar</Badge>;
  if (status === 'blocked') return <Badge variant="warning-subtle">Revisar fecha</Badge>;
  return <Badge variant="destructive-subtle">Error</Badge>;
}

function ReportView({ report }: { report: SyncReport }) {
  return (
    <div className="space-y-3">
      <div className="text-muted-foreground text-sm">
        Última sincronización: {formatDateTime(report.finishedAt)} · <b>{report.imported}</b> nuevo(s) ·{' '}
        {report.duplicates} ya importado(s)
        {(report.ownTransfers ?? 0) > 0 && <> · {report.ownTransfers} traspaso(s) entre tus cuentas</>}
        {report.invalid > 0 && <> · <span className="text-destructive">{report.invalid} con errores</span></>}
      </div>
      {report.importError && (
        <Alert variant="destructive">
          <AlertDescription>{report.importError}</AlertDescription>
        </Alert>
      )}
      {report.accounts.length > 0 && (
        <div className="overflow-x-auto rounded-md border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-muted-foreground text-xs">
              <tr>
                <th className="px-3 py-2 text-start font-medium whitespace-nowrap">Cuenta</th>
                <th className="px-3 py-2 text-start font-medium whitespace-nowrap">Desde</th>
                <th className="px-3 py-2 text-end font-medium whitespace-nowrap">Descargados</th>
                <th className="px-3 py-2 text-end font-medium whitespace-nowrap">Nuevos</th>
                <th className="px-3 py-2 text-end font-medium whitespace-nowrap">Ya estaban</th>
                <th className="px-3 py-2 text-start font-medium whitespace-nowrap">Estado</th>
              </tr>
            </thead>
            <tbody>
              {report.accounts.map((row, index) => (
                <tr key={index} className="border-t align-top">
                  <td className="px-3 py-2">
                    <div className="font-medium">{row.account}</div>
                    <div className="text-muted-foreground text-xs">{row.bank}</div>
                    {row.message && (
                      <div
                        className={`mt-1 max-w-md text-xs ${row.status === 'ok' ? 'text-muted-foreground' : 'text-amber-700 dark:text-amber-400'}`}
                      >
                        {row.message}
                      </div>
                    )}
                    {row.notes?.map((note, i) => (
                      <div key={i} className="text-muted-foreground mt-1 max-w-md text-xs">
                        {note}
                      </div>
                    ))}
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">{formatDate(row.dateFrom)}</td>
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
            {report.invalidRows.length} movimiento(s) que Wealthfolio no aceptó
          </summary>
          <ul className="mt-2 space-y-2">
            {report.invalidRows.slice(0, 50).map((row, index) => (
              <li key={index} className="text-xs">
                <div>
                  {formatDate(row.date)} · {row.amount} · {row.account}
                </div>
                {row.comment && <div className="text-muted-foreground">{row.comment}</div>}
                <div className="text-destructive">{row.errors.join('; ')}</div>
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
  const queryClient = useQueryClient();
  const saveConnections = useSaveConnections();
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState('');
  const [error, setError] = useState<string | null>(null);

  const mapped = state.connections.flatMap((c) => c.accounts).filter((a) => a.wealthfolioAccountId);
  const detectInterest = state.config.detectInterest ?? true;
  const detectOwnTransfers = state.config.detectOwnTransfers ?? true;

  const sync = async () => {
    if (running) return;
    setRunning(true);
    setError(null);
    setProgress('Preparando…');
    try {
      const { report, connections } = await runSync({
        host: ctx.api,
        config: state.config,
        connections: state.connections,
        detectInterest,
        detectOwnTransfers,
        onProgress: setProgress,
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
        ctx.api.toast.error(`Sincronización con incidencias: ${report.imported} movimiento(s) nuevo(s)`);
      } else {
        ctx.api.toast.success(
          report.imported > 0
            ? `${report.imported} movimiento(s) nuevo(s) importado(s)`
            : 'Todo al día: no hay movimientos nuevos',
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
          <span>Sincronización</span>
          <Button size="lg" onClick={sync} disabled={running || mapped.length === 0}>
            {running ? <LoaderCircle className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
            {running ? 'Sincronizando…' : 'Sincronizar ahora'}
          </Button>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {mapped.length === 0 && (
          <p className="text-muted-foreground text-sm">
            Conecta un banco y asigna al menos una de sus cuentas a una cuenta de Wealthfolio para
            poder sincronizar.
          </p>
        )}
        {running && progress && (
          <div className="text-muted-foreground flex items-center gap-2 text-sm">
            <LoaderCircle className="size-4 animate-spin" /> {progress}
          </div>
        )}
        {error && (
          <Alert variant="destructive">
            <AlertTitle>No se pudo sincronizar</AlertTitle>
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
            Registrar como «Intereses» los ingresos cuyo concepto contenga «intereses»
          </label>
          <label className="text-muted-foreground flex items-start gap-2 text-xs">
            <input
              type="checkbox"
              className="mt-0.5"
              checked={detectOwnTransfers}
              onChange={(e) => saveOption({ detectOwnTransfers: e.target.checked })}
            />
            <span>
              Registrar como traspaso un cargo y un abono del mismo importe entre dos de tus cuentas
              sincronizadas (hasta 3 días de diferencia) cuando una es de tarjeta o el concepto dice
              «traspaso», «recarga» o «pago tarjeta»
            </span>
          </label>
        </div>
      </CardContent>
    </Card>
  );
}
