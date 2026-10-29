// Labels, WhatsApp messages and small parsing helpers (pure, testable).

import { formatDay, formatDateTime, deadlineOf } from './dates.js';

export const STATUS = {
  need: { short: 'Rit nodig', long: 'We hebben een lift nodig' },
  self: { short: 'Zelf geregeld', long: 'We regelen het zelf, geen plaats over' },
  rather_not: { short: 'Liever niet', long: 'Kan rijden, maar liever niet' },
  can: { short: 'Kan rijden', long: 'Kan rijden als het nodig is' },
  driving: { short: 'Rij sowieso', long: 'Ik rij sowieso, plan me zeker in' },
};
export const STATUS_ORDER = ['need', 'self', 'rather_not', 'can', 'driving'];
export const DRIVER_STATUSES = ['rather_not', 'can', 'driving'];

export const LEG = {
  to: { name: 'Heen', sub: 'naar de les' },
  from: { name: 'Terug', sub: 'na de les' },
};

export const kidNames = (f, ids) => (f?.kids || []).filter((k) => !ids || ids.includes(k.id)).map((k) => k.name);
export const kidsLabel = (f, ids) => kidNames(f, ids).join(' & ') || f?.name || '?';
export const famLabel = (f) => (f ? `Fam. ${f.name}` : '?');

/** Kid names in a car: driver's own kids first, then riders in route order. */
export function carKids(car, byId, answers) {
  const own = kidNames(byId[car.driverId], answers[car.driverId]?.kids);
  const rest = car.riders.flatMap((id) => kidNames(byId[id], answers[id]?.kids));
  return [...own, ...rest];
}

export function scheduleText(plan, { settings, week, byId, answers, link }) {
  const lines = [`*Carpool ${settings.groupName || 'dansles'} — ${formatDay(week)}*`];
  for (const leg of ['to', 'from']) {
    const lp = plan.legs[leg];
    if (!lp || lp.participants.length === 0) continue;
    const when = leg === 'to' ? `les om ${settings.time}` : `les gedaan om ${settings.endTime}`;
    lines.push('', `${leg === 'to' ? '➡️' : '⬅️'} *${LEG[leg].name}* (${when})`);
    for (const c of lp.cars) lines.push(`🚗 ${byId[c.driverId]?.name}: ${carKids(c, byId, answers).join(', ')}`);
    if (lp.unassigned.length) {
      lines.push(`⚠️ Nog geen plaats voor: ${lp.unassigned.map((id) => kidsLabel(byId[id], answers[id]?.kids)).join(', ')}`);
    }
  }
  if (link) lines.push('', link);
  return lines.join('\n');
}

export function reminderText({ settings, week, missing, link }) {
  const dl = formatDateTime(deadlineOf(settings, week));
  return [
    `Carpool ${settings.groupName || 'dansles'} ${formatDay(week)}: nog geen antwoord van ${missing.join(', ')}.`,
    `Graag invullen vóór ${dl}. Zonder antwoord gaan we uit van jullie gewoonte, of dat jullie kind een lift nodig heeft.`,
    link ? `👉 ${link}` : '',
  ].filter(Boolean).join('\n');
}

export const whatsappUrl = (text) => `https://wa.me/?text=${encodeURIComponent(text)}`;

/** Google Maps directions link for a car's route. points: [{lat,lng}], first = start, last = end. */
export function mapsUrl(points) {
  const ok = points.filter((p) => p && Number.isFinite(p.lat) && Number.isFinite(p.lng));
  if (ok.length < 2) return null;
  const fmt = (p) => `${p.lat},${p.lng}`;
  const params = new URLSearchParams({ api: '1', origin: fmt(ok[0]), destination: fmt(ok[ok.length - 1]), travelmode: 'driving' });
  if (ok.length > 2) params.set('waypoints', ok.slice(1, -1).map(fmt).join('|'));
  return `https://www.google.com/maps/dir/?${params}`;
}

/** Accepts "50.77, 4.53", "50.77 4.53" or a Google Maps link. */
export function parseCoords(input) {
  if (!input) return null;
  const s = String(input).trim();
  const pats = [/!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/, /@(-?\d+\.\d+),(-?\d+\.\d+)/, /[?&](?:q|query|ll|destination)=(-?\d+\.\d+)(?:,|%2C)\s*(-?\d+\.\d+)/i, /^(-?\d+(?:\.\d+)?)\s*[,;\s]\s*(-?\d+(?:\.\d+)?)$/];
  for (const re of pats) {
    const m = re.exec(s);
    if (m) {
      const lat = parseFloat(m[1]);
      const lng = parseFloat(m[2]);
      if (Math.abs(lat) <= 90 && Math.abs(lng) <= 180) return { lat: round6(lat), lng: round6(lng) };
    }
  }
  return null;
}
const round6 = (x) => Math.round(x * 1e6) / 1e6;

export async function geocode(address) {
  const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&countrycodes=be,nl,fr,lu,de&q=${encodeURIComponent(address)}`;
  const res = await fetch(url, { headers: { 'Accept-Language': 'nl' } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  if (!data.length) return null;
  return { lat: round6(+data[0].lat), lng: round6(+data[0].lon), label: data[0].display_name };
}

export const newId = (prefix) => `${prefix}-${Math.random().toString(36).slice(2, 9)}`;
