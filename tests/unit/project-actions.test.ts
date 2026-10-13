import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';

// The Rename Server Action (Story 1.7) with a fake Auth client, a fake accounts database and a fake redirect. withActiveAccount and
// resolveAccess are the real ones, so who may rename, what the action takes from the verified session instead of from the form, in
// what order, and what it prints, is what the browser would see. The command itself is faked and written to one ordered log.
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
  renameProjectCommand: vi.fn(),
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
vi.mock('@/lib/projects', async (importOriginal) => ({...(await importOriginal<typeof import('@/lib/projects')>()), renameProjectCommand: mocks.renameProjectCommand}));

import {renameProject} from '@/app/projects/actions';
import {AccountsConfigError, AccountsUnavailableError} from '@/lib/accounts';
import {renameIdle} from '@/lib/project-view';
import {sessionReader} from '../support/access-token';

const USER = '5f0d6c1e-8a52-4c1b-9d57-2b6a1f0e7c44';
const SESSION = '3b1c9a3e-6a3e-4f19-9d0e-0a4f5e2c8d11';
const ACCOUNT = '7a1b2c3d-4e5f-4a6b-8c7d-0e1f2a3b4c5d';
const OTHER_ACCOUNT = 'aa1b2c3d-4e5f-4a6b-8c7d-0e1f2a3b4caa';
const PROJECT = '9d8c7b6a-5f4e-4d3c-8b2a-1f0e9d8c7b6a';
const COMMAND = '11111111-2222-4333-8444-555555555555';
const HOSTED = 'https://abcdefgh.supabase.co';
const googleUser = {id: USER, email: 'person@example.com', email_confirmed_at: '2026-10-10T00:00:00Z', is_anonymous: false, app_metadata: {provider: 'google', providers: ['google']}};

const valid = {projectId: PROJECT, commandId: COMMAND, expectedRevision: '1', title: 'After'};
const form = (fields: Record<string, string>) => {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) data.set(name, value);
  return data;
};
const run = (fields: Record<string, string> = valid) => renameProject(renameIdle, form(fields));
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
  mocks.renameProjectCommand.mockReset().mockImplementation(async (_operation, input: {title: string}) => {
    order.push('renameProjectCommand');
    return {outcome: 'renamed', projectId: PROJECT, title: input.title, revision: 2, replayed: false};
  });
  mocks.refresh.mockReset();
  for (const method of ['log', 'info', 'warn', 'error', 'debug'] as const) vi.spyOn(console, method).mockImplementation(() => undefined);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('a rename at the current revision (AC-4)', () => {
  it('renames, and answers the title and revision the Project now has, after asking who is asking', async () => {
    expect(await run()).toEqual({outcome: 'renamed', title: 'After', revision: 2, replayed: false});
    expect(order).toEqual(['authorizeSession', 'renameProjectCommand', 'refresh']);
  });

  it('takes the Account and the epoch from the verified session, and nothing about either from the form', async () => {
    await run({...valid, accountId: OTHER_ACCOUNT, epoch: '99', account_id: OTHER_ACCOUNT, workspaceId: OTHER_ACCOUNT});
    expect(mocks.renameProjectCommand).toHaveBeenCalledTimes(1);
    const [operation, input] = mocks.renameProjectCommand.mock.calls[0];
    expect(operation).toEqual({accountId: ACCOUNT, epoch: 4});
    expect(input).toEqual({commandId: COMMAND, projectId: PROJECT, expectedRevision: 1, title: 'After'});
  });

  it('sends the title trimmed, and the expected revision as a number', async () => {
    await run({...valid, title: '  \tAfter  \n', expectedRevision: ' 7 '});
    expect(mocks.renameProjectCommand.mock.calls[0][1]).toMatchObject({title: 'After', expectedRevision: 7});
  });

  it('keeps a Hebrew title and one of 120 characters as they are', async () => {
    expect(await run({...valid, title: 'המזבח החיצון והכבש'})).toMatchObject({outcome: 'renamed', title: 'המזבח החיצון והכבש'});
    expect(await run({...valid, title: 'ש'.repeat(120)})).toMatchObject({outcome: 'renamed'});
  });

  it('answers a replay as the original receipt, and says so', async () => {
    mocks.renameProjectCommand.mockResolvedValue({outcome: 'renamed', projectId: PROJECT, title: 'After', revision: 2, replayed: true});
    expect(await run()).toEqual({outcome: 'renamed', title: 'After', revision: 2, replayed: true});
  });

  it('sends the same command again when the person presses Save again: the command ID is the form\'s, not the action\'s', async () => {
    await run();
    await run();
    expect(mocks.renameProjectCommand.mock.calls.map((call) => call[1].commandId)).toEqual([COMMAND, COMMAND]);
  });
});

describe('a rename at a stale revision (AC-4)', () => {
  it('answers the current title and revision, changes nothing, and refreshes the page so it shows them', async () => {
    mocks.renameProjectCommand.mockResolvedValue({outcome: 'stale', projectId: PROJECT, title: 'Renamed in the other window', revision: 5});
    expect(await run()).toEqual({outcome: 'stale', title: 'Renamed in the other window', revision: 5});
    expect(steps()).toEqual(['refresh']);
  });
});

describe('the other answers', () => {
  it('says a reused command ID changed nothing, and refreshes nothing', async () => {
    mocks.renameProjectCommand.mockResolvedValue({outcome: 'reused'});
    expect(await run()).toEqual({outcome: 'reused'});
    expect(mocks.refresh).not.toHaveBeenCalled();
  });

  it('says a Project that is not available is gone, and refreshes so the page becomes the unavailable page', async () => {
    mocks.renameProjectCommand.mockResolvedValue({outcome: 'unavailable'});
    expect(await run()).toEqual({outcome: 'gone'});
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
  });

  it('sends the person Home, with nothing changed, when the database no longer gives this request authority', async () => {
    mocks.renameProjectCommand.mockResolvedValue({outcome: 'denied'});
    expect(await redirected(run())).toBe('/');
    expect(mocks.refresh).not.toHaveBeenCalled();
  });
});

