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
// club name, in case that's ever renamed). If MORE than one row
// matches, this refuses rather than guessing which one is really the
// Journey club — the whole point of matching by Book Track instead of
// club name was to survive a renamed club, not to silently pick
// whichever matching row happens to come first in the DOM.
//
// UPDATE (verified live 2026-08-11): outside the regular meeting season
// (confirmed during the summer gap before the fall program year starts),
// `?current_only=Y` stops isolating a single "current" row and instead
// returns the SAME one-row-per-scheduled-meeting-date shape documented
// below for `?current_only=N` — for every club, not just Journey. Each
// meeting date's <tr> carries a sibling
// `<span class="fields" calendar_date="YYYY-MM-DD" …>`.
//
// UPDATE (verified live 2026-09-10, the day after the predicted
// entrance-gate -> book transition): the multi-row shape above isn't a
// summer-only quirk — it's how this endpoint behaves in-season too, and
// it NEVER exposes an already-held meeting's date, not even the one from
// the night before. Checked directly: `?current_only=Y` and
// `?current_only=N` returned byte-identical output (both with
// `Cache-Control: no-store` — not a caching artifact), and every Advocates
// row's `calendar_date` was 2026-09-16 or later. The 2026-09-09 meeting
// (predicted "Unit 1 #1") had already happened and was gone from BOTH
// endpoints; the *soonest* row was 2026-09-16's "Unit 1 #2".
//
// That matters because of what the "soonest upcoming" fallback does with
// it: picking that row and using ITS lesson directly means showing kids a
// lesson their leader hasn't taught yet, for the entire ~6-day gap between
// meetings — verified in this repo's own git history, current-lesson.json
// jumped straight from week 1 (entrance-gate default, unchanged since
// 2026-08-11) to week 2 ("Unit 1 #2") on 2026-09-10, never passing through
// a distinctly-recorded "week 1, confirmed from a real Unit 1 #1 match"
// state at all (the entrance-gate default and the real week-1 book lesson
// happen to be byte-identical, so `sameLesson()` saw no change to commit).
// Every week going forward would repeat this one-lesson-ahead pattern.
//
// The fix: when the resolved row's own `calendar_date` is today or later
// (the school's/church's local "today", via `todayLocalDateStr()` — NOT a
// naive UTC epoch compare: the cron runs 08:23 UTC / ~4:23 AM Eastern,
// which is already hours past UTC midnight, so comparing raw timestamps
// would misclassify TODAY's own not-yet-held meeting as "in the past"),
// that meeting hasn't happened yet — so what's actually "current" (most
// recently TAUGHT) is the PREVIOUS lesson in `lessons.json`'s sequence,
// not the one the row names. See `resolveCurrentSection()`'s `alreadyHeld`
// field and its one call site below. This subsumes the old "past date vs.
// soonest upcoming" disambiguation (the "past" branch still exists, for
// robustness, in case the site ever again exposes an already-held date —
// it's just never been observed doing so) and additionally applies the
// same today-or-later check to the single-match case, which the original
// version of this comment assumed was always a clean "here's today's
// meeting" read and never questioned.
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
// lessons.json's `unit`/`lesson` fields.
//
// Safety rail, same as fetch-calendar.mjs: refuse (exit 1) rather than
// overwrite a good file with an unconfident parse — a bad night here
// means the display keeps yesterday's lesson, not a wrong one. The
// entrance-gate case is different: that IS a confident read (we know
// for certain the club hasn't started the book), so it positively
// writes the week-1 default rather than refusing.
//
// CORS note — why `sourceUrl` is a CDN URL, not the `clubs.awana.org` one
// lessons.json lists: clubs.awana.org's download links 302-redirect to a
// CloudFront-backed CDN host, and that redirect response itself carries no
// Access-Control-Allow-Origin header. The CloudFront target *does* send
// `access-control-allow-origin: *`, so this script follows the redirect
// once, server-side (where CORS doesn't apply), and records the resolved
// CDN URL — this matters both as the URL `transcode-lesson-video.mjs`
// downloads from, and as the fallback `downloadUrl` a browser can still
// fetch/cache directly if transcoding hasn't produced a video yet.
//
// `downloadUrl` vs `sourceUrl` — this script writes BOTH: `sourceUrl` is
// always the original (large, ~90-220MB) lesson file, used as this script's
// own "did the lesson actually change" identity and as the input to the
// transcode step. `downloadUrl` is what the kiosk actually fetches — it
// starts out equal to `sourceUrl` (so playback still works before
// transcoding catches up) and gets overwritten to a small same-origin path
// by `scripts/transcode-lesson-video.mjs` once that succeeds. A
// heartbeat-only rewrite (the lesson itself hasn't changed) preserves
// whatever `downloadUrl`/`transcodedAt` the transcode step already set,
// rather than resetting it back to the untranscoded source every week.
// ─────────────────────────────────────────────────────────────

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { JSDOM } from 'jsdom';

