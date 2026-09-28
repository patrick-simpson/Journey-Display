// The page shell: what the kiosk shows around the lesson, and what it no
// longer shows at all.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { bootKiosk, tick, PI_ZERO } from './kiosk-dom.mjs';

const ROUTES = {
  'current-lesson.json': {
    json: {
      version: 2,
      week: 1,
      title: 'Unit 1, Lesson 1: Apologetics',
      sourceUrl: 'https://cdn.awana.example/student-1-original.mp4',
      downloadUrl: 'current-lesson-video.mp4',
      transcodedAt: '2026-09-15T04:00:00Z',
    },
  },
};

test('the clock-drift note is gone, page and script', () => {
  const kiosk = bootKiosk(ROUTES);
  const { document, window } = kiosk;
  assert.equal(document.getElementById('clock-warning'), null);
  assert.equal(document.getElementById('journey-splash-clock'), null);
  assert.equal(typeof window.checkClockDrift, 'undefined');
  assert.equal(typeof window.showClockWarning, 'undefined');
  assert.equal(typeof window.describeDrift, 'undefined');
  assert.equal(typeof window.wallClock, 'undefined');
  // Nothing may probe for a Date header any more: the refresh at startup asks
  // for the lesson and nothing else.
  assert.equal(
    kiosk.fetchLog.some((r) => r.url.includes('clock=') || r.method === 'HEAD'),
    false
  );
  kiosk.close();
});

/* Fullscreen is a real browser capability jsdom has none of, so it is stubbed
   the same way the harness stubs media playback: record what the page asked
   for, and answer the way a browser would. */
function stubFullscreen(window) {
  const { document } = window;
  const calls = [];
  let element = null;
  Object.defineProperty(document, 'fullscreenElement', {
    get: () => element,
    configurable: true,
  });
  document.documentElement.requestFullscreen = () => {
    calls.push('enter');
    element = document.documentElement;
    return Promise.resolve();
  };
  document.exitFullscreen = () => {
    calls.push('exit');
    element = null;
    return Promise.resolve();
  };
  return calls;
}

function postFromDisplay(kiosk, data, origin = 'https://patrick-simpson.github.io') {
  const { window } = kiosk;
  const frame = kiosk.document.getElementById('checkin-frame');
  window.dispatchEvent(
    new window.MessageEvent('message', { data, origin, source: frame.contentWindow })
  );
}

function dblclick(kiosk, id) {
  const target = kiosk.document.getElementById(id);
  target.dispatchEvent(new kiosk.window.MouseEvent('dblclick', { bubbles: true }));
}

test('the embedded display can ask for the whole page to go fullscreen', () => {
  const kiosk = bootKiosk(ROUTES);
  const calls = stubFullscreen(kiosk.window);

  postFromDisplay(kiosk, { type: 'awana-display:toggle-fullscreen' });
  assert.deepEqual(calls, ['enter']);

  // The next double-click inside the display comes back out again.
  postFromDisplay(kiosk, { type: 'awana-display:toggle-fullscreen' });
  assert.deepEqual(calls, ['enter', 'exit']);
  kiosk.close();
});

test('a message from anywhere else, or about anything else, is ignored', () => {
  const kiosk = bootKiosk(ROUTES);
  const { window } = kiosk;
  const calls = stubFullscreen(window);

  // Right type, wrong sender: any page on the internet can post to an opener
  // or an embedder, so the source check is what makes this safe.
  window.dispatchEvent(
    new window.MessageEvent('message', {
      data: { type: 'awana-display:toggle-fullscreen' },
      origin: 'https://patrick-simpson.github.io',
      source: window,
    })
  );
  assert.deepEqual(calls, []);

  // Right sender, wrong origin.
  postFromDisplay(kiosk, { type: 'awana-display:toggle-fullscreen' }, 'https://evil.example');
  assert.deepEqual(calls, []);

  // Right sender, anything else it might one day send.
  postFromDisplay(kiosk, { type: 'awana-display:something-else' });
  postFromDisplay(kiosk, 'awana-display:toggle-fullscreen');
  postFromDisplay(kiosk, null);
  assert.deepEqual(calls, []);
  kiosk.close();
});

test('a double-click on the Journey layer toggles the page, a control does not', () => {
  const kiosk = bootKiosk(ROUTES);
  const { document, window } = kiosk;
  const calls = stubFullscreen(window);
  window.setView('journey');

  dblclick(kiosk, 'journey-placeholder');
  assert.deepEqual(calls, ['enter']);
  dblclick(kiosk, 'journey-placeholder');
  assert.deepEqual(calls, ['enter', 'exit']);

  // A double-tap on a button is two presses, not a fullscreen request.
  dblclick(kiosk, 'journey-splash-play-btn');
  assert.deepEqual(calls, ['enter', 'exit']);

  // And not while the operator is in the settings panel, where a double-click
  // lands on a list of lessons and a set of text fields.
  document.getElementById('settings-btn').click();
  dblclick(kiosk, 'journey-placeholder');
  assert.deepEqual(calls, ['enter', 'exit']);
  kiosk.close();
});

