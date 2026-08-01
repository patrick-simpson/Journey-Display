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
// club name, in case that's ever renamed).
//
// IMPORTANT — "Faith Foundations" is TwoTimTwo/Awana's generic
// "entrance gate" onboarding sequence every club runs through BEFORE
// starting their assigned book — it is NOT the Advocates book itself,
// despite appearing under the "Journey: Advocates" Book Track. So
// "Faith Foundations #7" means "7 weeks into the entrance gate," not
// "week 7 of Advocates." While a club is still in the entrance gate,
// there is no real "current lesson" to resolve from TwoTimTwo yet — by
// request, this defaults to week 1 (the first Advocates video) during
// that period, rather than leaving the display blank, so there's
// always something to show; it's an explicit default, not a match.
//
// Once a club finishes the entrance gate, the Section text becomes
// "Unit N #M" — VERIFIED against this church's own full-year schedule
// (fetched `?current_only=N`, which returns one book-track table per
// scheduled meeting date for the whole year): the Journey club's last
// entrance-gate meeting is "Faith Foundations #7" (2026-09-02), then
// the very next meeting (2026-09-09) is "Unit 1 #1", continuing in
// lockstep with the Advocates page's own numbering all the way to
// "Unit 8 #4" (2027-05-19). So "Unit N #M" maps directly to
// lessons.json's `unit`/`lesson` fields — no flat 1..32 counting
// needed, unlike an earlier, wrong guess this script used to make.
//
// Safety rail, same as fetch-calendar.mjs: refuse (exit 1) rather than
// overwrite a good file with an unconfident parse — a bad night here
// means the display keeps yesterday's lesson, not a wrong one. The
// entrance-gate case is different: that IS a confident read (we know
// for certain the club hasn't started the book), so it positively
// writes the week-1 default rather than refusing.
// ─────────────────────────────────────────────────────────────

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { JSDOM } from 'jsdom';

const DEFAULT_URL = 'https://kvbchurch.twotimtwo.com/calendar/index?current_only=Y';
const DEFAULT_LESSONS = 'public/lessons.json';
const DEFAULT_OUT = 'public/current-lesson.json';
const HEARTBEAT_DAYS = 7;
const ENTRANCE_GATE_LABEL = 'Faith Foundations';

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

/** "Unit N #M" -> the lessons.json entry with matching unit/lesson.
 * Only call this once the entrance gate has been ruled out. */
function matchLesson(text, lessons) {
  if (!text || !Array.isArray(lessons) || lessons.length === 0) return null;
  const m = text.match(/Unit\s+(\d+)\s*#\s*(\d+)/i);
  if (!m) return null;
  const unit = Number(m[1]);
  const lessonNum = Number(m[2]);
  return lessons.find((l) => l.unit === unit && l.lesson === lessonNum) || null;
}

function writeFeed(out, feed) {
  writeFileSync(out, `${JSON.stringify(feed, null, 2)}\n`);
}

function readExisting(out) {
  if (!existsSync(out)) return null;
  try {
    return JSON.parse(readFileSync(out, 'utf8'));
  } catch {
    return null; // corrupt feed → always rewrite
  }
}

function heartbeatDue(existing) {
  const ageMs = existing?.resolvedAt ? Date.now() - Date.parse(existing.resolvedAt) : Infinity;
  return !(ageMs < HEARTBEAT_DAYS * 24 * 60 * 60 * 1000);
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

if (sectionText.startsWith(ENTRANCE_GATE_LABEL)) {
  const firstLesson = lessons.find((l) => l.week === 1);
  if (!firstLesson) {
    console.error(`${lessonsPath} has no week 1 entry — can't apply the entrance-gate default.`);
    process.exit(1);
  }
  const existing = readExisting(out);
  const unchanged = existing && existing.week === firstLesson.week;
  if (unchanged && !heartbeatDue(existing)) {
    console.log(`Still in the entrance gate ("${sectionText}") — ${out} untouched (week 1 default).`);
    process.exit(0);
  }
  writeFeed(out, {
    version: 1,
    week: firstLesson.week,
    title: firstLesson.title,
    downloadUrl: firstLesson.downloadUrl,
    resolvedAt: new Date().toISOString(),
  });
  console.log(
    `Still in the entrance gate ("${sectionText}") — defaulted to week 1: "${firstLesson.title}".`
  );
  process.exit(0);
}

const lesson = matchLesson(sectionText, lessons);
if (!lesson) {
  console.error(
    `Extracted "${sectionText}" but couldn't resolve a week number from it, or it doesn't match ` +
    `any entry in ${lessonsPath} — refusing to overwrite ${out}.`
  );
  process.exit(1);
}

const existing = readExisting(out);
const unchanged = existing && existing.week === lesson.week;
if (unchanged && !heartbeatDue(existing)) {
  console.log(`No change (still week ${lesson.week}) — ${out} untouched.`);
  process.exit(0);
}

writeFeed(out, {
  version: 1,
  week: lesson.week,
  title: lesson.title,
  downloadUrl: lesson.downloadUrl,
  resolvedAt: new Date().toISOString(),
});
console.log(
  `Wrote ${out}: week ${lesson.week} — "${lesson.title}" (from "${sectionText}")` +
  `${unchanged ? ' (heartbeat refresh)' : ''}.`
);
