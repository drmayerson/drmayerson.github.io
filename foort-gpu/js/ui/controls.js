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
    out.push({ key: spec.name, label: spec.label, type: 'range', group: 'Spacetime', min, max, default: spec.default,
      ...(log ? { scale: 'log' } : { step: spec.step ?? (max - min) / 1000 }),
      format: log ? (v) => Number(v).toPrecision(3) : fmt(Math.max(0, Math.ceil(-Math.log10(spec.step ?? (max - min) / 1000)))),
      visible: (s) => ids.includes(s.metric) && !(zeroKey(s.metric) && s[zeroKey(s.metric)]), metricParam: true });
  }
  for (const m of METRICS) if (m.zeroSwitch)
    out.push({ key: m.zeroSwitch.key, label: m.zeroSwitch.label, type: 'checkbox', group: 'Spacetime', default: false, visible: (s) => s.metric === m.id });
  return out;
}
/** state key of a metric's zero-limit switch (registry zeroSwitch.key), or '' @param {string} id */
export const zeroKey = (id) => METRICS.find((m) => m.id === id)?.zeroSwitch?.key ?? '';

/** @type {Control[]} */
export const CONTROLS = [
  { key: 'metric', label: 'metric', type: 'select', group: 'Spacetime', options: METRICS.filter((m) => !m.hidden).map((m) => m.id),
    optionLabels: Object.fromEntries(METRICS.map((m) => [m.id, m.label])), default: 'kerr' },
  { key: 'path', label: 'Kerr tracer', type: 'select', group: 'Spacetime', options: ['tabulated', 'analytic'],
    optionLabels: { tabulated: 'tabulated metric (app)', analytic: 'closed-form shader (validation)' }, default: 'tabulated',
    visible: (s) => s.metric === 'kerr' },
  ...metricParamControls(),
  { key: 'r', label: 'camera distance r (M)', type: 'range', group: 'Camera', min: 2, max: 100000, scale: 'log', default: 1000, format: sig },
  { key: 'inc', label: 'inclination (deg)', type: 'range', group: 'Camera', min: 0.01, max: 179.99, step: 0.01, default: 17, format: fmt(2) },
  { key: 'screen', label: 'screen size (M)', type: 'range', group: 'Camera', min: 0.05, max: 500, scale: 'log', default: 15, format: sig },
  { key: 'cx', label: 'screen centre α (M)', type: 'number', group: 'Camera', step: 0.1, default: 0 },
  { key: 'cy', label: 'screen centre β (M)', type: 'number', group: 'Camera', step: 0.1, default: 0 },
  { key: 'N', label: 'resolution', type: 'select', group: 'Tracing', options: [128, 256, 512, 1024, 2048], default: 512 },
  { key: 'preset', label: 'FOORT preset (metric, camera, emission)', type: 'select', group: 'Disc emission',
    options: ['custom', 'KerrExample', 'JohannsenExample', 'Test_MNrun', 'Test_FBdetail'], default: 'custom', retrace: false },
  { key: 'mu', label: 'Johnson-SU μ', type: 'number', group: 'Disc emission', step: 0.01, default: 2.02, retrace: false },
  { key: 'gamma', label: 'Johnson-SU γ', type: 'number', group: 'Disc emission', step: 0.1, default: -2, retrace: false },
  { key: 'sigma', label: 'Johnson-SU σ', type: 'number', group: 'Disc emission', step: 0.05, default: 0.5, retrace: false },
  { key: 'redshiftPower', label: 'redshift power', type: 'number', group: 'Disc emission', step: 1, default: 3, retrace: false },
  { key: 'fudge', label: 'geometric fudge factor (passes ≥ 2)', type: 'number', group: 'Disc emission', step: 0.1, default: 1, retrace: false },
  { key: 'maxPasses', label: 'max passes (0: all stored, ≤ 3)', type: 'select', group: 'Disc emission', options: [0, 1, 2, 3], default: 0, retrace: false },
  { key: 'xi', label: 'fluid ξ (sub-Keplerian)', type: 'range', group: 'Disc emission', min: 0, max: 1, step: 0.01, default: 1, format: fmt(2) },
  { key: 'betaR', label: 'fluid β_r', type: 'range', group: 'Disc emission', min: 0, max: 1, step: 0.01, default: 1, format: fmt(2) },
  { key: 'betaPhi', label: 'fluid β_φ', type: 'range', group: 'Disc emission', min: 0, max: 1, step: 0.01, default: 1, format: fmt(2) },
  { key: 'autoExposure', label: 'auto exposure', type: 'checkbox', group: 'Disc emission', default: true, retrace: false },
  { key: 'exposure', label: 'exposure', type: 'range', group: 'Disc emission', min: 0.01, max: 1000, scale: 'log', default: 1, format: sig, retrace: false,
    visible: (s) => !s.autoExposure },
  { key: 'toneMap', label: 'tone map', type: 'select', group: 'Disc emission', options: [0, 1, 2, 3],
    optionLabels: { 0: 'linear', 1: 'sqrt', 2: 'log', 3: 'asinh' }, default: 1, retrace: false },
  { key: 'colorMap', label: 'colour map', type: 'select', group: 'Disc emission', options: [0, 1, 2],
    optionLabels: { 0: 'afmhot', 1: 'inferno', 2: 'grey' }, default: 0, retrace: false },
  { key: 'play', label: 'play', type: 'checkbox', group: 'Time', default: true, retrace: false },
  { key: 'speed', label: 'speed (M per second)', type: 'range', group: 'Time', min: 0.1, max: 1000, scale: 'log', default: 20, format: sig, retrace: false },
  { key: 'slowLight', label: 'slow light (each point at its emission time)', type: 'checkbox', group: 'Time', default: true, retrace: false },
  { key: 'noiseField', label: 'noise field', type: 'select', group: 'Time', options: ['inoisy_lg21', 'placeholder'],
    optionLabels: { inoisy_lg21: 'inoisy, Lee & Gammie 2021 disc (M8)', placeholder: 'placeholder FFT field (M7)' }, default: 'inoisy_lg21', retrace: false },
  { key: 'sigmaN', label: 'noise amplitude σₙ', type: 'range', group: 'Time', min: 0, max: 2, step: 0.05, default: 1, format: fmt(2), retrace: false },
  { key: 'advect', label: 'procedural advection (rotate the field with the fluid)', type: 'checkbox', group: 'Time', default: false, retrace: false },
  { key: 'advectD', label: 'advection crossfade period D (M)', type: 'range', group: 'Time', min: 2, max: 500, scale: 'log', default: 40, format: sig, retrace: false,
    visible: (s) => s.advect },
  { key: 'grid', label: 'metric table (x × θ nodes per hemisphere)', type: 'select', group: 'Tracing',
    options: ['256x128', '512x128', '512x256', '1024x256'], default: '512x128', visible: (s) => s.metric !== 'kerr' || s.path !== 'analytic' },
  { key: 'eps', label: 'step parameter ε', type: 'range', group: 'Tracing', min: 0.003, max: 0.1, scale: 'log', default: 0.03, format: sig },
  { key: 'farSteps', label: 'larger steps beyond 20 M (up to 4×; ~3e-4 rad on escape directions)', type: 'checkbox', group: 'Tracing', default: true },
  { key: 'maxSteps', label: 'max steps', type: 'select', group: 'Tracing', options: [1000, 2000, 5000, 10000, 20000, 50000], default: 5000 },
  { key: 'crossing', label: 'equatorial crossings', type: 'select', group: 'Tracing', options: ['interpolate', 'foort'],
    optionLabels: { interpolate: 'interpolated (app)', foort: 'FOORT parity' }, default: 'interpolate' },
  { key: 'storeH', label: 'record |H| (replaces crossing 3)', type: 'checkbox', group: 'Tracing', default: false },
  { key: 'view', label: 'debug view', type: 'select', group: 'View', options: Object.keys(VIEWS),
    optionLabels: Object.fromEntries(Object.entries(VIEWS).map(([k, v]) => [k, v.label])), default: 'emission', retrace: false },
  { key: 'lo', label: 'range low', type: 'number', group: 'View', step: 0.1, default: NaN, retrace: false,
    visible: (s) => 'lo' in VIEWS[s.view] },
  { key: 'hi', label: 'range high', type: 'number', group: 'View', step: 0.1, default: NaN, retrace: false,
    visible: (s) => 'hi' in VIEWS[s.view] },
];

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
  return s;
}

