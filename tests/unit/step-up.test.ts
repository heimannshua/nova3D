import {describe, expect, it, vi} from 'vitest';
import type {StepUpReceipt} from '@/lib/accounts';
import {finishStepUp, signInTimeoutMs} from '@/lib/access';
import {createBudget} from '@/lib/deadline';
import {checkMarker} from '@/lib/accounts';
import {consumedStepUpClasses, isStepUpClass, stepUpClasses, stepUpErrorKeys, stepUpIdle, stepUpPath, stepUpReasonKeys, stepUpReturnPaths, stepUpUrl} from '@/lib/step-up';
import {hashStepUpSecret} from '@/lib/step-up-flow';
import {locales, translate} from '@/lib/i18n';

// Story 1.4b: what the callback does with a sign-in that came back to a browser holding a step-up cookie,
// and the facts about the action classes. The database's own decisions are in
// tests/integration/step-up.test.ts; this is the application's reading of them.

const USER = '5f0d6c1e-8a52-4c1b-9d57-2b6a1f0e7c44';
const SESSION = '3b1c9a3e-6a3e-4f19-9d0e-0a4f5e2c8d11';
const person = {id: USER, email: 'person@example.com', sessionId: SESSION};
const SECRET = 'S'.repeat(43);
const CHALLENGE = 'C'.repeat(43);
const flow = {secret: SECRET, challenge: CHALLENGE};

const receipt = (outcome: StepUpReceipt['outcome'], reason: string | null = null, actionClass: StepUpReceipt['actionClass'] = null): StepUpReceipt => ({outcome, reason, actionClass});
const run = (answer: StepUpReceipt | Error | ((input: unknown) => Promise<StepUpReceipt>), options: {log?: (message: string, detail: string) => void} = {}) => {
  const complete = vi.fn(async (input: unknown) => {
    if (typeof answer === 'function') return answer(input);
    if (answer instanceof Error) throw answer;
    return answer;
  });
  const log = options.log ?? vi.fn();
  return {complete, log, finished: finishStepUp(person, flow, {complete: complete as never, log, budget: createBudget(signInTimeoutMs)})};
};

