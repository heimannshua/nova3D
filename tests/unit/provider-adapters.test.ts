import {describe, expect, it, vi} from 'vitest';
import {dispatchAnthropicMessages, dispatchBraveSearch, type AdapterConfig} from '@/lib/providers/adapters';
import {buildSearchPayload, buildSynthesisPayload} from '@/lib/providers/payload';
import type {PermissionSnapshot} from '@/lib/providers/policy';

const permission: PermissionSnapshot = {
  accountId: 'account-1', projectId: 'project-1', jobId: 'job-1', category: 'research_search', provider: 'brave',
  purpose: 'discover public sources', outboundData: ['normalized_public_subject'], disclosedMaximumMicrodollars: 100_000,
  grantedAt: '2026-10-21T12:00:00.000Z', expiresAt: '2026-10-28T12:00:00.000Z', revokedAt: null, jobTerminal: false,
};
const base = (): AdapterConfig => ({
  freeOnly: false,
  permission,
  match: {
    accountId: 'account-1', projectId: 'project-1', jobId: 'job-1', category: 'research_search', provider: 'brave',
    purpose: permission.purpose, outboundData: permission.outboundData, calculatedMaximumMicrodollars: 100_000, now: '2026-10-21T12:01:00.000Z',
  },
  operation: {id: '22222222-2222-4222-8222-222222222222', accountId: 'account-1', projectId: 'project-1', jobId: 'job-1'},
  reservation: {outcome: 'reserved', reservationId: '11111111-1111-4111-8111-111111111111', operationId: '22222222-2222-4222-8222-222222222222', accountId: 'account-1', jobId: 'job-1', reservedMicrodollars: 100_000},
  markDispatched: vi.fn(async () => true),
  fetch: vi.fn(async () => Response.json({web: {results: []}}, {status: 200})),
});

describe('provider adapters', () => {
  it('never calls a provider in free-only mode or without verified enablement', async () => {
    const config = base();
    config.freeOnly = true;
    expect(await dispatchBraveSearch(buildSearchPayload({confirmedPublicSubject: 'altar'}), config)).toEqual({outcome: 'disabled', reason: 'free_only'});
    expect(config.fetch).not.toHaveBeenCalled();
    config.freeOnly = false;
    expect(await dispatchBraveSearch(buildSearchPayload({confirmedPublicSubject: 'altar'}), config)).toMatchObject({outcome: 'disabled', reason: 'rates_unverified'});
    expect(config.fetch).not.toHaveBeenCalled();
  });

  it('keeps dispatch disabled until provisioning evidence is recorded', async () => {
    const config = base();
    const anthropicPermission: PermissionSnapshot = {
      ...permission, category: 'synthesis_vision', provider: 'anthropic', purpose: 'identify subject',
      outboundData: ['confirmed_project_scope'],
    };
    config.permission = anthropicPermission;
    config.match = {
      ...config.match, category: 'synthesis_vision', provider: 'anthropic', purpose: anthropicPermission.purpose,
      outboundData: anthropicPermission.outboundData,
    };
    config.fetch = vi.fn(async () => new Response('error', {status: 503}));
    config.markDispatched = vi.fn(async () => false);
    const payload = buildSynthesisPayload({purpose: 'identify subject', confirmedScope: 'altar', approvedEvidence: [], derivatives: [], allowedData: ['confirmed_project_scope']});
    expect(await dispatchAnthropicMessages(payload, config)).toEqual({outcome: 'disabled', reason: 'rates_unverified'});
    expect(config.fetch).not.toHaveBeenCalled();
    expect(config.markDispatched).not.toHaveBeenCalled();
  });

  it('does not admit a permission for another provider or category to Anthropic', async () => {
    const config = base();
    const synthesis = buildSynthesisPayload({purpose: 'identify subject', confirmedScope: 'altar', approvedEvidence: [], derivatives: [], allowedData: ['confirmed_project_scope']});
    expect(await dispatchAnthropicMessages(synthesis, config)).toEqual({outcome: 'rejected', reason: 'not_admitted'});
    expect(config.fetch).not.toHaveBeenCalled();
  });

  it('rejects a reservation bound to a different Account or Job before marking dispatch', async () => {
    const config = base();
    config.reservation = {...config.reservation!, accountId: 'other-account'};
    expect(await dispatchBraveSearch(buildSearchPayload({confirmedPublicSubject: 'altar'}), config)).toEqual({outcome: 'rejected', reason: 'not_admitted'});
    expect(config.markDispatched).not.toHaveBeenCalled();
    config.reservation = {...config.reservation!, accountId: 'account-1', jobId: 'other-job'};
    expect(await dispatchBraveSearch(buildSearchPayload({confirmedPublicSubject: 'altar'}), config)).toEqual({outcome: 'rejected', reason: 'not_admitted'});
    expect(config.fetch).not.toHaveBeenCalled();
    config.reservation = {...config.reservation!, jobId: 'job-1'};
    config.reservation = {...config.reservation!, operationId: '33333333-3333-4333-8333-333333333333'};
    expect(await dispatchBraveSearch(buildSearchPayload({confirmedPublicSubject: 'altar'}), config)).toEqual({outcome: 'rejected', reason: 'not_admitted'});
  });

  it('rejects malformed reservation identifiers before dispatch', async () => {
    const config = base();
    config.reservation = {...config.reservation!, reservationId: 'bad'};
    expect(await dispatchBraveSearch(buildSearchPayload({confirmedPublicSubject: 'altar'}), config)).toEqual({outcome: 'rejected', reason: 'not_admitted'});
    expect(config.markDispatched).not.toHaveBeenCalled();
  });
});
