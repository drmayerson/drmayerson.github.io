# Carpool Dansles — spec and code guide

Weekly carpool planner for a small group of parents (5–10 families) whose kids go to the same dance lesson. Replaces the weekly WhatsApp back-and-forth: each family answers in one or two taps, the app proposes who drives and who rides with whom, and the plan is posted back to WhatsApp. Interface in Dutch, mobile first.

Setup for going live: see `SETUP.md`.

**Live** (since 29 Oct 2026): <https://drmayerson.github.io/dansles/> (folder `dansles/` in the `drmayerson/drmayerson.github.io` repo), Supabase project `wgndfxipbxqihpzrjxvo`. The group key is not stored in the repo; it only lives in the link shared in WhatsApp.

## Decisions (agreed with Daniel, Oct 2026)

| Topic | Decision |
|---|---|
| Hosting | Static site on GitHub Pages (`drmayerson.github.io/<folder>`) + free Supabase database |
| Access | No accounts. A long random group key in the link (`#k=…`) is the only way in; phones remember it |
| Who can edit | Every parent can edit everything (families, answers for others, the plan, settings) |
| Language | Dutch UI |
| No answer by deadline | Use the family's saved usual answer; without one, assume their kid needs a ride both ways (never assume they drive) |
| Fairness | Equal per family (kids rarely share a class with siblings). Measured as share of a family's carpool legs in which they drove someone else's kid, last 16 lesson weeks, smoothed for newcomers. Families who choose to drive more (e.g. "rij sowieso") simply drive more; that's fine |
| Two legs | *Heen* (home → lesson) and *Terug* (lesson → home) are answered and planned separately; different families for the two legs where possible |
| Geography | Secondary: decides who sits in which car, and breaks ties between equally fair driver choices. Routes are home → pickups → studio and the reverse |

## What a family answers each week

- Which kid(s) go to the lesson. None → the family is out of the planning that week (no ride, no driving).
- Per leg, one of: **Rit nodig** (need a ride) · **Zelf geregeld** (we handle our own, no seats to spare) · **Liever niet** (can drive, rather not) · **Kan rijden** (can drive) · **Rij sowieso** (driving anyway, always plan me in).
- For driving answers: seats for kids, own kids included (prefilled from the family's default).
- Optional: save the answer as the family's **usual**, used automatically in weeks they don't answer.

## Assignment algorithm (`src/algorithm.js`, pure, unit-tested)

Per week, both legs chosen jointly:

1. **Effective answer** per family: this week's answer → usual answer → "needs a ride both ways".
2. **Participants** per leg: families sending ≥1 kid whose answer isn't *Zelf geregeld*. Families are the unit: siblings stay together; drivers always take their own kids.
3. **Driver sets**: all *Rij sowieso* families, plus every subset of *Kan rijden*/*Liever niet* families whose seats can fit everyone (exact enumeration; ≤ ~12 candidates). Cost = 1000 per extra car + 100 × fairness share + 90 if *Liever niet* + 2 per route-km + tiny rotating tie-breaker. So: fewest cars first, then whoever drove least, then avoid reluctant drivers, then shorter routes.
4. **Both legs together**: best pair of driver sets, +60 if the same family drives both legs (unless they're forced both ways).
5. **Seating**: riders are distributed over the chosen cars to minimise total route length (exact dynamic programming over subsets; best stop order per car).
6. **Shortage**: if even all possible drivers can't seat everyone, use all of them, seat as many kids as possible and report the missing seats. The UI shows a red notice and an "Ik kan … rijden" button.

Weights live in `WEIGHTS` at the top of the file.

## Weekly cycle

- Weeks roll over automatically from the lesson weekday/times in settings; parents can answer up to 6 weeks ahead.
- Before the deadline the plan is a live **proposal** that updates with every answer.
- Anyone can tap a kid to move them to another car; the plan is then stored as **manually adjusted** and stops auto-updating (banner + "Herbereken" if answers change afterwards).
- At the deadline the first phone that opens the app **locks** the plan (stored once, race-safe). Later answer changes show a banner listing the families concerned, with a recalculate button.
- Past weeks without a stored plan are locked retroactively (so fairness history is always complete). Past plans can be corrected in *Historiek* (move kids to reflect what really happened) or marked "geen les".
- "Geen les deze week" cancels a week: nothing planned, doesn't count for fairness.
- WhatsApp: a reminder message listing who hasn't answered, and the plan as a formatted message, each via a `wa.me` share link or copy button.

## Data (Supabase, `supabase/schema.sql`)

- `cp_groups` (key + settings JSON), `cp_families` (one row per family), `cp_responses` (one row per family per week, so simultaneous saves never clash), `cp_weeks` (per week: `cancelled`, stored `plan`).
- Tables are closed (RLS on, no policies, privileges revoked). The page can only call `cp_load`, `cp_save_*`, `cp_delete_family`, each of which checks the group key. `cp_save_week(..., p_if_absent)` stores a plan only if none exists (deadline lock).
- Family JSON: `{ id, name, parent, kids:[{id,name}], address, lat, lng, seats, usual:{to,from} | null }`.
- Response JSON: `{ kids:[kidId], to:{status, seats?}, from:{status, seats?} }`.
- Plan JSON: `{ version, week, edited, legs:{ to|from: { participants, cars:[{driverId, forced, ratherNot, seats, ownKids, riders:[familyId in route order], km}], unassigned, seatsShort } }, sources, fingerprints, rates }`.

## Code map

```
index.html, styles.css, config.js     page shell, design tokens (light + dark), Supabase settings
src/app.js        UI (Preact + htm, no build step): Deze week · Gezinnen · Historiek · Instellingen
src/algorithm.js  planning logic (no DOM)
src/dates.js      lesson weeks, deadlines, Dutch date formatting
src/text.js       labels, WhatsApp texts, Google Maps route links, coordinate parsing, geocoding (OpenStreetMap Nominatim)
src/store.js      storage: Supabase backend or browser-only demo backend, same interface
src/demo-data.js  fictional example group for demo mode
vendor/           preact+htm and supabase-js, vendored (no CDN dependency)
tests/            node --test tests/*.test.js
tools/build-demo.mjs   single-file demo build (dist/) for previews
```

## Ideas not built yet

- Push/email reminders (would need a server-side scheduled job; WhatsApp share covers it for now).
- Calendar export per driver.
- Per-kid participation per leg (currently per family per week; *Zelf geregeld* covers one-way exceptions).
