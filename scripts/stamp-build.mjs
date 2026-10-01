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
 *   3. public/index.html    every STAMPED_ASSETS path (the page's script, its
 *                           stylesheets, the brand kit's two stylesheets and
 *                           the wordmark) gets ?v=<sha>
 *   4. public/brand/fonts.css  every font URL gets ?v=<sha256 of that font>
 *
 * Point 3 is what makes a reload actually pick up new code: GitHub Pages
 * serves every asset with max-age=600, and Chromium will happily reuse a
 * still-fresh subresource from disk across a reload (this is the ten-minute
 * trap PI_SETUP.md warns about). A changed query string is a different URL,
 * so the new page pulls new assets immediately.
 *
 * Point 4 is the same promise one level down. The fonts are not named in
 * index.html but in brand/fonts.css, so the ?v= on that stylesheet alone
 * would leave a new @font-face rule free to pair with an old font still fresh
 * in the disk cache. Each font URL is versioned by its OWN content hash, not
 * the build id, so a deploy that did not touch the fonts does not make a
 * 512MB Pi fetch them again, and one that did can never render with the old
 * bytes.
 *
 * The committed files keep plain paths and content="dev": only the deployed
 * copy is rewritten, and public/version.json is gitignored. That matters most
 * for brand/, which must stay byte-identical to the signage repo's kit (see
 * test/brand-kit.test.mjs). Running this locally is safe and undone by
 * `git checkout public/index.html public/brand/fonts.css`.
 *
 * Usage: node scripts/stamp-build.mjs <build-id> [dir]   (dir defaults to public/)
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REPO = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

// The assets whose URLs carry the build id. A file added here must be
// referenced in index.html as a plain relative path, the way these are.
export const STAMPED_ASSETS = [
  'src/schedule.js',
  'src/sync.js',
  'src/style.css',
  'brand/tokens.css',
  'brand/fonts.css',
  'brand/logos/journey-white.svg',
];

// The brand kit's @font-face sheet, whose url()s are relative to itself.
export const FONTS_CSS = 'brand/fonts.css';

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

/* Rewrites brand/fonts.css so every font URL carries ?v=<hash>, where
 * hashFor(relativeUrl) answers for the file that URL names. Idempotent in the
 * same way as stampHtml: an existing ?v= is consumed by the pattern. Throws if
 * the sheet names no fonts at all, which would mean the kit changed shape and
 * this stamp silently stopped protecting anything. */
export function stampFontsCss(css, hashFor) {
  const pattern = /url\((['"]?)(fonts\/[^'")?#]+)(?:\?v=[^'")]*)?\1\)/g;
  let count = 0;
  const out = css.replace(pattern, (_, quote, rel) => {
    count += 1;
    return `url(${quote}${rel}?v=${hashFor(rel)}${quote})`;
  });
  if (!count) throw new Error(`stamp-build: ${FONTS_CSS} names no fonts/ URLs to version`);
  return out;
}

/* The version a font's URL carries: the first 12 hex of its sha256. Throws for
 * a font the sheet names but the deploy does not carry, which is a kit that
 * would 404 its own fonts on the kiosk. */
export function fontHasher(brandDir) {
  return (rel) => {
    const file = path.join(brandDir, rel);
    if (!existsSync(file)) throw new Error(`stamp-build: ${FONTS_CSS} names ${rel}, which is missing`);
    return createHash('sha256').update(readFileSync(file)).digest('hex').slice(0, 12);
  };
}

export function buildVersionJson(build, builtAt = new Date().toISOString()) {
  return `${JSON.stringify({ build, builtAt }, null, 2)}\n`;
}

/* Writes all three files in `dir` (public/ by default) and returns what it wrote,
 * so a test can assert on the content without reading the disk again. */
export function stampBuild(build, dir = path.join(REPO, 'public'), builtAt) {
  if (!build || typeof build !== 'string') {
    throw new Error('stamp-build: a build id (the commit SHA) is required');
  }
  const htmlPath = path.join(dir, 'index.html');
  const html = stampHtml(readFileSync(htmlPath, 'utf8'), build);
  const fontsPath = path.join(dir, FONTS_CSS);
  if (!existsSync(fontsPath)) throw new Error(`stamp-build: ${FONTS_CSS} is missing from ${dir}`);
  const fontsCss = stampFontsCss(readFileSync(fontsPath, 'utf8'), fontHasher(path.dirname(fontsPath)));
  const version = buildVersionJson(build, builtAt);
  writeFileSync(htmlPath, html);
  writeFileSync(fontsPath, fontsCss);
  writeFileSync(path.join(dir, 'version.json'), version);
  return { html, fontsCss, version };
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
