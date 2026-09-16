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
