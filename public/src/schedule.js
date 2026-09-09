// Daily schedule: full-screen the Awana Check-in Display all day, except
// between JOURNEY_START and JOURNEY_END, when the Journey lesson video
// shows. See CLAUDE.md for the conventions around changing these
// constants, and for how the video content itself gets here.
const JOURNEY_START_MINUTES = 18 * 60 + 30; // 6:30 PM
const JOURNEY_END_MINUTES = 19 * 60 + 15; // 7:15 PM
const POLL_INTERVAL_MS = 15000;
const LESSON_REFRESH_MS = 60 * 60 * 1000; // current-lesson.json only changes nightly
const VIDEO_CACHE_NAME = 'journey-videos-v1';
// Small same-origin documents (lessons.json) that make the UI answerable
// offline — kept separate from the video bucket, whose eviction logic
// deliberately clears everything but the current week's bundle.
const ASSET_CACHE_NAME = 'journey-assets-v1';

// fetch() has no timeout of its own: on the kiosk's flaky connection a hung
// request can sit unresolved for minutes, which is how "you click buttons and
// it doesn't respond" happened. Anything the UI is (indirectly) waiting on
// goes through this instead. AbortController is feature-checked because this
// runs on an oldish kiosk Chromium.
function fetchWithTimeout(url, options, timeoutMs) {
  if (typeof AbortController === 'undefined') return fetch(url, options);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { ...options, signal: controller.signal }).finally(() =>
    clearTimeout(timer)
  );
}

const checkinView = document.getElementById('checkin-view');
const journeyView = document.getElementById('journey-view');
const journeyPlaceholder = document.getElementById('journey-placeholder');
const journeySplash = document.getElementById('journey-splash');
const journeySplashWeek = document.getElementById('journey-splash-week');
const journeySplashTitle = document.getElementById('journey-splash-title');
const journeySplashPlayBtn = document.getElementById('journey-splash-play-btn');
const journeySplashResumeBtn = document.getElementById('journey-splash-resume-btn');
const journeySplashResumeLabel = document.getElementById('journey-splash-resume-label');
const journeySplashStartOverBtn = document.getElementById('journey-splash-startover-btn');
const journeyVideo = document.getElementById('journey-video');
const journeyLoading = document.getElementById('journey-loading');
const journeyLoadingNote = document.getElementById('journey-loading-note');
const videoControls = document.getElementById('video-controls');
const pauseBtn = document.getElementById('pause-btn');
const unmuteBtn = document.getElementById('unmute-btn');
const videoScrubber = document.getElementById('video-scrubber');
const videoTime = document.getElementById('video-time');
const toggleBtn = document.getElementById('toggle-btn');
const settingsBtn = document.getElementById('settings-btn');
const settingsPanel = document.getElementById('settings-panel');
const settingsBackdrop = document.getElementById('settings-backdrop');
const settingsCloseBtn = document.getElementById('settings-close-btn');
const settingsLessonList = document.getElementById('settings-lesson-list');
const settingsVariantPicker = document.getElementById('settings-variant-picker');
const settingsVariantPrompt = document.getElementById('settings-variant-prompt');
const settingsVariantStudentBtn = document.getElementById('settings-variant-student');
const settingsVariantLeaderBtn = document.getElementById('settings-variant-leader');
const settingsVariantBackBtn = document.getElementById('settings-variant-back');
const settingsLeaderPicker = document.getElementById('settings-leader-picker');
const settingsLeaderPrompt = document.getElementById('settings-leader-prompt');
const settingsLeaderVideoBtn = document.getElementById('settings-leader-video');
const settingsLeaderHandoutBtn = document.getElementById('settings-leader-handout');
const settingsLeaderBackBtn = document.getElementById('settings-leader-back');
const handoutView = document.getElementById('handout-view');
const handoutTitle = document.getElementById('handout-title');
const handoutCloseBtn = document.getElementById('handout-close-btn');
const handoutFrame = document.getElementById('handout-frame');
const ccBtn = document.getElementById('cc-btn');
const captionPrompt = document.getElementById('caption-prompt');
const captionYesBtn = document.getElementById('caption-yes');
const captionNoBtn = document.getElementById('caption-no');
const captionOverlay = document.getElementById('caption-overlay');
const captionText = document.getElementById('caption-text');
const slidesView = document.getElementById('slides-view');
const slideStage = document.getElementById('slide-stage');
const slideImage = document.getElementById('slide-image');
const slideTemplate = document.getElementById('slide-template');
const slideTemplateHeading = document.getElementById('slide-template-heading');
const slideTemplateBullets = document.getElementById('slide-template-bullets');
const slidePrevBtn = document.getElementById('slide-prev-btn');
const slideNextBtn = document.getElementById('slide-next-btn');
const slideCounter = document.getElementById('slide-counter');
const slidesAutoAdvanceSelect = document.getElementById('slides-auto-advance');
const slidesExtraInputs = {
  questions: document.getElementById('slides-extra-questions'),
  takeaways: document.getElementById('slides-extra-takeaways'),
  challenges: document.getElementById('slides-extra-challenges'),
};

let currentLesson = null;
let currentObjectUrl = null;
// Teaching-slides state (see the "Teaching slides" section near the end).
// Declared up here because stopJourneyContent() — reached from the startup
// setView() call below — tears the slideshow down, and a `let` further down
// the file would still be in its temporal dead zone at that moment.
let teachingSlides = null; // parsed teaching-slides.json, once loaded
let slideshow = null; // { week, items, index, onFinish, blobUrls: Map, errors }
let slideAutoTimer = null;
// Bumped on every showJourneyContent()/playCurrentLesson()/startPreview()
// call so a slow, in-flight call (e.g. still awaiting a cache read) can
// detect it's stale once it resolves and avoid clobbering state a newer
// call already set.
let journeyRequestToken = 0;
// Browsers only allow *unmuted* autoplay after a genuine user gesture has
// occurred on the page. This page's clickable elements are its corner
// buttons (a click inside the Check-in Display iframe is a different
// origin and never bubbles up to this document), so a click on any of
// them counts as "the kiosk has been touched" and unlocks unmuted autoplay
// for every subsequent lesson — no separate unmute tap needed after that
// first click. This flag deliberately lives only in memory, not
// localStorage: the browser's own gesture-based permission is itself
// scoped to this page's lifetime (it doesn't survive a reload/reboot
// either), so persisting a "still unlocked" flag past that point would
// just be wrong.
let audioUnlocked = false;

/* ── Idle cursor / idle controls ──────────────────────────────────────
   The cursor starts hidden (kiosk mode: nothing should look "parked" on
   the projected video) but reappears on any mouse movement or touch and
   hides again after a few idle seconds — an operator has to be able to
   see the pointer to use the corner buttons and the settings panel at
   all. The same cursor-hidden class also fades the playback control bar
   (see #video-controls in style.css), which is why touches count as
   activity too: phones/tablets have no mousemove. This only governs this
   document; the Check-in Display iframe is a different origin and
   manages its own cursor. */
const CURSOR_IDLE_MS = 5000;
let cursorIdleTimer = null;
document.documentElement.classList.add('cursor-hidden');
function markActivity() {
  document.documentElement.classList.remove('cursor-hidden');
  clearTimeout(cursorIdleTimer);
  cursorIdleTimer = setTimeout(() => {
    document.documentElement.classList.add('cursor-hidden');
  }, CURSOR_IDLE_MS);
}
document.addEventListener('mousemove', markActivity);
document.addEventListener('touchstart', markActivity, { passive: true });

function scheduledPhase() {
  const now = new Date();
  const minutes = now.getHours() * 60 + now.getMinutes();
  return minutes >= JOURNEY_START_MINUTES && minutes < JOURNEY_END_MINUTES
    ? 'journey'
    : 'checkin';
}

/* ── Lesson video: fetched once while online, played from the Cache
      API afterward so a flaky evening connection can't interrupt
      playback. See CLAUDE.md for the nightly feed that produces
      current-lesson.json (including why its downloadUrl is a CORS-enabled
      CDN URL rather than the awana.org one lessons.json itself
      lists). ────────────────────────────────────────────────────────── */

async function loadCurrentLesson() {
  try {
    const res = await fetch('current-lesson.json', { cache: 'no-store' });
    if (!res.ok) return null;
    const data = await res.json();
    if (!data || typeof data.week !== 'number' || typeof data.downloadUrl !== 'string') {
      return null;
    }
    return data;
  } catch {
    return null;
  }
}

function sameLesson(a, b) {
  return !!a && !!b && a.week === b.week && a.downloadUrl === b.downloadUrl;
}

/* The nightly transcode reuses ONE filename (current-lesson-video.mp4), so
   when the lesson changes, this week's bytes and last week's live at the same
   URL — and a kiosk refreshing hourly essentially never witnesses the brief
   pre-transcode state (downloadUrl = the per-week CloudFront original) whose
   URL change used to be what flushed the cache. Keying the cached video by
   transcodedAt (which uniquely identifies each transcode run) instead of by
   URL alone is what keeps a cached lesson from surviving its own replacement.
   The fetch itself still goes to the real URL — only the cache key carries
   the version. */
function videoCacheKey(lesson) {
  if (!lesson.transcodedAt) return lesson.downloadUrl;
  const sep = lesson.downloadUrl.includes('?') ? '&' : '?';
  return `${lesson.downloadUrl}${sep}v=${encodeURIComponent(lesson.transcodedAt)}`;
}

/* Pre-download everything the current week's show and picker can need — the
   video, BOTH transcripts, and the leader handout — not just the video, so a
   dead connection at 6:30 PM (or during a same-week preview) costs nothing.
   Missing files (week 27 has no leader transcript/handout) 404 and are simply
   skipped. Eviction of the previous week's bundle only happens once every
   piece of the new one is safely stored — a mid-download failure can never
   leave the cache emptier than it started (the invariant the old
   cacheLessonVideo() kept for the video alone, extended to the bundle). */
