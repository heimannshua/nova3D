'use server';

import {refresh} from 'next/cache';
import {accountIdOf} from '@/lib/account-admin';
import {AccountsConfigError, AccountsUnavailableError} from '@/lib/accounts';
import {administered, type AdministeredSteps} from '@/lib/administered';
import {operationOf} from '@/lib/authority';
import {withDeadline, withinBudget} from '@/lib/deadline';
import {recordUsageRefusal, setUsageLimit, type UsageCommandKind, type UsageRefusalAction} from '@/lib/usage';
import {parseDollars, type UsageActionState} from '@/lib/usage-view';

// The Administrator's two changes to an Account's usage limit (Story 2.4): change the monthly limit, and reset the count. Each is a Server Action
// that goes through `administered` (lib/administered.ts, shared with the invitation and Accounts pages), so, behind `withActiveAccount` and in this
// order, and nothing changes before all of them pass:
//
//   1. The Account's role is `administrator` (the live authorization's, not the request's). Otherwise the attempt is refused, audited as
//      `usage.denied`, and nothing else is done. The one thing read from the form before this check is the `accountId`, because the refusal is
//      audited against that Account; it is parsed to a UUID or null at once (`accountIdOf`).
//   2. The session's own `administration` marker is valid (`checkMarker`, five minutes). Anything but `allowed` is a refusal; `none` and `expired`
//      offer the step-up. A refusal is audited as `usage.limit_refused`. Nothing is appended.
//   3. `setUsageLimit`, with the actor `user:<Auth user ID>` and the Administrator's Account and epoch taken from the verified access, never from
//      the request. The command ID, the period the person saw and the typed limit are read from the form only now.
//
// The limit is typed in dollars and parsed here (`parseDollars`, whole cents, $0 to $10,000) into integer microdollars; a limit that is not one is
// a message for the field, and nothing is sent. The database judges it again. A reset takes no limit, and any `limit` field sent with it is ignored.
//
// Nothing here shows or logs an amount, an address or the request: this file prints only the name and message of an error, and a refusal is
// recorded with the actor, the action and the Account alone, never a limit or a reason.

const describe = (error: unknown) => (error instanceof Error ? `${error.name}: ${error.message}` : 'unknown failure');

/** How long recording a refusal may take once the change has been refused. Its own allowance: a slow check must not cost the audit. */
const refusalRecordMs = 3000;

const nothingHappened: UsageActionState = {outcome: 'unavailable', unknown: false};

async function recordRefusal(userId: string, action: UsageRefusalAction, accountId: string | null) {
  try {
    await withDeadline(recordUsageRefusal({userId, action, accountId}, {timeoutMs: refusalRecordMs}), refusalRecordMs);
  } catch (error) {
    console.error('A refused usage change could not be recorded in the audit trail.', describe(error));
  }
}

/**
 * Whether the change certainly did not happen. A request the database never received (the key is not configured), or one it understood and
 * rejected (a 4xx), changed nothing. Anything else may have reached it: a dropped connection, a timeout, a server error, an answer that makes no
 * sense. For those the person is told to check the list first (and sending the same command again would be safe).
 */
function failed(error: unknown): UsageActionState {
  console.error('The usage limit change failed.', describe(error));
  const certain = error instanceof AccountsConfigError || (error instanceof AccountsUnavailableError && !error.outcomeUnknown);
  // "Check the list" must point at a list that has been read since: a lost answer may have been a change that was made.
  if (!certain) refresh();
  return {outcome: 'unavailable', unknown: !certain};
}

/** What `administered` answers for each way a change is stopped, and how it records the two refusals. */
function stoppedBy(accountId: string | null): AdministeredSteps<UsageActionState> {
  return {
    unavailable: nothingHappened,
    denied: {outcome: 'denied'},
    refused: (stepUp) => ({outcome: 'refused', stepUp}),
    recordDenied: (userId) => recordRefusal(userId, 'usage.denied', accountId),
    recordRefused: (userId) => recordRefusal(userId, 'usage.limit_refused', accountId),
  };
}

/** The period the person saw, as a positive whole number; anything else is not from this page. */
function seqOf(input: unknown): number | null {
  if (typeof input !== 'string' || !/^[1-9][0-9]{0,8}$/.test(input)) return null;
  return Number(input);
}

/** The command and what it was made against, read from the form once the role and the marker have passed; null when the form is not one this page makes. */
function commandOf(formData: FormData): {commandId: string; expectedSeq: number} | null {
  const commandId = accountIdOf(formData.get('commandId'));
  const expectedSeq = seqOf(formData.get('expectedSeq'));
  return commandId && expectedSeq ? {commandId, expectedSeq} : null;
}

/**
 * One command: `change` (the typed limit) or `reset`. A form that is not this page's (no command ID, no period) is told the page is out of date;
 * a limit that is not a limit is a message for the field.
 */
async function command(kind: UsageCommandKind, formData: FormData, accountId: string | null): Promise<UsageActionState> {
  return administered(stoppedBy(accountId), async ({actor, budget, access}) => {
    const made = commandOf(formData);
    if (!accountId || !made) return {outcome: 'stale'};

    let limit: number | null = null;
    if (kind === 'change') {
      const parsed = parseDollars(formData.get('limit'));
      if (!parsed.ok) return {outcome: 'invalid', problem: parsed.problem};
      limit = parsed.microdollars;
    }

    let receipt: Awaited<ReturnType<typeof setUsageLimit>>;
    try {
      receipt = await withinBudget(budget, (timeoutMs) =>
        setUsageLimit(operationOf(access.account), {actor, targetAccountId: accountId, commandId: made.commandId, kind, limit, expectedSeq: made.expectedSeq}, {timeoutMs}),
      );
    } catch (error) {
      return failed(error);
    }

    // Whatever the answer, the list the page shows may be out of date now (the other window changed it, the month turned, the Account was disabled).
    if (receipt.outcome !== 'reused' && receipt.outcome !== 'invalid_limit' && receipt.outcome !== 'denied') refresh();
    switch (receipt.outcome) {
      case 'changed':
        return {outcome: 'changed', limit: receipt.period.limit};
      case 'reset':
        return {outcome: 'reset'};
      case 'replayed':
        return {outcome: 'replayed'};
      case 'unchanged':
        return {outcome: 'unchanged', limit: receipt.period.limit};
      case 'stale':
        return {outcome: 'stale'};
      case 'reused':
        return {outcome: 'reused'};
      case 'invalid_limit':
        return {outcome: 'invalid_limit'};
      case 'disabled':
        return {outcome: 'disabled'};
      case 'not_found':
        return {outcome: 'not_found'};
      default:
        return {outcome: 'denied'};
    }
  });
}

/** Changes an Account's monthly limit to the typed dollar amount (whole cents, $0 to $10,000). Appends a successor period that carries the liabilities. */
export async function changeUsageLimit(_previous: UsageActionState, formData: FormData): Promise<UsageActionState> {
  return command('change', formData, accountIdOf(formData.get('accountId')));
}

/** Resets the count of an Account's month: settled restarts at zero, what is reserved stays reserved, and the limit stays. */
export async function resetUsageCount(_previous: UsageActionState, formData: FormData): Promise<UsageActionState> {
  return command('reset', formData, accountIdOf(formData.get('accountId')));
}
