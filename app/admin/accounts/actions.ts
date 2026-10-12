'use server';

import {refresh} from 'next/cache';
import {accountIdOf, type AccountActionState} from '@/lib/account-admin';
import {
  AccountsConfigError,
  AccountsUnavailableError,
  disableAccount,
  enableAccount,
  recordAccountRefusal,
  type AccountRefusalAction,
} from '@/lib/accounts';
import {administered, type AdministeredSteps} from '@/lib/administered';
import {runCancellers} from '@/lib/authority';
import {withDeadline, withinBudget} from '@/lib/deadline';

// The Administrator's two changes to an Account (Story 1.5): disable it and re-enable it. Each is a Server Action that goes
// through `administered` (lib/administered.ts, shared with the invitation page), so, behind `withActiveAccount` and in this
// order, and nothing changes before all of them pass:
//
//   1. The Account's role is `administrator` (the live authorization's, not the request's). Otherwise the attempt is refused,
//      audited as `account.denied`, and nothing else is done. The one thing read from the form before this check is the
//      `accountId`, because the refusal is audited against that Account; it is parsed to a UUID or null at once
//      (`accountIdOf`).
//   2. The session's own `administration` marker is valid (`checkMarker`, five minutes). Anything but `allowed` is a refusal;
//      `none` and `expired` offer the step-up. A refusal is audited as `account.disable_refused` or `account.enable_refused`.
//   3. `disableAccount` or `enableAccount`, with the actor `user:<Auth user ID>` taken from the verified session, never from
//      the request. Disabling is ONE database transaction (the status and epoch, every session grant, the Auth sessions, the
//      audit event); the Workspace is untouched.
//
// Cancellation signals go out only AFTER the disable has committed (`runCancellers`, lib/authority.ts): best effort, counted,
// and never a reason to undo it. A canceller that asks the authority guard therefore always finds it denying.
//
// Nothing here reads, shows or logs Workspace content, a project name or usage, and a refusal is recorded with the actor, the
// action and the Account alone, never a reason. This file prints only the name and message of an error.

const describe = (error: unknown) => (error instanceof Error ? `${error.name}: ${error.message}` : 'unknown failure');

/** How long recording a refusal may take once the change has been refused. Its own allowance: a slow check must not cost the audit. */
const refusalRecordMs = 3000;

const nothingHappened: AccountActionState = {outcome: 'unavailable', unknown: false};

async function recordRefusal(userId: string, action: AccountRefusalAction, accountId: string | null) {
  try {
    await withDeadline(recordAccountRefusal({userId, action, accountId}, {timeoutMs: refusalRecordMs}), refusalRecordMs);
  } catch (error) {
    console.error('A refused Account change could not be recorded in the audit trail.', describe(error));
  }
}

/**
 * Whether the change certainly did not happen. A request the database never received (the key is not configured), or one it
 * understood and rejected (a 4xx), changed nothing. Anything else may have reached it: a dropped connection, a timeout, a
 * server error, an answer that makes no sense. For those the person is told to check the list first.
 */
function failed(error: unknown): AccountActionState {
  console.error('The Account change failed.', describe(error));
  const certain = error instanceof AccountsConfigError || (error instanceof AccountsUnavailableError && !error.outcomeUnknown);
  // "Check the list" must point at a list that has been read since: a lost answer may have been a change that was made.
  if (!certain) refresh();
  return {outcome: 'unavailable', unknown: !certain};
}

type Change = {
  /** The refusal to record when the Administrator has no valid marker. */
  refusal: Extract<AccountRefusalAction, 'account.disable_refused' | 'account.enable_refused'>;
  /** The Account the attempt named (the database records it only if it exists); null when the form named none. */
  accountId: string | null;
};

/** What `administered` answers for each way a change is stopped, and how it records the two refusals. */
function stoppedBy(change: Change): AdministeredSteps<AccountActionState> {
  return {
    unavailable: nothingHappened,
    denied: {outcome: 'denied'},
    refused: (stepUp) => ({outcome: 'refused', stepUp}),
    recordDenied: (userId) => recordRefusal(userId, 'account.denied', change.accountId),
    recordRefused: (userId) => recordRefusal(userId, change.refusal, change.accountId),
  };
}

/**
 * Disables a member Account. One transaction in the database ends its authority (sessions, grants, epoch); only afterwards do
 * the cancellers run. The answer says how many sessions ended and how many Jobs were cancelled.
 */
export async function disableMemberAccount(_previous: AccountActionState, formData: FormData): Promise<AccountActionState> {
  const accountId = accountIdOf(formData.get('accountId'));
  return administered(stoppedBy({refusal: 'account.disable_refused', accountId}), async ({actor, budget}) => {
    if (!accountId) return {outcome: 'not_found'};
    let receipt: Awaited<ReturnType<typeof disableAccount>>;
    try {
      receipt = await withinBudget(budget, (timeoutMs) => disableAccount({accountId, actor}, {timeoutMs}));
    } catch (error) {
      return failed(error);
    }
    // Either way the list the page shows may be out of date now.
    refresh();
    switch (receipt.outcome) {
      case 'disabled': {
        // The disable has committed: the Account's authority is gone for good. Only now do the cancellation signals go out.
        const report = await runCancellers({accountId, epoch: receipt.epoch ?? 0});
        return {outcome: 'disabled', sessionsEnded: receipt.sessionsEnded, jobsCancelled: report.cancelled, cancellationsFailed: report.failed};
      }
      case 'already_disabled':
        return {outcome: 'already_disabled'};
      case 'administrator':
        return {outcome: 'administrator'};
      default:
        return {outcome: 'not_found'};
    }
  });
}

/** Re-enables a disabled Account under a newer epoch. The sessions that were ended stay ended: the person signs in anew. */
export async function enableMemberAccount(_previous: AccountActionState, formData: FormData): Promise<AccountActionState> {
  const accountId = accountIdOf(formData.get('accountId'));
  return administered(stoppedBy({refusal: 'account.enable_refused', accountId}), async ({actor, budget}) => {
    if (!accountId) return {outcome: 'not_found'};
    let receipt: Awaited<ReturnType<typeof enableAccount>>;
    try {
      receipt = await withinBudget(budget, (timeoutMs) => enableAccount({accountId, actor}, {timeoutMs}));
    } catch (error) {
      return failed(error);
    }
    refresh();
    if (receipt.outcome === 'enabled') return {outcome: 'enabled'};
    return {outcome: receipt.outcome === 'already_enabled' ? 'already_enabled' : 'not_found'};
  });
}
