import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';

// The Server Action behind the review of the pictures (Story 2.3) with a fake Auth client, a fake accounts database and a fake redirect. withActiveAccount and
// resolveAccess are the real ones, so who may review, what the action takes from the verified session instead of from the form, and what it prints, is what the
// browser would see. The command itself is faked. The form carries a command, a Project, the revision reviewed, the choice, the person's scope and outcome (direct
// only), the two flags, and for each picture its upload, label and three measurements: never an Account, an epoch, a stage, a verdict, a digest or an approval.
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
  recordPictureReview: vi.fn(),
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
vi.mock('@/lib/projects', async (importOriginal) => ({...(await importOriginal<typeof import('@/lib/projects')>()), recordPictureReview: mocks.recordPictureReview}));

import {recordPictureReview} from '@/app/projects/[projectId]/pictures/review/actions';
import {AccountsConfigError, AccountsUnavailableError} from '@/lib/accounts';
import {reviewIdle} from '@/lib/picture-view';
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
const googleUser = {id: USER, email: 'person@example.com', email_confirmed_at: '2026-10-10T00:00:00Z', is_anonymous: false, app_metadata: {provider: 'google', providers: ['google']}};

type Fields = Record<string, string | string[]>;
const form = (fields: Fields) => {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) for (const one of Array.isArray(value) ? value : [value]) data.append(name, one);
  return data;
};
/** What the screen sends to confirm direct conversion of three good pictures. */
const direct: Fields = {
  commandId: COMMAND,
  projectId: PROJECT,
  expectedSeq: '2',
  mode: 'image_direct',
  scope: 'The subject in my pictures',
  outcome: 'A model from my pictures',
  obstruction: 'on',
  uploadId: UPLOADS,
  label: ['front', 'left', 'top'],
  shortEdge: ['1200', '1200', '900'],
  blur: ['412.375', '100', '99.5'],
  clipped: ['0.0213', '0.35', '0'],
};
/** And to choose research-assisted reconstruction: no scope, no outcome. */
const research: Fields = {...direct, mode: 'evidence_images', scope: [] as never, outcome: [] as never};
const review = (fields: Fields = direct) => recordPictureReview(reviewIdle, form(fields));
const redirected = async (work: Promise<unknown>) => {
  try {
    await work;
  } catch (error) {
    if (error instanceof Redirected) return error.to;
    throw error;
  }
  return null;
};
const receipt = (outcome: string, extra: Record<string, unknown> = {}) => ({outcome, projectId: PROJECT, requestId: REQUEST, seq: 3, ...extra});
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
  order.length = 0;
  const getUser = vi.fn(async () => ({data: {user: googleUser}, error: null}));
  mocks.createSupabaseServerClient.mockReset().mockImplementation(async () => ({auth: {getUser, signOut: vi.fn(), ...sessionReader(USER, SESSION)}}));
  mocks.authorizeSession.mockReset();
  authorizationIs('active');
  mocks.recordPictureReview.mockReset().mockImplementation(async () => {
    order.push('recordPictureReview');
    return receipt('created');
  });
  for (const method of ['log', 'info', 'warn', 'error', 'debug'] as const) vi.spyOn(console, method).mockImplementation(() => undefined);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('recordPictureReview records the review the form describes, and goes to the Project', () => {
  it('sends the verified Account and epoch, the command, the Project, the revision reviewed, the mode, the person\'s scope and outcome, the pictures in order with their labels and measurements, and both flags', async () => {
    expect(await redirected(review())).toBe(`/projects/${PROJECT}`);
    expect(mocks.recordPictureReview).toHaveBeenCalledTimes(1);
    const [operation, input] = mocks.recordPictureReview.mock.calls[0];
    expect(operation).toEqual({accountId: ACCOUNT, epoch: 4});
    expect(input).toEqual({
      commandId: COMMAND,
      projectId: PROJECT,
      expectedSeq: 2,
      mode: 'image_direct',
      scope: 'The subject in my pictures',
      outcome: 'A model from my pictures',
      images: [
        {uploadId: UPLOADS[0], label: 'front', shortEdgePx: 1200, blurVariance: 412.375, clippedFraction: 0.0213},
        {uploadId: UPLOADS[1], label: 'left', shortEdgePx: 1200, blurVariance: 100, clippedFraction: 0.35},
        {uploadId: UPLOADS[2], label: 'top', shortEdgePx: 900, blurVariance: 99.5, clippedFraction: 0},
      ],
      obstructionConfirmed: true,
      acknowledge: false,
    });
    expect(order).toEqual(['authorizeSession', 'recordPictureReview', `redirect:/projects/${PROJECT}`]);
  });

  it('records the Generate anyway acknowledgment only for direct conversion, as the form says, and decides nothing about whether it was needed', async () => {
    await redirected(review({...direct, acknowledge: 'on'}));
    expect(mocks.recordPictureReview.mock.calls[0][1]).toMatchObject({mode: 'image_direct', acknowledge: true});
    // For research-assisted reconstruction an acknowledgment in the form is not carried: there is nothing to acknowledge.
    await redirected(review({...research, acknowledge: 'on'}));
    expect(mocks.recordPictureReview.mock.calls[1][1]).toMatchObject({mode: 'evidence_images', acknowledge: false});
  });

  it('sends no scope and no outcome for research-assisted reconstruction, even when the form carries some', async () => {
    await redirected(review({...research, scope: 'A scope the client made up', outcome: 'An outcome the client made up'}));
    const [, input] = mocks.recordPictureReview.mock.calls[0];
    expect(input).toMatchObject({mode: 'evidence_images', scope: null, outcome: null});
    expect(JSON.stringify(input)).not.toMatch(/made up/);
  });

  it('reads the scope and outcome as Story 2.1 does: a textarea\'s line ends and the white space around them are not kept', async () => {
    await redirected(review({...direct, scope: '  The altar  ', outcome: '\tA model\t'}));
    expect(mocks.recordPictureReview.mock.calls[0][1]).toMatchObject({scope: 'The altar', outcome: 'A model'});
  });

  it('records the obstruction question as unanswered unless the box is on', async () => {
    await redirected(review({...direct, obstruction: 'off'}));
    expect(mocks.recordPictureReview.mock.calls[0][1]).toMatchObject({obstructionConfirmed: false});
    const { obstruction: _removed, ...without } = direct;
    await redirected(review(without));
    expect(mocks.recordPictureReview.mock.calls[1][1]).toMatchObject({obstructionConfirmed: false});
  });

  it('takes the Account and the epoch from the verified session, and nothing about either from the form', async () => {
    await redirected(review({...direct, accountId: OTHER_ACCOUNT, account_id: OTHER_ACCOUNT, epoch: '99', workspaceId: OTHER_ACCOUNT}));
    expect(mocks.recordPictureReview.mock.calls[0][0]).toEqual({accountId: ACCOUNT, epoch: 4});
    expect(JSON.stringify(mocks.recordPictureReview.mock.calls[0])).not.toContain(OTHER_ACCOUNT);
  });

  it('trusts no verdict, stage, digest, length, type, approval or cost from the form: the call carries nothing but what it names', async () => {
    await redirected(review({...direct, ok: 'true', passed: 'true', incomplete: 'false', stage: 'request_confirmed', digest: 'd'.repeat(64), sha256: 'e'.repeat(64), length: '12', contentType: 'image/png', approved: 'yes', permission: 'granted', maxCost: '5'}));
    const [, input] = mocks.recordPictureReview.mock.calls[0];
    expect(Object.keys(input).sort()).toEqual(['acknowledge', 'commandId', 'expectedSeq', 'images', 'mode', 'obstructionConfirmed', 'outcome', 'projectId', 'scope']);
    for (const image of input.images) expect(Object.keys(image).sort()).toEqual(['blurVariance', 'clippedFraction', 'label', 'shortEdgePx', 'uploadId']);
    expect(JSON.stringify(input)).not.toMatch(/request_confirmed|approved|granted|maxCost|image\/png|eeeeeeee|dddddddd/);
  });

  it('sends the same command again when the person presses Confirm again: the command ID is the form\'s, not the action\'s', async () => {
    await redirected(review());
    await redirected(review());
    expect(mocks.recordPictureReview.mock.calls.map((call) => call[1].commandId)).toEqual([COMMAND, COMMAND]);
  });

  it('lower-cases every ID', async () => {
    await redirected(review({...direct, commandId: COMMAND.toUpperCase(), projectId: PROJECT.toUpperCase(), uploadId: UPLOADS.map((id) => id.toUpperCase())}));
    expect(mocks.recordPictureReview.mock.calls[0][1]).toMatchObject({commandId: COMMAND, projectId: PROJECT});
    expect(mocks.recordPictureReview.mock.calls[0][1].images.map((image: {uploadId: string}) => image.uploadId)).toEqual(UPLOADS);
  });

  it.each(['created', 'replayed', 'unchanged'])('goes to the Project on %s', async (outcome) => {
    mocks.recordPictureReview.mockResolvedValue(receipt(outcome));
    expect(await redirected(review())).toBe(`/projects/${PROJECT}`);
  });

  it('goes to the Project, with nothing to say, when the same review is confirmed again under a new command after an answer was lost: it is already recorded', async () => {
    // The first Confirm's answer never arrived; the person reloads, the screen reads the revision the review made (a new expected revision), and Confirm is pressed
    // again under a NEW command ID: the database says `unchanged` and the action sends the person where `created` would have.
    mocks.recordPictureReview.mockResolvedValue(receipt('unchanged'));
    const NEW_COMMAND = 'cccccccc-2222-4222-8222-cccccccccccc';
    expect(await redirected(review({...direct, commandId: NEW_COMMAND, expectedSeq: '3'}))).toBe(`/projects/${PROJECT}`);
    expect(mocks.recordPictureReview.mock.calls[0][1]).toMatchObject({commandId: NEW_COMMAND, expectedSeq: 3});
    expect(printed()).toEqual([]);
  });
});

