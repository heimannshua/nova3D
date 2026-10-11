import {createHash, randomBytes, randomUUID} from 'node:crypto';
import type {Client} from 'pg';
import {beforeAll, describe, expect, it} from 'vitest';
import {checkMarker, completeStepUp, issueInvitation, registerWithCode, startStepUp} from '@/lib/accounts';
import {codeHash, createHarness, insertAmrClaim} from '../support/accounts-db';
import {stackEnvironment} from '../support/stack';

// Story 1.4b against the Supabase CLI stack: step-up nonces, fresh-authentication markers and the three api
// functions, every row of the I/O matrix at the database. Most cases run inside a transaction that is rolled
// back, as the service role. The cases that need several real connections, and the REST round trip the
// application makes, commit real data that is removed afterwards (audit events are append-only and stay).

const {db, connect, committed, inTx, addUser, addSession, attempt, api, count} = createHarness();

let env: Record<string, string>;
beforeAll(async () => {
  env = await stackEnvironment(db);
});

const secretHash = () => codeHash();
// A PKCE S256 challenge is the base64url of a SHA-256: 43 characters.
const challenge = () => randomBytes(32).toString('base64url');
const emailHash = (email: string) => createHash('sha256').update(email.toLowerCase()).digest('hex');
const minutes = (n: number) => `${n} minutes`;

/** A user with an active Account (registered the way the registration screen does) and a session that holds its grant. */
async function member(client: Client) {
  const svc = api(client);
  const user = await addUser(client);
  const hash = codeHash();
  await svc.issue(hash, 'general', null);
  const receipt = await svc.register(user.id, hash);
  if (receipt.outcome !== 'registered') throw new Error(`The test Account was not created (${receipt.outcome}).`);
  const sessionId = await addSession(client, user.id);
  await svc.issueGrant(user.id, sessionId);
  return {user, accountId: receipt.account_id as string, sessionId};
}

type Member = Awaited<ReturnType<typeof member>>;
type Started = {secret: string; verifier: string; actionClass: string};

/** A step-up started from the member's session, the way the Server Action does it. */
async function start(client: Client, m: Member, options: {actionClass?: string; secret?: string; verifier?: string} = {}): Promise<Started> {
  const started = {secret: options.secret ?? secretHash(), verifier: options.verifier ?? challenge(), actionClass: options.actionClass ?? 'administration'};
  const receipt = await api(client).startStepUp(m.user.id, m.sessionId, started.actionClass, started.secret, started.verifier);
  if (receipt.outcome !== 'started') throw new Error(`The step-up was not started (${receipt.outcome}).`);
  return started;
}

/** The new session a second Google sign-in mints for the same user: a session with an `oauth` row in Auth's own amr table. */
async function signInAgain(client: Client, userId: string, options: {method?: string; createdAt?: Date; amr?: boolean} = {}) {
  const sessionId = await addSession(client, userId);
  if (options.amr !== false) await insertAmrClaim(client, sessionId, {method: options.method, createdAt: options.createdAt});
  return sessionId;
}

const nonceOf = async (client: Client, secret: string) => (await client.query('select * from identity.step_up_nonces where secret_hash = $1', [secret])).rows[0];
const grantOf = async (client: Client, sessionId: string) => (await client.query('select * from identity.session_grants where session_id = $1', [sessionId])).rows[0];
const markersOf = async (client: Client, sessionId: string) => (await client.query('select * from identity.fresh_authentications where session_id = $1', [sessionId])).rows;
const auditOf = async (client: Client, action: string, target: string) =>
  (await client.query('select actor, action, target from identity.audit_events where action = $1 and target = $2 order by id', [action, target])).rows;
const stateOf = async (client: Client, m: Member, sessionId: string) => (await api(client).authorize(m.user.id, sessionId)).state as string;
/** Moves a nonce back in time by this many minutes (its start and its expiry together). */
const ageNonce = (client: Client, secret: string, by: number) =>
  client.query(`update identity.step_up_nonces set started_at = started_at - $2::interval, expires_at = expires_at - $2::interval where secret_hash = $1`, [secret, minutes(by)]);
/** Moves a marker back in time. */
const ageMarker = (client: Client, sessionId: string, by: number) =>
  client.query(`update identity.fresh_authentications set issued_at = issued_at - $2::interval, expires_at = expires_at - $2::interval where session_id = $1`, [sessionId, minutes(by)]);

