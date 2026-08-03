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
- The repo root also has small **Node tool scripts** run only by
  GitHub Actions, never on the Pi or in the browser: `fetch-current-
  lesson.mjs` (uses `jsdom`; see "Current lesson lookup" below) and
  `transcode-lesson-video.mjs` (shells out to `ffmpeg`, installed as a
  workflow step; see "Video transcoding" below). Neither makes the
  *site* a Node app: `public/` stays plain HTML/CSS/JS with no build
  step, same as ever. `node_modules/` is gitignored.

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

**Licensing boundary:** the church has an active Awana Ministry
Membership covering this curriculum for its own program. Everything
here is scoped to **internal, on-device playback only** — nothing here
should ever redistribute, advertise, or link to these video files for
anyone other than this kiosk. `public/lessons.json`'s `downloadUrl`s
point at Awana's own CDN and are the canonical source; this repo never
fetches them for any purpose beyond this kiosk's own playback/caching.

**Deliberate, informed exception — re-encoded copies in `public/`:**
Awana doesn't offer a lower-resolution/lower-bitrate download for any
lesson (checked directly against the real page — only "Leader Video"
and "Student Video," both full quality), and the kiosk's Raspberry Pi
Zero cannot decode the originals (1080p H.264, ~90-220MB each) at a
usable frame rate. `scripts/transcode-lesson-video.mjs` (server-side,
in the nightly Action) re-encodes the current lesson down to something
the Pi Zero can actually play smoothly and writes it to
`public/current-lesson-video.mp4`, which GitHub Pages then serves —
technically a public URL, same as the rest of this site. The project
owner chose this trade-off explicitly, aware that it's a narrower
version of "never rehost" than the original wording: it's a re-encoded,
lower-quality copy, used solely for this kiosk's own playback, never
linked/advertised anywhere else — not a copy of the original files
being redistributed. If you're touching this boundary in either
direction, that's a call for the project owner, not an assumption to
make either way.

### `public/lessons.json` — the fixed lesson map

Hand-maintained, not scraped nightly (the course itself doesn't change
week to week): `{ version, sourceUrl, lessons: [{ week, unit, lesson,
title, downloadUrl, leaderDownloadUrl }, …] }`. `week` is a flat 1-32
count in course order (`unit`/`lesson` are the Advocates page's own
"Unit N, Lesson M" numbering — 8 units × 4 lessons). `downloadUrl` is
always the Student Video (the one the auto-scheduled 6:30 show plays);
`leaderDownloadUrl` is that lesson's Leader Video, used only by the
manual video-picker in Settings (see "Manual video preview" below) —
**`null` for week 27** ("Unit 7, Lesson 3: Suffering"), which really
has no Leader Video on Awana's own page, not a scraping gap. Built by
fetching and parsing the real Advocates page (all 32
`.m-lesson-resources-block` tiles, each with a "Unit N, Lesson M"
heading and a `.m-small-video-resource-tile` per video labeled "Student
Video" / "Leader Video" with its own download link) — rebuild it the
same way if Awana revises the course. Don't guess the Leader Video's
filename from the Student one: it's usually `…-leader.mp4` but three
lessons (weeks 17-19) use `…-leaders.mp4` (plural) instead — a real
inconsistency in Awana's own naming, confirmed against the live page,
not a typo to "fix" here.

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
lesson with a wrong one. `scripts/transcode-lesson-video.mjs` then runs
as the next step in the same workflow — see "Video transcoding" below.

**`current-lesson.json` schema** (`version: 2`): `{ week, title,
sourceUrl, downloadUrl, transcodedAt, resolvedAt }`.
- `sourceUrl` is the original (large) lesson file's CORS-friendly CDN
  URL — see the CORS note further down. It's this script's own
  "did the lesson actually change" identity (`sameLesson()` compares
  `week`/`title`/`sourceUrl`, deliberately NOT `downloadUrl`).
- `downloadUrl` is what the kiosk actually fetches/caches/plays. It
  starts out equal to `sourceUrl` (so playback still works before
  transcoding catches up) and gets overwritten to the small, same-origin
  `current-lesson-video.mp4` once `transcode-lesson-video.mjs` succeeds.
- `transcodedAt` is null until that transcode succeeds for the current
  lesson. `fetch-current-lesson.mjs` resets both `downloadUrl` (back to
  `sourceUrl`) and `transcodedAt` (back to null) whenever the lesson
  genuinely changes, but **preserves** them across a heartbeat-only
  rewrite (same lesson, just re-confirmed) — otherwise every weekly
  heartbeat would discard a perfectly good transcoded video and make
  the kiosk fall back to the full-size original until the next transcode
  run, for no reason.

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
still there, the script defaults to **week 1** (the first Advocates
video) rather than leaving the display blank — an explicit default, by
request, not a match against the entrance-gate count.

**Once in the book, the Section text is "Unit N #M"** — verified
against this church's own full-year schedule (fetch
`?current_only=N`, one book-track table per scheduled meeting date for
the whole year, rather than just the current one). The Journey club's
schedule shows the last entrance-gate meeting as "Faith Foundations #7"
(2026-09-02), then the very next meeting (2026-09-09) as "Unit 1 #1",
continuing in lockstep with the Advocates page's own numbering through
"Unit 8 #4" (2027-05-19). So "Unit N #M" maps directly to
`lessons.json`'s `unit`/`lesson` fields — an earlier version of this
script guessed a flat 1-32 count instead, which happened to work for
Unit 1 by coincidence but would have been wrong from Unit 2 onward;
that guess has been replaced with this verified mapping.

