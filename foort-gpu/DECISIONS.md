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
- 2026-11-08 — **B3 banded fluid** (`model: 'banded'`): circular in every stable band (inner edges refined by bisection on the stability sign), in each gap a plunge with the E and L of the next stable band's inner-edge orbit; = FOORT for metrics with a horizon. **E4 (default fluid) is the plan's proposal, flagged for the user:** the viewer defaults to banded (there is no normal/expert split until B7); validation scripts and `FLUID_DEFAULTS` use FOORT's model.
- 2026-11-08 — **B3 envelope radius:** coordinate r (default, D3) or circumferential sqrt(g_phiphi), from the fluid table's 4th channel in the display shader (redraw only).
- 2026-11-08 — **B3 comparison presets:** camera r = 1000 M, 60°, screen 16 M; disc Johnson-SU mu = 3, gamma = -1.5, sigma = 1 in circumferential radius; banded fluid; pairs Kerr a = 0 | ST3Cr 0.005, Kerr a = 0 | ST3Cr lambda = 0, Kerr a = 0.5 | ST3Cr 0.05, as A/B presets until compare mode (B7).
- 2026-11-08 — **B4 fuzzball noise fields (E3: anchors λ = 0, 1e-3, 5e-3, 0.05, the plan's default; flagged for the user).**
  - **Model:** inoisy `foort_logr` reads a tabulated Ω(r) (`FOORT_OMEGA_FILE`) from the viewer's banded fluid. The tabulated Ω replaces Keplerian in the advection and correlation-time terms. The correlation time is clamped to ≥ 3 Δt = 4.7 M; the clamp never binds, because max Ω ≈ 0.41/M gives a shortest period of 15 M. In table mode the correlation length is lam · r at all radii, with no inner cutoff.
  - **Physics parameters:** those of `inoisy_lg21` (lam 5, τ 1, r12 0.1, θ −70°, T = 200 M).
  - **Grid:** 128 × 192 × 128 over r = 1e-4–200 M. Each file is 6.3 MB; the four together are 25.2 MB, against the plan's 50 MB per-file limit.
  - **λ = 0** uses the ST3Cr black hole's Ω (circular outside its ISCO, plunging inside).
- 2026-11-08 — **B4 runtime selection** (noise field "auto", the new default):
  - all black-hole metrics use `inoisy_lg21` (plan: BH mode keeps it);
  - ST3Cr-BH uses `l0`;
  - ST3Cr uses the anchor nearest in log λ: λ < 10^−3.5 goes to `l0`, otherwise the nearest of 1e-3, 5e-3, 0.05.
  - The field is reloaded when the metric, λ, the λ = 0 switch or a preset changes. The clock line names the field and says "auto".
  - Fixed choices remain available.
- 2026-11-08 — **B4 coverage guard:** outside [xmin, xmax], σₙ is multiplied by clamp(1 − d/w, 0, 1), with d the distance in x = log r and w = fadeWidth from the metadata (fallback lam·|cos θ|, then 1). The factor keeps its mean 1. It applies to every field, BH included.
- 2026-11-08 — **B4 coverage view and readout:**
  - **View** (mode 11, "Noise coverage"): the emission-weighted guard factor of the first 3 crossings, from green (1) to red (0), grey where there is no emission.
  - **Readout:** the clock line and the legend give the whole-image percentage, computed in JS on the coarse records.
- 2026-11-08 — **CHECKPOINTS B0–B4 accepted with all proposed defaults** (user: "Accept all defaults"):
  - **E1:** tier time targets ≤ 2 s (BH), ≤ 10 s (fuzzball) at 512²;
  - **Normal budgets:** as in the plan, Section 1.2;
  - **E2:** K = 8 tail bins;
  - **E3:** noise anchors λ = 0, 1e-3, 5e-3, 0.05, nearest anchor at runtime; the B4 fields and animations are approved;
  - **E4:** banded fluid by default, FOORT's model for parity work;
  - **Noise data:** 35 MB committed is acceptable.
  - **Not decided:** merging `foort-gpu-1b` into main, and the device round (no reports yet). E1 stays provisional until the device numbers arrive.
- 2026-11-09 — **B5 started** (user: "Start B5", after accepting B0–B4).
- 2026-11-09 — **B5 exactness criterion.**
  - Fuzzball images are chaotic: 37–50% of the pixels change class under eps → eps/2. Even a perturbation of 1e-6 in eps changes the time-averaged emission of 0.1–4% of the non-chaotic pixels by more than 1e-3.
  - An exact speedup is therefore judged against that **noise floor** (`b5Exact.mjs --feature floor`), not against bit identity, on the quality-gate scene set: termination agreement, escape direction, crossing r/dt/g, tail bins, and emission.
- 2026-11-09 — **B5-1 closed-form metrics.**
  - **Generator:** `tools/codegen/gen_metrics.py` (SymPy) writes `shaders/glsl/closed/<metric>.glsl`. Each defines a `lookupTables` with the table lookup's interface; `trace.glsl`, compiled with `CLOSED_FORM`, supplies the Hamiltonian, the force with the dmomQ split, and the terminations.
  - **Float32 safety:** expressions in e = r − r₊ with Δ factorised; the angle as S = sin δ, C = hemi cos δ; integer powers as products. The generator also writes JS mirrors (`dev/tests/unit/closed/`), tested against the JS metrics in double.
  - **Default path "auto":**
    - Kerr uses the hand-written shader. It is 1.1–1.5× faster than the generated one, which agrees with it to emission L1 1e-6 and serves as its cross-check.
    - Johannsen and RN use the generated shaders: 3.7× and 8.2× faster than the tables, termination 100%, emission L1 ≤ 4e-6.
    - Manko–Novikov keeps the tables, as plan 4.1-1 prescribes. On 300 pixels where the generated MN shader and the tables disagree, the double CPU reference sides with the tables every time. The errors sit at r = 1.5–1.8, next to the termination radius (1.507) beside the CTC band, where float32 loses digits. MN closed was only 1.3× faster anyway.
  - **Tables on request:** the Tracing control "metric evaluation" can force the tables, or a closed form.
- 2026-11-09 — **B5-2 ST3Cr G3 = G4:** g^rr = r² g^θθ holds to 6e-16 for ST3Cr and its λ = 0 black hole. A registry flag `g3equalsG4` gives the `G3_EQUALS_G4` shader define: 16 instead of 20 fetches. It is on by default, as exact: its changes equal the noise floor.
- 2026-11-09 — **B5-3 texel reuse (`TEXEL_REUSE`):**
  - **How:** the 20 texels of the current cell stay in registers, and are refetched only when the cell changes.
  - **Exact:** changes are at the 1e-7 level (compiler reordering).
  - **Speed:** 1.3–2.0× on this laptop's AMD Radeon iGPU (A/B/A/B at 512²); 1.5–2.6× in the probe's interleaved pairs.
  - **Status:** off by default until a second GPU confirms it (plan). A viewer checkbox and probe pairs are provided.
- 2026-11-09 — **B5-4 ray compaction (`COMPACT`, 8 draw buffers):**
  - **Design:** phase A stops rays at n1 = 1500 steps and writes their state to 2 more attachments. An asynchronous PBO read-back lists the unfinished rays. Phase B traces them as a dense 256-wide image (the state read back, p_t and p_φ recomputed from the pixel), and a point-draw pass scatters the records back. Further rounds run at 2n1, 4n1, …
  - **Exactness:** identical crossings, termination and escape on every pixel of the 13 scenes. The only difference is the tail centroids, rounded to 12 bits at a phase boundary (emission L1 ≤ 6e-6). Total step counts are identical.
  - **Speed:** not faster on this laptop: 0.75–0.99× at 512² A/B/A/B; 1.07× in the probe pair at 256². The cost model (waves run as long as their longest ray) predicted at most 1.12–1.21× for the fuzzball and nothing for black holes.
  - **Status:** off by default, as a viewer checkbox. It stays as the "trace a list of pixels" machinery for B6's adaptive refinement.
- 2026-11-09 — **B5-5 interaction:**
  - **Camera azimuth** is a display uniform (control "camera azimuth", no re-trace). The e2e test matches a camera traced at that azimuth on 99.8% of the pixels, with noise on.
  - **Record cache (E9: 256 MB desktop, 64 MB phone):** an LRU in `TracePipeline`, with records copied on the GPU by float blits. The key covers the program, uniforms, tables, fluid, N and levels. Scripts and tests bypass it.
  - **Idle pre-tracing:** 300 ms after a final trace, the previews of λ ± one slider notch (ST3Cr) and inclination ± 5° are traced into the cache, in a separate background record set (the canvas never shows them). Any input cancels it after the current tile. It is on by default on desktop and off on phones (touch screen < 820 px), as a checkbox.
  - **Limitation:** a dragged slider rarely lands exactly on a pre-traced value, so pre-tracing mainly serves arrow-key and one-notch steps; the cache serves switching back.
- 2026-11-09 — **Correction:** the B0 device-round table called this laptop's GPU "Intel iGPU"; it is an AMD Radeon integrated GPU (D3D11), as the probe reports. Fixed in PROGRESS.md.
- 2026-11-09 — **B5 device round; texel reuse adopted (plan 4.1-3: "only if faster on both").** The user ran the B5 probe on their laptop (Firefox, "AMD Radeon R9 200 Series, or similar": Firefox reports a generalised renderer string) and on their phone (Samsung Xclipse 920). The reports are in `dev/reports/b5/probe_user_*.json`.

  | interleaved pair (256²) | user's laptop | phone | this machine (AMD Radeon iGPU) |
  |---|---|---|---|
  | G3 = G4 (ST3Cr) | 1.23× | 1.19× | 1.17× |
  | texel reuse, Kerr tabulated | 2.00× | 1.23× | 1.53× |
  | texel reuse, ST3Cr | 3.21× | 2.23× | 2.57× |
  | ray compaction, ST3Cr | 1.01× | 1.07× | 1.07× |
  | generated Johannsen vs tables | 5.23× | 2.97× | 5.67× |

  - **Texel reuse** is faster on all three GPUs, so the viewer now defaults to it. Scripts and the quality gate's Reference keep the plain tracer (`VIEW_DEFAULTS.texelReuse` false), so Reference stays the Stage 1 integrator.
  - **Ray compaction** gains at most 7%, so it stays off.
  - **Not decided by the user:** the user did not decide this explicitly; it is the plan's adoption rule applied to their reports. Flagged at checkpoint B5.
- 2026-11-09 — **B5 merged; B6 started** (user: "Merge, start B6").
- 2026-11-09 — **B6 quality tiers** (`js/gpu/tiers.js`, plan 1.2):
  - **Tiers:** Reference, High and Normal as in the plan. Draft is the coarse preview while dragging (coarse level; coarse tables for metric parameters).
  - **"quality" control:** auto, reference, high, normal, or custom (the ε, far-step and max-step controls, shown only then); URL `quality=`.
  - **URL v3:** a link from before v3 that set ε, farSteps or maxSteps opens as custom.
  - **Auto selection:** once per metric mode, before the first final trace, the current view is traced at 64² for each tier in the background record set (twice each; the first compiles). The full trace at the current resolution is predicted from those timings, and the highest tier within E1 (2 s BH, 10 s fuzzball) is chosen; Normal if none fits.
    - The probe is longer than the plan's "~100 ms": about 0.3 s for black holes, about 1 s for the fuzzball (Reference has 10000 max steps there).
    - The status line and the performance table name the tier and the predictions.
  - **Quality gate:** the B5 exact speedups are now in every gate configuration (closed-form path "auto", texel reuse), as plan 1.2 allows. Option `--out`; option `--refhash` reuses Reference records cached under an earlier code version, used here because the B6 shader options are all off in Reference.
- 2026-11-09 — **B6 Normal candidates (plan 4.2), gate at 512² against Reference** (`dev/reports/b6/summary.md`):
  - **Near-field ε = 0.04, 0.05, 0.06, 0.08** (far steps kept): none passes. From 0.04 on, the sky errors exceed High's (black holes: p99 up to 0.42 px at 0.04 vs High's ≤ 0.30); from 0.05 on, the noisy-frame emission L1 and delays fail too. Speed vs High: 1.2–2.1× (black holes).
  - **Bogacki–Shampine 3(2)** (`+bs3`, FSAL, error control on (x, δ, sin δ φ), tolerance tol × the pixel's angle at the camera, steps capped at 4 × FOORT's rule):
    - at tol 0.1 it passes **every** budget on all 8 black-hole scenes: sky p99 ≤ 0.10 px (High 0.22–0.30), emission L1 ≤ 1.8e-3, p99 ≤ 6.5e-3, dt p99 ≤ 0.23 M; 1.19× High (geometric mean, 0.9–2.2× per scene vs Reference);
    - at tol 0.3 and 1 it is 1.5× and 2.0× faster but fails the noisy-frame emission L1 (4–5e-3);
    - it fails on the fuzzball at every tolerance: different steps change the chaotic interior (class agreement 93–95% vs High's 97.5%).
  - **Adaptive refinement** (`js/gpu/refine.js` + interpolation pass + the B5 pixel-list machinery, from stride 4):
    - **Marking:** termination class or crossing count differ, or a corner not cleanly escaped or captured, or the interpolation error estimated from second differences exceeds the thresholds (sky in fine pixels via the Jacobian; r, g relative; dt in M). A first-difference rule marked 93% of the Kerr cells (lensing is steep but smooth); second differences mark 32%.
    - **Result:** fails the sky budget on every scene (p99 1.5–2.5 px vs High 0.3), and the per-pixel emission p99 on three black-hole scenes; 1.14–1.31× High.
    - **Why:** interpolating escape directions across 4-pixel cells cannot match a fully traced image to a few tenths of a pixel; the budget "no worse than High" is set by High's 0.25 px.
    - The machinery stays, off. Two-stage refinement (4 → 2 → 1) or a looser sky budget would be the next things to try.
- 2026-11-09 — **B6 Normal (proposed, for the user to confirm at checkpoint B6):**
  - **Black holes:** High + BS3 at tol 0.1.
  - **Fuzzball:** = High. No candidate passes; its chaotic interior makes any change of steps visible.
  - **Refinement:** not in Normal.
- 2026-11-09 — **Bug found by the gate and fixed:** an idle pre-trace that started between a trace and the read-back of its records made the read-back return the background set (one corrupted gate scene: eps 0.04, kerr_a0_inc17; rerun clean).
  - **Fix:** read-backs now read the displayed set unless the pipeline asks for its own (refinement).
  - **Scripts:** the gate and the GPU runner open the viewer with `pretrace=0`.
- 2026-11-09 — **CHECKPOINT B6 accepted; Normal confirmed** (user: "Confirm and merge"):
  - **Black holes:** High + Bogacki–Shampine 3(2) at tol 0.1.
  - **Fuzzball:** = High.
  - **Adaptive refinement:** not in Normal (kept, off).
  - **Merge:** foort-gpu-1b merged to main.
- 2026-11-10 — **B7 started** (user: "Start B7").
- 2026-11-10 — **B7 panels:**
  - **Tagging:** each control carries a level (expert, both, normal, or hidden: state and URL only). The normal panel is generated from the same `CONTROLS` list, with its own labels where useful.
  - **Default:** the normal panel; `ui=expert` or the toolbar button (key `e`) for the expert panel. Old links without `ui` open in the normal panel with their state.
  - **Normal panel:**
    - **Spacetime:** family (black hole = Kerr, fuzzball = ST3Cr), spin a (Kerr), λ.
    - **Camera:** viewing angle, field of view, azimuth.
    - **Disc emission:** brightness (a factor on the auto exposure), time-averaged (σₙ = 0 for the display).
    - **Time:** play, speed.
    - **Compare** on/off with its layout.
    - The quality tier is shown in the status line, not chosen.
  - **λ = 0:** the λ slider has one position below its minimum, which sets λ = 0 (the ST3Cr black hole); the checkbox stays in the expert panel.
  - **Expert additions:**
    - for custom quality: the integrator (RK4 / BS3) with its tolerance, and adaptive refinement with its threshold;
    - the compaction threshold N₁;
    - the record-cache size;
    - which compare side the panel edits, and the blink rate.
  - **Not done:**
    - tail bins stay fixed at 8 (E2);
    - no "refined pixels" view (refinement is off in every tier);
    - units, telescope blur and video are B8–B9.
- 2026-11-10 — **B7 interaction** (`js/ui/interaction.js`):
  - **Drag:** horizontal = azimuth (0.5°/px, display-only); vertical = viewing angle (0.3°/px, previews at the coarse level, the full trace on release). Shift-drag or two fingers pan; a pinch or the wheel zooms (wheel: the full trace 300 ms after the last event). During zoom and pan the display shows an instant digital zoom of the current records (`uZoom`, `uOrigin` in display.glsl).
  - **Toolbar:** expert/normal, hide panel, fullscreen (the image), snapshot (PNG of the canvas), reset to defaults, help (`?`).
  - **Persistence:** localStorage holds the last URL; a URL with parameters takes precedence.
  - **Progress:** the levels weighted by their rays; shown after 400 ms, with an ETA and a cancel button.
  - **Long-trace warning:** before a final trace predicted above 15 s (from the tier probe), with "trace anyway", "lower resolution" and "use Normal quality".
- 2026-11-10 — **B7 compare:**
  - **Layouts:** split (draggable divider), side by side (the canvas two records wide), blink (a rate, or the `b` key by hand).
  - **State:** A and B share camera, time and display settings (`SHARED_KEYS`). The panel edits one side, and the other side's own settings wait in a stash (expert). In the normal panel B is the other family at matched settings.
  - **Drawing:** both sides are drawn every frame from the record cache (pinned, never evicted), each with its own fluid table and noise field (the backend keeps both by name and key). Both use side A's auto exposure, so brightness compares directly.
- 2026-11-10 — **B7 phone-safe defaults:** with quality auto, when no tier fits E1 at the default resolution and the link did not set N, the resolution is halved (not below 256). Phones also get the 64 MB cache and no idle pre-tracing (B5).
- 2026-11-10 — **Tests:** Playwright now runs at most 4 workers. With more, this laptop's iGPU occasionally returned a wrong frame or timed out under 33 GPU-heavy tests; at 4 the suite is also faster (1.2 vs 1.8 min).
- 2026-11-10 — **B7 merged to main** for the user's laptop and phone trial (user: "Merge to main").
- 2026-11-10 — **B8 started before the user's B7 checks** (user: "continue with B8 for now without my checks on B7 yet").
- 2026-11-10 — **E6 unit presets, checked against the literature:**
  - **Sgr A\*:** M = 4.297 × 10⁶ M☉, D = 8.277 kpc (GRAVITY Collaboration 2022, A&A 657, L12, https://www.aanda.org/articles/aa/abs/2022/01/aa42465-21/aa42465-21.html), so θ_g = 5.12 µas. The plan's rounded 4.3 × 10⁶ M☉ at 8.28 kpc agrees.
  - **M87\*:** M = 6.5 × 10⁹ M☉, D = 16.8 Mpc (EHT Collaboration 2019, ApJL 875, L6, Paper VI, https://arxiv.org/abs/1906.11243), so θ_g = 3.8 µas.
  - **Stellar:** 10 M☉ at 1 kpc, illustrative.
  - **Constants:** GM☉/c³ = 4.925490947 µs, GM☉/c² = 1.476625038 km (IAU nominal GM☉).
  - **Code:** `js/units.js`; unit tests check θ_g, GM/c³ = 21.2 s for Sgr A* (real time = 0.047 M/s) and 8.9 h for M87*.
- 2026-11-10 — **B8 display:** with the telescope beam or the light curve on, the emission view is drawn linearly into a float image per view (display.glsl `uOut`: total, n = 1, n = 2, n ≥ 3 + tail). `post.glsl` then runs:
  - the light-curve reduction (2 × 2 sums down to 1 × 1, an asynchronous PBO read-back every frame);
  - the telescope blur (a separable Gaussian, zero outside the image; for σ > 8 px on a 2^k box-averaged copy, k = ⌈log₂(σ/8)⌉);
  - the tone map (bilinear from the smaller copy, no float-filtering extension).

  Without either, the direct path of Stage 1 is used. In compare mode each side has its own images.
- 2026-11-10 — **E5 beam:** default FWHM 20 µas (the plan's default); in dimensionless units the FWHM is given in M (default 2 M). The beam is zero-padded outside the image, as a telescope's would be. With a disc that fills the field (Sgr A*, 15 M field), a 20–40 µas beam spreads 14–31% of the light off the image.
- 2026-11-10 — **B8 light curve:** side A's flux per frame (observer time, total, n = 1, n = 2, n ≥ 3). The chart shows the last noise period (at least 50 M), with flux / mean, the period marked, and time in M and in physical units. The series restarts when the clock goes back or a new trace finishes.
- 2026-11-10 — **B8 pixel inspector:**
  - **How:** a click (no movement, < 0.6 s) with the inspector on. The CPU reference (`cpuTracer.js`, now with optional path recording) traces the pixel in a module worker (`js/ref/inspectWorker.js`), with the view's own parameters (the B6 integrator and refinement off: RK4 at the view's ε). The GPU record is read from the displayed records.
  - **Display:** the meridional plane of the camera and the equatorial plane, scaled to 4 × the closest approach (so the fuzzball's cap is visible), with the horizon or the point and ring singularities; up to 3 rays.
  - **Limitations:** compare mode off only; no tap-and-hold on touch yet (a tap works).
- 2026-11-10 — **B8 merged to main** for the user's trial of B7 and B8 together (user: "Merge to main").
- 2026-11-10 — **B9 started before the user's B7/B8 checks** (user: "continue with B9 without me checking yet, will check at end").
- 2026-11-10 — **B9 export** (`js/export.js`):
  - **PNG:** the canvas at trace resolution; the scale bar and the clock burned in when "snapshot: burn in" is on. The view's URL goes in a `tEXt` chunk (keyword `foort-gpu-url`) inserted after IHDR, CRC-32 computed in JS.
  - **Video:** `captureStream(0)` + `requestFrame()` + MediaRecorder, with the first supported of WebM VP9, VP8, WebM, then MP4.
    - **Frames:** drawn at a fixed observer-time step from the records (no re-trace) and paced at the chosen rate. The step is the speed per frame, or T / frames for "one noise period" (frame k at t₀ + kT / frames, so the loop closes exactly). With procedural advection the loop is not seamless and the status says so.
    - **Options:** length (s) and rate (24, 30, 60). The resolution is the trace's, since a different one needs a re-trace. Progress in the bar, cancel with the bar's button or the record button. The clock returns to its start afterwards.
- 2026-11-10 — **B9 acceptance on this machine** (AMD Radeon integrated graphics, D3D11, Chrome; `dev/reports/b9/acceptance_laptop.json`), at the auto-selected tier. All plan targets are met:
  - 1024² Kerr: 0.72 s (High);
  - 512² fuzzball at λ = 1e-3: 3.2 s with the Test_FBdetail camera, 1.8 s with the default camera (Reference: the auto tier picks it, since it fits 10 s);
  - display with light curve and beam: the page runs at 60 fps at 512² and 1024² (the pass alone: 670 and 170 fps);
  - azimuth drag: 60.6 fps, no trace started.
- 2026-11-10 — **Final quality gate per tier** (`dev/reports/b9/gate_normal.*`, `gate_reference.*`; High in `dev/reports/b6/gate_high.*`):
  - **Reference:** its own consistency (ε against ε/2) changes 0–0.02% of the black-hole pixels and 2.1–3.3% of the fuzzball pixels (λ = 0: 0.07%).
  - **High:** passes every budget except, on the fuzzball, class agreement and the chaotic class fractions, from its 5000-step limit (accepted in Stage 1).
  - **Normal:**
    - **Black holes:** passes every budget on all 8 scenes (sky p99 ≤ 0.10 px, emission L1 ≤ 1.8e-3), 1.0–2.3× faster than Reference.
    - **Fuzzball:** = High.
- 2026-11-10 — **B9 merged to main** (user: "Merge to main"), which also redeploys B8: the GitHub Pages deploy of the B8 merge (ce49645) had failed in its deploy step (build succeeded).

## External review (2026-11-10, `FOORT_GPU_REVIEW.md`), packages 1-3

- 2026-11-11 — **Review packages 1-3 on branch `foort-gpu-review`** (user: "ok continue with those three packages first then"). The open decisions of the review stay with the user: P2 (tier policy), U2 (Dutch), E7 (physics options). So does the lay-panel redesign (packages 7-8).
- 2026-11-11 — **C1, escape radius:**
  - **Black holes:** at least R_out = 60 M outside FOORT-parity mode. A camera at 10 M now sees the disc to 60 M; before, it was cut at 10.1 M.
  - **The fuzzball:** keeps 1.01 r_cam. A 60 M boundary would stretch its table from 46 M to 458 M over the same 512 nodes, a coarser grid in the chaotic interior. Test_FBdetail's total flux changed by 0.4-1.9× at the chaos noise floor, with nothing gained, since its emission lies at r < 1 M.
  - **FOORT parity** (FOORT crossings or mesh) keeps FOORT's 1.01 r_cam.
- 2026-11-11 — **C2:** a camera at or inside the static limit (g_tt ≥ 0) is moved out to where g_tt ≤ −0.05, with a note in the status line. Setup warnings now appear in the status line in both panels. A final trace with more than half its rays NaN reports "failed", not "done".
- 2026-11-11 — **C3:** a camera exactly on the equator no longer records a crossing at itself: the interpolated branch skips the first step's flip when z₀ = 0, which agrees with the CPU reference. FOORT parity is unchanged.
- 2026-11-11 — **C4:** the auto exposure reads the coarse level the trace used (stride 8 at 2048²).
- 2026-11-11 — **U10:** values a device chooses for itself (no pre-tracing on phones, the phone-safe resolution) are kept out of links and the remembered view.
- 2026-11-11 — **P1, scheduler:**
  - **Rates:** the cost per ray of each kind of trace (program, max steps, step settings) is measured and remembered per GPU in localStorage. A trace with a known rate sizes its first tile from it, with no lone 32² probe and no re-tiling.
  - **Tile size:** final traces use 90 ms tiles (previews 30 ms); the watchdog rule is unchanged.
  - **Not done:** skipping the coarse level for traces predicted under 150 ms. It costs about 8% and feeds the auto exposure and the preview.
- 2026-11-11 — **P5:** record read-backs go through PBO + fence (asynchronous). The step count is summed on the GPU (2 × 2 reduction) and read back asynchronously, and only in the expert panel.
- 2026-11-11 — **P6, record memory:**
  - **Attachments:** 6-7 are allocated only for programs with compaction or refinement.
  - **Levels:** made on first use; a trace frees the strides it does not use.
  - **Cache:** it takes the textures of a finished trace instead of copying them, and a restored view shows the cached textures directly. A freed entry that is still on screen is deleted when its level goes. Entries larger than half the budget are not cached, except compare sides.
- 2026-11-11 — **Review packages 1-3 merged to main** (user: "Merge to main").
