# Visitor brief

## How to hand it out (files, not long prompts)

Split the brief below into two kinds of files in the run folder, so you don't repeat it in every prompt:

1. **`<run>/visitor-instructions.md`**, once per run: everything in the template below except "Who you are" and the situation line. It contains the scenario's **Visitor text** (for `expo-manned` also the "Extra for the visitor" text and the explainer profile), the app files to read (paths relative to the run folder), "How to live through the visit", and "What to write" with the JSON shape.
2. **`<run>/visitors/<persona-id>.md`**, one per visitor: the persona's full YAML entry, verbatim from `personas/roster.yaml` (cut it out with a small script rather than retyping), and that visitor's situation line (see below).

Then launch each visitor with `subagent_type: "general-purpose"`, `model: "sonnet"`, a description like `"Visitor lotte-9"`, and this short prompt:

```text
You are one visitor in a simulated audience test of an outreach app. Your run folder is <absolute run path>
1. Read visitors\<persona-id>.md in that folder: who you are and your situation.
2. Read visitor-instructions.md in that folder and follow it exactly: read dossier.md and the screenshots it names, live through the visit as this person, and write responses\<persona-id>.json.
3. Reply with only the one line the instructions ask for.
```

Do not put the intended takeaways, your view of the app, or anything about other visitors in either file.

## The brief's content

Add one **situation line** for each visitor, in brackets after the scenario text, that places this person in the scenario using their persona: how the link reached them (or how they came to the stand), where they are, whether their sound is on, which device and therefore which screenshot applies (an old small Android → `first_small-phone.png`), and **which language version they get**. If the app picks its language from the browser, a French-speaking visitor sees the French version: say so, and tell them the dossier's text appears to them in that language. Vary the situations realistically; don't make every visitor's circumstances ideal.

If something could not be exercised in the walkthrough (singing, camera, motion), tell the visitor to assume the device works once permission is given, and to decide in character how well they manage the task, or whether they try at all.

The template below shows the whole brief as a single text; split it into the two files as described above.

---

```text
You are one visitor in a simulated audience test of an outreach app. You will become the person described below, live through one visit to the app, and write down honestly how it went. Nobody is grading the app through you and nobody will be hurt by bad news: an honest "I left after 20 seconds because I didn't get it" is the most useful thing you can produce.

## Who you are
{persona YAML entry, verbatim}

## The situation
{scenario Visitor text, verbatim}
({situation line for this visitor: how they got here, where, sound, device/screenshot, language version})
{for expo-manned: "Extra for the visitor" text, then "Explainer at this stand:" + explainer profile}

## The app
You cannot open the app. Everything you see and can do is recorded in:
- {run}/dossier.md (read it fully first: it is a neutral record of every screen, its text, its controls and what happens)
- the images in {run}/shots/ (look at the ones for your device: {list of relevant PNG files}). These are exactly what you would see first.
Only what is in these files exists. If you would try something the dossier does not cover, write it in "untested_actions" and assume the most ordinary outcome.

## How to live through the visit
1. Before you start, note in "before" what you think about this subject and (if your persona has a view) about the Einstein Telescope.
2. First sight: from the link preview or (at an expo) from a few metres away, decide in about five seconds whether you even start. You may not.
3. Go through it in time order, as this person. Keep a running clock in seconds. Reading costs time: words ÷ your wpm × 60. Read only what your reading habit makes you read; text you skip does not reach you. Text in a language you read at A2 or below is mostly lost on you; at B1 you get the gist slowly.
4. You know only what your persona knows. Words on your "doesnt_know" list stay meaningless unless the app explains them in a way YOU would understand. Do not quietly fill gaps with knowledge the person does not have.
5. You leave when your patience runs out, when you are stuck, embarrassed, bored, interrupted or done. Something that genuinely grabs you can stretch your patience, at most to double. Leaving early is a normal, useful result.
6. Think in your own voice and language level. A child thinks like a child; nobody uses words like "UX", "onboarding" or "engaging" unless their job gives them those words.
7. Be calibrated: 3/5 means "fine, nothing special". Most exhibits get a 3. Give a 5 only with a reason you would say out loud; give a 1 when it deserves it.
8. Every complaint must point to a screen (S1, S2…) or element from the dossier. Things you merely suspect go in "untested_actions".

## What to write
Write ONE file, {run}/responses/{persona-id}.json, valid JSON (UTF-8), exactly this shape:

{
  "persona_id": "{persona-id}",
  "scenario": "{scenario}",
  "profile": {"age_band": "...", "language": "<primary locale>", "gw_et_knowledge": "...", "digital_skill": 0, "science_literacy": 0, "et_stance": "...", "performance_comfort": "...", "accessibility": "..."},
  "language_used": "which language version you used and how well you could read it",
  "before": "what you thought/knew going in, in your own words",
  "first_sight": {"started": true, "seconds_to_decide": 5, "why": "..."},
  "timeline": [
    {"t": 0, "screen": "S1", "did": "what you did", "thought": "what went through your head, in your voice", "mood": 0}
  ],
  "exit": {"reason": "completed | bored | confused | frustrated | embarrassed | interrupted | out_of_time | technical | language | never_started", "screen": "S?", "t": 0, "detail": "..."},
  "understood": ["what you think you learned, in your own words"],
  "misconceptions": ["things you now believe that are probably wrong, or that you garbled; say what made you think so (screen/text)"],
  "tell_someone_tonight": "what you would actually say about this to a friend or family member tonight, in your own words and language",
  "confusions": [{"screen": "S?", "what": "...", "severity": 1}],
  "failures": [{"screen": "S?", "what": "...", "type": "usability | technical | accessibility | language | content | social", "severity": 1}],
  "delights": [{"screen": "S?", "what": "..."}],
  "questions": [{"asked_to": "explainer | nobody (left wondering)", "question": "...", "answer_summary": "... or null", "satisfied": true}],
  "conversation": "expo-manned only: the exchange with the explainer as a short script; otherwise null",
  "ratings": {"enjoyment": 3, "clarity": 3, "learned": 3, "would_recommend": 5, "felt_smart": 3},
  "after": "what you think now about the subject and (if relevant) the Einstein Telescope; did anything change?",
  "quote": "one sentence you might say walking away, in your own language",
  "untested_actions": ["things you would have tried that the dossier does not cover, and what you assumed"],
  "sim_confidence": {"score": 3, "why": "how much of your visit rested on guesses because the dossier was thin"}
}

Scales: mood −2 (miserable) to +2 (delighted); severity 1 (minor) to 3 (made me give up or get it wrong); ratings 1–5 except would_recommend 0–10; felt_smart: 1 = it made me feel stupid, 5 = it made me feel clever; sim_confidence 1–5.
Write text fields in English, except "tell_someone_tonight", "quote" and the "thought" fields, which are in your persona's own language and voice.

When the file is written, reply with exactly one line:
{persona-id}: <exit reason> at <screen> after <t> s, enjoyment <n>/5, "<tell_someone_tonight in at most 12 words>"
```
