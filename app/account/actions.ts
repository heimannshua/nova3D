'use server';

import {redirect} from 'next/navigation';
import {revokeAccountGrants, revokeSessionGrant} from '@/lib/accounts';
import {withActiveAccount, withVerifiedUser} from '@/lib/auth';
import {withinBudget} from '@/lib/deadline';
import {signedOutPath} from '@/lib/sign-in';
import type {SessionActionState} from '@/lib/session-actions';
import {endSession} from '@/lib/supabase/server';
import {signOutQuietly, signOutTimeoutMs} from '@/lib/supabase/sign-out';

const unavailable: SessionActionState = {outcome: 'unavailable'};
// A name and a message, never a request, a token or a cookie.
const describe = (error: unknown) => (error instanceof Error ? `${error.name}: ${error.message}` : 'unknown failure');

/**
 * Signs the person out of this browser (Story 1.4a). The grant is revoked FIRST: until the revocation is
 * recorded the session is not ended, so a sign-out that could not be recorded says so and leaves the person
 * signed in to try again, instead of looking signed out while the old token still works. Then Auth is told to
 * end this session (other sessions stay), the cookies are expired, and the person lands on sign-in, which says
 * they have been signed out. Who is signing out comes from the verified session, never from the form. The
 * whole chain shares one time budget, and a session whose grant has already ended can still be signed out.
 */
export async function signOut(_previous: SessionActionState): Promise<SessionActionState> {
  return withVerifiedUser({unavailable}, async ({user, supabase, budget}) => {
    // Auth has no session for this browser, or does not vouch for the identity: there is no grant to revoke.
    if (user) {
      try {
        await withinBudget(budget, (timeoutMs) =>
          revokeSessionGrant({sessionId: user.sessionId, userId: user.id, actor: `user:${user.id}`, reason: 'sign_out'}, {timeoutMs}),
        );
      } catch (error) {
        console.error('Sign-out could not record the revocation; the session is kept.', describe(error));
        return unavailable;
      }
    }
    // The grant is revoked, so the session is over whatever Auth answers; the cookies are expired either way.
    await endSession(supabase, 'local', {timeoutMs: Math.min(signOutTimeoutMs, budget.remaining())});
    redirect(signedOutPath);
  });
}

/**
 * Signs out every other session of this Account and leaves this one standing ("sign out my other sessions"),
 * and says how many were signed out. Only an active Account with a valid grant may ask; anyone else is sent
 * where any private request would send them. Every other grant is revoked in one statement, which is what
 * ends them; Auth is then told to end the other sessions too, on a deadline, and a failure there is logged but
 * changes nothing, because the grants are already revoked and a session without a grant has no access.
 */
export async function signOutOtherSessions(_previous: SessionActionState): Promise<SessionActionState> {
  return withActiveAccount({unavailable}, async ({access, supabase, budget}) => {
    let signedOut: number;
    try {
      const revoked = await withinBudget(budget, (timeoutMs) =>
        revokeAccountGrants(
          {accountId: access.account.accountId, exceptSessionId: access.user.sessionId, actor: `user:${access.user.id}`, reason: 'sign_out_others'},
          {timeoutMs},
        ),
      );
      signedOut = revoked.live;
    } catch (error) {
      console.error('Sign out of other sessions could not record the revocation.', describe(error));
      return unavailable;
    }
    await signOutQuietly(supabase, 'others', {timeoutMs: Math.min(signOutTimeoutMs, budget.remaining())});
    return {outcome: 'done', count: signedOut};
  });
}
