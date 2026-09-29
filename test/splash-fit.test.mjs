// The splash headline in the shout face, measured in a real browser.
//
// The lesson's name is set in Paytone One at a size tuned for the face that
// came before it (see --jr-shout-fit in style.css), and jsdom has no layout.
// So this boots the real page in Chromium (the same binary the handout
// renderer uses; set PLAYWRIGHT_CHROMIUM if yours lives elsewhere), as the Pi
// Zero kiosk (its user agent), and checks, for every lesson in the course on
// the Pi's safe-mode screen and on a 1080p TV: the shout face really is the
// one drawn, the name is one line, clear of the doodle cluster beside it and
// of the buttons under it, and an accented capital (Paytone One's reach past
// its own ascent) has nothing to be clipped by. Skipped, and says so, on a
// machine without Chromium. Every request is answered from public/ by the test
// itself: no server, no port, no network. schedule.js is not run; the test
// fills the splash the way showJourneyContent() does.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PUBLIC = path.join(path.dirname(path.dirname(fileURLToPath(import.meta.url))), 'public');
const CHROMIUM = process.env.PLAYWRIGHT_CHROMIUM || '/opt/pw-browsers/chromium';
const skip = existsSync(CHROMIUM) ? false : `no Chromium at ${CHROMIUM}`;
const TYPES = { '.html': 'text/html', '.css': 'text/css', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.ttf': 'font/ttf' };
const PI_ZERO_UA =
  'Mozilla/5.0 (X11; Linux armv6l) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/116.0.0.0 Safari/537.36';

// The Pi's safe-mode screen with and without overscan, a 720p TV and a 1080p one.
const VIEWPORTS = [
  [592, 432],
  [640, 480],
  [1280, 720],
  [1920, 1080],
];

// splashLessonText() in schedule.js: "Unit N, Lesson M: Name" -> "Name".
const headline = (title) => /^\s*Unit\s+\d+\s*,\s*Lesson\s+\d+\s*:\s*(\S.*?)\s*$/i.exec(title)[1];
const lessons = JSON.parse(readFileSync(path.join(PUBLIC, 'lessons.json'), 'utf8')).lessons;

test('every lesson name fits the splash in the shout face, on the kiosk and on a TV', { skip }, async () => {
  const { chromium } = await import('playwright-core');
  const browser = await chromium.launch({ executablePath: CHROMIUM });
  try {
    for (const [width, height] of VIEWPORTS) {
      const page = await browser.newPage({ viewport: { width, height }, userAgent: PI_ZERO_UA });
      await page.route('**/*', (route) => {
        const url = new URL(route.request().url());
        const rel = decodeURIComponent(url.pathname).replace(/^\/+/, '');
        const file = path.join(PUBLIC, rel);
        if (url.host !== 'journey.test' || rel === 'src/schedule.js' || !existsSync(file)) return route.abort();
        return route.fulfill({ body: readFileSync(file), contentType: TYPES[path.extname(file)] });
      });
      await page.goto('http://journey.test/index.html');
      const face = await page.evaluate(async () => {
        document.getElementById('checkin-view').classList.add('hidden');
        document.getElementById('journey-view').classList.remove('hidden');
        document.getElementById('journey-placeholder').classList.add('hidden');
        document.getElementById('journey-splash').classList.remove('hidden');
        await document.fonts.load('400 1em "Paytone One"');
        await document.fonts.load("400 1em 'Londrina Solid'");
        await document.fonts.ready;
        const title = document.getElementById('journey-splash-title');
        return {
          check: document.fonts.check('400 1em "Paytone One"'),
          loaded: [...document.fonts].filter((f) => f.status === 'loaded').map((f) => f.family.replace(/['"]/g, '')),
          family: getComputedStyle(title).fontFamily,
        };
      });
      const at0 = `${width}x${height}`;
      assert.ok(face.loaded.includes('Paytone One'), `${at0}: the shout face is the one that loaded (${face.loaded})`);
      assert.ok(face.check);
      assert.match(face.family, /^"?Paytone One"?,/, `${at0}: the title asks for it first`);

      const measure = (text, long, kicker) =>
        page.evaluate(
          ({ text, long, kicker }) => {
            const $ = (id) => document.getElementById(id);
            const title = $('journey-splash-title');
            $('journey-splash-week').textContent = kicker;
            title.textContent = text;
            title.classList.toggle('is-long', long);
            const box = (el) => {
              const r = el.getBoundingClientRect();
              return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, height: r.height };
            };
            const cluster = getComputedStyle($('journey-splash'), '::after');
            const clusterRight = parseFloat(cluster.left) + parseFloat(cluster.width);
            const clusterTop = parseFloat(cluster.top);
            const clusterBottom = clusterTop + parseFloat(cluster.height);
            const size = parseFloat(getComputedStyle(title).fontSize);
            const lineHeight = parseFloat(getComputedStyle(title).lineHeight);
            // Everything from the title up to the splash paints its overflow.
            const clippers = [];
            for (let el = title.parentElement; el && el !== $('journey-splash'); el = el.parentElement) {
              const cs = getComputedStyle(el);
              if (cs.overflowX !== 'visible' || cs.overflowY !== 'visible') clippers.push(el.id || el.tagName);
            }
            // Where the caps really stand: a zero-size inline box sits on the
            // baseline, and a canvas knows how far an "H" reaches above it.
            const baseline = (el) => {
              const probe = document.createElement('span');
              probe.style.cssText = 'display:inline-block;width:0;height:0;vertical-align:baseline';
              el.appendChild(probe);
              const y = probe.getBoundingClientRect().bottom;
              probe.remove();
              return y;
            };
            const ctx = document.createElement('canvas').getContext('2d');
            ctx.font = `${size}px "Paytone One"`;
            const capTop = baseline(title) - ctx.measureText('H').actualBoundingBoxAscent;
            return {
              capTop,
              kickerBase: baseline($('journey-splash-week')),
              title: box(title),
              week: box($('journey-splash-week')),
              actions: box($('journey-splash-actions')),
              splash: box($('journey-splash')),
              size,
              lineHeight,
              clusterRight,
              clusterTop,
              clusterBottom,
              clippers,
              clusterShown: cluster.display !== 'none',
            };
          },
          { text, long, kicker }
        );

      for (const lesson of lessons) {
        const name = headline(lesson.title);
        const m = await measure(name, name.length > 14, `Week ${lesson.week} · Unit ${lesson.unit} · Lesson ${lesson.lesson}`);
        const at = `${at0}, "${name}"`;
        assert.ok(m.title.height < m.lineHeight * 1.5, `${at}: one line, not a wrapped name`);
        assert.ok(m.title.left >= 0 && m.title.right <= width, `${at}: inside the screen`);
        if (m.clusterShown && m.title.top < m.clusterBottom && m.title.bottom > m.clusterTop) {
          assert.ok(m.title.left >= m.clusterRight, `${at}: clear of the doodle cluster beside it`);
        }
        // The kicker sits on the caps the way the design was drawn (about
        // .13 to .19 em of air on Galindo). Paytone One without its lift
        // leaves .3 em: the name drifts down away from the line it belongs to.
        const air = (m.capTop - m.kickerBase) / m.size;
        assert.ok(air > 0.08 && air < 0.26, `${at}: ${air.toFixed(2)} em between the kicker and the caps`);
        assert.ok(m.title.bottom <= m.actions.top, `${at}: above the buttons`);
      }

      // A title in a shape lessons.json does not use falls back to the whole
      // title at the smaller size: it may wrap, but never past the screen or
      // onto the buttons.
      const long = await measure('Special Night: A Very Long Lesson Title That Will Not Split', true, 'Week 32');
      assert.ok(long.title.left >= 0 && long.title.right <= width, `${at0}: the fallback title is inside the screen`);
      assert.ok(long.title.bottom <= long.actions.top, `${at0}: the fallback title clears the buttons`);
      if (long.clusterShown) {
        assert.ok(long.title.left >= long.clusterRight, `${at0}: the fallback title clears the doodle cluster`);
      }

      // Paytone One draws accented capitals as high as 1.16 em, above its
      // ascent (1.113 em) and far above the title's 0.98 line box. Nothing
      // between the title and the splash may clip that overhang, and the ink
      // of the tallest stack must land inside the screen.
      const stack = 'ỄẤẦẨ';
      const tall = await measure(stack, false, 'Week 4 · Unit 1 · Lesson 4');
      assert.deepEqual(tall.clippers, [], `${at0}: nothing above the title clips its overflow`);
      const inkTop = await page.evaluate((stack) => {
        const title = document.getElementById('journey-splash-title');
        const probe = document.createElement('span');
        probe.style.cssText = 'display:inline-block;width:0;height:0;vertical-align:baseline';
        title.appendChild(probe);
        const baseline = probe.getBoundingClientRect().bottom;
        probe.remove();
        const ctx = document.createElement('canvas').getContext('2d');
        ctx.font = `${getComputedStyle(title).fontSize} "Paytone One"`;
        return baseline - ctx.measureText(stack).actualBoundingBoxAscent;
      }, stack);
      assert.ok(inkTop >= 0, `${at0}: the accented capitals' ink (top at ${inkTop.toFixed(1)}px) is on screen`);
      await page.close();
    }
  } finally {
    await browser.close();
  }
});
