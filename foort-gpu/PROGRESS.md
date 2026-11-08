# FOORT-GPU progress

## CHECKPOINT M0 — scaffold, deployment, benchmark (2026-11-03)

### Done

- Branch `foort-gpu-dev` in `drmayerson.github.io`; everything is inside `foort-gpu/`. Nothing outside it was touched; no root `index.html` link.
- Folder skeleton of plan Section 5 (empty folders hold `.gitkeep`).
- `index.html` + `js/main.js` + `js/gpu/capabilities.js`: capability page (WebGL2 renderer, extensions, limits, float precision; WebGPU adapter info, features, limits).
- `js/camera/tetradCamera.js`: general tetrad camera with `fromStaticObserver`, a line-by-line port of FOORT `ViewScreen::ConstructVielbein` / `SetNewInitialConditions` (double precision, DOM-free). Kept for M3.
- `js/gpu/backend.js`: backend interface (JSDoc type only).
- `bench/`: standalone benchmark. `kerrBench.frag.glsl` (WebGL2 fragment shader) and `kerrBench.wgsl` (WebGPU compute shader) are line-for-line parallel: analytic Kerr, Hamiltonian in `(t, log(r - r_h), theta, phi)`, RK4, FOORT adaptive step (`eps = 0.03`), axis reflection, horizon / boundary / timeout / NaN terminations, FOORT four-colour output. Tiled dispatch with identical tile sizes, warm-up, median of N runs, GPU timer queries where present, pixel-difference statistics, a disagreement map and a copyable JSON report. If a backend is missing, the page says which one and why, and runs the other.
- `dev/`: `package.json` (Vitest, Playwright, TypeScript), `vitest.config.js`, `playwright.config.js` (starts `python -m http.server` and uses installed Chrome with WebGPU enabled), `jsconfig.json` (`tsc --checkJs`), unit tests `tests/unit/tetradCamera.test.js`, browser tests `tests/e2e/m0.spec.js`, and `serve.sh` / `serve.ps1`.

### Test results

The app and the benchmark load from `python -m http.server` with no build step. Checked in the Claude desktop app's built-in Chromium browser, on this laptop's AMD Radeon integrated GPU (RDNA3, ANGLE/D3D11). Both backends are available there, with timer queries.

**WebGL2 vs WebGPU agreement** (FOORT `KerrExample.cfg`: a = 0.94, r = 1000, θ = 0.2967, 15 × 15 screen; about 759 RK4 steps per pixel; no NaN or timeouts):

| size | termination agreement | four-colour agreement | escape-direction diff, median / p99 / max (rad) |
|---|---|---|---|
| 256² | 100% | 100% (0 px) | 4.7e-7 / 1.5e-5 / 5.6e-3 |
| 512² | 100% | 99.9992% (2 px) | 4.8e-7 / 1.5e-5 / 5.5e-2 |
| 1024² | 100% | 99.9999% (1 px) | 4.7e-7 / 1.5e-5 / 1.1e-1 |

The few large differences are isolated pixels, consistent with chaotic rays near the photon ring.

**Timing on this laptop**, median of 3 runs in ms. These numbers are indicative only: the built-in browser pane was hidden, so the page ran as a background page and wall times were noisy.

| tile | backend | 512² wall / GPU | 1024² wall / GPU | 1024² Msteps/s (GPU) |
|---|---|---|---|---|
| 128 | WebGL2 | 121 / 86 | 672 / 401 | 1980 |
| 128 | WebGPU | 141 / 109 | 637 / 467 | 1700 |
| 64 | WebGL2 | | 1226 / 724 | |
| 64 | WebGPU | | 1048 / 617 | |
| 256 | WebGL2 | | 444 / 402 | |
| 256 | WebGPU | | 468 / 419 | |
| 512 | WebGL2 | | 410 / 397 | |
| 512 | WebGPU | | 420 / 397 | |

So the two backends perform the same here: GPU time is equal to within about 10%, with WebGL2 slightly ahead. Small tiles lose 2–3× to per-tile synchronization. The benchmark default tile is now 256.

**Unit tests:** the Vitest suite is written but has **not been run**, because Node.js is not installed on this machine. Its camera assertions were checked by hand in the browser by importing the same modules:
- the tetrad is orthonormal to 4e-16;
- the initial momenta are null to 1e-15, with `p_t = 1`, past-pointing and inward;
- the central pixel is radial;
- `p_phi ≈ alpha sin(theta)` at large r.

**Playwright:** written, **not run** (Node.js missing).

### Open issues / for the user

1. **Node.js** is needed to run `dev/` (Vitest and Playwright). Install Node LTS, or allow the agent to install it.
2. **Deploy:** merge `foort-gpu-dev` to `main` so the benchmark is live at `https://drmayerson.github.io/foort-gpu/bench/`. This needs your approval.
3. **Your numbers:** open the benchmark on your laptop(s) and phone in a foreground Chrome tab, press Run (defaults: 512² and 1024², 3 runs, tile 256), and paste the JSON report back. Firefox and Safari results are also useful for the WebGL2 reach argument.
4. **Decisions** to record in `DECISIONS.md`:
   - D2, the backend. The data so far points to WebGL2, the default: WebGPU is 1.0–1.1× here, far from the 1.5× threshold.
   - The default resolutions, tile size and step budgets.
5. **Visual check:** not done by the agent. Screenshots of the hidden browser pane were blank, so the four-colour images have only been checked numerically. Please look at them on the benchmark page.
6. **Throwaway caveat:** the benchmark computes `Rt²/Δ` in float32 at r ~ 1000, where large terms cancel. Both backends agree, but whether this is accurate enough against a double-precision reference is tested in M3, not here.

### User-reported runs

**2026-11-03, Firefox 158 on Windows** (deployed page, defaults, tile 256). Firefox reports the GPU only by its generic bucket, "Radeon R9 200 Series, or similar", which may be the same AMD laptop. WebGL2 has no timer queries in Firefox, so it is wall-clock only. User confirmed: the four-colour images look fine.

| size | WebGL2 wall | WebGPU wall / GPU | Msteps/s: WebGL2 wall, WebGPU GPU |
|---|---|---|---|
| 512² | 107 ms | 402 / 98 ms | 1860, 2030 |
| 1024² | 355 ms | 1606 / 382 ms | 2240, 2080 |

- **Agreement:** termination 100%. Four-colour agreement is 100% at 512² and 99.9996% at 1024² (4 px differ). The median escape-direction difference is 8e-7 rad.
- **Reading:** the shader cost is the same in both backends; WebGL2 wall time ≈ WebGPU GPU time. Firefox's WebGPU wall time is about 4× its GPU time. This is a fixed latency of roughly 75–100 ms per `onSubmittedWorkDone`: 4 tiles at 512² add about 300 ms, 16 tiles at 1024² add about 1.2 s. For an interactive app that has to wait on each tile, that latency rules out WebGPU in Firefox today.
- **Status:** the user chose **D2 = WebGL2** (2026-11-03; see `DECISIONS.md`).

### M0 closed (2026-11-03)

- D2 = WebGL2 was confirmed by the user, and the four-colour images were approved visually.
- Default resolutions, tile size and step budgets use the agent defaults listed in `DECISIONS.md` ("Still open").
- Not done in M0:
  - no phone run;
  - Vitest and Playwright not run, because Node.js is not installed. These tests need to run before or during M1.
- Next: M1 (metric library + FOORT parity harness), awaiting the user's go-ahead.
- Update during M1: Vitest and Playwright now run and pass (Playwright: 2 of 2 in headless Chrome on the AMD GPU).

## CHECKPOINT M1 — metric library + FOORT parity harness (2026-11-03)

### Done

- `js/metrics/`:
  - `kerr.js`, `johannsen.js` (all five FOORT parameters; the UI exposes `a` and `alpha13`), `mankoNovikov.js`, `st3cr.js`: verbatim ports of FOORT's `getMetric_dd` / `getMetric_uu`;
  - `st3crBH.js`: the new λ = 0 class;
  - `common.js`: generic circular inversion, Carlson `R_F`, the elliptic integral K(k), singularity distances, pointwise and sampled validity, `validityRadius`;
  - `registry.js`: menus and sliders, with D5 charges P = 2, q0 = 50.
- `validate()` for every metric:
  - FOORT's parameter-range checks;
  - a sampled check (finite components, Lorentzian signature, no CTCs) outside the termination radius.
- `tools/foort_parity/`: `metric_dump.cpp` + `build.sh` + README. It links FOORT's own `Metric.cpp` from the unmodified local clone (commit `cfff2d5`) and dumps g_dd and g_uu as CSV.
- `dev/scripts/`:
  - `metricParity.mjs` (Level 0, 1e4 random points per set) and `parityLib.mjs`;
  - `validityScan.mjs`: Johannsen α13 and MN α3 ranges;
  - `st3crChecks.mjs`: M_ADM, λ → 0, inverses, b_c.

  The reports are in `dev/reports/m1_*.json`. Golden values (50 points per set) are in `dev/tests/golden/metric_parity/`.
- Tests:
  - `dev/tests/unit/metrics.test.js`, 28 tests;
  - all 40 Vitest tests pass;
  - `tsc --checkJs` is clean.

### Level 0: JS vs FOORT, 10 000 points per set

The **scaled** column is the one checked against the target (see `DECISIONS.md`). It applies only to points where FOORT's own metric is valid.

| set | g_dd raw | g_dd scaled | g_uu (closed) scaled | g_uu (generic) scaled | points in invalid region |
|---|---|---|---|---|---|
| Kerr a = 0 / 0.5 / 0.94 / 0.998 | ≤ 2.7e-14 | ≤ 2.7e-14 | ≤ 1.3e-13 | ≤ 1.1e-12 | 0 |
| Johannsen (4 sets, incl. all 5 parameters ≠ 0) | ≤ 9.7e-15 | ≤ 9.7e-15 | ≤ 9.6e-15 | ≤ 2.3e-14 | 0 |
| MN a = 0, α3 = 0.2 | 7.9e-16 | 7.9e-16 | 7.8e-16 | 9.3e-16 | 0 |
| MN a = 0.5, α3 = 0.1 | 2.0e-10 | 4.7e-15 | 5.3e-15 | 8.8e-15 | 3 |
| MN a = 0.9, α3 = −0.5 | 3.0e-11 | 1.8e-13 | 1.4e-13 | 3.8e-13 | 15 |
| MN a = 0.3, α3 = 1 | 4.7e-10 | 2.8e-14 | 2.8e-14 | 4.7e-10 | 36 (+6 non-finite in both) |
| ST3Cr λ = 0.15 / 0.05 / 0.005 / 1e-4 | 3.0e-12 / 4.2e-11 / 2.3e-10 / 5.5e-7 | ≤ 5.3e-14 | ≤ 5.3e-14 | ≤ 5.3e-14 | 0 |

- **Target met:** every closed form agrees with FOORT to ≤ 1.8e-13 (scaled) on valid points.
- **Raw-measure misses** occur only in g_tφ, for MN and ST3Cr. They are explained by cancellation: at the worst ST3Cr point the condition number is about 1.5e7 × 1e3, so a rounding floor of ~1e-6 relative is expected even in double precision.
- **Generic inversion** is worse near horizons, because det(t–φ) → 0 there: up to 1.1e-12 for Kerr a = 0.998 and 4.7e-10 for MN. Closed forms are therefore used everywhere.
- **MN invalid region:** at points within about 1.05 r₊, FOORT itself has g_φφ < 0, with g_tt ~ −2e6 and det(g) formed from products ~1e12. No double-precision inverse is accurate there (both residuals are ~1e-3).
- **MN non-finite points:** the 6 points that are non-finite in both codes are `exp(2γ′)` overflowing through the 1/R⁸ terms near the equatorial horizon (plan gotcha 8).
- **Circularity:** FOORT returns exactly 0 for every off-block component at all points. This was checked from FOORT's side, as plan Section 3.3 asks.

### ST3Cr (P = 2, q0 = 50)

- **M_ADM** = 24.000 from g_tt asymptotics (23.9994 at r = 2e6, 1/r drift), for λ = 0.15, 0.05, 0.005, 1e-4 and 0. This matches (3P + q0 − P³)/2.
- **J** ≈ 176 λ.
- **λ_max** = 0.193182: λ = 0.19 validates, λ = 0.194 is rejected.
- **λ → 0** (deviation from the BH at fixed r, maximized over θ):

  | λ | r = 0.1 M | r = 1 M | r = 10 M |
  |---|---|---|---|
  | 1e-2 | 5e-2 / 7e-3 | 5e-4 / 2e-3 | 2e-6 / 5e-5 |
  | 1e-4 | 7.5e-6 / 7e-5 | 7e-8 / 2e-5 | 2e-10 / 5e-7 |
  | 1e-6 | 7.5e-10 / 7e-7 | 7e-12 / 2e-7 | 2e-14 / 5e-9 |

  Each entry is |Q/Q_BH − 1| / scaled |g_tφ|. Q converges as λ², g_tφ as λ, so the limit is continuous away from the throat.
