import { useQueryClient } from '@tanstack/react-query';
import type { Account } from '@wealthfolio/addon-sdk';
import {
  Alert,
  AlertDescription,
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Input,
} from '@wealthfolio/ui';
import { RotateCcw, Unplug } from 'lucide-react';
import { useState } from 'react';
import { maskIban } from '../lib/mapping';
import { daysLeft, isExpired, type BankConnection, type LinkedAccount } from '../lib/state';
import {
  QK,
  useAddonCtx,
  useClient,
  useSaveConnections,
  useWealthfolioAccounts,
  type AddonState,
} from '../hooks/use-addon-data';
import { errorText, formatDate, formatDateTime, NativeSelect } from './ui-bits';

function ConsentBadge({ connection }: { connection: BankConnection }) {
  if (isExpired(connection)) return <Badge variant="destructive-subtle">Consentimiento caducado</Badge>;
  const days = daysLeft(connection);
  if (days <= 7) return <Badge variant="warning-subtle">Caduca en {days} día(s)</Badge>;
  return <Badge variant="success-subtle">Válido hasta {formatDate(connection.validUntil)}</Badge>;
}

function accountLabel(account: Account): string {
  const types: Record<string, string> = {
    CASH: 'efectivo',
    CREDIT_CARD: 'tarjeta',
    SECURITIES: 'inversión',
    CRYPTOCURRENCY: 'cripto',
  };
  const type = types[account.accountType] ?? account.accountType.toLowerCase();
  return `${account.name} (${account.currency}, ${type})`;
}

function AccountRow({
  account,
  wfAccounts,
  duplicateTarget,
  onChange,
}: {
  account: LinkedAccount;
  wfAccounts: Account[];
  duplicateTarget: boolean;
  onChange: (patch: Partial<LinkedAccount>) => void;
}) {
  const target = wfAccounts.find((a) => a.id === account.wealthfolioAccountId);
  const currencyMismatch = target && account.currency && target.currency !== account.currency;
  const sorted = [...wfAccounts].sort((a, b) => {
    const score = (x: Account) => (x.currency === account.currency ? 0 : 1) + (x.accountType === 'SECURITIES' ? 1 : 0);
    return score(a) - score(b) || a.name.localeCompare(b.name, 'es');
  });

  return (
    <div className="grid gap-3 border-t py-3 first:border-t-0 sm:grid-cols-[1fr_1fr_auto] sm:items-start">
      <div className="min-w-0">
        <div className="truncate font-medium">{account.name}</div>
        <div className="text-muted-foreground text-xs">
          {[maskIban(account.iban), account.currency, account.cashAccountType].filter(Boolean).join(' · ')}
        </div>
      </div>
      <div className="space-y-1">
        <NativeSelect
          aria-label={`Cuenta de Wealthfolio para ${account.name}`}
          value={account.wealthfolioAccountId ?? ''}
          onChange={(e) =>
            onChange({
              wealthfolioAccountId: e.target.value || null,
              // A new destination starts its own history.
              lastSyncedDate: undefined,
              lastSyncedAt: undefined,
            })
          }
        >
          <option value="">No sincronizar</option>
          {sorted.map((wf) => (
            <option key={wf.id} value={wf.id}>
              {accountLabel(wf)}
            </option>
          ))}
        </NativeSelect>
        {currencyMismatch && (
          <p className="text-xs text-amber-600 dark:text-amber-400">
            La cuenta del banco está en {account.currency} y la de Wealthfolio en {target.currency}.
          </p>
        )}
        {duplicateTarget && (
          <p className="text-xs text-amber-600 dark:text-amber-400">
            Otra cuenta bancaria también se sincroniza con esta cuenta de Wealthfolio.
          </p>
        )}
      </div>
      <div className="space-y-1 sm:w-40">
        {account.lastSyncedAt ? (
          <div className="text-muted-foreground text-xs">
            Última sincronización:
            <br />
            {formatDateTime(account.lastSyncedAt)}
          </div>
        ) : (
          <>
            <Input
              type="date"
              aria-label="Importar movimientos desde"
              value={account.syncFrom}
              max={new Date().toISOString().slice(0, 10)}
              onChange={(e) => e.target.value && onChange({ syncFrom: e.target.value })}
              disabled={!account.wealthfolioAccountId}
            />
            <p className="text-muted-foreground text-xs">Importar desde</p>
          </>
        )}
      </div>
    </div>
  );
}