describe('recordPictureReview reads a form that is the screen\'s, and refuses one that is not', () => {
  const without = (...names: string[]): Fields => Object.fromEntries(Object.entries(direct).filter(([name]) => !names.includes(name)));
  it.each([
    ['no command ID', {commandId: ''}],
    ['a command ID that is not one', {commandId: '123'}],
    ['a Project ID that is not one', {projectId: 'nope'}],
    ['a Project ID with a space', {projectId: ` ${PROJECT}`}],
    ['no revision', {expectedSeq: ''}],
    ['a revision of 0', {expectedSeq: '0'}],
    ['a revision that is not a number', {expectedSeq: 'two'}],
    ['a revision too large for the database', {expectedSeq: '2000000001'}],
    ['a mode the screen does not offer', {mode: 'evidence_text'}],
    ['no mode', {mode: ''}],
    ['no pictures', {uploadId: [], label: [], shortEdge: [], blur: [], clipped: []}],
    ['thirteen pictures', Object.fromEntries(Object.entries({uploadId: 'aaaaaaaa-1111-4111-8111-', label: 'front', shortEdge: '900', blur: '120', clipped: '0'}).map(([name, value]) => [name, Array.from({length: 13}, (_, index) => (name === 'uploadId' ? `${value}${String(index).padStart(12, '0')}` : value))]))],
    ['an upload ID that is not one', {uploadId: [UPLOADS[0], UPLOADS[1], 'nope']}],
    ['a repeated upload', {uploadId: [UPLOADS[0], UPLOADS[1], UPLOADS[0].toUpperCase()]}],
    ['fewer labels than pictures', {label: ['front', 'left']}],
    ['more measurements than pictures', {blur: ['1', '2', '3', '4']}],
    ['a label that is not one of the seven', {label: ['front', 'left', 'side']}],
    ['an empty label', {label: ['front', 'left', '']}],
    ['a short edge of 0', {shortEdge: ['1200', '1200', '0']}],
    ['a short edge that is not whole', {shortEdge: ['1200', '1200', '900.5']}],
    ['a short edge in exponent form', {shortEdge: ['1200', '1200', '9e2']}],
    ['a blur with four decimals', {blur: ['412.375', '100', '99.5001']}],
    ['a negative blur', {blur: ['412.375', '100', '-1']}],
    ['a blur above what the kernel can give', {blur: ['412.375', '100', '1040401']}],
    ['a clipped share above 1', {clipped: ['0.0213', '0.35', '1.0001']}],
    ['a clipped share with five decimals', {clipped: ['0.0213', '0.35', '0.00001']}],
    ['a clipped share that is a word', {clipped: ['0.0213', '0.35', 'none']}],
  ] as [string, Fields][])('is invalid for %s: nothing to point at and nothing recorded', async (_name, change) => {
    expect(await review({...direct, ...change})).toEqual({outcome: 'invalid', problems: []});
    expect(mocks.recordPictureReview).not.toHaveBeenCalled();
  });

  it('is invalid for a form with nothing in it', async () => {
    expect(await recordPictureReview(reviewIdle, new FormData())).toEqual({outcome: 'invalid', problems: []});
    expect(await review(without('uploadId', 'label', 'shortEdge', 'blur', 'clipped'))).toEqual({outcome: 'invalid', problems: []});
    expect(mocks.recordPictureReview).not.toHaveBeenCalled();
  });

  it('accepts twelve pictures and every value on the edge of its range', async () => {
    const twelve = Array.from({length: 12}, (_, index) => `aaaaaaaa-1111-4111-8111-${String(index).padStart(12, '0')}`);
    await redirected(review({...direct, uploadId: twelve, label: twelve.map(() => 'detail'), shortEdge: twelve.map(() => '1'), blur: twelve.map(() => '1040400'), clipped: twelve.map(() => '1')}));
    expect(mocks.recordPictureReview.mock.calls[0][1].images).toHaveLength(12);
    await redirected(review({...direct, shortEdge: ['999999999', '1', '800'], blur: ['0', '0.001', '1040400'], clipped: ['0', '1', '0.0001']}));
    expect(mocks.recordPictureReview.mock.calls[1][1].images.map((image: {shortEdgePx: number}) => image.shortEdgePx)).toEqual([999999999, 1, 800]);
  });

  it.each([
    ['an empty scope', {scope: ''}, {field: 'scope', problem: 'empty'}],
    ['a scope of white space', {scope: '   \n '}, {field: 'scope', problem: 'empty'}],
    ['a scope of 301 characters', {scope: 'x'.repeat(301)}, {field: 'scope', problem: 'too_long'}],
    ['a scope with a control character', {scope: 'The\u0007altar'}, {field: 'scope', problem: 'control'}],
    ['a scope with a bidirectional control', {scope: 'The ‮altar'}, {field: 'scope', problem: 'control'}],
    ['an empty outcome', {outcome: ''}, {field: 'outcome', problem: 'empty'}],
    ['an outcome of 301 characters', {outcome: 'y'.repeat(301)}, {field: 'outcome', problem: 'too_long'}],
    ['an outcome with a new line in it', {outcome: 'A\nmodel'}, {field: 'outcome', problem: 'control'}],
  ] as [string, Fields, {field: string; problem: string}][])('names the field problem for %s, as Story 2.1 does, and records nothing', async (_name, change, problem) => {
    expect(await review({...direct, ...change})).toEqual({outcome: 'invalid', problems: [problem]});
    expect(mocks.recordPictureReview).not.toHaveBeenCalled();
  });

  it('names both fields when both are wrong, scope first', async () => {
    expect(await review({...direct, scope: '', outcome: ''})).toEqual({
      outcome: 'invalid',
      problems: [{field: 'scope', problem: 'empty'}, {field: 'outcome', problem: 'empty'}],
    });
  });

  it('accepts a scope and an outcome of exactly 300 characters, and never checks them for research-assisted reconstruction', async () => {
    await redirected(review({...direct, scope: 'x'.repeat(300), outcome: 'y'.repeat(300)}));
    expect(mocks.recordPictureReview).toHaveBeenCalledTimes(1);
    await redirected(review({...research, scope: '', outcome: ''}));
    expect(mocks.recordPictureReview).toHaveBeenCalledTimes(2);
  });
});

