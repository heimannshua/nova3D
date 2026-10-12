import {afterEach, describe, expect, it, vi} from 'vitest';
import type {UserRead} from '@/lib/access';
import {AccountsConfigError, AccountsUnavailableError, type RecoveryCheck, type RecoveryIssuance, type RecoveryRedemption} from '@/lib/accounts';
import type {MagicLink} from '@/lib/auth-admin';
import type {MailOutcome} from '@/lib/mailer';
import {recheckDelaysMs, recoveryLink, recoveryLinkOrigin, recoveryTimeoutMs, redeemRecoveryLink, requestRecoveryLink, type RecoveryRedeemDeps, type RecoveryRequestDeps} from '@/lib/recovery';

// The two sequences of Administrator recovery (Story 1.6) with every collaborator faked: the order of the calls, what each failure
// ends and keeps, and what is logged. (tests/unit/recovery-actions.test.ts runs the same sequences over the real client and a
// stubbed network.)
const TOKEN = 'T'.repeat(43);
const USER = '5f0d6c1e-8a52-4c1b-9d57-2b6a1f0e7c44';
const SESSION = '3b1c9a3e-6a3e-4f19-9d0e-0a4f5e2c8d11';
const EMAIL = 'admin@example.test';
const HASHED = 'hashed-link-token-must-never-be-logged';
const ORIGIN = 'https://nova3d.example.test';

afterEach(() => vi.restoreAllMocks());

describe('recoveryLinkOrigin', () => {
  it('is the request\'s own origin locally, and nothing the environment says', () => {
    expect(recoveryLinkOrigin({APP_ENV: 'local'}, 'http://127.0.0.1:4173')).toBe('http://127.0.0.1:4173');
    expect(recoveryLinkOrigin({APP_ENV: 'local', APP_ORIGIN: 'https://elsewhere.example.test'}, 'http://127.0.0.1:4173')).toBe('http://127.0.0.1:4173');
    expect(recoveryLinkOrigin({APP_ENV: 'local'}, null)).toBeNull();
  });

  it.each(['staging', 'production'])('is APP_ORIGIN in %s, whatever the request says', (APP_ENV) => {
    expect(recoveryLinkOrigin({APP_ENV, APP_ORIGIN: ORIGIN}, 'https://evil.example.test')).toBe(ORIGIN);
    expect(recoveryLinkOrigin({APP_ENV, APP_ORIGIN: ` ${ORIGIN} `}, null)).toBe(ORIGIN);
  });

  it.each([undefined, '', '  ', '<staging-app-origin>', 'http://nova3d.example.test', `${ORIGIN}/`, `${ORIGIN}/recover`, 'nova3d.example.test', 'https://user:pass@nova3d.example.test'])('is none in staging for APP_ORIGIN %j, so nothing is issued', (APP_ORIGIN) => {
    expect(recoveryLinkOrigin({APP_ENV: 'staging', APP_ORIGIN}, 'https://nova3d.example.test')).toBeNull();
  });

  it('is none for an environment it does not know', () => {
    expect(recoveryLinkOrigin({APP_ENV: 'qa', APP_ORIGIN: ORIGIN}, 'https://nova3d.example.test')).toBeNull();
    expect(recoveryLinkOrigin({}, 'https://nova3d.example.test')).toBeNull();
  });
});

describe('recoveryLink', () => {
  it('puts the token in the fragment of /recover/confirm, and in no query', () => {
    const link = recoveryLink(ORIGIN, TOKEN);
    expect(link).toBe(`${ORIGIN}/recover/confirm#${TOKEN}`);
    const url = new URL(link);
    expect(url.pathname).toBe('/recover/confirm');
    expect(url.search).toBe('');
    expect(url.hash).toBe(`#${TOKEN}`);
  });
});

