/* The Awana sync service, Journey's half (owner, 2026-10-01: "type kennebec
   and have it sync everything up").

   The family's screens share one always-on service (the Awana Check-in
   Display repo's worker/). This kiosk signs in to it with the church
   passphrase from Settings, and then its ROOM settings follow every other
   Journey screen: captions on/off, caption size and backdrop, the teaching
   slides' auto-advance and extras, and tonight's edited bullets. Video
   quality and the leader prep transcript choice stay on this device, because
   they depend on the device and on the leader.

   - The sign-in lives in the SAME localStorage slots the lobby signage uses
     (this page and the embedded Check-in Display share an origin), so signing
     in here also sets the embedded lobby screen up, and the other way round.
   - Light on purpose (the kiosk is a Pi Zero): one fetch at start, one every
     ten minutes and on reconnect, and one PUT a second after a room setting
     changes here. No socket of its own.
   - Until the display site's shared/sync.json names a service, the Settings
     section stays hidden and nothing here runs. */

(function () {
  'use strict';

  var SYNC_INDEX = 'https://patrick-simpson.github.io/Awana-Check-in-Display/shared/sync.json';
  var SESSION_KEY = 'awanaSyncSession.v1';
  var DISPLAY_KEY = 'awanaDisplayKey.v1';
  var CONFIG_KEY = 'awanaConfig.v1';
  var APPLIED_KEY = 'journey.sync.savedAt';
  var POLL_MS = 10 * 60 * 1000;
  var PUSH_DELAY_MS = 1000;
  var SESSION_RE = /^v1\.\d+\.\d+\.[A-Za-z0-9_-]{20,}$/;

  // The room keys, in Journey's own storage formats (schedule.js owns them).
  var KEYS = {
    captions: 'journey.captions',
    captionSize: 'journey.captions.size',
    captionBackdrop: 'journey.captions.backdrop',
    slidesAutoAdvanceSec: 'journey.slides.autoAdvanceSec',
    slideExtras: 'journey.slides.extras',
    slideNotes: 'journey.slides.notesOverride',
  };
  var CAPTION_SIZES = ['0.8', '1', '1.3', '1.6'];

  var base = '';
  var pushTimer = null;
  var lastPushed = '';

  function get(key) {
    try { return localStorage.getItem(key); } catch (e) { return null; }
  }
  function set(key, value) {
    try {
      if (value === null || value === undefined) localStorage.removeItem(key);
      else localStorage.setItem(key, value);
      return true;
    } catch (e) { return false; }
  }
  function session() {
    var s = (get(SESSION_KEY) || '').trim();
    return SESSION_RE.test(s) ? s : '';
  }
  function normalize(p) {
    return String(p == null ? '' : p).trim().normalize('NFKC').toLowerCase();
  }
  function parse(json) {
    try { return JSON.parse(json); } catch (e) { return null; }
  }

  /* This device's room settings, as the service stores them. */
  function readRoom() {
    var out = {};
    var cc = get(KEYS.captions);
    if (cc === 'on' || cc === 'off') out.captions = cc === 'on';
    var size = get(KEYS.captionSize);
    if (CAPTION_SIZES.indexOf(size) !== -1) out.captionSize = size;
    var backdrop = get(KEYS.captionBackdrop);
    if (backdrop === 'on' || backdrop === 'off') out.captionBackdrop = backdrop === 'on';
    var auto = get(KEYS.slidesAutoAdvanceSec);
    if (auto !== null && isFinite(Number(auto))) out.slidesAutoAdvanceSec = Number(auto);
    var extras = parse(get(KEYS.slideExtras));
    if (extras && typeof extras === 'object') out.slideExtras = extras;
    var notes = parse(get(KEYS.slideNotes));
    if (notes && typeof notes === 'object') out.slideNotes = notes;
    return out;
  }

  /* The service's room settings into this device's storage, then the live
     page brought up to date through schedule.js's own helpers. Captions
     on/off takes effect at the next video, the way a stored choice does. */
  function applyRoom(s) {
    if (!s || typeof s !== 'object') return;
    if (typeof s.captions === 'boolean') set(KEYS.captions, s.captions ? 'on' : 'off');
    if (CAPTION_SIZES.indexOf(s.captionSize) !== -1) set(KEYS.captionSize, s.captionSize);
    if (typeof s.captionBackdrop === 'boolean') set(KEYS.captionBackdrop, s.captionBackdrop ? 'on' : 'off');
    if (typeof s.slidesAutoAdvanceSec === 'number') set(KEYS.slidesAutoAdvanceSec, String(s.slidesAutoAdvanceSec));
    if (s.slideExtras && typeof s.slideExtras === 'object') set(KEYS.slideExtras, JSON.stringify(s.slideExtras));
    if (s.slideNotes && typeof s.slideNotes === 'object') set(KEYS.slideNotes, JSON.stringify(s.slideNotes));
    lastPushed = JSON.stringify(readRoom());
    var sizeSelect = document.getElementById('captions-size');
    var backdropBox = document.getElementById('captions-backdrop');
    if (sizeSelect && s.captionSize) sizeSelect.value = s.captionSize;
    if (backdropBox && typeof s.captionBackdrop === 'boolean') backdropBox.checked = s.captionBackdrop;
    try {
      if (typeof window.applyCaptionDisplayPrefs === 'function') window.applyCaptionDisplayPrefs();
      if (typeof window.syncSlidesPrefInputs === 'function') window.syncSlidesPrefInputs();
    } catch (e) { /* the stored values still apply on the next load */ }
  }

  function request(path, opts) {
    opts = opts || {};
    var headers = {};
    if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
    if (opts.session) headers.Authorization = 'Bearer ' + opts.session;
    return fetch(base + path, {
      method: opts.method || 'GET',
      headers: headers,
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
      cache: 'no-store',
    }).then(function (res) {
      return res.json().then(function (b) { return { ok: res.ok, status: res.status, body: b }; },
        function () { return { ok: res.ok, status: res.status, body: null }; });
    }, function () { return { ok: false, status: 0, body: null }; });
  }

  function note(text, tone) {
    var el = document.getElementById('sync-status');
    if (!el) return;
    el.textContent = text;
    el.dataset.tone = tone || 'muted';
  }

  function render() {
    var section = document.getElementById('settings-sync');
    if (!section) return;
    section.classList.toggle('hidden', !base);
    var signedIn = Boolean(session());
    document.getElementById('sync-signin').classList.toggle('hidden', signedIn);
    document.getElementById('sync-signed-in').classList.toggle('hidden', !signedIn);
  }

  function pull() {
    var s = session();
    if (!base || !s) return Promise.resolve();
    return request('/v1/state', { session: s }).then(function (res) {
      if (res.status === 401) {
        set(SESSION_KEY, null);
        render();
        note('The passphrase was changed. Type the new one to sign this screen in again.', 'bad');
        return;
      }
      if (!res.ok || !res.body) return;
      var journey = res.body.journey;
      if (!journey || typeof journey.savedAt !== 'string') return;
      if (journey.savedAt === get(APPLIED_KEY)) return;
      applyRoom(journey.settings);
      set(APPLIED_KEY, journey.savedAt);
    });
  }

  function push() {
    var s = session();
    if (!base || !s) return;
    var room = readRoom();
    var snapshot = JSON.stringify(room);
    if (snapshot === lastPushed) return;
    request('/v1/journey', { method: 'PUT', body: { settings: room }, session: s }).then(function (res) {
      if (res.ok && res.body && typeof res.body.savedAt === 'string') {
        lastPushed = snapshot;
        set(APPLIED_KEY, res.body.savedAt);
        note('Saved for every Journey screen.', 'ok');
      } else if (res.status === 401) {
        set(SESSION_KEY, null);
        render();
        note('The passphrase was changed. Type the new one to sign this screen in again.', 'bad');
      } else {
        note('Could not reach the sync service, so this change stayed on this screen.', 'bad');
      }
    });
  }

  function schedulePush() {
    if (!base || !session()) return;
    clearTimeout(pushTimer);
    pushTimer = setTimeout(push, PUSH_DELAY_MS);
  }

  function signIn() {
    var input = document.getElementById('sync-passphrase');
    var passphrase = normalize(input.value);
    if (!passphrase) { note('Type the passphrase first.', 'bad'); return; }
    note('Signing in…');
    request('/v1/login', { method: 'POST', body: { passphrase: passphrase } }).then(function (res) {
      var b = res.body || {};
      if (res.status === 401) {
        note('That is not the passphrase.' + (typeof b.triesLeft === 'number' ? ' ' + b.triesLeft + ' tries left before a 15-minute wait.' : ''), 'bad');
        return;
      }
      if (res.status === 429) { note('Too many wrong tries. Wait a little, then try again.', 'bad'); return; }
      if (!res.ok || !SESSION_RE.test(b.session || '') || typeof b.displayKey !== 'string') {
        note(res.status === 0 ? 'Could not reach the sync service. Check the internet connection.' : (b.error || 'Sign-in failed.'), 'bad');
        return;
      }
      set(SESSION_KEY, b.session);
      set(DISPLAY_KEY, b.displayKey);
      // The embedded lobby screen shares this storage: hand it the Pusher key
      // too if it has none, so it is fully set up by the same sign-in.
      var cfg = parse(get(CONFIG_KEY)) || {};
      if (b.pusher && b.pusher.key && !cfg.pusherAppKey) {
        cfg.pusherAppKey = b.pusher.key;
        if (b.pusher.cluster) cfg.pusherCluster = b.pusher.cluster;
        set(CONFIG_KEY, JSON.stringify(cfg));
      }
      input.value = '';
      render();
      note('Signed in. Room settings now follow every Journey screen.', 'ok');
      var journey = b.state && b.state.journey;
      if (journey && typeof journey.savedAt === 'string') {
        applyRoom(journey.settings);
        set(APPLIED_KEY, journey.savedAt);
      } else {
        // First Journey screen signed in: its settings become the room's.
        lastPushed = '';
        push();
      }
      var frame = document.querySelector('#checkin-view iframe');
      if (frame && frame.contentWindow) {
        try { frame.contentWindow.location.reload(); } catch (e) { /* cross-origin: it picks the keys up on its next load */ }
      }
    });
  }

  function signOut() {
    set(SESSION_KEY, null);
    render();
    note('Signed out. This screen keeps its settings.', 'muted');
  }

  function start() {
    var btn = document.getElementById('sync-signin-btn');
    if (btn) btn.addEventListener('click', signIn);
    var input = document.getElementById('sync-passphrase');
    if (input) input.addEventListener('keydown', function (e) { if (e.key === 'Enter') signIn(); });
    var out = document.getElementById('sync-signout-btn');
    if (out) out.addEventListener('click', signOut);
    // Any change in the Settings card, or a CC press, may have changed a room
    // setting; push() sends only when the room's values actually differ.
    var card = document.getElementById('settings-card');
    if (card) {
      card.addEventListener('change', schedulePush);
      card.addEventListener('input', schedulePush);
      card.addEventListener('click', schedulePush);
    }
    document.addEventListener('click', function (e) {
      if (e.target && e.target.closest && e.target.closest('#cc-btn, .cc-btn, [data-captions-toggle]')) schedulePush();
    });

    fetch(SYNC_INDEX, { cache: 'no-store' }).then(function (r) { return r.ok ? r.json() : null; }, function () { return null; })
      .then(function (d) {
        var url = d && typeof d.url === 'string' ? d.url.trim().replace(/\/+$/, '') : '';
        if (!/^https:\/\/[^\s?#]+$/.test(url)) return;
        base = url;
        lastPushed = JSON.stringify(readRoom());
        render();
        pull();
        setInterval(pull, POLL_MS);
        window.addEventListener('online', pull);
      });
  }

  // Test seam: the jsdom harness drives the same functions the page uses.
  window.journeySync = { readRoom: readRoom, applyRoom: applyRoom, pull: pull, push: push, signIn: signIn, signOut: signOut };

  start();
})();
