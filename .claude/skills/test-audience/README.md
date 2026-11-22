# Test audience (Claude skill)

A simulated audience for the outreach apps on this site. About thirty fictional visitors (a 7-year-old who can't read yet, a sceptical dairy farmer from Voeren, a Deaf graphic designer, a GW postdoc, an Italian economist from the rival Sardinian ET bid, a retired miner, …) each "visit" an app on a phone, a laptop or at an expo stand, and report what they liked, learned, misunderstood and where they gave up. Claude then combines their answers into a report with a ranked fix list.

It finds friction cheaply. It does not replace watching real people use the app.

## Using it

In Claude Code, opened anywhere inside this repository (any account or subscription; the skill travels with the repo):

```
/test-audience chirp-karaoke
/test-audience et-horizon expo-unmanned family-day
/test-audience zwart-gat-piano expo-manned school-visit, explainer volunteer
/test-audience https://example.org/app solo-laptop international
```

or just ask: "Run the test audience on eenhoornrace at an unmanned expo stand, with the accessibility panel."

Defaults: scenario `solo-phone`, panel `quick` (6 visitors). Claude asks before running more than 12 visitors, because each one is a separate subagent.

Each run writes to `.claude/test-audience-runs/<date>_<app>_<scenario>_<panel>/`: `brief.md`, `dossier.md` (what the app showed), `shots/`, `responses/<visitor>.json`, `summary.json`, `probe.md` and `report.md`. Runs are git-ignored; commit one by hand if you want to keep it.

## Changing the audience

- Visitors: `personas/roster.yaml`. Copy an entry, change it, keep the id unique. Scales are explained in `personas/dimensions.md`.
- Groups: `panels.yaml`.
- Ask Claude to "generate 10 personas: Walloon secondary-school pupils" (or anything else); they are saved in `personas/generated/` and can be moved into the roster.
- Situations (phone, laptop, expo with or without explainer) and explainer profiles: `scenarios.md`.

## Using it elsewhere

- **Another repository or machine**: copy this folder to `~/.claude/skills/test-audience/` (personal, all projects) or to `<repo>/.claude/skills/test-audience/`.
- **claude.ai**: zip this folder and upload it under Settings → Capabilities → Skills. There is no browser and no subagents there, so Claude works from the source code or a URL and plays the visitors one after another; the results are less independent.

## Note

This repository is public, and with `.nojekyll` GitHub Pages may serve this folder too. The personas are fictional; keep it that way, and keep anything confidential out of the roster.
