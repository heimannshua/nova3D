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
});
