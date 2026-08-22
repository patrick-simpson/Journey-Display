// Daily schedule: full-screen the Awana Check-in Display all day, except
// between JOURNEY_START and JOURNEY_END, when the Journey lesson video
// shows. See CLAUDE.md for the conventions around changing these
// constants, and for how the video content itself gets here.
const JOURNEY_START_MINUTES = 18 * 60 + 30; // 6:30 PM
const JOURNEY_END_MINUTES = 19 * 60 + 15; // 7:15 PM
const POLL_INTERVAL_MS = 15000;
const LESSON_REFRESH_MS = 60 * 60 * 1000; // current-lesson.json only changes nightly
const VIDEO_CACHE_NAME = 'journey-videos-v1';

const checkinView = document.getElementById('checkin-view');
const journeyView = document.getElementById('journey-view');
const journeyPlaceholder = document.getElementById('journey-placeholder');
const journeySplash = document.getElementById('journey-splash');
const journeySplashWeek = document.getElementById('journey-splash-week');
const journeySplashTitle = document.getElementById('journey-splash-title');
const journeySplashPlayBtn = document.getElementById('journey-splash-play-btn');
const journeyVideo = document.getElementById('journey-video');
const journeyLoading = document.getElementById('journey-loading');
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

let currentLesson = null;
let currentObjectUrl = null;
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

async function cacheLessonVideo(lesson) {
  if (!('caches' in window)) return;
  try {
    const cache = await caches.open(VIDEO_CACHE_NAME);
    if (await cache.match(lesson.downloadUrl)) return; // already cached
    const response = await fetch(lesson.downloadUrl);
    if (!response.ok) return;
    await cache.put(lesson.downloadUrl, response);
    // Only evict older cached videos once the new one is safely stored.
    const keys = await cache.keys();
    await Promise.all(
      keys.filter((req) => req.url !== lesson.downloadUrl).map((req) => cache.delete(req))
    );
  } catch (err) {
    // Offline, or Awana's site unreachable right now — keep whatever's
    // already cached and try again on the next poll. Logged (not just
    // swallowed) so a permanently-failing cache attempt is discoverable
    // in devtools rather than invisible until the network is down at showtime.
    console.warn('Journey: could not cache lesson video —', err);
  }
}

async function resolveVideoSrc(lesson) {
  if ('caches' in window) {
    try {
      const cache = await caches.open(VIDEO_CACHE_NAME);
      const cached = await cache.match(lesson.downloadUrl);
      if (cached) {
        const blobUrl = URL.createObjectURL(await cached.blob());
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
  return lesson.downloadUrl;
}

// Entering the journey window no longer autoplays anything: it shows a
// branded "Large Group Time" splash naming this week's lesson, and waits
// for the operator to actually start the video (Space / → / the on-screen
// button — see playCurrentLesson() and the keydown listener below). The
// video itself is still pre-fetched into the Cache API well ahead of time
// by refreshLesson()/cacheLessonVideo() regardless of what's on screen, so
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
    return;
  }
  // Don't rip control away from a playback that's already started (or
  // in-flight) — e.g. the hourly lesson refresh firing while the video is
  // already playing mid-window.
  if (!journeyVideo.classList.contains('hidden')) return;
  journeyPlaceholder.classList.add('hidden');
  journeySplashWeek.textContent = `Week ${currentLesson.week}`;
  journeySplashTitle.textContent = currentLesson.title;
  journeySplash.classList.remove('hidden');
}

// Actually starts the queued lesson playing — called only from a genuine
// user action (keypress or the on-screen button), which is also what makes
// unmuted autoplay reliable (see audioUnlocked below).
async function playCurrentLesson() {
  const token = ++journeyRequestToken;
  if (!currentLesson) return;
  journeySplash.classList.add('hidden');
  journeyVideo.classList.remove('hidden');
  videoControls.classList.remove('hidden');
  showVideoLoading();
  journeyVideo.loop = false; // plays once; falls back to Check-in Display on 'ended' below
  setMuted(!audioUnlocked);
  const src = await resolveVideoSrc(currentLesson);
  if (token !== journeyRequestToken) return; // a newer call has since taken over
  journeyVideo.src = src;
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
function showVideoLoading() {
  journeyLoading.classList.remove('hidden');
}

function hideVideoLoading() {
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
  playCurrentLesson();
});

document.addEventListener('keydown', (e) => {
  if (e.code !== 'Space' && e.code !== 'ArrowRight') return;
  if (isAwaitingPlay()) {
    e.preventDefault(); // stop Space from also "clicking" a focused button below
    audioUnlocked = true;
    playCurrentLesson();
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
journeyVideo.addEventListener('ended', () => {
  if (previewMode) {
    endPreview();
    return;
  }
  setView('checkin');
});

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
      journeyVideo.play().catch(() => {});
      return;
    }
    endPreview();
    return;
  }
  if (!journeyView.classList.contains('hidden')) {
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
  cacheLessonVideo(lesson);
  if (changed && lastPhase === 'journey' && !previewMode) showJourneyContent();
}

refreshLesson();
setInterval(refreshLesson, LESSON_REFRESH_MS);

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

async function loadAllLessons() {
  if (allLessons) return allLessons;
  try {
    const res = await fetch('lessons.json', { cache: 'no-store' });
    if (!res.ok) return null;
    const data = await res.json();
    if (!data || !Array.isArray(data.lessons)) return null;
    allLessons = data.lessons;
    return allLessons;
  } catch {
    return null;
  }
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

function openHandout(lesson) {
  handoutTitle.textContent = `Week ${lesson.week} — ${lesson.title} (Leader Handout)`;
  handoutFrame.src = handoutUrl(lesson.week);
  handoutView.classList.remove('hidden');
  handoutCloseBtn.focus();
}

function closeHandout() {
  handoutView.classList.add('hidden');
  // Drop the PDF viewer's memory the moment it's closed — same 512MB-Pi
  // hygiene as detaching the <video> element's src.
  handoutFrame.removeAttribute('src');
}

handoutCloseBtn.addEventListener('click', closeHandout);

async function openSettingsPanel() {
  audioUnlocked = true;
  resetSettingsPanelToList();
  const lessons = await loadAllLessons();
  if (lessons) renderLessonList(lessons);
  settingsPanel.classList.remove('hidden');
}

function closeSettingsPanel() {
  settingsPanel.classList.add('hidden');
}

function startPreview(url, title, fallbackUrl = null) {
  ++journeyRequestToken; // invalidate any in-flight showJourneyContent() call
  previewMode = true;
  previewFallbackUrl = fallbackUrl;
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
  startPreview(
    transcodedPreviewUrl(pendingPreviewLesson.week, 'student'),
    `${pendingPreviewLesson.title} (Student Video)`,
    pendingPreviewLesson.downloadUrl
  );
  closeSettingsPanel();
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
  startPreview(
    transcodedPreviewUrl(pendingPreviewLesson.week, 'leader'),
    `${pendingPreviewLesson.title} (Leader Video)`,
    pendingPreviewLesson.leaderDownloadUrl
  );
  closeSettingsPanel();
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
