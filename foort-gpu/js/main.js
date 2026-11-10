// @ts-check
// Viewer bootstrap: BH-mode metrics and the ST3Cr fuzzball (M6) on the tabulated GPU tracer (Kerr also on the
// closed-form shader), progressive refinement, live re-bake of the metric tables, disc emission, debug views.
// Camera lengths in the UI are in units of the metric's M_ADM (1 for the BH metrics, 24 for ST3Cr).
// Stage 1B B7: normal and expert panels, interaction on the image, compare mode, persistence, progress and cancel.
import { CLOSED_FORMS } from './metrics/closedForm.js';
import { tierSettings, pickTier, TIERS, TIER_LABELS, NORMAL_TRACED, TIER_TARGET_S } from './gpu/tiers.js';
import { createBackend } from './gpu/backend.js';
import { TracePipeline, finalLevels } from './gpu/pipeline.js';
import { gpuTraceSetup, tableSpec, fluidSpec } from './gpu/traceConfig.js';
import { BakeClient } from './bake/client.js';
import { metricEntry, paramBounds, createMetric } from './metrics/registry.js';
import { decodeRecord, RECORD_FLOATS } from './gpu/traceConfig.js';
import { discIntensity, EMISSION_PRESETS } from './fluid/emission.js';
import { fluidTableRcirc } from './fluid/fluidTable.js';
import { CONTROLS, VIEWS, SHARED_KEYS, buildControls, initialState, stateToQuery, setPanelUnits } from './ui/controls.js';
import { unitsOf, formatDuration, niceBelow, beamSigmaPx } from './units.js';
import { drawLightCurve, drawInspector, inspectorTable } from './ui/readouts.js';
import { attachInteraction } from './ui/interaction.js';
import { loadNoiseField, autoNoiseField, noiseCover } from './noise/noiseField.js';

const $ = (/** @type {string} */ id) => /** @type {HTMLElement} */ (document.getElementById(id));
const DEG = Math.PI / 180;
/** localStorage key of the remembered view (B7) */
const STORE_KEY = 'foort-gpu:last-view';

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

/**
 * @param {Record<string, any>} s @param {boolean} [coarseTables]
 * @param {import('./gpu/tiers.js').Tier} [autoTier]  the tier 'auto' resolves to (default High)
 * @returns {import('./gpu/traceConfig.js').ViewParams}
 */
export function viewFromState(s, coarseTables = false, autoTier = 'high') {
  const [nx, nth] = String(s.grid).split('x').map(Number);
  const metric = metricIdFromState(s), metricParams = metricParamsFromState(s).params;
  const M = createMetric(metric, metricParams).massADM;
  return {
    metric, metricParams,
    // a path the metric does not have falls back: analytic = Kerr only, closed = metrics with a generated shader
    path: s.path === 'analytic' ? (metric === 'kerr' ? 'analytic' : 'auto') : s.path === 'closed' ? (CLOSED_FORMS[metric] ? 'closed' : 'tabulated') : s.path, grid: coarseTables ? { nx: 128, nth: 64 } : { nx, nth },
    camera: { r: s.r * M, theta: s.inc * DEG, screen: s.screen * M, cx: s.cx * M, cy: s.cy * M },
    N: s.N, crossing: s.crossing, storeH: s.storeH,
    // quality tier (B6): its eps, far steps, max steps, integrator and refinement; 'custom' takes them from the controls
    ...(s.quality === 'custom'
      ? { eps: s.eps, maxSteps: s.maxSteps, farSteps: s.farSteps ? { r: 20, max: 4 } : null,
        refine: s.refine ? { sky: s.refineSky, r: 2e-3, g: 2e-3, dt: 0.2 } : null, bs3: s.integrator === 'bs3' ? { tol: s.bs3Tol, cap: 4 } : null }
      : tierSettings(s.quality === 'auto' ? autoTier : s.quality, metricEntry(metric).mode)),
    fluid: { xi: s.xi, betaR: s.betaR, betaPhi: s.betaPhi, model: s.fluidModel },
    texelReuse: !!s.texelReuse, compact: s.compact ? { n1: Number(s.compactN1) } : null,
    tailEmission: { redshiftPower: s.redshiftPower, fudge: s.fudge, maxPasses: Number(s.maxPasses) },
  };
}

/**
 * Display time of the state: observer time, slow/fast light, M_ADM, procedural advection, noise amplitude
 * (0 when the normal panel's "time-averaged" is on).
 * @param {Record<string, any>} s @param {number} tObs @param {number} M @returns {import('./gpu/backend.js').DisplayTime}
 */
export const timeFromState = (s, tObs, M) => ({ tObs, slow: !!s.slowLight, M, advect: s.advect ? s.advectD : 0, sigma: s.timeAvg ? 0 : s.sigmaN });

/** @param {Record<string, any>} s @returns {import('./fluid/emission.js').EmissionParams} */
export const emissionFromState = (s) => ({ mu: s.mu, gamma: s.gamma, sigma: s.sigma, redshiftPower: s.redshiftPower, fudge: s.fudge, maxPasses: Number(s.maxPasses) });

/** keys a compare side has of its own (everything not shared) */
const SIDE_KEYS = CONTROLS.map((c) => c.key).filter((k) => !SHARED_KEYS.includes(k));

/**
 * Normal-panel compare (B7): the other spacetime family at matched settings (Kerr a = 0 <-> the ST3Cr fuzzball).
 * @param {Record<string, any>} s @returns {Record<string, any>}
 */
export function otherFamily(s) {
  return metricEntry(metricIdFromState(s)).mode === 'fuzzball'
    ? { ...s, metric: 'kerr', a: 0, family: 'bh' }
    : { ...s, metric: 'st3cr', bh0: false, family: 'fuzzball' };
}

