// Where the scheduled show's bytes come from: the network first, the cached
// copy as the safety net. The Pi plays a streamed file smoothly and stutters
// on the same encode served as a blob URL (owner report 2026-09-16), so this
// is a playback-quality property, not a plumbing detail, and it is driven
// through the real splash button rather than by calling resolveVideoSrc.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bootKiosk, installCaches, tick, PI_ZERO } from './kiosk-dom.mjs';

const CURRENT = {
  version: 2,
  week: 1,
  title: 'Unit 1, Lesson 1: Apologetics',
  sourceUrl: 'https://cdn.awana.example/student-1-original.mp4',
  downloadUrl: 'current-lesson-video.mp4',
  transcodedAt: '2026-09-15T04:00:00Z',
  resolvedAt: '2026-09-15T03:00:00Z',
};

const VIDEO_KEY = `current-lesson-video.mp4?v=${encodeURIComponent(CURRENT.transcodedAt)}`;

// The video URL answers a HEAD, which is what "the network is up" means here.
const ROUTES = {
  'current-lesson.json': { json: CURRENT },
  'current-lesson-video.mp4': { text: 'streamable bytes' },
};

// The caption prompt asks once per device and would otherwise sit in front of
// every playback path here; a kiosk that has been used before has answered.
const ANSWERED = { 'journey.captions': 'off' };

const ticks = async (n = 4) => {
  for (let i = 0; i < n; i += 1) await tick();
};

/* Count object URLs without losing the harness's stub: the strongest form of
   "it streamed" is that no multi-megabyte blob was ever made. */
function countObjectUrls(window) {
  const made = [];
  window.URL.createObjectURL = (blob) => {
    made.push(blob);
    return 'blob:stub';
  };
  return made;
}

async function bootWithCachedVideo(prefs = ANSWERED, routes = ROUTES) {
  const kiosk = bootKiosk(routes, prefs, PI_ZERO);
  await ticks();
  const caches = installCaches(kiosk.window);
  const cache = await kiosk.window.caches.open('journey-videos-v1');
  await cache.put(VIDEO_KEY, {
    ok: true,
    blob: async () => new kiosk.window.Blob(['cached bytes']),
  });
  return { ...kiosk, caches };
}

async function beginTheLesson(kiosk) {
  kiosk.window.setView('journey');
  kiosk.document.getElementById('journey-splash-play-btn').click();
  await ticks(6);
}

/* The page's own setTimeout, captured for the duration of one call, so a
   stall can be aged 8 seconds without waiting 8 seconds. jsdom gives the page
   its own timers, so this never touches the test runner's. */
function captureTimers(window, fn) {
  const real = window.setTimeout;
  const captured = [];
  window.setTimeout = (cb, ms) => {
    captured.push({ cb, ms });
    return 0;
  };
  try {
    fn();
  } finally {
    window.setTimeout = real;
  }
  return captured;
}

const timerAt = (timers, ms) => timers.find((t) => t.ms === ms);

test('a reachable video streams, and no blob is made for it', async () => {
  const kiosk = await bootWithCachedVideo();
  const objectUrls = countObjectUrls(kiosk.window);
  await beginTheLesson(kiosk);

  assert.equal(kiosk.video.getAttribute('src'), 'current-lesson-video.mp4');
  assert.equal(objectUrls.length, 0, 'the cached copy is the safety net, not the default');
  assert.equal(
    kiosk.fetchLog.some((r) => r.method === 'HEAD' && r.url.includes('current-lesson-video.mp4')),
    true,
    'one bounded HEAD is what decides it'
  );
  kiosk.close();
});

test('a video the server will not answer for falls back to the cached copy', async () => {
  // No route for the .mp4, so the HEAD comes back 404: the file is cached but
  // the network cannot serve it right now.
  const kiosk = await bootWithCachedVideo(ANSWERED, { 'current-lesson.json': { json: CURRENT } });
  const objectUrls = countObjectUrls(kiosk.window);
  await beginTheLesson(kiosk);

  assert.equal(kiosk.video.getAttribute('src'), 'blob:stub');
  assert.equal(objectUrls.length, 1);
  kiosk.close();
});

test('an offline kiosk plays the cached copy without probing at all', async () => {
  const kiosk = await bootWithCachedVideo();
  Object.defineProperty(kiosk.window.navigator, 'onLine', {
    get: () => false,
    configurable: true,
  });
  const before = kiosk.fetchLog.length;
  await beginTheLesson(kiosk);

  assert.equal(kiosk.video.getAttribute('src'), 'blob:stub');
  assert.equal(
    kiosk.fetchLog
      .slice(before)
      .some((r) => r.method === 'HEAD' && r.url.includes('current-lesson-video.mp4')),
    false,
    'navigator.onLine already answered the question'
  );
  kiosk.close();
});

test('a streamed video that stalls swaps to the cached copy, once, where it was', async () => {
  const kiosk = await bootWithCachedVideo();
  await beginTheLesson(kiosk);
  assert.equal(kiosk.video.getAttribute('src'), 'current-lesson-video.mp4');

  kiosk.video.currentTime = 120;
  const timers = captureTimers(kiosk.window, () =>
    kiosk.video.dispatchEvent(new kiosk.window.Event('waiting'))
  );
  const swap = timerAt(timers, 8000);
  assert.ok(swap, 'a stalled stream with a cached copy arms the swap');
  swap.cb();
  await ticks(6);

  assert.equal(kiosk.video.getAttribute('src'), 'blob:stub');
  // The position is armed as pendingSeek and applied by the one permanent
  // loadedmetadata listener, not written straight to the element.
  kiosk.seeks.length = 0;
  kiosk.video.dispatchEvent(new kiosk.window.Event('loadedmetadata'));
  assert.deepEqual(kiosk.seeks, [120]);

  // Once per playback: the candidate is spent, so a second stall arms nothing.
  const again = captureTimers(kiosk.window, () =>
    kiosk.video.dispatchEvent(new kiosk.window.Event('waiting'))
  );
  assert.equal(timerAt(again, 8000), undefined);
  kiosk.close();
});

test('a stall with nothing cached is left to the existing stall handling', async () => {
  // No cache at all: the picker's videos and any evening the bundle never
  // landed. There is nothing to swap to, so nothing is armed.
  const kiosk = bootKiosk(ROUTES, ANSWERED, PI_ZERO);
  await ticks();
  await beginTheLesson(kiosk);
  assert.equal(kiosk.video.getAttribute('src'), 'current-lesson-video.mp4');

  const timers = captureTimers(kiosk.window, () =>
    kiosk.video.dispatchEvent(new kiosk.window.Event('waiting'))
  );
  assert.equal(timerAt(timers, 8000), undefined);
  assert.ok(timerAt(timers, 12000), 'the loading note still says something honest');
  kiosk.close();
});

test('a stall on the last seconds hands over to the slides instead of swapping', async () => {
  const kiosk = await bootWithCachedVideo();
  await beginTheLesson(kiosk);
  kiosk.video.currentTime = 599; // duration is 600 in the harness

  const timers = captureTimers(kiosk.window, () =>
    kiosk.video.dispatchEvent(new kiosk.window.Event('waiting'))
  );
  timerAt(timers, 8000).cb();
  await ticks(6);

  assert.equal(kiosk.video.getAttribute('src'), 'current-lesson-video.mp4', 'no swap this close to the end');
  kiosk.close();
});
