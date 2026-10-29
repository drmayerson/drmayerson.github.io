import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computePlan, effectiveAnswer, fairnessStats, movePassenger, changedSincePlan, freeSeats } from '../src/algorithm.js';
import { currentWeek, deadlineOf, pastWeeks, addDays } from '../src/dates.js';

const W = '2026-11-04';
// West cluster around x=4.50, east cluster around x=4.60; studio in the middle.
const fam = (id, lng, extra = {}) => ({ id, name: id, kids: [{ id: id + 'k', name: id + '-kid' }], seats: 3, lat: 50.77, lng, ...extra });
const studio = { lat: 50.77, lng: 4.55 };
const ans = (to, from = to, extra = {}) => ({ kids: undefined, to, from, ...extra });
const need = { status: 'need' };
const can = (seats = 3) => ({ status: 'can', seats });
const rather = (seats = 3) => ({ status: 'rather_not', seats });
const driving = (seats = 3) => ({ status: 'driving', seats });
const self = { status: 'self' };

const driversOf = (plan, leg) => plan.legs[leg].cars.map((c) => c.driverId).sort();
const seated = (plan, leg) => plan.legs[leg].cars.flatMap((c) => [c.driverId, ...c.riders]).sort();

test('effective answer: answer > usual > needs a ride', () => {
  const f = fam('a', 4.5, { usual: { to: can(2), from: need } });
  assert.equal(effectiveAnswer(f, null).source, 'usual');
  assert.equal(effectiveAnswer(f, null).to.seats, 2);
  assert.equal(effectiveAnswer({ ...f, usual: null }, null).to.status, 'need');
  const r = effectiveAnswer(f, { kids: [], to: need, from: need });
  assert.equal(r.source, 'answer');
  assert.deepEqual(r.kids, []);
});

test('one willing driver with enough seats: one car, everyone seated, own kid in own car', () => {
  const families = ['a', 'b', 'c'].map((id, i) => fam(id, 4.5 + i * 0.01));
  const plan = computePlan({ week: W, families, studio, responses: { a: ans(can(3)), b: ans(need), c: ans(need) } });
  assert.deepEqual(driversOf(plan, 'to'), ['a']);
  assert.deepEqual(seated(plan, 'to'), ['a', 'b', 'c']);
  assert.equal(plan.legs.to.seatsShort, 0);
});

test('uses the fewest cars and always includes "driving anyway"', () => {
  const families = ['a', 'b', 'c', 'd'].map((id, i) => fam(id, 4.5 + i * 0.01));
  const plan = computePlan({ week: W, families, studio, responses: { a: ans(can(4)), b: ans(can(4)), c: ans(driving(1)), d: ans(need) } });
  // c drives anyway (only own kid); a or b alone can take the rest
  assert.equal(plan.legs.to.cars.length, 2);
  assert.ok(driversOf(plan, 'to').includes('c'));
});

test('fairness: whoever drove least is picked', () => {
  const families = ['a', 'b', 'c'].map((id, i) => fam(id, 4.5 + i * 0.01));
  const stats = { a: { rate: 0.6 }, b: { rate: 0.1 }, c: { rate: 0.3 } };
  const plan = computePlan({ week: W, families, studio, stats, responses: { a: ans(can(), need), b: ans(can(), need), c: ans(need) } });
  assert.deepEqual(driversOf(plan, 'to'), ['b']);
});

test('"rather not" is avoided at equal fairness, but not forever', () => {
  const families = ['a', 'b', 'c'].map((id, i) => fam(id, 4.5 + i * 0.01));
  const responses = { a: ans(rather(), need), b: ans(can(), need), c: ans(need) };
  let plan = computePlan({ week: W, families, studio, responses, stats: { a: { rate: 0.3 }, b: { rate: 0.3 } } });
  assert.deepEqual(driversOf(plan, 'to'), ['b']);
  plan = computePlan({ week: W, families, studio, responses, stats: { a: { rate: 0 }, b: { rate: 0.9 } } });
  assert.deepEqual(driversOf(plan, 'to'), ['a']);
});

