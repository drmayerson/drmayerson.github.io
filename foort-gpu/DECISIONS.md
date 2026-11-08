# FOORT-GPU decisions

Format: date — decision — alternatives — reason. Plan-level decisions D1–D9 are in
`FOORT_GPU_STAGE1_PLAN.md` Section 10; this file records their confirmation and every
non-trivial implementation choice.

## Confirmed by the user before M0

- 2026-11-03 — **D1**: folder `foort-gpu/` in `drmayerson.github.io`, plain ES modules + JSDoc, no build step, dev tooling in `foort-gpu/dev/`.
- 2026-11-03 — **D3**: Johnson-SU envelope in FOORT's coordinate `r`; noise sampled at `log(r/M_ADM)`.
- 2026-11-03 — **D4**: placeholder FFT noise in M7; the agent builds inoisy in M8.

## Decided at CHECKPOINT M0

- 2026-11-03 — **D2: WebGL2** for Stage 1 (user: "Yes, WebGL2"). — Alternative: WebGPU-first. — Reason: the benchmark's per-ray GPU cost is equal in both backends: Chrome/AMD integrated GPU, WebGPU 1.0–1.1× the speed of WebGL2; Firefox 158, WebGL2 355 ms wall vs WebGPU 382 ms GPU at 1024². Firefox's WebGPU adds about 75–100 ms of latency per tile wait, which makes wall-clock time 4× slower. WebGL2 also has wider reach. All GPU access stays behind `js/gpu/backend.js`; WebGPU is M10 / Stage 2.

## Still open (agent defaults in use until the user confirms)

- Default trace resolution 1024², drag preview 256², tile 256 px (a 256² tile at about 760 steps/px runs in about 25 ms on the AMD laptop, well under the watchdog; tiles of 64 px or smaller lose 2–3× to synchronization).
- Step budgets: `maxSteps` 5000 for BH mode and 20000 for fuzzball mode (plan defaults; to be tuned in M6).
- D5–D9 remain on their proposed defaults.

## M0 implementation choices

