// @ts-check
// Metric registry: the UI builds its mode/metric menus and parameter sliders from this list.
// Adding a metric = one module in js/metrics/ plus one entry here.
import { createKerr } from './kerr.js';
import { createJohannsen } from './johannsen.js';
import { createMankoNovikov } from './mankoNovikov.js';
import { createST3Cr, st3crLambdaMax } from './st3cr.js';
import { createST3CrBH } from './st3crBH.js';
import { createReissnerNordstrom } from './reissnerNordstrom.js';
import { rescaleToUnitMass } from './common.js';

/**
 * @typedef {{name:string, label:string, min:number, max:number, default:number, scale?:'linear'|'log', step?:number, fixed?:boolean,
 *   bounds?:(params:Record<string, number>) => {min:number, max:number}}} ParamSpec
 *   `min`/`max` are the widest range; `bounds`, when present, narrows it for the other current parameters.
 * @typedef {Object} MetricEntry
 * @property {string} id
 * @property {string} label
 * @property {'BH'|'fuzzball'} mode
 * @property {(params:Record<string, number>) => import('./common.js').StationaryAxisymmetricMetric} create
 * @property {ParamSpec[]} params
 * @property {Record<string, Record<string, number>>} presets
 * @property {string} [emissionNote]  caveat shown under the disc-emission view
 * @property {boolean} [hidden]       not in the metric menu (reached through another entry's zeroSwitch)
 * @property {{id:string, label:string, key:string}} [zeroSwitch]  a checkbox (state/URL key `key`) that replaces this metric by
 *   entry `id` (its parameter -> 0 limit)
 *
 * The viewer builds its metric menu and parameter sliders from this list (js/ui/controls.js): a parameter name
 * shared by several metrics (e.g. the spin a) is one slider; `fixed` parameters get no slider.
 */

// Fixed fuzzball charges (decision D5)
const P = 2, q0 = 50;

/** @type {MetricEntry[]} */
export const METRICS = [
  {
    id: 'kerr', label: 'Kerr', mode: 'BH',
    create: (p) => createKerr({ a: p.a }),
    params: [{ name: 'a', label: 'spin a', min: 0, max: 0.999, default: 0.94, step: 0.001 }],
    presets: { KerrExample: { a: 0.94 } },
  },
  {
    id: 'johannsen', label: 'Johannsen', mode: 'BH',
    create: (p) => createJohannsen({ a: p.a, alpha13: p.alpha13 }),
    // alpha13 in [-0.99 r_+^3(a), 10] (CHECKPOINT M1): closer to -r_+^3 a thin CTC band can extend
    // beyond the 1.01 r_+ termination for spinning holes (up to 0.9944 x -r_+^3 at a = 0.9)
    params: [
      { name: 'a', label: 'spin a', min: 0, max: 0.999, default: 0.5, step: 0.001 },
      {
        name: 'alpha13', label: 'α13 (≥ −0.99 r₊³)', min: -7.92, max: 10, default: 1, step: 0.01,
        bounds: (p) => ({ min: -0.99 * (1 + Math.sqrt(1 - p.a * p.a)) ** 3, max: 10 }),
      },
    ],
    presets: {},
  },
  {
    id: 'mankoNovikov', label: 'Manko–Novikov', mode: 'BH',
    create: (p) => createMankoNovikov({ a: p.a, alpha3: p.alpha3 }),
    // alpha3 range from the M1 validity scan
    params: [
      { name: 'a', label: 'spin a', min: 0, max: 0.999, default: 0.5, step: 0.001 },
      { name: 'alpha3', label: 'α3', min: -1, max: 1, default: 0.1, step: 0.01 },
    ],
    presets: {},
  },
  {
    id: 'reissnerNordstrom', label: 'Reissner–Nordström', mode: 'BH',
    create: (p) => createReissnerNordstrom({ Q: p.Q }),
    params: [{ name: 'Q', label: 'charge Q', min: 0, max: 0.999, default: 0.5, step: 0.001 }],
    presets: {},
  },
  {
    id: 'st3cr', label: 'ST3Cr ring fuzzball (P = 2, q0 = 50)', mode: 'fuzzball',
    zeroSwitch: { id: 'st3crBH', label: 'λ = 0 (supersymmetric black hole)', key: 'bh0' },
    // Stage 1B B2: crossings after the third (trapped light) are kept in the binned tail
    emissionNote: 'light trapped inside the fuzzball crosses the disc many times; crossings after the third are summed in 8 log-r bins and drawn without noise or slow light (their fluctuations average out)',
    // in units of M_ADM = 24 (Stage 1B B1); the raw metric (FOORT's coordinates) is createST3Cr itself
    create: (p) => rescaleToUnitMass(createST3Cr({ P: p.P, q0: p.q0, lambda: p.lambda })),
    params: [
      { name: 'lambda', label: 'λ', min: 1e-4, max: 0.999 * st3crLambdaMax(P, q0), default: 0.005, scale: 'log' },
      { name: 'P', label: 'P', min: P, max: P, default: P, fixed: true },
      { name: 'q0', label: 'q0', min: q0, max: q0, default: q0, fixed: true },
    ],
    presets: { Test_FBdetail: { lambda: 0.005, P, q0 } },
  },
  {
    id: 'st3crBH', label: 'ST3Cr black hole (λ = 0)', mode: 'fuzzball', hidden: true,
    create: (p) => rescaleToUnitMass(createST3CrBH({ P: p.P, q0: p.q0 })),
    params: [
      { name: 'P', label: 'P', min: P, max: P, default: P, fixed: true },
      { name: 'q0', label: 'q0', min: q0, max: q0, default: q0, fixed: true },
    ],
    presets: {},
  },
];

/** @param {string} id */
export const metricEntry = (id) => {
  const e = METRICS.find((m) => m.id === id);
  if (!e) throw new Error(`unknown metric ${id}`);
  return e;
};

/**
 * Current [min, max] of a parameter given the other parameters.
 * @param {ParamSpec} spec @param {Record<string, number>} params
 */
export const paramBounds = (spec, params) => (spec.bounds ? spec.bounds(params) : { min: spec.min, max: spec.max });

/** Create a metric from its registry defaults, overridden by `params`. @param {string} id @param {Record<string, number>} [params] */
export function createMetric(id, params = {}) {
  const e = metricEntry(id);
  /** @type {Record<string, number>} */
  const p = {};
  for (const s of e.params) p[s.name] = params[s.name] ?? s.default;
  return e.create(p);
}
