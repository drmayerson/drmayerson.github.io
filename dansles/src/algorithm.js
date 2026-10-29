// Carpool assignment algorithm — pure functions, no DOM or storage.
//
// Pipeline per week:
//   1. effectiveAnswer()  — a family's answer, else their usual answer, else "needs a ride"
//   2. fairnessStats()    — share of past legs each family drove (from stored plans)
//   3. computePlan()      — for both legs jointly:
//        a. choose drivers: forced ("driving anyway") first, then the cheapest set of
//           optional drivers that seats everyone, minimising (in this order of weight):
//           number of cars, fairness (who drove least), "rather not" answers,
//           and the same family driving both legs
//        b. seat the other kids in the chosen cars so total driving distance is minimal
//           (home → pickups → studio, and the reverse after class)
//
// Families are the unit of transport: siblings always travel together and a driver
// always takes their own kids.

export const LEGS = ['to', 'from'];
export const STATUSES = ['need', 'self', 'rather_not', 'can', 'driving'];
const DRIVER_STATUSES = new Set(['rather_not', 'can', 'driving']);

export const WEIGHTS = {
  car: 1000,       // each extra car: dominates everything else
  fairness: 100,   // × share of past legs driven (0..1)
  ratherNot: 90,   // choosing someone who answered "rather not"
  bothLegs: 60,    // same family driving there and back (unless forced both ways)
  km: 2,           // per road-km of the resulting routes: geography as a tie-breaker between driver sets
  jitter: 3,       // deterministic tie-breaker that rotates week to week
};
const ROAD_FACTOR = 1.3;   // straight-line km → rough road km
const UNKNOWN_KM = 2;      // distance assumed when coordinates are missing
const SMOOTHING = 2;       // pseudo-legs pulling new families towards the group average
const UNSEATED_PENALTY = 1e6;
const KEEP_PER_LEG = 16;

// ---------- geometry ----------

