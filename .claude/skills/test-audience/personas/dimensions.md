# Persona dimensions

Every persona in `roster.yaml` fills in the fields below. The scales have anchors so that a "3" means the same thing in every persona. All personas are fictional; never model one on a real, identifiable person.

## Fields

| Field | Values | Notes |
|---|---|---|
| `id` | `firstname-age`, lowercase | Unique. Used for file names and panels. |
| `name`, `age`, `home` | free | `home` includes country code, e.g. `Voeren (BE)`. |
| `age_band` | `child` (≤11), `teen` (12–17), `young` (18–29), `adult` (30–49), `middle` (50–64), `senior` (65+) | Used for grouping in the report. |
| `languages` | `primary` (locale), `reads` (list with level), `notes` | Levels: native, C1, B2, B1, A2, A1, none. The app's language vs. these levels decides how much text a visitor understands. |
| `education`, `occupation` | free | |
| `science_literacy` | 0–5 | 0 no school science beyond primary · 1 vague school memories · 2 follows popular science on TV now and then · 3 comfortable with graphs, units, "frequency" · 4 STEM degree or job · 5 practising physicist |
| `gw_et_knowledge` | `none`, `heard-of`, `news`, `enthusiast`, `professional` | none: never heard of gravitational waves · heard-of: the word rings a bell · news: knows "they were detected, black holes collided" · enthusiast: reads/watches about it, knows LIGO/Virgo, chirps · professional: works in the field |
| `knows` / `doesnt_know` | lists | Concrete. `doesnt_know` lists words and ideas this person will NOT understand unless the app explains them well. This is what keeps visitors honest. |
| `et_stance` | `unaware`, `neutral`, `supportive`, `curious-local`, `skeptical-local`, `opposed`, `stakeholder`, `rival-site` | Attitude to the Einstein Telescope. Locals near the Meuse–Rhine candidate site may have concerns (construction, groundwater, traffic, cost, "what's in it for us"). `rival-site`: from another candidate region. |
| `digital_skill` | 1–5 | 1 avoids touchscreens, afraid to break things · 2 WhatsApp and photos only, doesn't scroll unless told · 3 everyday apps, misses hidden menus and small links · 4 confident, tries gestures, finds settings · 5 developer/power user, probes edge cases |
| `reading` | `wpm` (number) + `habit` | Adult average ~200–250 wpm in the native language; much slower for children, dyslexia, or a second language at B1 or lower. Habits: reads everything / skims headings and buttons / reads only big text / does not read, looks at pictures / cannot read yet. |
| `attention` | `solo_sec`, `expo_sec`, `notes` | Patience before leaving if nothing grabs them, alone on a device and at an expo stand. `notes` says what extends or shortens it. |
| `motivation` | free | Why they are here at all. |
| `social` | free | Alone, with kids, with friends, school class… Who else is looking. |
| `personality` | free | A few traits that shape behaviour. |
| `performance_comfort` | `low`, `medium`, `high` | Willingness to sing, shout, move or be watched doing something odd in public. Decides whether they try anything performative at an expo. |
| `accessibility` | free, or `none` | Vision, hearing, motor, cognitive, reading. |
| `devices` | free | What they carry and how old it is. Decides screen size, speed and sound habits. |
| `generated` | `true` (optional) | Set on generated personas. |

## Coverage checklist

When adding personas or building a custom panel, check the panel covers what the app is meant for, and that it includes at least one visitor who is likely to struggle:

- age bands from the app's target audience, plus one band just outside it
- someone with `gw_et_knowledge: none` and someone at `enthusiast` or above
- `digital_skill` 1–2 as well as 4–5
- a visitor reading the app in a second language, and one who does not read the app's language at all
- an accessibility need relevant to the app (sound-based app → hearing; colour coding → colour blindness; small text → low vision; long text → dyslexia)
- for expo scenarios: one `performance_comfort: low` visitor and one visitor who comes as a group
- for ET-related content: one `skeptical-local` or `stakeholder`

## Adding a persona by hand

Copy an existing entry in `roster.yaml`, give it a new unique `id`, and fill in every field. Make `doesnt_know` specific. Then add the id to any panels in `panels.yaml` where it belongs.

## Generating personas

When asked to "generate N <description>" (for example "generate 8 secondary-school pupils from Wallonia" or "generate 20 to broaden the audience"):

1. Read `roster.yaml` and list which combinations of the dimensions above are thin (for the description given).
2. Write N new personas that fill those gaps, varied in name, home, personality and motivation, plausible for the region and age. Avoid stereotypes as the defining trait: each persona is a person first, with a background that shapes but does not dictate their reaction.
3. Save them to `personas/generated/<YYYY-MM-DD>-<slug>.yaml` with `generated: true`, ids unique across the roster and earlier generated files.
4. Tell the user what was generated in a short table (id, age, language, GW knowledge, digital skill, one trait), so they can promote good ones into `roster.yaml` later.
