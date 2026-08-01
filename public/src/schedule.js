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

let currentLesson = null;
let currentObjectUrl = null;

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
      current-lesson.json. ────────────────────────────────────────── */

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
  } catch {
    // Offline, or Vimeo unreachable right now — keep whatever's already
    // cached and try again on the next poll.
  }
}

async function resolveVideoSrc(lesson) {
  if (currentObjectUrl) {
    URL.revokeObjectURL(currentObjectUrl);
    currentObjectUrl = null;
  }
  if ('caches' in window) {
    try {
      const cache = await caches.open(VIDEO_CACHE_NAME);
      const cached = await cache.match(lesson.downloadUrl);
      if (cached) {
        currentObjectUrl = URL.createObjectURL(await cached.blob());
        return currentObjectUrl;
      }
    } catch {
      // fall through to the live URL
    }
  }
  return lesson.downloadUrl;
}

async function showJourneyContent() {
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
  journeyVideo.muted = true;
  unmuteBtn.textContent = '🔇';
  journeyVideo.src = await resolveVideoSrc(currentLesson);
  journeyVideo.play().catch(() => {});
}

function stopJourneyContent() {
  journeyVideo.pause();
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

let lastPhase = scheduledPhase();
setView(lastPhase);

setInterval(() => {
  const phase = scheduledPhase();
  if (phase !== lastPhase) {
    lastPhase = phase;
    setView(phase);
  }
}, POLL_INTERVAL_MS);

toggleBtn.addEventListener('click', () => {
  const showingJourney = !journeyView.classList.contains('hidden');
  setView(showingJourney ? 'checkin' : 'journey');
});

unmuteBtn.addEventListener('click', () => {
  journeyVideo.muted = !journeyVideo.muted;
  unmuteBtn.textContent = journeyVideo.muted ? '🔇' : '🔊';
});

// Once the lesson finishes, there's nothing left to show for the rest
// of the window — fall back to the Check-in Display right away rather
// than holding on a blank/frozen frame until 7:15.
journeyVideo.addEventListener('ended', () => {
  lastPhase = 'checkin';
  setView('checkin');
});

/* ── Lesson refresh: pulled well ahead of the evening window so the
      video is already cached locally by 6:30, regardless of how the
      network is behaving right then. ──────────────────────────────── */

async function refreshLesson() {
  const lesson = await loadCurrentLesson();
  const changed = !currentLesson || !lesson || lesson.week !== currentLesson.week;
  currentLesson = lesson;
  if (lesson) cacheLessonVideo(lesson);
  if (changed && lastPhase === 'journey') showJourneyContent();
}

refreshLesson();
setInterval(refreshLesson, LESSON_REFRESH_MS);