The entrance-gate label check is deliberately tolerant of whitespace
(including a stray non-breaking space, which `String.trim()` alone
does not strip from the middle of a string) and case, normalizing
before comparison — the same tolerance `matchLesson()`'s `\s+` regex
already had, so a template variance doesn't turn into a permanent
nightly failure on one side but not the other.

### Video transcoding (`scripts/transcode-lesson-video.mjs`)

Runs as the step right after `fetch-current-lesson.mjs` in
`update-lesson.yml`. Verified against a real lesson file: Awana's
original is 1920x1080 H.264 Main profile, ~2.2Mbps video + 161kbps
audio, ~94MB for a ~5.5 minute lesson. Re-encoded to 854x480 H.264
**Baseline** profile (avoids CABAC entropy coding, which costs
meaningfully more CPU to decode than baseline's CAVLC — the actual
lever for a weak decoder, more than resolution alone), capped at
~700kbps video + 96kbps audio, **same original frame rate** (shrinking
resolution/bitrate/profile is what should let a weak decoder keep up;
dropping frame rate further wasn't part of the ask and would look
worse for no decode-cost benefit) — that lesson came out to ~17MB, a
~5.5x reduction, visually clean at normal TV viewing distance (spot-
checked by extracting and viewing real frames from both).

- Downloads `current-lesson.json`'s `sourceUrl` — server-side, so
  Node's `fetch()` doesn't care whether it's CORS-friendly (CORS is a
  browser-only concept); this is simpler than the browser-side
  constraint that made `sourceUrl` need to be CORS-friendly in the
  first place (see the CORS note below).
- Skips the work entirely if `current-lesson.json.transcodedAt` is
  already set for the current lesson **and** `public/current-lesson-
  video.mp4` still exists on disk — so a nightly run that finds nothing
  changed doesn't re-download/re-encode ~100-200MB for no reason.
- **Never fails the overall job.** Any failure (download, ffmpeg, disk)
  is caught and logged; `current-lesson.json`'s `downloadUrl` is simply
  left as whatever `fetch-current-lesson.mjs` wrote it as (`sourceUrl`,
  the original) — the kiosk still plays and caches that directly, just
  at full size/quality, rather than being left with no video at all.