const LEGENDS = {
  fourColor: [['#e44a40', 'θ < π/2, φ < π'], ['#409ce4', 'θ < π/2, φ > π'], ['#f0c83c', 'θ > π/2, φ < π'], ['#5abe6e', 'θ > π/2, φ > π'], ['#000', 'horizon']],
  term: [['#000', 'horizon / inner cut'], ['#8cbff2', 'escaped'], ['#f28c26', 'time out'], ['#f0f', 'NaN'], ['#b30d0d', 'singularity']],
  passes: [['#000', '0'], ['#4073d9', '1'], ['#f29933', '2'], ['#fff', '≥ 3']],
};

/** safe localStorage (private windows and blocked storage throw) */
const store = {
  get: () => { try { return localStorage.getItem(STORE_KEY); } catch { return null; } },
  set: (/** @type {string} */ v) => { try { localStorage.setItem(STORE_KEY, v); } catch { /* not available */ } },
  clear: () => { try { localStorage.removeItem(STORE_KEY); } catch { /* not available */ } },
};

async function main() {
  // B7 persistence: the URL takes precedence; without one, the remembered view
  const stored = location.search.length > 1 ? null : store.get();
  const query = new URLSearchParams(stored ?? location.search);
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
  const cacheBytesOf = () => (state.cacheMB === 'auto' ? (isPhone ? 64 : 256) : Number(state.cacheMB)) * 2 ** 20;
  let lastStats = /** @type {import('./gpu/pipeline.js').TraceStats|null} */ (null);
  let level = 0;
  // progress bar (B7): weighted by the rays of each level, with an ETA; shown after 400 ms
  const prog = { levels: /** @type {number[]} */ ([]), t0: 0, on: false };
  let cancelled = false;
  const pipeline = new TracePipeline(backend, {
    cacheBytes: cacheBytesOf(),
    onStage: stage,
    onProgress: (p) => {
      if (cancelled) return;   // tiles still in flight after a cancel
      level = p.level;
      $('status').textContent = `tracing: stride ${p.level}, tile ${p.done}/${p.total}`;
      showProgress(p);
      requestDraw();
    },
  });
  /** @param {{level:number, done:number, total:number}} p */
  const showProgress = (p) => {
    if (!prog.on) return;
    const el = performance.now() - prog.t0;
    const w = prog.levels.map((st) => 1 / (st * st)), W = w.reduce((a, b) => a + b, 0) || 1;
    const i = Math.max(0, prog.levels.indexOf(p.level));
    const frac = (w.slice(0, i).reduce((a, b) => a + b, 0) + w[i] * (p.total ? p.done / p.total : 0)) / W;
    if (el < 400) return;
    $('progress').hidden = false;
    /** @type {HTMLElement} */ ($('progressBar')).style.width = `${(100 * frac).toFixed(1)}%`;
    const eta = frac > 0.02 ? (el * (1 - frac)) / frac / 1000 : NaN;
    $('progressText').textContent = `${(100 * frac).toFixed(0)}%${Number.isFinite(eta) ? `, about ${eta < 10 ? eta.toFixed(1) : eta.toFixed(0)} s left` : ''}`;
  };
  const hideProgress = () => { prog.on = false; $('progress').hidden = true; };

  // noise fields: kept on the GPU by name (compare mode may show two anchors)
  let noise = /** @type {import('./noise/noiseField.js').NoiseField|null} */ (null);
  let noiseName = '';
  /** @type {Map<string, import('./noise/noiseField.js').NoiseField>} */
  const noiseLoaded = new Map();
  /** the field a state asks for ('auto': by metric and lambda, Stage 1B B4) @param {Record<string, any>} s */
  const wantedNoiseOf = (s) => (s.noiseField === 'auto' ? autoNoiseField(metricIdFromState(s), metricParamsFromState(s).params) : s.noiseField);
  const wantedNoise = () => wantedNoiseOf(sideState('A'));
  /** load a field onto the GPU by name (noise/<name>.json/.bin) @param {string} name */
  const ensureNoise = async (name) => {
    if (noiseLoaded.has(name)) return noiseLoaded.get(name);
    try { const f = await loadNoiseField(name); backend.uploadNoise(f, name); noiseLoaded.set(name, f); return f; }
    catch (e) { console.warn(`noise field ${name} not loaded:`, e); return undefined; }
  };
  /** make a field the current one (side A) @param {string} name */
  const useNoise = async (name) => {
    if (name === noiseName) return;
    const f = await ensureNoise(name);
    if (f) { backend.uploadNoise(f, name); noise = f; noiseName = name; }
  };

  // B7 compare: the panel edits one side; the other side's own settings wait in `stash`
  /** @type {Record<string, any>|null} */
  let stash = null;
  /** the full state of a compare side @param {'A'|'B'} side @returns {Record<string, any>} */
  const sideState = (side) => {
    if (state.compare === 'off' || side === (state.ui === 'normal' ? 'A' : state.cmpEdit)) return state;
    if (state.ui === 'normal') return otherFamily(state);
    return { ...state, ...(stash ?? {}) };
  };
  /** what each side's last trace left: its cache key, fluid table, noise field, tail geometry, mass */
  const sides = /** @type {Record<'A'|'B', {key:string, fluid:any, fluidKey:string, noiseName:string, tail:any, M:number, label:string}|null>} */ ({ A: null, B: null });
  /** the side being traced (drawn from the live records) */
  let liveSide = /** @type {'A'|'B'|null} */ (null);
  let blinkManual = /** @type {'A'|'B'|null} */ (null);

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
    const sA = sideState('A');
    const em = emissionFromState(sA), I = [];
    if (sA.envelope === 'circumferential' && lastFluid) { const F = lastFluid; em.radius = (r) => fluidTableRcirc(F, r); }
    for (let k = 0; k < coarse.length / RECORD_FLOATS; k++) {
      const d = decodeRecord(coarse, k, lastTail ?? undefined);
      const v = discIntensity(sA.storeH ? d.crossings.slice(0, 2) : d.crossings, em, d.tail);
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
  /** B8 physical units of the state (null: dimensionless) */
  const unitsNow = () => unitsOf(state.units, state.unitMass, state.unitDist);
  setPanelUnits(unitsNow());
  /** B8 scale bar: a round length near a quarter of the field of view, in M and (with units) in uas */
  const scaleBar = () => {
    const u = unitsNow(), L = niceBelow(state.screen / 4);
    const frac = L / state.screen / (state.compare === 'side' ? 2 : 1);
    const el = $('scaleBar');
    /** @type {HTMLElement} */ (el.firstElementChild).style.width = `${(100 * frac).toFixed(2)}%`;
    el.style.width = '100%';
    /** @type {HTMLElement} */ (el.lastElementChild).textContent = `${L} M${u ? ` = ${(L * u.thetaUas).toPrecision(3)} µas` : ''}`;
  };
  /** B8 light curve: (observer time, total, n = 1, n = 2, n >= 3) of side A, from the GPU reduction of each frame */
  let lcSeries = /** @type {number[][]} */ ([]);
  const lcCanvas = /** @type {HTMLCanvasElement} */ ($('lc'));
  const updateLightCurve = () => {
    for (const r of backend.pollLightCurve()) {
      if (r.tag.side !== 'A') continue;
      let last = lcSeries[lcSeries.length - 1];
      if (last && r.tag.tObs < last[0]) { lcSeries = []; last = undefined; }   // the clock went back (a new trace, a reset)
      if (!last || r.tag.tObs > last[0]) lcSeries.push([r.tag.tObs, r.v[0], r.v[1], r.v[2], r.v[3]]);
    }
    if (lcSeries.length > 2000) lcSeries.splice(0, lcSeries.length - 2000);
    lcCanvas.hidden = !state.lightcurve || state.view !== 'emission';
    if (!lcCanvas.hidden) drawLightCurve(lcCanvas, lcSeries, { period: noise?.meta.T_over_M ?? 0, units: unitsNow(), orders: !!state.lcOrders });
  };
  /** camera of the records on screen, for the instant digital zoom and pan while a re-trace runs (B7) */
  let shown = { screen: state.screen, cx: state.cx, cy: state.cy, N: state.N };
  /** display parameters of a state @param {Record<string, any>} s @param {{tail:any, M:number}|null} info */
  const displayView = (s, info) => {
    const v = VIEWS[/** @type {keyof typeof VIEWS} */ (s.view)];
    const lo = Number.isNaN(s.lo) ? /** @type {any} */ (v).lo ?? 0 : s.lo;
    const hi = Number.isNaN(s.hi) ? /** @type {any} */ (v).hi ?? 1 : s.hi;
    const M = info?.M ?? lastFluid?.M ?? 1;
    const pix = shown.screen / shown.N;
    return { mode: v.mode, lo, hi, maxSteps: s.maxSteps, rCam: s.r * M, storeH: !!s.storeH,
      emission: emissionFromState(s), exposure: s.autoExposure ? autoExposure * s.brightness : s.exposure, toneMap: Number(s.toneMap), colorMap: Number(s.colorMap),
      time: timeFromState(s, tObs, M), tail: info?.tail ?? lastTail, envelope: s.envelope, azimuth: s.az * DEG,
      zoom: { s: shown.screen / s.screen, ox: (s.cx - shown.cx) / pix, oy: (s.cy - shown.cy) / pix },
      // B8: the linear emission for the telescope beam and the light curve
      post: s.view === 'emission' && (s.blur || s.lightcurve)
        ? { blurSigmaPx: s.blur ? beamSigmaPx(s.units === 'M' ? s.beamM : s.beamUas, unitsNow(), shown.screen, shown.N) : 0, lightCurve: !!s.lightcurve } : undefined };
  };
  const draw = () => {
    if (state.compare === 'off') {
      backend.canvasSize(state.N, state.N);
      backend.display(displayView(state, null), { side: 'A' });
      return;
    }
    const N = state.N;
    const side = state.compare === 'side';
    backend.canvasSize(side ? 2 * N : N, N);
    backend.clearCanvas();
    /** @param {'A'|'B'} sd @param {number[]} viewport @param {number[]|undefined} scissor */
    const one = (sd, viewport, scissor) => {
      const info = sides[sd];
      const handle = info && liveSide !== sd ? pipeline.cache.get(info.key)?.handle : undefined;
      if (liveSide !== sd && !handle) return;
      backend.display(displayView(sideState(sd), info), { handle, viewport, scissor, fluid: info?.fluid, fluidKey: info?.fluidKey, noiseName: info?.noiseName, side: sd });
    };
    if (side) { one('A', [0, 0, N, N], undefined); one('B', [N, 0, N, N], undefined); }
    else if (state.compare === 'split') {
      const x = Math.round(state.cmpDiv * N);
      one('A', [0, 0, N, N], [0, 0, x, N]); one('B', [0, 0, N, N], [x, 0, N - x, N]);
    } else {
      const sd = blinkManual ?? (Math.floor((performance.now() / 1000) * state.blinkHz * 2) % 2 ? 'B' : 'A');
      one(sd, [0, 0, N, N], undefined);
      $('labelA').style.visibility = sd === 'A' ? 'visible' : 'hidden';
      $('labelB').style.visibility = sd === 'B' ? 'visible' : 'hidden';
    }
  };
  const layoutCompare = () => {
    const on = state.compare !== 'off';
    $('canvasWrap').classList.toggle('side', state.compare === 'side');
    $('divider').hidden = state.compare !== 'split';
    /** @type {HTMLElement} */ ($('divider')).style.left = `${100 * state.cmpDiv}%`;
    $('sideLabels').hidden = !on;
    const SHORT = /** @type {Record<string, string>} */ ({ kerr: 'Kerr', johannsen: 'Johannsen', mankoNovikov: 'Manko–Novikov', reissnerNordstrom: 'RN', st3cr: 'ST3Cr', st3crBH: 'ST3Cr λ = 0 (BH)' });
    const lab = (/** @type {'A'|'B'} */ sd) => {
      const s = sideState(sd), id = metricIdFromState(s);
      return `${sd}: ${SHORT[id] ?? id}${id === 'st3cr' ? ` λ = ${s.lambda}` : id === 'kerr' || id === 'johannsen' || id === 'mankoNovikov' ? ` a = ${s.a}` : id === 'reissnerNordstrom' ? ` Q = ${s.Q}` : ''}`;
    };
    $('labelA').textContent = lab('A'); $('labelB').textContent = lab('B');
    $('labelA').style.visibility = $('labelB').style.visibility = 'visible';
  };

  const legend = () => {
    const items = /** @type {any} */ (LEGENDS)[state.view];
    const v = /** @type {any} */ (VIEWS)[state.view];
    $('legend').innerHTML = items
      ? items.map(([c, t]) => `<span style="background:${c}"></span>${t}`).join('')
      : 'lo' in v ? `inferno colour map from ${Number.isNaN(state.lo) ? v.lo : state.lo} to ${Number.isNaN(state.hi) ? v.hi : state.hi}`
        : state.view === 'emission' ? `disc emission Σ F g^${state.redshiftPower} J(r) over all crossings (the first 3 exact, later ones binned); ${['linear', 'sqrt', 'log', 'asinh'][Number(state.toneMap)]} tone map, exposure ${(state.autoExposure ? autoExposure * state.brightness : state.exposure).toPrecision(3)}${lastFluid?.isco ? `; ISCO r = ${lastFluid.isco.toFixed(3)}${lastFluid.M !== 1 ? ` (${(lastFluid.isco / lastFluid.M).toFixed(3)} M)` : ''}` : ''}${metricEntry(metricIdFromState(state)).emissionNote ? `. Note: ${metricEntry(metricIdFromState(state)).emissionNote}` : ''}`
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
      perfRow('quality', `${/** @type {any} */ (TIER_LABELS)[tierNow] ?? tierNow}${state.quality === 'auto' ? ` (auto; predicted full trace here: ${Object.entries(autoPredicted[metricEntry(metricIdFromState(state)).mode] ?? {}).map(([t, x]) => `${t} ${x.toFixed(1)} s`).join(', ')})` : ''}`
        + (st.traced !== undefined && st.traced < 1 ? `; adaptive refinement traced ${(100 * st.traced).toFixed(0)}% of the pixels` : '')) +
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
  /** the tier 'auto' picked per metric mode, the predicted full-trace times (s) per tier, and the probe timings */
  const autoTiers = /** @type {Record<string, import('./gpu/tiers.js').Tier>} */ ({});
  const autoPredicted = /** @type {Record<string, Record<string, number>>} */ ({});
  const autoProbe = /** @type {Record<string, {ms: Partial<Record<import('./gpu/tiers.js').Tier, number>>, rays: number}>} */ ({});
  let tierNow = /** @type {string} */ ('high');
  /**
   * Probe traces of the current view at 64^2 for each tier (in the background record set, twice: the first compiles),
   * scaled to the full image: the highest tier within E1's target (B6, plan 1.2).
   * @param {'BH'|'fuzzball'} mode @param {Record<string, any>} s
   */
  const probeTier = async (mode, s) => {
    const n = 64;
    /** @type {Partial<Record<import('./gpu/tiers.js').Tier, number>>} */
    const ms = {};
    for (const t of TIERS) {
      try {
        const view = { ...viewFromState({ ...s, quality: t }), N: n, refine: null };
        const ts = tableSpec(view);
        const tables = ts ? (await bakes.get(ts)).tables : undefined;
        const fluid = (await bakes.get(fluidSpec(view))).tables;
        const setup = gpuTraceSetup(view, tables, fluid);
        let best = Infinity;
        for (let k = 0; k < 2; k++) {
          const st = await pipeline.trace(setup, { levels: [1], measureSteps: false, background: true, cache: false });
          if (!st) return null;
          best = Math.min(best, st.gpuMs ?? st.wallMs);
        }
        // Normal traces only part of the full level with refinement: its measured share
        ms[t] = t === 'normal' ? best * NORMAL_TRACED[mode] : best;
      } catch (e) { console.warn('tier probe failed:', e); return null; }
    }
    autoProbe[mode] = { ms, rays: n * n };
    return pickTier(ms, n * n, s.N * s.N * (1 + 1 / 16), mode);
  };
  /** predicted full trace (s) of a state on this device, from the probe of its mode (null: not probed) @param {Record<string, any>} s */
  const predictS = (s) => {
    const mode = metricEntry(metricIdFromState(s)).mode, pr = autoProbe[mode];
    const t = s.quality === 'auto' ? autoTiers[mode] : s.quality;
    const ms = pr?.ms[/** @type {import('./gpu/tiers.js').Tier} */ (t)];
    return ms === undefined ? null : (ms * s.N * s.N * (1 + 1 / 16)) / pr.rays / 1000;
  };
  let runId = 0;
  let lastBake = '';
  /** @type {import('./fluid/fluidTable.js').FluidTable|null} */
  let lastFluid = null;
  /** URL and remembered view @param {Record<string, any>} [s] */
  const saveUrl = (s = state) => {
    // the URL carries the state of side A (the panel may be editing B)
    const q = stateToQuery(s);
    history.replaceState(null, '', `?${q}`);
    store.set(q);
  };
  let urlTimer = /** @type {ReturnType<typeof setTimeout>|null} */ (null);
  const saveUrlSoon = () => { if (urlTimer) clearTimeout(urlTimer); urlTimer = setTimeout(() => { urlTimer = null; saveUrl(sideState('A')); }, 250); };

  /**
   * Trace one state into the displayed records. Returns the stats and the setup, or null (superseded or failed).
   * @param {Record<string, any>} s @param {boolean} final @param {boolean} metricDrag @param {number} id
   */
  const traceState = async (s, final, metricDrag, id) => {
    let setup;
    try {
      // quality tier (B6): 'auto' probes this device once per metric mode (before the first final trace)
      const mode = metricEntry(metricIdFromState(s)).mode;
      if (s.quality === 'auto' && final && !autoTiers[mode]) {
        $('status').textContent = 'measuring this device (quality auto)…';
        const pk = await probeTier(mode, s);
        if (id !== runId) return null;
        if (pk) {
          autoTiers[mode] = pk.tier; autoPredicted[mode] = pk.predictedS;
          // B7 phone-safe resolution: when no tier fits the target and the link did not set N, halve it (down to 256)
          if (!query.has('N') && pk.predictedS[pk.tier] > TIER_TARGET_S[mode] && s.N > 256) {
            const n = Math.max(256, s.N / 2 ** Math.ceil(Math.log2(Math.sqrt(pk.predictedS[pk.tier] / TIER_TARGET_S[mode]))));
            controls.set('N', n);
            if (s !== state) s.N = n;
          }
        }
      }
      tierNow = s.quality === 'auto' ? autoTiers[mode] ?? 'high' : s.quality;
      const view = viewFromState(s, metricDrag, autoTiers[mode] ?? 'high');
      const ts = tableSpec(view);
      let tables;
      if (ts) {
        $('status').textContent = 'baking metric tables…';
        const bk = await bakes.get(ts);
        if (id !== runId) return null;   // superseded while baking
        tables = bk.tables;
        if (!tables.validation.ok) throw new Error(`metric not valid on its table: ${tables.validation.messages.join('; ')}`);
        if (!bk.cached) lastBake = `${tables.grid.nx} × ${tables.grid.nth} nodes${tables.grid.symmetric ? ' (θ ≤ π/2)' : ''}, ${bk.ms.toFixed(0)} ms in the worker (bake ${tables.timing.totalMs.toFixed(0)} ms)`;
      }
      const fs = fluidSpec(view);
      const fb = await bakes.get(fs);
      if (id !== runId) return null;
      setup = gpuTraceSetup(view, tables, fb.tables);
      const levels = final ? finalLevels(s.N) : [Math.min(8, Math.max(1, s.N / 128))];
      prog.levels = levels; prog.t0 = performance.now(); prog.on = final;
      const st = await pipeline.trace(setup, { levels, measureSteps: final });
      if (!st) return null;
      return { st, setup, fluid: fb.tables, fluidKey: fs.key, levels };
    } catch (e) { $('status').textContent = String(/** @type {Error} */ (e).message); return null; }
  };

  /** @type {{final:boolean, metricDrag:boolean}|null} */
  let pendingWarn = null;
  /**
   * @param {boolean} final @param {boolean} [metricDrag] coarse tables while a metric parameter is dragged
   * @param {boolean} [skipWarn] start a trace predicted above 15 s without asking (B7)
   */
  const run = async (final, metricDrag = false, skipWarn = false) => {
    const id = ++runId;
    cancelled = false;
    $('warnBox').hidden = true;
    saveUrl(sideState('A'));
    // B7: warn before a trace predicted above 15 s on this device
    const pred = final ? predictS(state) : null;
    if (final && !skipWarn && pred !== null && pred > 15) {
      pendingWarn = { final, metricDrag };
      $('warnText').textContent = `This trace is predicted to take about ${pred.toFixed(0)} s on this device (${state.N}², quality ${state.quality}). Lower the resolution or the quality for a faster image.`;
      $('warnBox').hidden = false;
      $('status').textContent = 'waiting: long trace';
      return;
    }
    const { clamped } = metricParamsFromState(state);
    const order = /** @type {('A'|'B')[]} */ (state.compare === 'off' ? ['A'] : state.ui === 'normal' || state.cmpEdit === 'A' ? ['A', 'B'] : ['B', 'A']);
    let res = null;
    for (const sd of order) {
      const s = sideState(sd);
      liveSide = state.compare === 'off' ? null : sd;
      if (state.compare !== 'off') {
        // the other side's noise field must be on the GPU too
        await ensureNoise(wantedNoiseOf(s));
        layoutCompare();
      }
      const r = await traceState(s, final, metricDrag, id);
      if (!r || id !== runId) { liveSide = null; hideProgress(); return; }
      const M = createMetric(metricIdFromState(s), metricParamsFromState(s).params).massADM;
      if (pipeline.lastKey) {
        const old = sides[sd]?.key;
        if (old && old !== pipeline.lastKey) pipeline.pins.delete(old);
        if (state.compare !== 'off') pipeline.pins.add(pipeline.lastKey);
      }
      sides[sd] = { key: pipeline.lastKey, fluid: r.fluid, fluidKey: r.fluidKey, noiseName: wantedNoiseOf(s), tail: r.setup.tail, M, label: sd };
      if (sd === 'A' || state.compare === 'off') {
        lastFluid = r.fluid; lastTail = r.setup.tail; res = r;
        if (final) { coarse = await backend.readRecords(s.N >= 512 ? 4 : 1); updateExposure(); }
      }
      if (sd === order[0] && state.compare === 'off') break;
    }
    liveSide = null;
    hideProgress();
    if (state.compare === 'off') { for (const k of pipeline.pins) pipeline.pins.delete(k); }
    if (!res) res = /** @type {any} */ (null);
    const st = res?.st ?? (pipeline.lastKey ? pipeline.cache.get(pipeline.lastKey)?.stats : undefined);
    shown = { screen: state.screen, cx: state.cx, cy: state.cy, N: state.N };
    scaleBar();
    if (final) { inspected.splice(0); drawInspected(); lcSeries = []; }
    if (final && state.pretrace && state.compare === 'off') schedulePretrace(id);
    if (st) lastStats = st;
    if (final) { legend(); $('clock').textContent = clockText(); }
    requestDraw();
    if (!st) return;
    const note = clamped.length ? ` (${clamped.join(', ')})` : '';
    const q = `quality ${/** @type {any} */ (TIER_LABELS)[tierNow] ?? tierNow}${state.quality === 'auto' ? ' (auto)' : ''}`;
    $('status').textContent = (final ? `done: ${st.N}², ${st.wallMs.toFixed(0)} ms, ${q}${state.compare !== 'off' ? ', compare A | B' : ''}` : `preview (stride ${res?.levels?.[0] ?? '?'}, draft); release to refine`) + note;
    if (final && res) showPerf(st, res.setup.warnings, res.setup.tables ? lastBake : res.setup.program.startsWith('trace_kerr_analytic') ? 'none: hand-written closed-form Kerr shader' : `none: generated closed-form shader (${res.setup.program.slice(7).split('+')[0]})`);
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
          const view = viewFromState(ns, !!ns.metricDrag, autoTiers[metricEntry(metricIdFromState(ns)).mode] ?? 'high');
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
  const applyPanel = () => {
    $('uiToggle').textContent = state.ui === 'normal' ? 'Expert panel' : 'Normal panel';
    $('perfBox').hidden = state.ui === 'normal';
  };
  /** swap the side the panel edits (expert compare): the other side's own settings come out of the stash */
  const swapEditedSide = () => {
    const mine = Object.fromEntries(SIDE_KEYS.map((k) => [k, state[k]]));
    if (stash) Object.assign(state, stash);
    stash = mine;
    controls.refresh();
  };
  let editedSide = state.cmpEdit;
  const controls = buildControls(/** @type {HTMLFormElement} */ ($('controls')), state, (key, final, retrace) => {
    if (key === 'view') { controls.set('lo', NaN); controls.set('hi', NaN); legend(); }
    if (key === 'family') {
      // normal panel: black hole = Kerr, fuzzball = ST3Cr
      controls.set('metric', state.family === 'bh' ? 'kerr' : 'st3cr');
      key = 'metric'; retrace = true; final = true;
    }
    if (key === 'metric') {
      controls.set('maxSteps', MAX_STEPS_DEFAULT[metricEntry(metricIdFromState(state)).mode]);
      controls.set('family', metricEntry(metricIdFromState(state)).mode === 'fuzzball' ? 'fuzzball' : 'bh');
    }
    if (key === 'cacheMB') { pipeline.cacheBytes = cacheBytesOf(); pipeline.cacheTrim(); }
    if (key === 'compare') {
      if (state.compare !== 'off' && !stash) stash = Object.fromEntries(SIDE_KEYS.map((k) => [k, otherFamily(state)[k]]));
      if (state.compare === 'off') { sides.B = null; for (const k of pipeline.pins) pipeline.pins.delete(k); }
      layoutCompare(); run(true); return;
    }
    if (key === 'cmpEdit') {
      if (state.cmpEdit !== editedSide) { const want = state.cmpEdit; state.cmpEdit = editedSide; swapEditedSide(); state.cmpEdit = want; editedSide = want; controls.refresh(); }
      layoutCompare(); refreshNoise(); requestDraw(); return;
    }
    if (key === 'blinkHz' || key === 'cmpDiv') { requestDraw(); return; }
    if (['units', 'unitMass', 'unitDist'].includes(key)) { setPanelUnits(unitsNow()); controls.refresh(); scaleBar(); $('clock').textContent = clockText(); }
    if (key === 'screen' || key === 'compare') scaleBar();
    if (key === 'lightcurve' || key === 'view') lcSeries = [];
    if (key === 'inspect') { $('inspector').hidden = !state.inspect; drawInspected(); }
    if (key === 'preset' && state.preset !== 'custom') {
      const p = /** @type {any} */ (EMISSION_PRESETS)[state.preset];
      controls.set('metric', p.metric);
      for (const [k, v] of Object.entries(p.params)) controls.set(k, v);
      controls.set('maxSteps', p.maxSteps ?? MAX_STEPS_DEFAULT[metricEntry(metricIdFromState(state)).mode]);
      for (const [k, v] of Object.entries(p.emission)) controls.set(k, v);
      controls.set('inc', p.inc); controls.set('r', p.r); controls.set('screen', p.screen);
      controls.set('family', metricEntry(metricIdFromState(state)).mode === 'fuzzball' ? 'fuzzball' : 'bh');
      // presets that also set other state (B3 comparison presets: envelope radius, fluid model); others reset them
      controls.set('envelope', p.state?.envelope ?? 'coordinate');
      if (p.state?.fluidModel) controls.set('fluidModel', p.state.fluidModel);
      refreshNoise();
      run(true);
      return;
    }
    if (['mu', 'gamma', 'sigma', 'redshiftPower', 'fudge', 'maxPasses', 'autoExposure', 'envelope', 'brightness'].includes(key)) { updateExposure(); legend(); }
    if (['slowLight', 'play', 'timeAvg'].includes(key)) $('clock').textContent = clockText();
    if (key === 'noiseField' || key === 'metric' || key === 'lambda' || key === 'bh0') refreshNoise();
    if (state.compare !== 'off') layoutCompare();
    const isParam = !!CONTROLS.find((c) => c.key === key)?.metricParam;
    if (retrace) run(final, isParam && !final); else { saveUrlSoon(); legend(); requestDraw(); }
  });
  applyPanel();
  layoutCompare();

  // toolbar (B7)
  const togglePanelMode = () => { controls.set('ui', state.ui === 'normal' ? 'expert' : 'normal'); controls.refresh(); applyPanel(); layoutCompare(); saveUrlSoon(); requestDraw(); };
  const toggleHide = () => { const l = $('layout'); l.classList.toggle('nopanel'); $('hidePanel').textContent = l.classList.contains('nopanel') ? 'Show panel' : 'Hide panel'; };
  const toggleFullscreen = () => { if (document.fullscreenElement) document.exitFullscreen(); else $('stage').requestFullscreen?.().catch(() => {}); };
  const snapshot = () => {
    draw();
    canvas.toBlob((b) => {
      if (!b) return;
      const a = document.createElement('a');
      a.href = URL.createObjectURL(b);
      a.download = `foort-gpu-${metricIdFromState(state)}-${Date.now()}.png`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    }, 'image/png');
  };
  const toggleHelp = (/** @type {boolean|undefined} */ force = undefined) => { $('helpOverlay').hidden = force === undefined ? !$('helpOverlay').hidden : !force; };
  $('uiToggle').addEventListener('click', togglePanelMode);
  $('hidePanel').addEventListener('click', toggleHide);
  $('fullscreen').addEventListener('click', toggleFullscreen);
  $('snapshot').addEventListener('click', snapshot);
  $('help').addEventListener('click', () => toggleHelp());
  $('helpClose').addEventListener('click', () => { $('helpOverlay').hidden = true; });
  $('resetView').addEventListener('click', () => { store.clear(); location.href = location.pathname; });
  $('cancel').addEventListener('click', () => {
    cancelled = true;
    runId++;
    pipeline.cancel();
    hideProgress();
    liveSide = null;
    $('status').textContent = 'cancelled (the image shows what was traced so far)';
  });
  $('warnGo').addEventListener('click', () => { const w = pendingWarn; $('warnBox').hidden = true; if (w) run(w.final, w.metricDrag, true); });
  $('warnLower').addEventListener('click', () => { $('warnBox').hidden = true; controls.set('N', Math.max(128, state.N / 2)); run(true); });
  $('warnTier').addEventListener('click', () => { $('warnBox').hidden = true; controls.set('quality', 'normal'); run(true, false, true); });

  // B8 pixel inspector: the CPU reference (double precision, in a worker) traces the clicked pixel's ray
  /** @type {Worker|null} */
  let inspWorker = null;
  let inspSeq = 0;
  const inspected = /** @type {{i:number, j:number, xf:number, yf:number, cpu:any, gpu:any, color:string}[]} */ ([]);
  const INSP_COLORS = ['#58c4ff', '#ffb347', '#b4ff6b'];
  const drawInspected = () => {
    const marks = $('marks');
    marks.innerHTML = state.inspect ? inspected.map((r) => `<span style="left:${100 * r.xf}%;top:${100 * r.yf}%;border-color:${r.color}"></span>`).join('') : '';
    if (!state.inspect) return;
    drawInspector(/** @type {HTMLCanvasElement} */ ($('inspRZ')), /** @type {HTMLCanvasElement} */ ($('inspXY')), inspected);
    $('inspTable').innerHTML = inspectorTable(inspected);
  };
  /** @param {number} xf @param {number} yf fractions of the image from its top-left corner */
  const inspect = async (xf, yf) => {
    if (!state.inspect) return;
    if (state.compare !== 'off') { $('inspNote').textContent = 'The inspector works with compare off.'; return; }
    const N = state.N, i = Math.min(N - 1, Math.floor(xf * N)), j = Math.min(N - 1, Math.floor((1 - yf) * N));
    const view = viewFromState(state, false, autoTiers[metricEntry(metricIdFromState(state)).mode] ?? 'high');
    // the GPU record of the pixel, from the displayed records
    const rec = await backend.readRecords(1);
    const gpu = decodeRecord(rec, j * N + i, lastTail ?? undefined);
    if (!inspWorker) inspWorker = new Worker(new URL('./ref/inspectWorker.js', import.meta.url), { type: 'module' });
    const id = ++inspSeq;
    $('inspNote').textContent = `tracing pixel (${i}, ${j}) on the CPU…`;
    const cpu = await new Promise((res) => {
      const w = /** @type {Worker} */ (inspWorker);
      const on = (/** @type {MessageEvent} */ e) => { if (e.data.id === id) { w.removeEventListener('message', on); res(e.data.result ?? { error: e.data.error }); } };
      w.addEventListener('message', on);
      w.postMessage({ id, view: { ...view, refine: null, bs3: null }, i, j });
    });
    inspected.unshift({ i, j, xf, yf, cpu, gpu, color: '' });
    inspected.splice(3);
    inspected.forEach((r, k) => { r.color = INSP_COLORS[k]; });
    $('inspNote').textContent = cpu.error ? `CPU trace failed: ${cpu.error}` : `pixel (${i}, ${j}): ${cpu.steps} steps on the CPU in ${cpu.ms.toFixed(0)} ms. The CPU traces with RK4 at the view's ε (the GPU record may come from an error-controlled tier: compare at Reference or High).`;
    drawInspected();
  };
  $('inspClear').addEventListener('click', () => { inspected.splice(0); drawInspected(); });
  $('inspector').hidden = !state.inspect;

  // interaction on the image (B7)
  let previewQueued = false;
  const preview = () => {
    if (previewQueued) return;
    previewQueued = true;
    requestAnimationFrame(() => { previewQueued = false; run(false); });
  };
  attachInteraction(canvas, {
    azimuth: (d) => { controls.set('az', ((state.az + d) % 360 + 360) % 360); saveUrlSoon(); requestDraw(); },
    inclination: (d, final) => {
      if (d) controls.set('inc', Math.min(179.99, Math.max(0.01, Number((state.inc + d).toFixed(2)))));
      if (final) run(true); else preview();
    },
    zoom: (f, final) => {
      if (f !== 1) controls.set('screen', Math.min(500, Math.max(0.05, Number((state.screen * f).toPrecision(4)))));
      if (final) run(true); else requestDraw();   // instant digital zoom of the current image
    },
    pan: (dx, dy, final) => {
      if (dx || dy) { controls.set('cx', Number((state.cx + dx * state.screen).toPrecision(4))); controls.set('cy', Number((state.cy + dy * state.screen).toPrecision(4))); }
      if (final) run(true); else requestDraw();
    },
    divider: () => (state.compare === 'split' ? state.cmpDiv : null),
    click: (xf, yf) => { inspect(xf, yf); },
    setDivider: (f) => { state.cmpDiv = f; /** @type {HTMLElement} */ ($('divider')).style.left = `${100 * f}%`; requestDraw(); saveUrlSoon(); },
    keys: {
      ' ': () => { controls.set('play', !state.play); $('clock').textContent = clockText(); },
      f: toggleFullscreen, h: toggleHide, s: snapshot, e: togglePanelMode,
      r: () => { $('status').textContent = 'video recording comes with export (Stage 1B B9)'; },
      c: () => { controls.set('compare', state.compare === 'off' ? 'split' : 'off'); if (state.compare !== 'off' && !stash) stash = Object.fromEntries(SIDE_KEYS.map((k) => [k, otherFamily(state)[k]])); layoutCompare(); run(true); },
      b: () => {
        if (state.compare === 'off') return;
        const showing = blinkManual ?? (state.compare === 'blink' && Math.floor((performance.now() / 1000) * state.blinkHz * 2) % 2 ? 'B' : 'A');
        blinkManual = showing === 'A' ? 'B' : 'A'; if (state.compare !== 'blink') controls.set('compare', 'blink'); layoutCompare(); requestDraw(); },
      '?': () => toggleHelp(),
      Escape: () => toggleHelp(false),
    },
  });

  // animation (M7): advance t_obs while playing; the display pass is cheap, the trace is not repeated
  let lastFrame = performance.now(), lastLegend = 0;
  const animate = (/** @type {number} */ now) => {
    const dts = Math.min(0.1, (now - lastFrame) / 1000);
    lastFrame = now;
    const noisy = state.play && noise && state.sigmaN > 0 && !state.timeAvg && state.view === 'emission' || state.play && state.view === 'noise'
      || state.play && state.lightcurve && state.view === 'emission';
    if (noisy) {
      // B8: with physical units, "real time" runs the clock at 1 s per s, i.e. 1 / (GM/c^3) M per s
      const u = unitsNow();
      tObs += (state.realTime && u ? 1 / u.tS : state.speed) * dts;
      if (now - lastLegend > 250) { lastLegend = now; $('clock').textContent = clockText(); }
    }
    // no animation frames while a trace runs: redrawing the canvas at 60 fps competes with the trace tiles for the
    // GPU (up to 3x slower traces on integrated graphics, M9); the progress callback still draws each finished tile
    if ((noisy || (state.compare === 'blink' && !blinkManual)) && !pipeline.busy) draw();
    updateLightCurve();
    requestAnimationFrame(animate);
  };
  const clockText = () => `t = ${tObs.toFixed(1)} M${unitsNow() ? ` = ${formatDuration(tObs * /** @type {any} */ (unitsNow()).tS)}` : ''}${noise ? ` (${noiseName}${state.noiseField === 'auto' ? ', auto' : ''}, period ${noise.meta.T_over_M} M; noise covers ${(100 * noiseCoverage).toFixed(1)}% of the emission)` : ' (no noise field)'}, ${state.slowLight ? 'slow' : 'fast'} light${state.timeAvg ? ', time-averaged' : ''}`;
  $('clock').textContent = clockText();
  requestAnimationFrame(animate);

  legend();
  await run(true);

  // test hook (Playwright): trace an arbitrary view and return the records
  /** @type {any} */ (window).__foort = {
    state, backend, pipeline, CONTROLS,
    stats: () => lastStats,
    /** the view the current state traces (Stage 1B B5 tests) */
    view: () => viewFromState(state, false, autoTiers[metricEntry(metricIdFromState(state)).mode] ?? 'high'),
    /** the quality tier of the last trace (B6) */
    tier: () => tierNow,
    /** the state of a compare side (B7) */
    side: (/** @type {'A'|'B'} */ sd) => ({ ...sideState(sd) }),
    /** B8: the light-curve samples (t, total, n = 1, n = 2, n >= 3) and the last inspected rays */
    lightCurve: () => lcSeries.map((x) => [...x]),
    inspected: () => inspected.map((r) => ({ i: r.i, j: r.j, cpu: r.cpu, gpu: r.gpu })),
    inspect: (/** @type {number} */ xf, /** @type {number} */ yf) => inspect(xf, yf),
    /** the run counter (B7 tests: a display-only change starts no run) */
    runs: () => runId,
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
      shown = { screen: state.screen, cx: state.cx, cy: state.cy, N: view.N };
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
