# FOORT-GPU decisions

Format: date — decision — alternatives — reason. Plan-level decisions D1–D9 are in
`FOORT_GPU_STAGE1_PLAN.md` Section 10; this file records their confirmation and every
non-trivial implementation choice.

## Confirmed by the user before M0

- 2026-11-03 — **D1**: folder `foort-gpu/` in `drmayerson.github.io`, plain ES modules + JSDoc, no build step, dev tooling in `foort-gpu/dev/`.
- 2026-11-03 — **D3**: Johnson-SU envelope in FOORT's coordinate `r`; noise sampled at `log(r/M_ADM)`.
- 2026-11-03 — **D4**: placeholder FFT noise in M7; the agent builds inoisy in M8.

## Open (to decide at CHECKPOINT M0)

- **D2** graphics API — default WebGL2-first unless WebGPU > ~1.5× faster on the main laptop.
- Default resolutions, tile size, step budgets.
- D5–D9 still on their proposed defaults (not yet relevant).

## M0 implementation choices

- 2026-11-03 — Benchmark integrates in `x = log(r - r_h)` with BL `r` recovered as `r_h + e^x`, Hamiltonian `H = W / (2 Sigma)` in Carter form, keeping the `W dSigma` terms (exact even off-shell). — Alternatives: plain `r` (far too many steps at r = 1000 with FOORT's step rule), dropping the `W` terms. — Reason: matches the plan's grid coordinate (Section 3.4) so step counts are representative of the real app.
- 2026-11-03 — Benchmark camera built in JS double precision with `TetradCamera.fromStaticObserver` (port of FOORT `ViewScreen`), passed to both shaders as `mat4` vielbein + `mat4` g_dd; per-pixel flat momentum and `p_t = 1` normalization done in float32 in the shader. — Alternative: per-pixel momenta precomputed on the CPU. — Reason: keeps the general tetrad camera of Section 1.3 and avoids a per-pixel upload.
- 2026-11-03 — Benchmark fairness: one draw (WebGL2, scissored full-screen triangle into one RGBA32F target) or one dispatch+submit (WebGPU, 8×8 workgroups, storage buffer) per tile, waited on per tile (fence polling via `MessageChannel` yields / `onSubmittedWorkDone`); same tile size; one warm-up run; median of N runs; GPU time from timer/timestamp queries where available, else wall-clock only. — Reason: the plan asks for the same algorithm, step control and tile sizes; per-tile waiting is what the app will do to stay under the GPU watchdog.
- 2026-11-03 — Termination codes: 1 horizon (`r < r_h (1 + 0.01)`), 2 boundary sphere (`r > 1.01 r_cam`), 3 timeout, 4 NaN/Inf. Four-colour quadrant computed on the CPU from the escape `(theta, phi mod 2 pi)` with FOORT's `FourColorScreenDiagnostic` rule.
- 2026-11-03 — Pixel convention: pixel centres, `unit = (i + 0.5)/N` (both backends), `beta` increasing upwards. FOORT's `SimpleSquareMesh` convention will be matched exactly in M2 (parity runs).
