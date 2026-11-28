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

const MADRID = (() => {
  try {
    return new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Europe/Madrid',
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  } catch {
    return null;
  }
})();

/** Wall-clock time in Spain at `instant`: [year, month, day, hour, minute, second]. */
function madridClock(instant: Date): number[] | null {
  if (!MADRID) return null;
  const p = Object.fromEntries(MADRID.formatToParts(instant).map((x) => [x.type, x.value]));
  return [p.year, p.month, p.day, p.hour, p.minute, p.second].map(Number);
}

function madridDay(instant: Date): string | null {
  const clock = madridClock(instant);
  return clock ? `${clock[0]}-${String(clock[1]).padStart(2, '0')}-${String(clock[2]).padStart(2, '0')}` : null;
}

type Zone = 'UTC' | 'Europe/Madrid';

/** The instant a clock reading names in `zone`, or null when it is not a real moment there. */
function instantOf(clock: number[], zone: Zone): Date | null {
  const [y, mo, d, h, mi, s] = clock;
  if (h > 23 || mi > 59 || s > 59) return null;
  const asUtc = Date.UTC(y, mo - 1, d, h, mi, s);
  const utc = new Date(asUtc);
  if (utc.getUTCFullYear() !== y || utc.getUTCMonth() !== mo - 1 || utc.getUTCDate() !== d) return null;
  if (zone === 'UTC') return utc;
  // Spain is UTC+1 in winter and UTC+2 in summer: keep the offset whose clock matches.
  for (const hours of [2, 1]) {
    const candidate = new Date(asUtc - hours * 3_600_000);
    const wall = madridClock(candidate);
    if (wall && wall.every((value, i) => value === clock[i])) return candidate;
  }
  return null;
}

/**
 * Banks whose entry reference carries the moment of the movement. None of it is
 * documented: each format was read off the bank's own movements, and a bank
 * that is not here, or a reference that does not fit, gives no time.
 */
const REFERENCE_TIMES: Array<{ bank: RegExp; read: (reference: string) => { clock: number[]; zone: Zone } | null }> = [
  {
    // 36 digits; digits 19 to 30 are YYMMDDhhmmss in UTC. Card payments carry
    // when they were paid; receipts and transfers, when the bank processed them.
    bank: /^BBVA$/i,
    read: (reference) => {
      if (!/^\d{36}$/.test(reference)) return null;
      const [yy, ...rest] = (reference.slice(18, 30).match(/\d\d/g) ?? []).map(Number);
      return { clock: [2000 + yy, ...rest], zone: 'UTC' };
    },
  },
  {
    // YYYYMMDDhhmmss in Spanish time, six digits, "S" and a digit. On a
    // transfer from BBVA it is BBVA's moment, a second later at most.
    bank: /SABADELL/i,
    read: (reference) => {
      const m = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})\d{6}S\d$/.exec(reference);
      return m ? { clock: m.slice(1).map(Number), zone: 'Europe/Madrid' } : null;
    },
  },
];

/** The moment the bank's entry reference carries, as an instant, or null. */
function referenceInstant(tx: EbTransaction, bankName: string): Date | null {
  const reference = (tx.entry_reference ?? '').trim();
  const format = REFERENCE_TIMES.find((f) => f.bank.test(bankName.trim()));
  const read = format && reference ? format.read(reference) : null;
  return read ? instantOf(read.clock, read.zone) : null;
}

/**
 * The moment the bank's entry reference carries, in UTC ("…Z"), whatever its
 * day, or null. Kept in the activity's metadata even when the movement stays
 * on its bare booking day: Wealthfolio has no field to show it.
 */
export function referenceMoment(tx: EbTransaction, bankName: string): string | null {
  const instant = referenceInstant(tx, bankName);
  return instant ? `${instant.toISOString().slice(0, 19)}Z` : null;
}

/** `instant` as a timestamp with Spain's offset ("…T00:40:00+01:00"), or null. */
function spanishTimestamp(instant: Date): string | null {
  const clock = madridClock(instant);
  if (!clock) return null;
  const [y, mo, d, h, mi, s] = clock;
  const wall = Date.UTC(y, mo - 1, d, h, mi, s);
  const hours = Math.round((wall - instant.getTime()) / 3_600_000);
  return `${new Date(wall).toISOString().slice(0, 19)}+${String(hours).padStart(2, '0')}:00`;
}