- **Single reusable filename** (`public/current-lesson-video.mp4`),
  overwritten in place each time the lesson changes — not one file per
  lesson. Keeps at most one lesson's video present in the working tree
  at a time, matching the existing `current-lesson.json` pattern.
  Git still keeps every past version in *history* though, so the
  repo's `.git` size grows by roughly one lesson's transcoded size
  (~15-20MB) every time the lesson changes — around 500-600MB across a
  full 32-week run through the course. Not a problem at today's scale;
  if it ever becomes one, moving this asset to a GitHub Release (which
  doesn't bloat git history) is the natural next step — deliberately
  not built now, since it's real added complexity this repo doesn't
  need yet.

### Video playback and offline resilience (`public/src/schedule.js`)

No service worker — the browser's Cache API is used directly from
`schedule.js`, which is simpler and is all "cache one video file"
actually needs:

- **The video no longer autoplays at 6:30.** Crossing into the
  scheduled window shows a branded "Large Group Time" splash
  (`#journey-splash`) instead, with this week's lesson **topic** as the
  hero, filled in from `currentLesson` by `showJourneyContent()`. The
  lesson video itself is still queued up in the background exactly as
  before (see the pre-fetch bullet right below) — only the on-screen
  *playback* waits.
- **The splash's design is derived from the real Advocates title
  cards, not invented — don't "brand" it back to guesswork.** The
  lesson thumbnails on `clubs.awana.org/ym-course/advocates/` are the
  videos' own opening cards, and they establish the language: warm,
  slightly-off-white hand-lettered type over warm natural photography,
  showing the lesson's **topic word alone** ("apologetics",
  "PANTHEISM") — no badges, no subtitles, no chrome. So the splash
  leads with the topic at display size, demotes `Week N · Unit N,
  Lesson M` to quiet metadata, keeps the course lockup small in the
  top-left, and uses a warm near-black (`#15120f`) / bone
  (`#f6f1e8`) / warm amber (`#c8a06a`) palette pulled from those
  cards. An earlier pass used a centered stack with an invented
  red/gold pill badge and a big filled CTA — those colors appear
  nowhere in Awana's material. We can't ship the hand-lettered face
  (no build step, and the Pi only has Raspberry Pi OS's own fonts), so
  the echo is compositional rather than typographic.
- **`splitLessonTitle()`** is what makes that possible: `lessons.json`
  titles are `"Unit N, Lesson M: Topic"`, and it splits on the first
  colon so the topic can lead. All 32 topics are a single word (longest
  is "Resurrection"), which is what lets the hero be sized as big as it
  is — re-check that sizing if a multi-word topic ever appears. Topics
  render **as authored, never force-lowercased**: week 21's topic is
  the acronym `DNA`, which "dna" would mangle. A title with no colon
  falls back to using the whole string as the topic, and the
  `#journey-splash-ref:empty` rule drops the dangling separator.
  An operator starts it with **Space**, **→**, or the on-screen "Begin
  Video" button; all three are gated by `isAwaitingPlay()` (splash
  visible, Journey view showing, not `previewMode`) and funnel into
  `playCurrentLesson()`, which is the only thing that ever sets
  `journeyVideo.src` for the scheduled show. This also conveniently
  doubles as the audio-unlock gesture (see `audioUnlocked` below) —
  pressing Space/→/the button to begin is itself a genuine user
  action, so playback can start unmuted immediately rather than
  needing a separate tap. **The manual preview flow (Settings panel)
  is unchanged** — `startPreview()` still plays immediately, bypassing
  the splash entirely; the splash-and-wait behavior only applies to
  the scheduled 6:30 show.
