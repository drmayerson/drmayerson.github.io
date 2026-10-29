import { test } from 'node:test';
import assert from 'node:assert/strict';
import { weeksToLock, retentionStart, visiblePastWeeks, RETENTION_DAYS } from '../src/history.js';
import { addDays, ymd } from '../src/dates.js';

const settings = { weekday: 3, time: '14:00', endTime: '15:30', deadlineDaysBefore: 1, deadlineTime: '20:00', startWeek: '2024-01-03' };

test('R2: weeks outside the retention window are never reconstructed', () => {
  const now = new Date(2026, 9, 29, 12);
  const due = weeksToLock(settings, {}, now);
  const from = retentionStart(now);
  assert.ok(due.length > 40, 'recent weeks are reconstructed');
  assert.ok(due.every((w) => w >= from), 'nothing older than the window');
  const oldest = new Date(2026, 9, 29); oldest.setDate(oldest.getDate() - RETENTION_DAYS);
  assert.ok(due[0] > ymd(oldest), 'strictly inside the database boundary');
});

test('R2: repeated reloads after crossing the boundary write nothing again', () => {
  const records = {};
  let now = new Date(2026, 9, 29, 12);
  for (const w of weeksToLock(settings, records, now)) records[w] = { plan: { stub: true } };
  // simulate the database: on each later day, rows older than the boundary disappear
  for (let day = 1; day <= 30; day++) {
    now = new Date(2026, 9, 29 + day, 12);
    const dbBoundary = ymd(new Date(now.getFullYear(), now.getMonth(), now.getDate() - RETENTION_DAYS));
    for (const w of Object.keys(records)) if (w < dbBoundary) delete records[w];
    const again = weeksToLock(settings, records, now).filter((w) => w < addDays(ymd(now), -7));
    assert.deepEqual(again, [], `day ${day}: expired or existing weeks would be rewritten`);
    for (const w of weeksToLock(settings, records, now)) records[w] = { plan: { stub: true } };
  }
});

test('R2: history list shows only weeks inside the window', () => {
  const now = new Date(2026, 9, 29, 12);
  const weeks = visiblePastWeeks(settings, '2026-11-04', now);
  assert.ok(weeks.length > 0 && weeks.every((w) => w >= retentionStart(now)));
});