let bundleInFlight = false;
async function cacheLessonBundle(lesson) {
  if (!('caches' in window)) return;
  // Startup, the hourly timer, and the 'online' listener can all fire close
  // together — without this, each would re-download the same multi-MB video
  // in parallel on a single-core Pi. Whatever a skipped call would have
  // stored, the next refresh's call picks up (skip-if-cached is per item).
  if (bundleInFlight) return;
  bundleInFlight = true;
  try {
    const cache = await caches.open(VIDEO_CACHE_NAME);
    const candidates = [
      { fetchUrl: lesson.downloadUrl, cacheKey: videoCacheKey(lesson) },
      { fetchUrl: captionUrlFor(lesson.week, 'student') },
      { fetchUrl: captionUrlFor(lesson.week, 'leader') },
      { fetchUrl: handoutUrl(lesson.week) },
      // The teaching slides shown after the video (see startTeachingSlides).
      ...Array.from({ length: deckSlideCount(lesson.week) }, (_, i) => ({
        fetchUrl: slideImageUrl(lesson.week, i + 1),
      })),
      { fetchUrl: slideTemplateUrl(lesson.week) },
    ];
    for (const c of candidates) c.cacheKey = c.cacheKey || c.fetchUrl;
    const bundleUrls = new Set(candidates.map((c) => new URL(c.cacheKey, location.href).href));
    let allStored = true;
    for (const { fetchUrl, cacheKey } of candidates) {
      try {
        if (await cache.match(cacheKey)) continue; // already stored
        const response = await fetch(fetchUrl);
        if (response.status === 404) continue; // legitimately doesn't exist — skip, not a failure
        if (!response.ok) {
          allStored = false;
          continue;
        }
        await cache.put(cacheKey, response);
      } catch (err) {
        // Offline, or the host unreachable right now — keep whatever's
        // already cached and try again on the next refresh. Logged (not just
        // swallowed) so a permanently-failing cache attempt is discoverable
        // in devtools rather than invisible until the network is down at
        // showtime.
        allStored = false;
        console.warn('Journey: could not cache', fetchUrl, '—', err);
      }
    }
    if (!allStored) return;
    const keys = await cache.keys();
    await Promise.all(
      keys.filter((req) => !bundleUrls.has(req.url)).map((req) => cache.delete(req))
    );
  } catch (err) {
    console.warn('Journey: could not cache lesson bundle —', err);
  } finally {
    bundleInFlight = false;
  }
}

/* Resolves what the <video> element should play: the cached copy as a blob
   URL when available, the live URL otherwise. `token` is the caller's
   journeyRequestToken snapshot — if a teardown or newer request has bumped
   the token while the (slow, ~17MB) cache read was in flight, this returns
   null WITHOUT committing anything, so a stale resolve can neither clobber
   currentObjectUrl nor strand a multi-megabyte blob URL that nothing will
   ever revoke (on a 512MB Pi that leak would sit resident until the next
   show). Callers must bail on null. */
async function resolveVideoSrc(lesson, token) {
  if ('caches' in window) {
    try {
      const cache = await caches.open(VIDEO_CACHE_NAME);
      // Migration fallback: kiosks that cached this week's video before the
      // key was versioned hold it under the bare downloadUrl. That copy can
      // only be a same-URL fetch — at worst exactly the staleness the old
      // code always had — so it's strictly better than falling through to
      // the network on a dead evening connection. The bundle prefetch stores
      // under the versioned key and then evicts the legacy entry, so this
      // heals itself after one online refresh.
      const cached =
        (await cache.match(videoCacheKey(lesson))) || (await cache.match(lesson.downloadUrl));
      if (cached) {
        const blob = await cached.blob();
        if (token !== undefined && token !== journeyRequestToken) return null;
        const blobUrl = URL.createObjectURL(blob);
        // Only revoke the previous object URL once its replacement is in
        // hand — never before — so a slower, still-in-flight resolve can
        // never be left pointing at an already-revoked URL.
        if (currentObjectUrl) URL.revokeObjectURL(currentObjectUrl);
        currentObjectUrl = blobUrl;
        return blobUrl;
      }
    } catch {
      // fall through to the live URL
    }
  }
  if (token !== undefined && token !== journeyRequestToken) return null;
  return lesson.downloadUrl;
}

/* ── Resume an interrupted lesson ─────────────────────────────────────
   A Pi brownout, an accidental hard refresh, or a stray press of the ⇄
   button used to cost the room the whole lesson so far: playCurrentLesson()
   always attaches a fresh src and never seeks, and stopJourneyContent()
   detaches it, so every restart began again at 0:00. The scheduled show now
   marks its position in localStorage every few seconds, and the splash
   offers to pick it back up.

   Deliberately narrow, because resuming into the WRONG video would be worse
   than restarting: the stored week must match the lesson actually queued
   (a lesson change makes the mark meaningless, never "close enough"), the
   position has to be far enough in to be worth keeping and far enough from
   the end to be worth watching, and the mark has to be recent. Manual
   previews never record one (previewMode), so a previewed week can never be
   offered as the scheduled show's resume point.

   Reading it costs no network — it is pure localStorage, so the splash
   still renders synchronously (acknowledge first, network later). Every
   access is wrapped, like storeCaptionPref(): Chromium in kiosk/private
   modes can throw on localStorage rather than returning null. */
const RESUME_KEY = 'journey.resume';
const RESUME_WRITE_INTERVAL_MS = 5000; // one small write per 5s of playback
const RESUME_MIN_SECONDS = 30; // below this, starting over costs nothing
const RESUME_END_MARGIN_S = 10; // this close to the end, the lesson is over
const RESUME_MAX_AGE_MS = 4 * 60 * 60 * 1000; // last night's mark is not this evening's

let lastResumeWriteMs = 0;
// The position the splash is currently offering (0 = not offering one), read
// by the Resume button and by Space/→.
let offeredResumeAt = 0;
// The week of the lesson actually attached to the <video> right now, set by
// playCurrentLesson() and cleared on every teardown. The mark is written
// against THIS, not against currentLesson.week — the hourly refresh can
// legitimately swap currentLesson while the old video is still playing, and a
// mark carrying the new week with the old video's position would resume the
// wrong lesson at an arbitrary point.
let playingWeek = null;

function clearResumePoint() {
  lastResumeWriteMs = 0;
  try {
    localStorage.removeItem(RESUME_KEY);
  } catch {
    // Nothing to do — a mark that can't be cleared also can't have been written.
  }
}

// Bound to the video's 'timeupdate' below (which fires ~4x/second), so this
// throttles itself rather than writing on every tick.
function recordResumePoint() {
  if (previewMode || playingWeek === null) return;
  if (journeyVideo.classList.contains('hidden')) return;
  const t = journeyVideo.currentTime;
  const d = journeyVideo.duration;
  if (!Number.isFinite(t) || t < RESUME_MIN_SECONDS) return;
  if (Number.isFinite(d) && d > 0 && d - t <= RESUME_END_MARGIN_S) return;
  const now = Date.now();
  if (now - lastResumeWriteMs < RESUME_WRITE_INTERVAL_MS) return;
  lastResumeWriteMs = now;
  try {
    localStorage.setItem(
      RESUME_KEY,
      JSON.stringify({
        week: playingWeek,
        t: Math.floor(t),
        d: Number.isFinite(d) && d > 0 ? Math.floor(d) : 0,
        at: now,
      })
    );
  } catch {
    // Storage blocked/full — the lesson simply won't be resumable. Fine.
  }
}

function storedResumePoint() {
  try {
    const raw = localStorage.getItem(RESUME_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw);
    if (!p || typeof p !== 'object') return null;
    if (typeof p.week !== 'number' || typeof p.t !== 'number' || typeof p.at !== 'number') {
      return null;
    }
    if (!Number.isFinite(p.t) || !Number.isFinite(p.at)) return null;
    return p;
  } catch {
    return null;
  }
}

// The mark, but only if it still describes THIS lesson and is still worth
// offering. Returns the seconds to resume at, or 0 for "just begin".
function resumeSecondsFor(lesson) {
  const p = storedResumePoint();
  if (!lesson || !p) return 0;
  if (p.week !== lesson.week) return 0;
  if (p.t < RESUME_MIN_SECONDS) return 0;
  if (Date.now() - p.at > RESUME_MAX_AGE_MS) return 0;
  if (typeof p.d === 'number' && Number.isFinite(p.d) && p.d > 0 && p.d - p.t <= RESUME_END_MARGIN_S) {
    return 0;
  }
  return p.t;
}

/* The splash shows EITHER "Begin Video" (nothing to resume) or the pair
   "Resume at M:SS" + "Start over" — never all three, because "Begin Video"
   and "Start over" are the same action and a third button on a screen read
   from across a room is just one more thing to get wrong. */
function offerResume(lesson) {
  offeredResumeAt = resumeSecondsFor(lesson);
  const offering = offeredResumeAt > 0;
  if (offering) journeySplashResumeLabel.textContent = `Resume at ${formatTime(offeredResumeAt)}`;
  journeySplashResumeBtn.classList.toggle('hidden', !offering);
  journeySplashStartOverBtn.classList.toggle('hidden', !offering);
  journeySplashPlayBtn.classList.toggle('hidden', offering);
}

/* currentTime can only be set once the media's duration is known, so the
   resume seek waits for this src's own 'loadedmetadata'. One permanent
   listener (rather than one added per play) so nothing accumulates, and the
   journeyRequestToken snapshot means a mark from a request that has since
   been superseded can never seek a newer video. */
let pendingSeek = null;
journeyVideo.addEventListener('loadedmetadata', () => {
  const seek = pendingSeek;
  pendingSeek = null;
  if (!seek || seek.token !== journeyRequestToken) return;
  const d = journeyVideo.duration;
  let t = seek.t;
  if (Number.isFinite(d) && d > 0) t = Math.min(t, Math.max(0, d - 1));
  if (!(t > 0)) return;
  try {
    journeyVideo.currentTime = t;
  } catch {
    // Some sources refuse a seek before they are seekable — play from the
    // top rather than not at all.
  }
  syncScrubber();
});

