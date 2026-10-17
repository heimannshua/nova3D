import {beforeEach, describe, expect, it, vi} from 'vitest';

// The route of Story 1.12, `POST /api/transfers/tickets` (app/api/transfers/tickets/route.ts): one POST, never static, that starts from the mutation
// guard and does nothing before it. The guards are faked here (what they decide is tests/unit/auth.test.ts and, end to end,
// tests/e2e/file-gateway.spec.ts), and so is the issuing (tests/unit/transfer-tickets.test.ts): what is pinned is the route's own shape.
const mocks = vi.hoisted(() => ({requireMutationAccess: vi.fn(), issueTransferTicket: vi.fn()}));
vi.mock('@/lib/auth', () => ({requireMutationAccess: mocks.requireMutationAccess}));
vi.mock('@/lib/transfer-tickets', () => ({issueTransferTicket: mocks.issueTransferTicket}));

import * as route from '@/app/api/transfers/tickets/route';

const account = {accountId: '7a1b2c3d-4e5f-4a6b-8c7d-0e1f2a3b4c5d', workspaceId: null, role: 'member', epoch: 3, preferences: null};
const active = {access: {state: 'active', user: {id: 'u', email: 'e', sessionId: 's'}, account}};
const refusal = (status: number, error: string) => ({denied: Response.json({error}, {status})});
const request = () => new Request('https://app.example/api/transfers/tickets', {method: 'POST', body: JSON.stringify({direction: 'download'})});

beforeEach(() => {
  mocks.requireMutationAccess.mockReset().mockResolvedValue(active);
  mocks.issueTransferTicket.mockReset().mockResolvedValue(Response.json({ticket: 't', gateway: 'g'}));
});

describe('the route', () => {
  it('exports one POST and `dynamic`, and nothing else: no GET puts a ticket in a URL', () => {
    expect(Object.keys(route).sort()).toEqual(['POST', 'dynamic']);
    expect(route.dynamic).toBe('force-dynamic');
  });

  it('starts from the mutation guard with its own request, before anything else', async () => {
    const given = request();
    await route.POST(given);
    expect(mocks.requireMutationAccess).toHaveBeenCalledExactlyOnceWith(given);
    expect(mocks.requireMutationAccess.mock.invocationCallOrder[0]).toBeLessThan(mocks.issueTransferTicket.mock.invocationCallOrder[0]);
  });

  it.each([
    [401, 'not_signed_in'],
    [403, 'origin_not_allowed'],
    [403, 'csrf_invalid'],
    [503, 'unavailable'],
  ])('returns the guard\'s %s %s untouched, and neither reads the body nor signs anything', async (status, error) => {
    const denial = refusal(status, error);
    mocks.requireMutationAccess.mockResolvedValue(denial);
    const given = request();
    const response = await route.POST(given);
    expect(response).toBe(denial.denied);
    expect(response.status).toBe(status);
    expect(await response.json()).toEqual({error});
    expect(given.bodyUsed).toBe(false);
    expect(mocks.issueTransferTicket).not.toHaveBeenCalled();
  });

  it('hands the verified access, never the request\'s claims, and the process environment to the issuer, and returns its answer as it is', async () => {
    const answer = Response.json({ticket: 'signed', gateway: 'https://files.example.test'}, {headers: {'cache-control': 'no-store'}});
    mocks.issueTransferTicket.mockResolvedValue(answer);
    const given = request();
    const response = await route.POST(given);
    expect(response).toBe(answer);
    expect(mocks.issueTransferTicket).toHaveBeenCalledExactlyOnceWith(given, active.access, process.env);
  });
});
