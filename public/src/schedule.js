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
const journeyVideo = document.getElementById('journey-video');
const unmuteBtn = document.getElementById('unmute-btn');
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

let currentLesson = null;
let currentObjectUrl = null;
// Bumped on every showJourneyContent()/startPreview() call so a slow,
// in-flight call (e.g. still awaiting a cache read) can detect it's stale
// once it resolves and avoid clobbering state a newer call already set.
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

async function showJourneyContent() {
  const token = ++journeyRequestToken;
  if (!currentLesson) {
    // No lesson resolved yet (or the nightly feed came back empty) —
    // show the plain placeholder rather than a broken video.
    journeyVideo.pause();
    journeyVideo.removeAttribute('src');
    journeyVideo.classList.add('hidden');
    unmuteBtn.classList.add('hidden');
    journeyPlaceholder.classList.remove('hidden');
    return;
  }
  journeyPlaceholder.classList.add('hidden');
  journeyVideo.classList.remove('hidden');
  unmuteBtn.classList.remove('hidden');
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

function setMuted(muted) {
  journeyVideo.muted = muted;
  unmuteBtn.textContent = muted ? '🔇' : '🔊';
  unmuteBtn.setAttribute('aria-pressed', String(!muted));
}

function stopJourneyContent() {
  journeyVideo.pause();
  // Release the cached video's blob URL and detach the element while the
  // Journey view isn't showing — on a 512MB Pi Zero, a ~100-200MB decoded
  // blob has no business staying resident for the other 23 hours of the day.
  // It costs one cheap Cache API read to reconstruct at the next 6:30 PM.
  journeyVideo.removeAttribute('src');
  journeyVideo.load();
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
  if (previewMode) {
    endPreview();
    return;
  }
  if (!journeyView.classList.contains('hidden')) {
    journeyVideo.classList.add('hidden');
    unmuteBtn.classList.add('hidden');
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
   never touches current-lesson.json. Deliberately plays the lesson's
   original (untranscoded) URL directly rather than going through the
   Cache API — this is an occasional manual action, not the nightly
   auto-played lesson, so it doesn't need pre-caching machinery; it will
   just take a little longer to start and may not play as smoothly on the
   Pi Zero as the transcoded current lesson does. When it's not currently
   the scheduled 6:30-7:15 window, picking a lesson asks Leader or Student
   Video first — outside the window this is more likely someone reviewing
   content than showing it to kids, so the Leader Video (which has extra
   discussion notes not meant for the room) is worth offering directly. */

let allLessons = null;
let pendingPreviewLesson = null;

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
  if (scheduledPhase() === 'journey') {
    // Inside the normal window, a preview is a quick look at the Student
    // Video the same way the real 6:30 show always plays — no extra step.
    startPreview(lesson.downloadUrl, lesson.title);
    closeSettingsPanel();
    return;
  }
  pendingPreviewLesson = lesson;
  settingsVariantPrompt.textContent = `"${lesson.title}" — which video?`;
  settingsVariantLeaderBtn.disabled = !lesson.leaderDownloadUrl;
  settingsLessonList.classList.add('hidden');
  settingsVariantPicker.classList.remove('hidden');
}

function resetSettingsPanelToList() {
  pendingPreviewLesson = null;
  settingsVariantPicker.classList.add('hidden');
  settingsLessonList.classList.remove('hidden');
}

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

function startPreview(url, title) {
  ++journeyRequestToken; // invalidate any in-flight showJourneyContent() call
  previewMode = true;
  journeyView.classList.remove('hidden');
  checkinView.classList.add('hidden');
  journeyPlaceholder.classList.add('hidden');
  journeyVideo.classList.remove('hidden');
  unmuteBtn.classList.remove('hidden');
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
  startPreview(pendingPreviewLesson.downloadUrl, `${pendingPreviewLesson.title} (Student Video)`);
  closeSettingsPanel();
});

settingsVariantLeaderBtn.addEventListener('click', () => {
  if (!pendingPreviewLesson || !pendingPreviewLesson.leaderDownloadUrl) return;
  startPreview(pendingPreviewLesson.leaderDownloadUrl, `${pendingPreviewLesson.title} (Leader Video)`);
  closeSettingsPanel();
});
