'use server';

import {headers} from 'next/headers';
import {redirect} from 'next/navigation';
import {AccountsUnavailableError, clientAddressFromHeaders, confirmRegistration, registerWithCode, type RegistrationReceipt} from '@/lib/accounts';
import {issueSessionGrant, resolveAccess} from '@/lib/access';
import {isCommandId, maxCodeLength, newCommandId, type RegisterState} from '@/lib/register';
import {signInErrorPath} from '@/lib/sign-in';
import {createSupabaseServerClient, endSession} from '@/lib/supabase/server';

// A command ID is minted again after any definitive answer. It is kept only when the attempt may or may
// not have reached the database, so the retry is the same command and the database answers it once.
const fresh = (error: RegisterState['error']): RegisterState => ({commandId: newCommandId(), error});
const retry = (commandId: string): RegisterState => ({commandId, error: 'unavailable'});

/**
 * Redeems an invitation code for the signed-in Google identity, and issues the grant of this session once
 * the Account exists. The user and the session are the verified server session and nothing in the form: the
 * form carries a code and a command ID, and a client-supplied user, role, status or session is never read.
 * Every failure is generic and is counted by the database; a code is never logged and never sent back.
 *
 * One more case: the person registered, the Account exists, but this session never got its grant (the answer
 * was lost, or the server stopped between the two steps), and the form is submitted again with the same
 * command. The proxy lets that POST through for a session that has an Account and no grant; here the command
 * is replayed (the database answers it with the Account it created) and the database must confirm that this
 * command and this code created the Account, before the session gets its grant. Any other session of a user
 * that has an Account, with any other code, is turned away as an ended session.
 */
export async function registerWithInvitation(_previous: RegisterState, formData: FormData): Promise<RegisterState> {
  // Bound the input before anything else happens: no Auth call, no database call, nothing for the limiter.
  const code = formData.get('code');
  if (typeof code !== 'string' || code.length > maxCodeLength) return fresh('refused');
  const submitted = formData.get('commandId');
  const commandId = isCommandId(submitted) ? submitted.toLowerCase() : newCommandId();

  const supabase = await createSupabaseServerClient();
  const access = await resolveAccess(supabase);
  if (access.state === 'signed-out') redirect(signInErrorPath('not_signed_in'));
  if (access.state === 'active') redirect('/');
  if (access.state === 'disabled') {
    await endSession(supabase);
    redirect(signInErrorPath('account_disabled'));
  }
  // The Google identity is no longer the one pinned to the Account (its session's grant was just revoked).
  if (access.state === 'refused') {
    await endSession(supabase);
    redirect(signInErrorPath('not_allowed'));
  }
  // An Account whose session has no grant can only be here to repair a retried registration (see above).
  const retried = access.state === 'session-ended' && access.reason === 'no_grant';
  if (access.state === 'session-ended' && !retried) redirect(signInErrorPath('session_ended'));
  // The identity or the Account could not be checked: nothing was attempted, and the same command retries.
  if (access.state === 'unavailable') return retry(commandId);

  let receipt: RegistrationReceipt;
  try {
    receipt = await registerWithCode({
      userId: access.user.id,
      commandId,
      code,
      clientAddress: clientAddressFromHeaders(await headers()),
    });
  } catch (error) {
    console.error('Registration failed closed.', error instanceof Error ? `${error.name}: ${error.message}` : 'unknown failure');
    // The database may have seen the attempt (a timeout, a 5xx): the same command ID retries it safely.
    return error instanceof AccountsUnavailableError && error.outcomeUnknown ? retry(commandId) : fresh('unavailable');
  }

  if (receipt.outcome === 'registered') {
    if (retried) {
      let confirmed = false;
      try {
        confirmed = receipt.replayed && (await confirmRegistration({userId: access.user.id, commandId, code}));
      } catch (error) {
        console.error('Registration could not be confirmed.', error instanceof Error ? `${error.name}: ${error.message}` : 'unknown failure');
        return retry(commandId);
      }
      // Not the command that created this Account: the session has no grant, and this is not how to get one.
      if (!confirmed) redirect(signInErrorPath('session_ended'));
    }
    // The Account is live, so this session gets its grant now. Without one the first private request would
    // be refused as signed out; if it cannot be issued the person is signed out and told to try again (the
    // Account exists, and signing in again issues the grant at the callback).
    const refusal = await issueSessionGrant(access.user);
    if (refusal) {
      await endSession(supabase, refusal.scope);
      redirect(refusal.to);
    }
    redirect('/');
  }
  if (receipt.outcome === 'disabled') {
    await endSession(supabase);
    redirect(signInErrorPath('account_disabled'));
  }
  // An Account exists and this is not its registration: nothing here can help the session.
  if (retried) redirect(signInErrorPath('session_ended'));
  // Refused or limited: the same generic answer, whichever it was.
  return fresh('refused');
}

/** "Use a different Google account": ends this browser's session and returns to sign-in. */
export async function switchGoogleAccount(): Promise<void> {
  await endSession(await createSupabaseServerClient(), 'local');
  redirect('/login');
}
