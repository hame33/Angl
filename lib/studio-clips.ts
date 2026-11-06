/*
 * Reading your own clips for the studio. RLS returns only rows you own (plus
 * public ones, which are yours too in the single-publisher phase); the query
 * filters by owner anyway so a future multi-tenant Angl lists only your own.
 */
import { createClient } from '@/lib/supabase/server';

export interface StudioClip {
  id: string;
  share_id: string;
  title: string;
  visibility: 'private' | 'unlisted' | 'public';
  youtube_video_id: string | null;
  start_seconds: number;
  end_seconds: number;
  category: string | null;
  legacy: { index?: number; gameId?: string | null; gameTitle?: string | null; teamName?: string | null; categoryEmoji?: string | null } | null;
  updated_at: string;
}

const COLUMNS = 'id, share_id, title, visibility, youtube_video_id, start_seconds, end_seconds, category, legacy, updated_at';
const PAGE = 1000;   // PostgREST's default row cap per request

export async function listMyClips(ownerId: string): Promise<StudioClip[]> {
  const supabase = await createClient();
  const all: StudioClip[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from('clips').select(COLUMNS).eq('owner_id', ownerId)
      .order('created_at', { ascending: true }).order('id')
      .range(from, from + PAGE - 1);
    if (error) throw new Error('Could not load your clips: ' + error.message);
    all.push(...(data as StudioClip[]));
    if (!data || data.length < PAGE) break;
  }
  // Imported clips keep classic Angl's order, which their timestamps can't show
  return all.sort((a, b) => (a.legacy?.index ?? 1e9) - (b.legacy?.index ?? 1e9));
}

export interface StudioGroup {
  key: string;
  team: string;
  film: string;
  categories: { name: string; emoji: string | null; clips: StudioClip[] }[];
  count: number;
}

/* team → film → category, the way classic Angl's dashboard shows them. */
export function groupStudioClips(clips: StudioClip[]): StudioGroup[] {
  const groups: StudioGroup[] = [];
  for (const c of clips) {
    const team = c.legacy?.teamName ?? 'Added in the studio';
    const film = c.legacy?.gameTitle ?? 'No film';
    const key = `${team}\u0000${c.legacy?.gameId ?? film}`;
    let g = groups.find(x => x.key === key);
    if (!g) groups.push(g = { key, team, film, categories: [], count: 0 });
    const name = c.category ?? 'No category';
    let cat = g.categories.find(x => x.name === name);
    if (!cat) g.categories.push(cat = { name, emoji: c.legacy?.categoryEmoji ?? null, clips: [] });
    cat.clips.push(c);
    g.count++;
  }
  return groups;
}
