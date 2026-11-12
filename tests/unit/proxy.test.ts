import {NextRequest} from 'next/server';
import {afterEach, describe, expect, it, vi} from 'vitest';

const accessMocks = vi.hoisted(() => ({resolveAccess: vi.fn()}));

vi.mock('@/lib/access', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/access')>();
  accessMocks.resolveAccess.mockImplementation(actual.resolveAccess);
  return {...actual, resolveAccess: accessMocks.resolveAccess};
});
import {proxy} from '@/proxy';
import {isMachinePath, isPublicPath, machinePaths, publicPaths} from '@/lib/public-paths';

afterEach(() => {
  vi.unstubAllEnvs();
  accessMocks.resolveAccess.mockClear();
});

// The design kit is the only route that is public because of a flag. It lets tests reach the shell
// without a sign-in, so it must never be public unless synthetic data is on (production forbids that).
describe('public paths (Story 1.2)', () => {
  it('keeps the sign-in, callback, health, status, scheduled-job, heartbeat, dispatch and worker routes public', () => {
    expect(publicPaths).toEqual(['/login', '/auth/callback', '/api/health', '/api/status', '/recover', '/recover/confirm', '/manifest.en.webmanifest', '/manifest.he.webmanifest', '/pwa/icon-192.png', '/pwa/icon-512.png', '/pwa/apple-touch-icon.png', '/api/jobs', '/api/heartbeat', '/api/dispatch', '/api/workers']);
    for (const path of publicPaths) expect(isPublicPath(path, {})).toBe(true);
  });

  it('makes only the exact PWA static resources public and keeps near-misses private', () => {
    const resources = ['/manifest.en.webmanifest', '/manifest.he.webmanifest', '/pwa/icon-192.png', '/pwa/icon-512.png', '/pwa/apple-touch-icon.png'];
    for (const path of resources) {
      expect(isPublicPath(path, {}), path).toBe(true);
      expect(isMachinePath(path), path).toBe(false);
    }
    for (const path of ['/pwa/', '/pwa/other.png', '/manifest.fr.webmanifest', '/manifest.en.webmanifest/x', '/pwa/../settings', '/pwa/%2e%2e/settings', '/PWA/icon-192.png', '/Manifest.en.webmanifest']) {
      expect(isPublicPath(path, {SYNTHETIC_DATA_ENABLED: 'true'}), path).toBe(false);
      expect(isMachinePath(path), path).toBe(false);
    }
  });

  it('makes the two recovery pages public (Story 1.6) and nothing beneath or beside them', () => {
    for (const path of ['/recover', '/recover/confirm']) expect(isPublicPath(path, {}), path).toBe(true);
    for (const path of ['/recover/', '/recover/confirm/', '/recover/confirm/extra', '/recover/other', '/recovery', '/recover.json', '/Recover']) {
      expect(isPublicPath(path, {SYNTHETIC_DATA_ENABLED: 'true'}), path).toBe(false);
    }
  });

  it('makes the status route (Story 1.8) public at its one path and nothing beneath or beside it', () => {
    expect(isPublicPath('/api/status', {})).toBe(true);
    for (const path of ['/api/status/', '/api/status/extra', '/api/statuses', '/api/Status', '/api', '/status', '/api/status.json']) {
      expect(isPublicPath(path, {SYNTHETIC_DATA_ENABLED: 'true'}), path).toBe(false);
    }
  });

  it('makes the scheduled-job route (Story 1.9) public at its one path, a machine path, and nothing beneath or beside it', () => {
    expect(machinePaths).toEqual(['/api/jobs', '/api/heartbeat', '/api/dispatch', '/api/workers']);
    expect(isPublicPath('/api/jobs', {})).toBe(true);
    expect(isMachinePath('/api/jobs')).toBe(true);
    for (const path of ['/api/jobs/', '/api/jobs/extra', '/api/job', '/api/Jobs', '/api/jobs.json', '/jobs', '/api', '/api/jobs?x=1']) {
      expect(isPublicPath(path, {SYNTHETIC_DATA_ENABLED: 'true'}), path).toBe(false);
      expect(isMachinePath(path), path).toBe(false);
    }
  });

  it('makes the heartbeat route (Story 1.13) public at its one path, the second machine path, and nothing beneath or beside it', () => {
    expect(isPublicPath('/api/heartbeat', {})).toBe(true);
    expect(isMachinePath('/api/heartbeat')).toBe(true);
    for (const path of ['/api/heartbeat/', '/api/heartbeat/extra', '/api/heartbeats', '/api/Heartbeat', '/api/heartbeat.json', '/heartbeat', '/api/heartbeat?x=1']) {
      expect(isPublicPath(path, {SYNTHETIC_DATA_ENABLED: 'true'}), path).toBe(false);
      expect(isMachinePath(path), path).toBe(false);
    }
  });

  it('makes the dispatch route (Story 2.7) public at its one path, the third machine path, and nothing beneath or beside it', () => {
    expect(isPublicPath('/api/dispatch', {})).toBe(true);
    expect(isMachinePath('/api/dispatch')).toBe(true);
    for (const path of ['/api/dispatch/', '/api/dispatch/extra', '/api/dispatches', '/api/Dispatch', '/api/dispatch.json', '/dispatch', '/api/dispatch?x=1']) {
      expect(isPublicPath(path, {SYNTHETIC_DATA_ENABLED: 'true'}), path).toBe(false);
      expect(isMachinePath(path), path).toBe(false);
    }
  });

  it('makes the worker route (Story 2.7) public at its one path, the fourth machine path, and nothing beneath or beside it', () => {
    expect(isPublicPath('/api/workers', {})).toBe(true);
    expect(isMachinePath('/api/workers')).toBe(true);
    for (const path of ['/api/workers/', '/api/workers/extra', '/api/worker', '/api/Workers', '/api/workers.json', '/workers', '/api/workers?x=1']) {
      expect(isPublicPath(path, {SYNTHETIC_DATA_ENABLED: 'true'}), path).toBe(false);
      expect(isMachinePath(path), path).toBe(false);
    }
  });

  it('is a machine path only where a scheduler or a worker, not a browser, makes the call: no other public path skips the origin check', () => {
    for (const path of publicPaths.filter((entry) => !machinePaths.includes(entry))) expect(isMachinePath(path), path).toBe(false);
    expect(isMachinePath('/kit')).toBe(false);
  });

  it('adds /kit only when SYNTHETIC_DATA_ENABLED is exactly true', () => {
    expect(isPublicPath('/kit', {SYNTHETIC_DATA_ENABLED: 'true'})).toBe(true);
    for (const value of [undefined, 'false', 'TRUE', '1', '', ' true']) expect(isPublicPath('/kit', {SYNTHETIC_DATA_ENABLED: value}), String(value)).toBe(false);
  });

  it('never makes any other private page public', () => {
    for (const path of ['/', '/settings', '/projects', '/progress', '/register', '/register/extra', '/kit/extra', '/kitx', '/admin', '/admin/accounts', '/admin/usage', '/step-up']) {
      expect(isPublicPath(path, {SYNTHETIC_DATA_ENABLED: 'true'}), path).toBe(false);
    }
  });
});

