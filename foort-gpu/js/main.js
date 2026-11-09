// @ts-check
// Viewer bootstrap: BH-mode metrics and the ST3Cr fuzzball (M6) on the tabulated GPU tracer (Kerr also on the
// closed-form shader), progressive refinement, live re-bake of the metric tables, disc emission, debug views.
// Camera lengths in the UI are in units of the metric's M_ADM (1 for the BH metrics, 24 for ST3Cr).
import { CLOSED_FORMS } from './metrics/closedForm.js';
import { createBackend } from './gpu/backend.js';
import { TracePipeline, finalLevels } from './gpu/pipeline.js';
import { gpuTraceSetup, tableSpec, fluidSpec } from './gpu/traceConfig.js';
import { BakeClient } from './bake/client.js';
import { metricEntry, paramBounds, createMetric } from './metrics/registry.js';
import { decodeRecord, RECORD_FLOATS } from './gpu/traceConfig.js';
import { discIntensity, EMISSION_PRESETS } from './fluid/emission.js';
import { fluidTableRcirc } from './fluid/fluidTable.js';
import { CONTROLS, VIEWS, buildControls, initialState, stateToQuery } from './ui/controls.js';
import { loadNoiseField, autoNoiseField, noiseCover } from './noise/noiseField.js';

const $ = (/** @type {string} */ id) => /** @type {HTMLElement} */ (document.getElementById(id));
const DEG = Math.PI / 180;

/** Metric parameters with a slider (non-fixed), per registry id. @param {string} id */
const paramKeys = (id) => metricEntry(id).params.filter((p) => !p.fixed).map((p) => p.name);

/** Registry id of the state's metric: a zero-limit switch (e.g. ST3Cr's lambda = 0) selects its limit metric. @param {Record<string, any>} s */
export const metricIdFromState = (s) => { const e = metricEntry(s.metric); return e.zeroSwitch && s[e.zeroSwitch.key] ? e.zeroSwitch.id : s.metric; };

/** Default max steps per mode (fuzzball rays scatter in the cap and throat). */
const MAX_STEPS_DEFAULT = { BH: 5000, fuzzball: 5000 };   // fuzzball 5000 (M9 trade, user): disc images identical to 10000

/**
 * Metric parameters of the state, clamped to the registry's validity bounds.
 * @param {Record<string, any>} s @returns {{params: Record<string, number>, clamped: string[]}}
 */
export function metricParamsFromState(s) {
  const id = metricIdFromState(s);
  const entry = metricEntry(id);
  /** @type {Record<string, number>} */
  const params = {};
  for (const k of paramKeys(id)) params[k] = s[k];
  const clamped = [];
  for (const spec of entry.params) {
    if (!(spec.name in params)) continue;
    const bd = paramBounds(spec, params);
    const v = Math.min(Math.max(params[spec.name], bd.min), bd.max);
    if (v !== params[spec.name]) { clamped.push(`${spec.label} clamped to ${v.toPrecision(4)}`); params[spec.name] = v; }
  }
  return { params, clamped };
}

/** @param {Record<string, any>} s @param {boolean} [coarseTables] @returns {import('./gpu/traceConfig.js').ViewParams} */
export function viewFromState(s, coarseTables = false) {
  const [nx, nth] = String(s.grid).split('x').map(Number);
  const metric = metricIdFromState(s), metricParams = metricParamsFromState(s).params;
  const M = createMetric(metric, metricParams).massADM;
  return {
    metric, metricParams,
    // a path the metric does not have falls back: analytic = Kerr only, closed = metrics with a generated shader
    path: s.path === 'analytic' ? (metric === 'kerr' ? 'analytic' : 'auto') : s.path === 'closed' ? (CLOSED_FORMS[metric] ? 'closed' : 'tabulated') : s.path, grid: coarseTables ? { nx: 128, nth: 64 } : { nx, nth },
    camera: { r: s.r * M, theta: s.inc * DEG, screen: s.screen * M, cx: s.cx * M, cy: s.cy * M },
    N: s.N, eps: s.eps, maxSteps: s.maxSteps, crossing: s.crossing, storeH: s.storeH,
    // larger steps beyond 20 M, up to 4x (M9 accuracy trade, adopted by the user): escape directions shift ~3e-4 rad
    farSteps: s.farSteps ? { r: 20, max: 4 } : null,
    fluid: { xi: s.xi, betaR: s.betaR, betaPhi: s.betaPhi, model: s.fluidModel },
    texelReuse: !!s.texelReuse, compact: s.compact ? { n1: 1500 } : null,
    tailEmission: { redshiftPower: s.redshiftPower, fudge: s.fudge, maxPasses: Number(s.maxPasses) },
  };
}

