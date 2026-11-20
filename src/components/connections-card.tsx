import { useQueryClient } from '@tanstack/react-query';
import type { Account, AccountValuation } from '@wealthfolio/addon-sdk';
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
import { compareBalances, isBookedBalance } from '../lib/balance';
import { firstSafeDate, latestForeignActivityDate } from '../lib/guard';
import { maskIban } from '../lib/mapping';
import {
  addDays,
  daysLeft,
  isExpired,
  toIsoDate,
  type BankConnection,
  type LinkedAccount,
} from '../lib/state';
import {
  QK,
  useAddonCtx,
  useClient,
  useSaveConnections,
  useValuations,
  useWealthfolioAccounts,
  type AddonState,
} from '../hooks/use-addon-data';
import { errorText, formatDate, formatDateTime, formatMoney, NativeSelect } from './ui-bits';

/** Many banks only give ~90 days of history to an unattended request. */
const TYPICAL_HISTORY_DAYS = 90;

function BalanceLine({ account, valuation }: { account: LinkedAccount; valuation?: AccountValuation }) {
  const bank = account.bankBalance;
  if (!bank || !account.wealthfolioAccountId) return null;
  const check = compareBalances(
    bank,
    valuation ? { cashBalance: valuation.cashBalance, accountCurrency: valuation.accountCurrency } : undefined,
  );
  const bankDate = bank.referenceDate ?? bank.fetchedAt;

  return (
    <div className="bg-muted/40 mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 rounded-md px-3 py-2 text-xs">
      <span>
        Banco: <b className="tabular-nums">{formatMoney(Number(bank.amount), bank.currency)}</b>{' '}
        <span className="text-muted-foreground">
          ({bank.type}, {formatDate(bankDate)})
        </span>
      </span>
      {valuation && (
        <span>
          Wealthfolio:{' '}
          <b className="tabular-nums">{formatMoney(valuation.cashBalance, valuation.accountCurrency)}</b>{' '}
          <span className="text-muted-foreground">({formatDate(valuation.valuationDate)})</span>
        </span>
      )}
      {check.state === 'match' && <Badge variant="success-subtle">Cuadra</Badge>}
      {check.state === 'match-inverted' && (
        <Badge variant="success-subtle">Cuadra (el banco lo muestra con el signo contrario)</Badge>
      )}
      {check.state === 'mismatch' && (
        <>
          <Badge variant="warning-subtle">
            Descuadre: {formatMoney(check.difference, bank.currency, true)}
          </Badge>
          <span className="text-muted-foreground w-full">
            Puede faltar historial anterior a la fecha de inicio, haber movimientos pendientes o
            rechazados, o Wealthfolio no haber terminado de recalcular.
            {!isBookedBalance(bank) && ' El banco solo da saldo disponible, que puede incluir crédito o retenciones.'}
          </span>
        </>
      )}
      {check.state === 'unknown' && check.reason === 'currency' && (
        <span className="text-muted-foreground">Divisas distintas: no se compara.</span>
      )}
    </div>
  );
}

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
  valuation,
  checking,
  onChange,
  onChooseTarget,
}: {
  account: LinkedAccount;
  wfAccounts: Account[];
  duplicateTarget: boolean;
  valuation?: AccountValuation;
  /** True while looking up what is already in the chosen Wealthfolio account. */
  checking: boolean;
  onChange: (patch: Partial<LinkedAccount>) => void;
  onChooseTarget: (wealthfolioAccountId: string | null) => void;
}) {
  const target = wfAccounts.find((a) => a.id === account.wealthfolioAccountId);
  const currencyMismatch = target && account.currency && target.currency !== account.currency;
  const sorted = [...wfAccounts].sort((a, b) => {
    const score = (x: Account) => (x.currency === account.currency ? 0 : 1) + (x.accountType === 'SECURITIES' ? 1 : 0);
    return score(a) - score(b) || a.name.localeCompare(b.name, 'es');
  });
  const today = toIsoDate(new Date());
  const overlapsExisting = Boolean(account.existingUntil && account.syncFrom <= account.existingUntil);
  const beyondTypicalHistory = account.syncFrom < addDays(today, -TYPICAL_HISTORY_DAYS);

  return (
    <div className="border-t py-3 first:border-t-0">
    <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-start">
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
          disabled={checking}
          onChange={(e) => onChooseTarget(e.target.value || null)}
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
      <div className="space-y-1 sm:w-48">
        {account.lastSyncedAt ? (
          <div className="text-muted-foreground text-xs">
            Última sincronización:
            <br />
            {formatDateTime(account.lastSyncedAt)}
            {account.retryFrom && (
              <>
                <br />
                Se vuelve a revisar desde el {formatDate(account.retryFrom)}
              </>
            )}
          </div>
        ) : (
          <>
            <Input
              type="date"
              aria-label="Importar movimientos desde"
              value={account.syncFrom}
              max={account.syncFrom > today ? account.syncFrom : today}
              onChange={(e) => e.target.value && onChange({ syncFrom: e.target.value })}
              disabled={!account.wealthfolioAccountId || checking}
            />
            <p className="text-muted-foreground text-xs">
              {checking ? 'Comprobando movimientos existentes…' : 'Importar desde'}
            </p>
            {account.wealthfolioAccountId && account.existingUntil && (
              <p
                className={`text-xs ${overlapsExisting ? 'text-amber-600 dark:text-amber-400' : 'text-muted-foreground'}`}
              >
                La cuenta ya tiene movimientos hasta el {formatDate(account.existingUntil)} (CSV u
                otros). {overlapsExisting
                  ? `Empieza el ${formatDate(firstSafeDate(account.existingUntil))} o después para no duplicarlos.`
                  : 'Se importará a partir de ahí.'}
              </p>
            )}
            {account.wealthfolioAccountId && beyondTypicalHistory && (
              <p className="text-muted-foreground text-xs">
                Muchos bancos solo dan {TYPICAL_HISTORY_DAYS} días de historial: comprueba después que
                el saldo cuadra.
              </p>
            )}
          </>
        )}
      </div>
    </div>
    <BalanceLine account={account} valuation={valuation} />
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
  const [checking, setChecking] = useState<string | null>(null);

  const usable = (wfAccounts.data ?? []).filter(
    (a) => a.isActive && !a.isArchived && a.trackingMode !== 'HOLDINGS',
  );
  const valuations = useValuations(
    state.connections.flatMap((c) =>
      c.accounts.filter((a) => a.wealthfolioAccountId && a.bankBalance).map((a) => a.wealthfolioAccountId!),
    ),
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

  /**
   * A new destination starts its own history. If the Wealthfolio account already
   * has movements from elsewhere (a CSV, manual entries), start the day after the
   * latest one: Wealthfolio would not recognise them as the same movements.
   */
  const chooseTarget = async (sessionId: string, account: LinkedAccount, wealthfolioAccountId: string | null) => {
    setError(null);
    const patch: Partial<LinkedAccount> = {
      wealthfolioAccountId,
      lastSyncedDate: undefined,
      lastSyncedAt: undefined,
      retryFrom: undefined,
      existingUntil: undefined,
    };
    if (wealthfolioAccountId) {
      setChecking(account.key);
      try {
        const existing = await latestForeignActivityDate(ctx.api.activities, wealthfolioAccountId);
        if (existing) {
          patch.existingUntil = existing;
          const safe = firstSafeDate(existing);
          if (account.syncFrom < safe) patch.syncFrom = safe;
        }
      } catch (e) {
        setError(`No se pudo comprobar qué movimientos hay ya en esa cuenta: ${errorText(e)}`);
      } finally {
        setChecking(null);
      }
    }
    await updateAccount(sessionId, account.key, patch);
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
                valuation={
                  account.wealthfolioAccountId
                    ? valuations.data?.get(account.wealthfolioAccountId)
                    : undefined
                }
                checking={checking === account.key}
                onChange={(patch) => updateAccount(connection.sessionId, account.key, patch)}
                onChooseTarget={(id) => chooseTarget(connection.sessionId, account, id)}
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
