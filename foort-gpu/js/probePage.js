// @ts-check
// Tier probe page (probe.html, Stage 1B B0): short traces of the viewer's own tracer on this device, to measure its
// ray-step throughput per configuration and predict full-trace times for the quality tiers (plan Section 1.2, E1).
// The report is a JSON block the user copies back. Uses the same code path as the viewer (bake worker, pipeline).
import { createBackend } from './gpu/backend.js';
import { TracePipeline } from './gpu/pipeline.js';
import { gpuTraceSetup, tableSpec, fluidSpec } from './gpu/traceConfig.js';
import { BakeClient } from './bake/client.js';
import { createMetric } from './metrics/registry.js';
import { probeWebGL2 } from './gpu/capabilities.js';

const $ = (/** @type {string} */ id) => /** @type {HTMLElement} */ (document.getElementById(id));

/** camera in units of the metric's M_ADM (the registry metric may be in raw coordinates) */
const camM = (/** @type {string} */ id, /** @type {Record<string, number>} */ p, /** @type {{r:number, theta:number, screen:number}} */ c) => {
  const M = createMetric(id, p).massADM;
  return { r: c.r * M, theta: c.theta, screen: c.screen * M };
};
const kerrCam = { r: 1000, theta: 0.2967, screen: 15 };
const fbCam = { r: 250 / 24, theta: 1.5, screen: 150 / 24 };
const far = { r: 20, max: 4 };
/** probe cases: Reference and High (today's viewer) settings, small images */
const CASES = [
  { name: 'Kerr a=0.94 closed-form, Reference', mode: 'BH', N: 256, view: { metric: 'kerr', metricParams: { a: 0.94 }, path: 'analytic', maxSteps: 5000 } },
  { name: 'Kerr a=0.94 tabulated, Reference', mode: 'BH', N: 256, view: { metric: 'kerr', metricParams: { a: 0.94 }, maxSteps: 5000 } },
  { name: 'Kerr a=0.94 tabulated, High', mode: 'BH', N: 256, view: { metric: 'kerr', metricParams: { a: 0.94 }, maxSteps: 5000, farSteps: far } },
  { name: 'ST3Cr λ=1e-3, Reference', mode: 'fuzzball', N: 128, view: { metric: 'st3cr', metricParams: { lambda: 1e-3 }, maxSteps: 10000 } },
  { name: 'ST3Cr λ=1e-3, High', mode: 'fuzzball', N: 128, view: { metric: 'st3cr', metricParams: { lambda: 1e-3 }, maxSteps: 5000, farSteps: far } },
  // Stage 1B B6: the viewer's tiers for black holes on their default path (closed form) and the tables; Normal = High +
  // the Bogacki-Shampine 3(2) integrator (the fuzzball's Normal is its High)
  { name: 'B6 Kerr a=0.94 closed-form, High', mode: 'BH', N: 256, view: { metric: 'kerr', metricParams: { a: 0.94 }, path: 'auto', texelReuse: true, maxSteps: 5000, farSteps: far } },
  { name: 'B6 Kerr a=0.94 closed-form, Normal', mode: 'BH', N: 256, view: { metric: 'kerr', metricParams: { a: 0.94 }, path: 'auto', texelReuse: true, maxSteps: 5000, farSteps: far, bs3: { tol: 0.1, cap: 4 } } },
  { name: 'B6 Manko-Novikov a=0.94 tabulated, High', mode: 'BH', N: 256, view: { metric: 'mankoNovikov', metricParams: { a: 0.94, alpha3: 2 }, texelReuse: true, maxSteps: 5000, farSteps: far } },
  { name: 'B6 Manko-Novikov a=0.94 tabulated, Normal', mode: 'BH', N: 256, view: { metric: 'mankoNovikov', metricParams: { a: 0.94, alpha3: 2 }, texelReuse: true, maxSteps: 5000, farSteps: far, bs3: { tol: 0.1, cap: 4 } } },
];
/**
 * Stage 1B B5 exact speedups, measured as interleaved A/B pairs (A, B, A, B, A, B; best of 3 each): the GPU clock
 * ramps up during the probe, so cases measured one after another are not comparable. The ST3Cr cases above already
 * use the G3 = G4 identity; texel reuse and ray compaction are adopted only if faster on the laptop and another GPU.
 */
