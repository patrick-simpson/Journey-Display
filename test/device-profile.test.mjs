// The device profile: what this screen is, what it therefore plays, and what
// the Settings panel lets an operator say about it. Driven through the real
// page wherever there is a control to press, because the wiring is the part
// that has broken before.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bootKiosk, tick, PI_ZERO, DESKTOP } from './kiosk-dom.mjs';

const LESSONS = {
  version: 1,
  lessons: [
    {
      week: 1,
      unit: 1,
      lesson: 1,
      title: 'Unit 1, Lesson 1: Apologetics',
      downloadUrl: 'https://clubs.awana.org/student-1.mp4',
      leaderDownloadUrl: 'https://clubs.awana.org/leader-1.mp4',
      captions: { student: true, leader: true },
    },
  ],
};

// The steady state: the nightly transcode has run, so downloadUrl is the small
// same-origin copy and sourceUrl is still Awana's own CORS-friendly original.
const CURRENT = {
  version: 2,
  week: 1,
  title: 'Unit 1, Lesson 1: Apologetics',
  sourceUrl: 'https://cdn.awana.example/student-1-original.mp4',
  downloadUrl: 'current-lesson-video.mp4',
  transcodedAt: '2026-09-15T04:00:00Z',
  resolvedAt: '2026-09-15T03:00:00Z',
};

const ROUTES = {
  'lessons.json': { json: LESSONS },
  'current-lesson.json': { json: CURRENT },
};

// cacheLessonBundle() fetches the video, both transcripts, the prep
// transcripts, the handout and the slides; a 404 is "legitimately missing,
// skip". These routes make the video (both qualities) and one transcript real,
// so what is stored is what this device chose to store.
const BUNDLE_ROUTES = {
  ...ROUTES,
  'current-lesson-video.mp4': { text: 'transcoded bytes' },
  'student-1-original.mp4': { text: 'original bytes' },
  'transcripts/week-01-student.vtt': { text: 'WEBVTT' },
};

// The caption prompt asks once per device and would otherwise sit in front of
// every playback path here; a kiosk that has been used before has answered.
const ANSWERED = { 'journey.captions': 'off' };

const LOW_POWER_URL = 'https://patrick-simpson.github.io/Awana-Check-in-Display/?lowPower=1';
const FULL_URL = 'https://patrick-simpson.github.io/Awana-Check-in-Display/';

/* A Cache API just real enough for cacheLessonBundle(): one Map per bucket,
   keyed by absolute URL the way a browser keys it, so store-before-evict can
   be watched. Installed AFTER boot on purpose: schedule.js feature-checks
   `caches` at call time, and leaving it undefined at startup is the path a
   fresh kiosk takes. */
function installCaches(window) {
  const buckets = new Map();
  const abs = (key) => new window.URL(String(key), 'https://example.test/').href;
  const bucket = (name) => {
    if (!buckets.has(name)) buckets.set(name, new Map());
    return buckets.get(name);
  };
  const open = async (name) => {
    const store = bucket(name);
    return {
      match: async (key) => store.get(abs(key)),
      put: async (key, response) => {
        store.set(abs(key), response);
      },
      keys: async () => [...store.keys()].map((url) => ({ url })),
      delete: async (request) => store.delete(abs(request.url || request)),
    };
  };
  window.caches = {
    open,
    match: async (key) => {
      for (const store of buckets.values()) {
        const hit = store.get(abs(key));
        if (hit) return hit;
      }
      return undefined;
    },
  };
  return { buckets, keysIn: (name) => [...bucket(name).keys()] };
}

