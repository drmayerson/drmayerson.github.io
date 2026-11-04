# FOORT-GPU — Stage 1 implementation plan

Status: v0.3 (2026-11-03; D1, D3, D4 confirmed; D2 = backend chosen by the M0 benchmark, WebGL2-first expected). Owner: Daniel Mayerson. Intended executor: a Claude Code session on a machine with a recent Chrome (WebGL2 and WebGPU available).

---

## 0. How to use this document (instructions to the implementing agent)

- Work strictly milestone by milestone (Section 7). Each milestone ends in a **CHECKPOINT**. At a checkpoint: run the listed tests, write a short report in `PROGRESS.md` (what was done, test results with numbers, open issues, screenshots/paths), commit, and **stop and wait for the user's go-ahead**. Do not start the next milestone without explicit approval.
- Record every non-trivial implementation choice in `DECISIONS.md` (date, decision, alternatives, reason). Section 10 lists decisions with proposed defaults; if the user has not confirmed one when it becomes relevant, use the default and flag it in the checkpoint report.
- All code lives in `drmayerson.github.io/foort-gpu/` (no build step; see Section 3.1). Work on branch `foort-gpu-dev`; merge to the published branch only at user-approved checkpoints. Do not touch the other folders of that repository.
- Never modify the FOORT repository itself. FOORT is read-only reference material; the parity harness (M1–M2) lives in this repo under `tools/foort_parity/` and builds against a local clone of FOORT.
- Before writing any physics code, read the FOORT files listed in Section 2.1. Port behaviour faithfully first; improve only after parity is established and documented.
- Visual correctness must be confirmed by the user at checkpoints; automated tests establish numerical correctness. When something looks plausible but is not tested, say so.

---

## 1. Goal and scope

### 1.1 Stage 1 goal

A browser application ("FOORT-GPU viewer") that ray traces, numerically and on the GPU, images of compact objects with an equatorial emitting disc, with:

- **BH mode**: Kerr (spin `a`), Johannsen (spin `a` + `alpha13`, other deformation parameters fixed to 0), Manko–Novikov (spin `a` + octopole `alpha3`) — parameters and conventions exactly as in FOORT.
- **Fuzzball mode**: the ST3Cr ring fuzzball with fixed `P`, `q0` and variable `lambda`, **including `lambda = 0`**, which is the supersymmetric static BH with a horizon at base-space `r = 0`.
- **Emission**: equatorial disc with FOORT's GLM Johnson-SU radial envelope times `exp(sigma_n * X)` where `X` is a precomputed, time-periodic Gaussian random field (inoisy-type), observed with the correct redshift (fluid velocity model as in FOORT) and **finite light-travel time** ("slow light": each image point shows the disc at its emission time).
- **Real time**: the disc animates at display frame rate; parameter or camera changes trigger a re-trace that is fast enough to feel interactive (progressive refinement).
- **Modularity**: adding a new stationary, axisymmetric metric should mean writing one JavaScript module (metric functions in double precision) and nothing on the GPU side.

### 1.2 Non-goals for Stage 1

Moving/accelerating observers, spaceship dynamics, cubemaps (Stage 2); polarization; thick/volumetric emission; non-axisymmetric spacetimes; a second GPU backend (optional M10); offline science-grade precision (the GPU path is float32 and is meant for visualization; FOORT stays the science tool).

### 1.3 Stage 2 preview (design constraints to respect now)

Stage 2 will be a "fly around the object" game: arbitrary observer 4-velocity and orientation, ship worldline integration with thrust, possibly a 4π cubemap per camera position. Therefore:

- The camera must be implemented as a **general tetrad camera** (position + orthonormal tetrad); FOORT's static observer is just one constructor.
- Trace and display must stay **decoupled** (Section 3.8): the trace stores geometry (crossings, delays, redshift ingredients), the display applies emission and time. The stored data must be sufficient to recompute the redshift for a different observer 4-velocity at the same event (store the photon momentum at the camera or the needed invariants).
- All time is coordinate time `t` of the stationary metric, in units of the metric's mass.

---

## 2. Background and references

### 2.1 FOORT (reference implementation)

Repository: `https://github.com/drmayerson/foort` (C++17). Read `AGENTS.md` first. Relevant files in `FOORT/src/`:

