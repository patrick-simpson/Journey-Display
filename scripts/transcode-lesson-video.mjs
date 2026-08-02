#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────
// Nightly video transcode (run by .github/workflows/update-lesson.yml,
// after scripts/fetch-current-lesson.mjs, or by hand):
//
//   node scripts/transcode-lesson-video.mjs
//   node scripts/transcode-lesson-video.mjs --lesson public/current-lesson.json --out public/current-lesson-video.mp4
//
// The Pi Zero this kiosk runs on (single-core ARMv6, 512MB RAM) struggles
// to decode Awana's original files smoothly — they're 1080p H.264 Main
// profile at ~2.2Mbps, 90-220MB each. This downloads the current lesson's
// `sourceUrl` (server-side — Node's fetch doesn't enforce CORS, so the
// redirect-through-CloudFront shape that requires special handling in the
// browser is a non-issue here) and re-encodes it to something far easier
// to decode: 854x480, H.264 *Baseline* profile (avoids CABAC entropy
// coding, which costs meaningfully more CPU to decode than baseline's
// CAVLC), a modest capped bitrate, and the original frame rate preserved
// (shrinking resolution/bitrate/profile complexity is what should let a
// weak decoder keep up, not a lower frame rate). Verified against a real
// lesson file: 94MB 1080p -> ~17MB 480p, visually clean at normal viewing
// distance on a TV.
//
// KNOWN, ACCEPTED TRADE-OFF — re-hosting: writing the transcoded file into
// public/ means it's served from the same public GitHub Pages URL as the
// rest of this site. This is a deliberate, informed exception to this
// project's own "never re-serve/re-host the original video files" rule
// (see CLAUDE.md) — that rule is about not redistributing Awana's ORIGINAL
// files; this is a re-encoded, lower-quality copy created and used solely
// for this kiosk's own on-device playback, not linked or advertised
// anywhere else. The project owner chose this trade-off explicitly,
// knowing it's technically a public URL, because the Pi Zero's hardware
// needs it. See CLAUDE.md before touching this boundary either direction.
//
// Repo-size trade-off: public/current-lesson-video.mp4 is a SINGLE reusable
// filename, overwritten (not versioned) each time the current lesson
// changes — so only one lesson's video is ever present at once, not all 32.
// Git still keeps every past version in its history though (~15-20MB per
// lesson change), so the repo's .git size grows by roughly one course's
// worth (~500-600MB) per full 32-week run through the curriculum. Not a
// problem today; if it ever becomes one, moving this asset to a GitHub
// Release (which doesn't bloat git history) is the natural next step —
// deliberately not built now since it adds real complexity this repo
// doesn't need yet.
//
// Failure handling: any failure here (download, ffmpeg, disk) leaves
// current-lesson.json's `downloadUrl` exactly as fetch-current-lesson.mjs
// left it (pointing at the original CORS-friendly `sourceUrl`) — the kiosk
// still plays and caches that directly, just at the original size/quality,
// rather than being left with no video at all. This script never treats a
// failure to transcode as fatal to the overall nightly job.
// ─────────────────────────────────────────────────────────────

import { readFileSync, writeFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';

const DEFAULT_LESSON = 'public/current-lesson.json';
const DEFAULT_OUT = 'public/current-lesson-video.mp4';
const OUT_FILENAME = 'current-lesson-video.mp4'; // relative path written into downloadUrl

function arg(flag) {
  const i = process.argv.indexOf(flag);
  return i !== -1 ? process.argv[i + 1] : undefined;
}

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    proc.stderr.on('data', (d) => {
      stderr += d;
    });
    proc.on('error', reject); // e.g. ffmpeg not installed
    proc.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${cmd} exited ${code}: ${stderr.slice(-2000)}`));
    });
  });
}

async function downloadTo(url, destPath) {
  const res = await fetch(url, { signal: AbortSignal.timeout(5 * 60 * 1000) });
  if (!res.ok) throw new Error(`download HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  writeFileSync(destPath, buf);
}

const lessonPath = arg('--lesson') || DEFAULT_LESSON;
const outPath = arg('--out') || DEFAULT_OUT;

if (!existsSync(lessonPath)) {
  console.log(`${lessonPath} doesn't exist yet — nothing to transcode.`);
  process.exit(0);
}

let lesson;
try {
  lesson = JSON.parse(readFileSync(lessonPath, 'utf8'));
} catch {
  console.error(`${lessonPath} is not valid JSON — leaving it alone.`);
  process.exit(0); // not this script's job to fix a corrupt feed
}

if (!lesson.sourceUrl || typeof lesson.sourceUrl !== 'string') {
  console.log(`${lessonPath} has no sourceUrl yet — nothing to transcode.`);
  process.exit(0);
}

// Already transcoded for this exact lesson, and the file is actually
// present? Nothing to do. (transcodedAt is cleared by fetch-current-
// lesson.mjs whenever the lesson genuinely changes, so this only skips
// when it's truly still the same lesson as last time.)
if (lesson.transcodedAt && existsSync(outPath)) {
  console.log(`Week ${lesson.week} already transcoded at ${lesson.transcodedAt} — nothing to do.`);
  process.exit(0);
}

const tmpDir = mkdtempSync(join(tmpdir(), 'journey-transcode-'));
const rawPath = join(tmpDir, 'source.mp4');

try {
  console.log(`Downloading week ${lesson.week}'s source video…`);
  await downloadTo(lesson.sourceUrl, rawPath);

  console.log('Transcoding to 854x480 baseline H.264…');
  await run('ffmpeg', [
    '-y',
    '-i', rawPath,
    '-vf', 'scale=854:480',
    '-c:v', 'libx264',
    '-profile:v', 'baseline',
    '-level', '3.1',
    '-preset', 'veryfast',
    '-crf', '26',
    '-maxrate', '700k',
    '-bufsize', '1400k',
    '-c:a', 'aac',
    '-b:a', '96k',
    '-ac', '2',
    '-movflags', '+faststart',
    outPath,
  ]);

  lesson.downloadUrl = OUT_FILENAME;
  lesson.transcodedAt = new Date().toISOString();
  writeFileSync(lessonPath, `${JSON.stringify(lesson, null, 2)}\n`);
  console.log(`Transcoded week ${lesson.week} -> ${outPath}, updated ${lessonPath}.`);
} catch (err) {
  // Never fatal to the nightly job: current-lesson.json's downloadUrl is
  // still whatever fetch-current-lesson.mjs left it as (the original,
  // CORS-friendly sourceUrl) — playback still works, just at full size.
  console.error(`Transcode failed, leaving ${lessonPath}'s existing downloadUrl in place —`, err.message);
} finally {
  rmSync(tmpDir, { recursive: true, force: true });
}
