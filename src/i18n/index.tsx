import { registerTranslations, useAddonTranslation } from '@wealthfolio/addon-sdk';
import { useAmountFormatting, useDateFormatting } from '@wealthfolio/ui';
import { Fragment, type ReactNode } from 'react';
import { errorToText, isMsg, type Text } from '../lib/messages';
import { en } from './en';
import { es } from './es';

/** Call once in `enable()`, before the first render. */
export function registerAddonTranslations(): void {
  registerTranslations({ es, en });
}

// Never appears in a translation, so it can mark where a React node goes.
const MARK = '\u0001';

/**
 * Translation and formatting in the user's language and region: `t` for a key,
 * `render` for a message from the sync engine (or plain text), `rich` to put
 * React nodes (bold, code…) where a translation has a `{{name}}`.
 */
export function useText() {
  const { t: translate, language } = useAddonTranslation();
  const { formatCalendarDate, formatDateTime } = useDateFormatting();
  const { formatAmount } = useAmountFormatting();

  const t = (key: string, params?: Record<string, unknown>): string =>
    translate(key, { ...params, interpolation: { escapeValue: false } });

  /** A calendar date (YYYY-MM-DD) in the user's format. */
  const formatDay = (iso?: string): string => {
    if (!iso) return '—';
    try {
      return formatCalendarDate(iso.slice(0, 10));
    } catch {
      return iso;
    }
  };

  /** A moment (ISO timestamp) in the user's format. */
  const formatWhen = (iso?: string): string => {
    if (!iso) return '—';
    try {
      return formatDateTime(iso, { dateStyle: 'medium', timeStyle: 'short' });
    } catch {
      return iso;
    }
  };

  const formatMoney = (value: number, currency: string, signed = false): string => {
    if (!Number.isFinite(value)) return '—';
    const text = formatAmount(value, currency);
    return signed && value > 0 ? `+${text}` : text;
  };

  const render = (text: Text | null | undefined): string => {
    if (text === null || text === undefined) return '';
    if (typeof text === 'string') return text;
    const params: Record<string, unknown> = {};
    for (const [name, value] of Object.entries(text.params ?? {})) {
      if (isMsg(value)) params[name] = render(value);
      else if (name.endsWith('Date') && typeof value === 'string') params[name] = formatDay(value);
      else params[name] = value;
    }
    return t(text.key, params);
  };

  const rich = (key: string, nodes: Record<string, ReactNode>, params?: Record<string, unknown>): ReactNode[] => {
    const marks: Record<string, string> = {};
    for (const name of Object.keys(nodes)) marks[name] = `${MARK}${name}${MARK}`;
    return t(key, { ...params, ...marks })
      .split(MARK)
      .map((part, index) =>
        index % 2 === 1 && part in nodes ? <Fragment key={index}>{nodes[part]}</Fragment> : part,
      );
  };

  const errorText = (error: unknown): string => render(errorToText(error));

  return { t, language, render, rich, errorText, formatDay, formatWhen, formatMoney };
}
