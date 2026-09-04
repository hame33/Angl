/*
 * The timestamp parser is the delicate part of this app and it is heavily
 * commented for a reason. These tests exist to stop the duration work from
 * quietly regressing it — the cases about what is NOT a range matter as much
 * as the ones about what is.
 *
 *   node --test tests/
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadApp, withPlaylists, seed } from './load-app.mjs';

/* Each test gets its own app: the model is global state, and one test's
 * history must never leak into another's resolution. */
function freshApp() {
  const app = loadApp();
  app.settings = Object.assign({}, app.settings, { smartDurations: true });
  app.durationModel = app.emptyDurationModel();
  return app;
}

/* ── Explicit lengths ─────────────────────────────────────────────────────── */

test('a stated range sets the length and keeps the label', () => {
  const app = freshApp();
  const c = app.parseDictation('at 15:34 to 15:52 transition three');
  assert.equal(c.start, 15 * 60 + 34);
  assert.equal(c.end, 15 * 60 + 52);
  assert.equal(c.durationSecs, 18);
  assert.equal(c.durationSource, 'explicit');
  assert.equal(c.label, 'Transition three');
});

test('through, until, til and dash all open a range', () => {
  const app = freshApp();
  for (const word of ['to', 'until', 'til', 'till', 'through', 'thru', 'dash', 'minus']) {
    const c = app.parseDictation('at 15:34 ' + word + ' 15:52 press break');
    assert.equal(c.durationSecs, 18, word + ' should give an 18s clip');
    assert.equal(c.durationSource, 'explicit', word + ' should read as explicit');
    assert.equal(c.label, 'Press break', word + ' should leave the label alone');
  }
});

test('both sides of a range go through the same timestamp parser', () => {
  const app = freshApp();
  const c = app.parseDictation('an hour 26 to an hour 26 30 baseline out');
  assert.equal(c.start, 3600 + 26 * 60);
  assert.equal(c.end, 3600 + 26 * 60 + 30);
  assert.equal(c.durationSecs, 30);
  assert.equal(c.durationSource, 'explicit');
  assert.equal(c.label, 'Baseline out');
});

test('"for 20 seconds" still works', () => {
  const app = freshApp();
  const c = app.parseDictation('at 12:10 for 20 seconds pick and roll');
  assert.equal(c.start, 12 * 60 + 10);
  assert.equal(c.durationSecs, 20);
  assert.equal(c.durationSource, 'explicit');
  assert.equal(c.label, 'Pick and roll');
});

test('a bare number after "for" is seconds', () => {
  const app = freshApp();
  const c = app.parseDictation('at 15:34 for 8 kick out');
  assert.equal(c.durationSecs, 8);
  assert.equal(c.durationSource, 'explicit');
  assert.equal(c.label, 'Kick out');
});

/* ── What must NOT become a range ─────────────────────────────────────────── */

test('a "to" inside a label is still label', () => {
  const app = freshApp();
  const batch = app.parseDictationBatch('at 15:34 Smith to Jones give and go');
  assert.equal(batch.clips.length, 1, 'one dictation is always one clip');
  const c = batch.clips[0];
  assert.equal(c.start, 15 * 60 + 34);
  assert.equal(c.label, 'Smith to Jones give and go');
  assert.notEqual(c.durationSource, 'explicit');
});

test('a second timestamp with no range word stays in the label', () => {
  const app = freshApp();
  const c = app.parseDictation('at 15:34 zone look 16:02 again');
  assert.equal(c.start, 15 * 60 + 34);
  assert.notEqual(c.durationSource, 'explicit');
  assert.match(c.label, /16:02/);
});

test('an end that is not after the start is refused, with a warning', () => {
  const app = freshApp();
  const c = app.parseDictation('at 15:34 to 15:20 turnover');
  assert.notEqual(c.durationSource, 'explicit');
  assert.match(c.warning, /not after the start/);
  assert.equal(c.label, 'Turnover');
});

test('an absurdly long range is refused, with a warning', () => {
  const app = freshApp();
  const c = app.parseDictation('at 5:00 to 25:00 whole quarter');
  assert.notEqual(c.durationSource, 'explicit');
  assert.match(c.warning, /minutes/);
});

/* ── The rest of the timestamp parser, unchanged ──────────────────────────── */