test('different families drive there and back when possible', () => {
  const families = ['a', 'b', 'c'].map((id, i) => fam(id, 4.5 + i * 0.01));
  const plan = computePlan({ week: W, families, studio, responses: { a: ans(can()), b: ans(can()), c: ans(need) } });
  assert.notDeepEqual(driversOf(plan, 'to'), driversOf(plan, 'from'));
});

test('forced on one leg, alternation still applies on the other', () => {
  const families = ['a', 'b', 'c'].map((id, i) => fam(id, 4.5 + i * 0.01));
  const plan = computePlan({
    week: W, families, studio,
    responses: { a: ans(driving(), can()), b: ans(can()), c: ans(need) },
    stats: { a: { rate: 0 }, b: { rate: 0.5 } },
  });
  assert.deepEqual(driversOf(plan, 'to'), ['a']);
  assert.deepEqual(driversOf(plan, 'from'), ['b']);
});

test('shortage: reports unseated kids and missing seats', () => {
  const families = ['a', 'b', 'c', 'd'].map((id, i) => fam(id, 4.5 + i * 0.01));
  const plan = computePlan({ week: W, families, studio, responses: { a: ans(can(2)), b: ans(need), c: ans(need), d: ans(need) } });
  assert.equal(plan.legs.to.unassigned.length, 2);
  assert.equal(plan.legs.to.seatsShort, 2);
});

test('nobody answered and no usual answers: everyone needs a ride, nobody can drive', () => {
  const families = ['a', 'b'].map((id, i) => fam(id, 4.5 + i * 0.01));
  const plan = computePlan({ week: W, families, studio });
  assert.equal(plan.legs.to.cars.length, 0);
  assert.equal(plan.legs.to.seatsShort, 2);
});

test('siblings travel together and seats are respected', () => {
  const big = { ...fam('s', 4.51), kids: [{ id: 's1', name: 'x' }, { id: 's2', name: 'y' }] };
  const families = [fam('a', 4.5), fam('b', 4.6), big, fam('c', 4.52)];
  const plan = computePlan({ week: W, families, studio, responses: { a: ans(can(2)), b: ans(can(3)), s: ans(need), c: ans(need) } });
  const carWithS = plan.legs.to.cars.find((c) => c.riders.includes('s'));
  assert.ok(carWithS, 'siblings seated');
  for (const c of plan.legs.to.cars) {
    const used = c.ownKids + c.riders.reduce((n, id) => n + (id === 's' ? 2 : 1), 0);
    assert.ok(used <= c.seats, `car ${c.driverId} over capacity`);
  }
  assert.equal(plan.legs.to.seatsShort, 0);
});

test('geography: kids ride with the driver on their side of town', () => {
  const families = [fam('w1', 4.50), fam('w2', 4.505), fam('e1', 4.60), fam('e2', 4.605)];
  const plan = computePlan({ week: W, families, studio, responses: { w1: ans(driving(3)), e1: ans(driving(3)), w2: ans(need), e2: ans(need) } });
  const carW = plan.legs.to.cars.find((c) => c.driverId === 'w1');
  const carE = plan.legs.to.cars.find((c) => c.driverId === 'e1');
  assert.deepEqual(carW.riders, ['w2']);
  assert.deepEqual(carE.riders, ['e2']);
});

test('"self-arranged" and non-participating families are left out', () => {
  const families = ['a', 'b', 'c'].map((id, i) => fam(id, 4.5 + i * 0.01));
  const plan = computePlan({
    week: W, families, studio,
    responses: { a: ans(can()), b: ans(self, need), c: { kids: [], to: need, from: need } },
  });
  assert.deepEqual(plan.legs.to.participants.sort(), ['a']);
  assert.deepEqual(plan.legs.from.participants.sort(), ['a', 'b']);
});

test('fairness stats count only legs where others were carried', () => {
  const past = [
    { legs: { to: { participants: ['a', 'b'], cars: [{ driverId: 'a', riders: ['b'] }] }, from: { participants: ['a', 'b'], cars: [{ driverId: 'b', riders: [] }, { driverId: 'a', riders: [] }] } } },
  ];
  const s = fairnessStats(past, ['a', 'b', 'c']);
  assert.equal(s.a.drives, 1);
  assert.equal(s.b.drives, 0);
  assert.equal(s.a.legs, 2);
  assert.ok(s.a.rate > s.b.rate);
  assert.equal(s.c.legs, 0);
});

