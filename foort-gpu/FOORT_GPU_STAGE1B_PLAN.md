# FOORT-GPU — Stage 1B plan

Status: v1.0 (2026-11-08). Owner: Daniel Mayerson. Executor: Claude Code, in `drmayerson.github.io/foort-gpu/`.

Stage 1 is complete and accepted (see `PROGRESS.md`, `DECISIONS.md`, `README.md`, `FOORT_GPU_STAGE1_PLAN.md`). Stage 1B improves the Stage 1 viewer before Stage 2 (the spaceship game) starts:

- it fixes the known physics gaps;
- it makes tracing faster on laptops like the user's (AMD integrated GPU) **without giving up good physics on better machines**;
- it adds a normal/expert UI, direct interaction, science readouts, physical units, and PNG/video export.

---

## 0. Working agreement (unchanged from Stage 1, with additions)

- **Read first:** `FOORT_GPU_STAGE1_PLAN.md` (Section 0 still applies), `DECISIONS.md`, `PROGRESS.md` and `README.md`. Then read this file.
- **Milestones:** work milestone by milestone (Section 6). Each milestone ends in a **CHECKPOINT**:
  - run the listed tests;
  - append a report to `PROGRESS.md` under a new top-level heading `# Stage 1B`, with numbers, images and open issues;
  - commit, then **stop and wait for the user's go-ahead**.
- **Decisions:** record choices in `DECISIONS.md` under a new heading `## Stage 1B`. Section 8 lists open decisions with proposed defaults; use the default and flag it if the user has not answered when it becomes relevant.
- **Branch and merging:** work on branch `foort-gpu-1b`. Merge to `main` only at checkpoints the user approves.
- **Scope of changes:** keep the no-build-step rule, WebGL2 as the backend, and the backend interface. Touch nothing outside `foort-gpu/`.
- **Precedence:** where this file conflicts with the Stage 1 plan, this file wins.
- **Backward compatibility:** URLs from Stage 1 must keep working. Add a URL version field and migrate old parameters, in particular the fuzzball emission parameters after the rescaling of B1.
- **Translation is deferred.** The UI stays English in Stage 1B.

---

## 1. Goals and the accuracy policy

### 1.1 Goals

1. **Physics:**
   - recover the fuzzball emission lost to the 3-crossing record;
   - give the fuzzball a noise field that actually covers its emitting radii;
   - add a more physical fluid option for horizonless metrics;
   - rescale the fuzzball to unit mass;
   - allow equal-mass, same-disc comparisons.
2. **Speed:** all exact speedups, plus accuracy-budgeted ones, organized in quality tiers (Section 1.2).
3. **UI:** a normal mode and an expert mode; direct interaction; compare mode; persistence; ETA and cancel; phone-safe defaults.
4. **Science:**
   - a time-averaged image;
   - light curves (total and per image order);
   - an EHT-resolution blur;
   - a pixel inspector that shows a ray's path;
   - physical units with mass and distance presets;
   - PNG and video export.

### 1.2 Accuracy policy: quality tiers and the quality gate

Speedups must not quietly degrade the physics. Every trace runs at a **quality tier**.

| Tier | Contents | Who gets it |
|---|---|---|
| **Reference** | Stage 1 integrator without accuracy trades: ε = 0.03, no larger far steps, max steps 5000 (BH) / 10000 (fuzzball), every pixel traced, all crossings (B2). Exact speedups (B5) are allowed, because they do not change results beyond float32 rounding. | Science comparisons, validation; always selectable |
| **High** | Reference + the trades the user accepted in Stage 1 (far steps up to 4× beyond 20 M; fuzzball max steps 5000). This equals today's viewer. | Default on capable machines |
| **Normal** | High + accuracy-budgeted speedups (B6: larger near-field ε or error-controlled steps; adaptive refinement) that pass the quality gate below | Default on laptops like the user's |
| **Draft** | Whatever is fastest, for previews while dragging only; never the settled image | Interaction previews |

