import type { AccountValuation } from '@wealthfolio/addon-sdk';
import { Badge } from '@wealthfolio/ui';
import { useText } from '../i18n';
import { compareBalances, isBookedBalance, withOutdated, type AccountBalanceCheck } from '../lib/balance';
import type { LinkedAccount } from '../lib/state';

/** Bank balance against Wealthfolio's, or null when the bank gave none yet. */
export function balanceCheck(account: LinkedAccount, valuation?: AccountValuation): AccountBalanceCheck | null {
  if (!account.bankBalance || !account.wealthfolioAccountId) return null;
  const check = compareBalances(
    account.bankBalance,
    valuation ? { cashBalance: valuation.cashBalance, accountCurrency: valuation.accountCurrency } : undefined,
  );
  return withOutdated(check, account.balanceOutdated);
}

export function BalanceLine({ account, valuation }: { account: LinkedAccount; valuation?: AccountValuation }) {
  const { t, formatDay, formatMoney } = useText();
  const bank = account.bankBalance;
  const check = balanceCheck(account, valuation);
  if (!bank || !check) return null;
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
      {(check.state === 'mismatch' || check.state === 'outdated') && (
        <>
          <Badge variant="warning-subtle">
            {t('connections.balanceMismatch', { difference: formatMoney(check.difference, bank.currency, true) })}
          </Badge>
          <span className="text-muted-foreground w-full">
            {check.state === 'outdated' ? (
              t('connections.balanceOutdated')
            ) : (
              <>
                {t('connections.balanceMismatchHelp')}
                {!isBookedBalance(bank) && ` ${t('connections.balanceAvailableOnly')}`}
              </>
            )}
          </span>
        </>
      )}
      {check.state === 'unknown' && check.reason === 'currency' && (
        <span className="text-muted-foreground">{t('connections.balanceCurrencies')}</span>
      )}
    </div>
  );
}

/** What the bank gave the last time the add-on asked for the longest history. */
export function HistoryLine({ account }: { account: LinkedAccount }) {
  const { t, formatDay, formatWhen } = useText();
  const history = account.history;
  if (!history || !account.wealthfolioAccountId) return null;
  return (
    <p className="text-muted-foreground mt-1 text-xs">
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