const PAIRS = [
  { name: 'G3 = G4 (ST3Cr λ=1e-3, High)', N: 256, A: { metric: 'st3cr', metricParams: { lambda: 1e-3 }, maxSteps: 5000, farSteps: far, g34: false },
    B: { metric: 'st3cr', metricParams: { lambda: 1e-3 }, maxSteps: 5000, farSteps: far } },
  { name: 'texel reuse (Kerr a=0.94 tabulated, High)', N: 256, A: { metric: 'kerr', metricParams: { a: 0.94 }, maxSteps: 5000, farSteps: far },
    B: { metric: 'kerr', metricParams: { a: 0.94 }, maxSteps: 5000, farSteps: far, texelReuse: true } },
  { name: 'texel reuse (ST3Cr λ=1e-3, High)', N: 256, A: { metric: 'st3cr', metricParams: { lambda: 1e-3 }, maxSteps: 5000, farSteps: far },
    B: { metric: 'st3cr', metricParams: { lambda: 1e-3 }, maxSteps: 5000, farSteps: far, texelReuse: true } },
  { name: 'ray compaction (ST3Cr λ=1e-3, High)', N: 256, A: { metric: 'st3cr', metricParams: { lambda: 1e-3 }, maxSteps: 5000, farSteps: far },
    B: { metric: 'st3cr', metricParams: { lambda: 1e-3 }, maxSteps: 5000, farSteps: far, compact: { n1: 1500 } } },
  { name: 'generated closed form (Johannsen a=0.94, High)', N: 256, A: { metric: 'johannsen', metricParams: { a: 0.94, alpha13: 5.5 }, path: 'tabulated', maxSteps: 5000, farSteps: far },
    B: { metric: 'johannsen', metricParams: { a: 0.94, alpha13: 5.5 }, path: 'closed', maxSteps: 5000, farSteps: far } },
];

/** E1 (proposed): predicted full trace at the default resolution 512^2 within 2 s (BH) / 10 s (fuzzball) */
const TARGET_S = { BH: 2, fuzzball: 10 };

