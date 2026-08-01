# Journey Display

The default kiosk website for the church's Raspberry Pi Zero signage
display. It shows the [Awana Check-in Display](https://patrick-simpson.github.io/Awana-Check-in-Display/)
full-screen all evening, then automatically switches to the current
week's "Journey: Advocates" lesson video from **6:30 PM to 7:15 PM**
every day, before switching back (or as soon as the video ends,
whichever comes first). A small, subtle button in the bottom-right
corner lets a volunteer manually toggle between the two views at any
time; a second small button appears over the video to unmute it.

Live site: `https://patrick-simpson.github.io/Journey-Display/`
(GitHub Pages, redeployed automatically on every push to `main`).

## How it works

- `public/index.html` — the whole app. Two full-viewport layers
  (Check-in Display iframe, Journey placeholder) are both always
  mounted; a small script toggles which one is visible.
- `public/src/schedule.js` — the 6:30/7:15 schedule and the manual
  toggle button's behavior. See `CLAUDE.md` for the constants and how
  to retime the window.
- `public/src/style.css` — full-bleed layout and the subtle button
  styling.
- `public/lessons.json` — the fixed week→video map for the Advocates
  course (hand-maintained; see `CLAUDE.md`).
- `public/current-lesson.json` — which week is "current" right now,
  refreshed nightly by `.github/workflows/update-lesson.yml` from the
  church's own calendar system. Falls back to a plain placeholder if
  this hasn't resolved a lesson yet.

See `CLAUDE.md` for the full design of the lesson lookup and the
client-side video caching (so a flaky evening connection can't
interrupt playback).

Deliberately plain HTML/CSS/JS with no build step or framework: the
target hardware is a 2017 Raspberry Pi Zero (single-core ARMv6,
512MB RAM), so keeping the page as light as possible for its Chromium
kiosk browser matters more than developer convenience.

## Setting up the Raspberry Pi as a kiosk

The Pi should boot straight into Chromium in kiosk mode, pointed at
the live GitHub Pages URL above. A typical setup:

1. Install a lightweight desktop environment + Chromium if not already
   present (Raspberry Pi OS Lite + a minimal X session, or Raspberry Pi
   OS Desktop as-is).
2. Autostart Chromium in kiosk mode on boot, e.g. via
   `~/.config/lxsession/LXDE-pi/autostart` (LXDE) or a `systemd` user
   service, running something like:

   ```sh
   chromium-browser --kiosk --noerrdialogs --disable-infobars \
     https://patrick-simpson.github.io/Journey-Display/
   ```

   Deliberately **not** `--incognito`: the page caches the current
   lesson's video ahead of time using the browser's own storage, so it
   can still play if the network drops at 6:30. Incognito storage is
   wiped whenever the browser process restarts, which would silently
   throw away that cached video.
3. Disable screen blanking/DPMS (`xset s off`, `xset -dpms`,
   `xset s noblank`) so the kiosk doesn't sleep mid-evening.
4. Point Chromium at the URL above and leave it running — the page's
   own JavaScript handles the daily 6:30/7:15 switch, so the Pi never
   needs to reload or restart Chromium on a schedule.

This section is operational guidance only; the Pi's OS-level
provisioning (systemd units, autostart files, etc.) lives on the
device itself, not in this repo.