test('spoken hours still parse, and resolve without a stated length', () => {
  const app = freshApp();
  const c = app.parseDictation('an hour and 26 full court press');
  assert.equal(c.start, 3600 + 26 * 60);
  assert.equal(c.label, 'Full court press');
  // Nothing learned yet, so this is the built-in fallback
  assert.equal(c.durationSource, 'default');
  assert.equal(c.durationSecs, app.DEFAULT_DURATION.secs);
});

test('spoken units still beat the bare-number reading', () => {
  const app = freshApp();
  assert.equal(app.parseDictation('12 seconds steal').start, 12);
  assert.equal(app.parseDictation('12 minutes steal').start, 12 * 60);
  assert.equal(app.parseDictation('at 1 minute 30 steal').start, 90);
  assert.equal(app.parseDictation('at 1:00:41 steal').start, 3641);
});

/* ── The ladder ───────────────────────────────────────────────────────────── */

test('a keyword beats anything learned', () => {
  const app = freshApp();
  const pls = withPlaylists(app, ['Transition']);
  seed(app, pls[0].id, 'transition break', 12, 30);
  const c = app.parseDictation('at 15:34 transition long pull up');
  assert.equal(c.durationSource, 'keyword');
  assert.equal(c.durationSecs, 15);
});

test('an explicit range beats a keyword', () => {
  const app = freshApp();
  const c = app.parseDictation('at 15:34 to 15:52 long pull up');
  assert.equal(c.durationSource, 'explicit');
  assert.equal(c.durationSecs, 18);
});

test('a cold model resolves to the default, not NaN or 0', () => {
  const app = freshApp();
  withPlaylists(app, ['Offence']);
  const res = app.resolveDuration({ label: 'baseline out of bounds', playlistName: 'Offence' });
  assert.equal(res.source, 'default');
  assert.equal(res.secs, app.DEFAULT_DURATION.secs);
  assert.ok(Number.isFinite(res.secs) && res.secs > 0);
  assert.equal(app.durationNote(res), '5s, default');
});

test('a category with 30 clips at 12s resolves near 12s for a new clip', () => {
  const app = freshApp();
  const pls = withPlaylists(app, ['Transition']);
  seed(app, pls[0].id, 'transition break', 12, 30);
  const res = app.resolveDuration({ label: 'early offence', playlistName: 'Transition' });
  assert.ok(Math.abs(res.secs - 12) <= 1, 'expected ~12s, got ' + res.secs);
  assert.ok(res.source === 'learned' || res.source === 'category', 'got ' + res.source);
  assert.ok(res.confidence > 0.5);
});

test('a category short of the threshold falls through', () => {
  const app = freshApp();
  const pls = withPlaylists(app, ['Transition']);
  seed(app, pls[0].id, 'transition break', 12, 4);   // one under DUR_CATEGORY_N
  const res = app.resolveDuration({ label: 'early offence', playlistName: 'Transition' });
  assert.equal(res.source, 'default');
});

test('with no category history, the overall median answers', () => {
  const app = freshApp();
  const pls = withPlaylists(app, ['Offence', 'Brand new']);
  seed(app, pls[0].id, 'set play', 20, 14);
  const res = app.resolveDuration({ label: 'something else', playlistName: 'Brand new' });
  assert.equal(res.source, 'global');
  assert.equal(res.secs, 20);
});

test('the words spoken pull the estimate off the category median', () => {
  const app = freshApp();
  const pls = withPlaylists(app, ['Offence']);
  seed(app, pls[0].id, 'quick swing', 8, 20);
  seed(app, pls[0].id, 'full court press', 24, 10);
  const plain = app.resolveDuration({ label: 'swing swing', playlistName: 'Offence' });
  const pressed = app.resolveDuration({ label: 'full court press', playlistName: 'Offence' });
  assert.equal(pressed.source, 'learned');
  assert.ok(pressed.secs > plain.secs,
    'a word seen on long clips should pull the guess up: ' + plain.secs + ' vs ' + pressed.secs);
});

test('no single word may drag the estimate more than 60% off the category', () => {
  const app = freshApp();
  const pls = withPlaylists(app, ['Offence']);
  seed(app, pls[0].id, 'quick swing', 10, 40);
  seed(app, pls[0].id, 'marathon possession sequence', 80, 8);
  const res = app.resolveDuration({ label: 'marathon sequence', playlistName: 'Offence' });
  assert.ok(res.secs <= 10 * 1.6 + 0.5, 'capped nudge expected, got ' + res.secs);
});