/** @param {Record<string, any>} s */
export function stateToQuery(s) {
  const q = new URLSearchParams();
  for (const c of CONTROLS) {
    const v = s[c.key];
    if (v === c.default || (typeof v === 'number' && Number.isNaN(v))) continue;
    q.set(c.key, typeof v === 'boolean' ? (v ? '1' : '0') : String(v));
  }
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
  for (const c of CONTROLS) {
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
        inp.min = String(c.scale === 'log' ? 0 : c.min);
        inp.max = String(c.scale === 'log' ? SLIDER_STEPS : c.max);
        inp.step = c.scale === 'log' ? '1' : String(c.step ?? 'any');
        inp.value = String(toSlider(c, state[c.key]));
        out = document.createElement('output');
        out.textContent = (c.format ?? String)(state[c.key]);
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
      const v = read();
      if (c.type === 'number' && !Number.isFinite(v) && !Number.isNaN(c.default)) return;
      state[c.key] = v;
      if (out) out.textContent = (c.format ?? String)(v);
      refreshVisibility();
      onChange(c.key, final, c.retrace !== false);
    };
    if (c.type === 'range') {
      input.addEventListener('input', handler(false));
      input.addEventListener('change', handler(true));
    } else input.addEventListener('change', handler(true));
  }
  const refreshVisibility = () => { for (const w of widgets) w.row.hidden = w.c.visible ? !w.c.visible(state) : false; };
  refreshVisibility();
  /** set a value programmatically (e.g. a range reset when the view changes) */
  return {
    set(/** @type {string} */ key, /** @type {any} */ v) {
      const w = widgets.find((x) => x.c.key === key);
      if (!w) return;
      state[key] = v;
      if (w.c.type === 'range') { w.input.value = String(toSlider(w.c, v)); if (w.out) w.out.textContent = (w.c.format ?? String)(v); }
      else if (w.c.type === 'checkbox') /** @type {HTMLInputElement} */ (w.input).checked = !!v;
      else w.input.value = Number.isNaN(v) ? '' : String(v);
      refreshVisibility();
    },
  };
}