// Entering the journey window no longer autoplays anything: it shows a
// branded "Large Group Time" splash naming this week's lesson, and waits
// for the operator to actually start the video (Space / → / the on-screen
// button — see playCurrentLesson() and the keydown listener below). The
// video itself is still pre-fetched into the Cache API well ahead of time
// by refreshLesson()/cacheLessonBundle() regardless of what's on screen, so
// it's already "queued" and ready the moment playback is requested.
async function showJourneyContent() {
  ++journeyRequestToken; // invalidate any in-flight playCurrentLesson() call
  if (!currentLesson) {
    // No lesson resolved yet (or the nightly feed came back empty) —
    // show the plain placeholder rather than a broken video.
    journeyVideo.pause();
    journeyVideo.removeAttribute('src');
    journeyVideo.classList.add('hidden');
    hideVideoLoading();
    videoControls.classList.add('hidden');
    journeySplash.classList.add('hidden');
    journeyPlaceholder.classList.remove('hidden');
    offerResume(null);
    return;
  }
  // Don't rip control away from a playback that's already started (or
  // in-flight) — e.g. the hourly lesson refresh firing while the video is
  // already playing mid-window.
  if (!journeyVideo.classList.contains('hidden') || slideshowActive()) return;
  journeyPlaceholder.classList.add('hidden');
  // The splash owns the screen now — a loading overlay left up by an
  // in-flight playback request this call just invalidated would otherwise
  // sit on top of it (and its stall note would fire over it 12s later).
  hideVideoLoading();
  journeySplashWeek.textContent = `Week ${currentLesson.week}`;
  journeySplashTitle.textContent = currentLesson.title;
  // Decided from localStorage alone — no fetch stands between the splash
  // appearing and the operator seeing which buttons it offers.
  offerResume(currentLesson);
  journeySplash.classList.remove('hidden');
}

// Actually starts the queued lesson playing — called only from a genuine
// user action (keypress or the on-screen button), which is also what makes
// unmuted autoplay reliable (see audioUnlocked below).
async function playCurrentLesson(resumeAt = 0) {
  const token = ++journeyRequestToken;
  if (!currentLesson) return;
  stopTeachingSlides();
  journeySplash.classList.add('hidden');
  journeyVideo.classList.remove('hidden');
  videoControls.classList.remove('hidden');
  showVideoLoading();
  journeyVideo.loop = false; // plays once; falls back to Check-in Display on 'ended' below
  setMuted(!audioUnlocked);
  const src = await resolveVideoSrc(currentLesson, token);
  if (!src || token !== journeyRequestToken) return; // a newer call has since taken over
  journeyVideo.src = src;
  // The seek is armed only after the token check above, so a stale resolve
  // can never drop a resume position onto a newer video.
  playingWeek = currentLesson.week;
  pendingSeek = resumeAt > 0 ? { token, t: resumeAt } : null;
  // Starting from the top invalidates the old mark immediately, so a restart
  // that is then interrupted in its first 30 seconds (before the first write)
  // can't be offered last time's position.
  if (!(resumeAt > 0)) clearResumePoint();
  applyCaptions();
  journeyVideo.play().catch(() => {
    // Autoplay-with-sound can still be rejected in edge cases (e.g. the
    // browser's engagement heuristics disagree with our own tracking) —
    // fall back to muted so playback isn't left stuck on a paused frame.
    if (!journeyVideo.muted) {
      setMuted(true);
      journeyVideo.play().catch(() => {});
    }
  });
}

/* ── Captions ─────────────────────────────────────────────────────────
   Every lesson video has a same-origin WebVTT transcript in
   public/transcripts/ (see CLAUDE.md). Before playback starts, the operator
   is asked once — Yes/No, with Y/N keys — and that answer is REMEMBERED for
   this device, so the question never interrupts a service again. Because the
   prompt doesn't come back, the CC button in the playback control bar is the
   deliberate way back to the setting; keep it visible and obvious.

   Unlike `audioUnlocked` (which deliberately isn't persisted, because the
   browser's own gesture permission dies with the page), a caption choice IS a
   genuine operator preference with no browser-side counterpart, so persisting
   it across reloads/reboots is correct rather than a lie. */
const CAPTION_PREF_KEY = 'journey.captions';

// Every localStorage access is wrapped: Chromium in kiosk/private modes, or
// with site data blocked, throws on access rather than returning null.
function storedCaptionPref() {
  try {
    const v = localStorage.getItem(CAPTION_PREF_KEY);
    return v === 'on' ? true : v === 'off' ? false : null;
  } catch {
    return null;
  }
}

function storeCaptionPref(on) {
  try {
    localStorage.setItem(CAPTION_PREF_KEY, on ? 'on' : 'off');
  } catch {
    // Preference just won't survive a reload — the prompt asks again. Fine.
  }
}

let captionsEnabled = storedCaptionPref() ?? false;
// The VTT for whatever is on screen right now, or null when the current video
// has no transcript (nothing to show, so the CC button stays hidden).
let activeCaptionUrl = null;
let pendingPlay = null;
const captionProbeCache = new Map();
// URL -> bool, built from lessons.json's `captions` field once it loads.
// Null until then; captionsAvailable() falls back to cache/probe checks.
let captionManifest = null;

function buildCaptionManifest(lessons) {
  const map = new Map();
  let sawAny = false;
  for (const lesson of lessons) {
    if (!lesson || typeof lesson.week !== 'number' || !lesson.captions) continue;
    sawAny = true;
    map.set(captionUrlFor(lesson.week, 'student'), !!lesson.captions.student);
    map.set(captionUrlFor(lesson.week, 'leader'), !!lesson.captions.leader);
  }
  // An old cached lessons.json from before the manifest existed carries no
  // captions fields — keep falling back to probes rather than treating
  // "unknown" as "none".
  if (sawAny) captionManifest = map;
}

function captionUrlFor(week, variant) {
  return `transcripts/week-${String(week).padStart(2, '0')}-${variant}.vtt`;
}

/* A transcript may legitimately be missing (week 27 has no Leader Video at
   all, and a future lesson revision could outpace the transcripts), so
   playback needs to know before offering captions rather than attaching a
   track that 404s and silently does nothing. Which transcripts exist is
   answered in this order, cheapest first:
   1. lessons.json's shipped `captions` manifest (kept in sync by
      scripts/update-captions-manifest.mjs) — no network at all. This is the
      normal path; the rest is fallback for when lessons.json never loaded.
   2. An already-cached copy of the VTT (the current week's are prefetched).
   3. A HEAD probe with a short timeout — the original mechanism, now bounded.
      An earlier version awaited this probe unbounded and BEFORE any visual
      feedback, which on flaky WiFi made Begin Video/the picker look dead.
   Only positive answers are memoized: a probe that failed because the network
   was down must not disable captions until the next reload on a 24/7 kiosk. */
async function captionsAvailable(url) {
  if (!url) return false;
  if (captionProbeCache.get(url)) return true;
  if (captionManifest && captionManifest.has(url)) {
    const ok = captionManifest.get(url);
    if (ok) captionProbeCache.set(url, true);
    return ok;
  }
  if ('caches' in window) {
    try {
      if (await caches.match(url)) {
        captionProbeCache.set(url, true);
        return true;
      }
    } catch {
      // fall through to the probe
    }
  }
  try {
    const res = await fetchWithTimeout(url, { method: 'HEAD' }, 2500);
    if (res.ok) {
      captionProbeCache.set(url, true);
      return true;
    }
  } catch {
    // Unreachable right now — treat as "no captions" for this playback only.
  }
  return false;
}

/* Serve a prefetched transcript from the cache as a blob URL, so turning
   captions on never depends on the network at play time. Returns null on a
   cache miss (the caller falls back to the plain URL, which the <track>
   element fetches). Deliberately PURE — it touches no shared state, so a
   stale caller can simply discard (revoke) the result; requestPlayback()
   commits the blob URL to captionObjectUrl only after confirming it is still
   the current request. VTTs are ~10-20KB, so none of this holds meaningful
   memory on the Pi. */
let captionObjectUrl = null;
async function cachedCaptionBlobUrl(url) {
  if (!('caches' in window)) return null;
  try {
    const hit = await caches.match(url);
    if (!hit) return null;
    return URL.createObjectURL(await hit.blob());
  } catch {
    return null;
  }
}

function removeCaptionTracks() {
  if (activeTextTrack) {
    activeTextTrack.removeEventListener('cuechange', renderActiveCues);
    activeTextTrack = null;
  }
  clearCaptionText();
  for (const track of Array.from(journeyVideo.querySelectorAll('track'))) {
    track.remove();
  }
  // Detaching the element doesn't always drop the TextTrack from
  // video.textTracks in Chromium, so explicitly stop any that linger.
  for (const tt of Array.from(journeyVideo.textTracks || [])) {
    tt.mode = 'disabled';
  }
}

/* Captions are painted by us, not by the browser (see #caption-overlay in
   style.css for why). The track therefore runs in 'hidden' mode: cues are
   still parsed and 'cuechange' still fires, but nothing is drawn natively. */
let activeTextTrack = null;

function clearCaptionText() {
  captionText.textContent = '';
  captionOverlay.classList.add('hidden');
}

function renderActiveCues() {
  if (!activeTextTrack || !captionsEnabled) {
    clearCaptionText();
    return;
  }
  const cues = Array.from(activeTextTrack.activeCues || []);
  captionText.textContent = '';
  for (const cue of cues) {
    if (captionText.childNodes.length) captionText.appendChild(document.createElement('br'));
    // getCueAsHTML() rather than .text: it returns a parsed, sanitized
    // fragment, so any WebVTT markup renders as markup instead of literal
    // angle brackets.
    captionText.appendChild(cue.getCueAsHTML());
  }
  captionOverlay.classList.toggle('hidden', captionText.childNodes.length === 0);
}

/* Vertical placement has to satisfy two different screens at once:
   - On a 16:9 TV the video fills the element, so captions just need to clear
     the playback control bar.
   - On a phone (especially portrait) the video is letterboxed into a band in
     the middle, and captions pinned near the element's bottom would float in
     the black area, disconnected from the picture. So they instead sit just
     inside the video frame's lower edge, the way subtitles normally do.
   Whichever of those two constraints is lower wins. */
function positionCaptions() {
  let bottom = 96;
  const barStyle = getComputedStyle(videoControls);
  const barBottom = parseFloat(barStyle.bottom) || 0;
  const barClearance = videoControls.offsetHeight + barBottom + 12;
  bottom = barClearance;
  const vw = journeyVideo.videoWidth;
  const vh = journeyVideo.videoHeight;
  const ew = journeyVideo.clientWidth;
  const eh = journeyVideo.clientHeight;
  if (vw && vh && ew && eh) {
    // object-fit: contain -> the frame is scaled by the tighter axis.
    const scale = Math.min(ew / vw, eh / vh);
    const letterbox = Math.max(0, (eh - vh * scale) / 2);
    bottom = Math.max(barClearance, letterbox + 8);
  }
  captionOverlay.style.bottom = `${Math.round(bottom)}px`;
}

journeyVideo.addEventListener('loadedmetadata', positionCaptions);
window.addEventListener('resize', positionCaptions);
window.addEventListener('orientationchange', positionCaptions);

