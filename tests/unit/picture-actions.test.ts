import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';

// The two picture Server Actions (Story 2.2) with a fake Auth client, a fake accounts database and a fake redirect. withActiveAccount and resolveAccess are the
// real ones, so who may save or discard, what the actions take from the verified session instead of from the form, and what they print, is what the browser
// would see. The commands themselves are faked. The form carries a command, a Project (or none) and the upload IDs in order: never an Account, an epoch, a
// title, or the bytes of a picture.
class Redirected extends Error {
  readonly to: string;
  constructor(to: string) {
    super(`redirect to ${to}`);
    this.to = to;
  }
}
const order = vi.hoisted(() => [] as string[]);
const language = vi.hoisted(() => ({locale: 'en' as 'en' | 'he'}));
const mocks = vi.hoisted(() => ({
  createSupabaseServerClient: vi.fn(),
  authorizeSession: vi.fn(),
  recordPictureSet: vi.fn(),
  releaseStagedPictures: vi.fn(),
}));
vi.mock('next/navigation', () => ({
  redirect: (to: string) => {
    order.push(`redirect:${to}`);
    throw new Redirected(to);
  },
}));
vi.mock('next/headers', () => ({cookies: async () => ({getAll: () => [], get: () => undefined, set: () => undefined, delete: () => undefined})}));
vi.mock('@/lib/supabase/server', async (importOriginal) => ({...(await importOriginal<typeof import('@/lib/supabase/server')>()), createSupabaseServerClient: mocks.createSupabaseServerClient}));
vi.mock('@/lib/accounts', async (importOriginal) => ({...(await importOriginal<typeof import('@/lib/accounts')>()), authorizeSession: mocks.authorizeSession}));
vi.mock('@/lib/projects', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/projects')>()),
  recordPictureSet: mocks.recordPictureSet,
  releaseStagedPictures: mocks.releaseStagedPictures,
}));
// The language of the request: the catalog's title of a new Project is read in it.
vi.mock('@/lib/i18n/server', async () => {
  const {createTranslator, directionOf} = await import('@/lib/i18n');
  return {
    getI18n: async () => {
      order.push('getI18n');
      return {locale: language.locale, dir: directionOf(language.locale), t: createTranslator(language.locale)};
    },
  };
});

import {discardPictures, savePictureSet} from '@/app/projects/new/pictures/actions';
import {AccountsConfigError, AccountsUnavailableError} from '@/lib/accounts';
import {translate} from '@/lib/i18n';
import {saveIdle} from '@/lib/picture-view';
import {sessionReader} from '../support/access-token';

const USER = '5f0d6c1e-8a52-4c1b-9d57-2b6a1f0e7c44';
const SESSION = '3b1c9a3e-6a3e-4f19-9d0e-0a4f5e2c8d11';
const ACCOUNT = '7a1b2c3d-4e5f-4a6b-8c7d-0e1f2a3b4c5d';
const OTHER_ACCOUNT = 'aa1b2c3d-4e5f-4a6b-8c7d-0e1f2a3b4caa';
const PROJECT = '9d8c7b6a-5f4e-4d3c-8b2a-1f0e9d8c7b6a';
const REQUEST = '0a0b0c0d-1e1f-4a2a-8b3b-4c4c5d5d6e6e';
const COMMAND = '11111111-2222-4333-8444-555555555555';
const UPLOADS = ['aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa', 'bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb', 'cccccccc-3333-4333-8333-cccccccccccc'];
const HOSTED = 'https://abcdefgh.supabase.co';
// The moment of the save, fixed (only the clock is faked): a new Project's title carries its UTC date, and a save just before midnight must not make the test flaky.
const SAVED_AT = new Date('2026-10-19T23:59:58Z');
const SAVED_DATE = '2026-10-19';
/** The title the catalog makes of a new Project in a language, with the date of the save and no direction control around it. */
const titleIn = (locale: 'en' | 'he') => translate(locale, 'picture.projectTitle', {date: SAVED_DATE}, {isolate: false});
const googleUser = {id: USER, email: 'person@example.com', email_confirmed_at: '2026-10-10T00:00:00Z', is_anonymous: false, app_metadata: {provider: 'google', providers: ['google']}};

