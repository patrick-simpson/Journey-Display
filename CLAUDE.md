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

**A deployed fix is NOT immediately live on the kiosk.** GitHub Pages
serves every asset with `Cache-Control: max-age=600`, and Chromium's
normal reload does not revalidate subresources that are still fresh —
so for up to ~10 minutes after a deploy, an F5 on the Pi reloads
`index.html` but keeps running the *previous* `schedule.js`/CSS from
disk cache (this survives a reboot too). This has already caused one
"the fix didn't work" false alarm during live testing. When verifying a
fix on the kiosk: wait 10 minutes and then refresh, or hard-refresh
(Ctrl+Shift+R) to bypass the cache immediately. When a live symptom
contradicts code you know is deployed, suspect this cache before
suspecting the code.

## GitHub Pages source must stay "GitHub Actions"

The repo's Pages setting (Settings → Pages → Build and deployment →
Source) must be **"GitHub Actions"**, never "Deploy from a branch".
With the branch source set, every push to `main` triggers GitHub's
built-in "pages build and deployment" workflow, which publishes the
repo *root* (no `index.html` there — only `public/` has one) and races
`deploy.yml`'s correct artifact; whichever finishes last wins, so the
live site flip-flops between two entirely different layouts.

That flip-flop is what made the 2026-08-22 kiosk outage so confusing to
diagnose, and it's worth understanding the interaction, because the two
layouts have **disjoint** valid URLs:

| Pages source | `/` | `/public/index.html` |
| --- | --- | --- |
| GitHub Actions (correct) | 200 | 404 |
| Deploy from a branch | 404 | 200 |

The Pi had been misconfigured to load `…/Journey-Display/public/index.html`
— a URL that is only valid under the *wrong* Pages source. So every time
the built-in branch build won the race, the kiosk came back to life and
the misconfiguration stayed hidden; every time `deploy.yml` won, the
kiosk 404'd. Fixing the Pages source made the kiosk's 404 permanent
rather than intermittent, which is why the Pi's URL had to be corrected
to the canonical root (`https://patrick-simpson.github.io/Journey-Display/`)
at the same time. **The lesson: a kiosk that recovers on its own is not
evidence the kiosk is configured right** — check the URL the browser is
actually on (`ps -eo args | grep -i '[c]hromi'`) before believing the
server is at fault.

`deploy.yml` has a best-effort step that tries to force the setting via
the REST API, but
the Actions `GITHUB_TOKEN` isn't allowed to change Pages settings
("Resource not accessible by integration"), so only a repo admin can
actually fix it in the UI. Symptom to recognize: a `dynamic/pages/
pages-build-deployment` run appearing alongside a push means the
setting has regressed.

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

**Deliberate, informed exception — re-encoded copies:**
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
being redistributed.

**Owner-approved extension (2026-08-22) — all lessons, on a Release:**
the same exception now covers Pi-playable 480p re-encodes of *every*
lesson video (32 Student + 31 Leader; week 27 has no Leader Video),
uploaded as assets on the `transcoded-videos-v1` GitHub Release by
`scripts/transcode-all-lessons.mjs` / the on-demand
`transcode-all-lessons.yml` workflow. The manual video-picker plays
these (originals were undecodable on the Pi Zero — reported broken from
the live kiosk), falling back to the original URL if an asset is
missing. A Release rather than `public/` keeps ~1.1GB out of the repo,
its history, and every Pages deploy. Same character as the nightly
exception: re-encoded, kiosk-playback-only, never linked elsewhere.
The owner explicitly approved this extension when asked directly on
2026-08-22. If you're touching this boundary in either direction,
that's a call for the project owner, not an assumption to make either
way.

### `public/lessons.json` — the fixed lesson map

Hand-maintained, not scraped nightly (the course itself doesn't change
week to week): `{ version, sourceUrl, lessons: [{ week, unit, lesson,
title, downloadUrl, leaderDownloadUrl, captions }, …] }`. `captions` is
`{ student: bool, leader: bool }` — a shipped manifest of which
transcripts exist in `public/transcripts/`, regenerated by
`scripts/update-captions-manifest.mjs` (re-run it after adding or
removing any VTT). It exists so `captionsAvailable()` in `schedule.js`
answers "does this video have captions?" from data the page already
has, instead of a network HEAD probe at the moment the operator presses
play — the probe survives only as a bounded (2.5s-timeout) last resort
for when lessons.json never loaded. `week` is a flat 1-32
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
  doesn't bloat git history) is the natural next step. (The manual
  picker's batch-transcoded copies DO live on a Release now — see the
  owner-approved extension above — but this nightly file deliberately
  stays in `public/`: the kiosk pre-caches it with a browser `fetch()`,
  which needs a same-origin/CORS-friendly URL, and a Release download's
  redirect hop has the same missing-CORS-header problem the "why
  sourceUrl is a CDN URL" note below describes. Direct `<video>`
  playback, which is all the picker does, doesn't care.)

