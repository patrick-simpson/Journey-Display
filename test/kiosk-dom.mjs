// Boot public/index.html + public/src/schedule.js inside jsdom, so the real
// page's listeners and helpers can be exercised the way a leader exercises
// them (press the button, read the DOM) rather than by calling internals.
//
// schedule.js is a classic script, so its top-level `function` declarations
// land on `window` and are callable from a test; its `let`/`const` state
// deliberately does not, which is why the assertions below go through the
// DOM and the <video> element instead of poking at variables.
//
// Everything the kiosk's Chromium has and jsdom does not (media playback,
// object URLs, the Cache API) is stubbed here. `caches` is left UNDEFINED on
// purpose: schedule.js feature-checks it, and that is the path a fresh kiosk
// takes before anything has been stored.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { JSDOM } from 'jsdom';

const REPO = path.dirname(new URL(import.meta.url).pathname).replace(/\/test$/, '');
const PUBLIC = path.join(REPO, 'public');

export const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

// The kiosk this harness boots is the real one: a Raspberry Pi Zero, which
// detectDeviceProfile() reads as the low-power profile. A test that wants the
// page as a Mac or a laptop sees it passes `device` (see below).
export const PI_ZERO = {
  userAgent:
    'Mozilla/5.0 (X11; Linux armv6l) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/116.0.0.0 Safari/537.36',
  hardwareConcurrency: 1,
};

export const DESKTOP = {
  userAgent:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
  hardwareConcurrency: 8,
};

/**
 * @param routes  url substring -> { json } | { status } | { text }
 * @param prefs   localStorage entries seeded BEFORE schedule.js runs, the way
 *                a kiosk that has been used before comes up
 * @param device  { userAgent, hardwareConcurrency } the machine this page is
 *                running on, defaulting to the kiosk's own Pi Zero
 * @returns { dom, window, document, fetchLog, seeks, video, close }
 */
export function bootKiosk(routes = {}, prefs = {}, device = PI_ZERO) {
  const html = readFileSync(path.join(PUBLIC, 'index.html'), 'utf8').replace(
    '<script src="src/schedule.js"></script>',
    ''
  );
  const dom = new JSDOM(html, {
    url: 'https://example.test/',
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    userAgent: device.userAgent,
  });
  const { window } = dom;
  // jsdom reports 4 cores whatever it is pretending to be, and the page reads
  // this to tell a Pi from a laptop.
  Object.defineProperty(window.navigator, 'hardwareConcurrency', {
    get: () => device.hardwareConcurrency,
    configurable: true,
  });

  const fetchLog = [];
  window.fetch = (url, options = {}) => {
    const href = String(url);
    fetchLog.push({ url: href, method: (options.method || 'GET').toUpperCase() });
    const key = Object.keys(routes).find((k) => href.includes(k));
    const route = key ? routes[key] : { status: 404 };
    if (route.status && route.status >= 400) {
      return Promise.resolve(makeResponse(window, '', route.status));
    }
    const body = 'json' in route ? JSON.stringify(route.json) : route.text || '';
    return Promise.resolve(makeResponse(window, body, 200));
  };

  window.URL.createObjectURL = () => 'blob:stub';
  window.URL.revokeObjectURL = () => {};
  window.HTMLMediaElement.prototype.play = function play() {
    return Promise.resolve();
  };
  window.HTMLMediaElement.prototype.pause = function pause() {};

  // jsdom's <video> has no real media, so currentTime is stubbed on the one
  // element the page owns. The seeks array is what the tests read.
  const video = window.document.getElementById('journey-video');
  const seeks = [];
  let currentTime = 0;
  Object.defineProperty(video, 'currentTime', {
    get: () => currentTime,
    set: (t) => {
      currentTime = t;
      seeks.push(t);
    },
    configurable: true,
  });
  Object.defineProperty(video, 'duration', { get: () => 600, configurable: true });

  for (const [key, value] of Object.entries(prefs)) window.localStorage.setItem(key, value);

  const script = window.document.createElement('script');
  script.textContent = readFileSync(path.join(PUBLIC, 'src', 'schedule.js'), 'utf8');
  window.document.body.appendChild(script);

  // schedule.js sets a 15s poll and an hourly refresh; without closing the
  // window those keep the test process alive forever.
  const close = () => window.close();
  return { dom, window, document: window.document, fetchLog, seeks, video, close };
}

function makeResponse(window, body, status) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: () => Promise.resolve(body),
    json: () => Promise.resolve(JSON.parse(body)),
    blob: () => Promise.resolve(new window.Blob([body])),
  };
}
