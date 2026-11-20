import { daysBetween } from './state';

/**
 * Words Spanish banks use for money moved between the holder's own accounts or
 * cards. Ordinary "transferencia" is left out on purpose: it is just as common
 * for payments to other people.
 */
export const OWN_TRANSFER_PATTERN =
  /\b(traspaso|traspasos|recarga|recargas|liquidaci[oó]n\s+(de\s+)?(la\s+)?tarjeta|pago\s+(de\s+)?(la\s+)?tarjeta|amortizaci[oó]n\s+(de\s+)?tarjeta|cuenta\s+propia|own\s+account)\b/iu;

/** Maximum days between the two sides of one transfer (banks book them apart). */
export const MAX_TRANSFER_GAP_DAYS = 3;

export interface TransferCandidate {
  /** Caller's handle for the row. */
  key: number;
  accountId: string;
  activityType: string;
  date: string;
  /** Positive decimal string. */
  amount: string;
  currency: string;
  comment?: string;
}

export interface OwnTransferContext {
  /** Wealthfolio account type by account id (CREDIT_CARD, CASH…). */
  accountTypes: ReadonlyMap<string, string>;
  maxGapDays?: number;
}

function amountCents(amount: string): number | null {
  const value = Number(amount);
  return Number.isFinite(value) ? Math.round(Math.abs(value) * 100) : null;
}

function looksInternal(out: TransferCandidate, incoming: TransferCandidate, context: OwnTransferContext) {
  const isCard = (accountId: string) => context.accountTypes.get(accountId) === 'CREDIT_CARD';
  return (
    isCard(out.accountId) ||
    isCard(incoming.accountId) ||
    OWN_TRANSFER_PATTERN.test(out.comment ?? '') ||
    OWN_TRANSFER_PATTERN.test(incoming.comment ?? '')
  );
}

/**
 * Finds withdrawals and deposits that are the two sides of one transfer between
 * the user's own synced accounts when the bank gives no counterparty IBAN.
 *
 * A pair needs two different accounts, the same currency and amount, at most
 * `maxGapDays` between the dates, and a sign that it is internal: one side is a
 * credit card account, or a description says "traspaso", "recarga", "pago
 * tarjeta"... Only one-to-one matches are paired; when a movement could pair
 * with more than one, none of them is touched.
 *
 * Returns [withdrawalKey, depositKey] pairs.
 */
export function findOwnTransferPairs(
  rows: readonly TransferCandidate[],
  context: OwnTransferContext,
): Array<[number, number]> {
  const maxGap = context.maxGapDays ?? MAX_TRANSFER_GAP_DAYS;
  const outs = rows.filter((r) => r.activityType === 'WITHDRAWAL');
  const ins = rows.filter((r) => r.activityType === 'DEPOSIT');

  const matches = (out: TransferCandidate, incoming: TransferCandidate) => {
    if (out.accountId === incoming.accountId) return false;
    if (out.currency.toUpperCase() !== incoming.currency.toUpperCase()) return false;
    const a = amountCents(out.amount);
    if (a === null || a === 0 || a !== amountCents(incoming.amount)) return false;
    if (Math.abs(daysBetween(out.date, incoming.date)) > maxGap) return false;
    return looksInternal(out, incoming, context);
  };

  const candidatesForOut = new Map<number, TransferCandidate[]>();
  const candidatesForIn = new Map<number, TransferCandidate[]>();
  for (const out of outs) {
    for (const incoming of ins) {
      if (!matches(out, incoming)) continue;
      candidatesForOut.set(out.key, [...(candidatesForOut.get(out.key) ?? []), incoming]);
      candidatesForIn.set(incoming.key, [...(candidatesForIn.get(incoming.key) ?? []), out]);
    }
  }

  const pairs: Array<[number, number]> = [];
  for (const out of outs) {
    const options = candidatesForOut.get(out.key) ?? [];
    if (options.length !== 1) continue;
    const incoming = options[0];
    if ((candidatesForIn.get(incoming.key) ?? []).length !== 1) continue;
    pairs.push([out.key, incoming.key]);
  }
  return pairs;
}
