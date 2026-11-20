import type { HostAPI, NetworkResponse } from '@wealthfolio/addon-sdk';
import type {
  EbAccount,
  EbApplication,
  EbAspsp,
  EbAspspsResponse,
  EbBalance,
  EbBalancesResponse,
  EbErrorBody,
  EbSession,
  EbStartAuthResponse,
  EbTransaction,
  EbTransactionsResponse,
} from './eb-types';
import { createEnableBankingJwt } from './jwt';

export const API_BASE_URL = 'https://api.enablebanking.com';

/** Secret holding the application's private key (PEM). */
export const PRIVATE_KEY_SECRET = 'private-key';
/**
 * Secret holding the current signed JWT. The add-on network broker refuses a
 * raw Authorization header, so the token is stored as a secret and the broker
 * injects it as `Authorization: Bearer <token>` (request.auth.secretKey).
 */
export const JWT_SECRET = 'api-jwt';

const TOKEN_LIFETIME_SECONDS = 3600;
const TOKEN_REFRESH_MARGIN_SECONDS = 300;
const MAX_TRANSACTION_PAGES = 100;

export type EnableBankingHost = Pick<HostAPI, 'network' | 'secrets'>;

/**
 * Wealthfolio refused to send a request (as opposed to Enable Banking answering
 * with an error). It reports every refusal with the same generic message, so it
 * cannot be told apart from a connection failure. The usual cause is that the
 * add-on was installed or updated without approving api.enablebanking.com under
 * "Hosts de red", which leaves it without internet access.
 */
export class NetworkBlockedError extends Error {
  readonly hostCode?: string;

  constructor(cause: unknown) {
    const detail = cause instanceof Error ? cause.message : typeof cause === 'string' ? cause : '';
    const code =
      cause && typeof cause === 'object' && typeof (cause as { code?: unknown }).code === 'string'
        ? (cause as { code: string }).code
        : undefined;
    super(
      'Wealthfolio no ha dejado salir la petición a api.enablebanking.com. Suele pasar al ' +
        'instalar o actualizar el add-on sin marcar el acceso a internet: ve a Ajustes → ' +
        'Complementos, pasa el ratón por Enable Banking Sync, pulsa el icono del ojo («Ver ' +
        'permisos»), marca api.enablebanking.com en «Hosts de red» y pulsa Guardar. Si ya está ' +
        'marcado, comprueba tu conexión a internet.' +
        (detail || code ? ` (Detalle: ${[detail, code && `[${code}]`].filter(Boolean).join(' ')})` : ''),
    );
    this.name = 'NetworkBlockedError';
    this.hostCode = code;
  }
}

export class EnableBankingError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly errorCode?: string,
  ) {
    super(message);
    this.name = 'EnableBankingError';
  }

  /** True when the bank consent/session is no longer usable and must be renewed. */
  get needsReconnect(): boolean {
    const code = (this.errorCode ?? '').toUpperCase();
    return (
      code.includes('EXPIRED') ||
      code.includes('SESSION') ||
      code.includes('CONSENT') ||
      (this.status === 403 && !code.includes('RATE'))
    );
  }
}

function describeError(status: number, body: EbErrorBody | undefined, raw: string): EnableBankingError {
  const code = body?.error;
  const detail =
    typeof body?.detail === 'string'
      ? body.detail
      : body?.detail
        ? JSON.stringify(body.detail)
        : '';
  const base = body?.message || raw.slice(0, 300) || `HTTP ${status}`;
  let hint = '';
  if (status === 401) {
    hint =
      ' Revisa el ID de aplicación y la clave privada; si son correctos, puede que el consentimiento del banco haya caducado.';
  } else if (status === 429 || (code ?? '').toUpperCase().includes('RATE')) {
    hint =
      ' El banco limita el número de consultas diarias (PSD2 permite ~4 consultas automáticas al día por cuenta). Inténtalo más tarde.';
  }
  const message = [base, detail].filter(Boolean).join(' — ') + (code ? ` [${code}]` : '') + hint;
  return new EnableBankingError(message, status, code);
}

interface TokenCache {
  applicationId: string;
  expiresAt: number;
}

let tokenCache: TokenCache | null = null;

/** Forget the cached JWT (e.g. after the application id or key changes). */
export function resetTokenCache(): void {
  tokenCache = null;
}

export interface RequestOptions {
  query?: Record<string, string | undefined>;
  body?: unknown;
  timeoutSecs?: number;
}

export class EnableBankingClient {
  constructor(
    private readonly host: EnableBankingHost,
    private readonly applicationId: string,
  ) {
    if (!applicationId.trim()) {
      throw new Error('Falta el ID de la aplicación de Enable Banking.');
    }
  }

