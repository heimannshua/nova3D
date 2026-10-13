import {describe, expect, it, vi} from 'vitest';
import {AccountsUnavailableError} from '@/lib/accounts';
import {listProjects, maxListed, readProject, renameProjectCommand} from '@/lib/projects';
import {resolveProjectTarget} from '@/lib/project-target';

// The typed calls of the Projects functions (lib/projects.ts) and the target resolver (lib/project-target.ts), against a fake fetch:
// what each sends (the Account and the epoch of the operation, nothing a request chose), what each accepts as an answer, and that an
// answer that cannot be got is an error and never an empty list or an "unavailable" Project.
const ACCOUNT = '7a1b2c3d-4e5f-4a6b-8c7d-0e1f2a3b4c5d';
const PROJECT = '9d8c7b6a-5f4e-4d3c-8b2a-1f0e9d8c7b6a';
const COMMAND = '11111111-2222-4333-8444-555555555555';
const env = {NEXT_PUBLIC_SUPABASE_URL: 'https://abcdefgh.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'service-key-for-tests-only'};
const operation = {accountId: ACCOUNT, epoch: 3};
const row = {id: PROJECT, title: 'Courtyard bench', stage: 'researching', current_version: 0, revision: 1, created_at: '2026-10-12T00:00:00+00:00', updated_at: '2026-10-12T00:00:00+00:00'};

type Sent = {name: string; body: Record<string, unknown>; headers: Record<string, string>};
function fake(answer: unknown, status = 200) {
  const sent: Sent[] = [];
  const fetch = vi.fn(async (input: string, init?: RequestInit) => {
    sent.push({name: input.split('/rpc/')[1], body: JSON.parse(String(init?.body)), headers: init?.headers as Record<string, string>});
    return new Response(JSON.stringify(answer), {status, headers: {'content-type': 'application/json'}});
  });
  return {fetch, sent, options: {env, fetch}};
}

describe('listProjects', () => {
  it('asks for the Account and epoch of the operation, as the service role, with the limit, and reads the Projects and the total', async () => {
    const {sent, options} = fake({outcome: 'listed', total: 4, projects: [row]});
    const listed = await listProjects(operation, {limit: 3}, options);
    expect(listed).toEqual({outcome: 'listed', total: 4, projects: [{id: PROJECT, title: 'Courtyard bench', stage: 'researching', currentVersion: 0, revision: 1, createdAt: row.created_at, updatedAt: row.updated_at}]});
    expect(sent).toEqual([expect.objectContaining({name: 'list_projects', body: {p_account_id: ACCOUNT, p_epoch: 3, p_limit: 3}})]);
    expect(sent[0].headers).toMatchObject({authorization: 'Bearer service-key-for-tests-only', 'content-profile': 'api'});
  });

  it('asks for the most it may when no limit is given', async () => {
    const {sent, options} = fake({outcome: 'listed', total: 0, projects: []});
    expect(await listProjects(operation, {}, options)).toEqual({outcome: 'listed', total: 0, projects: []});
    expect(sent[0].body.p_limit).toBe(maxListed);
  });

  it('answers denied, with no Projects, when the database does', async () => {
    expect(await listProjects(operation, {}, fake({outcome: 'denied', total: null, projects: null}).options)).toEqual({outcome: 'denied'});
  });

  it('refuses a limit outside 1 to 200 and an operation that is not shaped like one, before asking', async () => {
    const {fetch, options} = fake({});
    for (const limit of [0, 201, 1.5, Number.NaN, -1]) await expect(listProjects(operation, {limit}, options)).rejects.toBeInstanceOf(TypeError);
    await expect(listProjects({accountId: 'not-an-id', epoch: 1}, {}, options)).rejects.toBeInstanceOf(TypeError);
    await expect(listProjects({accountId: ACCOUNT, epoch: 0}, {}, options)).rejects.toBeInstanceOf(TypeError);
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([
    ['a body that is not an object', []],
    ['an outcome it does not know', {outcome: 'maybe', total: 0, projects: []}],
    ['no total', {outcome: 'listed', projects: []}],
    ['more Projects than the total', {outcome: 'listed', total: 0, projects: [row]}],
    ['a stage it does not know', {outcome: 'listed', total: 1, projects: [{...row, stage: 'archived'}]}],
    ['a row with no title', {outcome: 'listed', total: 1, projects: [{...row, title: null}]}],
    ['a row with a bad ID', {outcome: 'listed', total: 1, projects: [{...row, id: 'nope'}]}],
    ['a revision of 0', {outcome: 'listed', total: 1, projects: [{...row, revision: 0}]}],
    ['a negative Version', {outcome: 'listed', total: 1, projects: [{...row, current_version: -1}]}],
  ])('treats %s as no answer at all', async (_name, answer) => {
    await expect(listProjects(operation, {}, fake(answer).options)).rejects.toBeInstanceOf(AccountsUnavailableError);
  });

  it('throws, and does not return an empty list, when the database cannot be reached or refuses', async () => {
    await expect(listProjects(operation, {}, {env, fetch: async () => { throw new TypeError('fetch failed'); }})).rejects.toMatchObject({name: 'AccountsUnavailableError', retryable: true, outcomeUnknown: true});
    await expect(listProjects(operation, {}, fake({message: 'no'}, 503).options)).rejects.toMatchObject({retryable: true});
    await expect(listProjects(operation, {}, fake({code: '42501'}, 401).options)).rejects.toMatchObject({retryable: false, code: '42501'});
  });
});

describe('readProject', () => {
  it('reads the Project, for the Account and epoch of the operation', async () => {
    const {sent, options} = fake({outcome: 'found', ...row});
    expect(await readProject(operation, PROJECT, options)).toMatchObject({outcome: 'found', project: {id: PROJECT, title: 'Courtyard bench', revision: 1}});
    expect(sent[0]).toMatchObject({name: 'get_project', body: {p_account_id: ACCOUNT, p_epoch: 3, p_project_id: PROJECT}});
  });

  it('lower-cases an ID before it asks, and does not trim one: an ID with anything around it is none', async () => {
    const {sent, options, fetch} = fake({outcome: 'found', ...row});
    await readProject(operation, PROJECT.toUpperCase(), options);
    expect(sent[0].body.p_project_id).toBe(PROJECT);
    fetch.mockClear();
    for (const padded of [`  ${PROJECT} `, ` ${PROJECT}`, `${PROJECT}\n`, `%20${PROJECT}%20`]) expect(await readProject(operation, padded, options), JSON.stringify(padded)).toEqual({outcome: 'unavailable'});
    expect(fetch).not.toHaveBeenCalled();
  });

  it('answers unavailable, with nothing else, when the database does', async () => {
    expect(await readProject(operation, PROJECT, fake({outcome: 'unavailable', id: null, title: null, stage: null, current_version: null, revision: null, created_at: null, updated_at: null}).options)).toEqual({outcome: 'unavailable'});
  });

  it('answers unavailable for anything that is not a Project ID without asking the database', async () => {
    const {fetch, options} = fake({});
    for (const target of ['not-an-id', '', ' ', `${PROJECT}x`, '../etc', null, undefined, 3, {}]) expect(await readProject(operation, target, options), String(target)).toEqual({outcome: 'unavailable'});
    expect(fetch).not.toHaveBeenCalled();
  });

  it('answers denied when the database does', async () => {
    expect(await readProject(operation, PROJECT, fake({outcome: 'denied'}).options)).toEqual({outcome: 'denied'});
  });

  it('throws, never answers unavailable, when the database cannot be reached: down is not "not yours"', async () => {
    await expect(readProject(operation, PROJECT, {env, fetch: async () => { throw new TypeError('fetch failed'); }})).rejects.toBeInstanceOf(AccountsUnavailableError);
    await expect(readProject(operation, PROJECT, fake({message: 'down'}, 502).options)).rejects.toBeInstanceOf(AccountsUnavailableError);
  });

  it('treats the row of another Project, or a row that is not shaped like one, as no answer', async () => {
    await expect(readProject(operation, PROJECT, fake({outcome: 'found', ...row, id: '11111111-1111-4111-8111-111111111111'}).options)).rejects.toBeInstanceOf(AccountsUnavailableError);
    await expect(readProject(operation, PROJECT, fake({outcome: 'found', ...row, stage: undefined}).options)).rejects.toBeInstanceOf(AccountsUnavailableError);
    await expect(readProject(operation, PROJECT, fake({outcome: 'found'}).options)).rejects.toBeInstanceOf(AccountsUnavailableError);
  });
});

describe('renameProjectCommand', () => {
  const input = {commandId: COMMAND, projectId: PROJECT, expectedRevision: 1, title: 'After'};

  it('sends the Account and epoch of the operation, the command ID, the Project, the expected revision and the title, and nothing else', async () => {
    const {sent, options} = fake({outcome: 'renamed', project_id: PROJECT, title: 'After', revision: 2, replayed: false});
    expect(await renameProjectCommand(operation, input, options)).toEqual({outcome: 'renamed', projectId: PROJECT, title: 'After', revision: 2, replayed: false});
    expect(sent[0]).toMatchObject({
      name: 'rename_project',
      body: {p_account_id: ACCOUNT, p_epoch: 3, p_command_id: COMMAND, p_project_id: PROJECT, p_expected_revision: 1, p_title: 'After'},
    });
    expect(Object.keys(sent[0].body).sort()).toEqual(['p_account_id', 'p_command_id', 'p_epoch', 'p_expected_revision', 'p_project_id', 'p_title']);
  });

  it('reads a replay as the original receipt', async () => {
    expect(await renameProjectCommand(operation, input, fake({outcome: 'renamed', project_id: PROJECT, title: 'After', revision: 2, replayed: true}).options)).toMatchObject({outcome: 'renamed', replayed: true});
  });

  it('reads a stale answer with the current title and revision', async () => {
    expect(await renameProjectCommand(operation, input, fake({outcome: 'stale', project_id: PROJECT, title: 'Now', revision: 5, replayed: false}).options)).toEqual({outcome: 'stale', projectId: PROJECT, title: 'Now', revision: 5});
  });

  it.each(['reused', 'unavailable', 'denied'])('reads %s as that and nothing more', async (outcome) => {
    expect(await renameProjectCommand(operation, input, fake({outcome, project_id: null, title: null, revision: null, replayed: null}).options)).toEqual({outcome});
  });

  it('refuses an input that is not shaped like one before it asks', async () => {
    const {fetch, options} = fake({});
    await expect(renameProjectCommand(operation, {...input, commandId: 'nope'}, options)).rejects.toBeInstanceOf(TypeError);
    await expect(renameProjectCommand(operation, {...input, projectId: 'nope'}, options)).rejects.toBeInstanceOf(TypeError);
    await expect(renameProjectCommand(operation, {...input, expectedRevision: 0}, options)).rejects.toBeInstanceOf(TypeError);
    await expect(renameProjectCommand(operation, {...input, expectedRevision: 1.5}, options)).rejects.toBeInstanceOf(TypeError);
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([
    ['an outcome it does not know', {outcome: 'done'}],
    ['a rename with no title', {outcome: 'renamed', project_id: PROJECT, title: null, revision: 2}],
    ['a rename with no revision', {outcome: 'renamed', project_id: PROJECT, title: 'After'}],
    ['a rename of no Project', {outcome: 'renamed', title: 'After', revision: 2}],
    ['a stale answer with no revision', {outcome: 'stale', project_id: PROJECT, title: 'Now'}],
  ])('treats %s as no answer at all', async (_name, answer) => {
    await expect(renameProjectCommand(operation, input, fake(answer).options)).rejects.toBeInstanceOf(AccountsUnavailableError);
  });

  it('says, when the call may have reached the database, that the outcome is unknown, and when it certainly did not, that it is not', async () => {
    await expect(renameProjectCommand(operation, input, {env, fetch: async () => { throw new TypeError('fetch failed'); }})).rejects.toMatchObject({outcomeUnknown: true});
    await expect(renameProjectCommand(operation, input, fake({code: '22023'}, 400).options)).rejects.toMatchObject({outcomeUnknown: false, retryable: false});
  });
});

describe('resolveProjectTarget', () => {
  const quiet = {log: () => undefined};

  it('resolves a Project of the Account to its Account, ID and current revision', async () => {
    expect(await resolveProjectTarget(operation, PROJECT, {...fake({outcome: 'found', ...row, revision: 4}).options, ...quiet})).toEqual({outcome: 'resolved', accountId: ACCOUNT, projectId: PROJECT, revision: 4});
  });

  it('answers unavailable, and the same thing, for a Project that is not available and for an ID that is no ID', async () => {
    const answers = [
      await resolveProjectTarget(operation, PROJECT, {...fake({outcome: 'unavailable'}).options, ...quiet}),
      await resolveProjectTarget(operation, 'not-an-id', {...fake({}).options, ...quiet}),
      await resolveProjectTarget(operation, undefined, {...fake({}).options, ...quiet}),
    ];
    for (const answer of answers) expect(answer).toEqual({outcome: 'unavailable'});
  });

  it('answers denied when the Account has no authority', async () => {
    expect(await resolveProjectTarget(operation, PROJECT, {...fake({outcome: 'denied'}).options, ...quiet})).toEqual({outcome: 'denied'});
  });

  it('never throws, and answers unreachable, which is not unavailable, when the database cannot answer or answers nonsense', async () => {
    const log = vi.fn();
    expect(await resolveProjectTarget(operation, PROJECT, {env, fetch: async () => { throw new TypeError('fetch failed'); }, log})).toEqual({outcome: 'unreachable'});
    expect(await resolveProjectTarget(operation, PROJECT, {...fake({nonsense: true}).options, log})).toEqual({outcome: 'unreachable'});
    expect(await resolveProjectTarget({accountId: 'x', epoch: 1}, PROJECT, {...fake({}).options, log})).toEqual({outcome: 'unreachable'});
    // What it logs is a name and a message, never the ID asked for.
    for (const call of log.mock.calls) expect(JSON.stringify(call)).not.toContain(PROJECT);
  });
});
