import { describe, expect, it } from 'vitest';
import { describeError } from '../src/lib/enable-banking-client';
import { errorEs } from './i18n';

const RATE_LIMIT = '[HUB046] Allowed number of accesses exceeded for consent.';

describe('Enable Banking error messages', () => {
  it('shows the API message once when the detail repeats it', () => {
    const body = {
      message: RATE_LIMIT,
      error: 'ASPSP_RATE_LIMIT_EXCEEDED',
      detail: { message: RATE_LIMIT, error_name: 'RateLimitException', error_data: {} },
    };
    const error = describeError(429, body, JSON.stringify(body));
    expect(error.message).toBe(`${RATE_LIMIT} [ASPSP_RATE_LIMIT_EXCEEDED]`);
    expect(errorEs(error)).toBe(
      `${RATE_LIMIT} [ASPSP_RATE_LIMIT_EXCEEDED] El banco limita el número de consultas diarias (PSD2 permite unas 4 consultas automáticas al día por cuenta). Inténtalo más tarde.`,
    );
  });

  it('also when the repeated detail comes as JSON text or plain text', () => {
    const asJson = JSON.stringify({ message: RATE_LIMIT, error_name: 'RateLimitException' });
    expect(describeError(500, { message: RATE_LIMIT, detail: asJson }, '').message).toBe(RATE_LIMIT);
    expect(describeError(500, { message: RATE_LIMIT, detail: ` ${RATE_LIMIT} ` }, '').message).toBe(RATE_LIMIT);
  });

  it('keeps a detail that adds information', () => {
    expect(describeError(422, { message: 'Validation error', detail: 'date_from is too old' }, '').message).toBe(
      'Validation error — date_from is too old',
    );
    expect(describeError(422, { message: 'Validation error', detail: [{ loc: ['date_from'] }] }, '').message).toBe(
      'Validation error — [{"loc":["date_from"]}]',
    );
  });
});