| What | Where | Notes |
|---|---|---|
| Metric base, symmetries | `Metric.h/.cpp` (`Metric`, `SphericalHorizonMetric`, `SingularityMetric`) | Christoffels via central finite differences with `Derivative_hval = 1e-7` — **unusable in float32**; we will not do this on the GPU. |
| Kerr (BL) | `KerrMetric` | horizon `1 + sqrt(1 - a^2)` (M = 1) |
| Johannsen | `JohannsenMetric(a, alpha13, alpha22, alpha52, eps3)` | we expose `a`, `alpha13`; others 0. Validity: `alpha13 > -r_+^3`. |
| Manko–Novikov | `MankoNovikovMetric(a, alpha3)` | prolate coords `x = (r-1)/k`, `y = cos(theta)`, `k = sqrt(1-a^2)`; `a = 0` handled via `alpha = 0`. **Not equatorially symmetric for `alpha3 != 0`.** Known pathologies near the horizon (CTC regions, singular behaviour at the equatorial horizon point). |
| Ring fuzzball | `ST3CrMetric(P, q0, lambda)` | `l = 8 P^3 lambda`, `R = 2 lambda sqrt(q0^2/(1-(1-3P^2)lambda)^2 - 4P^6)`; `omega_phi` contains a 17-point Simpson integral over `phi'` (expensive); `M_D0` uses `std::comp_ellint_1`. **`lambda = 0` divides by `l = 0` in `omega_phi_ab = -4P^3/l * om_ab` and is not supported in FOORT.** |
| Kerr–Schild Kerr | `KerrSchildMetric` | not needed in Stage 1 |
| Geodesic RHS, `Source` term | `Geodesic.h/.cpp` | `Source` = forcing term; relevant for Stage 2 |
| Integrators, adaptive step | `Integrators.h/.cpp` | `GetAdaptiveStep`: `h = 1/(1/h1 + 1/h2 + 1/h3)` with `h1 = eps/|v^1|`, `h2 = eps*min(theta, pi-theta)/|v^2|`, `h3 = eps/|v^3|`; default `eps = 0.03`; RK4 and Verlet |
| Camera | `ViewScreen.cpp` (`ConstructVielbein`, `SetNewInitialConditions`) | static observer: Gram–Schmidt from `d_t`, then `d_phi`, `d_r`, `d_theta`; flat-frame momentum `{-1, -r/D, -beta/(r D), alpha/(r sin(theta) D)}` with `D = sqrt(r^2 + alpha^2 + beta^2)`; rescaled so that `p_t = 1` (past-pointing). Only radially inward pointing camera. |
| Equatorial emission | `Diagnostics.cpp` (`EquatorialPassesDiagnostic`, `EquatorialEmissionDiagnostic`) | crossing detected by sign change of `theta - pi/2` outside a `Threshold` band; emission evaluated at the step position *after* the crossing (no interpolation); intensity `+= Fudge * g^RedshiftPower * J(r)` with `g = -1/(p·u)`; `RedshiftPower` default 3; `GeometricFudgeFactor` for passes > 1; `EquatPassUpperBound`. |
| Emission and fluid models | `DiagnosticsEmission.h/.cpp` | `GLMJohnsonSUEmission`: `J(r) = exp(-0.5*(gamma + asinh((r-mu)/sigma))^2) / sqrt((r-mu)^2 + sigma^2)` with true (non-log) `r`. `GeneralCircularRadialFluid(xi, beta_r, beta_phi)` with bisection ISCO search between `ISCOLowerBound`/`ISCOUpperBound` (defaults: horizon radius and 10× for horizon metrics; 0.05 and 1000 otherwise). |
| Terminations | `Terminations.h/.cpp` | Horizon (`r < r_h (1+eps)`), BoundarySphere, TimeOut (max steps), ThetaSingularity, NaN, GeneralSingularity (distance to metric singularities). |
| Meshes | `Mesh.h` | `SimpleSquareMesh` (uniform pixel grid) — use for parity runs. |
| Example configs | `FOORT/cfgs/KerrExample.cfg`, `Test_FBdetail.cfg` (ST3Cr with `P = 2`, `q0 = 50`, `lambda = 0.005`, camera `r = 250`, `theta = 1.5`, screen 150×150, Johnson `mu=0, gamma=-1.5, sigma=2`), `JohannsenExample.cfg`, `Test_MNrun.cfg` | |

### 2.2 Existing GPU code by the user

`https://github.com/drmayerson/drmayerson.github.io`, folder `zwart-gat-camera/index.html`: WebGL (1/2) fragment shader with **analytic** Kerr null geodesics via Carlson elliptic integrals (`kRF`, `kRJ`, `kerrCore`, `kerrLens`), observer at `CAM_D = 200`. Architecture: an expensive `MAP_PASS` that is recomputed only when parameters change (`dirty` flag) and a cheap `DISPLAY_PASS` every frame. Use (a) its Carlson `R_F` implementation if needed, (b) its `kerrLens` output as an independent analytic cross-check of escape directions for Kerr (M3), and (c) its two-pass architecture as precedent for ours.

### 2.3 Physics references

- Bacchini, Mayerson, Ripperda, Davelaar, Olivares, Hertog, Vercnocke, *Fuzzball Shadows* (arXiv:2103.12075): ST3Cr definitions, bubble equations, `lambda -> 0` scaling limit to the BH with `V = L = 0`, `K = 1 + 2P/r`, `M = -1/2 + (P^3 - q0)/r`, mass `2 M_BH = 3P + q0 - P^3`.
- Gralla, Lupsasca, Marrone 2020 (GLM, PRD 102, 124004): Johnson-SU envelope.
- Lee & Gammie 2021, ApJ 906, 39 (inoisy); code `https://github.com/AFD-Illinois/inoisy` (needs HYPRE, HDF5, MPI; models in `model_<name>.c`); Python wrapper `https://github.com/aviadlevis/pynoisy`.

---

## 3. Architecture and key design decisions

### 3.1 Platform and tooling

