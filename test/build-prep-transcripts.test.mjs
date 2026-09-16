// The build step that turns a week's prose + its VTT into the file the Read
// Prep overlay fetches. The two things worth pinning are the ones a leader
// would notice on screen: a timestamp that points at the wrong moment, and
// an "Exact words" version that is not what the VTT says.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { parseCues, exactText, buildPrepTranscript } from '../scripts/build-prep-transcripts.mjs';

const REPO = path.dirname(new URL(import.meta.url).pathname).replace(/\/test$/, '');

// Two cues on one line, one cue wrapped over two lines, a NOTE block before
// them, and an hour in the timestamps: all four shapes the real files have.
const FIXTURE_VTT = `WEBVTT

NOTE
Journey: Advocates - Week 99 Leader Video

1
00:00:06.290 --> 00:00:12.190
In 1 Peter 3:15, Peter wrote this, But in your hearts set

2
00:00:12.190 --> 00:00:18.999
apart Christ as Lord. Always be
prepared to give an answer.

3
00:01:04.500 --> 00:01:09.000
So Peter is asking us to give a reason.

4
01:00:59.900 --> 01:01:04.000
An hour in, still talking.
`;

test('parseCues maps every numbered cue to its start second and text', () => {
  const cues = parseCues(FIXTURE_VTT);
  assert.equal(cues.size, 4);
  assert.equal(cues.get(1).start, 6); // floored, not rounded
  assert.equal(cues.get(2).start, 12);
  assert.equal(cues.get(3).start, 64); // minutes carried
  assert.equal(cues.get(4).start, 3659); // hours carried
  // A cue wrapped over two lines is joined with a single space.
  assert.equal(cues.get(2).text, 'apart Christ as Lord. Always be prepared to give an answer.');
});

test('exactText joins the cue range verbatim, boundary repeats and all', () => {
  const cues = parseCues(FIXTURE_VTT);
  assert.equal(
    exactText(cues, 1, 2),
    'In 1 Peter 3:15, Peter wrote this, But in your hearts set apart Christ as Lord. ' +
      'Always be prepared to give an answer.'
  );
  assert.equal(exactText(cues, 3, 3), 'So Peter is asking us to give a reason.');
  // A range that runs past the last cue takes what exists rather than throwing.
  assert.equal(exactText(cues, 4, 9), 'An hour in, still talking.');
});

test('buildPrepTranscript takes t from the paragraph first cue and keeps both versions', () => {
  const cues = parseCues(FIXTURE_VTT);
  const data = buildPrepTranscript({
    week: 99,
    role: 'leader',
    title: 'Unit 9, Lesson 9: Fixtures',
    cues,
    prose: {
      paragraphs: [
        { fromCue: 1, toCue: 2, heading: 'The foundational verse', text: 'Peter wrote this.  ' },
        { fromCue: 3, toCue: 4, heading: null, text: 'Peter asks for a reason.' },
      ],
    },
  });
  assert.equal(data.version, 1);
  assert.equal(data.week, 99);
  assert.equal(data.role, 'leader');
  assert.equal(data.title, 'Unit 9, Lesson 9: Fixtures');
  assert.deepEqual(
    data.paragraphs.map((p) => p.t),
    [6, 64]
  );
  assert.equal(data.paragraphs[0].heading, 'The foundational verse');
  assert.equal(data.paragraphs[1].heading, null);
  assert.equal(data.paragraphs[0].edited, 'Peter wrote this.');
  assert.match(data.paragraphs[1].exact, /^So Peter is asking us to give a reason\. An hour in/);
});

test('a paragraph pointing at a cue the VTT does not have is refused', () => {
  const cues = parseCues(FIXTURE_VTT);
  assert.throws(
    () =>
      buildPrepTranscript({
        week: 99,
        role: 'leader',
        cues,
        prose: { paragraphs: [{ fromCue: 42, toCue: 43, text: 'nope' }] },
      }),
    /cue 42 is not in the VTT/
  );
});

test('the committed week 1 leader file matches what the pipeline builds today', () => {
  const served = JSON.parse(
    readFileSync(path.join(REPO, 'public', 'prep-transcripts', 'week-01-leader.json'), 'utf8')
  );
  const prose = JSON.parse(
    readFileSync(path.join(REPO, 'data', 'leader-transcript-prose.json'), 'utf8')
  ).weeks['1'];
  const cues = parseCues(
    readFileSync(path.join(REPO, 'public', 'transcripts', 'week-01-leader.vtt'), 'utf8')
  );
  const rebuilt = buildPrepTranscript({
    week: 1,
    role: 'leader',
    title: served.title,
    prose,
    cues,
  });
  assert.deepEqual(rebuilt, served);
});
