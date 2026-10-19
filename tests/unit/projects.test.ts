import {describe, expect, it, vi} from 'vitest';
import {AccountsUnavailableError} from '@/lib/accounts';
import {checkPictureRetention, createProjectRequest, listProjects, maxListed, readProject, readProjectRequest, readRetainedPictures, recordPictureReview, recordPictureSet, releaseStagedPictures, renameProjectCommand} from '@/lib/projects';
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
  confirmed: true,
  images: [],
  obstruction_confirmed: false,
  obstruction_confirmed_at: null,
  acknowledged: false,
  acknowledged_at: null,
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
        confirmed: true,
        confirmedAt: '2026-10-18T19:12:12.844515+00:00',
        images: [],
        obstructionConfirmed: false,
        obstructionConfirmedAt: null,
        acknowledged: false,
        acknowledgedAt: null,
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

// The pictures of a revision (Story 2.2) ---------------------------------------------------------------------------------------
const UPLOAD_1 = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';
const UPLOAD_2 = 'bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb';
const SHA_1 = 'a'.repeat(64);
const SHA_2 = 'b'.repeat(64);
const imageRow = (position: number, upload: string, sha: string, extra: Record<string, unknown> = {}) => ({
  position,
  upload_id: upload,
  sha256: sha,
  length: 482113,
  content_type: 'image/jpeg',
  expires_at: '2026-10-19T12:00:00.123456+00:00',
  available: true,
  label: null,
  short_edge_px: null,
  blur_variance: null,
  clipped_fraction: null,
  ...extra,
});
const pictureRow = {
  ...revisionRow,
  mode: 'evidence_images',
  subject_id: null,
  scope: null,
  intended_outcome: null,
  description: null,
  personalization_wording: null,
  personalization_text: null,
  personalization_style: null,
  personalization_applied: false,
  personalization_reason: null,
  confirmed_at: null,
  confirmed: false,
  images: [imageRow(1, UPLOAD_1, SHA_1), imageRow(2, UPLOAD_2, SHA_2, {content_type: 'image/webp', length: 12, available: false, expires_at: null})],
};

