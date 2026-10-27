import {beforeEach, describe, expect, it, vi} from 'vitest';

const callApi = vi.fn();
const callRow = vi.fn();
vi.mock('@/lib/accounts', () => ({callApi, callRow, requireUuid: (_name: string, value: string) => value, unexpected: () => new Error('unexpected')}));

const valid = {
  id: '11111111-1111-4111-8111-111111111111', account_id: '22222222-2222-4222-8222-222222222222',
  project_id: '33333333-3333-4333-8333-333333333333', job_id: '44444444-4444-4444-8444-444444444444',
  category: 'research_search', provider: 'brave', purpose: 'discover public sources', outbound_data: ['normalized_public_subject'],
  disclosed_maximum_microdollars: 100_000, granted_at: '2026-10-21T12:00:00.000Z', expires_at: '2026-10-28T12:00:00.000Z', revoked_at: null, job_terminal: false,
};

describe('persisted provider permission decoding', () => {
  beforeEach(() => { callApi.mockReset(); callRow.mockReset(); });
  it('decodes a complete persisted snapshot', async () => {
    callApi.mockResolvedValue([valid]);
    const {createPermissionStore} = await import('@/lib/providers/permissions');
    expect(await createPermissionStore().get({accountId: valid.account_id, projectId: valid.project_id, jobId: valid.job_id, category: 'research_search', provider: 'brave'})).toMatchObject({id: valid.id, provider: 'brave', jobTerminal: false});
  });
  it.each([
    {category: 'anything'}, {provider: 'other'}, {outbound_data: ['credentials']}, {outbound_data: ['normalized_public_subject','normalized_public_subject']},
    {job_terminal: 'false'}, {revoked_at: 17}, {disclosed_maximum_microdollars: 1.5}, {id: 'invalid'}, {expires_at: 'not a date'},
  ])('fails closed on malformed persisted fields %o', async (patch) => {
    callApi.mockResolvedValue([{...valid, ...patch}]);
    const {createPermissionStore} = await import('@/lib/providers/permissions');
    await expect(createPermissionStore().get({accountId: valid.account_id, projectId: valid.project_id, jobId: valid.job_id, category: 'research_search', provider: 'brave'})).rejects.toThrow('unexpected');
  });

  it('maps grant, empty lookup, and revoke arguments at the store boundary', async () => {
    callApi.mockResolvedValue([valid]);
    callRow.mockResolvedValue({revoked: true});
    const {createPermissionStore} = await import('@/lib/providers/permissions');
    const store = createPermissionStore();
    await store.grant({accountId: valid.account_id, projectId: valid.project_id, jobId: valid.job_id, category: 'research_search', provider: 'brave', purpose: valid.purpose, outboundData: ['normalized_public_subject'], disclosedMaximumMicrodollars: 100_000});
    expect(callApi).toHaveBeenCalledWith('grant_provider_permission', expect.objectContaining({p_account_id: valid.account_id, p_project_id: valid.project_id, p_job_id: valid.job_id, p_category: 'research_search', p_provider: 'brave', p_purpose: valid.purpose, p_outbound_data: ['normalized_public_subject'], p_disclosed_maximum_microdollars: 100_000}), {});
    callApi.mockResolvedValueOnce([]);
    expect(await store.get({accountId: valid.account_id, projectId: valid.project_id, jobId: valid.job_id, category: 'research_search', provider: 'brave'})).toBeNull();
    expect(await store.revoke({accountId: valid.account_id, projectId: valid.project_id, jobId: valid.job_id, permissionId: valid.id})).toBe(true);
    expect(callRow).toHaveBeenCalledWith('revoke_provider_permission', {p_account_id: valid.account_id, p_project_id: valid.project_id, p_job_id: valid.job_id, p_permission_id: valid.id}, {});
  });

  it('rejects an empty grant result', async () => {
    const result: unknown[] = [];
    callApi.mockResolvedValue(result);
    const {createPermissionStore} = await import('@/lib/providers/permissions');
    await expect(createPermissionStore().grant({accountId: valid.account_id, projectId: valid.project_id, jobId: valid.job_id, category: 'research_search', provider: 'brave', purpose: valid.purpose, outboundData: ['normalized_public_subject'], disclosedMaximumMicrodollars: 100_000})).rejects.toThrow('unexpected');
  });

  it.each([{}, {revoked: 'yes'}])('rejects malformed revoke results %o', async (result) => {
    callRow.mockResolvedValue(result);
    const {createPermissionStore} = await import('@/lib/providers/permissions');
    await expect(createPermissionStore().revoke({accountId: valid.account_id, projectId: valid.project_id, jobId: valid.job_id, permissionId: valid.id})).rejects.toThrow('unexpected');
  });
});
