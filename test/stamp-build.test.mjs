// Deploy-time build stamping. The kiosk's whole self-update story rests on
// this script having rewritten the copy that went to Pages, so the contract it
// depends on (a placeholder meta in the committed page, plain asset paths) is
// pinned here too.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  FONTS_CSS,
  stampBuild,
  stampFontsCss,
  stampHtml,
  STAMPED_ASSETS,
} from '../scripts/stamp-build.mjs';

const REPO = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const PAGE = path.join(REPO, 'public', 'index.html');
const FONTS_SHEET = path.join(REPO, 'public', FONTS_CSS);

/* A scratch copy of the real public/ (the page and the brand kit's font
   sheet and fonts), the way the workflow stamps a fresh checkout. Nothing
   here writes to the repo. */
function scratchPublic() {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'journey-stamp-'));
  cpSync(path.join(REPO, 'public', 'index.html'), path.join(dir, 'index.html'));
  cpSync(path.join(REPO, 'public', 'brand', 'fonts.css'), path.join(dir, 'brand', 'fonts.css'));
  cpSync(path.join(REPO, 'public', 'brand', 'fonts'), path.join(dir, 'brand', 'fonts'), {
    recursive: true,
  });
  return dir;
}

const fontUrls = (css) => [...css.matchAll(/url\((['"]?)([^'")]+)\1\)/g)].map((m) => m[2]);
const shortHash = (file) => createHash('sha256').update(readFileSync(file)).digest('hex').slice(0, 12);

/* Every src/href on a page that names a file of this site (not another
   origin, a data: URI or a fragment), in page order, every copy counted. */
const localRefs = (page) =>
  [...page.matchAll(/\s(?:src|href)=["']([^"']*)["']/g)]
    .map((m) => m[1])
    .filter((url) => url && !/^(?:[a-z][a-z\d+.-]*:|\/\/|#)/i.test(url));

/* The stamped page must carry ?v=<build> on every local reference the plain
   page has: the wordmark appears twice (the placeholder and the splash), so
   "each asset versioned once" is not enough, and an asset added to the page
   but not to STAMPED_ASSETS would otherwise go out on a plain URL, the
   old-page/new-asset mix the stamp exists to prevent. */
function assertEveryLocalRefStamped(stamped, build) {
  const plain = localRefs(readFileSync(PAGE, 'utf8'));
  assert.deepEqual(
    localRefs(stamped),
    plain.map((url) => `${url}?v=${build}`),
    'every local src/href, every copy, carries the build id'
  );
}

test('the committed page carries the placeholder the workflow replaces', () => {
  const html = readFileSync(PAGE, 'utf8');
  assert.match(html, /<meta name="journey-build" content="dev" \/>/);
  // Plain paths in git: only the deployed copy is versioned.
  for (const asset of STAMPED_ASSETS) {
    assert.equal(html.includes(`${asset}?v=`), false, `${asset} is unversioned in git`);
    assert.equal(html.includes(asset), true);
  }
  // The same for the kit's font sheet, which must also stay byte-identical to
  // the signage repo's copy (test/brand-kit.test.mjs).
  const fonts = fontUrls(readFileSync(FONTS_SHEET, 'utf8'));
  assert.ok(fonts.length > 0);
  for (const url of fonts) assert.equal(url.includes('?v='), false, `${url} is unversioned in git`);
});

test('the brand stylesheets and the wordmark are among the versioned assets', () => {
  // A reload onto a new build must not pair its new page with last deploy's
  // colours, @font-face rules or mark out of the ten-minute disk cache.
  for (const asset of ['brand/tokens.css', 'brand/fonts.css', 'brand/logos/journey-white.svg']) {
    assert.ok(STAMPED_ASSETS.includes(asset), `${asset} is stamped`);
  }
});

test('stamping writes the build id into the meta and onto the assets', () => {
  const dir = scratchPublic();
  const sha = '0123456789abcdef0123456789abcdef01234567';
  const { html, fontsCss, version } = stampBuild(sha, dir, '2026-09-16T18:00:00.000Z');

  assert.match(html, new RegExp(`<meta name="journey-build" content="${sha}"`));
  for (const asset of STAMPED_ASSETS) assert.ok(html.includes(`${asset}?v=${sha}`));
  assertEveryLocalRefStamped(html, sha);
  assert.deepEqual(JSON.parse(version), { build: sha, builtAt: '2026-09-16T18:00:00.000Z' });

  // All three files really landed in the directory that gets uploaded.
  assert.equal(readFileSync(path.join(dir, 'index.html'), 'utf8'), html);
  assert.equal(readFileSync(path.join(dir, FONTS_CSS), 'utf8'), fontsCss);
  assert.deepEqual(JSON.parse(readFileSync(path.join(dir, 'version.json'), 'utf8')).build, sha);
  rmSync(dir, { recursive: true, force: true });
});

test('every font URL carries the hash of the very bytes it names', () => {
  const dir = scratchPublic();
  const { fontsCss } = stampBuild('ccc333', dir, '2026-09-16T18:00:00.000Z');
  const urls = fontUrls(fontsCss);
  assert.equal(urls.length, fontUrls(readFileSync(FONTS_SHEET, 'utf8')).length, 'no URL was dropped');
  for (const url of urls) {
    const [rel, query] = url.split('?');
    const file = path.join(dir, 'brand', rel);
    assert.ok(existsSync(file), `${rel} is deployed`);
    assert.equal(query, `v=${shortHash(file)}`, `${rel} is versioned by its own content`);
  }
  // The build id is not what versions a font: a deploy that leaves the fonts
  // alone must not make the Pi fetch them again.
  assert.equal(fontsCss.includes('ccc333'), false);
  rmSync(dir, { recursive: true, force: true });
});

test('a changed font gets a new URL, an unchanged one keeps its old one', () => {
  const dir = scratchPublic();
  const before = fontUrls(stampBuild('ddd444', dir, '2026-09-16T18:00:00.000Z').fontsCss);
  const galindo = path.join(dir, 'brand', 'fonts', 'galindo-latin-400-normal.woff2');
  writeFileSync(galindo, Buffer.concat([readFileSync(galindo), Buffer.from([0])]));
  const after = fontUrls(stampBuild('eee555', dir, '2026-09-16T19:00:00.000Z').fontsCss);

  const changed = before.filter((url, i) => url !== after[i]);
  assert.deepEqual(
    changed.map((url) => url.split('?')[0]),
    ['fonts/galindo-latin-400-normal.woff2'],
    'only the font whose bytes moved got a new URL'
  );
  rmSync(dir, { recursive: true, force: true });
});

test('a font sheet naming a missing font, or no fonts at all, fails the deploy', () => {
  const dir = scratchPublic();
  rmSync(path.join(dir, 'brand', 'fonts', 'Galindo-Regular.ttf'));
  assert.throws(() => stampBuild('fff666', dir), /Galindo-Regular\.ttf/);
  rmSync(dir, { recursive: true, force: true });

  assert.throws(() => stampFontsCss('@font-face { font-family: X; }', () => 'x'), /no fonts/);
});

test('stamping is idempotent, and a new build leaves no trace of the old one', () => {
  const dir = scratchPublic();
  const once = stampBuild('aaa111', dir, '2026-09-16T18:00:00.000Z').html;
  const twice = stampBuild('aaa111', dir, '2026-09-16T18:00:00.000Z').html;
  assert.equal(twice, once);

  const next = stampBuild('bbb222', dir, '2026-09-16T19:00:00.000Z').html;
  assert.equal(next.includes('aaa111'), false);
  for (const asset of STAMPED_ASSETS) assert.ok(next.includes(`${asset}?v=bbb222`));
  assertEveryLocalRefStamped(next, 'bbb222');

  // The font sheet too: stamping an already-stamped sheet changes nothing.
  const fontsOnce = readFileSync(path.join(dir, FONTS_CSS), 'utf8');
  stampBuild('bbb222', dir, '2026-09-16T19:00:00.000Z');
  assert.equal(readFileSync(path.join(dir, FONTS_CSS), 'utf8'), fontsOnce);
  assert.equal(/\?v=[^'")]*\?v=/.test(fontsOnce), false, 'never a second ?v=');
  rmSync(dir, { recursive: true, force: true });
});

test('a page with no build meta fails the deploy rather than shipping mute', () => {
  // A page that cannot say which build it is can never notice a new one, and
  // a kiosk that silently stops updating itself is the failure this exists to
  // prevent. Better a red workflow run.
  assert.throws(() => stampHtml('<html><head></head><body></body></html>', 'abc'), /journey-build/);
});