// ---------------------------------------------------------------------------------------------------
describe('starting a step-up', () => {
  it('writes a nonce bound to the Account and the initiating session, with hashes only, and audits it', async () => {
    await inTx(async (client) => {
      const m = await member(client);
      const secret = secretHash();
      const verifier = challenge();
      const before = Date.now();
      const receipt = await api(client).startStepUp(m.user.id, m.sessionId, 'administration', secret, verifier);
      expect(receipt.outcome).toBe('started');
      // 10 minutes from now.
      expect(receipt.expires_at.getTime() - before).toBeGreaterThan(10 * 60_000 - 5_000);
      expect(receipt.expires_at.getTime() - before).toBeLessThan(10 * 60_000 + 5_000);
      const nonce = await nonceOf(client, secret);
      expect(nonce).toMatchObject({
        account_id: m.accountId,
        session_id: m.sessionId,
        action_class: 'administration',
        secret_hash: secret,
        verifier_hash: verifier,
        email_hash: emailHash(m.user.email),
        status: 'open',
        ended_at: null,
        completed_session_id: null,
      });
      expect(nonce.expires_at).toEqual(receipt.expires_at);
      expect(await auditOf(client, 'step_up.started', `account:${m.accountId}`)).toEqual([
        {actor: `user:${m.user.id}`, action: 'step_up.started', target: `account:${m.accountId}`},
      ]);
    });
  });

  it('takes each of the four action classes, and nothing else', async () => {
    await inTx(async (client) => {
      const m = await member(client);
      for (const actionClass of ['administration', 'owner_deletion', 'account_deletion', 'close_instance']) {
        expect((await api(client).startStepUp(m.user.id, m.sessionId, actionClass, secretHash(), challenge())).outcome, actionClass).toBe('started');
      }
      for (const bad of ['', 'Administration', 'admin', 'administration ', "administration'; --"]) {
        const result = await attempt(client, 'service_role', 'select * from api.start_step_up($1, $2, $3, $4, $5)', [m.user.id, m.sessionId, bad, secretHash(), challenge()]);
        expect(result.ok, bad).toBe(false);
        if (!result.ok) expect(result.code, bad).toBe('22023');
      }
    });
  });

  it('rejects arguments the server never sends (a null, a secret or challenge of the wrong shape)', async () => {
    await inTx(async (client) => {
      const m = await member(client);
      const good = [m.user.id, m.sessionId, 'administration', secretHash(), challenge()];
      const bad: [string, unknown[]][] = [
        ['null user', [null, ...good.slice(1)]],
        ['null session', [good[0], null, ...good.slice(2)]],
        ['null class', [good[0], good[1], null, good[3], good[4]]],
        ['short secret hash', [...good.slice(0, 3), 'abc', good[4]]],
        ['upper-case secret hash', [...good.slice(0, 3), secretHash().toUpperCase(), good[4]]],
        ['short challenge', [...good.slice(0, 4), 'abc']],
        ['challenge with padding', [...good.slice(0, 4), `${challenge().slice(0, 42)}=`]],
      ];
      for (const [name, args] of bad) {
        const result = await attempt(client, 'service_role', 'select * from api.start_step_up($1, $2, $3, $4, $5)', args);
        expect(result.ok, name).toBe(false);
        if (!result.ok) expect(result.code, name).toBe('22023');
      }
    });
  });

  it('voids the Account\'s previous nonce: at most one is open, and the new one is the open one', async () => {
    await inTx(async (client) => {
      const m = await member(client);
      const first = await start(client, m);
      const second = await start(client, m);
      expect((await nonceOf(client, first.secret)).status).toBe('voided');
      expect((await nonceOf(client, first.secret)).ended_at).not.toBeNull();
      expect((await nonceOf(client, second.secret)).status).toBe('open');
      expect(await count(client, `select count(*) as n from identity.step_up_nonces where account_id = $1 and status = 'open'`, [m.accountId])).toBe(1);
    });
  });

  it('does not let a second open nonce exist for an Account, whoever writes it', async () => {
    await inTx(async (client) => {
      const m = await member(client);
      await start(client, m);
      const result = await attempt(
        client,
        null,
        `insert into identity.step_up_nonces (account_id, session_id, action_class, secret_hash, verifier_hash, email_hash, expires_at)
         values ($1, $2, 'administration', $3, $4, $5, now() + interval '10 minutes')`,
        [m.accountId, m.sessionId, secretHash(), challenge(), emailHash('x@example.test')],
      );
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.code).toBe('23505');
    });
  });

  it('refuses a session that does not hold a valid grant of an active Account, writing and voiding nothing', async () => {
    await inTx(async (client) => {
      const svc = api(client);
      const m = await member(client);
      const open = await start(client, m);

      // A user with no Account.
      const stranger = await addUser(client);
      const strangerSession = await addSession(client, stranger.id);
      expect((await svc.startStepUp(stranger.id, strangerSession, 'administration', secretHash(), challenge())).outcome).toBe('refused');
      // A session of the member's that has no grant, and one whose Auth session does not exist.
      const noGrant = await addSession(client, m.user.id);
      expect((await svc.startStepUp(m.user.id, noGrant, 'administration', secretHash(), challenge())).outcome).toBe('refused');
      expect((await svc.startStepUp(m.user.id, randomUUID(), 'administration', secretHash(), challenge())).outcome).toBe('refused');
      // Another user's session.
      expect((await svc.startStepUp(m.user.id, strangerSession, 'administration', secretHash(), challenge())).outcome).toBe('refused');
      // A revoked grant.
      const revoked = await addSession(client, m.user.id);
      await svc.issueGrant(m.user.id, revoked);
      await svc.revokeGrants({session: revoked});
      expect((await svc.startStepUp(m.user.id, revoked, 'administration', secretHash(), challenge())).outcome).toBe('refused');
      // The earlier open nonce was not voided by any of them.
      expect((await nonceOf(client, open.secret)).status).toBe('open');
      expect(await count(client, 'select count(*) as n from identity.step_up_nonces where account_id = $1', [m.accountId])).toBe(1);
    });
  });

  it('refuses a disabled Account, and a Google identity that is not the pinned one', async () => {
    await inTx(async (client) => {
      const svc = api(client);
      const changed = await member(client);
      await client.query(`update auth.identities set provider_id = 'another-subject' where user_id = $1`, [changed.user.id]);
      expect((await svc.startStepUp(changed.user.id, changed.sessionId, 'administration', secretHash(), challenge())).outcome).toBe('refused');

      const disabled = await member(client);
      await client.query(`update identity.accounts set status = 'disabled' where id = $1`, [disabled.accountId]);
      expect((await svc.startStepUp(disabled.user.id, disabled.sessionId, 'administration', secretHash(), challenge())).outcome).toBe('refused');
      expect(await count(client, 'select count(*) as n from identity.step_up_nonces where account_id = any($1)', [[changed.accountId, disabled.accountId]])).toBe(0);
    });
  });

  it('allows 10 starts an hour per Account, counted from the nonce rows: the eleventh is limited and changes nothing', async () => {
    await inTx(async (client) => {
      const svc = api(client);
      const m = await member(client);
      let last!: Started;
      for (let i = 0; i < 10; i += 1) last = await start(client, m);
      const eleventh = await svc.startStepUp(m.user.id, m.sessionId, 'administration', secretHash(), challenge());
      expect(eleventh.outcome).toBe('limited');
      expect(eleventh.expires_at).toBeNull();
      // The tenth is still the open one: a refused start does not void anything.
      expect((await nonceOf(client, last.secret)).status).toBe('open');
      expect(await count(client, 'select count(*) as n from identity.step_up_nonces where account_id = $1', [m.accountId])).toBe(10);
      // Audited, once an hour.
      await svc.startStepUp(m.user.id, m.sessionId, 'administration', secretHash(), challenge());
      expect(await auditOf(client, 'step_up.limited', `account:${m.accountId}`)).toHaveLength(1);
    });
  });

  it('counts per Account, and forgets a start an hour later', async () => {
    await inTx(async (client) => {
      const svc = api(client);
      const a = await member(client);
      const b = await member(client);
      for (let i = 0; i < 10; i += 1) await start(client, a);
      expect((await svc.startStepUp(a.user.id, a.sessionId, 'administration', secretHash(), challenge())).outcome).toBe('limited');
      expect((await svc.startStepUp(b.user.id, b.sessionId, 'administration', secretHash(), challenge())).outcome).toBe('started');
      // All ten move back an hour and a minute: the count falls to zero.
      await client.query(`update identity.step_up_nonces set started_at = started_at - interval '61 minutes', expires_at = expires_at - interval '61 minutes' where account_id = $1`, [a.accountId]);
      expect((await svc.startStepUp(a.user.id, a.sessionId, 'administration', secretHash(), challenge())).outcome).toBe('started');
    });
  });

  it('counts the 59th minute and not the 61st', async () => {
    await inTx(async (client) => {
      const svc = api(client);
      const m = await member(client);
      for (let i = 0; i < 10; i += 1) await start(client, m);
      await client.query(`update identity.step_up_nonces set started_at = clock_timestamp() - interval '59 minutes', expires_at = clock_timestamp() - interval '49 minutes' where account_id = $1`, [m.accountId]);
      expect((await svc.startStepUp(m.user.id, m.sessionId, 'administration', secretHash(), challenge())).outcome).toBe('limited');
      await client.query(`update identity.step_up_nonces set started_at = clock_timestamp() - interval '61 minutes', expires_at = clock_timestamp() - interval '51 minutes' where account_id = $1`, [m.accountId]);
      expect((await svc.startStepUp(m.user.id, m.sessionId, 'administration', secretHash(), challenge())).outcome).toBe('started');
    });
  });
});

// ---------------------------------------------------------------------------------------------------
describe('completing a step-up: the same person signs in again (AC-4, AC-9)', () => {
  it('accepts the new session: its grant, its 5-minute marker for the class, the initiating grant revoked, the nonce consumed, all audited', async () => {
    await inTx(async (client) => {
      const svc = api(client);
      const m = await member(client);
      const flow = await start(client, m, {actionClass: 'owner_deletion'});
      const fresh = await signInAgain(client, m.user.id);
      const before = Date.now();

      expect(await svc.completeStepUp(m.user.id, fresh, flow.secret, flow.verifier)).toEqual({outcome: 'accepted', reason: null, action_class: 'owner_deletion'});

      // The new session has its grant, the normal way, at the Account's epoch.
      expect(await grantOf(client, fresh)).toMatchObject({session_id: fresh, account_id: m.accountId, epoch: '1', revoked_at: null});
      expect(await stateOf(client, m, fresh)).toBe('active');
      // The marker belongs to the new session only: this class, 5 minutes, the nonce's own start time.
      const nonce = await nonceOf(client, flow.secret);
      const [marker, ...rest] = await markersOf(client, fresh);
      expect(rest).toEqual([]);
      expect(marker).toMatchObject({session_id: fresh, action_class: 'owner_deletion', account_id: m.accountId, nonce_id: nonce.id, consumed_at: null});
      expect(marker.step_up_started_at).toEqual(nonce.started_at);
      expect(marker.expires_at.getTime() - marker.issued_at.getTime()).toBe(5 * 60_000);
      expect(Math.abs(marker.issued_at.getTime() - before)).toBeLessThan(5_000);
      expect(await markersOf(client, m.sessionId)).toEqual([]);
      // The initiating grant is revoked, by the user, for step_up, and is refused from now on.
      expect(await grantOf(client, m.sessionId)).toMatchObject({revoked_by: `user:${m.user.id}`, revoked_reason: 'step_up'});
      expect(await stateOf(client, m, m.sessionId)).toBe('revoked');
      // The nonce is consumed by the session it accepted.
      expect(nonce).toMatchObject({status: 'completed', completed_session_id: fresh});
      expect(nonce.ended_at).not.toBeNull();
      // Audited: the completion, the grant that was issued and the one that was revoked.
      expect(await auditOf(client, 'step_up.completed', `session:${fresh}`)).toEqual([{actor: `user:${m.user.id}`, action: 'step_up.completed', target: `session:${fresh}`}]);
      expect(await auditOf(client, 'session.issued', `session:${fresh}`)).toHaveLength(1);
      expect(await auditOf(client, 'session.revoked', `session:${m.sessionId}`)).toEqual([{actor: `user:${m.user.id}`, action: 'session.revoked', target: `session:${m.sessionId}`}]);
    });
  });

  it('leaves the Account\'s other sessions alone', async () => {
    await inTx(async (client) => {
      const svc = api(client);
      const m = await member(client);
      const other = await addSession(client, m.user.id);
      await svc.issueGrant(m.user.id, other);
      const flow = await start(client, m);
      const fresh = await signInAgain(client, m.user.id);
      expect((await svc.completeStepUp(m.user.id, fresh, flow.secret, flow.verifier)).outcome).toBe('accepted');
      expect(await stateOf(client, m, other)).toBe('active');
    });
  });

  it('accepts a sign-in whose amr row was created exactly at the nonce start (at or after, not only after)', async () => {
    await inTx(async (client) => {
      const svc = api(client);
      const m = await member(client);
      const flow = await start(client, m);
      // To the microsecond: a JavaScript Date cannot carry it, so the row is written from the nonce itself.
      const fresh = await signInAgain(client, m.user.id, {amr: false});
      await client.query(
        `insert into auth.mfa_amr_claims (id, session_id, created_at, updated_at, authentication_method)
         select gen_random_uuid(), $1, n.started_at, n.started_at, 'oauth' from identity.step_up_nonces n where n.secret_hash = $2`,
        [fresh, flow.secret],
      );
      expect((await svc.completeStepUp(m.user.id, fresh, flow.secret, flow.verifier)).outcome).toBe('accepted');
    });
  });

  it('accepts nothing from the caller beyond the user, the session and two hashes', async () => {
    const {rows} = await db.query(`select pg_get_function_arguments('api.complete_step_up(uuid, uuid, text, text)'::regprocedure) as args`);
    expect(rows[0].args).toBe('p_user_id uuid, p_session_id uuid, p_secret_hash text, p_verifier_hash text');
    const start_ = await db.query(`select pg_get_function_arguments('api.start_step_up(uuid, uuid, text, text, text)'::regprocedure) as args`);
    expect(start_.rows[0].args).toBe('p_user_id uuid, p_session_id uuid, p_action_class text, p_secret_hash text, p_verifier_hash text');
  });
});

