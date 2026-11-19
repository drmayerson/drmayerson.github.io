// Audience mode: feed simulated audiences (16 overlapping whoops at 95-330 Hz, up to 4 at once, plus a
// steady note and a falling glide) through the page's own group detector in 2048-sample chunks, as the
// microphone would. Dense low voices with interleaved harmonics are hard, so the bar is set on totals
// over eight audiences; the demo audience (default seed) must come out (nearly) perfect.
import assert from 'node:assert/strict';
import { loadChirpCore } from './load-core.mjs';
const C = loadChirpCore();
let fails = 0;
const check = (name, fn) => { try { fn(); console.log('ok   ', name); } catch (e) { fails++; console.log('FAIL ', name, '-', e.message); } };

function runCrowd(sr, seed, gain = 1) {
  const o = C.synthCrowd(sr, seed);
  const det = C.makeGroupDetector(sr, 0);
  const dets = [];
  for (let i = 0; i < o.x.length; i += 2048) { det.push(o.x.subarray(i, i + 2048).map(v => v * gain)); dets.push(...det.run(false).dets); }
  dets.push(...det.finish());
  const found = o.truth.filter(tr => dets.some(d => Math.min(d.t1, tr.t1) - Math.max(d.t0, tr.t0) > 0.3 * (tr.t1 - tr.t0) && Math.abs(Math.log(d.Mc / tr.Mc)) < 0.25)).length;
  const fake = dets.filter(d => (d.t0 > 6.55 && d.t1 < 7.65 && !o.truth.some(t => t.t0 < d.t1 && t.t1 > d.t0)) || d.t0 > 11.25).length;
  return { o, dets, found, fake };
}

let T = 0, F = 0, D = 0, fakes = 0;
const t0 = performance.now();
[3, 5, 7, 11, 13, 17, 23, 29].forEach((seed, i) => {
  const sr = i % 2 ? 44100 : 48000, r = runCrowd(sr, seed);
  console.log(`      seed ${seed}, ${sr} Hz: ${r.found}/${r.o.truth.length} found (mass within 25 %), ${r.dets.length} detections${r.fake ? ', ' + r.fake + ' distractor(s) counted' : ''}`);
  T += r.o.truth.length; F += r.found; D += r.dets.length; fakes += r.fake;
});
const rt = (performance.now() - t0) / (8 * 12.5 * 1000);
check(`eight audiences: ${F}/${T} whoops found`, () => assert.ok(F >= 0.8 * T));
check(`eight audiences: ${D} detections for ${T} whoops`, () => assert.ok(D <= 1.15 * T));
check('steady note and falling glide never counted', () => assert.equal(fakes, 0));
check(`runs at ${(rt * 100).toFixed(0)} % of real time`, () => assert.ok(rt < 0.5));
for (const sr of [44100, 48000]) check(`demo audience at ${sr} Hz`, () => {
  const r = runCrowd(sr); assert.ok(r.found >= 15 && r.dets.length <= 17, `${r.found} found, ${r.dets.length} detections`);
});
check('quiet audience (gain 0.05) still works', () => { const r = runCrowd(48000, 5, 0.05); assert.ok(r.found >= 14, `found ${r.found}`); });
check('silence gives nothing', () => { const det = C.makeGroupDetector(48000); det.push(new Float32Array(48000 * 3)); assert.equal(det.run(false).dets.length + det.finish().length, 0); });
check('white noise gives nothing', () => {
  let s = 9; const rnd = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
  const det = C.makeGroupDetector(48000); const x = Float32Array.from({ length: 48000 * 4 }, () => 0.2 * (rnd() - 0.5));
  let n = 0; for (let i = 0; i < x.length; i += 2048) { det.push(x.subarray(i, i + 2048)); n += det.run(false).dets.length; }
  assert.equal(n + det.finish().length, 0);
});
check('one clean whoop counts once with the right mass', () => {
  const o = C.synthChirp({ sr: 48000, Mc: 1.2, fStart: 140, fStop: C.fOfTau(1.2, 0.05), tStart: 0.3, tail: 0.5, harm: 0.5, vib: 0.2, noise: 0.004 });
  const det = C.makeGroupDetector(48000); det.push(o.x); const d = [...det.run(false).dets, ...det.finish()];
  assert.equal(d.length, 1); assert.ok(Math.abs(d[0].Mc / 1.2 - 1) < 0.1, 'Mc ' + d[0].Mc.toFixed(3));
});
console.log(fails ? `\n${fails} FAILED` : '\nall passed'); process.exit(fails ? 1 : 0);
