import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';

// The Administrator's three invitation Server Actions (Story 1.11) with a fake Auth client, a fake accounts database
// and a fake redirect. withActiveAccount and resolveAccess are the real ones, so who may change a code, in what
// order the role and the marker are checked, what the actions take from the verified session instead of from the
// request, and what they print, is what the browser would see. The accounts calls are faked, and every one of them
// is written to one ordered log, so "the role is checked before the marker, and the marker before the change" is
// read off the log.
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
  issueInvitation: vi.fn(),
  revokeInvitation: vi.fn(),
  recordInvitationRefusal: vi.fn(),
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
  issueInvitation: mocks.issueInvitation,
  revokeInvitation: mocks.revokeInvitation,
  recordInvitationRefusal: mocks.recordInvitationRefusal,
}));

import {issueNamedInvitation, mintGeneralInvitation, revokeInvitationCode} from '@/app/admin/invitations/actions';
import {AccountsConfigError, AccountsUnavailableError, type MarkerOutcome} from '@/lib/accounts';
import {invitationActionIdle} from '@/lib/invitations';
import {sessionReader} from '../support/access-token';

const USER = '5f0d6c1e-8a52-4c1b-9d57-2b6a1f0e7c44';
const OTHER_USER = '1c0d6c1e-8a52-4c1b-9d57-2b6a1f0e7c99';
const SESSION = '3b1c9a3e-6a3e-4f19-9d0e-0a4f5e2c8d11';
const ACCOUNT = '7a1b2c3d-4e5f-4a6b-8c7d-0e1f2a3b4c5d';
const INVITATION = '9d8c7b6a-5f4e-4d3c-8b2a-1f0e9d8c7b6a';
const OTHER_INVITATION = 'aa8c7b6a-5f4e-4d3c-8b2a-1f0e9d8c7b6b';
const CODE = 'H7K2-9QXM-D3FZ-W8TV-0N4B-RJ6Y-CP5E-GA1S';
const HOSTED = 'https://abcdefgh.supabase.co';
const googleUser = {id: USER, email: 'admin@example.com', email_confirmed_at: '2026-10-10T00:00:00Z', is_anonymous: false, app_metadata: {provider: 'google', providers: ['google']}};
const idle = invitationActionIdle;

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
    return state === 'active' ? {state, accountId: ACCOUNT, workspaceId: null, role, epoch: 1, preferences: null} : {state, accountId: null, workspaceId: null, role: null, epoch: null, preferences: null};
  });
const markerIs = (outcome: MarkerOutcome) =>
  mocks.checkMarker.mockImplementation(async () => {
    order.push('checkMarker');
    return outcome;
  });
const printed = () => [console.log, console.info, console.warn, console.error, console.debug].flatMap((method) => vi.mocked(method).mock.calls.flat().map((value) => (typeof value === 'string' ? value : JSON.stringify(value) ?? String(value))));

