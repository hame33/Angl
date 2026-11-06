/*
 * Keeps a studio session fresh: Supabase's access token expires hourly, and
 * only the proxy (Next 16's name for middleware) can rewrite the cookie on the
 * way in for a page render.
 *
 * Scoped to /studio and /auth on purpose. Share pages and the rest of the
 * public site never touch auth, so they stay cacheable and never set a cookie.
 */
import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) return response;

  const supabase = createServerClient(url, key, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll(toSet, headers) {
        for (const { name, value } of toSet) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of toSet) response.cookies.set(name, value, options);
        // A response that sets a session cookie must never be cached and replayed to someone else
        for (const [k, v] of Object.entries(headers)) response.headers.set(k, v);
      },
    },
  });
  // Refreshes the token if it has expired; nothing must run between this and the return
  await supabase.auth.getUser();
  return response;
}

export const config = { matcher: ['/studio/:path*', '/auth/:path*'] };
