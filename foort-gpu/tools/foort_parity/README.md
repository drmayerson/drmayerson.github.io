# FOORT parity harness

`metric_dump.cpp` links FOORT's own `Metric.cpp` (plus `Grid`, `Interpolator`, `Spline`,
`InputOutput`) from a local, unmodified FOORT clone and prints `g_dd` and `g_uu` at given
`(r, theta)` points, always in FOORT's normal `r` coordinate.

```
sh tools/foort_parity/build.sh "/path/to/FOORT clone"   # or set FOORT_DIR; output in build/ (git-ignored)
cd dev && node scripts/metricParity.mjs                  # Level-0 parity, 1e4 points per set -> dev/reports/m1_parity.json
```

`metricParity.mjs` also refreshes the small golden files in `dev/tests/golden/metric_parity/`
(50 points per set) that the Vitest suite uses without needing the harness.

Built and checked with g++ 16.2 (MSYS2 UCRT64), `-O2 -ffp-contract=off -D_USE_MATH_DEFINES`,
against FOORT commit `cfff2d5`.
