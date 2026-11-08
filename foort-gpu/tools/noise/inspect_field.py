"""Inspect a contract-format noise field (plan M8 tests): periodicity across t = T and phi = 2 pi, statistics per radius,
correlation times, and pictures: face-on disc snapshots X(t, r, phi) on a log-r polar map, a t-phi diagram at
fixed radii (Keplerian advection shows as tilted stripes), and the seams.

Usage: python tools/noise/inspect_field.py <name> [--out dev/reports/m8]  -> <name>_*.png and <name>_stats.json
"""
import argparse
import json
import os

import numpy as np
from PIL import Image


def load(name, folder):
    m = json.load(open(os.path.join(folder, f'{name}.json')))
    a = np.fromfile(os.path.join(folder, f'{name}.bin'), dtype='<f2').astype(np.float64).reshape(m['Nt'], m['Nx'], m['Nphi'])
    return m, a


def colour(v, lo=-3, hi=3):
    """afmhot-like map of exp(0.5 X) shape: map X in [lo, hi] to an RGB array."""
    t = np.clip((v - lo) / (hi - lo), 0, 1)
    return (np.stack([np.clip(2 * t, 0, 1), np.clip(2 * t - 0.5, 0, 1), np.clip(2 * t - 1, 0, 1)], -1) * 255).astype(np.uint8)


