// The sync service from Journey's side (public/src/sync.js): hidden until the
// display site names a service, sign-in with the church passphrase into the
// slots the embedded lobby screen shares, the room settings following the
// service, a change here going back to it, and video quality never travelling.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { bootKiosk, tick } from './kiosk-dom.mjs';

const REPO = path.dirname(new URL(import.meta.url).pathname).replace(/\/test$/, '');
const SYNC_JS = readFileSync(path.join(REPO, 'public', 'src', 'sync.js'), 'utf8');
const SERVICE = 'https://awana-sync.test.workers.dev';
const SESSION = 'v1.1.1790839331729.oWr6n92IJW5ldPGmtiyjPHAZpca-QGToNlKGXlKI6vc';
const KEY = 'AQIDBAUGBwgJCgsMDQ4PEBESExQVFhcYGRobHB0eHyA=';

const settle = async () => { for (let i = 0; i < 8; i++) await tick(); };

/** Boot the kiosk, then sync.js against a stand-in service. */
function boot({ url = SERVICE, journey = null, prefs = {}, stateStatus = 200 } = {}) {
  const kiosk = bootKiosk({}, prefs);
  const { window } = kiosk;
  const calls = [];
  const inner = window.fetch;
  const reply = (status, body) => Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  });
  window.fetch = (u, init = {}) => {
    const href = String(u);
    if (href.endsWith('/shared/sync.json')) return reply(200, { url });
    if (!href.startsWith(SERVICE)) return inner(u, init);
    const route = href.slice(SERVICE.length);
    const body = init.body ? JSON.parse(init.body) : null;
    calls.push({ route, method: init.method || 'GET', body, auth: (init.headers || {}).Authorization || null });
    if (route === '/v1/login') {
      if (body.passphrase !== 'kennebec') return reply(401, { triesLeft: 4 });
      return reply(200, { session: SESSION, displayKey: KEY, pusher: { key: 'pk', cluster: 'us2' }, state: { journey } });
    }
    if (route === '/v1/state') return reply(stateStatus, { journey });
    if (route === '/v1/journey') return reply(200, { savedAt: '2026-10-01T19:00:00.000Z', settings: body.settings });
    return reply(404, {});
  };
  const script = window.document.createElement('script');
  script.textContent = SYNC_JS;
  window.document.body.appendChild(script);
  return { ...kiosk, calls };
}

const ROOM = {
  savedAt: '2026-10-01T18:00:00.000Z',
  settings: {
    captions: true, captionSize: '1.3', captionBackdrop: true, slidesAutoAdvanceSec: 30,
    slideExtras: { questions: false, takeaways: true, challenges: true },
    slideNotes: { 5: { questions: ['What is grace?'] } },
  },
};

test('hidden, and silent, until the display site names a service', async () => {
  const k = boot({ url: '' });
  await settle();
  assert.ok(k.document.getElementById('settings-sync').classList.contains('hidden'));
  assert.equal(k.calls.length, 0);
  k.close();
});

test('"kennebec" signs in into the slots the lobby screen shares, and takes the room\'s settings', async () => {
  const k = boot({ journey: ROOM });
  await settle();
  const doc = k.document;
  assert.ok(!doc.getElementById('settings-sync').classList.contains('hidden'));

  doc.getElementById('sync-passphrase').value = 'kenebec';
  doc.getElementById('sync-signin-btn').click();
  await settle();
  assert.match(doc.getElementById('sync-status').textContent, /4 tries left/);

  doc.getElementById('sync-passphrase').value = '  Kennebec ';
  doc.getElementById('sync-signin-btn').click();
  await settle();
  const ls = k.window.localStorage;
  assert.equal(ls.getItem('awanaSyncSession.v1'), SESSION);
  assert.equal(ls.getItem('awanaDisplayKey.v1'), KEY);
  assert.equal(JSON.parse(ls.getItem('awanaConfig.v1')).pusherAppKey, 'pk');
  assert.ok(doc.getElementById('sync-signin').classList.contains('hidden'));

  assert.equal(ls.getItem('journey.captions'), 'on');
  assert.equal(ls.getItem('journey.captions.size'), '1.3');
  assert.equal(ls.getItem('journey.captions.backdrop'), 'on');
  assert.equal(ls.getItem('journey.slides.autoAdvanceSec'), '30');
  assert.deepEqual(JSON.parse(ls.getItem('journey.slides.notesOverride')), { 5: { questions: ['What is grace?'] } });
  // The live controls follow, through schedule.js's own helpers.
  assert.equal(doc.getElementById('captions-size').value, '1.3');
  assert.equal(doc.getElementById('captions-backdrop').checked, true);
  assert.equal(doc.getElementById('slides-auto-advance').value, '30');
  assert.equal(doc.getElementById('slides-extra-questions').checked, false);
  k.close();
});

test('a signed-in screen pulls the room\'s settings at start', async () => {
  const k = boot({ journey: ROOM, prefs: { 'awanaSyncSession.v1': SESSION } });
  await settle();
  const pull = k.calls.find((c) => c.route === '/v1/state');
  assert.equal(pull.auth, `Bearer ${SESSION}`);
  assert.equal(k.window.localStorage.getItem('journey.captions.size'), '1.3');
  k.close();
});

test('a change here goes to every Journey screen, and video quality never does', async () => {
  const k = boot({ journey: ROOM, prefs: { 'awanaSyncSession.v1': SESSION, 'journey.playback.quality': 'low' } });
  await settle();
  const size = k.document.getElementById('captions-size');
  size.value = '0.8';
  size.dispatchEvent(new k.window.Event('change', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 1200));
  await settle();
  const put = k.calls.filter((c) => c.route === '/v1/journey' && c.method === 'PUT').at(-1);
  assert.ok(put, 'a PUT went out');
  assert.equal(put.body.settings.captionSize, '0.8');
  assert.equal(JSON.stringify(put.body).includes('quality'), false);
  assert.equal(JSON.stringify(put.body).includes('playback'), false);
  k.close();
});

test('a passphrase change elsewhere signs this screen out and says so', async () => {
  const k = boot({ journey: ROOM, prefs: { 'awanaSyncSession.v1': SESSION }, stateStatus: 401 });
  await settle();
  assert.equal(k.window.localStorage.getItem('awanaSyncSession.v1'), null);
  assert.match(k.document.getElementById('sync-status').textContent, /passphrase was changed/);
  assert.ok(!k.document.getElementById('sync-signin').classList.contains('hidden'));
  k.close();
});
