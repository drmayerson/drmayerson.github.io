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
