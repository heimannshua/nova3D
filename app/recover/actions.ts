'use server';

import {redirect} from 'next/navigation';
import {isOutageError, readUser} from '@/lib/access';
import {clearCsrfCookie} from '@/lib/csrf.server';
import {withinBudget} from '@/lib/deadline';
import {recoveryLinkOrigin, redeemRecoveryLink, requestRecoveryLink, type RecoverySessionClient} from '@/lib/recovery';
import {recoveryLandingUrl, type RecoveryRedeemState, type RecoveryRequestState} from '@/lib/recovery-state';
import {requestOrigin} from '@/lib/step-up.server';
import {createDeferredSupabaseServerClient} from '@/lib/supabase/server';
import {signOutQuietly} from '@/lib/supabase/sign-out';

// The two public Server Actions of Administrator recovery (Story 1.6). Neither needs a session: the Administrator who
// needs them cannot sign in. Neither takes an address, an Account, a recipient or a link origin from the request: the
// address is ADMINISTRATOR_EMAIL, read by lib/accounts.ts and lib/mailer.ts from the server's own environment, and the link
// origin is APP_ORIGIN (locally, the origin the request came in on). A Server Action is a POST, so the proxy's origin check
// and Next's own host check apply to both, as to every other public path.

const describe = (error: unknown) => (error instanceof Error ? `${error.name}: ${error.message}` : 'unknown failure');

/**
 * `/recover`: one button, no input. Issues a single-use token and emails nova3D's own link to the configured Administrator
 * address, and answers only `sent`, `limited` or `unavailable`: never an address, a name or a Workspace.
 */
export async function requestRecovery(_previous: RecoveryRequestState): Promise<RecoveryRequestState> {
  const where = await requestOrigin();
  return requestRecoveryLink({origin: recoveryLinkOrigin(process.env, where?.origin ?? null)});
}

/**
 * `/recover/confirm`: the button that POSTs the link's token. The sequence is lib/recovery.ts `redeemRecoveryLink`: check the
 * token, make the link through Auth's Admin API, `verifyOtp` on a cookie-bound client, then one database transaction. The
 * minted session's cookies are held back until the redemption is known (`createDeferredSupabaseServerClient`):
 *
 *  - redeemed: the cookies are written, the CSRF cookie of the old session is cleared, and the person goes to Administration.
 *  - unknown (the database did not answer after the transaction was handed to it, so it may have committed): the cookies are
 *    written too, because that session is the person's way in if it did, and the person is told to open Administration.
 *  - anything else: nothing is written, so a browser with two windows open keeps exactly the cookies it sent, and the
 *    session that was minted has already been ended at Auth.
 */
export async function redeemRecovery(_previous: RecoveryRedeemState, formData: FormData): Promise<RecoveryRedeemState> {
  const field = formData.get('token');
  const token = typeof field === 'string' ? field : '';
  const deferred = await createDeferredSupabaseServerClient();
  if (!deferred) return {outcome: 'unavailable'};
  const {client} = deferred;

  const session: RecoverySessionClient = {
    async verify(hashedToken, budget) {
      try {
        const {data, error} = await withinBudget(budget, () => client.auth.verifyOtp({token_hash: hashedToken, type: 'magiclink'}));
        const accessToken = data?.session?.access_token;
        if (error || typeof accessToken !== 'string') return {ok: false, outage: isOutageError(error)};
        return {ok: true, accessToken};
      } catch (error) {
        console.error('The recovery session could not be made (Auth did not answer).', describe(error));
        return {ok: false, outage: true};
      }
    },
    readUser: (accessToken, budget) => readUser(client, {budget, accessToken}),
    // Only this session, at Auth: never a global sign-out, and no cookie of the browser's is touched.
    end: () => signOutQuietly(client, 'local'),
  };

  const result = await redeemRecoveryLink(token, {session});
  if (result.outcome === 'redeemed' || result.outcome === 'unknown') {
    const written = deferred.commit();
    // The browser now holds a different session: the CSRF cookie it may still hold belongs to the old one.
    await clearCsrfCookie();
    if (!written) {
      // The cookie store refused, or there was no cookie to give (no session was minted): either way the browser has no new
      // session, so a redirect to Administration would only find none. The person is told to open it, as for an unknown outcome.
      console.error('The recovery session cookies could not be written.', 'cookie store refused or nothing was held');
      return {outcome: 'unknown'};
    }
    if (result.outcome === 'redeemed') return redirect(recoveryLandingUrl(result.sessionsEnded));
    return {outcome: 'unknown'};
  }
  deferred.discard();
  return {outcome: result.outcome};
}
