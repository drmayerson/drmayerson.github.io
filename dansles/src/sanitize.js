// Defensive clean-up of loaded data, so one malformed record can never break the app for everyone.
// The database validates new writes (supabase/schema.sql); this also covers older or hand-edited rows.

const ID = /^[A-Za-z0-9_-]{1,64}$/;
const STATUSES = new Set(['need', 'self', 'rather_not', 'can', 'driving']);
const str = (v, max) => (typeof v === 'string' ? v.slice(0, max) : v == null ? '' : String(v).slice(0, max));
const num = (v, lo, hi) => (typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi ? v : null);
const int = (v, lo, hi, dflt) => { const n = num(v, lo, hi); return n == null ? dflt : Math.round(n); };
const obj = (v) => v && typeof v === 'object' && !Array.isArray(v);

function leg(v) {
  if (!obj(v) || !STATUSES.has(v.status)) return { status: 'need' };
  const out = { status: v.status };
  const seats = num(v.seats, 0, 20);
  if (seats != null) out.seats = Math.round(seats);
  return out;
}

export function sanitizeFamily(f) {
  if (!obj(f) || typeof f.id !== 'string' || !ID.test(f.id)) return null;
  const kids = (Array.isArray(f.kids) ? f.kids : [])
    .filter((k) => obj(k) && typeof k.id === 'string' && ID.test(k.id))
    .map((k) => ({ id: k.id, name: str(k.name, 60) || '?' }))
    .slice(0, 10);
  return {
    id: f.id,
    name: str(f.name, 80) || '?',
    parent: str(f.parent, 80),
    kids,
    address: str(f.address, 200),
    lat: num(f.lat, -90, 90),
    lng: num(f.lng, -180, 180),
    seats: int(f.seats, 0, 20, 3),
    usual: obj(f.usual) ? { to: leg(f.usual.to), from: leg(f.usual.from) } : null,
    ...(f.archived === true ? { archived: true } : {}),
  };
}

export function sanitizeResponse(r) {
  if (!obj(r)) return null;
  const out = { to: leg(r.to), from: leg(r.from) };
  if (Array.isArray(r.kids)) out.kids = r.kids.filter((k) => typeof k === 'string');
  return out;
}

function validLeg(lp) {
  return obj(lp) && Array.isArray(lp.participants) && Array.isArray(lp.cars) && Array.isArray(lp.unassigned)
    && lp.cars.every((c) => obj(c) && typeof c.driverId === 'string' && Array.isArray(c.riders) && Number.isFinite(c.seats));
}

export function sanitizeWeek(w) {
  if (!obj(w)) return { cancelled: false, plan: null };
  const plan = obj(w.plan) && obj(w.plan.legs) && validLeg(w.plan.legs.to) && validLeg(w.plan.legs.from) ? w.plan : null;
  return { cancelled: w.cancelled === true, plan };
}

export function sanitizeState(state) {
  const families = (Array.isArray(state.families) ? state.families : []).map(sanitizeFamily).filter(Boolean);
  const responses = {};
  for (const [week, byFam] of Object.entries(obj(state.responses) ? state.responses : {})) {
    for (const [fid, r] of Object.entries(obj(byFam) ? byFam : {})) {
      const clean = sanitizeResponse(r);
      if (clean) (responses[week] ??= {})[fid] = clean;
    }
  }
  const weeks = {};
  for (const [week, w] of Object.entries(obj(state.weeks) ? state.weeks : {})) weeks[week] = sanitizeWeek(w);
  return { ...state, families, responses, weeks };
}

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
export function sanitizeSettings(s, defaults) {
  const v = obj(s) ? s : {};
  const studio = obj(v.studio) ? v.studio : {};
  return {
    ...defaults,
    groupName: str(v.groupName ?? defaults.groupName, 80) || defaults.groupName,
    studio: { address: str(studio.address, 200), lat: num(studio.lat, -90, 90), lng: num(studio.lng, -180, 180) },
    weekday: int(v.weekday, 0, 6, defaults.weekday),
    time: TIME.test(v.time) ? v.time : defaults.time,
    endTime: TIME.test(v.endTime) ? v.endTime : defaults.endTime,
    deadlineDaysBefore: int(v.deadlineDaysBefore, 0, 7, defaults.deadlineDaysBefore),
    deadlineTime: TIME.test(v.deadlineTime) ? v.deadlineTime : defaults.deadlineTime,
    startWeek: typeof v.startWeek === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v.startWeek) ? v.startWeek : null,
    lookbackWeeks: int(v.lookbackWeeks, 1, 52, defaults.lookbackWeeks),
  };
}
