import type { HostAPI } from '@wealthfolio/addon-sdk';

export interface AddonConfig {
  applicationId: string;
  country: string;
  redirectUrl?: string;
  /** Classify incoming "intereses" movements as INTEREST (default true). */
  detectInterest?: boolean;
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
  errors: string[];
}

export interface SyncAccountResult {
  bank: string;
  account: string;
  status: 'ok' | 'error' | 'reconnect';
  fetched: number;
  imported: number;
  duplicates: number;
  invalid: number;
  dateFrom?: string;
  message?: string;
}

export interface SyncReport {
  startedAt: string;
  finishedAt: string;
  imported: number;
  duplicates: number;
  invalid: number;
  accounts: SyncAccountResult[];
  invalidRows: InvalidRowInfo[];
  importError?: string;
}

const KEYS = {
  config: 'config',
  connections: 'connections',
  pending: 'pending-authorization',
  lastReport: 'last-sync-report',
} as const;

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

export function isExpired(connection: BankConnection, now = new Date()): boolean {
  return new Date(connection.validUntil).getTime() <= now.getTime();
}

export function daysLeft(connection: BankConnection, now = new Date()): number {
  return Math.floor((new Date(connection.validUntil).getTime() - now.getTime()) / 86_400_000);
}
