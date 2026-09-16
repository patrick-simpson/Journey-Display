// The Read Prep overlay's transcript, driven through the real page: press the
// gear, pick a lesson, pick a role, press the button, read what is on screen.
// Calling renderPrep() directly would have missed the wiring, which is the
// part that has broken before (see the teaching-slides note in CLAUDE.md).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bootKiosk, tick } from './kiosk-dom.mjs';

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

const LEADER_PREP = {
  version: 1,
  weeks: {
    1: {
      week: 1,
      title: 'Unit 1, Lesson 1: Apologetics',
      bigIdea: 'Be ready to give a reason.',
      keyPoints: ['Apologetics is a defense.'],
      scriptures: ['1 Peter 3:15'],
      questions: ['What is a reason you believe?'],
    },
  },
};

const transcript = (role) => ({
  version: 1,
  week: 1,
  role,
  title: 'Unit 1, Lesson 1: Apologetics',
  paragraphs: [
    {
      t: 6,
      heading: 'The foundational verse',
      edited: `Edited ${role} paragraph one.`,
      exact: `Exact ${role} paragraph one`,
    },
    { t: 252, heading: null, edited: `Edited ${role} paragraph two.`, exact: `Exact ${role} two` },
  ],
});

const ROUTES = {
  'lessons.json': { json: LESSONS },
  'leader-prep.json': { json: LEADER_PREP },
  'prep-transcripts/week-01-leader.json': { json: transcript('leader') },
  'prep-transcripts/week-01-student.json': { json: transcript('student') },
};

// The caption prompt asks once per device and would otherwise sit in front of
// every playback path here; a kiosk that has been used before has answered.
const ANSWERED = { 'journey.captions': 'off' };

async function openPicker(kiosk) {
  const { document } = kiosk;
  document.getElementById('settings-btn').click();
  await tick();
  document.querySelector('.settings-lesson-row').click();
}

async function openPrepVia(kiosk, role) {
  const { document } = kiosk;
  await openPicker(kiosk);
  document.getElementById(`settings-variant-${role}`).click();
  document.getElementById(`settings-${role}-prep`).click();
  await tick();
  await tick();
}

test('formatTime renders the m:ss a timestamp button shows', () => {
  const kiosk = bootKiosk(ROUTES, ANSWERED);
  const { formatTime } = kiosk.window;
  assert.equal(formatTime(0), '0:00');
  assert.equal(formatTime(6), '0:06');
  assert.equal(formatTime(65), '1:05');
  assert.equal(formatTime(252), '4:12');
  assert.equal(formatTime(3661), '61:01'); // no hours field; a lesson is minutes long
  assert.equal(formatTime(9.9), '0:09'); // floored, never rounded past the moment
  assert.equal(formatTime(-5), '0:00');
  assert.equal(formatTime(NaN), '0:00');
  kiosk.close();
});

test('a leader Read Prep shows the summary with the transcript collapsed', async () => {
  const kiosk = bootKiosk(ROUTES, ANSWERED);
  await openPrepVia(kiosk, 'leader');
  const { document } = kiosk;
  assert.equal(document.getElementById('prep-view').classList.contains('hidden'), false);
  assert.match(document.getElementById('prep-title').textContent, /Week 1 .* \(Leader Prep\)$/);
  assert.match(document.getElementById('prep-body').textContent, /Be ready to give a reason\./);
  const toggle = document.querySelector('.prep-transcript-toggle');
  assert.equal(toggle.textContent, 'Read the full transcript');
  assert.equal(toggle.getAttribute('aria-expanded'), 'false');
  assert.equal(document.querySelectorAll('.prep-para').length, 0);
  kiosk.close();
});