/**
 * The moment the bank's entry reference carries, as a timestamp, when it falls
 * on `day` (the booking day) in Spain; otherwise null, to keep the bare day. A
 * Saturday payment booked on Monday keeps Monday.
 *
 * It is written with Spain's offset, not in UTC, so that it starts with `day`:
 * when importing, Wealthfolio links the two legs of a transfer by the day as
 * written, and between 00:00 and 02:00 in Spain the UTC day is the previous
 * one. Wealthfolio stores the same instant in UTC either way.
 */
export function referenceTime(tx: EbTransaction, bankName: string, day: string): string | null {
  const instant = referenceInstant(tx, bankName);
  if (!instant || madridDay(instant) !== day) return null;
  return spanishTimestamp(instant);
}

/**
 * The Spanish day of an import row's date: a bare day as it is; a timestamp
 * by the Spanish clock, as `referenceTime` chose it.
 */
export function movementDay(date: string): string {
  if (date.length <= 10) return date;
  const instant = new Date(date);
  return (Number.isNaN(instant.getTime()) ? null : madridDay(instant)) ?? date.slice(0, 10);
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

/** Words for a transfer with no description, in the user's language. */
export interface TransferLabels {
  from: string;
  to: string;
}

export const DEFAULT_TRANSFER_LABELS: TransferLabels = { from: 'Transferencia desde', to: 'Transferencia a' };

export function buildComment(tx: EbTransaction, labels: TransferLabels = DEFAULT_TRANSFER_LABELS): string {
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
    if (iban) parts.push(`${isIncoming(tx) ? labels.from : labels.to} ${maskIban(iban)}`);
  }
  const comment = parts.join(' · ');
  return comment.length > 500 ? `${comment.slice(0, 497)}...` : comment;
}

const INTEREST_PATTERN = /\b(inter[eé]s(es)?|interest)\b/iu;

/**
 * A movement booked without the other party's name (shop, payer or payee). BBVA
 * can add it, and complete the description, days later: "PAGO CON TARJETA EN
 * SUPERMERCADOS" gets the shop's name, and a payroll read the same day came as
 * "ABONO DE NOMINA… // EMPRESA SEGUROS SOCIEDA" with no payer.
 */
export function isUnnamedMovement(tx: EbTransaction): boolean {
  return !counterpartyName(tx);
}

export interface MappingOptions {
  wealthfolioAccountId: string;
  /** IBAN of the bank account being synced. */
  accountIban?: string;
  /** IBANs of every bank account that is synced into Wealthfolio (for transfer detection). */
  syncedIbans: Set<string>;
  bankName: string;
  /** Classify incoming "intereses" movements as INTEREST instead of DEPOSIT. */
  detectInterest: boolean;
  /** Words for a transfer with no description (default: Spanish). */
  transferLabels?: TransferLabels;
  /**
   * List the movements that come without the other party's name in `unnamed`, so
   * their note can be rewritten if the bank sends the name later.
   */
  findUnnamed?: boolean;
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
  /**
   * `sourceRecordId` of the movements still without the other party's name (only
   * with `findUnnamed`). Their note is the bank's description.
   */
  unnamed: Set<string>;
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
  const unnamed = new Set<string>();
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
      // The booking day, and the time the reference carries for the banks that put it there.
      date: referenceTime(tx, options.bankName, date) ?? date,
      // Cash movement: no asset. The SDK type marks `symbol` optional, but the host
      // requires the field (an empty string for cash, as in Wealthfolio's addon docs);
      // without it checkImport/import fail with a generic internal error.
      symbol: '',
      amount,
      currency,
      comment: buildComment(tx, options.transferLabels),
      sourceRecordId,
      metadata: compact({
        source: 'enable-banking',
        bank: options.bankName,
        entryReference: tx.entry_reference ?? undefined,
        transactionId: tx.transaction_id ?? undefined,
        bookingDate: tx.booking_date ?? undefined,
        valueDate: tx.value_date ?? undefined,
        // When the bank says it happened, also when that is another day.
        referenceMoment: referenceMoment(tx, options.bankName) ?? undefined,
        counterparty: counterpartyName(tx) || undefined,
        bankTransactionCode: tx.bank_transaction_code?.description ?? undefined,
        merchantCategoryCode: tx.merchant_category_code ?? undefined,
      }),
      isValid: true,
      isDraft: false,
    };
    if (isExternal !== undefined) row.isExternal = isExternal;
    if (options.findUnnamed && isUnnamedMovement(tx)) unnamed.add(sourceRecordId);
    rows.push(row);
  }

  return { rows, skipped, unnamed };
}
