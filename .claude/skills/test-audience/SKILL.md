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
| `scripts/capture.py` | Real PNG screenshots at phone, laptop and kiosk size (headless Chrome or Edge, WebGL included), also of states reached by scripted clicks; optional fake camera. |
| `scripts/inspect-screen.js` | Run in the browser on each screen: visible text above/below the fold, word counts, controls with sizes, smallest font. |
| `scripts/aggregate.py` | Checks the response files and computes ratings, funnel and drop-off tables. |

Paths below are relative to this skill's folder unless they start with `<run>`.

## 1. Pin down the run

From the arguments and the conversation, settle:

- **App**: a folder of the current project (served by the project's dev server; in the drmayerson.github.io repo that is the `site` entry in `.claude/launch.json`, so `chirp-karaoke` means `http://localhost:<port>/chirp-karaoke/` with the port `preview_start` reports; if the browser can't reach it, a server from another session may already be serving the folder on 8765, so try that) or a public URL.
- **Scenario(s)**: default `solo-phone`. Several are fine; each becomes its own run.
- **Panel (audience)**: use the one the user named: a panel name from `panels.yaml`, a list of persona ids, or "generate N <description>" (see `personas/dimensions.md`, Generating). **If the user did not name an audience, always ask. Never pick one silently.** See "Asking" below.
- **Report location**: every run ends with a written report (section 5). Use the place the user named. If they named none, use an obvious existing home for such reports: a folder or file of earlier test-audience or app reviews that the user keeps (for drmayerson.github.io, earlier reports sit in the parent folder `Github.io/`, e.g. `bh-camera-test-audience.md` and `outreach-apps-review.md`). If it isn't clear, ask. See "Asking" below.
- **Intended takeaways**: what the app should leave people with. Use the user's if given. Otherwise infer 2–4 from the app's own text (intro, takeaway or summary strings in the source), and state them to the user in one line as assumptions. Do not stop to ask.
- **Explainer profile** (only for `expo-manned`): default `phd-enthusiast`.

**Asking.** Put every open question in **one** `AskUserQuestion` call, before the walkthrough starts, so the user answers once and the rest runs without them:
- *Audience* (when not given): offer up to four panels that fit this app and scenario, best fit first and marked "(Recommended)". Choose them from each panel's `purpose` in `panels.yaml`: for an ET information evening, `et-region`; for a family expo, `family-day`; for a classroom app, `school-visit`. Always include `quick` as the cheap option. In each option's description give the size and a few of the people (e.g. "10: children 7–13, parents, grandparents, a Syrian mum learning Dutch"). The automatic "Other" answer covers other panels, persona ids or "generate …".
- *Report location* (only when not given and not obvious): offer two to four concrete places, e.g. the folder where earlier reviews live, the app's own repository (say so when the repository is public: a report committed there is published), or only the run folder (local, git-ignored).

Ask nothing else that has a default. Before launching **more than 12 visitors**, tell the user the number and that each visitor is one subagent (roughly 70–90k tokens each), and wait for a yes.

**Visitor model: always Sonnet.** Launch every visitor agent with `model: "sonnet"`, whatever the panel size, unless the user explicitly asks for another model for the visitors. The walkthrough, probe and report stay with you (the main model).

Create the run folder in the project root: `.claude/test-audience-runs/<YYYY-MM-DD>_<app>_<scenario>_<panel>/` (`<run>` from here on), with subfolders `shots/` and `responses/`. Write `<run>/brief.md`: app, URL, scenario, panel and persona ids, intended takeaways, explainer profile, report location, date.

## 2. Walk through the app yourself → `<run>/dossier.md`

Follow `protocols/walkthrough.md`. You are the only one who touches the app: the visitors experience it through your dossier and the screenshots in `<run>/shots/`, so anything you do not record does not exist for them. Describe, don't judge. Scenarios that share a device can share one dossier (copy it into each run).

## 3. Send in the audience

For each visitor, launch one subagent (`model: "sonnet"`) as described in `protocols/visitor-brief.md`: one shared `<run>/visitor-instructions.md` for the whole run, plus a `<run>/visitors/<persona-id>.md` per visitor with that persona's full YAML entry and their situation line. The prompt itself only points the agent at those two files. Launch them **all in one message** so they run in parallel; for panels over ~12, launch in waves of up to 12.

Never put the intended takeaways, your own opinion of the app, or other visitors' answers in a visitor's prompt. Each visitor writes `<run>/responses/<persona-id>.json` and replies with one line; do not ask for more, so the responses stay out of your context.

## 4. Check and probe

1. Run `python scripts/aggregate.py <run>`. It lists missing or invalid response files; relaunch those visitors once.
2. **Probe.** Read each response's `untested_actions` and `failures` of type `technical`. Where the dossier does not settle whether it really happens (a visitor "would tap the picture", "thinks the sound did not play"), check the five most consequential ones in the browser yourself. Record each as confirmed, not reproduced, or could not test, in `<run>/probe.md`.

## 5. Report → the chosen location (always)

Every run ends with a report; this is not optional. Follow `protocols/report.md`: a self-contained Markdown file that someone who was not in the conversation can read, covering what was tested and how, the verdict, findings and fixes. Save it at the location settled in step 1 as `<app>-test-audience-<scenario>-<panel>-<YYYY-MM-DD>.md`. Keep a copy at `<run>/report.md`, so the run folder is complete.

Then give the user, in chat: the verdict in two sentences, the top three problems, the takeaway recall numbers, and a link to the report. If the report is meant for others (a team, a funder, the exhibit crew), offer to publish it as a page.

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

- No browser tools: build the dossier from the source code and, if available, `scripts/capture.py` screenshots; set `fidelity: code-only` in the dossier header and say so in the report.
- No subagents (for example claude.ai with this skill uploaded): simulate the visitors one at a time, writing each response before starting the next, and never revise an earlier visitor's response after reading later ones. Say in the report that the visitors were not independent.