describe('a form that is not valid asks the database nothing', () => {
  it.each([
    ['a blank title', {title: ''}, 'empty'],
    ['a title of only white space', {title: ' \t '}, 'empty'],
    ['a title of only characters that draw nothing', {title: '\u200b\u200b'}, 'empty'],
    ['a title of 121 characters', {title: 'x'.repeat(121)}, 'too_long'],
    ['a title with a tab in it', {title: 'two\tcolumns'}, 'control'],
    ['a title with a new line in it', {title: 'two\nlines'}, 'control'],
    ['a title with a NUL in it', {title: 'nul\u0000'}, 'control'],
  ])('is a field error for %s', async (_name, change, problem) => {
    expect(await run({...valid, ...change})).toEqual({outcome: 'invalid', problem});
    expect(mocks.renameProjectCommand).not.toHaveBeenCalled();
    expect(mocks.refresh).not.toHaveBeenCalled();
  });

  it.each([
    ['no Project ID', {projectId: ''}],
    ['a Project ID that is not one', {projectId: 'not-an-id'}],
    ['a Project ID with spaces around it (an ID is not trimmed)', {projectId: ` ${PROJECT} `}],
    ['a command ID with a new line after it', {commandId: `${COMMAND}\n`}],
    ['no command ID', {commandId: ''}],
    ['a command ID that is not one', {commandId: '123'}],
    ['no revision', {expectedRevision: ''}],
    ['a revision of 0', {expectedRevision: '0'}],
    ['a revision that is not a number', {expectedRevision: 'one'}],
    ['a negative revision', {expectedRevision: '-1'}],
  ])('is a request that did not come from the dialog for %s', async (_name, change) => {
    expect(await run({...valid, ...change})).toEqual({outcome: 'invalid', problem: 'request'});
    expect(mocks.renameProjectCommand).not.toHaveBeenCalled();
  });

  it('is a request that did not come from the dialog when a field is missing altogether', async () => {
    expect(await renameProject(renameIdle, new FormData())).toEqual({outcome: 'invalid', problem: 'request'});
    expect(mocks.renameProjectCommand).not.toHaveBeenCalled();
  });
});

describe('authority lost mid-request is refused at the gate (the function refuses it again)', () => {
  it.each(['disabled', 'revoked', 'stale_epoch', 'expired', 'idle', 'no_session', 'no_grant', 'subject_mismatch'])('sends a %s session where any private request goes, and changes nothing', async (state) => {
    authorizationIs(state);
    const to = await redirected(run());
    expect(to).toMatch(/^\/login/);
    expect(mocks.renameProjectCommand).not.toHaveBeenCalled();
    expect(mocks.refresh).not.toHaveBeenCalled();
  });

  it('sends a person with no Account to register, and changes nothing', async () => {
    authorizationIs('unregistered');
    expect(await redirected(run())).toBe('/register');
    expect(mocks.renameProjectCommand).not.toHaveBeenCalled();
  });

  it('answers a retryable "nothing was changed" when the check itself could not be made', async () => {
    mocks.authorizeSession.mockRejectedValue(new AccountsUnavailableError('The accounts database did not answer.', {retryable: true}));
    expect(await run()).toEqual({outcome: 'unavailable', unknown: false});
    expect(mocks.renameProjectCommand).not.toHaveBeenCalled();
  });
});

describe('an outage during the rename', () => {
  it('tells the person to check the name first when the call may have reached the database, and refreshes so the name they check is current', async () => {
    mocks.renameProjectCommand.mockRejectedValue(new AccountsUnavailableError('The accounts database did not answer.', {retryable: true}));
    expect(await run()).toEqual({outcome: 'unavailable', unknown: true});
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
  });

  it('says nothing was changed when the request certainly did not get through', async () => {
    mocks.renameProjectCommand.mockRejectedValue(new AccountsUnavailableError('The accounts database refused the call (HTTP 400).', {status: 400, retryable: false, outcomeUnknown: false}));
    expect(await run()).toEqual({outcome: 'unavailable', unknown: false});
    mocks.renameProjectCommand.mockRejectedValue(new AccountsConfigError('SUPABASE_SERVICE_ROLE_KEY is not set'));
    expect(await run()).toEqual({outcome: 'unavailable', unknown: false});
    expect(mocks.refresh).not.toHaveBeenCalled();
  });

  it('treats an answer that makes no sense as possibly committed', async () => {
    mocks.renameProjectCommand.mockRejectedValue(new AccountsUnavailableError('The accounts database answered with an unexpected shape.', {retryable: false, outcomeUnknown: true}));
    expect(await run()).toEqual({outcome: 'unavailable', unknown: true});
  });

  it('prints a name and a message only: never the title, an ID or the form', async () => {
    mocks.renameProjectCommand.mockRejectedValue(new AccountsUnavailableError('The accounts database did not answer.', {retryable: true}));
    await run({...valid, title: 'A very private title'});
    const lines = printed();
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) {
      expect(line).not.toContain('A very private title');
      expect(line).not.toContain(PROJECT);
      expect(line).not.toContain(COMMAND);
      expect(line).not.toContain(ACCOUNT);
      expect(line).not.toContain('person@example.com');
    }
    expect(lines.join(' ')).toContain('AccountsUnavailableError: The accounts database did not answer.');
  });

  it('prints nothing at all on a rename that works', async () => {
    await run({...valid, title: 'A very private title'});
    expect(printed()).toEqual([]);
  });
});