- **Closed-form inverse** (plan Section 4.1) vs generic inversion: ≤ 8.9e-16 (20 000 points per λ).
- **ST3Cr BH b_c** = 49.7146 = **2.0714 M_ADM**, with the photon sphere at base r = 7.129 = 0.297 M_ADM; throat L² = 73.32.
  - Q = (1 + 4/r)³(1 + 84/r) is a 4-charge static extremal BH with charges (4, 4, 4, 84).
  - b_c is governed by roughly the geometric mean of the charges, M by their arithmetic mean. For equal charges the same formula gives the extremal-RN value 4M.
  - So b_c ≈ 2.07 M (well below Schwarzschild's 5.2 M) is expected for such unequal charges. It is checked analytically in the tests.

### Validity ranges

Scan: 600 radii log-spaced in r − r₊, 181 θ, up to r = 1000. Table: `dev/reports/m1_validity.json`; method: `dev/scripts/validityScan.mjs`.

- **Johannsen:** valid down to the horizon for every α13 tested, from −8 up to 100, for a ∈ [0, 0.998] (**corrected below**: this grid missed a thin strip next to −r₊³). There is **no upper bound**. The lower bound is −r₊³(a): −8 at a = 0, −2.96 at a = 0.9, −1.20 at a = 0.998. Proposed slider: (−r₊³(a), 10], lower end clamped per spin.
- **Manko–Novikov:** for **every α3 ≠ 0** there is a region just outside r₊ with CTCs (g_φφ ≤ 0), or with non-finite values at a = 0 (overflow). Its outer edge, r_valid / r₊ − 1, is symmetric in ±α3:

  | a \ abs(α3) | 0.01 | 0.03 | 0.1 | 0.2 | 0.5 | 1 | 2 |
  |---|---|---|---|---|---|---|---|
  | 0 | 4e-3 | 7e-3 | 1.3e-2 | 1.9e-2 | 3.0e-2 | 4.1e-2 | 5.8e-2 |
  | 0.5 | 1.1e-2 | 2.0e-2 | 3.8e-2 | 5.4e-2 | 9.0e-2 | 0.13 | 0.18 |
  | 0.94 | 6.9e-3 | 1.2e-2 | 2.4e-2 | 3.5e-2 | 5.7e-2 | 8.0e-2 | 0.11 |
  | 0.998 | 1.6e-3 | 2.9e-3 | 5.6e-3 | 8.1e-3 | 1.3e-2 | 1.9e-2 | 2.6e-2 |

  FOORT's horizon termination at 1.01 r₊ therefore lies **inside** the pathological region for most α3 ≠ 0. This includes the MN registry default (a = 0.5, α3 = 0.1), which `validate()` currently rejects.

### Open issues / decisions for the user

1. **MN termination (needs a decision).** Options:
   - (a) terminate MN rays at r_term = r_valid(a, α3) × (1 + margin), computed at bake time. A margin of 1% is proposed. This keeps rays out of the CTC region.
   - (b) keep FOORT's 1.01 r₊ for parity and let rays enter the CTC band.
   - (c) restrict α3 to the tiny range where the band lies inside 1.01 r₊.

   Recommendation: (a) for the app. M2 parity runs would then use the same r_term on the FOORT side, as a FOORT `Epsilon_Horizon` setting. The α3 slider could be [−1, 1], where r_valid ≤ 1.13 r₊.
2. **Johannsen α13 slider:** proposed (−r₊³(a), 10]. Confirm, or name a different upper end.
3. The parity target is judged on the **scaled** measure (see `DECISIONS.md`). Confirm this is acceptable; raw-measure numbers are reported above.
4. `dev/node_modules` is inside Dropbox (git-ignored), so Dropbox syncs ~100 MB of packages. It could be excluded with Dropbox's "ignore" attribute if you prefer.

### MN termination decision implemented (2026-11-03)

- The user chose option (a). `createMankoNovikov(...).terminationRadius()` returns max(1.01 r₊, 1.01 r_valid). It is computed lazily with `validityRadius`: 600 radii × 181 θ, scanning inwards and stopping at the first invalid sample, so it takes 6–12 ms.
- r_term / r₊ for sample parameters:

  | a | α3 | r_term / r₊ |
  |---|---|---|
  | 0.5 | 0.1 | 1.048 |
  | 0.5 | ±1 | 1.137 |
  | 0.94 | 0.5 | 1.067 |
  | 0.998 | 1 | 1.029 |
  | 0 | 1 | 1.052 |

- `validate()` now samples from r_term, so all registry defaults validate.
- New test: no invalid point outside r_term on a much finer 2000 × 721 sampling, for five (a, α3) pairs. 41 of 41 Vitest tests pass.
- Still open from the M1 checkpoint:
  - the Johannsen α13 slider range;
  - confirmation of the scaled parity measure;
  - excluding `dev/node_modules` from Dropbox sync.

### Correction: Johannsen lower bound (2026-11-03, after CHECKPOINT M1)

The slider test showed that the M1 claim "Johannsen is valid for every α13 > −r₊³" is **wrong** close to the bound. The α13 grid of the scan (−8, −4, −2, −1, …) missed that strip.

- For spinning holes, with α13 within about 0.6% of −r₊³, a thin CTC band (g_φφ ≤ 0) appears just outside the horizon. At a = 0.9 and α13 = −0.999 r₊³ it reaches 1.014 r₊, beyond the 1.01 r₊ termination.
- The true lower bound for "valid outside 1.01 r₊" (bisection; 800 radii × 361 θ):

  | a | −r₊³ | valid for α13 ≥ |
  |---|---|---|
  | 0, 0.3, 0.5 | −8, −7.460, −6.498 | the whole range > −r₊³ |
  | 0.7 | −5.0366 | −5.0253 (0.9978 × −r₊³) |
  | 0.9 | −2.9605 | −2.9439 (0.9944 × −r₊³) |
  | 0.94 | −2.4124 | −2.4025 (0.9959 × −r₊³) |
  | 0.99, 0.998, 0.999 | −1.486, −1.202, −1.140 | the whole range > −r₊³ |

  At a = 0.9, a 0.01-step sweep from −2.96 to 10 finds only α13 = −2.96 and −2.95 invalid.
- So α13 ≥ −0.99 r₊³ is valid at every tested spin. The slider bound (−r₊³(a), 10] accepted at the checkpoint therefore needs a small change; the user is asked.
- **Resolved:** the user chose a lower end of **−0.99 r₊³(a)**, and the slider is now [−0.99 r₊³(a), 10].
  - Fine check at that endpoint: 800 radii × 361 θ, for every a from 0 to 0.999 in steps of 0.01.
  - No point is invalid outside 1.01 r₊.
  - The widest CTC band reaches 1.0056 r₊, at a = 0.87, so the margin to the termination radius is 0.4%.
  - Johannsen keeps FOORT's 1.01 r₊ termination. 42 of 42 Vitest tests pass.

### M1 closed (2026-11-03)

User decisions at this checkpoint, all recorded in `DECISIONS.md`:
- MN termination at 1.01 r_valid;
- Johannsen α13 ∈ [−0.99 r₊³, 10];
- parity judged on the scaled measure.

Still optional: excluding `dev/node_modules` from Dropbox sync. Next is M2 (CPU reference tracer + FOORT golden images), which waits for the user's go-ahead.

## CHECKPOINT M2 — CPU reference tracer + FOORT golden images (2026-11-03)

### Done

- `js/ref/cpuTracer.js`: the GPU algorithm in double precision.
  - Hamiltonian on the five table functions G0–G4, with derivatives from 4th-order finite differences.
  - FOORT RK4 with its adaptive step, FOORT camera, terminations, and both crossing modes.
  - Every FOORT-specific behaviour is a switch: mesh, radial coordinate, axis handling, crossings, singularity distance.
  - The "parity" mode mimics FOORT; the "app" mode is what the GPU will do. See `DECISIONS.md`.
- **FOORT runs**, made with the unmodified FOORT executable, configs generated by `dev/scripts/foortCases.mjs` + `runFoort.mjs`. Settings: RK4, ε = 0.03, `SimpleSquareMesh` 128², boundary 1.01 r_cam. Cases:

  | case | parameters | camera |
  |---|---|---|
  | Kerr | a = 0 and a = 0.94 (`KerrExample.cfg`) | r = 1000, θ = 0.2967, 15 × 15 |
  | Johannsen | a = 0.94, α13 = 5.5 (`JohannsenExample.cfg`) | same as Kerr |
  | Manko–Novikov | a = 0.94, α3 = 2 (`Test_MNrun.cfg`) | θ = π/6; ε_h = 0.122 from decision (a) |
  | ST3Cr | λ = 0.005 (`Test_FBdetail.cfg`) | r = 250, θ = 1.5, 150 × 150 |

  FOORT run times: 112 / 151 / 221 / 170 / 1974 s, in the table's order.
- **Parsers** for FOORT `.dat` output (`foortDat.mjs`).
- **Comparisons:** a parallel CPU runner (`runCpuRef.mjs`, worker threads) and the comparison with images (`compareFoort.mjs`, `png.mjs`, `m2Summary.mjs`). Reports and side-by-side PNGs are in `dev/reports/m2/`.
- **Golden data:** 24–30 stratified FOORT pixels per case (6 for ST3Cr), in `dev/tests/golden/foort_images/`.
- **Tests:** `dev/tests/unit/cpuTracer.test.js` covers Level 1 golden pixels and three Level 3 analytic checks:
  - the Schwarzschild b_c = 3√3 from the capture edge, recovered to 2.5e-5;
  - the ST3Cr λ = 0 BH shadow edge at b_c;
  - a face-on axis-reflection test.

  All 50 Vitest tests pass and `tsc --checkJs` is clean.

### Level 1 results

Every FOORT pixel is compared for the BH cases. For ST3Cr, every second pixel in each direction is compared (64² of the 128² mesh), because the CPU reference costs about 2 ms per step for ST3Cr.

| case | mode | four-colour agreement | pass-count agreement | escape-direction diff, median / p99 (rad) | escape/capture confusion |
|---|---|---|---|---|---|
| Kerr a = 0 | parity | **100%** | 99.95% (8 px) | 4.7e-7 / 1.9e-5 | none |
| Kerr a = 0 | app | **100%** | 99.72% (46 px) | 5.9e-5 / 2.1e-4 | none |
| Kerr a = 0.94 | parity | **100%** | 100% | 4.7e-7 / 2.2e-5 | none |
| Kerr a = 0.94 | app | **100%** | 99.95% (9 px) | 5.7e-5 / 2.0e-4 | none |
| Johannsen | parity | **100%** | 100% | 5.6e-7 / 3.0e-5 | none |
| Johannsen | app | **99.994%** (1 px) | 99.93% (11 px) | 6.2e-5 / 2.1e-4 | none |
| Manko–Novikov | parity | **99.994%** (1 px) | 99.994% | 5.4e-7 / 3.0e-5 | 1 escape→capture |
| Manko–Novikov | app | **100%** | 99.89% (18 px) | 5.6e-5 / 2.1e-4 | none |
| ST3Cr λ = 0.005 | parity | **94.68%** (218 px) | 93.87% | 4.2e-7 / 0.89 | see below |
| ST3Cr λ = 0.005 | app | **94.73%** (216 px) | 93.65% | 4.2e-7 / 0.85 | see below |

- **All four BH cases meet the 99.5% target in both modes.**
  - In parity mode, escape directions agree to ~5e-7 rad (median). That matches the 6-digit precision of FOORT's printed angles.
  - In app mode the agreement is ~6e-5 rad. That is ordinary truncation error from the different radial coordinate, log(r − r₊) instead of log r.
- **Pass-count differences** occur at isolated pixels whose rays graze the equatorial plane. In app mode, interpolated crossings and FOORT's threshold band then count passes differently; this is the known O(step) effect of plan gotcha 10.
- **Relative constraint drift** |H| / Σ|terms|: ~2.5e-8 median and ≤ 1.2e-7 for escaping BH rays. The one exception is a single MN app-mode ray at 3.3e-3, in the strong-field region near the CTC band; it is not investigated further.

**ST3Cr misses the 99.5% target (94.7%). Diagnosis: the mismatched pixels are unconverged at ε = 0.03 in both codes.**

- **Chaotic regions:** all 218 mismatched pixels lie where FOORT's own 3×3 neighbourhood contains more than one colour. Only 33% of all pixels do.
- **Long rays:** they are long, nearly trapped rays, with a median of 5,765 steps against 1,144 overall.
- **ε-sensitivity:** retraced with the CPU reference at ε = 0.01, **54% of the mismatched pixels change their own outcome**. Of a control set of 218 pixels that agreed with FOORT, **0% change, and all 218 still agree with FOORT**.

So neither FOORT nor the CPU reference resolves these rays at the plan's default step size. The two integrators (FOORT's Christoffel form vs our Hamiltonian form) amplify their different truncation errors differently in the chaotic scattering inside the fuzzball. Outside the fuzzball interior the images agree pixel for pixel (`dev/reports/m2/st3cr_l0.005_*.png`).

Related observation: 358 escaping ST3Cr CPU rays (9%) end with a relative constraint drift above 1e-4. Constraint projection or a smaller ε in the throat may be worth testing in M6, where plan Section 3.5 already asks for an |H| debug view.

### Images

`dev/reports/m2/<case>_<mode>.png` shows five panels, left to right:
1. FOORT four-colour;
2. CPU four-colour;
3. disagreement map (red = four-colour differs, yellow = pass count differs);
4. FOORT pass count;
5. CPU pass count.

### Open issues / for the user

1. **ST3Cr Level 1:** accept the diagnosis above, or ask for a convergence study. The study would run FOORT and the CPU reference at ε = 0.01 (FOORT alone about 100 min) and compare only pixels whose outcome is ε-converged in both codes.
2. **Emission-intensity parity** (part of Level 1 in plan Section 6) is **deferred to M5**, where FOORT's fluid model is ported. FOORT's intensities are already stored with the runs and the golden pixels.
3. Visual check of the side-by-side images.

### M2 closed (2026-11-04)
The user accepted the ST3Cr diagnosis ("Accept, close M2"): the 218 mismatched pixels are rays not converged at ε = 0.03 in either code, so no convergence study is run. Carried forward:
- emission-intensity parity is done in M5;
- the constraint-drift finding (9% of escaping ST3Cr rays with relative |H| > 1e-4) is input for M6.

