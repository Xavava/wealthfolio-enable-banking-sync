import type { ActivityImport, ActivityType } from '@wealthfolio/addon-sdk';
import type { EbAccount, EbTransaction } from './eb-types';
import { sha256Hex } from './jwt';
import type { LinkedAccount } from './state';

export function normalizeIban(value?: string | null): string | undefined {
  const normalized = (value ?? '').replace(/\s+/g, '').toUpperCase();
  return normalized || undefined;
}

export function maskIban(iban?: string): string {
  if (!iban) return '';
  return iban.length <= 8 ? iban : `${iban.slice(0, 4)} •••• ${iban.slice(-4)}`;
}

/** Converts an Enable Banking account into the add-on's stored representation. */
export function toLinkedAccount(account: EbAccount, defaults: { syncFrom: string }): LinkedAccount {
  const iban =
    normalizeIban(account.account_id?.iban) ??
    normalizeIban(account.all_account_ids?.find((id) => id.scheme_name === 'IBAN')?.identification);
  const other = account.account_id?.other?.identification ?? undefined;
  const name =
    [account.name, account.product].find((value) => value && value.trim())?.trim() ??
    (iban ? maskIban(iban) : other ?? 'Cuenta');
  return {
    key: account.identification_hash || iban || other || account.uid,
    uid: account.uid,
    iban,
    name,
    currency: account.currency ?? undefined,
    cashAccountType: account.cash_account_type ?? undefined,
    wealthfolioAccountId: null,
    syncFrom: defaults.syncFrom,
  };
}

/** Only booked transactions are imported: pending ones can still change or disappear. */
export function isBooked(tx: EbTransaction): boolean {
  return !tx.status || tx.status.toUpperCase() === 'BOOK';
}

export function isIncoming(tx: EbTransaction): boolean {
  const indicator = (tx.credit_debit_indicator ?? '').toUpperCase();
  if (indicator === 'CRDT') return true;
  if (indicator === 'DBIT') return false;
  return !String(tx.transaction_amount?.amount ?? '').trim().startsWith('-');
}

/** Absolute amount as a decimal string ("12.30"), or null when it is not a valid non-zero number. */
export function absoluteAmount(tx: EbTransaction): string | null {
  const raw = String(tx.transaction_amount?.amount ?? '').trim().replace(/^[+-]/, '');
  if (!/^\d+(\.\d+)?$/.test(raw)) return null;
  if (Number(raw) === 0) return null;
  return raw;
}

export function transactionDate(tx: EbTransaction): string | null {
  const value = tx.booking_date || tx.value_date || tx.transaction_date;
  return value ? value.slice(0, 10) : null;
}

/**
 * Earliest date a pending movement carries. The booked version keeps a booking
 * date on or after it, so reading again from here is enough to pick it up.
 */
export function pendingDate(tx: EbTransaction): string | null {
  const dates = [tx.transaction_date, tx.value_date, tx.booking_date]
    .filter((d): d is string => Boolean(d))
    .map((d) => d.slice(0, 10))
    .sort();
  return dates[0] ?? null;
}

function remittanceText(tx: EbTransaction): string {
  const info = tx.remittance_information;
  const text = Array.isArray(info) ? info.join(' ') : (info ?? '');
  return text.replace(/\s+/g, ' ').trim();
}

export function counterpartyName(tx: EbTransaction): string {
  const party = isIncoming(tx) ? tx.debtor : tx.creditor;
  return (party?.name ?? '').replace(/\s+/g, ' ').trim();
}

export function counterpartyIban(tx: EbTransaction): string | undefined {
  const account = isIncoming(tx) ? tx.debtor_account : tx.creditor_account;
  return normalizeIban(account?.iban);
}

export function buildComment(tx: EbTransaction): string {
  const parts: string[] = [];
  const name = counterpartyName(tx);
  const remittance = remittanceText(tx);
  if (name) parts.push(name);
  if (remittance && remittance.toLowerCase() !== name.toLowerCase()) parts.push(remittance);
  if (parts.length === 0) {
    const fallback = tx.bank_transaction_code?.description || tx.note || '';
    if (fallback.trim()) parts.push(fallback.trim());
  }
  if (parts.length === 0) {
    const iban = counterpartyIban(tx);
    if (iban) parts.push(`${isIncoming(tx) ? 'Transferencia desde' : 'Transferencia a'} ${maskIban(iban)}`);
  }
  const comment = parts.join(' · ');
  return comment.length > 500 ? `${comment.slice(0, 497)}...` : comment;
}

const INTEREST_PATTERN = /\b(inter[eé]s(es)?|interest)\b/iu;

