---
name: test-audience
description: Stress-test an outreach app or exhibit with a simulated audience of diverse virtual visitors (children to seniors; different languages, science and gravitational-wave/Einstein Telescope knowledge, digital skill, attention span, accessibility needs, attitudes to ET) who "use" it on a phone, a laptop, or at an expo stand (unmanned kiosk or with an explainer), then report what they liked, what they learned, what they misunderstood and what failed. Use when the user asks for a test audience, virtual visitors, simulated users, user testing, audience feedback or a stress test of an app, page or exhibit.
argument-hint: "<app folder or URL> [scenario] [panel]"
---

# Test audience

A panel of fictional visitors tries an app and reports back. Each visitor is a separate subagent with its own persona, so their reactions stay independent. It is a cheap way to find what is confusing, broken, too long, too wordy or wrongly understood **before** real people do. It does not replace testing with real people: simulated visitors are better at spotting friction than at predicting delight. Say that once in the report, in the caveats.

## Files in this skill

| File | What it holds |
|---|---|
| `personas/roster.yaml` | The audience: ~30 fictional visitors. Add more here. |
| `personas/dimensions.md` | The axes personas vary on, their scales, and how to add or generate personas. |
| `panels.yaml` | Named groups of personas (`quick`, `general-public`, `family-day`, `school-visit`, `et-region`, `experts`, `accessibility`, `international`, `full`). |
| `scenarios.md` | How the visit happens: `solo-phone`, `solo-laptop`, `expo-unmanned`, `expo-manned` (with explainer profiles). |
| `protocols/walkthrough.md` | How you (the orchestrator) record the app into a dossier. |
| `protocols/visitor-brief.md` | The prompt each visitor agent gets, and the JSON it must write. |
| `protocols/report.md` | How to turn the responses into a report. |
| `scripts/first_screen.py` | Saves real PNG screenshots of the first screen at phone, laptop and kiosk size (headless Chrome or Edge). |
| `scripts/inspect-screen.js` | Run in the browser on each screen: visible text above/below the fold, word counts, controls with sizes, smallest font. |
| `scripts/aggregate.py` | Checks the response files and computes ratings, funnel and drop-off tables. |

Paths below are relative to this skill's folder unless they start with `<run>`.

## 1. Pin down the run

From the arguments and the conversation, settle:

- **App**: a folder of the current project (served by the project's dev server; in the drmayerson.github.io repo that is the `site` entry in `.claude/launch.json`, so `chirp-karaoke` means `http://localhost:<port>/chirp-karaoke/` with the port `preview_start` reports; if the browser can't reach it, a server from another session may already be serving the folder on 8765, so try that) or a public URL.
- **Scenario(s)**: default `solo-phone`. Several are fine; each becomes its own run.
- **Panel**: default `quick` (6 visitors). Also accepted: another panel name, a list of persona ids, or "generate N <description>" (see `personas/dimensions.md`, Generating).
- **Intended takeaways**: what the app should leave people with. Use the user's if given. Otherwise infer 2–4 from the app's own text (intro, takeaway or summary strings in the source), and state them to the user in one line as assumptions. Do not stop to ask.
- **Explainer profile** (only for `expo-manned`): default `phd-enthusiast`.

Ask the user only for what you cannot default. Before launching **more than 12 visitors**, tell the user the number and that each visitor is one subagent (roughly 20–50k tokens each), and wait for a yes. For panels over 12, suggest `model: "sonnet"` for the visitor agents to keep the cost down.

Create the run folder in the project root: `.claude/test-audience-runs/<YYYY-MM-DD>_<app>_<scenario>_<panel>/` (`<run>` from here on), with subfolders `shots/` and `responses/`. Write `<run>/brief.md`: app, URL, scenario, panel and persona ids, intended takeaways, explainer profile, date.

## 2. Walk through the app yourself → `<run>/dossier.md`

Follow `protocols/walkthrough.md`. You are the only one who touches the app: the visitors experience it through your dossier and the screenshots in `<run>/shots/`, so anything you do not record does not exist for them. Describe, don't judge. Scenarios that share a device can share one dossier (copy it into each run).

## 3. Send in the audience

For each visitor, launch one subagent with the prompt from `protocols/visitor-brief.md`, filled in with that persona's full YAML entry, the scenario text, the paths, and (expo-manned) the explainer profile. Launch them **all in one message** so they run in parallel; for panels over ~12, launch in waves of up to 12.

Never put the intended takeaways, your own opinion of the app, or other visitors' answers in a visitor's prompt. Each visitor writes `<run>/responses/<persona-id>.json` and replies with one line; do not ask for more, so the responses stay out of your context.

## 4. Check and probe

1. Run `python scripts/aggregate.py <run>`. It lists missing or invalid response files; relaunch those visitors once.
2. **Probe.** Read each response's `untested_actions` and `failures` of type `technical`. Where the dossier does not settle whether it really happens (a visitor "would tap the picture", "thinks the sound did not play"), check the five most consequential ones in the browser yourself. Record each as confirmed, not reproduced, or could not test, in `<run>/probe.md`.

## 5. Report → `<run>/report.md`

Follow `protocols/report.md`. Then give the user, in chat: the verdict in two sentences, the top three problems, the takeaway recall numbers, and a link to `report.md`. If the report is meant for others (a team, a funder, the exhibit crew), offer to publish it as a page.

## Realism rules

Simulated visitors drift towards being too patient, too articulate, too polite and too clever. The brief counters this; when reading responses, discount any that break these rules and say so in the report:

- A visitor knows only what the persona knows. Words outside their vocabulary (frequency, inspiral, solar mass, detector, interferometer…) stay unexplained unless the app explains them in a way that person would get.
- Time is tracked. A visitor reads at their own speed, skips what their reading habit skips, and leaves when patience runs out. Leaving early is a normal, useful outcome, not a failure of the simulation.
- 3/5 means "fine". Most exhibits get a 3. A 5 needs a reason the visitor could say out loud.
- The visitor's words are their own: a 9-year-old does not say "intuitive onboarding"; a farmer from Voeren does not say "engaging visualisation".
- Every complaint points to a screen or element in the dossier. Guesses about things not in the dossier go in `untested_actions`, not in `failures`.

## Extending

- **More personas**: add entries to `personas/roster.yaml` following `personas/dimensions.md`, then add their ids to the relevant panels in `panels.yaml`.
- **Generated personas**: "generate N …" creates new personas that fill gaps in the dimension grid (see `personas/dimensions.md`), saved to `personas/generated/<YYYY-MM-DD>-<slug>.yaml` so they can be reused or promoted into the roster.
- **New scenario** (a classroom on a smartboard, a planetarium foyer, a festival tent): add a section to `scenarios.md` with the same headings as the others.
- **New explainer profile**: add it under "Explainer profiles" in `scenarios.md`.

## Without Claude Code's browser or subagents

- No browser tools: build the dossier from the source code and, if available, `scripts/first_screen.py` screenshots; set `fidelity: code-only` in the dossier header and say so in the report.
- No subagents (for example claude.ai with this skill uploaded): simulate the visitors one at a time, writing each response before starting the next, and never revise an earlier visitor's response after reading later ones. Say in the report that the visitors were not independent.