export function haversineKm(a, b) {
  const R = 6371;
  const rad = (x) => (x * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

const hasCoords = (p) => p && Number.isFinite(p.lat) && Number.isFinite(p.lng);

export function roadKm(a, b) {
  if (!hasCoords(a) || !hasCoords(b)) return UNKNOWN_KM;
  return haversineKm(a, b) * ROAD_FACTOR;
}

// ---------- answers ----------

function normLeg(leg, family) {
  const status = STATUSES.includes(leg?.status) ? leg.status : 'need';
  const out = { status };
  if (DRIVER_STATUSES.has(status)) {
    const s = Number(leg?.seats);
    out.seats = Number.isFinite(s) && s >= 0 ? s : (family.seats ?? 3);
  }
  return out;
}

/** The answer the algorithm uses: this week's answer, else the family's usual, else "needs a ride both ways". */
export function effectiveAnswer(family, response) {
  const allKids = (family.kids || []).map((k) => k.id);
  if (response) {
    const kids = (response.kids ?? allKids).filter((id) => allKids.includes(id));
    return { source: 'answer', kids, to: normLeg(response.to, family), from: normLeg(response.from, family) };
  }
  if (family.usual) {
    return { source: 'usual', kids: allKids, to: normLeg(family.usual.to, family), from: normLeg(family.usual.from, family) };
  }
  return { source: 'default', kids: allKids, to: { status: 'need' }, from: { status: 'need' } };
}

export function answerFingerprint(a) {
  const leg = (l) => `${l.status}${l.seats ?? ''}`;
  return `${[...a.kids].sort().join(',')}|${leg(a.to)}|${leg(a.from)}`;
}

// ---------- fairness ----------

/**
 * Share of carpool legs each family drove, over the given past plans.
 * A leg counts as "driven" only if the family carried at least one other family's kid.
 * Returns { [familyId]: { legs, drives, rate } } where rate is smoothed towards the group mean.
 */
export function fairnessStats(pastPlans, familyIds) {
  const raw = Object.fromEntries(familyIds.map((id) => [id, { legs: 0, drives: 0 }]));
  for (const plan of pastPlans) {
    for (const leg of LEGS) {
      const lp = plan?.legs?.[leg];
      if (!lp) continue;
      for (const id of lp.participants || []) if (raw[id]) raw[id].legs++;
      for (const car of lp.cars || []) if (raw[car.driverId] && car.riders.length > 0) raw[car.driverId].drives++;
    }
  }
  const totLegs = Object.values(raw).reduce((s, r) => s + r.legs, 0);
  const totDrives = Object.values(raw).reduce((s, r) => s + r.drives, 0);
  const mean = totLegs ? totDrives / totLegs : 0;
  const out = {};
  for (const [id, r] of Object.entries(raw)) {
    out[id] = { ...r, rate: (r.drives + SMOOTHING * mean) / (r.legs + SMOOTHING) };
  }
  return out;
}

// ---------- helpers ----------

function hash01(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 16777619);
  return ((h >>> 0) % 100000) / 100000;
}

const popcount = (m) => { let c = 0; while (m) { m &= m - 1; c++; } return c; };

/** Participants of one leg: families sending ≥1 kid whose leg isn't "self-arranged". */
function legParticipants(families, answers, leg) {
  const out = [];
  for (const f of families) {
    const a = answers[f.id];
    if (!a || a.kids.length === 0) continue;
    const l = a[leg];
    if (l.status === 'self') continue;
    const kids = a.kids.length;
    const p = { id: f.id, kids, status: l.status, home: hasCoords(f) ? { lat: f.lat, lng: f.lng } : null };
    if (DRIVER_STATUSES.has(l.status)) p.cap = Math.max(l.seats, kids);
    out.push(p);
  }
  return out;
}

/** Can the riders' family groups be packed into the drivers' free seats? (first-fit decreasing) */
function packable(drivers, riders) {
  const free = drivers.map((d) => d.cap - d.kids).sort((a, b) => b - a);
  for (const r of [...riders].sort((a, b) => b.kids - a.kids)) {
    const i = free.findIndex((f) => f >= r.kids);
    if (i < 0) return false;
    free[i] -= r.kids;
  }
  return true;
}

// ---------- step a: driver selection ----------

function driverOptions(parts, stats, week, leg, studio) {
  const forced = parts.filter((p) => p.status === 'driving');
  const optional = parts.filter((p) => p.status === 'can' || p.status === 'rather_not');
  const optCost = (p) =>
    WEIGHTS.fairness * (stats[p.id]?.rate ?? 0) +
    (p.status === 'rather_not' ? WEIGHTS.ratherNot : 0) +
    WEIGHTS.jitter * hash01(`${week}|${leg}|${p.id}`);

  if (parts.length === 0) return [{ drivers: [], cost: 0, feasible: true, seating: { cars: [], unassigned: [] } }];
  const withSeating = (opt) => {
    const ids = new Set(opt.drivers.map((d) => d.id));
    opt.seating = seatRiders(opt.drivers, parts.filter((p) => !ids.has(p.id)), studio);
    opt.cost += WEIGHTS.km * opt.seating.cars.reduce((s, c) => s + c.km, 0);
    return opt;
  };

  const options = [];
  const n = optional.length;
  for (let mask = 0; mask < 1 << n; mask++) {
    const chosen = optional.filter((_, i) => mask & (1 << i));
    const drivers = [...forced, ...chosen];
    const driverIds = new Set(drivers.map((d) => d.id));
    const riders = parts.filter((p) => !driverIds.has(p.id));
    if (!packable(drivers, riders)) continue;
    const cost = WEIGHTS.car * chosen.length + chosen.reduce((s, p) => s + optCost(p), 0);
    options.push({ drivers, cost, feasible: true, optionalIds: new Set(chosen.map((c) => c.id)) });
  }
  if (options.length === 0) {
    // Not enough seats even with everyone who can drive: use all of them.
    return [withSeating({ drivers: [...forced, ...optional], cost: 0, feasible: false, optionalIds: new Set(optional.map((p) => p.id)) })];
  }
  options.sort((a, b) => a.cost - b.cost);
  return options.slice(0, KEEP_PER_LEG).map(withSeating).sort((a, b) => a.cost - b.cost);
}

function chooseDrivers(partsByLeg, stats, week, studio) {
  const to = driverOptions(partsByLeg.to, stats, week, 'to', studio);
  const from = driverOptions(partsByLeg.from, stats, week, 'from', studio);
  let best = null;
  for (const a of to) {
    for (const b of from) {
      let cost = a.cost + b.cost;
      for (const d of a.drivers) {
        const other = b.drivers.find((x) => x.id === d.id);
        if (other && (a.optionalIds?.has(d.id) || b.optionalIds?.has(d.id))) cost += WEIGHTS.bothLegs;
      }
      if (!best || cost < best.cost) best = { to: a, from: b, cost };
    }
  }
  return best;
}

// ---------- step b: seating by route ----------

/** Shortest path driverHome → (all stops, any order) → studio. Returns { km, order }. */
export function bestRoute(start, stops, end) {
  if (stops.length === 0) return { km: end ? roadKm(start, end) : 0, order: [] };
  let best = { km: Infinity, order: [] };
  const used = new Array(stops.length).fill(false);
  const path = [];
  const walk = (pos, km) => {
    if (km >= best.km) return;
    if (path.length === stops.length) {
      const total = km + (end ? roadKm(pos, end) : 0);
      if (total < best.km) best = { km: total, order: path.map((i) => stops[i].id) };
      return;
    }
    for (let i = 0; i < stops.length; i++) {
      if (used[i]) continue;
      used[i] = true; path.push(i);
      walk(stops[i].home, km + roadKm(pos, stops[i].home));
      path.pop(); used[i] = false;
    }
  };
  walk(start, 0);
  return best;
}

function seatRiders(drivers, riders, studio) {
  const n = riders.length;
  const full = (1 << n) - 1;
  const size = (mask) => riders.reduce((s, r, i) => (mask & (1 << i) ? s + r.kids : s), 0);
  const sizes = new Array(1 << n);
  for (let m = 0; m <= full; m++) sizes[m] = size(m);

  const routeMemo = drivers.map(() => new Map());
  const route = (ci, mask) => {
    const memo = routeMemo[ci];
    if (!memo.has(mask)) {
      const stops = riders.filter((_, i) => mask & (1 << i));
      memo.set(mask, bestRoute(drivers[ci].home, stops, studio));
    }
    return memo.get(mask);
  };

  // dp over cars: mask of riders seated so far → { cost, picks }
  let dp = new Map([[0, { cost: 0, picks: [] }]]);
  drivers.forEach((d, ci) => {
    const free = d.cap - d.kids;
    const next = new Map();
    for (const [mask, st] of dp) {
      const rest = full & ~mask;
      for (let sub = rest; ; sub = (sub - 1) & rest) {
        if (sizes[sub] <= free) {
          const cost = st.cost + route(ci, sub).km;
          const key = mask | sub;
          const cur = next.get(key);
          if (!cur || cost < cur.cost) next.set(key, { cost, picks: [...st.picks, sub] });
        }
        if (sub === 0) break;
      }
    }
    dp = next;
  });

  // pick the final state: everyone seated if possible, else fewest unseated kids
  let best = null;
  for (const [mask, st] of dp) {
    const total = st.cost + UNSEATED_PENALTY * sizes[full & ~mask];
    if (!best || total < best.total) best = { total, mask, picks: st.picks };
  }
  const cars = drivers.map((d, ci) => {
    const r = route(ci, best.picks[ci] ?? 0);
    return { driverId: d.id, forced: d.status === 'driving', ratherNot: d.status === 'rather_not', seats: d.cap, ownKids: d.kids, riders: r.order, km: round1(r.km) };
  });
  const unassigned = riders.filter((_, i) => !(best.mask & (1 << i))).map((r) => r.id);
  return { cars, unassigned };
}

const round1 = (x) => Math.round(x * 10) / 10;

// ---------- public: whole plan ----------

/**
 * @param {object} p
 * @param {string} p.week          'YYYY-MM-DD'
 * @param {object[]} p.families    active families {id, kids:[{id,name}], seats, lat, lng, usual}
 * @param {object} p.responses     { [familyId]: response } for this week
 * @param {object} p.stats         fairnessStats() result
 * @param {object} [p.studio]      { lat, lng }
 */
export function computePlan({ week, families, responses = {}, stats = {}, studio = null }) {
  const answers = Object.fromEntries(families.map((f) => [f.id, effectiveAnswer(f, responses[f.id])]));
  const partsByLeg = Object.fromEntries(LEGS.map((leg) => [leg, legParticipants(families, answers, leg)]));
  const studioPt = hasCoords(studio) ? studio : null;
  const choice = chooseDrivers(partsByLeg, stats, week, studioPt);

  const legs = {};
  for (const leg of LEGS) {
    const parts = partsByLeg[leg];
    const { cars, unassigned } = structuredClone(choice[leg].seating);
    if (leg === 'from') for (const c of cars) c.riders.reverse(); // drop-off order after class
    const kidsOf = (id) => parts.find((p) => p.id === id)?.kids ?? 0;
    legs[leg] = {
      participants: parts.map((p) => p.id),
      cars,
      unassigned,
      seatsShort: unassigned.reduce((s, id) => s + kidsOf(id), 0),
    };
  }

  return {
    version: 1,
    week,
    computedAt: new Date().toISOString(),
    edited: false,
    legs,
    sources: Object.fromEntries(Object.entries(answers).map(([id, a]) => [id, a.source])),
    fingerprints: Object.fromEntries(Object.entries(answers).map(([id, a]) => [id, answerFingerprint(a)])),
    rates: Object.fromEntries(families.map((f) => [f.id, round2(stats[f.id]?.rate ?? 0)])),
  };
}

const round2 = (x) => Math.round(x * 100) / 100;

/** Families whose effective answer differs from what the plan was built on. */
export function changedSincePlan(plan, families, responses) {
  if (!plan?.fingerprints) return [];
  return families
    .filter((f) => answerFingerprint(effectiveAnswer(f, responses[f.id])) !== plan.fingerprints[f.id])
    .map((f) => f.id);
}

/** Manually move a rider family to another car (driverId) or to "no seat yet" (null). */
export function movePassenger(plan, leg, familyId, toDriverId, { families, studio, kidsCount }) {
  const next = structuredClone(plan);
  const lp = next.legs[leg];
  const byId = Object.fromEntries(families.map((f) => [f.id, f]));
  const pt = (id) => (hasCoords(byId[id]) ? { lat: byId[id].lat, lng: byId[id].lng } : null);
  const touched = new Set();
  for (const c of lp.cars) {
    if (c.riders.includes(familyId)) { c.riders = c.riders.filter((r) => r !== familyId); touched.add(c); }
  }
  lp.unassigned = lp.unassigned.filter((r) => r !== familyId);
  if (toDriverId == null) lp.unassigned.push(familyId);
  else {
    const car = lp.cars.find((c) => c.driverId === toDriverId);
    car.riders.push(familyId);
    touched.add(car);
  }
  const studioPt = hasCoords(studio) ? studio : null;
  for (const c of touched) {
    const stops = c.riders.map((id) => ({ id, home: pt(id) }));
    const r = bestRoute(pt(c.driverId), stops, studioPt);
    c.riders = leg === 'from' ? [...r.order].reverse() : r.order;
    c.km = round1(r.km);
  }
  lp.seatsShort = lp.unassigned.reduce((s, id) => s + (kidsCount(id) || 0), 0);
  next.edited = true;
  return next;
}

/** Free seats left in a car (for validating manual moves). */
export function freeSeats(car, kidsCount) {
  return car.seats - car.ownKids - car.riders.reduce((s, id) => s + (kidsCount(id) || 0), 0);
}