describe('readProjectRequest, an unconfirmed picture request (Story 2.2)', () => {
  it('reads a revision that claims nothing but its pictures, in order, with the lease facts the database read', async () => {
    expect(await readProjectRequest(operation, PROJECT, fake(pictureRow).options)).toEqual({
      outcome: 'found',
      request: {
        id: REQUEST,
        projectId: PROJECT,
        seq: 1,
        mode: 'evidence_images',
        confirmed: false,
        subjectId: null,
        scope: null,
        outcome: null,
        description: null,
        personalization: {wording: null, text: null, style: null, applied: false, reason: null},
        confirmedAt: null,
        images: [
          {position: 1, uploadId: UPLOAD_1, sha256: SHA_1, length: 482113, contentType: 'image/jpeg', expiresAt: '2026-10-19T12:00:00.123456+00:00', available: true, label: null, shortEdgePx: null, blurVariance: null, clippedFraction: null},
          {position: 2, uploadId: UPLOAD_2, sha256: SHA_2, length: 12, contentType: 'image/webp', expiresAt: null, available: false, label: null, shortEdgePx: null, blurVariance: null, clippedFraction: null},
        ],
        obstructionConfirmed: false,
        obstructionConfirmedAt: null,
        acknowledged: false,
        acknowledgedAt: null,
      },
    });
  });

  it('lower-cases the upload IDs and reads a revision with no pictures as an empty list', async () => {
    const upper = {...pictureRow, images: [imageRow(1, UPLOAD_1.toUpperCase(), SHA_1)]};
    const read = await readProjectRequest(operation, PROJECT, fake(upper).options);
    expect(read).toMatchObject({outcome: 'found', request: {images: [{uploadId: UPLOAD_1}]}});
    expect(await readProjectRequest(operation, PROJECT, fake({...pictureRow, images: []}).options)).toMatchObject({outcome: 'found', request: {images: []}});
  });

  it('returns no key, address or download URL for a picture: only the lease facts', async () => {
    const read = await readProjectRequest(operation, PROJECT, fake(pictureRow).options);
    expect(JSON.stringify(read)).not.toMatch(/https?:|storage|signed|download|ticket|staging\//i);
  });

  it.each([
    ['pictures that are not a list', {images: 'none'}],
    ['no pictures member', {images: undefined}],
    ['more than 12 pictures', {images: Array.from({length: 13}, (_, index) => imageRow(index + 1, `aaaaaaaa-1111-4111-8111-${String(index).padStart(12, '0')}`, SHA_1))}],
    ['a picture out of order', {images: [imageRow(2, UPLOAD_1, SHA_1)]}],
    ['a picture with no upload ID', {images: [imageRow(1, 'nope', SHA_1)]}],
    ['a picture with a short digest', {images: [imageRow(1, UPLOAD_1, 'abc')]}],
    ['a picture of a kind it cannot be', {images: [imageRow(1, UPLOAD_1, SHA_1, {content_type: 'image/heic'})]}],
    ['a picture of no length', {images: [imageRow(1, UPLOAD_1, SHA_1, {length: 0})]}],
    ['a picture with no availability', {images: [imageRow(1, UPLOAD_1, SHA_1, {available: 'yes'})]}],
    ['a picture whose expiry is not text', {images: [imageRow(1, UPLOAD_1, SHA_1, {expires_at: 5})]}],
    ['no confirmed flag', {confirmed: undefined}],
    ['an unconfirmed revision with a time', {confirmed_at: '2026-10-18T19:12:12+00:00'}],
    ['an unconfirmed revision with a scope', {scope: 'A scope'}],
    ['an unconfirmed revision with a description', {description: 'A description'}],
    ['an unconfirmed revision with a subject', {subject_id: 'middot-altar-ramp'}],
    ['an unconfirmed revision with a wish', {personalization_wording: 'Add "David"', personalization_applied: false, personalization_reason: 'no_quoted_text'}],
    ['an unconfirmed text request', {mode: 'evidence_text'}],
    ['a confirmed revision with no description', {confirmed: true, description: null}],
  ])('treats %s as no answer at all', async (_name, change) => {
    await expect(readProjectRequest(operation, PROJECT, fake({...pictureRow, ...change}).options)).rejects.toBeInstanceOf(AccountsUnavailableError);
  });
});

describe('recordPictureSet (Story 2.2)', () => {
  const SET = [UPLOAD_1, UPLOAD_2];
  const creating = {commandId: COMMAND, projectId: null, title: 'Picture request', uploadIds: SET};

  it('sends the Account and epoch of the operation, the command, no Project and a title when it creates, and the uploads in order, as the service role', async () => {
    const {sent, options} = fake({outcome: 'created', project_id: PROJECT, request_id: REQUEST, seq: 1, position: null, released: 0});
    expect(await recordPictureSet(operation, creating, options)).toEqual({outcome: 'created', projectId: PROJECT, requestId: REQUEST, seq: 1, released: 0});
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({
      name: 'record_picture_set',
      body: {p_account_id: ACCOUNT, p_epoch: 3, p_command_id: COMMAND, p_project_id: null, p_title: 'Picture request', p_upload_ids: SET},
    });
    expect(Object.keys(sent[0].body).sort()).toEqual(['p_account_id', 'p_command_id', 'p_epoch', 'p_project_id', 'p_title', 'p_upload_ids']);
    expect(sent[0].headers).toMatchObject({authorization: 'Bearer service-key-for-tests-only', 'content-profile': 'api'});
  });

  it('names the Project and no title for a successor, lower-cases every ID, and reads the uploads it released', async () => {
    const {sent, options} = fake({outcome: 'revised', project_id: PROJECT.toUpperCase(), request_id: REQUEST.toUpperCase(), seq: 2, position: null, released: 1});
    const receipt = await recordPictureSet(operation, {commandId: COMMAND.toUpperCase(), projectId: PROJECT.toUpperCase(), title: null, uploadIds: [UPLOAD_2.toUpperCase(), UPLOAD_1]}, options);
    expect(receipt).toEqual({outcome: 'revised', projectId: PROJECT, requestId: REQUEST, seq: 2, released: 1});
    expect(sent[0].body).toMatchObject({p_command_id: COMMAND, p_project_id: PROJECT, p_title: null, p_upload_ids: [UPLOAD_2, UPLOAD_1]});
  });

  it.each(['created', 'revised', 'replayed', 'unchanged'] as const)('reads %s with the Project, the revision, its number and what was released', async (outcome) => {
    const receipt = await recordPictureSet(operation, creating, fake({outcome, project_id: PROJECT, request_id: REQUEST, seq: 3, position: null, released: null}).options);
    expect(receipt).toEqual({outcome, projectId: PROJECT, requestId: REQUEST, seq: 3, released: 0});
  });

  it.each(['too_large', 'reused', 'unavailable', 'not_editable', 'denied'] as const)('answers %s with nothing else', async (outcome) => {
    expect(await recordPictureSet(operation, creating, fake({outcome, project_id: null, request_id: null, seq: null, position: null, released: null}).options)).toEqual({outcome});
  });

  it.each(['unknown_upload', 'not_ready', 'expired_upload', 'duplicate_image'] as const)('answers %s with the position of the upload, which it must have', async (outcome) => {
    expect(await recordPictureSet(operation, creating, fake({outcome, project_id: null, request_id: null, seq: null, position: 2, released: null}).options)).toEqual({outcome, position: 2});
    for (const position of [null, 0, 3, -1, 1.5, 'one']) {
      await expect(recordPictureSet(operation, creating, fake({outcome, position}).options), String(position)).rejects.toBeInstanceOf(AccountsUnavailableError);
    }
  });

  it.each([
    ['an outcome it does not know', {outcome: 'maybe'}],
    ['a body that is not an object', []],
    ['a success with no Project', {outcome: 'created', project_id: null, request_id: REQUEST, seq: 1}],
    ['a success with a Project that is no ID', {outcome: 'created', project_id: 'nope', request_id: REQUEST, seq: 1}],
    ['a success with no revision', {outcome: 'revised', project_id: PROJECT, request_id: null, seq: 2}],
    ['a success with no number', {outcome: 'revised', project_id: PROJECT, request_id: REQUEST, seq: null}],
    ['a success with a number of 0', {outcome: 'created', project_id: PROJECT, request_id: REQUEST, seq: 0}],
    ['a success with a count that is no number', {outcome: 'revised', project_id: PROJECT, request_id: REQUEST, seq: 2, released: 'one'}],
  ])('treats %s as no answer at all', async (_name, answer) => {
    await expect(recordPictureSet(operation, creating, fake(answer).options)).rejects.toBeInstanceOf(AccountsUnavailableError);
  });

  it('refuses a set that is not 1 to 12 different upload IDs, a command or Project that is no ID, and an operation that is not one, before asking', async () => {
    const {fetch, options} = fake({});
    const twelve = Array.from({length: 12}, (_, index) => `aaaaaaaa-1111-4111-8111-${String(index).padStart(12, '0')}`);
    const bad: Record<string, Parameters<typeof recordPictureSet>[1]> = {
      'no uploads': {...creating, uploadIds: []},
      'thirteen uploads': {...creating, uploadIds: [...twelve, UPLOAD_1]},
      'a repeated upload': {...creating, uploadIds: [UPLOAD_1, UPLOAD_2, UPLOAD_1.toUpperCase()]},
      'an upload that is no ID': {...creating, uploadIds: [UPLOAD_1, 'nope']},
      'a command that is no ID': {...creating, commandId: 'nope'},
      'a Project that is no ID': {...creating, projectId: 'nope', title: null},
    };
    for (const [name, input] of Object.entries(bad)) await expect(recordPictureSet(operation, input, options), name).rejects.toBeInstanceOf(TypeError);
    await expect(recordPictureSet({accountId: 'not-an-id', epoch: 1}, creating, options)).rejects.toBeInstanceOf(TypeError);
    await expect(recordPictureSet({accountId: ACCOUNT, epoch: 0}, creating, options)).rejects.toBeInstanceOf(TypeError);
    expect(fetch).not.toHaveBeenCalled();
    // Twelve is the most that is accepted.
    await recordPictureSet(operation, {...creating, uploadIds: twelve}, fake({outcome: 'created', project_id: PROJECT, request_id: REQUEST, seq: 1}).options);
  });

  it('throws, and does not say nothing was saved, when the database cannot be reached or answers an error: the set may have been recorded', async () => {
    await expect(recordPictureSet(operation, creating, {env, fetch: async () => { throw new TypeError('fetch failed'); }})).rejects.toMatchObject({name: 'AccountsUnavailableError', retryable: true});
    await expect(recordPictureSet(operation, creating, fake({code: '22023'}, 400).options)).rejects.toMatchObject({name: 'AccountsUnavailableError', outcomeUnknown: false});
    await expect(recordPictureSet(operation, creating, fake({}, 500).options)).rejects.toMatchObject({name: 'AccountsUnavailableError', outcomeUnknown: true});
  });
});

describe('releaseStagedPictures (Story 2.2)', () => {
  it('sends the Account and epoch of the operation and the uploads, and reads how many were released', async () => {
    const {sent, options} = fake({outcome: 'released', released: 1});
    expect(await releaseStagedPictures(operation, [UPLOAD_1.toUpperCase(), UPLOAD_2], options)).toEqual({outcome: 'released', released: 1});
    expect(sent[0]).toMatchObject({name: 'release_staged_pictures', body: {p_account_id: ACCOUNT, p_epoch: 3, p_upload_ids: [UPLOAD_1, UPLOAD_2]}});
    expect(Object.keys(sent[0].body).sort()).toEqual(['p_account_id', 'p_epoch', 'p_upload_ids']);
  });

  it('answers denied with nothing else', async () => {
    expect(await releaseStagedPictures(operation, [UPLOAD_1], fake({outcome: 'denied', released: null}).options)).toEqual({outcome: 'denied'});
  });

  it.each([
    ['an outcome it does not know', {outcome: 'maybe'}],
    ['no count', {outcome: 'released', released: null}],
    ['a count that is negative', {outcome: 'released', released: -1}],
    ['more released than asked for', {outcome: 'released', released: 2}],
  ])('treats %s as no answer at all', async (_name, answer) => {
    await expect(releaseStagedPictures(operation, [UPLOAD_1], fake(answer).options)).rejects.toBeInstanceOf(AccountsUnavailableError);
  });

  it('refuses no uploads, more than 12, a repeat and an ID that is none, before asking', async () => {
    const {fetch, options} = fake({});
    const thirteen = Array.from({length: 13}, (_, index) => `aaaaaaaa-1111-4111-8111-${String(index).padStart(12, '0')}`);
    for (const uploadIds of [[], thirteen, [UPLOAD_1, UPLOAD_1], ['nope']]) await expect(releaseStagedPictures(operation, uploadIds, options), JSON.stringify(uploadIds)).rejects.toBeInstanceOf(TypeError);
    await expect(releaseStagedPictures({accountId: ACCOUNT, epoch: 0}, [UPLOAD_1], options)).rejects.toBeInstanceOf(TypeError);
    expect(fetch).not.toHaveBeenCalled();
  });
});

// The review of the pictures (Story 2.3) ----------------------------------------------------------------------------------------------------

const REVIEWED_AT = '2026-10-20T08:00:00.5+00:00';
const measuredImage = (position: number, upload: string, sha: string, label: string, extra: Record<string, unknown> = {}) =>
  imageRow(position, upload, sha, {label, short_edge_px: 1200, blur_variance: 412.375, clipped_fraction: 0.0213, ...extra});
const directRow = {
  ...pictureRow,
  seq: 2,
  mode: 'image_direct',
  scope: 'The subject in my pictures',
  intended_outcome: 'A model from my pictures',
  confirmed_at: REVIEWED_AT,
  confirmed: true,
  images: [measuredImage(1, UPLOAD_1, SHA_1, 'front'), measuredImage(2, UPLOAD_2, SHA_2, 'detail', {short_edge_px: 700})],
  obstruction_confirmed: true,
  obstruction_confirmed_at: REVIEWED_AT,
  acknowledged: true,
  acknowledged_at: REVIEWED_AT,
};

describe('readProjectRequest, a reviewed picture request (Story 2.3)', () => {
  it('reads each picture\'s label and measurements, the confirmation that nothing blocks the subject and the acknowledgment, for a confirmed direct request with no subject and no description', async () => {
    const read = await readProjectRequest(operation, PROJECT, fake(directRow).options);
    expect(read).toEqual({
      outcome: 'found',
      request: {
        id: REQUEST,
        projectId: PROJECT,
        seq: 2,
        mode: 'image_direct',
        confirmed: true,
        subjectId: null,
        scope: 'The subject in my pictures',
        outcome: 'A model from my pictures',
        description: null,
        personalization: {wording: null, text: null, style: null, applied: false, reason: null},
        confirmedAt: REVIEWED_AT,
        images: [
          {position: 1, uploadId: UPLOAD_1, sha256: SHA_1, length: 482113, contentType: 'image/jpeg', expiresAt: '2026-10-19T12:00:00.123456+00:00', available: true, label: 'front', shortEdgePx: 1200, blurVariance: 412.375, clippedFraction: 0.0213},
          {position: 2, uploadId: UPLOAD_2, sha256: SHA_2, length: 482113, contentType: 'image/jpeg', expiresAt: '2026-10-19T12:00:00.123456+00:00', available: true, label: 'detail', shortEdgePx: 700, blurVariance: 412.375, clippedFraction: 0.0213},
        ],
        obstructionConfirmed: true,
        obstructionConfirmedAt: REVIEWED_AT,
        acknowledged: true,
        acknowledgedAt: REVIEWED_AT,
      },
    });
  });

  it('reads a research-assisted choice as an unconfirmed picture request that records the obstruction confirmation and no scope', async () => {
    const research = {...pictureRow, seq: 3, images: [measuredImage(1, UPLOAD_1, SHA_1, 'back')], obstruction_confirmed: true, obstruction_confirmed_at: REVIEWED_AT, acknowledged: false, acknowledged_at: null};
    expect(await readProjectRequest(operation, PROJECT, fake(research).options)).toMatchObject({
      outcome: 'found',
      request: {mode: 'evidence_images', confirmed: false, scope: null, obstructionConfirmed: true, acknowledged: false, images: [{label: 'back', shortEdgePx: 1200}]},
    });
  });

  it('still requires a description of a confirmed request that is not direct', async () => {
    await expect(readProjectRequest(operation, PROJECT, fake({...directRow, mode: 'evidence_images', acknowledged: false, acknowledged_at: null}).options)).rejects.toBeInstanceOf(AccountsUnavailableError);
    await expect(readProjectRequest(operation, PROJECT, fake({...revisionRow, description: null}).options)).rejects.toBeInstanceOf(AccountsUnavailableError);
  });

  it.each([
    ['a label with no measurements', {images: [imageRow(1, UPLOAD_1, SHA_1, {label: 'front'})]}],
    ['measurements with no label', {images: [imageRow(1, UPLOAD_1, SHA_1, {short_edge_px: 800, blur_variance: 100, clipped_fraction: 0.1})]}],
    ['a label that is not one of the seven', {images: [measuredImage(1, UPLOAD_1, SHA_1, 'side')]}],
    ['a short edge of 0', {images: [measuredImage(1, UPLOAD_1, SHA_1, 'front', {short_edge_px: 0})]}],
    ['a short edge that is not whole', {images: [measuredImage(1, UPLOAD_1, SHA_1, 'front', {short_edge_px: 800.5})]}],
    ['a negative blur', {images: [measuredImage(1, UPLOAD_1, SHA_1, 'front', {blur_variance: -1})]}],
    ['a blur above what the kernel can give', {images: [measuredImage(1, UPLOAD_1, SHA_1, 'front', {blur_variance: 1040400.001})]}],
    ['a clipped share above 1', {images: [measuredImage(1, UPLOAD_1, SHA_1, 'front', {clipped_fraction: 1.0001})]}],
    ['a clipped share that is text', {images: [measuredImage(1, UPLOAD_1, SHA_1, 'front', {clipped_fraction: '0.1'})]}],
    ['an obstruction flag that disagrees with its time', {obstruction_confirmed: false, obstruction_confirmed_at: REVIEWED_AT}],
    ['an acknowledgment flag that disagrees with its time', {acknowledged: true, acknowledged_at: null}],
    ['no obstruction flag', {obstruction_confirmed: undefined}],
    ['an acknowledgment on a request that is not direct', {mode: 'evidence_images', confirmed: false, confirmed_at: null, scope: null, intended_outcome: null}],
    ['an acknowledgment with no obstruction confirmation', {obstruction_confirmed: false, obstruction_confirmed_at: null}],
    ['an obstruction confirmation on a text request', {mode: 'evidence_text', images: [], acknowledged: false, acknowledged_at: null, description: 'A description', subject_id: 'middot-altar-ramp'}],
  ])('treats %s as no answer at all', async (_name, change) => {
    await expect(readProjectRequest(operation, PROJECT, fake({...directRow, ...change}).options)).rejects.toBeInstanceOf(AccountsUnavailableError);
  });
});

describe('recordPictureReview (Story 2.3)', () => {
  const images = [
    {uploadId: UPLOAD_1, label: 'front' as const, shortEdgePx: 1200, blurVariance: 412.375, clippedFraction: 0.0213},
    {uploadId: UPLOAD_2, label: 'detail' as const, shortEdgePx: 700, blurVariance: 99.5, clippedFraction: 0.4},
  ];
  const direct = {commandId: COMMAND, projectId: PROJECT, expectedSeq: 2, mode: 'image_direct' as const, scope: 'The subject in my pictures', outcome: 'A model from my pictures', images, obstructionConfirmed: true, acknowledge: true};
  const research = {...direct, mode: 'evidence_images' as const, scope: null, outcome: null, acknowledge: false};

  it('sends the Account and epoch of the operation, the command, the revision reviewed, the mode, the confirmed scope and outcome, the pictures in order with their labels and measurements, and the two flags, as the service role', async () => {
    const {sent, options} = fake({outcome: 'created', project_id: PROJECT, request_id: REQUEST, seq: 3, position: null});
    expect(await recordPictureReview(operation, direct, options)).toEqual({outcome: 'created', projectId: PROJECT, requestId: REQUEST, seq: 3});
    expect(sent).toHaveLength(1);
    expect(sent[0].name).toBe('record_picture_review');
    expect(sent[0].body).toEqual({
      p_account_id: ACCOUNT,
      p_epoch: 3,
      p_command_id: COMMAND,
      p_project_id: PROJECT,
      p_expected_seq: 2,
      p_mode: 'image_direct',
      p_scope: 'The subject in my pictures',
      p_outcome: 'A model from my pictures',
      p_images: [
        {upload_id: UPLOAD_1, label: 'front', short_edge_px: 1200, blur_variance: 412.375, clipped_fraction: 0.0213},
        {upload_id: UPLOAD_2, label: 'detail', short_edge_px: 700, blur_variance: 99.5, clipped_fraction: 0.4},
      ],
      p_obstruction_confirmed: true,
      p_acknowledge: true,
    });
    expect(sent[0].headers).toMatchObject({authorization: 'Bearer service-key-for-tests-only', 'content-profile': 'api'});
  });

  it('sends no scope and no outcome for research-assisted, and sends nothing that is a verdict, an approval, a permission or a payment', async () => {
    const {sent, options} = fake({outcome: 'created', project_id: PROJECT, request_id: REQUEST, seq: 3});
    await recordPictureReview(operation, research, options);
    expect(sent[0].body).toMatchObject({p_mode: 'evidence_images', p_scope: null, p_outcome: null, p_acknowledge: false});
    expect(JSON.stringify(sent[0].body)).not.toMatch(/ok|pass|fail|verdict|approv|permission|payment|cost|price/i);
    expect(Object.keys(sent[0].body).sort()).toEqual(['p_account_id', 'p_acknowledge', 'p_command_id', 'p_epoch', 'p_expected_seq', 'p_images', 'p_mode', 'p_obstruction_confirmed', 'p_outcome', 'p_project_id', 'p_scope']);
    for (const image of sent[0].body.p_images as Record<string, unknown>[]) expect(Object.keys(image).sort()).toEqual(['blur_variance', 'clipped_fraction', 'label', 'short_edge_px', 'upload_id']);
  });

  it('lower-cases every ID and reads the revision it made', async () => {
    const {sent, options} = fake({outcome: 'replayed', project_id: PROJECT.toUpperCase(), request_id: REQUEST.toUpperCase(), seq: 3});
    expect(await recordPictureReview(operation, {...direct, commandId: COMMAND.toUpperCase(), projectId: PROJECT.toUpperCase(), images: [{...images[0], uploadId: UPLOAD_1.toUpperCase()}]}, options)).toEqual({outcome: 'replayed', projectId: PROJECT, requestId: REQUEST, seq: 3});
    expect(sent[0].body).toMatchObject({p_command_id: COMMAND, p_project_id: PROJECT});
    expect((sent[0].body.p_images as {upload_id: string}[])[0].upload_id).toBe(UPLOAD_1);
  });

  it('answers unchanged (the same review pressed again after an answer was lost: nothing was recorded) with the Project and the revision that already hold it, and treats one with no revision as no answer', async () => {
    const {sent, options} = fake({outcome: 'unchanged', project_id: PROJECT.toUpperCase(), request_id: REQUEST.toUpperCase(), seq: 3});
    expect(await recordPictureReview(operation, direct, options)).toEqual({outcome: 'unchanged', projectId: PROJECT, requestId: REQUEST, seq: 3});
    expect(sent).toHaveLength(1);
    for (const answer of [{outcome: 'unchanged', project_id: null, request_id: REQUEST, seq: 3}, {outcome: 'unchanged', project_id: PROJECT, request_id: null, seq: 3}, {outcome: 'unchanged', project_id: PROJECT, request_id: REQUEST, seq: 1}]) {
      await expect(recordPictureReview(operation, direct, fake(answer).options), JSON.stringify(answer)).rejects.toBeInstanceOf(AccountsUnavailableError);
    }
  });

  it.each(['reused', 'unavailable', 'not_editable', 'obstruction_not_confirmed', 'acknowledgment_required', 'denied'] as const)('answers %s with nothing else', async (outcome) => {
    expect(await recordPictureReview(operation, direct, fake({outcome, project_id: null, request_id: null, seq: null, position: null}).options)).toEqual({outcome});
  });

  it('answers stale with the latest revision\'s number when the database says it, and with none when it does not', async () => {
    expect(await recordPictureReview(operation, direct, fake({outcome: 'stale', seq: 4}).options)).toEqual({outcome: 'stale', seq: 4});
    expect(await recordPictureReview(operation, direct, fake({outcome: 'stale', seq: null}).options)).toEqual({outcome: 'stale', seq: null});
    await expect(recordPictureReview(operation, direct, fake({outcome: 'stale', seq: 0}).options)).rejects.toBeInstanceOf(AccountsUnavailableError);
  });

  it.each(['unknown_upload', 'not_ready', 'expired_upload', 'not_retained'] as const)('answers %s with the position of the upload, which it must have', async (outcome) => {
    expect(await recordPictureReview(operation, direct, fake({outcome, position: 2}).options)).toEqual({outcome, position: 2});
    for (const position of [null, 0, 3, -1, 1.5, 'one']) {
      await expect(recordPictureReview(operation, direct, fake({outcome, position}).options), String(position)).rejects.toBeInstanceOf(AccountsUnavailableError);
    }
  });

  it.each([
    ['an outcome it does not know', {outcome: 'maybe'}],
    ['a body that is not an object', []],
    ['a success with no Project', {outcome: 'created', project_id: null, request_id: REQUEST, seq: 3}],
    ['a success with no revision', {outcome: 'created', project_id: PROJECT, request_id: null, seq: 3}],
    ['a success with no number', {outcome: 'created', project_id: PROJECT, request_id: REQUEST, seq: null}],
    ['a success that is the first revision (a review is always a successor)', {outcome: 'created', project_id: PROJECT, request_id: REQUEST, seq: 1}],
  ])('treats %s as no answer at all', async (_name, answer) => {
    await expect(recordPictureReview(operation, direct, fake(answer).options)).rejects.toBeInstanceOf(AccountsUnavailableError);
  });

  it('refuses a call that is not shaped like one before asking: pictures, labels, numbers, IDs, the revision and the operation', async () => {
    const {fetch, options} = fake({});
    const twelve = Array.from({length: 12}, (_, index) => ({...images[0], uploadId: `aaaaaaaa-1111-4111-8111-${String(index).padStart(12, '0')}`}));
    const bad: Record<string, Parameters<typeof recordPictureReview>[1]> = {
      'no pictures': {...direct, images: []},
      'thirteen pictures': {...direct, images: [...twelve, {...images[0], uploadId: UPLOAD_1}]},
      'a repeated picture': {...direct, images: [images[0], {...images[1], uploadId: UPLOAD_1.toUpperCase()}]},
      'a picture that is no ID': {...direct, images: [{...images[0], uploadId: 'nope'}]},
      'a label that is not one of the seven': {...direct, images: [{...images[0], label: 'side' as never}]},
      'a short edge of 0': {...direct, images: [{...images[0], shortEdgePx: 0}]},
      'a short edge that is not whole': {...direct, images: [{...images[0], shortEdgePx: 800.5}]},
      'a negative blur': {...direct, images: [{...images[0], blurVariance: -0.001}]},
      'a blur that is not a number': {...direct, images: [{...images[0], blurVariance: Number.NaN}]},
      'a blur above what the kernel can give': {...direct, images: [{...images[0], blurVariance: 1040401}]},
      'a clipped share above 1': {...direct, images: [{...images[0], clippedFraction: 1.01}]},
      'a clipped share below 0': {...direct, images: [{...images[0], clippedFraction: -0.01}]},
      // On purpose added (review patch D3): the database keeps 3 and 4 decimals, and a number with more is refused before the call rather than rounded there.
      'a blur with more than 3 decimals': {...direct, images: [{...images[0], blurVariance: 412.3751}]},
      'a clipped share with more than 4 decimals': {...direct, images: [{...images[0], clippedFraction: 0.02134}]},
      'a scope for research-assisted reconstruction': {...research, scope: 'The subject'},
      'an outcome for research-assisted reconstruction': {...research, outcome: 'A model'},
      'no scope for direct conversion': {...direct, scope: null},
      'no outcome for direct conversion': {...direct, outcome: null},
      'a mode that is neither picture mode': {...direct, mode: 'evidence_text' as never},
      'a command that is no ID': {...direct, commandId: 'nope'},
      'a Project that is no ID': {...direct, projectId: 'nope'},
      'a revision of 0': {...direct, expectedSeq: 0},
      'a revision that is not whole': {...direct, expectedSeq: 1.5},
    };
    for (const [name, input] of Object.entries(bad)) await expect(recordPictureReview(operation, input, options), name).rejects.toBeInstanceOf(TypeError);
    await expect(recordPictureReview({accountId: 'not-an-id', epoch: 1}, direct, options)).rejects.toBeInstanceOf(TypeError);
    await expect(recordPictureReview({accountId: ACCOUNT, epoch: 0}, direct, options)).rejects.toBeInstanceOf(TypeError);
    expect(fetch).not.toHaveBeenCalled();
    // Twelve is the most that is accepted.
    await recordPictureReview(operation, {...direct, images: twelve}, fake({outcome: 'created', project_id: PROJECT, request_id: REQUEST, seq: 3}).options);
    // The most precision that is kept is accepted: 3 decimals of blur, 4 of the clipped share, and the ends of both ranges.
    for (const kept of [{blurVariance: 0.001, clippedFraction: 0.0001}, {blurVariance: 1040400, clippedFraction: 1}, {blurVariance: 0, clippedFraction: 0}, {blurVariance: 99.999, clippedFraction: 0.3501}]) {
      await recordPictureReview(operation, {...direct, images: [{...images[0], ...kept}]}, fake({outcome: 'created', project_id: PROJECT, request_id: REQUEST, seq: 3}).options);
    }
  });

  it('throws, and does not say nothing was recorded, when the database cannot be reached or answers an error: the review may have been recorded', async () => {
    await expect(recordPictureReview(operation, direct, {env, fetch: async () => { throw new TypeError('fetch failed'); }})).rejects.toMatchObject({name: 'AccountsUnavailableError', retryable: true});
    await expect(recordPictureReview(operation, direct, fake({code: '22023'}, 400).options)).rejects.toMatchObject({name: 'AccountsUnavailableError', outcomeUnknown: false});
    await expect(recordPictureReview(operation, direct, fake({}, 500).options)).rejects.toMatchObject({name: 'AccountsUnavailableError', outcomeUnknown: true});
  });
});

// Retained pictures (Story 2.12) ---------------------------------------------------------------------------------------------------

describe('checkPictureRetention (Story 2.12)', () => {
  const UPLOADS = ['aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa', 'bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb', 'cccccccc-3333-4333-8333-cccccccccccc'];
  const ROOT = 'ab'.repeat(32);
  const input = {projectId: PROJECT, expectedSeq: 2, uploadIds: UPLOADS};
  const blank = {seq: null, position: null, kept: null, asked: null, pictures: null};
  const checked = (actions: ('attach' | 'retained')[]) => ({
    ...blank,
    outcome: 'checked',
    pictures: actions.map((action, index) => ({position: index + 1, upload_id: UPLOADS[index], action, root: action === 'retained' ? ROOT : null})),
  });

  it('asks as the service role for the Account and epoch of the operation, the Project, the revision expected and the uploads in order, and nothing a request chose', async () => {
    const {sent, options} = fake(checked(['attach', 'retained', 'attach']));
    await checkPictureRetention(operation, input, options);
    expect(sent).toEqual([
      expect.objectContaining({name: 'check_picture_retention', body: {p_account_id: ACCOUNT, p_epoch: 3, p_project_id: PROJECT, p_expected_seq: 2, p_upload_ids: UPLOADS}}),
    ]);
    expect(sent[0].headers).toMatchObject({authorization: 'Bearer service-key-for-tests-only', 'content-profile': 'api'});
  });

  it('reads, per position, whether a picture needs an attach or is retained (with its root, which only the server reads)', async () => {
    expect(await checkPictureRetention(operation, input, fake(checked(['attach', 'retained', 'attach'])).options)).toEqual({
      outcome: 'checked',
      pictures: [
        {position: 1, uploadId: UPLOADS[0], action: 'attach', root: null},
        {position: 2, uploadId: UPLOADS[1], action: 'retained', root: ROOT},
        {position: 3, uploadId: UPLOADS[2], action: 'attach', root: null},
      ],
    });
  });

  it.each(['unavailable', 'not_editable', 'denied'] as const)('answers %s with nothing else', async (outcome) => {
    expect(await checkPictureRetention(operation, input, fake({...blank, outcome}).options)).toEqual({outcome});
  });

  it('answers stale with the latest revision\'s number when the database says it, and with none when it does not', async () => {
    expect(await checkPictureRetention(operation, input, fake({...blank, outcome: 'stale', seq: 4}).options)).toEqual({outcome: 'stale', seq: 4});
    expect(await checkPictureRetention(operation, input, fake({...blank, outcome: 'stale'}).options)).toEqual({outcome: 'stale', seq: null});
    await expect(checkPictureRetention(operation, input, fake({...blank, outcome: 'stale', seq: 0}).options)).rejects.toBeInstanceOf(AccountsUnavailableError);
  });

  it.each(['unknown_upload', 'not_ready', 'expired_upload'] as const)('answers %s with the position of the upload, which it must have', async (outcome) => {
    expect(await checkPictureRetention(operation, input, fake({...blank, outcome, position: 2}).options)).toEqual({outcome, position: 2});
    for (const position of [null, 0, 4, -1, 1.5, 'one']) {
      await expect(checkPictureRetention(operation, input, fake({...blank, outcome, position}).options), String(position)).rejects.toBeInstanceOf(AccountsUnavailableError);
    }
  });

  it('answers quota_exceeded with the bytes kept and the bytes asked, which it must have', async () => {
    expect(await checkPictureRetention(operation, input, fake({...blank, outcome: 'quota_exceeded', kept: 2_137_000_000, asked: 12_582_912}).options)).toEqual({outcome: 'quota_exceeded', kept: 2_137_000_000, asked: 12_582_912});
    for (const [kept, asked] of [[null, 5], [5, null], [-1, 5], [5, 1.5], ['5', 5]]) {
      await expect(checkPictureRetention(operation, input, fake({...blank, outcome: 'quota_exceeded', kept, asked}).options), `${kept} ${asked}`).rejects.toBeInstanceOf(AccountsUnavailableError);
    }
  });

  it.each([
    ['an outcome it does not know', {...blank, outcome: 'maybe'}],
    ['a body that is not an object', []],
    ['no pictures for a checked answer', {...blank, outcome: 'checked'}],
    ['fewer pictures than uploads', {...checked(['attach', 'attach', 'attach']), pictures: checked(['attach', 'attach', 'attach']).pictures.slice(0, 2)}],
    ['a picture out of place', {...checked(['attach', 'attach', 'attach']), pictures: [...checked(['attach', 'attach', 'attach']).pictures].reverse()}],
    ['a picture of another upload', {...checked(['attach', 'attach', 'attach']), pictures: checked(['attach', 'attach', 'attach']).pictures.map((picture) => ({...picture, upload_id: UPLOADS[0]}))}],
    ['an action it does not know', {...checked(['attach', 'attach', 'attach']), pictures: checked(['attach', 'attach', 'attach']).pictures.map((picture) => ({...picture, action: 'copy'}))}],
    ['a retained picture with no root', {...checked(['retained', 'attach', 'attach']), pictures: checked(['retained', 'attach', 'attach']).pictures.map((picture) => ({...picture, root: null}))}],
    ['a retained picture with a root that is not a digest', {...checked(['retained', 'attach', 'attach']), pictures: checked(['retained', 'attach', 'attach']).pictures.map((picture) => ({...picture, root: picture.action === 'retained' ? 'objects/../x' : null}))}],
    ['a picture to attach that has a root', {...checked(['attach', 'attach', 'attach']), pictures: checked(['attach', 'attach', 'attach']).pictures.map((picture) => ({...picture, root: ROOT}))}],
  ])('treats %s as no answer: the typed call refuses it by throwing', async (_name, answer) => {
    await expect(checkPictureRetention(operation, input, fake(answer).options)).rejects.toBeInstanceOf(AccountsUnavailableError);
  });

  it('refuses arguments the database would never be sent: an expected revision under 1, no or too many or repeated uploads, an upload or Project that is not an ID, an operation that is not one', async () => {
    const {fetch, options} = fake({});
    await expect(checkPictureRetention(operation, {...input, expectedSeq: 0}, options)).rejects.toBeInstanceOf(TypeError);
    await expect(checkPictureRetention(operation, {...input, expectedSeq: 1.5}, options)).rejects.toBeInstanceOf(TypeError);
    await expect(checkPictureRetention(operation, {...input, uploadIds: []}, options)).rejects.toBeInstanceOf(TypeError);
    await expect(checkPictureRetention(operation, {...input, uploadIds: Array.from({length: 13}, (_unused, index) => `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`)}, options)).rejects.toBeInstanceOf(TypeError);
    await expect(checkPictureRetention(operation, {...input, uploadIds: [UPLOADS[0], UPLOADS[0]]}, options)).rejects.toBeInstanceOf(TypeError);
    await expect(checkPictureRetention(operation, {...input, uploadIds: ['nope']}, options)).rejects.toBeInstanceOf(TypeError);
    await expect(checkPictureRetention(operation, {...input, projectId: 'nope'}, options)).rejects.toBeInstanceOf(TypeError);
    await expect(checkPictureRetention({accountId: 'not-an-id', epoch: 1}, input, options)).rejects.toBeInstanceOf(TypeError);
    await expect(checkPictureRetention({accountId: ACCOUNT, epoch: 0}, input, options)).rejects.toBeInstanceOf(TypeError);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('is an error, never a clean answer, when the database cannot be reached or refuses', async () => {
    await expect(checkPictureRetention(operation, input, {env, fetch: async () => { throw new TypeError('fetch failed'); }})).rejects.toMatchObject({name: 'AccountsUnavailableError', retryable: true});
    await expect(checkPictureRetention(operation, input, fake({code: '22023'}, 400).options)).rejects.toMatchObject({name: 'AccountsUnavailableError', outcomeUnknown: false});
    await expect(checkPictureRetention(operation, input, fake({}, 500).options)).rejects.toMatchObject({name: 'AccountsUnavailableError'});
  });
});

describe('readRetainedPictures (Story 2.12)', () => {
  const UPLOAD_1 = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';
  const UPLOAD_2 = 'bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb';
  const ROOT = 'ab'.repeat(32);
  const entry = (position: number, uploadId: string, patch: Record<string, unknown> = {}) => ({
    position,
    upload_id: uploadId,
    root: ROOT,
    retained_sha256: 'cd'.repeat(32),
    retained_length: 480000 + position,
    staged_sha256: 'ef'.repeat(32),
    label: position === 1 ? 'front' : null,
    content_type: 'image/jpeg',
    ...patch,
  });
  const found = (pictures: unknown[]) => ({outcome: 'found', pictures});

  it('asks as the service role for the Account and epoch of the operation and the Project, and nothing a request chose', async () => {
    const {sent, options} = fake(found([entry(1, UPLOAD_1)]));
    await readRetainedPictures(operation, PROJECT, options);
    expect(sent).toEqual([expect.objectContaining({name: 'read_retained_pictures', body: {p_account_id: ACCOUNT, p_epoch: 3, p_project_id: PROJECT}})]);
    expect(sent[0].headers).toMatchObject({authorization: 'Bearer service-key-for-tests-only', 'content-profile': 'api'});
  });

  it('reads the pinned pictures in order, each with its root, the retained digest and length and the staged digest the person confirmed, its label and its type, and nothing else', async () => {
    const read = await readRetainedPictures(operation, PROJECT, fake(found([entry(1, UPLOAD_1), entry(2, UPLOAD_2, {label: 'left', content_type: 'image/png'})])).options);
    expect(read).toEqual({
      outcome: 'found',
      pictures: [
        {position: 1, uploadId: UPLOAD_1, root: ROOT, retainedSha256: 'cd'.repeat(32), retainedLength: 480001, stagedSha256: 'ef'.repeat(32), label: 'front', contentType: 'image/jpeg'},
        {position: 2, uploadId: UPLOAD_2, root: ROOT, retainedSha256: 'cd'.repeat(32), retainedLength: 480002, stagedSha256: 'ef'.repeat(32), label: 'left', contentType: 'image/png'},
      ],
    });
    // The pictures of a revision that pins only some of them keep their own positions.
    const gap = await readRetainedPictures(operation, PROJECT, fake(found([entry(2, UPLOAD_2), entry(5, UPLOAD_1)])).options);
    expect(gap.outcome === 'found' && gap.pictures.map((picture) => picture.position)).toEqual([2, 5]);
  });

  it.each(['none', 'unavailable', 'denied'] as const)('answers %s with nothing else', async (outcome) => {
    expect(await readRetainedPictures(operation, PROJECT, fake({outcome, pictures: []}).options)).toEqual({outcome});
  });

  it('is unavailable for anything that is not a Project ID, without asking the database', async () => {
    const {fetch, options} = fake({});
    for (const id of ['not-an-id', '', 5, null, undefined, ` ${PROJECT}`]) expect(await readRetainedPictures(operation, id, options), String(id)).toEqual({outcome: 'unavailable'});
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([
    ['an outcome it does not know', {outcome: 'maybe'}],
    ['a body that is not an object', []],
    ['found with no pictures', {outcome: 'found', pictures: []}],
    ['found with pictures that are not a list', {outcome: 'found', pictures: 'x'}],
    ['more than twelve pictures', found(Array.from({length: 13}, (_unused, index) => entry(index + 1, `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`)))],
    ['positions that do not rise', found([entry(2, UPLOAD_1), entry(1, UPLOAD_2)])],
    ['a position of zero', found([entry(0, UPLOAD_1)])],
    ['an upload that is not an ID', found([entry(1, 'nope')])],
    ['a root that is not a digest', found([entry(1, UPLOAD_1, {root: 'objects/../x'})])],
    ['a retained digest that is not one', found([entry(1, UPLOAD_1, {retained_sha256: 'x'})])],
    ['a staged digest that is not one', found([entry(1, UPLOAD_1, {staged_sha256: 'AB'.repeat(32)})])],
    ['a retained length of zero', found([entry(1, UPLOAD_1, {retained_length: 0})])],
    ['a retained length that is not a number', found([entry(1, UPLOAD_1, {retained_length: '5'})])],
    ['a type a picture cannot have', found([entry(1, UPLOAD_1, {content_type: 'image/gif'})])],
    ['a label it does not know', found([entry(1, UPLOAD_1, {label: 'inside'})])],
  ])('treats %s as no answer: the typed call refuses it by throwing', async (_name, answer) => {
    await expect(readRetainedPictures(operation, PROJECT, fake(answer).options)).rejects.toBeInstanceOf(AccountsUnavailableError);
  });

  it('is an error, never an empty answer, when the database cannot be reached', async () => {
    await expect(readRetainedPictures(operation, PROJECT, {env, fetch: async () => { throw new TypeError('fetch failed'); }})).rejects.toMatchObject({name: 'AccountsUnavailableError', retryable: true});
  });
});
