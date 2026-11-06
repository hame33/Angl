/*
 * Supabase for the signed-in studio: server components, server actions and
 * route handlers. A new client per request, as @supabase/ssr requires — the
 * session lives in cookies, and RLS sees the signed-in user through them.
 *
 * Public share pages never use this. They read through lib/shared-clip.ts,
 * which carries no cookies, so a visitor's request can be cached and served
 * to everyone.
 */
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { site } from '@/lib/site';

export async function createClient() {
  const store = await cookies();
  return createServerClient(site.supabase.url, site.supabase.publishableKey, {
    cookies: {
      getAll: () => store.getAll(),
      setAll(toSet) {
        try {
          for (const { name, value, options } of toSet) store.set(name, value, options);
        } catch {
          // Called from a server component, where cookies are read-only. The
          // proxy refreshes the session on the way in, so this is safe to skip.
        }
      },
    },
  });
}

export interface Publisher { id: string; email: string | null }

/*
 * The signed-in user, if they may publish. getUser() asks Supabase Auth
 * rather than trusting the cookie, so a forged cookie gets nowhere; RLS would
 * refuse its writes anyway, this just lets the page say so.
 */
export async function currentPublisher(): Promise<{ user: Publisher | null; isPublisher: boolean }> {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) return { user: null, isPublisher: false };
  const { data: ok } = await supabase.rpc('is_publisher');
  return { user: { id: data.user.id, email: data.user.email ?? null }, isPublisher: ok === true };
}