test('detectDeviceProfile reads the machine, not the brand', () => {
  const kiosk = bootKiosk(ROUTES, ANSWERED);
  const { detectDeviceProfile } = kiosk.window;
  const chrome = (bits) => `Mozilla/5.0 (${bits}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36`;

  // Every Raspberry Pi this could run on: Linux on ARM.
  assert.equal(detectDeviceProfile(chrome('X11; Linux armv6l'), 1), 'low');
  assert.equal(detectDeviceProfile(chrome('X11; Linux armv7l'), 4), 'low');
  assert.equal(detectDeviceProfile(chrome('X11; Linux aarch64'), 4), 'low');

  // Phones and tablets: a small screen on cell data wants the small file.
  assert.equal(
    detectDeviceProfile(
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148',
      6
    ),
    'low'
  );
  assert.equal(detectDeviceProfile(chrome('Linux; Android 14; Pixel 8'), 8), 'low');

  // Real computers, including Apple silicon (whose UA still says Intel).
  assert.equal(detectDeviceProfile(chrome('Macintosh; Intel Mac OS X 10_15_7'), 8), 'full');
  assert.equal(
    detectDeviceProfile(
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15',
      10
    ),
    'full'
  );
  assert.equal(detectDeviceProfile(chrome('Windows NT 10.0; Win64; x64'), 4), 'full');

  // Two cores or fewer is a weak machine whatever it calls itself, and a
  // browser that will not say gets the benefit of the doubt.
  assert.equal(detectDeviceProfile(chrome('Windows NT 10.0; Win64; x64'), 2), 'low');
  assert.equal(detectDeviceProfile(chrome('Windows NT 10.0; Win64; x64'), undefined), 'full');
  kiosk.close();
});

test('the override wins over detection, and Auto goes back to it', () => {
  const pi = bootKiosk(ROUTES, ANSWERED, PI_ZERO);
  assert.equal(pi.window.effectiveProfile(), 'low');
  pi.close();

  const mac = bootKiosk(ROUTES, ANSWERED, DESKTOP);
  assert.equal(mac.window.effectiveProfile(), 'full');
  mac.close();

  const forcedFull = bootKiosk(ROUTES, { ...ANSWERED, 'journey.playback.quality': 'full' }, PI_ZERO);
  assert.equal(forcedFull.window.effectiveProfile(), 'full');
  forcedFull.close();

  const forcedLow = bootKiosk(ROUTES, { ...ANSWERED, 'journey.playback.quality': 'low' }, DESKTOP);
  assert.equal(forcedLow.window.effectiveProfile(), 'low');
  forcedLow.close();

  // A junk value in device storage is not a third profile.
  const junk = bootKiosk(ROUTES, { ...ANSWERED, 'journey.playback.quality': 'ultra' }, DESKTOP);
  assert.equal(junk.window.storedPlaybackQuality(), 'auto');
  assert.equal(junk.window.effectiveProfile(), 'full');
  junk.close();
});

test('the embedded display carries ?lowPower=1 only on the low profile', () => {
  const pi = bootKiosk(ROUTES, ANSWERED, PI_ZERO);
  assert.equal(pi.document.getElementById('checkin-frame').getAttribute('src'), LOW_POWER_URL);
  pi.close();

  const mac = bootKiosk(ROUTES, ANSWERED, DESKTOP);
  assert.equal(mac.document.getElementById('checkin-frame').getAttribute('src'), FULL_URL);
  mac.close();
});

test('the iframe is only rewritten when the URL actually changes', () => {
  const kiosk = bootKiosk(ROUTES, ANSWERED, PI_ZERO);
  const frame = kiosk.document.getElementById('checkin-frame');
  let writes = 0;
  Object.defineProperty(frame, 'src', {
    get: () => frame.getAttribute('src'),
    set: (value) => {
      writes += 1;
      frame.setAttribute('src', value);
    },
    configurable: true,
  });

  // Already the low-power URL: re-applying it must not reload the iframe,
  // which would drop the display's live check-in socket for nothing.
  kiosk.window.applyCheckinDisplayUrl();
  assert.equal(writes, 0);

  kiosk.document.getElementById('quality-full').click();
  assert.equal(writes, 1);
  assert.equal(frame.getAttribute('src'), FULL_URL);

  kiosk.window.applyCheckinDisplayUrl();
  assert.equal(writes, 1);
  kiosk.close();
});

