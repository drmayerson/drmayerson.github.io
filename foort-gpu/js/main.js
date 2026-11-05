// @ts-check
// Viewer bootstrap: BH-mode metrics and the ST3Cr fuzzball (M6) on the tabulated GPU tracer (Kerr also on the
// closed-form shader), progressive refinement, live re-bake of the metric tables, disc emission, debug views.
// Camera lengths in the UI are in units of the metric's M_ADM (1 for the BH metrics, 24 for ST3Cr).
import { createBackend } from './gpu/backend.js';
import { TracePipeline } from './gpu/pipeline.js';
import { gpuTraceSetup, tableSpec, fluidSpec } from './gpu/traceConfig.js';
import { BakeClient } from './bake/client.js';
import { metricEntry, paramBounds, createMetric } from './metrics/registry.js';
import { decodeRecord } from './gpu/traceConfig.js';
import { discIntensity, EMISSION_PRESETS } from './fluid/emission.js';
import { CONTROLS, VIEWS, buildControls, initialState, stateToQuery } from './ui/controls.js';
import { loadNoiseField } from './noise/noiseField.js';

const $ = (/** @type {string} */ id) => /** @type {HTMLElement} */ (document.getElementById(id));
const DEG = Math.PI / 180;
const NOISE_FIELD = 'placeholder';

const PARAM_KEYS = { kerr: ['a'], johannsen: ['a', 'alpha13'], mankoNovikov: ['a', 'alpha3'], st3cr: ['lambda'], st3crBH: [] };

/** Registry id of the state's metric: the ST3Cr lambda = 0 switch selects the black-hole class. @param {Record<string, any>} s */
export const metricIdFromState = (s) => (s.metric === 'st3cr' && s.bh0 ? 'st3crBH' : s.metric);

/** Default max steps per mode (fuzzball rays scatter in the cap and throat). */
const MAX_STEPS_DEFAULT = { BH: 5000, fuzzball: 10000 };

/**
 * Metric parameters of the state, clamped to the registry's validity bounds.
 * @param {Record<string, any>} s @returns {{params: Record<string, number>, clamped: string[]}}
 */
