// The corner buttons over the Check-in Display, measured in a real browser:
// the column the embedded display keeps clear.
//
// The ⇄ view toggle and the ⚙ settings gear float over the Check-in
// Display's iframe all through the check-in phase, and a frame can never
// paint over its parent. The two sides agree on where the buttons go: while
// the display shows, both sit in ONE column in the bottom-right corner (the
// gear stacked 8px above the toggle), 48px wide, max(3vw, 24px) in from the
// right edge, the toggle max(3vh, 24px) up from the bottom, in a frame that
// fills the viewport from 0,0 (so its 1vw is ours). The display, finding
// itself framed, keeps its corner chip, its ticker and a long child's name
// out of that column; the top-right is its own (its status sticker and
// weather chip are measured to the pixel there). Its copy of the column is
// HOST_CONTROL in its src/lib/embed.js (see "The corner-button contract" in
// CLAUDE.md). Moving a button out of the column, or back into the display's
// top-right, fails here. Elsewhere the gear keeps the top-right, as it always
// has. Like control-bar-layout.test.mjs: Chromium, every request answered
// from public/ by the test, schedule.js not run.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PUBLIC = path.join(path.dirname(path.dirname(fileURLToPath(import.meta.url))), 'public');
const CHROMIUM = process.env.PLAYWRIGHT_CHROMIUM || '/opt/pw-browsers/chromium';
const skip = existsSync(CHROMIUM) ? false : `no Chromium at ${CHROMIUM}`;
const TYPES = { '.html': 'text/html', '.css': 'text/css', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' };

// The Pi's safe-mode screen with and without overscan, then 720p and 1080p.
const VIEWPORTS = [
  [592, 432],
  [640, 480],
  [1280, 720],
  [1920, 1080],
];

/** Where each button belongs, in px: over the display, and over everything else. */
function expected(vw, vh) {
  const right = Math.max(0.03 * vw, 24);
  const edge = Math.max(0.03 * vh, 24);
  const x = { left: vw - right - 48, right: vw - right };
  const toggle = { ...x, top: vh - edge - 48, bottom: vh - edge };
  return {
    checkin: { 'toggle-btn': toggle, 'settings-btn': { ...x, top: toggle.top - 8 - 48, bottom: toggle.top - 8 } },
    journey: { 'toggle-btn': toggle, 'settings-btn': { ...x, top: edge, bottom: edge + 48 } },
  };
}

const near = (a, b) => Math.abs(a - b) <= 0.5;

test('over the Check-in Display both corner buttons keep to the one bottom-right column it leaves them', { skip }, async () => {
  const { chromium } = await import('playwright-core');
  const browser = await chromium.launch({ executablePath: CHROMIUM });
  try {
    for (const [width, height] of VIEWPORTS) {
      const page = await browser.newPage({ viewport: { width, height } });
      await page.route('**/*', (route) => {
        const url = new URL(route.request().url());
        const rel = decodeURIComponent(url.pathname).replace(/^\/+/, '');
        const file = path.join(PUBLIC, rel);
        if (url.host !== 'journey.test' || rel === 'src/schedule.js' || !existsSync(file)) return route.abort();
        return route.fulfill({ body: readFileSync(file), contentType: TYPES[path.extname(file)] });
      });
      await page.goto('http://journey.test/index.html');
      const measure = () => page.evaluate(() => {
        const box = (id) => {
          const r = document.getElementById(id).getBoundingClientRect();
          return { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
        };
        return { frame: box('checkin-frame'), 'settings-btn': box('settings-btn'), 'toggle-btn': box('toggle-btn') };
      });
      const want = expected(width, height);

      // The page opens on the Check-in Display (schedule.js not run).
      const over = await measure();
      const at = `${width}x${height}, over the Check-in Display`;
      // The frame IS the viewport, so the display's own vw / vh are this page's.
      assert.deepEqual(over.frame, { left: 0, top: 0, right: width, bottom: height }, `${at}: the iframe fills the viewport`);
      for (const id of ['toggle-btn', 'settings-btn']) {
        for (const side of ['left', 'top', 'right', 'bottom']) {
          assert.ok(near(over[id][side], want.checkin[id][side]), `${at}: #${id} ${side} is ${over[id][side]}, want ${want.checkin[id][side]}`);
        }
      }

      // Anywhere else the gear is back in the top-right, where it always was.
      await page.evaluate(() => {
        document.getElementById('checkin-view').classList.add('hidden');
        document.getElementById('journey-view').classList.remove('hidden');
      });
      const away = await measure();
      for (const id of ['toggle-btn', 'settings-btn']) {
        for (const side of ['left', 'top', 'right', 'bottom']) {
          assert.ok(near(away[id][side], want.journey[id][side]), `${width}x${height}, Journey view: #${id} ${side} is ${away[id][side]}, want ${want.journey[id][side]}`);
        }
      }
      await page.close();
    }
  } finally {
    await browser.close();
  }
});
