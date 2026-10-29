// UI (Preact + htm, no build step). Dutch interface.
import { html, render, useState, useEffect, useMemo, useRef } from '../vendor/preact-htm.js';
import { computePlan, fairnessStats, effectiveAnswer, changedSincePlan, movePassenger, freeSeats, recentLessonPlans, LEGS, WEIGHTS } from './algorithm.js';
import { currentWeek, addDays, deadlineOf, formatDay, formatDateTime, timeLeft, pastWeeks, dayName } from './dates.js';
import { createStore, safeLS, shareLink } from './store.js';
import {
  STATUS, STATUS_ORDER, DRIVER_STATUSES, LEG, kidsLabel, kidNames, famLabel, carKids,
  scheduleText, reminderText, whatsappUrl, mapsUrl, parseCoords, geocode, newId,
} from './text.js';

const ME_KEY = 'carpool.me';
const WEEKS_AHEAD = 6;

// ---------------------------------------------------------------- model

const activeFamilies = (data) =>
  data.families.filter((f) => !f.archived).sort((a, b) => a.name.localeCompare(b.name, 'nl'));

function statsBefore(data, week) {
  const s = data.settings;
  const plans = recentLessonPlans(pastWeeks(s, week), data.weeks, s.lookbackWeeks || 16);
  return fairnessStats(plans, data.families.map((f) => f.id));
}

function weekModel(data, week, now) {
  const { settings } = data;
  const fams = activeFamilies(data);
  const byId = Object.fromEntries(data.families.map((f) => [f.id, f]));
  const responses = data.responses[week] || {};
  const rec = data.weeks[week] || {};
  const answers = Object.fromEntries(fams.map((f) => [f.id, effectiveAnswer(f, responses[f.id])]));
  const deadline = deadlineOf(settings, week);
  const pastDeadline = now > deadline;
  const stats = statsBefore(data, week);
  const cancelled = !!rec.cancelled;
  const live = cancelled || fams.length === 0 ? null : computePlan({ week, families: fams, responses, stats, studio: settings.studio });
  const stored = rec.plan || null;
  const plan = cancelled ? null : stored || live;
  const changed = stored ? changedSincePlan(stored, fams, responses) : [];
  const kidsCount = (id) => answers[id]?.kids.length ?? 0;
  return { week, settings, fams, byId, responses, rec, answers, deadline, pastDeadline, stats, cancelled, plan, stored, changed, kidsCount };
}

/** Store a plan for every week whose deadline passed without one (so history and fairness build up). */
async function lockDue(store, data, now) {
  const s = data.settings;
  if (!s.startWeek || activeFamilies(data).length === 0) return false;
  const cur = currentWeek(s, now);
  const due = pastWeeks(s, cur);
  if (now > deadlineOf(s, cur)) due.push(cur);
  const work = { ...data, weeks: { ...data.weeks } };
  let changed = false;
  for (const w of due) {
    const rec = work.weeks[w];
    if (rec?.cancelled || rec?.plan) continue;
    const plan = computePlan({ week: w, families: activeFamilies(data), responses: data.responses[w] || {}, stats: statsBefore(work, w), studio: s.studio });
    // A past week nobody opened after its deadline: reconstructed from answers and today's defaults.
    if (w !== cur) plan.inferred = true;
    work.weeks[w] = await store.saveWeek(w, { ...(rec || {}), cancelled: false, plan }, { ifAbsent: true });
    changed = true;
  }
  return changed;
}

// ---------------------------------------------------------------- small pieces

const Icon = ({ d }) => html`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d.map((p) => html`<path d=${p} />`)}</svg>`;
const ICONS = {
  week: ['M5 18h14', 'M7 18v-3a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v3', 'M6 13l1.5-4h9L18 13', 'M8 18v1.5M16 18v1.5'],
  families: ['M3 20v-1a5 5 0 0 1 10 0v1', 'M8 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6', 'M14 20v-1a4 4 0 0 1 7-2.6', 'M17 11a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5'],
  history: ['M4 20V10', 'M10 20V4', 'M16 20v-7', 'M22 20H2'],
  settings: ['M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6', 'M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z'],
};

function Sheet({ title, onClose, children }) {
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);
  return html`<div class="scrim" onClick=${(e) => e.target === e.currentTarget && onClose()}>
    <div class="sheet" role="dialog" aria-modal="true" aria-label=${title}>
      <div class="sheet-head"><h2>${title}</h2><button class="iconbtn" onClick=${onClose} aria-label="Sluiten">✕</button></div>
      ${children}
    </div>
  </div>`;
}

function Stepper({ value, min = 0, max = 8, onChange, label }) {
  return html`<span class="stepper" role="group" aria-label=${label}>
    <button type="button" onClick=${() => onChange(Math.max(min, value - 1))} aria-label="Minder" disabled=${value <= min}>−</button>
    <span class="num" aria-live="polite">${value}</span>
    <button type="button" onClick=${() => onChange(Math.min(max, value + 1))} aria-label="Meer" disabled=${value >= max}>+</button>
  </span>`;
}

async function copyText(text, notify) {
  try { await navigator.clipboard.writeText(text); notify('Gekopieerd'); return true; }
  catch { return false; }
}

function ShareActions({ text, waLabel, notify }) {
  const [fallback, setFallback] = useState(false);
  return html`<div class="stack">
    <div class="row">
      <a class="btn primary" href=${whatsappUrl(text)} target="_blank" rel="noopener">${waLabel}</a>
      <button class="btn" onClick=${async () => { if (!(await copyText(text, notify))) setFallback(true); }}>Kopieer tekst</button>
    </div>
    ${fallback && html`<textarea class="input" rows="6" readonly onFocus=${(e) => e.target.select()}>${text}</textarea>
      <p class="hint">Kopiëren lukte niet automatisch: selecteer de tekst hierboven en kopieer ze zelf.</p>`}
  </div>`;
}

// ---------------------------------------------------------------- answer editor

function LegPicker({ leg, value, onChange, family, kidCount, settings }) {
  const isDriver = DRIVER_STATUSES.includes(value.status);
  const when = leg === 'to' ? `${LEG.to.sub} · ${settings.time}` : `${LEG.from.sub} · ${settings.endTime}`;
  const pick = (status) => onChange(DRIVER_STATUSES.includes(status)
    ? { status, seats: Math.max(value.seats ?? family.seats ?? 3, kidCount) }
    : { status });
  return html`<div class=${`leg-pick leg-${leg}`}>
    <div class="leg-pick-head"><h3>${LEG[leg].name}</h3><span class="when">${when}</span></div>
    <div class="choices" role="group" aria-label=${`${LEG[leg].name}: jouw antwoord`}>
      ${STATUS_ORDER.map((s) => html`<button type="button" class="choice" aria-pressed=${value.status === s} title=${STATUS[s].long} onClick=${() => pick(s)}>${STATUS[s].short}</button>`)}
    </div>
    <p class="hint">${STATUS[value.status].long}.</p>
    ${isDriver && html`<div class="row small">
      <${Stepper} label="Plaatsen voor kinderen" value=${value.seats} min=${kidCount} onChange=${(n) => onChange({ ...value, seats: n })} />
      <span class="muted">plaatsen voor kinderen, je eigen kind${kidCount > 1 ? 'eren' : ''} meegeteld</span>
    </div>`}
  </div>`;
}