test('expanding shows the edited paragraphs, and Exact words swaps them with no fetch', async () => {
  const kiosk = bootKiosk(ROUTES, ANSWERED);
  await openPrepVia(kiosk, 'leader');
  const { document, fetchLog } = kiosk;
  document.querySelector('.prep-transcript-toggle').click();
  // The mode row is up before anything is awaited: a press has to change the
  // screen this frame, network or no network.
  assert.equal(document.querySelectorAll('.prep-mode-btn').length, 2);
  assert.match(document.querySelector('.prep-transcript-body').textContent, /Loading transcript/);
  await tick();
  await tick();

  const paras = [...document.querySelectorAll('.prep-para-text')].map((el) => el.textContent);
  assert.deepEqual(paras, ['Edited leader paragraph one.', 'Edited leader paragraph two.']);
  assert.equal(document.querySelector('.prep-para-heading').textContent, 'The foundational verse');
  const stamps = [...document.querySelectorAll('.prep-time')].map((el) => el.textContent);
  assert.deepEqual(stamps, ['0:06', '4:12']);

  const [edited, exact] = document.querySelectorAll('.prep-mode-btn');
  assert.equal(edited.getAttribute('aria-pressed'), 'true');
  assert.equal(exact.getAttribute('aria-pressed'), 'false');

  const before = fetchLog.length;
  exact.click();
  assert.equal(fetchLog.length, before, 'switching versions must not fetch anything');
  assert.deepEqual(
    [...document.querySelectorAll('.prep-para-text')].map((el) => el.textContent),
    ['Exact leader paragraph one', 'Exact leader two']
  );
  assert.equal(exact.getAttribute('aria-pressed'), 'true');
  assert.equal(edited.getAttribute('aria-pressed'), 'false');
  assert.equal(kiosk.window.localStorage.getItem('journey.prep.transcriptMode'), 'exact');

  // Collapsing drops the paragraphs from the DOM again.
  document.querySelector('.prep-transcript-toggle').click();
  assert.equal(document.querySelectorAll('.prep-para').length, 0);
  kiosk.close();
});

test('the stored version preference is what a later open starts in', async () => {
  const kiosk = bootKiosk(ROUTES, { ...ANSWERED, 'journey.prep.transcriptMode': 'exact' });
  await openPrepVia(kiosk, 'leader');
  kiosk.document.querySelector('.prep-transcript-toggle').click();
  await tick();
  await tick();
  assert.deepEqual(
    [...kiosk.document.querySelectorAll('.prep-para-text')].map((el) => el.textContent),
    ['Exact leader paragraph one', 'Exact leader two']
  );
  kiosk.close();
});

test('a Student Read Prep has no summary and opens expanded', async () => {
  const kiosk = bootKiosk(ROUTES, ANSWERED);
  await openPrepVia(kiosk, 'student');
  const { document } = kiosk;
  assert.match(document.getElementById('prep-title').textContent, /\(Student Prep\)$/);
  assert.match(document.getElementById('prep-body').textContent, /Summaries live under the Leader/);
  assert.doesNotMatch(document.getElementById('prep-body').textContent, /Big Idea/);
  assert.equal(document.querySelector('.prep-transcript-toggle').getAttribute('aria-expanded'), 'true');
  assert.deepEqual(
    [...document.querySelectorAll('.prep-para-text')].map((el) => el.textContent),
    ['Edited student paragraph one.', 'Edited student paragraph two.']
  );
  kiosk.close();
});

test('a transcript that will not download says so in place', async () => {
  const kiosk = bootKiosk({ ...ROUTES, 'prep-transcripts/week-01-leader.json': { status: 404 } }, ANSWERED);
  await openPrepVia(kiosk, 'leader');
  kiosk.document.querySelector('.prep-transcript-toggle').click();
  await tick();
  await tick();
  assert.match(
    kiosk.document.querySelector('.prep-transcript-body').textContent,
    /hasn’t downloaded to this device yet/
  );
  // The summary above it is untouched.
  assert.match(kiosk.document.getElementById('prep-body').textContent, /Be ready to give a reason\./);
  kiosk.close();
});

