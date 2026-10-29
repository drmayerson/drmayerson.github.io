// Example group for demo mode. Fictional families; dates are generated relative to today
// so the demo always shows a live week with a few weeks of history behind it.

import { computePlan, fairnessStats } from './algorithm.js';
import { currentWeek, addDays } from './dates.js';

const leg = (status, seats) => (seats == null ? { status } : { status, seats });

const FAMILIES = [
  { id: 'f-peeters', name: 'Peeters', parent: 'Sarah', kids: [{ id: 'k-lotte', name: 'Lotte' }], address: 'Stationsplein, Overijse', lat: 50.7712, lng: 4.5378, seats: 3, usual: { to: leg('can', 3), from: leg('need') } },
  { id: 'f-janssens', name: 'Janssens', parent: 'Pieter', kids: [{ id: 'k-noor', name: 'Noor' }], address: 'Dorpsstraat, Huldenberg', lat: 50.7893, lng: 4.5829, seats: 4, usual: { to: leg('need'), from: leg('driving', 4) } },
  { id: 'f-maes', name: 'Maes', parent: 'Inge', kids: [{ id: 'k-mila', name: 'Mila' }], address: 'Tombeekheide, Overijse', lat: 50.7552, lng: 4.5531, seats: 2, usual: null },
  { id: 'f-claes', name: 'Claes', parent: 'Tom', kids: [{ id: 'k-fien', name: 'Fien' }], address: 'Jezus-Eik, Overijse', lat: 50.7487, lng: 4.4693, seats: 3, usual: { to: leg('can', 3), from: leg('can', 3) } },
  { id: 'f-wouters', name: 'Wouters', parent: 'Lien', kids: [{ id: 'k-elise', name: 'Elise' }], address: 'Maleizen, Overijse', lat: 50.7771, lng: 4.5093, seats: 3, usual: { to: leg('rather_not', 3), from: leg('rather_not', 3) } },
  { id: 'f-desmet', name: 'De Smet', parent: 'Koen', kids: [{ id: 'k-lina', name: 'Lina' }], address: 'Ottenburg, Huldenberg', lat: 50.7781, lng: 4.6214, seats: 3, usual: { to: leg('can', 3), from: leg('can', 3) } },
  { id: 'f-mertens', name: 'Mertens', parent: 'Evi', kids: [{ id: 'k-hanne', name: 'Hanne' }], address: 'Neerijse, Huldenberg', lat: 50.8152, lng: 4.6338, seats: 3, usual: { to: leg('need'), from: leg('need') } },
];

export function buildDemoState(defaults) {
  const now = new Date();
  const settings = {
    ...defaults,
    groupName: 'Dansles (demo)',
    studio: { address: 'Dansstudio, Overijse centrum', lat: 50.7745, lng: 4.5340 },
    weekday: 3, time: '14:00', endTime: '15:30', deadlineDaysBefore: 1, deadlineTime: '20:00',
  };
  const week = currentWeek(settings, now);
  settings.startWeek = addDays(week, -7 * 6);
  const families = structuredClone(FAMILIES);

  // Past weeks: mostly usual answers, with a few realistic deviations.
  const responses = {};
  const weeks = {};
  const plans = [];
  for (let i = 6; i >= 1; i--) {
    const w = addDays(week, -7 * i);
    if (i === 3) { weeks[w] = { cancelled: true, plan: null }; continue; } // holiday
    const r = {
      'f-maes': { kids: ['k-mila'], to: leg('need'), from: leg(i % 2 ? 'can' : 'need', 2) },
      'f-mertens': { kids: ['k-hanne'], to: leg('need'), from: leg(i === 5 ? 'can' : 'need', 3) },
    };
    if (i === 2) r['f-desmet'] = { kids: [], to: leg('need'), from: leg('need') }; // Lina was ill
    responses[w] = r;
    const stats = fairnessStats(plans.slice(-16), families.map((f) => f.id));
    const plan = computePlan({ week: w, families, responses: r, stats, studio: settings.studio });
    plan.computedAt = new Date(now.getTime() - i * 7 * 864e5).toISOString();
    plans.push(plan);
    weeks[w] = { cancelled: false, plan };
  }

  // This week: four families have answered, three haven't.
  responses[week] = {
    'f-peeters': { kids: ['k-lotte'], to: leg('can', 3), from: leg('need') },
    'f-claes': { kids: ['k-fien'], to: leg('rather_not', 3), from: leg('can', 3) },
    'f-janssens': { kids: ['k-noor'], to: leg('self'), from: leg('driving', 4) },
    'f-mertens': { kids: ['k-hanne'], to: leg('need'), from: leg('need') },
  };

  return { settings, families, responses, weeks };
}