function applyCaptions() {
  removeCaptionTracks();
  const show = captionsEnabled && !!activeCaptionUrl;
  ccBtn.classList.toggle('hidden', !activeCaptionUrl);
  ccBtn.setAttribute('aria-pressed', String(show));
  ccBtn.textContent = show ? 'CC on' : 'CC off';
  if (!show) return;
  const track = document.createElement('track');
  track.kind = 'captions';
  track.srclang = 'en';
  track.label = 'English';
  track.src = activeCaptionUrl;
  track.default = true;
  const attach = () => {
    if (!track.track) return;
    activeTextTrack = track.track;
    // 'hidden', not 'showing': parse cues and fire cuechange, but let
    // renderActiveCues() do the drawing into #caption-overlay.
    activeTextTrack.mode = 'hidden';
    activeTextTrack.addEventListener('cuechange', renderActiveCues);
    positionCaptions();
    renderActiveCues();
  };
  track.addEventListener('load', attach);
  journeyVideo.appendChild(track);
  attach();
}

function showCaptionPrompt() {
  captionPrompt.classList.remove('hidden');
  // Focus has to wait for the element to actually be rendered: .hidden is
  // `display: none !important`, and focus() on a still-unrendered element
  // silently does nothing — which would leave the Yes default with no focus
  // ring and nothing for a keyboard/screen-reader user to land on.
  requestAnimationFrame(() => captionYesBtn.focus());
}

function isCaptionPromptOpen() {
  return !captionPrompt.classList.contains('hidden');
}

function answerCaptionPrompt(on) {
  if (!isCaptionPromptOpen()) return;
  captionsEnabled = on;
  storeCaptionPref(on);
  captionPrompt.classList.add('hidden');
  const proceed = pendingPlay;
  pendingPlay = null;
  if (proceed) proceed();
}

/* The single gate every playback path goes through: works out whether this
   video has captions, asks once if the operator has never answered, then runs
   the actual play function.

   The screen changes BEFORE anything is awaited — the Journey layer and the
   loading overlay appear the instant the operator acts. An earlier version
   awaited the caption probe first, so on flaky WiFi a press of Begin
   Video/Space (or a picker choice) changed nothing on screen for as long as
   the network dawdled — reported from the live kiosk as "you click buttons
   and it doesn't respond". Hiding the splash immediately also makes
   isAwaitingPlay() false, so mashing Space/the button can't stack duplicate
   requests.

   The reveal matters for the prompt path too: the prompt lives inside
   #journey-view, so that layer has to be on screen or the question renders
   into a display:none ancestor and is invisible — which once stranded manual
   previews (operator picks a video, sees the Check-in Display, and playback
   waits forever on a question nobody can see). */
async function requestPlayback(captionUrl, proceed) {
  const token = ++journeyRequestToken;
  stopTeachingSlides(); // a slideshow left from the previous video must not sit over this one
  journeyView.classList.remove('hidden');
  checkinView.classList.add('hidden');
  journeyPlaceholder.classList.add('hidden');
  journeySplash.classList.add('hidden');
  showVideoLoading();
  const available = await captionsAvailable(captionUrl);
  // The operator may have torn this down (toggle button) or started a newer
  // request while the probe was in flight — don't resurrect it.
  if (token !== journeyRequestToken) return;
  const blobUrl = available ? await cachedCaptionBlobUrl(captionUrl) : null;
  if (token !== journeyRequestToken) {
    // Stale: a newer request owns the screen now — discard our blob rather
    // than clobbering (and revoking) caption state that request just set.
    if (blobUrl) URL.revokeObjectURL(blobUrl);
    return;
  }
  if (blobUrl) {
    if (captionObjectUrl) URL.revokeObjectURL(captionObjectUrl);
    captionObjectUrl = blobUrl;
  }
  activeCaptionUrl = available ? blobUrl || captionUrl : null;
  if (available && storedCaptionPref() === null) {
    pendingPlay = proceed;
    hideVideoLoading();
    showCaptionPrompt();
    return;
  }
  proceed();
}

captionYesBtn.addEventListener('click', () => {
  audioUnlocked = true;
  answerCaptionPrompt(true);
});
captionNoBtn.addEventListener('click', () => {
  audioUnlocked = true;
  answerCaptionPrompt(false);
});

ccBtn.addEventListener('click', () => {
  audioUnlocked = true;
  captionsEnabled = !captionsEnabled;
  storeCaptionPref(captionsEnabled);
  applyCaptions();
});

// True only while the splash is up and waiting for the operator to start
// the queued lesson — Space/→/the on-screen button all no-op outside this.
function isAwaitingPlay() {
  return (
    !journeyView.classList.contains('hidden') &&
    !journeySplash.classList.contains('hidden') &&
    !previewMode
  );
}

/* Loading indicator: covers the gap between asking a video to play and
   frames actually rendering — which for a manual preview (streaming a
   full-size original over church WiFi) can be long enough to look like a
   dead screen. Also re-shown by the video's 'waiting' event for mid-play
   buffering stalls, and hidden again by 'playing'. */
const LOADING_STALL_MS = 12000;
const LOADING_NOTE_DEFAULT = journeyLoadingNote.textContent;
let loadingStallTimer = null;

function showVideoLoading() {
  journeyLoading.classList.remove('hidden');
  // If loading drags on, say so honestly instead of pulsing forever — a
  // stalled fetch on a dead connection never fires an error event, so
  // without this the overlay is indistinguishable from progress. The ⇄
  // button always works as the way out (it never waits on the network).
  clearTimeout(loadingStallTimer);
  loadingStallTimer = setTimeout(() => {
    // Stalled on the tail of the lesson — go straight to the slides rather
    // than leaving the room staring at a frozen last frame.
    if (!journeyVideo.classList.contains('hidden') && videoNearEnd()) {
      endOfLessonHandoff();
      return;
    }
    journeyLoadingNote.textContent =
      'Still loading — the internet may be down. Press → for the teaching slides, or ⇄ (bottom right) to go back.';
  }, LOADING_STALL_MS);
}

function hideVideoLoading() {
  clearTimeout(loadingStallTimer);
  journeyLoadingNote.textContent = LOADING_NOTE_DEFAULT;
  journeyLoading.classList.add('hidden');
}

journeyVideo.addEventListener('playing', hideVideoLoading);
journeyVideo.addEventListener('waiting', () => {
  if (!journeyVideo.classList.contains('hidden')) showVideoLoading();
});

function setMuted(muted) {
  journeyVideo.muted = muted;
  unmuteBtn.textContent = muted ? '🔇' : '🔊';
  unmuteBtn.setAttribute('aria-pressed', String(!muted));
}

/* ── Playback controls: pause/play, scrubber, elapsed time ────────────
   The bar (#video-controls) shows whenever a video is active, fading out
   with the idle cursor and pinned visible while paused. Tapping/clicking
   the video itself toggles pause too — the natural touch gesture — and
   Space does the same during playback (it already starts the splash's
   queued lesson when that's what's on screen). */
function formatTime(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) seconds = 0;
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

let scrubbing = false;

function syncPlaybackUI() {
  const paused = journeyVideo.paused;
  pauseBtn.textContent = paused ? 'Play' : 'Pause';
  // While paused, the bar must not fade away with the idle cursor —
  // a silent frozen frame with no visible controls reads as a crash.
  videoControls.classList.toggle('force-visible', paused);
}

function syncScrubber() {
  if (scrubbing) return;
  const duration = journeyVideo.duration;
  if (Number.isFinite(duration) && duration > 0) {
    videoScrubber.max = String(duration);
    videoScrubber.value = String(journeyVideo.currentTime);
    videoTime.textContent = `${formatTime(journeyVideo.currentTime)} / ${formatTime(duration)}`;
  } else {
    // Duration unknown (still loading, or a stream that doesn't report
    // one) — show elapsed time only and leave the scrubber inert.
    videoScrubber.max = '0';
    videoScrubber.value = '0';
    videoTime.textContent = formatTime(journeyVideo.currentTime);
  }
}

function togglePause() {
  if (journeyVideo.classList.contains('hidden')) return;
  audioUnlocked = true; // pausing/resuming is itself a genuine gesture
  if (journeyVideo.paused) journeyVideo.play().catch(() => {});
  else journeyVideo.pause();
}

journeyVideo.addEventListener('play', syncPlaybackUI);
journeyVideo.addEventListener('pause', syncPlaybackUI);
journeyVideo.addEventListener('timeupdate', syncScrubber);
journeyVideo.addEventListener('timeupdate', recordResumePoint);
journeyVideo.addEventListener('durationchange', syncScrubber);
journeyVideo.addEventListener('click', togglePause);
pauseBtn.addEventListener('click', togglePause);

videoScrubber.addEventListener('input', () => {
  scrubbing = true;
  const t = Number(videoScrubber.value);
  if (Number.isFinite(t)) {
    journeyVideo.currentTime = t;
    videoTime.textContent = `${formatTime(t)} / ${formatTime(journeyVideo.duration)}`;
  }
});
videoScrubber.addEventListener('change', () => {
  scrubbing = false;
});

function stopJourneyContent() {
  playingWeek = null; // nothing attached — stop marking a position
  // Invalidate any still-awaiting requestPlayback()/playCurrentLesson() call:
  // once the operator has torn the view down, a slow caption probe or cache
  // read resolving later must not restart playback into a hidden layer.
  ++journeyRequestToken;
  stopTeachingSlides();
  journeyVideo.pause();
  // Release the cached video's blob URL and detach the element while the
  // Journey view isn't showing — on a 512MB Pi Zero, a ~100-200MB decoded
  // blob has no business staying resident for the other 23 hours of the day.
  // It costs one cheap Cache API read to reconstruct at the next 6:30 PM.
  journeyVideo.removeAttribute('src');
  journeyVideo.load();
  journeyVideo.classList.add('hidden');
  hideVideoLoading();
  videoControls.classList.add('hidden');
  videoControls.classList.remove('force-visible');
  // Drop caption tracks with the video, and abandon any unanswered prompt —
  // its pending play refers to a video that's no longer on screen.
  activeCaptionUrl = null;
  pendingPlay = null;
  captionPrompt.classList.add('hidden');
  removeCaptionTracks();
  if (captionObjectUrl) {
    URL.revokeObjectURL(captionObjectUrl);
    captionObjectUrl = null;
  }
  ccBtn.classList.add('hidden');
  videoScrubber.max = '0';
  videoScrubber.value = '0';
  videoTime.textContent = '0:00';
  journeySplash.classList.add('hidden');
  if (currentObjectUrl) {
    URL.revokeObjectURL(currentObjectUrl);
    currentObjectUrl = null;
  }
}

