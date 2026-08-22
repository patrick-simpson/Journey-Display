#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────
// One-time (re-runnable) batch transcode of EVERY lesson video in
// public/lessons.json — run by .github/workflows/transcode-all-lessons.yml
// (workflow_dispatch), or by hand on a machine with ffmpeg + gh:
//
//   node scripts/transcode-all-lessons.mjs
//
// Why: the manual video-picker (Settings panel) used to play Awana's
// original 1080p files directly, which the kiosk's Pi Zero cannot decode
// at a watchable frame rate no matter how long it buffers. Only the
// *current* lesson got a Pi-playable 480p transcode (the nightly
// transcode-lesson-video.mjs). This script closes that gap: every
// Student Video (32) and Leader Video (31 — week 27 genuinely has none)
// gets the exact same re-encode and is uploaded as a GitHub Release
// asset, which the picker plays first, falling back to the original URL
// if an asset is missing. A Release (not public/) keeps ~1.1GB of video
// out of the repo working tree, git history, and every Pages deploy.
//
// LICENSING BOUNDARY — owner-approved extension (2026-08-22): this widens
// the existing "re-encoded copies for this kiosk's own playback" exception
// (see CLAUDE.md and transcode-lesson-video.mjs) from the current lesson to
// all lessons, Student and Leader. Same character as before: re-encoded,
// lower-quality copies used solely for this kiosk's own on-device playback,
// never linked or advertised anywhere else. The project owner explicitly
// chose this on 2026-08-22 — do not extend or retract it again without
// them.
//
// Resumable by design: assets already present on the release are skipped,
// so a mid-run failure (or an Actions timeout) costs only the videos not
// yet uploaded — re-run the workflow and it picks up where it left off.
// A per-video failure logs and moves on; the script exits non-zero at the
// end if anything failed, so the Actions run shows red and the operator
// knows to re-run.
// ─────────────────────────────────────────────────────────────

import { readFileSync, createWriteStream, mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

const RELEASE_TAG = 'transcoded-videos-v1';
const LESSONS_PATH = 'public/lessons.json';

function run(cmd, args, { capture = false } = {}) {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, { stdio: ['ignore', capture ? 'pipe' : 'inherit', 'pipe'] });
    let stdout = '';
    let stderr = '';
    if (capture) proc.stdout.on('data', (d) => (stdout += d));
    proc.stderr.on('data', (d) => (stderr += d));
    proc.on('error', reject);
    proc.on('close', (code) => {
      if (code === 0) resolve(stdout);
      else reject(new Error(`${cmd} ${args[0]} exited ${code}: ${stderr.slice(-2000)}`));
    });
  });
}

async function downloadTo(url, destPath) {
  // Streamed to disk, not buffered — originals run 90-220MB each.
  const res = await fetch(url, { signal: AbortSignal.timeout(10 * 60 * 1000) });
  if (!res.ok) throw new Error(`download HTTP ${res.status}`);
  await pipeline(Readable.fromWeb(res.body), createWriteStream(destPath));
}

function assetName(week, variant) {
  return `week-${String(week).padStart(2, '0')}-${variant}.mp4`;
}

const { lessons } = JSON.parse(readFileSync(LESSONS_PATH, 'utf8'));
if (!Array.isArray(lessons) || lessons.length === 0) {
  console.error(`${LESSONS_PATH} has no lessons — nothing to transcode.`);
  process.exit(1);
}

// Ensure the release exists, then list what's already uploaded.
try {
  await run('gh', ['release', 'view', RELEASE_TAG], { capture: true });
} catch {
  console.log(`Creating release ${RELEASE_TAG}…`);
  await run('gh', [
    'release', 'create', RELEASE_TAG,
    '--title', 'Transcoded lesson videos (kiosk playback)',
    '--notes', 'Pi-Zero-playable 480p re-encodes of the Journey: Advocates lesson videos, used only by this kiosk’s manual video-picker. See CLAUDE.md for the licensing boundary.',
  ]);
}
const existing = new Set(
  (await run('gh', ['release', 'view', RELEASE_TAG, '--json', 'assets', '--jq', '.assets[].name'], { capture: true }))
    .split('\n')
    .filter(Boolean)
);
console.log(`Release ${RELEASE_TAG} has ${existing.size} asset(s) already.`);

const jobs = [];
for (const lesson of lessons) {
  jobs.push({ week: lesson.week, title: lesson.title, variant: 'student', url: lesson.downloadUrl });
  // week 27 has leaderDownloadUrl: null — a real gap on Awana's page, not a bug.
  if (lesson.leaderDownloadUrl) {
    jobs.push({ week: lesson.week, title: lesson.title, variant: 'leader', url: lesson.leaderDownloadUrl });
  }
}

const failures = [];
let done = 0;
for (const job of jobs) {
  const name = assetName(job.week, job.variant);
  if (existing.has(name)) {
    console.log(`✓ ${name} already uploaded — skipping.`);
    continue;
  }
  const tmpDir = mkdtempSync(join(tmpdir(), 'journey-batch-'));
  const rawPath = join(tmpDir, 'source.mp4');
  const outPath = join(tmpDir, name);
  try {
    console.log(`↓ ${name} — downloading ${job.url}`);
    await downloadTo(job.url, rawPath);
    console.log(`⚙ ${name} — transcoding (${Math.round(statSync(rawPath).size / 1e6)}MB original)…`);
    // Settings identical to transcode-lesson-video.mjs — verified against a
    // real lesson file (94MB 1080p -> ~17MB 480p, clean at TV distance).
    await run('ffmpeg', [
      '-y', '-hide_banner', '-loglevel', 'error',
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
    console.log(`↑ ${name} — uploading (${Math.round(statSync(outPath).size / 1e6)}MB)…`);
    await run('gh', ['release', 'upload', RELEASE_TAG, outPath, '--clobber']);
    done += 1;
  } catch (err) {
    console.error(`✗ ${name} failed — ${err.message}`);
    failures.push(name);
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
}

console.log(`\nDone: ${done} uploaded, ${existing.size} pre-existing, ${failures.length} failed.`);
if (failures.length) {
  console.error(`Failed: ${failures.join(', ')} — re-run this workflow; already-uploaded assets are skipped.`);
  process.exit(1);
}
