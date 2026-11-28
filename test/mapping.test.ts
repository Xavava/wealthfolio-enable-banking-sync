import { describe, expect, it } from 'vitest';
import { parseRedirect } from '../src/lib/connect';
import type { EbTransaction } from '../src/lib/eb-types';
import { buildComment, mapTransactions, toLinkedAccount } from '../src/lib/mapping';

const OWN_IBAN = 'ES9121000418450200051332';
const SAVINGS_IBAN = 'ES7921000813610123456789';

function tx(overrides: Partial<EbTransaction>): EbTransaction {
  return {
    transaction_amount: { amount: '10.00', currency: 'EUR' },
    credit_debit_indicator: 'DBIT',
    status: 'BOOK',
    booking_date: '2026-11-03',
    ...overrides,
  };
}

const baseOptions = {
  wealthfolioAccountId: 'wf-1',
  accountIban: OWN_IBAN,
  syncedIbans: new Set([OWN_IBAN, SAVINGS_IBAN]),
  bankName: 'Banco Test',
  detectInterest: true,
};

describe('mapTransactions', () => {
  it('maps debits and credits to WITHDRAWAL and DEPOSIT with positive amounts', async () => {
    const { rows } = await mapTransactions(
      [
        tx({ entry_reference: 'A1', creditor: { name: 'MERCADONA' }, remittance_information: ['Compra tarjeta'] }),
        tx({
          entry_reference: 'A2',
          credit_debit_indicator: 'CRDT',
          transaction_amount: { amount: '1500.50', currency: 'EUR' },
          debtor: { name: 'ACME SL' },
          remittance_information: ['NOMINA NOVIEMBRE'],
        }),
      ],
      baseOptions,
    );
    expect(rows.map((r) => [r.activityType, r.amount, r.currency, r.date])).toEqual([
      ['WITHDRAWAL', '10.00', 'EUR', '2026-11-03'],
      ['DEPOSIT', '1500.50', 'EUR', '2026-11-03'],
    ]);
    expect(rows[0].comment).toBe('MERCADONA · Compra tarjeta');
    expect(rows[0]).toMatchObject({ accountId: 'wf-1', isValid: true, isDraft: false });
    expect(rows[0].metadata).toMatchObject({ source: 'enable-banking', bank: 'Banco Test', entryReference: 'A1' });
  });

  it('uses the sign of the amount when the indicator is missing', async () => {
    const { rows } = await mapTransactions(
      [tx({ credit_debit_indicator: undefined, transaction_amount: { amount: '-4.20', currency: 'EUR' } })],
      baseOptions,
    );
    expect(rows[0]).toMatchObject({ activityType: 'WITHDRAWAL', amount: '4.20' });
  });

  it('skips pending, zero-amount and undated movements', async () => {
    const { rows, skipped } = await mapTransactions(
      [
        tx({ status: 'PDNG' }),
        tx({ transaction_amount: { amount: '0.00', currency: 'EUR' } }),
        tx({ booking_date: null, value_date: null, transaction_date: null }),
        tx({ entry_reference: 'OK' }),
      ],
      baseOptions,
    );
    expect(rows).toHaveLength(1);
    expect(skipped.map((s) => s.reason)).toEqual(['pending', 'no-amount', 'no-date']);
  });

  it('detects transfers between synced accounts as internal transfers', async () => {
    const { rows } = await mapTransactions(
      [
        tx({ creditor_account: { iban: 'ES79 2100 0813 6101 2345 6789' } }),
        tx({ credit_debit_indicator: 'CRDT', debtor_account: { iban: SAVINGS_IBAN } }),
        tx({ creditor_account: { iban: 'ES0000000000000000000000' } }),
      ],
      baseOptions,
    );
    expect(rows.map((r) => [r.activityType, r.isExternal])).toEqual([
      ['TRANSFER_OUT', false],
      ['TRANSFER_IN', false],
      ['WITHDRAWAL', undefined],
    ]);
  });

  it('classifies incoming interest only when enabled', async () => {
    const interest = tx({ credit_debit_indicator: 'CRDT', remittance_information: ['LIQUIDACIÓN INTERESES'] });
    const loanInterest = tx({ remittance_information: ['INTERESES PRESTAMO'] });
    const enabled = await mapTransactions([interest, loanInterest], baseOptions);
    const disabled = await mapTransactions([interest], { ...baseOptions, detectInterest: false });
    expect(enabled.rows.map((r) => r.activityType)).toEqual(['INTEREST', 'WITHDRAWAL']);
    expect(disabled.rows[0].activityType).toBe('DEPOSIT');
  });

  it('gives stable, distinct ids to identical movements without a bank reference', async () => {
    const coffee = tx({ creditor: { name: 'CAFE' }, transaction_amount: { amount: '1.50', currency: 'EUR' } });
    const first = await mapTransactions([coffee, { ...coffee }], baseOptions);
    const again = await mapTransactions([coffee, { ...coffee }], baseOptions);
    const ids = first.rows.map((r) => r.sourceRecordId);
    expect(new Set(ids).size).toBe(2);
    expect(again.rows.map((r) => r.sourceRecordId)).toEqual(ids);
    expect(ids[0]).toMatch(/^fp:[0-9a-f]{40}:1$/);
  });

  it('builds ids from the bank reference when present, hashing long ones', async () => {
    const { rows } = await mapTransactions(
      [tx({ entry_reference: 'REF-1' }), tx({ entry_reference: 'X'.repeat(200) })],
      baseOptions,
    );
    expect(rows[0].sourceRecordId).toBe('ref:REF-1|2026-11-03|-10.00');
    expect(rows[1].sourceRecordId).toMatch(/^ref:[0-9a-f]{40}$/);
  });
});