test('manual move updates riders, order and shortage', () => {
  const families = ['a', 'b', 'c', 'd'].map((id, i) => fam(id, 4.5 + i * 0.01));
  const responses = { a: ans(can(2)), b: ans(need), c: ans(need), d: ans(need) };
  const plan = computePlan({ week: W, families, studio, responses });
  const kidsCount = () => 1;
  const rider = plan.legs.to.cars[0].riders[0];
  const moved = movePassenger(plan, 'to', rider, null, { families, studio, kidsCount });
  assert.equal(moved.edited, true);
  assert.ok(moved.legs.to.unassigned.includes(rider));
  assert.equal(moved.legs.to.seatsShort, plan.legs.to.seatsShort + 1);
  assert.equal(freeSeats(moved.legs.to.cars[0], kidsCount), 1);
  assert.equal(plan.edited, false, 'original untouched');
});

test('changedSincePlan detects answers that changed after locking', () => {
  const families = ['a', 'b'].map((id, i) => fam(id, 4.5 + i * 0.01));
  const responses = { a: ans(can()), b: ans(need) };
  const plan = computePlan({ week: W, families, studio, responses });
  assert.deepEqual(changedSincePlan(plan, families, responses), []);
  assert.deepEqual(changedSincePlan(plan, families, { ...responses, b: ans(can()) }), ['b']);
});

test('performance: 10 families, all can drive, both legs < 1.5 s', () => {
  const families = Array.from({ length: 10 }, (_, i) => fam('f' + i, 4.48 + i * 0.015, { lat: 50.75 + (i % 3) * 0.02 }));
  const responses = Object.fromEntries(families.map((f, i) => [f.id, ans(i % 3 === 0 ? need : can(2 + (i % 3)))]));
  const t = Date.now();
  const plan = computePlan({ week: W, families, studio, responses });
  assert.ok(Date.now() - t < 1500, `took ${Date.now() - t} ms`);
  assert.equal(plan.legs.to.seatsShort, 0);
});

test('dates: current week, deadline, past weeks', () => {
  const s = { weekday: 3, time: '14:00', endTime: '15:30', deadlineDaysBefore: 1, deadlineTime: '20:00', startWeek: '2026-10-07' };
  assert.equal(currentWeek(s, new Date(2026, 9, 29, 12)), '2026-11-04'); // Thu → next Wed
  assert.equal(currentWeek(s, new Date(2026, 10, 4, 15, 0)), '2026-11-04'); // during lesson
  assert.equal(currentWeek(s, new Date(2026, 10, 4, 16, 0)), '2026-11-11'); // after lesson
  const dl = deadlineOf(s, '2026-11-04');
  assert.equal(dl.getDate(), 3); assert.equal(dl.getHours(), 20);
  assert.deepEqual(pastWeeks(s, '2026-11-04'), ['2026-10-07', '2026-10-14', '2026-10-21', '2026-10-28']);
  assert.equal(addDays('2026-10-28', 7), '2026-11-04');
});

// ---------- regressions from the October 2026 review ----------
import { _internals, recentLessonPlans, WEIGHTS } from '../src/algorithm.js';

test('review F2: exact seat check — two big cars suffice, no third car', () => {
  const kidsOf = (id, n) => Array.from({ length: n }, (_, i) => ({ id: `${id}k${i}`, name: `${id}${i}` }));
  const mk = (id, n, lng) => ({ id, name: id, kids: kidsOf(id, n), seats: 8, lat: 50.77, lng });
  const families = [mk('d1', 1, 4.50), mk('d2', 1, 4.60), mk('p1', 3, 4.51), mk('p2', 3, 4.59), mk('p3', 2, 4.52), mk('p4', 2, 4.58), mk('p5', 2, 4.53), mk('w', 2, 4.57)];
  const all = (f, to) => ({ kids: f.kids.map((k) => k.id), to, from: to });
  const responses = Object.fromEntries(families.map((f) => [f.id, all(f, need)]));
  responses.d1 = all(families[0], driving(8));
  responses.d2 = all(families[1], driving(8));
  responses.w = all(families[7], can(4));
  const plan = computePlan({ week: W, families, studio, responses });
  assert.equal(plan.legs.to.cars.length, 2);
  assert.equal(plan.legs.to.seatsShort, 0);
  // and the raw check itself
  const { packable } = _internals;
  assert.equal(packable([{ cap: 8, kids: 1 }, { cap: 8, kids: 1 }], [3, 3, 2, 2, 2, 2].map((k) => ({ kids: k }))), true);
  assert.equal(packable([{ cap: 8, kids: 1 }, { cap: 8, kids: 1 }], [3, 3, 3, 3, 3].map((k) => ({ kids: k }))), false);
});

