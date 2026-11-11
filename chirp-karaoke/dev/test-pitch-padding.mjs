// Regression test for review K1: recordings with little silence around the voice were rejected
// ("no clear pitch") because the loudness gate followed the quietest 15 % of the recording.
// Feeds synthetic chirps with 0, 0.05, 0.2 and 0.6 s of padding through the page's own analyze().
import assert from 'node:assert/strict';
import { loadChirpCore } from './load-core.mjs';
const C = loadChirpCore();
let fails = 0;
const check = (name, fn) => { try { fn(); console.log('ok   ', name); } catch (e) { fails++; console.log('FAIL ', name, '-', e.message); } };

const cases = [
  { Mc: 1.2, f0: 140, sr: 16000, label: '0.8 s chirp, 16 kHz' },
  { Mc: 0.8, f0: 120, sr: 48000, label: '~2 s chirp, 48 kHz (mic rate)' },
  { Mc: 1.5, f0: 110, sr: 44100, label: '1.5 s chirp, 44.1 kHz, voice-like (vibrato, harmonics)', vib: 0.25, harm: 0.5, jitter: 0.05 },
];
for (const cs of cases) for (const pad of [0, 0.05, 0.2, 0.6]) {
  check(`${cs.label}, padding ${pad} s`, () => {
    const o = C.synthChirp({ sr: cs.sr, Mc: cs.Mc, fStart: cs.f0, fStop: C.fOfTau(cs.Mc, 0.1), tStart: pad, tail: pad, noise: 0.004, vib: cs.vib || 0, harm: cs.harm || 0, jitter: cs.jitter || 0, seed: 3 });
    const r = C.analyze(o.x, o.sr, 'real');
    assert.equal(r.err, undefined, 'rejected: ' + r.err);
    const rel = r.fit.Mc / cs.Mc - 1;
    assert.ok(Math.abs(rel) < 0.06, `chirp mass ${r.fit.Mc.toFixed(3)} vs ${cs.Mc} (${(rel * 100).toFixed(1)} %)`);
    assert.ok(r.fit.score > 0.8, 'score ' + r.fit.score.toFixed(2));
  });
}
// A musical glide (constant semitones per second) held for the whole press must also be accepted.
for (const pad of [0, 0.05, 0.2, 0.6]) check(`2 s musical glide 150->450 Hz, padding ${pad} s`, () => {
  const sr = 48000, L = 2, n = Math.round((L + 2 * pad) * sr), x = new Float32Array(n); let ph = 0;
  for (let i = Math.round(pad * sr); i < Math.round((pad + L) * sr); i++) { const t = i / sr - pad; ph += 2 * Math.PI * 150 * Math.pow(3, t / L) / sr; x[i] = 0.3 * Math.sin(ph) * Math.min(1, t / 0.03, (L - t) / 0.02); }
  const r = C.analyze(x, sr, 'real');
  assert.equal(r.err, undefined, 'rejected: ' + r.err);
});
// Room noise measured before the press must not gate out the voice.
check('room level 0.02 passed in, voice at 0.2', () => {
  const o = C.synthChirp({ sr: 48000, Mc: 1.2, fStart: 140, fStop: C.fOfTau(1.2, 0.1), tStart: 0, tail: 0, noise: 0.04, seed: 5 });
  const r = C.analyze(o.x, o.sr, 'real', 0.02); assert.equal(r.err, undefined, 'rejected: ' + r.err);
});
check('silence gives "quiet"', () => { const r = C.analyze(new Float32Array(48000), 48000, 'real'); assert.equal(r.err, 'quiet'); });

// Karaoke score: singing the target (even an octave up, a bit late) scores high; a steady note scores low.
for (const tg of C.TARGETS) {
  const McV = tg.Mc / tg.factor;
  const sing = (shift, oct, sr = 48000) => C.synthChirp({ sr, Mc: McV, fStart: C.fOfTau(McV, tg.tauA) * 2 ** oct, fStop: C.fOfTau(McV, tg.tauB) * 2 ** oct, tStart: tg.t0 + shift, tail: 0.2, noise: 0.003, harm: 0.4 });
  check(`karaoke ${tg.id}: on time`, () => { const o = sing(0, 0); const r = C.analyze(o.x, o.sr, tg.mode); const k = C.karaokeScore(r.voiced, tg); assert.ok(k.score > 0.8, 'score ' + k.score.toFixed(2)); });
  // (octave shift applied to the frequencies of a chirp changes its mass: emulate by scaling the voice frequencies only)
  check(`karaoke ${tg.id}: 0.25 s late`, () => { const o = sing(0.25, 0); const r = C.analyze(o.x, o.sr, tg.mode); const k = C.karaokeScore(r.voiced, tg); assert.ok(k.score > 0.75, 'score ' + k.score.toFixed(2)); });
  check(`karaoke ${tg.id}: one octave up`, () => { const r = C.analyze(sing(0, 0).x, 48000, tg.mode); const v = r.voiced.map(p => ({ t: p.t, f: p.f * 2 })); const k = C.karaokeScore(v, tg); assert.ok(k.score > 0.8 && k.oct === 1, 'score ' + k.score.toFixed(2) + ' oct ' + k.oct); });
  check(`karaoke ${tg.id}: steady note scores low`, () => {
    const sr = 48000, x = new Float32Array(sr * 2); for (let i = 0; i < x.length; i++) x[i] = 0.3 * Math.sin(2 * Math.PI * 200 * i / sr);
    const k = C.karaokeScore(C.analyze(x, sr, tg.mode).voiced, tg); assert.ok(k.score < 0.45, 'score ' + k.score.toFixed(2)); });
}
console.log(fails ? `\n${fails} FAILED` : '\nall passed'); process.exit(fails ? 1 : 0);
