/**
 * Translatable messages for code that runs outside React.
 *
 * The SDK only translates inside components (`useAddonTranslation`), so the sync
 * engine and the API client return a message key with its parameters, and the
 * interface renders it in the user's language. Sync reports are stored, so a
 * report keeps following the language if the user changes it later.
 *
 * Parameter conventions, applied when rendering:
 * - a name ending in `Date` holds a calendar date (YYYY-MM-DD) and is shown in
 *   the user's date format;
 * - a value can itself be a message (e.g. an error inside a note).
 */
export interface Msg {
  key: string;
  params?: Record<string, MsgParam>;
}

export type MsgParam = string | number | Msg;

/** Text to show: a translatable message, or literal text (host errors, older reports). */
export type Text = string | Msg;

export function msg(key: string, params?: Record<string, MsgParam>): Msg {
  return params ? { key, params } : { key };
}

export function isMsg(value: unknown): value is Msg {
  return Boolean(value) && typeof value === 'object' && typeof (value as Msg).key === 'string';
}

/** An error whose text is a translatable message. */
export class LocalizedError extends Error {
  readonly msg: Msg;

  constructor(message: Msg) {
    super(message.params ? `${message.key} ${JSON.stringify(message.params)}` : message.key);
    this.name = 'LocalizedError';
    this.msg = message;
  }
}

/** The text of anything thrown: its message when it has one, else plain text. */
export function errorToText(error: unknown): Text {
  if (error instanceof LocalizedError) return error.msg;
  if (isMsg((error as { msg?: unknown } | null)?.msg)) return (error as { msg: Msg }).msg;
  // Host API rejections may carry a stable `code` (SDK 3.13.1); their message is
  // localized and generic, so show the code too.
  const code =
    error && typeof error === 'object' && typeof (error as { code?: unknown }).code === 'string'
      ? (error as { code: string }).code
      : undefined;
  if (error instanceof Error) return code && !error.message.includes(code) ? `${error.message} [${code}]` : error.message;
  if (typeof error === 'string') return error;
  const message = (error as { message?: unknown } | null)?.message;
  if (typeof message === 'string') return code ? `${message} [${code}]` : message;
  if (error === undefined || error === null) return msg('errors.unknown');
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}