Next: M3, after the user's go-ahead.

## CHECKPOINT M3 — GPU tracer, analytic Kerr path (2026-11-04)

### Done

- **Viewer** (`index.html`, `js/main.js`, `js/ui/controls.js`): the WebGL2 tracer with live controls.
  - Spin a.
  - Camera distance, inclination, screen size (field of view) and screen-centre offset.
  - Resolution 128²–2048², ε, max steps, crossing mode (interpolated / FOORT parity), optional |H| record.
  - Eight debug views: four-colour, termination, steps, g₁, dt₁, crossings count, sky grid (escape direction on a 15° grid), |H|.
  - While a slider is dragged, a coarse preview is traced; on release, the image refines.
  - The state is in the URL, e.g. `?a=0.998&inc=80&view=sky`.
  - The M0 capability page moved to `caps.html`.
- **Shaders** (`shaders/glsl/`):
  - `common.glsl` is metric-agnostic: FOORT camera, RK4 with FOORT's step rule, axis reflection, terminations, interpolated and FOORT-parity equatorial crossings, and the 16-float record.
  - `trace_kerr_analytic.glsl` holds the closed-form Kerr equations.
  - `display.glsl` draws the views.
  - M4's tabulated tracer will provide the same five metric functions (`DECISIONS.md`).
- **Backend and pipeline** (`js/gpu/backendWebGL2.js`, `js/gpu/pipeline.js`, `js/gpu/traceConfig.js`):
  - Four RGBA32F MRT targets per progressive level (strides 1, 2, 4, 8, each traced as its own smaller image).
  - Fence-polled tiles of about 256² rays, adapted towards about 30 ms per tile and traced centre-out.
  - GPU timer queries; cancellation when parameters change.
  - `traceConfig.js` turns one view description into both the GPU uniforms and the CPU-reference options, so Level 2 compares the same rays.
- **Dev tooling** (`dev/scripts/`):
  - `gpuRunner.mjs` drives the viewer in Chrome via Playwright.
  - `cpuPool.mjs` runs the CPU reference on worker threads.
  - `m3Level2.mjs`, `m3Level3.mjs`, `m3Perf.mjs`, `m3Screens.mjs` produce the checks below.
  - `kerrAnalytic.mjs` is a double-precision port of zwart-gat-camera's analytic `kerrCore` (zwart-gat-camera itself is untouched), plus an exact capture test from the conserved quantities (λ, η).
- **Tests:**
  - Vitest: 57 passed, including the new `m3.test.js` (trace config, record layout, tiling, analytic references vs CPU tracer).
  - Playwright in Chrome: 5 passed (new `m3.spec.js`: viewer and views, GPU vs CPU sample, face-on axis test).
  - `tsc --checkJs`: clean.

### Bugs found and fixed during M3

1. **South-pole precision (float32).** Rays passing close to θ = π, which is every ray in the α ≈ 0 column of an image, came out wrong by up to 0.5 rad.
   - Cause: near π, float32 spacing is 2.4e-7, which swallows the small θ steps near the pole. It also happens at 17° inclination.
   - Fix: the GPU state now holds the distance to the nearer pole, δ, plus a hemisphere sign. The axis is a reflection δ → −δ at both poles; the equator flips the hemisphere.
2. **Rays aimed straight at the axis never crossed it.** FOORT's step rule h₂ ∝ θ makes the steps shrink geometrically (Zeno). FOORT avoids this only by terminating such rays (ThetaSingularity).
   - Fix: the axis distance in the step rule is floored at 1e-3, on GPU and CPU alike in app mode.
   - These two fixes removed the visible seam in face-on views.
3. **float32 overflow beyond r ≈ 1e7** in the analytic Kerr force term (Δ² ~ r⁴). The resulting NaNs were partly classified as captured, because GLSL `min()` and comparisons with NaN are undefined.
   - Fix: the term is rewritten with R_t/Δ, and NaN is tested before the other terminations on the GPU.
   - It only affects boundary spheres far beyond the app's range (camera up to 1e5).
4. **Progressive refinement cost 3× a single pass.** The coarse levels were strided passes over the full image, and a SIMD wave runs as long as its longest ray, discarded lanes included.
   - Fix: each level is now a compact image. The total cost is 1.3× a single pass (expected 1 + 1/4 + 1/16).

### Level 2: GPU (float32) vs CPU reference (double), 256², same rays

The cameras use the KerrExample setup: r = 1000, inclination 17°, 15 × 15 screen, ε = 0.03. The "inc80" rows use inclination 80°, and the "faceon" rows 0.01°.

- **Escape direction** is compared on rays that escaped in both codes.
- **Crossing 1** compares r and g at the first equatorial crossing; g is the Keplerian placeholder.
- **Emission proxy** is Σₖ gₖ³ J(rₖ), using the Johnson-SU parameters of KerrExample.cfg. It stands in for the M5 emission until the fluid model exists.

| case | four-colour agreement (px) | termination agreement | escape direction median / p99 / max (rad) | pass count agreement | crossing 1: Δr/r median / p99 | crossing 1: Δg/g median / p99 | emission proxy, relative L1 | shadow radius, GPU/CPU | time, GPU / CPU (15 threads) |
|---|---|---|---|---|---|---|---|---|---|
| a = 0 | 100.000% (0) | 100.000% | 2.0e-6 / 6.6e-5 / 4.5e-3 | 100.00% | 1.0e-6 / 4.0e-6 | 5.7e-7 / 2.4e-5 | 4.7e-6 | 1.00000 | 42 ms / 41 s |
| a = 0.5 | 100.000% (0) | 100.000% | 1.9e-6 / 6.7e-5 / 4.4e-2 | 100.00% | 1.0e-6 / 4.0e-6 | 4.9e-7 / 1.4e-5 | 4.0e-6 | 1.00000 | 28 ms / 34 s |
| a = 0.94 | 100.000% (0) | 100.000% | 1.9e-6 / 6.2e-5 / 2.1e-2 | 100.00% | 1.0e-6 / 4.0e-6 | 4.3e-7 / 8.2e-6 | 1.2e-5 | 1.00000 | 31 ms / 45 s |
| a = 0.998 | 100.000% (0) | 100.000% | 1.9e-6 / 6.7e-5 / 1.6e-1 | 100.00% | 1.0e-6 / 4.1e-6 | 4.1e-7 / 8.4e-6 | 4.1e-6 | 1.00000 | 37 ms / 66 s |
| a = 0.94, inc80 | 100.000% (0) | 100.000% | 1.4e-6 / 5.3e-5 / 9.4e-3 | 100.00% | 1.5e-6 / 6.5e-6 | 3.5e-7 / 1.0e-5 | 6.5e-6 | 1.00000 | 26 ms / 50 s |
| a = 0.998, inc80 | 100.000% (0) | 100.000% | 1.4e-6 / 6.3e-5 / 8.3e-2 | 99.99% | 1.4e-6 / 6.4e-6 | 3.5e-7 / 1.2e-5 | 1.6e-5 | 1.00000 | 35 ms / 46 s |
| a = 0, faceon | 99.997% (2) | 100.000% | 3.5e-6 / 1.1e-4 / 8.0e-3 | 100.00% | 1.6e-6 / 6.0e-6 | 1.0e-6 / 3.7e-5 | 7.0e-6 | 1.00000 | 48 ms / 70 s |
| a = 0.94, faceon | 100.000% (0) | 100.000% | 3.2e-6 / 1.2e-4 / 2.8e-2 | 100.00% | 1.7e-6 / 6.4e-6 | 7.2e-7 / 1.4e-5 | 6.0e-6 | 1.00000 | 51 ms / 71 s |

**Against the Level 2 targets** (four-colour ≥ 99%, critical curve within 0.5%, emission L1 ≤ 2%):

- **Four-colour:** met by a wide margin. The 2 mismatched face-on pixels both lie on a class boundary of the CPU image.
- **Critical curve:** met; the shadow areas are equal to the pixel.
- **Emission:** the proxy is at 1e-5, though the real emission waits for M5.
- **Escape directions:** the p99 is set by ordinary step error. The isolated large maxima are rays near the photon ring, where the image is chaotic.

The images are `dev/reports/m3/<case>.png`. Each has four panels: GPU four-colour, CPU four-colour, mismatches (red, with the CPU class boundaries in grey), and the escape-direction error on a log colour scale from 1e-7 to 1e-1 rad.

### Level 3: analytic checks (`dev/reports/m3/level3.json`)

- **Schwarzschild shadow** (static camera at r = 1000, edge-on, 1024², screen 12):
  - expected radius on the screen: r tan(asin(3√3 √(1 − 2/r)/r)) = 5.19102;
  - GPU, from the shadow area: 5.19096;
  - relative difference −1.3e-5. The pixel size is 2.3e-3 of the radius.
- **Critical curve (Bardeen):** each pixel's capture compared with the exact test from its conserved quantities (λ, η); captured means R(r) has no turning point outside r₊. This is equivalent to the Bardeen curve and exact at any camera distance.
  - Cases: a = 0.5, 0.94, 0.998 at 17°, and a = 0.94, 0.998 at 80°; 512².
  - **Result: 0 mismatched pixels in all five.** Maps in `capture_*.png`.
- **kerrLens escape directions:** compared with `kerrCore` for a camera at r = 1e5, boundary 1e8, 128². The expected residual from the finite camera distance is b/r ≈ 7.5e-5.

  | case | GPU vs kerrCore, median / p99 (rad) | CPU reference vs kerrCore, median / p99 (rad) |
  |---|---|---|
  | a = 0.5, 17° | 7.4e-5 / 1.4e-4 | 7.0e-5 / 9.9e-5 |
  | a = 0.94, 17° | 7.3e-5 / 1.3e-4 | 6.9e-5 / 9.9e-5 |
  | a = 0.94, 80° | 7.3e-5 / 1.1e-4 | 7.0e-5 / 1.0e-4 |
  | a = 0.998, 80° | 7.3e-5 / 1.2e-4 | 6.9e-5 / 1.0e-4 |

  Both tracers agree with kerrCore at the finite-distance level, so the camera, momenta and sign conventions are right. The large GPU maxima are isolated photon-ring rays.
- **Face-on axis crossing** (inclination 0.01°, 256², |H| recorded):
  - 0 NaN and 0 timeouts, for a = 0 and a = 0.94.
  - Constraint drift |H|_rel on escaping rays: median 2.4e-6, p99 1e-5, max 2.7e-4.
  - **No seam:** the escape-direction error against the CPU on the two columns next to α = 0 is the same as on a column at α = −S/4. Medians 1e-5 / 4e-6 for a = 0 and 4e-6 / 3e-6 for a = 0.94.
  - Images: `views/sky_faceon_a0.png`, `views/sky_faceon_a0.94.png`. The one vertical line is the φ = 0/π meridian, where FOORT's quadrant colour changes.

### Performance vs M0 (same Chrome, AMD Radeon integrated GPU, ANGLE/D3D11; KerrExample, 759 steps per ray)

| | 512² wall / GPU | 1024² wall / GPU |
|---|---|---|
| M0 benchmark shader (one level) | 114 / 99 ms | 495 / 409 ms |
| viewer, one level | 121 / 108 ms | 483 / 423 ms |
| viewer, progressive 4 → 2 → 1 | 153 / 137 ms | 634 / 558 ms |

- **Speed:** the full tracer costs the same as the M0 benchmark shader, about 1.9 G RK4 steps/s, even though it now records three crossings, the redshift and the termination and pass information.
- **Progressive refinement** adds 30%. In return, the stride-4 preview appears after about 1/16 of the time.
- **Caveat:** timings vary by about ±20% between runs here (shared integrated GPU).

### Images for the user (`dev/reports/m3/views/`, 512²)

- `fourColor_a0.94_inc17.png` (KerrExample) and `fourColor_a0.998_inc80.png`
- `sky_faceon_a0.png`, `sky_faceon_a0.94.png`: axis-crossing views
- `sky_a0.94_inc80.png`, `g1_a0.94_inc80.png`, `passes_a0.94_inc80.png`, `steps_a0.94_inc80.png`

Error maps: `dev/reports/m3/kerr_*.png` and `capture_*.png`.

To try it yourself, serve with `sh dev/serve.sh` (or `dev\serve.ps1`) and open <http://127.0.0.1:8765/>.

### Open issues / for the user

1. **Visual check.** Please look at the four-colour images, the face-on sky-grid views and the error maps, and try the sliders in the viewer.
2. **Deploy:** merging to `main` would publish the viewer at `drmayerson.github.io/foort-gpu/`; there is still no link from the root page. This needs your approval.
3. **Precision note for small ε:** at ε = 0.003, rays passing within about 1e-3 rad of the axis keep a float32 error floor of about 1e-4 rad, with one probe ray at 3e-3. The CPU at that ε reaches about 1e-5. At the default ε = 0.03 the GPU equals the CPU to within the step error everywhere.
4. **Face-on images are less step-converged** at ε = 0.03 than inclined ones: about 5e-4 rad against a converged reference, against about 1e-4 at 17°. This is the same in both codes, so it is not a GPU issue. A smaller default ε could be considered for near-polar cameras.
5. **Redshift placeholder:** g is Keplerian until M5.
6. **M2 app-mode numbers:** the axis step floor (now on in app mode) slightly changes rays that pass within 1e-3 rad of the axis. The M2 app-mode comparisons were not rerun; the parity mode is unchanged.

### M3 closed (2026-11-04)
The user accepted M3 ("Accept, merge and push"). It is merged to `main` and pushed. Next: M4 (tabulated metric path), after the user's go-ahead.

## CHECKPOINT M4 — tabulated metric path, all BH-mode metrics (2026-11-04)

