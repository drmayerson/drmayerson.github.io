// Which weeks the app may (re)construct and show, given the retention period.
// The database keeps answers and week records for RETENTION_DAYS (see supabase/schema.sql,
// which uses the same number); anything older is deleted and must never be recreated.

import { currentWeek, deadlineOf, pastWeeks, addDays, ymd } from './dates.js';

export const RETENTION_DAYS = 400;
// The database counts days in UTC; one week of margin keeps the browser safely inside the window.
const MARGIN_DAYS = 7;

/** Oldest lesson date the app still shows or reconstructs (inclusive). */
export function retentionStart(now = new Date()) {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return addDays(ymd(d), -(RETENTION_DAYS - MARGIN_DAYS));
}

/** Past weeks inside the retention window, oldest first. */
export function visiblePastWeeks(settings, week, now = new Date()) {
  const from = retentionStart(now);
  return pastWeeks(settings, week).filter((w) => w >= from);
}

/**
 * Weeks whose plan should be stored now: past weeks inside the retention window without a plan
 * (and not cancelled), plus the current week once its deadline has passed.
 * @param {object} records { [week]: { cancelled, plan } }
 */
export function weeksToLock(settings, records, now = new Date()) {
  if (!settings.startWeek) return [];
  const cur = currentWeek(settings, now);
  const due = visiblePastWeeks(settings, cur, now);
  if (now > deadlineOf(settings, cur)) due.push(cur);
  return due.filter((w) => !records[w]?.cancelled && !records[w]?.plan);
}
