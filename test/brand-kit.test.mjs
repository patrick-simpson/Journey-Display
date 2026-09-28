// The brand kit mirror and the page's use of it.
//
// public/brand/ is a byte-identical copy of the signage repo's shared/brand/
// (the canonical kit), so the kiosk never depends on another site or the
// network for its own fonts and colours. These tests are the drift check: the
// mirror must match data/brand-kit-manifest.json file for file, the page must
// load only self-hosted brand assets, style.css's fallbacks and baked art must
// agree with the kit, and the Pi Zero's paint budget (flat, one keyframe, no
// blur) is pinned rather than remembered.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { diffTrees, hashTree, MANIFEST_PATH, MIRROR_DIR, syncBrandKit } from '../scripts/sync-brand-kit.mjs';

const REPO = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const PUBLIC = path.join(REPO, 'public');
const read = (rel) => readFileSync(path.join(PUBLIC, rel), 'utf8');
const manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8'));
const html = read('index.html');
const styleCss = read('src/style.css');

const stripComments = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '');

/* { selector, body } for every plain rule, including the ones inside @media. */
function rules(css) {
  return [...stripComments(css).matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({
    selector: m[1].trim(),
    body: m[2],
  }));
}

/* Splits on commas that are not inside parentheses. */
function splitTop(value, sep = ',') {
  const parts = [];
  let depth = 0;
  let cur = '';
  for (const ch of value) {
    if (ch === '(') depth += 1;
    if (ch === ')') depth -= 1;
    if (depth === 0 && (sep === ' ' ? /\s/.test(ch) : ch === sep)) {
      if (cur.trim()) parts.push(cur.trim());
      cur = '';
    } else cur += ch;
  }
  if (cur.trim()) parts.push(cur.trim());
  return parts;
}

test('public/brand/ is exactly the manifest, file for file', () => {
  const drift = diffTrees(manifest.files, hashTree(MIRROR_DIR));
  assert.deepEqual(
    drift,
    [],
    'public/brand/ must be a byte-identical copy of the kit: re-run ' +
      'node scripts/sync-brand-kit.mjs <Awana-Check-in-Display checkout> rather than editing it by hand'
  );
  assert.equal(manifest.source, 'Awana-Check-in-Display/shared/brand/');
});