### Video playback and offline resilience (`public/src/schedule.js`)

No service worker — the browser's Cache API is used directly from
`schedule.js`, which is simpler and is all this page's caching actually
needs (a service worker was considered again for the 2026-09-01
offline-resilience work and deliberately rejected: everything below is
achievable with Cache API + blob URLs, and a mismanaged SW on a remote
kiosk can pin stale code indefinitely — strictly worse than the
10-minute Pages cache we already tiptoe around. Accepted residual risk:
a reboot during a total outage has no app shell to load).

- **No click or keypress may await the network before something visible
  changes** — this is a hard rule, learned live ("you click buttons and
  it doesn't respond" — reported 2026-09-01 from the kiosk on flaky
  WiFi). The two offenders were `requestPlayback()` (awaited a caption
  HEAD probe with no timeout before ANY DOM change, so Begin
  Video/Space/the picker looked dead while the network dawdled) and
  `openSettingsPanel()` (awaited lessons.json before unhiding the
  panel, so a hung fetch made the gear button read as broken forever).
  `requestPlayback()` now reveals the Journey layer + loading overlay
  synchronously and probes after; the settings panel opens instantly
  with a "Loading lesson list…" note that becomes a visible error state
  on failure. Anything the UI indirectly waits on goes through
  `fetchWithTimeout()`. Every control also got an instant `:active`
  press state in style.css (`transition: none` so it lands next paint).
  If you add a new interactive path, keep this property: acknowledge
  first, network later.
- **The whole current-week bundle is pre-downloaded, not just the
  video**: `cacheLessonBundle()` (on load, hourly, and on the browser's
  `online` event) stores the lesson video, BOTH transcripts, and the
  leader handout in `journey-videos-v1`. A 404 (week 27 has no leader
  VTT/handout) is "legitimately missing — skip", not a failure; the old
  bundle is evicted only after every piece of the new one stored
  (store-before-evict, extended from the old single-video invariant —
  on any real failure nothing is evicted and the next refresh retries).
  Playback then consumes the cache: caption tracks and the handout
  iframe get blob URLs when cached (revoked in `stopJourneyContent()` /
  `closeHandout()`), so captions and the current week's handout work
  offline. A same-week Student pick in the manual picker also plays the
  cached copy (gated on `currentLesson.transcodedAt`, so a
  not-yet-transcoded 1080p original never reaches the Pi's decoder that
  way) instead of re-streaming ~17MB from the Release.
- **The cached video is keyed by `transcodedAt`, not URL alone**
  (`videoCacheKey()`): the nightly transcode reuses one filename, so
  when the lesson changes, this week's and last week's bytes share a
  URL — and the kiosk essentially never witnesses the brief
  pre-transcode CloudFront-URL state whose URL change used to be the
  only thing that flushed the cache. Without the versioned key, a
  cached lesson would survive its own replacement and the kiosk would
  keep playing last week's video (latent from the day this cache
  shipped; would first have bitten at the first real lesson change).
  The transcripts/handout stay keyed by URL — they're per-week files,
  so a week change alone flushes them; only a mid-week caption
  correction can be ~a-week stale on an already-bundled kiosk, which is
  accepted.
- **lessons.json is cache-first**: fetched once at startup (5s timeout,
  good copy stored in `journey-assets-v1`), served from that cache with
  a quiet background revalidate afterward — the old
  `{cache:'no-store'}`-on-every-open is gone. The `captions` manifest
  (see above) is built from whichever copy loads; an old cached copy
  without the field just falls back to probing.
- **What still can't be pre-downloaded: the other 62 picker videos.**
  GitHub Release URLs 302-redirect without CORS headers on the redirect
  hop (verified live; documented below), so a browser fetch() can never
  store their bytes — only same-origin copies would make a "download
  all videos" feature possible, and rehosting is a project-owner call
  (see the licensing boundary above). The picker still streams those.
  **Asked and declined 2026-09-01**: the owner chose "current week is
  enough" over a same-origin mirror + download-all — don't re-raise it
  unless they bring it up.
