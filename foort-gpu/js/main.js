// @ts-check
// Viewer bootstrap (M3): analytic-Kerr GPU tracer with progressive refinement and debug views.
import { createBackend } from './gpu/backend.js';
import { TracePipeline } from './gpu/pipeline.js';
import { gpuTraceSetup } from './gpu/traceConfig.js';
import { CONTROLS, VIEWS, buildControls, initialState, stateToQuery } from './ui/controls.js';

const $ = (/** @type {string} */ id) => /** @type {HTMLElement} */ (document.getElementById(id));
const DEG = Math.PI / 180;

/** @param {Record<string, any>} s @returns {import('./gpu/traceConfig.js').ViewParams} */
export function viewFromState(s) {
  return {
    metric: 'kerr', metricParams: { a: s.a },
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
  const backend = await createBackend(canvas);
  let lastStats = /** @type {import('./gpu/pipeline.js').TraceStats|null} */ (null);
  let level = 0;
  const pipeline = new TracePipeline(backend, {
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
  const showPerf = (/** @type {import('./gpu/pipeline.js').TraceStats} */ st, /** @type {string[]} */ warnings) => {
    const caps = backend.capabilities();
    const rays = st.N * st.N;
    $('perf').innerHTML =
      perfRow('GPU', String(caps.renderer)) +
      perfRow('image', `${st.N}² (levels ${st.levels.join(' → ')}, ${st.tiles} tiles)`) +
      perfRow('trace time', `${st.wallMs.toFixed(0)} ms wall` + (st.gpuMs !== null ? `, ${st.gpuMs.toFixed(0)} ms GPU` : '')) +
      (st.steps !== null ? perfRow('RK4 steps', `${(st.steps / rays).toFixed(0)} per ray, ${(st.steps / ((st.gpuMs ?? st.wallMs) * 1e3)).toFixed(0)} M steps/s`) : '') +
      (warnings.length ? perfRow('warnings', warnings.join('; ')) : '');
  };

  const run = async (/** @type {boolean} */ final) => {
    history.replaceState(null, '', `?${stateToQuery(state)}`);
    let setup;
    try { setup = gpuTraceSetup(viewFromState(state)); } catch (e) { $('status').textContent = String(/** @type {Error} */ (e).message); return; }
    const levels = final ? [4, 2, 1] : [Math.min(8, Math.max(1, state.N / 128))];
    const st = await pipeline.trace(setup, { levels, measureSteps: final });
    if (!st) return;
    lastStats = st;
    requestDraw();
    $('status').textContent = final ? `done: ${st.N}², ${st.wallMs.toFixed(0)} ms` : `preview (stride ${levels[0]}); release to refine`;
    if (final) showPerf(st, setup.warnings);
  };

  const controls = buildControls(/** @type {HTMLFormElement} */ ($('controls')), state, (key, final, retrace) => {
    if (key === 'view') { controls.set('lo', NaN); controls.set('hi', NaN); legend(); }
    if (retrace) run(final); else { history.replaceState(null, '', `?${stateToQuery(state)}`); legend(); requestDraw(); }
  });
  legend();
  await run(true);

  // test hook (Playwright): trace an arbitrary view and return the records
  /** @type {any} */ (window).__foort = {
    state, backend, pipeline, CONTROLS,
    stats: () => lastStats,
    /** @param {import('./gpu/traceConfig.js').ViewParams} view @param {{levels?:number[]}} [o] */
    async trace(view, o = {}) {
      const setup = gpuTraceSetup(view);
      const stats = await pipeline.trace(setup, { levels: o.levels ?? [1], measureSteps: true, adaptTiles: false });
      const rec = await backend.readRecords();
      requestDraw();
      const bytes = new Uint8Array(rec.buffer);
      let bin = '';
      for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      return { stats, records: btoa(bin), level };
    },
  };
}

main().catch((e) => {
  $('errorBox').hidden = false;
  $('error').textContent = String(e?.stack ?? e);
  $('status').textContent = 'failed';
  /** @type {any} */ (window).__foortError = String(e);
});