describe('the other answers of Confirm', () => {
  it('says which picture is the matter by its position for an upload that is gone, not ready or expired, and recorded nothing', async () => {
    for (const outcome of ['unknown_upload', 'not_ready', 'expired_upload']) {
      mocks.recordPictureReview.mockResolvedValue({outcome, position: 2});
      expect(await review(), outcome).toEqual({outcome, position: 2});
    }
    expect(order.filter((step) => step.startsWith('redirect:'))).toEqual([]);
  });

  it.each(['stale', 'obstruction_not_confirmed', 'acknowledgment_required', 'reused', 'not_editable'])('says %s with nothing else, and recorded nothing', async (outcome) => {
    mocks.recordPictureReview.mockResolvedValue({outcome, seq: 4});
    expect(await review()).toEqual({outcome});
  });

  it('says a Project that is not there (another Account\'s, deleted, unknown, or a replay whose Project has gone) is gone: a message, not a redirect', async () => {
    mocks.recordPictureReview.mockResolvedValue({outcome: 'unavailable'});
    expect(await review()).toEqual({outcome: 'gone'});
    expect(order.filter((step) => step.startsWith('redirect:'))).toEqual([]);
  });

  it('sends the person Home, with nothing recorded, when the database no longer gives this request authority', async () => {
    mocks.recordPictureReview.mockResolvedValue({outcome: 'denied'});
    expect(await redirected(review())).toBe('/');
  });

  it('never sends an outcome it does not know to a Project: an unknown outcome is treated as the authority having ended', async () => {
    mocks.recordPictureReview.mockResolvedValue({outcome: 'surprise'});
    expect(await redirected(review())).toBe('/');
  });
});

