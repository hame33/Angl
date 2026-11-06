import test from 'node:test';
import assert from 'node:assert/strict';
import { clock, excerpt, linkify, paragraphs, slugify } from './text.ts';

test('slugs are lower-case, hyphenated and readable', () => {
  assert.equal(slugify('Closeout to the nail!'), 'closeout-to-the-nail');
  assert.equal(slugify('Pick & Roll — Défense'), 'pick-and-roll-defense');
  assert.equal(slugify('   '), '');
});

test('long slugs are cut without a trailing hyphen', () => {
  const s = slugify('a '.repeat(80));
  assert.ok(s.length <= 60);
  assert.ok(!s.endsWith('-'));
});

test('an excerpt keeps short text whole and cuts long text on a word', () => {
  assert.equal(excerpt('Short note.'), 'Short note.');
  const long = 'word '.repeat(60);
  const e = excerpt(long);
  assert.ok(e.length <= 155);
  assert.ok(e.endsWith('word…'));
});

test('an excerpt flattens line breaks', () => {
  assert.equal(excerpt('one\n\ntwo'), 'one two');
});

test('links are split out and trailing punctuation stays outside them', () => {
  assert.deepEqual(linkify('see https://example.com/a. Then go.'), [
    { kind: 'text', text: 'see ' },
    { kind: 'link', text: 'https://example.com/a', href: 'https://example.com/a' },
    { kind: 'text', text: '. Then go.' },
  ]);
});

test('only http(s) becomes a link, so nothing scriptable does', () => {
  assert.deepEqual(linkify('javascript:alert(1)'), [{ kind: 'text', text: 'javascript:alert(1)' }]);
});

test('text with no links is one segment', () => {
  assert.deepEqual(linkify('Sprint to the nail'), [{ kind: 'text', text: 'Sprint to the nail' }]);
});

test('paragraphs split on blank lines and drop empties', () => {
  assert.deepEqual(paragraphs('one\ntwo\n\n\nthree\n'), ['one\ntwo', 'three']);
});

test('times read the way classic Angl shows them', () => {
  assert.equal(clock(75), '1:15');
  assert.equal(clock(3641), '1:00:41');
  assert.equal(clock(9.9), '0:09');
});
