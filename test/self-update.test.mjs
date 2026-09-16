// The kiosk picking up a new deploy on its own: what makes it reload, what
// makes it wait, and what makes it do nothing at all. Driven through the real
// page, because the states that must block a reload (a lesson playing, the
// settings panel, a reading overlay) are page states, not flags.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bootKiosk, tick, PI_ZERO } from './kiosk-dom.mjs';

const CURRENT = {
  version: 2,
  week: 1,
  title: 'Unit 1, Lesson 1: Apologetics',
  sourceUrl: 'https://cdn.awana.example/student-1-original.mp4',
  downloadUrl: 'current-lesson-video.mp4',
  transcodedAt: '2026-09-15T04:00:00Z',
};

const ANSWERED = { 'journey.captions': 'off' };

const OLD_BUILD = 'aaaaaaa';
const NEW_BUILD = 'bbbbbbb';

const page = (build) =>
  `<!doctype html><html><head><meta name="journey-build" content="${build}" /></head><body></body></html>`;

const ticks = async (n = 4) => {
  for (let i = 0; i < n; i += 1) await tick();
};

/* Boots the kiosk as a deployed build, with version.json and index.html under
   the test's control. reloadPage() is a one-line indirection in schedule.js
   precisely so this can watch for a reload instead of navigating jsdom. */
function bootDeployed({ deployed = OLD_BUILD, served = OLD_BUILD, version } = {}) {
  const routes = {
    'current-lesson.json': { json: CURRENT },
    'index.html': { text: page(served) },
  };
  if (version !== null) routes['version.json'] = { json: version || { build: deployed } };
  const kiosk = bootKiosk(routes, ANSWERED, PI_ZERO);
  kiosk.document
    .querySelector('meta[name="journey-build"]')
    .setAttribute('content', OLD_BUILD);
  const reloads = [];
  kiosk.window.reloadPage = () => reloads.push(Date.now());
  return { ...kiosk, routes, reloads };
}

const versionFetches = (kiosk) => kiosk.fetchLog.filter((r) => r.url.includes('version.json'));
const indexFetches = (kiosk) => kiosk.fetchLog.filter((r) => r.url.includes('index.html'));

/* The page's own setTimeout, captured across one awaited call, so "it will try
   again in 15 seconds" can be asserted without waiting 15 seconds. The check
   arms that timer after its own awaits, so the patch has to outlive them. */
async function captureTimers(window, fn) {
  const real = window.setTimeout;
  const captured = [];
  window.setTimeout = (cb, ms) => {
    captured.push({ cb, ms });
    return 0;
  };
  try {
    await fn();
    await ticks();
  } finally {
    window.setTimeout = real;
  }
  return captured;
}

test('the same build is not news: no index fetch, no reload', async () => {
  const kiosk = bootDeployed({ deployed: OLD_BUILD });
  await kiosk.window.checkForNewBuild();
  await ticks();

  assert.equal(versionFetches(kiosk).length, 1);
  assert.equal(indexFetches(kiosk).length, 0, 'nothing to be fresh about');
  assert.deepEqual(kiosk.reloads, []);
  kiosk.close();
});

test('no version.json at all leaves the poller inert', async () => {
  // A local checkout, or a deploy that predates the stamping step: the file
  // 404s, which is "no news", never a reload.
  const kiosk = bootDeployed({ version: null });
  await kiosk.window.checkForNewBuild();
  await ticks();

  assert.equal(indexFetches(kiosk).length, 0);
  assert.deepEqual(kiosk.reloads, []);
  kiosk.close();
});

test('a new build waits for the CDN to serve the new page, then reloads once', async () => {
  // Pages' max-age=600 applies to index.html too, so version.json can be new
  // while this edge still hands back the old page. Reloading onto that page
  // would look exactly like a deploy that did not take.
  const kiosk = bootDeployed({ version: { build: NEW_BUILD }, served: OLD_BUILD });
  await kiosk.window.checkForNewBuild();
  await ticks();
  assert.equal(indexFetches(kiosk).length, 1, 'it checked the page itself');
  assert.deepEqual(kiosk.reloads, [], 'and found the old one');

  kiosk.routes['index.html'] = { text: page(NEW_BUILD) };
  await kiosk.window.checkForNewBuild();
  await ticks();
  assert.equal(kiosk.reloads.length, 1);

  // The second check needed no second look at version.json: the pending build
  // is already known.
  assert.equal(versionFetches(kiosk).length, 1);
  kiosk.close();
});

test('a lesson on screen blocks the reload, and it tries again later', async () => {
  const kiosk = bootDeployed({ version: { build: NEW_BUILD }, served: NEW_BUILD });
  await ticks();
  kiosk.window.setView('journey');
  kiosk.document.getElementById('journey-splash-play-btn').click();
  await ticks(6);
  assert.equal(kiosk.video.classList.contains('hidden'), false, 'a video really is playing');

  const timers = await captureTimers(kiosk.window, () => kiosk.window.checkForNewBuild());
  assert.deepEqual(kiosk.reloads, [], 'never during something a room is watching');
  assert.equal(indexFetches(kiosk).length, 0, 'it did not even ask');
  assert.ok(
    timers.some((t) => t.ms === 15000),
    'a busy kiosk re-checks every 15 seconds, with no deadline'
  );

  // The lesson ends: the check-in display is back, so now it may reload.
  kiosk.window.setView('checkin');
  await kiosk.window.checkForNewBuild();
  await ticks();
  assert.equal(kiosk.reloads.length, 1);
  kiosk.close();
});

test('the settings panel, a reading overlay and the splash all hold it off', async () => {
  const kiosk = bootDeployed({ version: { build: NEW_BUILD }, served: NEW_BUILD });
  await ticks();
  const { document, window } = kiosk;

  document.getElementById('settings-btn').click();
  await window.checkForNewBuild();
  await ticks();
  assert.deepEqual(kiosk.reloads, [], 'someone is using the panel');
  document.getElementById('settings-close-btn').click();

  document.getElementById('prep-view').classList.remove('hidden');
  await window.checkForNewBuild();
  await ticks();
  assert.deepEqual(kiosk.reloads, [], 'someone is reading');
  document.getElementById('prep-view').classList.add('hidden');

  // The splash is up, waiting for a leader to press Begin: the room is about
  // to watch a lesson, which is the worst possible moment to go blank.
  window.setView('journey');
  assert.equal(document.getElementById('journey-splash').classList.contains('hidden'), false);
  await window.checkForNewBuild();
  await ticks();
  assert.deepEqual(kiosk.reloads, []);

  window.setView('checkin');
  await window.checkForNewBuild();
  await ticks();
  assert.equal(kiosk.reloads.length, 1);
  kiosk.close();
});

test("the 'online' burst is rate limited to one check a minute", async () => {
  const kiosk = bootDeployed({ deployed: OLD_BUILD });
  for (let i = 0; i < 3; i += 1) {
    kiosk.window.dispatchEvent(new kiosk.window.Event('online'));
    await ticks();
  }
  assert.equal(versionFetches(kiosk).length, 1, 'flapping WiFi fires this in bursts');
  kiosk.close();
});