/* ── The splash, in the kit ───────────────────────────────────────────── */

test('the splash names the lesson as a kicker over its one-word name', () => {
  const kiosk = bootKiosk(ROUTES);
  const { splashLessonText } = kiosk.window;
  assert.deepEqual(
    { ...splashLessonText({ week: 4, title: 'Unit 1, Lesson 4: Logic' }) },
    { kicker: 'Week 4 · Unit 1 · Lesson 4', headline: 'Logic' }
  );
  assert.deepEqual(
    { ...splashLessonText({ week: 18, title: '  unit 5,  lesson 2 :  Resurrection ' }) },
    { kicker: 'Week 18 · Unit 5 · Lesson 2', headline: 'Resurrection' }
  );
  // A title in any other shape loses nothing: the whole of it is the
  // headline, and the week alone is the kicker.
  assert.deepEqual(
    { ...splashLessonText({ week: 9, title: 'A Special Evening: Q&A' }) },
    { kicker: 'Week 9', headline: 'A Special Evening: Q&A' }
  );
  assert.deepEqual({ ...splashLessonText({ week: 2, title: null }) }, { kicker: 'Week 2', headline: '' });
  kiosk.close();
});

test('the splash and the placeholder carry the Journey wordmark and this week', async () => {
  const kiosk = bootKiosk(ROUTES);
  const { document, window } = kiosk;
  for (const id of ['journey-splash-journey', 'journey-placeholder']) {
    const mark = document.querySelector(`#${id} img`);
    assert.equal(mark.getAttribute('src'), 'brand/logos/journey-white.svg');
    assert.equal(mark.getAttribute('alt'), 'Journey', 'the mark still reads "Journey" aloud');
  }
  for (let i = 0; i < 4; i += 1) await tick();
  window.setView('journey');
  assert.equal(document.getElementById('journey-splash').classList.contains('hidden'), false);
  assert.equal(document.getElementById('journey-splash-week').textContent, 'Week 1 · Unit 1 · Lesson 1');
  assert.equal(document.getElementById('journey-splash-title').textContent, 'Apologetics');
  assert.equal(document.getElementById('journey-splash-title').classList.contains('is-long'), false);
  assert.equal(document.getElementById('journey-splash-banner').textContent, 'Large Group Time');
  kiosk.close();
});

test('a title that does not split is shown whole, at the smaller size', async () => {
  const kiosk = bootKiosk({
    'current-lesson.json': {
      json: { ...ROUTES['current-lesson.json'].json, week: 9, title: 'A Special Evening: Questions and Answers' },
    },
  });
  for (let i = 0; i < 4; i += 1) await tick();
  kiosk.window.setView('journey');
  const title = kiosk.document.getElementById('journey-splash-title');
  assert.equal(kiosk.document.getElementById('journey-splash-week').textContent, 'Week 9');
  assert.equal(title.textContent, 'A Special Evening: Questions and Answers');
  assert.equal(title.classList.contains('is-long'), true);
  kiosk.close();
});

test('every lesson in the course splits into a short one-word name', () => {
  // The 14-character "is-long" line in showJourneyContent() is only safe if
  // no real lesson name comes near it.
  const lessons = JSON.parse(readFileSync(new URL('../public/lessons.json', import.meta.url), 'utf8'));
  const kiosk = bootKiosk(ROUTES);
  for (const lesson of lessons.lessons) {
    const { kicker, headline } = kiosk.window.splashLessonText(lesson);
    assert.match(kicker, new RegExp(`^Week ${lesson.week} · Unit ${lesson.unit} · Lesson ${lesson.lesson}$`));
    assert.match(headline, /^\S{1,12}$/, `week ${lesson.week}: "${headline}"`);
  }
  kiosk.close();
});

test('the brand fonts are asked for at startup, and nothing waits on them', async () => {
  const asked = [];
  const kiosk = bootKiosk(ROUTES, {}, PI_ZERO, (window) => {
    // A font load that never settles: the flaky evening this exists for.
    window.document.fonts = { load: (face) => (asked.push(face), new Promise(() => {})) };
  });
  assert.deepEqual(asked, ['400 1em Galindo', '400 1em "Londrina Solid"', '400 1em Figtree']);
  for (let i = 0; i < 4; i += 1) await tick();
  kiosk.window.setView('journey');
  assert.equal(
    kiosk.document.getElementById('journey-splash').classList.contains('hidden'),
    false,
    'the splash is up with the fonts still loading'
  );
  kiosk.close();

  // A browser that throws on the request, or has no font API at all, still
  // boots: the fallback faces are the only cost.
  const throwing = bootKiosk(ROUTES, {}, PI_ZERO, (window) => {
    window.document.fonts = {
      load: () => {
        throw new window.DOMException('bad font shorthand', 'SyntaxError');
      },
    };
  });
  assert.equal(typeof throwing.window.splashLessonText, 'function', 'schedule.js ran to the end');
  throwing.close();
});
