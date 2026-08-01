#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────
// Nightly "current lesson" resolver (run by
// .github/workflows/update-lesson.yml, or by hand):
//
//   node scripts/fetch-current-lesson.mjs
//   node scripts/fetch-current-lesson.mjs --from-file sample.html
//   node scripts/fetch-current-lesson.mjs --url https://… --out public/current-lesson.json
//
// Fetches the church's TwoTimTwo "current lesson" view and figures out
// which Journey: Advocates lesson that corresponds to, then writes
// public/current-lesson.json. The actual video files are NOT touched
// here — that's public/lessons.json's fixed week->video map, built
// from https://clubs.awana.org/ym-course/advocates/ (see CLAUDE.md).
//
// Verified DOM contract for `?current_only=Y` (confirmed against a
// real saved response — this is a DIFFERENT page/template than the
// general church calendar the sibling Awana-Check-in-Display repo
// scrapes, which uses `.dayline` divs; this one is a per-club "current
// book track" table):
//
//   <table class="table-striped">
//     <thead><tr><td>Club</td><td>Book Track</td><td>Section</td><td>Special</td></tr></thead>
//     <tbody>
//       <tr class="book-track-mtg">
//         <td>Journey</td>
//         <td>Journey: Advocates</td>
//         <td><b>Faith Foundations #7</b></td>
//         <td></td>
//       </tr>
//       … one row per club …
//     </tbody>
//   </table>
//
// The row is matched by "Book Track" containing "advocates" (not by
// club name, in case that's ever renamed). "Faith Foundations #7" is
// TwoTimTwo's own generic section-counter label — it does NOT match
// the Advocates page's own "Unit N, Lesson M" numbering by name, but
// verified against a real sample, the trailing "#N" is a flat 1..32
// count through the course in the same order as lessons.json's `week`
// field (Unit 1 Lesson 1..4 = weeks 1-4, Unit 2 = weeks 5-8, …), so
// "#7" = week 7 = Unit 2, Lesson 3. Spot-check this mapping against
// the real page if TwoTimTwo's book-track setup ever changes.
//
// Safety rail, same as fetch-calendar.mjs: refuse (exit 1) rather than
// overwrite a good file with an unconfident parse — a bad night here
// means the display keeps yesterday's lesson, not a wrong one.
// ─────────────────────────────────────────────────────────────

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { JSDOM } from 'jsdom';

const DEFAULT_URL = 'https://kvbchurch.twotimtwo.com/calendar/index?current_only=Y';
const DEFAULT_LESSONS = 'public/lessons.json';
const DEFAULT_OUT = 'public/current-lesson.json';
const HEARTBEAT_DAYS = 7;

function arg(flag) {
  const i = process.argv.indexOf(flag);
  return i !== -1 ? process.argv[i + 1] : undefined;
}

async function fetchWithRetry(url, attempts = 3) {
  let lastError;
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(30000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.text();
    } catch (err) {
      lastError = err;
      if (i < attempts - 1) await new Promise((r) => setTimeout(r, 2000 * (i + 1)));
    }
  }
  throw lastError;
}

/** Find the Advocates row in the "current book track" table and
 * return its Section text (e.g. "Faith Foundations #7"), or null if
 * the table/row isn't there in the shape we expect. */
function extractSectionText(html) {
  const doc = new JSDOM(html).window.document;
  for (const row of doc.querySelectorAll('tr.book-track-mtg')) {
    const cells = row.querySelectorAll('td');
    if (cells.length < 3) continue;
    const bookTrack = cells[1].textContent?.trim() || '';
    if (!/advocates/i.test(bookTrack)) continue;
    const section = cells[2].querySelector('b')?.textContent?.trim() || cells[2].textContent?.trim();
    if (section) return section;
  }
  return null;
}

/** "Faith Foundations #7" (or any "<label> #N") -> week N. */
function matchLesson(text, lessons) {
  if (!text || !Array.isArray(lessons) || lessons.length === 0) return null;
  const m = text.match(/#\s*(\d{1,2})\s*$/);
  if (!m) return null;
  const week = Number(m[1]);
  return lessons.find((l) => l.week === week) || null;
}

const url = arg('--url') || DEFAULT_URL;
const lessonsPath = arg('--lessons') || DEFAULT_LESSONS;
const out = arg('--out') || DEFAULT_OUT;
const fromFile = arg('--from-file');

if (!existsSync(lessonsPath)) {
  console.error(`${lessonsPath} not found — nothing to match the current lesson against.`);
  process.exit(1);
}
const lessonsData = JSON.parse(readFileSync(lessonsPath, 'utf8'));
const lessons = Array.isArray(lessonsData?.lessons) ? lessonsData.lessons : [];
if (lessons.length === 0) {
  console.error(
    `${lessonsPath} has no lessons yet — populate it from the Advocates page before running this.`
  );
  process.exit(1);
}

const html = fromFile ? readFileSync(fromFile, 'utf8') : await fetchWithRetry(url);
const sectionText = extractSectionText(html);

if (!sectionText) {
  console.error(
    'Could not find the Journey: Advocates row in the "current book track" table — refusing to ' +
    `overwrite ${out}. The page layout may have changed (see the comment at the top of this file).`
  );
  process.exit(1);
}

const lesson = matchLesson(sectionText, lessons);
if (!lesson) {
  console.error(
    `Extracted "${sectionText}" but couldn't resolve a week number from it, or it doesn't match ` +
    `any entry in ${lessonsPath} — refusing to overwrite ${out}.`
  );
  process.exit(1);
}

let existing = null;
if (existsSync(out)) {
  try {
    existing = JSON.parse(readFileSync(out, 'utf8'));
  } catch {
    existing = null; // corrupt feed → always rewrite
  }
}

const ageMs = existing?.resolvedAt ? Date.now() - Date.parse(existing.resolvedAt) : Infinity;
const heartbeatDue = !(ageMs < HEARTBEAT_DAYS * 24 * 60 * 60 * 1000);
const unchanged = existing && existing.week === lesson.week;

if (unchanged && !heartbeatDue) {
  console.log(`No change (still week ${lesson.week}) — ${out} untouched.`);
  process.exit(0);
}

const feed = {
  version: 1,
  week: lesson.week,
  title: lesson.title,
  downloadUrl: lesson.downloadUrl,
  resolvedAt: new Date().toISOString(),
};
writeFileSync(out, `${JSON.stringify(feed, null, 2)}\n`);
console.log(
  `Wrote ${out}: week ${lesson.week} — "${lesson.title}" (from "${sectionText}")` +
  `${unchanged ? ' (heartbeat refresh)' : ''}.`
);
