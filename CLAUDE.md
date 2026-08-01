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
- The repo root also has a small **Node/`jsdom` tool script**
  (`scripts/fetch-current-lesson.mjs`, run only by GitHub Actions —
  see "Current lesson lookup" below). This does not make the *site*
  a Node app: `public/` stays plain HTML/CSS/JS with no build step,
  same as ever. `node_modules/` is gitignored.

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

`#journey-view` plays the current week's "Journey: Advocates" lesson
video (a 32-week apologetics course, `https://clubs.awana.org/ym-course/advocates/`).
Each lesson is a direct `.mp4` file hosted on Awana's own CDN (not
Vimeo — confirmed by fetching the real page; each lesson ships both a
"Leader Video" and a "Student Video", and this repo always uses the
Student Video, since that's the one meant to play to the kids). If
`public/current-lesson.json` hasn't resolved a lesson yet, it falls
back to the plain placeholder (dark background + "Journey" text) —
never a broken `<video>` — same "missing data renders nothing"
principle as the sibling Awana-Check-in-Display repo.

**Licensing boundary — do not relax:** the church has an active Awana
Ministry Membership covering this curriculum for its own program.
Everything here is scoped to **internal, on-device playback only** —
caching a video locally for this kiosk to play is within that license;
nothing here should ever re-serve, re-share, or publicly rehost the
video files themselves. `public/lessons.json`'s `downloadUrl`s point at
Awana's own CDN; this repo only ever fetches them into the browser's
own cache for this device, never onto a public URL.

### `public/lessons.json` — the fixed lesson map

Hand-maintained, not scraped nightly (the course itself doesn't change
week to week): `{ version, sourceUrl, lessons: [{ week, unit, lesson,
title, downloadUrl }, …] }`. `week` is a flat 1-32 count in course
order (`unit`/`lesson` are the Advocates page's own "Unit N, Lesson M"
numbering — 8 units × 4 lessons). Built by fetching and parsing the
real Advocates page (all 32 `.m-lesson-resources-block` tiles, each
with a "Unit N, Lesson M" heading and Student/Leader video download
links) — rebuild it the same way if Awana revises the course.

### Current lesson lookup

`.github/workflows/update-lesson.yml` runs nightly (mirroring the
sibling repo's `update-calendar.yml` pattern): it calls
`scripts/fetch-current-lesson.mjs`, which resolves "what's the current
lesson" from the church's own TwoTimTwo calendar
(`https://kvbchurch.twotimtwo.com/calendar/index?current_only=Y`),
matches it against `public/lessons.json`, and writes
`public/current-lesson.json` — same-origin, so the kiosk never depends
on a third-party fetch succeeding at 6:30 PM. Only commits when the
resolved week actually changes (or weekly, as a staleness heartbeat).
If it can't confidently resolve a lesson, it exits non-zero and leaves
the last-good file alone — a bad parse must never overwrite a good
lesson with a wrong one.

**Verified DOM contract** (confirmed against a real saved response —
see the comment at the top of `fetch-current-lesson.mjs`): this
`?current_only=Y` endpoint is a *different* page/template than the
general church calendar the sibling repo scrapes (`.dayline` divs) —
it's a per-club "current book track" table (`tr.book-track-mtg`), one
row per club, with a `Book Track` column ("Journey: Advocates") and a
`Section` column carrying TwoTimTwo's own counter label (e.g. "Faith
Foundations #7").

**"Faith Foundations" is the entrance gate, not the book.** Every club
runs through this generic onboarding sequence before starting whatever
book they're actually assigned — "Faith Foundations #7" means "7 weeks
into the entrance gate," **not** "week 7 of Advocates," even though it
shows up under the "Journey: Advocates" Book Track. While a club is
still there, the script positively writes a "no lesson" feed
(`week: null`) rather than guessing — confirmed correct, not just
refused, since we know for certain there's no book lesson yet.

Once a club finishes the entrance gate, the Section text is expected
to actually reflect the book — but **the real shape of that text
hasn't been observed yet** (this church's Journey club was still in
the entrance gate as of writing). The current matching logic (trailing
`#N` read as a flat 1-32 position against `lessons.json`'s `week`
field) is a best guess for that later stage, carried over from before
this distinction was known. **Do not trust its first real "in the
book" output blindly** — verify it against what the Advocates page and
TwoTimTwo actually agree on once the club gets there, and update
`matchLesson()` in `fetch-current-lesson.mjs` if the real shape differs.

### Video playback and offline resilience (`public/src/schedule.js`)

No service worker — the browser's Cache API is used directly from
`schedule.js`, which is simpler and is all "cache one video file"
actually needs:

- On load, and hourly afterward, it fetches `current-lesson.json` and
  — regardless of what's currently on screen — pre-fetches that
  lesson's video into a dedicated `journey-videos-v1` cache bucket if
  it isn't already there. This runs well ahead of 6:30 PM, so playback
  doesn't depend on the network being up at showtime (the church's Pi
  connection is known to be flaky in the evenings).
- The previous week's cached video is evicted only once the new one is
  safely stored, so a mid-download failure can't leave the cache empty.
- Playback resolves from the cache (via `URL.createObjectURL`) when
  available, falling back to the live download URL otherwise (e.g. the
  very first run before anything's cached yet).
- Video starts muted (autoplay policy) with a subtle unmute button
  (same visual language as the corner toggle button); finishing the
  video falls back to the Check-in Display immediately rather than
  waiting for 7:15.

## Embedding note

The Awana Check-in Display (`https://patrick-simpson.github.io/Awana-Check-in-Display/`)
has no `X-Frame-Options`/CSP restriction, so it embeds fine in
`#checkin-view`'s iframe. If that ever changes, this page would need a
different integration approach (e.g. redirecting instead of embedding).