### Done

- **Bake** (`js/bake/bake.js`, worker `js/bake/worker.js`, client `js/bake/client.js`):
  - **Grid:** the tables are built in double precision on an (x, θ) grid, x = log(r − r₊), from the termination radius to r_max.
    - r_max is 1.1 × 10ⁿ beyond the boundary sphere.
    - θ covers [0, π/2] for symmetric metrics and [0, π] for Manko–Novikov.
  - **Derivatives:** one metric evaluation per node; derivatives by 4th-order finite differences, with mirror ghost nodes at the axis and equator.
  - **Validation:** pointwise signature and CTC checks at every node; an invalid table is refused, with a message.
  - **Redshift placeholder:** a 1D equatorial table of prograde circular orbits (Keplerian).
  - **Worker:** bakes run in a module Web Worker, cached by key; a newer request supersedes an older one.
- **Tracer** (`shaders/glsl/trace.glsl`): it provides the five metric functions of `common.glsl` by bicubic Hermite lookups (four RGBA32F texels per function per corner, `texelFetch`). The 1/sin²θ is applied analytically. `js/bake/hermite.js` is the same lookup in JS.
- **Viewer:**
  - **Metric selector:** Kerr, Johannsen (a, α13) or Manko–Novikov (a, α3). The sliders are clamped to the M1 validity bounds, and the status line says when a value was clamped.
  - **Kerr path switch:** tabulated (default) or the closed-form validation shader.
  - **Table grid selector**, with a default of 512 × 128.
  - **Live re-bake:** while a metric slider is dragged, a coarse 128 × 64 table is baked and a preview traced; on release, the full table and image follow.
  - **Startup:** the status line now names each stage ("loading shaders…", "baking metric tables…", "compiling the tabulated tracer…"). The shader files are fetched in parallel.
- **Tests:** Vitest 66 passed (new `bake.test.js`); Playwright 7 passed (new `m4.spec.js`); `tsc --checkJs` clean.
  - The test web server is now a small Node server (`dev/scripts/serve.mjs`). Python's `http.server` intermittently left ES-module requests unanswered when two test browsers loaded the app at once. Eight consecutive full runs pass.

### Findings and fixes during M4

1. **float32 storage of the metric limited the rays, not the grid.**
   - **The problem:** with G stored directly, the tabulated rays (in a double-precision tracer) were off by 4–6e-5 rad at any grid from 128 to 2048 nodes; float64 storage gave 3e-8. At large r, g^tt p_t² and g^xx p_x² cancel down to about b²/r², so float32's 6e-8 relative rounding of g^tt ≈ −1 is comparable to the geometry.
   - **The fix:** the tables now store residuals over a regular, metric-independent analytic background with M = M_ADM: B0 = −(1 + 2M/r + 4M²/r²), B2 = B4 = 1/r², B3 = r/((r + 2M)((r − r₊)² + M²)). The shader adds it back analytically.
   - **Result:** float32 tables then give 2e-8 rad. Because the background ignores spin, the Kerr table still carries all of the spin structure, so the Level 4 test stays meaningful.
2. **Shader compile time of about 34 s** (ANGLE/D3D inlined the Hermite lookup at four RK4 call sites). The RK4 stages are now a loop with one call site, and the Hermite weights are folded into four `dot` products per corner. Compile time is now about 1.5 s. The closed-form path is unchanged; the M3 Level 2 rerun gives identical results.
3. **The redshift placeholder** interpolated u^t, which diverges at the photon orbit; that was the one emission-proxy failure, 1–2% for Schwarzschild at 80°. It now interpolates 1/u^t, which vanishes continuously there, on its own 2048-node grid: about 7e-4 at worst.
4. **Axis nodes** of the tables were evaluated at θ = 1e-6. There Manko–Novikov's prolate coordinate loses digits in 1 − cos²θ, giving a 2e-8 absolute error in g^tφ near the axis (harmless, but 40% of that tiny function). The nodes now use θ = 1e-4, an even-function error of about 1e-8. The Manko–Novikov worst-case table error fell from 0.55 to 2e-5.

### Level 4: tabulated vs closed-form Kerr, both on the GPU, 256², default table 512 × 128

The views use r = 1000 and a 15 × 15 screen, at inclinations of 17° (KerrExample) and 80°. The emission proxy is Σ g³ J(r), as in M3.

| a | inc | escaping rays within 1e-3 rad | escape direction median / p99 (rad) | four-colour agreement | emission proxy, relative L1 |
|---|---|---|---|---|---|
| 0 | 17° | 99.980% | 6.4e-7 / 2.2e-5 | 100% | 3.4e-6 |
| 0 | 80° | 99.980% | 4.8e-7 / 2.1e-5 | 100% | 7.5e-4 |
| 0.5 | 17° | 99.974% | 6.8e-7 / 2.7e-5 | 100% | 1.9e-6 |
| 0.5 | 80° | 99.978% | 4.9e-7 / 2.3e-5 | 100% | 1.6e-5 |
| 0.94 | 17° | 99.977% | 7.4e-7 / 2.7e-5 | 100% | 1.6e-6 |
| 0.94 | 80° | 99.986% | 5.1e-7 / 2.8e-5 | 99.998% (1 px) | 6.7e-6 |
| 0.998 | 17° | 99.973% | 6.7e-7 / 2.4e-5 | 100% | 1.6e-5 |
| 0.998 | 80° | 99.905% | 4.9e-7 / 4.0e-5 | 100% | 5.2e-6 |

- **Targets met in all eight views:** at least 99% of escaping rays within 1e-3 rad, and emission L1 ≤ 0.5%. The shadow areas are identical, and r at the first crossing agrees to 3e-7.
- **Grid dependence** (all of 256 × 128, 512 × 128, 512 × 256 and 1024 × 256, in `level4.json`): the escape-direction numbers are flat across grids. For example, the worst case (a = 0.998 at 80°) gives 99.92 / 99.91 / 99.89 / 99.88%, so the float32 path dominates. The redshift p99 improves from 256 to 512 x-nodes. Hence the default 512 × 128.
- **Images:** the comparison maps are `level4_kerr_*_512x128.png`.

### Table accuracy in double precision, Kerr a = 0.94 (`table_error_*.json`, `m4TableRays.mjs`)

Errors are p99 relative to the function's scale at that radius. "Rays" is the escape direction against the direct metric with the double-precision tracer.

| grid | G | ∂G/∂x | ∂G/∂θ | rays (median) |
|---|---|---|---|---|
| 128 × 64 | 1.2e-5 | 4.9e-4 | 3.3e-6 | 1.7e-6 |
| 256 × 128 | 7.4e-7 | 5.4e-5 | 6.1e-6 | 1.5e-7 |
| 512 × 128 | — | — | — | 2.1e-8 |
| 512 × 256 | 5.4e-8 | 7.1e-6 | 1.2e-5 | 3.0e-8 |

- **Convergence:** Hermite converges as h⁴ (values) and h³ (derivatives) until float32 rounding takes over at ε₃₂/h. That happens at about 512 nodes in x and about 128 in θ, which is why finer θ grids get slightly worse derivatives.
- **Reference derivatives:** the "analytic Kerr derivatives" of the plan are the closed-form Kerr inverse metric differentiated by fine 4th-order central differences (h = 1e-4, error ≲ 1e-12).
- **Other metrics:** Johannsen behaves identically. Manko–Novikov has p99 4e-8 and worst case 2e-5, near the termination radius at the equator.

### Level 2: tabulated GPU vs CPU reference (double, direct metric), 256²

| case | four-colour agreement | escape direction median / p99 (rad) | shadow radius, GPU/CPU | emission proxy L1 |
|---|---|---|---|---|
| Johannsen a = 0.94, α13 = 5.5, 17° (M2 case) | 99.998% (1 px, at a class edge) | 2.6e-6 / 1.2e-4 | 0.99998 | 6.1e-6 |
| Johannsen a = 0.5, α13 = −5, 80° | 100% | 1.2e-6 / 1.7e-5 | 1.00000 | 5.9e-6 |
| Manko–Novikov a = 0.94, α3 = 2, 30° (M2 case) | 100% | 1.7e-6 / 6.4e-5 | 1.00000 | 6.0e-6 |
| Manko–Novikov a = 0.5, α3 = 0.5, 80° | 100% | 1.4e-6 / 8.2e-5 | 1.00000 | 1.9e-5 |
| Kerr a = 0.94, 17°, tabulated | 100% | 2.0e-6 / 6.5e-5 | 1.00000 | 3.7e-6 |

The GPU on tables matches the double-precision reference as well as the closed-form shader did in M3. The small specks inside the Manko–Novikov shadow appear identically in both codes, so they are a property of the metric. Images: `dev/reports/m4/<case>.png`.

### Timings (this laptop, AMD Radeon integrated GPU, Chrome/ANGLE D3D11)

| | Kerr | Johannsen | Manko–Novikov |
|---|---|---|---|
| bake 512 × 128 in the browser worker | 58 ms | 59 ms | 182 ms |
| bake 512 × 256 in the browser worker | 85 ms | 108 ms | 307 ms |
| trace 512², GPU (closed-form Kerr: 88 ms) | 430 ms | 445 ms | 487 ms |
| trace 1024², GPU (closed-form Kerr: 240 ms) | 1.90 s | 1.74 s | 1.92 s |

- **Bakes** are within the 0.5 s budget. Manko–Novikov includes its validity scan for the termination radius.
- **Tracing on tables is 4–8× slower than the closed-form shader.** I measured why:
  - With identical arithmetic but the five functions' fetches aliased to one, the trace runs at the closed-form speed (110 vs 89 ms). So the cost is the 20 distinct RGBA32F texel fetches per lookup, about 60,000 per ray.
  - Table size hardly matters: 0.3 MB costs nearly what 5 MB does.
  - Neither interleaving the functions in one texture (−13%, kept) nor caching the cell across RK stages (no gain, reverted) changes this.
  - The remaining levers are fewer bytes per node (half-float derivative channels) and an analytic far field. Those belong in the M9 performance pass.
- **Startup** (local): first preview after about 2.1 s, full 512² image after about 3 s. The status line shows each stage.

### Images for the user (`dev/reports/m4/views/`, 512², viewer)

- `fourColor_johannsen_a0.94_a13_5.5.png`, `fourColor_johannsen_a0.5_a13_-5_inc80.png`
- `fourColor_mankoNovikov_a0.94_a3_1_inc30.png`, `sky_mankoNovikov_a0.94_a3_1_inc80.png`, `g1_mankoNovikov_a0.94_a3_1_inc80.png`. These use α3 = 1, the edge of the viewer's slider range; Level 2 tested α3 = 2 directly.
- `sky_kerr_tabulated_faceon.png`: the face-on axis view on the tabulated path.

### Open issues / for the user

1. **Try the BH-mode sliders.** Run `sh dev/serve.sh` and open <http://127.0.0.1:8765/?metric=johannsen>, or publish after approval. The spin and α sliders re-bake live.
2. **Speed:** the tabulated tracer is 4–8× slower than closed-form Kerr: 0.45 s at 512² and 1.9 s at 1024² on this iGPU. Is that acceptable for now, with optimisation deferred to M9, or do you want a performance step before M5?
3. **Deploy:** merging to `main` publishes the M4 viewer; this needs your approval.
4. **Redshift:** it is still the Keplerian placeholder (now generic for all metrics); FOORT's fluid model comes in M5.
5. **α3 range:** the viewer allows Manko–Novikov α3 in [−1, 1] (M1 decision), while FOORT's example and the Level 2 test use α3 = 2, which works. Should the slider range be widened?

### M4 checkpoint decision (2026-11-04)
The tabulated-trace speed is accepted for now; optimisation is deferred to M9 (user: "Yes, defer to M9"). Still open: the Manko–Novikov α3 slider range, and publishing (merge to `main`).

## CHECKPOINT M5 — equatorial disc with static emission (2026-11-04)

### Done

- **Fluid model** (`js/fluid/generalCircularRadial.js`): a port of FOORT's `GeneralCircularRadialFluid`:
  - circular geodesics from the r-Christoffels;
  - sub-Keplerian rescaling (ξ);
  - the bisection ISCO search, between r_h and 10 r_h in log r, as FOORT;
  - the Cunningham plunge inside the ISCO, with the ISCO energy and angular momentum;
  - the radial-infall mix (β_r, β_φ) and FOORT's fallbacks;
  - plus Johnson-SU and the analytic Kerr ISCO.
- **Fluid table** (`js/fluid/fluidTable.js`): (1/u^t, u^r/u^t, Ω) at 2048 nodes in x = log(r − r₊), from the termination radius to r_max.
  - It is baked in the worker with its own cache key, in 5–10 ms, so fluid sliders do not re-bake the metric.
  - Both GPU tracers read it in `common.glsl`. The redshift now uses the full photon momentum, g = 1/(u^t p_t + u^r p_r + u^φ p_φ). The p_r term was missing in the M3/M4 Keplerian placeholder, which is now removed.
- **Display** (`display.glsl`, `js/fluid/emission.js`):
  - the disc emission I = Σₖ Fₖ gₖ^p J(rₖ) over the stored crossings, with redshift power, fudge factor and a pass bound;
  - exposure, with auto exposure from the 99.5th percentile of the coarse level;
  - tone maps (linear / sqrt / log / asinh) and colour maps (afmhot / inferno / grey).
  - Emission parameters only redraw; fluid parameters retrace.
  - The four record attachments of every level are bound: 16 texture units, the WebGL2 minimum.
