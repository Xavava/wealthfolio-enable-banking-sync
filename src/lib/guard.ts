import type { HostAPI } from '@wealthfolio/addon-sdk';
import { addDays, toDateOnly } from './state';

/** Must match `id` in manifest.json: Wealthfolio stores our IDs as `addon:<id>:<ID>`. */
export const ADDON_ID = 'enable-banking-sync';
const OWN_SOURCE_PREFIX = `addon:${ADDON_ID}:`;

const PAGE_SIZE = 50;
const MAX_PAGES = 20;

export type ActivitySearchHost = Pick<HostAPI['activities'], 'search'>;

/** Whether an activity was imported by this add-on (and is therefore matched by its ID). */
export function isOwnActivity(activity: { sourceRecordId?: string | null }): boolean {
  return Boolean(activity.sourceRecordId?.startsWith(OWN_SOURCE_PREFIX));
}

/**
 * Date (YYYY-MM-DD) of the latest activity in a Wealthfolio account that this
 * add-on did not import, or null when there is none.
 *
 * Wealthfolio only recognises an add-on row as a duplicate of a CSV or manual
 * activity when every value matches, comment included, so a bank movement that
 * is already in the account from another source would be imported twice. The
 * first sync of an account must therefore start after this date.
 */
export async function latestForeignActivityDate(
  activities: ActivitySearchHost,
  accountId: string,
): Promise<string | null> {
  for (let page = 0; page < MAX_PAGES; page++) {
    const response = await activities.search(
      page,
      PAGE_SIZE,
      { accountIds: [accountId] },
      '',
      { id: 'date', desc: true },
    );
    const rows = response?.data ?? [];
    for (const activity of rows) {
      if (isOwnActivity(activity)) continue;
      const date = toDateOnly(activity.date as Date | string);
      if (date) return date;
    }
    if (rows.length < PAGE_SIZE) return null;
  }
  return null;
}

/** First date that can be imported without overlapping `existingUntil`. */
export function firstSafeDate(existingUntil: string): string {
  return addDays(existingUntil, 1);
}
