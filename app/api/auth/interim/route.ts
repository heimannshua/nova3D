import {timingSafeEqual} from 'node:crypto';
import {NextResponse} from 'next/server';
import {createInterimSession, getInterimPassword, interimSessionCookie, sessionLifetimeSeconds} from '@/lib/interim-auth';

export async function POST(request: Request) {
  const configured = getInterimPassword();
  if (!configured) return NextResponse.json({ok: false, error: 'Interim access is not configured.'}, {status: 404});

  const body = await request.json().catch(() => null) as {password?: unknown} | null;
  const candidate = typeof body?.password === 'string' ? body.password : '';
  const candidateBuffer = Buffer.from(candidate);
  const configuredBuffer = Buffer.from(configured);
  const matches = candidateBuffer.length === configuredBuffer.length && timingSafeEqual(candidateBuffer, configuredBuffer);
  if (!matches) return NextResponse.json({ok: false, error: 'Incorrect interim password.'}, {status: 401});

  const token = createInterimSession();
  if (!token) return NextResponse.json({ok: false, error: 'Interim access is not configured.'}, {status: 404});
  const response = NextResponse.json({ok: true});
  response.cookies.set(interimSessionCookie, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: sessionLifetimeSeconds,
    path: '/',
  });
  return response;
}

export async function DELETE() {
  const response = NextResponse.json({ok: true});
  response.cookies.set(interimSessionCookie, '', {httpOnly: true, maxAge: 0, path: '/'});
  return response;
}