/** The three actions with a form that is valid for each, so a test can run the same expectations over all of them. */
const actions = [
  {name: 'issueNamedInvitation', run: () => issueNamedInvitation(idle, form({label: 'Daniel'})), refusal: 'invitation.issue_refused', invitationId: null, call: () => mocks.issueInvitation},
  {name: 'mintGeneralInvitation', run: () => mintGeneralInvitation(idle, form({replace: 'false'})), refusal: 'invitation.issue_refused', invitationId: null, call: () => mocks.issueInvitation},
  {name: 'revokeInvitationCode', run: () => revokeInvitationCode(idle, form({invitationId: INVITATION})), refusal: 'invitation.revoke_refused', invitationId: INVITATION, call: () => mocks.revokeInvitation},
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
  mocks.issueInvitation.mockReset().mockImplementation(async (input: {kind: string}) => {
    order.push('issueInvitation');
    return {outcome: 'issued', code: CODE, invitationId: INVITATION, kind: input.kind, replacedInvitationId: null};
  });
  mocks.revokeInvitation.mockReset().mockImplementation(async () => {
    order.push('revokeInvitation');
    return {invitationId: INVITATION, outcome: 'revoked'};
  });
  mocks.recordInvitationRefusal.mockReset().mockImplementation(async () => {
    order.push('recordInvitationRefusal');
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
    expect(order.filter((step) => step !== 'authorizeSession')).toEqual(['checkMarker', action.name === 'revokeInvitationCode' ? 'revokeInvitation' : 'issueInvitation', 'refresh']);
    expect(order[0]).toBe('authorizeSession');
    expect(mocks.recordInvitationRefusal).not.toHaveBeenCalled();
  });

  it('asks the marker about the verified session, for administration, and nothing else', async () => {
    await action.run();
    expect(mocks.checkMarker).toHaveBeenCalledTimes(1);
    expect(mocks.checkMarker).toHaveBeenCalledWith({userId: USER, sessionId: SESSION, actionClass: 'administration'}, {timeoutMs: expect.any(Number)});
  });

  it('refuses an Account that is not the Administrator, audits it as denied, and checks no marker and changes nothing', async () => {
    authorizationIs('active', 'member');
    expect(await action.run()).toEqual({outcome: 'denied'});
    expect(order.filter((step) => step !== 'authorizeSession')).toEqual(['recordInvitationRefusal']);
    expect(mocks.checkMarker).not.toHaveBeenCalled();
    expect(mocks.issueInvitation).not.toHaveBeenCalled();
    expect(mocks.revokeInvitation).not.toHaveBeenCalled();
    expect(mocks.recordInvitationRefusal).toHaveBeenCalledWith({userId: USER, action: 'invitation.denied', invitationId: action.invitationId}, {timeoutMs: expect.any(Number)});
    // A denial changes nothing and says nothing about the page: no re-read.
    expect(mocks.refresh).not.toHaveBeenCalled();
  });

  it.each([
    ['none', true],
    ['expired', true],
    ['used', false],
    ['stale', false],
  ] as const)('refuses a marker that is %s without changing anything, offers the step-up only when %s, and audits the refusal', async (outcome, stepUp) => {
    markerIs(outcome);
    expect(await action.run()).toEqual({outcome: 'refused', stepUp});
    // The page is read again exactly when the step-up is offered (its "you have confirmed it is you" note is out of date).
    expect(order.filter((step) => step !== 'authorizeSession')).toEqual(['checkMarker', 'recordInvitationRefusal', ...(stepUp ? ['refresh'] : [])]);
    expect(mocks.issueInvitation).not.toHaveBeenCalled();
    expect(mocks.revokeInvitation).not.toHaveBeenCalled();
    expect(mocks.recordInvitationRefusal).toHaveBeenCalledWith({userId: USER, action: action.refusal, invitationId: action.invitationId}, {timeoutMs: expect.any(Number)});
    expect(mocks.refresh).toHaveBeenCalledTimes(stepUp ? 1 : 0);
  });

  it('sends a session that no longer holds a grant Home, so the gate decides, and records and changes nothing', async () => {
    markerIs('denied');
    expect(await redirected(action.run())).toBe('/');
    expect(mocks.recordInvitationRefusal).not.toHaveBeenCalled();
    expect(mocks.issueInvitation).not.toHaveBeenCalled();
    expect(mocks.revokeInvitation).not.toHaveBeenCalled();
  });

  it('still refuses when the refusal cannot be recorded, and says so in the log by name, never with the request', async () => {
    markerIs('none');
    mocks.recordInvitationRefusal.mockRejectedValue(new AccountsUnavailableError('The accounts database did not answer.', {retryable: true}));
    expect(await action.run()).toEqual({outcome: 'refused', stepUp: true});
    expect(mocks.issueInvitation).not.toHaveBeenCalled();
    expect(mocks.revokeInvitation).not.toHaveBeenCalled();
    expect(printed().join('\n')).toContain('could not be recorded in the audit trail');
    expect(printed().join('\n')).not.toMatch(/Daniel|H7K2|invitationId/);
  });

  it('fails closed when the marker cannot be checked: a retryable notice, nothing changed, nothing recorded as a refusal', async () => {
    mocks.checkMarker.mockRejectedValue(new AccountsUnavailableError('The accounts database did not answer.', {retryable: true}));
    expect(await action.run()).toEqual({outcome: 'unavailable', unknown: false});
    expect(mocks.issueInvitation).not.toHaveBeenCalled();
    expect(mocks.revokeInvitation).not.toHaveBeenCalled();
    expect(mocks.recordInvitationRefusal).not.toHaveBeenCalled();
    expect(mocks.refresh).not.toHaveBeenCalled();
  });

  it('fails closed when the authorization cannot be made, before anything else is asked', async () => {
    mocks.authorizeSession.mockRejectedValue(new AccountsUnavailableError('The accounts database did not answer.', {retryable: true}));
    expect(await action.run()).toEqual({outcome: 'unavailable', unknown: false});
    expect(mocks.checkMarker).not.toHaveBeenCalled();
    expect(mocks.recordInvitationRefusal).not.toHaveBeenCalled();
  });

  it.each(['revoked', 'idle', 'expired', 'stale_epoch', 'no_grant', 'disabled', 'unregistered'])('sends a session whose authorization is %s where any private request goes, and does nothing', async (state) => {
    authorizationIs(state);
    const to = await redirected(action.run());
    expect(to).toMatch(/^\/(login|register)/);
    expect(mocks.checkMarker).not.toHaveBeenCalled();
    expect(mocks.recordInvitationRefusal).not.toHaveBeenCalled();
    expect(mocks.issueInvitation).not.toHaveBeenCalled();
    expect(mocks.revokeInvitation).not.toHaveBeenCalled();
  });

  it('takes the actor from the verified session and never from the form', async () => {
    const forged = form({label: 'Daniel', replace: 'false', invitationId: INVITATION, actor: `user:${OTHER_USER}`, userId: OTHER_USER, p_actor: `user:${OTHER_USER}`, role: 'administrator', sessionId: 'x'});
    const run = {
      issueNamedInvitation: () => issueNamedInvitation(idle, forged),
      mintGeneralInvitation: () => mintGeneralInvitation(idle, forged),
      revokeInvitationCode: () => revokeInvitationCode(idle, forged),
    }[action.name];
    await run();
    const calls = [...mocks.issueInvitation.mock.calls, ...mocks.revokeInvitation.mock.calls];
    expect(calls).toHaveLength(1);
    expect(calls[0][0].actor).toBe(`user:${USER}`);
    expect(JSON.stringify(mocks.checkMarker.mock.calls)).not.toContain(OTHER_USER);
    // ... and an Account that the form claims is the Administrator's is still the verified member.
    authorizationIs('active', 'member');
    expect(await run()).toEqual({outcome: 'denied'});
  });
});