- **Viewer:** the emission view is the default; there is a "Disc emission" control group and the FOORT presets KerrExample, JohannsenExample and Test_MNrun. The legend and performance table report the ISCO.
- **Harness:** `tools/foort_parity/fluid_dump.cpp` builds FOORT's fluid model against the unmodified clone. `runFoort.mjs --derivh` sets FOORT's `DerivativeH`.
- **Tests:** Vitest 70 passed (new `fluid.test.js`); Playwright 10 passed (new `m5.spec.js`: emission view, redraw vs retrace, presets); `tsc --checkJs` clean.

### Bug found and fixed during M5

**The GPU occasionally dropped an equatorial crossing**: one ray at 512² in the KerrExample view, visible as an isolated dark pixel. After the hemisphere flip, the stored δ = π − δ₁ rounded to exactly π/2 in float32, so the sign test on the equator distance saw 0. The hemisphere flip itself is now the crossing criterion. A search over four 512² views finds no isolated dark pixels and no rays that end south of the equator without a recorded pass.

### Fluid model vs FOORT (`dev/reports/m5/fluid_parity.json`)

8 metric cases × 4 fluid settings (ξ/β_r/β_φ = 1/1/1, 0.7/0.5/0.3, 0.5/0/1, 1/0/0), at 400 radii from the termination radius to 1000:

- **ISCO:** agrees with FOORT to about 1e-6 relative. The port is the closer of the two to the analytic Kerr ISCO, at about 1e-7 against FOORT's few e-6; FOORT differentiates with h = 1e-7. Values:

  | Kerr a = 0 | 0.5 | 0.94 | 0.998 | Johannsen 0.94 / 5.5 | MN 0.94 / 2 |
  |---|---|---|---|---|---|
  | 6.000001 | 4.233003 | 2.023593 | 1.236971 | 5.5417 | 1.4428 |

  The Manko–Novikov (0.94, 2) ISCO lies inside its termination radius, 1.507. FOORT's search runs through the invalid band too; the plunge region is cut off by the termination.
- **Four-velocity:** agrees to ≤ 1e-7 everywhere except a thin shell between the two codes' ISCO values. There the plunge uses slightly different ISCO E and L, giving up to 2e-5 for the mixed parameters.

### Level 1 (deferred from M2): disc intensities vs FOORT, M2 parity runs, 128², FOORT mesh

| comparison | Kerr a = 0 | Kerr a = 0.94 | Johannsen | Manko–Novikov |
|---|---|---|---|---|
| CPU parity mode (FOORT steps and crossings), relative difference median / p99 | 4.7e-5 / 3.0e-4 | 3.8e-5 / 2.5e-4 | 4.2e-5 / 2.8e-4 | 6.6e-5 / 3.0e-3 |
| GPU parity (closed-form shader in x = log r, FOORT crossings), median / p99 | 4.8e-5 / 3.1e-4 | 3.8e-5 / 2.5e-4 | — | — |
| GPU app tracer with FOORT crossings, relative L1 | 4.1e-3 | 4.5e-3 | 4.1e-3 | 4.6e-3 |
| GPU app tracer with interpolated crossings, relative L1 | 7.1e-3 | 7.2e-3 | 7.0e-3 | 7.2e-3 |

The images are `dev/reports/m5/foort_*.png` and `gpu_*.png`. Each panel set shows FOORT, then ours, then the relative difference on a log scale from 1e-7 to 1e-1.

- **Parity: a median of 4e-5 in both the CPU and the GPU.** That is about 3× FOORT's printed rounding (it writes intensities with 6 decimals, so the plan's 1e-6 target cannot be tested on its output). The remaining difference comes from integrating different equations: FOORT's second-order geodesic equation against our Hamilton equations, with the same steps.
  - For scale, FOORT-style crossings (recorded at the first step after the equator) make the intensity depend on where the steps land: the CPU at ε = 0.03 differs from itself at ε = 0.01 by 3e-3.
  - The GPU's float32 and its fluid table add nothing measurable.
- **The app tracer differs from FOORT by about 0.5% in L1, as expected.** Its radial coordinate log(r − r₊) puts the steps elsewhere (0.4% with FOORT crossings). Interpolated crossings remove FOORT's step-sized offset of the crossing position (0.7%). The CPU reference in app mode shows the same 0.7%, so this is FOORT's own crossing bias, not a GPU error.
- **Manko–Novikov in the strong field: unresolved, but bounded.** For crossings at r < 3, the CPU parity intensities differ from FOORT by more than 1e-3 at 1.5% of pixels, up to 0.23 at a few. Kerr has no such pixels even at r < 2.
  - **Both codes are internally consistent.** FOORT does not change with its derivative step (h = 1e-7 vs 1e-5: median 0, max 9e-4). The CPU does not change with its step either (1e-3, 3e-4 and 1e-4 give identical results), and it is converged: ε = 0.03 vs 0.003 differ by 1.5e-5 at r < 3.
  - So, within about 1e-5, the CPU reference is right there. The likeliest cause is FOORT's second-order integration at ε = 0.03 in Manko–Novikov's steep near-horizon field; I have not confirmed that inside FOORT.

### Level 2: GPU vs CPU reference, disc emission, same rays, 256², interpolated crossings

All 13 views of M3/M4: Kerr a = 0–0.998 at 17°, 80° and face-on; Johannsen; Manko–Novikov; tabulated Kerr. The emission uses the Johnson-SU parameters of KerrExample.cfg.

- **Emission relative L1: 3.7e-6 to 1.0e-5**, against the 2% target.
- **Redshift g at crossing 1:** median about 5e-7, p99 ≤ 4e-5.
- **Four-colour, shadow and escape directions:** unchanged from M3/M4.

**Level 4 emission** (tabulated vs closed-form Kerr, 8 views): relative L1 1.3e-6 to 3.5e-6, against the 0.5% target.

### Images for the user (`dev/reports/m5/views/`, 512²)

- `emission_KerrExample.png`, `emission_kerr_a0.94_inc80.png`, `emission_kerr_a0_inc80.png`
- `emission_JohannsenExample.png`, `emission_Test_MNrun_a3_1.png` (Manko–Novikov at α3 = 1, the edge of the viewer's slider range)
- `emission_kerr_a0.94_inc80_subkeplerian.png` (ξ = β_r = β_φ = 0.5), `emission_kerr_a0.94_inc80_log.png` (log tone map, inferno), `g1_kerr_a0.94_inc80.png`

Side by side with FOORT: `dev/reports/m5/gpu_<case>_interpolate.png` and `gpu_kerr_*_foort_parity.png`.

### Open issues / for the user

1. **Visual judgement** (the checkpoint): compare the static disc images with FOORT's (`gpu_*`, `foort_*`) and try the presets and emission controls in the viewer.
2. **Stored crossings:** the record holds 3 crossings, while FOORT sums all passes. In these 128² views 2–17 rays have more than 3 passes; they make up most of the L1 outliers in exact parity, along with axis handling. A 4th crossing slot would cost the |H| debug slot or a fifth render target. Is that worth doing?
3. **The Manko–Novikov strong-field difference against FOORT** (above): I can instrument FOORT's integrator in the harness if you want it settled.
4. **Deploy:** merging to `main` needs your approval.

**Decision (2026-11-04):** M5 accepted by the user ("Accept, merge and push"); merged into `main` and pushed. M6 not started; awaiting the go-ahead.

## CHECKPOINT M6 — fuzzball mode (2026-11-05)

### Done

- **ST3Cr and the λ = 0 black hole through the bake pipeline**, in x = log r (`js/bake/bake.js`):
  - The tables start at the metric's inner cut and hold residuals over a background that stays bounded at small r.
  - The bake checks validity from g^uu, at one metric evaluation per node.
  - Bake time at 512 × 128: 0.3–0.4 s in Node and about 0.7 s in the browser worker, over the plan's 0.5 s budget (ST3Cr's Simpson integral dominates).
- **Terminations:**
  - an inner cut, and a singularity stop at a Euclidean base-space distance from the D6 centres and the D0 ring (shader uniform `uSing`); both are 0.005 × min(l/2, R), so they scale with λ;
  - the λ = 0 black hole stops at r_cut = 1e-3;
  - views can override both (`rInner`, `singEps`), which the FOORT comparisons use.
- **Constraint projection onto H = 0** before every step, on by default for horizonless metrics, in the GPU tracer and the CPU reference (DECISIONS 2026-11-05).
  - Without it, rays that enter the throat end with relative |H| ~ 1 (p99, in both codes). Their exit momenta give blueshifts g ~ 10: single pixels that outshine the whole image.
  - FOORT shows the same: one pixel holds 96% of its λ = 0.005 image.
  - With it, GPU |H| at the end of the ray has a median of 1.5e-7 and a p99 of 4e-5.
- **Fluid:** FOORT's ISCO bisection is kept (r = 18.558 = 0.773 M at λ = 0.005), and the viewer now also reports the circular-orbit bands. At λ = 0.005 there are two stable bands, r < 0.31 inside the cap and r > 18.5, and FOORT's single-transition search finds only the outer one.
- **Viewer:**
  - the ST3Cr metric with a log-scale λ slider (1e-4 to 0.193) and a "λ = 0 (supersymmetric black hole)" switch;
  - the Test_FBdetail preset;
  - camera lengths in units of M_ADM (24 for ST3Cr);
  - 10000 max steps by default in fuzzball mode.
- **Tiling:** every trace starts with a 32² probe tile, and slow tiles are re-cut within a level. Before this, a 128² fuzzball tile ran for seconds, the GPU watchdog reset the device, and the page crashed.
- **Tests:** Vitest 78 passed (new `m6.test.js`), Playwright 13 passed (new `m6.spec.js`), `tsc --checkJs` clean.

### Table error near the centres and the ring (`dev/reports/m6/table_error_st3cr.json`, maps `table_error_map_*.png`)

Relative interpolation error of G0…G4 against the exact metric, p99, binned by distance to the nearest singularity in units of the stopping distance ε_s (λ = 0.005; other λ alike). Each cell gives the error in values / x-derivatives / δ-derivatives:

| grid | 3–10 ε_s | 10–30 ε_s | > 30 ε_s |
|---|---|---|---|
| 512 × 128 | 5e-2 / 8 / 6 | 2e-2 / 1.2 / 1.6 | 1.1e-6 / 1.3e-4 / 7.6e-5 |
| 512 × 256 | 1e-1 / 3 / 10 | 2e-2 / 1.2 / 1.5 | 8.5e-7 / 1.1e-4 / 2.9e-5 |
| 1024 × 256 | 1e-3 / 0.2 / 0.2 | 5e-4 / 0.12 / 0.1 | 7e-8 / 1.4e-5 / 2e-5 |

As expected, the errors concentrate at the D6 centres and the ring. The x resolution matters more than the θ resolution.

### Level 2: GPU vs CPU reference (double, exact metric, projection), 64², Test_FBdetail camera, 10000 max steps

Ray scattering inside the fuzzball is chaotic, so two correct integrators separate there. Every mismatched pixel is therefore re-traced on the CPU at ε = 0.01. When the CPU's own result changes with the step, the pixel is not converged at ε = 0.03 and says nothing about the GPU. The "converged" columns leave those pixels out.

| case | table | four-colour all / converged | emission L1 all / converged |
|---|---|---|---|
| λ = 0 BH | 512 × 128 | **100% / 100%** | 1.3e-5 |
| λ = 1e-4 | 512 × 128 | 98.2% / 98.7% | 4.4e-5 |
| | 1024 × 128 | 98.6% / 99.1% | 4.8e-5 |
| | 1024 × 256 | 98.6% / 99.0% | 2.0e-4 |
| λ = 0.005 | 512 × 128 | 94.4% / 96.3% | 1.5e-3 / 8.7e-4 |
| | 1024 × 128 | 95.2% / 97.3% | 1.1e-3 / 5.2e-4 |
| | 1024 × 256 | 96.0% / 97.8% | 9.2e-4 / 4.2e-4 |
| λ = 0.005, face-on | 512 × 128 | 93.6% / 94.7% | 1.3e-2 / 1.1e-2 |
| λ = 0.05 | 512 × 128 | 97.0% / 97.6% | 1.4e-1 |
| | 1024 × 128 | 98.6% / 99.2% | 3.3e-2 |
| | 1024 × 256 | 98.9% / 99.5% | 1.7e-2 |

The plan's thresholds are ≥ 99% four-colour and ≤ 2% emission L1.

- Escape directions, crossing radii and redshifts agree to about 1e-6 (median) wherever the outcomes agree.
- The λ = 0.05 emission misses are rays whose 2nd or 3rd crossing differs after a chaotic bounce, at r ≈ 2–3 where g ≈ 1.3 and I ∝ g³.
- The λ = 1e-4 emission L1 was 8.8e-2 before projection, from the throat blow-ups.

**Decision gate (plan M6):** the generic tables at the default 512 × 128 fail Level 2 near the structure. At 1024 × 256 they meet both thresholds for λ = 0.05 and 1e-4 (converged pixels) and the emission threshold everywhere except the face-on view, which was run only at 512 × 128. At λ = 0.005 four-colour reaches 97.8%. What is left there looks like chaos rather than the table:
- doubling θ moves it by only 0.5%;
- on a third to a half of the mismatched pixels, the double-precision CPU disagrees with itself between ε = 0.03 and 0.01;
- in M2, FOORT and the CPU agreed on 94.7% of this image.

I have **not** implemented the hybrid (Q and ω in the shader) and have not changed the default grid. Both choices are the user's; see Open issues.

### Level 1: GPU vs FOORT (M2 parity run, λ = 0.005, 128², FOORT mesh)

`dev/reports/m6/foort_*.json/.png`. The GPU uses FOORT's terminations: inner cut 0.01, singularity distance 0.001.

