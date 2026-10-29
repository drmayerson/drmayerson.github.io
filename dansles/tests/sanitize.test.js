import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeState, sanitizeFamily, sanitizeSettings } from '../src/sanitize.js';
import { computePlan, effectiveAnswer } from '../src/algorithm.js';
import { DEFAULT_SETTINGS } from '../src/store.js';

test('R3: the review\'s malformed family no longer breaks planning', () => {
  const bad = { id: 'f-test', name: 123, kids: 'invalid' };
  const f = sanitizeFamily(bad);
  assert.equal(f.name, '123');
  assert.deepEqual(f.kids, []);
  const ok = { id: 'f-ok', name: 'Ok', kids: [{ id: 'k1', name: 'Kid' }], seats: 3 };
  const state = sanitizeState({ families: [bad, ok, null, { id: 'bad id!' }], responses: { '2026-11-04': { 'f-ok': { kids: ['k1'], to: { status: 'maybe' }, from: 'x' }, 'f-x': 7 } }, weeks: { '2026-10-28': { plan: { legs: 'nonsense' } } } });
  assert.deepEqual(state.families.map((x) => x.id), ['f-test', 'f-ok']);
  assert.deepEqual(state.responses['2026-11-04']['f-ok'].to, { status: 'need' });
  assert.equal(state.responses['2026-11-04']['f-x'], undefined);
  assert.equal(state.weeks['2026-10-28'].plan, null);
  assert.doesNotThrow(() => computePlan({ week: '2026-11-04', families: state.families, responses: state.responses['2026-11-04'] }));
  assert.doesNotThrow(() => effectiveAnswer(state.families[0], null));
});

test('R3: malformed settings fall back to defaults', () => {
  const s = sanitizeSettings({ weekday: 9, time: '25:00', lookbackWeeks: 'x', studio: 'nowhere' }, DEFAULT_SETTINGS);
  assert.equal(s.weekday, DEFAULT_SETTINGS.weekday);
  assert.equal(s.time, DEFAULT_SETTINGS.time);
  assert.equal(s.lookbackWeeks, DEFAULT_SETTINGS.lookbackWeeks);
  assert.equal(s.studio.lat, null);
});
