import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computePlan, effectiveAnswer, answerFingerprint, changedSincePlan, movePassenger, homePoint } from '../src/algorithm.js';
import { sanitizeFamily, sanitizeResponse, familyPayload, responsePayload, HOMES_SCHEMA } from '../src/sanitize.js';

const W = '2026-11-11';
const studio = { lat: 50.77, lng: 4.55 };
const fam = (id, lng, extra = {}) => ({ id, name: id, kids: [{ id: id + 'k', name: id }], seats: 3, lat: 50.77, lng, ...extra });
const need = { status: 'need' };
const driving = (s = 3) => ({ status: 'driving', seats: s });
const ans = (to, from = to, extra = {}) => ({ to, from, ...extra });

test('homes: primary mode uses address 1 unless the week says otherwise', () => {
  const f = fam('a', 4.5, { home2: { label: 'oma', lat: 50.77, lng: 4.6 }, homeMode: 'primary' });
  assert.deepEqual(effectiveAnswer(f, null).home, { to: 1, from: 1 });
  assert.deepEqual(effectiveAnswer(f, ans(need, need, { home: { to: 2, from: 2 } })).home, { to: 2, from: 2 });
  assert.deepEqual(effectiveAnswer(f, ans(need, need, { home: { to: 1, from: 2 } })).home, { to: 1, from: 2 });
});

test('homes: alternate mode never assumes an address', () => {
  const f = fam('a', 4.5, { home2: { label: 'papa', lat: 50.77, lng: 4.6 }, homeMode: 'alternate' });
  assert.deepEqual(effectiveAnswer(f, null).home, { to: null, from: null });
  assert.deepEqual(effectiveAnswer(f, ans(need)).home, { to: null, from: null });
  assert.deepEqual(effectiveAnswer(f, ans(need, need, { home: { to: 2, from: null } })).home, { to: 2, from: null });
});

test('homes: families with one address are unchanged (fingerprint, home)', () => {
  const f = fam('a', 4.5);
  const a = effectiveAnswer(f, ans(need));
  assert.equal(a.home, null);
  assert.equal(answerFingerprint(a), '1|need|need');
});

test('homes: the planner routes from the chosen address', () => {
  // two drivers far apart; the rider lives in the west at home 1 and in the east at home 2
  const families = [fam('west', 4.50), fam('east', 4.60), fam('kid', 4.505, { home2: { label: 'papa', lat: 50.77, lng: 4.595 }, homeMode: 'alternate' })];
  const base = { west: ans(driving()), east: ans(driving()) };
  const at = (n) => computePlan({ week: W, families, studio, responses: { ...base, kid: ans(need, need, { home: { to: n, from: n } }) } });
  const carOf = (plan) => plan.legs.to.cars.find((c) => c.riders.includes('kid')).driverId;
  assert.equal(carOf(at(1)), 'west');
  assert.equal(carOf(at(2)), 'east');
  // different address per leg
  const split = computePlan({ week: W, families, studio, responses: { ...base, kid: ans(need, need, { home: { to: 1, from: 2 } }) } });
  assert.equal(split.legs.to.cars.find((c) => c.riders.includes('kid')).driverId, 'west');
  assert.equal(split.legs.from.cars.find((c) => c.riders.includes('kid')).driverId, 'east');
});

test('homes: a driver drives from the chosen address', () => {
  const families = [fam('d', 4.50, { home2: { lat: 50.77, lng: 4.60 }, homeMode: 'alternate' }), fam('r1', 4.505), fam('r2', 4.595)];
  const plan = (n) => computePlan({ week: W, families, studio, responses: { d: ans(driving(2), driving(2), { home: { to: n, from: n } }), r1: ans(need), r2: ans(need) } });
  // with 2 seats (own kid + 1) only one rider fits: the one nearer to where the driver starts
  assert.deepEqual(plan(1).legs.to.cars[0].riders, ['r1']);
  assert.deepEqual(plan(2).legs.to.cars[0].riders, ['r2']);
});