// ---------------------------------------------------------------------------------------------------
describe('completing a step-up that must NOT become fresh (AC-4)', () => {
  /** Nothing fresh, nothing granted, the initiating session untouched. */
  async function expectNothingFresh(client: Client, m: Member, fresh: string, flow: Started, nonceStatus: string | null) {
    expect(await grantOf(client, fresh), 'no grant for the new session').toBeUndefined();
    expect(await markersOf(client, fresh), 'no marker for the new session').toEqual([]);
    expect(await markersOf(client, m.sessionId), 'no marker for the initiating session').toEqual([]);
    expect(await grantOf(client, m.sessionId), 'the initiating grant is untouched').toMatchObject({revoked_at: null, revoked_by: null, revoked_reason: null});
    expect(await stateOf(client, m, m.sessionId)).toBe('active');
    if (nonceStatus) expect((await nonceOf(client, flow.secret)).status).toBe(nonceStatus);
    expect(await count(client, 'select count(*) as n from identity.fresh_authentications where account_id = $1', [m.accountId])).toBe(0);
  }

  it('another Google account signs in: rejected as a mismatch, audited, the nonce burned, only the new session is affected', async () => {
    await inTx(async (client) => {
      const svc = api(client);
      const m = await member(client);
      const flow = await start(client, m);
      // A different Google account is a different Auth user, with or without an Account of its own.
      const other = await member(client);
      const strangerUser = await addUser(client);
      const strangerSession = await signInAgain(client, strangerUser.id);
      const otherSession = await signInAgain(client, other.user.id);
      const rejection = await svc.completeStepUp(strangerUser.id, strangerSession, flow.secret, flow.verifier);
      expect(rejection).toEqual({outcome: 'rejected', reason: 'mismatch', action_class: 'administration'});
      await expectNothingFresh(client, m, strangerSession, flow, 'rejected');
      // Audited against the Account whose step-up it was, with the reason in the action: the new session's ID would
      // not outlive its Auth session.
      expect(await auditOf(client, 'step_up.rejected.mismatch', `account:${m.accountId}`)).toEqual([
        {actor: 'system:step_up', action: 'step_up.rejected.mismatch', target: `account:${m.accountId}`},
      ]);
      // The burned nonce cannot be tried again, even by the right person.
      const right = await signInAgain(client, m.user.id);
      expect(await svc.completeStepUp(m.user.id, right, flow.secret, flow.verifier)).toMatchObject({outcome: 'rejected', reason: 'used'});
      await expectNothingFresh(client, m, right, flow, 'rejected');
      // Another Account that holds its own Account is no better: the nonce is not its.
      const second = await start(client, m);
      expect(await svc.completeStepUp(other.user.id, otherSession, second.secret, second.verifier)).toMatchObject({outcome: 'rejected', reason: 'mismatch'});
      expect(await grantOf(client, otherSession)).toBeUndefined();
      expect(await stateOf(client, other, other.sessionId)).toBe('active');
    });
  });

  it('another browser completes (no cookie there): an ordinary sign-in, with nothing written', async () => {
    await inTx(async (client) => {
      const svc = api(client);
      const m = await member(client);
      const flow = await start(client, m);
      const fresh = await signInAgain(client, m.user.id);
      const audits = await count(client, 'select count(*) as n from identity.audit_events');
      // The other browser holds no cookie, or one that names nothing.
      expect(await svc.completeStepUp(m.user.id, fresh, secretHash(), flow.verifier)).toEqual({outcome: 'not_step_up', reason: 'unknown', action_class: null});
      expect(await count(client, 'select count(*) as n from identity.audit_events')).toBe(audits);
      await expectNothingFresh(client, m, fresh, flow, 'open');
    });
  });

  it('a sign-in started any other way is not mistaken for the step-up, and leaves it open', async () => {
    await inTx(async (client) => {
      const svc = api(client);
      const m = await member(client);
      const flow = await start(client, m);
      // This browser holds the cookie, but THIS sign-in began from a different PKCE flow.
      const ordinary = await signInAgain(client, m.user.id);
      expect(await svc.completeStepUp(m.user.id, ordinary, flow.secret, challenge())).toEqual({outcome: 'not_step_up', reason: 'other_flow', action_class: null});
      await expectNothingFresh(client, m, ordinary, flow, 'open');
      // The step-up itself can still come back and complete.
      const real = await signInAgain(client, m.user.id);
      expect((await svc.completeStepUp(m.user.id, real, flow.secret, flow.verifier)).outcome).toBe('accepted');
    });
  });

  it('an expired nonce is rejected, and marked expired', async () => {
    await inTx(async (client) => {
      const svc = api(client);
      const m = await member(client);
      const flow = await start(client, m);
      await ageNonce(client, flow.secret, 11);
      const fresh = await signInAgain(client, m.user.id);
      expect(await svc.completeStepUp(m.user.id, fresh, flow.secret, flow.verifier)).toEqual({outcome: 'rejected', reason: 'expired', action_class: 'administration'});
      await expectNothingFresh(client, m, fresh, flow, 'expired');
      expect(await auditOf(client, 'step_up.rejected.expired', `account:${m.accountId}`)).toHaveLength(1);
    });
  });

  it('a nonce is good until 10 minutes: one that expires in a second is accepted, one that expired a second ago is not', async () => {
    await inTx(async (client) => {
      const svc = api(client);
      const m = await member(client);
      const live = await start(client, m);
      await client.query(`update identity.step_up_nonces set started_at = clock_timestamp() - interval '9 minutes 58 seconds', expires_at = clock_timestamp() + interval '2 seconds' where secret_hash = $1`, [live.secret]);
      const fresh = await signInAgain(client, m.user.id);
      expect((await svc.completeStepUp(m.user.id, fresh, live.secret, live.verifier)).outcome).toBe('accepted');

      const m2 = await member(client);
      const dead = await start(client, m2);
      await client.query(`update identity.step_up_nonces set started_at = clock_timestamp() - interval '10 minutes 1 second', expires_at = clock_timestamp() - interval '1 second' where secret_hash = $1`, [dead.secret]);
      const late = await signInAgain(client, m2.user.id);
      expect(await svc.completeStepUp(m2.user.id, late, dead.secret, dead.verifier)).toMatchObject({outcome: 'rejected', reason: 'expired'});
    });
  });

  it('a replaced nonce (a newer start) is rejected, and the newer one still completes', async () => {
    await inTx(async (client) => {
      const svc = api(client);
      const m = await member(client);
      const first = await start(client, m);
      const second = await start(client, m);
      const fresh = await signInAgain(client, m.user.id);
      expect(await svc.completeStepUp(m.user.id, fresh, first.secret, first.verifier)).toEqual({outcome: 'rejected', reason: 'replaced', action_class: 'administration'});
      await expectNothingFresh(client, m, fresh, first, 'voided');
      const again = await signInAgain(client, m.user.id);
      expect((await svc.completeStepUp(m.user.id, again, second.secret, second.verifier)).outcome).toBe('accepted');
    });
  });

  it('a completed nonce cannot be used again: no second marker, no second grant', async () => {
    await inTx(async (client) => {
      const svc = api(client);
      const m = await member(client);
      const flow = await start(client, m);
      const fresh = await signInAgain(client, m.user.id);
      expect((await svc.completeStepUp(m.user.id, fresh, flow.secret, flow.verifier)).outcome).toBe('accepted');
      const replay = await signInAgain(client, m.user.id);
      expect(await svc.completeStepUp(m.user.id, replay, flow.secret, flow.verifier)).toMatchObject({outcome: 'rejected', reason: 'used'});
      expect(await grantOf(client, replay)).toBeUndefined();
      expect(await markersOf(client, replay)).toEqual([]);
      expect(await count(client, 'select count(*) as n from identity.fresh_authentications where account_id = $1', [m.accountId])).toBe(1);
      // The first acceptance stands.
      expect(await stateOf(client, m, fresh)).toBe('active');
    });
  });

  it('a sign-in older than the nonce is rejected: amr before the start, a method other than oauth, or no amr row at all', async () => {
    await inTx(async (client) => {
      const svc = api(client);
      const m = await member(client);
      const cases: [string, (startedAt: Date) => Promise<string>][] = [
        ['an oauth row a second before the start', (startedAt) => signInAgain(client, m.user.id, {createdAt: new Date(startedAt.getTime() - 1_000)})],
        ['an oauth row an hour before the start', (startedAt) => signInAgain(client, m.user.id, {createdAt: new Date(startedAt.getTime() - 3_600_000)})],
        ['only a password row', () => signInAgain(client, m.user.id, {method: 'password'})],
        ['no amr row', () => signInAgain(client, m.user.id, {amr: false})],
      ];
      for (const [name, makeSession] of cases) {
        const flow = await start(client, m);
        const startedAt: Date = (await nonceOf(client, flow.secret)).started_at;
        const fresh = await makeSession(startedAt);
        expect(await svc.completeStepUp(m.user.id, fresh, flow.secret, flow.verifier), name).toEqual({outcome: 'rejected', reason: 'old_sign_in', action_class: 'administration'});
        await expectNothingFresh(client, m, fresh, flow, 'rejected');
      }
    });
  });

  it('never reads an amr from the caller: the only evidence is Auth\'s own table', async () => {
    const {rows} = await db.query(`select pg_get_functiondef('api.complete_step_up(uuid, uuid, text, text)'::regprocedure) as def`);
    expect(rows[0].def).toContain('auth.mfa_amr_claims');
    expect(rows[0].def).not.toMatch(/raw_app_meta_data|jwt|current_setting|request\.jwt/i);
  });

  it('the initiating session cannot be the new one', async () => {
    await inTx(async (client) => {
      const svc = api(client);
      const m = await member(client);
      const flow = await start(client, m);
      await insertAmrClaim(client, m.sessionId);
      expect(await svc.completeStepUp(m.user.id, m.sessionId, flow.secret, flow.verifier)).toMatchObject({outcome: 'rejected', reason: 'same_session'});
      expect(await markersOf(client, m.sessionId)).toEqual([]);
      expect(await stateOf(client, m, m.sessionId)).toBe('active');
    });
  });

  it('a session Auth does not have for this user is rejected: one that never existed, one of another user', async () => {
    await inTx(async (client) => {
      const svc = api(client);
      const m = await member(client);
      const flow = await start(client, m);
      expect(await svc.completeStepUp(m.user.id, randomUUID(), flow.secret, flow.verifier)).toMatchObject({outcome: 'rejected', reason: 'no_session'});
      const flow2 = await start(client, m);
      const stranger = await addUser(client);
      const theirs = await signInAgain(client, stranger.id);
      // The right user, but a session that is another user's: not a new session of this person.
      expect(await svc.completeStepUp(m.user.id, theirs, flow2.secret, flow2.verifier)).toMatchObject({outcome: 'rejected', reason: 'no_session'});
      expect(await grantOf(client, theirs)).toBeUndefined();
    });
  });

  it('a disabled Account is rejected', async () => {
    await inTx(async (client) => {
      const svc = api(client);
      const m = await member(client);
      const flow = await start(client, m);
      const fresh = await signInAgain(client, m.user.id);
      await client.query(`update identity.accounts set status = 'disabled' where id = $1`, [m.accountId]);
      expect(await svc.completeStepUp(m.user.id, fresh, flow.secret, flow.verifier)).toMatchObject({outcome: 'rejected', reason: 'disabled'});
      expect(await grantOf(client, fresh)).toBeUndefined();
      expect(await markersOf(client, fresh)).toEqual([]);
    });
  });

  it('a different verified email, a replaced subject, or a second Google identity is rejected as a mismatch', async () => {
    await inTx(async (client) => {
      const svc = api(client);
      const emailChanged = await member(client);
      const emailFlow = await start(client, emailChanged);
      await client.query(`update auth.users set email = 'someone-else@example.test' where id = $1`, [emailChanged.user.id]);
      await client.query(`update auth.identities set identity_data = jsonb_set(identity_data, '{email}', '"someone-else@example.test"') where user_id = $1`, [emailChanged.user.id]);
      const a = await signInAgain(client, emailChanged.user.id);
      expect(await svc.completeStepUp(emailChanged.user.id, a, emailFlow.secret, emailFlow.verifier)).toMatchObject({outcome: 'rejected', reason: 'mismatch'});
      expect(await grantOf(client, a)).toBeUndefined();

      const subjectChanged = await member(client);
      const subjectFlow = await start(client, subjectChanged);
      await client.query(`update auth.identities set provider_id = 'a-new-subject' where user_id = $1`, [subjectChanged.user.id]);
      const b = await signInAgain(client, subjectChanged.user.id);
      expect(await svc.completeStepUp(subjectChanged.user.id, b, subjectFlow.secret, subjectFlow.verifier)).toMatchObject({outcome: 'rejected', reason: 'mismatch'});

      const second = await member(client);
      const secondFlow = await start(client, second);
      await client.query(
        `insert into auth.identities (provider_id, user_id, identity_data, provider, created_at, updated_at) values ('extra-subject', $1, '{"email_verified": true}', 'google', now(), now())`,
        [second.user.id],
      );
      const c = await signInAgain(client, second.user.id);
      expect(await svc.completeStepUp(second.user.id, c, secondFlow.secret, secondFlow.verifier)).toMatchObject({outcome: 'rejected', reason: 'mismatch'});
      for (const m of [emailChanged, subjectChanged, second]) expect(await markersOf(client, m.sessionId)).toEqual([]);
      expect(await count(client, 'select count(*) as n from identity.fresh_authentications where account_id = any($1)', [[emailChanged.accountId, subjectChanged.accountId, second.accountId]])).toBe(0);
    });
  });

  it('is all or nothing: a step-up that cannot give the new session a grant leaves the initiating grant and the nonce as they were', async () => {
    await inTx(async (client) => {
      const svc = api(client);
      const m = await member(client);
      const flow = await start(client, m);
      const fresh = await signInAgain(client, m.user.id);
      // A grant that already exists for the new session and is revoked: issue_grant answers `revoked`, not `exists`.
      await client.query(`insert into identity.session_grants (session_id, account_id, epoch) values ($1, $2, 1)`, [fresh, m.accountId]);
      await client.query(`update identity.session_grants set revoked_at = now(), revoked_by = 'system:test', revoked_reason = 'test' where session_id = $1`, [fresh]);
      expect(await svc.completeStepUp(m.user.id, fresh, flow.secret, flow.verifier)).toMatchObject({outcome: 'rejected', reason: 'grant_revoked'});
      expect(await markersOf(client, fresh)).toEqual([]);
      expect(await stateOf(client, m, m.sessionId)).toBe('active');
    });
  });

  it('audits every rejection against the Account with the reason in the action, and the evidence outlives the Auth session', async () => {
    await inTx(async (client) => {
      const svc = api(client);
      const m = await member(client);
      const reasons: [string, () => Promise<Record<string, any>>][] = [
        [
          'expired',
          async () => {
            const flow = await start(client, m);
            await ageNonce(client, flow.secret, 11);
            return svc.completeStepUp(m.user.id, await signInAgain(client, m.user.id), flow.secret, flow.verifier);
          },
        ],
        [
          'replaced',
          async () => {
            const first = await start(client, m);
            await start(client, m);
            return svc.completeStepUp(m.user.id, await signInAgain(client, m.user.id), first.secret, first.verifier);
          },
        ],
        [
          'old_sign_in',
          async () => {
            const flow = await start(client, m);
            return svc.completeStepUp(m.user.id, await signInAgain(client, m.user.id, {amr: false}), flow.secret, flow.verifier);
          },
        ],
        [
          'same_session',
          async () => {
            const flow = await start(client, m);
            return svc.completeStepUp(m.user.id, m.sessionId, flow.secret, flow.verifier);
          },
        ],
        [
          'no_session',
          async () => {
            const flow = await start(client, m);
            return svc.completeStepUp(m.user.id, randomUUID(), flow.secret, flow.verifier);
          },
        ],
      ];
      for (const [reason, run] of reasons) {
        expect((await run()).reason, reason).toBe(reason);
        expect(await auditOf(client, `step_up.rejected.${reason}`, `account:${m.accountId}`), reason).toEqual([
          {actor: 'system:step_up', action: `step_up.rejected.${reason}`, target: `account:${m.accountId}`},
        ]);
      }
      // Every action is in the audit grammar, and nothing was written against a session.
      const {rows} = await client.query(`select action, target from identity.audit_events where action like 'step_up.rejected.%' and target = $1`, [`account:${m.accountId}`]);
      expect(rows).toHaveLength(reasons.length);
      for (const row of rows) expect(row.action).toMatch(/^[a-z][a-z_]*(\.[a-z][a-z_]*)+$/);
      // The Auth session of a rejected sign-in is deleted; the event still says whose Account and why.
      await client.query('delete from auth.sessions where user_id = $1 and id <> $2', [m.user.id, m.sessionId]);
      expect(await count(client, `select count(*) as n from identity.audit_events where action like 'step_up.rejected.%' and target = $1`, [`account:${m.accountId}`])).toBe(reasons.length);
    });
  });

  it('records no secret, hash or challenge in an audit event', async () => {
    await inTx(async (client) => {
      const svc = api(client);
      const m = await member(client);
      const flow = await start(client, m);
      const fresh = await signInAgain(client, m.user.id);
      await svc.completeStepUp(m.user.id, fresh, flow.secret, flow.verifier);
      const other = await member(client);
      const second = await start(client, other);
      const strangerUser = await addUser(client);
      await svc.completeStepUp(strangerUser.id, await signInAgain(client, strangerUser.id), second.secret, second.verifier);
      const {rows} = await client.query(
        `select actor, action, coalesce(target, '') as target from identity.audit_events where action like 'step_up.%' and (actor = any($1) or actor = 'system:step_up')`,
        [[`user:${m.user.id}`, `user:${other.user.id}`]],
      );
      expect(rows.length).toBeGreaterThanOrEqual(3);
      // A rejection names the Account and the reason, and no session at all.
      const rejections = rows.filter((row) => row.action.startsWith('step_up.rejected.'));
      expect(rejections.length).toBeGreaterThanOrEqual(1);
      for (const row of rejections) expect(row.target).toMatch(/^account:[0-9a-f-]{36}$/);
      const text = JSON.stringify(rows);
      for (const value of [flow.secret, flow.verifier, second.secret, second.verifier, emailHash(m.user.email), m.user.email, other.user.email]) expect(text).not.toContain(value);
    });
  });
});