test('the mirror carries everything this page loads, fonts with their licences', () => {
  for (const rel of [
    'tokens.css',
    'tokens.json',
    'fonts.css',
    'logos/journey-white.svg',
    'fonts/galindo-latin-400-normal.woff2',
    'fonts/londrina-solid-latin-400-normal.woff2',
    'fonts/figtree-latin-wght-normal.woff2',
    'fonts/OFL-Galindo.txt',
    'fonts/OFL-LondrinaSolid.txt',
    'fonts/OFL-Figtree.txt',
  ]) {
    assert.ok(rel in manifest.files, `${rel} is in the mirror`);
  }
  // Every font the kit's sheet names is really there.
  for (const m of read('brand/fonts.css').matchAll(/url\((['"]?)([^'")?]+)\1\)/g)) {
    assert.ok(existsSync(path.join(PUBLIC, 'brand', m[2])), `brand/${m[2]} exists`);
  }
});

test('the drift check notices a changed, a missing and an extra file', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'journey-brand-'));
  cpSync(MIRROR_DIR, dir, { recursive: true });
  assert.deepEqual(diffTrees(manifest.files, hashTree(dir)), []);

  writeFileSync(path.join(dir, 'tokens.css'), `${read('brand/tokens.css')}\n/* hand edit */\n`);
  rmSync(path.join(dir, 'logos', 'journey-white.svg'));
  writeFileSync(path.join(dir, 'stray.css'), 'body{}');
  assert.deepEqual(diffTrees(manifest.files, hashTree(dir)).sort(), [
    'changed: tokens.css',
    'extra: stray.css',
    'missing: logos/journey-white.svg',
  ]);
  rmSync(dir, { recursive: true, force: true });
});

test('--check against a signage checkout compares without writing anything', () => {
  // A fake signage checkout whose kit is this mirror: no drift, and the
  // mirror and the manifest are left exactly as they were.
  const checkout = mkdtempSync(path.join(os.tmpdir(), 'journey-signage-'));
  cpSync(MIRROR_DIR, path.join(checkout, 'shared', 'brand'), { recursive: true });
  const before = readFileSync(MANIFEST_PATH, 'utf8');
  const { drift } = syncBrandKit(checkout, { check: true });
  assert.deepEqual(drift, []);
  assert.equal(readFileSync(MANIFEST_PATH, 'utf8'), before);

  writeFileSync(path.join(checkout, 'shared', 'brand', 'tokens.css'), ':root{}');
  assert.deepEqual(syncBrandKit(checkout, { check: true }).drift, ['changed: tokens.css']);
  assert.throws(() => syncBrandKit(os.tmpdir(), { check: true }), /not the brand kit/);
  rmSync(checkout, { recursive: true, force: true });
});

test('the page links the kit and loads nothing from the network', () => {
  const links = [...html.matchAll(/<link\b[^>]*href="([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(links, ['brand/tokens.css', 'brand/fonts.css', 'src/style.css']);
  for (const src of [...html.matchAll(/<(?:img|script)\b[^>]*src="([^"]+)"/g)].map((m) => m[1])) {
    assert.doesNotMatch(src, /^(https?:)?\/\//, `${src} is self-hosted`);
    assert.ok(existsSync(path.join(PUBLIC, src)), `${src} exists`);
  }
  // The one cross-origin thing on the page is the Check-in Display itself.
  const external = [...html.matchAll(/(?:src|href)="(https?:[^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(external, ['https://patrick-simpson.github.io/Awana-Check-in-Display/?lowPower=1']);

  for (const [name, css] of [
    ['style.css', styleCss],
    ['brand/fonts.css', read('brand/fonts.css')],
    ['brand/tokens.css', read('brand/tokens.css')],
  ]) {
    assert.doesNotMatch(stripComments(css), /@import|url\(\s*['"]?(https?:)?\/\//, `${name} fetches nothing remote`);
  }
});

test("every kit fallback in style.css is the kit's own value", () => {
  const tokens = Object.fromEntries(
    [...read('brand/tokens.css').matchAll(/(--brand-[\w-]+)\s*:\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()])
  );
  const norm = (v) => v.replace(/\s+/g, ' ').replace(/\s*,\s*/g, ', ').trim().toLowerCase();
  const uses = [...stripComments(styleCss).matchAll(/var\((--brand-[\w-]+),\s*((?:[^()]|\([^()]*\))+)\)/g)];
  assert.ok(uses.length >= 10, 'style.css reads the kit through its tokens');
  for (const [, name, fallback] of uses) {
    assert.ok(name in tokens, `${name} is a kit token`);
    assert.equal(norm(fallback), norm(tokens[name]), `${name}'s fallback matches tokens.css`);
  }
});

test("the baked art is the kit's own shapes, path for path", () => {
  const kitPaths = new Set();
  for (const rel of Object.keys(manifest.files)) {
    if (!/^(shapes|doodles)\/.*\.svg$/.test(rel)) continue;
    for (const m of read(`brand/${rel}`).matchAll(/\sd="([^"]+)"/g)) kitPaths.add(m[1]);
  }
  const baked = [...styleCss.matchAll(/\sd='([^']+)'/g)].map((m) => m[1]);
  assert.ok(baked.length >= 8, 'the wave, the tab and the doodles are all baked in');
  for (const d of baked) assert.ok(kitPaths.has(d), `baked path ${d.slice(0, 24)}… is in the kit`);
  // Journey's own wave and tab, not another club's.
  for (const rel of ['shapes/wave-journey.svg', 'shapes/tab-c-journey.svg']) {
    const d = read(`brand/${rel}`).match(/\sd="([^"]+)"/)[1];
    assert.ok(baked.includes(d), `${rel} is on the page`);
  }
});

test("the colours that were never Journey's are gone", () => {
  // The old kiosk borrowed a red from Awana's general palette and a gold that
  // is not in Journey's palette, and set everything in system type.
  for (const hex of ['#c8102e', '#e8123a', '#a00d25', '#ff2e52', '#f2b705', '#f0b429', '#ff6b83']) {
    assert.equal(styleCss.toLowerCase().includes(hex), false, `${hex} is gone`);
  }
  const systemType = rules(styleCss).filter(
    (r) => /font-family:\s*system-ui/.test(r.body) && !r.selector.includes('#slide-template')
  );
  assert.deepEqual(systemType.map((r) => r.selector), [], 'every face comes from the kit');
});

test("Awana's template slide keeps the deck's own type", () => {
  // The generated TEMPLATE slide reproduces Awana's deck, so it is the one
  // place the kit's faces do not reach.
  const rule = rules(styleCss).find((r) => r.selector === '#slide-template');
  assert.match(rule.body, /font-family:\s*Calibri,\s*Carlito/);
});

test('the Pi Zero paint budget: one keyframe, no filters, no gradients, no blur', () => {
  const css = stripComments(styleCss);
  assert.deepEqual([...css.matchAll(/@keyframes\s+([\w-]+)/g)].map((m) => m[1]), ['journey-splash-pulse']);
  for (const m of css.matchAll(/animation(?:-name)?\s*:\s*([^;]+);/g)) {
    assert.match(m[1], /^journey-splash-pulse\b/, 'the pulse is the only animation');
  }
  assert.doesNotMatch(css, /(^|[^-])filter\s*:/, 'no filters');
  assert.doesNotMatch(css, /backdrop-filter/, 'no backdrop blur');
  assert.doesNotMatch(css, /gradient\(/, 'flat fills only');

  // Every shadow is a hard offset (zero blur). The one exception is Awana's
  // own template slide, whose soft text shadow copies the deck.
  for (const { selector, body } of rules(styleCss)) {
    for (const m of body.matchAll(/(?:box|text)-shadow\s*:\s*([^;]+)/g)) {
      if (m[1].trim() === 'none') continue;
      for (const shadow of splitTop(m[1])) {
        const lengths = splitTop(shadow, ' ').filter((t) => /^-?[\d.]+[a-z%]*$/.test(t));
        const blur = lengths[2] || '0';
        if (selector === '#slide-template') continue;
        assert.equal(parseFloat(blur), 0, `${selector}: "${shadow}" has no blur`);
      }
    }
  }
});