async function run() {
  /** @type {HTMLButtonElement} */ ($('run')).disabled = true;
  const canvas = /** @type {HTMLCanvasElement} */ ($('view'));
  const status = (/** @type {string} */ t) => { $('status').textContent = t; };
  const backend = await createBackend(canvas, { onStage: status });
  const pipeline = new TracePipeline(backend, { onStage: status });
  const bakes = new BakeClient();
  const rows = [];
  for (const c of CASES) {
    status(`${c.name}…`);
    const cam = camM(c.view.metric, c.view.metricParams, c.mode === 'BH' ? kerrCam : fbCam);
    /** @type {import('./gpu/traceConfig.js').ViewParams} */
    const view = /** @type {any} */ ({ ...c.view, camera: cam, N: c.N, fluid: { xi: 1, betaR: 1, betaPhi: 1 } });
    const ts = tableSpec(view);
    const tables = ts ? (await bakes.get(ts)).tables : undefined;
    const fluid = (await bakes.get(fluidSpec(view))).tables;
    const setup = gpuTraceSetup(view, tables, fluid);
    await pipeline.trace(setup, { levels: [1], measureSteps: true, cache: false });   // warm-up: compile, tile size
    let best = /** @type {any} */ (null);
    for (let k = 0; k < 2; k++) {
      const st = await pipeline.trace(setup, { levels: [1], measureSteps: true, cache: false });
      if (st && (!best || st.wallMs < best.wallMs)) best = st;
    }
    const ms = best.gpuMs ?? best.wallMs;
    const stepsPerRay = best.steps / (c.N * c.N);
    const rate = best.steps / (ms / 1000);
    const predict = (/** @type {number} */ N) => (stepsPerRay * N * N) / rate * 1.06;   // with the 4 -> 1 preview level
    rows.push({ case: c.name, mode: c.mode, N: c.N, wallMs: +best.wallMs.toFixed(1), gpuMs: best.gpuMs === null ? null : +best.gpuMs.toFixed(1),
      stepsPerRay: +stepsPerRay.toFixed(0), msteps_per_s: +(rate / 1e6).toFixed(1), predicted512s: +predict(512).toFixed(2), predicted1024s: +predict(1024).toFixed(2),
      withinE1At512: predict(512) <= TARGET_S[/** @type {'BH'|'fuzzball'} */ (c.mode)] });
  }
  /** @type {any[]} */
  const pairs = [];
  for (const pr of PAIRS) {
    status(`B5: ${pr.name}…`);
    const setups = [];
    for (const v of [pr.A, pr.B]) {
      const cam = camM(v.metric, v.metricParams, v.metric === 'st3cr' ? fbCam : kerrCam);
      /** @type {import('./gpu/traceConfig.js').ViewParams} */
      const view = /** @type {any} */ ({ ...v, camera: cam, N: pr.N, fluid: { xi: 1, betaR: 1, betaPhi: 1 } });
      const ts = tableSpec(view);
      const tables = ts ? (await bakes.get(ts)).tables : undefined;
      const fluid = (await bakes.get(fluidSpec(view))).tables;
      const setup = gpuTraceSetup(view, tables, fluid);
      await pipeline.trace(setup, { levels: [1], measureSteps: false, cache: false });   // warm-up
      setups.push(setup);
    }
    const best = [Infinity, Infinity];
    for (let k = 0; k < 3; k++) for (let ab = 0; ab < 2; ab++) {
      const st = await pipeline.trace(setups[ab], { levels: [1], measureSteps: false, cache: false });
      if (st) best[ab] = Math.min(best[ab], st.gpuMs ?? st.wallMs);
    }
    pairs.push({ case: pr.name, N: pr.N, msA: +best[0].toFixed(1), msB: +best[1].toFixed(1), speedup: +(best[0] / best[1]).toFixed(2) });
  }
  const caps = probeWebGL2();
  const report = {
    page: 'FOORT-GPU tier probe (Stage 1B B0, B5, B6 cases)', date: new Date().toISOString(), userAgent: navigator.userAgent,
    renderer: caps.renderer ?? null, vendor: caps.vendor ?? null,
    limits: { MAX_DRAW_BUFFERS: /** @type {any} */ (caps).limits?.MAX_DRAW_BUFFERS, MAX_TEXTURE_IMAGE_UNITS: /** @type {any} */ (caps).limits?.MAX_TEXTURE_IMAGE_UNITS },
    timerQueries: !!caps.extensions?.EXT_disjoint_timer_query_webgl2, devicePixelRatio: devicePixelRatio,
    screen: `${screen.width}x${screen.height}`, hardwareConcurrency: navigator.hardwareConcurrency, results: rows, b5pairs: pairs,
  };
  $('results').innerHTML = '<tr><th>case</th><th>steps/ray</th><th>Msteps/s</th><th>predicted 512²</th><th>predicted 1024²</th></tr>'
    + rows.map((r) => `<tr><td>${r.case}</td><td>${r.stepsPerRay}</td><td>${r.msteps_per_s}</td><td class="${r.withinE1At512 ? 'ok' : 'bad'}">${r.predicted512s} s</td><td>${r.predicted1024s} s</td></tr>`).join('')
    + '<tr><th>B5 speedup (A/B interleaved)</th><th>off (ms)</th><th>on (ms)</th><th>speedup</th><th></th></tr>'
    + pairs.map((r) => `<tr><td>${r.case}</td><td>${r.msA}</td><td>${r.msB}</td><td class="${r.speedup > 1.02 ? 'ok' : 'bad'}">${r.speedup}×</td><td></td></tr>`).join('');
  $('report').textContent = JSON.stringify(report, null, 1);
  /** @type {any} */ (window).__probe = report;
  const copy = /** @type {HTMLButtonElement} */ ($('copy'));
  copy.disabled = false;
  copy.onclick = () => navigator.clipboard.writeText(JSON.stringify(report, null, 1)).then(() => { copy.textContent = 'Copied'; });
  status('done');
}

$('run').addEventListener('click', () => { run().catch((e) => { $('status').textContent = `failed: ${e?.message ?? e}`; /** @type {any} */ (window).__probe = { error: String(e) }; }); });
if (new URLSearchParams(location.search).has('auto')) $('run').click();