- If the loading overlay stays up ~12s, its note switches to say the
  internet may be down and points at the ⇄ button (which never waits on
  the network) — a stalled fetch fires no error event, and an endless
  "Loading…" pulse is indistinguishable from progress.
- **The video no longer autoplays at 6:30.** Crossing into the
  scheduled window shows a branded "Large Group Time" splash
  (`#journey-splash`) instead — a "Journey / Advocates" wordmark, the
  "Large Group Time" banner, and this week's lesson prominently named
  (`Week N` + `lessons.json`'s `title`, both filled in from
  `currentLesson` by `showJourneyContent()`). The lesson video itself
  is still queued up in the background exactly as before (see the
  pre-fetch bullet right below) — only the on-screen *playback* waits.
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
- **An interrupted lesson can be resumed.** The scheduled show marks its
  position in `localStorage` (`journey.resume`, `{week, t, d, at}`) about
  every 5 seconds, and the splash then offers **"Resume at M:SS" + "Start
  over"** in place of "Begin Video" (never all three — Begin Video and Start
  over are the same action). Space/→ take whichever primary button is
  showing, so a reflexive tap resumes rather than restarting the room at
  0:00. The offer is deliberately narrow, because resuming into the *wrong*
  video is worse than restarting: the mark must carry the same `week` as the
  queued lesson, be at least 30s in, at least 10s from the end, and less
  than 4 hours old — anything else falls back to plain "Begin Video". The
  mark is written against the week actually attached to the `<video>`
  (`playingWeek`), not `currentLesson.week`, which the hourly refresh can
  swap mid-playback; manual previews never write one (`previewMode`), and
  the `ended` handler and `finishTeachingSlides()` clear it (both skipping
  previews). The seek itself is armed as `pendingSeek` and applied by ONE
  permanent `loadedmetadata` listener that re-checks `journeyRequestToken`,
  so a stale resolve can never seek a newer video. Reading the mark touches
  only `localStorage`, so the splash still renders with nothing awaited.
- On load, and hourly afterward, it fetches `current-lesson.json` and
  — regardless of what's currently on screen — pre-fetches that
  lesson's bundle (video + transcripts + handout, see
  `cacheLessonBundle()` above) into the `journey-videos-v1` cache
  bucket, skipping pieces already there. This runs well ahead of
  6:30 PM, so playback doesn't depend on the network being up at
  showtime (the church's Pi connection is known to be flaky in the
  evenings). A failed fetch of
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
  the Check-in Display immediately rather than waiting for 7:15.