/**
 * Display time of the state: observer time, slow/fast light, M_ADM, procedural advection, noise amplitude.
 * @param {Record<string, any>} s @param {number} tObs @param {number} M @returns {import('./gpu/backend.js').DisplayTime}
 */
export const timeFromState = (s, tObs, M) => ({ tObs, slow: !!s.slowLight, M, advect: s.advect ? s.advectD : 0, sigma: s.sigmaN });

/** @param {Record<string, any>} s @returns {import('./fluid/emission.js').EmissionParams} */
export const emissionFromState = (s) => ({ mu: s.mu, gamma: s.gamma, sigma: s.sigma, redshiftPower: s.redshiftPower, fudge: s.fudge, maxPasses: Number(s.maxPasses) });

const LEGENDS = {
  fourColor: [['#e44a40', 'θ < π/2, φ < π'], ['#409ce4', 'θ < π/2, φ > π'], ['#f0c83c', 'θ > π/2, φ < π'], ['#5abe6e', 'θ > π/2, φ > π'], ['#000', 'horizon']],
  term: [['#000', 'horizon / inner cut'], ['#8cbff2', 'escaped'], ['#f28c26', 'time out'], ['#f0f', 'NaN'], ['#b30d0d', 'singularity']],
  passes: [['#000', '0'], ['#4073d9', '1'], ['#f29933', '2'], ['#fff', '≥ 3']],
};

