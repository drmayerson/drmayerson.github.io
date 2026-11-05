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
