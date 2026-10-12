import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';

// The Administrator's two Account Server Actions (Story 1.5) with a fake Auth client, a fake accounts database and a fake
// redirect. withActiveAccount, resolveAccess and the shared `administered` wrapper are the real ones, so who may change an
// Account, in what order the role and the marker are checked, what the actions take from the verified session instead of from
// the request, when the cancellers run, and what they print, is what the browser would see. The accounts calls are faked, and
// every one of them is written to one ordered log, so "the role is checked before the marker, the marker before the change, and
// the cancellers after the change" is read off the log.
class Redirected extends Error {
  readonly to: string;
  constructor(to: string) {
    super(`redirect to ${to}`);
    this.to = to;
  }
}
const order = vi.hoisted(() => [] as string[]);
const mocks = vi.hoisted(() => ({
  createSupabaseServerClient: vi.fn(),
  authorizeSession: vi.fn(),
  checkMarker: vi.fn(),
  disableAccount: vi.fn(),
  enableAccount: vi.fn(),
  guardOperation: vi.fn(),
  recordAccountRefusal: vi.fn(),
  refresh: vi.fn(),
}));
vi.mock('next/navigation', () => ({
  redirect: (to: string) => {
    order.push(`redirect:${to}`);
    throw new Redirected(to);
  },
}));
vi.mock('next/cache', () => ({
  refresh: () => {
    order.push('refresh');
    mocks.refresh();
  },
}));
vi.mock('next/headers', () => ({cookies: async () => ({getAll: () => [], get: () => undefined, set: () => undefined, delete: () => undefined})}));
vi.mock('@/lib/supabase/server', async (importOriginal) => ({...(await importOriginal<typeof import('@/lib/supabase/server')>()), createSupabaseServerClient: mocks.createSupabaseServerClient}));
vi.mock('@/lib/accounts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/accounts')>()),
  authorizeSession: mocks.authorizeSession,
  checkMarker: mocks.checkMarker,
  disableAccount: mocks.disableAccount,
  enableAccount: mocks.enableAccount,
  guardOperation: mocks.guardOperation,
  recordAccountRefusal: mocks.recordAccountRefusal,
}));

import {disableMemberAccount, enableMemberAccount} from '@/app/admin/accounts/actions';
import {accountActionIdle} from '@/lib/account-admin';
import {AccountsConfigError, AccountsUnavailableError, type MarkerOutcome} from '@/lib/accounts';
import {authorizeStep, registerCanceller} from '@/lib/authority';
import {sessionReader} from '../support/access-token';

const USER = '5f0d6c1e-8a52-4c1b-9d57-2b6a1f0e7c44';
const OTHER_USER = '1c0d6c1e-8a52-4c1b-9d57-2b6a1f0e7c99';
const SESSION = '3b1c9a3e-6a3e-4f19-9d0e-0a4f5e2c8d11';
const ADMIN_ACCOUNT = '7a1b2c3d-4e5f-4a6b-8c7d-0e1f2a3b4c5d';
const TARGET = '9d8c7b6a-5f4e-4d3c-8b2a-1f0e9d8c7b6a';
const OTHER_TARGET = 'aa8c7b6a-5f4e-4d3c-8b2a-1f0e9d8c7b6b';
const HOSTED = 'https://abcdefgh.supabase.co';
const googleUser = {id: USER, email: 'admin@example.com', email_confirmed_at: '2026-10-10T00:00:00Z', is_anonymous: false, app_metadata: {provider: 'google', providers: ['google']}};
const idle = accountActionIdle;

const form = (fields: Record<string, string>) => {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) data.set(name, value);
  return data;
};
const redirected = async (work: Promise<unknown>) => {
  try {
    await work;
  } catch (error) {
    if (error instanceof Redirected) return error.to;
    throw error;
  }
  return null;
};
const authorizationIs = (state: string, role: 'administrator' | 'member' = 'administrator') =>
  mocks.authorizeSession.mockImplementation(async () => {
    order.push('authorizeSession');
    return state === 'active'
      ? {state, accountId: ADMIN_ACCOUNT, workspaceId: null, role, epoch: 1, preferences: null}
      : {state, accountId: null, workspaceId: null, role: null, epoch: null, preferences: null};
  });
