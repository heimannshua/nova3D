// Server-only persistence for category-scoped paid-work permissions.
import {callApi, callRow, requireUuid, unexpected, type AccountsOptions, type Row} from '@/lib/accounts';
import {outboundDataCategories, type PermissionSnapshot, type PermissionStore, type PaidCategory, type OutboundDataCategory} from './policy';

if (typeof window !== 'undefined') throw new Error('Provider permissions are server-only.');

const text = (value: unknown) => typeof value === 'string' ? value : null;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function decode(row: Row): PermissionSnapshot {
  const outbound = row.outbound_data;
  const maximum = row.disclosed_maximum_microdollars;
  if (!Array.isArray(outbound) || outbound.length < 1 || outbound.length > 8 || outbound.some((item) => typeof item !== 'string' || !(outboundDataCategories as readonly string[]).includes(item)) || new Set(outbound).size !== outbound.length) throw unexpected();
  if (typeof row.id !== 'string' || typeof row.account_id !== 'string' || typeof row.project_id !== 'string' || typeof row.job_id !== 'string' ||
      (row.category !== 'research_search' && row.category !== 'synthesis_vision') || (row.provider !== 'anthropic' && row.provider !== 'brave') ||
      typeof row.purpose !== 'string' || row.purpose.length < 1 || row.purpose.length > 500 || typeof maximum !== 'number' || !Number.isSafeInteger(maximum) || maximum < 1 || maximum > 1_000_000 ||
      typeof row.granted_at !== 'string' || !Number.isFinite(Date.parse(row.granted_at)) || typeof row.expires_at !== 'string' || !Number.isFinite(Date.parse(row.expires_at)) ||
      (row.revoked_at !== null && (typeof row.revoked_at !== 'string' || !Number.isFinite(Date.parse(row.revoked_at)))) || typeof row.job_terminal !== 'boolean' ||
      !uuid.test(row.id) || !uuid.test(row.account_id) || !uuid.test(row.project_id) || !uuid.test(row.job_id)) throw unexpected();
  return {id: row.id, accountId: row.account_id, projectId: row.project_id, jobId: row.job_id, category: row.category as PaidCategory,
    provider: row.provider, purpose: String(row.purpose), outboundData: outbound as OutboundDataCategory[],
    disclosedMaximumMicrodollars: maximum, grantedAt: row.granted_at, expiresAt: row.expires_at,
    revokedAt: text(row.revoked_at), jobTerminal: row.job_terminal};
}

export function createPermissionStore(options: AccountsOptions = {}): PermissionStore {
  return {
    async grant(input) {
      const result = await callApi('grant_provider_permission', {p_account_id: requireUuid('accountId', input.accountId), p_project_id: requireUuid('projectId', input.projectId),
        p_job_id: requireUuid('jobId', input.jobId), p_category: input.category, p_provider: input.provider, p_purpose: input.purpose,
        p_outbound_data: [...input.outboundData], p_disclosed_maximum_microdollars: input.disclosedMaximumMicrodollars}, options);
      if (!Array.isArray(result) || !result[0] || typeof result[0] !== 'object') throw unexpected();
      return decode(result[0] as Row);
    },
    async get(input) {
      const result = await callApi('get_provider_permission', {p_account_id: requireUuid('accountId', input.accountId), p_project_id: requireUuid('projectId', input.projectId),
        p_job_id: requireUuid('jobId', input.jobId), p_category: input.category, p_provider: input.provider}, options);
      if (!Array.isArray(result) || result.length > 1) throw unexpected();
      return result.length ? decode(result[0] as Row) : null;
    },
    async revoke(input) {
      const row = await callRow('revoke_provider_permission', {p_account_id: requireUuid('accountId', input.accountId), p_project_id: requireUuid('projectId', input.projectId),
        p_job_id: requireUuid('jobId', input.jobId), p_permission_id: requireUuid('permissionId', input.permissionId)}, options);
      if (typeof row.revoked !== 'boolean') throw unexpected();
      return row.revoked;
    },
  };
}