async function main() {
  const query = new URLSearchParams(location.search);
  const state = initialState(query);
  // phones (decision E9): a 64 MB record cache and no idle pre-tracing unless the URL asks for it
  const isPhone = navigator.maxTouchPoints > 0 && Math.min(screen.width, screen.height) < 820;
  if (isPhone && !query.has('pretrace')) state.pretrace = false;
  const canvas = /** @type {HTMLCanvasElement} */ ($('view'));
  const stage = (/** @type {string} */ t) => { $('status').textContent = t; /** @type {any} */ (window).__foortStage = t; };
  const backend = await createBackend(canvas, { onStage: stage });
  // the OS may reset the GPU when one dispatch runs too long (very high resolution or max steps on a slow GPU);
  // WebGL then loses its context and every texture: say so instead of showing a frozen image
  canvas.addEventListener('webglcontextlost', (e) => {
    e.preventDefault();
    $('errorBox').hidden = false;
    $('error').textContent = 'The GPU reset the drawing context, usually because one trace ran too long. Reload the page, '
      + 'and try a lower resolution or fewer max steps.';
    $('status').textContent = 'GPU context lost';
  });
  let lastStats = /** @type {import('./gpu/pipeline.js').TraceStats|null} */ (null);
  let level = 0;
  const pipeline = new TracePipeline(backend, {
    cacheBytes: (isPhone ? 64 : 256) * 2 ** 20,
    onStage: stage,
    onProgress: (p) => { level = p.level; $('status').textContent = `tracing: stride ${p.level}, tile ${p.done}/${p.total}`; requestDraw(); },
  });

  // noise field: inoisy production field (M8) or the M7 placeholder
  let noise = /** @type {import('./noise/noiseField.js').NoiseField|null} */ (null);
  let noiseName = '';
  /** the field the state asks for ('auto': by metric and lambda, Stage 1B B4) */
  const wantedNoise = () => (state.noiseField === 'auto' ? autoNoiseField(metricIdFromState(state), metricParamsFromState(state).params) : state.noiseField);
  /** load and upload a noise field by name (noise/<name>.json/.bin) */
  const useNoise = async (/** @type {string} */ name) => {
    if (name === noiseName) return;
    try { const f = await loadNoiseField(name); backend.uploadNoise(f); noise = f; noiseName = name; }
    catch (e) { console.warn(`noise field ${name} not loaded:`, e); }
  };
  stage('loading the noise field…');
  await useNoise(wantedNoise());
  /** observer time t_obs in units of M */
  let tObs = 0;

  let autoExposure = 1;
  let noiseCoverage = 1;
  /** @param {Float32Array} rec @param {import('./fluid/emission.js').EmissionParams} em */
  const coverageOf = (rec, em) => {
    if (!noise) return 1;
    let w = 0, wc = 0;
    for (let k = 0; k < rec.length / RECORD_FLOATS; k++) for (const [n, c] of decodeRecord(rec, k).crossings.entries()) {
      if (em.maxPasses > 0 && n + 1 > em.maxPasses) continue;
      const e = (n === 0 ? 1 : em.fudge) * c.g ** em.redshiftPower * discIntensity([{ r: c.r, g: 1 }], { ...em, redshiftPower: 0, fudge: 1, maxPasses: 0 });
      w += e; wc += e * noiseCover(noise.meta, Math.log(c.r / (lastFluid?.M ?? 1)));
    }
    return w > 0 ? wc / w : 1;
  };
  /** tail-bin geometry of the last trace (Stage 1B B2) */
  let lastTail = /** @type {import('./gpu/traceConfig.js').TailGeometry|null} */ (null);
  /** coarse-level records of the last full trace, for auto exposure */
  let coarse = /** @type {Float32Array|null} */ (null);
  const updateExposure = () => {
    if (!coarse) return;
    const em = emissionFromState(state), I = [];
    if (state.envelope === 'circumferential' && lastFluid) { const F = lastFluid; em.radius = (r) => fluidTableRcirc(F, r); }
    for (let k = 0; k < coarse.length / RECORD_FLOATS; k++) {
      const d = decodeRecord(coarse, k, lastTail ?? undefined);
      const v = discIntensity(state.storeH ? d.crossings.slice(0, 2) : d.crossings, em, d.tail);
      if (v > 0) I.push(v);
    }
    // emission-weighted share of the noisy crossings (the first 3) inside the field's range (B4 coverage)
    noiseCoverage = coverageOf(coarse, em);
    I.sort((a, b) => a - b);
    const top = I.length ? I[Math.min(I.length - 1, Math.floor(0.995 * I.length))] : 0;
    autoExposure = top > 0 ? 1 / top : 1;
  };
  let drawQueued = false;
  const requestDraw = () => {
    if (drawQueued) return;
    drawQueued = true;
    requestAnimationFrame(() => { drawQueued = false; draw(); });
  };
  const draw = () => {
    const v = VIEWS[/** @type {keyof typeof VIEWS} */ (state.view)];
    const lo = Number.isNaN(state.lo) ? /** @type {any} */ (v).lo ?? 0 : state.lo;
    const hi = Number.isNaN(state.hi) ? /** @type {any} */ (v).hi ?? 1 : state.hi;
    backend.display({ mode: v.mode, lo, hi, maxSteps: state.maxSteps, rCam: state.r * (lastFluid?.M ?? 1), storeH: !!state.storeH,
      emission: emissionFromState(state), exposure: state.autoExposure ? autoExposure : state.exposure, toneMap: Number(state.toneMap), colorMap: Number(state.colorMap),
      time: timeFromState(state, tObs, lastFluid?.M ?? 1), tail: lastTail, envelope: state.envelope, azimuth: state.az * DEG });
  };

  const legend = () => {
    const items = /** @type {any} */ (LEGENDS)[state.view];
    const v = /** @type {any} */ (VIEWS)[state.view];
    $('legend').innerHTML = items
      ? items.map(([c, t]) => `<span style="background:${c}"></span>${t}`).join('')
      : 'lo' in v ? `inferno colour map from ${Number.isNaN(state.lo) ? v.lo : state.lo} to ${Number.isNaN(state.hi) ? v.hi : state.hi}`
        : state.view === 'emission' ? `disc emission Σ F g^${state.redshiftPower} J(r) over all crossings (the first 3 exact, later ones binned); ${['linear', 'sqrt', 'log', 'asinh'][Number(state.toneMap)]} tone map, exposure ${(state.autoExposure ? autoExposure : state.exposure).toPrecision(3)}${lastFluid?.isco ? `; ISCO r = ${lastFluid.isco.toFixed(3)}${lastFluid.M !== 1 ? ` (${(lastFluid.isco / lastFluid.M).toFixed(3)} M)` : ''}` : ''}${metricEntry(metricIdFromState(state)).emissionNote ? `. Note: ${metricEntry(metricIdFromState(state)).emissionNote}` : ''}`
        : state.view === 'steps' ? `inferno colour map of log(steps), from 1 to max steps (${state.maxSteps})`
          : state.view === 'sky' ? '15° grid in the escape direction (θ, φ), tinted by FOORT quadrant; black: horizon'
            : state.view === 'coverage' ? `Noise coverage: emission-weighted share of the first 3 crossings inside the field's radial range (${noise ? `${noiseName}, r = ${Math.exp(noise.meta.xmin).toPrecision(2)}–${Math.exp(noise.meta.xmax).toPrecision(3)} M` : 'no field'}); green 100%, red 0%, grey: no disc emission. Whole image: ${(100 * noiseCoverage).toFixed(2)}%` : '';
  };

  const perfRow = (/** @type {string} */ k, /** @type {string} */ v) => `<tr><th>${k}</th><td>${v}</td></tr>`;
  const showPerf = (/** @type {import('./gpu/pipeline.js').TraceStats} */ st, /** @type {string[]} */ warnings, /** @type {string} */ bake) => {
    const caps = backend.capabilities();
    const rays = st.N * st.N;
    $('perf').innerHTML =
      perfRow('GPU', String(caps.renderer)) +
      perfRow('metric tables', bake) +
      perfRow('fluid', lastFluid ? `${lastFluid.stableBands ? 'banded' : "FOORT's model"}; ξ = ${lastFluid.params.xi}, β_r = ${lastFluid.params.betaR}, β_φ = ${lastFluid.params.betaPhi}; ISCO ${lastFluid.isco ? 'r = ' + lastFluid.isco.toFixed(4) : 'not found'}${lastFluid.stableBands ? `; circular in ${lastFluid.stableBands.map((b) => `${b.from.toPrecision(3)}–${Number.isFinite(b.to) ? b.to.toPrecision(3) : '∞'}`).join(', ')}` : ''} (${lastFluid.ms.toFixed(0)} ms)` : '') +
      (lastFluid?.bands ? perfRow('circular orbits', bandText(lastFluid.bands)) : '') +
      perfRow('image', `${st.N}² (levels ${st.levels.join(' → ')}, ${st.tiles} tiles)`) +
      perfRow('disc crossings', caps.tailBins ? `first 3 exact, the rest in ${caps.tailBins} log-r bins (no noise or slow light)` : `first 3 only: this device has ${caps.maxDrawBuffers} draw buffers (the binned tail needs 6)`) +
      perfRow('trace time', st.cached ? `restored from the record cache (traced in ${st.wallMs.toFixed(0)} ms)` : `${st.wallMs.toFixed(0)} ms wall` + (st.gpuMs !== null ? `, ${st.gpuMs.toFixed(0)} ms GPU` : '')
        + (st.compacted ? `; ${st.compacted} rays continued in compaction rounds` : '')) +
      perfRow('record cache', `${pipeline.cache.size} views, ${(pipeline.cacheUsed() / 2 ** 20).toFixed(0)} of ${(pipeline.cacheBytes / 2 ** 20).toFixed(0)} MB${state.pretrace ? '; idle pre-tracing on' : ''}`) +
      (st.steps !== null ? perfRow('RK4 steps', `${(st.steps / rays).toFixed(0)} per ray, ${(st.steps / ((st.gpuMs ?? st.wallMs) * 1e3)).toFixed(0)} M steps/s`) : '') +
      (warnings.length ? perfRow('warnings', warnings.join('; ')) : '');
  };

  /** @param {{from:number, to:number, kind:string}[]} bands */
  const bandText = (bands) => {
    const st = bands.filter((b) => b.kind === 'stable').length;
    return bands.map((b) => `${b.kind} ${b.from.toPrecision(3)}–${b.to.toPrecision(3)}`).join(', ')
      + (st > 1 ? `; ${st} stable bands: FOORT's ISCO bisection finds one transition only (plunge with ISCO E, L inside it)` : '');
  };

  const bakes = new BakeClient();
  let runId = 0;
  let lastBake = '';
  /** @type {import('./fluid/fluidTable.js').FluidTable|null} */
  let lastFluid = null;
  /** @param {boolean} final @param {boolean} [metricDrag] coarse tables while a metric parameter is dragged */
  const run = async (final, metricDrag = false) => {
    const id = ++runId;
    history.replaceState(null, '', `?${stateToQuery(state)}`);
    const { clamped } = metricParamsFromState(state);
    let setup;
    try {
      const view = viewFromState(state, metricDrag);
      const ts = tableSpec(view);
      let tables;
      if (ts) {
        $('status').textContent = 'baking metric tables…';
        const bk = await bakes.get(ts);
        if (id !== runId) return;   // superseded while baking
        tables = bk.tables;
        if (!tables.validation.ok) throw new Error(`metric not valid on its table: ${tables.validation.messages.join('; ')}`);
        if (!bk.cached) lastBake = `${tables.grid.nx} × ${tables.grid.nth} nodes${tables.grid.symmetric ? ' (θ ≤ π/2)' : ''}, ${bk.ms.toFixed(0)} ms in the worker (bake ${tables.timing.totalMs.toFixed(0)} ms)`;
      }
      const fs = fluidSpec(view);
      const fb = await bakes.get(fs);
      if (id !== runId) return;
      lastFluid = fb.tables;
      setup = gpuTraceSetup(view, tables, fb.tables);
      lastTail = setup.tail;
    } catch (e) { $('status').textContent = String(/** @type {Error} */ (e).message); return; }
    const levels = final ? finalLevels(state.N) : [Math.min(8, Math.max(1, state.N / 128))];
    const st = await pipeline.trace(setup, { levels, measureSteps: final });
    if (!st) return;
    if (final && state.pretrace) schedulePretrace(id);
    lastStats = st;
    if (final) { coarse = await backend.readRecords(state.N >= 512 ? 4 : 1); updateExposure(); legend(); $('clock').textContent = clockText(); }
    requestDraw();
    const note = clamped.length ? ` (${clamped.join(', ')})` : '';
    $('status').textContent = (final ? `done: ${st.N}², ${st.wallMs.toFixed(0)} ms` : `preview (stride ${levels[0]}); release to refine`) + note;
    if (final) showPerf(st, setup.warnings, setup.tables ? lastBake : setup.program === 'trace_kerr_analytic' ? 'none: hand-written closed-form Kerr shader' : `none: generated closed-form shader (${setup.program.slice(7)})`);
  };

  // Stage 1B B5 idle pre-tracing: after a final trace, with the GPU idle, trace the previews of the neighbouring views
  // (lambda one slider notch up and down, inclination +- 5 deg) into the record cache, so that those previews are
  // instant. Any input starts a new trace, which cancels a pre-trace after its current tile.
  /** @param {number} id the run that finished */
  const schedulePretrace = (id) => {
    setTimeout(async () => {
      if (id !== runId || pipeline.busy) return;
      const ctl = (/** @type {string} */ k) => CONTROLS.find((c) => c.key === k);
      /** @type {Record<string, any>[]} */
      const neighbours = [];
      const lam = ctl('lambda');
      if (metricIdFromState(state) === 'st3cr' && lam && lam.scale === 'log') {
        const notch = (/** @type {number} */ lam.max / /** @type {number} */ (lam.min)) ** (1 / 1000);
        for (const f of [notch, 1 / notch]) {
          const l = Number((state.lambda * f).toPrecision(4));
          if (l >= /** @type {number} */ (lam.min) && l <= /** @type {number} */ (lam.max)) neighbours.push({ ...state, lambda: l, metricDrag: true });
        }
      }
      for (const d of [5, -5]) { const inc = state.inc + d; if (inc > 0 && inc < 180) neighbours.push({ ...state, inc }); }
      for (const ns of neighbours) {
        if (id !== runId) return;
        try {
          const view = viewFromState(ns, !!ns.metricDrag);
          const ts = tableSpec(view);
          const tables = ts ? (await bakes.get(ts)).tables : undefined;
          const fluid = (await bakes.get(fluidSpec(view))).tables;
          if (id !== runId) return;
          const s = gpuTraceSetup(view, tables, fluid);
          await pipeline.trace(s, { levels: [Math.min(8, Math.max(1, state.N / 128))], measureSteps: false, background: true });
        } catch (e) { console.warn('pre-trace failed:', e); }
      }
    }, 300);
  };

  /** load the field the state asks for (auto: by metric and lambda) and refresh what depends on it */
  const refreshNoise = () => useNoise(wantedNoise()).then(() => { updateExposure(); $('clock').textContent = clockText(); legend(); requestDraw(); });
  const controls = buildControls(/** @type {HTMLFormElement} */ ($('controls')), state, (key, final, retrace) => {
    if (key === 'view') { controls.set('lo', NaN); controls.set('hi', NaN); legend(); }
    if (key === 'metric') controls.set('maxSteps', MAX_STEPS_DEFAULT[metricEntry(metricIdFromState(state)).mode]);
    if (key === 'preset' && state.preset !== 'custom') {
      const p = /** @type {any} */ (EMISSION_PRESETS)[state.preset];
      controls.set('metric', p.metric);
      for (const [k, v] of Object.entries(p.params)) controls.set(k, v);
      controls.set('maxSteps', p.maxSteps ?? MAX_STEPS_DEFAULT[metricEntry(metricIdFromState(state)).mode]);
      for (const [k, v] of Object.entries(p.emission)) controls.set(k, v);
      controls.set('inc', p.inc); controls.set('r', p.r); controls.set('screen', p.screen);
      // presets that also set other state (B3 comparison presets: envelope radius, fluid model); others reset them
      controls.set('envelope', p.state?.envelope ?? 'coordinate');
      if (p.state?.fluidModel) controls.set('fluidModel', p.state.fluidModel);
      refreshNoise();
      run(true);
      return;
    }
    if (['mu', 'gamma', 'sigma', 'redshiftPower', 'fudge', 'maxPasses', 'autoExposure', 'envelope'].includes(key)) { updateExposure(); legend(); }
    if (['slowLight', 'play'].includes(key)) $('clock').textContent = clockText();
    if (key === 'noiseField' || key === 'metric' || key === 'lambda' || key === 'bh0') refreshNoise();
    const isParam = !!CONTROLS.find((c) => c.key === key)?.metricParam;
    if (retrace) run(final, isParam && !final); else { history.replaceState(null, '', `?${stateToQuery(state)}`); legend(); requestDraw(); }
  });
  // animation (M7): advance t_obs while playing; the display pass is cheap, the trace is not repeated
  let lastFrame = performance.now(), lastLegend = 0;
  const animate = (/** @type {number} */ now) => {
    const dts = Math.min(0.1, (now - lastFrame) / 1000);
    lastFrame = now;
    if (state.play && noise && state.sigmaN > 0 && state.view === 'emission' || state.play && state.view === 'noise') {
      tObs += state.speed * dts;
      // no animation frames while a trace runs: redrawing the canvas at 60 fps competes with the trace tiles for the
      // GPU (up to 3x slower traces on integrated graphics, M9); the progress callback still draws each finished tile
      if (!pipeline.busy) draw();
      if (now - lastLegend > 250) { lastLegend = now; $('clock').textContent = clockText(); }
    }
    requestAnimationFrame(animate);
  };
  const clockText = () => `t = ${tObs.toFixed(1)} M${noise ? ` (${noiseName}${state.noiseField === 'auto' ? ', auto' : ''}, period ${noise.meta.T_over_M} M; noise covers ${(100 * noiseCoverage).toFixed(1)}% of the emission)` : ' (no noise field)'}, ${state.slowLight ? 'slow' : 'fast'} light`;
  $('clock').textContent = clockText();
  requestAnimationFrame(animate);

  legend();
  await run(true);

  // test hook (Playwright): trace an arbitrary view and return the records
  /** @type {any} */ (window).__foort = {
    state, backend, pipeline, CONTROLS,
    stats: () => lastStats,
    /** the view the current state traces (Stage 1B B5 tests) */
    view: () => viewFromState(state),
    noise: () => noise,
    /** set the observer time (units of M) and redraw */
    setTime(/** @type {number} */ t) { tObs = t; draw(); $('clock').textContent = clockText(); },
    /** @param {import('./gpu/traceConfig.js').ViewParams} view @param {{levels?:number[], adaptTiles?:boolean, measureSteps?:boolean, records?:boolean, cache?:boolean}} [o] */
    async trace(view, o = {}) {
      const ts = tableSpec(view);
      const tables = ts ? (await bakes.get(ts)).tables : undefined;
      const fluid = (await bakes.get(fluidSpec(view))).tables;
      const setup = gpuTraceSetup(view, tables, fluid);
      lastTail = setup.tail;
      // scripts and tests trace afresh unless they ask for the record cache (timings, A/B comparisons)
      const stats = await pipeline.trace(setup, { levels: o.levels ?? [1], measureSteps: o.measureSteps ?? true, adaptTiles: o.adaptTiles ?? false, cache: o.cache ?? false });
      if (o.records === false) { requestDraw(); return { stats, records: '', level, isco: fluid.isco, bake: null, tail: setup.tail }; }
      const rec = await backend.readRecords();
      requestDraw();
      const bytes = new Uint8Array(rec.buffer);
      let bin = '';
      for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      return { stats, records: btoa(bin), level, isco: fluid.isco, tail: setup.tail, bake: tables ? { grid: tables.grid, timing: tables.timing, validation: tables.validation } : null };
    },
  };
}

main().catch((e) => {
  // startup failures (no WebGL2, a missing extension, a shader that does not compile): the message, the details in the console
  console.error(e);
  $('errorBox').hidden = false;
  $('error').textContent = `${String(e?.message ?? e)}

FOORT-GPU needs WebGL2 with EXT_color_buffer_float (a recent Chrome or Edge; Firefox and `
    + 'Safari 15+ should work but are untested). The capability page lists what this browser offers.';
  $('status').textContent = 'failed';
  /** @type {any} */ (window).__foortError = String(e);
});