type Fields = Record<string, string | string[]>;
const form = (fields: Fields) => {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) for (const one of Array.isArray(value) ? value : [value]) data.append(name, one);
  return data;
};
/** What the screen sends to save a new set: no Project. */
const saving: Fields = {commandId: COMMAND, projectId: '', uploadId: UPLOADS};
/** What it sends to change the pictures of a Project. */
const changing: Fields = {commandId: COMMAND, projectId: PROJECT, uploadId: UPLOADS};
const save = (fields: Fields = saving) => savePictureSet(saveIdle, form(fields));
const redirected = async (work: Promise<unknown>) => {
  try {
    await work;
  } catch (error) {
    if (error instanceof Redirected) return error.to;
    throw error;
  }
  return null;
};
const receipt = (outcome: string, extra: Record<string, unknown> = {}) => ({outcome, projectId: PROJECT, requestId: REQUEST, seq: 1, released: 0, ...extra});
const authorizationIs = (state: string, epoch = 4) =>
  mocks.authorizeSession.mockImplementation(async () => {
    order.push('authorizeSession');
    return state === 'active'
      ? {state, accountId: ACCOUNT, workspaceId: null, role: 'member', epoch, preferences: null}
      : {state, accountId: null, workspaceId: null, role: null, epoch: null, preferences: null};
  });
const printed = () => [console.log, console.info, console.warn, console.error, console.debug].flatMap((method) => vi.mocked(method).mock.calls.flat().map((value) => (typeof value === 'string' ? value : JSON.stringify(value) ?? String(value))));

