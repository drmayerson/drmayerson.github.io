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