def disc(m, a, k, size=320, rmin=0.5, rmax=60.):
    """face-on snapshot at time index k: pixel radius log-mapped from rmin to rmax (units of M)."""
    yy, xx = np.mgrid[0:size, 0:size]
    cx = (xx + 0.5) / size * 2 - 1
    cy = 1 - (yy + 0.5) / size * 2
    rho = np.hypot(cx, cy)
    r = rmin * (rmax / rmin) ** rho
    phi = np.mod(np.arctan2(cy, cx), 2 * np.pi)
    xi = (np.log(r) - m['xmin']) / (m['xmax'] - m['xmin']) * (m['Nx'] - 1)
    pi_ = phi / (2 * np.pi) * m['Nphi']
    j = np.clip(np.round(xi).astype(int), 0, m['Nx'] - 1)
    i = np.mod(np.round(pi_).astype(int), m['Nphi'])
    img = colour(a[k][j, i])
    img[rho > 1] = 255
    return img


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('name')
    ap.add_argument('--folder', default=os.path.join(os.path.dirname(__file__), '..', '..', 'noise'))
    ap.add_argument('--omega', default='', help='Omega(r) table of the field (B4); default Keplerian r^-3/2')
    ap.add_argument('--radii', default='1,2,5,10,30,100', help='radii (M) for the correlation times')
    ap.add_argument('--out', default=os.path.join(os.path.dirname(__file__), '..', '..', 'dev', 'reports', 'm8'))
    a_ = ap.parse_args()
    os.makedirs(a_.out, exist_ok=True)
    m, a = load(a_.name, a_.folder)
    Nt, Nx, Nphi = a.shape
    x = m['xmin'] + np.arange(Nx) * (m['xmax'] - m['xmin']) / (Nx - 1)
    dt = m['T_over_M'] / Nt

    # seams: jump across t = T and phi = 2 pi vs typical neighbour differences
    d_t_in = np.abs(np.diff(a, axis=0)).mean()
    d_t_seam = np.abs(a[0] - a[-1]).mean()
    d_p_in = np.abs(np.diff(a, axis=2)).mean()
    d_p_seam = np.abs(a[:, :, 0] - a[:, :, -1]).mean()
    # temporal correlation time at selected radii (lag where the autocorrelation along t, following the pixel, drops to 1/e)
    def corr_time(j):
        s = a[:, j, :]
        ac = [np.mean(s * np.roll(s, -l, axis=0)) for l in range(Nt // 2)]
        ac = np.array(ac) / ac[0]
        below = np.where(ac < np.exp(-1))[0]
        return float(below[0] * dt) if len(below) else float('inf')
    # co-rotating correlation: shift phi by Omega t before correlating (Omega from the field's table, or Keplerian)
    if a_.omega:
        tab = np.loadtxt(a_.omega, comments='#')
        omega_of = lambda r: float(np.interp(np.log(r), tab[:, 0], tab[:, 1]))
    else:
        omega_of = lambda r: r ** -1.5
    def corr_time_corot(j):
        r = np.exp(x[j]); om = omega_of(r)
        s = a[:, j, :]
        ac = []
        for l in range(Nt // 2):
            shift = om * l * dt / (2 * np.pi) * Nphi
            i0 = int(np.floor(shift)); f = shift - i0
            rolled = (1 - f) * np.roll(s, -i0, axis=1) + f * np.roll(s, -i0 - 1, axis=1)
            ac.append(np.mean(s[:Nt - l] * rolled[l:] if l else s * s))
        ac = np.array(ac) / ac[0]
        below = np.where(ac < np.exp(-1))[0]
        return float(below[0] * dt) if len(below) else float('inf')
    radii = [float(v) for v in a_.radii.split(',')]
    js = [int(np.argmin(np.abs(np.exp(x) - r))) for r in radii]
    stats = {
        'name': a_.name, 'shape': [Nt, Nx, Nphi], 'mean': float(a.mean()), 'std': float(a.std()),
        'std_per_radius_range': [float(a.std(axis=(0, 2)).min()), float(a.std(axis=(0, 2)).max())],
        'seam_t': {'mean_abs_jump': float(d_t_seam), 'mean_abs_step_inside': float(d_t_in)},
        'seam_phi': {'mean_abs_jump': float(d_p_seam), 'mean_abs_step_inside': float(d_p_in)},
        'corr_time_fixed_point_M': {f'{np.exp(x[j]):.3g}': corr_time(j) for j in js},
        'corr_time_corotating_M': {f'{np.exp(x[j]):.3g}': corr_time_corot(j) for j in js},
        'orbital_period_M': {f'{np.exp(x[j]):.3g}': float(2 * np.pi / abs(omega_of(np.exp(x[j])))) for j in js},
        'time_step_M': dt, 'three_time_steps_M': 3 * dt,
    }
    json.dump(stats, open(os.path.join(a_.out, f'{a_.name}_stats.json'), 'w'), indent=1)
    print(json.dumps(stats, indent=1))

    # pictures: 4 face-on snapshots over the period
    snaps = [disc(m, a, k) for k in (0, Nt // 8, Nt // 4, Nt // 2)]
    gap = np.full((snaps[0].shape[0], 6, 3), 255, np.uint8)
    Image.fromarray(np.concatenate(sum([[s, gap] for s in snaps], [])[:-1], axis=1)).save(os.path.join(a_.out, f'{a_.name}_disc.png'))
    # Lee & Gammie (2021) Fig. 3 style: face-on, x, y in [-10, 10] M, envelope g = (r0/r)^4 exp(-(r0/r)^2) with r0 = 2 M,
    # brightness g exp(0.5 X) on a log scale (as inoisy general_xy's param_env)
    def lg_frame(k, size=256, L=10., r0=2.):
        yy, xx = np.mgrid[0:size, 0:size]
        X = ((xx + 0.5) / size * 2 - 1) * L
        Y = (1 - (yy + 0.5) / size * 2) * L
        r = np.hypot(X, Y) + 1e-9
        phi = np.mod(np.arctan2(Y, X), 2 * np.pi)
        xi = np.clip((np.log(r) - m['xmin']) / (m['xmax'] - m['xmin']) * (m['Nx'] - 1), 0, m['Nx'] - 1)
        j0 = np.minimum(np.floor(xi).astype(int), m['Nx'] - 2); fx = xi - j0
        pp = phi / (2 * np.pi) * m['Nphi']; i0 = np.floor(pp).astype(int); fp = pp - i0
        A = a[k]
        v = ((1 - fx) * ((1 - fp) * A[j0, i0 % Nphi] + fp * A[j0, (i0 + 1) % Nphi])
             + fx * ((1 - fp) * A[j0 + 1, i0 % Nphi] + fp * A[j0 + 1, (i0 + 1) % Nphi]))
        g = (r0 / r) ** 4 * np.exp(-(r0 / r) ** 2)
        b = np.log10(np.maximum(g * np.exp(0.5 * v), 1e-6))
        t = np.clip((b + 3) / 3.3, 0, 1)
        return (np.stack([np.clip(2 * t, 0, 1), np.clip(2 * t - 0.5, 0, 1), np.clip(2 * t - 1, 0, 1)], -1) * 255).astype(np.uint8)
    frames = [lg_frame(k) for k in (0, Nt // 16, Nt // 8)]
    gap = np.full((256, 6, 3), 255, np.uint8)
    Image.fromarray(np.concatenate([frames[0], gap, frames[1], gap, frames[2]], axis=1)).save(os.path.join(a_.out, f'{a_.name}_lg21style.png'))
    # t-phi diagrams at r = 2, 5, 20 M (time upwards), twice the period to show the t seam
    panels = []
    for r in (2.0, 5.0, 20.0):
        j = int(np.argmin(np.abs(np.exp(x) - r)))
        tp = np.concatenate([a[:, j, :], a[:, j, :]], axis=0)[::-1]
        panels.append(np.array(Image.fromarray(colour(tp)).resize((256, 256), Image.NEAREST)))
        panels.append(np.full((256, 6, 3), 255, np.uint8))
    Image.fromarray(np.concatenate(panels[:-1], axis=1)).save(os.path.join(a_.out, f'{a_.name}_tphi.png'))


if __name__ == '__main__':
    main()