export interface MappingOptions {
  wealthfolioAccountId: string;
  /** IBAN of the bank account being synced. */
  accountIban?: string;
  /** IBANs of every bank account that is synced into Wealthfolio (for transfer detection). */
  syncedIbans: Set<string>;
  bankName: string;
  /** Classify incoming "intereses" movements as INTEREST instead of DEPOSIT. */
  detectInterest: boolean;
}

export function classify(
  tx: EbTransaction,
  options: Pick<MappingOptions, 'accountIban' | 'syncedIbans' | 'detectInterest'>,
): { activityType: ActivityType; isExternal?: boolean } {
  const incoming = isIncoming(tx);
  const otherIban = counterpartyIban(tx);
  if (otherIban && otherIban !== options.accountIban && options.syncedIbans.has(otherIban)) {
    // Money moving between two of your own synced accounts: an internal transfer.
    return { activityType: incoming ? 'TRANSFER_IN' : 'TRANSFER_OUT', isExternal: false };
  }
  if (incoming && options.detectInterest && INTEREST_PATTERN.test(`${remittanceText(tx)} ${tx.bank_transaction_code?.description ?? ''}`)) {
    return { activityType: 'INTEREST' };
  }
  return { activityType: incoming ? 'DEPOSIT' : 'WITHDRAWAL' };
}

function compact<T extends Record<string, unknown>>(value: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(value).filter(([, v]) => v !== undefined && v !== null && v !== ''),
  ) as Partial<T>;
}

export interface SkippedTransaction {
  reason: 'pending' | 'no-amount' | 'no-date';
  tx: EbTransaction;
}

export interface MappedTransactions {
  rows: ActivityImport[];
  skipped: SkippedTransaction[];
}

/**
 * Converts Enable Banking transactions into Wealthfolio import rows.
 *
 * Each row gets a `sourceRecordId` so Wealthfolio recognises it on later syncs
 * and skips it as a duplicate. The bank's entry reference is used when present;
 * otherwise a fingerprint of the movement plus an occurrence counter, so two
 * identical movements on the same day (two equal coffees) are both kept.
 */
export async function mapTransactions(
  transactions: EbTransaction[],
  options: MappingOptions,
): Promise<MappedTransactions> {
  const rows: ActivityImport[] = [];
  const skipped: SkippedTransaction[] = [];
  const occurrences = new Map<string, number>();

  for (const tx of transactions) {
    if (!isBooked(tx)) {
      skipped.push({ reason: 'pending', tx });
      continue;
    }
    const amount = absoluteAmount(tx);
    if (!amount) {
      skipped.push({ reason: 'no-amount', tx });
      continue;
    }
    const date = transactionDate(tx);
    if (!date) {
      skipped.push({ reason: 'no-date', tx });
      continue;
    }

    const incoming = isIncoming(tx);
    const signedAmount = `${incoming ? '' : '-'}${amount}`;
    const currency = tx.transaction_amount.currency;
    const reference = (tx.entry_reference || tx.transaction_id || '').trim();

    let sourceRecordId: string;
    if (reference) {
      const raw = `ref:${reference}|${date}|${signedAmount}`;
      sourceRecordId = raw.length <= 120 ? raw : `ref:${(await sha256Hex(raw)).slice(0, 40)}`;
    } else {
      const fingerprint = (
        await sha256Hex(
          [
            date,
            tx.value_date ?? '',
            signedAmount,
            currency,
            counterpartyName(tx),
            counterpartyIban(tx) ?? '',
            remittanceText(tx),
          ].join('|'),
        )
      ).slice(0, 40);
      const n = (occurrences.get(fingerprint) ?? 0) + 1;
      occurrences.set(fingerprint, n);
      sourceRecordId = `fp:${fingerprint}:${n}`;
    }

    const { activityType, isExternal } = classify(tx, options);
    const row: ActivityImport = {
      accountId: options.wealthfolioAccountId,
      activityType,
      date,
      amount,
      currency,
      comment: buildComment(tx),
      sourceRecordId,
      metadata: compact({
        source: 'enable-banking',
        bank: options.bankName,
        entryReference: tx.entry_reference ?? undefined,
        transactionId: tx.transaction_id ?? undefined,
        bookingDate: tx.booking_date ?? undefined,
        valueDate: tx.value_date ?? undefined,
        counterparty: counterpartyName(tx) || undefined,
        bankTransactionCode: tx.bank_transaction_code?.description ?? undefined,
        merchantCategoryCode: tx.merchant_category_code ?? undefined,
      }),
      isValid: true,
      isDraft: false,
    };
    if (isExternal !== undefined) row.isExternal = isExternal;
    rows.push(row);
  }

  return { rows, skipped };
}
