# Production noise fields with inoisy (plan M8)

The noise fields of the viewer (`noise/<name>.json` + `.bin`, contract in plan Section 3.9 and `js/noise/noiseField.js`) come from
[inoisy](https://github.com/AFD-Illinois/inoisy) (Lee & Gammie 2021, arXiv:2011.07151). inoisy solves the stochastic PDE of
Lindgren et al. (2011) with HYPRE. Its output is a Gaussian random field with a prescribed, position-dependent anisotropic
correlation: along the Keplerian flow in time, and along trailing spirals in space.

## Environment (Windows 11, native build)

| component | version | source |
|---|---|---|
| MSYS2 UCRT64 toolchain | gcc 16.2.0 | existing `C:\msys64` |
| HYPRE | 2.33.0 | `pacman -S mingw-w64-ucrt-x86_64-hypre` |
| HDF5 (serial) | 2.2.0 | `pacman -S mingw-w64-ucrt-x86_64-hdf5` |
| MS-MPI headers and import library | 10.1.1 | `pacman -S mingw-w64-ucrt-x86_64-msmpi` |
| GSL | 2.8 | `pacman -S mingw-w64-ucrt-x86_64-gsl` |
| Microsoft MPI runtime (`msmpi.dll`) | 10.1.12498.52 | `msmpisetup.exe` from Microsoft (admin install) |
| inoisy | commit `dab29ed` | `git clone https://github.com/AFD-Illinois/inoisy.git ~/foort-gpu-work/inoisy` |

```bash
/c/msys64/usr/bin/bash -lc "pacman -S --needed mingw-w64-ucrt-x86_64-hypre mingw-w64-ucrt-x86_64-hdf5 mingw-w64-ucrt-x86_64-msmpi mingw-w64-ucrt-x86_64-gsl mingw-w64-ucrt-x86_64-make make"
```

The work tree `~/foort-gpu-work/inoisy` lies outside the Pages repository. Only the scripts and the model files in
`tools/noise/inoisy_foort/` are committed, together with the final contract-format fields.

### Deviations from inoisy's Makefile

- **No `h5pcc`:** MSYS2's HDF5 is serial, without MPI-IO. `hdf5_utils.c` is compiled with `-DUSE_MPI=0` and inoisy runs on a single MPI rank. That is fine for the field sizes used here: about 2–4 M unknowns, solved in about 1 minute.
- **Explicit compile:** gcc is called directly with the UCRT64 include and library paths (`build_inoisy.sh`) instead of `make`.

## The FOORT-GPU model `foort_logr` (`tools/noise/inoisy_foort/`)

The current inoisy model `general_xy` (Lee & Gammie 2021, Section 4.2) works on a Cartesian (t, x, y) grid that is periodic in t only. The viewer needs (t, log r, φ), periodic in t and φ, over a large range of radii. So:

- **`model_foort_logr.c`** is `model_general_xy.c` with periodic boundaries in φ as well as t.
- **`param_foort_logr.c`** carries general_xy's physics on the grid (t, x1 = log r, φ):
  - Keplerian Ω = r^(−3/2) (in units of M), with inoisy's smooth cutoff inside r_ct;
  - correlation time λ₀ = 2π τ / Ω along the flow vector (1, 0, Ω);
  - spatial major axis λ₁ = lam · r at θ = −70° to the radial direction (20° to the circle, trailing), and minor axis λ₂ = r12 · λ₁.
- **Why log r:** a physical vector a e_r + b e_φ has components (a/r, b/r) in (log r, φ), so the spatial tensor is scale free there: lam (cos θ, sin θ). One grid then covers r = 0.05–200 M with the same relative resolution.
- **Operator:** the operator and its discretization are general_xy's, in coordinate form.
- **Compile-time parameters:** `-DFOORT_LAM`, `FOORT_TAU`, `FOORT_R12`, `FOORT_RCT`, `FOORT_T`, `FOORT_XMIN`, `FOORT_XMAX`, `FOORT_THETA_DEG`.

## Making the field `inoisy_lg21`

```bash
# 1. build (FOORT_XMAX = log 200)
CFLAGS_EXTRA="-DFOORT_XMAX=5.3" bash tools/noise/build_inoisy.sh ~/foort-gpu-work/inoisy foort_logr
# 2. run: (phi, log r, t) = 256 x 128 x 128, one rank, PCG + PFMG (solver 0), GSL seed 3; about 75 s
cd ~/foort-gpu-work/inoisy && PATH=/c/msys64/ucrt64/bin:$PATH GSL_RNG_SEED=3 ./foort_logr.exe -ni 256 -nj 128 -nk 128 -solver 0 -o out
# 3. convert to the contract (per-radius normalization, float16), from foort-gpu/
python tools/noise/inoisy_to_contract.py ~/foort-gpu-work/inoisy/out/foort_logr_128_256_128_00003.h5 inoisy_lg21 --describe "..."
# 4. inspect: seams, statistics, correlation times, pictures -> dev/reports/m8/
python tools/noise/inspect_field.py inoisy_lg21
```

| parameter | value |
|---|---|
| lam = λ₁ / r | 5 |
| r12 = λ₂ / λ₁ | 0.1 |
| θ (major axis to radial) | −70° |
| τ (correlation time × Ω / 2π) | 1 |
| r_ct | 1 M |
| grid (t, log r, φ) | 128 × 128 × 256 |
| t range | [0, 200) M, periodic |
| log r range | −3 to 5.24 (r = 0.05–190 M) |
| φ range | [0, 2π), periodic |
| file | 8.4 MB, float16 |

The lam, r12, θ and τ values are those of general_xy and of Lee & Gammie Fig. 3.

## Fuzzball fields with a tabulated Ω(r) (Stage 1B B4)

The ST3Cr fuzzball emits at r ≪ M, and its flow is the viewer's banded fluid, not Keplerian. `param_foort_logr.c` therefore takes an optional table:

- **`FOORT_OMEGA_FILE`** (environment variable): a text file of rows `x Ω`, with x = log(r/M) and Ω the fluid's angular velocity u^φ/u^t in 1/M, ascending in x. It is linearly interpolated, and clamped at the ends.
- **With a table:**
  - Ω(r) replaces r^(−3/2), with no inner cutoff, since the table is the flow;
  - correlation time λ₀ = max(2π τ / |Ω|, 3 Δt), Δt = T / N_t (the plan's anti-aliasing clamp);
  - correlation length lam · r at all radii.
- **Without a table:** the model is unchanged (`inoisy_lg21`).
- The tables come from the viewer's fluid code (banded model, unit-mass ST3Cr): `node dev/scripts/b4OmegaTables.mjs` writes `tools/noise/omega/st3cr_l{0,1e-3,5e-3,0.05}.txt`. The λ = 0 table is the ST3Cr black hole's.

```bash
# 1. build for r = 1e-4 ... 200 M (copy to foort_logr_fb.exe; rebuild with XMAX=5.3 and no XMIN for inoisy_lg21)
CFLAGS_EXTRA="-DFOORT_XMIN=-9.2103404 -DFOORT_XMAX=5.37" bash tools/noise/build_inoisy.sh ~/foort-gpu-work/inoisy foort_logr
# 2. run per anchor (seeds 11-14 for 5e-3, 0, 1e-3, 0.05), (phi, log r, t) = 128 x 192 x 128, about 6 min each
cd ~/foort-gpu-work/inoisy && FOORT_OMEGA_FILE="$(cygpath -w .../tools/noise/omega/st3cr_l5e-3.txt)" PATH=/c/msys64/ucrt64/bin:$PATH GSL_RNG_SEED=11 ./foort_logr_fb.exe -ni 128 -nj 192 -nk 128 -solver 0 -o out_fb/l5e-3
# 3. convert (Windows Python with numpy; h5dump from UCRT64 at the END of PATH), from foort-gpu/
PATH=$PATH:/c/msys64/ucrt64/bin python tools/noise/inoisy_to_contract.py ~/foort-gpu-work/inoisy/out_fb/l5e-3/foort_logr_192_128_128_00011.h5 inoisy_st3cr_l5e-3 --omega st3cr_l5e-3.txt --anchor "st3cr lambda=5e-3" --describe "..."
# 4. inspect, co-rotating with the table's Omega -> dev/reports/b4/
python tools/noise/inspect_field.py inoisy_st3cr_l5e-3 --omega tools/noise/omega/st3cr_l5e-3.txt --radii 0.01,0.1,1,3,10,50 --out dev/reports/b4
```

- **Metadata:** the converter adds `fadeWidth` = lam · |cos θ| = 1.71, the x-extent of one correlation length, used by the viewer's coverage guard, and `anchor`.
- **Files:** `noise/inoisy_st3cr_l{0,1e-3,5e-3,0.05}.{json,bin}`, 6.3 MB each, 25.2 MB for the four. Grid 128 × 192 × 128 (t, log r, φ), x from −9.21 to 5.29 (r = 1e-4–199 M).
