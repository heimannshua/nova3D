import {NextResponse, type NextRequest} from 'next/server';
import {allowedEmail, hasSupabaseConfig} from '@/lib/auth-config';
import {interimAuthEnabled, interimSessionCookie, verifyInterimSession} from '@/lib/interim-auth';
import {createSupabaseProxyClient} from '@/lib/supabase/proxy';

const publicPaths = ['/login', '/auth/callback', '/api/auth/interim', '/api/health'];

export async function proxy(request: NextRequest) {
  const pathname = request.nextUrl.pathname;
  if (publicPaths.some((path) => pathname === path || pathname.startsWith(`${path}/`))) return NextResponse.next();
  if (verifyInterimSession(request.cookies.get(interimSessionCookie)?.value)) return NextResponse.next();

  if (hasSupabaseConfig()) {
    const client = createSupabaseProxyClient(request);
    if (client) {
      const {data: {user}} = await client.supabase.auth.getUser();
      if (user && allowedEmail(user.email)) return client.response;
    }
  }

  const login = new URL('/login', request.url);
  const error = hasSupabaseConfig() ? 'not_signed_in' : interimAuthEnabled() ? 'interim_required' : 'auth_not_configured';
  login.searchParams.set('error', error);
  return NextResponse.redirect(login);
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml).*)'],
};
