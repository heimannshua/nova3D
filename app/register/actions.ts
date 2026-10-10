'use server';

import {headers} from 'next/headers';
import {redirect} from 'next/navigation';
import {AccountsUnavailableError, clientAddressFromHeaders, registerWithCode, type RegistrationReceipt} from '@/lib/accounts';
import {resolveAccess} from '@/lib/access';
import {isCommandId, maxCodeLength, newCommandId, type RegisterState} from '@/lib/register';
import {signInErrorPath} from '@/lib/sign-in';
import {createSupabaseServerClient, endSession} from '@/lib/supabase/server';

// A command ID is minted again after any definitive answer. It is kept only when the attempt may or may
// not have reached the database, so the retry is the same command and the database answers it once.
const fresh = (error: RegisterState['error']): RegisterState => ({commandId: newCommandId(), error});
const retry = (commandId: string): RegisterState => ({commandId, error: 'unavailable'});

/**
 * Redeems an invitation code for the signed-in Google identity. The user is the verified server session
 * and nothing in the form: the form carries a code and a command ID, and a client-supplied user, role or
 * status is never read. Every failure is generic and is counted by the database; a code is never logged
 * and never sent back.
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
  // The identity or the Account could not be checked: nothing was attempted, and the same command retries.
  if (access.state !== 'unregistered') return retry(commandId);

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

  if (receipt.outcome === 'registered') redirect('/');
  if (receipt.outcome === 'disabled') {
    await endSession(supabase);
    redirect(signInErrorPath('account_disabled'));
  }
  // Refused or limited: the same generic answer, whichever it was.
  return fresh('refused');
}

/** "Use a different Google account": ends this browser's session and returns to sign-in. */
export async function switchGoogleAccount(): Promise<void> {
  await endSession(await createSupabaseServerClient(), 'local');
  redirect('/login');
}