describe('proxy', () => {
  const run = (path: string) => proxy(new NextRequest(`http://127.0.0.1:4173${path}`));

  it('passes exact PWA resources without session resolution, cookies, or Account data', async () => {
    accessMocks.resolveAccess.mockClear();
    for (const path of ['/manifest.en.webmanifest', '/manifest.he.webmanifest', '/pwa/icon-192.png', '/pwa/icon-512.png', '/pwa/apple-touch-icon.png']) {
      const response = await run(path);
      expect(response.status, path).toBe(200);
      expect(response.headers.get('x-middleware-next'), path).toBe('1');
      expect(response.headers.has('set-cookie'), path).toBe(false);
      expect(await response.text(), path).toBe('');
    }
    expect(accessMocks.resolveAccess).not.toHaveBeenCalled();
  });

  it('keeps PWA near-misses behind the private-route gate', async () => {
    for (const path of ['/pwa/', '/pwa/other.png', '/manifest.fr.webmanifest', '/manifest.en.webmanifest/x', '/pwa/../settings', '/pwa/%2e%2e/settings', '/PWA/icon-192.png', '/Manifest.en.webmanifest']) {
      const response = await run(path);
      expect(response.status, path).toBe(307);
      expect(new URL(response.headers.get('location') ?? '').pathname, path).toBe('/login');
    }
  });

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
