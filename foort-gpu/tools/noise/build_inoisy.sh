#!/usr/bin/env bash
# Build inoisy (AFD-Illinois/inoisy) natively on Windows with MSYS2 UCRT64 (plan M8; build notes in build_inoisy.md).
# Packages (pacman): mingw-w64-ucrt-x86_64-{hypre,hdf5,msmpi,gsl,make}; runtime: Microsoft MPI (msmpisetup.exe).
# The serial HDF5 of MSYS2 has no MPI-IO, so hdf5_utils.c is compiled with USE_MPI=0 and inoisy runs on one rank.
# The FOORT-GPU model (foort_logr: Lee & Gammie 2021 physics on (t, log r, phi), periodic in t and phi) is copied
# from tools/noise/inoisy_foort/ into the clone before building.
# Parameters of foort_logr: CFLAGS_EXTRA="-DFOORT_XMAX=5.3 ..." (see param_foort_logr.c).
# Usage (any shell): bash tools/noise/build_inoisy.sh [inoisy clone dir, default ~/foort-gpu-work/inoisy] [models...]
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SRC="${1:-$HOME/foort-gpu-work/inoisy}"
shift || true
MODELS="${*:-foort_logr general_xy}"
UCRT=/c/msys64/ucrt64
export PATH="$UCRT/bin:$PATH"
CC="$UCRT/bin/gcc"
for f in "$HERE"/inoisy_foort/*.c; do [ -e "$f" ] && cp "$f" "$SRC/src/"; done
cd "$SRC"
mkdir -p obj
CFLAGS="${CFLAGS_EXTRA:-} -O2 -g -Wall -Wno-unused-variable -Wno-unused-but-set-variable -I$UCRT/include -Iinclude -DHAVE_CONFIG_H -DHYPRE_TIMING"
for f in main hdf5_utils; do
  extra=""; [ "$f" = hdf5_utils ] && extra="-DUSE_MPI=0"
  $CC $CFLAGS $extra -c src/$f.c -o obj/$f.o
done
for m in $MODELS; do
  $CC $CFLAGS -c src/model_$m.c -o obj/model_$m.o
  $CC $CFLAGS -c src/param_$m.c -o obj/param_$m.o
  $CC obj/main.o obj/hdf5_utils.o obj/model_$m.o obj/param_$m.o -L$UCRT/lib -lHYPRE -lhdf5 -lgsl -lgslcblas -lmsmpi -lm -lstdc++ -o $m.exe
  echo "built $SRC/$m.exe"
done