describe('authority lost mid-request is refused at the gate (the function refuses it again)', () => {
  it.each(['disabled', 'revoked', 'stale_epoch', 'expired', 'idle', 'no_session', 'no_grant', 'subject_mismatch'])('sends a %s session where any private request goes, and records nothing', async (state) => {
    authorizationIs(state);
    expect(await redirected(review())).toMatch(/^\/login/);
    expect(mocks.recordPictureReview).not.toHaveBeenCalled();
  });

  it('sends a person with no Account to register', async () => {
    authorizationIs('unregistered');
    expect(await redirected(review())).toBe('/register');
    expect(mocks.recordPictureReview).not.toHaveBeenCalled();
  });

  it('answers "nothing was recorded", retryable, when the check itself could not be made', async () => {
    mocks.authorizeSession.mockRejectedValue(new AccountsUnavailableError('The accounts database did not answer.', {retryable: true}));
    expect(await review()).toEqual({outcome: 'unavailable', unknown: false});
    expect(mocks.recordPictureReview).not.toHaveBeenCalled();
  });
});

describe('an outage while recording', () => {
  it('tells the person to check the Project first when the call may have reached the database', async () => {
    mocks.recordPictureReview.mockRejectedValue(new AccountsUnavailableError('The accounts database did not answer.', {retryable: true, outcomeUnknown: true}));
    expect(await review()).toEqual({outcome: 'unavailable', unknown: true});
  });

  it('says nothing was recorded only when the request certainly did not get through', async () => {
    mocks.recordPictureReview.mockRejectedValue(new AccountsUnavailableError('The accounts database refused the call (HTTP 400).', {status: 400, retryable: false, outcomeUnknown: false}));
    expect(await review()).toEqual({outcome: 'unavailable', unknown: false});
    mocks.recordPictureReview.mockRejectedValue(new AccountsConfigError('SUPABASE_SERVICE_ROLE_KEY is not set'));
    expect(await review()).toEqual({outcome: 'unavailable', unknown: false});
  });

  it('treats an answer that makes no sense, and any other error, as possibly recorded', async () => {
    mocks.recordPictureReview.mockRejectedValue(new AccountsUnavailableError('The accounts database answered with an unexpected shape.', {retryable: false, outcomeUnknown: true}));
    expect(await review()).toEqual({outcome: 'unavailable', unknown: true});
    mocks.recordPictureReview.mockRejectedValue(new TypeError('surprise'));
    expect(await review()).toEqual({outcome: 'unavailable', unknown: true});
  });

  it('retries with the same command ID, so a retry records at most one revision', async () => {
    mocks.recordPictureReview.mockRejectedValueOnce(new AccountsUnavailableError('The accounts database did not answer.', {retryable: true, outcomeUnknown: true}));
    expect(await review()).toEqual({outcome: 'unavailable', unknown: true});
    expect(await redirected(review())).toBe(`/projects/${PROJECT}`);
    expect(mocks.recordPictureReview.mock.calls.map((call) => call[1].commandId)).toEqual([COMMAND, COMMAND]);
    expect(mocks.recordPictureReview.mock.calls[0][1]).toEqual(mocks.recordPictureReview.mock.calls[1][1]);
  });

  it('prints a name and a message only: never an ID, a scope, a label or an upload', async () => {
    mocks.recordPictureReview.mockRejectedValue(new AccountsUnavailableError('The accounts database did not answer.', {retryable: true}));
    await review();
    const lines = printed();
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) {
      for (const secret of [PROJECT, COMMAND, ACCOUNT, ...UPLOADS, 'person@example.com', 'The subject in my pictures', 'A model from my pictures']) expect(line).not.toContain(secret);
    }
    expect(lines.join(' ')).toContain('AccountsUnavailableError: The accounts database did not answer.');
  });

  it('prints nothing at all when recording works', async () => {
    await redirected(review());
    expect(printed()).toEqual([]);
  });
});