test('pressing a timestamp closes prep and seeks that video there', async () => {
  const kiosk = bootKiosk(ROUTES, ANSWERED);
  await openPrepVia(kiosk, 'leader');
  const { document, video, seeks } = kiosk;
  document.querySelector('.prep-transcript-toggle').click();
  await tick();
  await tick();

  document.querySelectorAll('.prep-time')[1].click();
  // Acknowledge first: the overlay is gone and the Journey layer is up before
  // anything has been awaited.
  assert.equal(document.getElementById('prep-view').classList.contains('hidden'), true);
  assert.equal(document.getElementById('journey-view').classList.contains('hidden'), false);
  assert.equal(document.getElementById('journey-loading').classList.contains('hidden'), false);
  await tick();
  await tick();

  assert.match(video.getAttribute('src'), /week-01-leader\.mp4$/);
  assert.deepEqual(seeks, [], 'nothing may be seeked before the media reports its duration');
  video.dispatchEvent(new kiosk.window.Event('loadedmetadata'));
  assert.deepEqual(seeks, [252]);

  // One permanent listener, one seek: a second loadedmetadata (a source
  // switching, a reload) must not re-seek a video the leader has moved on in.
  video.dispatchEvent(new kiosk.window.Event('loadedmetadata'));
  assert.deepEqual(seeks, [252]);
  kiosk.close();
});

test('a seek armed by a superseded request never lands on the newer video', async () => {
  const kiosk = bootKiosk(ROUTES, ANSWERED);
  await openPrepVia(kiosk, 'student');
  const { document, video, seeks } = kiosk;
  document.querySelectorAll('.prep-time')[1].click();
  await tick();
  await tick();
  assert.match(video.getAttribute('src'), /week-01-student\.mp4$/);

  // Whatever supersedes it (the view-toggle button, the 7:15 boundary, a
  // newer pick) bumps journeyRequestToken through stopJourneyContent().
  kiosk.window.stopJourneyContent();
  video.dispatchEvent(new kiosk.window.Event('loadedmetadata'));
  assert.deepEqual(seeks, []);
  kiosk.close();
});

test('the Student path asks video or prep, and Back returns to the roles', async () => {
  const kiosk = bootKiosk(ROUTES, ANSWERED);
  const { document } = kiosk;
  await openPicker(kiosk);
  assert.equal(document.getElementById('settings-variant-picker').classList.contains('hidden'), false);
  document.getElementById('settings-variant-student').click();
  assert.equal(document.getElementById('settings-variant-picker').classList.contains('hidden'), true);
  assert.equal(document.getElementById('settings-student-picker').classList.contains('hidden'), false);
  assert.match(document.getElementById('settings-student-prompt').textContent, /video or prep\?$/);

  document.getElementById('settings-student-back').click();
  assert.equal(document.getElementById('settings-student-picker').classList.contains('hidden'), true);
  assert.equal(document.getElementById('settings-variant-picker').classList.contains('hidden'), false);

  // Watch Video still goes straight to the Student Video.
  document.getElementById('settings-variant-student').click();
  document.getElementById('settings-student-video').click();
  await tick();
  await tick();
  assert.match(kiosk.video.getAttribute('src'), /week-01-student\.mp4$/);
  assert.deepEqual(kiosk.seeks, [], 'a plain Watch Video starts at the top');
  kiosk.video.dispatchEvent(new kiosk.window.Event('loadedmetadata'));
  assert.deepEqual(kiosk.seeks, []);
  kiosk.close();
});

test('the current week bundle asks for both roles transcripts', async () => {
  const kiosk = bootKiosk(ROUTES, ANSWERED);
  await tick();
  // cacheLessonBundle() is a no-op without the Cache API (this jsdom has
  // none), so the URL builder is what is worth pinning here.
  assert.equal(kiosk.window.prepTranscriptUrl(1, 'leader'), 'prep-transcripts/week-01-leader.json');
  assert.equal(kiosk.window.prepTranscriptUrl(27, 'student'), 'prep-transcripts/week-27-student.json');
  kiosk.close();
});