test('the Settings buttons set, show and persist the choice', () => {
  const kiosk = bootKiosk(ROUTES, ANSWERED, PI_ZERO);
  const { document, window } = kiosk;
  document.getElementById('settings-btn').click();

  const pressed = () =>
    ['auto', 'full', 'low']
      .filter((k) => document.getElementById(`quality-${k}`).getAttribute('aria-pressed') === 'true');
  assert.deepEqual(pressed(), ['auto']);
  // Auto has to say what it detected, or it is a promise nobody can check.
  assert.equal(document.getElementById('quality-auto').textContent, 'Auto (detected: low power)');

  document.getElementById('quality-full').click();
  assert.deepEqual(pressed(), ['full']);
  assert.equal(window.localStorage.getItem('journey.playback.quality'), 'full');
  assert.equal(window.effectiveProfile(), 'full');
  assert.match(document.getElementById('quality-status').textContent, /full quality/);

  document.getElementById('quality-auto').click();
  assert.deepEqual(pressed(), ['auto']);
  assert.equal(window.localStorage.getItem('journey.playback.quality'), 'auto');
  assert.equal(window.effectiveProfile(), 'low');
  assert.equal(document.getElementById('checkin-frame').getAttribute('src'), LOW_POWER_URL);
  kiosk.close();
});

test('a choice that cannot be stored applies now and says it will not last', () => {
  const kiosk = bootKiosk(ROUTES, ANSWERED, PI_ZERO);
  const { document, window } = kiosk;
  // jsdom's Storage exposes named properties, so assigning to the instance
  // would just store an item called "setItem". The method lives on the
  // prototype, which is what a browser with site data blocked breaks.
  const realSetItem = window.Storage.prototype.setItem;
  window.Storage.prototype.setItem = () => {
    throw new Error('storage blocked');
  };
  document.getElementById('quality-full').click();
  assert.equal(window.effectiveProfile(), 'full', 'the button still has to do something');
  assert.equal(document.getElementById('checkin-frame').getAttribute('src'), FULL_URL);
  assert.match(document.getElementById('quality-status').textContent, /won’t[\s\S]*store settings/);
  window.Storage.prototype.setItem = realSetItem;
  kiosk.close();
});

test('the scheduled show plays the transcode on low and the original on full', async () => {
  const pi = bootKiosk(ROUTES, ANSWERED, PI_ZERO);
  await tick();
  pi.window.setView('journey');
  pi.document.getElementById('journey-splash-play-btn').click();
  await tick();
  await tick();
  assert.equal(pi.video.getAttribute('src'), 'current-lesson-video.mp4');
  pi.close();

  const mac = bootKiosk(ROUTES, ANSWERED, DESKTOP);
  await tick();
  mac.window.setView('journey');
  mac.document.getElementById('journey-splash-play-btn').click();
  await tick();
  await tick();
  assert.equal(mac.video.getAttribute('src'), CURRENT.sourceUrl);
  // Nothing is degraded about playing the original, so the splash says nothing.
  assert.equal(
    mac.document.getElementById('journey-splash-quality').classList.contains('hidden'),
    true
  );
  mac.close();
});

test('a lesson with no transcode yet: the Release copy on low, the original on full', () => {
  const lesson = { ...CURRENT, downloadUrl: CURRENT.sourceUrl, transcodedAt: null };

  const pi = bootKiosk(ROUTES, ANSWERED, PI_ZERO);
  const lowPlan = pi.window.scheduledVideoPlan(lesson);
  assert.equal(lowPlan.mode, 'release');
  assert.match(lowPlan.url, /week-01-student\.mp4$/);
  pi.close();

  const mac = bootKiosk(ROUTES, ANSWERED, DESKTOP);
  assert.equal(mac.window.scheduledVideoPlan(lesson).mode, 'original');
  mac.close();
});

