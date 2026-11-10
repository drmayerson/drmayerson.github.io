// @ts-check
import { METRICS } from '../metrics/registry.js';
// Viewer controls: a declarative list of parameters -> form widgets, URL-synced state.
// Sliders report 'input' while dragging (coarse preview) and 'change' on release (full trace).

/**
 * @typedef {Object} Control
 * @property {string} key
 * @property {string} label
 * @property {'range'|'select'|'checkbox'|'number'} type
 * @property {string} group
 * @property {number} [min] @property {number} [max] @property {number} [step]
 * @property {'linear'|'log'} [scale]
 * @property {(number|string)[]} [options]   select values
 * @property {Record<string, string>} [optionLabels]
 * @property {number|string|boolean} default
 * @property {(v:any) => string} [format]
 * @property {(s:Record<string, any>) => boolean} [visible]
 * @property {boolean} [retrace]             false: display-only (no new trace)
 * @property {boolean} [metricParam]         a metric parameter (dragging it re-bakes coarse tables)
 * @property {'expert'|'both'|'normal'|'hidden'} [level]  Stage 1B B7 panels: expert (default; the expert panel only), both,
 *                                           normal (the normal panel only), hidden (state and URL only, no widget)
 * @property {string} [normalLabel]          label in the normal panel
 * @property {string} [zeroEnd]              log slider with one more position below its minimum: there it sets this state
 *                                           key (the metric's zero-limit switch, e.g. "lambda = 0 (black hole)")
 */

export const VIEWS = {
  emission: { mode: 8, label: 'Disc emission' },
  fourColor: { mode: 0, label: 'Four-colour screen' },
  term: { mode: 1, label: 'Termination' },
  steps: { mode: 2, label: 'Steps (log)' },
  g1: { mode: 3, label: 'Redshift g₁ (fluid model)', lo: 0, hi: 1.6 },
  dt1: { mode: 4, label: 'Delay −dt₁ − (r_cam − r₁)', lo: -10, hi: 60 },
  passes: { mode: 5, label: 'Equatorial crossings' },
  sky: { mode: 6, label: 'Sky grid (escape direction)' },
  ham: { mode: 7, label: 'Constraint |H| (log₁₀)', lo: -9, hi: -2 },
  noise: { mode: 9, label: 'Noise X at crossing 1 (grey = 0.5 + X/8)' },
  dt21: { mode: 10, label: 'n = 1 image delay (dt₁ − dt₂)/M', lo: 0, hi: 60 },
  coverage: { mode: 11, label: 'Noise coverage (green: inside the field)' },
};

const fmt = (/** @type {number} */ d) => (v) => Number(v).toFixed(d);
const sig = (v) => (Math.abs(v) >= 100 ? Number(v).toFixed(0) : Number(v).toPrecision(3));

/**
 * Sliders of the metric parameters, from the registry (js/metrics/registry.js): one per parameter name (shared by the
 * metrics that have it, with the widest range; the registry's bounds clamp it per metric), plus the zero-limit switches.
 * @returns {Control[]}
 */
