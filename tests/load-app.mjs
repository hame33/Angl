/*
 * Runs Angl's script in a Node sandbox so the parser can be tested without a
 * browser. The app is one file on purpose, so rather than split it up for the
 * tests' benefit we lift the <script> out of index.html and give it just
 * enough of a DOM to reach its own function declarations.
 *
 * Only top-level code has to survive this: a few addEventListener calls, a
 * navigator sniff and a couple of localStorage reads. Everything the tests
 * actually exercise is called by hand afterwards.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const here = dirname(fileURLToPath(import.meta.url));

function fakeElement() {
  const el = {
    value: '', textContent: '', innerHTML: '', checked: false, disabled: false,
    style: {}, dataset: {}, title: '',
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    appendChild() {}, removeChild() {}, focus() {}, blur() {}, click() {},
    addEventListener() {}, removeEventListener() {},
    querySelector: () => null, querySelectorAll: () => [],
    getBoundingClientRect: () => ({ top: 0, left: 0, width: 0, height: 0 }),
    closest: () => null,
  };
  return el;
}

function fakeStorage() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { map.set(k, String(v)); },
    removeItem: (k) => { map.delete(k); },
    clear: () => map.clear(),
  };
}

/* Everything a test needs that `let`/`const` keeps off the sandbox global. */
const EPILOGUE = `
globalThis.__app = {
  parseDictation, parseDictationBatch, resolveDuration, durationNote,
  recordDurationSample, normaliseDurationModel, emptyDurationModel,
  median, durTokens, durStem, findEndTime, findTimestamp,
  get settings() { return settings; },
  set settings(v) { settings = v; },
  get durationModel() { return durationModel; },
  set durationModel(v) { durationModel = v; },
  get playlists() { return playlists; },
  set playlists(v) { playlists = v; },
  get games() { return games; },
  set games(v) { games = v; },
  get clips() { return clips; },
  set clips(v) { clips = v; },
  backfillDurationModel, resetDurationModel, loadFromStorage,
  set answerConfirm(v) { globalThis.answerConfirm = v; },
  DURATION_WORDS, DEFAULT_DURATION, DUR_SAMPLE_CAP,
};
`;

export function loadApp() {
  const html = readFileSync(join(here, '..', 'index.html'), 'utf8');
  const open = html.indexOf('<script>');
  const close = html.lastIndexOf('</script>');
  if (open < 0 || close < 0) throw new Error('no <script> block in index.html');
  const source = html.slice(open + '<script>'.length, close);

  const doc = {
    getElementById: () => fakeElement(),
    querySelector: () => null,
    querySelectorAll: () => [],
    createElement: () => fakeElement(),
    addEventListener() {}, removeEventListener() {},
    body: fakeElement(),
    activeElement: null,
  };
  const sandbox = {
    console, setTimeout, clearTimeout, setInterval, clearInterval,
    requestAnimationFrame: (fn) => setTimeout(fn, 0),
    document: doc,
    localStorage: fakeStorage(),
    navigator: { platform: 'Test', userAgent: 'node', language: 'en-US' },
    location: { href: 'http://localhost:8777/index.html', protocol: 'http:' },
    fetch: () => Promise.reject(new Error('no network in tests')),
    URL: { createObjectURL: () => 'blob:x', revokeObjectURL() {} },
    Blob: class {},
    FileReader: class {},
    AbortController: globalThis.AbortController,
    // Tests that drive a confirm-guarded action set sandbox.answerConfirm
    confirm: () => sandbox.answerConfirm === true,
    answerConfirm: false,
    alert() {},
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  sandbox.window.addEventListener = () => {};
  sandbox.window.removeEventListener = () => {};
  sandbox.isSecureContext = true;

  vm.createContext(sandbox);
  vm.runInContext(source + EPILOGUE, sandbox, { filename: 'index.html' });
  return sandbox.__app;
}

/* A game with playlists, so extractPlaylist and category lookups have
 * something real to work against. */
export function withPlaylists(app, names) {
  app.games = [{ id: 'g1', title: 'Test game', videoId: 'v1', teamId: 't1' }];
  app.playlists = names.map((name, i) => ({ id: 'pl' + i, gameId: 'g1', name, emoji: '🏀' }));
  return app.playlists;
}

/* Seed a category with `count` clips of `secs` each, as if they had been
 * saved one at a time. */
export function seed(app, playlistId, label, secs, count) {
  for (let i = 0; i < count; i++) {
    app.recordDurationSample({
      id: 'c' + i, label, playlistId,
      effStart: 0, effEnd: secs, bufBefore: 0, bufAfter: 0,
    });
  }
}
