import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';

// The Administrator's two Usage Server Actions (Story 2.4) with a fake Auth client, a fake accounts database and a fake redirect.
// withActiveAccount, resolveAccess and the shared `administered` wrapper are the real ones, so who may change a limit, in what order the role
// and the marker are checked, what the actions take from the verified session instead of from the request, what is read from the form and
// when, and what they print, is what the browser would see. The Usage and accounts calls are faked, and every one of them is written to one
// ordered log, so "the role is checked before the marker, and the marker before the change" is read off the log.
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
  setUsageLimit: vi.fn(),
  recordUsageRefusal: vi.fn(),
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
}));
vi.mock('@/lib/usage', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/usage')>()),
  setUsageLimit: mocks.setUsageLimit,
  recordUsageRefusal: mocks.recordUsageRefusal,
}));

import {changeUsageLimit, resetUsageCount} from '@/app/admin/usage/actions';
import {AccountsConfigError, AccountsUnavailableError, type MarkerOutcome} from '@/lib/accounts';
import {usageActionIdle} from '@/lib/usage-view';
import {sessionReader} from '../support/access-token';

const USER = '5f0d6c1e-8a52-4c1b-9d57-2b6a1f0e7c44';
const OTHER_USER = '1c0d6c1e-8a52-4c1b-9d57-2b6a1f0e7c99';
const SESSION = '3b1c9a3e-6a3e-4f19-9d0e-0a4f5e2c8d11';
const ADMIN_ACCOUNT = '7a1b2c3d-4e5f-4a6b-8c7d-0e1f2a3b4c5d';
const TARGET = '9d8c7b6a-5f4e-4d3c-8b2a-1f0e9d8c7b6a';
const OTHER_TARGET = 'aa8c7b6a-5f4e-4d3c-8b2a-1f0e9d8c7b6b';
const COMMAND = '11111111-2222-4333-8444-555555555555';
const HOSTED = 'https://abcdefgh.supabase.co';
const EPOCH = 3;
const googleUser = {id: USER, email: 'admin@example.com', email_confirmed_at: '2026-10-10T00:00:00Z', is_anonymous: false, app_metadata: {provider: 'google', providers: ['google']}};
const idle = usageActionIdle;

const form = (fields: Record<string, string>) => {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) data.set(name, value);
  return data;
};
/** A form this page makes: the Account, the command, the period the person saw and (for a change) the typed limit. */
const change = (fields: Record<string, string> = {}) => form({accountId: TARGET, commandId: COMMAND, expectedSeq: '1', limit: '40', ...fields});
const reset = (fields: Record<string, string> = {}) => form({accountId: TARGET, commandId: COMMAND, expectedSeq: '1', ...fields});
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
      ? {state, accountId: ADMIN_ACCOUNT, workspaceId: null, role, epoch: EPOCH, preferences: null}
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
const period = (over: Record<string, unknown> = {}) => ({seq: 2, monthStart: '2026-10-01', limit: 40_000_000, previousLimit: 25_000_000, cause: 'change', ...over});

/** The two actions with a form that is valid for each, so a test can run the same expectations over both. */
const actions = [
  {name: 'changeUsageLimit', run: (fields?: Record<string, string>) => changeUsageLimit(idle, change(fields)), kind: 'change', limit: 40_000_000},
  {name: 'resetUsageCount', run: (fields?: Record<string, string>) => resetUsageCount(idle, reset(fields)), kind: 'reset', limit: null},
] as const;

