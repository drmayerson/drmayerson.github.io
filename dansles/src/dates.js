// Week/lesson date helpers. All dates are local (the parents' own time zone).
// A "week" is identified by its lesson date as 'YYYY-MM-DD'.

const pad = (n) => String(n).padStart(2, '0');

export function ymd(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function parseYmd(s) {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function addDays(s, n) {
  const d = parseYmd(s);
  d.setDate(d.getDate() + n);
  return ymd(d);
}

function at(dateStr, hhmm) {
  const d = parseYmd(dateStr);
  const [h, m] = (hhmm || '00:00').split(':').map(Number);
  d.setHours(h || 0, m || 0, 0, 0);
  return d;
}

/** End of the lesson (after which the week counts as past). */
export function lessonEnd(settings, week) {
  return at(week, settings.endTime || settings.time || '23:59');
}

export function lessonStart(settings, week) {
  return at(week, settings.time || '00:00');
}

export function deadlineOf(settings, week) {
  return at(addDays(week, -(settings.deadlineDaysBefore ?? 1)), settings.deadlineTime || '20:00');
}

/** The upcoming (or ongoing) lesson date. settings.weekday: 0=Sunday … 6=Saturday. */
export function currentWeek(settings, now = new Date()) {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const diff = (((settings.weekday ?? 3) - d.getDay()) % 7 + 7) % 7;
  d.setDate(d.getDate() + diff);
  let week = ymd(d);
  if (now > lessonEnd(settings, week)) week = addDays(week, 7);
  return week;
}

/** Past lesson dates from startWeek (inclusive) up to `week` (exclusive), oldest first. */
export function pastWeeks(settings, week, limit = 104) {
  const out = [];
  if (!settings.startWeek) return out; // a new group has no history yet
  let w = addDays(week, -7);
  const start = settings.startWeek;
  while (w >= start && out.length < limit) { out.unshift(w); w = addDays(w, -7); }
  return out;
}

const DAYS = ['zondag', 'maandag', 'dinsdag', 'woensdag', 'donderdag', 'vrijdag', 'zaterdag'];
const MONTHS = ['januari', 'februari', 'maart', 'april', 'mei', 'juni', 'juli', 'augustus', 'september', 'oktober', 'november', 'december'];

export const dayName = (i) => DAYS[i];

export function formatDay(week, { weekday = true } = {}) {
  const d = parseYmd(week);
  return `${weekday ? DAYS[d.getDay()] + ' ' : ''}${d.getDate()} ${MONTHS[d.getMonth()]}`;
}

export function formatDateTime(date) {
  return `${DAYS[date.getDay()]} ${date.getDate()} ${MONTHS[date.getMonth()]}, ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** "nog 2 dagen", "nog 5 uur", "verlopen" */
export function timeLeft(deadline, now = new Date()) {
  const ms = deadline - now;
  if (ms <= 0) return null;
  const h = Math.floor(ms / 3.6e6);
  if (h >= 48) return `nog ${Math.floor(h / 24)} dagen`;
  if (h >= 1) return `nog ${h} uur`;
  return `nog ${Math.max(1, Math.round(ms / 6e4))} min`;
}
