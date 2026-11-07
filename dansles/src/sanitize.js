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
    homeLabel: str(f.homeLabel, 30),
    home2: obj(f.home2)
      ? { label: str(f.home2.label, 30), address: str(f.home2.address, 200), lat: num(f.home2.lat, -90, 90), lng: num(f.home2.lng, -180, 180) }
      : null,
    homeMode: f.homeMode === 'alternate' ? 'alternate' : 'primary',
    ...(f.archived === true ? { archived: true } : {}),
  };
}

const homeNum = (v) => (v === 1 || v === 2 ? v : null);
function homeChoice(h) {
  if (!obj(h)) return null;
  const out = { to: homeNum(h.to), from: homeNum(h.from) };
  return out.to == null && out.from == null ? null : out;
}

// ---------- what is sent to the database ----------
// The second-address fields are only sent once the database knows them (schema version 3 and up);
// older databases refuse unknown fields. With a new database, home2 is always sent (null = none), so
// the server can tell "removed" apart from "sent by an older app version that doesn't know the field".
export const HOMES_SCHEMA = 3;

export function familyPayload(f, schema) {
  const { homeLabel, home2, homeMode, updatedAt, ...rest } = f;
  if ((schema ?? 0) < HOMES_SCHEMA) return rest;
  const h2 = home2 && (home2.address || Number.isFinite(home2.lat)) ? home2 : null;
  return {
    ...rest,
    homeLabel: h2 && homeLabel ? homeLabel : null,
    home2: h2,
    homeMode: h2 ? (homeMode === 'alternate' ? 'alternate' : 'primary') : null,
  };
}

export function responsePayload(r, family, schema) {
  if (r == null) return null;
  const { home, ...rest } = r;
  const choice = homeChoice(home);
  if ((schema ?? 0) < HOMES_SCHEMA || !family?.home2 || !choice) return rest;
  return { ...rest, home: choice };
}

export function sanitizeResponse(r) {
  if (!obj(r)) return null;
  const out = { to: leg(r.to), from: leg(r.from) };
  if (Array.isArray(r.kids)) out.kids = r.kids.filter((k) => typeof k === 'string');
  const home = homeChoice(r.home);
  if (home) out.home = home;
  return out;
}

const isInt = (v, lo, hi) => Number.isInteger(v) && v >= lo && v <= hi;
const isIds = (v) => Array.isArray(v) && v.length <= 50 && v.every((x) => typeof x === 'string' && ID.test(x));
const optBool = (v) => v == null || typeof v === 'boolean';

// Same rules as the database's cp_v_plan(): a plan is used only if it is complete and every number
// is in range; otherwise it is dropped (the week then shows a fresh proposal) instead of breaking the page.
function validCar(c) {
  return obj(c) && typeof c.driverId === 'string' && ID.test(c.driverId) && isIds(c.riders) && c.riders.length <= 20
    && isInt(c.seats, 0, 20) && (c.ownKids == null || isInt(c.ownKids, 0, 10))
    && (c.km == null || (typeof c.km === 'number' && c.km >= 0 && c.km <= 2000))
    && optBool(c.forced) && optBool(c.ratherNot);
}
function validLeg(lp) {
  return obj(lp) && isIds(lp.participants) && isIds(lp.unassigned)
    && (lp.seatsShort == null || isInt(lp.seatsShort, 0, 200))
    && Array.isArray(lp.cars) && lp.cars.length <= 50 && lp.cars.every(validCar);
}
export function validPlan(p) {
  return obj(p) && obj(p.legs) && validLeg(p.legs.to) && validLeg(p.legs.from) && optBool(p.edited) && optBool(p.inferred);
}

export function sanitizeWeek(w) {
  if (!obj(w)) return { cancelled: false, plan: null };
  return { cancelled: w.cancelled === true, plan: validPlan(w.plan) ? w.plan : null };
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