describe('the action classes', () => {
  it('are exactly the four the database knows, and only those are classes', () => {
    expect([...stepUpClasses]).toEqual(['administration', 'owner_deletion', 'account_deletion', 'close_instance']);
    for (const value of stepUpClasses) expect(isStepUpClass(value)).toBe(true);
    for (const value of [undefined, null, '', 'Administration', 'admin', 'administration ', 'constructor', '__proto__', 'toString', 42, ['administration']]) {
      expect(isStepUpClass(value), String(value)).toBe(false);
    }
  });

  it('consume the marker by use for Account deletion and close-instance, and for no other class', () => {
    expect([...consumedStepUpClasses]).toEqual(['account_deletion', 'close_instance']);
  });

  it('return, by class, to a path of this application that the server chose: the invitation page for administration (Story 1.11), Settings until the stories that own the other areas exist', () => {
    expect(Object.keys(stepUpReturnPaths).sort()).toEqual([...stepUpClasses].sort());
    expect(stepUpReturnPaths).toEqual({
      administration: '/admin/invitations',
      owner_deletion: '/settings',
      account_deletion: '/settings',
      close_instance: '/settings',
    });
    for (const path of Object.values(stepUpReturnPaths)) {
      expect(path).toMatch(/^\/[a-z]/);
      expect(path).not.toMatch(/[?#:]|\/\//);
    }
    expect(stepUpPath).toBe('/step-up');
  });

  it('say what is being confirmed in both languages, one message for each class, so a class added without words does not compile', () => {
    expect(Object.keys(stepUpReasonKeys).sort()).toEqual([...stepUpClasses].sort());
    const seen = new Set<string>();
    for (const locale of locales) {
      for (const actionClass of stepUpClasses) {
        const words = translate(locale, stepUpReasonKeys[actionClass]);
        expect(words.length, `${locale}:${actionClass}`).toBeGreaterThan(10);
        seen.add(`${locale}:${words}`);
      }
    }
    // Four classes, four different sentences, in each language.
    expect(seen.size).toBe(stepUpClasses.length * locales.length);
    expect(translate('en', stepUpReasonKeys.administration)).toMatch(/invitation codes/);
  });

  it('have one URL that starts a step-up, built from the closed list and by nothing else', () => {
    for (const actionClass of stepUpClasses) expect(stepUpUrl(actionClass)).toBe(`/step-up?for=${actionClass}`);
    // A class that is not on the list is a mistake in the caller, never a URL.
    for (const bad of ['', 'Administration', 'admin', 'administration&for=close_instance', 'administration#', '__proto__', 'constructor', undefined, null, 42]) {
      expect(() => stepUpUrl(bad as never), String(bad)).toThrow(TypeError);
    }
    // And the page accepts exactly what it makes.
    for (const actionClass of stepUpClasses) expect(isStepUpClass(new URL(stepUpUrl(actionClass), 'http://x').searchParams.get('for'))).toBe(true);
  });

  it('say what went wrong in both languages when the page cannot start', () => {
    expect(stepUpIdle).toEqual({outcome: 'idle'});
    for (const locale of locales) for (const key of Object.values(stepUpErrorKeys)) expect(translate(locale, key).length).toBeGreaterThan(10);
  });
});

describe('finishStepUp: a sign-in comes back to a browser holding a step-up cookie', () => {
  it.each(stepUpClasses)('accepted (%s): the person goes on to the class\'s own path, and nobody is signed out', async (actionClass) => {
    const {complete, finished} = run(receipt('accepted', null, actionClass));
    expect(await finished).toEqual({kind: 'decided', decision: {to: stepUpReturnPaths[actionClass], signOut: false}});
    // The database is handed the new session, the hash of the cookie secret and the PKCE challenge, and nothing else.
    expect(complete).toHaveBeenCalledTimes(1);
    expect(complete.mock.calls[0][0]).toEqual({userId: USER, sessionId: SESSION, secretHash: hashStepUpSecret(SECRET), verifierHash: CHALLENGE});
    expect(complete.mock.calls[0][0]).not.toHaveProperty('secret');
  });

  it('not a step-up, nothing named by the secret: an ordinary sign-in', async () => {
    expect(await run(receipt('not_step_up', 'unknown')).finished).toEqual({kind: 'ordinary'});
  });

  it('not a step-up, another flow: an ordinary sign-in too. The browser holds one verifier, which that flow overwrote and has now consumed, so this step-up cannot come back and its cookie goes with the rest', async () => {
    expect(await run(receipt('not_step_up', 'other_flow')).finished).toEqual({kind: 'ordinary'});
  });

  it.each(['mismatch', 'expired', 'replaced', 'used', 'old_sign_in', 'same_session', 'no_session', 'disabled', 'grant_revoked'])(
    'rejected (%s): only this browser\'s new session is ended, never a global sign-out, and the person signs in again with a localized error',
    async (reason) => {
      const {finished, log} = run(receipt('rejected', reason, 'administration'));
      const outcome = await finished;
      expect(outcome).toEqual({kind: 'decided', decision: {to: '/login?error=step_up_failed', signOut: true, scope: 'local'}});
      // The reason is logged by name, never the secret or the challenge.
      expect(JSON.stringify(vi.mocked(log).mock.calls)).toContain(reason);
      expect(JSON.stringify(vi.mocked(log).mock.calls)).not.toContain(SECRET);
      expect(JSON.stringify(vi.mocked(log).mock.calls)).not.toContain(CHALLENGE);
    },
  );

  it('the database could not be reached: denied and retryable, only this browser\'s new session ended, nothing fresh', async () => {
    const {finished, log} = run(new Error('the accounts database did not answer'));
    expect(await finished).toEqual({kind: 'decided', decision: {to: '/login?error=auth_unavailable', signOut: true, scope: 'local'}});
    expect(vi.mocked(log)).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(vi.mocked(log).mock.calls)).not.toContain(SECRET);
    expect(JSON.stringify(vi.mocked(log).mock.calls)).not.toContain(hashStepUpSecret(SECRET));
  });

  it('a database that never answers is the same, inside the sign-in\'s time budget', async () => {
    vi.useFakeTimers();
    try {
      const finished = finishStepUp(person, flow, {complete: () => new Promise<never>(() => undefined), log: vi.fn(), timeoutMs: 50});
      await vi.advanceTimersByTimeAsync(100);
      expect(await finished).toEqual({kind: 'decided', decision: {to: '/login?error=auth_unavailable', signOut: true, scope: 'local'}});
    } finally {
      vi.useRealTimers();
    }
  });

  it('an acceptance that names no class, or an outcome nobody knows, is not an acceptance', async () => {
    for (const answer of [receipt('accepted', null, null), {outcome: 'maybe', reason: null, actionClass: null} as unknown as StepUpReceipt]) {
      expect(await run(answer).finished).toEqual({kind: 'decided', decision: {to: '/login?error=auth_unavailable', signOut: true, scope: 'local'}});
    }
  });

  it('never signs the initiating session out: no decision here is global', async () => {
    const answers = [receipt('accepted', null, 'administration'), receipt('rejected', 'mismatch', 'administration'), new Error('down')];
    for (const answer of answers) {
      const outcome = await run(answer).finished;
      if (outcome.kind === 'decided' && outcome.decision.signOut) expect(outcome.decision.scope).toBe('local');
    }
  });
});

describe('checkMarker: a missing time is missing, never the epoch', () => {
  const ids = {userId: USER, sessionId: SESSION};
  /** The body the database is sent, with the network stubbed. */
  async function sent(input: Parameters<typeof checkMarker>[0]) {
    const bodies: Record<string, unknown>[] = [];
    const answer = await checkMarker(input, {
      env: {NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54321', SUPABASE_SERVICE_ROLE_KEY: 'a-service-key-for-the-stub'},
      fetch: async (_url, init) => {
        bodies.push(JSON.parse(String(init?.body)));
        return new Response(JSON.stringify({outcome: 'allowed'}), {status: 200, headers: {'content-type': 'application/json'}});
      },
    });
    return {answer, body: bodies[0]};
  }

  it.each(['account_deletion', 'close_instance'])('%s with a null time throws, as with none, and asks the database nothing', async (actionClass) => {
    await expect(checkMarker({...ids, actionClass, startedAfter: null}, {env: {}})).rejects.toThrow(/startedAfter is required/);
    await expect(checkMarker({...ids, actionClass}, {env: {}})).rejects.toThrow(/startedAfter is required/);
  });

  it.each(['administration', 'owner_deletion'])('%s with a null time sends no time at all (not 1970)', async (actionClass) => {
    for (const startedAfter of [null, undefined]) {
      const {answer, body} = await sent({...ids, actionClass, ...(startedAfter === null ? {startedAfter} : {})});
      expect(answer).toBe('allowed');
      expect(body.p_started_after).toBeNull();
    }
  });

  it('sends a real time as an ISO string', async () => {
    const moment = new Date('2026-10-11T12:00:00.000Z');
    expect((await sent({...ids, actionClass: 'account_deletion', startedAfter: moment})).body.p_started_after).toBe('2026-10-11T12:00:00.000Z');
    expect((await sent({...ids, actionClass: 'account_deletion', startedAfter: '2026-10-11T12:00:00Z'})).body.p_started_after).toBe('2026-10-11T12:00:00.000Z');
  });
});