// ---------------------------------------------------------------------------------------------------
describe('a NULL refuses; it never falls through as "not different"', () => {
  /** Replaces a function for the rest of the (rolled back) transaction. */
  const replace = (client: Client, sql: string) => client.query(sql);
  const nullAuthorization = (body: string) =>
    `create or replace function api.authorize_session(p_user_id uuid, p_session_id uuid) returns api.session_authorization
       language sql security definer set search_path = '' as $$ ${body} $$`;

  it('start_step_up refuses when the authorization is absent or all NULL, and writes no nonce', async () => {
    for (const body of ['select null::api.session_authorization', 'select (null, null, null, null, null, null)::api.session_authorization', `select ('active', null, null, null, null, null)::api.session_authorization`]) {
      await inTx(async (client) => {
        const m = await member(client);
        await replace(client, nullAuthorization(body));
        const receipt = await api(client).startStepUp(m.user.id, m.sessionId, 'administration', secretHash(), challenge());
        expect(receipt, body).toEqual({outcome: 'refused', expires_at: null});
        expect(await count(client, 'select count(*) as n from identity.step_up_nonces where account_id = $1', [m.accountId]), body).toBe(0);
        expect(await count(client, `select count(*) as n from identity.audit_events where action = 'step_up.started' and target = $1`, [`account:${m.accountId}`]), body).toBe(0);
      });
    }
  });

  it('use_marker denies when the authorization is absent or all NULL, and consumes nothing', async () => {
    await inTx(async (client) => {
      const svc = api(client);
      const m = await member(client);
      const flow = await start(client, m, {actionClass: 'account_deletion'});
      const session = await signInAgain(client, m.user.id);
      expect((await svc.completeStepUp(m.user.id, session, flow.secret, flow.verifier)).outcome).toBe('accepted');
      for (const body of ['select null::api.session_authorization', 'select (null, null, null, null, null, null)::api.session_authorization', `select ('active', null, null, null, null, null)::api.session_authorization`]) {
        await replace(client, nullAuthorization(body));
        expect(await svc.useMarker(m.user.id, session, 'account_deletion', new Date(0)), body).toEqual({outcome: 'denied'});
      }
      expect((await markersOf(client, session))[0].consumed_at).toBeNull();
    });
  });

  it('start_step_up refuses an identity with no subject or no email, instead of failing on a constraint or starting', async () => {
    for (const [name, row] of [['no subject', `select 'x@example.test'::text, null::text`], ['no email', `select null::text, google_subject from identity.accounts limit 1`]] as const) {
      await inTx(async (client) => {
        const m = await member(client);
        await replace(
          client,
          `create or replace function identity.verified_google(p_user_id uuid) returns table (verified_email text, google_subject text)
             language sql stable set search_path = '' as $$ ${row} $$`,
        );
        expect(await api(client).startStepUp(m.user.id, m.sessionId, 'administration', secretHash(), challenge()), name).toEqual({outcome: 'refused', expires_at: null});
        expect(await count(client, 'select count(*) as n from identity.step_up_nonces where account_id = $1', [m.accountId]), name).toBe(0);
      });
    }
  });

  it('complete_step_up rejects, and does not accept, when the identity answers with no subject (the same email, so only the subject can say no) or no email', async () => {
    for (const name of ['no subject', 'no email']) {
      await inTx(async (client) => {
        const svc = api(client);
        const m = await member(client);
        const flow = await start(client, m);
        const fresh = await signInAgain(client, m.user.id);
        const row = name === 'no subject' ? `select '${m.user.email}'::text, null::text` : `select null::text, 'whatever'::text`;
        await replace(
          client,
          `create or replace function identity.verified_google(p_user_id uuid) returns table (verified_email text, google_subject text)
             language sql stable set search_path = '' as $$ ${row} $$`,
        );
        expect(await svc.completeStepUp(m.user.id, fresh, flow.secret, flow.verifier), name).toMatchObject({outcome: 'rejected', reason: 'mismatch'});
        expect(await grantOf(client, fresh), name).toBeUndefined();
        expect(await markersOf(client, fresh), name).toEqual([]);
        expect(await stateOf(client, m, m.sessionId), name).toBe('active');
      });
    }
  });
});

