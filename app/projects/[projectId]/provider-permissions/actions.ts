'use server';

import {refresh} from 'next/cache';
import {withActiveAccount} from '@/lib/auth';
import {operationOf} from '@/lib/authority';
import {readProject} from '@/lib/projects';
import {readJob} from '@/lib/job-records';
import {createPermissionStore} from '@/lib/providers/permissions';
import {outboundDataCategories, providerEnablement, type PaidCategory} from '@/lib/providers/policy';

export type PermissionActionState = {outcome: 'saved' | 'revoked' | 'unavailable' | 'disabled' | 'invalid'; reason?: string};

/** There is no server-authoritative paid operation payload in this checkout to quote. Fail closed without estimating inputs. */
async function verifiedQuote(provider: 'anthropic' | 'brave') {
  const ready = providerEnablement(provider);
  if (!ready.enabled) return {state: 'disabled' as const, reason: ready.reason ?? 'provider_unverified'};
  return {state: 'disabled' as const, reason: 'operation_quote_unavailable'};
}

/** Consent is saved only after live Project/Job ownership, nonterminal status, provider evidence, and a server calculator quote pass. */
export async function grantProviderPermission(input: {projectId: string; jobId: string; provider: 'anthropic' | 'brave'; category: PaidCategory; purpose: string; outboundData: string[]}): Promise<PermissionActionState> {
  return withActiveAccount({unavailable: {outcome: 'unavailable'}}, async ({access}) => {
    if (!input || !['anthropic','brave'].includes(input.provider) || !['research_search','synthesis_vision'].includes(input.category) ||
        typeof input.purpose !== 'string' || input.purpose.trim().length < 1 || input.purpose.length > 500 || !Array.isArray(input.outboundData) ||
        input.outboundData.some((item) => !(outboundDataCategories as readonly string[]).includes(item)) ||
        (input.category === 'research_search' && (input.provider !== 'brave' || input.outboundData.length !== 1 || input.outboundData[0] !== 'normalized_public_subject')) ||
        (input.category === 'synthesis_vision' && (input.provider !== 'anthropic' || input.outboundData.includes('normalized_public_subject')))) return {outcome: 'invalid'};
    const operation = operationOf(access.account);
    const project = await readProject(operation, input.projectId);
    if (project.outcome !== 'found') return {outcome: 'unavailable'};
    const job = await readJob(operation, {jobId: input.jobId});
    if (job.outcome !== 'found' || job.job.projectId !== input.projectId || ['completed','failed','cancelled'].includes(job.job.state)) return {outcome: 'unavailable'};
    const quote = await verifiedQuote(input.provider);
    // No current route supplies an authoritative paid operation for quoting. Keep this action
    // available as a guarded boundary, but never persist a grant from client-supplied price data.
    return {outcome: 'disabled', reason: quote.reason};
  });
}

/** Revocation is scoped to the live Account and an existing Project/Job; unknown ownership fails closed. */
export async function revokeProviderPermission(input: {projectId: string; jobId: string; permissionId: string}): Promise<PermissionActionState> {
  return withActiveAccount({unavailable: {outcome: 'unavailable'}}, async ({access}) => {
    if (!input || typeof input.projectId !== 'string' || typeof input.jobId !== 'string' || typeof input.permissionId !== 'string') return {outcome: 'invalid'};
    const operation = operationOf(access.account);
    const project = await readProject(operation, input.projectId);
    const job = await readJob(operation, {jobId: input.jobId});
    if (project.outcome !== 'found' || job.outcome !== 'found' || job.job.projectId !== input.projectId) return {outcome: 'unavailable'};
    const changed = await createPermissionStore().revoke({accountId: access.account.accountId, projectId: input.projectId, jobId: input.jobId, permissionId: input.permissionId});
    refresh();
    return changed ? {outcome: 'revoked'} : {outcome: 'unavailable'};
  });
}
