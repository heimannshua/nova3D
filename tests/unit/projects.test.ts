import {describe, expect, it, vi} from 'vitest';
import {AccountsUnavailableError} from '@/lib/accounts';
import {createProjectRequest, listProjects, maxListed, readProject, readProjectRequest, renameProjectCommand} from '@/lib/projects';
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

// Request revisions (Story 2.1) --------------------------------------------------------------------------------------------------------
const REQUEST = '0a0b0c0d-1e1f-4a2a-8b3b-4c4c5d5d6e6e';
const confirmed = {
  title: 'The outer altar and ramp (Middot 3)',
  mode: 'evidence_text' as const,
  subjectId: 'middot-altar-ramp',
  scope: 'The outer altar',
  outcome: 'A model I can print',
  description: 'Build the altar and add "David" engraved',
  personalization: {wording: 'Add "David" engraved', text: 'David', style: 'recessed' as const, applied: true, reason: null},
};
const revisionRow = {
  outcome: 'found',
  request_id: REQUEST,
  project_id: PROJECT,
  seq: 1,
  mode: 'evidence_text',
  subject_id: 'middot-altar-ramp',
  scope: 'The outer altar',
  intended_outcome: 'A model I can print',
  description: 'Build the altar and add "David" engraved',
  personalization_wording: 'Add "David" engraved',
  personalization_text: 'David',
  personalization_style: 'recessed',
  personalization_applied: true,
  personalization_reason: null,
  confirmed_at: '2026-10-18T19:12:12.844515+00:00',
};