// ---------------------------------------------------------------------------------------------------
describe('the same person is the same person whatever the case of the address (hash only)', () => {
  const stubIdentity = (client: Client, email: string, subject: string) =>
    client.query(
      `create or replace function identity.verified_google(p_user_id uuid) returns table (verified_email text, google_subject text)
         language sql stable set search_path = '' as $$ select '${email}'::text, '${subject}'::text $$`,
    );

  it('an address that differs only in case is accepted, with the identity helper handing back either spelling', async () => {
    await inTx(async (client) => {
      const svc = api(client);
      const m = await member(client);
      const subject = (await client.query('select google_subject from identity.accounts where id = $1', [m.accountId])).rows[0].google_subject as string;
      await stubIdentity(client, 'Mixed.Case@Example.TEST', subject);
      const flow = await start(client, m);
      // The stored hash is of the lower-case spelling.
      expect((await nonceOf(client, flow.secret)).email_hash).toBe(emailHash('mixed.case@example.test'));
      await stubIdentity(client, 'MIXED.CASE@example.test', subject);
      const fresh = await signInAgain(client, m.user.id);
      expect((await svc.completeStepUp(m.user.id, fresh, flow.secret, flow.verifier)).outcome).toBe('accepted');
    });
  });

  it('a different address is still another person, in any case', async () => {
    await inTx(async (client) => {
      const svc = api(client);
      const m = await member(client);
      const subject = (await client.query('select google_subject from identity.accounts where id = $1', [m.accountId])).rows[0].google_subject as string;
      await stubIdentity(client, 'Someone@Example.test', subject);
      const flow = await start(client, m);
      await stubIdentity(client, 'SOMEONE.ELSE@EXAMPLE.TEST', subject);
      const fresh = await signInAgain(client, m.user.id);
      expect(await svc.completeStepUp(m.user.id, fresh, flow.secret, flow.verifier)).toMatchObject({outcome: 'rejected', reason: 'mismatch'});
    });
  });

  it('an Auth user whose address is stored in capitals is the same person (the real helper, no stub)', async () => {
    await inTx(async (client) => {
      const svc = api(client);
      const m = await member(client);
      const flow = await start(client, m);
      expect((await nonceOf(client, flow.secret)).email_hash).toBe(emailHash(m.user.email));
      await client.query(`update auth.users set email = upper(email) where id = $1`, [m.user.id]);
      await client.query(`update auth.identities set identity_data = jsonb_set(identity_data, '{email}', to_jsonb(upper(identity_data ->> 'email'))) where user_id = $1`, [m.user.id]);
      const fresh = await signInAgain(client, m.user.id);
      expect((await svc.completeStepUp(m.user.id, fresh, flow.secret, flow.verifier)).outcome).toBe('accepted');
    });
  });
});

