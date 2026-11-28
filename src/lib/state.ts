import type { HostAPI } from '@wealthfolio/addon-sdk';
import type { Text } from './messages';

export interface AddonConfig {
  applicationId: string;
  country: string;
  redirectUrl?: string;
  /** Classify incoming "intereses" movements as INTEREST (default true). */
  detectInterest?: boolean;
  /**
   * Pair a withdrawal and a deposit of the same amount between two synced accounts
   * as an internal transfer when the bank gives no IBAN (card repayments, top-ups,
   * "traspasos"). Default true.
   */
  detectOwnTransfers?: boolean;
}

/** Balance reported by the bank for an account. */
export interface BankBalance {
  /** Signed decimal string as reported by the bank. */
  amount: string;
  currency: string;
  /** ISO 20022 balance type (CLBD, ITBD, CLAV…). */
  type: string;
  /** Date the balance refers to (YYYY-MM-DD), when the bank gives one. */
  referenceDate?: string;
  /** ISO timestamp when the add-on fetched it. */
  fetchedAt: string;
}

/** A bank account exposed by an Enable Banking session. */
export interface LinkedAccount {
  /** Stable across sessions (identification_hash, else IBAN, else uid). Used to keep mappings on reconnect. */
  key: string;
  /** Session-scoped account id used in API calls. Changes when the consent is renewed. */
  uid: string;
  iban?: string;
  name: string;
  currency?: string;
  cashAccountType?: string;
  /** Wealthfolio account that receives the movements; null = not synced. */
  wealthfolioAccountId: string | null;
  /** First date (YYYY-MM-DD) to import on the first sync. */
  syncFrom: string;
  /** date_to (YYYY-MM-DD) of the last successful sync. */
  lastSyncedDate?: string;
  /** ISO timestamp of the last successful sync. */
  lastSyncedAt?: string;
  /**
   * Earliest date (YYYY-MM-DD) the next sync must read again: movements that were
   * still pending or that Wealthfolio rejected. Absent when nothing is held back.
   */
  retryFrom?: string;
  /**
   * The user chose `syncFrom` for this Wealthfolio account. Required before the first
   * sync: the add-on cannot see what is already in the account (e.g. from a CSV).
   */
  syncFromConfirmed?: boolean;
  /**
   * Last balance reported by the bank: read on the first sync of the day, or when
   * the user updates the balances that are out of date.
   */
  bankBalance?: BankBalance;
  /**
   * A sync imported movements after `bankBalance` was read, so a difference with
   * Wealthfolio is expected until it is read again. Absent otherwise.
   */
  balanceOutdated?: boolean;
  /**
   * What the bank gave the last time the add-on asked for the longest history it
   * keeps: the date asked for and the earliest movement returned (absent when it
   * returned none).
   */
  history?: { requestedFrom: string; earliest?: string; checkedAt: string };
  /**
   * Reads of movements the bank accepted on `date` (local YYYY-MM-DD). Balance reads
   * are not counted: the bank keeps them apart. Not kept on renewal: the bank counts
   * per consent.
   */
  reads?: { date: string; count: number };
  /**
   * Movements imported in the last NAME_WAIT_DAYS days without the other party's
   * name (shop, payer or payee; their note is the bank's description), by
   * `sourceRecordId`. Transfers between your accounts are left out. If the bank
   * sends the name in that time the note is rewritten with it in front; then, or
   * when the time is over, the entry goes. Absent when none.
   */
  pendingNotes?: Record<string, PendingNote>;
}

export interface PendingNote {
  /** Date of the movement (YYYY-MM-DD). */
  date: string;
  /**
   * Date and time it was imported with, when it has a time (BBVA from 1.10.0,
   * Banco de Sabadell from 1.11.0).
   * The note is rewritten with it so the time stays. Absent: midnight UTC.
   */
  activityDate?: string;
  /** Activity type it was imported with (Wealthfolio needs it to update the note). */
  activityType: string;
  currency: string;
  /** Absolute amount, for messages. */
  amount: string;
  // No kind of movement: card payments and the rest are treated alike (1.8.0 kept
  // one; the next sync drops it).
  // No activity id: the import result does not carry the stored one (1.7.0 kept a
  // wrong one). The sync that sees the name learns it from Wealthfolio's validation.
}

export interface BankConnection {
  sessionId: string;
  aspsp: { name: string; country: string };
  /** ISO timestamp when the bank consent expires. */
  validUntil: string;
  createdAt: string;
  accounts: LinkedAccount[];
}

export interface PendingAuthorization {
  state: string;
  aspsp: { name: string; country: string };
  validUntil: string;
  redirectUrl: string;
  url: string;
  createdAt: string;
}

export interface InvalidRowInfo {
  account: string;
  date: string;
  amount: string;
  comment: string;
  errors: Text[];
}

export type SyncStatus = 'ok' | 'error' | 'reconnect' | 'blocked';