test('one wild mis-clip does not move a settled median', () => {
  const app = freshApp();
  const pls = withPlaylists(app, ['Transition']);
  seed(app, pls[0].id, 'break', 12, 30);
  seed(app, pls[0].id, 'break', 300, 1);
  const res = app.resolveDuration({ label: 'break', playlistName: 'Transition' });
  assert.ok(Math.abs(res.secs - 12) <= 1, 'median should shrug it off, got ' + res.secs);
});

test('switching smart durations off restores the flat default', () => {
  const app = freshApp();
  const pls = withPlaylists(app, ['Transition']);
  seed(app, pls[0].id, 'transition break', 12, 30);
  app.settings = Object.assign({}, app.settings, { smartDurations: false });
  const res = app.resolveDuration({ label: 'early offence', playlistName: 'Transition' });
  assert.equal(res.source, 'default');
  assert.equal(res.secs, 5);
  // Keywords and stated lengths are untouched by the toggle
  assert.equal(app.parseDictation('at 15:34 long pull up').durationSecs, 15);
  assert.equal(app.parseDictation('at 15:34 to 15:52 pull up').durationSecs, 18);
});

/* ── The model itself ─────────────────────────────────────────────────────── */

test('buffers are not learned back, so guesses do not creep', () => {
  const app = freshApp();
  const pls = withPlaylists(app, ['Offence']);
  for (let i = 0; i < 10; i++) {
    app.recordDurationSample({
      id: 'c' + i, label: 'set play', playlistId: pls[0].id,
      // a 10s clip played with 2s of padding either side
      effStart: 0, effEnd: 14, bufBefore: 2, bufAfter: 2,
    });
  }
  assert.equal(app.resolveDuration({ label: 'set play', playlistName: 'Offence' }).secs, 10);
});

test('a correction counts double', () => {
  const app = freshApp();
  const pls = withPlaylists(app, ['Offence']);
  const clip = { id: 'c1', label: 'iso', playlistId: pls[0].id, effStart: 0, effEnd: 9, bufBefore: 0, bufAfter: 0 };
  app.recordDurationSample(clip, { strong: true });
  assert.equal(app.durationModel.categories.offence.n, 2);
  assert.equal(app.durationModel.global.n, 2);
});

test('the sample cap drops the oldest, so the model tracks this season', () => {
  const app = freshApp();
  const pls = withPlaylists(app, ['Offence']);
  seed(app, pls[0].id, 'set play', 5, app.DUR_SAMPLE_CAP + 40);
  const bucket = app.durationModel.categories.offence;
  assert.equal(bucket.durations.length, app.DUR_SAMPLE_CAP);
  assert.equal(bucket.n, app.DUR_SAMPLE_CAP + 40, 'n is the lifetime count');
});

test('a corrupt model costs the history and nothing else', () => {
  const app = freshApp();
  const m = app.normaliseDurationModel({ global: 'nonsense', categories: 7, tokens: null });
  assert.equal(m.global.n, 0);
  assert.deepEqual(Object.keys(m.categories), []);
  app.durationModel = m;
  assert.equal(app.resolveDuration({ label: 'anything', playlistName: 'Offence' }).source, 'default');
});

test('crude stemming lands the same word in one bucket', () => {
  const app = freshApp();
  // Spread: arrays come back from the sandbox's own realm, so deepEqual on
  // them would compare prototypes rather than contents
  const tokens = (s) => [...app.durTokens(s)];
  assert.deepEqual(tokens('pressing the press presses'), ['press']);
  // a double s is a word, not a plural
  assert.equal(app.durStem('press'), 'press');
  assert.equal(app.durStem('possession'), 'possession');
  // stopwords and bare numbers carry no length information
  assert.deepEqual(tokens('and the 3 to a'), []);
});

test('the note says where the length came from', () => {
  const app = freshApp();
  const pls = withPlaylists(app, ['Transition']);
  seed(app, pls[0].id, 'transition break', 12, 23);
  const c = app.parseDictation('at 15:34 break out');
  assert.match(c.durationNote, /^\d+s, /);
  assert.equal(app.durationNote({ secs: 20, source: 'explicit' }), '20s, as you called it');
  assert.equal(app.durationNote({ secs: 15, source: 'keyword', name: 'long' }), '15s, you said “long”');
  assert.equal(app.durationNote({ secs: 12, source: 'learned', n: 23, category: 'transition' }),
    '12s, learned from 23 clips in transition');
});