// ---------------------------------------------------------------------------------------------------
describe('the markers: one session, one class, five minutes (AC-4)', () => {
  async function fresh(client: Client, actionClass: string) {
    const m = await member(client);
    const flow = await start(client, m, {actionClass});
    const session = await signInAgain(client, m.user.id);
    expect((await api(client).completeStepUp(m.user.id, session, flow.secret, flow.verifier)).outcome).toBe('accepted');
    return {m, session, flow};
  }

  it.each(['administration', 'owner_deletion'])('%s: allowed again and again for 5 minutes, then refused', async (actionClass) => {
    await inTx(async (client) => {
      const svc = api(client);
      const {m, session} = await fresh(client, actionClass);
      expect(await svc.useMarker(m.user.id, session, actionClass)).toEqual({outcome: 'allowed'});
      expect(await svc.useMarker(m.user.id, session, actionClass)).toEqual({outcome: 'allowed'});
      // Not consumed.
      expect((await markersOf(client, session))[0].consumed_at).toBeNull();
      // 4 minutes 59 seconds in, still allowed; 5 minutes 1 second in, refused.
      await client.query(`update identity.fresh_authentications set issued_at = clock_timestamp() - interval '4 minutes 59 seconds', expires_at = clock_timestamp() + interval '1 second' where session_id = $1`, [session]);
      expect(await svc.useMarker(m.user.id, session, actionClass)).toEqual({outcome: 'allowed'});
      await client.query(`update identity.fresh_authentications set issued_at = clock_timestamp() - interval '5 minutes 1 second', expires_at = clock_timestamp() - interval '1 second' where session_id = $1`, [session]);
      expect(await svc.useMarker(m.user.id, session, actionClass)).toEqual({outcome: 'expired'});
    });
  });

  it.each(['account_deletion', 'close_instance'])('%s: consumed by use (twice is once), and only after a step-up that started after the confirmation was shown', async (actionClass) => {
    await inTx(async (client) => {
      const svc = api(client);
      const {m, session, flow} = await fresh(client, actionClass);
      const startedAt: Date = (await nonceOf(client, flow.secret)).started_at;
      // The start time to the microsecond, which a JavaScript Date cannot carry.
      const exact = (await client.query('select started_at::text as at from identity.step_up_nonces where secret_hash = $1', [flow.secret])).rows[0].at as string;
      // The caller must say when its confirmation was shown.
      const missing = await attempt(client, 'service_role', 'select * from api.use_marker($1, $2, $3, null)', [m.user.id, session, actionClass]);
      expect(missing.ok).toBe(false);
      if (!missing.ok) expect(missing.code).toBe('22023');
      // A confirmation shown after the step-up started: the marker is stale, and is NOT consumed by the refusal.
      expect(await svc.useMarker(m.user.id, session, actionClass, new Date(startedAt.getTime() + 1_000))).toEqual({outcome: 'stale'});
      expect(await svc.useMarker(m.user.id, session, actionClass, exact)).toEqual({outcome: 'stale'});
      expect((await markersOf(client, session))[0].consumed_at).toBeNull();
      // Shown before it started: allowed, once.
      const shown = new Date(startedAt.getTime() - 1_000);
      expect(await svc.useMarker(m.user.id, session, actionClass, shown)).toEqual({outcome: 'allowed'});
      expect((await markersOf(client, session))[0].consumed_at).not.toBeNull();
      expect(await svc.useMarker(m.user.id, session, actionClass, shown)).toEqual({outcome: 'used'});
      expect(await auditOf(client, 'step_up.marker_consumed', `session:${session}`)).toHaveLength(1);
    });
  });

  it('a consumed class expires after 5 minutes too, unused', async () => {
    await inTx(async (client) => {
      const {m, session, flow} = await fresh(client, 'account_deletion');
      const startedAt: Date = (await nonceOf(client, flow.secret)).started_at;
      await ageMarker(client, session, 6);
      expect(await api(client).useMarker(m.user.id, session, 'account_deletion', new Date(startedAt.getTime() - 60_000))).toEqual({outcome: 'expired'});
    });
  });

  it('a started_after time may be given for the reusable classes too, and then applies', async () => {
    await inTx(async (client) => {
      const svc = api(client);
      const {m, session, flow} = await fresh(client, 'administration');
      const startedAt: Date = (await nonceOf(client, flow.secret)).started_at;
      expect(await svc.useMarker(m.user.id, session, 'administration', new Date(startedAt.getTime() + 1_000))).toEqual({outcome: 'stale'});
      expect(await svc.useMarker(m.user.id, session, 'administration', new Date(startedAt.getTime() - 1_000))).toEqual({outcome: 'allowed'});
    });
  });

  it('belongs to the new session only: the initiating session and every other session of the Account are refused', async () => {
    await inTx(async (client) => {
      const svc = api(client);
      const {m, session} = await fresh(client, 'administration');
      // The initiating session: its grant was revoked by the step-up, so it is denied, whatever markers exist.
      expect(await svc.useMarker(m.user.id, m.sessionId, 'administration')).toEqual({outcome: 'denied'});
      // Another session of the Account with a perfectly valid grant has no marker.
      const other = await addSession(client, m.user.id);
      await svc.issueGrant(m.user.id, other);
      expect(await svc.useMarker(m.user.id, other, 'administration')).toEqual({outcome: 'none'});
      // Not even by the same call with the initiating session's own valid grant back: there is no marker for it.
      expect(await markersOf(client, m.sessionId)).toEqual([]);
      // And another user cannot use this session's marker.
      const stranger = await addUser(client);
      expect(await svc.useMarker(stranger.id, session, 'administration')).toEqual({outcome: 'denied'});
    });
  });

  it('is for its class only', async () => {
    await inTx(async (client) => {
      const svc = api(client);
      const {m, session} = await fresh(client, 'administration');
      for (const other of ['owner_deletion']) expect(await svc.useMarker(m.user.id, session, other)).toEqual({outcome: 'none'});
      for (const other of ['account_deletion', 'close_instance']) expect(await svc.useMarker(m.user.id, session, other, new Date(0))).toEqual({outcome: 'none'});
    });
  });

  it('is of no use to a session whose grant has ended, or whose Account is disabled', async () => {
    await inTx(async (client) => {
      const svc = api(client);
      const {m, session} = await fresh(client, 'administration');
      expect(await svc.useMarker(m.user.id, session, 'administration')).toEqual({outcome: 'allowed'});
      await svc.revokeGrants({session});
      expect(await svc.useMarker(m.user.id, session, 'administration')).toEqual({outcome: 'denied'});

      const second = await fresh(client, 'administration');
      await client.query(`update identity.accounts set status = 'disabled' where id = $1`, [second.m.accountId]);
      expect(await svc.useMarker(second.m.user.id, second.session, 'administration')).toEqual({outcome: 'denied'});
    });
  });

  it('is no marker at all when its row names an Account other than the session\'s own (the lookup checks the Account, not only the session)', async () => {
    await inTx(async (client) => {
      const svc = api(client);
      const a = await member(client);
      const b = await member(client);
      // A row that should never exist: B's session, A's Account, written as the owner. The lookup must not honor it.
      const flow = await start(client, a);
      const nonce = await nonceOf(client, flow.secret);
      await client.query(
        `insert into identity.fresh_authentications (session_id, action_class, account_id, nonce_id, step_up_started_at, expires_at)
         values ($1, 'administration', $2, $3, $4, now() + interval '5 minutes')`,
        [b.sessionId, a.accountId, nonce.id, nonce.started_at],
      );
      expect(await svc.useMarker(b.user.id, b.sessionId, 'administration')).toEqual({outcome: 'none'});
    });
  });

  it('is for a class on the list, and nothing else', async () => {
    await inTx(async (client) => {
      const {m, session} = await fresh(client, 'administration');
      for (const bad of ['', 'ADMINISTRATION', 'delete']) {
        const result = await attempt(client, 'service_role', 'select * from api.use_marker($1, $2, $3, null)', [m.user.id, session, bad]);
        expect(result.ok, bad).toBe(false);
        if (!result.ok) expect(result.code, bad).toBe('22023');
      }
    });
  });
});