// ---------------------------------------------------------------------------------------------------
describe('issueNamedInvitation', () => {
  it('issues a named code under the trimmed name, and returns the code, once, in the answer', async () => {
    const state = await issueNamedInvitation(idle, form({label: '  Daniel  '}));
    expect(mocks.issueInvitation).toHaveBeenCalledWith({kind: 'named', label: 'Daniel', actor: `user:${USER}`}, {timeoutMs: expect.any(Number)});
    expect(state).toEqual({outcome: 'issued', invitationId: INVITATION, kind: 'named', label: 'Daniel', code: CODE, replacedInvitationId: null});
  });

  it.each([
    ['empty', '', 'empty'],
    ['blank', ' \t  ', 'empty'],
    ['over 80 characters', 'x'.repeat(81), 'too_long'],
    ['over 80 characters of two code units each', '😀'.repeat(81), 'too_long'],
  ] as const)('answers a name that is %s in the field, after the marker is good, and issues nothing', async (_name, label, problem) => {
    expect(await issueNamedInvitation(idle, form({label}))).toEqual({outcome: 'invalid', problem});
    expect(mocks.issueInvitation).not.toHaveBeenCalled();
    expect(mocks.refresh).not.toHaveBeenCalled();
  });

  it.each(['\u200b', '\u200b\u200c\u200d\u2060\ufeff', '\u2800', '\u3164', '\u115f\u1160', ' \u00a0\u2028 '])('answers a name that draws nothing (%j) as an empty name, and issues nothing', async (label) => {
    expect(await issueNamedInvitation(idle, form({label}))).toEqual({outcome: 'invalid', problem: 'empty'});
    expect(mocks.issueInvitation).not.toHaveBeenCalled();
  });

  it('sends the normalized name: a NUL or a newline in it becomes one space, so the database is never asked to store a control character', async () => {
    await issueNamedInvitation(idle, form({label: 'Dana\u0000\u0000Cohen\n'}));
    expect(mocks.issueInvitation.mock.calls[0][0]).toEqual({kind: 'named', label: 'Dana Cohen', actor: `user:${USER}`});
    await issueNamedInvitation(idle, form({label: 'דנה\u200f כהן'}));
    expect(mocks.issueInvitation.mock.calls[1][0].label).toBe('דנה\u200f כהן');
    // And the name that comes back to the browser is the one that was stored.
    const state = await issueNamedInvitation(idle, form({label: '\tDana\n'}));
    expect(state).toMatchObject({outcome: 'issued', label: 'Dana'});
  });

  it('takes exactly 80 characters, counted as the database counts them', async () => {
    expect((await issueNamedInvitation(idle, form({label: 'y'.repeat(80)}))).outcome).toBe('issued');
    expect((await issueNamedInvitation(idle, form({label: '😀'.repeat(80)}))).outcome).toBe('issued');
    expect(mocks.issueInvitation).toHaveBeenCalledTimes(2);
  });

  it('treats a missing or non-text label as an empty name', async () => {
    expect(await issueNamedInvitation(idle, new FormData())).toEqual({outcome: 'invalid', problem: 'empty'});
    const file = new FormData();
    file.set('label', new Blob(['x']), 'x.txt');
    expect(await issueNamedInvitation(idle, file)).toEqual({outcome: 'invalid', problem: 'empty'});
  });

  it('does not read the name before the role and the marker have passed', async () => {
    const reads: string[] = [];
    const spy = new FormData();
    spy.set('label', 'Daniel');
    const original = spy.get.bind(spy);
    spy.get = (name: string) => {
      reads.push(name);
      return original(name);
    };
    authorizationIs('active', 'member');
    await issueNamedInvitation(idle, spy);
    authorizationIs('active');
    markerIs('expired');
    await issueNamedInvitation(idle, spy);
    expect(reads).toEqual([]);
    markerIs('allowed');
    await issueNamedInvitation(idle, spy);
    expect(reads).toEqual(['label']);
  });

  it('does not check the name before the role and the marker: a bad name from an Account that may not ask is denied, not corrected', async () => {
    authorizationIs('active', 'member');
    expect(await issueNamedInvitation(idle, form({label: ''}))).toEqual({outcome: 'denied'});
    authorizationIs('active');
    markerIs('none');
    expect(await issueNamedInvitation(idle, form({label: ''}))).toEqual({outcome: 'refused', stepUp: true});
  });

  it('says nothing was made when the code is already stored (a hash that exists), and shows no code', async () => {
    mocks.issueInvitation.mockResolvedValue({outcome: 'exists', invitationId: null, kind: 'named'});
    expect(await issueNamedInvitation(idle, form({label: 'Daniel'}))).toEqual({outcome: 'unavailable', unknown: false});
    expect(mocks.refresh).not.toHaveBeenCalled();
  });

  it.each([
    ['a dropped connection', new AccountsUnavailableError('The accounts database did not answer.', {retryable: true}), true],
    ['a database error', new AccountsUnavailableError('The accounts database refused the call (HTTP 503).', {status: 503, retryable: true, outcomeUnknown: true}), true],
    ['an answer that makes no sense', new AccountsUnavailableError('The accounts database answered with an unexpected shape.', {retryable: false, outcomeUnknown: true}), true],
    ['the time budget running out', new Error('no answer within 7000 ms'), true],
    ['a request the database rejected', new AccountsUnavailableError('The accounts database refused the call (HTTP 400).', {status: 400, code: '22023', retryable: false, outcomeUnknown: false}), false],
    ['a key that is not configured', new AccountsConfigError('INVITATION_HASH_KEY is not set'), false],
  ])('after %s, says whether the change may have been made (unknown: %s), and shows no code', async (_name, error, unknown) => {
    mocks.issueInvitation.mockRejectedValue(error);
    expect(await issueNamedInvitation(idle, form({label: 'Daniel'}))).toEqual({outcome: 'unavailable', unknown});
    // "Check the list below" points at a list read after the attempt only when the attempt may have changed it.
    expect(mocks.refresh).toHaveBeenCalledTimes(unknown ? 1 : 0);
  });
});

