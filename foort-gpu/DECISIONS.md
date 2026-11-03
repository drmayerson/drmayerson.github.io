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
