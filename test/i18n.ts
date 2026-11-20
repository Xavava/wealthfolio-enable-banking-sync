import { en } from '../src/i18n/en';
import { es } from '../src/i18n/es';
import { errorToText, isMsg, type Text } from '../src/lib/messages';
import { formatIsoDate } from '../src/lib/state';

type Bundle = Record<string, unknown>;

export function lookup(bundle: Bundle, key: string): string | undefined {
  let node: unknown = bundle;
  for (const part of key.split('.')) {
    if (!node || typeof node !== 'object') return undefined;
    node = (node as Bundle)[part];
  }
  return typeof node === 'string' ? node : undefined;
}

/**
 * Renders a message the way the add-on does in Wealthfolio (i18next `{{name}}`
 * interpolation; `…Date` parameters as dates, here in the Spanish format).
 * Fails on unknown keys or placeholders left without a value.
 */
export function renderIn(bundle: Bundle, text: Text | null | undefined): string {
  if (text === null || text === undefined) return '';
  if (typeof text === 'string') return text;
  const template = lookup(bundle, text.key);
  if (template === undefined) throw new Error(`Missing translation: ${text.key}`);
  return template.replace(/\{\{(\w+)\}\}/g, (_, name: string) => {
    const value = text.params?.[name];
    if (value === undefined) throw new Error(`Missing parameter "${name}" for ${text.key}`);
    if (isMsg(value)) return renderIn(bundle, value);
    if (name.endsWith('Date') && typeof value === 'string') return formatIsoDate(value);
    return String(value);
  });
}

/** Spanish text of a message (or plain text). */
export const textEs = (text: Text | null | undefined) => renderIn(es, text);
/** English text of a message (or plain text). */
export const textEn = (text: Text | null | undefined) => renderIn(en, text);
/** Spanish text of anything thrown. */
export const errorEs = (error: unknown) => textEs(errorToText(error));

/** Every key of a nested bundle, as dotted paths. */
export function keysOf(bundle: Bundle, prefix = ''): string[] {
  return Object.entries(bundle).flatMap(([key, value]) =>
    value && typeof value === 'object' ? keysOf(value as Bundle, `${prefix}${key}.`) : [`${prefix}${key}`],
  );
}
