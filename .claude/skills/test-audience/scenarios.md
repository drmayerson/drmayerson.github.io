# Scenarios

Each scenario has the same headings. The **Visitor text** block is pasted verbatim into each visitor's brief; the **Walkthrough must cover** list is for you when building the dossier.

---

## solo-phone

**Device**: phone, portrait. Walk through at 375×812 (the browser's mobile preset); also check 360×640 (small, older Android) for layout breaks. Visitors with old or small phones (see their `devices`) get the small-screen version.

**Visitor text**:
> You are on your own phone, alone. You got here from a link: a message from someone, a social-media post or a QR code on a poster. You might be on the sofa, on a bus or in a queue. Your phone's sound may be off (it usually is in public), notifications can interrupt you, and you hold the phone in one hand. Nobody explains anything; if something is unclear, you either figure it out or leave. Leaving costs nothing: one swipe and you're back in another app. Your patience is your `attention.solo_sec`, stretched only if something grabs you.

**Walkthrough must cover**: phone viewport (portrait, plus a landscape check), first screen without scrolling, load time, sound off/muted, permission prompts (and what happens on "deny"), scrolling, tiny or hidden controls, text size, the link preview title/description (from the page's `<title>` and meta tags), what happens on back/reload.

---

## solo-laptop

**Device**: laptop at 1366×768 (common budget laptop), mouse or trackpad, speakers or headphones. Check 1920×1080 too if the layout changes.

**Visitor text**:
> You are at your own laptop or desktop, alone, sitting down. You came here from a link in an email, an article, a search, or because a teacher or colleague sent it. Other tabs and your inbox are one click away. Sound is on unless your habits say otherwise. You have a bit more patience than on a phone and will read a little more, but you still leave when it stops rewarding you. Your patience is your `attention.solo_sec` × 1.5.

**Walkthrough must cover**: laptop viewport, hover states, keyboard use (Tab, Space, Enter), whether the design looks stretched or empty on a wide screen, mic/camera prompts on desktop browsers, sound behaviour.

---

## expo-unmanned

**Device**: a kiosk touchscreen on a stand, default 1920×1080 landscape (a 24–32" screen at chest height). If the user says the stand uses a tablet, use 1024×768 or 1180×820. Open the app with `?kiosk=1` if it supports kiosk mode (the apps in drmayerson.github.io do, via `shared/outreach-kit.js`: idle reset, "touch to start" overlay).

**Visitor text**:
> You are walking through a busy exhibition hall (science fair, open day, festival). It is noisy, around the level of a crowded café: sound from the screen is hard to hear unless it is loud, and a microphone picks up the crowd. You see a screen on a stand from a few metres away and decide in about five seconds whether to walk up. Nobody is staffing the stand. You stand while using it, others may be watching or waiting behind you, and the previous visitor may have left it halfway through something. There are many other stands around you competing for your attention. Your patience is your `attention.expo_sec`. If you come with others (see `social`), they influence whether you stay.

**Walkthrough must cover**: kiosk mode (`?kiosk=1`), the attract/idle screen and whether it is readable and inviting from 2–3 m (font sizes in px on a 1920-wide screen), what a visitor finds if the previous visitor walked away mid-flow, idle-reset timing, touch-target sizes, whether it works without hearing the sound, behaviour with a noisy microphone input if the app uses the mic (from the code if you cannot test it), language choice at the start, how long one full go takes (throughput: can a queue move?).

---

## expo-manned

**Device**: as `expo-unmanned`.

**Visitor text**:
> You are walking through a busy exhibition hall (science fair, open day, festival). It is noisy, around the level of a crowded café. At this stand there is a screen and a person from the institute who explains it (their profile is below). They are friendly but have other visitors too: expect one to four minutes of their attention, more only if the stand is quiet. They may invite you in, show you what to do, answer your questions and talk about the Einstein Telescope. You decide whether to walk up, whether to try it yourself or just watch, and what you ask. Your patience is your `attention.expo_sec`, longer if the conversation interests you. If you come with others (see `social`), they influence what happens.

**Extra for the visitor**: write the conversation with the explainer as it would go, playing the explainer strictly within their profile: they know what their profile says they know, they have the habits it gives them, and they make the mistakes it says they make. Include at least the questions you would actually ask, and whether the answer satisfied you.

**Walkthrough must cover**: as `expo-unmanned`, plus what the screen offers an explainer to point at (moments to pause, a "how does it work" panel, visuals to gesture to), and anything that requires the explainer to know the app (hidden settings, PIN-protected reset, leaderboards).

### Explainer profiles

- **`phd-enthusiast`** (default): a PhD student in gravitational-wave physics. Knows the physics deeply and the app well. Very enthusiastic; tends to use jargon (strain, inspiral, solar masses, kHz) and to give long answers; adapts when they notice confusion, but not always. Speaks Dutch and English fluently, French haltingly, no German.
- **`volunteer`**: a student volunteer from another field (e.g. biology). Knows the app's flow by heart and the official one-line messages, not much beyond. Answers deep questions with "good question, I'll ask a colleague" or a guess. Friendly, energetic, Dutch and English.
- **`outreach-pro`**: an experienced science communicator. Reads visitors quickly, uses everyday language and analogies, invites shy people without pressure, keeps it short with children and goes deep with experts. Speaks Dutch, French, English and German.
- **`tired-researcher`**: a senior researcher on their third day at the stand. Knows everything, explains correctly but briefly, a little flat; perks up for good questions. Dutch, English, French.
