import {describe, expect, it} from 'vitest';
import {matchProviderPermission, normalizePublicSubject, providerEnablement, type PermissionSnapshot} from '@/lib/providers/policy';

const permission: PermissionSnapshot = {
  accountId: 'account-1', projectId: 'project-1', jobId: 'job-1', category: 'research_search', provider: 'brave',
  purpose: 'discover public sources', outboundData: ['normalized_public_subject'], disclosedMaximumMicrodollars: 100_000,
  grantedAt: '2026-10-21T12:00:00.000Z', expiresAt: '2026-10-28T12:00:00.000Z', revokedAt: null, jobTerminal: false,
};
const request = {
  accountId: permission.accountId, projectId: permission.projectId, jobId: permission.jobId, category: permission.category,
  provider: permission.provider, purpose: permission.purpose, outboundData: permission.outboundData,
  calculatedMaximumMicrodollars: 100_000, now: '2026-10-21T12:01:00.000Z',
};

describe('paid provider permission policy', () => {
  it('matches exact scope and rejects scope, maximum, revocation, terminal Job, and expiry changes', () => {
    expect(matchProviderPermission(permission, request).allowed).toBe(true);
    expect(matchProviderPermission(permission, {...request, purpose: 'another purpose'})).toMatchObject({allowed: false, reason: 'scope_mismatch'});
    expect(matchProviderPermission(permission, {...request, outboundData: ['normalized_public_subject', 'project_evidence']})).toMatchObject({allowed: false, reason: 'scope_mismatch'});
    expect(matchProviderPermission(permission, {...request, calculatedMaximumMicrodollars: 100_001})).toMatchObject({allowed: false, reason: 'maximum_exceeded'});
    expect(matchProviderPermission({...permission, revokedAt: request.now}, request)).toMatchObject({allowed: false, reason: 'revoked'});
    expect(matchProviderPermission({...permission, jobTerminal: true}, request)).toMatchObject({allowed: false, reason: 'job_terminal'});
    expect(matchProviderPermission(permission, {...request, now: permission.expiresAt})).toMatchObject({allowed: false, reason: 'expired'});
  });

  it('fails closed before the grant time as well as after expiry', () => {
    expect(matchProviderPermission(permission, {...request, now: '2026-10-21T11:59:59.999Z'})).toMatchObject({allowed: false, reason: 'expired'});
    expect(matchProviderPermission(null, request)).toMatchObject({allowed: false, reason: 'missing'});
  });

  it('fails closed on missing provider evidence and requires the Brave ledger review', () => {
    expect(providerEnablement('anthropic', {ANTHROPIC_API_KEY: 'test'})).toMatchObject({enabled: false, reason: 'rates_unverified'});
    expect(providerEnablement('brave', {BRAVE_SEARCH_API_KEY: 'test'})).toMatchObject({enabled: false, reason: 'rates_unverified'});
    expect(providerEnablement('anthropic', {})).toMatchObject({enabled: false, reason: 'rates_unverified'});
  });

  it('normalizes public subjects and refuses empty or oversized input', () => {
    expect(normalizePublicSubject('  Middot\n  Altar ')).toBe('Middot Altar');
    expect(() => normalizePublicSubject('  ')).toThrow();
    expect(() => normalizePublicSubject('x'.repeat(241))).toThrow();
  });
});