beforeEach(() => {
  vi.useFakeTimers({toFake: ['Date']});
  vi.setSystemTime(SAVED_AT);
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', HOSTED);
  language.locale = 'en';
  order.length = 0;
  const getUser = vi.fn(async () => ({data: {user: googleUser}, error: null}));
  mocks.createSupabaseServerClient.mockReset().mockImplementation(async () => ({auth: {getUser, signOut: vi.fn(), ...sessionReader(USER, SESSION)}}));
  mocks.authorizeSession.mockReset();
  authorizationIs('active');
  mocks.recordPictureSet.mockReset().mockImplementation(async () => {
    order.push('recordPictureSet');
    return receipt('created');
  });
  mocks.releaseStagedPictures.mockReset().mockImplementation(async (_operation: unknown, ids: string[]) => {
    order.push('releaseStagedPictures');
    return {outcome: 'released', released: ids.length};
  });
  for (const method of ['log', 'info', 'warn', 'error', 'debug'] as const) vi.spyOn(console, method).mockImplementation(() => undefined);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('savePictureSet records the pictures the form lists, in its order, and goes to the Project', () => {
  it('creates a Project when the form names none: the command, no Project, the catalog\'s title with the date of the save, and the uploads in order', async () => {
    expect(await redirected(save())).toBe(`/projects/${PROJECT}`);
    expect(mocks.recordPictureSet).toHaveBeenCalledTimes(1);
    const [operation, input] = mocks.recordPictureSet.mock.calls[0];
    expect(operation).toEqual({accountId: ACCOUNT, epoch: 4});
    expect(input).toEqual({commandId: COMMAND, projectId: null, title: titleIn('en'), uploadIds: UPLOADS});
    expect(input.title).toBe('Picture request 2026-10-19');
    expect(order).toEqual(['authorizeSession', 'getI18n', 'recordPictureSet', `redirect:/projects/${PROJECT}`]);
  });

  it('writes the title of a new Project in the person\'s language, with the UTC date of the save (the date of the moment, not of a clock that already moved on) and no direction control', async () => {
    language.locale = 'he';
    await redirected(save());
    const title = mocks.recordPictureSet.mock.calls[0][1].title as string;
    expect(title).toBe(titleIn('he'));
    expect(title).not.toBe(titleIn('en'));
    expect(title).toContain(SAVED_DATE);
    // A title is the person's text: no isolate or other direction control comes from the catalog (the date is a placeholder, and a placeholder is not isolated).
    expect(title).not.toMatch(/[\u2066-\u2069\u202a-\u202e]/);
  });

  it('dates the title by the UTC day, whatever the day is where the server runs', async () => {
    vi.setSystemTime(new Date('2026-12-31T23:59:59.999Z'));
    await redirected(save());
    expect(mocks.recordPictureSet.mock.calls[0][1].title).toBe('Picture request 2026-12-31');
    vi.setSystemTime(new Date('2027-01-01T00:00:00.000Z'));
    await redirected(save());
    expect(mocks.recordPictureSet.mock.calls[1][1].title).toBe('Picture request 2027-01-01');
  });

  it('appends a successor to the Project the form names, with no title and without reading the language', async () => {
    mocks.recordPictureSet.mockResolvedValue(receipt('revised', {seq: 2, released: 1}));
    expect(await redirected(save(changing))).toBe(`/projects/${PROJECT}`);
    expect(mocks.recordPictureSet.mock.calls[0][1]).toEqual({commandId: COMMAND, projectId: PROJECT, title: null, uploadIds: UPLOADS});
    expect(order).not.toContain('getI18n');
  });

  it('keeps the order the form lists, whatever the IDs are, and lower-cases an ID', async () => {
    const reversed = [...UPLOADS].reverse();
    await redirected(save({...saving, uploadId: reversed}));
    expect(mocks.recordPictureSet.mock.calls[0][1].uploadIds).toEqual(reversed);
    await redirected(save({...saving, uploadId: [UPLOADS[0].toUpperCase()], commandId: COMMAND.toUpperCase()}));
    expect(mocks.recordPictureSet.mock.calls[1][1]).toMatchObject({uploadIds: [UPLOADS[0]], commandId: COMMAND});
  });

  it.each(['created', 'revised', 'replayed', 'unchanged'])('goes to the Project on %s', async (outcome) => {
    mocks.recordPictureSet.mockResolvedValue(receipt(outcome));
    expect(await redirected(save(outcome === 'created' ? saving : changing))).toBe(`/projects/${PROJECT}`);
  });

  it('takes the Account and the epoch from the verified session, and nothing about either from the form', async () => {
    await redirected(save({...saving, accountId: OTHER_ACCOUNT, account_id: OTHER_ACCOUNT, epoch: '99', workspaceId: OTHER_ACCOUNT}));
    expect(mocks.recordPictureSet.mock.calls[0][0]).toEqual({accountId: ACCOUNT, epoch: 4});
    expect(JSON.stringify(mocks.recordPictureSet.mock.calls[0])).not.toContain(OTHER_ACCOUNT);
  });

  it('takes no title, mode, subject, scope, approval or cost from the form: the call carries the command, the Project, a title of its own and the uploads', async () => {
    await redirected(save({...saving, title: 'A title the client made up', mode: 'image_direct', subjectId: 'middot-altar-ramp', scope: 'x', approved: 'yes', maxCost: '5'}));
    const [, input] = mocks.recordPictureSet.mock.calls[0];
    expect(Object.keys(input).sort()).toEqual(['commandId', 'projectId', 'title', 'uploadIds']);
    expect(input.title).toBe(titleIn('en'));
    expect(JSON.stringify(input)).not.toMatch(/made up|image_direct|middot|approved|maxCost/);
  });

  it('sends the same command again when the person presses Save again: the command ID is the form\'s, not the action\'s', async () => {
    await redirected(save());
    await redirected(save());
    expect(mocks.recordPictureSet.mock.calls.map((call) => call[1].commandId)).toEqual([COMMAND, COMMAND]);
  });

  it('carries no image body: the form holds IDs and nothing else, and a file in it is not read', async () => {
    const data = form(saving);
    data.append('picture', new File([new Uint8Array(10_000)], 'photo.jpg', {type: 'image/jpeg'}));
    await redirected(savePictureSet(saveIdle, data));
    expect(JSON.stringify(mocks.recordPictureSet.mock.calls[0])).not.toMatch(/photo\.jpg|picture/);
  });
});

describe('savePictureSet reads a form that is the screen\'s, and refuses one that is not', () => {
  it.each([
    ['no command ID', {commandId: ''}],
    ['a command ID that is not one', {commandId: '123'}],
    ['a command ID with a new line after it', {commandId: `${COMMAND}\n`}],
    ['a Project ID that is not one', {projectId: 'nope'}],
    ['a Project ID with a space', {projectId: ` ${PROJECT}`}],
    ['no uploads', {uploadId: []}],
    ['an upload ID that is not one', {uploadId: [UPLOADS[0], 'nope']}],
    ['an upload ID with white space around it', {uploadId: [` ${UPLOADS[0]}`]}],
    ['a repeated upload ID', {uploadId: [UPLOADS[0], UPLOADS[1], UPLOADS[0].toUpperCase()]}],
    ['thirteen uploads', {uploadId: Array.from({length: 13}, (_, index) => `aaaaaaaa-1111-4111-8111-${String(index).padStart(12, '0')}`)}],
  ])('is invalid for %s: nothing to point at and nothing saved', async (_name, change) => {
    expect(await save({...saving, ...change})).toEqual({outcome: 'invalid'});
    expect(mocks.recordPictureSet).not.toHaveBeenCalled();
  });

  it('accepts twelve uploads, and an empty Project field as "a new Project"', async () => {
    const twelve = Array.from({length: 12}, (_, index) => `aaaaaaaa-1111-4111-8111-${String(index).padStart(12, '0')}`);
    await redirected(save({...saving, uploadId: twelve}));
    expect(mocks.recordPictureSet.mock.calls[0][1]).toMatchObject({projectId: null, uploadIds: twelve});
  });

  it('is invalid for a form with nothing in it, and for a form with no Project field at all (a new Project)', async () => {
    expect(await savePictureSet(saveIdle, new FormData())).toEqual({outcome: 'invalid'});
    await redirected(save({commandId: COMMAND, uploadId: UPLOADS}));
    expect(mocks.recordPictureSet.mock.calls[0][1]).toMatchObject({projectId: null});
  });
});

describe('the other answers of Save', () => {
  it.each(['unknown_upload', 'not_ready', 'expired_upload', 'duplicate_image'])('says which picture %s is, by its position, and saved nothing', async (outcome) => {
    mocks.recordPictureSet.mockResolvedValue({outcome, position: 2});
    expect(await save()).toEqual({outcome, position: 2});
    expect(order.filter((step) => step.startsWith('redirect:'))).toEqual([]);
  });

  it.each(['too_large', 'reused', 'not_editable'])('says %s with nothing else, and saved nothing', async (outcome) => {
    mocks.recordPictureSet.mockResolvedValue({outcome});
    expect(await save()).toEqual({outcome});
  });

  it('says a Project that is not there (another Account\'s, deleted, unknown, or a replay whose Project has gone) is gone: a message, not a redirect', async () => {
    mocks.recordPictureSet.mockResolvedValue({outcome: 'unavailable'});
    expect(await save(changing)).toEqual({outcome: 'gone'});
    expect(order.filter((step) => step.startsWith('redirect:'))).toEqual([]);
  });

  it('sends the person Home, with nothing saved, when the database no longer gives this request authority', async () => {
    mocks.recordPictureSet.mockResolvedValue({outcome: 'denied'});
    expect(await redirected(save())).toBe('/');
  });
});

describe('authority lost mid-request is refused at the gate (the function refuses it again)', () => {
  it.each(['disabled', 'revoked', 'stale_epoch', 'expired', 'idle', 'no_session', 'no_grant', 'subject_mismatch'])('sends a %s session where any private request goes, for both actions, and records nothing', async (state) => {
    authorizationIs(state);
    expect(await redirected(save())).toMatch(/^\/login/);
    expect(await redirected(discardPictures(form({uploadId: UPLOADS})))).toMatch(/^\/login/);
    expect(mocks.recordPictureSet).not.toHaveBeenCalled();
    expect(mocks.releaseStagedPictures).not.toHaveBeenCalled();
  });

  it('sends a person with no Account to register', async () => {
    authorizationIs('unregistered');
    expect(await redirected(save())).toBe('/register');
    expect(mocks.recordPictureSet).not.toHaveBeenCalled();
  });

  it('answers "nothing was saved", retryable, when the check itself could not be made', async () => {
    mocks.authorizeSession.mockRejectedValue(new AccountsUnavailableError('The accounts database did not answer.', {retryable: true}));
    expect(await save()).toEqual({outcome: 'unavailable', unknown: false});
    expect(mocks.recordPictureSet).not.toHaveBeenCalled();
  });
});

describe('an outage while saving', () => {
  it('tells the person to check My Projects first when the call may have reached the database', async () => {
    mocks.recordPictureSet.mockRejectedValue(new AccountsUnavailableError('The accounts database did not answer.', {retryable: true, outcomeUnknown: true}));
    expect(await save()).toEqual({outcome: 'unavailable', unknown: true});
  });

  it('says nothing was saved only when the request certainly did not get through', async () => {
    mocks.recordPictureSet.mockRejectedValue(new AccountsUnavailableError('The accounts database refused the call (HTTP 400).', {status: 400, retryable: false, outcomeUnknown: false}));
    expect(await save()).toEqual({outcome: 'unavailable', unknown: false});
    mocks.recordPictureSet.mockRejectedValue(new AccountsConfigError('SUPABASE_SERVICE_ROLE_KEY is not set'));
    expect(await save()).toEqual({outcome: 'unavailable', unknown: false});
  });

  it('treats an answer that makes no sense, and any other error, as possibly saved', async () => {
    mocks.recordPictureSet.mockRejectedValue(new AccountsUnavailableError('The accounts database answered with an unexpected shape.', {retryable: false, outcomeUnknown: true}));
    expect(await save()).toEqual({outcome: 'unavailable', unknown: true});
    mocks.recordPictureSet.mockRejectedValue(new TypeError('surprise'));
    expect(await save()).toEqual({outcome: 'unavailable', unknown: true});
  });

  it('retries with the same command ID, so a retry makes at most one Project and one revision', async () => {
    mocks.recordPictureSet.mockRejectedValueOnce(new AccountsUnavailableError('The accounts database did not answer.', {retryable: true, outcomeUnknown: true}));
    expect(await save()).toEqual({outcome: 'unavailable', unknown: true});
    expect(await redirected(save())).toBe(`/projects/${PROJECT}`);
    expect(mocks.recordPictureSet.mock.calls.map((call) => call[1].commandId)).toEqual([COMMAND, COMMAND]);
    expect(mocks.recordPictureSet.mock.calls.map((call) => call[1].uploadIds)).toEqual([UPLOADS, UPLOADS]);
  });

  it('prints a name and a message only: never an ID, a title or an upload', async () => {
    mocks.recordPictureSet.mockRejectedValue(new AccountsUnavailableError('The accounts database did not answer.', {retryable: true}));
    await save(changing);
    const lines = printed();
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) {
      for (const secret of [PROJECT, COMMAND, ACCOUNT, ...UPLOADS, 'person@example.com', titleIn('en')]) expect(line).not.toContain(secret);
    }
    expect(lines.join(' ')).toContain('AccountsUnavailableError: The accounts database did not answer.');
  });

  it('prints nothing at all when saving works', async () => {
    await redirected(save());
    expect(printed()).toEqual([]);
  });
});

describe('discardPictures releases uploads that were never saved, silently', () => {
  const discard = (fields: Fields = {uploadId: [UPLOADS[0]]}) => discardPictures(form(fields));

  it('releases exactly the uploads the form lists, for the verified Account and epoch', async () => {
    expect(await discard({uploadId: [UPLOADS[1], UPLOADS[0]], accountId: OTHER_ACCOUNT})).toBeUndefined();
    expect(mocks.releaseStagedPictures).toHaveBeenCalledTimes(1);
    const [operation, ids] = mocks.releaseStagedPictures.mock.calls[0];
    expect(operation).toEqual({accountId: ACCOUNT, epoch: 4});
    expect(ids).toEqual([UPLOADS[1], UPLOADS[0]]);
    expect(JSON.stringify(mocks.releaseStagedPictures.mock.calls[0])).not.toContain(OTHER_ACCOUNT);
    expect(order).toEqual(['authorizeSession', 'releaseStagedPictures']);
  });

  it('answers nothing, whatever the database says, and does not redirect on a denial', async () => {
    mocks.releaseStagedPictures.mockResolvedValue({outcome: 'denied'});
    expect(await discard()).toBeUndefined();
    mocks.releaseStagedPictures.mockResolvedValue({outcome: 'released', released: 0});
    expect(await discard()).toBeUndefined();
    expect(order.filter((step) => step.startsWith('redirect:'))).toEqual([]);
  });

  it('never throws when the release fails: the upload lapses on its own', async () => {
    mocks.releaseStagedPictures.mockRejectedValue(new AccountsUnavailableError('The accounts database did not answer.', {retryable: true, outcomeUnknown: true}));
    await expect(discard()).resolves.toBeUndefined();
    mocks.releaseStagedPictures.mockRejectedValue(new TypeError('surprise'));
    await expect(discard()).resolves.toBeUndefined();
  });

  it('prints a name and a message when a release fails, and never an upload ID', async () => {
    mocks.releaseStagedPictures.mockRejectedValue(new AccountsUnavailableError('The accounts database did not answer.', {retryable: true}));
    await discard({uploadId: UPLOADS});
    for (const line of printed()) for (const id of [...UPLOADS, ACCOUNT]) expect(line).not.toContain(id);
  });

  it.each([
    ['no uploads', {uploadId: []}],
    ['an upload ID that is not one', {uploadId: [UPLOADS[0], 'nope']}],
    ['a repeated upload ID', {uploadId: [UPLOADS[0], UPLOADS[0]]}],
    ['thirteen uploads', {uploadId: Array.from({length: 13}, (_, index) => `aaaaaaaa-1111-4111-8111-${String(index).padStart(12, '0')}`)}],
  ])('ignores a form with %s, and asks the database nothing', async (_name, fields) => {
    await expect(discard(fields)).resolves.toBeUndefined();
    expect(mocks.releaseStagedPictures).not.toHaveBeenCalled();
  });

  it('ignores an empty form', async () => {
    await expect(discardPictures(new FormData())).resolves.toBeUndefined();
    expect(mocks.releaseStagedPictures).not.toHaveBeenCalled();
  });

  it('answers nothing when the check itself could not be made', async () => {
    mocks.authorizeSession.mockRejectedValue(new AccountsUnavailableError('The accounts database did not answer.', {retryable: true}));
    await expect(discard()).resolves.toBeUndefined();
    expect(mocks.releaseStagedPictures).not.toHaveBeenCalled();
  });
});

describe('the actions file', () => {
  const source = readFileSync(resolve(import.meta.dirname, '../../app/projects/new/pictures/actions.ts'), 'utf8');
  const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

  it('is a server file with the two actions and nothing else exported', () => {
    expect(source.trimStart()).toMatch(/^'use server';/);
    expect([...code.matchAll(/^export\s+(?:async\s+)?function\s+(\w+)/gm)].map((match) => match[1])).toEqual(['savePictureSet', 'discardPictures']);
    expect([...code.matchAll(/^export\s/gm)]).toHaveLength(2);
  });

  it('reads only the command, the Project and the uploads from the form', () => {
    expect([...code.matchAll(/formData\.(?:get|getAll)\(['"](\w+)['"]\)/g)].map((match) => match[1])).toEqual(['uploadId', 'commandId', 'projectId']);
    expect(code).not.toMatch(/formData\.get\(['"](?:accountId|epoch|title|mode|approved|permission|payment)/);
  });
});
