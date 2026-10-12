'use server';

import {refresh} from 'next/cache';
import {redirect} from 'next/navigation';
import {homePath} from '@/lib/access';
import {
  AccountsConfigError,
  AccountsUnavailableError,
  checkMarker,
  issueInvitation,
  recordInvitationRefusal,
  revokeInvitation,
  type InvitationRefusalAction,
  type MarkerOutcome,
} from '@/lib/accounts';
import {withActiveAccount} from '@/lib/auth';
import {withDeadline, withinBudget, type Budget} from '@/lib/deadline';
import {invitationIdOf, labelProblem, normalizeLabel, type InvitationActionState} from '@/lib/invitations';

// The Administrator's three changes to the invitation codes (Story 1.11): issue a named code, make or replace the
// general code, and revoke an unused code. Each is a Server Action behind `withActiveAccount`, which asks for the
// live authorization itself, every time, so none of them trusts the page that rendered the button. In this order,
// and nothing changes before all of them pass:
//
//   1. The Account's role is `administrator` (the live authorization's, not the request's). Otherwise the attempt
//      is refused, audited as `invitation.denied`, and nothing else is done. What is read from the form before this
//      check is one thing: a revoke reads its `invitationId`, because the refusal is audited against that invitation,
//      and parses it to a UUID or null at once (`invitationIdOf`). The name of a named code and the `replace` flag of
//      the general code are read only after the role and the marker have passed.
//   2. The session's own `administration` marker is valid (`checkMarker`, five minutes, reusable). Anything but
//      `allowed` is a refusal; `none` and `expired` offer the step-up. A refusal is audited as
//      `invitation.issue_refused` or `invitation.revoke_refused`. The marker is checked here and not inside the
//      issuance function because the audited seed command shares that function and has no session.
//   3. `issueInvitation` or `revokeInvitation`, with the actor `user:<Auth user ID>` taken from the verified
//      session, never from the request. They are the very functions the seed command calls, and they audit the
//      change (`invitation.issued`, `invitation.revoked`).
//
// The code of an issued invitation is returned to the browser in the one response that carries it. It is not
// logged, not audited, not put in a URL or a cookie, not cached and not listed again: this file prints only the
// name and message of an error (which never contain a code), and a refusal is recorded with the actor and the
// invitation ID alone, never a label, a code or a reason. A failure to record a refusal is logged and never turns
// the refusal into a permission.

const describe = (error: unknown) => (error instanceof Error ? `${error.name}: ${error.message}` : 'unknown failure');

/** How long recording a refusal may take once the change has been refused. Its own allowance: a slow check must not cost the audit. */
const refusalRecordMs = 3000;

const nothingHappened: InvitationActionState = {outcome: 'unavailable', unknown: false};

async function recordRefusal(userId: string, action: InvitationRefusalAction, invitationId: string | null) {
  try {
    await withDeadline(recordInvitationRefusal({userId, action, invitationId}, {timeoutMs: refusalRecordMs}), refusalRecordMs);
  } catch (error) {
    console.error('A refused invitation change could not be recorded in the audit trail.', describe(error));
  }
}

/**
 * Whether the change certainly did not happen. A request the database never received (the key is not configured), or
 * one it understood and rejected (a 4xx), changed nothing. Anything else may have reached it: a dropped connection, a
 * timeout, a server error, an answer that makes no sense. For those the person is told to check the list first.
 */
function failed(error: unknown): InvitationActionState {
  console.error('The invitation change failed.', describe(error));
  const certain = error instanceof AccountsConfigError || (error instanceof AccountsUnavailableError && !error.outcomeUnknown);
  // "Check the list below" must point at a list that has been read since: a lost answer may have been a change that was
  // made. A failure that certainly changed nothing leaves the list as it was.
  if (!certain) refresh();
  return {outcome: 'unavailable', unknown: !certain};
}

type Change = {
  /** The refusal to record when the Administrator has no valid marker. */
  refusal: Extract<InvitationRefusalAction, 'invitation.issue_refused' | 'invitation.revoke_refused'>;
  /** For a revoke, the invitation the attempt named (the database records it only if it exists); otherwise null. */
  invitationId: string | null;
};

