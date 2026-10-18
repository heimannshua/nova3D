import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';

// The two request Server Actions (Story 2.1) with a fake Auth client, a fake accounts database and a fake redirect. withActiveAccount and
// resolveAccess are the real ones, so who may understand or confirm, what the actions take from the verified session instead of from the
// form, what they recompute, in what order and what they print, is what the browser would see. The command itself is faked.
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
  createProjectRequest: vi.fn(),
}));
// The registry the actions read. By default it is the real default registry (Middot's one subject); a test sets `registry.current` to the
// fixture registry (a second subject that shares the alias "altar") to see the several-matches case through the real actions.
const registry = vi.hoisted(() => ({current: null as null | {subjects(): readonly unknown[]; subject(id: string): unknown}}));
vi.mock('next/navigation', () => ({
  redirect: (to: string) => {
    order.push(`redirect:${to}`);
    throw new Redirected(to);
  },
}));
vi.mock('next/headers', () => ({cookies: async () => ({getAll: () => [], get: () => undefined, set: () => undefined, delete: () => undefined})}));
vi.mock('@/lib/supabase/server', async (importOriginal) => ({...(await importOriginal<typeof import('@/lib/supabase/server')>()), createSupabaseServerClient: mocks.createSupabaseServerClient}));
vi.mock('@/lib/accounts', async (importOriginal) => ({...(await importOriginal<typeof import('@/lib/accounts')>()), authorizeSession: mocks.authorizeSession}));
vi.mock('@/lib/projects', async (importOriginal) => ({...(await importOriginal<typeof import('@/lib/projects')>()), createProjectRequest: mocks.createProjectRequest}));
vi.mock('@/lib/domain-registry', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/domain-registry')>();
  const current = () => (registry.current ?? original.defaultDomainRegistry) as typeof original.defaultDomainRegistry;
  return {...original, defaultDomainRegistry: {subjects: () => current().subjects(), subject: (id: string) => current().subject(id)}};
});

import {confirmRequest, understandRequest} from '@/app/projects/new/actions';
import {AccountsConfigError, AccountsUnavailableError} from '@/lib/accounts';
import {confirmIdle, understandIdle} from '@/lib/request-view';
import {sessionReader} from '../support/access-token';
import {fixtureRegistry} from '../support/fixture-domains';

const USER = '5f0d6c1e-8a52-4c1b-9d57-2b6a1f0e7c44';
const SESSION = '3b1c9a3e-6a3e-4f19-9d0e-0a4f5e2c8d11';
const ACCOUNT = '7a1b2c3d-4e5f-4a6b-8c7d-0e1f2a3b4c5d';
const OTHER_ACCOUNT = 'aa1b2c3d-4e5f-4a6b-8c7d-0e1f2a3b4caa';
const PROJECT = '9d8c7b6a-5f4e-4d3c-8b2a-1f0e9d8c7b6a';
const REQUEST = '0a0b0c0d-1e1f-4a2a-8b3b-4c4c5d5d6e6e';
const COMMAND = '11111111-2222-4333-8444-555555555555';
const HOSTED = 'https://abcdefgh.supabase.co';
const googleUser = {id: USER, email: 'person@example.com', email_confirmed_at: '2026-10-10T00:00:00Z', is_anonymous: false, app_metadata: {provider: 'google', providers: ['google']}};
const ALTAR = {id: 'middot-altar-ramp', displayName: 'The outer altar and ramp (Middot 3)'};

const described = {description: 'Please build the altar and ramp, and add "David" engraved on the base', personalization: 'Add "David" engraved on the base'};
const confirming = {...described, commandId: COMMAND, subjectId: ALTAR.id, scope: 'The outer altar', outcome: 'A model I can print'};
const form = (fields: Record<string, string>) => {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) data.set(name, value);
  return data;
};
const understand = (fields: Record<string, string> = described) => understandRequest(understandIdle, form(fields));
const confirm = (fields: Record<string, string> = confirming) => confirmRequest(confirmIdle, form(fields));
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

