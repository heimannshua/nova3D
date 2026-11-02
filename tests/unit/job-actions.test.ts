import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';

// The Cancel Server Action of a Job (Story 2.7) with a fake Auth client, a fake accounts database and a fake redirect. withActiveAccount and resolveAccess are the real ones, so who may
// cancel, what the action takes from the verified session instead of from the form, in what order, and what it prints, is what the browser would see. The command itself is faked and
// written to one ordered log.
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
  cancelJob: vi.fn(),
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
vi.mock('@/lib/accounts', async (importOriginal) => ({...(await importOriginal<typeof import('@/lib/accounts')>()), authorizeSession: mocks.authorizeSession}));
vi.mock('@/lib/job-commands', async (importOriginal) => ({...(await importOriginal<typeof import('@/lib/job-commands')>()), cancelJob: mocks.cancelJob}));

import {cancelJobAction} from '@/app/progress/actions';
import {AccountsConfigError, AccountsUnavailableError} from '@/lib/accounts';
import {jobCancelIdle} from '@/lib/job-view';
import {sessionReader} from '../support/access-token';

const USER = '5f0d6c1e-8a52-4c1b-9d57-2b6a1f0e7c44';
const SESSION = '3b1c9a3e-6a3e-4f19-9d0e-0a4f5e2c8d11';
const ACCOUNT = '7a1b2c3d-4e5f-4a6b-8c7d-0e1f2a3b4c5d';
const OTHER_ACCOUNT = 'aa1b2c3d-4e5f-4a6b-8c7d-0e1f2a3b4caa';
const JOB = '9d8c7b6a-5f4e-4d3c-8b2a-1f0e9d8c7b6a';
const COMMAND = '11111111-2222-4333-8444-555555555555';
const HOSTED = 'https://abcdefgh.supabase.co';
const googleUser = {id: USER, email: 'person@example.com', email_confirmed_at: '2026-10-10T00:00:00Z', is_anonymous: false, app_metadata: {provider: 'google', providers: ['google']}};
const attempt = {id: '6a1b2c3d-4e5f-4a6b-8c7d-0e1f2a3b4c5d', number: 1, state: 'cancelled', stage: 'started', reason: 'user_cancelled'};

const valid = {jobId: JOB, commandId: COMMAND};
const form = (fields: Record<string, string>) => {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) data.set(name, value);
  return data;
};
const run = (fields: Record<string, string> = valid) => cancelJobAction(jobCancelIdle, form(fields));
const redirected = async (work: Promise<unknown>) => {
  try {
    await work;
  } catch (error) {
    if (error instanceof Redirected) return error.to;
    throw error;
  }
  return null;
};
const authorizationIs = (state: string, epoch = 4) =>
  mocks.authorizeSession.mockImplementation(async () => {
    order.push('authorizeSession');
    return state === 'active'
      ? {state, accountId: ACCOUNT, workspaceId: null, role: 'member', epoch, preferences: null}
      : {state, accountId: null, workspaceId: null, role: null, epoch: null, preferences: null};
  });
const printed = () => [console.log, console.info, console.warn, console.error, console.debug].flatMap((method) => vi.mocked(method).mock.calls.flat().map((value) => (typeof value === 'string' ? value : JSON.stringify(value) ?? String(value))));
const steps = () => order.filter((step) => step !== 'authorizeSession');

