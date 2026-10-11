'use server';

import {cookies, headers} from 'next/headers';
import {adoptPreferences, setAccountPreference} from '@/lib/accounts';
import {withActiveAccount} from '@/lib/auth';
import {withinBudget} from '@/lib/deadline';
import type {PreferenceSaveState} from '@/lib/preference-actions';
import {cookieMaxAgeSeconds, parsePreferenceChange, preferenceCookieNames, recordFromCookies, type PreferenceChange} from '@/lib/preferences';
import {isSecureRequest} from '@/lib/request-integrity';

const unavailable: PreferenceSaveState = {outcome: 'unavailable'};
// A name and a message, never a request, a token or a cookie.
const describe = (error: unknown) => (error instanceof Error ? `${error.name}: ${error.message}` : 'unknown failure');

/**
 * The cookie copy of a saved change: the same cookie the device wrote before the Account held the record, so pages
 * with no Account (the sign-in page, the design kit) follow the person too. A null language (match my device)
 * removes the cookie. It never throws and is written only after the record is: a change that could not be saved
 * leaves the cookie as it was. A browser that refuses the cookie costs nothing, because the record wins.
 */
async function writeCookieCopy(change: PreferenceChange) {
  const name = preferenceCookieNames[change.name];
  try {
    const store = await cookies();
    if (change.value === null) {
      store.delete(name);
      return;
    }
    // A Server Action POST always carries its Origin (the proxy refuses one without), and the first
    // x-forwarded-proto is what a platform in front of the application says about the browser's connection.
    const requestHeaders = await headers();
    let protocol = 'http:';
    try {
      const origin = requestHeaders.get('origin');
      if (origin) protocol = new URL(origin).protocol;
    } catch {
      // An Origin that is not a URL says nothing about https; the cookie is simply not marked Secure.
    }
    store.set(name, change.value, {path: '/', maxAge: cookieMaxAgeSeconds, sameSite: 'lax', secure: isSecureRequest(requestHeaders.get('x-forwarded-proto'), protocol)});
  } catch (error) {
    console.error('The preference cookie copy could not be written.', error instanceof Error ? error.name : 'unknown failure');
  }
}

/**
 * Saves one preference to the Account's record (Story 1.4d): language (or null, "match my device"), light or dark,
 * explanation detail, first-use guidance. The Account is the one `withActiveAccount` verifies for this very request
 * (a live active Account with a valid grant), never an argument: the action takes a NAME and a VALUE and nothing
 * else, and both are checked against the allowed sets before anything is asked of the database, which checks them
 * again. In this order, and nothing is stored unless the record is:
 *
 *   1. An Account that has no record yet (its first navigation could not adopt the device's cookies) adopts them
 *      first, so changing one setting does not drop the other three.
 *   2. The record is saved (api.set_preference).
 *   3. Only then the cookie copy is written, so a change that could not be saved leaves the device as it was.
 *
 * Answers `saved`, or `unavailable` for anything that kept the record from holding the choice (an invalid choice,
 * the database not answering, an Account that stopped being active a moment ago). The client undoes its optimistic
 * change on `unavailable` and says so. A request from a session that is not let in is sent where any private
 * request is sent (the redirect is the answer, as for the sign-out actions).
 */
export async function savePreference(name: string, value: string | null): Promise<PreferenceSaveState> {
  const change = parsePreferenceChange(name, value);
  if (!change) return unavailable;
  return withActiveAccount({unavailable}, async ({access, budget}) => {
    const {accountId, preferences} = access.account;
    try {
      if (preferences === null) {
        const store = await cookies();
        const device = recordFromCookies((cookieName) => store.get(cookieName)?.value);
        await withinBudget(budget, (timeoutMs) => adoptPreferences({accountId, ...device}, {timeoutMs}));
      }
      const outcome = await withinBudget(budget, (timeoutMs) => setAccountPreference({accountId, name: change.name, value: change.value}, {timeoutMs}));
      if (outcome !== 'saved') {
        console.error('A preference could not be saved; the choice is undone.', `outcome ${outcome}`);
        return unavailable;
      }
    } catch (error) {
      console.error('A preference could not be saved; the choice is undone.', describe(error));
      return unavailable;
    }
    await writeCookieCopy(change);
    return {outcome: 'saved'};
  });
}