- On load, and hourly afterward, it fetches `current-lesson.json` and
  — regardless of what's currently on screen — pre-fetches that
  lesson's video into a dedicated `journey-videos-v1` cache bucket if
  it isn't already there. This runs well ahead of 6:30 PM, so playback
  doesn't depend on the network being up at showtime (the church's Pi
  connection is known to be flaky in the evenings). A failed fetch of
  `current-lesson.json` (the flaky-network case this exists for) is
  treated as "no news" and never clears an already-loaded lesson —
  only a genuinely resolved lesson can replace `currentLesson`.
- **Why `sourceUrl` is a CDN URL, not the `clubs.awana.org` one
  `lessons.json` lists:** `clubs.awana.org` 302-redirects lesson
  downloads to a CloudFront-backed host, and that redirect response
  itself carries no `Access-Control-Allow-Origin` header (confirmed
  against the live site). A browser `fetch()` in CORS mode — which the
  Cache API path needs, to read a response into a storable/playable
  `Blob` — fails outright on that redirect hop, even though the
  CloudFront target it points to *does* send
  `access-control-allow-origin: *`. Switching to `no-cors` mode is
  **not** a fix: an opaque response's body is null by spec (that's the
  whole point of the opacity), so `.blob()` on it always yields 0
  bytes, cached or not. The real fix has to happen server-side, where
  CORS doesn't apply — `fetch-current-lesson.mjs` resolves the redirect
  itself (a plain HEAD request) and records the already-CORS-enabled
  final URL as `sourceUrl`, falling back to the original
  `clubs.awana.org` URL if that resolution ever fails (still fine for
  direct `<video>` playback either way, which is never subject to CORS
  unless the `crossorigin` attribute is set — deliberately not set
  here). In steady state `downloadUrl` is the transcoded same-origin
  file, so this CORS distinction only actually matters for the (rare)
  case where transcoding hasn't succeeded yet and the browser has to
  fetch `sourceUrl` directly.
- The previous week's cached video is evicted only once the new one is
  safely stored, so a mid-download failure can't leave the cache empty.
