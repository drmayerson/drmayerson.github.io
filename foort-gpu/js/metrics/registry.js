// @ts-check
// Metric registry: the UI builds its mode/metric menus and parameter sliders from this list.
// Adding a metric = one module in js/metrics/ plus one entry here.
import { createKerr } from './kerr.js';
import { createJohannsen } from './johannsen.js';
import { createMankoNovikov } from './mankoNovikov.js';
import { createST3Cr, st3crLambdaMax } from './st3cr.js';
import { createST3CrBH } from './st3crBH.js';

/**
 * @typedef {{name:string, label:string, min:number, max:number, default:number, scale?:'linear'|'log', fixed?:boolean}} ParamSpec
 * @typedef {Object} MetricEntry
 * @property {string} id
 * @property {string} label
 * @property {'BH'|'fuzzball'} mode
 * @property {(params:Record<string, number>) => import('./common.js').StationaryAxisymmetricMetric} create
 * @property {ParamSpec[]} params
 * @property {Record<string, Record<string, number>>} presets
 */

// Fixed fuzzball charges (decision D5)
const P = 2, q0 = 50;

/** @type {MetricEntry[]} */
export const METRICS = [
  {
    id: 'kerr', label: 'Kerr', mode: 'BH',
    create: (p) => createKerr({ a: p.a }),
    params: [{ name: 'a', label: 'spin a', min: 0, max: 0.999, default: 0.94 }],
    presets: { KerrExample: { a: 0.94 } },
  },
  {
    id: 'johannsen', label: 'Johannsen', mode: 'BH',
    create: (p) => createJohannsen({ a: p.a, alpha13: p.alpha13 }),
    // alpha13 range: lower bound -r_+^3 (spin dependent, enforced by validate()); upper bound from the M1 scan
    params: [
      { name: 'a', label: 'spin a', min: 0, max: 0.999, default: 0.5 },
      { name: 'alpha13', label: 'α13', min: -1, max: 10, default: 1 },
    ],
    presets: {},
  },
  {
    id: 'mankoNovikov', label: 'Manko–Novikov', mode: 'BH',
    create: (p) => createMankoNovikov({ a: p.a, alpha3: p.alpha3 }),
    // alpha3 range from the M1 validity scan
    params: [
      { name: 'a', label: 'spin a', min: 0, max: 0.999, default: 0.5 },
      { name: 'alpha3', label: 'α3', min: -1, max: 1, default: 0.1 },
    ],
    presets: {},
  },
  {
    id: 'st3cr', label: 'ST3Cr ring fuzzball', mode: 'fuzzball',
    create: (p) => createST3Cr({ P: p.P, q0: p.q0, lambda: p.lambda }),
    params: [
      { name: 'lambda', label: 'λ', min: 1e-4, max: 0.999 * st3crLambdaMax(P, q0), default: 0.005, scale: 'log' },
      { name: 'P', label: 'P', min: P, max: P, default: P, fixed: true },
      { name: 'q0', label: 'q0', min: q0, max: q0, default: q0, fixed: true },
    ],
    presets: { Test_FBdetail: { lambda: 0.005, P, q0 } },
  },
  {
    id: 'st3crBH', label: 'ST3Cr black hole (λ = 0)', mode: 'fuzzball',
    create: (p) => createST3CrBH({ P: p.P, q0: p.q0 }),
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

/** Create a metric from its registry defaults, overridden by `params`. @param {string} id @param {Record<string, number>} [params] */
export function createMetric(id, params = {}) {
  const e = metricEntry(id);
  /** @type {Record<string, number>} */
  const p = {};
  for (const s of e.params) p[s.name] = params[s.name] ?? s.default;
  return e.create(p);
}