beforeEach(() => {
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', HOSTED);
  order.length = 0;
  const getUser = vi.fn(async () => ({data: {user: googleUser}, error: null}));
  mocks.createSupabaseServerClient.mockReset().mockImplementation(async () => ({auth: {getUser, signOut: vi.fn(), ...sessionReader(USER, SESSION)}}));
  mocks.authorizeSession.mockReset();
  authorizationIs('active');
  mocks.checkMarker.mockReset();
  markerIs('allowed');
  mocks.setUsageLimit.mockReset().mockImplementation(async (_operation: unknown, input: {kind: string; limit: number | null}) => {
    order.push('setUsageLimit');
    return input.kind === 'reset' ? {outcome: 'reset', period: period({limit: 25_000_000, cause: 'reset'})} : {outcome: 'changed', period: period()};
  });
  mocks.recordUsageRefusal.mockReset().mockImplementation(async () => {
    order.push('recordUsageRefusal');
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
    expect(steps()).toEqual(['checkMarker', 'setUsageLimit', 'refresh']);
    expect(order[0]).toBe('authorizeSession');
    expect(mocks.recordUsageRefusal).not.toHaveBeenCalled();
  });

  it('asks the marker about the verified session, for administration, and nothing else', async () => {
    await action.run();
    expect(mocks.checkMarker).toHaveBeenCalledTimes(1);
    expect(mocks.checkMarker).toHaveBeenCalledWith({userId: USER, sessionId: SESSION, actionClass: 'administration'}, {timeoutMs: expect.any(Number)});
  });

  it('refuses an Account that is not the Administrator, audits it as denied against the Account it named, and checks no marker and changes nothing', async () => {
    authorizationIs('active', 'member');
    expect(await action.run()).toEqual({outcome: 'denied'});
    expect(steps()).toEqual(['recordUsageRefusal']);
    expect(mocks.checkMarker).not.toHaveBeenCalled();
    expect(mocks.setUsageLimit).not.toHaveBeenCalled();
    expect(mocks.recordUsageRefusal).toHaveBeenCalledWith({userId: USER, action: 'usage.denied', accountId: TARGET}, {timeoutMs: expect.any(Number)});
    // A denial changes nothing and says nothing about the page: no re-read.
    expect(mocks.refresh).not.toHaveBeenCalled();
  });

  // A marker of another class comes back from the database as `none` for the class that was asked (the integration test proves that with a real marker);
  // here the action's part is that it asks for administration alone and refuses what is not `allowed`.
  it.each([
    ['none (also what a marker of another class comes back as)', 'none', true],
    ['expired', 'expired', true],
    ['used', 'used', false],
    ['stale', 'stale', false],
  ] as const)('refuses a marker that is %s without changing anything, offers the step-up only when %s, and audits the refusal', async (_name, outcome, stepUp) => {
    markerIs(outcome);
    expect(await action.run()).toEqual({outcome: 'refused', stepUp});
    // The page is read again exactly when the step-up is offered (its "you have confirmed it is you" note is out of date).
    expect(steps()).toEqual(['checkMarker', 'recordUsageRefusal', ...(stepUp ? ['refresh'] : [])]);
    expect(mocks.setUsageLimit).not.toHaveBeenCalled();
    expect(mocks.recordUsageRefusal).toHaveBeenCalledWith({userId: USER, action: 'usage.limit_refused', accountId: TARGET}, {timeoutMs: expect.any(Number)});
    expect(mocks.refresh).toHaveBeenCalledTimes(stepUp ? 1 : 0);
  });

  it('sends a session that no longer holds a grant Home, so the gate decides, and records and changes nothing', async () => {
    markerIs('denied');
    expect(await redirected(action.run())).toBe('/');
    expect(mocks.recordUsageRefusal).not.toHaveBeenCalled();
    expect(mocks.setUsageLimit).not.toHaveBeenCalled();
  });

  it('still refuses when the refusal cannot be recorded, and says so in the log by name, never with the request', async () => {
    markerIs('none');
    mocks.recordUsageRefusal.mockRejectedValue(new AccountsUnavailableError('The accounts database did not answer.', {retryable: true}));
    expect(await action.run()).toEqual({outcome: 'refused', stepUp: true});
    expect(mocks.setUsageLimit).not.toHaveBeenCalled();
    expect(printed().join('\n')).toContain('could not be recorded in the audit trail');
    expect(printed().join('\n')).not.toMatch(new RegExp(`${TARGET}|${USER}|admin@example.com`));
  });

  it('fails closed when the marker cannot be checked: a retryable notice, nothing changed, nothing recorded as a refusal', async () => {
    mocks.checkMarker.mockRejectedValue(new AccountsUnavailableError('The accounts database did not answer.', {retryable: true}));
    expect(await action.run()).toEqual({outcome: 'unavailable', unknown: false});
    expect(mocks.setUsageLimit).not.toHaveBeenCalled();
    expect(mocks.recordUsageRefusal).not.toHaveBeenCalled();
    expect(mocks.refresh).not.toHaveBeenCalled();
  });

  it('fails closed when the authorization cannot be made, before anything else is asked', async () => {
    mocks.authorizeSession.mockRejectedValue(new AccountsUnavailableError('The accounts database did not answer.', {retryable: true}));
    expect(await action.run()).toEqual({outcome: 'unavailable', unknown: false});
    expect(mocks.checkMarker).not.toHaveBeenCalled();
    expect(mocks.recordUsageRefusal).not.toHaveBeenCalled();
  });

  it.each(['revoked', 'idle', 'expired', 'stale_epoch', 'no_grant', 'disabled', 'unregistered'])('sends a session whose authorization is %s where any private request goes, and does nothing', async (state) => {
    authorizationIs(state);
    const to = await redirected(action.run());
    expect(to).toMatch(/^\/(login|register)/);
    expect(mocks.checkMarker).not.toHaveBeenCalled();
    expect(mocks.recordUsageRefusal).not.toHaveBeenCalled();
    expect(mocks.setUsageLimit).not.toHaveBeenCalled();
  });

  it('takes the actor, the Administrator\'s Account and the epoch from the verified session and never from the form', async () => {
    await action.run({actor: `user:${OTHER_USER}`, userId: OTHER_USER, p_actor: `user:${OTHER_USER}`, adminAccountId: OTHER_TARGET, epoch: '99', role: 'administrator', sessionId: 'x'});
    expect(mocks.setUsageLimit).toHaveBeenCalledTimes(1);
    const [operation, input, options] = mocks.setUsageLimit.mock.calls[0];
    expect(operation).toEqual({accountId: ADMIN_ACCOUNT, epoch: EPOCH});
    expect(input).toEqual({actor: `user:${USER}`, targetAccountId: TARGET, commandId: COMMAND, kind: action.kind, limit: action.limit, expectedSeq: 1});
    expect(options).toEqual({timeoutMs: expect.any(Number)});
    expect(JSON.stringify(mocks.checkMarker.mock.calls)).not.toContain(OTHER_USER);
    // ... and an Account that the form claims is the Administrator's is still the verified member.
    authorizationIs('active', 'member');
    expect(await action.run({role: 'administrator'})).toEqual({outcome: 'denied'});
  });

  it('reads only the Account\'s ID, parsed to a UUID, before the role and the marker are checked, and the rest of the form only after both passed', async () => {
    const reads: string[] = [];
    const spy = action.name === 'changeUsageLimit' ? change({accountId: TARGET.toUpperCase()}) : reset({accountId: TARGET.toUpperCase()});
    const original = spy.get.bind(spy);
    spy.get = (name: string) => {
      reads.push(`${name}@${steps().length}`);
      return original(name);
    };
    const run = action.name === 'changeUsageLimit' ? changeUsageLimit : resetUsageCount;
    authorizationIs('active', 'member');
    await run(idle, spy);
    expect(reads).toEqual(['accountId@0']);
    expect(mocks.recordUsageRefusal.mock.calls[0][0]).toEqual({userId: USER, action: 'usage.denied', accountId: TARGET});
    reads.length = 0;
    order.length = 0;
    markerIs('none');
    await run(idle, spy);
    expect(reads).toEqual(['accountId@0']);
    reads.length = 0;
    order.length = 0;
    authorizationIs('active');
    markerIs('allowed');
    await run(idle, spy);
    // After the marker (one step is the marker check itself), the rest is read: the command, the period, and for a change the limit.
    expect(reads[0]).toBe('accountId@0');
    expect(reads.slice(1).every((read) => /@\d+$/.test(read) && Number(read.split('@')[1]) >= 1)).toBe(true);
    expect(reads.slice(1).map((read) => read.split('@')[0])).toEqual(action.name === 'changeUsageLimit' ? ['commandId', 'expectedSeq', 'limit'] : ['commandId', 'expectedSeq']);
    expect(mocks.setUsageLimit.mock.calls[0][1].targetAccountId).toBe(TARGET);
  });

  it.each([
    ['no command ID', {commandId: ''}],
    ['a command ID that is not one', {commandId: 'not-an-id'}],
    ['no period', {expectedSeq: ''}],
    ['a period of 0', {expectedSeq: '0'}],
    ['a period that is not a whole number', {expectedSeq: '1.5'}],
    ['a period with a sign', {expectedSeq: '-1'}],
    ['a period with an exponent', {expectedSeq: '1e3'}],
    ['a period that is far too large', {expectedSeq: '99999999999'}],
    ['text for a period', {expectedSeq: "1'; drop table usage.periods"}],
    ['no Account', {accountId: ''}],
    ['an Account that is not an ID', {accountId: 'not-an-id'}],
  ])('says the page is out of date for %s, after the checks, without calling the database for it', async (_name, fields) => {
    expect(await action.run(fields)).toEqual({outcome: 'stale'});
    expect(mocks.setUsageLimit).not.toHaveBeenCalled();
    expect(steps()).toEqual(['checkMarker']);
  });

  it('audits a refusal against the Account it named when that was an ID, and against nothing when it was not', async () => {
    markerIs('expired');
    await action.run({accountId: OTHER_TARGET});
    await action.run({accountId: 'not-an-id'});
    expect(mocks.recordUsageRefusal.mock.calls.map((call) => call[0])).toEqual([
      {userId: USER, action: 'usage.limit_refused', accountId: OTHER_TARGET},
      {userId: USER, action: 'usage.limit_refused', accountId: null},
    ]);
  });

  it.each([
    ['a dropped connection', new AccountsUnavailableError('The accounts database did not answer.', {retryable: true}), true],
    ['a database error', new AccountsUnavailableError('The accounts database refused the call (HTTP 503).', {status: 503, retryable: true, outcomeUnknown: true}), true],
    ['an answer that makes no sense', new AccountsUnavailableError('The accounts database answered with an unexpected shape.', {retryable: false, outcomeUnknown: true}), true],
    ['the time budget running out', new Error('no answer within 7000 ms'), true],
    ['a request the database rejected', new AccountsUnavailableError('The accounts database refused the call (HTTP 400).', {status: 400, code: '22023', retryable: false, outcomeUnknown: false}), false],
    ['a key that is not configured', new AccountsConfigError('SUPABASE_SERVICE_ROLE_KEY is not set'), false],
  ])('after %s, says whether the change may have been made (unknown: %s), and reads the list again only then', async (_name, error, unknown) => {
    mocks.setUsageLimit.mockRejectedValue(error);
    expect(await action.run()).toEqual({outcome: 'unavailable', unknown});
    expect(mocks.refresh).toHaveBeenCalledTimes(unknown ? 1 : 0);
    expect(printed().join('\n')).toContain('The usage limit change failed.');
  });

  it.each([
    ['replayed', {outcome: 'replayed', period: period()}, {outcome: 'replayed'}, true],
    ['stale', {outcome: 'stale', period: period({seq: 4})}, {outcome: 'stale'}, true],
    ['reused', {outcome: 'reused'}, {outcome: 'reused'}, false],
    ['invalid_limit', {outcome: 'invalid_limit'}, {outcome: 'invalid_limit'}, false],
    ['disabled', {outcome: 'disabled'}, {outcome: 'disabled'}, true],
    ['not_found', {outcome: 'not_found'}, {outcome: 'not_found'}, true],
    ['denied', {outcome: 'denied'}, {outcome: 'denied'}, false],
  ] as const)('passes %s through, and reads the list again when the list may be out of date', async (_name, receipt, expected, refreshes) => {
    mocks.setUsageLimit.mockResolvedValue(receipt);
    expect(await action.run()).toEqual(expected);
    expect(mocks.refresh).toHaveBeenCalledTimes(refreshes ? 1 : 0);
  });
});

