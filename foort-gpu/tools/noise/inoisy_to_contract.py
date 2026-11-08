"""Convert an inoisy foort_logr output (HDF5) to the FOORT-GPU noise-field contract (plan Section 3.9, milestone M8).

Reads /data/data_raw (shape (Nt, Nx, Nphi): t, x1 = log r, phi; HYPRE's k-slowest order) and /params with MSYS2's
h5dump (no Python HDF5 package needed), renormalizes the field to zero mean and unit variance at every radius
(the operator's variance varies slowly with r and near the radial edges), and writes noise/<name>.bin (float16,
little endian, C order) and noise/<name>.json.

Usage: python tools/noise/inoisy_to_contract.py <file.h5> <name> [--h5dump C:/msys64/ucrt64/bin/h5dump.exe]
       [--describe "text"] [--out noise/]
"""
import argparse
import json
import os
import re
import subprocess
import tempfile

import numpy as np


def h5dump_array(h5dump, path, dset):
    with tempfile.TemporaryDirectory() as d:
        out = os.path.join(d, 'a.bin')
        subprocess.run([h5dump, '-d', dset, '-b', 'LE', '-o', out, path], check=True, capture_output=True)
        meta = subprocess.run([h5dump, '-H', '-d', dset, path], check=True, capture_output=True, text=True).stdout
        dims = [int(x) for x in re.search(r'DATASPACE\s+SIMPLE\s*\{\s*\(\s*([\d,\s]+)\)', meta).group(1).split(',')]
        dtype = '<f8' if 'IEEE_F64' in meta else '<f4'
        return np.fromfile(out, dtype=dtype).reshape(dims)


def h5dump_scalar(h5dump, path, dset):
    txt = subprocess.run([h5dump, '-d', dset, path], check=True, capture_output=True, text=True).stdout
    return float(re.search(r'DATA\s*\{\s*(?:\(0\):\s*)?([-+0-9.eE]+)', txt).group(1))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('h5')
    ap.add_argument('name')
    ap.add_argument('--h5dump', default='C:/msys64/ucrt64/bin/h5dump.exe')
    ap.add_argument('--describe', default='')
    ap.add_argument('--omega', default='', help='the Omega(r) table the field was made with (FOORT_OMEGA_FILE), recorded in the metadata')
    ap.add_argument('--anchor', default='', help='metric and lambda anchor the field belongs to, e.g. "st3cr lambda=5e-3"')
    ap.add_argument('--out', default=os.path.join(os.path.dirname(__file__), '..', '..', 'noise'))
    a = ap.parse_args()

    raw = h5dump_array(a.h5dump, a.h5, '/data/data_raw')
    p = {k: h5dump_scalar(a.h5dump, a.h5, f'/params/{k}') for k in
         ['x0start', 'x0end', 'x1start', 'x1end', 'x2start', 'x2end', 'dx0', 'dx1', 'dx2', 'lam', 'tau', 'r12', 'rct', 'theta']}
    Nt, Nx, Nphi = raw.shape
    # per-radius normalization (zero mean, unit variance in each x slice)
    mean_r = raw.mean(axis=(0, 2), keepdims=True)
    std_r = raw.std(axis=(0, 2), keepdims=True)
    field = (raw - mean_r) / std_r
    data = field.astype('<f2')
    os.makedirs(a.out, exist_ok=True)
    data.tofile(os.path.join(a.out, f'{a.name}.bin'))
    meta = {
        'Nt': Nt, 'Nx': Nx, 'Nphi': Nphi,
        'T_over_M': p['x0end'] - p['x0start'],
        'xmin': p['x1start'], 'xmax': p['x1start'] + (Nx - 1) * p['dx1'],   # sample positions (x1end is exclusive)
        'x_def': 'log(r/M)', 'periodic': {'t': True, 'phi': True}, 'normalized': 'zero mean, unit variance (per radius)',
        'dtype': 'float16', 'order': 'C (t, x, phi)',
        'generator': {
            'name': 'inoisy (AFD-Illinois/inoisy dab29ed), model foort_logr (tools/noise/inoisy_foort/)',
            'physics': 'Lee & Gammie 2021 (general_xy) on (t, log r, phi): correlation length lam r along a spiral at theta '
                       'to the radial direction, minor axis r12 times shorter, correlation time 2 pi tau / Omega_K along the '
                       'Keplerian flow, smooth cutoff inside r_ct',
            'lam': p['lam'], 'tau': p['tau'], 'r12': p['r12'], 'rct_over_M': p['rct'], 'theta_rad': p['theta'],
            'description': a.describe,
            'variance_before_normalization': {'min': float(std_r.min() ** 2), 'max': float(std_r.max() ** 2)},
            'omega': os.path.basename(a.omega) if a.omega else 'Keplerian (r^-3/2, cutoff inside r_ct)',
        },
        # Stage 1B B4: the viewer fades sigma_n to 0 over this width (in x = log r) outside [xmin, xmax] instead of
        # clamping: the x-projection of the major correlation axis, lam |cos theta|
        'fadeWidth': float(p['lam'] * abs(np.cos(p['theta']))),
        'anchor': a.anchor or None,
        'stats': {'mean': float(data.astype(np.float64).mean()), 'std': float(data.astype(np.float64).std())},
    }
    with open(os.path.join(a.out, f'{a.name}.json'), 'w') as f:
        json.dump(meta, f, indent=1)
    print(f"wrote {a.name}: {Nt} x {Nx} x {Nphi}, {data.nbytes / 1e6:.2f} MB; raw variance {meta['generator']['variance_before_normalization']}")


if __name__ == '__main__':
    main()
