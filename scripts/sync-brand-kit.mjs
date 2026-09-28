#!/usr/bin/env node
/* Mirror the Awana 2026-27 brand kit into public/brand/ and record what was
 * copied.
 *
 * The kit's canonical copy lives in the signage repo
 * (Awana-Check-in-Display/shared/brand/). This kiosk carries a byte-identical
 * mirror so it never depends on the network, or on another site, for its own
 * fonts and colours at 6:30 PM. The mirror is pinned by
 * data/brand-kit-manifest.json (a sha256 per file), and
 * test/brand-kit.test.mjs fails if public/brand/ and the manifest disagree,
 * which is what catches a hand edit to the mirror, a half-finished copy, or a
 * file dropped on the floor.
 *
 * Usage:
 *   node scripts/sync-brand-kit.mjs <signage-checkout>          copy + rewrite the manifest
 *   node scripts/sync-brand-kit.mjs <signage-checkout> --check  compare only; exit 1 on drift
 *
 * Change the kit in the signage repo first, then run this and commit
 * public/brand/ and the manifest together. Never edit public/brand/ by hand.
 */
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REPO = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
export const MIRROR_DIR = path.join(REPO, 'public', 'brand');
export const MANIFEST_PATH = path.join(REPO, 'data', 'brand-kit-manifest.json');
export const KIT_SUBDIR = path.join('shared', 'brand');

export const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

/* Every file under `dir`, as sorted forward-slash paths relative to it. */
export function listFiles(dir) {
  const out = [];
  const walk = (rel) => {
    for (const name of readdirSync(path.join(dir, rel))) {
      const child = rel ? `${rel}/${name}` : name;
      if (statSync(path.join(dir, child)).isDirectory()) walk(child);
      else out.push(child);
    }
  };
  walk('');
  return out.sort();
}

export function hashTree(dir) {
  const files = {};
  for (const rel of listFiles(dir)) files[rel] = sha256(readFileSync(path.join(dir, rel)));
  return files;
}

/* What differs between two { path: sha256 } maps, as human-readable lines. */
export function diffTrees(expected, actual) {
  const lines = [];
  for (const rel of Object.keys(expected)) {
    if (!(rel in actual)) lines.push(`missing: ${rel}`);
    else if (expected[rel] !== actual[rel]) lines.push(`changed: ${rel}`);
  }
  for (const rel of Object.keys(actual)) if (!(rel in expected)) lines.push(`extra: ${rel}`);
  return lines;
}

function kitCommit(checkout) {
  try {
    const sha = execFileSync('git', ['-C', checkout, 'log', '-1', '--format=%H', '--', KIT_SUBDIR], {
      encoding: 'utf8',
    }).trim();
    const dirty = execFileSync('git', ['-C', checkout, 'status', '--porcelain', '--', KIT_SUBDIR], {
      encoding: 'utf8',
    }).trim();
    // A kit with uncommitted edits has no commit that describes it.
    return sha && !dirty ? sha : null;
  } catch {
    return null;
  }
}

export function syncBrandKit(checkout, { check = false } = {}) {
  const source = path.join(checkout, KIT_SUBDIR);
  if (!existsSync(path.join(source, 'tokens.css'))) {
    throw new Error(`sync-brand-kit: ${source} is not the brand kit (no tokens.css)`);
  }
  const want = hashTree(source);
  const have = existsSync(MIRROR_DIR) ? hashTree(MIRROR_DIR) : {};
  const drift = diffTrees(want, have);
  if (check) return { drift, files: want };

  rmSync(MIRROR_DIR, { recursive: true, force: true });
  for (const rel of Object.keys(want)) {
    const dest = path.join(MIRROR_DIR, rel);
    mkdirSync(path.dirname(dest), { recursive: true });
    copyFileSync(path.join(source, rel), dest);
  }
  const manifest = {
    note: 'sha256 of every file in public/brand/, a byte-identical mirror of Awana-Check-in-Display/shared/brand/. Regenerate with scripts/sync-brand-kit.mjs; never edit by hand.',
    source: 'Awana-Check-in-Display/shared/brand/',
    kitCommit: kitCommit(checkout),
    files: want,
  };
  writeFileSync(MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`);
  return { drift, files: want, manifest };
}

const invokedDirectly =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedDirectly) {
  const args = process.argv.slice(2);
  const check = args.includes('--check');
  const checkout = args.find((a) => !a.startsWith('--'));
  if (!checkout) {
    console.error('usage: node scripts/sync-brand-kit.mjs <Awana-Check-in-Display checkout> [--check]');
    process.exit(2);
  }
  try {
    const { drift, files } = syncBrandKit(path.resolve(checkout), { check });
    if (check) {
      if (drift.length) {
        console.error(`public/brand/ has drifted from the kit:\n  ${drift.join('\n  ')}`);
        process.exit(1);
      }
      console.log(`public/brand/ matches the kit (${Object.keys(files).length} files)`);
    } else {
      console.log(
        `public/brand/ mirrored (${Object.keys(files).length} files, ${drift.length} changed); ` +
          'commit it together with data/brand-kit-manifest.json'
      );
    }
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
}