// ---------------------------------------------------------------------------------------------------
describe('changeUsageLimit', () => {
  it('parses the typed dollars into integer microdollars, sends them with the period the person saw, and answers the new limit', async () => {
    expect(await changeUsageLimit(idle, change({limit: '40.50', expectedSeq: '7'}))).toEqual({outcome: 'changed', limit: 40_000_000});
    expect(mocks.setUsageLimit.mock.calls[0][1]).toMatchObject({kind: 'change', limit: 40_500_000, expectedSeq: 7});
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['$25', 25_000_000],
    ['0', 0],
    ['10,000.00', 10_000_000_000],
    ['0.01', 10_000],
    [' 12.340 ', 12_340_000],
  ])('accepts %j as %i microdollars', async (typed, microdollars) => {
    await changeUsageLimit(idle, change({limit: typed}));
    expect(mocks.setUsageLimit.mock.calls[0][1].limit).toBe(microdollars);
  });

  it.each([
    ['nothing', {limit: ''}, 'empty'],
    ['no field', {limit: '   '}, 'empty'],
    ['text', {limit: 'forty'}, 'format'],
    ['a negative amount', {limit: '-5'}, 'negative'],
    ['a fraction of a cent', {limit: '12.345'}, 'cents'],
    ['more than the ceiling', {limit: '10000.01'}, 'range'],
    ['far more than the ceiling', {limit: '99999999999'}, 'range'],
  ] as const)('answers a field message for %s, after the checks, and sends nothing', async (_name, fields, problem) => {
    expect(await changeUsageLimit(idle, change(fields))).toEqual({outcome: 'invalid', problem});
    expect(mocks.setUsageLimit).not.toHaveBeenCalled();
    expect(steps()).toEqual(['checkMarker']);
    expect(mocks.refresh).not.toHaveBeenCalled();
  });

  it('answers a field message for a missing limit field, not an exception', async () => {
    const data = form({accountId: TARGET, commandId: COMMAND, expectedSeq: '1'});
    expect(await changeUsageLimit(idle, data)).toEqual({outcome: 'invalid', problem: 'empty'});
  });

  it('checks the role and the marker BEFORE it says a limit is not one: a refused person is told about the sign-in, not the field', async () => {
    markerIs('none');
    expect(await changeUsageLimit(idle, change({limit: 'forty'}))).toEqual({outcome: 'refused', stepUp: true});
    authorizationIs('active', 'member');
    expect(await changeUsageLimit(idle, change({limit: 'forty'}))).toEqual({outcome: 'denied'});
  });

  it('answers the limit the Account already had when the database says unchanged', async () => {
    mocks.setUsageLimit.mockResolvedValue({outcome: 'unchanged', period: period({limit: 25_000_000})});
    expect(await changeUsageLimit(idle, change({limit: '25'}))).toEqual({outcome: 'unchanged', limit: 25_000_000});
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------------------------------
describe('resetUsageCount', () => {
  it('sends a reset with no limit, whatever the form carries, and answers that the count was reset', async () => {
    expect(await resetUsageCount(idle, reset({limit: '1', expectedSeq: '3'}))).toEqual({outcome: 'reset'});
    expect(mocks.setUsageLimit.mock.calls[0][1]).toMatchObject({kind: 'reset', limit: null, expectedSeq: 3});
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
  });

  it('never reads a limit from the form', async () => {
    const reads: string[] = [];
    const spy = reset({limit: '1000'});
    const original = spy.get.bind(spy);
    spy.get = (name: string) => {
      reads.push(name);
      return original(name);
    };
    await resetUsageCount(idle, spy);
    expect(reads).not.toContain('limit');
  });
});

// ---------------------------------------------------------------------------------------------------
describe('privacy', () => {
  it('prints nothing about an Account, whatever happens: no ID, no address, no actor, no amount', async () => {
    mocks.setUsageLimit.mockRejectedValueOnce(new AccountsUnavailableError('The accounts database did not answer.', {retryable: true}));
    await changeUsageLimit(idle, change({limit: '123.45'}));
    await changeUsageLimit(idle, change({limit: '123.45'}));
    await resetUsageCount(idle, reset());
    markerIs('none');
    await changeUsageLimit(idle, change({limit: '123.45'}));
    mocks.recordUsageRefusal.mockRejectedValue(new Error('down'));
    await resetUsageCount(idle, reset());
    markerIs('allowed');
    authorizationIs('active', 'member');
    await changeUsageLimit(idle, change({limit: '123.45'}));
    const text = printed().join('\n');
    for (const secret of [TARGET, USER, ADMIN_ACCOUNT, 'admin@example.com', '123.45', '123450000']) expect(text).not.toContain(secret);
    // The log did say something: a failure is never silent.
    expect(text).toContain('The usage limit change failed.');
  });

  it('records a refusal with the actor, the action and the Account alone: no limit, no reason, no marker outcome, no address', async () => {
    markerIs('expired');
    await changeUsageLimit(idle, change({limit: '123.45'}));
    authorizationIs('active', 'member');
    await resetUsageCount(idle, reset());
    for (const call of mocks.recordUsageRefusal.mock.calls) expect(Object.keys(call[0]).sort()).toEqual(['accountId', 'action', 'userId']);
    expect(JSON.stringify(mocks.recordUsageRefusal.mock.calls)).not.toMatch(/expired|none|reason|123|admin@example.com/);
  });
});