function metricParamControls() {
  /** @type {Map<string, {spec: import('../metrics/registry.js').ParamSpec, ids: string[], min: number, max: number}>} */
  const byName = new Map();
  for (const m of METRICS) for (const p of m.params) {
    if (p.fixed) continue;
    const e = byName.get(p.name);
    if (e) { e.ids.push(m.id); e.min = Math.min(e.min, p.min); e.max = Math.max(e.max, p.max); }
    else byName.set(p.name, { spec: p, ids: [m.id], min: p.min, max: p.max });
  }
  /** @type {Control[]} */
  const out = [];
  for (const { spec, ids, min, max } of byName.values()) {
    const log = spec.scale === 'log';
    const zk = ids.map(zeroKey).find(Boolean) ?? '';
    out.push({ key: spec.name, label: spec.label, type: 'range', group: 'Spacetime', min, max, default: spec.default,
      ...(log ? { scale: 'log' } : { step: spec.step ?? (max - min) / 1000 }),
      format: log ? (v) => Number(v).toPrecision(3) : fmt(Math.max(0, Math.ceil(-Math.log10(spec.step ?? (max - min) / 1000)))),
      // the normal panel has the spin of Kerr and the fuzzball's lambda (the slider's lowest position: lambda = 0)
      level: spec.name === 'a' || spec.name === 'lambda' ? 'both' : 'expert', ...(log && zk ? { zeroEnd: zk } : {}),
      visible: (s) => ids.includes(s.metric) && (s.ui !== 'normal' || spec.name !== 'a' || s.metric === 'kerr'), metricParam: true });
  }
  for (const m of METRICS) if (m.zeroSwitch)
    out.push({ key: m.zeroSwitch.key, label: m.zeroSwitch.label, type: 'checkbox', group: 'Spacetime', default: false, visible: (s) => s.metric === m.id, level: 'both' });
  return out;
}
/** state key of a metric's zero-limit switch (registry zeroSwitch.key), or '' @param {string} id */
export const zeroKey = (id) => METRICS.find((m) => m.id === id)?.zeroSwitch?.key ?? '';