describe('buildComment', () => {
  it('avoids repeating the counterparty and falls back to the bank code', () => {
    expect(buildComment(tx({ creditor: { name: 'Netflix' }, remittance_information: 'NETFLIX' }))).toBe('Netflix');
    expect(buildComment(tx({ bank_transaction_code: { description: 'Comisión mantenimiento' } }))).toBe(
      'Comisión mantenimiento',
    );
  });
});

describe('toLinkedAccount', () => {
  it('prefers identification_hash as the stable key and normalises the IBAN', () => {
    const account = toLinkedAccount(
      {
        uid: 'uid-1',
        identification_hash: 'hash-1',
        account_id: { iban: 'es91 2100 0418 4502 0005 1332' },
        name: 'Cuenta Online',
        currency: 'EUR',
        cash_account_type: 'CACC',
      },
      { syncFrom: '2026-08-22' },
    );
    expect(account).toMatchObject({
      key: 'hash-1',
      uid: 'uid-1',
      iban: OWN_IBAN,
      name: 'Cuenta Online',
      wealthfolioAccountId: null,
      syncFrom: '2026-08-22',
    });
  });
});

describe('parseRedirect', () => {
  it('accepts a full URL, a query string or a bare code', () => {
    expect(parseRedirect('https://localhost/callback?state=s1&code=abc')).toEqual({
      code: 'abc',
      state: 's1',
      error: undefined,
      errorDescription: undefined,
    });
    expect(parseRedirect('code=xyz&state=s2')).toMatchObject({ code: 'xyz', state: 's2' });
    expect(parseRedirect('  bare-code ')).toEqual({ code: 'bare-code' });
    expect(parseRedirect('https://localhost/cb?error=access_denied&error_description=User+cancelled')).toMatchObject({
      error: 'access_denied',
      errorDescription: 'User cancelled',
    });
  });
});

describe('buildComment fallbacks', () => {
  it('describes a bare transfer by the masked counterparty IBAN', () => {
    expect(buildComment(tx({ creditor_account: { iban: SAVINGS_IBAN } }))).toBe('Transferencia a ES79 •••• 6789');
    expect(buildComment(tx({ credit_debit_indicator: 'CRDT', debtor_account: { iban: OWN_IBAN } }))).toBe(
      'Transferencia desde ES91 •••• 1332',
    );
  });
});