describe('requestRecoveryLink', () => {
  const issued = (token = TOKEN): RecoveryIssuance => ({outcome: 'issued', token, expiresAt: '2026-10-12T15:15:00Z'});
  type Spies = {calls: string[]; log: ReturnType<typeof vi.fn>; deps: RecoveryRequestDeps};
  function build(options: {origin?: string | null; issue?: () => Promise<RecoveryIssuance>; send?: (link: string) => Promise<MailOutcome>; voidToken?: (token: string, definitive: boolean) => Promise<'voided'>} = {}): Spies {
    const calls: string[] = [];
    const log = vi.fn();
    const deps: RecoveryRequestDeps = {
      origin: options.origin === undefined ? ORIGIN : options.origin,
      issue: async () => {
        calls.push('issue');
        return (options.issue ?? (async () => issued()))();
      },
      send: async (link) => {
        calls.push(`send ${link}`);
        return (options.send ?? (async () => ({outcome: 'sent'})))(link);
      },
      voidToken: async (token, definitive) => {
        calls.push(`void ${token === TOKEN ? 'token' : token} ${definitive}`);
        return (options.voidToken ?? (async () => 'voided'))(token, definitive);
      },
      log,
    };
    return {calls, log, deps};
  }

  it('issues, then mails the link, and says sent', async () => {
    const {calls, deps, log} = build();
    expect(await requestRecoveryLink(deps)).toEqual({outcome: 'sent'});
    expect(calls).toEqual(['issue', `send ${ORIGIN}/recover/confirm#${TOKEN}`]);
    expect(log).not.toHaveBeenCalled();
  });

  it('issues nothing without an origin for the link', async () => {
    const {calls, deps, log} = build({origin: null});
    expect(await requestRecoveryLink(deps)).toEqual({outcome: 'unavailable'});
    expect(calls).toEqual([]);
    expect(log).toHaveBeenCalledTimes(1);
  });

  it('is limited, and mails nothing, when the limit is reached', async () => {
    const {calls, deps} = build({issue: async () => ({outcome: 'limited'})});
    expect(await requestRecoveryLink(deps)).toEqual({outcome: 'limited'});
    expect(calls).toEqual(['issue']);
  });

  it('reads unavailable, mailing nothing, when the database refuses (no eligible Administrator)', async () => {
    const {calls, deps} = build({issue: async () => ({outcome: 'refused'})});
    expect(await requestRecoveryLink(deps)).toEqual({outcome: 'unavailable'});
    expect(calls).toEqual(['issue']);
  });

  it('reads unavailable, mailing nothing, when issuing throws, and logs only the error\'s name and message', async () => {
    const {calls, deps, log} = build({issue: async () => Promise.reject(new AccountsUnavailableError('The accounts database did not answer.', {retryable: true}))});
    expect(await requestRecoveryLink(deps)).toEqual({outcome: 'unavailable'});
    expect(calls).toEqual(['issue']);
    expect(log).toHaveBeenCalledWith(expect.any(String), 'AccountsUnavailableError: The accounts database did not answer.');
  });

  it.each([
    ['refused', {outcome: 'refused', reason: 'provider_refused'} as MailOutcome, true],
    ['not configured', {outcome: 'refused', reason: 'not_configured'} as MailOutcome, true],
    ['a timeout', {outcome: 'unknown', reason: 'timeout'} as MailOutcome, false],
    ['a provider failure', {outcome: 'unknown', reason: 'provider_error'} as MailOutcome, false],
  ])('voids the token only for a definitive refusal: %s', async (_name, mail, definitive) => {
    const {calls, deps} = build({send: async () => mail});
    expect(await requestRecoveryLink(deps)).toEqual({outcome: 'unavailable'});
    expect(calls).toEqual(['issue', `send ${ORIGIN}/recover/confirm#${TOKEN}`, `void token ${definitive}`]);
  });

  it('treats a mailer that throws as an unknown outcome, never as sent', async () => {
    const {calls, deps} = build({send: async () => Promise.reject(new Error('boom'))});
    expect(await requestRecoveryLink(deps)).toEqual({outcome: 'unavailable'});
    expect(calls.at(-1)).toBe('void token false');
  });

  it('still reads unavailable when recording the failed mail fails, and logs only names', async () => {
    const {deps, log} = build({send: async () => ({outcome: 'refused', reason: 'provider_refused'}), voidToken: async () => Promise.reject(new Error('database down'))});
    expect(await requestRecoveryLink(deps)).toEqual({outcome: 'unavailable'});
    const printed = log.mock.calls.flat().join('\n');
    expect(printed).toContain('Error: database down');
    expect(printed).not.toContain(TOKEN);
  });

  it('never logs the token or the link', async () => {
    const outcomes: MailOutcome[] = [{outcome: 'sent'}, {outcome: 'refused', reason: 'provider_refused'}, {outcome: 'unknown', reason: 'timeout'}];
    for (const mail of outcomes) {
      const {deps, log} = build({send: async () => mail});
      await requestRecoveryLink(deps);
      expect(log.mock.calls.flat().join('\n')).not.toContain(TOKEN);
    }
  });
});