/** @type {Control[]} */
export const CONTROLS = [
  // Stage 1B B7: the panel (URL ui=normal|expert) and the normal panel's spacetime family
  { key: 'ui', label: 'panel', type: 'select', group: 'Spacetime', options: ['normal', 'expert'], default: 'normal', level: 'hidden', retrace: false },
  { key: 'family', label: 'spacetime', type: 'select', group: 'Spacetime', options: ['bh', 'fuzzball'],
    optionLabels: { bh: 'black hole (Kerr)', fuzzball: 'fuzzball (ST3Cr ring)' }, default: 'bh', level: 'normal', retrace: false },
  { key: 'metric', label: 'metric', type: 'select', group: 'Spacetime', options: METRICS.filter((m) => !m.hidden).map((m) => m.id),
    optionLabels: Object.fromEntries(METRICS.map((m) => [m.id, m.label])), default: 'kerr' },
  { key: 'path', label: 'metric evaluation', type: 'select', group: 'Tracing', options: ['auto', 'tabulated', 'closed', 'analytic'],
    optionLabels: { auto: 'auto (closed form where float32-safe, else tables)', tabulated: 'tabulated metric (baked in double)',
      closed: 'generated closed-form shader (Kerr, Johannsen, RN, Manko–Novikov)', analytic: 'hand-written closed-form Kerr shader' }, default: 'auto' },
  ...metricParamControls(),
  { key: 'r', label: 'camera distance r (M)', type: 'range', group: 'Camera', min: 2, max: 100000, scale: 'log', default: 1000, format: sig },
  { key: 'inc', label: 'inclination (deg)', normalLabel: 'viewing angle from the spin axis (deg)', type: 'range', group: 'Camera', min: 0.01, max: 179.99, step: 0.01, default: 17, format: fmt(2), level: 'both' },
  { key: 'screen', label: 'screen size (M)', normalLabel: 'field of view (M; smaller = zoom in)', type: 'range', group: 'Camera', min: 0.05, max: 500, scale: 'log', default: 15, format: sig, level: 'both' },
  // Stage 1B B5: rotating the camera about the symmetry axis adds a constant to every phi: display only, no re-trace
  { key: 'az', label: 'camera azimuth (deg; display only)', normalLabel: 'azimuth (deg)', type: 'range', group: 'Camera', min: 0, max: 360, step: 0.5, default: 0, format: fmt(1), retrace: false, level: 'both' },
  { key: 'cx', label: 'screen centre α (M)', type: 'number', group: 'Camera', step: 0.1, default: 0 },
  { key: 'cy', label: 'screen centre β (M)', type: 'number', group: 'Camera', step: 0.1, default: 0 },
  { key: 'N', label: 'resolution', type: 'select', group: 'Tracing', options: [128, 256, 512, 1024, 2048], default: 512 },
  { key: 'preset', label: 'FOORT preset (metric, camera, emission)', type: 'select', group: 'Disc emission',
    options: ['custom', 'KerrExample', 'JohannsenExample', 'Test_MNrun', 'Test_FBdetail', 'Compare 1A: Kerr a = 0', 'Compare 1B: ST3Cr λ = 0.005',
      'Compare 2A: Kerr a = 0', 'Compare 2B: ST3Cr λ = 0 (BH)', 'Compare 3A: Kerr a = 0.5', 'Compare 3B: ST3Cr λ = 0.05'], default: 'custom', retrace: false },
  { key: 'mu', label: 'Johnson-SU μ', type: 'number', group: 'Disc emission', step: 0.01, default: 2.02, retrace: false },
  { key: 'gamma', label: 'Johnson-SU γ', type: 'number', group: 'Disc emission', step: 0.1, default: -2, retrace: false },
  { key: 'sigma', label: 'Johnson-SU σ', type: 'number', group: 'Disc emission', step: 0.05, default: 0.5, retrace: false },
  // redshift power, fudge factor and max passes also weight the binned tail at trace time (Stage 1B B2): they re-trace
  { key: 'redshiftPower', label: 'redshift power', type: 'number', group: 'Disc emission', step: 1, default: 3 },
  { key: 'fudge', label: 'geometric fudge factor (passes ≥ 2)', type: 'number', group: 'Disc emission', step: 0.1, default: 1 },
  { key: 'maxPasses', label: 'max passes (0: all)', type: 'select', group: 'Disc emission', options: [0, 1, 2, 3, 4, 6, 10, 20], default: 0 },
  { key: 'fluidModel', label: 'fluid model', type: 'select', group: 'Disc emission', options: ['banded', 'foort'],
    optionLabels: { banded: 'banded (stable bands circular; horizonless metrics)', foort: "FOORT's GeneralCircularRadial (parity)" }, default: 'banded' },
  { key: 'envelope', label: 'envelope radius', type: 'select', group: 'Disc emission', options: ['coordinate', 'circumferential'],
    optionLabels: { coordinate: 'coordinate r (FOORT)', circumferential: 'circumferential √g_φφ' }, default: 'coordinate', retrace: false },
  { key: 'xi', label: 'fluid ξ (sub-Keplerian)', type: 'range', group: 'Disc emission', min: 0, max: 1, step: 0.01, default: 1, format: fmt(2) },
  { key: 'betaR', label: 'fluid β_r', type: 'range', group: 'Disc emission', min: 0, max: 1, step: 0.01, default: 1, format: fmt(2) },
  { key: 'betaPhi', label: 'fluid β_φ', type: 'range', group: 'Disc emission', min: 0, max: 1, step: 0.01, default: 1, format: fmt(2) },
  { key: 'autoExposure', label: 'auto exposure', type: 'checkbox', group: 'Disc emission', default: true, retrace: false },
  // B7 normal panel: brightness on top of the auto exposure, and the time-averaged disc
  { key: 'brightness', label: 'brightness', type: 'range', group: 'Disc emission', min: 0.1, max: 10, scale: 'log', default: 1, format: sig, retrace: false, level: 'both',
    visible: (s) => s.autoExposure },
  { key: 'timeAvg', label: 'time-averaged (no flicker)', type: 'checkbox', group: 'Disc emission', default: false, retrace: false, level: 'both' },
  { key: 'exposure', label: 'exposure', type: 'range', group: 'Disc emission', min: 0.01, max: 1000, scale: 'log', default: 1, format: sig, retrace: false,
    visible: (s) => !s.autoExposure },
  { key: 'toneMap', label: 'tone map', type: 'select', group: 'Disc emission', options: [0, 1, 2, 3],
    optionLabels: { 0: 'linear', 1: 'sqrt', 2: 'log', 3: 'asinh' }, default: 1, retrace: false },
  { key: 'colorMap', label: 'colour map', type: 'select', group: 'Disc emission', options: [0, 1, 2],
    optionLabels: { 0: 'afmhot', 1: 'inferno', 2: 'grey' }, default: 0, retrace: false },
  { key: 'play', label: 'play', type: 'checkbox', group: 'Time', default: true, retrace: false, level: 'both' },
  { key: 'speed', label: 'speed (M per second)', type: 'range', group: 'Time', min: 0.1, max: 1000, scale: 'log', default: 20, format: sig, retrace: false, level: 'both' },
  { key: 'slowLight', label: 'slow light (each point at its emission time)', type: 'checkbox', group: 'Time', default: true, retrace: false },
  { key: 'noiseField', label: 'noise field', type: 'select', group: 'Time',
    options: ['auto', 'inoisy_lg21', 'inoisy_st3cr_l0', 'inoisy_st3cr_l1e-3', 'inoisy_st3cr_l5e-3', 'inoisy_st3cr_l0.05', 'placeholder'],
    optionLabels: { auto: 'auto (black holes: Lee & Gammie disc; fuzzball: nearest λ anchor)', inoisy_lg21: 'inoisy, Lee & Gammie 2021 disc, Keplerian (M8)',
      'inoisy_st3cr_l0': 'inoisy, ST3Cr λ = 0 flow (B4)', 'inoisy_st3cr_l1e-3': 'inoisy, ST3Cr λ = 1e-3 flow (B4)', 'inoisy_st3cr_l5e-3': 'inoisy, ST3Cr λ = 5e-3 flow (B4)',
      'inoisy_st3cr_l0.05': 'inoisy, ST3Cr λ = 0.05 flow (B4)', placeholder: 'placeholder FFT field (M7)' }, default: 'auto', retrace: false },
  { key: 'sigmaN', label: 'noise amplitude σₙ', type: 'range', group: 'Time', min: 0, max: 2, step: 0.05, default: 1, format: fmt(2), retrace: false },
  { key: 'advect', label: 'procedural advection (rotate the field with the fluid)', type: 'checkbox', group: 'Time', default: false, retrace: false },
  { key: 'advectD', label: 'advection crossfade period D (M)', type: 'range', group: 'Time', min: 2, max: 500, scale: 'log', default: 40, format: sig, retrace: false,
    visible: (s) => s.advect },
  { key: 'grid', label: 'metric table (x × θ nodes per hemisphere)', type: 'select', group: 'Tracing',
    options: ['256x128', '512x128', '512x256', '1024x256'], default: '512x128', visible: (s) => s.path === 'tabulated' || (s.path === 'auto' && !['kerr', 'johannsen', 'reissnerNordstrom'].includes(s.metric)) },
  // Stage 1B B6 quality tiers (plan 1.2): auto picks the highest tier that traces the image within E1's time target on
  // this device; custom exposes the step parameter, far steps and max steps
  { key: 'quality', label: 'quality', type: 'select', group: 'Tracing', options: ['auto', 'reference', 'high', 'normal', 'custom'],
    optionLabels: { auto: 'auto (the best that fits 2 s black holes / 10 s fuzzball here)', reference: 'Reference (validation: ε 0.03, no trades)',
      high: 'High (far steps; fuzzball 5000 steps)', normal: 'Normal (High + gated speedups)', custom: 'custom (ε, far steps, max steps below)' }, default: 'auto' },
  { key: 'eps', label: 'step parameter ε', type: 'range', group: 'Tracing', min: 0.003, max: 0.1, scale: 'log', default: 0.03, format: sig, visible: (s) => s.quality === 'custom' },
  { key: 'farSteps', label: 'larger steps beyond 20 M (up to 4×; ~3e-4 rad on escape directions)', type: 'checkbox', group: 'Tracing', default: true, visible: (s) => s.quality === 'custom' },
  // Stage 1B B5 exact speedups (results unchanged beyond float32 rounding)
  // adopted at checkpoint B5: faster on all three GPUs measured (1.2-3.2x)
  { key: 'texelReuse', label: 'reuse table texels across RK stages (exact; 1.2–3× faster)', type: 'checkbox', group: 'Tracing', default: true },
  { key: 'compact', label: 'ray compaction (exact; trace long rays as a dense image after 1500 steps)', type: 'checkbox', group: 'Tracing', default: false },
  { key: 'pretrace', label: 'idle pre-tracing of neighbouring views (λ ± one notch, inclination ± 5°; off on phones)', type: 'checkbox', group: 'Tracing', default: true, retrace: false },
  // B7 expert: the B6 options for custom quality, the compaction threshold, the record cache
  { key: 'integrator', label: 'integrator', type: 'select', group: 'Tracing', options: ['rk4', 'bs3'],
    optionLabels: { rk4: "RK4 with FOORT's step rule", bs3: 'Bogacki–Shampine 3(2), error-controlled' }, default: 'rk4', visible: (s) => s.quality === 'custom' },
  { key: 'bs3Tol', label: 'BS3 tolerance (pixel angles)', type: 'range', group: 'Tracing', min: 0.01, max: 3, scale: 'log', default: 0.1, format: sig,
    visible: (s) => s.quality === 'custom' && s.integrator === 'bs3' },
  { key: 'refine', label: 'adaptive refinement (from stride 4; fails the Normal sky budget, B6)', type: 'checkbox', group: 'Tracing', default: false, visible: (s) => s.quality === 'custom' },
  { key: 'refineSky', label: 'refinement: interpolation error allowed (px)', type: 'range', group: 'Tracing', min: 0.02, max: 2, scale: 'log', default: 0.2, format: sig,
    visible: (s) => s.quality === 'custom' && s.refine },
  { key: 'compactN1', label: 'compaction: first stop (steps)', type: 'select', group: 'Tracing', options: [500, 1000, 1500, 2500], default: 1500, visible: (s) => s.compact },
  { key: 'cacheMB', label: 'record cache (MB)', type: 'select', group: 'Tracing', options: ['auto', '0', '64', '256', '512'],
    optionLabels: { auto: 'auto (256; 64 on phones)', 0: 'off', 64: '64', 256: '256', 512: '512' }, default: 'auto', retrace: false },
  { key: 'maxSteps', label: 'max steps', type: 'select', group: 'Tracing', options: [1000, 2000, 5000, 10000, 20000, 50000], default: 5000, visible: (s) => s.quality === 'custom' },
  { key: 'crossing', label: 'equatorial crossings', type: 'select', group: 'Tracing', options: ['interpolate', 'foort'],
    optionLabels: { interpolate: 'interpolated (app)', foort: 'FOORT parity' }, default: 'interpolate' },
  { key: 'storeH', label: 'record |H| (replaces crossing 3)', type: 'checkbox', group: 'Tracing', default: false },
  { key: 'view', label: 'debug view', type: 'select', group: 'View', options: Object.keys(VIEWS),
    optionLabels: Object.fromEntries(Object.entries(VIEWS).map(([k, v]) => [k, v.label])), default: 'emission', retrace: false },
  { key: 'lo', label: 'range low', type: 'number', group: 'View', step: 0.1, default: NaN, retrace: false,
    visible: (s) => 'lo' in VIEWS[s.view] },
  { key: 'hi', label: 'range high', type: 'number', group: 'View', step: 0.1, default: NaN, retrace: false,
    visible: (s) => 'hi' in VIEWS[s.view] },
  // B7 compare mode: A and B share camera and time; the panel edits A or B (expert); normal: B is the other family
  { key: 'compare', label: 'compare', type: 'select', group: 'Compare', options: ['off', 'split', 'side', 'blink'],
    optionLabels: { off: 'off', split: 'split screen (drag the divider)', side: 'side by side', blink: 'blink' }, default: 'off', retrace: false, level: 'both' },
  { key: 'cmpEdit', label: 'the panel edits', type: 'select', group: 'Compare', options: ['A', 'B'], optionLabels: { A: 'A (left)', B: 'B (right)' }, default: 'A', retrace: false,
    visible: (s) => s.compare !== 'off' },
  { key: 'blinkHz', label: 'blink rate (per second)', type: 'range', group: 'Compare', min: 0.25, max: 8, scale: 'log', default: 1, format: sig, retrace: false,
    visible: (s) => s.compare === 'blink', level: 'both' },
  { key: 'cmpDiv', label: 'divider', type: 'number', group: 'Compare', default: 0.5, retrace: false, level: 'hidden' },
];