export function ConnectionsCard({
  state,
  onReconnect,
}: {
  state: AddonState;
  onReconnect: (aspsp: { name: string; country: string }) => void;
}) {
  const ctx = useAddonCtx();
  const queryClient = useQueryClient();
  const client = useClient(state);
  const saveConnections = useSaveConnections();
  const wfAccounts = useWealthfolioAccounts();
  const [error, setError] = useState<string | null>(null);
  // window.confirm() is blocked inside the add-on sandbox, so confirm inline.
  const [confirming, setConfirming] = useState<string | null>(null);

  const usable = (wfAccounts.data ?? []).filter(
    (a) => a.isActive && !a.isArchived && a.trackingMode !== 'HOLDINGS',
  );

  const targetCounts = new Map<string, number>();
  for (const c of state.connections)
    for (const a of c.accounts)
      if (a.wealthfolioAccountId)
        targetCounts.set(a.wealthfolioAccountId, (targetCounts.get(a.wealthfolioAccountId) ?? 0) + 1);

  const updateAccount = async (sessionId: string, key: string, patch: Partial<LinkedAccount>) => {
    const next = state.connections.map((c) =>
      c.sessionId !== sessionId
        ? c
        : { ...c, accounts: c.accounts.map((a) => (a.key === key ? { ...a, ...patch } : a)) },
    );
    await saveConnections(next);
  };

  const disconnect = async (connection: BankConnection) => {
    setError(null);
    setConfirming(null);
    try {
      if (client && !isExpired(connection)) {
        await client.deleteSession(connection.sessionId).catch(() => undefined);
      }
      await saveConnections(state.connections.filter((c) => c.sessionId !== connection.sessionId));
      await queryClient.invalidateQueries({ queryKey: QK.state });
      ctx.api.toast.success(`${connection.aspsp.name} desconectado`);
    } catch (e) {
      setError(errorText(e));
    }
  };

  if (state.connections.length === 0) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Bancos conectados</CardTitle>
        <CardDescription>
          Elige en qué cuenta de Wealthfolio entra cada cuenta del banco. Las cuentas en «No
          sincronizar» se ignoran.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {wfAccounts.isSuccess && usable.length === 0 && (
          <Alert variant="warning">
            <AlertDescription>
              No tienes cuentas de Wealthfolio en modo transacciones. Crea una cuenta de tipo
              efectivo (o tarjeta) en Wealthfolio y vuelve aquí.
            </AlertDescription>
          </Alert>
        )}
        {state.connections.map((connection) => (
          <div key={connection.sessionId} className="rounded-lg border p-4">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-semibold">{connection.aspsp.name}</span>
                <ConsentBadge connection={connection} />
              </div>
              {confirming === connection.sessionId ? (
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <span>¿Desconectar? Lo ya importado se conserva.</span>
                  <Button size="sm" variant="destructive" onClick={() => disconnect(connection)}>
                    Sí, desconectar
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setConfirming(null)}>
                    Cancelar
                  </Button>
                </div>
              ) : (
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" onClick={() => onReconnect(connection.aspsp)}>
                    <RotateCcw className="size-4" /> Renovar
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setConfirming(connection.sessionId)}>
                    <Unplug className="size-4" /> Desconectar
                  </Button>
                </div>
              )}
            </div>
            {connection.accounts.map((account) => (
              <AccountRow
                key={account.key}
                account={account}
                wfAccounts={usable}
                duplicateTarget={
                  Boolean(account.wealthfolioAccountId) &&
                  (targetCounts.get(account.wealthfolioAccountId!) ?? 0) > 1
                }
                onChange={(patch) => updateAccount(connection.sessionId, account.key, patch)}
              />
            ))}
          </div>
        ))}
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
      </CardContent>
    </Card>
  );
}
