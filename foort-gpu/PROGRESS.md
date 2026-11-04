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