/* ── View switching ──────────────────────────────────────────────── */

function setView(phase) {
  const showJourney = phase === 'journey';
  journeyView.classList.toggle('hidden', !showJourney);
  checkinView.classList.toggle('hidden', showJourney);
  if (showJourney) {
    showJourneyContent();
  } else {
    stopJourneyContent();
  }
}

// `lastPhase` tracks only the *scheduled* phase (for detecting a genuine
// 18:30/19:15 boundary crossing) — it is deliberately never written to from
// the manual toggle or the video's 'ended' handler below, both of which call
// setView() directly to change what's on screen right now without touching
// this. That's what lets either of them hold a view that disagrees with
// scheduledPhase() (e.g. checkin display shown early, or shown again after
// the lesson finished early) without the next 15s poll tick fighting them —
// the poll only acts when scheduledPhase() itself has actually changed.
let lastPhase = scheduledPhase();
setView(lastPhase);

// True while a manually-picked video (from the Settings panel) is playing.
// The poller and the hourly lesson refresh both skip their normal
// view-changing work while this is set, so a preview can't be interrupted
// mid-playback by the ordinary schedule machinery — it only ends via the
// video finishing/erroring, or the operator explicitly leaving it (the
// toggle button). See "Manual video preview" below.
let previewMode = false;

setInterval(() => {
  if (previewMode) return;
  const phase = scheduledPhase();
  if (phase !== lastPhase) {
    lastPhase = phase;
    setView(phase);
  }
}, POLL_INTERVAL_MS);

toggleBtn.addEventListener('click', () => {
  audioUnlocked = true;
  if (previewMode) {
    endPreview();
    return;
  }
  const showingJourney = !journeyView.classList.contains('hidden');
  setView(showingJourney ? 'checkin' : 'journey');
});

unmuteBtn.addEventListener('click', () => {
  audioUnlocked = true;
  setMuted(!journeyVideo.muted);
});

// Starts the queued lesson playing — only while the splash is actually up
// (isAwaitingPlay()), so a stray keypress at any other time (e.g. during
// the Check-in Display, or once the video's already playing) does nothing.
journeySplashPlayBtn.addEventListener('click', () => {
  if (!isAwaitingPlay()) return;
  audioUnlocked = true;
  beginScheduledPlay();
});

// Shown in place of "Begin Video" when an interrupted showing of THIS week's
// lesson was marked (see offerResume) — picks it back up a few seconds shy of
// where it stopped.
journeySplashResumeBtn.addEventListener('click', () => {
  if (!isAwaitingPlay()) return;
  audioUnlocked = true;
  beginScheduledPlay(offeredResumeAt);
});

journeySplashStartOverBtn.addEventListener('click', () => {
  if (!isAwaitingPlay()) return;
  audioUnlocked = true;
  clearResumePoint();
  beginScheduledPlay(0);
});

// The scheduled show plays the Student Video, so that's the transcript to
// offer. requestPlayback() asks about captions only if this device has never
// answered, then starts playback either way.
function beginScheduledPlay(resumeAt = 0) {
  if (!currentLesson) return;
  requestPlayback(captionUrlFor(currentLesson.week, 'student'), () => playCurrentLesson(resumeAt));
}

document.addEventListener('keydown', (e) => {
  // The caption prompt owns the keyboard while it's up: Y/N answer it, and
  // Space/Enter take the focused default (Yes) so an operator who reflexively
  // taps Space to start the video isn't stopped by an unfamiliar screen.
  if (isCaptionPromptOpen()) {
    if (e.code === 'KeyY') {
      e.preventDefault();
      audioUnlocked = true;
      answerCaptionPrompt(true);
    } else if (e.code === 'KeyN') {
      e.preventDefault();
      audioUnlocked = true;
      answerCaptionPrompt(false);
    } else if (e.code === 'Space' || e.code === 'Enter') {
      e.preventDefault();
      audioUnlocked = true;
      answerCaptionPrompt(true);
    }
    return;
  }
  const typing = e.target instanceof Element && e.target.closest('input, select, textarea');
  // Teaching slides own Space/arrows while they're up (the video is hidden
  // by then, so none of the playback shortcuts below can fire anyway).
  if (slideshowActive() && settingsPanel.classList.contains('hidden')
      && handoutView.classList.contains('hidden') && !typing) {
    if (e.code === 'Space' || e.code === 'ArrowRight' || e.code === 'Enter' || e.code === 'PageDown') {
      e.preventDefault(); // (also stops Space from scrolling / clicking a focused button)
      if (e.repeat) return; // a held key must not fly through the deck
      audioUnlocked = true;
      nextSlide();
      return;
    }
    if (e.code === 'ArrowLeft' || e.code === 'PageUp' || e.code === 'Backspace') {
      e.preventDefault();
      if (e.repeat) return;
      prevSlide();
      return;
    }
  }
  // S opens Settings from anywhere (the splash advertises it); Escape closes.
  if (e.code === 'KeyS' && !e.repeat && !typing && settingsPanel.classList.contains('hidden')
      && handoutView.classList.contains('hidden')) {
    e.preventDefault();
    audioUnlocked = true;
    openSettingsPanel();
    return;
  }
  if (e.code === 'Escape' && !settingsPanel.classList.contains('hidden')) {
    closeSettingsPanel();
    return;
  }
  if (e.code !== 'Space' && e.code !== 'ArrowRight') return;
  if (isAwaitingPlay()) {
    e.preventDefault(); // stop Space from also "clicking" a focused button below
    audioUnlocked = true;
    // Whatever the splash's primary button says: Resume when one is offered,
    // otherwise plain Begin Video. "Start over" stays a deliberate press.
    beginScheduledPlay(offeredResumeAt);
    return;
  }
  // → moves the show on while a lesson video is up — playing, paused, or
  // wedged on a dead connection — handing over to the teaching slides. This
  // is the operator's guaranteed way forward when the video never finishes;
  // Space stays "pause" so a reflexive tap can't skip the lesson.
  if (
    e.code === 'ArrowRight' &&
    !journeyVideo.classList.contains('hidden') &&
    settingsPanel.classList.contains('hidden') &&
    handoutView.classList.contains('hidden')
  ) {
    e.preventDefault();
    audioUnlocked = true;
    endOfLessonHandoff();
    return;
  }
  // Once a video is actually on screen, Space toggles pause — but never
  // while the settings panel is open or a button/input has focus, where
  // Space already means "activate that control".
  if (
    e.code === 'Space' &&
    !journeyVideo.classList.contains('hidden') &&
    settingsPanel.classList.contains('hidden') &&
    !(e.target instanceof Element && e.target.closest('button, input'))
  ) {
    e.preventDefault();
    togglePause();
  }
});

/* ── Keep the kiosk screen awake ─────────────────────────────────────
   Raspberry Pi OS ships with screen blanking enabled by default; with no
   keyboard/mouse activity for hours, the display can go to sleep long
   before 6:30 PM arrives. The Wake Lock API only prevents the screen from
   blanking — it doesn't dismiss a blank that already happened — so this
   also re-acquires on visibilitychange (e.g. after the tab/monitor was
   backgrounded and the lock was released) rather than only once on load.
   Requires HTTPS, which GitHub Pages provides. Not fatal if unsupported
   (older Chromium builds) — disabling blanking at the OS level (see
   PI_SETUP.md) is the belt-and-braces fallback either way. */
let wakeLock = null;
async function requestWakeLock() {
  if (!('wakeLock' in navigator)) return;
  try {
    wakeLock = await navigator.wakeLock.request('screen');
  } catch {
    // e.g. the tab isn't visible yet — visibilitychange below retries.
  }
}
requestWakeLock();
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && (!wakeLock || wakeLock.released)) {
    requestWakeLock();
  }
});

// Once the lesson finishes, there's nothing left to show for the rest of
// the window — fall back to the Check-in Display right away rather than
// holding on a blank/frozen frame until 7:15. Deliberately does NOT touch
// lastPhase (see the comment above it) — doing so would make the very next
// poll tick see a manufactured "flip" back to 'journey' and restart the
// lesson from frame zero, which is exactly the bug this comment is here to
// prevent regressing.
/* The single way out of a lesson video, whatever ended it: Awana's teaching
   slides for that lesson come next, and only once they finish does the old
   end-of-video behavior run (Check-in Display for the scheduled show,
   endPreview() for a preview). Reached four ways — the video's own 'ended'
   event, the near-end stall watchdog, a manual skip with →, and a fatal
   video error. It used to hang off 'ended' alone, which stranded a leader
   mid-club: the lesson stalled on its last chunk over flaky WiFi, 'ended'
   never fired, and there was no way to reach the slides at all. */
function endOfLessonHandoff() {
  const finish = () => {
    if (previewMode) {
      endPreview();
      return;
    }
    setView('checkin');
  };
  const week = previewMode ? previewWeek : currentLesson && currentLesson.week;
  if (startTeachingSlides(week, finish)) return true;
  finish();
  return false;
}

// The lesson played out — there is nothing left to resume. (Cleared here
// rather than in endOfLessonHandoff(), which also runs for a → skip and for
// a stall/error, where the mark is still the best guess at where the room
// got to.)
journeyVideo.addEventListener('ended', () => {
  if (!previewMode) clearResumePoint();
});
journeyVideo.addEventListener('ended', endOfLessonHandoff);

/* A video that stalls within a few seconds of its end has, for the room's
   purposes, finished — the last frames are never worth waiting on. Judged
   only when the stall has already lasted LOADING_STALL_MS, so an ordinary
   buffering hiccup near the end still gets a chance to recover and play out. */
const END_STALL_TOLERANCE_S = 3;
function videoNearEnd() {
  const d = journeyVideo.duration;
  const t = journeyVideo.currentTime;
  return Number.isFinite(d) && d > 0 && d - t <= END_STALL_TOLERANCE_S;
}

