// Regenerate the `captions` field on every lesson in public/lessons.json
// from what actually exists in public/transcripts/. The kiosk ships this
// manifest so "does week N have a transcript?" is knowledge the page already
// has, instead of a network HEAD probe it must make (and possibly hang on)
// at the moment the operator presses play — see captionsAvailable() in
// public/src/schedule.js. Re-run after adding/removing any transcript.
//
// Usage: node scripts/update-captions-manifest.mjs
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const repoRoot = path.join(path.dirname(new URL(import.meta.url).pathname), '..');
const lessonsPath = path.join(repoRoot, 'public', 'lessons.json');
const transcriptsDir = path.join(repoRoot, 'public', 'transcripts');

const data = JSON.parse(readFileSync(lessonsPath, 'utf8'));
let changed = 0;
for (const lesson of data.lessons) {
  const wk = String(lesson.week).padStart(2, '0');
  const captions = {
    student: existsSync(path.join(transcriptsDir, `week-${wk}-student.vtt`)),
    leader: existsSync(path.join(transcriptsDir, `week-${wk}-leader.vtt`)),
  };
  if (JSON.stringify(lesson.captions) !== JSON.stringify(captions)) changed++;
  lesson.captions = captions;
}
writeFileSync(lessonsPath, JSON.stringify(data, null, 2) + '\n');
console.log(`lessons.json: captions manifest written for ${data.lessons.length} lessons (${changed} changed)`);