**Automatic tier selection:**
- At startup, run a ~100 ms probe trace and estimate the photon-steps per second.
- Pick the **highest** tier whose predicted full trace at the default resolution fits a time target: proposed ≤ 2 s for BH mode and ≤ 10 s for fuzzball mode (decision E1).
- The user can override the tier (expert panel, URL `quality=`).
- Show the active tier in the status line.

**Quality gate.** A dev script, built in B0, compares any configuration against Reference on a fixed **scene set** at 512²:

- Kerr a = 0 and a = 0.94 at inclinations 17° and 80°;
- Kerr a = 0.998 at 80°;
- Johannsen, Manko–Novikov and RN examples;
- ST3Cr λ = 0.05, 5e-3, 1e-3, 1e-4, and 0.

It reports the following measures.

- **Chaos mask:** pixels whose Reference result changes between ε and ε/2, in termination class or in sky position by more than 1 px (see below). Per-pixel budgets exclude these pixels. On them, only distribution-level budgets apply.
- **Disc emission (primary product).** It is evaluated time-averaged (σₙ = 0) and at 3 fixed observer times with noise. Measures: relative L1, per-pixel relative error p99, total flux.
- **Delays `dt`** at the crossings: error p99 in units of M.
- **Light curve** over one noise period: correlation with Reference, and relative RMS difference.
- **Sky position error in image-plane pixels:** the change of the escape direction divided by the local Jacobian of escape direction with respect to pixel position, the Jacobian estimated by finite differences on the Reference record. This is how far a fixed sky point's image would move. A raw radian difference is not used, because it overstates errors away from the critical curve.
- **Termination-class agreement** on non-chaotic pixels.
- **Timing:** GPU timer queries; alternate configurations A/B/A/B and take the best of N, because the user's iGPU varies 2–3× between runs.

**Budgets for Normal (vs Reference, same resolution, non-chaotic pixels).** These are initial values; report numbers at checkpoints rather than loosening them silently.

| Measure | Budget |
|---|---|
| emission relative L1 (time-averaged and noisy frames) | ≤ 3e-3 |
| per-pixel emission relative error, p99 | ≤ 2% |
| total flux | within 0.2% |
| `dt` error, p99 | ≤ 0.5 M |
| light-curve correlation over one period | ≥ 0.999 |
| termination-class agreement | ≥ 99.8% |
| sky position error | no worse than High (median and p99 in px) |
| chaotic region (fuzzball) | total emission there within 2%; fractions of escaped / trapped / singular rays within 1 percentage point |

High's own numbers against Reference (from the Stage 1 trades) are measured and reported once in B0, for context.

---

## 2. Findings from the Stage 1 audit (motivation; where to look)

1. **3-crossing record.** `shaders/glsl/common.glsl` keeps `cr[3]`. PROGRESS "CHECKPOINT M6" measured that the first 3 crossings keep only 45–48% of the fuzzball's intensity at λ = 0.005–0.05; 8 crossings would keep only 55%. FOORT sums all passes, so GPU and FOORT also differ there.
2. **Noise coverage.**
   - `noise/inoisy_lg21.json` spans `log(r/M)` ∈ [−3, 5.24], i.e. r = 0.05–190 M, and lookups clamp in x (`display.glsl`, `noiseField.js`).
   - The fuzzball's cap structure lies at r ≈ 0.007–0.02 M at λ = 0.005, and its emission at about 1e-3–0.2 M. Most of the cap therefore samples the clamped edge: noise frozen in r.
   - The field's correlation times follow a Keplerian Ω, which is meaningless inside the cap.
