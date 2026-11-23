# Report

Inputs: `<run>/brief.md` (intended takeaways), `<run>/dossier.md`, `<run>/responses/*.json`, `<run>/summary.json` (from `scripts/aggregate.py`), `<run>/probe.md`.

Read every response yourself. The aggregate script gives numbers; the useful findings are in the timelines, confusions and `tell_someone_tonight`.

## Judging takeaway recall

For each visitor and each intended takeaway, judge from `tell_someone_tonight` first, then `understood`:

- **got it**: the visitor states the idea in their own words, correctly enough for their level.
- **partly**: the gist is there but vague or mixed with errors.
- **missed**: absent, or the visitor never reached the screen that carries it.
- **garbled**: they state something that contradicts it (count these also as misconceptions).

`tell_someone_tonight` is the best measure, because it is what actually leaves the building. A visitor who "understood" five things but would tell their partner "it was a game where you sing" got the game, not the science.

## Weighting findings

Rank problems by **severity × number of visitors hit**, and give extra weight to:
- problems that stop people at the start (they lose everyone after them),
- problems that hit the app's main audience,
- misconceptions (an outreach app that teaches something wrong is worse than one that teaches nothing),
- problems confirmed in the probe.

Discount responses that broke the realism rules (an 8-year-old explaining chirp mass, a persona reading a language they don't read). Mention that you did.

## Report structure

The report is read by people who were not in the conversation: the app's author later, a colleague, the stand crew. It must stand on its own, without the run folder. Save it at the location chosen in step 1 as `<app>-test-audience-<scenario>-<panel>-<YYYY-MM-DD>.md`, and copy it to `<run>/report.md`. Refer to screenshots by their path in the run folder; don't embed them.

```markdown
# <App name>: simulated test audience, <scenario in words>

Run <date> with the `test-audience` skill (<where the skill lives>).
App: **<app>** (<repo or URL>, commit <hash> if known).
Full run (dossier, screenshots, every visitor's answers): `<run folder path>`.

## How this was done, and what it does not cover
- **Situation simulated:** device, place, sound, who is around; for expos, the stand set-up (staffed or not, kiosk mode, language).
- **Explainer** (expo-manned only): the profile in one sentence.
- **Visitors:** a table, one row each: name and age · who they are in a few words · their situation in this run (who they came with, how they got there).
- **Method:** two sentences: app recorded into a neutral description with real screenshots; each visitor a separate agent with its own clock, reading speed, patience and knowledge, not told the intended takeaways; claims checked against the app.
- **Not covered:** what could not be exercised (microphone, camera, real crowd, a flow end to end) and anything discounted.
- **Read it as:** finds friction before real visitors do; does not predict how much people will like it.

## Verdict
Two or three sentences, or a short table (pull · hold · message · ET link · physics): did it work for this audience, for whom not, and the single most important fix.

## Did the message land?
| Intended takeaway | got it | partly | missed | garbled |
(then one line per takeaway on who got it and who didn't, by segment)

What they would tell someone tonight: 4–6 representative `tell_someone_tonight` lines, verbatim, with persona id.

## Where people went and where they left
Started: x/n. Reached each screen: S1 n, S2 n, … Completed: n.
Exit reasons (counts) and the screens where people left, with the main reason at each.

## Problems, ranked
| # | Problem | Screen | Type | Visitors hit | Severity | Probe |
Each with one line of evidence (persona id + what happened).

## Misconceptions created
What visitors now wrongly believe, who, and which text/visual caused it.

## By group
Short paragraphs for the groups that differ: children, teens, seniors, non-Dutch readers, low digital skill, experts, ET locals, accessibility needs. Only groups present in the panel.

## What worked
Delights mentioned by several visitors, or by visitors who were otherwise negative.

## Questions visitors were left with
(For expo-manned: the questions asked and which answers fell flat. This doubles as an FAQ for the stand crew.)

## Ratings
Table from summary.json: overall and by age band / GW knowledge (means, n).

## Fix list
Numbered, most valuable first. Each: what to change, which problem(s) it addresses, effort (S/M/L).

## Caveats
Simulated visitors, not people: good at friction, weak at predicting delight and real social dynamics. Fidelity of the dossier (browser or code-only), what was not exercised, any responses discounted, average sim_confidence.

## Screenshots
One line per screenshot in the run folder: file name and what it shows (and what it does not show, e.g. a test image instead of a real camera picture).
```

Keep the report scannable: tables and short lines, no padding. Quotes stay verbatim and in the visitor's language. Write it in the language the user works in with you (English unless they use another), with visitor quotes in the visitors' own languages. If earlier reports exist at the chosen location, match their conventions (for example P1/P2/P3 priorities and finding IDs, as in `outreach-apps-review.md`).