// ---------------------------------------------------------------------------------------------------
describe('mintGeneralInvitation', () => {
  it('makes the general code without replacing anything unless the form says so, exactly', async () => {
    for (const replace of ['false', '', 'TRUE', '1', 'yes']) await mintGeneralInvitation(idle, form({replace}));
    await mintGeneralInvitation(idle, new FormData());
    for (const call of mocks.issueInvitation.mock.calls) expect(call[0]).toEqual({kind: 'general', actor: `user:${USER}`, replace: false});
    expect(mocks.issueInvitation).toHaveBeenCalledTimes(6);
    await mintGeneralInvitation(idle, form({replace: 'true'}));
    expect(mocks.issueInvitation.mock.calls[6][0]).toEqual({kind: 'general', actor: `user:${USER}`, replace: true});
  });

  it('returns the new code once, and says which code it replaced', async () => {
    mocks.issueInvitation.mockResolvedValue({outcome: 'issued', code: CODE, invitationId: INVITATION, kind: 'general', replacedInvitationId: OTHER_INVITATION});
    expect(await mintGeneralInvitation(idle, form({replace: 'true'}))).toEqual({outcome: 'issued', invitationId: INVITATION, kind: 'general', label: null, code: CODE, replacedInvitationId: OTHER_INVITATION});
  });

  it('is told a code exists when another window made it first, returns no code, and refreshes the page so it shows that one', async () => {
    mocks.issueInvitation.mockResolvedValue({outcome: 'exists', invitationId: OTHER_INVITATION, kind: 'general'});
    const state = await mintGeneralInvitation(idle, form({replace: 'false'}));
    expect(state).toEqual({outcome: 'exists'});
    expect(JSON.stringify(state)).not.toContain(OTHER_INVITATION);
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
  });

  it('says whether the change may have been made when the database does not answer', async () => {
    mocks.issueInvitation.mockRejectedValue(new AccountsUnavailableError('The accounts database did not answer.', {retryable: true}));
    expect(await mintGeneralInvitation(idle, form({replace: 'true'}))).toEqual({outcome: 'unavailable', unknown: true});
    // A lost answer to a replace may be a code made and the old one revoked: the list is read again.
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
  });

  it('does not read the replace flag before the role and the marker have passed', async () => {
    const reads: string[] = [];
    const spy = new FormData();
    spy.set('replace', 'true');
    const original = spy.get.bind(spy);
    spy.get = (name: string) => {
      reads.push(`get:${name}:after:${order.join('>')}`);
      return original(name);
    };
    authorizationIs('active', 'member');
    await mintGeneralInvitation(idle, spy);
    markerIs('none');
    authorizationIs('active');
    await mintGeneralInvitation(idle, spy);
    expect(reads).toEqual([]);
    markerIs('allowed');
    await mintGeneralInvitation(idle, spy);
    expect(reads).toHaveLength(1);
    expect(reads[0]).toContain('checkMarker');
  });
});

