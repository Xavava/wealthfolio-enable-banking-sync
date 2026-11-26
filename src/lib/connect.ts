import type { EbAccount, EbAspsp } from './eb-types';
import type { EnableBankingClient } from './enable-banking-client';
import { toLinkedAccount } from './mapping';
import { LocalizedError, msg } from './messages';
import type { BankConnection, LinkedAccount, PendingAuthorization } from './state';

const DAY_SECONDS = 86_400;

export function maxConsentDays(aspsp?: EbAspsp): number {
  const seconds = aspsp?.maximum_consent_validity;
  return seconds && seconds > 0 ? Math.max(1, Math.floor(seconds / DAY_SECONDS)) : 90;
}

function randomState(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export async function startBankAuthorization(
  client: EnableBankingClient,
  params: { aspsp: { name: string; country: string }; consentDays: number; redirectUrl: string },
): Promise<PendingAuthorization> {
  const validUntil = new Date(Date.now() + params.consentDays * DAY_SECONDS * 1000);
  const state = randomState();
  const response = await client.startAuthorization({
    aspsp: params.aspsp,
    validUntil,
    redirectUrl: params.redirectUrl,
    state,
  });
  return {
    state,
    aspsp: params.aspsp,
    validUntil: validUntil.toISOString(),
    redirectUrl: params.redirectUrl,
    url: response.url,
    createdAt: new Date().toISOString(),
  };
}

export interface ParsedRedirect {
  code?: string;
  state?: string;
  error?: string;
  errorDescription?: string;
}

/** Accepts the full URL the bank redirected to, its query string, or the bare code. */
export function parseRedirect(input: string): ParsedRedirect {
  const value = input.trim();
  if (!value) return {};
  if (!value.includes('=')) return { code: value };
  const queryStart = value.indexOf('?');
  const query = (queryStart >= 0 ? value.slice(queryStart + 1) : value).replace(/^#/, '');
  const params = new URLSearchParams(query.replace(/#/g, '&'));
  return {
    code: params.get('code') ?? undefined,
    state: params.get('state') ?? undefined,
    error: params.get('error') ?? undefined,
    errorDescription: params.get('error_description') ?? undefined,
  };
}

function sameBank(a: { name: string; country: string }, b: { name: string; country: string }) {
  return a.name === b.name && a.country === b.country;
}

/**
 * Exchanges the authorization code for a session and stores the bank's accounts.
 * Reconnecting a bank keeps each account's Wealthfolio mapping and sync history,
 * matched by its stable key (account uids change with every new session).
 */
export async function completeBankAuthorization(
  client: EnableBankingClient,
  pending: PendingAuthorization,
  redirectInput: string,
  connections: BankConnection[],
  defaultSyncFrom: string,
): Promise<{ connections: BankConnection[]; connection: BankConnection; replaced?: BankConnection }> {
  const parsed = parseRedirect(redirectInput);
  if (parsed.error) {
    throw new LocalizedError(msg('errors.bankError', { detail: parsed.errorDescription ?? parsed.error }));
  }
  if (!parsed.code) {
    throw new LocalizedError(msg('errors.missingCode'));
  }
  if (parsed.state && parsed.state !== pending.state) {
    throw new LocalizedError(msg('errors.stateMismatch'));
  }

  const session = await client.createSession(parsed.code);
  const accounts: EbAccount[] = [];
  for (const entry of session.accounts ?? []) {
    if (typeof entry === 'string') {
      const details = await client.getAccountDetails(entry);
      accounts.push({ ...details, uid: details.uid ?? entry });
    } else {
      accounts.push(entry);
    }
  }
  if (accounts.length === 0) {
    throw new LocalizedError(msg('errors.noAccounts'));
  }

  const aspsp = session.aspsp ?? pending.aspsp;
  const previous = connections.find((c) => sameBank(c.aspsp, aspsp));
  const previousByKey = new Map<string, LinkedAccount>(
    (previous?.accounts ?? []).map((account) => [account.key, account]),
  );

  const linked = accounts.map((account) => {
    const fresh = toLinkedAccount(account, { syncFrom: defaultSyncFrom });
    const old = previousByKey.get(fresh.key);
    // Everything about the account's history survives a renewal, including the
    // movements held back for the next sync and the confirmed start date.
    return old
      ? {
          ...fresh,
          wealthfolioAccountId: old.wealthfolioAccountId,
          syncFrom: old.syncFrom,
          syncFromConfirmed: old.syncFromConfirmed,
          lastSyncedDate: old.lastSyncedDate,
          lastSyncedAt: old.lastSyncedAt,
          retryFrom: old.retryFrom,
          bankBalance: old.bankBalance,
          pendingNotes: old.pendingNotes,
        }
      : fresh;
  });

  const connection: BankConnection = {
    sessionId: session.session_id,
    aspsp,
    validUntil: session.access?.valid_until ?? pending.validUntil,
    createdAt: new Date().toISOString(),
    accounts: linked,
  };

  const others = connections.filter((c) => !sameBank(c.aspsp, aspsp));
  return { connections: [...others, connection], connection, replaced: previous };
}