- **Captions** (owner-requested 2026-08-23): every lesson video can show
  its transcript as WebVTT captions. Before playback the operator is
  asked once — **"Show captions?" Yes/No, with Y/N keys** (Space/Enter
  take the focused Yes default) — and the answer is persisted to
  `localStorage` under `journey.captions`. Because the prompt asks
  **once per device and then never again** (the owner's explicit
  choice), the **CC button in the control bar is the only route back to
  the setting** — keep it prominent, and keep it showing on/off state.
  Note the contrast with `audioUnlocked`, which deliberately is *not*
  persisted: a caption choice is a real operator preference with no
  browser-side counterpart, so persisting it is honest rather than a
  lie. Details worth not relearning:
  - `requestPlayback()` is the single gate every playback path goes
    through. It HEAD-probes the VTT first (memoized) and simply skips
    the question when a transcript is missing — week 27 has no Leader
    Video, and a future lesson revision could outpace the transcripts.
  - That gate **must reveal `#journey-view` before showing the prompt**.
    The prompt lives inside that layer, so asking while it's still
    `hidden` renders the question into a `display:none` ancestor: the
    operator picks a video, sees the Check-in Display, and playback
    waits forever on a question nobody can see. Caught by screenshot;
    don't regress it.
  - **Captions are painted by us, not by the browser.** The track runs in
    `mode = 'hidden'` (cues parsed, `cuechange` fires, nothing drawn
    natively) and `renderActiveCues()` writes them into
    `#caption-overlay`. Native `::cue` was tried first and abandoned for
    two measured reasons: its font-size had to be in `vh`, which
    collapses to ~11px on a phone held sideways (844x390), and native cue
    placement follows the *letterboxed* video box, so it drifted between
    form factors and landed captions on top of the control bar. A real
    element takes `clamp()`/`vmin`, and — unlike shadow-DOM cues — can be
    measured by the test suite.
  - Size is `clamp(18px, 4.5vmin, 56px)`: `vmin` tracks whichever screen
    dimension constrains the video frame, so one expression serves a TV
    read across a room (~49px at 1080p) and a phone in either
    orientation (18px floor). Verified at 1920x1080, 390x844, 844x390,
    and 1024x768.
  - `positionCaptions()` satisfies two different constraints at once: on
    a filled 16:9 screen captions only need to clear the control bar; on
    a letterboxed phone they instead sit just inside the video frame's
    lower edge, so they don't float in the black band. It reads the
    bar's live `offsetHeight`, so captions lift automatically when the
    bar wraps to more rows on a narrow screen.
  - **Cue length is a hard caption constraint.** Both caption sets are
    now built from real word timestamps into cues of <=84 chars (see
    "Leader transcripts" below for the 2026-09-06 leader redo). History
    worth keeping: the first Leader transcripts were whisper's own
    sentence segments, up to **202 characters** — fine to read, unusable
    as a caption (a wall of text on a TV, six wrapped lines on a phone) —
    and `scripts/resegment-vtt.py` split them at sentence/clause/word
    boundaries, apportioning duration by character count. That script is
    no longer part of the pipeline; it stays only as a record.
  - **Size and backdrop are per-device settings** (Settings → Captions):
    a size choice (Small 0.8 / Normal 1 / Large 1.3 / Extra large 1.6,
    `journey.captions.size`) and a solid dark backdrop for bright frames
    (`journey.captions.backdrop`), read with the same try/catch shape as
    the slide preferences. The size **multiplies** the existing
    `clamp(18px, 4.5vmin, 56px)` through a `--caption-scale` custom
    property rather than replacing it, so every option keeps the same
    responsive behaviour on every screen — note this scales the clamp's
    floor too, so "Small" really is ~14px on a phone, which is the point of
    choosing it. `applyCaptionDisplayPrefs()` re-runs `positionCaptions()`
    after any change, because the band's height feeds the letterbox and
    control-bar clearance maths. The **CC button remains the only on/off
    control** — these settings only govern how captions look.
  - The control bar itself needed a `max-width: 760px` media query: three
    non-shrinking buttons plus scrubber and time cannot fit one row on a
    phone, and the CC button was being **clipped off the screen edge** —
    captions became impossible to toggle on mobile. Note that media
    query must sit *after* the base control rules in the stylesheet; an
    earlier copy placed before them lost the cascade to
    `#video-scrubber { flex: 1 }` and the scrubber never got its own row.
- **Playback control bar** (`#video-controls`): **Back 15s**, pause/play,
  **Skip 15s**, the unmute button, a finger-sized scrubber, and an
  elapsed/total time readout, along the bottom whenever a video is active.
  The two 15-second jumps (also **`,`** / **`.`**, with **`[`** / **`]`** as
  aliases) exist because dragging a finger-sized scrubber on a projected
  screen to replay one sentence always overshoots; they seek an
  already-attached source, so nothing is fetched and nothing is awaited.
  They clamp to `duration - 0.25` so a skip can never trip the `ended`
  handoff by accident — **→ stays the deliberate way on to the slides, and
  ← is left alone** because it means "previous slide" once those are up.
  Key repeats are ignored: a held key would queue seeks faster than the
  Pi's decoder can serve them. Five pills no longer fit one row alongside a
  usable scrubber below ~1100px, so **the bar's wrap media query is
  `max-width: 1100px`**, not the 760px it was with three — below that the
  scrubber was being squeezed to zero width (`flex: 1` with `min-width: 0`
  shrinks silently rather than overflowing; measured at 844x390). In that
  block the scrubber's basis is `calc(100% - 8rem)` so it and the time
  readout fill the first row exactly and the pills wrap together beneath
  them, rather than two or three tagging along on the scrubber's row. It fades out with the
  same `cursor-hidden` idle mechanism as the mouse cursor (touches
  count as activity too — phones have no mousemove) and is pinned
  visible while paused (`.force-visible`), since a frozen frame with no
  visible controls reads as a crash. Tapping/clicking the video itself
  toggles pause, and Space does too during playback (guarded so it
  never fires while the settings panel is open or a button has focus —
  and Space's original job, starting the splash's queued lesson, takes
  precedence). The bar's right inset reserves room for the view-toggle
  button in the corner.
