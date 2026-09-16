// Skipping the video: the splash's "Skip to slides" button, Shift+ArrowRight,
// and the picker's slides-only pick. All three land on the same slideshow the
// end-of-video handoff runs, so what these tests care about is which mode it
// runs in and what it must never touch on the way.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bootKiosk, tick, PI_ZERO } from './kiosk-dom.mjs';

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
    {
      week: 27,
      unit: 7,
      lesson: 3,
      title: 'Unit 7, Lesson 3: Suffering',
      downloadUrl: 'https://clubs.awana.org/student-27.mp4',
      leaderDownloadUrl: null,
      captions: { student: true, leader: false },
    },
  ],
};

const CURRENT = {
  version: 2,
  week: 1,
  title: 'Unit 1, Lesson 1: Apologetics',
  sourceUrl: 'https://cdn.awana.example/student-1-original.mp4',
  downloadUrl: 'current-lesson-video.mp4',
  transcodedAt: '2026-09-15T04:00:00Z',
};

const ROUTES = {
  'current-lesson.json': { json: CURRENT },
  'lessons.json': { json: LESSONS },
};

const ANSWERED = { 'journey.captions': 'off' };

const ticks = async (n = 4) => {
  for (let i = 0; i < n; i += 1) await tick();
};

async function bootAtTheSplash(prefs = ANSWERED) {
  const kiosk = bootKiosk(ROUTES, prefs, PI_ZERO);
  await ticks();
  kiosk.window.setView('journey');
  assert.equal(
    kiosk.document.getElementById('journey-splash').classList.contains('hidden'),
    false,
    'the splash is what a leader is looking at'
  );
  return kiosk;
}

const slidesShowing = (kiosk) =>
  !kiosk.document.getElementById('slides-view').classList.contains('hidden');

function pressArrowRight(window, { shift = false } = {}) {
  window.document.dispatchEvent(
    new window.KeyboardEvent('keydown', {
      code: 'ArrowRight',
      key: 'ArrowRight',
      shiftKey: shift,
      bubbles: true,
    })
  );
}

test('the splash button shows the slides without ever attaching a video', async () => {
  const kiosk = await bootAtTheSplash();
  kiosk.document.getElementById('journey-splash-slides-btn').click();
  await ticks();

  assert.equal(slidesShowing(kiosk), true);
  assert.match(
    kiosk.document.getElementById('slide-image').getAttribute('src') || '',
    /week-01/,
    "the scheduled show's own week"
  );
  assert.equal(kiosk.video.hasAttribute('src'), false, 'the queued video is never started');
  assert.equal(kiosk.document.getElementById('journey-splash').classList.contains('hidden'), true);
  assert.equal(kiosk.window.slideshowActive(), true);
  kiosk.close();
});

test('Shift+ArrowRight skips, plain ArrowRight still begins the video', async () => {
  const shifted = await bootAtTheSplash();
  pressArrowRight(shifted.window, { shift: true });
  await ticks();
  assert.equal(slidesShowing(shifted), true);
  assert.equal(shifted.video.hasAttribute('src'), false);
  shifted.close();

  const plain = await bootAtTheSplash();
  pressArrowRight(plain.window);
  await ticks(6);
  assert.equal(slidesShowing(plain), false, 'the lesson is what a bare arrow means');
  assert.equal(plain.video.getAttribute('src'), 'current-lesson-video.mp4');
  plain.close();
});

test('skipping clears the resume mark: the lesson is being called done', async () => {
  const mark = JSON.stringify({ week: 1, t: 200, d: 600, at: Date.now() });
  const kiosk = await bootAtTheSplash({ ...ANSWERED, 'journey.resume': mark });
  // The splash is offering to resume, which is exactly the state where a skip
  // must not leave last time's position lying around.
  assert.equal(
    kiosk.document.getElementById('journey-splash-resume-btn').classList.contains('hidden'),
    false
  );

  kiosk.document.getElementById('journey-splash-slides-btn').click();
  await ticks();
  assert.equal(slidesShowing(kiosk), true);
  assert.equal(kiosk.window.localStorage.getItem('journey.resume'), null);
  kiosk.close();
});