export function metricParamsFromState(s) {
  const id = metricIdFromState(s);
  const entry = metricEntry(id);
  /** @type {Record<string, number>} */
  const params = {};
  for (const k of /** @type {any} */ (PARAM_KEYS)[id]) params[k] = s[k];
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
    path: s.metric === 'kerr' ? s.path : 'tabulated', grid: coarseTables ? { nx: 128, nth: 64 } : { nx, nth },
    camera: { r: s.r * M, theta: s.inc * DEG, screen: s.screen * M, cx: s.cx * M, cy: s.cy * M },
    N: s.N, eps: s.eps, maxSteps: s.maxSteps, crossing: s.crossing, storeH: s.storeH,
    fluid: { xi: s.xi, betaR: s.betaR, betaPhi: s.betaPhi },
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
  const state = initialState(new URLSearchParams(location.search));
  const canvas = /** @type {HTMLCanvasElement} */ ($('view'));
  const stage = (/** @type {string} */ t) => { $('status').textContent = t; /** @type {any} */ (window).__foortStage = t; };
  const backend = await createBackend(canvas, { onStage: stage });
  let lastStats = /** @type {import('./gpu/pipeline.js').TraceStats|null} */ (null);
  let level = 0;
  const pipeline = new TracePipeline(backend, {
    onStage: stage,
    onProgress: (p) => { level = p.level; $('status').textContent = `tracing: stride ${p.level}, tile ${p.done}/${p.total}`; requestDraw(); },
  });

  // noise field (M7): placeholder FFT field until the production inoisy fields (M8)
  let noise = /** @type {import('./noise/noiseField.js').NoiseField|null} */ (null);
  try { stage('loading the noise field…'); noise = await loadNoiseField(NOISE_FIELD); backend.uploadNoise(noise); }
  catch (e) { console.warn('noise field not loaded:', e); }
  /** observer time t_obs in units of M */
  let tObs = 0;

  let autoExposure = 1;
  /** coarse-level records of the last full trace, for auto exposure */
  let coarse = /** @type {Float32Array|null} */ (null);
  const updateExposure = () => {
    if (!coarse) return;
    const em = emissionFromState(state), I = [];
    for (let k = 0; k < coarse.length / 16; k++) {
      const d = decodeRecord(coarse, k);
      const v = discIntensity(state.storeH ? d.crossings.slice(0, 2) : d.crossings, em);
      if (v > 0) I.push(v);
    }
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
      time: timeFromState(state, tObs, lastFluid?.M ?? 1) });
  };

  const legend = () => {
    const items = /** @type {any} */ (LEGENDS)[state.view];
    const v = /** @type {any} */ (VIEWS)[state.view];
    $('legend').innerHTML = items
      ? items.map(([c, t]) => `<span style="background:${c}"></span>${t}`).join('')
      : 'lo' in v ? `inferno colour map from ${Number.isNaN(state.lo) ? v.lo : state.lo} to ${Number.isNaN(state.hi) ? v.hi : state.hi}`
        : state.view === 'emission' ? `disc emission Σ F g^${state.redshiftPower} J(r) over the stored crossings (≤ 3); ${['linear', 'sqrt', 'log', 'asinh'][Number(state.toneMap)]} tone map, exposure ${(state.autoExposure ? autoExposure : state.exposure).toPrecision(3)}${lastFluid?.isco ? `; ISCO r = ${lastFluid.isco.toFixed(3)}${lastFluid.M !== 1 ? ` (${(lastFluid.isco / lastFluid.M).toFixed(3)} M)` : ''}` : ''}${state.metric === 'st3cr' && !state.bh0 ? '. Note: only the first 3 disc crossings are kept; light trapped inside the fuzzball crosses the disc many more times, so the interior is underestimated (about half of its intensity is missing for λ ≳ 0.001)' : ''}`
        : state.view === 'steps' ? `inferno colour map of log(steps), from 1 to max steps (${state.maxSteps})`
          : state.view === 'sky' ? '15° grid in the escape direction (θ, φ), tinted by FOORT quadrant; black: horizon' : '';
  };

  const perfRow = (/** @type {string} */ k, /** @type {string} */ v) => `<tr><th>${k}</th><td>${v}</td></tr>`;
  const showPerf = (/** @type {import('./gpu/pipeline.js').TraceStats} */ st, /** @type {string[]} */ warnings, /** @type {string} */ bake) => {
    const caps = backend.capabilities();
    const rays = st.N * st.N;
    $('perf').innerHTML =
      perfRow('GPU', String(caps.renderer)) +
      perfRow('metric tables', bake) +
      perfRow('fluid', lastFluid ? `ξ = ${lastFluid.params.xi}, β_r = ${lastFluid.params.betaR}, β_φ = ${lastFluid.params.betaPhi}; ISCO ${lastFluid.isco ? 'r = ' + lastFluid.isco.toFixed(4) : 'not found'} (${lastFluid.ms.toFixed(0)} ms)` : '') +
      (lastFluid?.bands ? perfRow('circular orbits', bandText(lastFluid.bands)) : '') +
      perfRow('image', `${st.N}² (levels ${st.levels.join(' → ')}, ${st.tiles} tiles)`) +
      perfRow('trace time', `${st.wallMs.toFixed(0)} ms wall` + (st.gpuMs !== null ? `, ${st.gpuMs.toFixed(0)} ms GPU` : '')) +
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
    } catch (e) { $('status').textContent = String(/** @type {Error} */ (e).message); return; }
    const levels = final ? [4, 2, 1] : [Math.min(8, Math.max(1, state.N / 128))];
    const st = await pipeline.trace(setup, { levels, measureSteps: final });
    if (!st) return;
    lastStats = st;
    if (final) { coarse = await backend.readRecords(state.N >= 512 ? 4 : 1); updateExposure(); legend(); }
    requestDraw();
    const note = clamped.length ? ` (${clamped.join(', ')})` : '';
    $('status').textContent = (final ? `done: ${st.N}², ${st.wallMs.toFixed(0)} ms` : `preview (stride ${levels[0]}); release to refine`) + note;
    if (final) showPerf(st, setup.warnings, setup.tables ? lastBake : 'closed-form Kerr shader');
  };

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
      run(true);
      return;
    }
    if (['mu', 'gamma', 'sigma', 'redshiftPower', 'fudge', 'maxPasses', 'autoExposure'].includes(key)) { updateExposure(); legend(); }
    if (['slowLight', 'play'].includes(key)) $('clock').textContent = clockText();
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
      draw();
      if (now - lastLegend > 250) { lastLegend = now; $('clock').textContent = clockText(); }
    }
    requestAnimationFrame(animate);
  };
  const clockText = () => `t = ${tObs.toFixed(1)} M${noise ? ` (field period ${noise.meta.T_over_M} M)` : ' (no noise field)'}, ${state.slowLight ? 'slow' : 'fast'} light`;
  $('clock').textContent = clockText();
  requestAnimationFrame(animate);

  legend();
  await run(true);

  // test hook (Playwright): trace an arbitrary view and return the records
  /** @type {any} */ (window).__foort = {
    state, backend, pipeline, CONTROLS,
    stats: () => lastStats,
    noise: () => noise,
    /** set the observer time (units of M) and redraw */
    setTime(/** @type {number} */ t) { tObs = t; draw(); $('clock').textContent = clockText(); },
    /** @param {import('./gpu/traceConfig.js').ViewParams} view @param {{levels?:number[]}} [o] */
    async trace(view, o = {}) {
      const ts = tableSpec(view);
      const tables = ts ? (await bakes.get(ts)).tables : undefined;
      const fluid = (await bakes.get(fluidSpec(view))).tables;
      const setup = gpuTraceSetup(view, tables, fluid);
      const stats = await pipeline.trace(setup, { levels: o.levels ?? [1], measureSteps: true, adaptTiles: false });
      const rec = await backend.readRecords();
      requestDraw();
      const bytes = new Uint8Array(rec.buffer);
      let bin = '';
      for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      return { stats, records: btoa(bin), level, isco: fluid.isco, bake: tables ? { grid: tables.grid, timing: tables.timing, validation: tables.validation } : null };
    },
  };
}

main().catch((e) => {
  $('errorBox').hidden = false;
  $('error').textContent = String(e?.stack ?? e);
  $('status').textContent = 'failed';
  /** @type {any} */ (window).__foortError = String(e);
});
