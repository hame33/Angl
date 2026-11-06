#!/usr/bin/env node
/*
 * Checks, over the real REST API with the publishable (anon) key, that a
 * signed-out visitor can read public clips and nothing else, and can write
 * nothing at all. Run it after any migration that touches policies:
 *
 *   NEXT_PUBLIC_SUPABASE_URL=… NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=… \
 *     npm run check:rls -- [publicShareId] [unlistedShareId] [privateShareId]
 *
 * The share ids are optional; with them it also checks each one resolves (or
 * doesn't) through get_shared_clip the way a share page would see it.
 * It never needs a secret key, and it changes nothing: every write it tries
 * is one that must be refused.
 */
const url = (process.env.NEXT_PUBLIC_SUPABASE_URL || '').replace(/\/+$/, '');
const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || '';
if (!url || !key) {
  console.error('Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY');
  process.exit(2);
}
const [pubId, unlistedId, privateId] = process.argv.slice(2);
const headers = { apikey: key, 'Content-Type': 'application/json', Prefer: 'return=representation' };
const rest = (path, init = {}) => fetch(`${url}/rest/v1/${path}`, { ...init, headers: { ...headers, ...init.headers } });

let failed = 0;
function check(name, ok, detail = '') {
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
  if (!ok) failed++;
}

// Reads: only public rows are listable
const list = await rest('clips?select=visibility');
const rows = list.ok ? await list.json() : [];
check('anon can list clips', list.ok, `HTTP ${list.status}`);
check('anon sees only public clips', rows.every(r => r.visibility === 'public'), `${rows.length} row(s)`);

// Writes: every one must be refused or touch nothing
const ins = await rest('clips', {
  method: 'POST',
  body: JSON.stringify({ title: 'rls probe', youtube_video_id: 'abcdefghijk', start_seconds: 1, end_seconds: 2 }),
});
check('anon insert is refused', ins.status === 401 || ins.status === 403, `HTTP ${ins.status}`);

const upd = await rest('clips?visibility=eq.public', { method: 'PATCH', body: JSON.stringify({ title: 'rls probe' }) });
const updRows = upd.ok ? await upd.json() : [];
check('anon update changes nothing', !upd.ok || updRows.length === 0, `HTTP ${upd.status}, ${updRows.length} row(s)`);

const del = await rest('clips?visibility=eq.public', { method: 'DELETE' });
const delRows = del.ok ? await del.json() : [];
check('anon delete removes nothing', !del.ok || delRows.length === 0, `HTTP ${del.status}, ${delRows.length} row(s)`);

const pubs = await rest('publishers?select=user_id');
const pubRows = pubs.ok ? await pubs.json() : [];
check('anon cannot see publishers', pubRows.length === 0, `HTTP ${pubs.status}`);

const isPub = await rest('rpc/is_publisher', { method: 'POST', body: '{}' });
check('anon cannot call is_publisher', !isPub.ok, `HTTP ${isPub.status}`);

// The share-page read path
async function shared(id) {
  const r = await rest(`rpc/get_shared_clip?p_share_id=${encodeURIComponent(id)}`);
  return r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`));
}
if (pubId) {
  const c = await shared(pubId);
  check('public clip resolves by share id', !!c && c.visibility === 'public');
  check('share payload has no owner or legacy ids', !!c && !('ownerId' in c) && !('legacy' in c));
}
if (unlistedId) {
  const c = await shared(unlistedId);
  check('unlisted clip resolves by share id', !!c && c.visibility === 'unlisted');
  const listed = await rest(`clips?select=id&share_id=eq.${encodeURIComponent(unlistedId)}`);
  check('unlisted clip is not listable', listed.ok && (await listed.json()).length === 0);
}
if (privateId) {
  check('private clip does not resolve', (await shared(privateId)) === null);
}
check('unknown share id does not resolve', (await shared('zzzzzzzzzzz')) === null);

console.log(failed ? `\n${failed} check(s) failed` : '\nAll checks passed');
process.exit(failed ? 1 : 0);
