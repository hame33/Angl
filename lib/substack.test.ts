import test from 'node:test';
import assert from 'node:assert/strict';
import { decodeEntities, parseFeed } from './substack.ts';

/* Shaped like Beyond The Arc's real feed (Substack RSS 2.0), trimmed. */
const FEED = `<?xml version="1.0" encoding="UTF-8"?><rss xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:content="http://purl.org/rss/1.0/modules/content/" version="2.0"><channel><title><![CDATA[Beyond The Arc]]></title><link>https://hamishdawson33.substack.com</link>
<item><title><![CDATA[Quantifying Coaching: New Metrics]]></title><description><![CDATA[From ATO Effectiveness to Momentum Shifts&#8212;The Numbers]]></description><link>https://hamishdawson33.substack.com/p/quantifying-coaching</link><guid isPermaLink="false">https://hamishdawson33.substack.com/p/quantifying-coaching</guid><dc:creator><![CDATA[Beyond The Arc]]></dc:creator><pubDate>Sat, 24 Aug 2024 16:14:42 GMT</pubDate><enclosure url="https://substack-post-media.s3.amazonaws.com/public/images/3e02_1024x1024.webp" length="0" type="image/jpeg"/><content:encoded><![CDATA[<div><svg><title>Share</title></svg><p>Body with a <a href="https://x.example">link</a></p></div>]]></content:encoded></item>
<item><title><![CDATA[Backboard passing]]></title><description><![CDATA[Wembanyama, the mini-hoop effect, and the next frontier.]]></description><link>https://hamishdawson33.substack.com/p/backboard-passing</link><pubDate>Fri, 23 Oct 2026 05:21:29 GMT</pubDate><enclosure url="https://substack-post-media.s3.amazonaws.com/public/images/5dc0_1376x768.jpeg" length="0" type="image/jpeg"/><content:encoded><![CDATA[<p><title>Not the title</title></p>]]></content:encoded></item>
</channel></rss>`;

test('posts are read newest first, with every field', () => {
  const posts = parseFeed(FEED);
  assert.equal(posts.length, 2);
  assert.deepEqual(posts[0], {
    title: 'Backboard passing',
    subtitle: 'Wembanyama, the mini-hoop effect, and the next frontier.',
    url: 'https://hamishdawson33.substack.com/p/backboard-passing',
    publishedAt: '2026-10-23T05:21:29.000Z',
    image: 'https://substack-post-media.s3.amazonaws.com/public/images/5dc0_1376x768.jpeg',
  });
});

test('entities Substack leaves inside CDATA are decoded', () => {
  assert.equal(parseFeed(FEED)[1]?.subtitle, 'From ATO Effectiveness to Momentum Shifts—The Numbers');
});

test('a <title> inside a post body is never taken for the post title', () => {
  assert.deepEqual(parseFeed(FEED).map(p => p.title), ['Backboard passing', 'Quantifying Coaching: New Metrics']);
});

test('an item with no title or no https link is skipped', () => {
  const xml = `<rss><channel>
    <item><title>No link</title></item>
    <item><title>Http</title><link>http://insecure.example/p</link></item>
    <item><title>Script</title><link>javascript:alert(1)</link></item>
    <item><title>Fine</title><link>https://ok.example/p</link></item>
  </channel></rss>`;
  assert.deepEqual(parseFeed(xml).map(p => p.title), ['Fine']);
});

test('a non-image enclosure, or a bad date, is dropped rather than shown broken', () => {
  const xml = `<rss><channel><item><title>Pod</title><link>https://ok.example/p</link>
    <pubDate>not a date</pubDate><enclosure url="https://ok.example/a.mp3" type="audio/mpeg"/></item></channel></rss>`;
  const [p] = parseFeed(xml);
  assert.equal(p?.image, null);
  assert.equal(p?.publishedAt, null);
});

test('plain-text fields are decoded and any stray markup removed', () => {
  const xml = `<rss><channel><item><title>Pick &amp; roll <b>reads</b></title><link>https://ok.example/p</link></item></channel></rss>`;
  assert.equal(parseFeed(xml)[0]?.title, 'Pick & roll reads');
});

test('entity decoding covers numeric, hex and the usual named ones, and leaves unknown ones alone', () => {
  assert.equal(decodeEntities('&#8212; &#x2019; &amp; &rsquo; &nbsp;&bogus;'), '— ’ & ’  &bogus;');
});

test('a feed with no items is an empty list, not an error', () => {
  assert.deepEqual(parseFeed('<rss><channel></channel></rss>'), []);
});