/** The role check, then the marker check, then `run` (see the top of this file). */
async function administered(
  change: Change,
  run: (context: {actor: string; budget: Budget}) => Promise<InvitationActionState>,
): Promise<InvitationActionState> {
  return withActiveAccount<InvitationActionState>({unavailable: nothingHappened}, async ({access, budget}) => {
    const {user, account} = access;

    if (account.role !== 'administrator') {
      await recordRefusal(user.id, 'invitation.denied', change.invitationId);
      return {outcome: 'denied'};
    }

    let marker: MarkerOutcome;
    try {
      marker = await withinBudget(budget, (timeoutMs) =>
        checkMarker({userId: user.id, sessionId: user.sessionId, actionClass: 'administration'}, {timeoutMs}),
      );
    } catch (error) {
      console.error('The invitation change could not check the fresh sign-in; nothing was changed.', describe(error));
      return nothingHappened;
    }
    // The session no longer holds a valid grant of an active Account (it ended a moment ago): not a reason to try
    // again. Home lets the access gate decide where this person now belongs, as the step-up action does.
    if (marker === 'denied') return redirect(homePath);
    if (marker !== 'allowed') {
      await recordRefusal(user.id, change.refusal, change.invitationId);
      const stepUp = marker === 'none' || marker === 'expired';
      // The page may still say "you have confirmed it is you" (the marker ran out while it was open): read it again, so
      // it shows the step-up beforehand, as it would on a new visit. Only the server's render changes; the codes the page
      // is showing are in the browser's own state and stay.
      if (stepUp) refresh();
      return {outcome: 'refused', stepUp};
    }

    return run({actor: `user:${user.id}`, budget});
  });
}

/** Issues a named, single-use code with a label. The name is for the Administrator only; it is not bound to an address. */
export async function issueNamedInvitation(_previous: InvitationActionState, formData: FormData): Promise<InvitationActionState> {
  return administered({refusal: 'invitation.issue_refused', invitationId: null}, async ({actor, budget}) => {
    const label = normalizeLabel(formData.get('label'));
    const problem = labelProblem(label);
    if (problem) return {outcome: 'invalid', problem};

    let issued: Awaited<ReturnType<typeof issueInvitation>>;
    try {
      issued = await withinBudget(budget, (timeoutMs) => issueInvitation({kind: 'named', label, actor}, {timeoutMs}));
    } catch (error) {
      return failed(error);
    }
    // A named code whose hash is already stored: no code was stored, so none is returned. Nothing was made.
    if (issued.outcome !== 'issued') return nothingHappened;
    refresh();
    return {outcome: 'issued', invitationId: issued.invitationId, kind: 'named', label, code: issued.code, replacedInvitationId: null};
  });
}

/**
 * Makes the general code, or replaces the unused one (`replace` is `true` in the form: the current code is revoked
 * and a new one made in one step). Without `replace`, a general code that already exists is not touched: the
 * answer is `exists`, which is what a second window is told when the first one made it.
 */
export async function mintGeneralInvitation(_previous: InvitationActionState, formData: FormData): Promise<InvitationActionState> {
  return administered({refusal: 'invitation.issue_refused', invitationId: null}, async ({actor, budget}) => {
    const replace = formData.get('replace') === 'true';
    let issued: Awaited<ReturnType<typeof issueInvitation>>;
    try {
      issued = await withinBudget(budget, (timeoutMs) => issueInvitation({kind: 'general', actor, replace}, {timeoutMs}));
    } catch (error) {
      return failed(error);
    }
    // Either way the list the page shows may be out of date now.
    refresh();
    if (issued.outcome !== 'issued') return {outcome: 'exists'};
    return {outcome: 'issued', invitationId: issued.invitationId, kind: 'general', label: null, code: issued.code, replacedInvitationId: issued.replacedInvitationId};
  });
}

/** Revokes an unused code by its invitation ID. A used code stays used; an ID that names nothing is not found. */
export async function revokeInvitationCode(_previous: InvitationActionState, formData: FormData): Promise<InvitationActionState> {
  const invitationId = invitationIdOf(formData.get('invitationId'));
  return administered({refusal: 'invitation.revoke_refused', invitationId}, async ({actor, budget}) => {
    if (!invitationId) return {outcome: 'not_found'};
    let receipt: Awaited<ReturnType<typeof revokeInvitation>>;
    try {
      receipt = await withinBudget(budget, (timeoutMs) => revokeInvitation({actor, invitationId}, {timeoutMs}));
    } catch (error) {
      return failed(error);
    }
    refresh();
    return {outcome: receipt.outcome};
  });
}