/** keys A and B share in compare mode (camera, observer time, display) */
export const SHARED_KEYS = ['ui', 'inc', 'screen', 'az', 'cx', 'cy', 'r', 'N', 'play', 'speed', 'slowLight', 'view', 'lo', 'hi', 'toneMap', 'colorMap',
  'autoExposure', 'exposure', 'brightness', 'timeAvg', 'compare', 'cmpEdit', 'blinkHz', 'cmpDiv', 'quality', 'pretrace', 'cacheMB', 'family'];

const SLIDER_STEPS = 1000;

/** @param {Control} c @param {number} v */
const toSlider = (c, v) => (c.scale === 'log'
  ? Math.round(SLIDER_STEPS * Math.log(v / /** @type {number} */ (c.min)) / Math.log(/** @type {number} */ (c.max) / /** @type {number} */ (c.min)))
  : v);
/** @param {Control} c @param {number} x */
const fromSlider = (c, x) => (c.scale === 'log'
  ? Number((/** @type {number} */ (c.min) * (/** @type {number} */ (c.max) / /** @type {number} */ (c.min)) ** (x / SLIDER_STEPS)).toPrecision(4))
  : x);

/** State from defaults and the URL query. @param {URLSearchParams} q */
export function initialState(q) {
  /** @type {Record<string, any>} */
  const s = {};
  for (const c of CONTROLS) {
    const raw = q.get(c.key);
    if (raw === null) s[c.key] = c.default;
    else if (c.type === 'checkbox') s[c.key] = raw === '1' || raw === 'true';
    else if (c.type === 'select' && typeof c.default === 'string') s[c.key] = raw;
    else s[c.key] = Number(raw);
  }
  migrateState(s, q);
  // the normal panel's family follows the metric
  s.family = METRICS.find((m) => m.id === s.metric)?.mode === 'fuzzball' ? 'fuzzball' : 'bh';
  return s;
}

