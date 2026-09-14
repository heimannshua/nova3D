import {NextResponse} from 'next/server';
import {allowedEmail} from '@/lib/auth-config';
import {createSupabaseServerClient} from '@/lib/supabase/server';

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const supabase = await createSupabaseServerClient();
  if (!code || !supabase) return NextResponse.redirect(new URL('/login?error=auth_unavailable', url));

  const {data, error} = await supabase.auth.exchangeCodeForSession(code);
  if (error || !data.user || !allowedEmail(data.user.email)) {
    if (data.user) await supabase.auth.signOut();
    const reason = error ? 'auth_failed' : 'not_allowed';
    return NextResponse.redirect(new URL(`/login?error=${reason}`, url));
  }

  return NextResponse.redirect(new URL('/', url));
}
