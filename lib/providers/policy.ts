// Story 2.5 provider boundary policy. This module has no network capability;
// adapters must obtain an affirmative decision here before building payloads.
import provisioningLedger from '../../provisioning/ledger.json';

export const paidCategories = ['research_search', 'synthesis_vision'] as const;
export type PaidCategory = (typeof paidCategories)[number];

export const outboundDataCategories = [
  'normalized_public_subject',
  'confirmed_project_scope',
  'project_evidence',
  'provider_image_derivatives',
] as const;
export type OutboundDataCategory = (typeof outboundDataCategories)[number];

export type PermissionSnapshot = {
  id?: string;
  accountId: string;
  projectId: string;
  jobId: string;
  category: PaidCategory;
  provider: 'anthropic' | 'brave';
  purpose: string;
  outboundData: readonly OutboundDataCategory[];
  disclosedMaximumMicrodollars: number;
  grantedAt: string;
  expiresAt: string;
  revokedAt: string | null;
  jobTerminal: boolean;
};

/** A server-loaded, durable permission lifecycle. This module deliberately does not cache grants. */
export interface PermissionStore {
  grant(input: Omit<PermissionSnapshot, 'id' | 'grantedAt' | 'expiresAt' | 'revokedAt' | 'jobTerminal'>): Promise<PermissionSnapshot>;
  get(input: {accountId: string; projectId: string; jobId: string; category: PaidCategory; provider: 'anthropic' | 'brave'}): Promise<PermissionSnapshot | null>;
  revoke(input: {accountId: string; projectId: string; jobId: string; permissionId: string}): Promise<boolean>;
}

/** Exact admission check shared with the SQL reservation transaction. */
export type PermissionAdmission = PermissionMatch & {permissionId: string};

export function permissionSnapshotIsUsable(snapshot: PermissionSnapshot | null, request: PermissionMatch): boolean {
  return matchProviderPermission(snapshot, request).allowed;
}

export type PermissionMatch = {
  accountId: string;
  projectId: string;
  jobId: string;
  category: PaidCategory;
  provider: 'anthropic' | 'brave';
  purpose: string;
  outboundData: readonly OutboundDataCategory[];
  calculatedMaximumMicrodollars: number;
  now?: string;
};

export type PermissionDecision =
  | {allowed: true; snapshot: PermissionSnapshot}
  | {allowed: false; reason: 'missing' | 'revoked' | 'expired' | 'job_terminal' | 'scope_mismatch' | 'maximum_exceeded'};

const sameSet = (left: readonly string[], right: readonly string[]) =>
  left.length === right.length && new Set(left).size === left.length && [...left].every((value) => right.includes(value));

/** Exact binding check used at every operation admission. */
export function matchProviderPermission(snapshot: PermissionSnapshot | null, request: PermissionMatch): PermissionDecision {
  if (!snapshot) return {allowed: false, reason: 'missing'};
  if (snapshot.revokedAt) return {allowed: false, reason: 'revoked'};
  if (snapshot.jobTerminal) return {allowed: false, reason: 'job_terminal'};
  const now = Date.parse(request.now ?? new Date().toISOString());
  const expiresAt = Date.parse(snapshot.expiresAt);
  const grantedAt = Date.parse(snapshot.grantedAt);
  if (!Number.isFinite(now) || !Number.isFinite(expiresAt) || !Number.isFinite(grantedAt) || now < grantedAt || now >= expiresAt) {
    return {allowed: false, reason: 'expired'};
  }
  if (
    snapshot.accountId !== request.accountId || snapshot.projectId !== request.projectId || snapshot.jobId !== request.jobId ||
    snapshot.category !== request.category || snapshot.provider !== request.provider || snapshot.purpose !== request.purpose ||
    !sameSet(snapshot.outboundData, request.outboundData)
  ) return {allowed: false, reason: 'scope_mismatch'};
  if (!Number.isSafeInteger(request.calculatedMaximumMicrodollars) || request.calculatedMaximumMicrodollars < 0 ||
      request.calculatedMaximumMicrodollars > snapshot.disclosedMaximumMicrodollars) {
    return {allowed: false, reason: 'maximum_exceeded'};
  }
  return {allowed: true, snapshot};
}

function attestationRecorded(id: string): boolean {
  const item = provisioningLedger.items.find((entry) => entry.id === id) as unknown as {kind: string; evidence: Record<string, unknown>} | undefined;
  if (!item || item.kind !== 'attestation') return false;
  const evidence = item.evidence.staging;
  if (!evidence || typeof evidence !== 'object' || Array.isArray(evidence)) return false;
  const record = evidence as Record<string, unknown>;
  const today = new Date().toISOString().slice(0, 10);
  if (typeof record.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(record.date) || record.date > today) return false;
  const parsedDate = new Date(`${record.date}T00:00:00.000Z`);
  if (Number.isNaN(parsedDate.getTime()) || parsedDate.toISOString().slice(0, 10) !== record.date) return false;
  if (typeof record.ref !== 'string' || !/^[\p{L}\p{N}][\p{L}\p{N} ._(),'&+\-]{2,119}$/u.test(record.ref)) return false;
  return !/^(?:tbd|tba|tbc|none|nil|null|undefined|na|pending|todo|test|testing|example|export|exports|sample|placeholder|dummy|foo|bar|baz|screenshot|file|name|ref|reference|[x*._\- ]+)$/i.test(record.ref.trim());
}

/** Readiness is derived from the provisioning ledger and server environment, never caller-supplied booleans. */
export function providerEnablement(provider: 'anthropic' | 'brave', env: Record<string, string | undefined> = process.env): {enabled: boolean; reason: string | null} {
  const slug = provider;
  if (!attestationRecorded(`${slug}-rate-schedule`)) return {enabled: false, reason: 'rates_unverified'};
  if (!attestationRecorded(`${slug}-account-terms`)) return {enabled: false, reason: 'terms_unverified'};
  if (!(env[provider === 'anthropic' ? 'ANTHROPIC_API_KEY' : 'BRAVE_SEARCH_API_KEY'] ?? '').trim()) return {enabled: false, reason: 'credential_missing'};
  if (provider === 'brave' && !attestationRecorded('brave-terms-review')) return {enabled: false, reason: 'brave_terms_review_missing'};
  return {enabled: true, reason: null};
}

/** Canonical query input. Callers must pass only the already-confirmed public subject, never a raw prompt. */
export function normalizePublicSubject(value: unknown): string {
  if (typeof value !== 'string') throw new TypeError('A confirmed public subject is required.');
  const normalized = value.normalize('NFKC').replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!normalized || [...normalized].length > 240) throw new TypeError('The public subject must contain 1 to 240 characters.');
  return normalized;
}