- **GPU backend: decided by data in M0 (D2).** Stage 1 is a one-independent-loop-per-pixel workload, which WebGL2 fragment shaders handle about as efficiently as WebGPU compute shaders, at the same float32 precision; WebGL2 has much wider reach (older iOS/Android, Firefox on Linux/Android) and matches the user's existing `zwart-gat-camera`. WebGPU becomes valuable in Stage 2 (ray rescheduling, cubemap updates, shooting rays toward objects). Therefore:
  - M0 benchmarks the same minimal analytic-Kerr tracer in **both** WebGL2 (GLSL ES 3.00 fragment shader) and WebGPU (WGSL compute shader) on the user's devices.
  - **Expected outcome / default: WebGL2-first for Stage 1**, unless WebGPU is substantially faster (rule of thumb: > 1.5× on the user's main laptop) — the user decides at CHECKPOINT M0, recorded in `DECISIONS.md`.
  - Either way, all GPU access goes through a **backend interface** (`js/gpu/backend.js`) so a second backend can be added later without touching physics or UI code. Only the chosen backend is implemented in M1–M9; the other is M10 (optional) or Stage 2.
- **Backend interface (sketch)**: `createBackend(canvas) -> { uploadTable2D(name, Float32Array, w, h), uploadTexture3D(name, data, nx, ny, nz, format), uploadUniforms(obj), traceTile(rect, levelOfDetail) -> Promise, display(time, viewParams), readRecords(rect) -> Float32Array (for tests), capabilities(), timing() }`. Shader sources are kept per backend (`shaders/glsl/`, `shaders/wgsl/`); keep the GLSL and WGSL versions structurally parallel (same function names and order) so porting is mechanical.
- **WebGL2 specifics** (if chosen): require `EXT_color_buffer_float` (render to and read back RGBA32F); `precision highp float; precision highp int;` in all shaders; trace pass = full-screen-quad draw into **4 RGBA32F color attachments (MRT)** holding the 16-float per-pixel record, restricted to tiles with `gl.scissor`/`gl.viewport`; pace tiles with `gl.fenceSync` + polling `gl.clientWaitSync` (keep each tile ≲ 30–50 ms to avoid the browser GPU watchdog); metric tables as RGBA32F 2D textures read with `texelFetch` (no filtering); noise as an R16F 3D texture with `LINEAR` filtering (R16F is filterable in core WebGL2); timing via `EXT_disjoint_timer_query_webgl2` where available, otherwise wall-clock around fences. Show a clear message if WebGL2 or `EXT_color_buffer_float` is missing.
- **WebGPU specifics** (if chosen): compute shader writes the record to a storage buffer; check `maxStorageBufferBindingSize`; timestamp queries if the `timestamp-query` feature is available; show a clear message if `navigator.gpu` is missing.
- **Location: a new folder `foort-gpu/` inside the existing GitHub Pages repository `drmayerson.github.io`, with no build step** (D1, confirmed). What is committed is exactly what is served: plain HTML + native ES modules (`<script type="module">`, relative imports) + shader source files (GLSL and/or WGSL) loaded at runtime with `fetch`. The bake runs in a module Web Worker (`new Worker(url, { type: 'module' })`). The app must run from any static server (`python3 -m http.server` locally, GitHub Pages in production). No bundler, no transpiler, no CDN dependencies for the app itself.
- **Language: modern JavaScript (ES2022) with JSDoc type annotations** and `// @ts-check` at the top of each file, so editors and an optional `tsc --noEmit --checkJs` run can type-check without any compilation step.
- **Dev-only tooling** lives in `foort-gpu/dev/` with its own `package.json` (Vitest for CPU unit tests, Playwright for browser/GPU tests in Chromium with WebGL2 (and WebGPU enabled for the M0 comparison); a software adapter is fine for correctness, not for timing). `node_modules/` and large generated artifacts are git-ignored. The served app must never import anything from `dev/`.
- **Repository etiquette**: the Pages repo hosts the user's other projects (`zwart-gat-camera/`, `et-horizon/`, etc.). Touch nothing outside `foort-gpu/`. In particular, do not add a link to the root `index.html` until M9 and only with the user's approval. Keep files under ~50 MB each (noise fields included); never commit FOORT itself, build products of the parity harness, or inoisy/HYPRE builds.
- Deployment is simply pushing to the Pages branch; work on a feature branch (`foort-gpu-dev`) and merge at checkpoints the user approves, so half-finished states are not published.
- Python (numpy, h5py) only for offline tools (noise generation, FOORT output parsing).

### 3.2 Precision strategy (central design principle)

- **Everything that defines the spacetime and the disc is computed in double precision in JavaScript (Float64)** (CPU, in a Web Worker): metric functions, inverse metric, derivative tables, validity checks, ISCO, fluid 4-velocity table, camera tetrad, initial momenta normalization constants.
- **The GPU only integrates rays in float32** using tabulated (or, for the Kerr validation path, closed-form) inverse-metric data, and does lookups. No finite differencing on the GPU.

### 3.3 Metric abstraction

Metric interface (JSDoc sketch; each metric is an ES module exporting a factory):

```js
/**
 * @typedef {{gtt:number, gtphi:number, gphiphi:number, grr:number, gthth:number}} Circular4
 * @typedef {Object} StationaryAxisymmetricMetric
 * @property {string} id
 * @property {Record<string, number>} params
 * @property {number} massADM                 length unit; UI shows lengths in units of this
 * @property {{kind:'none'} | {kind:'sphere', r:number}} horizon
 * @property {boolean} equatoriallySymmetric
 * @property {(r:number, th:number) => Circular4} g_dd     all other components zero
 * @property {((r:number, th:number) => Circular4)=} g_uu  optional closed form; else inverted generically
 * @property {() => Array<Object>} singularities           points / rings, for termination
 * @property {() => {ok:boolean, messages:string[]}} validate  parameter ranges; sampled signature/CTC checks
 */
// e.g. export function createKerr({ a }) { ... return metric; }
```
Metrics are listed in a registry module (`metrics/registry.js`) that the UI reads to build mode/metric menus and parameter sliders (each metric declares parameter names, ranges, defaults and presets).

All Stage 1 metrics are "circular" (only `t,phi` block plus `rr`, `thth` nonzero) — assert this.

Two GPU paths:

1. **Tabulated path (the backbone, used for all metrics in the app)**: the worker bakes 2D tables of five inverse-metric functions on an `(x, theta)` grid; the shader does Hermite bicubic interpolation. The shader is metric-agnostic.
2. **Analytic Kerr path (validation and benchmarking only)**: closed-form Kerr `g^{mu nu}` and its `r, theta` derivatives written directly in the shader language of the backend. Used to validate the tabulated path (M4) and to measure the cost of table lookups.

### 3.4 Coordinates and grid

- Radial grid coordinate: `x = log(r - r_h)` for horizon metrics (resolves the near-horizon region; the ray terminates at `r < r_h (1 + eps_h)`), `x = log r` for horizonless metrics and for the `lambda = 0` fuzzball BH (horizon at `r = 0`). `x` range from the termination radius to beyond the camera radius (camera up to ~1000 M).
- Angular: `theta in [0, pi]` (or `[0, pi/2]` with reflection when `equatoriallySymmetric`), uniform to start; allow an analytic non-uniform mapping later (M6 may need clustering near the axis and the equator where the ST3Cr centers and ring sit).
- Default grid 512 (x) × 256 (theta); make sizes configurable and justify final values with M4/M6 error studies.
- Tabulated functions (all as functions of `(x, theta)`, `x`-derivatives include the Jacobian):
  `G0 = g^{tt}`, `G1 = g^{t phi}`, `G2 = sin^2(theta) g^{phi phi}` (regular on the axis), `G3 = g^{xx}`, `G4 = g^{theta theta}`.
  In the shader `g^{phi phi} = G2 / sin^2(theta)` with the `sin^2` and its derivative applied analytically.
- Per function store the four Hermite values `(f, f_x, f_theta, f_x_theta)` → five RGBA32F textures, read with `texelFetch` (GLSL) / `textureLoad` (WGSL) — no hardware filtering: its fixed-point weights would make derivatives staircase.
- Derivatives: evaluate the metric once per grid node in double, then form derivatives by 4th-order finite differences on the grid (one-sided at edges). This keeps baking cheap (one metric evaluation per node — important for ST3Cr's Simpson integral). Validate against analytic derivatives for Kerr (M4).
- Bake time budget: ≤ 0.5 s for any metric at default grid size, in a Web Worker, so the `lambda` slider stays responsive.

### 3.5 Equations of motion

Hamiltonian form with conserved `p_t = -E`, `p_phi = L`:

```
H = 1/2 [ g^{tt} p_t^2 + 2 g^{t phi} p_t p_phi + g^{phi phi} p_phi^2 + g^{xx} p_x^2 + g^{theta theta} p_theta^2 ] = 0
dx/dlam     = g^{xx} p_x            dtheta/dlam = g^{theta theta} p_theta
dt/dlam     = g^{tt} p_t + g^{t phi} p_phi
dphi/dlam   = g^{t phi} p_t + g^{phi phi} p_phi
dp_x/dlam   = -1/2 d_x g^{mu nu} p_mu p_nu
dp_theta/dlam = -1/2 d_theta g^{mu nu} p_mu p_nu
```

State per ray: `(t, x, theta, phi, p_x, p_theta)` plus constants `(p_t, p_phi)`. Follow FOORT's convention of past-pointing momenta (backward tracing; `Delta t < 0` along the ray). Monitor the constraint `|H|` (debug view); add constraint projection only if drift is shown to matter.

Axis crossing: if `theta < 0` → `theta = -theta`, `phi += pi`, `p_theta = -p_theta`; if `theta > pi` → `theta = 2 pi - theta`, `phi += pi`, `p_theta = -p_theta`. (Replaces FOORT's ThetaSingularity termination; test with a face-on Schwarzschild camera, M3.)

### 3.6 Camera

Port FOORT's `ViewScreen` exactly (static observer vielbein, screen coordinates `alpha, beta`, screen size and center, radially inward camera, `p_t = 1` normalization), but implement it as `TetradCamera.fromStaticObserver(metric, r, theta, phi)`. The tetrad (4×4) and camera position are computed in JS (double) and passed as uniforms. User controls: distance, inclination, screen size (field of view), screen center offset.

Note for later: FOORT's redshift `g = -1/(p·u_fluid)` with `p_t = 1` is relative to a static observer at infinity; for a camera at finite radius the camera-frame redshift differs by `sqrt(-g_tt(camera))`. Keep FOORT's convention in Stage 1 (parity), but store enough to switch (Stage 2).

### 3.7 Integrator, step control, terminations

- RK4 with FOORT's adaptive step formula (Section 2.1) applied to the coordinate velocities `(dx/dlam, dtheta/dlam, dphi/dlam)` and FOORT's `SmallestPossibleStepsize`. Same `eps = 0.03` default. This gives a like-for-like comparison with FOORT. Faster integrators (e.g. embedded RK45) are a later optimization, gated by tests.
- Terminations: horizon; boundary sphere (`r > R_bound`, default 1.01 × camera radius); timeout (`maxSteps`, user-adjustable; default 5000 BH / 20000 fuzzball, to be tuned); NaN/Inf; singularity proximity (ST3Cr: Euclidean distance in the base R³ to the D6 centers `(0, 0, ±l/2)` and to the D0 ring `(rho = R, z = 0)` below `eps_sing`, FOORT default 0.001). Record the termination code per pixel.

### 3.8 Two-pass rendering

**Trace pass** (WebGL2: fragment shader rendering into 4 RGBA32F MRT targets per tile; WebGPU: compute shader writing a storage buffer; runs only when metric/emission-geometry/camera/fluid parameters change): one shader invocation per pixel traces the full ray and writes a fixed-size record:

```
termCode, nSteps, escape (theta_inf, phi_inf) or 0,
up to NCROSS = 3 equatorial crossings, each: (r_k, phi_k, dt_k, g_k)
```

where `dt_k = t_k - t_cam` (negative), `g_k` the redshift factor at the crossing (FOORT convention), and `r_k` the true `r`. Dispatch in tiles so that no single dispatch exceeds ~30–50 ms (avoids browser GPU watchdogs); order tiles/pixels coarse-to-fine (e.g. 1/16 → 1/4 → full resolution) so a preview appears immediately and refines. While the user drags a slider, trace only the coarse level; refine on release.

Crossing detection: sign change of `theta - pi/2` between steps, linear interpolation in `lambda` to the crossing for `(r, phi, t, momenta)`. Provide a `foortParityCrossing` flag that instead reproduces FOORT (threshold band, post-step position) for M5 comparisons.

**Display pass** (every frame, fragment shader, trivially cheap):

```
I(pixel, t_obs) = sum_k F_k * g_k^p * J(r_k) * exp(sigma_n * X(t_obs + dt_k, x_k, phi_k) - sigma_n^2/2)
```

with `F_1 = 1`, `F_{k>1} = GeometricFudgeFactor`, `F_k = 0` beyond `EquatPassUpperBound`, `p = RedshiftPower` (default 3), `J` the Johnson-SU envelope, and `X` the noise field (Section 3.9), wrapped periodically in time. Then exposure, tone mapping (selectable: linear / sqrt / log / asinh) and a colormap (e.g. afmhot, inferno, grayscale). Toggle **"fast light"** (`dt_k := 0`) for comparison. Time control: play/pause, speed in units of M per second.

Debug views (cheap, from the same record; essential for development and checkpoints): four-color screen (FOORT `FourColorScreen` quadrant convention from escape direction), termination code, step count heat map, number of crossings, `g_1`, `dt_1`, `|H|` drift (if stored).

### 3.9 Emission model and noise field

- Johnson-SU envelope with FOORT's parameters `(mu, gamma, sigma)` in the metric's true coordinate `r` — for ST3Cr this is the base-space `r` of FOORT, exactly as FOORT does it (D3, confirmed). Presets from FOORT configs (`KerrExample.cfg` for BH mode, `Test_FBdetail.cfg` for fuzzball mode). Keep the radius function behind one small helper so a circumferential-radius option could be added later without touching the shaders' structure.
- Fluid: port `GeneralCircularRadialFluid` (parameters `xi, beta_r, beta_phi`, ISCO search with configurable bounds) to JS; tabulate the contravariant fluid velocity `(u^t, u^x, u^phi)` on the equator as a 1D table in `x` (e.g. 2048 samples, linear interpolation). Report the ISCO (or "no ISCO") in the UI. For horizonless metrics FOORT's single-transition bisection may be inappropriate (several stable/unstable bands); detect and report this rather than silently accept the bisection result.
- **Noise-field contract** (any generator can produce it):
  - `noise/<name>.bin`: little-endian float16 (or float32) array, shape `(Nt, Nx, Nphi)`, C order.
  - `noise/<name>.json`: `{ "Nt", "Nx", "Nphi", "T_over_M", "xmin", "xmax", "x_def": "log(r/M)", "periodic": {"t": true, "phi": true}, "normalized": "zero mean, unit variance", "generator": {...} }`.
  - Uploaded as a half-float (R16F / `r16float`) 3D texture with hardware linear filtering, `repeat` addressing in `t` and `phi`, `clamp` in `x`. Typical size 128 × 256 × 256 (16 MB at float16).
  - The field is sampled with `x = log(r / M_ADM)` so one field serves all metrics; this is an approximation for the fuzzball (the field's built-in flow pattern is Kepler-like, not the actual fluid model). (See D3/D4.)
- Optional display-shader mode "procedural advection": sample at `phi - Omega_fluid(r) * tau` with two crossfaded phases of finite duration (flow-map trick) — default off; useful with a placeholder field that has no built-in rotation.

### 3.10 Modes and parameters

| Mode | Metric | User parameters | Notes |
|---|---|---|---|
| BH | Kerr | `a in [0, 0.999]` | M = 1 |
| BH | Johannsen | `a`, `alpha13` | range: `alpha13 > -r_+^3`; upper slider bound set by validity checks |
| BH | Manko–Novikov | `a`, `alpha3` | slider range set by validity checks (signature, no CTCs outside termination radius); warn that the equatorial disc is not a symmetry plane for `alpha3 != 0` |
| Fuzzball | ST3Cr | `lambda in [0, lambda_max)` | fixed `P = 2`, `q0 = 50` (D5). `lambda_max = (q0/(2P^3) - 1)/(3P^2 - 1) ≈ 0.193`. Log-scaled slider (e.g. 1e-4 … 0.19) plus an explicit "lambda = 0 (BH)" switch. |
| Fuzzball | ST3Cr BH (`lambda = 0`) | — | new metric class: `V = L = 0`, `K = 1 + 2P/r`, `M = -1/2 + (P^3 - q0)/r`, `omega = 0`, `Q = -2 K^3 M`; horizon at `r = 0` |

Common controls: camera distance, inclination, field of view; Johnson parameters; fluid parameters; noise amplitude `sigma_n`; redshift power, fudge factor, max passes; time speed; slow/fast light; tone mapping; debug view; resolution and max steps; performance overlay (trace time, photon-steps per second).

---

## 4. Physics notes and gotchas

1. **ST3Cr metric structure.** `ds^2 = -Q^{-1/2}(dt + omega dphi)^2 + Q^{1/2}(dr^2 + r^2 dtheta^2 + r^2 sin^2 theta dphi^2)`, with FOORT's `g03 = -omega/sqrt(Q)`. Inverse: `g^{tt} = -Q^{1/2} + omega^2 Q^{-1/2}/(r^2 sin^2 theta)`, `g^{t phi} = -omega Q^{-1/2}/(r^2 sin^2 theta)`, `g^{phi phi} = Q^{-1/2}/(r^2 sin^2 theta)`, `g^{rr} = Q^{-1/2}`, `g^{theta theta} = Q^{-1/2}/r^2`. Verify these against generic inversion of FOORT's `g_dd` in M1. If the generic tables prove inaccurate near the centers/ring (M6), the fallback design is a hybrid: only `Q` and `omega` (or only the ring integral part of `omega`) are tabulated and the inverse metric is assembled in the shader from them (see M6 decision gate).
2. **Mass and units.** `M_ADM = (3P + q0 - P^3)/2 = 24` for `P = 2, q0 = 50`, independent of `lambda` (check numerically from `g_tt ≈ -1 + 2M/r` in M1). Shader works in metric coordinates; the UI reports lengths and times in units of `M_ADM` so BH and fuzzball modes are comparable.
3. **Validity of `lambda`.** Requires `q0^2/(1-(1-3P^2)lambda)^2 - 4P^6 > 0` (FOORT checks) and `Q > 0` everywhere on the grid; check at bake time and refuse to render otherwise.
4. **`lambda = 0`.** Separate class (FOORT's formula divides by zero). Near-horizon geometry is AdS2 × S2 with `Q^{1/2} -> L^2/r^2`, `L^2 = 4 sqrt(P^3 (q0 - P^3))`. In `x = log r` the horizon is at `x -> -inf`; terminate at `r < r_cut` (configurable). Analytic test: static spherical, so the critical impact parameter is `b_c = min_r r sqrt(Q(r))` (from `b^2 = g_phiphi/(-g_tt)` at the equator).
5. **Small `lambda`.** Deep throat: rays entering it return after a delay that grows as `lambda -> 0` (huge `|dt|`) with tiny `g`. In `log r` the number of steps grows only logarithmically. The `lambda -> 0` limit should be visually continuous outside the throat region (M6 test). float32 `dt` values of 1e5–1e6 M lose sub-M precision; irrelevant for noise sampling, but note it.
6. **The D0 ring lies in the equatorial plane** at `r = R`: the disc crosses a (4D) singularity. Terminate rays near it; the emission there is deep in the throat and strongly redshifted, so impact should be small — verify and report.
7. **D6 centers are on the axis** at `r = l/2`, `theta = 0, pi` — corners of the `(x, theta)` grid. Expect the largest table errors there; quantify in M6.
8. **Manko–Novikov.** Exponential factors with `1/R^n` (`R = sqrt(x^2 + y^2 - 1)`) blow up near the horizon equator; keep the termination radius safely outside and test float32 overflow in the tables; the octopole breaks equatorial symmetry (use full `theta in [0, pi]` tables; disc still placed at `theta = pi/2` as in FOORT).
9. **Johannsen**: fine; horizon at the Kerr value.
10. **FOORT's crossing method** (post-step position, threshold band) differs from interpolation by O(step); use the parity flag for comparisons, interpolation for the app.

---

## 5. Repository layout (proposed)

```
drmayerson.github.io/            (existing Pages repo; touch only foort-gpu/)
  foort-gpu/
    index.html                  the viewer (served as-is)
    style.css
    README.md  PROGRESS.md  DECISIONS.md  FOORT_GPU_STAGE1_PLAN.md
    js/
      main.js                   app bootstrap, backend selection, capability report
      metrics/                  registry.js common.js kerr.js johannsen.js mankoNovikov.js st3cr.js st3crBH.js
      bake/                     worker.js grid.js hermite.js validate.js
      fluid/                    generalCircularRadial.js johnsonSU.js
      camera/                   tetradCamera.js (static-observer constructor ports FOORT ViewScreen)
      gpu/                      backend.js (interface) backendWebGL2.js and/or backendWebGPU.js
                                pipeline.js (tile scheduling, progressive refinement, timing; backend-agnostic)
      noise/                    loader.js
      ui/                       controls.js presets.js perf.js
      ref/                      cpuTracer.js (double-precision reference, same algorithm; also importable from node)
    shaders/
      glsl/  and/or  wgsl/      per backend, structurally parallel:
        common.*                hermite lookup, RK4, step control, terminations, crossings
        trace.*                 tabulated-metric tracer
        trace_kerr_analytic.*   validation tracer
        display.*               emission + noise + tone mapping + debug views
    noise/                      noise fields (.bin + .json), each < 50 MB
    bench/index.html            standalone benchmark page (M0)
    tools/                      not loaded by the app
      foort_parity/             C++/CMake harness against a local FOORT clone (outside the repo) + cfgs + scripts
      noise/                    gen_placeholder_fft.py, build_inoisy.md/.sh, inoisy_to_contract.py
    dev/                        dev-only: package.json, vitest + playwright configs, tests/, golden data
                                (node_modules git-ignored)
```

JS modules under `js/` that contain pure math (metrics, bake, fluid, camera, ref) must not touch the DOM or any GPU API, so they run unchanged in node for Vitest.

---

## 6. Testing strategy (summary)

- **Level 0 — metric parity**: JS metric `g_dd` vs FOORT C++ `getMetric_dd` at ≥ 10^4 random points per metric/parameter set (excluding neighbourhoods of singularities): max relative difference ≤ 1e-12.
- **Level 1 — CPU reference tracer vs FOORT**: same configuration (RK4, `eps = 0.03`, `SimpleSquareMesh`, same camera), small images (64² to 128²): four-color classification agreement ≥ 99.5% of pixels; equatorial-emission intensities with `foortParityCrossing`: median relative difference ≤ 1e-6, and explain outliers.
- **Level 2 — GPU (float32) vs CPU reference (double)**: four-color agreement ≥ 99% (disagreements only along chaotic/boundary regions — show a map); emission intensity relative L1 ≤ 2%; critical-curve size within 0.5%.
- **Level 3 — analytic checks**: Schwarzschild shadow radius at the camera distance; Kerr critical curve (Bardeen) for a distant camera; agreement with `zwart-gat-camera`'s `kerrLens` escape directions; ST3Cr BH `b_c`.
- **Level 4 — tabulated vs analytic Kerr on GPU**: escape-direction angular difference ≤ 1e-3 rad for ≥ 99% of escaping pixels; emission relative L1 ≤ 0.5%.
- **Level 5 — user visual checkpoints** with screenshots and side-by-side comparisons with FOORT images.

All thresholds are initial targets; if one cannot be met, report numbers and a diagnosis at the checkpoint rather than loosening silently.

---

## 7. Milestones

### M0 — Scaffold, deployment, benchmark  *(small)*

Deliverables: folder skeleton (Section 5) on branch `foort-gpu-dev`, `dev/` tooling (Vitest + Playwright, optional `tsc --checkJs`), a local-serve script, capability page (WebGL2 + extensions, WebGPU adapter info and limits). A standalone **benchmark page** with the *same* minimal analytic-Kerr RK4 tracer (no disc, four-color debug image) implemented twice — WebGL2 fragment shader and WebGPU compute shader — reporting, for each backend, photon-steps per second, trace time at 512² and 1024², and whether the two images agree (pixel-difference statistics). It must run in browsers lacking one of the two backends and say which one is missing. Keep both implementations as small and parallel as possible; this code is throwaway-quality but must be fair (same algorithm, same step control, same tile sizes).

Tests: unit-test and Playwright runs succeed locally; WebGL2 and WebGPU benchmark images agree (they compute the same thing in float32; small differences only in chaotic regions); the app and benchmark load from `python3 -m http.server` with no build. With the user's approval, merge so the benchmark is live on GitHub Pages.

**CHECKPOINT M0**: user opens the deployed benchmark on their laptop(s) and phone and reports numbers for both backends. **Decide the Stage 1 backend (D2)** — default WebGL2 unless WebGPU is substantially faster on the user's main devices — and the default resolutions, tile sizes and step budgets (record in `DECISIONS.md`).

### M1 — Metric library in JavaScript + FOORT parity harness

Deliverables: JS ports of Kerr, Johannsen (`a`, `alpha13`; other params supported but default 0), Manko–Novikov (`a`, `alpha3`), ST3Cr (`P, q0, lambda > 0`, including the Simpson integral and a double-precision complete elliptic integral — Carlson `R_F` is fine), and the new ST3Cr BH (`lambda = 0`). Generic 4×4 circular-metric inversion and closed-form inverses where available. `validate()` for each. `tools/foort_parity/`: small C++ program linking FOORT's `Metric.cpp` (and dependencies) that dumps `g_dd` at given points to CSV.

Tests: Level 0 parity for several parameter sets per metric; ST3Cr closed-form inverse (Section 4.1) vs generic inversion; `M_ADM` from asymptotics; `lambda -> 0` convergence of the ST3Cr functions to the BH functions away from the throat; ST3Cr BH `b_c` computed.

**CHECKPOINT M1**: report tables of max errors, `M_ADM`, `lambda_max`, validity ranges found for `alpha13` and `alpha3`.

### M2 — CPU reference tracer (double) and FOORT golden images

Deliverables: `js/ref/cpuTracer.js` implementing exactly the GPU algorithm (Hamiltonian, FOORT camera, FOORT step control, terminations, axis reflection, both crossing modes) using direct (non-tabulated) metric evaluation, with derivatives by high-order finite differences in double. FOORT runs (via its executable and cfgs with `SimpleSquareMesh`) for: Kerr `a = 0` and `a = 0.94` (from `KerrExample.cfg`), Johannsen example, MN example, ST3Cr `lambda = 0.005` (`Test_FBdetail.cfg`). Parsers for FOORT `.dat` output. Golden data stored under `dev/tests/golden/` (keep it small; regenerate rather than commit large files).

Tests: Level 1. Note: FOORT integrates the second-order geodesic equation (Christoffel form) while we integrate Hamilton's equations; trajectories agree only to integration error, so compare at the image level and report the distribution of differences.

**CHECKPOINT M2**: side-by-side images (FOORT vs CPU ref) for each case + agreement statistics.

### M3 — GPU tracer, analytic Kerr path

Deliverables: backend implementation for the chosen API, `trace_kerr_analytic.*` + `common.*` shaders (RK4, step control, terminations, axis reflection, crossing detection with interpolation and parity mode), tiled progressive dispatch, per-pixel record storage, display pass with debug views (four-color, termination, steps, `g_1`, `dt_1`, crossings count). Camera UI (distance, inclination, field of view).

Tests: Level 2 against the CPU reference for Kerr `a = 0, 0.5, 0.94, 0.998`; Level 3 analytic checks (Schwarzschild shadow; Bardeen curve; `kerrLens` escape directions; face-on axis-crossing test with no seam). Performance numbers vs M0.

**CHECKPOINT M3**: user inspects four-color images, an axis-crossing view and the error maps.

### M4 — Tabulated metric path (all BH-mode metrics)

Deliverables: bake worker (grid, values, 4th-order FD derivatives, Hermite packing, validation), `trace.*` shader reading the five tables, mode/metric switching for Kerr, Johannsen, MN with live re-bake on slider change.

Tests: Level 4 (tabulated vs analytic Kerr) for several spins and grid sizes → choose default grid; FD-derivative tables vs analytic Kerr derivatives; Level 2 for Johannsen and MN against the CPU reference; bake timing.

**CHECKPOINT M4**: error-vs-grid-size table, chosen defaults, bake and trace timings; user tries the BH-mode sliders.

### M5 — Equatorial disc with static emission

Deliverables: fluid model port + ISCO search + 1D fluid table; Johnson-SU; crossings → intensity in the display pass with redshift power, fudge factor, max passes; tone mapping and colormaps; presets from FOORT cfgs.

Tests: fluid table vs FOORT's `GetFourVelocityd` at sample radii (via the parity harness); ISCO vs FOORT (and vs the analytic Kerr ISCO); image-level comparison with FOORT `EquatorialEmission` output for Kerr (`KerrExample.cfg`), Johannsen and MN (parity crossing mode), then with interpolated crossings (report the difference).

**CHECKPOINT M5**: side-by-side static disc images vs FOORT; user judges.

### M6 — Fuzzball mode (hardest milestone)

Deliverables: ST3Cr and ST3Cr-BH through the bake pipeline (`x = log r`), singularity terminations (centers, ring), `lambda` slider (log scale + `lambda = 0` switch), fuzzball presets (camera and Johnson parameters from `Test_FBdetail.cfg`), ISCO/disc-edge reporting for horizonless cases, `maxSteps` tuning.

Tests: Level 1–2 against FOORT/CPU reference at `lambda = 0.005` (four-color and emission); table-error maps concentrated near the D6 centers and the ring; qualitative comparison with *Fuzzball Shadows* Fig. 1 (four-color, several `lambda`); `lambda = 0` BH: shadow vs `b_c`; continuity sequence `lambda = 1e-2, 1e-3, 1e-4, 0` (difference maps outside the throat); step-count and timing statistics vs `lambda`.

**Decision gate inside M6**: if generic tables fail the Level 2 thresholds because of the centers/ring, implement the hybrid (tabulate `Q` and `omega`, or only the ring part of `omega`; assemble `g^{mu nu}` and derivatives in the shader; `M_D0` via in-shader Carlson `R_F` with analytic derivative) and/or a clustered `theta` mapping. Report before choosing.

**CHECKPOINT M6**: image sequences in `lambda`, error maps, timings; user judges physics plausibility.

### M7 — Time-dependent emission with slow light

Deliverables: noise-field loader (contract of Section 3.9), 3D texture, display-pass noise term with periodic time wrap, play/pause/speed, slow/fast light toggle, optional procedural-advection mode. `tools/noise/gen_placeholder_fft.py`: periodic (in `t`, `phi`; padded/clamped in `x`) anisotropic Gaussian random field via FFT, normalized to zero mean and unit variance, written in the contract format.

Tests: loader round-trip; field statistics in shader (mean/variance via readback); `dt` map sanity (direct image vs n = 1 image delay of order the photon-orbit time; deep-throat echoes in fuzzball mode); seamless loop at `t = T`.

**CHECKPOINT M7**: user watches the animated disc in Kerr and fuzzball modes, compares slow vs fast light.

### M8 — Production inoisy fields  *(can run in parallel with M5–M7)*

The agent builds the generator itself (D4, confirmed). Work outside the Pages repository (e.g. `~/foort-gpu-work/inoisy/`); commit only scripts, documentation and the final contract-format fields. Prefer a dedicated conda environment (HYPRE, an MPI implementation, HDF5 and h5py are available from conda-forge); on Windows use WSL. Ask the user before installing anything system-wide. Start with the plain C inoisy (`AFD-Illinois/inoisy`, a disc model in log-r/phi coordinates); use pynoisy only if a custom diffusion tensor (flow matched to a metric's fluid `Omega(r)`) is wanted later.

Deliverables: `tools/noise/build_inoisy.md` + script (exact versions, commands, environment file); a disc model run in `(t, log r, phi)` with periodic boundary conditions in `t` and `phi` (check/adjust the model file's boundary conditions); `inoisy_to_contract.py` (HDF5 → contract, normalization, float16); 1–3 fields with documented parameters (correlation lengths/times in units of M, grid, period `T`).

Tests: contract validation; periodicity check (field continuity across `t = T`, `phi = 2 pi`); visual comparison with Lee & Gammie example frames.

**CHECKPOINT M8**: user approves the fields (physics parameters).

### M9 — Polish, performance, documentation  *(Stage 1 acceptance)*

Deliverables: progressive-quality interaction (coarse while dragging), performance overlay, presets for both modes, URL-hash state for sharing views, error handling (missing GPU features, invalid parameters, bake failures), README (user guide + developer guide: "how to add a metric"), `DECISIONS.md` complete. With the user's approval: merge to the Pages branch and add a link to `foort-gpu/` in the root `index.html` in the style of the existing entries.

Acceptance (initial targets, revise after M0): on a laptop with a discrete GPU, a 1024² Kerr re-trace ≤ 0.3 s; on integrated graphics ≤ 1 s; drag preview (256²) ≤ 50 ms; display pass ≥ 60 fps at native resolution; fuzzball at `lambda = 1e-3` ≤ 3× the Kerr trace time. "Add a metric" demonstrated by adding one trivial metric (e.g. Reissner–Nordström or Schwarzschild in isotropic coordinates) touching only `js/metrics/` and the registry.

**CHECKPOINT M9 = Stage 1 done.**

### M10 (optional) — second backend

Implement the backend not chosen at M0 behind the same interface (port the structurally parallel shaders; no physics or UI changes). If WebGL2 was chosen, this is the WebGPU backend and is a natural first step of Stage 2; if WebGPU was chosen, this is the WebGL2 fallback for wider device coverage. Acceptance: both backends produce matching images (same tolerance as M0) and the app picks the best available backend automatically, with a manual override.

---

## 8. Performance budget notes

- Expected cost: ~300–800 FLOP per RK4 step (analytic Kerr) and ~80 texel loads per step on the tabulated path (5 tables × 4 texels × 4 RK stages); typical 300–1000 steps per ray at `eps = 0.03`; pixels near the photon ring and deep throats dominate (SIMD divergence). Measure, don't assume (M0, M3, M4).
- Per-pixel record: ~16 floats (64 MB at 1024²). WebGL2: four RGBA32F render targets (check `MAX_DRAW_BUFFERS` ≥ 4, guaranteed by the spec, and available GPU memory on phones). WebGPU: check `maxStorageBufferBindingSize`, request higher limits where available, otherwise split buffers or reduce resolution.
- Levers, in order: lower trace resolution + upscaling; tile/pixel ordering; better integrator; analytic far field for large `r`; table packing (texture arrays, half precision for derivative channels if accurate enough).

---

## 9. Out-of-scope reminders

No moving observers, no thrust, no cubemaps, no volumetric emission, no polarization in Stage 1. Keep the code structured so Stage 2 can add them (Section 1.3).

---

## 10. Decision log (proposed defaults — to be confirmed by the user)

| ID | Decision | Proposed default | Alternatives |
|---|---|---|---|
| D1 | Repo and tooling | **Confirmed:** folder `foort-gpu/` in `drmayerson.github.io`, plain ES modules + JSDoc, no build step; dev tooling isolated in `foort-gpu/dev/` | — |
| D2 | Graphics API | **Confirmed at CHECKPOINT M0 (2026-11-03): WebGL2** for Stage 1 behind a backend interface; WebGPU added as M10 or in Stage 2 (benchmark numbers in `PROGRESS.md`) | WebGPU-first if > ~1.5× faster on the user's main laptop |
| D3 | Radial variable for Johnson envelope | **Confirmed:** FOORT's coordinate `r` (parity with FOORT); noise sampled at `log(r/M_ADM)` with the same `r` | circumferential radius as a later option |
| D4 | Noise generation | **Confirmed:** placeholder FFT field in M7; the agent builds inoisy and produces real fields in M8 | one field per metric matched to its fluid `Omega(r)` via pynoisy (later) |
| D5 | Fixed fuzzball charges | `P = 2`, `q0 = 50` (FOORT `Test_FBdetail.cfg`, *Fuzzball Shadows*) | other |
| D6 | Johannsen/MN parameters exposed | Johannsen `a, alpha13`; MN `a, alpha3` | expose all Johannsen parameters in an "advanced" panel |
| D7 | Redshift convention | FOORT's (`p_t = 1`, observer at infinity) in Stage 1 | camera-frame redshift |
| D8 | UI language | English | Dutch / both |
| D9 | Integrator | RK4 + FOORT step heuristic (parity first) | RK45 after M5 if tests allow |
