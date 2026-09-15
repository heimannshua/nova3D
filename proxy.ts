import {NextResponse, type NextRequest} from 'next/server';
import {allowedEmail, hasSupabaseConfig} from '@/lib/auth-config';
import {createSupabaseProxyClient} from '@/lib/supabase/proxy';

const publicPaths = ['/login', '/auth/callback', '/api/health'];
const legacyInterimSessionCookie = 'nova3d-interim-session';

function nextResponse(request: NextRequest) {
  const response = NextResponse.next();
  if (request.cookies.has(legacyInterimSessionCookie)) {
    response.cookies.set(legacyInterimSessionCookie, '', {httpOnly: true, maxAge: 0, path: '/'});
  }
  return response;
}

export async function proxy(request: NextRequest) {
  const pathname = request.nextUrl.pathname;
  if (publicPaths.includes(pathname)) return nextResponse(request);
  if (hasSupabaseConfig()) {
    const client = createSupabaseProxyClient(request);
    if (client) {
      const {data: {user}} = await client.supabase.auth.getUser();
      if (user && allowedEmail(user.email)) {
        if (request.cookies.has(legacyInterimSessionCookie)) {
          client.response.cookies.set(legacyInterimSessionCookie, '', {httpOnly: true, maxAge: 0, path: '/'});
        }
        return client.response;
      }
    }
  }

  const login = new URL('/login', request.url);
  const error = hasSupabaseConfig() ? 'not_signed_in' : 'auth_not_configured';
  login.searchParams.set('error', error);
  return NextResponse.redirect(login);
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml).*)'],
};