/** URL version written by stateToQuery. 1 (no `v`): Stage 1. 2: Stage 1B, the fuzzball in units of M (B1). */
export const URL_VERSION = 3;

/**
 * Migrate the state of an older URL to the current version.
 * Version 1 -> 2: the ST3Cr fuzzball is traced in units of M_ADM = 24 (B1), so its Johnson-SU mu and sigma, which were
 * coordinate units of the raw metric, are divided by 24 (also when they took their default values). Camera lengths
 * were already in units of M in Stage 1.
 * @param {Record<string, any>} s @param {URLSearchParams} q
 */
export function migrateState(s, q) {
  const v = Number(q.get('v') ?? 1);
  if (v < 2 && s.metric === 'st3cr') { s.mu /= 24; s.sigma /= 24; }
  // v3 (Stage 1B B6): tracing settings belong to a quality tier; a link that set them keeps them as 'custom'
  if (v < 3 && !q.has('quality') && ['eps', 'farSteps', 'maxSteps'].some((k) => q.has(k))) s.quality = 'custom';
}

/** @param {Record<string, any>} s */
export function stateToQuery(s) {
  const q = new URLSearchParams();
  for (const c of CONTROLS) {
    const v = s[c.key];
    if (v === c.default || (typeof v === 'number' && Number.isNaN(v))) continue;
    q.set(c.key, typeof v === 'boolean' ? (v ? '1' : '0') : String(v));
  }
  q.set('v', String(URL_VERSION));
  return q.toString();
}