  private async ensureToken(force = false): Promise<void> {
    const now = Math.floor(Date.now() / 1000);
    if (
      !force &&
      tokenCache &&
      tokenCache.applicationId === this.applicationId &&
      tokenCache.expiresAt - TOKEN_REFRESH_MARGIN_SECONDS > now
    ) {
      return;
    }
    const pem = await this.host.secrets.get(PRIVATE_KEY_SECRET);
    if (!pem) {
      throw new Error('No hay clave privada guardada. Configura Enable Banking primero.');
    }
    const jwt = await createEnableBankingJwt(this.applicationId.trim(), pem, {
      lifetimeSeconds: TOKEN_LIFETIME_SECONDS,
    });
    await this.host.secrets.set(JWT_SECRET, jwt.token);
    tokenCache = { applicationId: this.applicationId, expiresAt: jwt.expiresAt };
  }

  private buildUrl(path: string, query?: Record<string, string | undefined>): string {
    const url = new URL(path, API_BASE_URL);
    for (const [key, value] of Object.entries(query ?? {})) {
      if (value !== undefined && value !== '') url.searchParams.set(key, value);
    }
    return url.toString();
  }

  async request<T>(
    method: 'GET' | 'POST' | 'DELETE',
    path: string,
    options: RequestOptions = {},
  ): Promise<T> {
    const send = async (): Promise<NetworkResponse> => {
      const headers: Record<string, string> = { Accept: 'application/json' };
      if (options.body !== undefined) headers['Content-Type'] = 'application/json';
      try {
        return await this.host.network.request({
          url: this.buildUrl(path, options.query),
          method,
          headers,
          body: options.body === undefined ? undefined : JSON.stringify(options.body),
          auth: { type: 'bearer', secretKey: JWT_SECRET },
          timeoutSecs: options.timeoutSecs ?? 60,
        });
      } catch (error) {
        // Any HTTP answer from Enable Banking, errors included, arrives as a response.
        // A rejection means Wealthfolio did not let the request out.
        throw new NetworkBlockedError(error);
      }
    };

    await this.ensureToken();
    let response = await send();
    if (response.status === 401) {
      // The stored token may be stale (e.g. written by an older add-on run).
      await this.ensureToken(true);
      response = await send();
    }

    let parsed: unknown;
    try {
      parsed = response.body ? JSON.parse(response.body) : undefined;
    } catch {
      parsed = undefined;
    }

    if (response.status < 200 || response.status >= 300) {
      throw describeError(response.status, parsed as EbErrorBody | undefined, response.body ?? '');
    }
    return parsed as T;
  }

  getApplication(): Promise<EbApplication> {
    return this.request<EbApplication>('GET', '/application');
  }

  async getAspsps(country: string): Promise<EbAspsp[]> {
    const response = await this.request<EbAspspsResponse>('GET', '/aspsps', {
      query: { country },
    });
    return response.aspsps ?? [];
  }

  startAuthorization(params: {
    aspsp: { name: string; country: string };
    validUntil: Date;
    redirectUrl: string;
    state: string;
    psuType?: 'personal' | 'business';
  }): Promise<EbStartAuthResponse> {
    return this.request<EbStartAuthResponse>('POST', '/auth', {
      body: {
        access: { valid_until: params.validUntil.toISOString() },
        aspsp: params.aspsp,
        state: params.state,
        redirect_url: params.redirectUrl,
        psu_type: params.psuType ?? 'personal',
      },
    });
  }

  createSession(code: string): Promise<EbSession> {
    return this.request<EbSession>('POST', '/sessions', { body: { code } });
  }

  getSession(sessionId: string): Promise<EbSession> {
    return this.request<EbSession>('GET', `/sessions/${encodeURIComponent(sessionId)}`);
  }

  async deleteSession(sessionId: string): Promise<void> {
    await this.request<unknown>('DELETE', `/sessions/${encodeURIComponent(sessionId)}`);
  }

  getAccountDetails(accountUid: string): Promise<EbAccount> {
    return this.request<EbAccount>('GET', `/accounts/${encodeURIComponent(accountUid)}/details`);
  }

  async getBalances(accountUid: string): Promise<EbBalance[]> {
    const response = await this.request<EbBalancesResponse>(
      'GET',
      `/accounts/${encodeURIComponent(accountUid)}/balances`,
    );
    return response?.balances ?? [];
  }

  /** Fetches every page of transactions for the account in the date range. */
  async getAllTransactions(
    accountUid: string,
    dateFrom: string,
    dateTo?: string,
  ): Promise<EbTransaction[]> {
    const all: EbTransaction[] = [];
    let continuationKey: string | undefined;
    for (let page = 0; page < MAX_TRANSACTION_PAGES; page++) {
      const response = await this.request<EbTransactionsResponse>(
        'GET',
        `/accounts/${encodeURIComponent(accountUid)}/transactions`,
        {
          query: { date_from: dateFrom, date_to: dateTo, continuation_key: continuationKey },
          timeoutSecs: 120,
        },
      );
      all.push(...(response.transactions ?? []));
      continuationKey = response.continuation_key ?? undefined;
      if (!continuationKey) return all;
    }
    throw new Error(
      `Demasiadas páginas de movimientos (>${MAX_TRANSACTION_PAGES}). Reduce el rango de fechas.`,
    );
  }
}
