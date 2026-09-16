// Generate public/prep-transcripts/week-NN-<role>.json: each lesson video's
// transcript in the two forms the kiosk's Read Prep overlay offers:
//
//   "edited"  the readable prose from data/<role>-transcript-prose.json (the
//             same text the Leader Handout prints), and
//   "exact"   the verbatim cue text from public/transcripts/week-NN-<role>.vtt,
//             joined with single spaces and NOT cleaned up in any way.
//
// WHY BOTH: a leader skimming to prepare wants the edited prose; a leader
// checking what was actually said (or reading along with the video) wants the
// words. The owner asked for the transcript on screen, so the edited prose is
// now served per week. data/*-transcript-prose.json stays the single
// hand-edited build input, and the handout pipeline is unchanged.
//
// Each paragraph carries `t`, the start time in seconds of its first cue, so
// the overlay can offer a tappable timestamp that starts that video there.
// Same mapping the printed handout uses (see cueStarts() in
// scripts/render-leader-handouts.mjs).
//
// PER-WEEK FILES, on purpose: public/leader-prep.json stays the small file
// warmed at startup, and a transcript (tens of KB) is fetched only when a
// leader actually expands one. The current week's two files ride the kiosk's
// prefetched bundle, so tonight's lesson reads offline.
//
// A role whose prose fails scripts/validate-transcript-prose.py is NOT
// written: a gap in the paragraph tiling means a dropped passage, and half a
// transcript in front of a leader is worse than none. A role whose prose file
// does not exist yet is skipped quietly.
//
// Usage: node scripts/build-prep-transcripts.mjs [role ...]   (default: both)
//        (also run by scripts/build-leader-prep.mjs, so the served copies
//         cannot drift from the data they came from)
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const REPO = path.dirname(path.dirname(new URL(import.meta.url).pathname));
const OUT_DIR = path.join(REPO, 'public', 'prep-transcripts');
const ROLES = ['leader', 'student'];

const pad = (week) => String(week).padStart(2, '0');

export const prosePathFor = (role) => path.join(REPO, 'data', `${role}-transcript-prose.json`);
export const vttPathFor = (week, role) =>
  path.join(REPO, 'public', 'transcripts', `week-${pad(week)}-${role}.vtt`);
export const outPathFor = (week, role) => path.join(OUT_DIR, `week-${pad(week)}-${role}.json`);

/* Parse a WebVTT into `cue number -> { start, text }`.
   Cues in these files are numbered, which is what the prose indexes; a cue
   body can run to several lines, so they are joined with a single space.
   NOTE blocks and the WEBVTT header carry no number+timing pair, so the
   "digits then a line containing -->" test skips them. */
export function parseCues(vttText) {
  const lines = vttText.split(/\r?\n/);
  const cues = new Map();
  for (let i = 0; i < lines.length; i++) {
    const num = lines[i].trim();
    const timing = (lines[i + 1] || '').trim();
    if (!/^\d+$/.test(num) || !timing.includes('-->')) continue;
    const [h, m, s] = timing.split('-->')[0].trim().split(':');
    const start = Math.floor(Number(h) * 3600 + Number(m) * 60 + parseFloat(s));
    const body = [];
    let j = i + 2;
    for (; j < lines.length && lines[j].trim() !== ''; j++) body.push(lines[j].trim());
    cues.set(Number(num), { start, text: body.join(' ').replace(/\s+/g, ' ').trim() });
    i = j;
  }
  return cues;
}

/* The verbatim words of cues from..to, joined with single spaces. Boundary
   repeats (the same word ending one cue and starting the next, which
   condition_on_previous_text=False produces) are left alone: "Exact words"
   has to be exactly what the VTT says, or it is just a second edit. */
export function exactText(cues, from, to) {
  const parts = [];
  for (let n = from; n <= to; n++) {
    const cue = cues.get(n);
    if (cue && cue.text) parts.push(cue.text);
  }
  return parts.join(' ');
}

/** The served shape: { version, week, role, title, paragraphs[] }. Pure. */
export function buildPrepTranscript({ week, role, title, prose, cues }) {
  const paragraphs = [];
  for (const p of prose.paragraphs) {
    const cue = cues.get(p.fromCue);
    if (!cue) throw new Error(`week ${week} ${role}: cue ${p.fromCue} is not in the VTT`);
    paragraphs.push({
      t: cue.start,
      heading: p.heading || null,
      edited: String(p.text || '').trim(),
      exact: exactText(cues, p.fromCue, p.toCue),
    });
  }
  return { version: 1, week, role, title: title || '', paragraphs };
}

function lessonTitles() {
  const titles = new Map();
  const file = path.join(REPO, 'public', 'lessons.json');
  if (!existsSync(file)) return titles;
  for (const lesson of JSON.parse(readFileSync(file, 'utf8')).lessons || []) {
    if (lesson && typeof lesson.week === 'number') titles.set(lesson.week, lesson.title || '');
  }
  return titles;
}

/* The prose validator is the gate. It is the mechanical check that the
   paragraphs tile the cue numbers with no gap, that the edited text was
   edited rather than summarized, and that no Scripture reference was
   invented. Publishing prose that fails it would put exactly those errors on
   a screen in front of a leader. */
function validateProse(role) {
  const res = spawnSync(
    'python3',
    [path.join(REPO, 'scripts', 'validate-transcript-prose.py'), '--role', role],
    { encoding: 'utf8' }
  );
  if (res.error) throw res.error;
  if (res.status !== 0) {
    const tail = `${res.stdout || ''}${res.stderr || ''}`.trim().split('\n').slice(-12).join('\n');
    throw new Error(`${role} prose failed validate-transcript-prose.py:\n${tail}`);
  }
}

export function writePrepTranscriptsFor(role, { validate = true } = {}) {
  const prosePath = prosePathFor(role);
  if (!existsSync(prosePath)) {
    console.log(`prep-transcripts: no ${path.relative(REPO, prosePath)} yet, skipping ${role}`);
    return [];
  }
  if (validate) validateProse(role);
  const weeks = JSON.parse(readFileSync(prosePath, 'utf8')).weeks;
  const titles = lessonTitles();
  mkdirSync(OUT_DIR, { recursive: true });
  const written = [];
  for (const key of Object.keys(weeks).sort((a, b) => Number(a) - Number(b))) {
    const week = Number(weeks[key].week ?? key);
    const cues = parseCues(readFileSync(vttPathFor(week, role), 'utf8'));
    const data = buildPrepTranscript({
      week,
      role,
      title: titles.get(week),
      prose: weeks[key],
      cues,
    });
    writeFileSync(outPathFor(week, role), `${JSON.stringify(data)}\n`);
    written.push(week);
  }
  // A week dropped from the prose must not leave a stale file being served.
  const keep = new Set(written.map((w) => `week-${pad(w)}-${role}.json`));
  for (const name of readdirSync(OUT_DIR)) {
    if (name.endsWith(`-${role}.json`) && !keep.has(name)) rmSync(path.join(OUT_DIR, name));
  }
  console.log(
    `prep-transcripts: ${written.length} ${role} week${written.length === 1 ? '' : 's'} → ` +
      `${path.relative(REPO, OUT_DIR)}/`
  );
  return written;
}

export function writePrepTranscripts(roles = ROLES, options) {
  const out = {};
  for (const role of roles) out[role] = writePrepTranscriptsFor(role, options);
  return out;
}

// Run directly (node scripts/build-prep-transcripts.mjs) but stay importable.
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  const asked = process.argv.slice(2).filter((a) => ROLES.includes(a));
  writePrepTranscripts(asked.length ? asked : ROLES);
}
