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