- 2026-11-03 — Benchmark integrates in `x = log(r - r_h)` with BL `r` recovered as `r_h + e^x`, Hamiltonian `H = W / (2 Sigma)` in Carter form, keeping the `W dSigma` terms (exact even off-shell). — Alternatives: plain `r` (far too many steps at r = 1000 with FOORT's step rule), dropping the `W` terms. — Reason: matches the plan's grid coordinate (Section 3.4) so step counts are representative of the real app.
- 2026-11-03 — Benchmark camera built in JS double precision with `TetradCamera.fromStaticObserver` (port of FOORT `ViewScreen`), passed to both shaders as `mat4` vielbein + `mat4` g_dd; per-pixel flat momentum and `p_t = 1` normalization done in float32 in the shader. — Alternative: per-pixel momenta precomputed on the CPU. — Reason: keeps the general tetrad camera of Section 1.3 and avoids a per-pixel upload.
- 2026-11-03 — Benchmark fairness: one draw (WebGL2, scissored full-screen triangle into one RGBA32F target) or one dispatch+submit (WebGPU, 8×8 workgroups, storage buffer) per tile, waited on per tile (fence polling via `MessageChannel` yields / `onSubmittedWorkDone`); same tile size; one warm-up run; median of N runs; GPU time from timer/timestamp queries where available, else wall-clock only. — Reason: the plan asks for the same algorithm, step control and tile sizes; per-tile waiting is what the app will do to stay under the GPU watchdog.
- 2026-11-03 — Termination codes: 1 horizon (`r < r_h (1 + 0.01)`), 2 boundary sphere (`r > 1.01 r_cam`), 3 timeout, 4 NaN/Inf. Four-colour quadrant computed on the CPU from the escape `(theta, phi mod 2 pi)` with FOORT's `FourColorScreenDiagnostic` rule.
- 2026-11-03 — Pixel convention: pixel centres, `unit = (i + 0.5)/N` (both backends), `beta` increasing upwards. FOORT's `SimpleSquareMesh` convention will be matched exactly in M2 (parity runs).

## M1 implementation choices

- 2026-11-03 — Node.js installed with `winget install OpenJS.NodeJS.LTS` (v26.13.0, system-wide MSI), at the user's choice. `dev/node_modules` lives in the Dropbox folder, so Dropbox syncs it; it is git-ignored.
- 2026-11-03 — **JS metric interface**: `g_dd(r, theta)` and `g_uu(r, theta)` take the true `r`; there is no log-r option in the metrics, because the grid coordinate is the bake's job. Each returns the five circular components. This makes circularity structural. The parity harness checks it from the FOORT side: every off-block component FOORT returns is exactly 0.
- 2026-11-03 — **Ports are verbatim**: the same formulas, the same operation order, `Math.pow` wherever FOORT uses `pow`, FOORT's 17-point doubled Simpson sum for ST3Cr ω_φ, and `std::comp_ellint_1` replaced by Carlson `R_F(0, 1 - k², 1)`. — Alternative: algebraically simplified or more stable forms. — Reason: parity first (plan Section 0); improvements come after parity is established.
- 2026-11-03 — **Closed-form inverses are used for all five metrics.** Generic inversion stays as a fallback for future metrics. — Reason: near the MN horizon, the generic t–φ inversion loses up to 4.7e-10 (scaled) against FOORT, while the closed forms stay ≤ 3e-14.
- 2026-11-03 — **Parity measure** has two parts:
  - **raw**: component-wise relative difference;
  - **scaled**: for g_tφ, the difference divided by √|g_tt g_φφ|; for diagonal components, the same as raw.

  The 1e-12 target is applied to the scaled measure, on points where FOORT's own metric is valid. — Reason: g_tφ is often the small remainder of large cancellations. At the worst ST3Cr λ = 1e-4 point, ω_ab has condition number 1.5e7 and the ring integral cancels it by another ~1e3. The double-precision rounding floor in raw relative terms is therefore ~1e-6, and FOORT and JS differ there only through last-bit libm differences. Raw numbers are still reported. **Accepted by the user at CHECKPOINT M1** (2026-11-03, "Accept both").
- 2026-11-03 — **Manko–Novikov termination, decided by the user at CHECKPOINT M1** (user: "Option (a): r_valid + 1%"): MN rays terminate at r_term = max(r₊(1 + 0.01), 1.01 × r_valid(a, α3)). Here r_valid is the edge of the CTC / non-finite band outside the horizon, found by the sampled `validityRadius` scan at bake time. M2 parity runs use the same r_term on the FOORT side, via `Epsilon_Horizon = r_term / r₊ − 1`. The α3 slider is [−1, 1]. — Alternatives: (b) FOORT's 1.01 r₊, which lets rays enter the CTC band; (c) restrict α3 to the tiny range where the band lies inside 1.01 r₊.
- 2026-11-03 — **Johannsen α13 slider: (−r₊³(a), 10]**, accepted by the user at CHECKPOINT M1 ("Accept both"). The lower end follows the spin; the validity scan found no upper bound up to 100.
- 2026-11-03 — **Johannsen α13 slider revised to [−0.99 r₊³(a), 10]** by the user ("Lower end −0.99 r₊³"), after the correction in `PROGRESS.md`. Closer to −r₊³, a thin CTC band can reach beyond the 1.01 r₊ termination for spinning holes (the worst case found is 0.9944 × −r₊³ at a = 0.9). Johannsen keeps FOORT's 1.01 r₊ termination. — Alternative: MN-style termination 1% outside the band, with the full range kept.
- 2026-11-03 — `ST3CrBH` (λ = 0) reports `horizon: {kind: 'none'}`. The horizon is at base r = 0, i.e. x → −∞ in `x = log r`. Rays will be cut at a configurable `r_cut` (M6).
- 2026-11-03 — Validity checks (`validate()`, `validityRadius()`) test, at sample points: finite components, Lorentzian signature (g_rr > 0, g_θθ > 0, det(t–φ block) < 0), and no CTCs (g_φφ > 0). An ST3Cr point with Q ≤ 0 shows up as non-finite.

## M2 implementation choices

- 2026-11-03 — **CPU reference = the GPU algorithm in double precision** (`js/ref/cpuTracer.js`):
  - Hamiltonian in (t, x, θ, φ) on the five table functions G0 = g^tt, G1 = g^tφ, G2 = sin²θ g^φφ, G3 = g^xx, G4 = g^θθ;
  - ∂_x and ∂_θ by 4th-order central differences, step 1e-3;
  - FOORT RK4 with the adaptive step rule, applied to dx/dλ, dθ/dλ, dφ/dλ.

  Every FOORT-specific behaviour is a switch, so "parity" and "app" modes share one code path:

  | switch | parity mode (FOORT) | app mode |
  |---|---|---|
  | `mesh` | i/(N−1) | (i+0.5)/N |
  | `radial` | log r | log(r − r₊) |
  | `axis` | continue, ThetaSingularity at 1e-6 | reflect |
  | `crossing` | post-step position, threshold band | linear interpolation in λ |
  | `singularity` | coordinate distance √((r−r_s)² + (θ−θ_s)²) | Euclidean base-space distance |

  The M2 comparisons use FOORT's mesh in both modes, so the same pixels are compared.
- 2026-11-03 — **FOORT parity runs** use FOORT's own unmodified executable (`FOORT/bin/FOORT.exe` of the clone, commit `cfff2d5`) with generated configs (`dev/scripts/foortCases.mjs`). Settings:
  - integrator **RK4** (the example configs use Verlet), StepSize 0.03, SmallestPossibleStepsize 1e-12;
  - `SimpleSquareMesh` 128²;
  - BoundarySphere 1.01 r_cam;
  - MN `Epsilon_Horizon` = r_term/r₊ − 1 = 0.122 (decision a; FOORT's own example uses 0.08);
  - cameras and emission parameters from the example configs.

  libconfig quirk found: a real-valued setting written without a decimal point (e.g. `gamma = -2`) is silently ignored by FOORT, which falls back to its default. The generator forces a decimal point on every real value.
- 2026-11-03 — **Horizon termination counts intermediate RK4 stages.** If any stage or the step end lies inside the termination radius, the ray is captured. — Reason: in x = log r (parity mode), p_r ~ 1/Δ diverges at the horizon. A stage that lands inside r₊ returns garbage; before this fix, 43 Kerr a = 0 rays from inside the shadow "escaped" to r ~ 1e19. FOORT integrates dr/dλ, which stays finite, and ends such rays just inside r₊. In app mode (x = log(r − r₊)) the horizon is at x = −∞ and this never triggers in practice.
- 2026-11-03 — The metric functions are evaluated at |θ| (axis reflection) and clamped to [1e-9, π − 1e-9]. Finite-difference stencils may straddle the axis, where the formulas are 0·∞ (G2) or NaN (ST3Cr's ring term uses sin θ directly).
- 2026-11-03 — **Emission-intensity parity (part of Level 1) is deferred to M5**, where FOORT's `GeneralCircularRadialFluid` (about 450 lines: ISCO search, plunge, FD Christoffels) is ported anyway. FOORT's intensities are already in the M2 run outputs and golden files, so M5 does not need new FOORT runs. **Flagged at CHECKPOINT M2.**
- 2026-11-03 — The relative constraint drift is reported as |H| / Σ|terms of H|, on escaping rays only. Captured rays end at a coordinate singularity, where the terms of H diverge.
- 2026-11-04 — **CHECKPOINT M2: ST3Cr diagnosis accepted, M2 closed** (user: "Accept, close M2"). The ST3Cr λ = 0.005 four-colour agreement of 94.7% (below the 99.5% target) is accepted as a step-size convergence limit shared by both codes, not a tracer discrepancy. No ε = 0.01 convergence study is run. The four BH cases meet the target in both modes.
- 2026-11-04 — **M3 GPU tracer structure.**
  - The trace program is `shaders/glsl/<metric>.glsl` + `common.glsl`, concatenated at load time after the `#version`/precision header.
    - The metric file provides `radiusOf`, `geodesicRHS`, `hamiltonianRel`, `crossingRedshift` and `nearSingularity`.
    - `common.glsl` holds the camera, RK4 + FOORT step, terminations, crossings and the record.
    - M4's tabulated `trace.glsl` implements the same five functions.
  - **Record** (4 × RGBA32F, 16 floats):
    - `(termCode + 16·passes, steps, θ_end, φ_end mod 2π)`;
    - then three crossings `(r, φ mod 2π, dt = t − t_cam, g)`, with r = 0 meaning no crossing.
    - With "record |H|" on, the third crossing is replaced by `(|H|_rel, t_end, 0, 0)`.
  - **Progressive refinement:** strides 4 → 2 → 1 (8 for previews of large images). Each level is traced as its own compact image of ceil(N/s)² rays, with its own record set. The display shows, per pixel, the finest level that has traced it (steps > 0 after a clear).
    - **Reason:** a strided pass over the full image costs as much as a full trace, because a SIMD wave runs as long as its longest ray, discarded lanes included. Measured: 3× a single pass with discards, 1.3× with compact levels.
    - Coarse levels are not reused by finer ones (1/4 + 1/16 extra rays), which keeps them independent.
  - **Tiles:** about 256² rays each, sized adaptively towards about 30 ms per tile, traced centre-out.
  - **Interaction:** while a slider is dragged, only one coarse level is traced; on release, the full sequence runs.
  - The capability page moved from `index.html` to `caps.html`; `index.html` is now the viewer.
- 2026-11-04 — **Pole-distance polar coordinate on the GPU.** The float32 state holds δ = min(θ, π − θ) and a hemisphere sign, with p_δ = ±p_θ.
  - Crossing the axis is δ → −δ (φ += π, p_δ → −p_δ) at both poles; crossing the equator flips the hemisphere.
  - **Reason:** near θ = π, float32 spacing is 2.4e-7. Rays passing close to the south pole (the α ≈ 0 column of every image) came out wrong by up to 0.5 rad. Near θ = 0 floats are dense, hence the asymmetry.
  - Equatorially symmetric metrics use their θ formulas with θ := δ.
  - **M4 tables:** look up θ = δ or π − δ. The hemisphere sign multiplies the θ-derivative.
  - The CPU reference (double) keeps θ.
- 2026-11-04 — **Axis step floor.** In FOORT's step rule, min(θ, π − θ) is floored at 1e-3 when axis reflection is on: app mode on the GPU and in the CPU reference; parity (`axis: 'foort'`) keeps 0.
  - **Reason:** with h₂ ∝ θ, a ray aimed straight at the axis (p_φ = 0) takes geometrically shrinking steps and never crosses it. FOORT ends such rays with ThetaSingularity.
  - With the floor, the RK4 step across the axis moves θ by about 3e-5 rad, and the equations are smooth there.
  - **Consequence:** the M2 app-mode numbers would change slightly for rays passing within 1e-3 rad of the axis. They were not rerun.
- 2026-11-04 — **Redshift placeholder in M3.** g at a crossing is computed for a prograde Keplerian emitter on the equator, with g = 0 inside the photon orbit, so that the g₁ debug view and the record layout can be tested. M5 replaces it with FOORT's `GeneralCircularRadialFluid`.
- 2026-11-04 — **CHECKPOINT M3 accepted** (user: "Accept, merge and push"). The viewer (analytic Kerr) is merged to `main` and published at `drmayerson.github.io/foort-gpu/`, with no link from the root `index.html` (that waits for M9).
- 2026-11-04 — **M4 metric tables** (`js/bake/bake.js`, `shaders/glsl/trace.glsl`).
  - **Functions and grid:** G0…G4 on a uniform (x, θ) grid, x = log(r − r₊), from the termination radius to r_max.
    - r_max is 1.1 × 10ⁿ ≥ the boundary sphere, so camera changes rarely force a re-bake.
    - θ covers [0, π/2] for equatorially symmetric metrics (Kerr, Johannsen, MN with α3 = 0) and [0, π] otherwise (MN). The GPU's pole-distance state indexes it directly.
  - **Derivatives:** 4th-order finite differences on the grid; one-sided in x at the ends, mirror ghost nodes in θ (every G_k is even about the axis, and about the equator when symmetric).
  - **Interpolation:** bicubic Hermite, with 4 RGBA32F texels per function per corner, read by `texelFetch`. The five functions of a node sit in adjacent rows of one 2D texture.
  - `js/bake/hermite.js` is the same lookup in JS, for the tests and studies.
- 2026-11-04 — **The tables store residuals over an analytic background.** The background (functions of r only, mass M = M_ADM, regular for r > r0):
  - B0 = −(1 + 2M/r + 4M²/r²), B1 = 0, B2 = B4 = 1/r², B3 = r/((r + 2M)((r − r0)² + M²)).
  - **Reason:** float32 storage of G itself limited rays to about 6e-5 rad at any grid size. At large r, g^tt p_t² and g^xx p_x² cancel down to about b²/r², so the 6e-8 relative storage rounding of G0 ≈ −1 is not small against the geometry. With the same grid stored in float64, rays agree to 3e-8.
  - With residuals, float32 tables reach 2e-8 (double-precision tracer, `dev/scripts/m4TableRays.mjs`).
  - **Why this background:** it is metric-independent, so the Kerr table still carries all of the spin structure and Level 4 remains a real test. It is regular at the horizon and matches the leading large-r behaviour.
  - M6 may need a different background for the fuzzball; it is one shader function.
- 2026-11-04 — **Default table 512 × 128** (x nodes × θ nodes per hemisphere). In the Level 4 study the escape-direction accuracy does not depend on the grid between 256 × 128 and 1024 × 256, because the float32 path dominates. 512 × 128 has the best redshift accuracy for its cost, with a 60–190 ms bake in the worker. The viewer offers 256 × 128 to 1024 × 256.
- 2026-11-04 — **Equatorial emitter table (redshift placeholder):** 1/u^t and Ω of prograde circular orbits on its own 2048-node x grid, interpolated linearly. 1/u^t goes to 0 continuously at the photon orbit, whereas u^t diverges there and spoiled the interpolation. It is replaced by FOORT's fluid model in M5.
- 2026-11-04 — **RK4 stages as a loop** in `common.glsl`, with one call site of `geodesicRHS`. With four call sites, ANGLE/D3D inlined the tabulated lookup four times and the shader took about 34 s to compile; now about 1.5 s. Results of the analytic path are unchanged (the M3 Level 2 rerun is identical).
- 2026-11-04 — **Interaction:** while a metric slider is dragged, a 128 × 64 table is baked and only the coarse level is traced; on release, the full table and the full image follow. Bakes run in a module Web Worker (`js/bake/worker.js`), cached by key (6 entries), and a newer request supersedes an older one.
- 2026-11-04 — **Test web server: `dev/scripts/serve.mjs` (Node)** instead of Python's `http.server`, in the Playwright config and `gpuRunner.mjs`. Python's server intermittently left ES-module requests unanswered when two test browsers loaded the app at once; the page then stayed on "starting…". With the Node server, eight consecutive full runs pass. `dev/serve.sh`/`.ps1` (Python) remain for manual use.
- 2026-11-04 — **Viewer startup stages:** the status line names each stage, and the shader files are fetched in parallel (the user asked how long "starting…" should last).
- 2026-11-04 — **Table axis nodes are evaluated at θ = 1e-4** (was 1e-6). Manko–Novikov's prolate coordinate loses digits in 1 − cos²θ closer to the axis. The even-function error at the node, about 1e-8 relative, is below float32.
- 2026-11-04 — **CHECKPOINT M4: tabulated-trace speed accepted for now; optimisation deferred to M9** (user: "Yes, defer to M9"). On the AMD integrated GPU, the tabulated trace is 4–8× slower than closed-form Kerr (0.45 s at 512², 1.9 s at 1024²), limited by RGBA32F texel fetches. M9 should try half-float derivative channels (fewer bytes per node) and an analytic far field.
- 2026-11-04 — **M5 fluid model and emission.**
  - **Fluid:** `js/fluid/generalCircularRadial.js` ports FOORT's `GeneralCircularRadialFluid` in the true r.
    - Christoffels are 4th-order finite differences with h = 1e-4 r (FOORT uses central differences with h = 1e-7 in its coordinate).
    - The ISCO bisection runs in log r with FOORT's bracket of 2 × 1e-7, and FOORT's default bounds (r_h, 10 r_h).
    - The four-velocity is a vector, so the redshift does not depend on FOORT's log-r coordinate.
  - **Fluid table:** (1/u^t, u^r/u^t, Ω) at 2048 nodes, linear in x. It is shared by both GPU tracers (`common.glsl`) and baked in the worker under its own cache key.
  - **Redshift:** uses the photon's p_r (p_x dx/dr). For interpolated crossings the momenta are interpolated too.
  - **Emission:** computed in the display pass from the stored crossings, so emission parameters, exposure, tone map and colour map only redraw.
  - **Removed:** the M3/M4 Keplerian placeholder (`keplerOrbit`, the equatorial table).
- 2026-11-04 — **Equator crossings on the GPU are detected by the hemisphere flip** of the pole-distance state, not by a sign change of the equator distance. In float32, δ = π − δ₁ can round to exactly π/2 after the flip, and the sign test then missed the crossing (an isolated dark pixel in the disc images). The interpolation fraction is |z₀| / (|z₀| + |z|).
- 2026-11-04 — **Level 1 emission criterion:** FOORT prints intensities with 6 decimals, so the plan's "median relative difference ≤ 1e-6" cannot be tested on its output. The report gives the median relative difference (4e-5 in parity mode) and the fraction within FOORT's rounding.
- 2026-11-04 — **CHECKPOINT M5 accepted; merged to `main` and pushed** (user: "Accept, merge and push"). Left open for later: a 4th crossing slot, instrumenting FOORT for the Manko–Novikov strong-field difference, and the α3 slider range [−1, 1].
- 2026-11-05 — **M6 horizonless tables:** x = log r (r0 = 0) from the metric's inner cut to r_max. The background over which the residuals are stored is bounded at small r for horizonless metrics:
  - B0 = −(1 + 2M(r + 2M)/(r² + M²)) and B2 = B4 = 1/(r² + M²); these agree with the horizon background up to O(M²/r²) at large r;
  - with the 1/r² forms, the residual inside the fuzzball would be ~30× larger than G itself (g^tt ~ −L²/r² with L² = 73 ≪ 4M² = 2304);
  - the shader selects the form by r0 > 0.
- 2026-11-05 — **Bake validity from g^uu** (`pointValidityInverse`): the signature and CTC tests on the inverse metric are equivalent to those on g_dd. This saves one metric evaluation per node: the ST3Cr bake goes from 0.7–0.85 s to 0.3–0.4 s in Node (0.7 s in the browser worker, still over the 0.5 s budget; ST3Cr's Simpson integral dominates, left for M9).
- 2026-11-05 — **ST3Cr terminations scale with the structure:** inner cut and singularity distance are both 0.005 × min(l/2, R) (8e-4 at λ = 0.005, close to FOORT's 1e-3). FOORT's absolute 0.01 / 0.001 would swallow the whole structure for λ ≲ 1e-3 (R = 0.0094 at λ = 1e-4).
  - The singularity distance is Euclidean in the base R³ (as the CPU reference's 'euclid' mode). FOORT measures it in coordinate space (r, θ).
  - The λ = 0 black hole stops at r_cut = 1e-3 (4e-5 M_ADM). Rays below it are deep in the AdS₂ throat and never return.
  - Views can override both (`rInner`, `singEps`), for FOORT comparisons.
- 2026-11-05 — **Camera lengths in the UI are in units of M_ADM** (plan gotcha 2): 1 for the BH metrics, 24 for ST3Cr. Test_FBdetail's r = 250, screen 150 appear as 10.417 M and 6.25 M.
- 2026-11-05 — **Circular-orbit bands** are reported for horizonless metrics, alongside FOORT's ISCO bisection, which is kept for parity (plan Section 3.9).
  - ST3Cr at λ = 0.005 has two stable bands: r < 0.31 inside the cap, and r > 18.5.
  - FOORT's bisection between 0.05 and 1000 finds 18.558; inside it the fluid plunges with the ISCO E and L, the inner stable band included.
- 2026-11-05 — **Fuzzball max steps 10000** (FOORT's Test_FBdetail value, the default when the metric changes to ST3Cr; BH mode keeps 5000).
  - At 128², λ = 0.005: 7% / 3% of rays time out at 5000 / 20000 steps.
  - 20000 at 512² takes several minutes for small λ.
- 2026-11-05 — **Trace tiles start with a 32² probe** and are re-cut within a level when a tile takes more than 2× the 30 ms target. The M3 tiling started with 256² rays per tile: a 128² fuzzball tile at 10⁴ max steps then ran for seconds, the OS GPU watchdog reset the device, and the page crashed (λ = 1e-3, 512²).
- 2026-11-05 — **Constraint projection onto H = 0 before every step, on by default for horizonless metrics** (view option `project`, uniform uAux.w; also in the CPU reference). The plan asked for it only if drift matters (Section 3.5), and it does.
  - Rays that dive into the throat lose the null constraint at ε = 0.03: relative |H| at the end has a p99 of 1.0 on the GPU and on the CPU (λ = 1e-4).
  - Their momenta on exit give blueshifts g ~ 10 at r ~ 1.5. One such pixel outshines the rest of the image (I = 275 vs a total of 12); FOORT shows the same (one pixel holds 96% of its λ = 0.005 image).
  - The projection rescales (p_x, p_δ) by sqrt(−B/A), from 2H = p_μ ẋ^μ = B + A at the start of the step: one extra metric evaluation, the RK loop gets a fifth iteration.
  - GPU |H| after it: median 1.5e-7, p99 4e-5.
  - BH views keep the M3–M5 integrator unchanged.
- 2026-11-05 — **CHECKPOINT M6 decisions (user).**
  - **Table size:** the fuzzball keeps the default 512 × 128 table; no hybrid. The user: "don't worry about the GPU vs CPU comparison for geodesics that are very near the centers (the chaotic regime) - small numerical errors can compound there and give different results, this is normal and not to worry about ... stay with defaults".
  - **Crossings beyond 3:** kept as they are, with a note in the emission legend in fuzzball mode. The user: "leave it. I think ~90% or higher emission should be ok. Add a small note about this somewhere on the UI." Measured shares are 93% at λ = 1e-4 but 45–48% at λ = 0.005–0.05 (PROGRESS, CHECKPOINT M6); the note says so.
  - **Merge:** M6 merged to `main` and pushed (user: "Merge and push").
- 2026-11-05 — **M7 placeholder noise field** (`tools/noise/gen_placeholder_fft.py`, `noise/placeholder.{json,bin}`):
  - Gaussian random field from white noise filtered with a Gaussian spectrum. Periodic in t and φ through the FFT; in x it is generated on a doubled grid and cropped (not periodic).
  - Shape 64 × 96 × 128 (t, x, φ), float16, 1.6 MB.
  - Period T = 200 M; x = log(r/M) from −6 to 7, which covers the fuzzball's emission at r ~ 1e-3 to 0.2 M as well as the BH discs.
  - Correlation time 8 M, correlation lengths 0.4 in log r and 0.35 rad in φ.
  - Small enough to commit; production fields follow in M8.
- 2026-11-05 — **Noise on the GPU:** R16F 3D texture, hardware linear filtering, repeat in φ and t, clamp in x, texel centres on the samples (`noiseTexCoord` / `sampleNoise` is the same rule in double, for the tests). Each crossing gets exp(σ_n X − σ_n²/2), with X at τ = t_obs + dt_k (slow light; fast light uses dt_k := 0), x = log(r_k/M_ADM), φ_k. Default σ_n = 1.
- 2026-11-05 — **Display binds only the levels of the current trace** (at most 3, finest first: 12 texture units) instead of all four levels (16 units, the WebGL2 minimum). This frees units for the noise field (unit 12) and the fluid table (unit 13, Ω for advection). The backend learns the levels from `clearRecords(levels)`.
- 2026-11-05 — **Procedural advection (optional, default off; plan Section 3.9):**
  - Two copies of the field, rotated with the fluid's Ω(r) since the last reset of their phase (period D, offset D/2), are crossfaded with triangular weights.
  - The blend is divided by sqrt(w_a² + w_b²) to keep unit variance.
  - D defaults to 40 M. The placeholder field has no flow of its own; with advection the pattern shears into spiral streaks.
- 2026-11-05 — **Time controls:** play (default on), speed in M per second (default 20), slow/fast light (default slow), σ_n, advection. t_obs is not wrapped, so the advection phases stay continuous; texture repeat makes the field periodic. Time, light, σ_n and advection changes only redraw.
- 2026-11-05 — **Checkpoint animations are not committed:** the GIFs (about 4 MB each) are built by `dev/scripts/m7Frames.mjs` and `tools/noise/frames_to_gif.py` into the git-ignored `tools/foort_parity/build/`.
- 2026-11-05 — **CHECKPOINT M7 accepted** (user: "Looks right"). Advection stays off by default; merged to `main` and pushed (user: "Merge and push").
- 2026-11-05 — **M8 build environment: MSYS2 UCRT64 + Microsoft MPI** (user's choice, over WSL and a Python reimplementation). pacman installed HYPRE 2.33, HDF5 2.2 (serial), GSL 2.8 and the MS-MPI 10.1 headers into `C:\msys64`; the user installed the MS-MPI runtime. Serial HDF5 has no MPI-IO, so inoisy runs on one rank (`hdf5_utils.c` with USE_MPI=0).
- 2026-11-05 — **inoisy model `foort_logr`** (`tools/noise/inoisy_foort/`): general_xy's physics (Lee & Gammie 2021) on (t, log r, φ), periodic in t and φ.
  - The current inoisy disc model is Cartesian and periodic in t only. The old `disk_logr` no longer links with inoisy's `main.c` and lacks general_xy's spiral anisotropy and source normalization.
  - The operator is general_xy's coordinate form applied in (t, log r, φ): the local correlation tensor is the specified one, and the r-dependence of the variance is removed by per-radius normalization in the converter.
- 2026-11-05 — **Production field `inoisy_lg21`:** 128 × 128 × 256, T = 200 M, r = 0.05–190 M, general_xy's parameters (lam 5, r12 0.1, θ −70°, τ 1, r_ct 1 M).
  - 128 radial cells instead of 64: with 64 over 0.05–1000 M the spiral arms of Lee & Gammie Fig. 3 came out faint.
  - 128 time slices: doubling them hardly changed the inner-disc decorrelation, which is set by the Keplerian advection.
  - 8.4 MB at float16; it is the viewer's default field, and the M7 placeholder stays selectable.
- 2026-11-05 — **HDF5 read via `h5dump`** in the converter, instead of installing h5py into the system Python.
- 2026-11-05 — **CHECKPOINT M8 accepted** (user: "Approve as is"): field `inoisy_lg21` with general_xy's parameters and T = 200 M. Merged to `main` and pushed (user: "Merge and push").
- 2026-11-05 — **Registry-driven controls (M9 "add a metric"):** the metric menu and the parameter sliders are built from `js/metrics/registry.js`. One slider per parameter name, with the widest range over the metrics that share it; the registry's `bounds` clamp it per metric.
  - Registry fields: `step`; `hidden` (not in the menu); `zeroSwitch` {id, label, key} (ST3Cr's λ = 0 switch, key `bh0`, kept for existing URLs); `emissionNote` (the fuzzball's 3-crossing caveat).
  - Adding a metric needs one module and one registry entry; Reissner–Nordström is the demonstration.
- 2026-11-05 — **View state stays in the URL query** (`?metric=…&lambda=…`), not the hash the plan mentions. It already reproduces a view when shared, also on GitHub Pages, and the tests and reports use it.
- 2026-11-05 — **Tile sizing (fix of the M6 probe tiling).**
  - The rate rule shrank tiles without end: a tile's wall time includes a fixed fence/yield latency. A 1024² Kerr trace then ran in 4941 tiles of about 256 rays, at 20× the M4 time.
  - Now: the rays-per-tile estimate moves both ways, by at most 2× per tile in log space, with a floor of 64² rays. The floor drops 4× (to a minimum of 256) only when a tile at the floor runs longer than 400 ms (the watchdog margin for heavy fuzzball tiles).
  - The rest of a level is split only when a tile exceeds 3× the 30 ms target.
- 2026-11-05 — **No animation frames while a trace runs:** redrawing the canvas at 60 fps competed with the trace tiles for the integrated GPU, slowing traces by up to 3× at times. The progress callback still draws every finished tile.
- 2026-11-05 — **Constraint projection without a fifth RHS evaluation.**
  - `geodesicRHS` also returns `dmomQ`, the part of the force quadratic in the spatial momenta. The first RK stage is corrected exactly (dx, dδ ∝ s; that part ∝ s²) instead of being re-evaluated after the rescaling.
  - The RK loop is again the plain four-stage loop of M3–M5 (the M6 five-iteration loop with break/continue cost about 10% even with projection off).
  - Results are unchanged (M6 Level 2 rerun).
  - The closed-form Kerr shader does not split its force; asking it for projection is an error.
- 2026-11-05 — **Startup and runtime errors are explained in the page:**
  - a missing WebGL2 or extension: the message plus what the viewer needs;
  - a lost WebGL context (an OS GPU reset after an overlong dispatch): what happened and what to change.
- 2026-11-05 — **M9 speed-up (user: "Try a speed-up"), all without accuracy loss.**
  - **What limits the tabulated tracer, measured by adding redundant work** (Kerr 512², one level, GPU time):

    | variant | GPU time |
    |---|---|
    | as is | about 1300 ms |
    | + a second copy of the 20 table fetches | +720 ms |
    | + twice the Hermite arithmetic | +1100 ms |

    Both fetches and arithmetic mattered; M4's "fetch-bound" was half the story.
  - **Separable bicubic Hermite** in `trace.glsl`: interpolate along x for the two θ rows, then along θ. It is the same tensor-product formula with about a third of the arithmetic; the derivative channels are pre-multiplied by the cell size at upload (`backendWebGL2.js`). Result: 1300 → 840 ms. The Level 4 rerun matches M4 to 0.012% (escape directions within 1e-3 rad); emission proxy differences about 1e-6.
  - **Progressive levels: one coarse level, then the full image** (`finalLevels`: 4 → 1 for 512²–1024², 8 → 1 for 2048², 2 → 1 for 256²) instead of 4 → 2 → 1. This saves the 25% of the middle level; the preview still appears at once.
  - **Two tiles in flight:** the next tile is queued while the JS side waits for the previous fence. Submit-and-wait left the GPU idle 10–40 ms per tile, which doubled the wall time of a 1024² fuzzball trace (1000+ tiles). Tile timing now measures each tile's own share (from the later of its submission and the previous completion).
  - **Tile floor:** it drops only when a 64² tile runs longer than 1 s (was 400 ms; the Windows watchdog is about 2 s), and never below 32². At 400 ms, heavy fuzzball tiles fell back to tiny, inefficient tiles.
- 2026-11-05 — **M9 accuracy trades as options, all off by default**, for the user to judge (PROGRESS, "M9 accuracy trades"): `tableHalf` (shader variant `trace_half`: R32F values + RGBA16F derivatives), `farSteps` {r (M_ADM), max} (eps *= clamp(r / r_far, 1, max); also in the CPU reference), and the fuzzball max steps (an existing control).
- 2026-11-05 — **Adopted M9 trades** (user: "Far 4x + 5000 steps"): the viewer traces with larger steps beyond 20 M (up to 4×; checkbox "larger steps beyond 20 M", on by default) and the fuzzball max steps default is 5000 (also the Test_FBdetail preset; FOORT's config uses 10000). Half-float tables are not adopted (slower and less accurate). Validation scripts keep the plain integrator unless they ask for the options.
- 2026-11-05 — **CHECKPOINT M9 / Stage 1 accepted; root-page card and merge** (user: "Card + merge"). The FOORT-GPU card (Dutch, in the style of the existing cards) is the last card of the root `index.html` section "Zwaartekrachtgolven en de Einstein Telescope"; M9 merged to `main` and pushed.

## Stage 1B

- 2026-11-08 — **Branch `foort-gpu-1b`**, from `main` at `dd3b999`. The plan is `FOORT_GPU_STAGE1B_PLAN.md` v1.0. The user asked for B0, B1 and B2 in sequence with one stop, at checkpoint B2 ("carry out B0, B1, B2 (sequentially) and stop only at checkpoint B2"). Checkpoints B0 and B1 are therefore reported together at B2.
- 2026-11-08 — **B0 report hygiene:** new image reports go to `dev/reports/img/` (git-ignored); small JSON/markdown summaries stay in `dev/reports/`. The 137 PNGs committed in Stage 1 are left in place. Reruns of Stage 1 scripts that overwrite tracked PNGs are reverted before committing.
- 2026-11-08 — **B0 quality gate** (`dev/scripts/qualityGate.mjs`, scene set and configurations in `gateConfigs.mjs`):
  - **Scenes:** the plan's set; cameras and emission are given in units of M and converted to the registry metric's units.
  - **Chaos mask:** Reference at ε vs ε/2 (max steps doubled); termination class changes, or a sky jump > 1 px.
  - **Noisy frames:** use `inoisy_lg21` with σₙ = 1, slow light, at t = 0, T/3 and 2T/3. The light curve has 32 samples over one period.
  - **Sky error:** in image-plane pixels, through the inverse of the 2×2 Jacobian of the escape direction (tangent-plane coordinates) with respect to the pixel, from central differences on the Reference record.
  - **Chaotic-region budgets:** applied only from 100 chaotic pixels up.
  - **Reference records:** cached per code hash (`tools/foort_parity/build/gate/`, git-ignored).
- 2026-11-08 — **B0 tier probe page** (`probe.html`): five short traces (Kerr closed-form / tabulated Reference / tabulated High, ST3Cr λ = 1e-3 Reference / High). It reports Msteps/s, predicted 512² and 1024² times, and whether 512² fits E1. The JSON report is for the user to copy back. **E1 (tier time targets) is still the plan's default:** ≤ 2 s BH, ≤ 10 s fuzzball at 512². Unconfirmed; flagged at checkpoint B2.
- 2026-11-08 — **B1 `rescaleToUnitMass(metric)`** (`js/metrics/common.js`), applied to ST3Cr and ST3Cr-BH in the registry. The raw `createST3Cr` stays for the FOORT harness.
  - The wrapper carries `lengthScale` L = 24. `tableRadiusFor(r, L)` and the fluid's horizonless ISCO bounds (0.05/L, 1000/L) use it, so tables, fluid table and ISCO search keep their raw node positions. The rescaled metric then traces the same rays: the same step sequence, since the step rule is scale-invariant in x = log r.
  - Raw-unit helpers (ST3Cr `functions`, ST3Cr-BH `Q`) are not carried over; `criticalImpactParameter` is wrapped.
- 2026-11-08 — **B1 URL version** `v=2` (written by every URL). A URL without `v` (Stage 1) with `metric=st3cr` has its Johnson-SU μ and σ divided by 24, also when they took their defaults. Camera lengths were already in units of M in Stage 1.
- 2026-11-08 — **B1 Test_FBdetail preset:** μ = 0, γ = −1.5, σ = 2/24, r = 10.4167, screen 6.25 (exact conversions).
- 2026-11-08 — **B2 binned tail, packing (E2: K = 8, the plan's default).**
  - The record is 6 RGBA32F attachments: rec0–3 as in Stage 1, then 2 for the tail. Each bin is one float: W_b = Σ F g^p over crossings 4, 5, … (up to max passes), with the bin's emission-weighted log-r centroid, as an 8-bit fraction of the bin width, in the low 8 bits of W_b's mantissa (W keeps 15 bits, 3e-5 relative). This fits K = 8 in 2 attachments and leaves attachment 6 for the compaction state of B5, within 8.
  - **Bins:** uniform in log r from the inner termination radius to 50 M (`tailGeometry`).
  - **Drawing:** the tail is drawn without noise and slow light (legend, README).
  - **Re-tracing:** redshift power, fudge factor and max passes now re-trace; max passes offers 0 (all), 1–4, 6, 10, 20.
  - **Fewer than 6 draw buffers:** `TAIL_BINS 0`, the first 3 crossings only, and the performance table says so.
  - **Display:** binds at most 2 progressive levels × 6 attachments, 12 texture units, plus noise and fluid. `finalLevels` never uses more than 2.
  - **Records:** read back with 24 floats per pixel (`RECORD_FLOATS`).
- 2026-11-08 — **B2 K recommendation: keep K = 8.** With K = 8 the tail approximation is 0.3–1.7% L1 (budget 2%), while K = 4 fails (5–9%). K = 16 would give 0.2–0.6% but needs 4 tail attachments, 8 in total, and leaves no room for the B5 compaction state.