const DEFAULT_URL = 'https://kvbchurch.twotimtwo.com/calendar/index?current_only=Y';
const DEFAULT_LESSONS = 'public/lessons.json';
const DEFAULT_OUT = 'public/current-lesson.json';
const HEARTBEAT_DAYS = 7;
const ENTRANCE_GATE_LABEL = 'faith foundations';

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

/** Resolve lesson.downloadUrl's redirect to its final CDN URL, server-side,
 * so the browser never has to follow a cross-origin redirect that lacks
 * CORS headers of its own. Falls back to the original URL (still fine for
 * direct <video> playback, just not for the Cache API pre-fetch) if the
 * resolution fails or the final response turns out not to be CORS-enabled
 * — a transient failure here must never block writing the rest of the feed.
 */
async function resolveCorsFriendlyVideoUrl(downloadUrl) {
  try {
    const res = await fetch(downloadUrl, {
      method: 'HEAD',
      redirect: 'follow',
      signal: AbortSignal.timeout(30000),
    });
    if (res.ok && res.headers.get('access-control-allow-origin')) {
      return res.url;
    }
  } catch {
    // fall through
  }
  return downloadUrl;
}

/** Reads a book-track-mtg row's own scheduled date, if present — the
 * `calendar_date="YYYY-MM-DD"` attribute lives on a `span.fields` sibling
 * elsewhere inside the same meeting-date `<tr>`, not on the row itself, so
 * this walks up to that ancestor `<tr>` and reads it from there. Returns
 * null if it's missing (e.g. an older/different page shape), which callers
 * treat as "can't safely disambiguate by date." */
function rowCalendarDate(row) {
  for (let el = row.parentElement; el; el = el.parentElement) {
    if (el.tagName !== 'TR') continue;
    const span = el.querySelector('span.fields[calendar_date]');
    if (span) return span.getAttribute('calendar_date') || null;
  }
  return null;
}

/** Collects every Advocates row in the "current book track" table as raw
 * `{ section, dateStr }` pairs — `dateStr` from rowCalendarDate(), null
 * when unavailable. Pure extraction; resolveCurrentSection() below does
 * the picking/disambiguating. */
function extractSectionMatches(html) {
  const doc = new JSDOM(html).window.document;
  const matches = [];
  for (const row of doc.querySelectorAll('tr.book-track-mtg')) {
    const cells = row.querySelectorAll('td');
    if (cells.length < 3) continue;
    const bookTrack = cells[1].textContent?.trim() || '';
    if (!/advocates/i.test(bookTrack)) continue;
    const section = cells[2].querySelector('b')?.textContent?.trim() || cells[2].textContent?.trim() || '';
    matches.push({ section, dateStr: rowCalendarDate(row) });
  }
  return matches;
}

const CLUB_TIMEZONE = 'America/New_York';

/** "YYYY-MM-DD" for "today" in the club's own timezone. A plain string
 * compare against a row's own bare `calendar_date` avoids the timezone
 * pitfall of epoch-timestamp math: the cron runs at 08:23 UTC (~4:23 AM
 * Eastern), hours past UTC midnight, so comparing raw `Date.now()`
 * against a UTC-midnight parse of today's own date would already read as
 * "in the past" before that day's meeting has actually happened. */
function todayLocalDateStr(timeZone = CLUB_TIMEZONE) {
  // en-CA's date format is YYYY-MM-DD, matching calendar_date's own shape.
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(
    new Date()
  );
}