describe('redeemRecoveryLink', () => {
  const valid: RecoveryCheck = {outcome: 'valid', userId: USER, email: EMAIL};
  const link: MagicLink = {hashedToken: HASHED, userId: USER};
  const aUser: UserRead = {kind: 'user', user: {id: USER, email: EMAIL, sessionId: SESSION}};
  const redeemed: RecoveryRedemption = {outcome: 'redeemed', sessionsEnded: 3, epoch: 5};

  type Behaviour = {
    check?: () => Promise<RecoveryCheck>;
    mint?: () => Promise<MagicLink>;
    verify?: () => Promise<{ok: true; accessToken: string} | {ok: false; outage: boolean}>;
    readUser?: () => Promise<UserRead>;
    redeem?: () => Promise<RecoveryRedemption>;
    end?: () => Promise<void>;
    timeoutMs?: number;
    /** The waits between the asks that follow a refused link. None by default, so no test waits. */
    delays?: readonly number[];
  };
  function build(behaviour: Behaviour = {}) {
    const calls: string[] = [];
    const log = vi.fn();
    const deps: RecoveryRedeemDeps = {
      session: {
        verify: async (hashed) => {
          calls.push(`verify ${hashed === HASHED ? 'hashed' : hashed}`);
          return (behaviour.verify ?? (async () => ({ok: true as const, accessToken: 'minted-access-token'})))();
        },
        readUser: async (accessToken) => {
          calls.push(`readUser ${accessToken}`);
          return (behaviour.readUser ?? (async () => aUser))();
        },
        end: async () => {
          calls.push('end');
          await behaviour.end?.();
        },
      },
      check: async (token) => {
        calls.push(`check ${token === TOKEN ? 'token' : token}`);
        return (behaviour.check ?? (async () => valid))();
      },
      mint: async (email) => {
        calls.push(`mint ${email}`);
        return (behaviour.mint ?? (async () => link))();
      },
      redeem: async (input) => {
        calls.push(`redeem ${input.token === TOKEN ? 'token' : input.token} ${input.userId} ${input.sessionId}`);
        return (behaviour.redeem ?? (async () => redeemed))();
      },
      log,
      timeoutMs: behaviour.timeoutMs,
      recheckDelaysMs: behaviour.delays ?? [0],
      sleep: async (milliseconds) => {
        calls.push(`sleep ${milliseconds}`);
      },
    };
    return {calls, log, deps};
  }
  const run = (behaviour?: Behaviour) => {
    const {calls, log, deps} = build(behaviour);
    return redeemRecoveryLink(TOKEN, deps).then((result) => ({result, calls, log}));
  };

  it('checks, makes the link for the Auth user\'s own address, verifies it, reads the user, and redeems: in that order', async () => {
    const {result, calls, log} = await run();
    expect(result).toEqual({outcome: 'redeemed', sessionsEnded: 3});
    expect(calls).toEqual(['check token', `mint ${EMAIL}`, 'verify hashed', 'readUser minted-access-token', `redeem token ${USER} ${SESSION}`]);
    expect(log).not.toHaveBeenCalled();
  });

  it('has a budget of its own, long enough for the whole chain and not unbounded', () => {
    expect(recoveryTimeoutMs).toBeGreaterThanOrEqual(5_000);
    expect(recoveryTimeoutMs).toBeLessThanOrEqual(30_000);
  });

  describe('before a session exists, a failure changes nothing and ends nothing', () => {
    it.each(['unknown', 'used', 'expired', 'voided', 'administrator'] as const)('is invalid when the check says %s', async (outcome) => {
      const {result, calls} = await run({check: async () => ({outcome})});
      expect(result).toEqual({outcome: 'invalid'});
      expect(calls).toEqual(['check token']);
    });

    it('is unavailable when the check throws', async () => {
      const {result, calls, log} = await run({check: async () => Promise.reject(new AccountsUnavailableError('The accounts database did not answer.', {retryable: true}))});
      expect(result).toEqual({outcome: 'unavailable'});
      expect(calls).toEqual(['check token']);
      expect(log.mock.calls.flat().join('\n')).toContain('AccountsUnavailableError');
    });

    it('is unavailable when the link cannot be made', async () => {
      const {result, calls} = await run({mint: async () => Promise.reject(new Error('Auth refused to make the link (HTTP 422).'))});
      expect(result).toEqual({outcome: 'unavailable'});
      expect(calls).toEqual(['check token', `mint ${EMAIL}`]);
    });

    it('verifies nothing when Auth made the link for another user', async () => {
      const {result, calls} = await run({mint: async () => ({hashedToken: HASHED, userId: '1c0d6c1e-8a52-4c1b-9d57-2b6a1f0e7c99'})});
      expect(result).toEqual({outcome: 'unavailable'});
      expect(calls).toEqual(['check token', `mint ${EMAIL}`]);
    });

    it('is unavailable, with no session to end, when Auth does not answer to the verification, and does not ask again', async () => {
      const {result, calls} = await run({verify: async () => ({ok: false, outage: true})});
      expect(result).toEqual({outcome: 'unavailable'});
      expect(calls).toEqual(['check token', `mint ${EMAIL}`, 'verify hashed']);
    });

    it('is unavailable when the verification throws', async () => {
      const {result, calls} = await run({verify: async () => Promise.reject(new Error('boom'))});
      expect(result).toEqual({outcome: 'unavailable'});
      expect(calls).toEqual(['check token', `mint ${EMAIL}`, 'verify hashed']);
    });

    it('asks the check again when Auth refuses the link: invalid if the token has meanwhile been used, unavailable if it is still valid or the check fails', async () => {
      for (const [second, expected] of [[async () => ({outcome: 'used'}) as RecoveryCheck, 'invalid'], [async () => valid, 'unavailable'], [async () => Promise.reject(new Error('down')), 'unavailable']] as const) {
        let asked = 0;
        const {result, calls} = await run({verify: async () => ({ok: false, outage: false}), check: () => (asked++ === 0 ? Promise.resolve(valid) : second())});
        expect(result.outcome).toBe(expected);
        expect(calls).toEqual(['check token', `mint ${EMAIL}`, 'verify hashed', 'sleep 0', 'check token']);
      }
    });

    it('waits between those asks, a few times and no longer than a couple of seconds, for the window that made Auth refuse the link to finish', async () => {
      expect(recheckDelaysMs.length).toBeGreaterThanOrEqual(2);
      expect(recheckDelaysMs.reduce((total, delay) => total + delay, 0)).toBeLessThanOrEqual(2500);
      // The winner commits on the third ask: the loser asked three times, waited the three delays, and says the one bad-link message.
      let asked = 0;
      const answers: RecoveryCheck[] = [valid, valid, valid, {outcome: 'used'}];
      const {result, calls} = await run({verify: async () => ({ok: false, outage: false}), check: async () => answers[Math.min(asked++, answers.length - 1)], delays: [10, 20, 30, 40]});
      expect(result).toEqual({outcome: 'invalid'});
      expect(calls).toEqual(['check token', `mint ${EMAIL}`, 'verify hashed', 'sleep 10', 'check token', 'sleep 20', 'check token', 'sleep 30', 'check token']);
    });

    it('asks as many times as there are delays, and then says try again, if the token is valid every time', async () => {
      const {result, calls} = await run({verify: async () => ({ok: false, outage: false}), delays: [1, 2, 3]});
      expect(result).toEqual({outcome: 'unavailable'});
      expect(calls.filter((call) => call === 'check token')).toHaveLength(1 + 3);
      expect(calls.filter((call) => call.startsWith('sleep'))).toEqual(['sleep 1', 'sleep 2', 'sleep 3']);
    });

    it('does not wait or ask again when Auth did not answer at all: that is not another window\'s link', async () => {
      const {result, calls} = await run({verify: async () => ({ok: false, outage: true}), delays: [10, 20]});
      expect(result).toEqual({outcome: 'unavailable'});
      expect(calls).toEqual(['check token', `mint ${EMAIL}`, 'verify hashed']);
    });
  });

  describe('once a session exists, a failure before the transaction ends it', () => {
    it.each([
      ['signed out', {kind: 'signed-out'} as UserRead],
      ['unavailable', {kind: 'unavailable'} as UserRead],
      ['ineligible', {kind: 'ineligible'} as UserRead],
      ['another user', {kind: 'user', user: {id: '1c0d6c1e-8a52-4c1b-9d57-2b6a1f0e7c99', email: EMAIL, sessionId: SESSION}} as UserRead],
    ])('ends it, and redeems nothing, when Auth\'s user is %s (and the token is still valid, so it is retryable)', async (_name, read) => {
      const {result, calls} = await run({readUser: async () => read});
      expect(result).toEqual({outcome: 'unavailable'});
      expect(calls).toEqual(['check token', `mint ${EMAIL}`, 'verify hashed', 'readUser minted-access-token', 'end', 'sleep 0', 'check token']);
    });

    it('ends it when reading the user throws', async () => {
      const {result, calls} = await run({readUser: async () => Promise.reject(new Error('boom'))});
      expect(result).toEqual({outcome: 'unavailable'});
      expect(calls.slice(-3)).toEqual(['end', 'sleep 0', 'check token']);
      expect(calls.some((call) => call.startsWith('redeem'))).toBe(false);
    });

    it('says the one bad-link message, not "try again", when the session was lost because another window recovered first (its transaction deletes every other session, and the token is used)', async () => {
      let asked = 0;
      const {result, calls} = await run({readUser: async () => ({kind: 'unavailable'}), check: async () => (asked++ === 0 ? valid : {outcome: 'used'})});
      expect(result).toEqual({outcome: 'invalid'});
      expect(calls.at(-1)).toBe('check token');
      expect(calls.some((call) => call.startsWith('redeem'))).toBe(false);
    });
  });

  describe('the transaction', () => {
    it.each(['unknown', 'used', 'expired', 'voided', 'administrator'] as const)('is refused with %s: one answer, and only this window\'s session ends', async (outcome) => {
      const {result, calls} = await run({redeem: async () => ({outcome})});
      expect(result).toEqual({outcome: 'invalid'});
      expect(calls.at(-2)).toBe(`redeem token ${USER} ${SESSION}`);
      expect(calls.at(-1)).toBe('end');
      expect(calls.filter((call) => call === 'end')).toHaveLength(1);
    });

    it('ends the session when the database rejected the call, which certainly did not commit', async () => {
      const {result, calls} = await run({redeem: async () => Promise.reject(new AccountsUnavailableError('The accounts database refused the call (HTTP 400).', {status: 400, code: '22023', retryable: false, outcomeUnknown: false}))});
      expect(result).toEqual({outcome: 'unavailable'});
      expect(calls.at(-1)).toBe('end');
    });

    it.each([
      ['no answer', new AccountsUnavailableError('The accounts database did not answer.', {retryable: true})],
      ['a server error', new AccountsUnavailableError('The accounts database refused the call (HTTP 503).', {status: 503, retryable: true, outcomeUnknown: true})],
      ['an answer of an unexpected shape', new AccountsUnavailableError('The accounts database answered with an unexpected shape.', {retryable: false, outcomeUnknown: true})],
    ])('keeps the session, and says unknown, on %s: the call was dispatched and it may have committed', async (_name, error) => {
      const {result, calls, log} = await run({redeem: async () => Promise.reject(error)});
      expect(result).toEqual({outcome: 'unknown'});
      expect(calls).not.toContain('end');
      expect(log).toHaveBeenCalledTimes(1);
    });

    it('keeps the session, and says unknown, when the budget runs out while the database is being asked (the call is in flight)', async () => {
      const {result, calls} = await run({redeem: () => new Promise<RecoveryRedemption>(() => undefined), timeoutMs: 40});
      expect(result).toEqual({outcome: 'unknown'});
      expect(calls).not.toContain('end');
    });

    describe('when the call was never sent, nothing can have committed: the session ends, the answer is unavailable, and the token is untouched', () => {
      it('ends the session when the budget was already spent before the call (withinBudget never starts the step)', async () => {
        // The session is read slowly: by the time the transaction would be asked for, none of the 40 ms is left.
        const slow = () => new Promise<UserRead>((resolve) => setTimeout(() => resolve(aUser), 80));
        const {result, calls, log} = await run({readUser: slow, timeoutMs: 40});
        expect(result).toEqual({outcome: 'unavailable'});
        expect(calls.some((call) => call.startsWith('redeem'))).toBe(false);
        expect(calls).toContain('end');
        expect(log.mock.calls.flat().join('\n')).toContain('no time left in the budget');
      });

      it.each([
        ['an unusable configuration (the recovery key or the Administrator address is missing)', new AccountsConfigError('RECOVERY_HASH_KEY is not set')],
        ['an argument rejected before any request (a user that is not a UUID)', new TypeError('userId must be a UUID')],
        ['an error that is not the database\'s', new Error('boom')],
      ])('ends the session on %s', async (_name, error) => {
        const {result, calls, log} = await run({redeem: async () => Promise.reject(error)});
        expect(result).toEqual({outcome: 'unavailable'});
        expect(calls.at(-1)).toBe('end');
        expect(calls.filter((call) => call === 'end')).toHaveLength(1);
        expect(log).toHaveBeenCalledTimes(1);
        expect(log.mock.calls.flat().join('\n')).not.toContain(TOKEN);
      });

      it('does not mistake a deadline of its own for a call that was never sent: a DeadlineError is in flight', async () => {
        const {result, calls} = await run({redeem: () => new Promise<RecoveryRedemption>(() => undefined), timeoutMs: 30});
        expect(result).toEqual({outcome: 'unknown'});
        expect(calls).not.toContain('end');
      });
    });

    it('is unavailable, with nothing made, when the budget runs out before the check answers', async () => {
      const {result, calls} = await run({check: () => new Promise<RecoveryCheck>(() => undefined), timeoutMs: 40});
      expect(result).toEqual({outcome: 'unavailable'});
      expect(calls).toEqual(['check token']);
    });
  });

  it('is never made to throw by a session that cannot be ended', async () => {
    const {result, log} = await run({readUser: async () => ({kind: 'ineligible'}), end: async () => Promise.reject(new Error('Auth did not answer'))});
    expect(result).toEqual({outcome: 'unavailable'});
    expect(log.mock.calls.flat().join('\n')).toContain('Error: Auth did not answer');
  });

  it('never logs the token, the link\'s hashed token or an address, on any path', async () => {
    const behaviours: Behaviour[] = [
      {},
      {check: async () => ({outcome: 'used'})},
      {check: async () => Promise.reject(new Error('down'))},
      {mint: async () => Promise.reject(new Error('refused'))},
      {verify: async () => ({ok: false, outage: false})},
      {readUser: async () => ({kind: 'ineligible'})},
      {redeem: async () => ({outcome: 'used'})},
      {redeem: async () => Promise.reject(new Error('down'))},
    ];
    for (const behaviour of behaviours) {
      const {log} = await run(behaviour);
      const printed = log.mock.calls.flat().join('\n');
      for (const secret of [TOKEN, HASHED, EMAIL, 'minted-access-token']) expect(printed).not.toContain(secret);
    }
  });
});