3. **Fluid in horizonless metrics.** FOORT's bisection finds the outer ISCO (18.56 coordinate units at λ = 0.005). Inside it, the fluid plunges with that orbit's E and L straight through the inner stable band (r < 0.31). That is FOORT parity, but not physical.
4. **Units.** ST3Cr is traced in coordinates with M_ADM = 24, so the Test_FBdetail emission parameters (μ = 0, σ = 2) are in coordinate units, about 0.08 M. The BH and fuzzball presets are not comparable.
5. **Speed.**
   - The tabulated path is lookup-bound (20 RGBA32F `texelFetch` per RK stage in `trace.glsl`).
   - The closed-form Kerr shader is 4.3× faster and validated, but it is not the default (`js/ui/controls.js`, key `path`).
   - ST3Cr has the exact identity g^xx = g^θθ (= Q^{-1/2}/r² in x = log r, because the base space is conformally flat), so one of the five tables is redundant.
   - Trapped fuzzball rays create long tails: mean 1566 steps vs p90 6241 at λ = 1e-3.
   - The accuracy of the baseline (≈ 1e-6 rad median in escape direction) is far below one pixel; ε = 0.03 was chosen for FOORT parity, not by a study.
6. **Only one machine was measured** (AMD integrated GPU, Chrome/ANGLE D3D11). No discrete GPU, Apple silicon, or phone numbers exist.

---

## 3. Physics work

### 3.1 Fuzzball rescaled to unit mass (B1)

Express ST3Cr (λ > 0) and ST3Cr-BH (λ = 0) in units of M_ADM = (3P + q0 − P³)/2 = 24, with t = M t' and r = M r'.

- **Metric:**
  - g'_tt(r', θ) = g_tt(M r', θ)
  - g'_tφ = g_tφ(M r', θ) / M
  - g'_φφ = g_φφ(M r', θ) / M²
  - g'_rr = g_rr(M r', θ)
  - g'_θθ = g_θθ(M r', θ) / M²

  (The overall factor M² is dropped; null geodesics and redshift ratios are unaffected.) Transform the inverse accordingly.
- **Implementation:** a generic wrapper `rescaleToUnitMass(metric)` in `js/metrics/common.js`, applied in the registry. The raw metric stays available, for the FOORT parity harness.
- **Everything that carries a length or time scales:** termination radius, singularity positions and ε, the D6 center height and ring radius in `uSing`, ISCO and stable bands, Johnson μ and σ, camera presets, table grid ranges, fluid table, delays and the noise period.
- **Presets:** Test_FBdetail becomes r_cam = 10.4167, screen 6.25, μ = 0, σ = 2/24 (exact conversions).
- **Old URLs:** migrate their fuzzball emission parameters (URL version field).
- **Tests:**
  - wrapped vs raw metric at random points, under the scaling, to 1e-12;
  - M_ADM of the wrapped metric = 1 from the large-r falloff;
  - λ = 0 b_c scales by 1/24;
  - the M6 GPU-vs-CPU and GPU-vs-FOORT comparisons rerun with converted parameters: same agreement as before;
  - images unchanged up to float32 noise.

### 3.2 All disc crossings: binned tail (B2)

**Record design.** Keep the first 3 crossings exactly as now (they carry slow light and noise). Accumulate every later crossing (k > 3, up to `maxPasses`) into **K log-r bins**. Each bin stores:
- `W_b = Σ F_k g_k^p`;
- `X_b = Σ F_k g_k^p log r_k` (for the weighted centroid).

The display then adds `Σ_b W_b J(exp(X_b / W_b))`.
- Use bins in log r over the emitting range, with edges chosen per metric from the fluid table range. Propose K = 8 (decision E2).
- **The tail is drawn without noise and without slow light**: each trapped ray contributes many crossings with long, spread-out delays, so their fluctuations average out (E[exp(σₙX − σₙ²/2)] = 1). This is a physical approximation, not only a convenience. Say so in the legend and the README.
- Changing the redshift power `p`, the fudge factor or `maxPasses` re-traces (W depends on them). μ, γ, σ, exposure, tone map and noise stay redraw-only.

