// @ts-check
// M0 benchmark page: same analytic-Kerr RK4 tracer in WebGL2 and WebGPU.
// URL options: ?auto=1 runs on load; sizes=512,1024; runs=3; tile=128; plus any BenchParams key.
import { DEFAULTS, buildUniforms, compareRecords, codeCounts, totalSteps, quadrant, median } from './setup.js';
import { GLBench } from './benchGL.js';
import { GPUBench } from './benchGPU.js';

const $ = (/** @type {string} */ id) => /** @type {HTMLElement} */ (document.getElementById(id));
const qs = new URLSearchParams(location.search);

const FIELDS = ['a', 'thetaCam', 'rCam', 'screen', 'eps', 'maxSteps', 'tile'];
for (const f of FIELDS) {
  const el = /** @type {HTMLInputElement} */ ($(f));
  el.value = String(qs.get(f) ?? /** @type {any} */ (DEFAULTS)[f]);
}
/** @type {HTMLInputElement} */ ($('sizes')).value = qs.get('sizes') ?? '512,1024';
/** @type {HTMLInputElement} */ ($('runs')).value = qs.get('runs') ?? '3';

function readParams() {
  const p = { ...DEFAULTS };
  for (const f of FIELDS) /** @type {any} */ (p)[f] = Number(/** @type {HTMLInputElement} */ ($(f)).value);
  const sizes = /** @type {HTMLInputElement} */ ($('sizes')).value.split(',').map((s) => parseInt(s, 10)).filter((n) => n > 0);
  const runs = Math.max(1, parseInt(/** @type {HTMLInputElement} */ ($('runs')).value, 10) || 1);
  return { p, sizes, runs };
}

const COLORS = [[0, 0, 0], [228, 74, 64], [64, 156, 228], [240, 200, 60], [90, 190, 110]];
const OTHER = { 3: [255, 0, 255], 4: [255, 255, 255] };

