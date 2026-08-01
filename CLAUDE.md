# Journey Display — Project conventions for Claude

## Git workflow: push directly to `main` on every update

Every code change in this repo should be committed **and pushed to
`main`** as part of the same turn. There are no feature branches and no
pull request review step — the user has explicitly authorized direct
pushes to `main`. The deploy workflow at
`.github/workflows/deploy.yml` triggers on every push to `main`, so
each push automatically redeploys the live kiosk site.

Concretely, after editing any file:

1. `git add` the changed files.
2. `git commit` with a clear message.
3. `git push -u origin main` (no PR, no other branch).

## Tech stack snapshot

- Plain static HTML/CSS/JS — **deliberately no framework or build
  step**. This runs on a Raspberry Pi Zero from 2017 (single-core
  ARMv6, 512MB RAM), so keeping the page as light as possible for the
  Chromium kiosk browser matters more than developer convenience.
- Only `public/` is deployed to GitHub Pages (see
  `.github/workflows/deploy.yml`) — repo docs, workflow files, etc.
  never end up served on the live site.
- `public/index.html` is the only page. It mounts two full-viewport
  layers and toggles a `hidden` class between them rather than
  destroying/recreating either — the Awana Check-in Display iframe
  (`#checkin-view`) needs to stay connected in the background so its
  live check-in data doesn't have to reconnect when Journey isn't
  showing.

## Daily schedule

`public/src/schedule.js` holds the switching logic:

- `JOURNEY_START_MINUTES` (18:30) / `JOURNEY_END_MINUTES` (19:15) are
  the schedule window in minutes-since-midnight, using the Pi's local
  system clock. Change these two constants to retime the switch.
- The Awana Check-in Display shows outside that window; the Journey
  placeholder shows inside it. This repeats every day — there's no
  date logic, only time-of-day.
- On load, the current phase is computed immediately (so a reboot
  mid-window comes up correct), then a ~15s poll only forces a view
  change when the phase actually flips (i.e. exactly at the two
  boundaries) — this is what lets the manual toggle button override
  the view in between without being fought by the poller.

## The Journey page itself

`#journey-view` in `public/index.html` is currently a plain
placeholder (dark background + "Journey" text). **This is the one
piece meant to be replaced** once the real Journey content is built —
swap the placeholder markup (or point it at an iframe, same pattern as
`#checkin-view`) without touching the scheduling logic in
`schedule.js`.

## Embedding note

The Awana Check-in Display (`https://patrick-simpson.github.io/Awana-Check-in-Display/`)
has no `X-Frame-Options`/CSP restriction, so it embeds fine in
`#checkin-view`'s iframe. If that ever changes, this page would need a
different integration approach (e.g. redirecting instead of embedding).