// ---------------------------------------------------------------------------------------------------
describe('what the tables refuse, whoever writes', () => {
  it('a nonce cannot change what it is, and an ended nonce is final', async () => {
    await inTx(async (client) => {
      const m = await member(client);
      const flow = await start(client, m);
      for (const column of ['secret_hash', 'verifier_hash', 'email_hash']) {
        const result = await attempt(client, null, `update identity.step_up_nonces set ${column} = $2 where secret_hash = $1`, [flow.secret, column === 'secret_hash' ? secretHash() : column === 'verifier_hash' ? challenge() : emailHash('z@example.test')]);
        expect(result.ok, column).toBe(false);
        if (!result.ok) expect(result.code, column).toBe('55000');
      }
      for (const [column, value] of [['action_class', 'close_instance'], ['account_id', randomUUID()], ['session_id', randomUUID()]] as const) {
        const result = await attempt(client, null, `update identity.step_up_nonces set ${column} = $2 where secret_hash = $1`, [flow.secret, value]);
        expect(result.ok, column).toBe(false);
      }
      await client.query(`update identity.step_up_nonces set status = 'voided', ended_at = now() where secret_hash = $1`, [flow.secret]);
      const revive = await attempt(client, null, `update identity.step_up_nonces set status = 'open', ended_at = null where secret_hash = $1`, [flow.secret]);
      expect(revive.ok).toBe(false);
      if (!revive.ok) expect(revive.code).toBe('55000');
    });
  });

  it('a marker cannot change what it is, and a consumed marker is final', async () => {
    await inTx(async (client) => {
      const svc = api(client);
      const m = await member(client);
      const flow = await start(client, m, {actionClass: 'close_instance'});
      const session = await signInAgain(client, m.user.id);
      await svc.completeStepUp(m.user.id, session, flow.secret, flow.verifier);
      for (const [column, value] of [['action_class', 'administration'], ['session_id', randomUUID()], ['account_id', randomUUID()]] as const) {
        const result = await attempt(client, null, `update identity.fresh_authentications set ${column} = $2 where session_id = $1`, [session, value]);
        expect(result.ok, column).toBe(false);
      }
      expect(await svc.useMarker(m.user.id, session, 'close_instance', new Date(0))).toEqual({outcome: 'allowed'});
      const unconsume = await attempt(client, null, `update identity.fresh_authentications set consumed_at = null where session_id = $1`, [session]);
      expect(unconsume.ok).toBe(false);
      if (!unconsume.ok) expect(unconsume.code).toBe('55000');
    });
  });

  it('one session has one marker per class (a second step-up is a second session)', async () => {
    await inTx(async (client) => {
      const m = await member(client);
      const flow = await start(client, m);
      const session = await signInAgain(client, m.user.id);
      await api(client).completeStepUp(m.user.id, session, flow.secret, flow.verifier);
      const marker = (await markersOf(client, session))[0];
      const again = await attempt(
        client,
        null,
        `insert into identity.fresh_authentications (session_id, action_class, account_id, nonce_id, step_up_started_at, expires_at) values ($1, 'administration', $2, $3, now(), now() + interval '5 minutes')`,
        [session, m.accountId, marker.nonce_id],
      );
      expect(again.ok).toBe(false);
    });
  });
});

