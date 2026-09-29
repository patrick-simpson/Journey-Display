// The about page (public/about.html) and the kit.
//
// The page is a static showcase for church leadership that the kiosk never
// loads, so nothing else would notice if its screen recreations drifted from
// the screen. Its 6:30 start-screen recreation (Fig. 1 and the resume card)
// is drawn in the kiosk's 2026-27 kit; these pin that to the mirror in
// public/brand/, and keep the faces the owner retired (Galindo, 2026-09-29:
// "looks too much like SpongeBob") from coming back to the page.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PUBLIC = path.join(path.dirname(path.dirname(fileURLToPath(import.meta.url))), 'public');
const read = (rel) => readFileSync(path.join(PUBLIC, rel), 'utf8');
// What the browser acts on: the story a comment tells is allowed.
const live = read('about.html').replace(/<!--[\s\S]*?-->/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
const style = live.match(/<style>([\s\S]*?)<\/style>/)[1];
const tokens = read('brand/tokens.css');

const token = (css, name) => css.match(new RegExp(`${name}:\\s*([^;]+);`))?.[1].trim();
const luminance = (hex) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a, b) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

test('the about page names neither Galindo nor Lilita One, and asks Google only for its editorial faces', () => {
  assert.doesNotMatch(live, /galindo/i);
  assert.doesNotMatch(live, /lilita/i);
  const families = [...live.matchAll(/fonts\.googleapis\.com\/css2\?([^"']+)/g)]
    .flatMap(([, query]) => [...query.replace(/&amp;/g, '&').matchAll(/family=([^:&@]+)/g)].map((m) => m[1]));
  assert.deepEqual(families.sort(), ['Fraunces', 'IBM+Plex+Mono', 'Source+Sans+3']);
});

test('the about page loads the kit\'s own self-hosted faces, never a third party\'s', () => {
  assert.match(live, /<link[^>]+rel="stylesheet"[^>]+href="brand\/fonts\.css"/);
  const fontsCss = read('brand/fonts.css');
  for (const family of ['Paytone One', 'Londrina Solid', 'Figtree']) {
    assert.match(fontsCss, new RegExp(`font-family:\\s*'${family}'`));
  }
  for (const [, file] of fontsCss.matchAll(/url\('([^']+)'\)/g)) {
    assert.ok(existsSync(path.join(PUBLIC, 'brand', file)), `${file} is in the mirror`);
  }
  // The three voices lead with the kit's families, in the kit's roles.
  const voice = (name) => token(style, `--jd-${name}`);
  assert.match(voice('shout'), /^"Paytone One"/);
  assert.match(voice('label'), /^"Londrina Solid"/);
  assert.match(voice('read'), /^"Figtree"/);
  assert.match(token(tokens, '--brand-font-display'), /^'Paytone One'/);
  assert.match(token(tokens, '--brand-font-label'), /^'Londrina Solid'/);
  assert.match(token(tokens, '--brand-font-body'), /^'Figtree'/);
});

test('the start-screen recreation is drawn in the kit\'s Journey colours', () => {
  const same = (mine, kit) => assert.equal(token(style, mine).toLowerCase(), token(tokens, kit).toLowerCase(), `${mine} is ${kit}`);
  same('--jd-ink', '--brand-journey-ink');
  same('--jd-purple', '--brand-journey');
  same('--jd-deep', '--brand-journey-deep');
  same('--jd-tint', '--brand-journey-tint');
  same('--jd-hot-deep', '--brand-hot-deep');
  // The button's orange is the one deliberate departure: a shade deeper than
  // the kit's hot, so its white label passes AA at the size a mock draws it.
  const hot = token(style, '--jd-hot');
  assert.notEqual(hot.toLowerCase(), token(tokens, '--brand-hot').toLowerCase());
  assert.ok(contrast('#ffffff', hot) >= 4.5, `white on ${hot} passes AA`);
  assert.ok(contrast('#ffffff', token(tokens, '--brand-hot')) < 4.5, 'and the kit\'s own would not, which is why');
});

test('the start-screen rules use the kit, not the pre-kit black, red, gold and system font', () => {
  const splash = [...style.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .map(([, selector, body]) => ({ selector: selector.trim(), body }))
    .filter(({ selector }) => /\.jd-(splash|kbtn|ink|wave|doodles|art|demo-splash)/.test(selector));
  assert.ok(splash.length >= 15, 'found the start screen\'s rules');
  for (const { selector, body } of splash) {
    assert.doesNotMatch(body, /--jd-red|--jd-gold|--jd-kiosk-font|#000\b|#c8102e|#f2b705/i, selector);
  }
  // Fig. 1 sits on the indigo field, not the black one the other recreations keep.
  assert.match(live, /class="fam-frame__screen jd-ink"[^>]*>\s*<div class="jd-splash">/);
  // One-weight faces are never asked for a bold they do not have.
  assert.match(style, /\.jd-ink\s*\{[^}]*font-synthesis-weight:\s*none/);
});

test('the page draws its own art: no image, no Awana wordmark, nothing copied from the kit', () => {
  assert.doesNotMatch(live, /<img\b/i);
  assert.doesNotMatch(live, /brand\/(logos|shapes|doodles)\//);
});
