#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────
// Nightly "current lesson" resolver (run by
// .github/workflows/update-lesson.yml, or by hand):
//
//   node scripts/fetch-current-lesson.mjs
//   node scripts/fetch-current-lesson.mjs --from-file sample.html
//   node scripts/fetch-current-lesson.mjs --url https://… --out public/current-lesson.json
//
// Fetches the church's TwoTimTwo "current lesson" view, figures out
// which Journey: Advocates lesson that corresponds to, and writes
// public/current-lesson.json. The actual video files are NOT touched
// here — that's public/lessons.json's fixed week→video map, hand-built
// from https://clubs.awana.org/ym-course/advocates/ (see CLAUDE.md).
//
// IMPORTANT — unverified against a real response: this environment's
// outbound network could not reach kvbchurch.twotimtwo.com to see the
// real shape of `?current_only=Y`, so this script tries two strategies
// defensively rather than assuming one:
//   1. JSON response — look for common field names.
//   2. HTML response — reuse the `.dayline` / `.msg .desc` /
//      `.fields[calendar_date]` contract that this SAME TwoTimTwo
//      instance's general calendar page uses (see the sibling
//      Awana-Check-in-Display repo's `src/lib/calendarParse.js`,
//      which is verified against real HTML from this church's
//      account) — `current_only=Y` most likely renders through the
//      same day-line template, just filtered to one row.
// Whichever strategy matches, the extracted title text is matched
// against public/lessons.json by week-number pattern ("week 12",
// "lesson 12", …) or literal title containment.
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

/** Try to read a lesson identifier out of a parsed JSON body. Returns
 * a raw text string to match against lessons.json, or null. */
function extractFromJson(data) {
  if (!data || typeof data !== 'object') return null;
  const item = Array.isArray(data) ? data[0] : (Array.isArray(data.events) ? data.events[0] : data);
  if (!item || typeof item !== 'object') return null;
  const candidates = [item.title, item.lesson, item.week, item.name, item.subject, item.description];
  const text = candidates.find((v) => typeof v === 'string' && v.trim());
  return text ? text.trim() : null;
}

/** Same DOM contract as the sibling repo's calendarParse.js. Returns
 * the visible title text of the (expected single) matching day, or
 * null if nothing recognizable is there. */
function extractFromHtml(html) {
  const doc = new JSDOM(html).window.document;
  for (const dayline of doc.querySelectorAll('div.dayline')) {
    const skipped = dayline.querySelector('.msg.skipped');
    if (skipped) continue; // no club this week — nothing to resolve
    for (const span of dayline.querySelectorAll('.msg .desc')) {
      const style = span.getAttribute('style') || '';
      if (/display\s*:\s*none/i.test(style)) continue;
      const text = span.textContent?.trim();
      if (text) return text;
    }
    const note = dayline.querySelector('.day-note');
    const text = note?.textContent?.trim();
    if (text) return text;
  }
  return null;
}

/** Match extracted text against the lessons list by week number
 * ("week 12", "lesson 12", "session 12") or literal title containment
 * (checked in both directions so either source can be more specific). */
function matchLesson(text, lessons) {
  if (!text || !Array.isArray(lessons) || lessons.length === 0) return null;
  const weekMatch = text.match(/\b(?:week|lesson|session)\s*#?\s*(\d{1,2})\b/i);
  if (weekMatch) {
    const week = Number(weekMatch[1]);
    const byWeek = lessons.find((l) => l.week === week);
    if (byWeek) return byWeek;
  }
  const normalized = text.toLowerCase();
  return (
    lessons.find(
      (l) =>
        typeof l.title === 'string' &&
        (normalized.includes(l.title.toLowerCase()) || l.title.toLowerCase().includes(normalized))
    ) || null
  );
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

const body = fromFile ? readFileSync(fromFile, 'utf8') : await fetchWithRetry(url);

let text = null;
try {
  text = extractFromJson(JSON.parse(body));
} catch {
  // not JSON — fall through to HTML
}
if (!text) text = extractFromHtml(body);

if (!text) {
  console.error(
    'Could not find a recognizable lesson identifier in the response — refusing to overwrite ' +
    `${out}. The page layout may differ from what this script expects (see the comment at the ` +
    'top of this file); it needs tuning against a real sample.'
  );
  process.exit(1);
}

const lesson = matchLesson(text, lessons);
if (!lesson) {
  console.error(
    `Extracted "${text}" but it didn't match any entry in ${lessonsPath} — refusing to overwrite ` +
    `${out}.`
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
  vimeoId: lesson.vimeoId,
  downloadUrl: lesson.downloadUrl,
  resolvedAt: new Date().toISOString(),
};
writeFileSync(out, `${JSON.stringify(feed, null, 2)}\n`);
console.log(`Wrote ${out}: week ${lesson.week} — "${lesson.title}"${unchanged ? ' (heartbeat refresh)' : ''}.`);