const markerIs = (outcome: MarkerOutcome) =>
  mocks.checkMarker.mockImplementation(async () => {
    order.push('checkMarker');
    return outcome;
  });
const printed = () => [console.log, console.info, console.warn, console.error, console.debug].flatMap((method) => vi.mocked(method).mock.calls.flat().map((value) => (typeof value === 'string' ? value : JSON.stringify(value) ?? String(value))));
/** What happened, without the authorization that every action starts with. */
const steps = () => order.filter((step) => step !== 'authorizeSession');

/** The two actions with a form that is valid for each, so a test can run the same expectations over both. */
const actions = [
  {name: 'disableMemberAccount', run: () => disableMemberAccount(idle, form({accountId: TARGET})), refusal: 'account.disable_refused', call: () => mocks.disableAccount},
  {name: 'enableMemberAccount', run: () => enableMemberAccount(idle, form({accountId: TARGET})), refusal: 'account.enable_refused', call: () => mocks.enableAccount},
] as const;

/** The Account stays disabled after a disable commits; the guard reads this, as the database would. */
let committed = false;

beforeEach(() => {
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', HOSTED);
  order.length = 0;
  committed = false;
  const getUser = vi.fn(async () => ({data: {user: googleUser}, error: null}));
  mocks.createSupabaseServerClient.mockReset().mockImplementation(async () => ({auth: {getUser, signOut: vi.fn(), ...sessionReader(USER, SESSION)}}));
  mocks.authorizeSession.mockReset();
  authorizationIs('active');
  mocks.checkMarker.mockReset();
  markerIs('allowed');
  mocks.disableAccount.mockReset().mockImplementation(async () => {
    order.push('disableAccount');
    committed = true;
    return {outcome: 'disabled', sessionsEnded: 2, grantsRevoked: 3, epoch: 4};
  });
  mocks.enableAccount.mockReset().mockImplementation(async () => {
    order.push('enableAccount');
    return {outcome: 'enabled', epoch: 5};
  });
  mocks.guardOperation.mockReset().mockImplementation(async () => {
    order.push(`guardOperation:${committed ? 'disabled' : 'allowed'}`);
    return committed ? {outcome: 'disabled', epoch: 4} : {outcome: 'allowed', epoch: 3};
  });
  mocks.recordAccountRefusal.mockReset().mockImplementation(async () => {
    order.push('recordAccountRefusal');
    return 'recorded';
  });
  mocks.refresh.mockReset();
  for (const method of ['log', 'info', 'warn', 'error', 'debug'] as const) vi.spyOn(console, method).mockImplementation(() => undefined);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------------------------------
describe.each(actions)('$name: the role, then the marker, then the change', (action) => {
  it('does all three in that order for an Administrator with a marker, and refreshes the page it belongs to', async () => {
    const state = await action.run();
    expect(state.outcome).not.toBe('unavailable');
    expect(steps()).toEqual(['checkMarker', action.name === 'disableMemberAccount' ? 'disableAccount' : 'enableAccount', 'refresh']);
    expect(order[0]).toBe('authorizeSession');
    expect(mocks.recordAccountRefusal).not.toHaveBeenCalled();
  });

  it('asks the marker about the verified session, for administration, and nothing else', async () => {
    await action.run();
    expect(mocks.checkMarker).toHaveBeenCalledTimes(1);
    expect(mocks.checkMarker).toHaveBeenCalledWith({userId: USER, sessionId: SESSION, actionClass: 'administration'}, {timeoutMs: expect.any(Number)});
  });

  it('refuses an Account that is not the Administrator, audits it as denied against the Account it named, and checks no marker and changes nothing', async () => {
    authorizationIs('active', 'member');
    expect(await action.run()).toEqual({outcome: 'denied'});
    expect(steps()).toEqual(['recordAccountRefusal']);
    expect(mocks.checkMarker).not.toHaveBeenCalled();
    expect(mocks.disableAccount).not.toHaveBeenCalled();
    expect(mocks.enableAccount).not.toHaveBeenCalled();
    expect(mocks.recordAccountRefusal).toHaveBeenCalledWith({userId: USER, action: 'account.denied', accountId: TARGET}, {timeoutMs: expect.any(Number)});
    // A denial changes nothing and says nothing about the page: no re-read.
    expect(mocks.refresh).not.toHaveBeenCalled();
  });

  // A marker of another class comes back from the database as `none` for the class that was asked (the integration test proves
  // that with a real marker); here the action's part is that it asks for administration alone and refuses what is not `allowed`.
  it.each([
    ['none (also what a marker of another class comes back as)', 'none', true],
    ['expired', 'expired', true],
    ['used', 'used', false],
    ['stale', 'stale', false],
  ] as const)('refuses a marker that is %s without changing anything, offers the step-up only when %s, and audits the refusal', async (_name, outcome, stepUp) => {
    markerIs(outcome);
    expect(await action.run()).toEqual({outcome: 'refused', stepUp});
    // The page is read again exactly when the step-up is offered (its "you have confirmed it is you" note is out of date).
    expect(steps()).toEqual(['checkMarker', 'recordAccountRefusal', ...(stepUp ? ['refresh'] : [])]);
    expect(mocks.disableAccount).not.toHaveBeenCalled();
    expect(mocks.enableAccount).not.toHaveBeenCalled();
    expect(mocks.recordAccountRefusal).toHaveBeenCalledWith({userId: USER, action: action.refusal, accountId: TARGET}, {timeoutMs: expect.any(Number)});
    expect(mocks.refresh).toHaveBeenCalledTimes(stepUp ? 1 : 0);
  });

  it('sends a session that no longer holds a grant Home, so the gate decides, and records and changes nothing', async () => {
    markerIs('denied');
    expect(await redirected(action.run())).toBe('/');
    expect(mocks.recordAccountRefusal).not.toHaveBeenCalled();
    expect(mocks.disableAccount).not.toHaveBeenCalled();
    expect(mocks.enableAccount).not.toHaveBeenCalled();
  });

  it('still refuses when the refusal cannot be recorded, and says so in the log by name, never with the request', async () => {
    markerIs('none');
    mocks.recordAccountRefusal.mockRejectedValue(new AccountsUnavailableError('The accounts database did not answer.', {retryable: true}));
    expect(await action.run()).toEqual({outcome: 'refused', stepUp: true});
    expect(mocks.disableAccount).not.toHaveBeenCalled();
    expect(mocks.enableAccount).not.toHaveBeenCalled();
    expect(printed().join('\n')).toContain('could not be recorded in the audit trail');
    expect(printed().join('\n')).not.toMatch(new RegExp(`${TARGET}|${USER}|admin@example.com`));
  });

  it('fails closed when the marker cannot be checked: a retryable notice, nothing changed, nothing recorded as a refusal', async () => {
    mocks.checkMarker.mockRejectedValue(new AccountsUnavailableError('The accounts database did not answer.', {retryable: true}));
    expect(await action.run()).toEqual({outcome: 'unavailable', unknown: false});
    expect(mocks.disableAccount).not.toHaveBeenCalled();
    expect(mocks.enableAccount).not.toHaveBeenCalled();
    expect(mocks.recordAccountRefusal).not.toHaveBeenCalled();
    expect(mocks.refresh).not.toHaveBeenCalled();
  });

  it('fails closed when the authorization cannot be made, before anything else is asked', async () => {
    mocks.authorizeSession.mockRejectedValue(new AccountsUnavailableError('The accounts database did not answer.', {retryable: true}));
    expect(await action.run()).toEqual({outcome: 'unavailable', unknown: false});
    expect(mocks.checkMarker).not.toHaveBeenCalled();
    expect(mocks.recordAccountRefusal).not.toHaveBeenCalled();
  });

  it.each(['revoked', 'idle', 'expired', 'stale_epoch', 'no_grant', 'disabled', 'unregistered'])('sends a session whose authorization is %s where any private request goes, and does nothing', async (state) => {
    authorizationIs(state);
    const to = await redirected(action.run());
    expect(to).toMatch(/^\/(login|register)/);
    expect(mocks.checkMarker).not.toHaveBeenCalled();
    expect(mocks.recordAccountRefusal).not.toHaveBeenCalled();
    expect(mocks.disableAccount).not.toHaveBeenCalled();
    expect(mocks.enableAccount).not.toHaveBeenCalled();
  });

  it('takes the actor from the verified session and never from the form', async () => {
    const forged = form({accountId: TARGET, actor: `user:${OTHER_USER}`, userId: OTHER_USER, p_actor: `user:${OTHER_USER}`, role: 'administrator', sessionId: 'x', epoch: '99'});
    const run = {
      disableMemberAccount: () => disableMemberAccount(idle, forged),
      enableMemberAccount: () => enableMemberAccount(idle, forged),
    }[action.name];
    await run();
    const calls = [...mocks.disableAccount.mock.calls, ...mocks.enableAccount.mock.calls];
    expect(calls).toHaveLength(1);
    expect(calls[0][0]).toEqual({accountId: TARGET, actor: `user:${USER}`});
    expect(JSON.stringify(mocks.checkMarker.mock.calls)).not.toContain(OTHER_USER);
    // ... and an Account that the form claims is the Administrator's is still the verified member.
    authorizationIs('active', 'member');
    expect(await run()).toEqual({outcome: 'denied'});
  });

  it('reads the Account\'s ID, parsed to a UUID, and nothing else of the form, and only the ID before the role and the marker are checked', async () => {
    const reads: string[] = [];
    const spy = new FormData();
    spy.set('accountId', TARGET.toUpperCase());
    spy.set('actor', `user:${OTHER_USER}`);
    const original = spy.get.bind(spy);
    spy.get = (name: string) => {
      reads.push(`${name}@${order.length}`);
      return original(name);
    };
    const run = action.name === 'disableMemberAccount' ? disableMemberAccount : enableMemberAccount;
    authorizationIs('active', 'member');
    await run(idle, spy);
    expect(reads).toEqual(['accountId@0']);
    expect(mocks.recordAccountRefusal.mock.calls[0][0]).toEqual({userId: USER, action: 'account.denied', accountId: TARGET});
    authorizationIs('active');
    await run(idle, spy);
    expect(reads.every((read) => read.startsWith('accountId@'))).toBe(true);
    expect(mocks.disableAccount.mock.calls.concat(mocks.enableAccount.mock.calls)[0][0].accountId).toBe(TARGET);
  });

  it.each([['nothing', {}], ['text that is not an ID', {accountId: 'not-an-id'}], ['an injection', {accountId: "x'; drop table identity.accounts"}], ['a blank', {accountId: ' '}]])('says not found for %s, after the checks, without calling the database for it', async (_name, fields) => {
    const state = await (action.name === 'disableMemberAccount' ? disableMemberAccount(idle, form(fields)) : enableMemberAccount(idle, form(fields)));
    expect(state).toEqual({outcome: 'not_found'});
    expect(mocks.disableAccount).not.toHaveBeenCalled();
    expect(mocks.enableAccount).not.toHaveBeenCalled();
    expect(steps()).toEqual(['checkMarker']);
  });

  it('audits a refusal against the Account it named when that was an ID, and against nothing when it was not', async () => {
    markerIs('expired');
    const run = (fields: Record<string, string>) => (action.name === 'disableMemberAccount' ? disableMemberAccount(idle, form(fields)) : enableMemberAccount(idle, form(fields)));
    await run({accountId: OTHER_TARGET});
    await run({accountId: 'not-an-id'});
    expect(mocks.recordAccountRefusal.mock.calls.map((call) => call[0])).toEqual([
      {userId: USER, action: action.refusal, accountId: OTHER_TARGET},
      {userId: USER, action: action.refusal, accountId: null},
    ]);
  });

  it.each([
    ['a dropped connection', new AccountsUnavailableError('The accounts database did not answer.', {retryable: true}), true],
    ['a database error', new AccountsUnavailableError('The accounts database refused the call (HTTP 503).', {status: 503, retryable: true, outcomeUnknown: true}), true],
    ['an answer that makes no sense', new AccountsUnavailableError('The accounts database answered with an unexpected shape.', {retryable: false, outcomeUnknown: true}), true],
    ['the time budget running out', new Error('no answer within 7000 ms'), true],
    ['a request the database rejected', new AccountsUnavailableError('The accounts database refused the call (HTTP 400).', {status: 400, code: '22023', retryable: false, outcomeUnknown: false}), false],
    ['a key that is not configured', new AccountsConfigError('SUPABASE_SERVICE_ROLE_KEY is not set'), false],
  ])('after %s, says whether the change may have been made (unknown: %s), reads the list again only then, and runs no canceller', async (_name, error, unknown) => {
    action.call().mockRejectedValue(error);
    const cancelled = vi.fn(async () => 1);
    const remove = registerCanceller({name: 'probe', cancel: cancelled});
    try {
      expect(await action.run()).toEqual({outcome: 'unavailable', unknown});
    } finally {
      remove();
    }
    expect(mocks.refresh).toHaveBeenCalledTimes(unknown ? 1 : 0);
    expect(cancelled).not.toHaveBeenCalled();
    expect(printed().join('\n')).toContain('The Account change failed.');
  });
});

// ---------------------------------------------------------------------------------------------------
describe('disableMemberAccount', () => {
  const removers: (() => void)[] = [];
  afterEach(() => {
    for (const remove of removers.splice(0)) remove();
  });

  it('disables the Account as the verified user, and says how many sessions ended and how many Jobs were cancelled', async () => {
    expect(await disableMemberAccount(idle, form({accountId: TARGET.toUpperCase()}))).toEqual({outcome: 'disabled', sessionsEnded: 2, jobsCancelled: 0, cancellationsFailed: 0});
    expect(mocks.disableAccount).toHaveBeenCalledWith({accountId: TARGET, actor: `user:${USER}`}, {timeoutMs: expect.any(Number)});
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
  });

  it('runs the cancellers only after the disable has committed, so a canceller that asks the guard finds it denying', async () => {
    const seen: unknown[] = [];
    removers.push(
      registerCanceller({
        name: 'research',
        cancel: async (target) => {
          order.push('canceller');
          const decision = await authorizeStep({accountId: target.accountId, epoch: 3}, {log: () => undefined});
          seen.push([target, decision]);
          return 2;
        },
      }),
    );
    removers.push(registerCanceller({name: 'exports', cancel: async () => 3}));
    expect(await disableMemberAccount(idle, form({accountId: TARGET}))).toEqual({outcome: 'disabled', sessionsEnded: 2, jobsCancelled: 5, cancellationsFailed: 0});
    // (The page is flagged for a re-read as soon as the database has answered; the cancellers run after that, and after the commit.)
    expect(steps()).toEqual(['checkMarker', 'disableAccount', 'refresh', 'canceller', 'guardOperation:disabled']);
    // The canceller was told the Account and the epoch the disable raised it to, and the guard denied its (older) operation.
    expect(seen).toEqual([[{accountId: TARGET, epoch: 4}, {allowed: false, reason: 'disabled'}]]);
  });

  it('counts the cancellers that did not finish, and still reports the disable: it is never undone', async () => {
    removers.push(
      registerCanceller({
        name: 'breaks',
        cancel: async () => {
          throw new Error('queue unreachable');
        },
      }),
    );
    removers.push(registerCanceller({name: 'fine', cancel: async () => 1}));
    expect(await disableMemberAccount(idle, form({accountId: TARGET}))).toEqual({outcome: 'disabled', sessionsEnded: 2, jobsCancelled: 1, cancellationsFailed: 1});
    expect(printed().join('\n')).toContain('The canceller breaks did not finish');
    expect(printed().join('\n')).not.toMatch(new RegExp(`${TARGET}|${USER}`));
  });

  it.each([
    ['already_disabled', {outcome: 'already_disabled', sessionsEnded: 0, grantsRevoked: 0, epoch: 4}],
    ['administrator', {outcome: 'administrator', sessionsEnded: 0, grantsRevoked: 0, epoch: 1}],
    ['not_found', {outcome: 'not_found', sessionsEnded: 0, grantsRevoked: 0, epoch: null}],
  ] as const)('passes %s through, refreshes the page, and cancels nothing', async (outcome, receipt) => {
    const cancelled = vi.fn(async () => 1);
    removers.push(registerCanceller({name: 'probe', cancel: cancelled}));
    mocks.disableAccount.mockResolvedValue(receipt);
    expect(await disableMemberAccount(idle, form({accountId: TARGET}))).toEqual({outcome});
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
    expect(cancelled).not.toHaveBeenCalled();
  });

  it('is told it is already disabled when another window got there first, and the answer carries nothing about the Account', async () => {
    mocks.disableAccount.mockResolvedValue({outcome: 'already_disabled', sessionsEnded: 0, grantsRevoked: 0, epoch: 4});
    const state = await disableMemberAccount(idle, form({accountId: TARGET}));
    expect(JSON.stringify(state)).not.toContain(TARGET);
  });
});

// ---------------------------------------------------------------------------------------------------
describe('enableMemberAccount', () => {
  it('enables the Account as the verified user and refreshes the page; the sessions that ended stay ended', async () => {
    expect(await enableMemberAccount(idle, form({accountId: TARGET}))).toEqual({outcome: 'enabled'});
    expect(mocks.enableAccount).toHaveBeenCalledWith({accountId: TARGET, actor: `user:${USER}`}, {timeoutMs: expect.any(Number)});
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
    // It revokes nothing and restores nothing: the one call is the enable.
    expect(steps()).toEqual(['checkMarker', 'enableAccount', 'refresh']);
  });

  it.each([
    ['already_enabled', {outcome: 'already_enabled', epoch: 5}],
    ['not_found', {outcome: 'not_found', epoch: null}],
  ] as const)('passes %s through and refreshes the page', async (outcome, receipt) => {
    mocks.enableAccount.mockResolvedValue(receipt);
    expect(await enableMemberAccount(idle, form({accountId: TARGET}))).toEqual({outcome});
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
  });

  it('runs no canceller and asks no guard: re-enabling gives the person a new sign-in, never an old operation a new life', async () => {
    const cancelled = vi.fn(async () => 1);
    const remove = registerCanceller({name: 'probe', cancel: cancelled});
    try {
      await enableMemberAccount(idle, form({accountId: TARGET}));
    } finally {
      remove();
    }
    expect(cancelled).not.toHaveBeenCalled();
    expect(mocks.guardOperation).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------------------------------
describe('privacy', () => {
  it('prints nothing about an Account, whatever happens: no ID, no address, and no actor', async () => {
    mocks.disableAccount.mockRejectedValueOnce(new AccountsUnavailableError('The accounts database did not answer.', {retryable: true}));
    await disableMemberAccount(idle, form({accountId: TARGET}));
    await disableMemberAccount(idle, form({accountId: TARGET}));
    await enableMemberAccount(idle, form({accountId: TARGET}));
    markerIs('none');
    await disableMemberAccount(idle, form({accountId: TARGET}));
    mocks.recordAccountRefusal.mockRejectedValue(new Error('down'));
    await enableMemberAccount(idle, form({accountId: TARGET}));
    markerIs('allowed');
    authorizationIs('active', 'member');
    await disableMemberAccount(idle, form({accountId: TARGET}));
    const text = printed().join('\n');
    for (const secret of [TARGET, USER, 'admin@example.com']) expect(text).not.toContain(secret);
    // The log did say something: a failure is never silent.
    expect(text).toContain('The Account change failed.');
  });

  it('records a refusal with the actor, the action and the Account alone: no reason, no marker outcome, no address', async () => {
    markerIs('expired');
    await disableMemberAccount(idle, form({accountId: TARGET}));
    authorizationIs('active', 'member');
    await enableMemberAccount(idle, form({accountId: TARGET}));
    for (const call of mocks.recordAccountRefusal.mock.calls) expect(Object.keys(call[0]).sort()).toEqual(['accountId', 'action', 'userId']);
    expect(JSON.stringify(mocks.recordAccountRefusal.mock.calls)).not.toMatch(/expired|none|reason|admin@example.com/);
  });
});