/**
 * Build the form. `onChange(key, final)` fires on every edit; final = false while a slider is dragged.
 * @param {HTMLFormElement} form @param {Record<string, any>} state
 * @param {(key:string, final:boolean, retrace:boolean) => void} onChange
 */
export function buildControls(form, state, onChange) {
  form.innerHTML = '';
  /** @type {Record<string, HTMLFieldSetElement>} */
  const groups = {};
  /** @type {{c:Control, row:HTMLElement, input:HTMLInputElement|HTMLSelectElement, out?:HTMLOutputElement}[]} */
  const widgets = [];
  // groups in a fixed order (the first appearance in CONTROLS would put Tracing before Camera)
  const ORDER = ['Spacetime', 'Camera', 'Disc emission', 'Time', 'View', 'Compare', 'Tracing'];
  const ordered = [...CONTROLS].sort((a, b) => (ORDER.indexOf(a.group) + 1 || 99) - (ORDER.indexOf(b.group) + 1 || 99));
  for (const c of ordered) {
    if (c.level === 'hidden') continue;
    if (!groups[c.group]) {
      const fs = document.createElement('fieldset');
      fs.innerHTML = `<legend>${c.group}</legend>`;
      form.appendChild(fs);
      groups[c.group] = fs;
    }
    const row = document.createElement('label');
    row.className = `ctl ctl-${c.type}`;
    const name = document.createElement('span');
    name.textContent = c.label;
    name.dataset.label = c.label;
    if (c.normalLabel) name.dataset.normalLabel = c.normalLabel;
    row.appendChild(name);
    /** @type {HTMLInputElement|HTMLSelectElement} */
    let input;
    /** @type {HTMLOutputElement|undefined} */
    let out;
    if (c.type === 'select') {
      const sel = document.createElement('select');
      for (const o of c.options ?? []) {
        const op = document.createElement('option');
        op.value = String(o);
        op.textContent = c.optionLabels?.[String(o)] ?? String(o);
        sel.appendChild(op);
      }
      sel.value = String(state[c.key]);
      input = sel;
    } else {
      const inp = document.createElement('input');
      inp.type = c.type;
      if (c.type === 'range') {
        inp.min = String(c.scale === 'log' ? (c.zeroEnd ? -1 : 0) : c.min);
        inp.max = String(c.scale === 'log' ? SLIDER_STEPS : c.max);
        inp.step = c.scale === 'log' ? '1' : String(c.step ?? 'any');
        inp.value = String(c.zeroEnd && state[c.zeroEnd] ? -1 : toSlider(c, state[c.key]));
        out = document.createElement('output');
        out.textContent = c.zeroEnd && state[c.zeroEnd] ? '0' : (c.format ?? String)(state[c.key]);
      } else if (c.type === 'checkbox') inp.checked = !!state[c.key];
      else { inp.step = String(c.step ?? 'any'); inp.value = Number.isNaN(state[c.key]) ? '' : String(state[c.key]); }
      input = inp;
    }
    input.name = c.key;
    row.appendChild(input);
    if (out) row.appendChild(out);
    groups[c.group].appendChild(row);
    widgets.push({ c, row, input, out });

    const read = () => {
      if (c.type === 'checkbox') return /** @type {HTMLInputElement} */ (input).checked;
      if (c.type === 'range') return fromSlider(c, Number(input.value));
      if (c.type === 'select') return typeof c.default === 'string' ? input.value : Number(input.value);
      return input.value === '' ? NaN : Number(input.value);
    };
    const handler = (/** @type {boolean} */ final) => () => {
      // the zero position of a log slider: the zero-limit switch (lambda = 0), the parameter keeps its last value
      if (c.zeroEnd) {
        const z = Number(input.value) < 0;
        if (z !== !!state[c.zeroEnd]) { state[c.zeroEnd] = z; sync(c.zeroEnd); }
        if (z) { if (out) out.textContent = '0'; refreshVisibility(); onChange(c.zeroEnd, final, true); return; }
      }
      const v = read();
      if (c.type === 'number' && !Number.isFinite(v) && !Number.isNaN(c.default)) return;
      state[c.key] = v;
      if (out) out.textContent = (c.format ?? String)(v);
      sync(c.key);   // e.g. the lambda = 0 checkbox moves the lambda slider to its zero position
      refreshVisibility();
      onChange(c.key, final, c.retrace !== false);
    };
    if (c.type === 'range') {
      input.addEventListener('input', handler(false));
      input.addEventListener('change', handler(true));
    } else input.addEventListener('change', handler(true));
  }
  const levelShown = (/** @type {Control} */ c) => {
    const l = c.level ?? 'expert';
    return l === 'both' || (state.ui === 'normal' ? l === 'normal' : l === 'expert');
  };
  const refreshVisibility = () => {
    for (const w of widgets) {
      w.row.hidden = !levelShown(w.c) || (w.c.visible ? !w.c.visible(state) : false);
      const span = /** @type {HTMLElement} */ (w.row.firstChild);
      span.textContent = state.ui === 'normal' && span.dataset.normalLabel ? span.dataset.normalLabel : span.dataset.label ?? '';
    }
    for (const fs of Object.values(groups)) fs.hidden = !Array.from(fs.querySelectorAll('.ctl')).some((r) => !(/** @type {HTMLElement} */ (r)).hidden);
  };
  /** show a state value in its widget */
  const sync = (/** @type {string} */ key) => {
    for (const w of widgets) {
      const v = state[w.c.key];
      if (w.c.key === key && w.c.type === 'checkbox') /** @type {HTMLInputElement} */ (w.input).checked = !!v;
      if (w.c.zeroEnd === key || (w.c.key === key && w.c.zeroEnd)) {
        const z = !!state[/** @type {string} */ (w.c.zeroEnd)];
        w.input.value = String(z ? -1 : toSlider(w.c, state[w.c.key]));
        if (w.out) w.out.textContent = z ? '0' : (w.c.format ?? String)(state[w.c.key]);
      }
    }
  };
  refreshVisibility();
  /** set a value programmatically (e.g. a range reset when the view changes) */
  return {
    set(/** @type {string} */ key, /** @type {any} */ v) {
      const w = widgets.find((x) => x.c.key === key);
      state[key] = v;
      sync(key);
      if (!w) { refreshVisibility(); return; }
      if (w.c.type === 'range') { w.input.value = String(toSlider(w.c, v)); if (w.out) w.out.textContent = (w.c.format ?? String)(v); sync(key); }
      else if (w.c.type === 'checkbox') /** @type {HTMLInputElement} */ (w.input).checked = !!v;
      else w.input.value = Number.isNaN(v) ? '' : String(v);
      refreshVisibility();
    },
    /** re-show every widget from the state (panel switch, compare A/B, reset) */
    refresh() {
      for (const w of widgets) {
        const v = state[w.c.key];
        if (w.c.type === 'range') { w.input.value = String(toSlider(w.c, v)); if (w.out) w.out.textContent = (w.c.format ?? String)(v); }
        else if (w.c.type === 'checkbox') /** @type {HTMLInputElement} */ (w.input).checked = !!v;
        else w.input.value = typeof v === 'number' && Number.isNaN(v) ? '' : String(v);
        if (w.c.zeroEnd) sync(w.c.zeroEnd);
      }
      refreshVisibility();
    },
  };
}