// ---------------------------------------------------------------------------------------------------
describe('revokeInvitationCode', () => {
  it('revokes by the invitation ID of the form, as the verified user, and refreshes the page', async () => {
    expect(await revokeInvitationCode(idle, form({invitationId: INVITATION.toUpperCase()}))).toEqual({outcome: 'revoked'});
    expect(mocks.revokeInvitation).toHaveBeenCalledWith({actor: `user:${USER}`, invitationId: INVITATION}, {timeoutMs: expect.any(Number)});
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
  });

  it.each(['revoked', 'already_revoked', 'redeemed', 'not_found'] as const)('passes the %s outcome through, and refreshes the page', async (outcome) => {
    mocks.revokeInvitation.mockResolvedValue({invitationId: INVITATION, outcome});
    expect(await revokeInvitationCode(idle, form({invitationId: INVITATION}))).toEqual({outcome});
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
  });

  it.each([['nothing', {}], ['text that is not an ID', {invitationId: 'not-an-id'}], ['an injection', {invitationId: "x'; drop table identity.invitations"}], ['a blank', {invitationId: ' '}]])('says not found for %s, after the checks, without calling the database for it', async (_name, fields) => {
    expect(await revokeInvitationCode(idle, form(fields))).toEqual({outcome: 'not_found'});
    expect(mocks.revokeInvitation).not.toHaveBeenCalled();
    expect(order.filter((step) => step !== 'authorizeSession')).toEqual(['checkMarker']);
  });

  it('reads the invitation ID first (a refusal is audited against it) and nothing else of the form, parsed to a UUID or null', async () => {
    const reads: string[] = [];
    const spy = new FormData();
    spy.set('invitationId', INVITATION);
    spy.set('actor', `user:${OTHER_USER}`);
    const original = spy.get.bind(spy);
    spy.get = (name: string) => {
      reads.push(name);
      return original(name);
    };
    authorizationIs('active', 'member');
    await revokeInvitationCode(idle, spy);
    expect(reads).toEqual(['invitationId']);
    expect(mocks.recordInvitationRefusal.mock.calls[0][0]).toEqual({userId: USER, action: 'invitation.denied', invitationId: INVITATION});
  });

  it('audits a refusal against the invitation it named, when that was an ID, and against nothing when it was not', async () => {
    markerIs('expired');
    await revokeInvitationCode(idle, form({invitationId: OTHER_INVITATION}));
    await revokeInvitationCode(idle, form({invitationId: 'not-an-id'}));
    expect(mocks.recordInvitationRefusal.mock.calls.map((call) => call[0])).toEqual([
      {userId: USER, action: 'invitation.revoke_refused', invitationId: OTHER_INVITATION},
      {userId: USER, action: 'invitation.revoke_refused', invitationId: null},
    ]);
  });

  it.each([
    ['a dropped connection', new AccountsUnavailableError('The accounts database did not answer.', {retryable: true}), true],
    ['a request the database rejected', new AccountsUnavailableError('The accounts database refused the call (HTTP 400).', {status: 400, retryable: false, outcomeUnknown: false}), false],
  ])('after %s, says whether the change may have been made (unknown: %s)', async (_name, error, unknown) => {
    mocks.revokeInvitation.mockRejectedValue(error);
    expect(await revokeInvitationCode(idle, form({invitationId: INVITATION}))).toEqual({outcome: 'unavailable', unknown});
    expect(mocks.refresh).toHaveBeenCalledTimes(unknown ? 1 : 0);
  });
});

