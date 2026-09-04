/*
 * The misses view is the first thing that reads the dictation log. It is
 * read-only on purpose: it exists so a coach can eyeball what the parser keeps
 * getting wrong, and nothing about it feeds back into the parser or the
 * duration model. These tests are mostly about what it must NOT do.
 *
 *   node --test tests/
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadApp } from './load-app.mjs';

const plain = v => JSON.parse(JSON.stringify(v));

/* A log entry, at a controllable time so ordering is assertable. */
function entry(outcome, at, extra) {
  return Object.assign({
    v: 1, at, outcome, parser: 'builtin',
    heard: outcome + ' at ' + at,
    parsed: { start: 934, end: 949, label: 'Long two', playlist: 'Offence' },
    kept: outcome === 'corrected'
      ? { start: 936, end: 952, label: 'Long two', playlist: 'Defence' }
      : null,
  }, extra || {});
}

function withLog(entries) {
  const app = loadApp();
  app.dictationLog = entries;
  return app;
}

/* ── What counts as a miss ────────────────────────────────────────────────── */

test('a confirmed session is the parser working, so it is not a miss', () => {
  const app = withLog([
    entry('confirmed', 1),
    entry('corrected', 2),
    entry('discarded', 3),
    entry('missed',    4),
  ]);
  const outcomes = plain(app.dictationMisses()).map(e => e.outcome);
  assert.deepEqual(outcomes.sort(), ['corrected', 'discarded', 'missed']);
  assert.ok(!outcomes.includes('confirmed'), 'a clean parse is not something to review');
});

test('misses come back newest first', () => {
  const app = withLog([
    entry('missed', 1000),
    entry('corrected', 2000),
    entry('discarded', 3000),
  ]);
  assert.deepEqual(plain(app.dictationMisses()).map(e => e.at), [3000, 2000, 1000]);
});

test('rows are ordered by the clock, not by where they sit in the log', () => {
  // The log is append-ordered in practice; this is the belt to that braces.
  const app = withLog([
    entry('missed',    3000),
    entry('corrected', 1000),
    entry('discarded', 2000),
  ]);
  assert.deepEqual(plain(app.dictationMisses()).map(e => e.at), [3000, 2000, 1000]);
});

test('the view is capped, and says nothing about the rest', () => {
  const many = [];
  for (let i = 0; i < 100; i++) many.push(entry('corrected', i + 1));
  const app = withLog(many);

  const shown = plain(app.dictationMisses());
  assert.equal(shown.length, app.DICT_MISS_VIEW_CAP, 'a season of misses is not a settings panel');
  assert.equal(shown[0].at, 100, 'and the cap keeps the newest, not the oldest');

  assert.equal(plain(app.dictationMisses(Infinity)).length, 100,
    'the count of everything is still available for the toggle label');
});

test('an empty log has no misses and does not throw', () => {
  assert.deepEqual(plain(withLog([]).dictationMisses()), []);
});

test('a log with junk in it does not break the view', () => {
  const app = withLog([null, undefined, {}, { outcome: 'nonsense' }, entry('missed', 5)]);
  const out = plain(app.dictationMisses());
  assert.equal(out.length, 1, 'only the real miss is shown');
  assert.equal(out[0].outcome, 'missed');
});

/* ── Reading the log changes nothing ──────────────────────────────────────── */

test('reading the misses does not touch the log or write storage', () => {
  const entries = [entry('corrected', 1), entry('confirmed', 2), entry('missed', 3)];
  const app = withLog(entries.map(e => Object.assign({}, e)));
  const before = plain(app.dictationLog);
  const keysBefore = app.__storageKeys();

  app.dictationMisses();
  app.dictationMisses(Infinity);

  assert.deepEqual(plain(app.dictationLog), before, 'the log is read, never rewritten');
  assert.deepEqual(app.__storageKeys(), keysBefore, 'and nothing new was stored');
});

test('the view adds no storage key of its own', () => {
  const app = withLog([entry('missed', 1)]);
  app.dictationMisses();
  app.saveDictationLog();
  for (const k of app.__storageKeys()) {
    assert.ok(k.startsWith('filmroom_'), k + ' must keep the filmroom_ prefix');
  }
  assert.ok(!app.__storageKeys().some(k => /miss/i.test(k)),
    'the misses view is a read of the log, not a store of its own');
});

test('the duration model is untouched by looking at misses', () => {
  const app = withLog([entry('corrected', 1)]);
  app.durationModel = app.emptyDurationModel();
  const before = plain(app.durationModel);
  app.dictationMisses();
  assert.deepEqual(plain(app.durationModel), before,
    'there is no learning loop here, and there must not quietly become one');
});

/* ── The lines a row is built from ────────────────────────────────────────── */

test('a parse reads as a time, a label and a playlist', () => {
  const app = loadApp();
  const line = app.missLine({ start: 934, end: 949, label: 'Long two', playlist: 'Offence' }, null);
  assert.match(line, /15:34/);
  assert.match(line, /15:49/);
  assert.match(line, /Long two/);
  assert.match(line, /Offence/);
});

test('only the fields that actually differ are marked', () => {
  const app = loadApp();
  const parsed = { start: 934, end: 949, label: 'Long two', playlist: 'Offence' };
  const kept   = { start: 934, end: 949, label: 'Long two', playlist: 'Defence' };
  const line = app.missLine(kept, parsed);
  const marked = line.split('miss-diff').length - 1;
  assert.equal(marked, 1, 'the playlist changed and nothing else did');
  assert.match(line, /miss-diff[^>]*>Defence/, 'and it is the playlist that is marked');
});

test('a clip that was only stretched still marks its times', () => {
  const app = loadApp();
  const parsed = { start: 934, end: 939, label: 'Long two', playlist: 'Offence' };
  const kept   = { start: 934, end: 952, label: 'Long two', playlist: 'Offence' };
  const line = app.missLine(kept, parsed);
  assert.match(line, /miss-diff[^>]*>15:34/,
    'the start did not move but the end did, and the span is what the eye reads');
  assert.equal(line.split('miss-diff').length - 1, 1, 'and nothing else is marked');
});

test('nothing parsed reads as nothing, not as 0:00', () => {
  const app = loadApp();
  const line = app.missLine(null, null);
  assert.match(line, /nothing/);
  assert.ok(!line.includes('0:00'), 'a failed parse has no timestamp to show');
});

test('a label from a transcript cannot inject markup', () => {
  const app = loadApp();
  const line = app.missLine(
    { start: 0, end: 5, label: '<img src=x onerror=alert(1)>', playlist: null }, null);
  assert.ok(!line.includes('<img'), 'the transcript is text, and is escaped as text');
  assert.match(line, /&lt;img/);
});
