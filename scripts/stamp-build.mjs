#!/usr/bin/env node
/* Deploy-time build identity for a site that deliberately has no build step.
 *
 * The kiosk has to be able to answer "am I running the current deploy?" on its
 * own (see the self-updating kiosk notes in CLAUDE.md), and nothing in the
 * committed tree can know a commit SHA. So this script runs in
 * .github/workflows/deploy.yml, between the checkout and the Pages upload, and
 * stamps the copy that is about to be uploaded:
 *
 *   1. public/version.json  = { build, builtAt }  (the file the kiosk polls)
 *   2. public/index.html    the journey-build meta carries the same SHA
 *   3. public/index.html    src/schedule.js and src/style.css get ?v=<sha>
 *
 * Point 3 is what makes a reload actually pick up new code: GitHub Pages
 * serves every asset with max-age=600, and Chromium will happily reuse a
 * still-fresh subresource from disk across a reload (this is the ten-minute
 * trap PI_SETUP.md warns about). A changed query string is a different URL,
 * so the new page pulls new assets immediately.
 *
 * The committed files keep plain paths and content="dev": only the deployed
 * copy is rewritten, and public/version.json is gitignored. Running this
 * locally is safe and undone by `git checkout public/index.html`.
 *
 * Usage: node scripts/stamp-build.mjs <build-id> [dir]   (dir defaults to public/)
 */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REPO = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

// The assets whose URLs carry the build id. A file added here must be
// referenced in index.html as a plain relative path, the way these two are.
export const STAMPED_ASSETS = ['src/schedule.js', 'src/style.css'];

export const BUILD_META_NAME = 'journey-build';

const escapeForRegExp = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/* Rewrites one HTML document. Idempotent by construction: the meta's content
 * is replaced whatever it was, and an asset's optional existing ?v= is part of
 * what the pattern consumes, so stamping twice is the same as stamping once
 * and re-stamping with a new id leaves no trace of the old one. */
export function stampHtml(html, build) {
  const metaPattern = new RegExp(
    `(<meta\\s+[^>]*name=["']${BUILD_META_NAME}["'][^>]*content=["'])[^"']*(["'])`,
    'i'
  );
  if (!metaPattern.test(html)) {
    throw new Error(
      `stamp-build: no <meta name="${BUILD_META_NAME}"> in the page. ` +
        'The kiosk compares that meta with version.json to notice a new deploy, ' +
        'so a page without it can never update itself.'
    );
  }
  let out = html.replace(metaPattern, `$1${build}$2`);
  for (const asset of STAMPED_ASSETS) {
    const pattern = new RegExp(`((?:src|href)=["'])${escapeForRegExp(asset)}(?:\\?v=[^"']*)?(["'])`, 'g');
    if (!pattern.test(out)) {
      throw new Error(`stamp-build: index.html does not reference ${asset}`);
    }
    pattern.lastIndex = 0;
    out = out.replace(pattern, `$1${asset}?v=${build}$2`);
  }
  return out;
}

export function buildVersionJson(build, builtAt = new Date().toISOString()) {
  return `${JSON.stringify({ build, builtAt }, null, 2)}\n`;
}

/* Writes both files in `dir` (public/ by default) and returns what it wrote,
 * so a test can assert on the content without reading the disk again. */
export function stampBuild(build, dir = path.join(REPO, 'public'), builtAt) {
  if (!build || typeof build !== 'string') {
    throw new Error('stamp-build: a build id (the commit SHA) is required');
  }
  const htmlPath = path.join(dir, 'index.html');
  const html = stampHtml(readFileSync(htmlPath, 'utf8'), build);
  const version = buildVersionJson(build, builtAt);
  writeFileSync(htmlPath, html);
  writeFileSync(path.join(dir, 'version.json'), version);
  return { html, version };
}

const invokedDirectly =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedDirectly) {
  const [build, dir] = process.argv.slice(2);
  try {
    stampBuild(build, dir ? path.resolve(dir) : undefined);
    console.log(`stamp-build: stamped ${build}`);
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
}
