import {redirect} from 'next/navigation';
import {describe, expect, it, vi} from 'vitest';
import {
  accountActionIdle,
  accountFailureKey,
  accountIdOf,
  accountLabelOf,
  accountMessageKeys,
  accountStatusKeys,
  attemptAccountAction,
  type AccountActionState,
} from '@/lib/account-admin';
import {catalogs, locales} from '@/lib/i18n';
import {unexpectedResponseMessage} from '@/lib/session-actions';

// What the Accounts page and its two Server Actions agree on (lib/account-admin.ts), without a browser or a server.
const ID = '9d8c7b6a-5f4e-4d3c-8b2a-1f0e9d8c7b6a';

describe('accountIdOf', () => {
  it('accepts an Account ID as the database spells one, in either case, with whitespace around it', () => {
    expect(accountIdOf(ID)).toBe(ID);
    expect(accountIdOf(ID.toUpperCase())).toBe(ID);
    expect(accountIdOf(`  ${ID}\n`)).toBe(ID);
  });

  it.each(['', ' ', 'not-an-id', `${ID}x`, `x${ID}`, ID.replaceAll('-', ''), "x'; drop table identity.accounts", `${ID}\u0000`, null, undefined, 7, {}, [ID], new Blob(['x'])])('answers null for %j', (input) => {
    expect(accountIdOf(input)).toBeNull();
  });
});

describe('words for the states', () => {
  it('exist for every status and every answer that is a message, in both languages', () => {
    for (const locale of locales) {
      for (const key of [...Object.values(accountStatusKeys), ...Object.values(accountMessageKeys)]) expect(catalogs[locale][key], `${locale}:${key}`).toBeTruthy();
    }
    expect(Object.keys(accountStatusKeys).sort()).toEqual(['active', 'disabled']);
  });

  it('say Enabled and Disabled', () => {
    expect([accountStatusKeys.active, accountStatusKeys.disabled].map((key) => catalogs.en[key])).toEqual(['Enabled', 'Disabled']);
  });

  it('pick a message for a refusal that offers the step-up, one that does not, and for a failure that may or may not have changed something', () => {
    expect(accountFailureKey({outcome: 'refused', stepUp: true})).toBe('accounts.error.needsConfirm');
    expect(accountFailureKey({outcome: 'refused', stepUp: false})).toBe('accounts.error.refused');
    expect(accountFailureKey({outcome: 'unavailable', unknown: false})).toBe('accounts.error.unavailable');
    expect(accountFailureKey({outcome: 'unavailable', unknown: true})).toBe('accounts.error.unknown');
    // The "may have changed something" message tells the person to look at the list first.
    expect(catalogs.en['accounts.error.unknown']).toMatch(/Check the list/);
  });
});

describe('accountLabelOf', () => {
  it('is the address, or the stand-in when Auth no longer vouches for one', () => {
    expect(accountLabelOf({email: 'dana@example.com'}, 'none')).toBe('dana@example.com');
    expect(accountLabelOf({email: null}, 'none')).toBe('none');
  });
});

describe('attemptAccountAction', () => {
  const data = () => new FormData();

  it('passes the action\'s own answer through', async () => {
    const answer: AccountActionState = {outcome: 'refused', stepUp: true};
    expect(await attemptAccountAction(async () => answer, accountActionIdle, data(), vi.fn())).toBe(answer);
  });

  it('hands the action the previous state and the form', async () => {
    const action = vi.fn(async () => accountActionIdle);
    const form = data();
    await attemptAccountAction(action, {outcome: 'already_disabled'}, form, vi.fn());
    expect(action).toHaveBeenCalledWith({outcome: 'already_disabled'}, form);
  });

  it('rethrows a redirect for Next.js to follow', async () => {
    const navigate = vi.fn();
    let thrown: unknown;
    try {
      redirect('/login');
    } catch (error) {
      thrown = error;
    }
    await expect(attemptAccountAction(async () => { throw thrown; }, accountActionIdle, data(), navigate)).rejects.toBe(thrown);
    expect(navigate).not.toHaveBeenCalled();
  });

  it('reloads the page, once, when the answer is the proxy\'s redirect (the session no longer has access), and keeps the state', async () => {
    const navigate = vi.fn();
    const state = await attemptAccountAction(async () => { throw new Error(unexpectedResponseMessage); }, {outcome: 'already_enabled'}, data(), navigate);
    expect(navigate).toHaveBeenCalledTimes(1);
    expect(state).toEqual({outcome: 'already_enabled'});
  });

  it('says the change may have been made, and reloads nothing, when the connection drops or the server fails', async () => {
    const navigate = vi.fn();
    expect(await attemptAccountAction(async () => { throw new TypeError('Failed to fetch'); }, accountActionIdle, data(), navigate)).toEqual({outcome: 'unavailable', unknown: true});
    expect(await attemptAccountAction(async () => { throw new Error('Internal Server Error'); }, accountActionIdle, data(), navigate)).toEqual({outcome: 'unavailable', unknown: true});
    expect(navigate).not.toHaveBeenCalled();
  });
});
