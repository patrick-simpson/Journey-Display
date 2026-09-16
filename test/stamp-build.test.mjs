// Deploy-time build stamping. The kiosk's whole self-update story rests on
// this script having rewritten the copy that went to Pages, so the contract it
// depends on (a placeholder meta in the committed page, plain asset paths) is
// pinned here too.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { stampBuild, stampHtml, STAMPED_ASSETS } from '../scripts/stamp-build.mjs';

const REPO = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const PAGE = path.join(REPO, 'public', 'index.html');

/* A scratch copy of the real public/, the way the workflow stamps a fresh
   checkout. Nothing here writes to the repo. */
function scratchPublic() {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'journey-stamp-'));
  cpSync(path.join(REPO, 'public', 'index.html'), path.join(dir, 'index.html'));
  return dir;
}

test('the committed page carries the placeholder the workflow replaces', () => {
  const html = readFileSync(PAGE, 'utf8');
  assert.match(html, /<meta name="journey-build" content="dev" \/>/);
  // Plain paths in git: only the deployed copy is versioned.
  for (const asset of STAMPED_ASSETS) {
    assert.equal(html.includes(`${asset}?v=`), false, `${asset} is unversioned in git`);
    assert.equal(html.includes(asset), true);
  }
});

test('stamping writes the build id into the meta and onto the assets', () => {
  const dir = scratchPublic();
  const sha = '0123456789abcdef0123456789abcdef01234567';
  const { html, version } = stampBuild(sha, dir, '2026-09-16T18:00:00.000Z');

  assert.match(html, new RegExp(`<meta name="journey-build" content="${sha}"`));
  for (const asset of STAMPED_ASSETS) assert.ok(html.includes(`${asset}?v=${sha}`));
  assert.deepEqual(JSON.parse(version), { build: sha, builtAt: '2026-09-16T18:00:00.000Z' });

  // Both files really landed in the directory that gets uploaded.
  assert.equal(readFileSync(path.join(dir, 'index.html'), 'utf8'), html);
  assert.deepEqual(JSON.parse(readFileSync(path.join(dir, 'version.json'), 'utf8')).build, sha);
  rmSync(dir, { recursive: true, force: true });
});

test('stamping is idempotent, and a new build leaves no trace of the old one', () => {
  const dir = scratchPublic();
  const once = stampBuild('aaa111', dir, '2026-09-16T18:00:00.000Z').html;
  const twice = stampBuild('aaa111', dir, '2026-09-16T18:00:00.000Z').html;
  assert.equal(twice, once);

  const next = stampBuild('bbb222', dir, '2026-09-16T19:00:00.000Z').html;
  assert.equal(next.includes('aaa111'), false);
  for (const asset of STAMPED_ASSETS) assert.ok(next.includes(`${asset}?v=bbb222`));
  rmSync(dir, { recursive: true, force: true });
});

test('a page with no build meta fails the deploy rather than shipping mute', () => {
  // A page that cannot say which build it is can never notice a new one, and
  // a kiosk that silently stops updating itself is the failure this exists to
  // prevent. Better a red workflow run.
  assert.throws(() => stampHtml('<html><head></head><body></body></html>', 'abc'), /journey-build/);
});
