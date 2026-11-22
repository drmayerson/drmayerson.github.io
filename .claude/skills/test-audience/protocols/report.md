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

## Report structure (`<run>/report.md`)

```markdown
# Test audience: <app> · <scenario> · <panel> (<n> visitors) · <date>

## Verdict
Two or three sentences: did it work for this audience, for whom not, and the single most important fix.

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
```

Keep the report scannable: tables and short lines, no padding. Quotes stay verbatim and in the visitor's language.