| GPU mode | four-colour | emission rel. diff median | emission L1, pixels with ≤ 3 crossings in both and the same class |
|---|---|---|---|
| FOORT crossings, no projection | 92.8% | 1.2e-3 | **7.2e-4** (13390 px) |
| interpolated crossings, projection | 93.5% | 1.7e-2 | 9.1e-3 |

- The four-colour agreement matches M2's CPU vs FOORT (94.7%): the same chaotic interior.
- Over the whole image the emission L1 is about 1, for two reasons:
  - FOORT has 2 hot pixels (constraint drift), one holding 96% of its total intensity;
  - **17% of the rays cross the equator more than 3 times**, and the GPU record keeps 3 crossings (see the next section).

### The 3-crossing record misses much of the fuzzball's emission (`dev/reports/m6/passes.json`)

CPU reference with every crossing kept, Test_FBdetail camera and emission, 64². The table gives the share of the true image intensity kept with the first n crossings:

| λ | rays with > 3 crossings | n = 1 | 2 | 3 | 4 | 6 | 8 |
|---|---|---|---|---|---|---|---|
| 0.05 | 11.6% | 18% | 38% | **48%** | 56% | 68% | 78% |
| 0.005 | 17.4% | 19% | 41% | **45%** | 48% | 52% | 55% |
| 1e-4 | 24.5% | 42% | 87% | **93%** | 94% | 95% | 97% |

Rays trapped in the cap cross the disc many times, and each crossing adds a little (Johnson-SU μ = 0, σ = 2 peaks inside the cap). For λ ≳ 1e-3 the GPU emission images therefore show **about half** of the true intensity, missing it mostly in the interior. More render targets do not fix this: 8 crossings keep 55% at λ = 0.005. The black-hole metrics of M5 are not affected in the same way (at most a few photon-ring pixels).

### Level 3: λ = 0 shadow vs b_c (`dev/reports/m6/level3.json`)

The shadow is the disc of screen radius r_c tan ψ, with sin ψ = b_c / (r_c √Q(r_c)) and b_c = 49.7146. At 512², GPU and analytic shadows agree with **0 mismatched pixels** for three cameras: Test_FBdetail (r = 250, θ = 1.5), r = 1000 M, and face-on at 100 M.

### Continuity as λ → 0 (`dev/reports/m6/continuity.json/.png`, 256², vs the λ = 0 black hole)

| λ | four-colour mismatch, screen radius > 1.1 × shadow | emission L1 there | four-colour mismatch inside |
|---|---|---|---|
| 1e-2 | 0.87% | 2.2e-2 | 80% |
| 1e-3 | 0.075% | 2.5e-3 | 51% |
| 1e-4 | 0.002% | 2.5e-4 | 12% |

Outside the throat the images converge linearly in λ. Inside, the fuzzball returns rays that the black hole swallows; that region shrinks as λ → 0.

### Steps and timings (`dev/reports/m6/steps_N512.json`; AMD integrated GPU, 10000 max steps, projection)

| λ | 512² GPU | mean / p90 steps | escaped | singularity | time out |
|---|---|---|---|---|---|
| 0.05 | 5.0 s | 551 / 977 | 99.8% | 0.2% | 0.01% |
| 0.005 | 11.0 s | 1188 / 2685 | 96.0% | 0.4% | 3.6% |
| 1e-3 | 12.2 s | 1566 / 6241 | 90.2% | 2.2% | 7.6% |
| 1e-4 | 17.8 s | 2468 / 10001 | 78.2% | 2.7% | 18.2% |
| 0 (BH) | 3.0 s | 447 / 682 | 74.7% | — (25.3% inner cut) | 0 |

In the viewer, a 512² image therefore takes 5–20 s after a coarse 128² preview. At small λ, 10–20% of rays time out (trapped). With 20000 steps the fraction roughly halves, at about twice the time (128²: `steps_N128.json`, run before projection).

### Images for the user

- **λ sequences, 512²:** `dev/reports/m6/sequence_emission.png` and `sequence_fourColor.png` (λ = 0.15, 0.05, 0.01, 0.005, 1e-3, 1e-4, 0). The single views are in `dev/reports/m6/views/`.
- **Fuzzball Shadows Fig. 1:** `dev/reports/m6/fig1_comparison.png`, four-colour with an equatorial camera at r = 250, for λ = 0.19, 0.05, 0.01, 0.001 and the black hole. The structures match the paper's (the λ = 0.19 central ellipse and arcs; the growing chaotic band; the coherent outer ring). Our quadrant colours are assigned differently.
- **λ = 0.005 debug views:** termination, steps, g₁, log tone map, face-on and distant camera (`views/`).

### Open issues / for the user

1. **Visual judgement of the physics** (the checkpoint).
2. **Decision gate:** (a) make the fuzzball table 1024 × 256 (or 1024 × 128; bake about 1.2 s, or 0.6 s, in Node) and accept the chaotic residual at λ ≈ 0.005; or (b) build the hybrid (Q, ω in the shader). I recommend (a).
3. **Emission beyond 3 crossings (new, significant):** the record keeps about half of the fuzzball's intensity at λ ≳ 1e-3. Options:
   - accumulate the tail Σ_{k>3} F g^p J(r) in the trace pass for the current emission parameters. Emission edits then redraw crossings 1–3 at once and retrace for the tail, and in M7 the tail would have fast light only;
   - more crossing slots, which is not enough: 55% with 8 at λ = 0.005;
   - leave it, and state it in the UI.
4. **Bake time** over 0.5 s for ST3Cr (0.7 s in the browser at 512 × 128, more at 1024): optimise ST3Cr's evaluation in M9?
5. **Merging** to `main` needs your approval.

**Decision (2026-11-05):** the user judged the M6 images to look good. They chose to keep the default 512 × 128 table (the chaotic-regime differences are expected) and to keep 3 crossings with a UI note. M6 is merged into `main` and pushed. M7 is not started and awaits the go-ahead.

## CHECKPOINT M7 — time-dependent emission with slow light (2026-11-05)

### Done

- **Noise-field contract and loader** (`js/noise/noiseField.js`):
  - parses and validates `noise/<name>.json` + `.bin` (float16 or float32, (Nt, Nx, Nphi) C order, x = log(r/M), periodic in t and φ);
  - includes float16 conversion, and `sampleNoise`, which uses the GPU's sampling rule in double for the tests.
- **Placeholder field** `noise/placeholder` (`tools/noise/gen_placeholder_fft.py`):
  - an FFT Gaussian random field, 64 × 96 × 128, float16, 1.6 MB;
  - period 200 M; x = log(r/M) from −6 to 7;
  - correlation time 8 M, correlation lengths 0.4 in log r and 0.35 rad in φ;
  - mean −8e-8, standard deviation 1.0000.
- **3D texture** (R16F, linear filtering, repeat in t and φ, clamp in x), uploaded at startup.
- **Display pass:**
  - each crossing is multiplied by exp(σ_n X − σ_n²/2), with X taken at its emission time t_obs + dt_k (slow light) or at t_obs (fast light);
  - optional procedural advection with the fluid's Ω(r) (flow-map crossfade, variance-preserving);
  - new debug views: noise X at crossing 1, and the n = 1 image delay (dt₁ − dt₂)/M.
  - The display now binds only the (at most 3) levels of the current trace, which frees texture units for the noise field and the fluid table.
- **Viewer "Time" group:** play/pause, speed (M per second), slow/fast light, σ_n, advection and its period D, and a clock line under the image. None of these retrace.
- **Tests:** Vitest 85 passed (new `m7.test.js`), Playwright 16 passed (new `m7.spec.js`), `tsc --checkJs` clean.

### Test results

- **Loader round trip** (unit): float16 conversion is exact for representable values and rounds to nearest otherwise; float16 and float32 files give identical fields; wrong sizes and non-periodic fields are rejected.
- **Placeholder field** (unit):
  - mean and standard deviation within 1e-3 of 0 and 1;
  - samples exact at the nodes;
  - periodic in t and φ to 1e-5;
  - across the seams no larger jump than inside the field.
- **Sampling in the shader** (e2e, Kerr a = 0.94, 60°, 128²): the noise view read back from the canvas agrees with `sampleNoise` at every disc pixel to within 0.1 in X. That is 8-bit readback (0.03) plus the hardware filter weights. Over 20 times spread across the period, the GPU samples have mean |⟨X⟩| < 0.15 and variance within 0.25 of 1. A single frame does not average out, because it sees a correlated patch of the field.
- **Seamless loop** (e2e): the canvas at t = 13 M and at 13 M + T differs by ≤ 2/255 per channel. Slow and fast light give different images.
- **Frame rate:** 60 frames/s while playing, at 512² and 1024², with and without advection. The trace is not repeated.

**Light-travel delays (`dev/reports/m7/delays.json`, 256², GPU records, in units of M_ADM):**

| view | crossing 2 − crossing 1, median [p10, p90] | max | excess delay of crossing 1, median / p99 / max |
|---|---|---|---|
| Kerr a = 0, 80° | 45.9 [25.8, 65.4] | 1030 | 12.3 / 38.4 / 42.9 |
| Kerr a = 0.94, 80° | 45.0 [23.3, 67.9] | 1020 | 13.2 / 39.4 / 45.9 |
| Kerr a = 0.94, 17° | 20.7 [16.4, 70.7] | 1020 | 17.3 / 22.9 / 32.4 |
| ST3Cr λ = 0.05 | 15.9 [7.2, 19.7] | 32 | 6.8 / 18.0 / 34.8 |
| ST3Cr λ = 0.005 | 17.0 [10.2, 31.3] | 67 | 6.9 / 41.4 / 60.4 |
| ST3Cr λ = 1e-4 | 17.6 [11.1, **1140**] | **1930** | 6.9 / **1480** / 1920 |
| ST3Cr λ = 0 BH | 16.5 [9.6, 20.4] | 2800 | 4.1 / 18.8 / 2150 |

The excess delay is −dt₁ − (r_cam − r₁): the delay beyond straight-line travel from the emission radius.

- **Black holes:** near face-on, the n = 1 image lags the direct image by about 20 M, the order of half the photon-orbit period (2π · 3√3 M / 2 = 16 M for Schwarzschild). At 80°, the second crossing of many rays is on the far side of the disc, so the median delay of about 45 M is the disc's light-crossing time. The maxima of about 1000 M are rays whose second crossing is at large r on the far disc.
- **Fuzzball:**
  - throat echoes grow as λ → 0: maximum delays of 32 M, 67 M and 1930 M at λ = 0.05, 0.005 and 1e-4;
  - at λ = 1e-4, 10% of the rays with two crossings come back from the throat more than 1100 M later;
  - the λ = 0 BH's long delays (up to 2150 M) are rays that cross the disc deep in the throat before they reach the inner cut.
- **Precision:** dt in float32 is ~1e-4 M at the 1000 M delays here, far below the field's correlation time of 8 M.

### Animations for the user

GIFs (40 frames over one period T = 200 M, 256²; about 4 MB each, so not committed; rebuilt by `dev/scripts/m7Frames.mjs` + `tools/noise/frames_to_gif.py`):

- `tools/foort_parity/build/m7gif/kerr_slow_fast_advect.gif`: Kerr a = 0.94 at 60°, with slow light, fast light, and slow light + advection.
- `tools/foort_parity/build/m7gif/fuzzball_slow_fast.gif`: ST3Cr λ = 0.005 slow and fast, and λ = 1e-4 slow.

Live: the viewer plays by default (Time group).

### Open issues / for the user

1. **Visual judgement** (the checkpoint): the animated disc in Kerr and fuzzball modes, slow vs fast light.
2. **The placeholder field has no flow.** Its pattern only changes in time; it does not rotate with the disc. Procedural advection (off by default, as the plan proposes) rotates it with the fluid but shears it into spiral streaks within D = 40 M. M8's inoisy fields have a built-in Kepler-like flow. Should advection be on by default until then?
3. **Auto exposure ignores the noise.** It uses the stationary intensities (the noise factor has mean 1), so bright noise peaks saturate at σ_n ≳ 1.5.
4. **Fuzzball emission beyond 3 crossings** (M6) also carries no noise or delay; it is missing altogether, as before.
5. **Merging** to `main` needs your approval.

**Decision (2026-11-05):** M7 accepted by the user ("Looks right"). Merged to `main` and pushed. M8 not started.

## CHECKPOINT M8 — production inoisy noise field (2026-11-05)

### Done

- **Build:** inoisy (AFD-Illinois/inoisy, `dab29ed`) builds natively on Windows with MSYS2 UCRT64 (HYPRE 2.33, serial HDF5 2.2, GSL 2.8, MS-MPI 10.1). The build is `tools/noise/build_inoisy.sh`, with exact versions and commands in `tools/noise/build_inoisy.md`.
  - The work tree is `~/foort-gpu-work/inoisy`, outside the repository.
  - MSYS2's HDF5 has no MPI-IO, so inoisy runs on one rank (`hdf5_utils.c` is compiled with USE_MPI=0).
- **New inoisy model `foort_logr`** (`tools/noise/inoisy_foort/`): the physics of inoisy's `general_xy` (Lee & Gammie 2021, Section 4.2) on the grid (t, log r, φ), periodic in t and φ.
  - The current model is Cartesian and periodic in t only.
  - In log r the spatial correlation tensor is scale free, so one grid covers r = 0.05–200 M.
