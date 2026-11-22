# Walkthrough: recording the app into a dossier

The visitors never touch the app. They experience it only through `<run>/dossier.md` and the PNGs in `<run>/shots/`. Your job is a complete, neutral record: what is on the screen, what happens when you do things, how long it takes. **Describe, don't judge.** Write "the button is 28×28 px, grey text on a dark grey background", not "the button is hard to see". Write "the intro is 146 words", not "the intro is too long". Judging is the visitors' job; if your opinions leak into the dossier, every visitor will repeat them.

## Setup

1. **Serve the app.** For a folder in the project, start the project's dev server with `preview_start` (in drmayerson.github.io: name `site`) and use the port it reports. If the browser can't reach it, another session's server may already serve the folder (try `http://localhost:8765/`). For a URL, open it with `preview_start {url}`.
2. **Set the viewport** for the scenario with `resize_window` (`scenarios.md` gives sizes). Reload after resizing.
3. **Real screenshots.** Run, from the project root,
   `python <skill>/scripts/capture.py <app-folder-or-url> <run>/shots --sizes phone,small-phone --lang nl`
   (pick the sizes the scenario needs: `laptop`, `tablet`, `kiosk`; add `--query kiosk=1` for kiosk mode). A local folder is served by the script itself (`--root ..` for a sibling repo), so it does not depend on the dev server. By default it saves the first screen; with `--steps` it clicks through the app and saves each state you name (see the script's help), and `{"js": …, "print": true}` steps return measurements, e.g. the contents of `inspect-screen.js`. `--fake-camera` feeds Chrome's synthetic test video (a flat green frame) to camera apps: useful for the layout, not for what people look like, so pair it with the app's own example image if it has one. These PNGs are the only things visitors see with their own eyes: capture the first screen and every key state, and open each one to check it looks right. If no Chrome/Edge is found, describe the screens in extra detail instead.
4. **Find the intended flow in the source.** Skim the app's HTML/JS for screens, states, timers, permissions (`getUserMedia`, `DeviceMotionEvent`), sound, language tables (and how the default language is chosen), kiosk handling, takeaway strings, and any test or example hooks (an "example" button, a debug object on `window`) that let you reach result screens without a microphone or camera. This tells you what to look for, and covers what the browser cannot exercise.
5. **Load the inspector.** On each screen, run `scripts/inspect-screen.js` with `javascript_tool` (paste the file's contents; if the dev server serves the project root, `eval(await (await fetch('/.claude/skills/test-audience/scripts/inspect-screen.js')).text())` saves pasting it each time). It returns the visible text above and below the fold with word counts, every visible control with its size and position, and the smallest font. Use its numbers in the dossier.

The built-in browser blocks the microphone and camera, so anything that needs them is "from code" (see below). Its screenshots are for your eyes only: on high-DPI screens they show a cropped, zoomed part of the page. Use `capture.py` for the images visitors get.

Visitors read the dossier first and the screenshots second, so the dossier must say what each image shows, and what it does **not** show (a test pattern instead of a real camera picture, a state staff would normally hide).

## Walk the happy path

Go through the app as its designer intends, screen by screen. Number each distinct screen or state S1, S2, … For each, record:

- **How you got here** and how long it took (load, animation, waiting for a result).
- **Layout**: what is visible without scrolling vs. after scrolling; the dominant element; what draws the eye first; colours that carry meaning (red/green, colour scales); text over busy backgrounds.
- **Pictures inside the UI** (drawings, diagrams, icons in pop-ups and cards): what they show. Visitors who don't read still look at these, and they are often what people remember.
- **Text, verbatim**, in the app's default language, with its word count. Note text that is collapsed (`<details>`), in tooltips or only in a "more" panel.
- **Controls**: label or icon, approximate size in px (measure with `javascript_tool` `getBoundingClientRect`), position, how it looks (e.g. "small grey text link bottom-right", "large purple pill button centre").
- **Feedback**: what happens on interaction: visuals, sound (and whether the meaning survives without sound), vibration, permission prompts.
- **Payoff**: the moment the app delivers its point (a result, a reveal, a score). Note the time from first touch to payoff.

Use `get_page_text` and `read_page` for text and controls, screenshots to see the layout (describe what you see), and `javascript_tool` only to measure (sizes, font sizes, colours, timings).

## Walk off the happy path

Each as a short entry: what you did, what happened.

- Tap or click things before reading; tap things that look tappable but aren't.
- Deny every permission the app asks for; then try to continue.
- Sound off / noisy room: does the app still make sense? Which screens rely on hearing?
- Wait without touching (kiosk idle reset: after how long, back to what?). Arrive at a screen a previous visitor left mid-flow.
- Back button, reload, rotate the phone, resize the window.
- Switch language: where the switch is, how visible, which languages exist. For every language that a panel member reads better than the default, capture the key screens' text in that language too (switch, then `get_page_text`).
- Very fast or very slow input; repeating the activity; trying to "win" or break a score.

## What you cannot exercise

Some things a browser automation cannot do: sing into a microphone, move a phone, take a selfie. Describe what the app would do based on the code (what input it expects, what feedback it gives, typical results, how it handles silence or noise) and mark these entries **(from code)**.

## Dossier format

```markdown
# Dossier: <app>, <scenario>
- URL: ...           - Viewport(s): ...      - Date: ...
- Languages offered: ... (default: ..., how to switch: ...)
- Fidelity: browser walkthrough | code-only
- Screenshots: shots/<file>.png – what each shows

## Link preview / first sight
(page title and description as a link preview shows them; what the first screen looks like from the PNGs and your own view)

## Flow map
S1 Intro → S2 ... → S3 ... (branches)

## Screens
### S1 <name>
(how reached · layout · verbatim text [N words] · controls · feedback · timing)
...

## Off the happy path
- ...

## Not exercised (from code)
- ...

## Facts
- Time to first payoff: ...
- Words on the happy path (default language): ...
- Smallest body font: ... px · smallest touch target: ... px
- Needs sound: yes/no/partly · Needs mic/camera/motion: ...
- Works without sound: ...
- Kiosk idle reset: ...
- Languages: ...
```

Keep it under about 4,000 words. Prefer verbatim text and measurements over descriptions of quality.

Only write down what you saw, measured or read in the code. If you did not test something (rotation, a back button, tapping the animation), either test it or leave it out; mark code-derived statements "(from code)". A visitor will treat every line of the dossier as fact.
