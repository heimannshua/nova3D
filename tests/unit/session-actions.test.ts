import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {describe, expect, it, vi} from 'vitest';
import {attemptSessionAction, sessionActionIdle, unexpectedResponseMessage, type SessionActionState} from '@/lib/session-actions';

// How the sign-out buttons read a call to a Server Action that did not answer in the action's own words.
class Redirected extends Error {
  // The marker Next.js gives a redirect it throws, so unstable_rethrow lets it through.
  readonly digest = 'NEXT_REDIRECT;replace;/login;307;';
}
const done = (count: number): SessionActionState => ({outcome: 'done', count});

describe('attemptSessionAction', () => {
  it('returns what the action answers', async () => {
    const navigate = vi.fn();
    expect(await attemptSessionAction(async () => done(2), sessionActionIdle, navigate)).toEqual(done(2));
    expect(await attemptSessionAction(async () => ({outcome: 'unavailable'}), sessionActionIdle, navigate)).toEqual({outcome: 'unavailable'});
    expect(navigate).not.toHaveBeenCalled();
  });

  it('passes the previous state to the action', async () => {
    const action = vi.fn(async (_previous: SessionActionState) => done(0));
    await attemptSessionAction(action, {outcome: 'unavailable'}, vi.fn());
    expect(action).toHaveBeenCalledWith({outcome: 'unavailable'});
  });

  it('lets a redirect through, for Next.js to follow: that is how a sign-out finishes', async () => {
    const navigate = vi.fn();
    await expect(attemptSessionAction(async () => { throw new Redirected('NEXT_REDIRECT'); }, sessionActionIdle, navigate)).rejects.toBeInstanceOf(Redirected);
    expect(navigate).not.toHaveBeenCalled();
  });

  it('loads the page again, once, and keeps the state, only for the answer that is not an action\'s at all: a proxy redirect', async () => {
    const navigate = vi.fn();
    const previous = {outcome: 'unavailable'} as const;
    expect(await attemptSessionAction(async () => { throw new Error(unexpectedResponseMessage); }, previous, navigate)).toEqual(previous);
    expect(navigate).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['a dropped connection', new TypeError('Failed to fetch')],
    ['a server error the action threw', new Error('An error occurred in the Server Components render.')],
    ['a plain-text server error', new Error('Internal Server Error')],
    ['something that is not an Error', 'boom'],
    ['an Error that only mentions the unexpected response', new Error(`${unexpectedResponseMessage} (and more)`)],
  ])('says the call is unavailable, and never reloads the page silently, for %s', async (_name, failure) => {
    const navigate = vi.fn();
    expect(await attemptSessionAction(async () => { throw failure; }, sessionActionIdle, navigate)).toEqual({outcome: 'unavailable'});
    expect(navigate).not.toHaveBeenCalled();
  });

  it('cannot become a reload loop: each attempt navigates at most once, and a failed reload is just another attempt', async () => {
    const navigate = vi.fn();
    const failing = async (): Promise<SessionActionState> => { throw new Error(unexpectedResponseMessage); };
    let state: SessionActionState = sessionActionIdle;
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      state = await attemptSessionAction(failing, state, navigate);
      expect(navigate, `after attempt ${attempt}`).toHaveBeenCalledTimes(attempt);
    }
  });

  it('knows the message the installed Next.js client throws for a response that is not an action\'s (a Next upgrade that changes it fails here)', () => {
    const reducer = readFileSync(resolve(import.meta.dirname, '../../node_modules/next/dist/client/components/router-reducer/reducers/server-action-reducer.js'), 'utf8');
    expect(reducer).toContain(`'${unexpectedResponseMessage}'`);
  });
});
