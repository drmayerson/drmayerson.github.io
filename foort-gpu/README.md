# FOORT-GPU

A browser app that ray traces black holes and fuzzballs with an equatorial accretion disc, numerically and in real
time on the GPU, after [FOORT](https://github.com/drmayerson/foort) (Daniel Mayerson's C++ ray tracer). It runs at
<https://drmayerson.github.io/foort-gpu/>. There is no installation and no build step.

- **Spacetimes:**
  - black holes: Kerr, Johannsen, Manko–Novikov and Reissner–Nordström;
  - the ST3Cr ring fuzzball of *Fuzzball Shadows* (arXiv:2103.12075), including its λ = 0 black hole.
- **Disc:** FOORT's fluid model (GeneralCircularRadial), its Johnson-SU emission profile, and its redshift convention (an observer at infinity).
- **Time:** the disc flickers with a Gaussian random field from [inoisy](https://github.com/AFD-Illinois/inoisy) (Lee & Gammie 2021). Each image point shows the disc as it was when its light left ("slow light").

The GPU computes in float32 and is meant for visualization; FOORT remains the science tool. Accuracy against FOORT
and against a double-precision reference is documented in `PROGRESS.md`.

---

## User guide

### Requirements

WebGL2 with `EXT_color_buffer_float`: a recent Chrome or Edge (tested), Firefox or Safari 15+ (untested). A discrete GPU helps, but integrated graphics work. `caps.html` reports what your browser offers.

### The image

The camera is a static observer at distance r, inclination θ from the spin axis, looking at the origin; FOORT's `ViewScreen`. The screen size and centre are given in the same units. All lengths and times in the viewer are in units of the metric's ADM mass M. The ST3Cr fuzzball (FOORT's charges P = 2, q₀ = 50, M_ADM = 24 in FOORT's coordinates) is traced in units of M too, so its lengths, the disc profile and the delays compare directly with the black holes; Stage 1 links are converted automatically.

A new trace runs whenever the spacetime, camera, fluid or tracing settings change. It refines progressively: a coarse image first, then finer levels, centre first. While a slider is dragged only the coarse level is traced, on a coarse metric table; the full image follows on release. Emission, exposure, tone map, colour map, time and noise settings only redraw and never retrace.

### Controls

| group | what it does |
|---|---|
| **Spacetime** | the metric and its parameters (sliders clamp to each metric's valid range); for ST3Cr, a log-scale λ slider and a "λ = 0" switch to the supersymmetric black hole; for Kerr, the closed-form validation shader |
| **Camera** | distance, inclination, screen size and centre (units of M) |
| **Disc emission** | FOORT presets (KerrExample, JohannsenExample, Test_MNrun, Test_FBdetail); Johnson-SU μ, γ, σ; redshift power; geometric fudge factor and number of passes; the fluid's sub-Keplerian ξ and radial-infall β_r, β_φ; exposure (auto: the 99.5th percentile), tone map, colour map |
| **Time** | play/pause, speed (M per second), slow vs fast light, noise field (auto: by metric and λ; or a fixed inoisy field, or the placeholder), noise amplitude σₙ, optional procedural advection of the field with the fluid |
| **Tracing** | resolution, metric table size, the step parameter ε (FOORT's 0.03), larger steps beyond 20 M (on by default: about 20% faster, escape directions within about 3e-4 rad), max steps (5000; for the fuzzball the disc image is the same as with 10000), FOORT-parity or interpolated disc crossings, recording the constraint \|H\| |
| **View** | disc emission, or a debug view: four-colour screen, termination, steps, redshift g₁, delay, crossings, sky grid, \|H\|, noise, n = 1 image delay, noise coverage |

### Debug views

The legend under the image explains the colours of each debug view. The performance table reports:
- the GPU and the table bake;
- the fluid's ISCO, and the circular-orbit bands for horizonless metrics;
- the trace time and the steps per ray.

### Sharing a view

The complete state is in the URL query, for example `?metric=st3cr&lambda=0.001&inc=60&view=fourColor`, so a link reproduces the view.

### Known limitations

- **Later disc crossings:** each pixel keeps its first 3 disc crossings exactly; every later crossing (light trapped near the photon ring or inside the fuzzball's cap) is summed into 8 log-r bins and drawn **without noise or slow light** (its fluctuations average out over many crossings with spread-out delays). Devices with fewer than 6 WebGL2 draw buffers keep the first 3 crossings only (the performance table says so). Redshift power, fudge factor and max passes re-trace, since the bins are weighted at trace time.
- **Noise model:** the noise field is sampled at log(r/M). With the noise field on "auto", black holes use `inoisy_lg21` (Keplerian flow, r = 0.05–190 M). The ST3Cr fuzzball and its λ = 0 black hole use a field made with the viewer's own banded-fluid Ω(r) at the anchor λ nearest in log λ (0, 1e-3, 5e-3, 0.05; r = 1e-4–200 M). Between anchors the flow is approximate. Outside a field's radial range the noise amplitude fades to 0 over one correlation length (coverage guard). The "Noise coverage" view and the clock line show how much of the emission the field covers.
- **Chaos:** inside the fuzzball, ray scattering is chaotic, and individual pixels there depend on the step size in any integrator, FOORT's included.
- **Very large images:** on a slow GPU, very large images or very many steps can make the operating system reset the GPU. The page then says so and needs a reload.

---

## Developer guide

### Layout

| path | contents |
|---|---|
| `index.html`, `style.css`, `js/main.js` | the viewer |
| `js/metrics/` | the metric library (double precision); `registry.js` lists the metrics the viewer offers |
| `js/bake/` | metric tables for the GPU (baked in a Web Worker); Hermite lookup in JS for the tests |
| `js/gpu/` | backend interface and the WebGL2 backend, trace scheduling (progressive levels, adaptive tiles), view → uniforms |
| `js/camera/` | tetrad camera (FOORT's static observer) |
| `js/fluid/` | FOORT's fluid model (port), its GPU table, Johnson-SU and the disc emission |
| `js/noise/` | noise-field contract, loader and sampler |
| `js/ref/` | the double-precision CPU reference tracer (tests and validation) |
| `js/ui/` | controls (built from `CONTROLS` and the metric registry), URL state |
| `shaders/glsl/` | `common.glsl` (tracer core), `trace.glsl` (tabulated metric), `trace_kerr_analytic.glsl` (closed-form Kerr, validation), `display.glsl` (emission and debug views) |
| `noise/` | noise fields in the contract format |
| `tools/` | offline tools, not loaded by the app: the FOORT parity harness (`foort_parity/`), noise generation (`noise/`: placeholder FFT field; inoisy build, model and converter, see `tools/noise/build_inoisy.md`) |
| `dev/` | tests and validation scripts (Node.js ≥ 18) |
| `bench/` | the M0 WebGL2-vs-WebGPU benchmark |

### How it works

- **Metrics:** every metric is stationary, axisymmetric and circular. A metric module gives g_dd (and optionally g^uu) in double precision.
- **Tables:** a Web Worker bakes five inverse-metric functions on an (x = log(r − r_h), θ) grid as residuals over an analytic background, with finite-difference derivatives (`js/bake/bake.js`).
- **Tracer:** the GPU integrates Hamilton's equations with RK4 and FOORT's adaptive step, in float32, reading the tables by bicubic Hermite interpolation (`shaders/glsl/`). Nothing on the GPU is metric-specific.
- **Record:** each pixel's ray writes a 16-float record: termination, steps, escape direction, and up to 3 equatorial crossings (r, φ, delay, redshift).
- **Display:** a cheap fragment pass turns the record into the disc emission every frame, with noise and slow light, or into a debug view.
- **Design and validation:** the plan's design is in `FOORT_GPU_STAGE1_PLAN.md`; every implementation choice, with its reason, is in `DECISIONS.md`.

### Adding a metric

Adding a metric needs one module in `js/metrics/` and one entry in `js/metrics/registry.js`, nothing else. `reissnerNordstrom.js` is the example:

1. **Write `js/metrics/<name>.js`**, exporting a factory that returns the `StationaryAxisymmetricMetric` interface (`js/metrics/common.js`):
   - `id`, `params`;
   - `massADM`: the length unit of the UI;
   - `horizon`: `{kind:'sphere', r}` or `{kind:'none'}`;
   - `equatoriallySymmetric`;
   - `g_dd(r, θ)` with the five nonzero components gtt, gtphi, gphiphi, grr, gthth; optionally a closed-form `g_uu`;
   - `singularities()`;
   - `validate()`;
   - optionally `terminationRadius()` and `singularityEpsilon()`.

   Horizonless metrics are traced in x = log r and need a `terminationRadius()`: their inner cut.
2. **Add an entry to `METRICS`** in `registry.js`:
   - `id`, `label`;
   - `mode` (`'BH'` or `'fuzzball'`: the default max steps);
   - `create(params)`;
   - `params`: name, label, min, max, default, optionally `step`, `scale: 'log'`, `bounds(params)` for parameter-dependent limits, `fixed`.

   The viewer's metric menu and sliders are built from this list. A parameter name shared by several metrics (like the spin `a`) is one slider.
3. **Test it:** add a unit test, as in `dev/tests/unit/m9.test.js`, covering validity, the inverse, a known limit and a bake. Then look at the four-colour view and compare with the CPU reference (`dev/scripts/m3Level2.mjs` shows how).

### Tests and validation

```
cd dev
npm install
npx playwright install chromium   # only if Chrome is not installed
npm test                           # Vitest unit tests (pure-math modules, in node)
npm run test:e2e                   # Playwright end-to-end tests in Chrome (serves the app with dev/scripts/serve.mjs)
npm run typecheck                  # tsc --checkJs
```

Validation scripts (reports in `dev/reports/m<N>/`), by milestone:

| milestone | scripts |
|---|---|
| M1–M2 | `metricParity.mjs`, `runFoort.mjs`, `runCpuRef.mjs`, `compareFoort.mjs`: metric and CPU-reference parity with FOORT (need `tools/foort_parity/build.sh`) |
| M3 | `m3Level2.mjs`, `m3Level3.mjs`, `m3Perf.mjs`: GPU vs CPU, analytic checks, timings |
| M4 | `m4Level4.mjs`, `m4TableError.mjs`, `m4TableRays.mjs`, `m4Perf.mjs`: tabulated vs closed-form Kerr, table errors, bake and trace timings |
| M5 | `fluidParity.mjs`, `m5FoortEmission.mjs`, `m5GpuVsFoort.mjs`: fluid model and disc intensities vs FOORT |
| M6 | `m6TableError.mjs`, `m6Level2.mjs`, `m6GpuVsFoort.mjs`, `m6Level3.mjs`, `m6Continuity.mjs`, `m6Passes.mjs`, `m6Steps.mjs`: fuzzball tables, GPU vs CPU and FOORT, λ = 0 shadow, λ → 0, crossings, steps |
| M7–M8 | `m7Delays.mjs`, `m7Frames.mjs`; `tools/noise/inspect_field.py`: light delays, animations, noise fields |
| M9 | `m9Perf.mjs`: acceptance timings |
| Stage 1B | `qualityGate.mjs` (+ `gateConfigs.mjs`): any configuration vs Reference on the scene set; `b1Compare.mjs`; `b2Tail.mjs`, `b2BH.mjs`, `b2Images.mjs`; `b3Images.mjs`; `b4OmegaTables.mjs`, `b4Coverage.mjs`, `m7Frames.mjs --b4`; the device probe page `probe.html` |

### Local server

`sh dev/serve.sh` (or `powershell -File dev\serve.ps1`), then open <http://127.0.0.1:8765/>.