- **The splash and loading overlays are viewport-responsive**
  (`clamp()` type sizes, wrapping wordmark) — the page is occasionally
  opened on a phone, where the original fixed TV sizes overflowed; the
  Space/→ keyboard hint is hidden on touch-only devices. A
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
- A **loading overlay** (`#journey-loading`) covers the gap between
  asking a video to play and frames actually rendering — shown by
  `playCurrentLesson()`/`startPreview()`, re-shown by the video's
  `waiting` event on mid-play buffering stalls, hidden by `playing` and
  on every teardown/error path. It exists mostly for manual previews,
  which stream Awana's full-size originals and can take long enough to
  start that the screen otherwise reads as dead. Cheap opacity pulse
  only, same animation budget as the splash.
- The **mouse cursor auto-hides after 5s idle** and reappears on any
  mouse movement (`cursor-hidden` class on `<html>`, toggled in
  `schedule.js`). An earlier version set `cursor: none`
  unconditionally, which made the Journey view impossible to navigate
  with a mouse — reported broken from the live kiosk, don't regress it.
  Note the parent page never sees mousemove while the pointer is over
  the Check-in Display iframe (cross-origin) — the embedded app governs
  its own cursor there, and that's fine.
- The **Settings panel is sized as a 10-foot UI** (rows ~1.5rem in a
  ~1100px card) — it renders on a TV read from across a room, not a
  desktop monitor; "too small to read" was likewise reported from the
  live kiosk.