/** Picks which Advocates row is "current" and whether ITS OWN lesson is
 * actually current or the meeting it's assigned to just hasn't happened
 * yet (see the big comment at the top of this file — verified 2026-09-10
 * that `?current_only=Y` never exposes an already-held meeting's date, so
 * "the soonest row this endpoint shows" and "the lesson that was most
 * recently taught" are usually two different things, off by one lesson).
 *
 * Returns `{ sectionText, alreadyHeld, matchCount, blank }`.
 * `alreadyHeld`:
 *   - `true`  — this meeting has already happened; use its own lesson.
 *   - `false` — this meeting is today-or-later, hasn't happened yet;
 *     caller should resolve to the PREVIOUS lesson in sequence instead.
 *   - `null`  — no date available to reason about (a single match with no
 *     `calendar_date` at all) — caller uses it directly, the same as
 *     `true`, preserving this script's original pre-date-aware behavior
 *     for that shape rather than guessing when there's nothing to check. */
function resolveCurrentSection(matches) {
  if (matches.length === 0) return { sectionText: null, matchCount: 0 };

  if (matches.length === 1) {
    const only = matches[0];
    if (!only.section) return { sectionText: null, matchCount: 1, blank: true };
    if (!only.dateStr) return { sectionText: only.section, alreadyHeld: null, matchCount: 1 };
    return { sectionText: only.section, alreadyHeld: only.dateStr < todayLocalDateStr(), matchCount: 1 };
  }

  // More than one row: every one needs a parseable date to disambiguate —
  // a single unparseable one means the page shape isn't what's assumed,
  // and guessing among the rest would be worse than refusing.
  if (matches.some((m) => !m.dateStr || Number.isNaN(Date.parse(`${m.dateStr}T00:00:00Z`)))) {
    return { sectionText: null, matchCount: matches.length };
  }
  const today = todayLocalDateStr();
  const past = matches.filter((m) => m.dateStr < today);
  if (past.length > 0) {
    // Never actually observed live (see the 2026-09-10 comment above) —
    // kept for robustness in case the site exposes past dates again.
    const chosen = past.reduce((latest, m) => (m.dateStr > latest.dateStr ? m : latest));
    if (!chosen.section) return { sectionText: null, matchCount: matches.length, blank: true };
    return { sectionText: chosen.section, alreadyHeld: true, matchCount: matches.length };
  }
  const soonest = matches.reduce((s, m) => (m.dateStr < s.dateStr ? m : s));
  if (!soonest.section) return { sectionText: null, matchCount: matches.length, blank: true };
  return { sectionText: soonest.section, alreadyHeld: false, matchCount: matches.length };
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

/** Normalize whitespace (collapsing runs of whitespace, including
 * non-breaking spaces, to a single space) and case, so a label check isn't
 * brittle against markup/whitespace variance that the "Unit N #M" regex
 * below already tolerates via \s+. */
function normalizeLabel(text) {
  return text.replace(/\s+/g, ' ').trim().toLowerCase();
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

/** A resolved lesson is "unchanged" only if week, title, and sourceUrl all
 * match — so correcting a title/URL typo in lessons.json for the
 * currently-showing week still reaches the feed on the next run, instead of
 * being skipped as "no change" until the week number itself happens to
 * move. Deliberately compares `sourceUrl`, not `downloadUrl`: the latter
 * gets overwritten by the transcode step once it succeeds, and comparing
 * against that would make every run think the lesson "changed" back to
 * untranscoded the moment it wasn't. */
function sameLesson(existing, candidate) {
  return (
    !!existing &&
    existing.week === candidate.week &&
    existing.title === candidate.title &&
    existing.sourceUrl === candidate.sourceUrl
  );
}

/** Builds the feed object to write: a genuinely new/changed lesson resets
 * downloadUrl/transcodedAt back to the untranscoded source (a new lesson
 * necessarily hasn't been transcoded yet); an unchanged lesson (e.g. a
 * heartbeat-only refresh) preserves whatever the transcode step already
 * produced, so it isn't discarded and redone for no reason every week. */
function buildFeed(existing, candidate, resolvedAtISO) {
  const unchanged = sameLesson(existing, candidate);
  return {
    version: 2,
    week: candidate.week,
    title: candidate.title,
    sourceUrl: candidate.sourceUrl,
    downloadUrl: unchanged && existing?.downloadUrl ? existing.downloadUrl : candidate.sourceUrl,
    transcodedAt: unchanged ? existing?.transcodedAt ?? null : null,
    resolvedAt: resolvedAtISO,
  };
}

function heartbeatDue(existing) {
  const parsed = existing?.resolvedAt ? Date.parse(existing.resolvedAt) : NaN;
  if (!Number.isFinite(parsed)) return true; // missing/unparseable -> due
  const ageMs = Date.now() - parsed;
  // A negative age (resolvedAt in the future — clock skew, a hand-edited
  // file, a bad restore) must count as due, not as "freshly resolved
  // moments ago" — otherwise the heartbeat that exists to prove the
  // pipeline is alive can silently disable itself indefinitely.
  return ageMs < 0 || ageMs >= HEARTBEAT_DAYS * 24 * 60 * 60 * 1000;
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
const { sectionText, alreadyHeld, matchCount, blank } = resolveCurrentSection(extractSectionMatches(html));

if (!sectionText) {
  if (matchCount > 1) {
    console.error(
      `Found ${matchCount} "Journey: Advocates" rows in the "current book track" table — refusing to ` +
      `guess which one is authoritative. Refusing to overwrite ${out}.`
    );
  } else if (blank) {
    console.error(
      'The Journey: Advocates row\'s Section cell is blank — refusing to overwrite ' +
      `${out} rather than falling through to a different club's row.`
    );
  } else {
    console.error(
      'Could not find the Journey: Advocates row in the "current book track" table — refusing to ' +
      `overwrite ${out}. The page layout may have changed (see the comment at the top of this file).`
    );
  }
  process.exit(1);
}

if (normalizeLabel(sectionText).startsWith(ENTRANCE_GATE_LABEL)) {
  const firstLesson = lessons.find((l) => l.week === 1);
  if (!firstLesson) {
    console.error(`${lessonsPath} has no week 1 entry — can't apply the entrance-gate default.`);
    process.exit(1);
  }
  const existing = readExisting(out);
  const sourceUrl = await resolveCorsFriendlyVideoUrl(firstLesson.downloadUrl);
  const candidate = { week: firstLesson.week, title: firstLesson.title, sourceUrl };
  if (sameLesson(existing, candidate) && !heartbeatDue(existing)) {
    console.log(`Still in the entrance gate ("${sectionText}") — ${out} untouched (week 1 default).`);
    process.exit(0);
  }
  writeFeed(out, buildFeed(existing, candidate, new Date().toISOString()));
  console.log(
    `Still in the entrance gate ("${sectionText}") — defaulted to week 1: "${firstLesson.title}".`
  );
  process.exit(0);
}

let lesson = matchLesson(sectionText, lessons);
if (!lesson) {
  console.error(
    `Extracted "${sectionText}" but couldn't resolve a week number from it, or it doesn't match ` +
    `any entry in ${lessonsPath} — refusing to overwrite ${out}.`
  );
  process.exit(1);
}

if (alreadyHeld === false) {
  // "${sectionText}" is assigned to a meeting that's today-or-later —
  // hasn't happened yet at the time this (early-morning) script runs —
  // so it isn't what was actually most recently TAUGHT. See the
  // 2026-09-10 comment at the top of this file. What's actually current
  // is the previous lesson in sequence.
  const previous = lessons.find((l) => l.week === lesson.week - 1);
  if (previous) {
    console.log(
      `"${sectionText}" is assigned to a meeting that hasn't happened yet — using the previous ` +
      `lesson, week ${previous.week} ("${previous.title}"), as what's actually current.`
    );
    lesson = previous;
  } else {
    // week 1 has no predecessor — the club's very first book meeting is
    // scheduled but hasn't happened yet, so there's no real "current"
    // book lesson at all yet. The entrance-gate default (also week 1) is
    // exactly the right answer here too.
    console.log(
      `"${sectionText}" is the club's first book meeting and hasn't happened yet — defaulting to ` +
      `week 1, same as the entrance-gate default.`
    );
  }
}

const existing = readExisting(out);
const sourceUrl = await resolveCorsFriendlyVideoUrl(lesson.downloadUrl);
const candidate = { week: lesson.week, title: lesson.title, sourceUrl };
if (sameLesson(existing, candidate) && !heartbeatDue(existing)) {
  console.log(`No change (still week ${lesson.week}) — ${out} untouched.`);
  process.exit(0);
}

writeFeed(out, buildFeed(existing, candidate, new Date().toISOString()));
console.log(
  `Wrote ${out}: week ${lesson.week} — "${lesson.title}" (from "${sectionText}")` +
  `${sameLesson(existing, candidate) ? ' (heartbeat refresh)' : ''}.`
);
