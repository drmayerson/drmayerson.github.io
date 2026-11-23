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

**Scenarios** (second word): `solo-phone`, `solo-laptop`, `expo-unmanned` (kiosk, nobody at the stand), `expo-manned` (with an explainer; add "explainer volunteer", "outreach-pro" or "tired-researcher" to change the default PhD student).

**Panels** (third word, or "with the … panel"). You can also name people ("only lotte-9 and willy-72") or ask for new ones ("generate 8 Walloon pupils").

| Panel | Size | Visitors |
|---|---|---|
| `quick` (default) | 6 | lotte-9, ayoub-13, nadia-38, pieter-45, josee-61, sophie-27 |
| `general-public` | 12 | lotte-9, ayoub-13, emma-15, chloe-20, kevin-22, sanne-24, tom-34, nadia-38, stefan-44, martine-52, josee-61, willy-72 |
| `family-day` | 10 | noor-7, lotte-9, lucas-11, ayoub-13, yasmina-35, nadia-38, stefan-44, raj-41, maria-79, willy-72 |
| `school-visit` | 7 | lucas-11, ayoub-13, emma-15, fien-16, jules-17, bram-31, martine-52 |
| `et-region` | 10 | jules-17, kevin-22, sanne-24, jan-39, pieter-45, greet-48, ingrid-57, hans-58, josee-61, willy-72 |
| `experts` | 6 | fien-16, arno-19, sophie-27, bram-31, hans-58, dirk-66 |
| `accessibility` | 8 | lucas-11, lien-26, tom-34, yasmina-35, stefan-44, dirk-66, willy-72, maria-79 |
| `international` | 8 | lucas-11, jules-17, chloe-20, elena-29, raj-41, yasmina-35, hans-58, josee-61 |
| `full` | 30 | everyone in `personas/roster.yaml` |

Who each person is: `personas/roster.yaml` (one entry per visitor). The panels themselves: `panels.yaml`.

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
