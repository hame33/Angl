import test from 'node:test';
import assert from 'node:assert/strict';
import { clipUpdateSchema, firstIssue, importBatchSchema, parseClock, parseLines, parseTags } from './clip-form.ts';

const form = (over: Record<string, string> = {}) => ({
  id: '0b9c6f3e-1d2a-4b5c-8d7e-9f0a1b2c3d4e',
  title: '2 on 1 using the backboard',
  notes: 'Think lay-up.\r\n\r\nOff the glass.',
  coachingPoints: '- Think lay-up\n\n• Off the glass\n',
  tags: 'Transition, finishing, transition',
  videoId: 'bJJy8l6tVAI',
  start: '1:49',
  end: '2:23',
  coachName: 'John Calipari',
  coachUrl: '',
  sourceTitle: 'Arkansas basketball summer practice footage',
  channelName: 'HawgBeat.com',
  channelUrl: 'https://www.youtube.com/@HawgBeat',
  visibility: 'public',
  ...over,
});

test('times read as m:ss, h:mm:ss or plain seconds', () => {
  assert.equal(parseClock('1:49'), 109);
  assert.equal(parseClock('1:02:03'), 3723);
  assert.equal(parseClock('109'), 109);
  assert.equal(parseClock('1:49.5'), 109.5);
  assert.equal(parseClock(' 0:05 '), 5);
});

test('nonsense times are refused, not guessed', () => {
  assert.equal(parseClock(''), null);
  assert.equal(parseClock('1:75'), null);
  assert.equal(parseClock('1:60:00'), null);
  assert.equal(parseClock('soon'), null);
});

test('tags are lower-cased and de-duplicated', () => {
  assert.deepEqual(parseTags('Defence, closeouts ,DEFENCE,, '), ['defence', 'closeouts']);
});

test('coaching points are one per line, bullets dropped', () => {
  assert.deepEqual(parseLines('- One\n\n• Two\n * Three '), ['One', 'Two', 'Three']);
});

test('a full form parses into what the database stores', () => {
  const r = clipUpdateSchema.safeParse(form());
  assert.ok(r.success, r.success ? '' : firstIssue(r.error));
  assert.equal(r.data.start, 109);
  assert.equal(r.data.end, 143);
  assert.equal(r.data.notes, 'Think lay-up.\n\nOff the glass.');
  assert.deepEqual(r.data.coachingPoints, ['Think lay-up', 'Off the glass']);
  assert.deepEqual(r.data.tags, ['transition', 'finishing']);
  assert.equal(r.data.coachUrl, null);
});

test('an end before the start is refused with a plain reason', () => {
  const r = clipUpdateSchema.safeParse(form({ end: '1:00' }));
  assert.equal(r.success, false);
  assert.equal(r.success ? '' : firstIssue(r.error), 'The end must be after the start');
});

test('a clip with no video can be saved privately but never shared', () => {
  assert.equal(clipUpdateSchema.safeParse(form({ videoId: '', visibility: 'private' })).success, true);
  const r = clipUpdateSchema.safeParse(form({ videoId: '', visibility: 'unlisted' }));
  assert.equal(r.success ? '' : firstIssue(r.error), 'A clip needs a YouTube video before it can be shared');
});

test('links must be https, so nothing scriptable is stored', () => {
  const r = clipUpdateSchema.safeParse(form({ coachUrl: 'javascript:alert(1)' }));
  assert.equal(r.success ? '' : firstIssue(r.error), 'Coach url must start with https://');
});

test('an unknown visibility is refused', () => {
  assert.equal(clipUpdateSchema.safeParse(form({ visibility: 'everyone' })).success, false);
});

test('an import batch re-checks what the browser sent', () => {
  const clip = {
    legacyId: 'c1', title: 'A', videoId: 'bad id!', startSeconds: 1, endSeconds: 2,
    markedStartSeconds: null, markedEndSeconds: null, category: 'Defence',
    legacy: { id: 'c1', index: 0, gameId: 'g1', playlistId: 'p1', gameTitle: 'R7', teamName: 'U16', sport: 'basketball', categoryEmoji: '🛡️' },
  };
  const ok = importBatchSchema.safeParse([clip]);
  assert.ok(ok.success);
  assert.equal(ok.data[0]?.videoId, null, 'a bad video id is dropped, not stored');
  assert.equal(importBatchSchema.safeParse([{ ...clip, endSeconds: 0.5 }]).success, false);
  assert.equal(importBatchSchema.safeParse([]).success, false);
});