test('the picker plays the Release copy on low and the original on full', async () => {
  // Week 1 is the current lesson, so use the Leader Video: the Student side
  // has its own same-week cached-copy shortcut, covered below.
  const pi = bootKiosk(ROUTES, ANSWERED, PI_ZERO);
  await pickLeaderVideo(pi);
  assert.match(pi.video.getAttribute('src'), /week-01-leader\.mp4$/);
  pi.close();

  const mac = bootKiosk(ROUTES, ANSWERED, DESKTOP);
  await pickLeaderVideo(mac);
  assert.equal(mac.video.getAttribute('src'), LESSONS.lessons[0].leaderDownloadUrl);
  mac.close();
});

async function pickLeaderVideo(kiosk) {
  const { document } = kiosk;
  document.getElementById('settings-btn').click();
  await tick();
  document.querySelector('.settings-lesson-row').click();
  document.getElementById('settings-variant-leader').click();
  document.getElementById('settings-leader-video').click();
  await tick();
  await tick();
}

test('the two qualities are cached under keys that cannot collide', () => {
  const kiosk = bootKiosk(ROUTES, ANSWERED, PI_ZERO);
  const { videoCacheKey } = kiosk.window;
  const low = videoCacheKey(CURRENT, 'low');
  const full = videoCacheKey(CURRENT, 'full');
  assert.equal(low, `current-lesson-video.mp4?v=${encodeURIComponent(CURRENT.transcodedAt)}`);
  assert.equal(full, `${CURRENT.sourceUrl}?q=1080`);
  assert.notEqual(low, full);
  // The marker has to be a query, not a #fragment: the Cache API ignores
  // fragments when it matches, so '#1080' would be the same key as the plain
  // URL and one quality would be served the other's bytes.
  assert.doesNotMatch(full, /#/);
  kiosk.close();
});

test('the bundle stores the transcode on low and the original on full', async () => {
  const pi = bootKiosk(BUNDLE_ROUTES, ANSWERED, PI_ZERO);
  const piCaches = installCaches(pi.window);
  await pi.window.cacheLessonBundle(CURRENT);
  const piVideos = piCaches
    .keysIn('journey-videos-v1')
    .filter((url) => url.includes('.mp4'));
  assert.deepEqual(piVideos, [
    `https://example.test/current-lesson-video.mp4?v=${encodeURIComponent(CURRENT.transcodedAt)}`,
  ]);
  pi.close();

  const mac = bootKiosk(BUNDLE_ROUTES, ANSWERED, DESKTOP);
  const macCaches = installCaches(mac.window);
  await mac.window.cacheLessonBundle(CURRENT);
  const macVideos = macCaches
    .keysIn('journey-videos-v1')
    .filter((url) => url.includes('.mp4'));
  assert.deepEqual(macVideos, [`${CURRENT.sourceUrl}?q=1080`]);
  mac.close();
});

test('an original that will not download costs the video and nothing else', async () => {
  // A cross-origin original served without CORS headers: fetch() rejects, and
  // this page can do nothing about it. The rest of the bundle must still be
  // stored, and last week's must still be evicted.
  const kiosk = bootKiosk(BUNDLE_ROUTES, ANSWERED, DESKTOP);
  const { window } = kiosk;
  const caches = installCaches(window);
  const realFetch = window.fetch;
  window.fetch = (url, options) => {
    if (String(url) === CURRENT.sourceUrl) return Promise.reject(new TypeError('Failed to fetch'));
    return realFetch(url, options);
  };
  const cache = await window.caches.open('journey-videos-v1');
  await cache.put('https://example.test/stale-last-week.mp4', { ok: true });

  await window.cacheLessonBundle(CURRENT);
  const keys = caches.keysIn('journey-videos-v1');
  assert.equal(keys.includes('https://example.test/stale-last-week.mp4'), false, 'store-before-evict still evicts once the rest is in');
  assert.equal(keys.some((url) => url.includes('.mp4')), false, 'no video was storable');
  assert.equal(keys.length > 0, true, 'the transcripts and slides still cached');
  kiosk.close();
});
