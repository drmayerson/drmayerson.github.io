// Debounced, ordered saving of answers. One "slot" per key (week|family), kept at module level so
// it survives the editor closing and reopening.
//
// Guarantees:
//  - every edit gets a new revision number immediately;
//  - requests for one key are sent strictly one after another, newest value last;
//  - status is 'saved' only when the server acknowledged the *latest* revision;
//  - flush() sends a pending edit right away (used when the editor closes or the page is hidden).
//
// Limitation: the queue lives in memory. When the whole page is closed, flushing is best-effort:
// the browser may stop before a request (or one queued behind it) reaches the server. The app warns
// before closing while hasPending() is true, and tells people to wait for "Opgeslagen".

export function createSaver(send, { delay = 450, setTimer = setTimeout, clearTimer = clearTimeout } = {}) {
  const slots = new Map();

  const slot = (key) => {
    if (!slots.has(key)) {
      slots.set(key, { rev: 0, value: undefined, ackRev: 0, failedRev: 0, sentRev: 0, timer: null, inflight: 0, chain: Promise.resolve(), listeners: new Set() });
    }
    return slots.get(key);
  };

  const statusOf = (s) => {
    if (s.rev === 0) return 'idle';
    if (s.timer || s.inflight || s.sentRev > s.ackRev && s.sentRev > s.failedRev) return 'saving';
    if (s.ackRev === s.rev) return 'saved';
    if (s.failedRev === s.rev) return 'failed';
    return 'saving';
  };
  const emit = (s) => { const st = statusOf(s); s.listeners.forEach((fn) => fn(st)); };

  function edit(key, value) {
    const s = slot(key);
    s.rev += 1;
    s.value = value;
    if (s.timer) clearTimer(s.timer);
    s.timer = setTimer(() => { s.timer = null; flush(key); }, delay);
    emit(s);
    return s.rev;
  }

  function flush(key) {
    const s = slots.get(key);
    if (!s) return Promise.resolve();
    if (s.timer) { clearTimer(s.timer); s.timer = null; }
    const rev = s.rev;
    if (rev === 0 || rev === s.ackRev || rev === s.sentRev) { emit(s); return s.chain; }
    s.sentRev = rev;
    const value = s.value;
    s.chain = s.chain.then(async () => {
      if (rev < s.rev) return; // a newer edit exists; its own flush sends the newest value
      s.inflight += 1; emit(s);
      let ok = false;
      try { ok = (await send(key, value)) !== false; } catch { ok = false; }
      s.inflight -= 1;
      if (ok) s.ackRev = Math.max(s.ackRev, rev);
      else s.failedRev = Math.max(s.failedRev, rev);
      emit(s);
    });
    emit(s);
    return s.chain;
  }

  /** Send the latest value again after a failure. */
  function retry(key) {
    const s = slots.get(key);
    if (!s) return Promise.resolve();
    s.sentRev = 0;
    return flush(key);
  }

  function flushAll() { return Promise.all([...slots.keys()].map(flush)); }

  function status(key) { return statusOf(slot(key)); }

  /** True while any edit is not yet acknowledged by the server (pending, in flight or failed). */
  function hasPending() { return [...slots.values()].some((s) => s.rev > s.ackRev); }

  /** The newest value edited for this key (not necessarily saved yet), or undefined. */
  function pendingValue(key) { const s = slots.get(key); return s && s.rev > s.ackRev ? s.value : undefined; }

  function subscribe(key, fn) {
    const s = slot(key);
    s.listeners.add(fn);
    fn(statusOf(s));
    return () => s.listeners.delete(fn);
  }

  return { edit, flush, retry, flushAll, status, pendingValue, subscribe, hasPending };
}