// A failed/unsupported video load, or a stall that never recovers, should
// fall back to the placeholder rather than leaving a silent black frame
// that's indistinguishable from a dead display.
journeyVideo.addEventListener('error', () => {
  console.warn('Journey: video failed to load/play', journeyVideo.error);
  hideVideoLoading();
  if (previewMode) {
    // A preview tries the transcoded release asset first; if that errored
    // (asset missing, release renamed), retry once with the lesson's
    // original URL before giving up. Cleared immediately so a failure of
    // the fallback itself lands in endPreview() below, not a loop.
    if (previewFallbackUrl) {
      const fallback = previewFallbackUrl;
      previewFallbackUrl = null;
      console.warn('Journey: transcoded preview failed, retrying with the original —', fallback);
      showVideoLoading();
      journeyVideo.src = fallback;
      applyCaptions(); // keep captions across the one-time fallback swap
      journeyVideo.play().catch(() => {});
      return;
    }
    endPreview();
    return;
  }
  if (!journeyView.classList.contains('hidden')) {
    // The lesson can't play, but this week's teaching slides are already on
    // this device — far better on the wall than a dead placeholder. Only a
    // week with no slides falls through to it.
    if (startTeachingSlides(currentLesson && currentLesson.week, () => setView('checkin'))) return;
    journeyVideo.classList.add('hidden');
    videoControls.classList.add('hidden');
    journeyPlaceholder.classList.remove('hidden');
  }
});

/* ── Lesson refresh: pulled well ahead of the evening window so the
      video is already cached locally by 6:30, regardless of how the
      network is behaving right then. ──────────────────────────────── */

async function refreshLesson() {
  const lesson = await loadCurrentLesson();
  // A failed fetch (the exact flaky-network case this refresh exists to be
  // resilient against) must never blank out a lesson we already have —
  // only a genuinely resolved lesson can update or clear currentLesson.
  if (!lesson) return;
  const changed = !sameLesson(currentLesson, lesson);
  currentLesson = lesson;
  cacheLessonBundle(lesson);
  if (changed && lastPhase === 'journey' && !previewMode) showJourneyContent();
}

refreshLesson();
setInterval(refreshLesson, LESSON_REFRESH_MS);
// The browser noticing the connection coming back is a better moment to
// retry than waiting out the hourly timer — flaky church WiFi is the normal
// operating condition here. ('online' can fire in bursts on a flapping
// connection; the bundleInFlight guard in cacheLessonBundle() is what keeps
// that from stacking duplicate multi-MB downloads on the single-core Pi.)
window.addEventListener('online', () => refreshLesson());

/* ── Manual video preview (Settings panel) ────────────────────────────
   Lets an operator browse every lesson in public/lessons.json and play
   any one of them right now — always a one-off: it never changes what
   the schedule above will automatically show at the next 6:30 PM, and
   never touches current-lesson.json. Plays the lesson's pre-transcoded
   480p copy from the GitHub Release (see transcodedPreviewUrl above),
   falling back to the original URL only if that asset is missing — an
   earlier version played the originals directly, which the Pi Zero
   cannot decode at a watchable frame rate, so "only the current week
   plays properly" was reported broken from the live kiosk. Still skips
   the Cache API: an occasional manual action doesn't need the nightly
   lesson's pre-caching machinery, it just needs a decodable file. Picking
   a lesson ALWAYS asks Leader or Student Video first (lessons with no
   Leader Video — week 27 — have that choice disabled); see the comment in
   onLessonPicked() for why this is deliberately unconditional. */

let allLessons = null;
let pendingPreviewLesson = null;
// Set alongside each preview: the lesson's original URL, tried once if the
// transcoded release asset errors (missing, or the release was renamed).
let previewFallbackUrl = null;
// The week of the lesson being previewed — the teaching slides shown after
// a preview video are that lesson's, not the scheduled one's.
let previewWeek = null;

// Every lesson (Student and Leader) has a Pi-playable 480p re-encode
// uploaded as a GitHub Release asset by scripts/transcode-all-lessons.mjs —
// the Pi Zero can't decode Awana's 1080p originals at a watchable frame
// rate, so previews play these first and only fall back to the original if
// the asset is missing. (Release asset URLs 302-redirect, which <video>
// follows fine; no crossorigin attribute means CORS never applies.)
const TRANSCODED_VIDEO_BASE =
  'https://github.com/patrick-simpson/Journey-Display/releases/download/transcoded-videos-v1/';

function transcodedPreviewUrl(week, variant) {
  return `${TRANSCODED_VIDEO_BASE}week-${String(week).padStart(2, '0')}-${variant}.mp4`;
}

/* lessons.json is a static file that changes ~never, yet an earlier version
   fetched it with {cache:'no-store'} at the moment the Settings gear was
   pressed — a forced network round-trip standing between the click and the
   panel's contents. Now it's cache-first: a good copy is kept in the Cache
   API (stored by fetchLessonsJson below, refreshed in the background), so
   after the first successful load ever, the lesson list works with the
   network fully dead. GitHub Pages' own max-age=600 means a plain fetch is
   at most 10 minutes stale, same as every other asset on the site. */
function adoptLessonsData(data) {
  if (!data || !Array.isArray(data.lessons)) return false;
  allLessons = data.lessons;
  buildCaptionManifest(allLessons);
  return true;
}

async function fetchLessonsJson() {
  const res = await fetchWithTimeout('lessons.json', {}, 5000);
  if (!res.ok) throw new Error(`lessons.json ${res.status}`);
  // Parse and shape-check BEFORE caching: a 200 carrying garbage (a truncated
  // deploy, a hand-edit typo) must never replace the known-good offline copy.
  const text = await res.text();
  const data = JSON.parse(text); // throws on invalid JSON
  if (!data || !Array.isArray(data.lessons)) throw new Error('lessons.json: unexpected shape');
  if ('caches' in window) {
    try {
      const cache = await caches.open(ASSET_CACHE_NAME);
      await cache.put(
        'lessons.json',
        new Response(text, { headers: { 'content-type': 'application/json' } })
      );
    } catch {
      // Not storable right now (quota, private mode) — still usable live.
    }
  }
  return data;
}

async function cachedLessonsJson() {
  if (!('caches' in window)) return null;
  try {
    const cache = await caches.open(ASSET_CACHE_NAME);
    const hit = await cache.match('lessons.json');
    return hit ? await hit.json() : null;
  } catch {
    return null;
  }
}

async function loadAllLessons() {
  if (allLessons) return allLessons;
  const cached = await cachedLessonsJson();
  if (cached && adoptLessonsData(cached)) {
    // Serve the cached copy instantly; revalidate quietly for next time.
    fetchLessonsJson().then(adoptLessonsData, () => {});
    return allLessons;
  }
  try {
    if (adoptLessonsData(await fetchLessonsJson())) return allLessons;
  } catch {
    // Offline with nothing cached yet — the caller shows the error state.
  }
  return null;
}

function renderLessonList(lessons) {
  settingsLessonList.textContent = '';
  for (const lesson of lessons.slice().sort((a, b) => a.week - b.week)) {
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'settings-lesson-row';
    row.setAttribute('role', 'option');
    if (currentLesson && currentLesson.week === lesson.week) {
      row.classList.add('settings-lesson-current');
    }
    const week = document.createElement('span');
    week.className = 'settings-lesson-week';
    week.textContent = `Week ${lesson.week}`;
    const title = document.createElement('span');
    title.textContent = lesson.title;
    row.append(week, title);
    row.addEventListener('click', () => onLessonPicked(lesson));
    settingsLessonList.appendChild(row);
  }
}

function onLessonPicked(lesson) {
  // Always ask Leader or Student — an earlier version skipped the question
  // inside the 6:30-7:15 window (playing the Student Video directly, like
  // the scheduled show), but the two behaviors read as the picker being
  // flaky rather than as a deliberate rule ("it's not asking me
  // consistently" — reported from the live kiosk 2026-08-22). One
  // consistent extra click beats a clever inconsistency.
  pendingPreviewLesson = lesson;
  settingsVariantPrompt.textContent = `"${lesson.title}" — which video?`;
  settingsVariantLeaderBtn.disabled = !lesson.leaderDownloadUrl;
  settingsLessonList.classList.add('hidden');
  settingsVariantPicker.classList.remove('hidden');
}

function resetSettingsPanelToList() {
  pendingPreviewLesson = null;
  settingsVariantPicker.classList.add('hidden');
  settingsLeaderPicker.classList.add('hidden');
  settingsLessonList.classList.remove('hidden');
}

/* ── Leader handout viewer ────────────────────────────────────────────
   Each Leader Video has a one-page summary PDF (public/handouts/,
   generated from its transcript in public/transcripts/ — see CLAUDE.md).
   Shown full-screen in an iframe via Chromium's built-in PDF viewer, so
   the kiosk never leaves the page or opens a tab. */
function handoutUrl(week) {
  return `handouts/week-${String(week).padStart(2, '0')}-leader-handout.pdf`;
}

let handoutObjectUrl = null;

// The current week's handout is prefetched into the Cache API by
// cacheLessonBundle(); serving it as a blob URL means opening it needs no
// network. Other weeks fall back to the live URL (Chromium's PDF viewer
// streams it), and the ~55KB PDF is small enough that this stays a
// degraded-not-dead path: the overlay and its Close button appear instantly
// and never wait on the fetch. PURE, like cachedCaptionBlobUrl(): returns a
// fresh blob URL or null, and openHandout() commits it to handoutObjectUrl
// only after confirming the open it belongs to is still the current one.
async function cachedHandoutBlobUrl(url) {
  if (!('caches' in window)) return null;
  try {
    const hit = await caches.match(url);
    if (!hit) return null;
    return URL.createObjectURL(await hit.blob());
  } catch {
    return null;
  }
}

// Identity of the latest open — a slow cache read for handout A must not
// land its PDF into an overlay that has since been closed and reopened
// showing handout B's title.
let handoutRequestId = 0;

function openHandout(lesson) {
  const requestId = ++handoutRequestId;
  handoutTitle.textContent = `Week ${lesson.week} — ${lesson.title} (Leader Handout)`;
  handoutView.classList.remove('hidden');
  handoutCloseBtn.focus();
  const url = handoutUrl(lesson.week);
  cachedHandoutBlobUrl(url).then((blobUrl) => {
    if (requestId !== handoutRequestId) {
      // Closed or replaced while the cache read was in flight — discard our
      // blob rather than clobbering (and revoking) the newer open's.
      if (blobUrl) URL.revokeObjectURL(blobUrl);
      return;
    }
    if (blobUrl) {
      if (handoutObjectUrl) URL.revokeObjectURL(handoutObjectUrl);
      handoutObjectUrl = blobUrl;
      handoutFrame.src = blobUrl;
    } else {
      handoutFrame.src = url;
    }
  });
}

