import {NextRequest} from 'next/server';
import {afterEach, describe, expect, it, vi} from 'vitest';
import {proxy} from '@/proxy';
import {isPublicPath, publicPaths} from '@/lib/public-paths';

afterEach(() => vi.unstubAllEnvs());

// The design kit is the only route that is public because of a flag. It lets tests reach the shell
// without a sign-in, so it must never be public unless synthetic data is on (production forbids that).
describe('public paths (Story 1.2)', () => {
  it('keeps the sign-in, callback and health routes public', () => {
    expect(publicPaths).toEqual(['/login', '/auth/callback', '/api/health']);
    for (const path of publicPaths) expect(isPublicPath(path, {})).toBe(true);
  });

  it('adds /kit only when SYNTHETIC_DATA_ENABLED is exactly true', () => {
    expect(isPublicPath('/kit', {SYNTHETIC_DATA_ENABLED: 'true'})).toBe(true);
    for (const value of [undefined, 'false', 'TRUE', '1', '', ' true']) expect(isPublicPath('/kit', {SYNTHETIC_DATA_ENABLED: value}), String(value)).toBe(false);
  });

  it('never makes any other private page public', () => {
    for (const path of ['/', '/settings', '/projects', '/progress', '/kit/extra', '/kitx']) {
      expect(isPublicPath(path, {SYNTHETIC_DATA_ENABLED: 'true'}), path).toBe(false);
    }
  });
});

describe('proxy', () => {
  const run = (path: string) => proxy(new NextRequest(`http://127.0.0.1:4173${path}`));

  it('lets /kit through when synthetic data is on', async () => {
    vi.stubEnv('SYNTHETIC_DATA_ENABLED', 'true');
    const response = await run('/kit');
    expect(response.headers.get('x-middleware-next')).toBe('1');
  });

  it('sends /kit to sign-in when synthetic data is off, like any private page', async () => {
    vi.stubEnv('SYNTHETIC_DATA_ENABLED', 'false');
    const response = await run('/kit');
    expect(response.status).toBe(307);
    expect(new URL(response.headers.get('location') ?? '').pathname).toBe('/login');
  });

  it('still sends Settings to sign-in when synthetic data is on', async () => {
    vi.stubEnv('SYNTHETIC_DATA_ENABLED', 'true');
    const response = await run('/settings');
    expect(response.status).toBe(307);
    expect(new URL(response.headers.get('location') ?? '').pathname).toBe('/login');
  });
});