/** @param {HTMLCanvasElement} cv @param {Float32Array} rec @param {number} N */
function drawFourColor(cv, rec, N) {
  cv.width = cv.height = N;
  const ctx = /** @type {CanvasRenderingContext2D} */ (cv.getContext('2d'));
  const img = ctx.createImageData(N, N);
  for (let py = 0; py < N; py++) for (let px = 0; px < N; px++) {
    const i = 4 * (py * N + px);
    const code = rec[i];
    const c = /** @type {any} */ (OTHER)[code] ?? COLORS[quadrant(code, rec[i + 2], rec[i + 3])];
    const o = 4 * ((N - 1 - py) * N + px); // beta up
    img.data[o] = c[0]; img.data[o + 1] = c[1]; img.data[o + 2] = c[2]; img.data[o + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
}

/** @param {HTMLCanvasElement} cv @param {Uint8Array} mismatch @param {Float32Array} rec @param {number} N */
function drawDiff(cv, mismatch, rec, N) {
  cv.width = cv.height = N;
  const ctx = /** @type {CanvasRenderingContext2D} */ (cv.getContext('2d'));
  const img = ctx.createImageData(N, N);
  for (let py = 0; py < N; py++) for (let px = 0; px < N; px++) {
    const k = py * N + px;
    const o = 4 * ((N - 1 - py) * N + px);
    const g = rec[4 * k] === 2 ? 40 : 15;
    if (mismatch[k]) { img.data[o] = 255; img.data[o + 1] = 40; img.data[o + 2] = 40; } else { img.data[o] = img.data[o + 1] = img.data[o + 2] = g; }
    img.data[o + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
}

const fmt = (/** @type {number|null|undefined} */ x, d = 1) => (x == null || !isFinite(x) ? '—' : x.toFixed(d));

/** @param {string} s */
function log(s) { $('log').textContent += s + '\n'; }

async function main() {
  const [glsl, wgsl] = await Promise.all([
    fetch('./kerrBench.frag.glsl').then((r) => r.text()),
    fetch('./kerrBench.wgsl').then((r) => r.text()),
  ]);
  const gl = new GLBench(glsl);
  const gp = new GPUBench(wgsl);
  const glOk = gl.init();
  let gpOk = false;
  try { gpOk = await gp.init(); } catch (e) { gp.error = 'WebGPU init failed: ' + e; }
  $('glStatus').textContent = glOk ? `available — ${gl.device}${gl.timerExt ? ' (GPU timer queries)' : ' (no timer queries; wall-clock only)'}` : gl.error;
  $('gpStatus').textContent = gpOk ? `available — ${gp.deviceName || 'adapter info hidden'}${gp.hasTimestamps ? ' (timestamp queries)' : ' (no timestamp queries; wall-clock only)'}` : gp.error;
  $('glStatus').className = glOk ? 'ok' : 'bad';
  $('gpStatus').className = gpOk ? 'ok' : 'bad';
  const runBtn = /** @type {HTMLButtonElement} */ ($('run'));
  runBtn.disabled = !(glOk || gpOk);

  async function runAll() {
    runBtn.disabled = true;
    $('log').textContent = '';
    $('results').innerHTML = '';
    const { p, sizes, runs } = readParams();
    const U = buildUniforms(p);
    for (const w of U.warnings) log('camera warning: ' + w);
    /** @type {any} */
    const report = { params: p, sizes, runs, userAgent: navigator.userAgent, webgl2: glOk ? gl.device : gl.error, webgpu: gpOk ? gp.deviceName : gp.error, results: [] };
    const backends = /** @type {Array<[string, any]>} */ ([]);
    if (glOk) backends.push(['WebGL2', gl]);
    if (gpOk) backends.push(['WebGPU', gp]);
    try {
      // warm-up: compile/pipeline caches, clocks
      for (const [name, b] of backends) { log(`${name}: warm-up 128²`); await b.run(U, 128, p.tile); }
      for (const N of sizes) {
        /** @type {Record<string, Float32Array>} */
        const recs = {};
        for (const [name, b] of backends) {
          const walls = [], gpus = [];
          let rec = new Float32Array(0);
          for (let k = 0; k < runs; k++) {
            const r = await b.run(U, N, p.tile);
            walls.push(r.wallMs); if (r.gpuMs != null) gpus.push(r.gpuMs);
            rec = r.rec;
            log(`${name} ${N}² run ${k + 1}: ${r.wallMs.toFixed(1)} ms wall${r.gpuMs != null ? `, ${r.gpuMs.toFixed(1)} ms GPU` : ''}`);
          }
          recs[name] = rec;
          const steps = totalSteps(rec);
          const wall = median(walls), gpu = gpus.length === runs ? median(gpus) : null;
          const row = { backend: name, N, tile: p.tile, wallMsMedian: wall, wallMsMin: Math.min(...walls), gpuMsMedian: gpu, photonSteps: steps,
            stepsPerPixel: steps / (N * N), MstepsPerSecWall: steps / wall / 1e3, MstepsPerSecGpu: gpu ? steps / gpu / 1e3 : null, codes: codeCounts(rec) };
          report.results.push(row);
          const tr = document.createElement('tr');
          tr.innerHTML = `<td>${name}</td><td>${N}²</td><td>${fmt(wall)}</td><td>${fmt(row.wallMsMin)}</td><td>${fmt(gpu)}</td>` +
            `<td>${fmt(row.stepsPerPixel, 0)}</td><td>${fmt(row.MstepsPerSecWall, 0)}</td><td>${fmt(row.MstepsPerSecGpu, 0)}</td>` +
            `<td>${row.codes.horizon}/${row.codes.escape}/${row.codes.timeout}/${row.codes.nan}</td>`;
          $('results').appendChild(tr);
        }
        if (N === sizes[sizes.length - 1]) {
          if (recs.WebGL2) drawFourColor(/** @type {HTMLCanvasElement} */ ($('cvGL')), recs.WebGL2, N);
          if (recs.WebGPU) drawFourColor(/** @type {HTMLCanvasElement} */ ($('cvGPU')), recs.WebGPU, N);
        }
        if (recs.WebGL2 && recs.WebGPU) {
          const c = compareRecords(recs.WebGL2, recs.WebGPU);
          const { mismatch, ...stats } = c;
          report.results.push({ compare: 'WebGL2 vs WebGPU', N, ...stats });
          log(`${N}² agreement: termination ${(100 * c.codeAgreement).toFixed(3)}%, four-color ${(100 * c.fourColorAgreement).toFixed(3)}% (${c.fourColorMismatches} px), ` +
            `escape-direction diff median ${c.escapeAngleMedian.toExponential(2)} rad, p99 ${c.escapeAngleP99.toExponential(2)}, max ${c.escapeAngleMax.toExponential(2)}`);
          const tr = document.createElement('tr');
          tr.className = 'cmp';
          tr.innerHTML = `<td colspan="9">${N}²: four-color agreement <b>${(100 * c.fourColorAgreement).toFixed(3)}%</b> (${c.fourColorMismatches} px differ), ` +
            `termination agreement ${(100 * c.codeAgreement).toFixed(3)}%, escape-direction difference median ${c.escapeAngleMedian.toExponential(1)} / p99 ${c.escapeAngleP99.toExponential(1)} rad, mean |Δsteps| ${c.meanAbsStepDiff.toFixed(2)}</td>`;
          $('results').appendChild(tr);
          if (N === sizes[sizes.length - 1]) drawDiff(/** @type {HTMLCanvasElement} */ ($('cvDiff')), mismatch, recs.WebGL2, N);
        }
      }
      const gl1 = report.results.filter((/** @type {any} */ r) => r.backend === 'WebGL2');
      const gp1 = report.results.filter((/** @type {any} */ r) => r.backend === 'WebGPU');
      if (gl1.length && gp1.length) {
        const last = (/** @type {any[]} */ a) => a[a.length - 1];
        const ratio = last(gl1).wallMsMedian / last(gp1).wallMsMedian;
        report.webgpuSpeedupWall = ratio;
        $('verdict').textContent = `At ${last(gl1).N}²: WebGPU is ${ratio.toFixed(2)}× the speed of WebGL2 (wall-clock; > 1 means WebGPU faster). ` +
          `Plan rule of thumb: choose WebGPU only if > 1.5× on your main laptop.`;
      } else {
        $('verdict').textContent = `Only ${backends.map((b) => b[0]).join(' and ')} available here; no comparison possible.`;
      }
      report.done = true;
    } catch (e) {
      log('ERROR: ' + e);
      report.error = String(e);
    }
    $('json').textContent = JSON.stringify(report, null, 1);
    /** @type {any} */ (window).__benchResult = report;
    runBtn.disabled = false;
  }

  runBtn.addEventListener('click', runAll);
  $('copy').addEventListener('click', () => navigator.clipboard?.writeText($('json').textContent ?? ''));
  /** @type {any} */ (window).__benchReady = { webgl2: glOk, webgpu: gpOk, glError: gl.error, gpuError: gp.error };
  if (qs.get('auto') === '1') runAll();
}

main().catch((e) => { $('log').textContent = 'Fatal: ' + e; /** @type {any} */ (window).__benchResult = { error: String(e) }; });
