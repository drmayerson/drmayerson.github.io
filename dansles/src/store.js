// Storage layer. Two interchangeable backends with the same methods:
//   - supabase: shared online database (needs config.js filled in + the group key in the link)
//   - demo:     this browser only (localStorage), pre-filled with example families
//
// Normalised state shape returned by load():
//   { settings, families: [...], responses: { [week]: { [familyId]: data } }, weeks: { [week]: data } }

import { buildDemoState } from './demo-data.js';

const KEY_STORAGE = 'carpool.key';
const DEMO_STORAGE = 'carpool.demo.v1';

export const DEFAULT_SETTINGS = {
  groupName: 'Dansles',
  studio: { address: '', lat: null, lng: null },
  weekday: 3,
  time: '14:00',
  endTime: '15:30',
  deadlineDaysBefore: 1,
  deadlineTime: '20:00',
  startWeek: null,
  lookbackWeeks: 16,
};

const safeLS = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* private mode */ } },
  del(k) { try { localStorage.removeItem(k); } catch { /* ignore */ } },
};
export { safeLS };

/** The group key: from the link (#k=...) or remembered from an earlier visit. */
export function groupKey() {
  const m = /[#&]k=([A-Za-z0-9]+)/.exec(location.hash || '');
  if (m) { safeLS.set(KEY_STORAGE, m[1]); return m[1]; }
  return safeLS.get(KEY_STORAGE);
}

export function shareLink(key) {
  const base = location.href.split('#')[0];
  return key ? `${base}#k=${key}` : base;
}

export function createStore(config = {}) {
  const hasSupabase = config.supabaseUrl && config.supabaseAnonKey && globalThis.supabase?.createClient;
  if (!hasSupabase) return demoStore();
  const key = groupKey();
  if (!key) return { mode: 'nokey' };
  return supabaseStore(config, key);
}

// ---------- Supabase ----------

function supabaseStore(config, key) {
  const client = globalThis.supabase.createClient(config.supabaseUrl, config.supabaseAnonKey, {
    auth: { persistSession: false },
  });
  const call = async (fn, args) => {
    const { data, error } = await client.rpc(fn, { p_secret: key, ...args });
    if (error) {
      const e = new Error(/invalid key/.test(error.message) ? 'invalid key' : error.message);
      e.code = error.code;
      throw e;
    }
    return data;
  };
  return {
    mode: 'supabase',
    key,
    async load() {
      const raw = await call('cp_load', {});
      const responses = {};
      for (const r of raw.responses || []) (responses[r.week] ??= {})[r.familyId] = r.data;
      const weeks = {};
      for (const w of raw.weeks || []) weeks[w.week] = w.data;
      return {
        settings: { ...DEFAULT_SETTINGS, ...(raw.settings || {}) },
        families: raw.families || [],
        responses,
        weeks,
      };
    },
    saveSettings: (settings) => call('cp_save_settings', { p_settings: settings }),
    saveFamily: (family) => call('cp_save_family', { p_family: family }),
    deleteFamily: (id) => call('cp_delete_family', { p_id: id }),
    saveResponse: (week, familyId, data) => call('cp_save_response', { p_week: week, p_family_id: familyId, p_data: data }),
    saveWeek: (week, data, { ifAbsent = false } = {}) => call('cp_save_week', { p_week: week, p_data: data, p_if_absent: ifAbsent }),
  };
}

// ---------- demo (this browser only) ----------

function demoStore() {
  const read = () => {
    const raw = safeLS.get(DEMO_STORAGE);
    if (raw) { try { return JSON.parse(raw); } catch { /* fall through */ } }
    const fresh = buildDemoState(DEFAULT_SETTINGS);
    safeLS.set(DEMO_STORAGE, JSON.stringify(fresh));
    return fresh;
  };
  let state = read();
  const write = () => safeLS.set(DEMO_STORAGE, JSON.stringify(state));
  const clone = (x) => JSON.parse(JSON.stringify(x));
  return {
    mode: 'demo',
    async load() { return clone({ ...state, settings: { ...DEFAULT_SETTINGS, ...state.settings } }); },
    async saveSettings(s) { state.settings = clone(s); write(); },
    async saveFamily(f) {
      const i = state.families.findIndex((x) => x.id === f.id);
      if (i >= 0) state.families[i] = clone(f); else state.families.push(clone(f));
      write();
    },
    async deleteFamily(id) {
      state.families = state.families.filter((f) => f.id !== id);
      for (const w of Object.values(state.responses)) delete w[id];
      write();
    },
    async saveResponse(week, familyId, data) {
      state.responses[week] ??= {};
      if (data == null) delete state.responses[week][familyId];
      else state.responses[week][familyId] = clone(data);
      write();
    },
    async saveWeek(week, data, { ifAbsent = false } = {}) {
      const cur = state.weeks[week];
      if (!ifAbsent) state.weeks[week] = clone(data);
      else if (!cur?.plan) state.weeks[week] = { ...(cur || {}), plan: clone(data.plan) };
      write();
      return clone(state.weeks[week]);
    },
    async reset() { safeLS.del(DEMO_STORAGE); state = read(); },
  };
}
