import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { en } from '../src/i18n/en';
import { es } from '../src/i18n/es';
import { ADDON_NAME } from '../src/lib/enable-banking-client';
import { buildComment } from '../src/lib/mapping';
import { msg } from '../src/lib/messages';
import { keysOf, lookup, textEn, textEs } from './i18n';

const SECTIONS = Object.keys(es).join('|');

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? sourceFiles(path) : /\.tsx?$/.test(name) ? [path] : [];
  });
}

const placeholders = (text: string) => [...text.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]).sort();

describe('translations', () => {
  it('English has exactly the Spanish keys', () => {
    expect(keysOf(en).sort()).toEqual(keysOf(es).sort());
  });

  it('every translation keeps the placeholders of the Spanish text', () => {
    for (const key of keysOf(es)) {
      expect({ key, placeholders: placeholders(lookup(en, key)!) }).toEqual({
        key,
        placeholders: placeholders(lookup(es, key)!),
      });
    }
  });

  it('every key used in the code exists', () => {
    const used = new Set<string>();
    for (const file of sourceFiles(join(__dirname, '../src'))) {
      if (file.includes(`${join('src', 'i18n')}`) && !file.endsWith('index.tsx')) continue;
      const source = readFileSync(file, 'utf-8');
      for (const match of source.matchAll(new RegExp(`'((?:${SECTIONS})\\.[A-Za-z]+)'`, 'g'))) used.add(match[1]);
    }
    expect(used.size).toBeGreaterThan(100);
    expect([...used].filter((key) => lookup(es, key) === undefined)).toEqual([]);
  });

  it('renders sync messages in both languages, dates included', () => {
    const note = msg('sync.historyPartial', { earliestDate: '2024-01-02', fromDate: '2020-01-01' });
    expect(textEs(note)).toMatch(/^El banco ha dado movimientos desde el 02\/01\/2024 \(pediste desde el 01\/01\/2020\)/);
    expect(textEn(note)).toMatch(/^The bank gave transactions from 02\/01\/2024 \(you asked from 01\/01\/2020\)/);
    const nested = msg('sync.balanceFailed', { detail: msg('errors.missingKey') });
    expect(textEn(nested)).toBe('Could not read the bank balance: No private key is saved. Set up Enable Banking first.');
  });

  it('names the add-on as Wealthfolio lists it', () => {
    const manifest = JSON.parse(readFileSync(join(__dirname, '../manifest.json'), 'utf-8')) as { name: string };
    expect(ADDON_NAME).toBe(manifest.name);
  });

  it('writes the fallback transfer description in the language it is given', () => {
    const tx = {
      transaction_amount: { amount: '10.00', currency: 'EUR' },
      credit_debit_indicator: 'DBIT',
      status: 'BOOK',
      booking_date: '2026-10-01',
      creditor_account: { iban: 'ES7921000813610123456789' },
    } as Parameters<typeof buildComment>[0];
    expect(buildComment(tx)).toBe('Transferencia a ES79 •••• 6789');
    expect(buildComment(tx, { from: en.sync.transferFrom, to: en.sync.transferTo })).toBe('Transfer to ES79 •••• 6789');
  });
});
