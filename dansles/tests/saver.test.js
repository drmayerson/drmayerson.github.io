import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSaver } from '../src/saver.js';

// Controllable fake timers and fake server.
function harness({ failFirst = 0 } = {}) {
  let now = 0; const timers = new Map(); let id = 0;
  const setTimer = (fn, ms) => { timers.set(++id, { at: now + ms, fn }); return id; };
  const clearTimer = (t) => timers.delete(t);
  const advance = async (ms) => {
    now += ms;
    for (const [k, t] of [...timers]) if (t.at <= now) { timers.delete(k); t.fn(); }
    await tick();
  };
  const tick = () => new Promise((r) => setImmediate(r));
  const server = { stored: {}, calls: [], pending: [] , fails: failFirst };
  // send() resolves only when the test releases it, so "in flight" can be held open
  const send = (key, value) => new Promise((resolve) => {
    server.calls.push(value);
    server.pending.push(() => {
      if (server.fails > 0) { server.fails--; resolve(false); return; }
      server.stored[key] = value; resolve(true);
    });
  });
  const release = async () => { const f = server.pending.shift(); f && f(); await tick(); await tick(); };
  const saver = createSaver(send, { delay: 450, setTimer, clearTimer });
  const states = [];
  return { saver, server, advance, release, tick, states };
}

test('R1: an older save finishing during a newer edit\'s debounce does not show "saved"', async () => {
  const h = harness();
  h.saver.edit('w|f', 'A');
  await h.advance(450);                   // A sent, in flight
  assert.equal(h.saver.status('w|f'), 'saving');
  h.saver.edit('w|f', 'B');               // B waits in its debounce
  await h.release();                      // A acknowledged
  assert.equal(h.saver.status('w|f'), 'saving', 'B is not saved yet');
  await h.advance(450);                   // B sent
  await h.release();                      // B acknowledged
  assert.equal(h.saver.status('w|f'), 'saved');
  assert.equal(h.server.stored['w|f'], 'B');
});

test('R1: leaving before the debounce expires still sends the edit (flush)', async () => {
  const h = harness();
  h.saver.edit('w|f', 'A');
  h.saver.flush('w|f');                   // editor closes / page hidden
  await h.tick();
  assert.deepEqual(h.server.calls, ['A']);
  await h.release();
  assert.equal(h.saver.status('w|f'), 'saved');
  await h.advance(1000);
  assert.deepEqual(h.server.calls, ['A'], 'no duplicate send after the old timer');
});

test('R1: closing and reopening the editor while a request is in flight keeps order', async () => {
  const h = harness();
  h.saver.edit('w|f', 'A');
  h.saver.flush('w|f');                   // first editor closes; A in flight
  await h.tick();
  // a new editor instance subscribes to the same key and edits again
  const seen = [];
  const off = h.saver.subscribe('w|f', (st) => seen.push(st));
  assert.equal(seen.at(-1), 'saving');
  h.saver.edit('w|f', 'B');
  h.saver.flush('w|f');
  await h.tick();
  assert.deepEqual(h.server.calls, ['A'], 'B waits until A is done');
  await h.release();                      // A done
  assert.deepEqual(h.server.calls, ['A', 'B']);
  assert.equal(h.saver.status('w|f'), 'saving');
  await h.release();                      // B done
  assert.equal(h.server.stored['w|f'], 'B');
  assert.equal(seen.at(-1), 'saved');
  off();
});

test('R1: failure shows "failed", retry sends the latest value', async () => {
  const h = harness({ failFirst: 1 });
  h.saver.edit('w|f', 'A');
  await h.advance(450);
  await h.release();
  assert.equal(h.saver.status('w|f'), 'failed');
  assert.equal(h.saver.pendingValue('w|f'), 'A');
  h.saver.retry('w|f');
  await h.tick();
  await h.release();
  assert.equal(h.saver.status('w|f'), 'saved');
  assert.equal(h.server.stored['w|f'], 'A');
});

test('R1: rapid edits only send the newest value', async () => {
  const h = harness();
  for (const v of ['A', 'B', 'C']) { h.saver.edit('w|f', v); await h.advance(100); }
  await h.advance(450);
  await h.release();
  assert.deepEqual(h.server.calls, ['C']);
  assert.equal(h.saver.status('w|f'), 'saved');
});

test('hasPending reports unsaved edits until the server acknowledged them', async () => {
  const h = harness();
  assert.equal(h.saver.hasPending(), false);
  h.saver.edit('w|f', 'A');
  assert.equal(h.saver.hasPending(), true);
  await h.advance(450);
  assert.equal(h.saver.hasPending(), true, 'in flight');
  await h.release();
  assert.equal(h.saver.hasPending(), false);
});
