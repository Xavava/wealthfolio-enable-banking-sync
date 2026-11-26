import type { EbBalance } from './eb-types';
import type { BankBalance } from './state';

/**
 * Booked balances first: Wealthfolio only holds booked movements, so a booked
 * balance is the one that should match. Intraday (ITBD) before closing (CLBD)
 * because the sync also imports what was booked today.
 */
export const BALANCE_PREFERENCE = [
  'ITBD',
  'CLBD',
  'OPBD',
  'XPCD',
  'PRCD',
  'ITAV',
  'CLAV',
  'OPAV',
  'FWAV',
  'VALU',
  'INFO',
  'OTHR',
];

const BOOKED_TYPES = new Set(['ITBD', 'CLBD', 'OPBD']);

const AMOUNT_PATTERN = /^[+-]?\d+(\.\d+)?$/;

export function isBookedBalance(balance: BankBalance): boolean {
  return BOOKED_TYPES.has(balance.type);
}

/** Picks the most comparable balance the bank returned, or null when none is usable. */
export function pickBalance(balances: readonly EbBalance[], fetchedAt: string): BankBalance | null {
  const usable = balances.filter(
    (b) => b?.balance_amount && AMOUNT_PATTERN.test(String(b.balance_amount.amount ?? '').trim()),
  );
  if (usable.length === 0) return null;
  const rank = (b: EbBalance) => {
    const index = BALANCE_PREFERENCE.indexOf((b.balance_type ?? '').toUpperCase());
    return index < 0 ? BALANCE_PREFERENCE.length : index;
  };
  const best = [...usable].sort((a, b) => rank(a) - rank(b))[0];
  return {
    amount: String(best.balance_amount.amount).trim().replace(/^\+/, ''),
    currency: best.balance_amount.currency,
    type: (best.balance_type ?? 'OTHR').toUpperCase(),
    referenceDate: best.reference_date ? best.reference_date.slice(0, 10) : undefined,
    fetchedAt,
  };
}

export type BalanceCheck =
  | { state: 'match' }
  /** Same figure with the opposite sign: usual for credit cards (debt shown as positive). */
  | { state: 'match-inverted' }
  /** Wealthfolio minus bank, in the account currency. */
  | { state: 'mismatch'; difference: number }
  | { state: 'unknown'; reason: 'no-bank' | 'no-wealthfolio' | 'currency' };

function cents(value: number): number {
  return Math.round(value * 100);
}

export function compareBalances(
  bank: BankBalance | undefined,
  wealthfolio: { cashBalance: number; accountCurrency: string } | undefined,
): BalanceCheck {
  if (!bank) return { state: 'unknown', reason: 'no-bank' };
  if (!wealthfolio || !Number.isFinite(wealthfolio.cashBalance)) {
    return { state: 'unknown', reason: 'no-wealthfolio' };
  }
  if (bank.currency.toUpperCase() !== wealthfolio.accountCurrency.toUpperCase()) {
    return { state: 'unknown', reason: 'currency' };
  }
  const bankCents = cents(Number(bank.amount));
  const wfCents = cents(wealthfolio.cashBalance);
  if (bankCents === wfCents) return { state: 'match' };
  if (bankCents !== 0 && bankCents === -wfCents) return { state: 'match-inverted' };
  return { state: 'mismatch', difference: (wfCents - bankCents) / 100 };
}

/** A difference expected because movements came in after the bank gave its balance. */
export type AccountBalanceCheck = BalanceCheck | { state: 'outdated' };

/**
 * The check shown for an account: a difference while its balance is out of date
 * is not a problem to review, only a balance to read again.
 */
export function withOutdated(check: BalanceCheck, balanceOutdated?: boolean): AccountBalanceCheck {
  return check.state === 'mismatch' && balanceOutdated ? { state: 'outdated' } : check;
}