- A screen [Wake Lock](https://developer.mozilla.org/en-US/docs/Web/API/Screen_Wake_Lock_API)
  is requested on load and re-acquired on `visibilitychange`, since
  Raspberry Pi OS's default screen-blanking would otherwise leave the
  kiosk asleep long before 6:30 PM with no local activity to prevent
  it. Not fatal if unsupported — disabling blanking at the OS level
  (see `PI_SETUP.md`) is the belt-and-braces fallback either way.

### Leader transcripts and handouts (owner-requested 2026-08-22)

Derived text content from the Leader Videos, same licensing character
as the re-encoded videos (internal ministry use for this church's own
leaders, never linked/advertised elsewhere; owner requested this
directly):

- **`public/transcripts/week-NN-leader.vtt`** — WebVTT transcript of
  each Leader Video (31 files; week 27 has none to transcribe). First
  generated with faster-whisper "small" (sentence segments); **redone
  2026-09-06 at large-v3** through the same pipeline as the Student
  captions — `transcribe-student-captions.py leader` (word timestamps,
  domain-vocabulary prompt, hallucination-hardened flags), a per-week
  review pass writing `leader-corrections/week-NN.json` (mostly the
  boundary-repeat words that `condition_on_previous_text=False`
  produces, plus capitalisation and a handful of real mishearings), the
  physics validator, an audio re-decode of every flagged cue, then
  `build-student-captions.py leader`. Same-origin, so they work as
  `<track>` captions without CORS issues. Regenerate only if Awana
  revises a video. Measured against the old pass: ~2.5% of words sat in
  a changed hunk; most hunks were filler, but the redo fixed real
  meaning errors ("except Christ" → "accept Christ", "relative to this
  day" → "relativistic", "the fairy" → "the Tooth Fairy", dropped
  clauses like "The doctor told me") and cut cue counts by roughly a
  third because cues now follow speech instead of split sentences.
  **Re-transcribing renumbers every cue**, and `data/leader-transcript-
  prose.json` addresses cues by number — run
  `scripts/remap-transcript-prose-cues.py <dir-of-old-vtts>` before the
  prose validator, which maps each paragraph boundary by time onto the
  new numbering (keep a copy of the old VTTs for exactly this).
  Two names both whisper passes garbled and the review pass now knows:
  the Awana Youth Ministries site is **AwanaYM.org**, and the author of
  *Questioning the Bible* is **Jonathan Morrow**.
- **Captions must be verified against AUDIO, not by reading.** Whisper
  hallucinates, and this bit us: run with
  `condition_on_previous_text=True` (the library default) it repeats and
  invents fluent text that no amount of proofreading can distinguish
  from a real sentence. Week 1 cue 53 read "Apology is not just about
  being an apologist." — a perfectly sensible line that **does not exist
  in the audio at all**; re-decoding that 0.64s window returns only the
  tail of the previous sentence. Two defences, both now permanent:
  - `scripts/validate-captions.py` gates publishing. It flags any cue
    carrying >=25 characters faster than **26 chars/sec** (brisk human
    speech peaks near 20; the worst offender was 106) and any cue that
    largely duplicates its neighbour. `build-student-vtt.py` refuses to
    write a week whose flags are neither corrected nor listed under
    `"verified"` in that week's corrections file. Flags are not proof of
    a hallucination — they are a demand to check that cue against audio.
  - `scripts/../verify-cue.py` (scratch tooling) re-decodes the window
    around a cue independently (beam 10, no conditioning, so it cannot
    inherit the original's invention) and prints it beside the current
    text and neighbours. Note the only ffmpeg on the box is Playwright's
    stripped build, which cannot demux mp4 — decode via
    `faster_whisper.audio.decode_audio` and slice the array instead.
  - Transcription now runs `condition_on_previous_text=False` plus
    `hallucination_silence_threshold=2.0` and `repetition_penalty=1.1`.
    Measured effect: the conditioned pass flagged **1.98%** of cues
    across 13 weeks; the first hardened week flagged **zero**. The cost
    is slightly less cross-window consistency, which is a good trade
    against inventing scripture.
- **`public/handouts/week-NN-leader-handout.pdf`** — an **accessible**
  (tagged) PDF for leaders: page 1 is the summary, and after it come the
  **transcript pages** (owner-requested 2026-09-06) — that week's Leader
  Video edited into readable prose, a timestamp beside each paragraph and
  section headings to skim by. Roughly 2-5 pages of transcript per handout;
  week 27 has no Leader Video, so it has no handout at all.
  - The whole pipeline lives in the repo now, so a handout can actually be
    corrected and regenerated: `data/leader-handout-summaries.json` (page 1)
    and `data/leader-transcript-prose.json` (the edited transcript) are
    hand-editable data; `scripts/render-leader-handouts.mjs` renders, and
    `scripts/finalize-handout-pdf.py` stamps /Lang, the XMP+docinfo title
    and DisplayDocTitle **and verifies** every file is tagged, titled and
    language-marked. Both data files are build inputs, deliberately NOT under
    `public/` — the transcript is already published there as the caption
    `.vtt`, and there is no reason to serve a second copy.
  - The prose is *edited for reading* (the owner's choice over verbatim):
    spoken grammar repaired, filler and false starts removed, every point,
    example and Scripture reference kept. Two rules exist because an error
    that flickers past in a caption is permanent in print: an editor may
    repair a misheard word only when context makes the intended one
    unambiguous, and must **never** guess at a proper noun or a Scripture
    reference (leave the oddity instead). Every week was then re-checked
    against its own VTT by a second pass. When the leader captions were
    redone at large-v3 (2026-09-06) the prose, the page-1 summaries and the
    teaching-slide notes were re-checked against a word-level diff of old
    vs new transcript, week by week: 48 prose edits and one summary key
    point changed, no slide bullet needed to. Two lessons from that pass:
    the newer decode is not automatically right (where its wording was
    itself odd — "green until my shirt is black" — the old reading was
    kept), and drafting agents drift toward restyling; only edits traceable
    to a specific diff hunk were accepted.
  - `scripts/validate-transcript-prose.py` gates it mechanically, because
    proofreading cannot catch these: paragraphs must **tile the cue numbers**
    1..lastCue with no gap (a dropped passage shows up as a gap), the edited
    text must stay above half the spoken word count (below that it was
    summarized, not edited), and **every book of the Bible named in the prose
    must also appear in the transcript** — which is what catches an invented
    or "tidied-up" citation. Run it before rendering.
  - **`@page` carries the margins, not `body` padding.** Body padding only
    insets the first page's top and the last page's bottom, so with the old
    single-page CSS the new transcript pages ran to the paper's edge.
- **The old one-page description, for context** — page 1 is still exactly
  this: a summary of each Leader Video for leaders:
  Big Idea, Key Points, Scripture, Discussion Questions, plus the
  trademark/internal-use footer. Generated from semantic HTML via
  Chromium `page.pdf({ tagged: true })` (real structure tags), then a
  pikepdf pass sets `/Lang`, XMP+docinfo title, and
  `DisplayDocTitle` — verify any regenerated file is still 1 page,
  tagged, titled, and language-marked before committing. Content is
  written from the transcript, not invented — scripture references only
  where the video actually cites them.
- **`public/leader-prep.json` — the same page-1 summary as *text*** (the
  "Read Prep" overlay, `#prep-view`). A PDF in an iframe is right on the TV
  and wrong on a phone, which is where a leader actually preps; this renders
  Big Idea / Key Points / Scripture / Discussion Questions as real DOM, so it
  reflows on any screen and — being one ~58KB same-origin file, loaded
  cache-first out of `journey-assets-v1` and warmed at startup like
  `lessons.json` and `teaching-slides.json` — it opens with the network dead,
  which the streamed PDF cannot do for a non-current week.
  `scripts/build-leader-prep.mjs` GENERATES it (`npm run build-leader-prep`);
  `render-leader-handouts.mjs` calls the same writer, so the served copy
  can't drift from the handouts. `data/leader-handout-summaries.json` remains
  the single hand-edited source and stays a build input — only the summaries
  travel, because those are this church's own writing about each video; the
  transcript prose stays out of `public/` (the spoken transcript is already
  published as the caption `.vtt`). Week 27 has no Leader Video, so it has no
  entry, and the overlay says exactly that rather than showing a blank panel.
- **Picker flow:** lesson → Student/Leader → (Leader only)
  Watch Video / View Handout / Read Prep. The handout opens in a full-screen
  iframe overlay (`#handout-view`, Chromium's built-in PDF viewer) so
  the kiosk never leaves the page; closing it detaches the iframe
  `src` (512MB-Pi memory hygiene). `#prep-view` is the same shape with our
  own DOM (emptied on close for the same reason, and Escape closes it).
  Both count as "a reading overlay is up" via `readerOverlayOpen()`, which
  is what keeps the playback and Settings keyboard shortcuts inert while
  either is covering the screen.

### Teaching slides after the video (owner-requested 2026-09-06)

Every Advocates lesson also ships a 5-slide **Teaching Slides** `.pptx`
on the course page (title, core verse, misconception, illumination, and
a blank **TEMPLATE** — a heading over three empty bullets — for the
leader to fill in). The kiosk shows them after any lesson video ends,
scheduled show or picker preview, before falling back to whatever the
video's ending used to do.

- **Owner-approved licensing extension (2026-09-06):** slides 1-4 of
  every deck are rendered to 1280x960 JPEGs in `public/slides/week-NN/`
  (~15MB for the whole course), plus each deck's template background as
  `template.jpg`. Same character as the re-encoded videos: kiosk-only
  copies, never linked or advertised elsewhere. The owner chose
  "all 32 weeks in the site itself" over nightly-current-week or a
  Release, so the current week's slides pre-download with the bundle and
  the picker can show any week offline-capable.
- `scripts/render-teaching-slides.py` is the reproducible pipeline
  (LibreOffice Impress → PDF → pypdfium2 → JPEG; extracts the template's
  largest referenced image as the background). It refuses a deck that
  isn't exactly 5 slides — all 32 were on 2026-09-06. Weeks 3 and 4
  really do have a doubled `.pptx.pptx` extension on Awana's side.
- `public/teaching-slides.json` — `{ version, sourceUrl, headings,
  weeks: { "N": { title, deckUrl, slides, notes } } }`. `notes` is the
  generated fill for the TEMPLATE slide, three kinds × three bullets:
  `questions` ("Talk About It" — discussion questions addressed to the
  students), `takeaways` ("Remember This"), `challenges` ("This Week").
  Written from each week's **Leader Video transcript** (week 27, which
  has no Leader Video, from the Student transcript), every bullet grounded
  in what the video says, ≤80 characters, then adversarially re-checked
  against the transcript by a second pass. Hand-edit the JSON to correct
  wording; the kiosk renders these as HTML text over `template.jpg`
  (`#slide-template` in style.css mirrors the deck: centered heading,
  three left-aligned bullets, white on the texture) so they stay crisp
  and editable — the only slide we *fill in*, never an image we copy.
- **A leader can rewrite tonight's three bullets on the kiosk itself**
  (Settings → "Edit tonight's bullets"): nine textareas, prefilled from
  `teaching-slides.json`, stored per device under
  `journey.slides.notesOverride` as `{ "<week>": { questions|takeaways|
  challenges: […] } }` and preferred by `slideNotesFor()`, which
  `buildSlideItems()` now reads instead of `notes` directly. Rules that
  matter: `public/teaching-slides.json` is never written — it stays the
  canonical hand-edited source, and only the kinds that actually **differ**
  from it are stored, so a later JSON correction still reaches every kind the
  leader left alone. Clearing all three lines of a kind falls back to the
  written bullets (the tick boxes are how you drop a slide). Bullets are
  capped at 80 characters and 3 per kind, on the way in *and* on the way out
  of storage. Only the currently-resolved week is editable, and the editor
  names it, because "tonight's" has to be unambiguous about what Reset
  undoes. Nothing marks an override **on the slide** (the wall must look the
  same either way), so Settings carries an "Edited on this device" badge
  — visible without opening the disclosure — plus a Reset; and a write
  that *fails* (kiosk storage blocked) says so rather than claiming "Saved",
  because the slideshow reads the override back out of storage, so an edit
  that could not be stored did not take. The Space/→ "begin the lesson"
  shortcut now also requires the Settings panel closed and no text field
  focused: with real textareas on the page, a space between two words must
  stay a space.
- **Four ways in, never just `ended`** (`endOfLessonHandoff()`): the
  video's own `ended` event, the near-end stall watchdog, a manual → , and
  a fatal video error all funnel through one handoff. Hanging the slides off
  `ended` alone stranded a leader mid-club on 2026-09-06: the lesson wedged
  on its last chunk over church WiFi, `ended` never fired, and the room sat
  on a frozen final frame under "Loading video…" with no way to reach the
  slides. So: a stall that is still stuck after `LOADING_STALL_MS` **and**
  within `END_STALL_TOLERANCE_S` of the end is treated as finished; **→**
  hands over from a video that is playing, paused or wedged (Space stays
  "pause", so a reflexive tap can't skip a lesson); and a video that errors
  outright shows the slides rather than the dead placeholder. Test the
  triggers, not just `startTeachingSlides()` — the original suite called
  that function directly, which is exactly why this shipped broken.
- **Playback** (`startTeachingSlides()` in schedule.js): the video is
  released (same memory hygiene as `stopJourneyContent()`), the deck's
  slides show in a 4:3 stage (pillarboxed on the TV), then whichever
  generated slides Settings has ticked. Leader-driven: Space / → / Enter
  next, ← back, tap the slide (left third = back), or the Prev/Next bar
  (fades with the idle cursor like the video bar). "Finish" on the last
  slide runs the old end-of-video behavior (Check-in Display for the
  scheduled show, `endPreview()` for a preview). `stopJourneyContent()`
  tears it down, so the ⇄ button and the 7:15 boundary work unchanged;
  `showJourneyContent()` treats a running slideshow like a playing video
  (no splash over it). A preview remembers its week (`previewWeek`) so a
  Leader/Student preview shows *that* lesson's slides.
- **Settings → "After the video: teaching slides"**: auto-advance
  interval (off = manual, 15s–2min; any manual step resets the timer) and
  three checkboxes for which generated slides to append. Persisted per
  device in localStorage (`journey.slides.autoAdvanceSec`,
  `journey.slides.extras`), like the caption choice. The splash hint now
  reads "Space / → · S for settings" — **S** opens Settings from anywhere
  (not while typing in a field), Escape closes it.
- The current week's slide images + template are part of the prefetched
  bundle (`cacheLessonBundle()`), and `teaching-slides.json` is
  cache-first in `journey-assets-v1` like `lessons.json`, so the whole
  post-video show works with the network dead. A slide image that fails
  to load skips ahead (bounded) rather than sitting on black.

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
- **Plays the pre-transcoded 480p Release asset**
  (`transcodedPreviewUrl()` in `schedule.js` →
  `releases/download/transcoded-videos-v1/week-NN-{student,leader}.mp4`),
  falling back to the original URL once if that asset errors. An
  earlier version played the originals directly as an "accepted
  trade-off" — but the Pi Zero can't decode 1080p at a watchable frame
  rate at all, so every non-current week was effectively unplayable
  (reported broken from the live kiosk; the owner then approved the
  batch-transcode extension above). Still bypasses the Cache API — an
  occasional manual action doesn't need the nightly lesson's
  pre-caching machinery, it just needs a decodable file.
- **Picking a lesson always asks Leader or Student Video first.** An
  earlier version skipped the question inside the 6:30-7:15 window
  (playing the Student Video directly, like the scheduled show) as a
  deliberate distinction — but in practice the two behaviors read as
  the picker being flaky, not as a rule ("it's not asking me
  consistently" — reported from the live kiosk 2026-08-22), so the
  choice is now unconditional. Lessons with no Leader Video
  (`leaderDownloadUrl: null` — currently only week 27) disable that
  choice rather than offering a dead link.
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
