# Zwart gat camera at an expo: review and checklist

Situation: the page runs on a laptop at a booth, only expo staff use the mouse, keyboard or a
presenter remote; visitors look at the screen (and scan a QR code for their photo).

## Verdict

**Ready, provided the laptop is set up as below and tested once with the real webcam and
lighting at the venue.** Everything was tested in a browser with simulated cameras; the
real webcam, the venue's lighting and the venue's internet were not.

What was checked (November 2026):

| Area | Result |
|---|---|
| Frame rate, background removal off / green screen | 55–60 frames per second |
| Frame rate, booth mode ("stand / mensen op afstand") | 60 frames per second (was 12 before this review: the person-recognition network now runs on the processor instead of the graphics chip) |
| Memory over several minutes in booth mode | stable: goes up and down between 9 and 60 MB and keeps returning to 9 MB (no leak) |
| Camera unplugged during use | message on screen, automatic reconnect every 3 s, falls back to another camera if the chosen one is gone |
| Restart of browser / computer | page comes back as it was left (settings, language, camera on, panel hidden), if "Onthouden" is on |
| Graphics driver reset / laptop waking up | page restarts itself with the same settings |
| Screen going to sleep | the page asks the browser to keep the screen on while it is open (Chrome/Edge) |
| Mouse pointer | disappears after 3 s without movement |
| Photo keys | click, arrow keys, PageUp/PageDown (what most presenter remotes send) |
| Languages | NL (default), EN, FR, DE; visitor download page follows the phone's language |

## Setting up the laptop (once, before the expo)

1. **Browser:** Chrome or Edge, up to date. (Firefox works, but cannot save photos to a
   chosen folder and has no screen-keep-awake.)
2. **Power:** plug the laptop in. Windows: *Settings → System → Power*: screen and sleep
   "Never" when plugged in; choose the best-performance power mode. Turn off the screen
   saver.
3. **Interruptions:** pause Windows Update for the duration of the expo; turn on *Do not
   disturb* (no notification pop-ups on the big screen).
4. **Webcam:** an external webcam on a small tripod or clamp, aimed at the visitors' spot.
   It must not move once booth mode has learned the background.
5. **Open the page** <https://drmayerson.github.io/zwart-gat-camera/>, click **Camera aan**
   and allow the camera; in the site settings (padlock icon left of the address) set
   *Camera* to **Allow**, so it starts by itself next time.
6. **Settings** (gear bottom left): language, camera (if there are several), background mode
   and picture, photo options (see [cloudflare/SETUP.md](cloudflare/SETUP.md) for the QR
   service), tap controls for spin/size if wanted, and keep **Onthouden** ticked.
7. **Photo folder:** if photos are saved on the laptop, choose a folder under *Opslaan in*
   (this avoids a "Save as" window for every photo) and allow "on every visit".
8. **Full screen:** button **Volledig scherm** or key **F**.
9. **Restart test:** close the browser, open the page again: it should come back exactly
   as set up, camera running.

### Optional: start automatically as a kiosk

For a laptop that starts the page by itself after a reboot, without address bar:

1. Create a shortcut with target
   `"C:\Program Files\Google\Chrome\Application\chrome.exe" --kiosk "https://drmayerson.github.io/zwart-gat-camera/"`
2. Press Win+R, type `shell:startup`, and put the shortcut in that folder.
3. To leave kiosk mode: Alt+F4.

Do steps 5–7 above in a normal Chrome window first (same Windows user), so the camera and
folder permissions are already granted.

## At the booth

| Action | How |
|---|---|
| Take a photo | click in the picture, arrow key, PageUp/PageDown (presenter remote) |
| Countdown 3-2-1 | tick *Aftellen voor de foto* in Settings |
| Show recent QR codes again | key **Q** or the small **QR** button bottom right (press again for older ones) |
| Hide QR code / cancel countdown | **Esc** |
| Spin, size, background picture without opening Settings | arrows at the right edge (tick the options in Settings) |
| Full screen on/off | **F** (or Esc to leave) |
| Settings | small gear bottom left |
| Check performance | press F12 → Console → type `zgcStats()` (fps should be 50–60) |

## Risks and what to do