test('review F3: driver choice equals the exhaustive minimum', () => {
  const { driverOptions, chooseDrivers, seatRiders, legParticipants } = _internals;
  for (let seed = 1; seed <= 25; seed++) {
    let x = seed * 9301 + 49297;
    const rnd = () => ((x = (x * 9301 + 49297) % 233280) / 233280);
    const st = ['need', 'can', 'rather_not', 'can', 'driving', 'need', 'self'];
    const families = Array.from({ length: 8 }, (_, i) => fam('f' + i, 4.45 + rnd() * 0.2, { lat: 50.74 + rnd() * 0.08, seats: 2 + Math.floor(rnd() * 3) }));
    const responses = Object.fromEntries(families.map((f) => [f.id, ans({ status: st[Math.floor(rnd() * st.length)], seats: f.seats }, { status: st[Math.floor(rnd() * st.length)], seats: f.seats })]));
    const stats = Object.fromEntries(families.map((f) => [f.id, { rate: rnd() }]));
    const answers = Object.fromEntries(families.map((f) => [f.id, effectiveAnswer(f, responses[f.id])]));
    const parts = { to: legParticipants(families, answers, 'to'), from: legParticipants(families, answers, 'from') };
    // exhaustive reference
    const fullCost = (o, leg) => {
      const ids = new Set(o.drivers.map((d) => d.id));
      const seat = seatRiders(o.drivers, parts[leg].filter((p) => !ids.has(p.id)), studio);
      return o.base + WEIGHTS.km * seat.cars.reduce((s, c) => s + c.km, 0);
    };
    const A = driverOptions(parts.to, stats, W, 'to'), B = driverOptions(parts.from, stats, W, 'from');
    let ref = Infinity;
    for (const a of A) for (const b of B) {
      let c = fullCost(a, 'to') + fullCost(b, 'from');
      for (const d of a.drivers) if (b.drivers.some((y) => y.id === d.id) && (a.optionalIds.has(d.id) || b.optionalIds.has(d.id))) c += WEIGHTS.bothLegs;
      ref = Math.min(ref, c);
    }
    const got = chooseDrivers(parts, stats, W, studio).cost;
    assert.ok(Math.abs(got - ref) < 1e-9, `seed ${seed}: got ${got}, exhaustive ${ref}`);
  }
});

test('review F5: cancelled weeks do not shrink the fairness window', () => {
  const weeks = ['w1', 'w2', 'w3', 'w4'];
  const rec = { w1: { plan: 'P1' }, w2: { plan: 'P2' }, w3: { cancelled: true, plan: null }, w4: { cancelled: true, plan: null } };
  assert.deepEqual(recentLessonPlans(weeks, rec, 2), ['P1', 'P2']);
  assert.deepEqual(recentLessonPlans(weeks, { ...rec, w4: { plan: 'P4' } }, 2), ['P2', 'P4']);
});

test('performance: 12 families, many can drive, both legs < 2 s', () => {
  const families = Array.from({ length: 12 }, (_, i) => fam('g' + i, 4.46 + i * 0.012, { lat: 50.75 + (i % 4) * 0.015 }));
  const responses = Object.fromEntries(families.map((f, i) => [f.id, ans(i % 4 === 0 ? need : can(2 + (i % 3)), i % 3 === 0 ? need : rather(3))]));
  const t = Date.now();
  computePlan({ week: W, families, studio, responses });
  assert.ok(Date.now() - t < 2000, `took ${Date.now() - t} ms`);
});
