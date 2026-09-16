// The page shell: what the kiosk shows around the lesson, and what it no
// longer shows at all.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bootKiosk } from './kiosk-dom.mjs';

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