| Risk | Effect | Mitigation |
|---|---|---|
| No or poor internet at the venue | fonts fall back to standard ones; booth mode works with the learned background only (no person recognition); QR upload fails → photo is saved on the laptop instead, with a message | test the venue Wi-Fi; bring a phone hotspot; the offline mode "alleen vaste achtergrond" needs no internet at all |
| Changing light (daylight, spots switching) | booth mode adapts within ~20 s; offline mode needs a new recording | use the camera lock option; avoid windows behind the visitors |
| Moving things in the background (screens, people walking behind) | they appear as "people" | aim the camera at a calm background |
| Webcam unplugged / USB hiccup | picture freezes, message, automatic reconnect | tape the cable; use a USB port directly on the laptop |
| Laptop on battery | lower performance, fans | keep it plugged in |
| More than ~1,000 QR photos per day | Cloudflare's free KV limit is reached; uploads fail, photos saved locally | switch the service to R2 (see SETUP.md) for very busy events |
| A visitor grabs the mouse | could open Settings | the gear is small and dim; keep mouse/remote with staff |

## Unattended touchscreen (no staff at the booth)

**Verdict: works by touch alone once staff have set it up.** The setup itself (QR service,
booth key, photo folder, PIN) needs a keyboard or the on-screen keyboard, once.

Everything a visitor can do is a tap: take a photo (tap the picture; with countdown if
ticked), close the QR code (×), re-show a QR code (only if allowed, see below), the arrows at
the right edge (spin, size, background picture; hold to repeat), the language buttons top
right, and the (i) explanation. None of it needs hover, a right click or a key.

Checked here:

| Item | Result |
|---|---|
| Settings protected by a PIN | tapping the gear shows a keypad; wrong PIN shakes and clears; right PIN opens the settings |
| Keypad left alone | closes after 20 s |
| Settings left open | close by themselves after 2 minutes without use (when the PIN is on) |
| Restart with PIN on | always starts with the settings closed |
| Forgotten PIN | open the page with `?pinreset` after the address (needs the address bar, so not possible for visitors in kiosk mode) |
| Visitor language buttons, (i) explanation | work; explanation closes after 60 s |
| Long press on the picture | no menu or text selection |
| Double tap / pinch on the picture | no zoom (pinch on buttons is still possible in a normal browser window, see kiosk flags below) |
| Earlier QR codes | could be re-shown by anyone: there is now an option to remove the "QR" button; **switch it off when unattended** |

Not testable here: a real touchscreen (the tests used mouse clicks; all controls use pointer
events, which touch screens send too).

Set up for unattended use:

1. Settings → *Zichtbaar als de instellingen verborgen zijn*: tick what visitors may use
   (spin, size, background picture, languages, explanation).
2. Settings → *Beveiligen*: tick the PIN option and choose a PIN of 4–8 digits.
3. If photos are on: untick *Knop "QR" voor eerdere QR-codes tonen*; prefer the QR code over
   saving on the laptop (a "Save as" or permission prompt could pop up for a visitor).
4. Run Chrome in kiosk mode (see above) and add these options to the shortcut, so visitors
   cannot zoom or swipe away from the page:
   `--kiosk --disable-pinch --overscroll-history-navigation=0`
5. Windows: switch off edge swipes (Action Center) for the booth account, or use Windows'
   own kiosk mode ("assigned access"); no keyboard within reach of visitors.

## Before going live: update the photo service once

The visitor download page now speaks NL/EN/FR/DE (it uses the phone's language). This is
in [cloudflare/worker.js](cloudflare/worker.js): paste the new version into the Cloudflare
Worker editor once and deploy (step 3 of SETUP.md). Until then the visitor page stays Dutch;
everything else keeps working.

## Known limitations

- Posters, statues or mannequins that look like people may stay visible in booth mode.
- Booth mode needs a fixed camera; if it is bumped, press *Opnieuw leren* (relearn).
- The visitor page and photos depend on the Cloudflare service and on the visitor's phone
  having internet.
- Not tested here: real webcams, the venue lighting, an external display/TV, and a
  multi-hour run on the actual laptop. Do one dry run of at least an hour before the expo.
