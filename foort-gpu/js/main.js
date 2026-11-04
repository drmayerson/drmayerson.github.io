// @ts-check
// Viewer bootstrap (M4): BH-mode metrics on the tabulated GPU tracer (Kerr also on the closed-form
// shader), progressive refinement, live re-bake of the metric tables, debug views.
import { createBackend } from './gpu/backend.js';
import { TracePipeline } from './gpu/pipeline.js';
import { gpuTraceSetup, tableSpec } from './gpu/traceConfig.js';
import { BakeClient } from './bake/client.js';
import { metricEntry, paramBounds } from './metrics/registry.js';
import { CONTROLS, VIEWS, buildControls, initialState, stateToQuery } from './ui/controls.js';

const $ = (/** @type {string} */ id) => /** @type {HTMLElement} */ (document.getElementById(id));
const DEG = Math.PI / 180;

const PARAM_KEYS = { kerr: ['a'], johannsen: ['a', 'alpha13'], mankoNovikov: ['a', 'alpha3'] };

/**
 * Metric parameters of the state, clamped to the registry's validity bounds.
 * @param {Record<string, any>} s @returns {{params: Record<string, number>, clamped: string[]}}
 */
export function metricParamsFromState(s) {
  const entry = metricEntry(s.metric);
  /** @type {Record<string, number>} */
  const params = {};
  for (const k of /** @type {any} */ (PARAM_KEYS)[s.metric]) params[k] = s[k];
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
  return {
    metric: s.metric, metricParams: metricParamsFromState(s).params,
    path: s.metric === 'kerr' ? s.path : 'tabulated', grid: coarseTables ? { nx: 128, nth: 64 } : { nx, nth },
    camera: { r: s.r, theta: s.inc * DEG, screen: s.screen, cx: s.cx, cy: s.cy },
    N: s.N, eps: s.eps, maxSteps: s.maxSteps, crossing: s.crossing, storeH: s.storeH,
  };
}

const LEGENDS = {
  fourColor: [['#e44a40', 'θ < π/2, φ < π'], ['#409ce4', 'θ < π/2, φ > π'], ['#f0c83c', 'θ > π/2, φ < π'], ['#5abe6e', 'θ > π/2, φ > π'], ['#000', 'horizon']],
  term: [['#000', 'horizon'], ['#8cbff2', 'escaped'], ['#f28c26', 'time out'], ['#f0f', 'NaN'], ['#b30d0d', 'singularity']],
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
    backend.display({ mode: v.mode, lo, hi, maxSteps: state.maxSteps, rCam: state.r, storeH: !!state.storeH });
  };

  const legend = () => {
    const items = /** @type {any} */ (LEGENDS)[state.view];
    const v = /** @type {any} */ (VIEWS)[state.view];
    $('legend').innerHTML = items
      ? items.map(([c, t]) => `<span style="background:${c}"></span>${t}`).join('')
      : 'lo' in v ? `inferno colour map from ${Number.isNaN(state.lo) ? v.lo : state.lo} to ${Number.isNaN(state.hi) ? v.hi : state.hi}`
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
      perfRow('image', `${st.N}² (levels ${st.levels.join(' → ')}, ${st.tiles} tiles)`) +
      perfRow('trace time', `${st.wallMs.toFixed(0)} ms wall` + (st.gpuMs !== null ? `, ${st.gpuMs.toFixed(0)} ms GPU` : '')) +
      (st.steps !== null ? perfRow('RK4 steps', `${(st.steps / rays).toFixed(0)} per ray, ${(st.steps / ((st.gpuMs ?? st.wallMs) * 1e3)).toFixed(0)} M steps/s`) : '') +
      (warnings.length ? perfRow('warnings', warnings.join('; ')) : '');
  };

  const bakes = new BakeClient();
  let runId = 0;
  let lastBake = '';
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
      setup = gpuTraceSetup(view, tables);
    } catch (e) { $('status').textContent = String(/** @type {Error} */ (e).message); return; }
    const levels = final ? [4, 2, 1] : [Math.min(8, Math.max(1, state.N / 128))];
    const st = await pipeline.trace(setup, { levels, measureSteps: final });
    if (!st) return;
    lastStats = st;
    requestDraw();
    const note = clamped.length ? ` (${clamped.join(', ')})` : '';
    $('status').textContent = (final ? `done: ${st.N}², ${st.wallMs.toFixed(0)} ms` : `preview (stride ${levels[0]}); release to refine`) + note;
    if (final) showPerf(st, setup.warnings, setup.tables ? lastBake : 'closed-form Kerr shader');
  };

  const controls = buildControls(/** @type {HTMLFormElement} */ ($('controls')), state, (key, final, retrace) => {
    if (key === 'view') { controls.set('lo', NaN); controls.set('hi', NaN); legend(); }
    const isParam = !!CONTROLS.find((c) => c.key === key)?.metricParam;
    if (retrace) run(final, isParam && !final); else { history.replaceState(null, '', `?${stateToQuery(state)}`); legend(); requestDraw(); }
  });
  legend();
  await run(true);

  // test hook (Playwright): trace an arbitrary view and return the records
  /** @type {any} */ (window).__foort = {
    state, backend, pipeline, CONTROLS,
    stats: () => lastStats,
    /** @param {import('./gpu/traceConfig.js').ViewParams} view @param {{levels?:number[]}} [o] */
    async trace(view, o = {}) {
      const ts = tableSpec(view);
      const tables = ts ? (await bakes.get(ts)).tables : undefined;
      const setup = gpuTraceSetup(view, tables);
      const stats = await pipeline.trace(setup, { levels: o.levels ?? [1], measureSteps: true, adaptTiles: false });
      const rec = await backend.readRecords();
      requestDraw();
      const bytes = new Uint8Array(rec.buffer);
      let bin = '';
      for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      return { stats, records: btoa(bin), level, bake: tables ? { grid: tables.grid, timing: tables.timing, validation: tables.validation } : null };
    },
  };
}

main().catch((e) => {
  $('errorBox').hidden = false;
  $('error').textContent = String(e?.stack ?? e);
  $('status').textContent = 'failed';
  /** @type {any} */ (window).__foortError = String(e);
});