test('the settings panel and a text field hold the shortcut off', async () => {
  const kiosk = await bootAtTheSplash();
  const { document, window } = kiosk;

  document.getElementById('settings-btn').click();
  await ticks();
  pressArrowRight(window, { shift: true });
  document.getElementById('journey-splash-slides-btn').click();
  await ticks();
  assert.equal(slidesShowing(kiosk), false, 'the panel is what the operator is using');
  document.getElementById('settings-close-btn').click();

  // A key pressed inside a real text field is text, not a shortcut.
  const field = document.createElement('textarea');
  document.body.appendChild(field);
  field.dispatchEvent(
    new window.KeyboardEvent('keydown', {
      code: 'ArrowRight',
      key: 'ArrowRight',
      shiftKey: true,
      bubbles: true,
    })
  );
  await ticks();
  assert.equal(slidesShowing(kiosk), false);
  field.remove();

  // With both out of the way it works.
  pressArrowRight(window, { shift: true });
  await ticks();
  assert.equal(slidesShowing(kiosk), true);
  kiosk.close();
});

test('the skipped show finishes back at the Check-in Display, like any lesson', async () => {
  const kiosk = await bootAtTheSplash();
  kiosk.document.getElementById('journey-splash-slides-btn').click();
  await ticks();
  assert.equal(slidesShowing(kiosk), true);

  kiosk.window.finishTeachingSlides();
  await ticks();
  assert.equal(kiosk.document.getElementById('checkin-view').classList.contains('hidden'), false);
  assert.equal(kiosk.window.slideshowActive(), false);
  kiosk.close();
});

test('the picker offers teaching slides for every week, week 27 included', async () => {
  const kiosk = bootKiosk(ROUTES, ANSWERED, PI_ZERO);
  await ticks();
  const { document, window } = kiosk;
  document.getElementById('settings-btn').click();
  await ticks();

  // Week 27 has no Leader Video, but it does have a deck.
  const rows = [...document.querySelectorAll('.settings-lesson-row')];
  rows[rows.length - 1].click();
  assert.equal(document.getElementById('settings-variant-leader').disabled, true);
  assert.equal(document.getElementById('settings-variant-slides').disabled, false);

  document.getElementById('settings-variant-slides').click();
  await ticks();
  assert.equal(slidesShowing(kiosk), true);
  assert.equal(kiosk.video.hasAttribute('src'), false, 'no video is fetched for a slides pick');
  assert.equal(document.getElementById('settings-panel').classList.contains('hidden'), true);
  assert.match(
    document.getElementById('slide-image').getAttribute('src') || '',
    /week-27/,
    'the deck is the picked week, which is what previewWeek is for'
  );

  // A preview: Finish hands back through endPreview(), and the deck shown was
  // the picked week's rather than the scheduled lesson's.
  window.finishTeachingSlides();
  await ticks();
  assert.equal(document.getElementById('checkin-view').classList.contains('hidden'), false);
  assert.equal(window.slideshowActive(), false);
  kiosk.close();
});

test('the toggle button tears a slides preview down, same as a video one', async () => {
  const kiosk = bootKiosk(ROUTES, ANSWERED, PI_ZERO);
  await ticks();
  const { document } = kiosk;
  document.getElementById('settings-btn').click();
  await ticks();
  document.querySelector('.settings-lesson-row').click();
  document.getElementById('settings-variant-slides').click();
  await ticks();
  assert.equal(slidesShowing(kiosk), true);

  document.getElementById('toggle-btn').click();
  await ticks();
  assert.equal(slidesShowing(kiosk), false);
  assert.equal(document.getElementById('checkin-view').classList.contains('hidden'), false);
  kiosk.close();
});
