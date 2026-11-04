#!/bin/sh
# Build the FOORT parity harness against a local, unmodified FOORT clone.
# Usage: sh tools/foort_parity/build.sh [path/to/FOORT clone]
# Output: tools/foort_parity/build/metric_dump(.exe), fluid_dump(.exe)  (git-ignored)
# Plain IEEE double: no -ffast-math, no -march (so no FMA contraction), matching FOORT's default build.
set -e
HERE="$(cd "$(dirname "$0")" && pwd)"
FOORT="${1:-${FOORT_DIR:-$HERE/../../../../../Coding/FOORT GitHub/FOORT}}"
SRC="$FOORT/FOORT/src"
[ -f "$SRC/Metric.cpp" ] || { echo "FOORT sources not found at $SRC (pass the clone path)"; exit 1; }
mkdir -p "$HERE/build"
CXX="${CXX:-g++}"
"$CXX" -std=c++17 -O2 -ffp-contract=off -D_USE_MATH_DEFINES -I"$SRC" \
  "$HERE/metric_dump.cpp" "$SRC/Metric.cpp" "$SRC/Grid.cpp" "$SRC/Interpolator.cpp" \
  "$SRC/InputOutput.cpp" "$SRC/Spline.cpp" \
  -o "$HERE/build/metric_dump"
"$CXX" -std=c++17 -O2 -ffp-contract=off -D_USE_MATH_DEFINES -I"$SRC"   "$HERE/fluid_dump.cpp" "$SRC/DiagnosticsEmission.cpp" "$SRC/Metric.cpp" "$SRC/Grid.cpp" "$SRC/Interpolator.cpp"   "$SRC/InputOutput.cpp" "$SRC/Spline.cpp"   -o "$HERE/build/fluid_dump"
echo "built $HERE/build/metric_dump (FOORT at $FOORT, commit $(git -C "$FOORT" rev-parse --short HEAD 2>/dev/null || echo unknown))"