function AnswerEditor({ family, model, onSave, onSaveUsual, onClear }) {
  const { settings, responses, answers } = model;
  const response = responses[family.id];
  const eff = answers[family.id] || effectiveAnswer(family, response);
  const [draft, setDraft] = useState(() => ({ kids: eff.kids, to: eff.to, from: eff.from }));
  const [saveState, setSaveState] = useState(''); // '' | 'saving' | 'saved' | 'failed'
  const timer = useRef(null);
  const queue = useRef(Promise.resolve());
  const latest = useRef(null);
  const alive = useRef(true);

  // Saves run one after another, so an older answer can never overwrite a newer one on the server.
  // "Opgeslagen" only appears after the server confirmed the latest answer.
  const save = (next) => {
    latest.current = next;
    setSaveState('saving');
    queue.current = queue.current.then(async () => {
      if (latest.current !== next) return; // a newer answer is queued behind this one
      const ok = await onSave(next);
      if (alive.current && latest.current === next) setSaveState(ok ? 'saved' : 'failed');
    });
  };
  const commit = (next) => {
    setDraft(next);
    clearTimeout(timer.current);
    setSaveState('saving');
    timer.current = setTimeout(() => save(next), 450);
  };
  useEffect(() => () => { alive.current = false; clearTimeout(timer.current); }, []);

  const kids = family.kids || [];
  const going = draft.kids.length > 0;
  const toggleKid = (id) => commit({ ...draft, kids: draft.kids.includes(id) ? draft.kids.filter((k) => k !== id) : [...draft.kids, id] });
  const sameAsUsual = family.usual && JSON.stringify({ to: family.usual.to, from: family.usual.from }) === JSON.stringify({ to: draft.to, from: draft.from });

  return html`<div class="stack" style="gap:16px">
    ${eff.source !== 'answer' && !saveState && html`<div class="notice warn">
      <p><strong>Nog niet ingevuld voor deze week.</strong> ${eff.source === 'usual'
        ? 'Zonder antwoord gebruiken we jullie standaardantwoord, zoals hieronder.'
        : `Zonder antwoord gaan we ervan uit dat ${kidsLabel(family)} een lift nodig heeft.`}</p>
      <div class="row"><button class="btn primary" onClick=${() => commit(draft)}>Klopt, bevestig</button></div>
    </div>`}

    <div class="stack">
      ${kids.map((k) => html`<label class="switch">
        <input type="checkbox" id=${`kid-${family.id}-${k.id}`} checked=${draft.kids.includes(k.id)} onChange=${() => toggleKid(k.id)} />
        ${k.name} gaat mee naar de les
      </label>`)}
    </div>

    ${going
      ? LEGS.map((leg) => html`<${LegPicker} leg=${leg} value=${draft[leg]} family=${family} kidCount=${draft.kids.length} settings=${settings}
          onChange=${(v) => commit({ ...draft, [leg]: v })} />`)
      : html`<p class="muted">Geen rit nodig en je wordt deze week niet ingepland als chauffeur.</p>`}

    <div class="row" style="justify-content:space-between">
      <span class="savestate" aria-live="polite">
        ${saveState === 'saving' && 'Bezig met opslaan…'}
        ${saveState === 'saved' && 'Opgeslagen'}
        ${saveState === 'failed' && html`<span style="color:var(--bad)">Niet opgeslagen.</span> <button class="btn ghost small" onClick=${() => save(draft)}>Opnieuw proberen</button>`}
      </span>
      <div class="row">
        ${going && !sameAsUsual && html`<button class="btn ghost" onClick=${() => onSaveUsual({ to: draft.to, from: draft.from })}>Bewaar als standaardantwoord</button>`}
        ${response && html`<button class="btn ghost" onClick=${onClear}>Wis antwoord</button>`}
      </div>
    </div>
  </div>`;
}

// ---------------------------------------------------------------- plan

function Seats({ car, model }) {
  const own = model.kidsCount(car.driverId);
  const taken = car.riders.reduce((n, id) => n + model.kidsCount(id), 0);
  const empty = Math.max(0, car.seats - own - taken);
  const cells = [...Array(own).fill('own'), ...Array(taken).fill('taken'), ...Array(empty).fill('')];
  return html`<span class="seats" title=${`${own + taken} van ${car.seats} plaatsen bezet`} aria-label=${`${own + taken} van ${car.seats} plaatsen bezet`}>
    ${cells.map((c) => html`<span class=${`seat ${c}`}></span>`)}
  </span>`;
}

function KidButton({ id, leg, model, me, onMove }) {
  const f = model.byId[id];
  const label = kidsLabel(f, model.answers[id]?.kids);
  return html`<button type="button" class=${`kid ${onMove ? 'movable' : ''} ${id === me ? 'me' : ''}`}
    onClick=${onMove ? () => onMove(leg, id) : undefined} disabled=${!onMove}
    title=${onMove ? `Verplaats ${label}` : undefined}>${label}</button>`;
}

function Car({ car, leg, model, me, onMove }) {
  const f = model.byId[car.driverId];
  const ownKids = kidNames(f, model.answers[car.driverId]?.kids);
  const pt = (id) => model.byId[id] && { lat: model.byId[id].lat, lng: model.byId[id].lng };
  const studio = { ...model.settings.studio, };
  // stops along the route; each stop after the first carries its own connector so wrapped lines start cleanly
  const home = html`<span class="who">${ownKids.join(', ') || f?.name || '?'}</span> <span class="where">thuis</span>`;
  const studioLabel = html`<span class="where">${model.settings.studio?.address ? 'Studio' : 'Les'}</span>`;
  const riderStops = car.riders.map((id) => ({ key: id, body: html`<${KidButton} id=${id} leg=${leg} model=${model} me=${me} onMove=${onMove} />` }));
  const stops = leg === 'to'
    ? [{ key: 'home', body: home }, ...riderStops, { key: 'studio', body: studioLabel, end: true }]
    : [{ key: 'studio', body: studioLabel, end: true }, ...riderStops, { key: 'home', body: home }];
  const points = leg === 'to'
    ? [pt(car.driverId), ...car.riders.map(pt), studio]
    : [studio, ...car.riders.map(pt), pt(car.driverId)];
  const url = mapsUrl(points);
  return html`<div class=${`car ${car.driverId === me ? 'is-me' : ''}`}>
    <div class="car-head">
      <span class="driver">${famLabel(f)}</span>
      ${car.driverId === me && html`<span class="tag you">jij</span>`}
      ${car.forced && html`<span class="tag">rijdt sowieso</span>`}
      ${car.ratherNot && html`<span class="tag warn">liever niet</span>`}
      <${Seats} car=${car} model=${model} />
    </div>
    <div class="route">
      ${stops.map((st, i) => html`<span key=${st.key} class=${`stop ${st.end ? 'end' : ''}`}>${i > 0 && html`<span class="link"></span>`}<span class="dot"></span><span>${st.body}</span></span>`)}
    </div>
    <div class="car-foot">
      <span class="num">± ${car.km} km</span>
      ${url && html`<a href=${url} target="_blank" rel="noopener">Route in Google Maps</a>`}
    </div>
  </div>`;
}

function LegBlock({ leg, model, me, onMove, onVolunteer }) {
  const lp = model.plan.legs[leg];
  const myLeg = me && model.answers[me]?.[leg];
  const canVolunteer = onVolunteer && me && model.answers[me]?.kids.length > 0 && myLeg && !DRIVER_STATUSES.includes(myLeg.status);
  return html`<div class=${`legblock leg-${leg}`}>
    <div class="leghead"><span class="bar"></span><h3>${LEG[leg].name}</h3>
      <span class="muted small">${leg === 'to' ? `${LEG.to.sub}, ${model.settings.time}` : `${LEG.from.sub}, ${model.settings.endTime}`}</span></div>
    ${lp.participants.length === 0
      ? html`<p class="muted small">Niemand heeft een rit nodig.</p>`
      : lp.cars.map((c) => html`<${Car} key=${c.driverId} car=${c} leg=${leg} model=${model} me=${me} onMove=${onMove} />`)}
    ${lp.unassigned.length > 0 && html`<div class="notice bad">
      <p><strong>${lp.seatsShort === 1 ? '1 plaats' : `${lp.seatsShort} plaatsen`} te weinig.</strong> Nog geen lift voor:
        ${lp.unassigned.map((id) => html` <${KidButton} id=${id} leg=${leg} model=${model} me=${me} onMove=${onMove} />`)}</p>
      <p class="small">Kan iemand toch rijden of een extra kind meenemen? Pas je antwoord aan, de planning past zich aan.</p>
      ${canVolunteer && html`<div class="row"><button class="btn primary" onClick=${() => onVolunteer(leg)}>Ik kan ${LEG[leg].name.toLowerCase()} rijden</button></div>`}
    </div>`}
  </div>`;
}

