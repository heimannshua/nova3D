import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';

// The synthetic-only route that gives the tests a real route mutation (Story 1.4c): a counter per Account that
// a GET reports and a POST bumps, 404 unless synthetic data is on, and nothing else. The guards are faked here;
// what they decide is tested in tests/unit/auth.test.ts and, end to end, in tests/e2e/request-integrity.spec.ts.
const mocks = vi.hoisted(() => ({requireApiAccess: vi.fn(), requireMutationAccess: vi.fn()}));
vi.mock('@/lib/auth', () => ({requireApiAccess: mocks.requireApiAccess, requireMutationAccess: mocks.requireMutationAccess}));

import {GET, POST} from '@/app/api/kit/mutation/route';

const accountA = '7a1b2c3d-4e5f-4a6b-8c7d-0e1f2a3b4c5d';
const accountB = '8b2c3d4e-5f6a-4b7c-9d8e-1f2a3b4c5d6e';
const active = (accountId: string) => ({access: {state: 'active', user: {id: 'u', email: 'e', sessionId: 's'}, account: {accountId, workspaceId: null, role: 'member', epoch: 1}}});
const refusal = (status: number, error: string) => ({denied: Response.json({error}, {status})});
const request = new Request('https://app.example/api/kit/mutation', {method: 'POST'});
const count = async (response: Response) => (await response.json()).count;

beforeEach(() => {
  vi.stubEnv('SYNTHETIC_DATA_ENABLED', 'true');
  mocks.requireApiAccess.mockReset().mockResolvedValue(active(accountA));
  mocks.requireMutationAccess.mockReset().mockResolvedValue(active(accountA));
});
afterEach(() => vi.unstubAllEnvs());

describe('GET and POST /api/kit/mutation', () => {
  it('reports a counter that a POST bumps, per Account', async () => {
    const mine = accountA.replace(/^7a/, '71');
    mocks.requireApiAccess.mockResolvedValue(active(mine));
    mocks.requireMutationAccess.mockResolvedValue(active(mine));
    expect(await count(await GET())).toBe(0);
    expect(await count(await POST(request))).toBe(1);
    expect(await count(await POST(request))).toBe(2);
    expect(await count(await GET())).toBe(2);
    // Another Account has its own.
    mocks.requireApiAccess.mockResolvedValue(active(accountB));
    expect(await count(await GET())).toBe(0);
  });

  it('answers no-store JSON', async () => {
    const response = await GET();
    expect(response.headers.get('content-type')).toMatch(/^application\/json/);
    expect(response.headers.get('cache-control')).toBe('no-store');
  });

  it('starts from its guards: the GET from requireApiAccess, the POST from requireMutationAccess with the request', async () => {
    await GET();
    await POST(request);
    expect(mocks.requireApiAccess).toHaveBeenCalledTimes(1);
    expect(mocks.requireMutationAccess).toHaveBeenCalledExactlyOnceWith(request);
    expect(mocks.requireApiAccess.mock.calls.length + mocks.requireMutationAccess.mock.calls.length).toBe(2);
  });

  it('changes nothing when a guard refuses: the denial is the answer', async () => {
    const before = await count(await GET());
    for (const [status, error] of [[403, 'csrf_invalid'], [403, 'origin_not_allowed'], [401, 'not_signed_in'], [503, 'auth_unavailable']] as const) {
      mocks.requireMutationAccess.mockResolvedValue(refusal(status, error));
      const response = await POST(request);
      expect([response.status, (await response.json()).error]).toEqual([status, error]);
    }
    expect(await count(await GET())).toBe(before);
    mocks.requireApiAccess.mockResolvedValue(refusal(401, 'not_signed_in'));
    expect((await GET()).status).toBe(401);
  });

  it.each(['false', '', 'TRUE', '1', undefined])('is a 404 that changes nothing, and asks no guard anything, unless synthetic data is exactly true (%j)', async (value) => {
    const before = await count(await GET());
    mocks.requireApiAccess.mockClear();
    mocks.requireMutationAccess.mockClear();
    vi.stubEnv('SYNTHETIC_DATA_ENABLED', value as string);
    const get = await GET();
    expect(get.status).toBe(404);
    expect(get.headers.get('cache-control')).toBe('no-store');
    const post = await POST(request);
    expect(post.status).toBe(404);
    expect(await post.json()).toEqual({error: 'not_found'});
    // Before any access, token or database call: a deployment without the route spends nothing on it.
    expect(mocks.requireApiAccess).not.toHaveBeenCalled();
    expect(mocks.requireMutationAccess).not.toHaveBeenCalled();
    vi.stubEnv('SYNTHETIC_DATA_ENABLED', 'true');
    expect(await count(await GET())).toBe(before);
  });

  it('answers a signed-out caller 404 too when the route is off (it is not there to be refused), and with the guard\'s own answer when it is on', async () => {
    mocks.requireApiAccess.mockResolvedValue(refusal(401, 'not_signed_in'));
    mocks.requireMutationAccess.mockResolvedValue(refusal(401, 'not_signed_in'));
    vi.stubEnv('SYNTHETIC_DATA_ENABLED', 'false');
    expect([(await GET()).status, (await POST(request)).status]).toEqual([404, 404]);
    vi.stubEnv('SYNTHETIC_DATA_ENABLED', 'true');
    expect([(await GET()).status, (await POST(request)).status]).toEqual([401, 401]);
  });
});