- **Converter** `tools/noise/inoisy_to_contract.py`: HDF5 → contract. It reads the file with MSYS2's `h5dump`, so no Python HDF5 package is needed, renormalizes each radius to zero mean and unit variance, and writes float16.
- **Inspection** `tools/noise/inspect_field.py`: seams, statistics per radius, correlation times (at a fixed point and co-rotating), and pictures.
- **Field `noise/inoisy_lg21`:**
  - grid 128 × 128 × 256 (t, log r, φ), 8.4 MB;
  - parameters lam = 5, r12 = 0.1, θ = −70°, τ = 1, r_ct = 1 M (general_xy's, as in Lee & Gammie Fig. 3);
  - T = 200 M, r = 0.05–190 M;
  - solved in 76 s.
- **Viewer:** a "noise field" selector, defaulting to `inoisy_lg21`, with the M7 placeholder still selectable. Procedural advection stays off: this field carries its own Keplerian flow.
- **Tests:** Vitest 88 passed (new `m8.test.js`: contract, per-radius normalization, seams), Playwright 17 passed (new: default field and switching), `tsc --checkJs` clean.

### Test results (`dev/reports/m8/inoisy_lg21_stats.json`)

- **Contract:** valid (unit test). Mean 2e-7, standard deviation 1.00000, and 0.99999–1.00001 at every radius after normalization.
- **Before normalization,** inoisy's variance varies by a factor of about 6000 with radius, from 2.4e-7 at large r to 1.4e-3. It follows inoisy's source scaling with the correlation volume λ₀λ₁λ₂, which grows as r^(3/2) in coordinate units.
- **Periodicity:**

  | seam | mean jump across it | mean step inside |
  |---|---|---|
  | t = T | 0.54 | 0.47 |
  | φ = 2π | 0.052 | 0.051 |

  - At every radius the t seam lies within the range of steps inside the field (radius by radius: unit test and the radial table in the transcript).
  - The t steps are large at small r. At r ≲ 1 M the pattern moves by Ω Δt ≈ 1.5 rad per time slice, more than its narrow azimuthal width, so a fixed point decorrelates between slices. A field with twice the time resolution (256 slices) changed this only a little: lag-one correlation at r = 1 M from 0.70 to 0.75. It is the model's physics at that radius, not under-resolution.
- **Correlation time following the Keplerian flow** (1/e of the co-rotating autocorrelation), against the orbital period 2π/Ω:

  | r (M) | 1.0 | 2.0 | 5.0 | 10 | 31 | 98 |
  |---|---|---|---|---|---|---|
  | measured (M) | 4.7 | 20 | 28 | 52 | > 100 | > 100 |
  | 2π/Ω (M) | 6.1 | 18 | 70 | 203 | 1060 | 6100 |

  Up to about 3 M the measured time follows the specified τ = 1 orbit. Further out it is capped by the period T = 200 M: a field periodic in t cannot stay correlated longer than about T/4. Beyond about 30 M the field is nearly static over one period.
- **Comparison with Lee & Gammie Fig. 3** (`dev/reports/m8/inoisy_lg21_lg21style.png`: face-on, x, y in [−10, 10] M, their envelope (r₀/r)⁴ exp(−(r₀/r)²) with r₀ = 2 M, brightness g exp(X/2) on a log scale, at three times): trailing spiral arms at about 20° to the circles, bright inner disc, the same look as their figure.
  - A first run with 64 radial cells over r = 0.05–1000 M showed the arms only faintly (cells 0.6 M wide at 4 M), so the production field uses 128 cells over 0.05–200 M.
- **Other pictures:** `inoisy_lg21_disc.png` (log-r polar snapshots at four times) and `inoisy_lg21_tphi.png` (t–φ diagrams at r = 2, 5, 20 M, two periods stacked: tilted stripes from the Keplerian advection, no seam).

### Animation for the user

`tools/foort_parity/build/m7gif/m8_inoisy.gif` (5.5 MB, not committed; `dev/scripts/m7Frames.mjs --m8` + `tools/noise/frames_to_gif.py`): Kerr a = 0.94 at 17° and 60°, and ST3Cr λ = 0.005, over one period with the inoisy field.

### Open issues / for the user (the checkpoint: approve the physics parameters)

1. **Parameters:** general_xy's defaults (lam 5, r12 0.1, θ −70°, τ 1, r_ct 1 M). Change any?
2. **Period T = 200 M** caps the correlation time at r ≳ 3 M (above). A longer period, e.g. 800 M with 4× the time slices (33 MB at float16), or with the same 128 slices (coarser in time), would let the outer disc follow its orbital time. Keep 200 M?
3. **Fuzzball** (plan D3/D4 approximation): the field is sampled at log(r/M_ADM), and ST3Cr's emission lies at r ≈ 1e-3–0.2 M. That is inside r_ct = 1 M, where Ω is held near its value at r_ct and the field is fast and fine-grained. The field's Keplerian flow is not ST3Cr's fluid rotation.
4. **Repository size:** the field is 8.4 MB (the plan expected about 16 MB per field). One field is committed; more variants are a single run each.
5. **Merging** to `main` needs your approval.

**Decision (2026-11-05):** M8 approved by the user ("Approve as is"): parameters and period unchanged. Merged to `main` and pushed. M9 not started.

## CHECKPOINT M9 — polish, performance, documentation (Stage 1 acceptance) (2026-11-05)

### Done

- **"Add a metric":** Reissner–Nordström (`js/metrics/reissnerNordstrom.js` plus one registry entry, nothing else).
  - It is possible because the viewer's metric menu and sliders are now built from the registry.
  - Unit tests: validity, closed-form vs generic inverse, the Schwarzschild limit (photon sphere 3, b_c = 3√3, ISCO 6), bake.
  - e2e: it appears in the menu with its charge slider; its GPU shadow at Q = 0.8 matches the analytic b_c (radius within 0.2%, mismatches only along the edge).
- **README:** a user guide (requirements, the image, controls, debug views, sharing, known limitations) and a developer guide (layout, how it works, adding a metric step by step, tests and validation scripts).
- **Error handling:**
  - startup failures show the message and what the viewer needs;
  - a lost WebGL context (OS GPU reset) is explained in the page;
  - invalid parameters are clamped, and metrics that are not valid on their table are refused in the status line, as before.
- **Already in place from earlier milestones:**
  - progressive interaction: a coarse level on a coarse table while dragging;
  - the performance table;
  - presets for both modes: KerrExample, JohannsenExample, Test_MNrun, Test_FBdetail;
  - view state in the URL (the query string; DECISIONS).
- **The viewer header** now describes Stage 1 and links the guide.
- **Two performance bugs found and fixed:**
  - tiles shrinking without end (from M6): 4941 tiles for a 1024² Kerr trace, 20× the M4 time;
  - animation frames competing with trace tiles for the GPU (from M7): traces up to 3× slower.
- **Projection without an extra RHS evaluation,** and the RK loop back to its M5 form (DECISIONS).
- **Tests:** Vitest 92 passed (new `m9.test.js`), Playwright 19 passed (new `m9.spec.js`), `tsc --checkJs` clean.

### Acceptance timings (`dev/reports/m9/perf_baseline.json`, `dev/scripts/m9Perf.mjs`; AMD Radeon integrated graphics, Chrome/ANGLE D3D11)

These timings run in the viewer's own path: progressive levels 4 → 2 → 1 and adaptive tiles, the median of 3 traces after a warm-up (1 trace for the slow fuzzball case).

| plan target (integrated graphics) | measured | |
|---|---|---|
| 1024² Kerr re-trace ≤ 1 s | **6.4 s** tabulated (the app); 1.8 s wall / 1.0 s GPU closed-form | not met |
| drag preview 256² ≤ 50 ms | **414 ms** (the viewer previews 128² at N = 512 and 1024: about 100 ms) | not met |
| display pass ≥ 60 fps | 60 fps at 512² and 1024², while playing (M7) | met |
| fuzzball λ = 1e-3 ≤ 3× Kerr | **8.3×** (53 s vs 6.4 s at 1024²; 8.5 s at 512²) | not met |

**Diagnosis:**

- **The machine varies by up to 3× between runs today** (iGPU clocks). Identical shaders gave 205–800 ms. The M0 benchmark runs at 105 ms (512² GPU) against 86–98 ms in M0. Run back to back today, the M4 shaders and the current ones take the same time (closed-form 196 vs 209 ms, tabulated 850 vs 770 ms at 512², single level). There is no shader regression, but today's absolute numbers are about 2× the M4 ones (88 / 430 ms).
- **The tabulated tracer is fetch-bound** (M4): 20 RGBA32F texel fetches per RK stage, about 4× the closed-form Kerr shader.
- **The fuzzball** takes twice the steps of Kerr (mean 1566 vs 760 at λ = 1e-3). Its trapped rays (7.6% time out at 10000 steps) keep SIMD groups busy long after their neighbours finish.
- **The plan's levers** that could close part of the gap are not implemented. Each trades accuracy, so each is a decision:
  - half-float derivative channels in the tables (about 40% fewer bytes per fetch; derivative precision falls to about 1e-3 relative);
  - an analytic far field, or larger steps at large r (about 130 of the 760 Kerr steps are spent beyond r = 20 M);
  - a lower fuzzball step limit (5000: about 2× faster, 11% instead of 7.6% time-outs at λ = 1e-3).

### Open issues / for the user

1. **Stage 1 acceptance:** everything except the performance targets, which are missed as above. Accept with these numbers, or try one of the levers first?
2. **Link from the root `index.html`** (needs your approval). A card in the style of the existing ones, in Dutch like the page, for example in the "Zwaartekrachtgolven en de Einstein Telescope" section (or a new section):
   > **FOORT-GPU: zwarte gaten en fuzzballs** · Een wetenschappelijke ray tracer in je browser: een accretieschijf rond een draaiend zwart gat of rond een fuzzball uit de snaartheorie, live berekend op je grafische kaart. Voor wie de details wil, met alle parameters van FOORT (in het Engels).
3. **Merging** to `main` needs your approval.

### M9 speed-up (user: "Try a speed-up"), 2026-11-05

**Changes.** None of them loses accuracy (DECISIONS):
- separable Hermite interpolation of the tables, with pre-scaled derivative channels;
- one coarse preview level instead of two;
- two trace tiles in flight;
- a tile-size floor that drops only for tiles over 1 s.

**Timings** (`dev/reports/m9/perf_pipelined.json`; same machine and method as above; this machine varies by up to 2–3× between runs, so treat single numbers with care):

| case | before | after | plan target (integrated graphics) |
|---|---|---|---|
| 1024² Kerr re-trace, tabulated (the app) | 6.4 s | **3.9 s** | ≤ 1 s, not met |
| 1024² Kerr re-trace, closed-form | 1.8 s | **0.73 s** | ≤ 1 s, met |
| 512² Kerr re-trace, tabulated | 2.3 s | 1.5 s | |
| 256² drag preview (one level) | 414 ms | 378 ms | ≤ 50 ms, not met (the viewer's 128² preview: about 95 ms) |
| 1024² fuzzball λ = 1e-3 | 53 s | **19.6 s** | |
| fuzzball / Kerr | 8.3× | **5.1×** | ≤ 3×, not met |

**Accuracy unchanged:**
- Level 4 (tabulated vs closed-form Kerr, 32 cases): at most 0.012% difference from M4.
- Level 2: Johannsen and Manko–Novikov 100% four-colour; ST3Cr λ = 1e-4 98.7% on converged pixels, as before; λ = 0 BH 100%.
- Vitest 92 and Playwright 19 passed.

**What is left.** The tabulated tracer now spends most of its time on its 20 texel fetches per RK stage. The levers left all trade accuracy:
- half-float derivative channels;
- an analytic far field, or larger steps at large r;
- a lower fuzzball step limit.

At this point they are the user's choice.

### M9 accuracy trades, each on its own (user: "try all three of these accuracy trades (separately) so that we can judge each one"), 2026-11-05

`dev/scripts/m9Trades.mjs`, `dev/reports/m9/trades_*.json` / `_log.txt`. All three are view options, off by default: `tableHalf`, `farSteps`, and `maxSteps` (already a control).

- **Speed:** GPU time of one full-resolution level (BH 512², fuzzball 256²), baseline and trade alternating, best of 3.
- **Accuracy:** the trade's image against the baseline's on the same rays (256²). The baseline's own error against the double-precision reference is about 1e-6 rad median for escape directions (M3–M4).

| trade | speed | four-colour vs baseline | escape-direction change, median / p99 (share within 1e-3 rad) | disc emission L1 change |
|---|---|---|---|---|
| **1. half-float derivative tables** (values R32F + derivatives RGBA16F) | **0.77–0.89×, slower** | 99.985–99.995% (BH); 93.9–96.5% (fuzzball) | 3.5–6.5e-5 / 2.3–4.0e-3 rad (96–98%) | 1.4–4.2e-4 (BH); 0.8–2.3e-3 (fuzzball) |
| **2a. larger steps beyond 20 M, up to 4×** | **1.18–1.24×** (BH); none for the Test_FBdetail fuzzball camera, which is inside 20 M | 99.986–99.992% | 3.0–3.6e-4 / 1.1–1.9e-3 rad (97.8–98.8%) | **0.6–0.9e-4** |
| **2b. the same, up to 8×** | 1.18–1.25× (no gain over 4×) | 99.89–99.93% | 1.0e-3 / 2–3e-2 rad (35–53%) | 1.0–1.6e-3 |
| **3. fuzzball max steps 5000 instead of 10000** | **1.35× (λ = 0.005), 1.44× (1e-3), 2.15× (1e-4)** | 97.4–98.8%: rays that escape after 5000 steps now end as time-outs | unchanged for every ray that escapes in both | **0** (the stored crossings all happen before step 5000) |

**Reading:**

1. **Half-float tables:** slower and less accurate. Two fetches per texel cost more on this GPU than the 25% fewer bytes save. Not worth it. A fully half-float table (one fetch, values also in 16 bits) would lose about 1e-3 relative in the metric values; not tried.
2. **Larger far steps (4×):** about 20% faster for distant cameras.
   - Escape directions (the sky, the four-colour view) shift by about 3e-4 rad. That is 300× the baseline's own error, but invisible at 512² with a 15 M screen, where one pixel is 3e-5 rad.
   - The disc image changes by about 1e-4.
   - 8× gains nothing more and costs 10× more accuracy.
3. **Fuzzball step limit 5000:** 1.35–2.15× faster, with **identical disc images**. Only the four-colour and termination views change, where 1.2–2.6% of the pixels become time-outs instead of late escapes. The disc emission comes from the first 3 crossings, which all happen early.

**Not adopted yet:** the user decides which go into the product.

**Decision (2026-11-05):** adopted: larger steps beyond 20 M (up to 4×) and the fuzzball step limit of 5000 (user: "Far 4x + 5000 steps"). Rejected: half-float tables. With the viewer's new defaults (`dev/reports/m9/perf_app.json`), the 1024² Kerr re-trace takes 3.3 s (tabulated) and 0.77 s (closed-form), and a 512² Kerr re-trace 1.2 s. The fuzzball single runs varied too much on this machine to quote; the back-to-back comparison (above) gives 1.35–2.15× for the step limit. Still open: the root-page card, and the merge to `main`.

**Decision (2026-11-05): Stage 1 accepted** (user: "Card + merge"), with the performance numbers above. The root `index.html` links FOORT-GPU from the "Zwaartekrachtgolven en de Einstein Telescope" section; M9 is merged to `main` and pushed.


# Stage 1B

Plan: `FOORT_GPU_STAGE1B_PLAN.md` v1.0, on branch `foort-gpu-1b`. The user asked for B0, B1 and B2 in sequence, stopping at checkpoint B2, so the three are reported together here.

## CHECKPOINT B0 — quality gate, baseline, devices, hygiene (2026-11-08)

### Done

- **Quality-gate harness** `dev/scripts/qualityGate.mjs` (with `gateConfigs.mjs`):
  - the scene set of plan 1.2, 13 scenes at 512²;
  - a chaos mask: Reference at ε vs ε/2;
  - emission, time-averaged and at 3 noisy observer times;
  - delays, the light curve over one period, sky error in image-plane pixels, and termination agreement;
  - chaotic-region totals and class fractions;
  - alternating A/B/A/B GPU timing, best of 3.

  Output is `dev/reports/b0/gate_<config>.json` and `.md`, with pass/fail against the Normal budgets.
- **Tier probe page** `probe.html` (`js/probePage.js`): short Reference/High traces of Kerr and ST3Cr, the device's Msteps/s, predicted 512² and 1024² times, and a copyable JSON report.
- **Report hygiene:** new image reports go to `dev/reports/img/` (git-ignored); JSON/markdown summaries are committed.

### Baseline: High vs Reference (`dev/reports/b0/gate_high.md`; AMD Radeon integrated, Chrome/ANGLE D3D11)

| scenes | chaos | class agreement | sky error, median / p99 (px) | emission L1, time-averaged / noisy | dt p99 (M) | LC correlation | speed-up |
|---|---|---|---|---|---|---|---|
| BH (8 scenes) | ≤ 0.02% | 99.998–100% | 0.021–0.029 / 0.22–0.30 | 0.6–2.3e-4 / 4.3–7.8e-4 | 0.03–0.27 | 1.000000 | 1.17–1.57× |
| ST3Cr λ = 0.05 … 1e-4 | 2.1–3.2% | 97.4–99.99% | identical | identical (0) | 0 | 1.000000 | 1.07–2.06× |
| ST3Cr λ = 0 | 0.08% | 100% | identical | identical | 0 | 1.000000 | 1.04× |

- **Black holes:** High's far steps move sky positions by about 0.03 px (median) and 0.3 px (p99). The time-averaged disc changes by about 1e-4. The noisy frames change by about 5e-4, because slow-light delays shift by up to 0.27 M.
- **Fuzzball:** the Test_FBdetail camera sits inside 20 M, so High's far steps do nothing and the images are identical. Its 5000-step limit only turns 0.01–2.6% of the rays into time-outs: class agreement is below the 99.8% budget, but no emission changes.

### Device round (needs the user)

Please open **`foort-gpu/probe.html`** (after the merge: <https://drmayerson.github.io/foort-gpu/probe.html>) on every device you have, press "Run the probe", and paste the report back. That means other laptops, a Mac, a phone, a discrete GPU. The benchmark (`bench/`) is useful too. This laptop's report (`dev/reports/b0`, run 2026-11-08):

| case | steps/ray | Msteps/s | predicted 512² |
|---|---|---|---|
| Kerr closed-form, Reference | 759 | 1071 | 0.20 s |
| Kerr tabulated, Reference | 759 | 97 | 2.18 s |
| Kerr tabulated, High | 589 | 87 | 1.89 s |
| ST3Cr λ = 1e-3, Reference | 1553 | 24 | 18.1 s |
| ST3Cr λ = 1e-3, High | 1102 | 24 | 12.6 s |

### Decisions to confirm (B0)

- **E1, tier time targets:** the plan's default is ≤ 2 s BH and ≤ 10 s fuzzball at 512². On this laptop, High fits the BH target and misses the fuzzball one (12.6 s).
- **Normal budgets:** unchanged from plan 1.2. High itself fails only the class-agreement budget on the fuzzball, through time-outs.

## CHECKPOINT B1 — fuzzball in unit mass (2026-11-08)

### Done

- **`rescaleToUnitMass(metric)`** (`js/metrics/common.js`): g'_tt = g_tt(Lr'), g'_tφ = g_tφ/L, g'_φφ = g_φφ/L², g'_rr = g_rr, g'_θθ = g_θθ/L², the inverse accordingly. Horizon, termination radius, singularities and their distance, and the critical impact parameter are divided by L.
  - It is applied to ST3Cr and ST3Cr-BH in the registry; M_ADM = 1 now for every metric.
  - `lengthScale` keeps every grid (metric tables, fluid table, ISCO bisection, circular-orbit bands) at its raw node positions, so the same rays are traced.
- **Units:** everything with a length or time is now in units of M:
  - the Test_FBdetail preset (σ = 2/24);
  - `uSing`, the ISCO (reported as 0.7733 instead of 18.558), the delays and the noise time;
  - the tail bins (B2).
- **URL version `v=2`;** Stage 1 fuzzball URLs migrate μ and σ (÷ 24).
- **Converted:** all dev scripts and tests that set fuzzball cameras or emission in raw units, to units of M (`m3Screens`, `m6*`, `m7*`, `m9*`, e2e `m6.spec`, unit `m6.test`). `m6GpuVsFoort` converts to FOORT's raw coordinates (camera, terminations, μ, σ ÷ 24; J × 24).

### Tests

- **Unit** (`dev/tests/unit/b1.test.js`):
  - wrapped vs raw metric and inverse at 2000 random points per λ (0.05, 5e-3, 1e-4), all within 1e-12;
  - M_ADM of the wrapped metric = 1 from the g_tt falloff;
  - λ = 0 b_c = 49.7146 / 24;
  - identical table node positions and the same ISCO (÷ 24);
  - the redshift unchanged inside and outside the ISCO;
  - URL migration;
  - the preset.
- **Images unchanged up to float32 noise** (`dev/scripts/b1Compare.mjs`, `dev/reports/b1/compare.json`): the rescaled Reference against the raw Reference records cached in B0, 512².

  | scene | escape direction median | r, dt, g medians | emission L1 on non-chaotic pixels |
  |---|---|---|---|
  | λ = 0.05 | 2.8e-6 rad | 1.5e-6, 8e-6 M, 6e-7 | 4.3e-3 |
  | λ = 5e-3 | 3.1e-6 | 1.9e-6, 1.1e-5 M, 7e-7 | 2.4e-5 |
  | λ = 1e-3 | 2.6e-6 | 1.9e-6, 1.1e-5 M, 7e-7 | 2.5e-5 |
  | λ = 1e-4 | 2.1e-6 | 2.0e-6, 1.2e-5 M, 8e-7 | 4.2e-5 |
  | λ = 0 | 2.3e-6 | 1.3e-6, 8e-6 M, 4e-7 | 8.5e-6 |

  Terminations agree on 99.0–99.98% of the non-chaotic pixels and 100% at λ = 0. The rest are float32 differences amplified by chaos. The mask used here, termination class at ε vs ε/2, misses some chaotic pixels, which explains λ = 0.05.
- **M6 comparisons rerun with converted parameters:**
  - GPU vs CPU (`dev/reports/m6/level2_*.json`): λ = 5e-3 96.34% four-colour on converged pixels (M6: 96.29%), emission L1 1.5e-3 (1.5e-3); λ = 0 100% (100%), 9.9e-6 (1.3e-5); λ = 1e-4 98.77% (98.72%), 6.2e-5 (4.4e-5).
  - GPU vs FOORT (`foort_*.json`): 92.47% four-colour (92.79%); emission on pixels with ≤ 3 passes 7.4e-4 (7.2e-4).
- **Full suites pass** (Vitest 101, Playwright 19 at B1; at B2, see below).

## CHECKPOINT B2 — all crossings: the binned tail (2026-11-08)

### Done

- **Record:**
  - the first 3 crossings exactly as before (slow light, noise);
  - crossings 4, 5, … up to max passes accumulated in **8 log-r bins** (inner cut to 50 M) at trace time, each one float: W = Σ F g^p, plus the emission-weighted log-r centroid in its low 8 mantissa bits;
  - the display adds Σ_b W_b J(r_b), **without noise or slow light**, since many crossings with spread-out delays average the fluctuations to 1 (legend, README).
- **Render-target budget:**
  - 6 RGBA32F attachments: rec0–3, tail 4–5; attachment 6 free for the B5 continuation state, within 8;
  - devices with fewer than 6 draw buffers fall back to 3 crossings, and the performance table says so;
  - the display binds 2 levels × 6 textures plus noise and fluid, 14 of the 16 guaranteed units;
  - records are 24 floats per pixel.
- **Re-tracing:** the redshift power, fudge factor and max passes now re-trace; max passes goes up to 20.
- **JS:** `decodeTail`/`binTail` (the shader's rule, used by the tests) and `discIntensity(..., tail)`.

### Tests

**Recovered intensity and the tail approximation** against the CPU reference with every crossing kept (`dev/scripts/b2Tail.mjs`, `dev/reports/b2/tail.json`; Test_FBdetail, 64², 10000 max steps):

| λ | true share in the first 3 crossings | GPU recovered (plan ≥ 98%) | GPU first 3 only | tail approximation L1 / total, K = 4 | K = 8 | K = 16 |
|---|---|---|---|---|---|---|
| 0.05 | 47.2% | **105.0%** | 48.9% | 8.9e-2 / −8.8e-2 | **8.3e-3 / −4.8e-3** | 3.0e-3 / +1.4e-3 |
| 5e-3 | 45.2% | **99.3%** | 45.2% | 4.9e-2 / −3.8e-2 | **1.7e-2 / −9.6e-3** | 5.9e-3 / −4.6e-3 |
| 1e-4 | 93.0% | **100.5%** | 93.0% | 8.6e-2 / +8.1e-2 | **3.0e-3 / −7.2e-4** | 1.6e-3 / −6.8e-4 |

- **Tail approximation** (plan ≤ 2%): it compares the binned J(centroid) with the exact Σ J(r_k) on the same CPU rays, so it isolates the approximation. **K = 8 passes everywhere (0.3–1.7%)**; K = 4 does not.
- **Recovered share:** it compares GPU (float32) and CPU (double) rays, whose trapped orbits are chaotic. The 105% at λ = 0.05 is that distribution-level difference (the GPU's first 3 crossings alone already give 48.9% against 47.2%), not the tail.
- **Black holes** (`dev/scripts/b2BH.mjs`, `dev/reports/b2/bh.json`; Kerr, 512²):
  - only pixels with more than 3 crossings change: 108–272 photon-ring pixels, +0.03–0.07% of the flux;
  - pixels with ≤ 3 crossings: 0 changed;
  - the first 16 floats of every record are bit-identical with and without the tail.
- **FOORT parity** (M2 runs, λ = 0.005; `m6GpuVsFoort.mjs`): on FOORT's pixels with more than 3 passes and the same four-colour class, emission L1 falls from **0.81 to 0.17** (FOORT-parity crossings) and from **0.96 to 0.21** (interpolated). The rest is chaotic ray divergence between the two integrators.
- **Unit** (`dev/tests/unit/b2.test.js`): shader packing ↔ `decodeTail` ↔ `binTail` identical; quantization below 1e-4 in W and 1/510 of a bin in the centroid; tail = exact when each bin holds one radius; max passes cuts the tail.
- **Full suites:** Vitest 106 passed, Playwright 19 passed, `tsc --checkJs` clean.

### Images (git-ignored, `dev/reports/img/b2/`)

`b2_before_after.png`: ST3Cr disc emission, time-averaged, 512², Test_FBdetail, the same exposure per pair. The top row is the first 3 crossings (Stage 1), the bottom row all crossings (B2), for λ = 0.05, 5e-3, 1e-3, 1e-4 and 0. The interiors gain the bright, fine-grained light of trapped rays; the λ = 0 black hole is unchanged.

### Open issues / for the user

1. **Checkpoints B0–B2:** accept them, and confirm:
   - **E1:** ≤ 2 s BH, ≤ 10 s fuzzball at 512²;
   - **the Normal budgets;**
   - **E2:** K = 8 (recommended).
2. **Device round:** run `probe.html` on your other devices and paste the reports.
3. **Merging** `foort-gpu-1b` to `main` needs your approval. The branch is pushed; `main` is untouched.