**Render-target budget (WebGL2 `MAX_DRAW_BUFFERS`; guaranteed ≥ 4, typically 8):**
- design the packing so the full feature set fits in **≤ 8 RGBA32F attachments**: the record (4), the tail bins (2 at K = 8) and the ray-continuation state for compaction (B5, at least 1, by packing `(x, t, p_x, p_δ)` and reusing the record's first texel for `(term/passes/hemisphere, steps, δ, φ)` while a ray is unfinished);
- devices with fewer attachments fall back: fewer bins, then no compaction, and a note in the performance table;
- the `|H|` debug option may keep using the crossing-3 slot.

**Tests:**
- against the CPU reference with all crossings kept (`dev/scripts/m6Passes.mjs` setup), Test_FBdetail camera, λ = 0.05, 5e-3 and 1e-4: recovered share of the true intensity ≥ 98%;
- the tail approximation (centroid J) vs the exact Σ J(r_k): tail relative L1 ≤ 2%;
- FOORT parity (M2 runs, parity mode): emission agreement improves where Stage 1 had > 3 passes;
- BH images: photon-ring pixels gain their n ≥ 4 contributions, with no other change.

### 3.3 Fluid model for horizonless metrics: stable bands (B3)

Add a fluid option **"banded"** for horizonless metrics:
- circular orbits in every stable band (bands are already computed and reported in Stage 1);
- in each unstable gap, a plunge from the inner edge of the outer band, using that orbit's E and L (FOORT's ISCO construction applied per band), until the next stable band.

Keep FOORT's model selectable ("FOORT (parity)"). Propose: banded is the default for horizonless metrics in normal mode, FOORT's model in expert/parity work (decision E4; show both at the checkpoint).

**Tests:** u·u = −1 and u^μ continuity checks; the λ = 0.005 bands reproduced; images and flux compared between the two models; FOORT's model unchanged against the M5 parity runs.

### 3.4 Envelope radius option and equal-mass comparison presets (B3)

- **Option** "envelope radius": FOORT coordinate r (default; D3 stays) **or** circumferential radius `sqrt(g_φφ)` on the equator. It is applied in the display shader through a 1D table r → R_circ per metric, so it stays redraw-only.
- **Comparison presets** with the same camera and the same disc defined in circumferential radius, in units of M:
  - Kerr a = 0 vs ST3Cr λ = 0.005;
  - Kerr a = 0 vs ST3Cr λ = 0;
  - Kerr a = 0.5 vs ST3Cr λ = 0.05.

  These work with compare mode (B7).

### 3.5 Fuzzball noise fields (B4)