function closeHandout() {
  ++handoutRequestId; // abandon any still-resolving open
  handoutView.classList.add('hidden');
  // Drop the PDF viewer's memory the moment it's closed — same 512MB-Pi
  // hygiene as detaching the <video> element's src.
  handoutFrame.removeAttribute('src');
  if (handoutObjectUrl) {
    URL.revokeObjectURL(handoutObjectUrl);
    handoutObjectUrl = null;
  }
}

handoutCloseBtn.addEventListener('click', closeHandout);

function openSettingsPanel() {
  audioUnlocked = true;
  resetSettingsPanelToList();
  // The panel appears the instant the gear is pressed — an earlier version
  // awaited lessons.json first, so on a hung request the gear looked broken
  // (nothing on screen, ever). The list fills in when the data arrives, from
  // the Cache API when the network can't answer.
  settingsPanel.classList.remove('hidden');
  if (allLessons) {
    renderLessonList(allLessons);
    return;
  }
  settingsLessonList.textContent = '';
  const note = document.createElement('p');
  note.className = 'settings-list-note';
  note.textContent = 'Loading lesson list…';
  settingsLessonList.appendChild(note);
  loadAllLessons().then((lessons) => {
    if (settingsPanel.classList.contains('hidden')) return; // closed meanwhile
    if (lessons) {
      // Only replace the loading note if the list hasn't already been
      // rendered by a faster concurrent open.
      if (note.isConnected) renderLessonList(lessons);
    } else {
      note.textContent =
        'The lesson list couldn’t load — check the kiosk’s internet connection, then close and reopen this panel.';
    }
  });
}

function closeSettingsPanel() {
  settingsPanel.classList.add('hidden');
}

function startPreview(url, title, fallbackUrl = null, week = null) {
  ++journeyRequestToken; // invalidate any in-flight showJourneyContent() call
  stopTeachingSlides();
  previewMode = true;
  playingWeek = null; // a preview is never the scheduled show's resume point
  previewFallbackUrl = fallbackUrl;
  previewWeek = week;
  journeyView.classList.remove('hidden');
  checkinView.classList.add('hidden');
  journeyPlaceholder.classList.add('hidden');
  // The splash may be up when a preview starts (picking a lesson while the
  // scheduled window's "Large Group Time" screen is showing) — hide it, or
  // it sits on top of the video. playCurrentLesson() does the same.
  journeySplash.classList.add('hidden');
  journeyVideo.classList.remove('hidden');
  videoControls.classList.remove('hidden');
  showVideoLoading();
  journeyVideo.loop = false;
  setMuted(!audioUnlocked);
  journeyVideo.src = url;
  applyCaptions();
  journeyVideo.play().catch(() => {
    if (!journeyVideo.muted) {
      setMuted(true);
      journeyVideo.play().catch(() => {});
    }
  });
  console.log(`Journey: previewing "${title}"`);
}

function endPreview() {
  if (!previewMode) return;
  previewMode = false;
  previewFallbackUrl = null;
  previewWeek = null;
  // Tear the preview's video down before handing the view back. Without
  // this, ending a preview inside the 6:30-7:15 window left the finished
  // video element visible, which made showJourneyContent() early-return
  // (it sees "playback in progress") instead of re-showing the splash.
  stopJourneyContent();
  setView(scheduledPhase());
}

settingsBtn.addEventListener('click', () => {
  audioUnlocked = true;
  openSettingsPanel();
});

settingsCloseBtn.addEventListener('click', closeSettingsPanel);
settingsBackdrop.addEventListener('click', closeSettingsPanel);

settingsVariantBackBtn.addEventListener('click', resetSettingsPanelToList);

settingsVariantStudentBtn.addEventListener('click', () => {
  if (!pendingPreviewLesson) return;
  const lesson = pendingPreviewLesson;
  closeSettingsPanel();
  requestPlayback(captionUrlFor(lesson.week, 'student'), async () => {
    // The current week's Student Video is the one already pre-downloaded for
    // the 6:30 show — play the local copy instead of re-streaming ~17MB from
    // the GitHub Release, so a same-week preview works with the network dead.
    // Gated on transcodedAt so a not-yet-transcoded week (downloadUrl still
    // the 1080p original the Pi can't decode) keeps using the Release asset.
    if (currentLesson && currentLesson.week === lesson.week && currentLesson.transcodedAt) {
      const token = journeyRequestToken;
      const src = await resolveVideoSrc(currentLesson, token);
      if (!src || token !== journeyRequestToken) return; // torn down while reading the cache
      startPreview(
        src,
        `${lesson.title} (Student Video)`,
        transcodedPreviewUrl(lesson.week, 'student'),
        lesson.week
      );
      return;
    }
    startPreview(
      transcodedPreviewUrl(lesson.week, 'student'),
      `${lesson.title} (Student Video)`,
      lesson.downloadUrl,
      lesson.week
    );
  });
});

// Leader is a two-step choice: first Leader vs Student, then Video vs
// Handout (the one-page summary PDF generated from the Leader Video's
// transcript).
settingsVariantLeaderBtn.addEventListener('click', () => {
  if (!pendingPreviewLesson || !pendingPreviewLesson.leaderDownloadUrl) return;
  settingsLeaderPrompt.textContent = `"${pendingPreviewLesson.title}" (Leader) — video or handout?`;
  settingsVariantPicker.classList.add('hidden');
  settingsLeaderPicker.classList.remove('hidden');
});

settingsLeaderVideoBtn.addEventListener('click', () => {
  if (!pendingPreviewLesson || !pendingPreviewLesson.leaderDownloadUrl) return;
  const lesson = pendingPreviewLesson;
  closeSettingsPanel();
  requestPlayback(captionUrlFor(lesson.week, 'leader'), () =>
    startPreview(
      transcodedPreviewUrl(lesson.week, 'leader'),
      `${lesson.title} (Leader Video)`,
      lesson.leaderDownloadUrl,
      lesson.week
    )
  );
});

settingsLeaderHandoutBtn.addEventListener('click', () => {
  if (!pendingPreviewLesson) return;
  openHandout(pendingPreviewLesson);
  closeSettingsPanel();
});

settingsLeaderBackBtn.addEventListener('click', () => {
  settingsLeaderPicker.classList.add('hidden');
  settingsVariantPicker.classList.remove('hidden');
});

/* ── Teaching slides (after the lesson video) ─────────────────────────
   Each Advocates lesson ships a 5-slide "Teaching Slides" deck on the
   course page: title, core verse, misconception, illumination, and a
   blank TEMPLATE (heading + three empty bullets) for the leader to fill.
   scripts/render-teaching-slides.py renders slides 1-4 of every week into
   public/slides/week-NN/slide-N.jpg and extracts the template's bare
   background as template.jpg; public/teaching-slides.json carries the deck
   metadata plus, per week, the three generated "fills" for that template
   (Talk About It / Remember This / This Week), written from the week's
   Leader Video transcript and rendered here as HTML text over the
   background so they stay crisp and editable.

   When any lesson video ends — the scheduled show or a picker preview —
   startTeachingSlides() takes over the Journey layer: the deck's slides,
   then whichever generated slides Settings has ticked. A leader drives it
   (Space / → / Enter next, ← back, tap the slide, or the Prev/Next bar);
   an optional auto-advance interval from Settings ticks it along too, and
   any manual step resets that timer. "Finish" on the last slide (or the
   auto-advance running off the end) hands control to whatever the video's
   own ending used to do: back to the Check-in Display for the scheduled
   show, endPreview() for a preview. The ⇄ button and the 7:15 boundary tear
   the slideshow down through stopJourneyContent() like everything else.

   Preferences live in localStorage (per device, like the caption choice):
   journey.slides.autoAdvanceSec (0 = manual) and journey.slides.extras
   ({questions, takeaways, challenges} booleans, all on by default). */
const TEACHING_SLIDES_URL = 'teaching-slides.json';
const DECK_SLIDE_COUNT_DEFAULT = 4; // every Advocates deck has 4 slides + the template
const SLIDES_AUTO_KEY = 'journey.slides.autoAdvanceSec';
const SLIDES_EXTRAS_KEY = 'journey.slides.extras';
const SLIDE_EXTRA_KINDS = ['questions', 'takeaways', 'challenges'];
const SLIDE_HEADINGS_DEFAULT = {
  questions: 'Talk About It',
  takeaways: 'Remember This',
  challenges: 'This Week',
};


function weekTag(week) {
  return `week-${String(week).padStart(2, '0')}`;
}

function slideImageUrl(week, n) {
  return `slides/${weekTag(week)}/slide-${n}.jpg`;
}

function slideTemplateUrl(week) {
  return `slides/${weekTag(week)}/template.jpg`;
}

function teachingSlidesFor(week) {
  const weeks = teachingSlides && teachingSlides.weeks;
  return (weeks && weeks[String(week)]) || null;
}

function deckSlideCount(week) {
  const w = teachingSlidesFor(week);
  return w && Number.isInteger(w.slides) && w.slides > 0 ? w.slides : DECK_SLIDE_COUNT_DEFAULT;
}

// Same cache-first shape as lessons.json (see loadAllLessons): a good copy
// is kept in the assets cache so the slide fills work with the network dead.
function adoptTeachingSlides(data) {
  if (!data || typeof data !== 'object' || !data.weeks || typeof data.weeks !== 'object') return false;
  teachingSlides = data;
  return true;
}

async function fetchTeachingSlidesJson() {
  const res = await fetchWithTimeout(TEACHING_SLIDES_URL, {}, 5000);
  if (!res.ok) throw new Error(`${TEACHING_SLIDES_URL} ${res.status}`);
  const text = await res.text();
  const data = JSON.parse(text);
  if (!data || typeof data !== 'object' || !data.weeks) throw new Error(`${TEACHING_SLIDES_URL}: unexpected shape`);
  if ('caches' in window) {
    try {
      const cache = await caches.open(ASSET_CACHE_NAME);
      await cache.put(TEACHING_SLIDES_URL, new Response(text, { headers: { 'content-type': 'application/json' } }));
    } catch {
      // Not storable right now — still usable live.
    }
  }
  return data;
}