beforeEach(() => {
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', HOSTED);
  order.length = 0;
  const getUser = vi.fn(async () => ({data: {user: googleUser}, error: null}));
  mocks.createSupabaseServerClient.mockReset().mockImplementation(async () => ({auth: {getUser, signOut: vi.fn(), ...sessionReader(USER, SESSION)}}));
  mocks.authorizeSession.mockReset();
  authorizationIs('active');
  mocks.cancelJob.mockReset().mockImplementation(async () => {
    order.push('cancelJob');
    return {outcome: 'cancelled', jobId: JOB, attempt, released: 1};
  });
  mocks.refresh.mockReset();
  for (const method of ['log', 'info', 'warn', 'error', 'debug'] as const) vi.spyOn(console, method).mockImplementation(() => undefined);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('cancelling a Job', () => {
  it('cancels, after asking who is asking, and refreshes the page so it shows the Job as cancelled', async () => {
    expect(await run()).toEqual({outcome: 'cancelled', replayed: false});
    expect(order).toEqual(['authorizeSession', 'cancelJob', 'refresh']);
  });

  it('takes the Account and the epoch from the verified session, and nothing about either from the form', async () => {
    await run({...valid, accountId: OTHER_ACCOUNT, epoch: '99', account_id: OTHER_ACCOUNT, workspaceId: OTHER_ACCOUNT});
    expect(mocks.cancelJob).toHaveBeenCalledTimes(1);
    const [operation, input] = mocks.cancelJob.mock.calls[0];
    expect(operation).toEqual({accountId: ACCOUNT, epoch: 4});
    expect(input).toEqual({commandId: COMMAND, jobId: JOB});
  });

  it('sends the same command again when the person presses the button again: the command ID is the form\'s, not the action\'s', async () => {
    await run();
    await run();
    expect(mocks.cancelJob.mock.calls.map((call) => call[1].commandId)).toEqual([COMMAND, COMMAND]);
  });

  it('answers a replay as a cancellation that already was, and says so', async () => {
    mocks.cancelJob.mockResolvedValue({outcome: 'replayed', jobId: JOB, attempt});
    expect(await run()).toEqual({outcome: 'cancelled', replayed: true});
  });

  it('reads a UUID in capitals as the same Job and command', async () => {
    await run({jobId: JOB.toUpperCase(), commandId: COMMAND.toUpperCase()});
    expect(mocks.cancelJob.mock.calls[0][1]).toEqual({commandId: COMMAND, jobId: JOB});
  });
});

describe('the other answers', () => {
  it('says a Job whose work had already ended was not changed, with the state it is in, and refreshes so the page shows it', async () => {
    mocks.cancelJob.mockResolvedValue({outcome: 'not_cancellable', state: 'completed'});
    expect(await run()).toEqual({outcome: 'not_cancellable', state: 'completed'});
    expect(steps()).toEqual(['refresh']);
  });

  it('says a reused command ID changed nothing, and refreshes nothing', async () => {
    mocks.cancelJob.mockResolvedValue({outcome: 'reused'});
    expect(await run()).toEqual({outcome: 'reused'});
    expect(mocks.refresh).not.toHaveBeenCalled();
  });

  it('says a Job that is not available is gone, and refreshes so the page becomes the unavailable page', async () => {
    mocks.cancelJob.mockResolvedValue({outcome: 'unavailable'});
    expect(await run()).toEqual({outcome: 'gone'});
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
  });

  it('sends the person Home, with nothing changed, when the database no longer gives this request authority', async () => {
    mocks.cancelJob.mockResolvedValue({outcome: 'denied'});
    expect(await redirected(run())).toBe('/');
    expect(mocks.refresh).not.toHaveBeenCalled();
  });
});

describe('a form that is not valid asks the database nothing', () => {
  it.each([
    ['no Job ID', {jobId: ''}],
    ['a Job ID that is not one', {jobId: 'not-an-id'}],
    ['a Job ID with spaces around it (an ID is not trimmed)', {jobId: ` ${JOB} `}],
    ['a command ID with a new line after it', {commandId: `${COMMAND}\n`}],
    ['no command ID', {commandId: ''}],
    ['a command ID that is not one', {commandId: '123'}],
  ])('is a request that did not come from the dialog for %s', async (_name, change) => {
    expect(await run({...valid, ...change})).toEqual({outcome: 'invalid'});
    expect(mocks.cancelJob).not.toHaveBeenCalled();
    expect(mocks.refresh).not.toHaveBeenCalled();
  });

  it('is a request that did not come from the dialog when a field is missing altogether', async () => {
    expect(await cancelJobAction(jobCancelIdle, new FormData())).toEqual({outcome: 'invalid'});
    expect(mocks.cancelJob).not.toHaveBeenCalled();
  });
});

describe('authority lost mid-request is refused at the gate (the function refuses it again)', () => {
  it.each(['disabled', 'revoked', 'stale_epoch', 'expired', 'idle', 'no_session', 'no_grant', 'subject_mismatch'])('sends a %s session where any private request goes, and changes nothing', async (state) => {
    authorizationIs(state);
    expect(await redirected(run())).toMatch(/^\/login/);
    expect(mocks.cancelJob).not.toHaveBeenCalled();
    expect(mocks.refresh).not.toHaveBeenCalled();
  });

  it('sends a person with no Account to register, and changes nothing', async () => {
    authorizationIs('unregistered');
    expect(await redirected(run())).toBe('/register');
    expect(mocks.cancelJob).not.toHaveBeenCalled();
  });

  it('answers a retryable "nothing was changed" when the check itself could not be made', async () => {
    mocks.authorizeSession.mockRejectedValue(new AccountsUnavailableError('The accounts database did not answer.', {retryable: true}));
    expect(await run()).toEqual({outcome: 'unavailable', unknown: false});
    expect(mocks.cancelJob).not.toHaveBeenCalled();
  });
});

describe('an outage during the cancellation', () => {
  it('tells the person to look at the page first when the call may have reached the database, and refreshes so the page they look at is current', async () => {
    mocks.cancelJob.mockRejectedValue(new AccountsUnavailableError('The accounts database did not answer.', {retryable: true}));
    expect(await run()).toEqual({outcome: 'unavailable', unknown: true});
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
  });

  it('says nothing was changed when the request certainly did not get through', async () => {
    mocks.cancelJob.mockRejectedValue(new AccountsUnavailableError('The accounts database refused the call (HTTP 400).', {status: 400, retryable: false, outcomeUnknown: false}));
    expect(await run()).toEqual({outcome: 'unavailable', unknown: false});
    mocks.cancelJob.mockRejectedValue(new AccountsConfigError('SUPABASE_SERVICE_ROLE_KEY is not set'));
    expect(await run()).toEqual({outcome: 'unavailable', unknown: false});
    expect(mocks.refresh).not.toHaveBeenCalled();
  });

  it('treats an answer that makes no sense as possibly committed', async () => {
    mocks.cancelJob.mockRejectedValue(new AccountsUnavailableError('The accounts database answered with an unexpected shape.', {retryable: false, outcomeUnknown: true}));
    expect(await run()).toEqual({outcome: 'unavailable', unknown: true});
  });

  it('prints a name and a message only: never an ID or the form', async () => {
    mocks.cancelJob.mockRejectedValue(new AccountsUnavailableError('The accounts database did not answer.', {retryable: true}));
    await run();
    const lines = printed();
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) {
      expect(line).not.toContain(JOB);
      expect(line).not.toContain(COMMAND);
      expect(line).not.toContain(ACCOUNT);
      expect(line).not.toContain('person@example.com');
    }
    expect(lines.join(' ')).toContain('AccountsUnavailableError: The accounts database did not answer.');
  });

  it('prints nothing at all on a cancellation that works', async () => {
    await run();
    expect(printed()).toEqual([]);
  });
});