- **Radial range:** r = 1e-4 to 200 M. Respect the 50 MB/file limit; keep the total committed noise data modest and report sizes.
- **Flow from the viewer's own fluid table Ω(r).** Extend the custom inoisy model `tools/noise/inoisy_foort/foort_logr` to read a tabulated Ω(r) (and use it for the correlation-time and advection terms) instead of Keplerian.
- **Ω depends on λ.** Generate fields at a few **anchor** λ values (proposed: 0, 1e-3, 5e-3, 0.05; decision E3) and pick the nearest anchor at runtime. State the anchor in the legend.
- **Time sampling:** clamp the minimum correlation time to ≥ 3 Δt (Δt = T/N_t) to avoid aliasing; check this numerically in `inspect_field.py`.
- **Coverage guard** for every field: outside its x-range, fade σₙ → 0 over one correlation length instead of clamping. Add a "noise coverage" debug view (fraction of emission-weighted crossings inside the field's range). Apply this to BH mode as well.
- BH mode keeps `inoisy_lg21` as its default.
- **Tests:** contract validation, periodicity, and per-radius statistics; coverage ≥ 99% of the emission weight for the fuzzball presets; user approval of the animation at the checkpoint.

---

## 4. Speed work

### 4.1 Exact speedups — results unchanged beyond float32 rounding (B5)

1. **Closed-form shaders by default where they exist.**
   - Make closed-form Kerr the default for Kerr. Keep "tabulated" as an expert/validation option.
   - Add a **dev-time code generator** `tools/codegen/` (SymPy) that writes GLSL for G0…G4 and their x- and θ-derivatives from symbolic metrics: Johannsen, Manko–Novikov, RN, and Kerr again (to cross-check the hand-written shader).
   - Generated `.glsl` files are committed, so there is no runtime build. They must implement the same metric interface as `trace.glsl`, including the `dmomQ` split, so constraint projection works for any metric.
   - **Watch Manko–Novikov:** its exponential factors near the horizon must not overflow float32 at the termination radius r_term. If a generated shader cannot be made safe, keep the tabulated path for that metric and document why.
   - **Tests:** generated vs JS metric at random points (float32 tolerance); Level 4-style comparison vs the tabulated path; the quality gate shows Reference-level agreement; compile time ≤ Stage 1's.
2. **ST3Cr table identity.**
   - A per-metric flag `G3equalsG4` (`js/metrics/registry.js` → bake → shader `#define`) that skips table 3 and reuses G4: 16 instead of 20 fetches per stage.
   - Verify the identity to 1e-12 in double, and the images unchanged.
3. **Texel reuse across RK stages.**
   - Cache the 20 (or 16) texels of the current grid cell in registers and refetch only when the cell index changes.
   - Benchmark it on the user's laptop **and** at least one other GPU. Adopt it only if it is faster on both, since register pressure can reduce occupancy.
4. **Ray compaction for long rays.**
   - **Phase A** traces every pixel up to N₁ steps (proposed 1500, tuned) and writes the continuation state of unfinished rays (Section 3.2 packing).
   - Read back a termination mask asynchronously (PBO + `fenceSync`) and build a dense index list of unfinished pixels.
   - **Phase B** traces the list as a compact image, using an index texture → pixel mapping. Scatter the results back with a point-draw pass, or keep an indirection map read by the display.
   - Can repeat at N₂ for very long tails.
   - **This must be exact:** compacted and single-pass records identical up to float32 nondeterminism. Test this on the whole scene set.
   - The same "trace a list of pixels" machinery serves adaptive refinement (4.2).
5. **Free and cached interaction** (results identical by construction):
   - **Camera azimuth is display-only:** in an axisymmetric spacetime, rotating the camera about the axis adds a constant to every crossing φ_k and every escape φ. Apply it as a display uniform; no re-trace.
   - **Record cache (LRU):** keep the records of recent views keyed by everything that affects a trace, for instant switching back and for compare mode. Memory budget is configurable (proposed 256 MB desktop, 64 MB phone).
   - **Idle pre-tracing:** after a view completes and the GPU is idle, trace neighbouring views (λ ± one slider notch, inclination ± 5°) at coarse resolution into the cache. Cancel instantly on input. Default on for desktop, off for phones (expert toggle).

Report for each item: speedup per scene (BH and fuzzball), on the user's laptop and on any other device available.

### 4.2 Accuracy-budgeted speedups — Normal tier only, must pass the quality gate (B6)

1. **Near-field step size.**
   - Study ε ∈ {0.03, 0.04, 0.05, 0.06, 0.08} (with the far-step rule kept) on the scene set.
   - Also try an embedded error-controlled integrator (e.g. Bogacki–Shampine 3(2) or Dormand–Prince 5(4)), with the tolerance set from the image-plane pixel size and the grid cell size.
   - Adopt for Normal the fastest variant that passes every budget. RK4 + FOORT's rule stays the Reference integrator.
2. **Adaptive refinement (a GPU `SquareSubdivisionMesh`, after FOORT's `Mesh.h`).**
   - From the coarse level (already traced and read back for auto exposure), mark cells for refinement when their corners differ in termination class or crossing count, or exceed thresholds in sky-position jump (px), crossing r, g, or `dt` differences.
   - Trace only the marked fine pixels, using the 4.1-4 index-list machinery, in stages (stride 4 → 2 → 1).
   - Fill the others by interpolating the records:
     - interpolate φ with wrap-around and escape directions on the sphere;
     - never interpolate across different topologies;
     - interpolate the tail bins too.
   - Make thresholds tier parameters. Reference and High always trace every pixel.
   - Report the fraction of pixels traced per scene and the speedup.
3. **No other trades without the user's approval.** Half-float tables were measured in Stage 1 to be slower and less accurate — do not revisit.

---

## 5. UI, interaction, science readouts, units, export

### 5.1 Normal and expert panels (B7)

A toggle at the top switches modes (URL `ui=normal|expert`); the state is preserved across the switch.

**Normal panel:**
- **Spacetime:** black hole / fuzzball. For black holes, spin a (Kerr only; the other BH metrics are expert). For fuzzballs, a λ log slider ending in a "λ = 0 (black hole)" position.
- **View:** viewing angle, zoom.
- **Time:** play/pause and speed.
- **Units:** the mass preset (5.4).
- **Display:** brightness (auto exposure on, with an offset); "time-averaged"; "telescope resolution" (EHT blur).
- **Compare:** on/off.
- **Export:** snapshot, record video.
- The quality tier is shown, not chosen.

**Expert panel:** everything that exists now, plus the new options:
- the tier override;
- ε / integrator;
- refinement thresholds;
- compaction on/off and N₁;
- tail bins;
- fluid model;
- envelope radius;
- noise field and anchor;
- record cache size;
- idle pre-tracing;
- all debug views, including the new "noise coverage" and "refined pixels" views.

Generate both panels from the existing `CONTROLS` / registry mechanism (tag each control `normal` or `expert`), not as two hand-written UIs.

### 5.2 Interaction (B7)

- **Drag on the image:**
  - horizontally: azimuth (display-only, instant);
  - vertically: inclination (re-trace, with a Draft preview while dragging).
- **Wheel or pinch:** zoom (screen size), with an instant digital zoom of the current image while the re-trace runs.
- **Shift-drag or two-finger drag:** pan (screen centre).
- **Buttons:** fullscreen; hide panel.
- **Keyboard shortcuts** (listed in a `?` overlay):
  - space: play/pause
  - f: fullscreen
  - h: hide panel
  - s: snapshot
  - r: record
  - e: expert/normal
  - c: compare
  - arrows: azimuth/inclination
  - + and −: zoom
- **Persistence:** remember the last view in `localStorage`. The URL takes precedence; add a "reset to defaults" button.
- **Long traces:** a progress bar with an ETA from the running step-rate estimate, and a cancel button. Warn before starting a trace estimated above 15 s, with a suggestion (lower resolution or tier).
- **Compare mode:**
  - two configurations A and B sharing camera and observer time;
  - layouts: split screen (draggable divider), side by side, or blink (toggle at a chosen rate, or by key);
  - uses the record cache;
  - presets from 3.4;
  - in expert mode, B can differ in any parameter; in normal mode, B is "the other spacetime family" at matched settings.
- **Phone-safe defaults:** from the capability check and the startup probe, choose the resolution, max steps, cache size and tier; test on real phones at the checkpoint.

### 5.3 Science readouts (B8)

1. **Time-averaged image.** A toggle that sets the noise factor to its mean (σₙ = 0 is exactly the time average, since E[exp(σₙX − σₙ²/2)] = 1). The tail is static anyway. Instant, display-only.
2. **Light curves.**
   - Render the linear (pre-tone-map) intensity split by image order into an RGBA float target: (n = 1, n = 2, n = 3, tail).
   - Reduce it on the GPU by downsampling passes to 1×1, and read it back asynchronously (PBO + fence) every frame.
   - Plot a scrolling strip chart (2D canvas) of total flux and, optionally, the per-order curves, against observer time in M and physical units (5.4).
   - Show the period T of the noise field on the time axis.
   - **Test:** the reduced flux equals a CPU sum over a read-back frame to 1e-5; time-averaged flux equals the σₙ = 0 flux to within sampling noise over one period.
3. **Telescope (EHT) resolution.**
   - A separable Gaussian blur of the linear intensity before tone mapping, with FWHM in µas (default 20 µas, decision E5), converted to screen units through the mass and distance preset: screen coordinates are impact parameters in M, and 1 M subtends θ_g = GM/(c²D).
   - Use a downsampled pyramid for wide kernels.
   - Disabled in dimensionless units, or the user gives the beam in M directly.
4. **Pixel inspector.**
   - Click (or tap and hold) a pixel. The double-precision CPU reference (`js/ref/cpuTracer.js`, in a worker) traces that ray with the current view parameters.
   - An inset panel then shows:
     - the path in the meridional (ρ, z) and equatorial (x, y) projections, in units of M, with the horizon (or the fuzzball's D6 centers and D0 ring) drawn;
     - the crossings marked with r, g and `dt`;
     - the GPU record of that pixel next to the CPU values;
     - the termination reason and step count.
   - Pin up to 3 inspected rays.

### 5.4 Physical units (B8)

A units selector with presets:
- dimensionless (M);
- Sgr A* (M = 4.3e6 M☉, D = 8.28 kpc);
- M87* (M = 6.5e9 M☉, D = 16.8 Mpc);
- 10 M☉ stellar-mass black hole (D = 1 kpc);
- custom M and D.

Check these values against current literature and cite the sources in `DECISIONS.md` (decision E6).

Derived quantities:
- the time unit GM/c³ (= 4.925 µs per M☉);
- the length unit GM/c² (= 1.477 km per M☉);
- the angle θ_g = GM/(c²D).

For reference, θ_g ≈ 5.1 µas for Sgr A* and 3.8 µas for M87* with the values above.

Use them for:
- the clock (observer time in M and in s/min/h/days);
- the time speed control, with a "×real time" option (for Sgr A*, real time is about 0.048 M/s);
- a scale bar on the image (M and µas);
- light-curve axes;
- the EHT beam.

Lengths in the panels show both M and the physical unit.

### 5.5 Export (B9)

- **PNG snapshot** of the displayed image at trace resolution, optionally with the scale bar, legend and clock burned in, and the full view state embedded (PNG `tEXt` chunk with the URL).
- **Video:**
  - `canvas.captureStream(0)` + `requestFrame()` + `MediaRecorder` (WebM VP9 where available, MP4 where Safari offers it; feature-detected).
  - Render frames at a fixed observer-time step, not wall-clock, so the video is smooth regardless of GPU speed.
  - Options: duration, frames per second, resolution, and **"one noise period"** for a seamless loop (exactly T; not seamless with procedural advection on — say so).
  - Show progress and allow cancel.
- `.dat` export is **not** in scope.

---

## 6. Milestones

### B0 — Baseline, quality gate, devices, hygiene

**Deliverables:**
- **Quality-gate harness:** `dev/scripts/qualityGate.mjs`, with the scene set, chaos mask, measures, and A/B/A/B timing (Section 1.2). It produces a markdown/JSON report.
- **Baseline report:** Reference vs High on the scene set.
- **Device round:** ask the user to open the benchmark and a new "tier probe" page on every device available to them (other laptops, a Mac, a phone, a discrete GPU) and paste the reports.
- **Repo hygiene:** stop committing PNG reports into the published branch. Write new reports to a git-ignored folder, or to a non-published branch `foort-gpu-reports`. Keep small JSON summaries in `dev/reports/`.

**CHECKPOINT B0:** baseline numbers; device numbers; confirm the Normal budgets and the tier time targets (E1).

### B1 — Fuzzball in unit mass

**Deliverables:** Section 3.1 (wrapper, presets, URL migration, all scaled quantities).

**Tests:** as listed in 3.1; the full Vitest/Playwright suites pass.

**CHECKPOINT B1.**

### B2 — All crossings (binned tail) and the render-target budget

**Deliverables:** Section 3.2, including the ≤ 8-attachment packing design that leaves room for compaction state, and the fallbacks.

**Tests:** as listed in 3.2.

**CHECKPOINT B2:** fuzzball images before and after; recovered shares; recommendation for K.

### B3 — Banded fluid, envelope radius, comparison presets

**Deliverables:** Sections 3.3 and 3.4.

**CHECKPOINT B3:** images and flux for both fluid models; the user picks the defaults (E4).

### B4 — Fuzzball noise fields *(may run in parallel with B5–B6; it needs the B1 units and the B3 fluid tables)*

**Deliverables:** Section 3.5 (inoisy model extension, anchor fields, coverage guard and debug view).

**CHECKPOINT B4:** the user approves the fields and animations.

### B5 — Exact speedups

**Deliverables:** Section 4.1, items 1–5.

**Tests:**
- exactness (records unchanged beyond float32 rounding; compaction identical);
- speedups per scene and per device;
- compile times.

**CHECKPOINT B5.**

### B6 — Quality tiers and accuracy-budgeted speedups

**Deliverables:**
- tier infrastructure and automatic selection (Section 1.2);
- Section 4.2 items 1–2, each passing the quality gate for Normal.

**CHECKPOINT B6:** the gate reports; speed per tier on the user's laptop and other devices; the user confirms which variants enter Normal.

### B7 — Normal/expert UI, interaction, compare, phones

**Deliverables:** Sections 5.1 and 5.2.

**Tests:** Playwright e2e for:
- mode switching with preserved state;
- drag, wheel and pinch (synthetic events);
- azimuth without a re-trace (no trace started);
- cache hits;
- compare layouts;
- persistence and reset;
- cancel;
- URL backward compatibility.

**CHECKPOINT B7:** the user tries both panels on laptop and phone.

### B8 — Science readouts and physical units

**Deliverables:** Sections 5.3 and 5.4.

**Tests:**
- light-curve reduction vs CPU;
- the time average;
- blur kernel width vs the requested FWHM (measured on a point source);
- inspector CPU vs GPU record agreement on the scene set;
- unit conversions (unit tests).

**CHECKPOINT B8.**

### B9 — Export, documentation, Stage 1B acceptance

**Deliverables:**
- Section 5.5;
- README updated:
  - the user guide for both panels;
  - shortcuts;
  - units;
  - readouts;
  - export;
  - the developer guide for codegen, tiers, the quality gate and compaction;
- `DECISIONS.md` complete;
- a final cross-device report: speed per tier, and the quality gate for every tier.

**Acceptance targets.** Initial; revise at B0 with the device numbers. On the user's AMD laptop, at the auto-selected tier:

| Case | Target |
|---|---|
| 1024² Kerr | ≤ 1 s |
| 512² fuzzball at λ = 1e-3 | ≤ 4 s |
| display incl. light curve and blur | ≥ 50 fps at 512²–1024² |
| azimuth drag | 60 fps with no re-trace |

Reference and High stay available and pass their own consistency checks.

**CHECKPOINT B9 = Stage 1B done.**

---

## 7. Out of scope for Stage 1B

- Translation (Dutch UI).
- `.dat` export.
- The WebGPU backend (M10 / Stage 2).
- Moving observers, the spaceship and cubemaps (Stage 2).
- Volumetric emission and polarization.

---

## 8. Open decisions (proposed defaults)

| ID | Decision | Proposed default |
|---|---|---|
| E1 | Tier time targets for automatic selection | ≤ 2 s (BH), ≤ 10 s (fuzzball) at the default resolution |
| E2 | Number of tail bins K | 8 (2 attachments); fewer on devices with < 8 draw buffers |
| E3 | Fuzzball noise anchors | λ = 0, 1e-3, 5e-3, 0.05; nearest anchor at runtime |
| E4 | Default fluid for horizonless metrics | banded in normal mode, FOORT's model in expert/parity work (user decides at B3) |
| E5 | EHT beam | Gaussian, FWHM 20 µas |
| E6 | Mass/distance presets | Sgr A* 4.3e6 M☉ at 8.28 kpc; M87* 6.5e9 M☉ at 16.8 Mpc; 10 M☉ at 1 kpc (verify against current literature, cite) |
| E7 | Video container | WebM (VP9) where available, MP4 on Safari |
| E8 | Compare mode default layout | split screen with a draggable divider |
| E9 | Record cache budget | 256 MB desktop, 64 MB phone |
| E10 | Compaction first cut N₁ | 1500 steps (tuned in B5) |
