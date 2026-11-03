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

  The 1e-12 target is applied to the scaled measure, on points where FOORT's own metric is valid. — Reason: g_tφ is often the small remainder of large cancellations. At the worst ST3Cr λ = 1e-4 point, ω_ab has condition number 1.5e7 and the ring integral cancels it by another ~1e3. The double-precision rounding floor in raw relative terms is therefore ~1e-6, and FOORT and JS differ there only through last-bit libm differences. Raw numbers are still reported. **Needs the user's confirmation (CHECKPOINT M1).**
- 2026-11-03 — `ST3CrBH` (λ = 0) reports `horizon: {kind: 'none'}`. The horizon is at base r = 0, i.e. x → −∞ in `x = log r`. Rays will be cut at a configurable `r_cut` (M6).
- 2026-11-03 — Validity checks (`validate()`, `validityRadius()`) test, at sample points: finite components, Lorentzian signature (g_rr > 0, g_θθ > 0, det(t–φ block) < 0), and no CTCs (g_φφ > 0). An ST3Cr point with Q ≤ 0 shows up as non-finite.