function MySummary({ model, me }) {
  const f = model.byId[me];
  const a = model.answers[me];
  if (!f || !a || !model.plan) return null;
  const line = (leg) => {
    const lp = model.plan.legs[leg];
    const kid = kidsLabel(f, a.kids);
    if (a.kids.length === 0) return html`<span class="muted">${kid} gaat niet mee.</span>`;
    if (a[leg].status === 'self') return html`<span>Eigen vervoer.</span>`;
    const mine = lp.cars.find((c) => c.driverId === me);
    if (mine) {
      const others = mine.riders.map((id) => kidsLabel(model.byId[id], model.answers[id]?.kids));
      return html`<span><strong>Jij rijdt</strong>${others.length ? ` en neemt ${others.join(', ')} mee` : ' (enkel je eigen kind)'}.</span>`;
    }
    const car = lp.cars.find((c) => c.riders.includes(me));
    if (car) {
      const d = model.byId[car.driverId];
      return html`<span>${kid} rijdt mee met <strong>${famLabel(d)}</strong>${d?.parent ? ` (${d.parent})` : ''}.</span>`;
    }
    return html`<span class="tag warn">Nog geen lift voor ${kid}</span>`;
  };
  return html`<div class="mine-summary">
    ${LEGS.map((leg) => html`<div class="mine-line"><span class=${`tag ${leg}`}>${LEG[leg].name}</span>${line(leg)}</div>`)}
  </div>`;
}

function PlanStatus({ model, onRecalc }) {
  const { stored, pastDeadline, changed, byId, settings, week } = model;
  let text;
  if (!stored) text = `Voorstel. Past zich automatisch aan tot de deadline (${formatDateTime(deadlineOf(settings, week))}).`;
  else if (!pastDeadline) text = 'Met de hand aangepast. Blijft zo staan tot iemand herberekent.';
  else text = 'Vastgelegd na de deadline.';
  return html`<div class="stack">
    <p class="muted small">${text}</p>
    ${changed.length > 0 && html`<div class="notice warn">
      <p><strong>Gewijzigde antwoorden sinds deze planning:</strong> ${changed.map((id) => famLabel(byId[id])).join(', ')}.</p>
      <div class="row"><button class="btn" onClick=${onRecalc}>Herbereken planning</button></div>
    </div>`}
    ${stored && changed.length === 0 && html`<div class="row"><button class="btn ghost" onClick=${onRecalc}>${pastDeadline ? 'Opnieuw berekenen' : 'Terug naar automatisch voorstel'}</button></div>`}
  </div>`;
}

function MoveSheet({ move, model, onMove, onClose }) {
  const { leg, id } = move;
  const lp = model.plan.legs[leg];
  const need = model.kidsCount(id);
  const current = lp.cars.find((c) => c.riders.includes(id));
  const options = lp.cars.filter((c) => c !== current);
  return html`<${Sheet} title=${`${kidsLabel(model.byId[id], model.answers[id]?.kids)} verplaatsen`} onClose=${onClose}>
    <p class="muted small">${LEG[leg].name}: kies een andere auto. De route wordt opnieuw berekend.</p>
    <div class="list">
      ${options.map((c) => {
        const free = freeSeats(c, model.kidsCount);
        return html`<button class="item" disabled=${free < need} onClick=${() => onMove(leg, id, c.driverId)}>
          <span class="grow"><span class="name">${famLabel(model.byId[c.driverId])}</span>
          <span class="sub"> · ${free < need ? 'vol' : `${free} vrij`}</span></span></button>`;
      })}
      ${current && html`<button class="item" onClick=${() => onMove(leg, id, null)}><span class="grow"><span class="name">Nog geen lift</span><span class="sub"> · uit deze auto halen</span></span></button>`}
    </div>
  <//>`;
}

// ---------------------------------------------------------------- week view

function Overview({ model, onPick, me }) {
  const missing = model.fams.filter((f) => !model.responses[f.id]);
  return html`<div class="list">
    ${model.fams.map((f) => {
      const a = model.answers[f.id];
      const src = model.responses[f.id] ? null : a.source === 'usual' ? html`<span class="tag">standaard</span>` : html`<span class="tag warn">geen antwoord</span>`;
      return html`<button class="item" onClick=${() => onPick(f.id)}>
        <span class="grow"><span class="name">${kidsLabel(f)}</span> <span class="sub">${famLabel(f)}${f.id === me ? ' · jij' : ''}</span>
          <span class="row" style="margin-top:4px">
            ${a.kids.length === 0
              ? html`<span class="tag">gaat niet mee</span>`
              : LEGS.map((leg) => html`<span class=${`tag ${leg}`}>${LEG[leg].name}: ${STATUS[a[leg].status].short}${DRIVER_STATUSES.includes(a[leg].status) ? ` (${a[leg].seats})` : ''}</span>`)}
            ${src}
          </span>
        </span>
      </button>`;
    })}
  </div>
  ${missing.length > 0 && html`<p class="small muted">${missing.length} van ${model.fams.length} gezinnen hebben nog niet geantwoord.</p>`}`;
}

function WhoAreYou({ fams, onPick, goFamilies }) {
  return html`<div class="card mine">
    <h2>Wie ben jij?</h2>
    <p class="muted small">Dit toestel onthoudt je keuze, zodat je meteen je eigen week ziet.</p>
    ${fams.length === 0
      ? html`<button class="btn primary" onClick=${goFamilies}>Voeg eerst de gezinnen toe</button>`
      : html`<div class="choices">${fams.map((f) => html`<button class="choice" onClick=${() => onPick(f.id)}>${kidsLabel(f)}<br /><span class="muted small">${famLabel(f)}</span></button>`)}</div>
        <button class="btn ghost" onClick=${() => onPick('')}>Ik kijk enkel mee</button>`}
  </div>`;
}