// ---------------------------------------------------------------------------------------------------
describe('a code is never anywhere but the one answer', () => {
  it('is in no log, whatever happens, and in no call that is recorded or audited', async () => {
    // Every path: made, replaced, refused, denied, failed, unknown.
    mocks.issueInvitation.mockResolvedValue({outcome: 'issued', code: CODE, invitationId: INVITATION, kind: 'named', replacedInvitationId: OTHER_INVITATION});
    await issueNamedInvitation(idle, form({label: 'Daniel'}));
    await mintGeneralInvitation(idle, form({replace: 'true'}));
    mocks.issueInvitation.mockRejectedValue(new AccountsUnavailableError('The accounts database did not answer.', {retryable: true}));
    await issueNamedInvitation(idle, form({label: 'Daniel'}));
    await mintGeneralInvitation(idle, form({replace: 'false'}));
    mocks.issueInvitation.mockRejectedValue(new Error(`no answer within 7000 ms`));
    await issueNamedInvitation(idle, form({label: 'Daniel'}));
    mocks.revokeInvitation.mockRejectedValue(new AccountsUnavailableError('The accounts database refused the call (HTTP 503).', {status: 503, retryable: true}));
    await revokeInvitationCode(idle, form({invitationId: INVITATION}));
    markerIs('none');
    await issueNamedInvitation(idle, form({label: 'Daniel'}));
    await revokeInvitationCode(idle, form({invitationId: INVITATION}));
    mocks.recordInvitationRefusal.mockRejectedValue(new Error('down'));
    await mintGeneralInvitation(idle, form({replace: 'false'}));
    markerIs('allowed');
    authorizationIs('active', 'member');
    await issueNamedInvitation(idle, form({label: 'Daniel'}));

    const text = printed().join('\n');
    for (const secret of [CODE, CODE.replaceAll('-', ''), 'Daniel']) expect(text).not.toContain(secret);
    expect(JSON.stringify(mocks.recordInvitationRefusal.mock.calls)).not.toMatch(/H7K2|Daniel/);
    expect(JSON.stringify(mocks.checkMarker.mock.calls)).not.toMatch(/H7K2|Daniel/);
    // The log did say something: a failure is never silent.
    expect(text).toContain('The invitation change failed.');
  });

  it('is in the answer to a made code, and in no other answer', async () => {
    const issued = await issueNamedInvitation(idle, form({label: 'Daniel'}));
    expect(JSON.stringify(issued)).toContain(CODE);
    markerIs('none');
    for (const state of [await issueNamedInvitation(idle, form({label: 'Daniel'})), await revokeInvitationCode(idle, form({invitationId: INVITATION}))]) {
      expect(JSON.stringify(state)).not.toContain(CODE);
    }
  });
});