beforeEach(() => {
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', HOSTED);
  registry.current = null;
  order.length = 0;
  const getUser = vi.fn(async () => ({data: {user: googleUser}, error: null}));
  mocks.createSupabaseServerClient.mockReset().mockImplementation(async () => ({auth: {getUser, signOut: vi.fn(), ...sessionReader(USER, SESSION)}}));
  mocks.authorizeSession.mockReset();
  authorizationIs('active');
  mocks.createProjectRequest.mockReset().mockImplementation(async () => {
    order.push('createProjectRequest');
    return {outcome: 'created', projectId: PROJECT, requestId: REQUEST};
  });
  for (const method of ['log', 'info', 'warn', 'error', 'debug'] as const) vi.spyOn(console, method).mockImplementation(() => undefined);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('understandRequest is free: it stores nothing and its matching reads no database (AC-1); only the gate\'s own live authorization check does', () => {
  it('is clear for one subject, with the wish as understood, and calls nothing that writes', async () => {
    const result = await understand();
    expect(result).toEqual({
      outcome: 'clear',
      subject: ALTAR,
      personalization: {kind: 'applied', wording: 'Add "David" engraved on the base', text: 'David', style: 'recessed'},
    });
    expect(mocks.createProjectRequest).not.toHaveBeenCalled();
    expect(order).toEqual(['authorizeSession']);
  });

  it('is clear with no wish when there is no wording, and with a declined one (explained, not blocking) when the wording cannot be used', async () => {
    expect(await understand({description: 'the altar'})).toEqual({outcome: 'clear', subject: ALTAR, personalization: {kind: 'none'}});
    expect(await understand({description: 'the altar', personalization: 'add something nice'})).toEqual({
      outcome: 'clear',
      subject: ALTAR,
      personalization: {kind: 'declined', wording: 'add something nice', reason: 'no_quoted_text'},
    });
  });

  it('reads Hebrew as the story says: the article is allowed, a longer word is not', async () => {
    expect(await understand({description: 'המזבח'})).toMatchObject({outcome: 'clear'});
    expect(await understand({description: 'מִזְבֵּחַ'})).toMatchObject({outcome: 'clear'});
    expect(await understand({description: 'altarpiece'})).toMatchObject({outcome: 'no_match'});
  });

  it('is no_match for a description no subject fits, naming the supported subjects', async () => {
    expect(await understand({description: 'a lighthouse'})).toEqual({outcome: 'no_match', subjects: [ALTAR]});
  });

  it('never offers the fixture subject: only the default registry (Middot) is registered', async () => {
    const result = await understand({description: 'the altar and the incense'});
    expect(result).toMatchObject({outcome: 'clear', subject: ALTAR});
    expect(JSON.stringify(await understand({description: 'a lighthouse'}))).not.toContain('fixture');
  });

  it.each([
    ['an empty description', {description: ''}, [{field: 'description', problem: 'empty'}]],
    ['a description of only white space', {description: ' \n\t '}, [{field: 'description', problem: 'empty'}]],
    ['a description over 2,000 characters', {description: 'x'.repeat(2001)}, [{field: 'description', problem: 'too_long'}]],
    ['a description with a control character', {description: 'altar\u0007'}, [{field: 'description', problem: 'control'}]],
    ['wording over 300 characters', {description: 'altar', personalization: 'x'.repeat(301)}, [{field: 'personalization', problem: 'too_long'}]],
    ['both', {description: '', personalization: 'x'.repeat(301)}, [{field: 'description', problem: 'empty'}, {field: 'personalization', problem: 'too_long'}]],
  ])('names the field problems of %s, before anything else', async (_name, fields, problems) => {
    expect(await understand(fields)).toEqual({outcome: 'invalid', problems});
  });

  it('reads a textarea\'s CRLF line ends as newlines, so a multi-line description is valid', async () => {
    expect(await understand({description: 'the altar\r\nand the ramp\r\n'})).toMatchObject({outcome: 'clear'});
  });

  it('treats a missing field as an empty one', async () => {
    expect(await understandRequest(understandIdle, new FormData())).toEqual({outcome: 'invalid', problems: [{field: 'description', problem: 'empty'}]});
  });
});

describe('confirmRequest creates the Project and its first revision, and goes to it (AC-2)', () => {
  it('sends exactly the edited values, and redirects to the new Project', async () => {
    expect(await redirected(confirm())).toBe(`/projects/${PROJECT}`);
    expect(mocks.createProjectRequest).toHaveBeenCalledTimes(1);
    const [operation, input] = mocks.createProjectRequest.mock.calls[0];
    expect(operation).toEqual({accountId: ACCOUNT, epoch: 4});
    expect(input).toEqual({
      commandId: COMMAND,
      request: {
        title: ALTAR.displayName,
        mode: 'evidence_text',
        subjectId: ALTAR.id,
        scope: 'The outer altar',
        outcome: 'A model I can print',
        description: described.description,
        personalization: {wording: 'Add "David" engraved on the base', text: 'David', style: 'recessed', applied: true, reason: null},
      },
    });
    expect(order).toEqual(['authorizeSession', 'createProjectRequest', `redirect:/projects/${PROJECT}`]);
  });

  it('takes the Account and the epoch from the verified session, and nothing about either from the form', async () => {
    await redirected(confirm({...confirming, accountId: OTHER_ACCOUNT, epoch: '99', account_id: OTHER_ACCOUNT, workspaceId: OTHER_ACCOUNT}));
    expect(mocks.createProjectRequest.mock.calls[0][0]).toEqual({accountId: ACCOUNT, epoch: 4});
  });

  it('titles the Project with the subject\'s display name from the registry, not with anything the form says', async () => {
    await redirected(confirm({...confirming, title: 'A title the client made up', projectTitle: 'Another'}));
    expect(mocks.createProjectRequest.mock.calls[0][1].request.title).toBe(ALTAR.displayName);
  });

  it('is always a text request: a mode in the form is not read', async () => {
    await redirected(confirm({...confirming, mode: 'image_direct'}));
    expect(mocks.createProjectRequest.mock.calls[0][1].request.mode).toBe('evidence_text');
  });

  it('sends the same command again when the person presses Confirm again: the command ID is the form\'s, not the action\'s', async () => {
    await redirected(confirm());
    await redirected(confirm());
    expect(mocks.createProjectRequest.mock.calls.map((call) => call[1].commandId)).toEqual([COMMAND, COMMAND]);
  });

  it('follows a replay to the same Project as a creation', async () => {
    mocks.createProjectRequest.mockResolvedValue({outcome: 'replayed', projectId: PROJECT, requestId: REQUEST});
    expect(await redirected(confirm())).toBe(`/projects/${PROJECT}`);
  });

  it('records no wish, an unusable wish as not applied with its reason, and trims what was edited', async () => {
    await redirected(confirm({...confirming, personalization: ''}));
    expect(mocks.createProjectRequest.mock.calls[0][1].request.personalization).toEqual({wording: null, text: null, style: null, applied: false, reason: null});
    await redirected(confirm({...confirming, personalization: 'add something nice', scope: '  Edited scope \n', outcome: '\tEdited outcome  '}));
    expect(mocks.createProjectRequest.mock.calls[1][1].request).toMatchObject({
      scope: 'Edited scope',
      outcome: 'Edited outcome',
      personalization: {wording: 'add something nice', text: null, style: null, applied: false, reason: 'no_quoted_text'},
    });
  });

  it('keeps the description the person wrote, with a newline in it, and reads the form\'s CRLF as one', async () => {
    await redirected(confirm({...confirming, description: 'the altar\r\nand the ramp'}));
    expect(mocks.createProjectRequest.mock.calls[0][1].request.description).toBe('the altar\nand the ramp');
  });

  it('carries no approval, permission or payment: the request holds the request and nothing else', async () => {
    await redirected(confirm({...confirming, approved: 'yes', permission: 'granted', maxCost: '5', paid: 'true'}));
    expect(Object.keys(mocks.createProjectRequest.mock.calls[0][1].request).sort()).toEqual(['description', 'mode', 'outcome', 'personalization', 'scope', 'subjectId', 'title']);
    expect(JSON.stringify(mocks.createProjectRequest.mock.calls[0])).not.toMatch(/approved|granted|maxCost|paid/);
  });
});

describe('with a second subject that shares the alias "altar" (the fixture registry), the real actions ask which one (AC-1)', () => {
  const INCENSE = {id: 'fixture-incense-altar', displayName: 'The incense altar (fixture)'};
  beforeEach(() => {
    registry.current = fixtureRegistry;
  });

  it('understands "altar" as ambiguous, naming both subjects in registry order, with the wish as understood and nothing stored', async () => {
    expect(await understand({description: 'altar', personalization: 'Add "David" engraved'})).toEqual({
      outcome: 'ambiguous',
      matches: [ALTAR, INCENSE],
      personalization: {kind: 'applied', wording: 'Add "David" engraved', text: 'David', style: 'recessed'},
    });
    expect(mocks.createProjectRequest).not.toHaveBeenCalled();
  });

  it('is clear when only one of them matches, and no_match offers both', async () => {
    expect(await understand({description: 'the incense'})).toEqual({outcome: 'clear', subject: INCENSE, personalization: {kind: 'none'}});
    expect(await understand({description: 'a ramp'})).toMatchObject({outcome: 'clear', subject: ALTAR});
    expect(await understand({description: 'a lighthouse'})).toEqual({outcome: 'no_match', subjects: [ALTAR, INCENSE]});
  });

  it('confirms the second subject the person chose: the request reaches the database with that subject and its display name as the title', async () => {
    expect(await redirected(confirm({...confirming, description: 'altar', subjectId: INCENSE.id}))).toBe(`/projects/${PROJECT}`);
    expect(mocks.createProjectRequest.mock.calls[0][1].request).toMatchObject({subjectId: INCENSE.id, title: INCENSE.displayName, description: 'altar'});
  });

  it('confirms the first subject too when it is the one chosen', async () => {
    await redirected(confirm({...confirming, description: 'altar', subjectId: ALTAR.id}));
    expect(mocks.createProjectRequest.mock.calls[0][1].request).toMatchObject({subjectId: ALTAR.id, title: ALTAR.displayName});
  });

  it('does not guess when none was chosen: the description no longer fits one subject, and nothing is stored', async () => {
    expect(await confirm({...confirming, description: 'altar', subjectId: ''})).toEqual({outcome: 'changed'});
    expect(mocks.createProjectRequest).not.toHaveBeenCalled();
  });

  it('refuses a subject that is registered but not a match for the description', async () => {
    expect(await confirm({...confirming, description: 'a ramp', subjectId: INCENSE.id})).toEqual({outcome: 'invalid', problems: [{field: 'subject', problem: 'not_a_match'}]});
    expect(mocks.createProjectRequest).not.toHaveBeenCalled();
  });
});

describe('confirmRequest recomputes everything and trusts nothing the client says it understood (AC-1)', () => {
  it('refuses a subject that is not a match for the description, and asks the database nothing', async () => {
    for (const subjectId of ['fixture-incense-altar', 'no-such-subject']) {
      expect(await confirm({...confirming, subjectId})).toEqual({outcome: 'invalid', problems: [{field: 'subject', problem: 'not_a_match'}]});
    }
    expect(await confirm({...confirming, description: 'a lighthouse'})).toEqual({outcome: 'invalid', problems: [{field: 'subject', problem: 'not_a_match'}]});
    expect(mocks.createProjectRequest).not.toHaveBeenCalled();
  });

  it('says the description no longer fits one subject when no subject was sent and none matches', async () => {
    expect(await confirm({...confirming, description: 'a lighthouse', subjectId: ''})).toEqual({outcome: 'changed'});
    expect(mocks.createProjectRequest).not.toHaveBeenCalled();
  });

  it('accepts no subject from the form when exactly one matches, as the screen would have sent it', async () => {
    expect(await redirected(confirm({...confirming, subjectId: ''}))).toBe(`/projects/${PROJECT}`);
    expect(mocks.createProjectRequest.mock.calls[0][1].request.subjectId).toBe(ALTAR.id);
  });

  it.each([
    ['an empty scope', {scope: ''}, [{field: 'scope', problem: 'empty'}]],
    ['a scope of 301 characters', {scope: 'x'.repeat(301)}, [{field: 'scope', problem: 'too_long'}]],
    ['a scope with a new line', {scope: 'two\nlines'}, [{field: 'scope', problem: 'control'}]],
    ['an empty outcome', {outcome: ' '}, [{field: 'outcome', problem: 'empty'}]],
    ['an outcome of 301 characters', {outcome: 'x'.repeat(301)}, [{field: 'outcome', problem: 'too_long'}]],
    ['an outcome with a tab', {outcome: 'a\tb'}, [{field: 'outcome', problem: 'control'}]],
    ['an empty description', {description: ''}, [{field: 'description', problem: 'empty'}]],
    ['wording over 300 characters', {personalization: 'x'.repeat(301)}, [{field: 'personalization', problem: 'too_long'}]],
    ['several at once', {scope: '', outcome: ''}, [{field: 'scope', problem: 'empty'}, {field: 'outcome', problem: 'empty'}]],
  ])('names the field problems of %s and stores nothing', async (_name, change, problems) => {
    expect(await confirm({...confirming, ...change})).toEqual({outcome: 'invalid', problems});
    expect(mocks.createProjectRequest).not.toHaveBeenCalled();
  });

  it.each([
    ['no command ID', {commandId: ''}],
    ['a command ID that is not one', {commandId: '123'}],
    ['a command ID with a new line after it', {commandId: `${COMMAND}\n`}],
  ])('is a form that does not come from the screen for %s: nothing to point at, nothing stored', async (_name, change) => {
    expect(await confirm({...confirming, ...change})).toEqual({outcome: 'invalid', problems: []});
    expect(mocks.createProjectRequest).not.toHaveBeenCalled();
  });

  it('is a form that does not come from the screen when a field is missing altogether', async () => {
    expect(await confirmRequest(confirmIdle, new FormData())).toEqual({outcome: 'invalid', problems: []});
    expect(mocks.createProjectRequest).not.toHaveBeenCalled();
  });
});

describe('the other answers', () => {
  it('says a reused command ID saved nothing', async () => {
    mocks.createProjectRequest.mockResolvedValue({outcome: 'reused'});
    expect(await confirm()).toEqual({outcome: 'reused'});
  });

  it('says a replay whose Project is gone saved nothing and has nowhere to go: a message, not a redirect to a page that is not there', async () => {
    mocks.createProjectRequest.mockResolvedValue({outcome: 'unavailable'});
    expect(await confirm()).toEqual({outcome: 'gone'});
    expect(order.filter((step) => step.startsWith('redirect:'))).toEqual([]);
  });

  it('sends the person Home, with nothing saved, when the database no longer gives this request authority', async () => {
    mocks.createProjectRequest.mockResolvedValue({outcome: 'denied'});
    expect(await redirected(confirm())).toBe('/');
  });
});

describe('authority lost mid-request is refused at the gate (the function refuses it again)', () => {
  it.each(['disabled', 'revoked', 'stale_epoch', 'expired', 'idle', 'no_session', 'no_grant', 'subject_mismatch'])('sends a %s session where any private request goes, for both actions, and stores nothing', async (state) => {
    authorizationIs(state);
    expect(await redirected(understand())).toMatch(/^\/login/);
    expect(await redirected(confirm())).toMatch(/^\/login/);
    expect(mocks.createProjectRequest).not.toHaveBeenCalled();
  });

  it('sends a person with no Account to register', async () => {
    authorizationIs('unregistered');
    expect(await redirected(understand())).toBe('/register');
    expect(await redirected(confirm())).toBe('/register');
    expect(mocks.createProjectRequest).not.toHaveBeenCalled();
  });

  it('answers a retryable "nothing was saved" when the check itself could not be made', async () => {
    mocks.authorizeSession.mockRejectedValue(new AccountsUnavailableError('The accounts database did not answer.', {retryable: true}));
    expect(await understand()).toEqual({outcome: 'unavailable'});
    expect(await confirm()).toEqual({outcome: 'unavailable', unknown: false});
    expect(mocks.createProjectRequest).not.toHaveBeenCalled();
  });
});

describe('an outage during the confirmation (matrix: Outage)', () => {
  it('tells the person to check My Projects first when the call may have reached the database', async () => {
    mocks.createProjectRequest.mockRejectedValue(new AccountsUnavailableError('The accounts database did not answer.', {retryable: true, outcomeUnknown: true}));
    expect(await confirm()).toEqual({outcome: 'unavailable', unknown: true});
  });

  it('says nothing was saved when the request certainly did not get through', async () => {
    mocks.createProjectRequest.mockRejectedValue(new AccountsUnavailableError('The accounts database refused the call (HTTP 400).', {status: 400, retryable: false, outcomeUnknown: false}));
    expect(await confirm()).toEqual({outcome: 'unavailable', unknown: false});
    mocks.createProjectRequest.mockRejectedValue(new AccountsConfigError('SUPABASE_SERVICE_ROLE_KEY is not set'));
    expect(await confirm()).toEqual({outcome: 'unavailable', unknown: false});
  });

  it('treats an answer that makes no sense as possibly saved', async () => {
    mocks.createProjectRequest.mockRejectedValue(new AccountsUnavailableError('The accounts database answered with an unexpected shape.', {retryable: false, outcomeUnknown: true}));
    expect(await confirm()).toEqual({outcome: 'unavailable', unknown: true});
  });

  it('retries with the same command ID, so a retry creates at most one Project', async () => {
    mocks.createProjectRequest.mockRejectedValueOnce(new AccountsUnavailableError('The accounts database did not answer.', {retryable: true, outcomeUnknown: true}));
    expect(await confirm()).toEqual({outcome: 'unavailable', unknown: true});
    expect(await redirected(confirm())).toBe(`/projects/${PROJECT}`);
    expect(mocks.createProjectRequest.mock.calls.map((call) => call[1].commandId)).toEqual([COMMAND, COMMAND]);
  });

  it('prints a name and a message only: never the description, the scope, the wording, the title or an ID', async () => {
    mocks.createProjectRequest.mockRejectedValue(new AccountsUnavailableError('The accounts database did not answer.', {retryable: true}));
    await confirm({...confirming, description: 'A very private description of the altar', scope: 'A very private scope', personalization: 'Add "Secret" raised'});
    const lines = printed();
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) {
      for (const secret of ['A very private description', 'A very private scope', 'Secret', ALTAR.displayName, PROJECT, COMMAND, ACCOUNT, 'person@example.com']) expect(line).not.toContain(secret);
    }
    expect(lines.join(' ')).toContain('AccountsUnavailableError: The accounts database did not answer.');
  });

  it('prints nothing at all when both actions work', async () => {
    await understand();
    await redirected(confirm());
    expect(printed()).toEqual([]);
  });
});
