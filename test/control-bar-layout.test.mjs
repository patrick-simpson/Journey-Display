// The video control bar's two-row layout, measured in a real browser.
//
// Below 1100px the bar wraps: the scrubber and the time readout own the first
// row and every pill sits together on the next. jsdom has no layout, so this
// one boots the real page in Chromium (the same binary the handout renderer
// uses; set PLAYWRIGHT_CHROMIUM if yours lives elsewhere) and is skipped on a
// machine without it. Every request is answered from public/ by the test
// itself, so it needs no server, no port and no network. schedule.js is not
// run: what is under test is the stylesheet, with the kit's fonts loaded.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PUBLIC = path.join(path.dirname(path.dirname(fileURLToPath(import.meta.url))), 'public');
const CHROMIUM = process.env.PLAYWRIGHT_CHROMIUM || '/opt/pw-browsers/chromium';
const skip = existsSync(CHROMIUM) ? false : `no Chromium at ${CHROMIUM}`;
const TYPES = { '.html': 'text/html', '.css': 'text/css', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' };
const PILLS = ['back15-btn', 'pause-btn', 'fwd15-btn', 'unmute-btn', 'cc-btn'];

// The Pi's safe-mode screen with and without overscan, then the other
// screens under the breakpoint, a phone held sideways among them.
const VIEWPORTS = [
  [592, 432],
  [640, 480],
  [800, 600],
  [844, 390],
  [1024, 768],
];
// Elapsed only (the whole "Loading video…" wait, or a stream with no
// duration), then the readouts once the duration is known.
const READOUTS = ['0:00', '0:02 / 5:31', '12:45 / 15:02'];

test('below 1100px the pills never join the scrubber row, whatever the readout says', { skip }, async () => {
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
      await page.evaluate(async () => {
        document.getElementById('checkin-view').classList.add('hidden');
        document.getElementById('journey-view').classList.remove('hidden');
        document.getElementById('video-controls').classList.remove('hidden');
        document.getElementById('cc-btn').classList.remove('hidden');
        await document.fonts.load("400 16px 'Londrina Solid'");
        await document.fonts.load("600 16px 'Figtree'");
      });

      let pillRows = null;
      for (const readout of READOUTS) {
        const at = `${width}x${height}, readout "${readout}"`;
        const bar = await page.evaluate(
          ({ readout, pills }) => {
            document.getElementById('video-time').textContent = readout;
            const box = (id) => document.getElementById(id).getBoundingClientRect();
            const scrubber = box('video-scrubber');
            const time = box('video-time');
            return {
              scrubberMid: (scrubber.top + scrubber.bottom) / 2,
              timeMid: (time.top + time.bottom) / 2,
              firstRowBottom: Math.max(scrubber.bottom, time.bottom),
              pills: pills.map((id) => box(id).top),
            };
          },
          { readout, pills: PILLS }
        );
        assert.ok(Math.abs(bar.timeMid - bar.scrubberMid) < 2, `${at}: the readout shares the scrubber's row`);
        bar.pills.forEach((top, i) =>
          assert.ok(top >= bar.firstRowBottom, `${at}: ${PILLS[i]} is below the scrubber row, not on it`)
        );
        assert.equal(new Set(bar.pills).size, 1, `${at}: the pills share one row`);
        // The bar must not rearrange itself when the duration arrives.
        pillRows ??= bar.pills;
        assert.deepEqual(bar.pills, pillRows, `${at}: no pill moved when the readout changed`);
      }
      await page.close();
    }
  } finally {
    await browser.close();
  }
});