describe('movements the bank names later (BBVA)', () => {
  const card = tx({ entry_reference: 'K1', remittance_information: ['PAGO CON TARJETA EN SUPERMERCADOS'] });
  const payroll = tx({
    entry_reference: 'N1',
    credit_debit_indicator: 'CRDT',
    remittance_information: ['ABONO DE NOMINA POR TRANSFERENCIA // INGRESO POR NÓMINA O PENSIÓN'],
  });

  it('lists every movement without the other party name, keeping the note the bank gives', async () => {
    const namedCard = { ...card, entry_reference: 'K2', creditor: { name: 'MERCADONA' } };
    const namedPayroll = { ...payroll, entry_reference: 'N2', debtor: { name: 'ACME SEGUROS SA' } };
    const mapped = await mapTransactions([card, namedCard, payroll, namedPayroll], { ...baseOptions, findUnnamed: true });
    expect(mapped.rows.map((r) => r.comment)).toEqual([
      'PAGO CON TARJETA EN SUPERMERCADOS',
      'MERCADONA · PAGO CON TARJETA EN SUPERMERCADOS',
      'ABONO DE NOMINA POR TRANSFERENCIA // INGRESO POR NÓMINA O PENSIÓN',
      'ACME SEGUROS SA · ABONO DE NOMINA POR TRANSFERENCIA // INGRESO POR NÓMINA O PENSIÓN',
    ]);
    expect([...mapped.unnamed]).toEqual(['ref:K1|2026-11-03|-10.00', 'ref:N1|2026-11-03|10.00']);
    expect((await mapTransactions([card, payroll], baseOptions)).unnamed.size).toBe(0);
  });
});

describe('time from the BBVA reference', () => {
  // 18 digits, the moment (YYMMDDhhmmss, UTC), 6 digits: like BBVA's 36-digit references.
  const ref = (moment: string) => `140000070000000000${moment}000000`;
  const bbva = { ...baseOptions, bankName: 'BBVA' };
  const dateOf = async (overrides: Partial<EbTransaction>, options = bbva) =>
    (await mapTransactions([tx(overrides)], options)).rows[0].date;

  it('adds the time when the moment falls on the booking day, keeping the ID by day', async () => {
    const { rows } = await mapTransactions(
      [tx({ entry_reference: ref('261125105807'), booking_date: '2026-11-25', value_date: '2026-11-25' })],
      bbva,
    );
    expect(rows[0].date).toBe('2026-11-25T10:58:07+00:00');
    expect(rows[0].sourceRecordId).toBe(`ref:${ref('261125105807')}|2026-11-25|-10.00`);
    expect(rows[0].metadata).toMatchObject({ bookingDate: '2026-11-25', valueDate: '2026-11-25' });
  });

  it('keeps the bare day when the bank booked it another day', async () => {
    // Paid on Saturday 24/10, booked on Monday 26/10.
    expect(await dateOf({ entry_reference: ref('261024190800'), booking_date: '2026-10-26', value_date: '2026-10-24' })).toBe(
      '2026-10-26',
    );
  });

  it('keeps the bare day when the moment is on another day in Spain or in UTC', async () => {
    // 23:30 UTC on 25/11 is 00:30 on 26/11 in Spain (winter, UTC+1).
    expect(await dateOf({ entry_reference: ref('261125233000'), booking_date: '2026-11-25' })).toBe('2026-11-25');
    // 23:30 UTC on 24/11 is already 25/11 in Spain, but not in UTC.
    expect(await dateOf({ entry_reference: ref('261124233000'), booking_date: '2026-11-25' })).toBe('2026-11-25');
    // Summer (UTC+2): 22:00 UTC is midnight in Spain; 21:59 UTC is still the same day.
    expect(await dateOf({ entry_reference: ref('260710220000'), booking_date: '2026-07-10' })).toBe('2026-07-10');
    expect(await dateOf({ entry_reference: ref('260710215900'), booking_date: '2026-07-10' })).toBe(
      '2026-07-10T21:59:00+00:00',
    );
  });

  it('only reads BBVA references that carry a valid moment', async () => {
    const day = { booking_date: '2026-11-25' };
    expect(await dateOf({ ...day, entry_reference: ref('261125105807') }, { ...baseOptions, bankName: 'Banco de Sabadell' })).toBe(
      '2026-11-25',
    );
    expect(await dateOf({ ...day, entry_reference: 'K1' })).toBe('2026-11-25');
    expect(await dateOf({ ...day, entry_reference: `${ref('261125105807')}0` })).toBe('2026-11-25');
    expect(await dateOf({ ...day, entry_reference: ref('261325105807') })).toBe('2026-11-25');
    expect(await dateOf({ booking_date: '2026-02-28', entry_reference: ref('260230105807') })).toBe('2026-02-28');
    expect(await dateOf({ ...day, entry_reference: ref('261125246000') })).toBe('2026-11-25');
    expect(await dateOf({ ...day, entry_reference: undefined, transaction_id: ref('261125105807') })).toBe('2026-11-25');
  });
});
