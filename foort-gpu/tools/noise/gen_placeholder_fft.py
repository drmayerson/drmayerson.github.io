"""Placeholder noise field for FOORT-GPU (plan Section 3.9, milestone M7).

An anisotropic Gaussian random field X(t, x, phi), x = log(r / M_ADM), made by filtering white noise in Fourier
space with a Gaussian spectrum. Periodic in t (period T) and phi (2 pi) by construction (FFT on those axes);
in x it is generated on a grid twice as long and cropped, so it is not periodic there. Normalized to zero mean
and unit variance. It has no built-in flow pattern: the field only evolves in time (the viewer's optional
procedural-advection mode adds the fluid's rotation). Production fields (inoisy, M8) follow the same contract.

Contract (noise/<name>.bin + noise/<name>.json): little-endian float16 array of shape (Nt, Nx, Nphi), C order.

Usage: python tools/noise/gen_placeholder_fft.py [--name placeholder] [--seed 1] [--Nt 64 --Nx 96 --Nphi 128]
       [--T 200] [--xmin -6 --xmax 7] [--lt 8 --lx 0.4 --lphi 0.35]
"""
import argparse
import json
import os

import numpy as np


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--name', default='placeholder')
    ap.add_argument('--seed', type=int, default=1)
    ap.add_argument('--Nt', type=int, default=64)
    ap.add_argument('--Nx', type=int, default=96)
    ap.add_argument('--Nphi', type=int, default=128)
    ap.add_argument('--T', type=float, default=200.0, help='period in t, units of M_ADM')
    ap.add_argument('--xmin', type=float, default=-6.0)
    ap.add_argument('--xmax', type=float, default=7.0)
    ap.add_argument('--lt', type=float, default=8.0, help='correlation time (M)')
    ap.add_argument('--lx', type=float, default=0.4, help='correlation length in log r')
    ap.add_argument('--lphi', type=float, default=0.35, help='correlation length in phi (rad)')
    ap.add_argument('--out', default=os.path.join(os.path.dirname(__file__), '..', '..', 'noise'))
    a = ap.parse_args()

    rng = np.random.default_rng(a.seed)
    nxp = 2 * a.Nx                     # padded x grid (cropped below: no wrap-around correlation in x)
    dt, dx, dphi = a.T / a.Nt, (a.xmax - a.xmin) / (a.Nx - 1), 2 * np.pi / a.Nphi
    kt = 2 * np.pi * np.fft.fftfreq(a.Nt, dt)
    kx = 2 * np.pi * np.fft.fftfreq(nxp, dx)
    kp = 2 * np.pi * np.fft.rfftfreq(a.Nphi, dphi)
    KT, KX, KP = np.meshgrid(kt, kx, kp, indexing='ij')
    # Gaussian spectrum: a Gaussian correlation function with these lengths (amplitude = sqrt of the spectrum)
    amp = np.exp(-0.25 * ((KT * a.lt) ** 2 + (KX * a.lx) ** 2 + (KP * a.lphi) ** 2))
    white = rng.standard_normal((a.Nt, nxp, a.Nphi))
    field = np.fft.irfftn(np.fft.rfftn(white) * amp, s=(a.Nt, nxp, a.Nphi), axes=(0, 1, 2))[:, :a.Nx, :]
    field = (field - field.mean()) / field.std()

    os.makedirs(a.out, exist_ok=True)
    data = field.astype('<f2')
    data.tofile(os.path.join(a.out, f'{a.name}.bin'))
    meta = {
        'Nt': a.Nt, 'Nx': a.Nx, 'Nphi': a.Nphi, 'T_over_M': a.T, 'xmin': a.xmin, 'xmax': a.xmax,
        'x_def': 'log(r/M)', 'periodic': {'t': True, 'phi': True}, 'normalized': 'zero mean, unit variance',
        'dtype': 'float16', 'order': 'C (t, x, phi)',
        'generator': {'name': 'gen_placeholder_fft.py', 'seed': a.seed, 'spectrum': 'Gaussian',
                      'correlation': {'t_over_M': a.lt, 'x': a.lx, 'phi': a.lphi}},
        'stats': {'mean': float(data.astype(np.float64).mean()), 'std': float(data.astype(np.float64).std())},
    }
    with open(os.path.join(a.out, f'{a.name}.json'), 'w') as f:
        json.dump(meta, f, indent=1)
    print(f"wrote {a.name}: {data.nbytes / 1e6:.2f} MB, mean {meta['stats']['mean']:.2e}, std {meta['stats']['std']:.4f}")


if __name__ == '__main__':
    main()