export interface SyncAccountResult {
  /** `LinkedAccount.key` of the account (reports from 1.5.2 on). */
  key?: string;
  bank: string;
  /** Account name as the bank gives it (often just the holder's name). */
  account: string;
  /** Name of the Wealthfolio account it syncs into (reports from 1.5.0 on). */
  wealthfolioAccount?: string;
  /** Masked IBAN of the bank account, e.g. "ES91 •••• 1332" (reports from 1.5.0 on). */
  iban?: string;
  status: SyncStatus;
  fetched: number;
  imported: number;
  duplicates: number;
  invalid: number;
  /** Pending movements left for a later sync. */
  pending?: number;
  /** Movements still without the other party's name that may get it (after this sync). */
  notesWaiting?: number;
  /** Notes rewritten in this sync with the other party's name. */
  notesWritten?: number;
  /** Movements that stay without the other party's name: the wait ended in this sync. */
  notesWithoutName?: number;
  /** Movements paired as internal transfers by amount and date (no IBAN). */
  ownTransfers?: number;
  dateFrom?: string;
  /** Translatable message, or plain text in reports saved before 1.4.0. */
  message?: Text;
  /** Extra notes (held-back movements, balance problems…). */
  notes?: Text[];
}

export interface SyncReport {
  startedAt: string;
  finishedAt: string;
  imported: number;
  duplicates: number;
  invalid: number;
  ownTransfers?: number;
  accounts: SyncAccountResult[];
  invalidRows: InvalidRowInfo[];
  importError?: Text;
}

const KEYS = {
  config: 'config',
  connections: 'connections',
  pending: 'pending-authorization',
  lastReport: 'last-sync-report',
  ui: 'ui-cards',
} as const;

/** Which cards of the page the user left open (true) or folded (false). */
export type UiPrefs = Partial<Record<string, boolean>>;

type Storage = HostAPI['storage'];

async function readJson<T>(storage: Storage, key: string, fallback: T): Promise<T> {
  const raw = await storage.get(key);
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

async function writeJson(storage: Storage, key: string, value: unknown): Promise<void> {
  await storage.set(key, JSON.stringify(value));
}

export const DEFAULT_CONFIG: AddonConfig = { applicationId: '', country: 'ES' };

export const store = {
  loadConfig: (s: Storage) => readJson<AddonConfig>(s, KEYS.config, DEFAULT_CONFIG),
  saveConfig: (s: Storage, config: AddonConfig) => writeJson(s, KEYS.config, config),
  loadConnections: (s: Storage) => readJson<BankConnection[]>(s, KEYS.connections, []),
  saveConnections: (s: Storage, connections: BankConnection[]) =>
    writeJson(s, KEYS.connections, connections),
  loadPending: (s: Storage) => readJson<PendingAuthorization | null>(s, KEYS.pending, null),
  savePending: (s: Storage, pending: PendingAuthorization) => writeJson(s, KEYS.pending, pending),
  clearPending: (s: Storage) => s.delete(KEYS.pending),
  loadLastReport: (s: Storage) => readJson<SyncReport | null>(s, KEYS.lastReport, null),
  saveLastReport: (s: Storage, report: SyncReport) => writeJson(s, KEYS.lastReport, report),
  loadUi: (s: Storage) => readJson<UiPrefs>(s, KEYS.ui, {}),
  saveUi: (s: Storage, prefs: UiPrefs) => writeJson(s, KEYS.ui, prefs),
};

/** Local calendar date as YYYY-MM-DD. */
export function toIsoDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function addDays(isoDate: string, days: number): string {
  const [y, m, d] = isoDate.split('-').map(Number);
  return toIsoDate(new Date(y, m - 1, d + days));
}

/** Whole days from `a` to `b` (both YYYY-MM-DD). */
export function daysBetween(a: string, b: string): number {
  const toUtc = (iso: string) => {
    const [y, m, d] = iso.split('-').map(Number);
    return Date.UTC(y, m - 1, d);
  };
  return Math.round((toUtc(b) - toUtc(a)) / 86_400_000);
}

/**
 * Calendar date (YYYY-MM-DD) of a value coming from the host: a plain date is kept
 * as is; a timestamp is read in the local time zone, like the rest of the UI.
 */
export function toDateOnly(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : toIsoDate(date);
}

/** Reads of movements a day PSD2 lets the bank serve without the user present. */
export const DAILY_READS = 4;

/** Counts one read of the account's movements on `today` (YYYY-MM-DD). */
export function countRead(account: LinkedAccount, today: string): void {
  const before = account.reads?.date === today ? account.reads.count : 0;
  account.reads = { date: today, count: before + 1 };
}

/** Today's reads of the account that has used the most: every sync reads them all. */
export function readsToday(accounts: LinkedAccount[], today: string): number {
  return Math.max(0, ...accounts.map((a) => (a.reads?.date === today ? a.reads.count : 0)));
}

/** Earliest start date accepted; anything before is a typing slip (e.g. year 0026). */
export const MIN_START_DATE = '2000-01-01';

/** A complete YYYY-MM-DD date between MIN_START_DATE and today. */
export function isValidStartDate(value: string | null | undefined, today: string): boolean {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return false;
  return value >= MIN_START_DATE && value <= today;
}

/** YYYY-MM-DD → DD/MM/YYYY, for messages. */
export function formatIsoDate(iso: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  return match ? `${match[3]}/${match[2]}/${match[1]}` : iso;
}

export function minDate(dates: Array<string | null | undefined>): string | undefined {
  return dates.filter((d): d is string => Boolean(d)).sort()[0];
}

export function isExpired(connection: BankConnection, now = new Date()): boolean {
  return new Date(connection.validUntil).getTime() <= now.getTime();
}

export function daysLeft(connection: BankConnection, now = new Date()): number {
  return Math.floor((new Date(connection.validUntil).getTime() - now.getTime()) / 86_400_000);
}
