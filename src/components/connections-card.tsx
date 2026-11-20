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
import { useEffect, useRef, useState } from 'react';
import { compareBalances, isBookedBalance } from '../lib/balance';
import { maskIban } from '../lib/mapping';
import {
  addDays,
  daysLeft,
  isExpired,
  isValidStartDate,
  MIN_START_DATE,
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
import { useText } from '../i18n';
import { NativeSelect } from './ui-bits';

/** Many banks only give ~90 days of history to an unattended request. */
const TYPICAL_HISTORY_DAYS = 90;

function BalanceLine({ account, valuation }: { account: LinkedAccount; valuation?: AccountValuation }) {
  const { t, formatDay, formatMoney } = useText();
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
        {t('connections.balanceBank')} <b className="tabular-nums">{formatMoney(Number(bank.amount), bank.currency)}</b>{' '}
        <span className="text-muted-foreground">
          ({bank.type}, {formatDay(bankDate)})
        </span>
      </span>
      {valuation && (
        <span>
          {t('connections.balanceWealthfolio')}{' '}
          <b className="tabular-nums">{formatMoney(valuation.cashBalance, valuation.accountCurrency)}</b>{' '}
          <span className="text-muted-foreground">({formatDay(valuation.valuationDate)})</span>
        </span>
      )}
      {check.state === 'match' && <Badge variant="success-subtle">{t('connections.balanceMatch')}</Badge>}
      {check.state === 'match-inverted' && (
        <Badge variant="success-subtle">{t('connections.balanceMatchInverted')}</Badge>
      )}
      {check.state === 'mismatch' && (
        <>
          <Badge variant="warning-subtle">
            {t('connections.balanceMismatch', { difference: formatMoney(check.difference, bank.currency, true) })}
          </Badge>
          <span className="text-muted-foreground w-full">
            {t('connections.balanceMismatchHelp')}
            {!isBookedBalance(bank) && ` ${t('connections.balanceAvailableOnly')}`}
          </span>
        </>
      )}
      {check.state === 'unknown' && check.reason === 'currency' && (
        <span className="text-muted-foreground">{t('connections.balanceCurrencies')}</span>
      )}
    </div>
  );
}

function ConsentBadge({ connection }: { connection: BankConnection }) {
  const { t, formatDay } = useText();
  if (isExpired(connection)) return <Badge variant="destructive-subtle">{t('connections.consentExpired')}</Badge>;
  const days = daysLeft(connection);
  if (days <= 7) return <Badge variant="warning-subtle">{t('connections.expiresIn', { n: days })}</Badge>;
  return (
    <Badge variant="success-subtle">
      {t('connections.validUntil', { date: formatDay(toIsoDate(new Date(connection.validUntil))) })}
    </Badge>
  );
}

function accountLabel(account: Account, t: (key: string) => string): string {
  const types: Record<string, string> = {
    CASH: t('connections.typeCash'),
    CREDIT_CARD: t('connections.typeCard'),
    SECURITIES: t('connections.typeSecurities'),
    CRYPTOCURRENCY: t('connections.typeCrypto'),
  };
  const type = types[account.accountType] ?? account.accountType.toLowerCase();
  return `${account.name} (${account.currency}, ${type})`;
}

/**
 * Start date field. While you type a year the browser reports partial dates
 * (0002, 0020, 0202…); saving each one and redrawing the field would reset the
 * year being typed. So the field keeps its own draft and only saves complete,
 * valid dates (or what is there when you leave the field).
 */
function StartDateInput({
  account,
  today,
  onCommit,
}: {
  account: LinkedAccount;
  today: string;
  onCommit: (syncFrom: string) => void;
}) {
  const { t, formatDay } = useText();
  const saved = account.syncFromConfirmed ? account.syncFrom : '';
  const [draft, setDraft] = useState(saved);
  const [focused, setFocused] = useState(false);
  const focusedRef = useRef(false);

  // Follow changes saved from elsewhere (e.g. another destination account), but
  // never overwrite what is being typed.
  useEffect(() => {
    if (!focusedRef.current) setDraft(saved);
  }, [saved]);

  const commit = (value: string) => {
    if (!isValidStartDate(value, today)) return;
    if (value !== account.syncFrom || !account.syncFromConfirmed) onCommit(value);
  };

  return (
    <>
      <Input
        type="date"
        aria-label={t('connections.startDateLabel')}
        value={draft}
        min={MIN_START_DATE}
        max={today}
        onFocus={() => {
          focusedRef.current = true;
          setFocused(true);
        }}
        onChange={(e) => {
          setDraft(e.target.value);
          commit(e.target.value);
        }}
        onBlur={() => {
          focusedRef.current = false;
          setFocused(false);
          commit(draft);
        }}
        disabled={!account.wealthfolioAccountId}
      />
      {!focused && draft !== '' && !isValidStartDate(draft, today) && (
        <p className="text-destructive text-xs">{t('connections.invalidDate', { min: formatDay(MIN_START_DATE) })}</p>
      )}
    </>
  );
}