function WeekView({ data, model, offset, setOffset, me, setMe, actions, store, notify, go }) {
  const { settings, week, fams, byId, plan, deadline, pastDeadline, cancelled } = model;
  const [move, setMove] = useState(null);
  const [editing, setEditing] = useState(null);
  const myFam = me && byId[me];
  const left = timeLeft(deadline);
  // Messages carry the plain address only: phones that opened the invite link once remember the key.
  const link = location.href.split('#')[0];
  const missingNames = fams.filter((f) => !model.responses[f.id]).map((f) => famLabel(f));
  const onMove = plan ? (leg, id) => setMove({ leg, id }) : null;

  return html`
    <header class="top">
      <span class="eyebrow">${settings.groupName}</span>
      <div class="weeknav">
        <button class="iconbtn" aria-label="Vorige week" disabled=${offset <= 0} onClick=${() => setOffset(offset - 1)}>‹</button>
        <h1>${formatDay(week)}</h1>
        <button class="iconbtn" aria-label="Volgende week" disabled=${offset >= WEEKS_AHEAD} onClick=${() => setOffset(offset + 1)}>›</button>
      </div>
      <div class="meta">
        <span class="num">${settings.time}–${settings.endTime}</span>
        ${!cancelled && html`<span>${left ? `Antwoorden tot ${formatDateTime(deadline)} (${left})` : 'Deadline voorbij'}</span>`}
      </div>
    </header>

    ${store.mode === 'demo' && offset === 0 && html`<div class="notice demo small">
      <p><strong>Demo.</strong> Voorbeeldgezinnen; wat je aanpast blijft enkel op dit toestel bewaard.</p>
    </div>`}

    ${cancelled
      ? html`<div class="notice"><p><strong>Geen les deze week.</strong> Er wordt niets gepland en de week telt niet mee voor de beurtrol.</p>
          <div class="row"><button class="btn" onClick=${() => actions.toggleCancelled(week)}>Toch les</button></div></div>`
      : html`
        ${me == null && html`<${WhoAreYou} fams=${fams} onPick=${setMe} goFamilies=${() => go('families')} />`}

        ${myFam && html`<section class="section">
          <div class="section-head"><h2>Jouw antwoord</h2><button class="btn ghost small" onClick=${() => setMe(null)}>Niet ${myFam.name}?</button></div>
          <div class="card mine">
            <${AnswerEditor} key=${`${me}|${week}`} family=${myFam} model=${model}
              onSave=${(r) => actions.saveResponse(week, me, r)} onSaveUsual=${(u) => actions.saveUsual(me, u)} onClear=${() => actions.clearResponse(week, me)} />
          </div>
        </section>`}

        ${plan && html`<section class="section">
          <div class="section-head"><h2>Planning</h2><button class="btn ghost small" onClick=${actions.openHelp}>Hoe werkt dit?</button></div>
          ${myFam && html`<${MySummary} model=${model} me=${me} />`}
          <${PlanStatus} model=${model} onRecalc=${() => actions.recalc(week)} />
          ${LEGS.map((leg) => html`<${LegBlock} leg=${leg} model=${model} me=${me} onMove=${onMove} onVolunteer=${(l) => actions.volunteer(week, me, l)} />`)}
          <p class="hint">Tik op een kind om het naar een andere auto te verplaatsen.</p>
        </section>`}

        ${fams.length > 0 && html`<section class="section">
          <div class="section-head"><h2>Antwoorden</h2></div>
          <${Overview} model=${model} me=${me} onPick=${(id) => setEditing(id)} />
          <div class="stack">
            ${missingNames.length > 0 && !pastDeadline && html`<div class="stack">
              <span class="label">Herinnering sturen</span>
              <${ShareActions} notify=${notify} waLabel="Herinnering via WhatsApp" text=${reminderText({ settings, week, missing: missingNames, link })} />
            </div>`}
            ${plan && html`<div class="stack">
              <span class="label">Planning delen</span>
              <${ShareActions} notify=${notify} waLabel="Planning via WhatsApp" text=${scheduleText(plan, { settings, week, byId, answers: model.answers, link })} />
            </div>`}
          </div>
        </section>`}

        <div class="row"><button class="btn ghost small" onClick=${() => actions.toggleCancelled(week)}>Geen les deze week?</button></div>
      `}

    ${move && html`<${MoveSheet} move=${move} model=${model} onClose=${() => setMove(null)}
      onMove=${(leg, id, to) => { setMove(null); actions.move(week, leg, id, to); }} />`}
    ${editing && byId[editing] && html`<${Sheet} title=${`Antwoord van ${famLabel(byId[editing])}`} onClose=${() => setEditing(null)}>
      ${editing !== me && html`<p class="muted small">Je vult in voor een ander gezin, bijvoorbeeld als ze het via WhatsApp lieten weten.</p>`}
      <${AnswerEditor} key=${`${editing}|${week}`} family=${byId[editing]} model=${model}
        onSave=${(r) => actions.saveResponse(week, editing, r)} onSaveUsual=${(u) => actions.saveUsual(editing, u)} onClear=${() => actions.clearResponse(week, editing)} />
    <//>`}
  `;
}

// ---------------------------------------------------------------- families

function LocationField({ idPrefix, value, onChange }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [raw, setRaw] = useState(Number.isFinite(value.lat) ? `${value.lat}, ${value.lng}` : '');
  const has = Number.isFinite(value.lat) && Number.isFinite(value.lng);
  const lookup = async () => {
    if (!value.address) { setMsg('Vul eerst een adres in.'); return; }
    setBusy(true); setMsg('');
    try {
      const r = await geocode(value.address);
      if (!r) setMsg('Adres niet gevonden. Probeer het met straat, nummer en gemeente, of plak de coördinaten hieronder.');
      else { onChange({ ...value, lat: r.lat, lng: r.lng }); setRaw(`${r.lat}, ${r.lng}`); setMsg(`Gevonden: ${r.label}`); }
    } catch {
      setMsg('Opzoeken lukt hier niet. Plak de coördinaten uit Google Maps hieronder.');
    }
    setBusy(false);
  };
  return html`<div class="stack">
    <div class="field">
      <label for=${`${idPrefix}-addr`}>Adres</label>
      <div class="row">
        <input class="input grow" id=${`${idPrefix}-addr`} value=${value.address || ''} placeholder="Straat 12, 3090 Overijse"
          onInput=${(e) => onChange({ ...value, address: e.target.value })} />
        <button type="button" class="btn" onClick=${lookup} disabled=${busy}>${busy ? 'Zoeken…' : 'Zoek op kaart'}</button>
      </div>
      ${msg && html`<span class="hint">${msg}</span>`}
    </div>
    <div class="field">
      <label for=${`${idPrefix}-coords`}>Locatie op de kaart</label>
      <input class="input" id=${`${idPrefix}-coords`} value=${raw} placeholder="50.7712, 4.5378 of een Google Maps-link"
        onInput=${(e) => { setRaw(e.target.value); const c = parseCoords(e.target.value); onChange({ ...value, lat: c?.lat ?? null, lng: c?.lng ?? null }); }} />
      <span class="hint">${has
        ? html`Locatie ingesteld. <a href=${`https://www.google.com/maps/search/?api=1&query=${value.lat},${value.lng}`} target="_blank" rel="noopener">Controleer op de kaart</a>`
        : 'In Google Maps: houd het huis ingedrukt (of rechtsklik) en kopieer de coördinaten.'}</span>
    </div>
  </div>`;
}

function FamilyForm({ family, settings, onSave, onDelete, onCancel }) {
  const [f, setF] = useState(() => family ? structuredClone(family) : {
    id: newId('f'), name: '', parent: '', kids: [{ id: newId('k'), name: '' }], address: '', lat: null, lng: null, seats: 3, usual: null,
  });
  const [confirmDel, setConfirmDel] = useState(false);
  const [err, setErr] = useState('');
  const set = (patch) => setF({ ...f, ...patch });
  const save = () => {
    const kids = f.kids.map((k) => ({ ...k, name: k.name.trim() })).filter((k) => k.name);
    if (!f.name.trim()) return setErr('Vul een gezinsnaam in.');
    if (!kids.length) return setErr('Vul minstens één kind in.');
    onSave({ ...f, name: f.name.trim(), parent: (f.parent || '').trim(), kids });
  };
  const usualOn = !!f.usual;
  const usual = f.usual || { to: { status: 'need' }, from: { status: 'need' } };
  return html`<form class="stack" style="gap:14px" onSubmit=${(e) => { e.preventDefault(); save(); }}>
    <div class="two">
      <div class="field"><label for="fam-name">Gezinsnaam</label><input class="input" id="fam-name" value=${f.name} placeholder="Peeters" onInput=${(e) => set({ name: e.target.value })} /></div>
      <div class="field"><label for="fam-parent">Ouder(s)</label><input class="input" id="fam-parent" value=${f.parent} placeholder="Sarah" onInput=${(e) => set({ parent: e.target.value })} /></div>
    </div>
    <div class="field">
      <span class="label">Kind(eren) in de dansles</span>
      ${f.kids.map((k, i) => html`<div class="row">
        <input class="input grow" id=${`kid-name-${k.id}`} aria-label="Naam kind" value=${k.name} placeholder="Voornaam"
          onInput=${(e) => set({ kids: f.kids.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)) })} />
        ${f.kids.length > 1 && html`<button type="button" class="btn ghost" onClick=${() => set({ kids: f.kids.filter((_, j) => j !== i) })}>Verwijder</button>`}
      </div>`)}
      <div><button type="button" class="btn ghost" onClick=${() => set({ kids: [...f.kids, { id: newId('k'), name: '' }] })}>+ Nog een kind</button></div>
    </div>
    <${LocationField} idPrefix="fam" value=${{ address: f.address, lat: f.lat, lng: f.lng }} onChange=${(v) => set(v)} />
    <div class="field">
      <span class="label">Plaatsen voor kinderen in de auto (incl. eigen kind)</span>
      <div class="row"><${Stepper} label="Plaatsen" value=${f.seats} min=${1} onChange=${(n) => set({ seats: n })} /><span class="hint">Standaard, aan te passen per week.</span></div>
    </div>
    <div class="field">
      <label class="switch"><input type="checkbox" id="fam-usual" checked=${usualOn} onChange=${() => set({ usual: usualOn ? null : usual })} /> Standaardantwoord instellen</label>
      <span class="hint">Wat doen jullie meestal? Vult dit gezin een week niets in, dan gebruikt de planning dit antwoord. Zonder standaardantwoord gaan we ervan uit dat jullie kind een lift nodig heeft.</span>
    </div>
    ${usualOn && LEGS.map((leg) => html`<${LegPicker} leg=${leg} value=${usual[leg]} family=${f} kidCount=${f.kids.length} settings=${settings}
      onChange=${(v) => set({ usual: { ...usual, [leg]: v } })} />`)}
    ${err && html`<p class="small" style="color:var(--bad)">${err}</p>`}
    <div class="row" style="justify-content:space-between">
      <div class="row"><button class="btn primary" type="submit">Bewaar</button><button class="btn" type="button" onClick=${onCancel}>Annuleer</button></div>
      ${family && (confirmDel
        ? html`<div class="row"><span class="small">Zeker? Ook hun antwoorden verdwijnen.</span><button type="button" class="btn danger solid" onClick=${() => onDelete(f.id)}>Ja, verwijder</button></div>`
        : html`<button type="button" class="btn danger" onClick=${() => setConfirmDel(true)}>Verwijder gezin</button>`)}
    </div>
  </form>`;
}

function FamiliesView({ data, actions, me, setMe }) {
  const [edit, setEdit] = useState(null); // family id, 'new' or null
  const fams = activeFamilies(data);
  const fam = edit && edit !== 'new' ? data.families.find((f) => f.id === edit) : null;
  return html`
    <header class="top"><span class="eyebrow">${data.settings.groupName}</span><h1>Gezinnen</h1>
      <p class="muted small">Adres, plaatsen en standaardantwoord per gezin. Iedereen met de link kan dit aanpassen.</p></header>
    <div class="list">
      ${fams.map((f) => html`<button class="item" onClick=${() => setEdit(f.id)}>
        <span class="grow"><span class="name">${kidsLabel(f)}</span> <span class="sub">${famLabel(f)}${f.parent ? ` · ${f.parent}` : ''}</span><br />
          <span class="sub">${f.address || 'Geen adres'}${Number.isFinite(f.lat) ? '' : ' · locatie ontbreekt'} · ${f.seats} plaatsen</span></span>
        ${f.id === me && html`<span class="tag you">jij</span>`}
        ${!Number.isFinite(f.lat) && html`<span class="tag warn">kaart</span>`}
      </button>`)}
      ${fams.length === 0 && html`<p class="item muted">Nog geen gezinnen.</p>`}
    </div>
    <div class="row"><button class="btn primary" onClick=${() => setEdit('new')}>+ Gezin toevoegen</button></div>
    ${edit && html`<${Sheet} title=${fam ? famLabel(fam) : 'Nieuw gezin'} onClose=${() => setEdit(null)}>
      <${FamilyForm} family=${fam} settings=${data.settings} onCancel=${() => setEdit(null)}
        onSave=${async (f) => { setEdit(null); await actions.saveFamily(f); if (!fam && me == null && fams.length === 0) setMe(f.id); }}
        onDelete=${async (id) => { setEdit(null); await actions.deleteFamily(id); if (id === me) setMe(null); }} />
    <//>`}
  `;
}

// ---------------------------------------------------------------- history

function HistoryView({ data, now, actions, me }) {
  const s = data.settings;
  const cur = currentWeek(s, now);
  const weeks = pastWeeks(s, cur).reverse();
  const stats = statsBefore(data, cur);
  const fams = activeFamilies(data);
  const mean = (() => { const L = fams.reduce((n, f) => n + stats[f.id].legs, 0); const D = fams.reduce((n, f) => n + stats[f.id].drives, 0); return L ? D / L : 0; })();
  const [open, setOpen] = useState(null);
  const [move, setMove] = useState(null);
  const model = open ? weekModel(data, open, now) : null;
  return html`
    <header class="top"><span class="eyebrow">${s.groupName}</span><h1>Historiek</h1>
      <p class="muted small">Beurtrol over de laatste ${s.lookbackWeeks || 16} lesweken. Wie minder vaak reed, komt eerst aan de beurt. Een rit telt pas als je een ander kind meenam. <button class="btn ghost small" style="padding:0" onClick=${actions.openHelp}>Hoe werkt de planning?</button></p></header>
    ${fams.length > 0 && html`<div class="table-wrap"><table>
      <thead><tr><th>Gezin</th><th class="num">Gereden</th><th>Aandeel</th></tr></thead>
      <tbody>${fams.map((f) => {
        const st = stats[f.id];
        const share = st.legs ? st.drives / st.legs : 0;
        return html`<tr><td><strong>${kidsLabel(f)}</strong>${f.id === me ? html` <span class="tag you">jij</span>` : ''}<br /><span class="muted small">${famLabel(f)}</span></td>
          <td class="num">${st.drives} <span class="muted small">van ${st.legs}</span></td>
          <td style="width:40%"><div class="share-bar" title=${`${Math.round(share * 100)}% van hun ritten zelf gereden; groepsgemiddelde ${Math.round(mean * 100)}%`}><i style=${`width:${Math.min(100, share * 100)}%`}></i><b style=${`left:${Math.min(100, mean * 100)}%`}></b></div></td></tr>`;
      })}</tbody></table></div>
      <p class="hint">Gereden van het aantal ritten waarvoor ze zich opgaven. De streep in de balk is het groepsgemiddelde. Wie vaker "rij sowieso" kiest, rijdt gewoon meer; dat is prima.</p>`}

    <section class="section">
      <h2>Vorige weken</h2>
      ${weeks.length === 0 && html`<p class="muted small">Nog geen vorige weken. De historiek begint vanaf de startweek in Instellingen.</p>`}
      <div class="list">
        ${weeks.map((w) => {
          const rec = data.weeks[w];
          const p = rec?.plan;
          const names = (leg) => (p?.legs[leg].cars || []).filter((c) => c.riders.length).map((c) => data.families.find((f) => f.id === c.driverId)?.name || '?').join(', ') || '—';
          return html`<button class="item" onClick=${() => setOpen(w)}>
            <span class="grow"><span class="name">${formatDay(w)}</span><br />
              ${rec?.cancelled ? html`<span class="sub">Geen les</span>` : p
                ? html`<span class="sub">Heen: ${names('to')} · Terug: ${names('from')}</span>${p.inferred && !p.edited ? html` <span class="tag warn">achteraf berekend</span>` : ''}${p.edited ? html` <span class="tag">aangepast</span>` : ''}`
                : html`<span class="sub">Nog niet vastgelegd</span>`}</span>
          </button>`;
        })}
      </div>
    </section>

    ${open && html`<${Sheet} title=${formatDay(open)} onClose=${() => setOpen(null)}>
      ${model.cancelled
        ? html`<p>Geen les deze week.</p><div class="row"><button class="btn" onClick=${() => actions.toggleCancelled(open)}>Toch les</button></div>`
        : html`${model.plan?.inferred && !model.plan?.edited && html`<div class="notice warn small"><p><strong>Achteraf berekend.</strong> Niemand opende de app na de deadline van deze week, dus de planning werd later gemaakt uit de antwoorden en de standaardantwoorden van toen. Ze telt mee voor de beurtrol; klopt ze niet, pas ze dan hieronder aan.</p></div>`}
          <p class="muted small">Klopt dit niet met wat er echt gebeurde? Verplaats kinderen zodat de beurtrol juist blijft.</p>
          ${model.plan && LEGS.map((leg) => html`<${LegBlock} leg=${leg} model=${model} me=${me} onMove=${(l, id) => setMove({ leg: l, id })} onVolunteer=${null} />`)}
          <div class="row"><button class="btn ghost" onClick=${() => actions.toggleCancelled(open)}>Er was geen les</button></div>`}
      ${move && html`<${MoveSheet} move=${move} model=${model} onClose=${() => setMove(null)} onMove=${(leg, id, to) => { setMove(null); actions.move(open, leg, id, to); }} />`}
    <//>`}
  `;
}

// ---------------------------------------------------------------- settings

function SettingsView({ data, store, actions, notify, now, me, setMe }) {
  const [s, setS] = useState(() => structuredClone(data.settings));
  const [confirmReset, setConfirmReset] = useState(false);
  const [confirmForget, setConfirmForget] = useState(false);
  const set = (patch) => setS({ ...s, ...patch });
  const dirty = JSON.stringify(s) !== JSON.stringify(data.settings);
  const link = store.mode === 'supabase' ? shareLink(store.key) : null;
  return html`
    <header class="top"><span class="eyebrow">${data.settings.groupName}</span><h1>Instellingen</h1></header>
    <form class="stack" style="gap:16px" onSubmit=${(e) => { e.preventDefault(); actions.saveSettings(s); }}>
      <div class="field"><label for="set-name">Naam van de groep</label><input class="input" id="set-name" value=${s.groupName} onInput=${(e) => set({ groupName: e.target.value })} /></div>
      <div class="two">
        <div class="field"><label for="set-day">Lesdag</label>
          <select class="input" id="set-day" value=${s.weekday} onChange=${(e) => set({ weekday: +e.target.value })}>
            ${[1, 2, 3, 4, 5, 6, 0].map((d) => html`<option value=${d}>${dayName(d)}</option>`)}
          </select></div>
        <div class="field"><label for="set-start">Les van … tot …</label>
          <div class="row"><input class="input grow" type="time" id="set-start" value=${s.time} onInput=${(e) => set({ time: e.target.value })} />
          <input class="input grow" type="time" id="set-end" aria-label="Einde les" value=${s.endTime} onInput=${(e) => set({ endTime: e.target.value })} /></div></div>
      </div>
      <div class="two">
        <div class="field"><label for="set-dl-days">Deadline antwoorden</label>
          <select class="input" id="set-dl-days" value=${s.deadlineDaysBefore} onChange=${(e) => set({ deadlineDaysBefore: +e.target.value })}>
            ${[0, 1, 2, 3].map((n) => html`<option value=${n}>${n === 0 ? 'de lesdag zelf' : n === 1 ? '1 dag ervoor' : `${n} dagen ervoor`}</option>`)}
          </select></div>
        <div class="field"><label for="set-dl-time">om</label><input class="input" type="time" id="set-dl-time" value=${s.deadlineTime} onInput=${(e) => set({ deadlineTime: e.target.value })} /></div>
      </div>
      <div class="field"><span class="label">Dansstudio</span>
        <${LocationField} idPrefix="studio" value=${s.studio || {}} onChange=${(v) => set({ studio: v })} /></div>
      <div class="field"><label for="set-startweek">Historiek vanaf</label>
        <input class="input" type="date" id="set-startweek" value=${s.startWeek || ''} onInput=${(e) => set({ startWeek: e.target.value || null })} />
        <span class="hint">Eerste lesdag die meetelt voor de beurtrol. Leeg laten = vanaf de eerstvolgende les.</span></div>
      <div class="row"><button class="btn primary" type="submit" disabled=${!dirty}>Bewaar instellingen</button></div>
    </form>

    <section class="section">
      <h2>Over de planning</h2>
      <p class="small muted">Hoe de app bepaalt wie rijdt en wie bij wie zit.</p>
      <div class="row"><button class="btn" onClick=${actions.openHelp}>Hoe werkt de planning?</button></div>
    </section>

    <section class="section">
      <h2>Dit toestel</h2>
      <p class="small">${me ? `Je bent ingesteld als ${famLabel(data.families.find((f) => f.id === me))}.` : 'Je kijkt mee zonder gezin.'}</p>
      <div class="row"><button class="btn" onClick=${() => setMe(null)}>Kies een ander gezin</button></div>
      ${store.mode === 'supabase' && html`
        <p class="small muted">Dit toestel onthoudt de groepssleutel, zodat de gewone link volstaat. Op een gedeeld of geleend toestel kun je dat wissen.</p>
        <div class="row">${confirmForget
          ? html`<button class="btn danger solid" onClick=${actions.forgetDevice}>Ja, vergeet dit toestel</button><button class="btn" onClick=${() => setConfirmForget(false)}>Annuleer</button>`
          : html`<button class="btn danger" onClick=${() => setConfirmForget(true)}>Vergeet dit toestel</button>`}</div>`}
    </section>

    ${link && html`<section class="section">
      <h2>Uitnodigingslink</h2>
      <p class="small muted">Deze link bevat de groepssleutel: wie hem heeft, kan alles zien en aanpassen. Een toestel heeft hem maar één keer nodig. Kopieer en plak hem zelf in de WhatsApp-groep (bv. als vastgezet bericht); de gewone berichten van de app bevatten de sleutel niet.</p>
      <div class="row"><button class="btn" onClick=${() => copyText(link, notify)}>Kopieer uitnodigingslink</button></div>
      <p class="small muted">Kwam de link in verkeerde handen? Maak een nieuwe sleutel aan (zie handleiding) en deel de nieuwe link; de oude werkt dan niet meer.</p>
    </section>`}

    <section class="section">
      <h2>Privacy</h2>
      <div class="prose small">
        <p><strong>Wat wordt bewaard:</strong> gezinsnaam, voornaam van de ouder(s) en kinderen, adres en kaartlocatie, aantal plaatsen, de antwoorden per week en de planningen.</p>
        <p><strong>Wie kan het zien:</strong> iedereen met de uitnodigingslink, en wie toegang heeft tot het databaseaccount van deze app. De gegevens gaan versleuteld over het internet, maar zijn niet end-to-end versleuteld. Er wordt niet bijgehouden wie wat aanpaste.</p>
        <p><strong>Andere diensten:</strong> "Zoek op kaart" stuurt het ingetypte adres naar OpenStreetMap. "Route in Google Maps" opent de route bij Google. De WhatsApp-knoppen geven de berichttekst door aan WhatsApp, zonder groepssleutel.</p>
        <p><strong>Hoe lang:</strong> antwoorden en planningen ouder dan ongeveer 13 maanden worden automatisch gewist. Een gezin verwijderen wist het gezin en hun antwoorden; in oude planningen blijft enkel een naamloze code over, zodat de beurtrol van de anderen klopt.</p>
      </div>
    </section>

    ${store.mode === 'demo' && html`<section class="section">
      <h2>Demo</h2>
      <p class="small muted">Deze versie bewaart alles enkel in deze browser. Online voor de hele groep vraagt een gratis database (zie de handleiding).</p>
      <div class="row">${confirmReset
        ? html`<button class="btn danger solid" onClick=${() => actions.resetDemo()}>Ja, zet de demo terug</button><button class="btn" onClick=${() => setConfirmReset(false)}>Annuleer</button>`
        : html`<button class="btn danger" onClick=${() => setConfirmReset(true)}>Demo terugzetten</button>`}</div>
    </section>`}
  `;
}

// ---------------------------------------------------------------- explainer

function HowItWorks({ settings }) {
  const W = WEIGHTS;
  const weeks = settings.lookbackWeeks || 16;
  return html`<div class="prose">
    <p>De app maakt elke week een voorstel. Niemand kiest met de hand wie moet rijden; dezelfde regels gelden voor iedereen. Hieronder staat precies hoe dat gebeurt.</p>

    <h3>1. Welke antwoorden telt de app?</h3>
    <ul>
      <li>Het antwoord dat een gezin voor die week invulde.</li>
      <li>Geen antwoord? Dan het <strong>standaardantwoord</strong> van dat gezin (in te stellen bij Gezinnen).</li>
      <li>Ook geen standaardantwoord? Dan gaan we ervan uit dat het kind een <strong>lift nodig</strong> heeft. De app rekent nooit op iemand als chauffeur die dat niet zelf aangaf.</li>
      <li>Kiest een gezin <strong>Eigen vervoer</strong>, of gaat hun kind niet mee, dan doen ze die rit niet mee in de planning.</li>
    </ul>
    <p>Heen en terug worden apart ingevuld en apart gepland, maar samen afgewogen.</p>

    <h3>2. Wie rijdt?</h3>
    <p>Wie <strong>Rij sowieso</strong> koos, rijdt altijd en neemt anderen mee als er plaats is. Daarna probeert de app <em>alle</em> mogelijke combinaties van chauffeurs uit bij wie <strong>Kan rijden</strong> of <strong>Liever niet, maar kan</strong> koos, en houdt enkel de combinaties over waarin elk kind een plaats heeft. Elke combinatie krijgt strafpunten; de combinatie met het laagste totaal wint.</p>
    <div class="table-wrap"><table>
      <thead><tr><th>Strafpunten voor…</th><th class="num">Punten</th></tr></thead>
      <tbody>
        <tr><td>elke extra auto</td><td class="num">${W.car}</td></tr>
        <tr><td>de beurtrol: hoe vaak deze chauffeur al reed (zie 4)</td><td class="num">0–${W.fairness}</td></tr>
        <tr><td>een chauffeur die "liever niet" antwoordde</td><td class="num">${W.ratherNot}</td></tr>
        <tr><td>hetzelfde gezin rijdt heen én terug</td><td class="num">${W.bothLegs}</td></tr>
        <tr><td>elke kilometer van de routes</td><td class="num">${W.km}</td></tr>
        <tr><td>loting bij gelijkstand (valt elke week anders uit)</td><td class="num">0–${W.jitter}</td></tr>
      </tbody>
    </table></div>
    <p>Wat dat in de praktijk betekent, van belangrijk naar minder belangrijk:</p>
    <ol>
      <li><strong>Zo weinig mogelijk auto's.</strong> Een extra auto kost zoveel punten dat de app (bijna) altijd voor minder auto's kiest.</li>
      <li><strong>Wie minder vaak reed, is eerst aan de beurt.</strong></li>
      <li><strong>"Liever niet" wordt zoveel mogelijk gespaard:</strong> enkel als er anders niet genoeg plaats is, of als de anderen al bijna elke keer reden.</li>
      <li><strong>Liefst een ander gezin heen dan terug</strong>, zodat niemand twee keer moet rijden. Wie beide ritten "Rij sowieso" koos, krijgt hiervoor geen strafpunten.</li>
      <li><strong>Kortere routes</strong> beslissen tussen verder gelijkwaardige keuzes.</li>
    </ol>
    <p class="small muted">Voorbeeld: Fam. A en Fam. B kunnen allebei rijden en er is maar één auto nodig. A reed de voorbije weken 50% van de keren, B 20%. A krijgt ${Math.round(W.fairness * 0.5)} punten, B ${Math.round(W.fairness * 0.2)}: B rijdt (kilometers even buiten beschouwing gelaten). Zei B "liever niet", dan krijgt B ${Math.round(W.fairness * 0.2)} + ${W.ratherNot} = ${Math.round(W.fairness * 0.2) + W.ratherNot} punten en rijdt A.</p>

    <h3>3. Wie zit bij wie?</h3>
    <ul>
      <li>Een chauffeur neemt altijd de eigen kinderen mee. Broers en zussen zitten samen.</li>
      <li>De andere kinderen worden zo over de auto's verdeeld dat de <strong>totale afstand zo klein mogelijk</strong> is. Heen: van thuis, kinderen ophalen, naar de les. Terug: van de les, kinderen afzetten, naar huis. De app rekent alle verdelingen en volgordes door.</li>
      <li>Afstanden zijn geschat: in vogelvlucht tussen de adressen op de kaart, maal 1,3. De knop "Route in Google Maps" toont de echte route.</li>
      <li>Is er te weinig plaats, dan rijdt iedereen die kan, krijgen zoveel mogelijk kinderen een plaats, en toont de planning hoeveel plaatsen er ontbreken.</li>
    </ul>

    <h3>4. De beurtrol</h3>
    <ul>
      <li>De app kijkt naar de laatste ${weeks} weken waarin er les was. Weken zonder les worden overgeslagen.</li>
      <li>Per gezin telt ze hoeveel ritten (heen en terug apart) hun kind meedeed, en bij hoeveel daarvan ze zelf reden.</li>
      <li>Een rit telt pas als <strong>gereden</strong> als je minstens één ander kind meenam. Enkel je eigen kind brengen telt niet.</li>
      <li>Ook ritten met "Rij sowieso" tellen als gereden. Wie vaak uit zichzelf rijdt, wordt de andere weken dus minder snel gevraagd.</li>
      <li>Nieuwe gezinnen starten rond het groepsgemiddelde, zodat ze niet meteen elke week aan de beurt zijn.</li>
    </ul>
    <p>De stand per gezin staat onder <strong>Historiek</strong>.</p>

    <h3>5. Wanneer ligt de planning vast?</h3>
    <ul>
      <li><strong>Tot de deadline</strong> is de planning een voorstel dat zich aanpast bij elk nieuw antwoord.</li>
      <li><strong>Verplaatst iemand met de hand een kind</strong>, dan blijft de planning zo staan. Veranderen er daarna antwoorden, dan verschijnt een melding met een knop om te herberekenen.</li>
      <li><strong>Na de deadline</strong> wordt de planning vastgelegd. Ook dan geeft een latere wijziging een melding en kan iedereen herberekenen.</li>
      <li><strong>Ging het anders dan gepland?</strong> Pas de week aan onder Historiek, zodat de beurtrol klopt.</li>
      <li><strong>Opende niemand de app na de deadline van een week?</strong> Dan maakt de app die planning later alsnog, uit de antwoorden en standaardantwoorden. Zo'n week staat in Historiek als "achteraf berekend" en kan je daar aanpassen.</li>
    </ul>
  </div>`;
}

// ---------------------------------------------------------------- app shell

function NoKey({ error }) {
  const [v, setV] = useState('');
  const go = () => {
    const m = /k=([A-Za-z0-9]+)/.exec(v) || /^([A-Za-z0-9]{16,})$/.exec(v.trim());
    if (m) { location.hash = `k=${m[1]}`; location.reload(); }
  };
  return html`<div class="center"><div class="stack" style="max-width:420px">
    <h1>Carpool dansles</h1>
    <p>${error ? 'Deze link werkt niet (meer). Vraag de juiste link in de WhatsApp-groep.' : 'Open de link uit de WhatsApp-groep om verder te gaan.'}</p>
    <div class="row"><input class="input grow" id="key-input" placeholder="Plak hier de link" value=${v} onInput=${(e) => setV(e.target.value)} /><button class="btn primary" onClick=${go}>Open</button></div>
  </div></div>`;
}

function App({ config }) {
  const [store] = useState(() => createStore(config));
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [view, setView] = useState('week');
  const [offset, setOffset] = useState(0);
  const [me, setMeState] = useState(() => { const v = safeLS.get(ME_KEY); return v === null ? null : v; });
  const [toast, setToast] = useState('');
  const [help, setHelp] = useState(false);
  const [offline, setOffline] = useState(false);
  const dataRef = useRef(null);
  dataRef.current = data;
  const [now, setNow] = useState(() => new Date());
  const toastTimer = useRef(null);

  const notify = (msg) => { setToast(msg); clearTimeout(toastTimer.current); toastTimer.current = setTimeout(() => setToast(''), 2400); };
  const setMe = (id) => { setMeState(id); if (id === null) safeLS.del(ME_KEY); else safeLS.set(ME_KEY, id); };

  const reload = async () => {
    try {
      let d = await store.load();
      const t = new Date();
      if (!d.settings.startWeek && d.families.length > 0) {
        // first use: history (and the fairness rotation) starts with this week
        await store.saveSettings({ ...d.settings, startWeek: currentWeek(d.settings, t) });
        d = await store.load();
      }
      setData(d); setNow(t); setError(null); setOffline(false);
      if (await lockDue(store, d, t)) setData(await store.load());
    } catch (e) {
      if (dataRef.current && e.message !== 'invalid key') setOffline(true); // keep showing what we have, marked as possibly outdated
      else setError(e);
    }
  };

  useEffect(() => {
    if (store.mode === 'nokey') return undefined;
    reload();
    const tick = () => { if (!document.hidden) reload(); };
    const t = setInterval(tick, 60000);
    document.addEventListener('visibilitychange', tick);
    return () => { clearInterval(t); document.removeEventListener('visibilitychange', tick); };
  }, []);

  if (store.mode === 'nokey') return html`<main class="app"><${NoKey} /></main>`;
  if (error && !data) return html`<main class="app">${error.message === 'invalid key'
    ? html`<${NoKey} error=${true} />`
    : html`<div class="center"><div class="stack"><h1>Laden lukt niet</h1><p class="muted">Controleer je internetverbinding.</p><div><button class="btn primary" onClick=${reload}>Opnieuw proberen</button></div></div></div>`}</main>`;
  if (!data) return html`<main class="app"><div class="center"><div class="spinner" role="status" aria-label="Laden"></div></div></main>`;

  const week = addDays(currentWeek(data.settings, now), 7 * offset);
  const model = weekModel(data, week, now);
  const validMe = me && data.families.some((f) => f.id === me) ? me : me === '' ? '' : null;

  // optimistic local update + save; reload afterwards to pick up others' changes
  // Optimistic update + save. On failure the local change is rolled back and false is returned,
  // so callers never report success for something the server didn't store.
  const run = async (localUpdate, save, okMsg) => {
    const before = dataRef.current;
    if (localUpdate) setData((d) => localUpdate(structuredClone(d)));
    let ok = true;
    try { await save(); if (okMsg) notify(okMsg); }
    catch { ok = false; if (localUpdate) setData(before); notify('Niet opgeslagen. Controleer je verbinding en probeer opnieuw.'); }
    reload();
    return ok;
  };
  const weekRec = (w) => data.weeks[w] || { cancelled: false, plan: null };

  const actions = {
    saveResponse: (w, fid, r) => run((d) => { (d.responses[w] ??= {})[fid] = r; return d; }, () => store.saveResponse(w, fid, r)),
    clearResponse: (w, fid) => run((d) => { if (d.responses[w]) delete d.responses[w][fid]; return d; }, () => store.saveResponse(w, fid, null), 'Antwoord gewist'),
    saveUsual: (fid, usual) => {
      const f = { ...data.families.find((x) => x.id === fid), usual };
      return run((d) => { d.families = d.families.map((x) => (x.id === fid ? f : x)); return d; }, () => store.saveFamily(f), 'Standaardantwoord bewaard');
    },
    volunteer: (w, fid, leg) => {
      const f = data.families.find((x) => x.id === fid);
      const a = weekModel(data, w, now).answers[fid];
      const r = { kids: a.kids, to: a.to, from: a.from, [leg]: { status: 'can', seats: Math.max(f.seats ?? 3, a.kids.length) } };
      return run((d) => { (d.responses[w] ??= {})[fid] = r; return d; }, () => store.saveResponse(w, fid, r), 'Bedankt! Planning aangepast');
    },
    move: (w, leg, id, to) => {
      const m = weekModel(data, w, now);
      const next = movePassenger(m.plan, leg, id, to, { families: data.families, studio: data.settings.studio, kidsCount: m.kidsCount });
      const rec = { ...weekRec(w), plan: next };
      return run((d) => { d.weeks[w] = rec; return d; }, () => store.saveWeek(w, rec), 'Verplaatst');
    },
    recalc: (w) => {
      const m = weekModel(data, w, now);
      const plan = m.pastDeadline ? computePlan({ week: w, families: m.fams, responses: m.responses, stats: m.stats, studio: data.settings.studio }) : null;
      const rec = { ...weekRec(w), plan };
      return run((d) => { d.weeks[w] = rec; return d; }, () => store.saveWeek(w, rec), 'Herberekend');
    },
    toggleCancelled: (w) => {
      const rec = { ...weekRec(w), cancelled: !weekRec(w).cancelled };
      return run((d) => { d.weeks[w] = rec; return d; }, () => store.saveWeek(w, rec), rec.cancelled ? 'Week geannuleerd' : 'Les staat weer gepland');
    },
    saveFamily: (f) => run((d) => { const i = d.families.findIndex((x) => x.id === f.id); if (i >= 0) d.families[i] = f; else d.families.push(f); return d; }, () => store.saveFamily(f), 'Gezin bewaard'),
    deleteFamily: (id) => run((d) => { d.families = d.families.filter((x) => x.id !== id); return d; }, () => store.deleteFamily(id), 'Gezin verwijderd'),
    saveSettings: (s) => {
      const next = { ...s, startWeek: s.startWeek || currentWeek(s, now) };
      return run((d) => { d.settings = next; return d; }, () => store.saveSettings(next), 'Instellingen bewaard');
    },
    openHelp: () => setHelp(true),
    forgetDevice: () => {
      safeLS.del('carpool.key'); safeLS.del(ME_KEY);
      try { history.replaceState(null, '', location.pathname + location.search); } catch { /* ignore */ }
      location.reload();
    },
    resetDemo: async () => { await store.reset(); setMe(null); setOffset(0); setView('week'); await reload(); notify('Demo teruggezet'); },
  };

  const go = (v) => { setView(v); window.scrollTo(0, 0); };
  const tabs = [['week', 'Deze week'], ['families', 'Gezinnen'], ['history', 'Historiek'], ['settings', 'Instellingen']];

  return html`
    <main class="app">
      ${offline && html`<div class="notice warn" role="status">
        <p><strong>Geen verbinding.</strong> Je ziet mogelijk niet de laatste gegevens, en wijzigingen worden nu niet opgeslagen.</p>
        <div class="row"><button class="btn" onClick=${reload}>Opnieuw verbinden</button></div>
      </div>`}
      ${view === 'week' && html`<${WeekView} data=${data} model=${model} offset=${offset} setOffset=${setOffset} me=${validMe} setMe=${setMe} actions=${actions} store=${store} notify=${notify} go=${go} />`}
      ${view === 'families' && html`<${FamiliesView} data=${data} actions=${actions} me=${validMe} setMe=${setMe} />`}
      ${view === 'history' && html`<${HistoryView} data=${data} now=${now} actions=${actions} me=${validMe} />`}
      ${view === 'settings' && html`<${SettingsView} key=${JSON.stringify(data.settings)} data=${data} store=${store} actions=${actions} notify=${notify} now=${now} me=${validMe} setMe=${setMe} />`}
    </main>
    <nav class="tabs" aria-label="Hoofdmenu"><div class="tabs-inner">
      ${tabs.map(([v, label]) => html`<button class="tab" aria-current=${view === v ? 'page' : undefined} onClick=${() => go(v)}><${Icon} d=${ICONS[v]} />${label}</button>`)}
    </div></nav>
    ${help && html`<${Sheet} title="Hoe werkt de planning?" onClose=${() => setHelp(false)}><${HowItWorks} settings=${data.settings} /><//>`}
    ${toast && html`<div class="toast" role="status">${toast}</div>`}
  `;
}

render(html`<${App} config=${globalThis.CARPOOL_CONFIG || {}} />`, document.getElementById('app'));