// ---------------------------------------------------------------------------------------------------
describe('concurrency (real connections, committed data)', () => {
  it('two completions of one step-up at once: one is accepted, the other finds the nonce used', async () => {
    const account = await activeCommitted();
    const flow = await startCommitted(account);
    const sessions = [await signInAgain(db, account.user.id), await signInAgain(db, account.user.id)];
    const clients = await Promise.all([connect(), connect()]);
    const answers = await Promise.all(
      clients.map((client, i) => client.query('select outcome, reason from api.complete_step_up($1, $2, $3, $4)', [account.user.id, sessions[i], flow.secret, flow.verifier])),
    );
    const outcomes = answers.map((answer) => answer.rows[0]).sort((a, b) => a.outcome.localeCompare(b.outcome));
    expect(outcomes).toEqual([{outcome: 'accepted', reason: null}, {outcome: 'rejected', reason: 'used'}]);
    expect(await count(db, 'select count(*) as n from identity.fresh_authentications where account_id = $1', [account.accountId])).toBe(1);
    expect(await count(db, `select count(*) as n from identity.session_grants where account_id = $1 and revoked_at is null`, [account.accountId])).toBe(1);
  });

  it('two starts of one Account at once leave exactly one open nonce', async () => {
    const account = await activeCommitted();
    const clients = await Promise.all([connect(), connect(), connect()]);
    const answers = await Promise.all(
      clients.map((client) => client.query('select outcome from api.start_step_up($1, $2, $3, $4, $5)', [account.user.id, account.sessionId, 'administration', secretHash(), challenge()])),
    );
    expect(answers.map((answer) => answer.rows[0].outcome)).toEqual(['started', 'started', 'started']);
    expect(await count(db, `select count(*) as n from identity.step_up_nonces where account_id = $1 and status = 'open'`, [account.accountId])).toBe(1);
    expect(await count(db, `select count(*) as n from identity.step_up_nonces where account_id = $1`, [account.accountId])).toBe(3);
  });

  it('twelve starts at once: the hourly limit holds, ten are started and two are limited', async () => {
    const account = await activeCommitted();
    const clients = await Promise.all(Array.from({length: 12}, () => connect()));
    const answers = await Promise.all(
      clients.map((client) => client.query('select outcome from api.start_step_up($1, $2, $3, $4, $5)', [account.user.id, account.sessionId, 'administration', secretHash(), challenge()])),
    );
    const outcomes = answers.map((answer) => answer.rows[0].outcome as string);
    expect(outcomes.filter((outcome) => outcome === 'started')).toHaveLength(10);
    expect(outcomes.filter((outcome) => outcome === 'limited')).toHaveLength(2);
    expect(await count(db, `select count(*) as n from identity.step_up_nonces where account_id = $1`, [account.accountId])).toBe(10);
  });

  it('a start that waited for another start of the same Account is dated from when it could act, not from when it was called', async () => {
    const account = await activeCommitted();
    const holder = await connect();
    await holder.query('begin');
    await holder.query(`select pg_advisory_xact_lock(hashtextextended('nova3d/step-up/' || $1::text, 0))`, [account.accountId]);
    const starter = await connect();
    let finished = false;
    const secret = secretHash();
    const pending = starter.query('select outcome from api.start_step_up($1, $2, $3, $4, $5)', [account.user.id, account.sessionId, 'administration', secret, challenge()]).then((result) => {
      finished = true;
      return result;
    });
    await new Promise((resolve) => setTimeout(resolve, 700));
    expect(finished, 'the start must wait for the Account lock').toBe(false);
    const released = (await holder.query('select clock_timestamp() as t')).rows[0].t as Date;
    await holder.query('commit');
    expect((await pending).rows[0].outcome).toBe('started');
    const nonce = await nonceOf(db, secret);
    // Dated after the wait (the lock was released after `released`), not from when the call began 700 ms earlier.
    expect(nonce.started_at.getTime()).toBeGreaterThanOrEqual(released.getTime());
    expect(nonce.expires_at.getTime() - nonce.started_at.getTime()).toBe(10 * 60_000);
  });

  it('a completion that waited for the nonce\'s lock judges expiry from when it could act, not from when it was called', async () => {
    const account = await activeCommitted();
    const flow = await startCommitted(account);
    const fresh = await signInAgain(db, account.user.id);
    const holder = await connect();
    await holder.query('begin');
    // Another transaction holds the nonce, and has set it to run out in 400 ms.
    await holder.query(`update identity.step_up_nonces set expires_at = clock_timestamp() + interval '400 milliseconds' where secret_hash = $1`, [flow.secret]);
    const completer = await connect();
    let finished = false;
    const pending = completer.query('select outcome, reason from api.complete_step_up($1, $2, $3, $4)', [account.user.id, fresh, flow.secret, flow.verifier]).then((result) => {
      finished = true;
      return result;
    });
    await new Promise((resolve) => setTimeout(resolve, 900));
    expect(finished, 'the completion must wait for the nonce\'s row lock').toBe(false);
    await holder.query('commit');
    // Called while the nonce still had time; able to act only after it had run out.
    expect((await pending).rows[0]).toEqual({outcome: 'rejected', reason: 'expired'});
    expect(await count(db, 'select count(*) as n from identity.fresh_authentications where account_id = $1', [account.accountId])).toBe(0);
  });

  it('a marker that is consumed by use is consumed once, however many ask at once', async () => {
    const account = await activeCommitted();
    const flow = await startCommitted(account, 'account_deletion');
    const fresh = await signInAgain(db, account.user.id);
    expect((await db.query('select outcome from api.complete_step_up($1, $2, $3, $4)', [account.user.id, fresh, flow.secret, flow.verifier])).rows[0].outcome).toBe('accepted');
    const clients = await Promise.all(Array.from({length: 5}, () => connect()));
    const answers = await Promise.all(
      clients.map((client) => client.query('select outcome from api.use_marker($1, $2, $3, $4)', [account.user.id, fresh, 'account_deletion', new Date(0)])),
    );
    const outcomes = answers.map((answer) => answer.rows[0].outcome as string);
    expect(outcomes.filter((outcome) => outcome === 'allowed')).toHaveLength(1);
    expect(outcomes.filter((outcome) => outcome === 'used')).toHaveLength(4);
  });
});

// ---------------------------------------------------------------------------------------------------
describe('the same calls over REST, as the application makes them', () => {
  it('starts, completes and checks a step-up through lib/accounts, and refuses what it should', async () => {
    const account = await activeCommitted();
    const secret = secretHash();
    const verifier = challenge();
    const started = await startStepUp({userId: account.user.id, sessionId: account.sessionId, actionClass: 'account_deletion', secretHash: secret, verifierHash: verifier}, {env});
    expect(started.outcome).toBe('started');
    expect(Date.parse(started.expiresAt!)).toBeGreaterThan(Date.now() + 9 * 60_000);

    // Not this step-up's sign-in (another browser): an ordinary one.
    const elsewhere = await signInAgain(db, account.user.id);
    expect(await completeStepUp({userId: account.user.id, sessionId: elsewhere, secretHash: secretHash(), verifierHash: verifier}, {env})).toEqual({outcome: 'not_step_up', reason: 'unknown', actionClass: null});
    // The step-up itself.
    const fresh = await signInAgain(db, account.user.id);
    expect(await completeStepUp({userId: account.user.id, sessionId: fresh, secretHash: secret, verifierHash: verifier}, {env})).toEqual({outcome: 'accepted', reason: null, actionClass: 'account_deletion'});
    expect(await checkMarker({userId: account.user.id, sessionId: fresh, actionClass: 'account_deletion', startedAfter: new Date(Date.now() - 3_600_000)}, {env})).toBe('allowed');
    expect(await checkMarker({userId: account.user.id, sessionId: fresh, actionClass: 'account_deletion', startedAfter: new Date(Date.now() - 3_600_000)}, {env})).toBe('used');
    expect(await checkMarker({userId: account.user.id, sessionId: account.sessionId, actionClass: 'administration'}, {env})).toBe('denied');
  });

  it('refuses malformed input before it reaches the database', async () => {
    const id = randomUUID();
    await expect(startStepUp({userId: id, sessionId: id, actionClass: 'nope', secretHash: secretHash(), verifierHash: challenge()}, {env})).rejects.toThrow(TypeError);
    await expect(startStepUp({userId: id, sessionId: id, actionClass: 'administration', secretHash: 'short', verifierHash: challenge()}, {env})).rejects.toThrow(TypeError);
    await expect(startStepUp({userId: id, sessionId: id, actionClass: 'administration', secretHash: secretHash(), verifierHash: 'short'}, {env})).rejects.toThrow(TypeError);
    await expect(completeStepUp({userId: id, sessionId: id, secretHash: 'x', verifierHash: challenge()}, {env})).rejects.toThrow(TypeError);
    await expect(checkMarker({userId: id, sessionId: id, actionClass: 'close_instance'}, {env})).rejects.toThrow(/startedAfter is required/);
    await expect(checkMarker({userId: id, sessionId: id, actionClass: 'administration', startedAfter: 'not a time'}, {env})).rejects.toThrow(TypeError);
  });

  it('is executable by the service role alone', async () => {
    await inTx(async (client) => {
      const m = await member(client);
      for (const role of ['anon', 'authenticated']) {
        for (const sql of [
          ['select * from api.start_step_up($1, $2, $3, $4, $5)', [m.user.id, m.sessionId, 'administration', secretHash(), challenge()]],
          ['select * from api.complete_step_up($1, $2, $3, $4)', [m.user.id, m.sessionId, secretHash(), challenge()]],
          ['select * from api.use_marker($1, $2, $3, null)', [m.user.id, m.sessionId, 'administration']],
        ] as const) {
          const result = await attempt(client, role, sql[0], [...sql[1]]);
          expect(result.ok, `${role}: ${sql[0]}`).toBe(false);
          if (!result.ok) expect(result.code).toBe('42501');
        }
      }
    });
  });
});

// Committed fixtures for the cases that need real connections. The harness removes the users, Accounts, grants,
// nonces, markers and codes registered here after the last test.
async function activeCommitted() {
  const user = await addUser(db);
  committed.users.push(user.id);
  const issued = await issueInvitation({kind: 'named', label: `step-up ${user.id.slice(0, 8)}`, actor: 'seed:local:step-up'}, {env});
  if (issued.outcome !== 'issued') throw new Error('The code was not issued.');
  committed.invitationIds.push(issued.invitationId);
  const receipt = await registerWithCode({userId: user.id, commandId: randomUUID(), code: issued.code, clientAddress: `203.0.113.${Math.floor(Math.random() * 250) + 1}`}, {env});
  if (receipt.outcome !== 'registered') throw new Error(`The test Account was not created (${receipt.outcome}).`);
  const sessionId = await addSession(db, user.id);
  await db.query('select * from api.issue_grant($1, $2)', [user.id, sessionId]);
  return {user, accountId: receipt.accountId as string, sessionId};
}

async function startCommitted(account: Awaited<ReturnType<typeof activeCommitted>>, actionClass = 'administration') {
  const flow = {secret: secretHash(), verifier: challenge()};
  const receipt = await db.query('select outcome from api.start_step_up($1, $2, $3, $4, $5)', [account.user.id, account.sessionId, actionClass, flow.secret, flow.verifier]);
  if (receipt.rows[0].outcome !== 'started') throw new Error(`The step-up was not started (${receipt.rows[0].outcome}).`);
  return flow;
}
