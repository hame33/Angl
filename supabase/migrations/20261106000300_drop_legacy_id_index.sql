-- Imported clips are deduplicated by their id instead: a UUID v5 of the owner,
-- the classic clip id, the film and the times (lib/legacy/ids.ts), inserted
-- with ON CONFLICT (id) DO NOTHING.
--
-- This index enforced one classic id per owner. Classic ids are 7 random
-- characters, unique only within one browser, so a second machine's export
-- could reuse one for a different clip, and the conflict would fail the whole
-- import batch.
drop index if exists public.clips_owner_legacy;