- Playback resolves from the cache (via `URL.createObjectURL`) when
  available, falling back to the live download URL otherwise (e.g. the
  very first run before anything's cached yet). The object URL is only
  ever revoked once its replacement is already in hand, and only
  released for good (along with detaching the `<video>` element) once
  the Journey window closes — a ~100-200MB decoded blob has no reason
  to stay resident for the other 23 hours of the day on a 512MB Pi Zero.
- Video starts muted (autoplay policy) with a visible unmute button
  (a text label, not just an emoji glyph, since Raspberry Pi OS doesn't
  always ship a color-emoji font); finishing the video falls back to
  the Check-in Display immediately rather than waiting for 7:15. A
  failed/stalled video load falls back to the placeholder too, rather
  than a silent black frame indistinguishable from a dead display.
  `video.loop` is explicitly set `false` (it was never looping by
  accident, but this makes the intent explicit rather than relying on
  the element's default).
- **Autoplay-with-sound after the first click:** browsers only allow
  *unmuted* autoplay once a genuine user gesture has occurred on the
  page. This page's only clickable elements are its two corner buttons,
  the splash's "Begin Video" button, and the Space/→ keys that start
  the scheduled lesson (a click inside the Check-in Display iframe is a
  different origin and never bubbles up to this document); any of them
  sets an in-memory `audioUnlocked` flag before `playCurrentLesson()`
  reads it, so the scheduled lesson now starts unmuted from its very
  first play — the splash's whole reason for existing is that playback
  never begins without one of these gestures having just happened.
  Deliberately **not** persisted to `localStorage` — the browser's own
  gesture-based permission is itself scoped to the page's lifetime (it
  doesn't survive a reload/reboot either), so persisting "still
  unlocked" past that point would just be wrong. The one path that can
  still start muted is a manual preview (Settings panel) opened before
  any gesture on the page at all — rare, since opening Settings is
  itself a click.
- **`lastPhase` invariant — do not break this again:** `lastPhase`
  tracks only the *scheduled* phase (for detecting a genuine 18:30/
  19:15 boundary crossing); the manual toggle button and the video's
  `ended` handler both call `setView()` directly to change what's on
  screen *without* touching `lastPhase`. That's what lets either of
  them hold a view that disagrees with `scheduledPhase()` (checkin
  shown early, or shown again after the lesson finished early) without
  the next 15s poll tick fighting them. An earlier version of the
  `ended` handler set `lastPhase = 'checkin'` directly, which made the
  *very next* poll tick see a manufactured "flip" back to `'journey'`
  and restart the lesson from frame zero — confirmed live before the
  fix. If you touch the poller or either handler, re-verify this
  property doesn't regress.
- A screen [Wake Lock](https://developer.mozilla.org/en-US/docs/Web/API/Screen_Wake_Lock_API)
  is requested on load and re-acquired on `visibilitychange`, since
  Raspberry Pi OS's default screen-blanking would otherwise leave the
  kiosk asleep long before 6:30 PM with no local activity to prevent
  it. Not fatal if unsupported — disabling blanking at the OS level
  (see `PI_SETUP.md`) is the belt-and-braces fallback either way.

### Manual video preview (Settings panel)

A third corner button (`#settings-btn`, top-right, same subtle style as
the other two) opens a panel listing every lesson in `lessons.json`, so
an operator can play any week on demand — for testing, previewing an
upcoming lesson, or catching up after a missed night.

- **Always a one-off.** Picking a lesson plays it immediately and never
  writes to `current-lesson.json` or touches `currentLesson` — the
  6:30 auto-schedule is completely unaffected by what was manually
  previewed, by design (confirmed: crossing the 6:30/7:15 boundary
  mid-preview doesn't interrupt it, and ending a preview afterward
  correctly resumes the real auto-resolved lesson, not the previewed
  one).
- **Plays the original URL directly**, bypassing the Cache API/
  transcode pipeline entirely — this is an occasional manual action on
  a lesson that isn't necessarily "current," so it doesn't warrant the
  pre-caching machinery built for the nightly auto-played lesson. It
  will load slower and may not play as smoothly on the Pi Zero as the
  transcoded current lesson does; that's an accepted trade-off for a
  rarely-used feature, not a bug to fix by extending transcoding to all
  32 lessons (see the repo-size trade-off already noted under "Video
  transcoding").
- **Outside the 6:30-7:15 window, picking a lesson asks Leader or
  Student Video first**; inside the window it plays the Student Video
  directly, same as the automatic show would. Outside the window is
  more likely someone reviewing content (the Leader Video carries extra
  discussion notes not meant for the room) than showing it to kids, so
  offering the choice there — but not interrupting the normal in-window
  experience with an extra step — was a deliberate distinction.
  Lessons with no Leader Video (`leaderDownloadUrl: null` — currently
  only week 27) disable that choice rather than offering a dead link.
- **`previewMode`** (in `schedule.js`) is the flag that makes this
  safe: the 15s scheduler poll and the hourly lesson refresh both
  no-op while it's set, so neither can interrupt an active preview or
  silently swap its video out from under it. It's cleared, and control
  handed back to `setView(scheduledPhase())`, when the preview's video
  ends/errors or the operator taps the view-toggle button (deliberately
  reused rather than adding a fourth button) — never anything else.

## Embedding note

The Awana Check-in Display (`https://patrick-simpson.github.io/Awana-Check-in-Display/`)
has no `X-Frame-Options`/CSP restriction, so it embeds fine in
`#checkin-view`'s iframe. If that ever changes, this page would need a
different integration approach (e.g. redirecting instead of embedding).

The iframe `src` carries `?lowPower=1` — that sibling app's own signage
runs on other, far more powerful devices too, so its confetti/motion
defaults stay full-strength; this flag scopes reduced animations to
*this* embed's Raspberry Pi Zero specifically, without touching what
any other device defaults to. See that repo's `src/lib/urlFlags.js` and
`CLAUDE.md` before changing or removing it.