test('homes: changing the address after a plan is stored is detected', () => {
  const f = fam('a', 4.5, { home2: { lat: 50.77, lng: 4.6 }, homeMode: 'primary' });
  const families = [f, fam('b', 4.52)];
  const responses = { a: ans(need), b: ans(driving()) };
  const plan = computePlan({ week: W, families, studio, responses });
  assert.deepEqual(changedSincePlan(plan, families, responses), []);
  assert.deepEqual(changedSincePlan(plan, families, { ...responses, a: ans(need, need, { home: { to: 2, from: 2 } }) }), ['a']);
});

test('homes: manual moves recompute the route from this week\'s address', () => {
  const families = [fam('west', 4.50), fam('east', 4.60), fam('kid', 4.505, { home2: { lat: 50.77, lng: 4.595 }, homeMode: 'primary' })];
  const responses = { west: ans(driving()), east: ans(driving()), kid: ans(need, need, { home: { to: 2, from: 2 } }) };
  const plan = computePlan({ week: W, families, studio, responses });
  const pointOf = (id) => homePoint(families.find((f) => f.id === id), id === 'kid' ? 2 : 1);
  const moved = movePassenger(plan, 'to', 'kid', 'west', { families, studio, kidsCount: () => 1, pointOf });
  const viaHome1 = movePassenger(plan, 'to', 'kid', 'west', { families, studio, kidsCount: () => 1 });
  assert.ok(moved.legs.to.cars.find((c) => c.driverId === 'west').km > viaHome1.legs.to.cars.find((c) => c.driverId === 'west').km);
});

test('homes: sanitising keeps valid fields and drops junk', () => {
  const f = sanitizeFamily({ id: 'f-a', name: 'A', kids: [{ id: 'k', name: 'K' }], seats: 3, homeLabel: 'mama', home2: { label: 'papa', address: 'X', lat: 50.7, lng: 4.5, junk: 1 }, homeMode: 'alternate' });
  assert.deepEqual(f.home2, { label: 'papa', address: 'X', lat: 50.7, lng: 4.5 });
  assert.equal(f.homeMode, 'alternate');
  assert.equal(sanitizeFamily({ id: 'f-b', name: 'B', kids: [], home2: 'nope', homeMode: 'weird' }).home2, null);
  assert.deepEqual(sanitizeResponse({ to: need, from: need, home: { to: 2, from: 7 } }).home, { to: 2, from: null });
  assert.equal(sanitizeResponse({ to: need, from: need, home: { to: 3 } }).home, undefined);
});

test('homes: payloads stay compatible with an older database', () => {
  const f = { id: 'f-a', name: 'A', kids: [], seats: 3, homeLabel: 'mama', home2: { label: 'papa', address: 'X', lat: 50.7, lng: 4.5 }, homeMode: 'alternate', updatedAt: 'x' };
  const old = familyPayload(f, 1);
  assert.ok(!('home2' in old) && !('homeLabel' in old) && !('homeMode' in old) && !('updatedAt' in old));
  const cur = familyPayload(f, HOMES_SCHEMA);
  assert.deepEqual(cur.home2, f.home2);
  assert.equal(cur.homeMode, 'alternate');
  const none = familyPayload({ ...f, home2: null }, HOMES_SCHEMA);
  assert.ok('home2' in none && none.home2 === null && none.homeLabel === null && none.homeMode === null, 'explicit null = removed');
  const r = { kids: [], to: need, from: need, home: { to: 2, from: 2 } };
  assert.ok(!('home' in responsePayload(r, f, 1)));
  assert.deepEqual(responsePayload(r, f, HOMES_SCHEMA).home, { to: 2, from: 2 });
  assert.ok(!('home' in responsePayload(r, { ...f, home2: null }, HOMES_SCHEMA)), 'no second address → no home');
  assert.equal(responsePayload(null, f, HOMES_SCHEMA), null);
});