describe('createProjectRequest', () => {
  it('sends the Account and epoch of the operation, the command ID and exactly the confirmed values, as the service role', async () => {
    const {sent, options} = fake({outcome: 'created', project_id: PROJECT, request_id: REQUEST});
    expect(await createProjectRequest(operation, {commandId: COMMAND, request: confirmed}, options)).toEqual({outcome: 'created', projectId: PROJECT, requestId: REQUEST});
    expect(sent).toHaveLength(1);
    expect(sent[0].name).toBe('create_project_request');
    expect(sent[0].body).toEqual({
      p_account_id: ACCOUNT,
      p_epoch: 3,
      p_command_id: COMMAND,
      p_title: 'The outer altar and ramp (Middot 3)',
      p_mode: 'evidence_text',
      p_subject_id: 'middot-altar-ramp',
      p_scope: 'The outer altar',
      p_outcome: 'A model I can print',
      p_description: 'Build the altar and add "David" engraved',
      p_personalization_wording: 'Add "David" engraved',
      p_personalization_text: 'David',
      p_personalization_style: 'recessed',
      p_personalization_applied: true,
      p_personalization_reason: null,
    });
    expect(sent[0].headers).toMatchObject({authorization: 'Bearer service-key-for-tests-only', 'content-profile': 'api'});
  });

  it('sends a declined wish as not applied with its reason, and no text or style', async () => {
    const {sent, options} = fake({outcome: 'created', project_id: PROJECT, request_id: REQUEST});
    await createProjectRequest(operation, {commandId: COMMAND, request: {...confirmed, mode: 'image_direct', personalization: {wording: 'Add "David"', text: null, style: null, applied: false, reason: 'image_direct_has_no_surfaces'}}}, options);
    expect(sent[0].body).toMatchObject({p_mode: 'image_direct', p_personalization_applied: false, p_personalization_text: null, p_personalization_style: null, p_personalization_reason: 'image_direct_has_no_surfaces'});
  });

  it('answers a replay as the same IDs, and a reused command and a denial as nothing more', async () => {
    expect(await createProjectRequest(operation, {commandId: COMMAND, request: confirmed}, fake({outcome: 'replayed', project_id: PROJECT.toUpperCase(), request_id: REQUEST}).options)).toEqual({outcome: 'replayed', projectId: PROJECT, requestId: REQUEST});
    expect(await createProjectRequest(operation, {commandId: COMMAND, request: confirmed}, fake({outcome: 'reused', project_id: null, request_id: null}).options)).toEqual({outcome: 'reused'});
    expect(await createProjectRequest(operation, {commandId: COMMAND, request: confirmed}, fake({outcome: 'denied', project_id: null, request_id: null}).options)).toEqual({outcome: 'denied'});
  });

  it('answers unavailable, with no ID, for a replay whose Project has since been deleted or tombstoned', async () => {
    expect(await createProjectRequest(operation, {commandId: COMMAND, request: confirmed}, fake({outcome: 'unavailable', project_id: null, request_id: null}).options)).toEqual({outcome: 'unavailable'});
    // Even if the database sent IDs with it, an unavailable answer carries none: there is no Project to go to.
    expect(await createProjectRequest(operation, {commandId: COMMAND, request: confirmed}, fake({outcome: 'unavailable', project_id: PROJECT, request_id: REQUEST}).options)).toEqual({outcome: 'unavailable'});
  });

  it('refuses a command ID, an Account or an epoch that is not shaped like one, before asking', async () => {
    const {fetch, options} = fake({});
    await expect(createProjectRequest(operation, {commandId: 'nope', request: confirmed}, options)).rejects.toBeInstanceOf(TypeError);
    await expect(createProjectRequest({accountId: 'nope', epoch: 1}, {commandId: COMMAND, request: confirmed}, options)).rejects.toBeInstanceOf(TypeError);
    await expect(createProjectRequest({accountId: ACCOUNT, epoch: 0}, {commandId: COMMAND, request: confirmed}, options)).rejects.toBeInstanceOf(TypeError);
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([
    ['a body that is not an object', []],
    ['an outcome it does not know', {outcome: 'maybe', project_id: PROJECT, request_id: REQUEST}],
    ['a creation with no Project', {outcome: 'created', project_id: null, request_id: REQUEST}],
    ['a creation with no revision', {outcome: 'created', project_id: PROJECT, request_id: null}],
    ['a creation whose IDs are not IDs', {outcome: 'created', project_id: 'nope', request_id: REQUEST}],
    ['a replay with a bad revision ID', {outcome: 'replayed', project_id: PROJECT, request_id: 'nope'}],
  ])('treats %s as no answer at all, and so as possibly saved', async (_name, answer) => {
    await expect(createProjectRequest(operation, {commandId: COMMAND, request: confirmed}, fake(answer).options)).rejects.toMatchObject({name: 'AccountsUnavailableError', outcomeUnknown: true});
  });

  it('throws, and does not say the request was not saved, when the database cannot be reached', async () => {
    await expect(createProjectRequest(operation, {commandId: COMMAND, request: confirmed}, {env, fetch: async () => { throw new TypeError('fetch failed'); }})).rejects.toMatchObject({name: 'AccountsUnavailableError', retryable: true});
    await expect(createProjectRequest(operation, {commandId: COMMAND, request: confirmed}, fake({message: 'no'}, 503).options)).rejects.toMatchObject({retryable: true, outcomeUnknown: true});
    // A request the database understood and refused (an invalid argument) certainly saved nothing.
    await expect(createProjectRequest(operation, {commandId: COMMAND, request: confirmed}, fake({code: '22023'}, 400).options)).rejects.toMatchObject({retryable: false, outcomeUnknown: false, code: '22023'});
  });
});

describe('readProjectRequest', () => {
  it('reads the latest revision for the Account and epoch of the operation', async () => {
    const {sent, options} = fake(revisionRow);
    expect(await readProjectRequest(operation, PROJECT, options)).toEqual({
      outcome: 'found',
      request: {
        id: REQUEST,
        projectId: PROJECT,
        seq: 1,
        mode: 'evidence_text',
        subjectId: 'middot-altar-ramp',
        scope: 'The outer altar',
        outcome: 'A model I can print',
        description: 'Build the altar and add "David" engraved',
        personalization: {wording: 'Add "David" engraved', text: 'David', style: 'recessed', applied: true, reason: null},
        confirmedAt: '2026-10-18T19:12:12.844515+00:00',
      },
    });
    expect(sent[0]).toMatchObject({name: 'read_project_request', body: {p_account_id: ACCOUNT, p_epoch: 3, p_project_id: PROJECT}});
  });

  it('reads a declined wish and no wish', async () => {
    const declined = {...revisionRow, personalization_text: null, personalization_style: null, personalization_applied: false, personalization_reason: 'no_quoted_text'};
    expect(await readProjectRequest(operation, PROJECT, fake(declined).options)).toMatchObject({outcome: 'found', request: {personalization: {wording: 'Add "David" engraved', text: null, style: null, applied: false, reason: 'no_quoted_text'}}});
    const plain = {...revisionRow, personalization_wording: null, personalization_text: null, personalization_style: null, personalization_applied: false, personalization_reason: null};
    expect(await readProjectRequest(operation, PROJECT, fake(plain).options)).toMatchObject({outcome: 'found', request: {personalization: {wording: null, text: null, style: null, applied: false, reason: null}}});
  });

  it('answers none, unavailable and denied with nothing else', async () => {
    for (const outcome of ['none', 'unavailable', 'denied'] as const) expect(await readProjectRequest(operation, PROJECT, fake({outcome}).options)).toEqual({outcome});
  });

  it('lower-cases an ID, and answers unavailable without asking for anything that is not an ID', async () => {
    const {sent, options, fetch} = fake(revisionRow);
    await readProjectRequest(operation, PROJECT.toUpperCase(), options);
    expect(sent[0].body.p_project_id).toBe(PROJECT);
    fetch.mockClear();
    for (const padded of [`  ${PROJECT} `, `${PROJECT}\n`, 'nope', '', null, undefined, 4]) expect(await readProjectRequest(operation, padded, options), JSON.stringify(padded)).toEqual({outcome: 'unavailable'});
    expect(fetch).not.toHaveBeenCalled();
  });

  it('does not trust the revision of another Project than the one asked for', async () => {
    await expect(readProjectRequest(operation, PROJECT, fake({...revisionRow, project_id: '11111111-2222-4333-8444-666666666666'}).options)).rejects.toBeInstanceOf(AccountsUnavailableError);
  });

  it.each([
    ['a mode it does not know', {mode: 'both'}],
    ['no scope', {scope: null}],
    ['no outcome', {intended_outcome: ''}],
    ['no description', {description: null}],
    ['no time', {confirmed_at: null}],
    ['a sequence of 0', {seq: 0}],
    ['an applied wish with no text', {personalization_text: null}],
    ['an applied wish with no style', {personalization_style: null}],
    ['an applied wish with a reason', {personalization_reason: 'no_quoted_text'}],
    ['a style it does not know', {personalization_style: 'engraved'}],
    ['a reason it does not know', {personalization_applied: false, personalization_text: null, personalization_style: null, personalization_reason: 'because'}],
    ['a wish that was not applied but has text', {personalization_applied: false, personalization_reason: 'no_quoted_text'}],
    ['a wish that was not applied and has no reason', {personalization_applied: false, personalization_text: null, personalization_style: null, personalization_reason: null}],
    ['a reason with no wording', {personalization_wording: null, personalization_applied: false, personalization_text: null, personalization_style: null, personalization_reason: 'no_quoted_text'}],
    ['an applied flag that is not true or false', {personalization_applied: 'yes'}],
    ['a bad revision ID', {request_id: 'nope'}],
  ])('treats %s as no answer at all', async (_name, change) => {
    await expect(readProjectRequest(operation, PROJECT, fake({...revisionRow, ...change}).options)).rejects.toBeInstanceOf(AccountsUnavailableError);
  });

  it('throws, and does not say there is no request, when the database cannot be reached', async () => {
    await expect(readProjectRequest(operation, PROJECT, {env, fetch: async () => { throw new TypeError('fetch failed'); }})).rejects.toMatchObject({name: 'AccountsUnavailableError', retryable: true});
  });
});