async function loadTeachingSlides() {
  if (teachingSlides) return teachingSlides;
  if ('caches' in window) {
    try {
      const cache = await caches.open(ASSET_CACHE_NAME);
      const hit = await cache.match(TEACHING_SLIDES_URL);
      if (hit && adoptTeachingSlides(await hit.json())) {
        fetchTeachingSlidesJson().then(adoptTeachingSlides, () => {});
        return teachingSlides;
      }
    } catch {
      // fall through to the network
    }
  }
  try {
    adoptTeachingSlides(await fetchTeachingSlidesJson());
  } catch (err) {
    console.warn('Journey: teaching-slides.json unavailable —', err);
  }
  return teachingSlides;
}

function slidesAutoAdvanceSec() {
  try {
    const v = Number(localStorage.getItem(SLIDES_AUTO_KEY));
    return Number.isFinite(v) && v > 0 ? v : 0;
  } catch {
    return 0;
  }
}

function slidesExtras() {
  const extras = { questions: true, takeaways: true, challenges: true };
  try {
    const stored = JSON.parse(localStorage.getItem(SLIDES_EXTRAS_KEY) || 'null');
    if (stored && typeof stored === 'object') {
      for (const k of SLIDE_EXTRA_KINDS) if (typeof stored[k] === 'boolean') extras[k] = stored[k];
    }
  } catch {
    // unreadable → defaults
  }
  return extras;
}

function storeSlidesPrefs() {
  try {
    localStorage.setItem(SLIDES_AUTO_KEY, String(Number(slidesAutoAdvanceSelect.value) || 0));
    const extras = {};
    for (const k of SLIDE_EXTRA_KINDS) extras[k] = slidesExtraInputs[k].checked;
    localStorage.setItem(SLIDES_EXTRAS_KEY, JSON.stringify(extras));
  } catch {
    // Preference just won't survive a reload. Fine.
  }
}

function syncSlidesPrefInputs() {
  const sec = String(slidesAutoAdvanceSec());
  slidesAutoAdvanceSelect.value = Array.from(slidesAutoAdvanceSelect.options).some((o) => o.value === sec) ? sec : '0';
  const extras = slidesExtras();
  for (const k of SLIDE_EXTRA_KINDS) slidesExtraInputs[k].checked = extras[k];
}

syncSlidesPrefInputs();
slidesAutoAdvanceSelect.addEventListener('change', storeSlidesPrefs);
for (const k of SLIDE_EXTRA_KINDS) slidesExtraInputs[k].addEventListener('change', storeSlidesPrefs);

function buildSlideItems(week) {
  if (!Number.isInteger(week) || week < 1) return [];
  const items = [];
  const count = deckSlideCount(week);
  for (let n = 1; n <= count; n++) items.push({ type: 'image', url: slideImageUrl(week, n) });
  const w = teachingSlidesFor(week);
  const notes = w && w.notes;
  const headings = Object.assign({}, SLIDE_HEADINGS_DEFAULT, (teachingSlides && teachingSlides.headings) || {});
  const extras = slidesExtras();
  for (const kind of SLIDE_EXTRA_KINDS) {
    if (!extras[kind] || !notes || !Array.isArray(notes[kind]) || !notes[kind].length) continue;
    items.push({
      type: 'template',
      heading: headings[kind],
      bullets: notes[kind].map(String),
      url: slideTemplateUrl(week),
    });
  }
  return items;
}


function slideshowActive() {
  return slideshow !== null;
}

/* Serve a prefetched slide from the cache as a blob URL (memoized per
   slideshow, all revoked in stopTeachingSlides), else the plain URL. */
function resolveSlideUrl(show, url) {
  if (show.blobUrls.has(url)) return show.blobUrls.get(url);
  const pending = (async () => {
    if ('caches' in window) {
      try {
        const hit = await caches.match(url);
        if (hit) {
          const blobUrl = URL.createObjectURL(await hit.blob());
          if (slideshow !== show) {
            URL.revokeObjectURL(blobUrl); // torn down while reading
            return url;
          }
          return blobUrl;
        }
      } catch {
        // fall through to the live URL
      }
    }
    return url;
  })();
  show.blobUrls.set(url, pending); // memoized as a promise: one blob per URL, ever
  return pending;
}

function startTeachingSlides(week, onFinish) {
  const items = buildSlideItems(week);
  if (!items.length) return false;
  stopTeachingSlides();
  ++journeyRequestToken; // nothing in flight should touch the video now
  slideshow = { week, items, index: 0, onFinish, blobUrls: new Map(), errors: 0 };
  // Release the video the same way stopJourneyContent() does — a decoded
  // ~17MB blob has no business staying resident behind a slideshow.
  journeyVideo.pause();
  journeyVideo.removeAttribute('src');
  journeyVideo.load();
  journeyVideo.classList.add('hidden');
  videoControls.classList.add('hidden');
  videoControls.classList.remove('force-visible');
  hideVideoLoading();
  removeCaptionTracks();
  ccBtn.classList.add('hidden');
  if (currentObjectUrl) {
    URL.revokeObjectURL(currentObjectUrl);
    currentObjectUrl = null;
  }
  journeySplash.classList.add('hidden');
  journeyPlaceholder.classList.add('hidden');
  journeyView.classList.remove('hidden');
  checkinView.classList.add('hidden');
  slidesView.classList.remove('hidden');
  showSlide(0);
  return true;
}

function showSlide(index) {
  const show = slideshow;
  if (!show) return;
  show.index = index;
  const item = show.items[index];
  clearTimeout(slideAutoTimer);
  slideAutoTimer = null;
  slideCounter.textContent = `Slide ${index + 1} of ${show.items.length}`;
  slidePrevBtn.disabled = index === 0;
  slideNextBtn.textContent = index === show.items.length - 1 ? 'Finish ✓' : 'Next →';
  if (item.type === 'image') {
    slideTemplate.classList.add('hidden');
    slideTemplate.style.backgroundImage = '';
    slideImage.classList.remove('hidden');
    resolveSlideUrl(show, item.url).then((src) => {
      if (slideshow !== show || show.index !== index) return;
      slideImage.src = src;
    });
  } else {
    slideImage.classList.add('hidden');
    slideImage.removeAttribute('src');
    slideTemplateHeading.textContent = item.heading;
    slideTemplateBullets.textContent = '';
    for (const bullet of item.bullets) {
      const li = document.createElement('li');
      li.textContent = bullet;
      slideTemplateBullets.appendChild(li);
    }
    slideTemplate.classList.remove('hidden');
    fitTemplateText();
    resolveSlideUrl(show, item.url).then((src) => {
      if (slideshow !== show || show.index !== index) return;
      slideTemplate.style.backgroundImage = `url("${src}")`;
    });
  }
  // Warm the next slide so the step lands instantly.
  const next = show.items[index + 1];
  if (next) {
    resolveSlideUrl(show, next.url).then((src) => {
      if (slideshow !== show) return;
      const img = new Image();
      img.src = src;
    });
  }
  const sec = slidesAutoAdvanceSec();
  if (sec > 0) slideAutoTimer = setTimeout(nextSlide, sec * 1000);
}

/* Three long bullets can outgrow the 4:3 stage on a short screen; step the
   list's type down until it fits rather than letting it spill off the
   slide (each bullet is capped at 80 characters, so this rarely fires). */
function fitTemplateText() {
  slideTemplateBullets.style.fontSize = '';
  const base = parseFloat(getComputedStyle(slideTemplateBullets).fontSize) || 24;
  let size = base;
  let guard = 12;
  while (guard-- > 0 && slideTemplateBullets.scrollHeight > slideTemplateBullets.clientHeight + 1 && size > base * 0.55) {
    size *= 0.92;
    slideTemplateBullets.style.fontSize = `${size}px`;
  }
}

window.addEventListener('resize', () => {
  if (slideshow && !slideTemplate.classList.contains('hidden')) fitTemplateText();
});

function nextSlide() {
  if (!slideshow) return;
  if (slideshow.index >= slideshow.items.length - 1) {
    finishTeachingSlides();
    return;
  }
  showSlide(slideshow.index + 1);
}

function prevSlide() {
  if (!slideshow || slideshow.index === 0) return;
  showSlide(slideshow.index - 1);
}

function finishTeachingSlides() {
  const show = slideshow;
  stopTeachingSlides();
  // The whole showing (video + slides) is done. Not for a preview: its
  // slides say nothing about where the scheduled lesson got to, and
  // previewMode is still set until onFinish() runs endPreview().
  if (!previewMode) clearResumePoint();
  if (show && typeof show.onFinish === 'function') show.onFinish();
}

function stopTeachingSlides() {
  clearTimeout(slideAutoTimer);
  slideAutoTimer = null;
  if (!slideshow) return;
  const show = slideshow;
  slideshow = null;
  slidesView.classList.add('hidden');
  slideImage.removeAttribute('src');
  slideTemplate.classList.add('hidden');
  slideTemplate.style.backgroundImage = '';
  slideTemplateBullets.textContent = '';
  slideTemplateBullets.style.fontSize = '';
  for (const pending of show.blobUrls.values()) {
    pending.then((u) => {
      if (typeof u === 'string' && u.startsWith('blob:')) URL.revokeObjectURL(u);
    }, () => {});
  }
}

// A slide image that can't load (never rendered, storage evicted, offline
// and uncached) skips ahead instead of leaving a black frame — bounded so a
// deck with nothing loadable ends instead of spinning.
slideImage.addEventListener('error', () => {
  if (!slideshow || slideImage.classList.contains('hidden')) return;
  const item = slideshow.items[slideshow.index];
  if (!item || item.type !== 'image') return; // a stale error for a slide we already left
  slideshow.errors += 1;
  if (slideshow.errors > slideshow.items.length) {
    finishTeachingSlides();
    return;
  }
  nextSlide();
});

slidePrevBtn.addEventListener('click', prevSlide);
slideNextBtn.addEventListener('click', () => {
  audioUnlocked = true;
  nextSlide();
});
// Tap/click the slide itself: left third steps back, the rest steps forward.
slideStage.addEventListener('click', (e) => {
  if (!slideshow) return;
  const rect = slideStage.getBoundingClientRect();
  if (e.clientX - rect.left < rect.width / 3) prevSlide();
  else nextSlide();
});

// Warm the lesson list + captions manifest at startup rather than on the
// first Settings press, and store lessons.json for offline use. Failure is
// fine — openSettingsPanel() retries and shows its own error state. (Kept at
// the very end of the script: it reads `allLessons`, a `let` that must be
// past its declaration before any call runs.)
loadAllLessons();
loadTeachingSlides();