function AccountRow({
  account,
  wfAccounts,
  duplicateTarget,
  valuation,
  onChange,
  onChooseTarget,
}: {
  account: LinkedAccount;
  wfAccounts: Account[];
  duplicateTarget: boolean;
  valuation?: AccountValuation;
  onChange: (patch: Partial<LinkedAccount>) => void;
  onChooseTarget: (wealthfolioAccountId: string | null) => void;
}) {
  const { t, language, formatDay, formatWhen } = useText();
  const target = wfAccounts.find((a) => a.id === account.wealthfolioAccountId);
  const currencyMismatch = target && account.currency && target.currency !== account.currency;
  const sorted = [...wfAccounts].sort((a, b) => {
    const score = (x: Account) => (x.currency === account.currency ? 0 : 1) + (x.accountType === 'SECURITIES' ? 1 : 0);
    return score(a) - score(b) || a.name.localeCompare(b.name, language);
  });
  const today = toIsoDate(new Date());
  const beyondTypicalHistory =
    Boolean(account.syncFromConfirmed) && account.syncFrom < addDays(today, -TYPICAL_HISTORY_DAYS);

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
          aria-label={t('connections.targetLabel', { account: account.name })}
          value={account.wealthfolioAccountId ?? ''}
          onChange={(e) => onChooseTarget(e.target.value || null)}
        >
          <option value="">{t('connections.noSync')}</option>
          {sorted.map((wf) => (
            <option key={wf.id} value={wf.id}>
              {accountLabel(wf, t)}
            </option>
          ))}
        </NativeSelect>
        {currencyMismatch && (
          <p className="text-xs text-amber-600 dark:text-amber-400">
            {t('connections.currencyMismatch', { bankCurrency: account.currency, wealthfolioCurrency: target.currency })}
          </p>
        )}
        {duplicateTarget && (
          <p className="text-xs text-amber-600 dark:text-amber-400">{t('connections.duplicateTarget')}</p>
        )}
      </div>
      <div className="space-y-1 sm:w-44">
        {account.lastSyncedAt ? (
          <div className="text-muted-foreground text-xs">
            {t('connections.lastSync')}
            <br />
            {formatWhen(account.lastSyncedAt)}
            {account.retryFrom && (
              <>
                <br />
                {t('connections.retryFrom', { date: formatDay(account.retryFrom) })}
              </>
            )}
          </div>
        ) : (
          <>
            <StartDateInput
              account={account}
              today={today}
              onCommit={(syncFrom) => onChange({ syncFrom, syncFromConfirmed: true })}
            />
            <p className="text-muted-foreground text-xs">{t('connections.importFrom')}</p>
            {account.wealthfolioAccountId && !account.syncFromConfirmed && (
              <p className="text-xs text-amber-600 dark:text-amber-400">{t('connections.chooseStart')}</p>
            )}
            {account.wealthfolioAccountId && beyondTypicalHistory && (
              <p className="text-muted-foreground text-xs">
                {t('connections.historyHint', { days: TYPICAL_HISTORY_DAYS })}
              </p>
            )}
          </>
        )}
      </div>
    </div>
    <HistoryLine account={account} />
    <BalanceLine account={account} valuation={valuation} />
    </div>
  );
}

/** What the bank gave the last time the add-on asked for the longest history. */
function HistoryLine({ account }: { account: LinkedAccount }) {
  const { t, formatDay, formatWhen } = useText();
  const history = account.history;
  if (!history || !account.wealthfolioAccountId) return null;
  return (
    <p className="text-muted-foreground mt-2 text-xs">
      {history.earliest
        ? t('connections.historyGiven', {
            earliest: formatDay(history.earliest),
            requested: formatDay(history.requestedFrom),
            checked: formatWhen(history.checkedAt),
          })
        : t('connections.historyNone', {
            requested: formatDay(history.requestedFrom),
            checked: formatWhen(history.checkedAt),
          })}
    </p>
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
  const { t, errorText } = useText();
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
   * A new destination starts its own history, and its start date has to be chosen
   * again: only the user knows what that Wealthfolio account already holds.
   */
  const chooseTarget = async (sessionId: string, account: LinkedAccount, wealthfolioAccountId: string | null) => {
    setError(null);
    await updateAccount(sessionId, account.key, {
      wealthfolioAccountId,
      syncFromConfirmed: false,
      lastSyncedDate: undefined,
      lastSyncedAt: undefined,
      retryFrom: undefined,
    });
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
      ctx.api.toast.success(t('connections.disconnectedToast', { bank: connection.aspsp.name }));
    } catch (e) {
      setError(errorText(e));
    }
  };

  if (state.connections.length === 0) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{t('connections.title')}</CardTitle>
        <CardDescription>{t('connections.description', { none: t('connections.noSync') })}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {wfAccounts.isSuccess && usable.length === 0 && (
          <Alert variant="warning">
            <AlertDescription>{t('connections.noAccounts')}</AlertDescription>
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
                  <span>{t('connections.confirmDisconnect')}</span>
                  <Button size="sm" variant="destructive" onClick={() => disconnect(connection)}>
                    {t('connections.yesDisconnect')}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setConfirming(null)}>
                    {t('common.cancel')}
                  </Button>
                </div>
              ) : (
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" onClick={() => onReconnect(connection.aspsp)}>
                    <RotateCcw className="size-4" /> {t('connections.renew')}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setConfirming(connection.sessionId)}>
                    <Unplug className="size-4" /> {t('connections.disconnect')}
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
