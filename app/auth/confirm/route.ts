/*
 * Where the magic link lands. Supabase verifies the emailed link, then sends
 * the browser here with a one-time code (PKCE), which is exchanged for a
 * session cookie. Anything else goes back to the sign-in page with a reason.
 */
import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';

// Only ever redirect within the studio, never to a URL taken from the link
function safeNext(next: string | null): string {
  return next && /^\/studio(\/|$)/.test(next) && !next.startsWith('//') ? next : '/studio';
}

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const next = safeNext(url.searchParams.get('next'));

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(new URL(next, url.origin));
  }
  // Supabase passes its own error back as ?error_description= when the link is stale
  const reason = url.searchParams.get('error_description') ? 'expired' : 'invalid';
  return NextResponse.redirect(new URL(`/studio/login?error=${reason}`, url.origin));
}
