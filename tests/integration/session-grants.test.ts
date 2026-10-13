import {randomUUID} from 'node:crypto';
import type {Client} from 'pg';
import {beforeAll, describe, expect, it} from 'vitest';
import {
  authorizeSession,
  issueGrant,
  issueInvitation,
  raiseAuthorizationEpoch,
  registerWithCode,
  revokeAccountGrants,
  revokeGrantsBelowEpoch,
  revokeSessionGrant,
} from '@/lib/accounts';
import {codeHash, createHarness, stack, uuidPattern} from '../support/accounts-db';
import {stackEnvironment} from '../support/stack';

// Story 1.4a against the Supabase CLI stack: session grants and live authorization, every row of the I/O
// matrix at the database. Most cases run inside a transaction that is rolled back, as the service role. The
// cases that need several real connections, and the REST round trip the application makes, commit real data
// that is removed afterwards (audit events are append-only and stay).

const {db, connect, committed, inTx, addUser, addSession, attempt, api, count} = createHarness();

// Built from the running stack alone (its keys, its database's identity, random hashing keys): these tests
// read no .env file, so they pass with a stale .env.local or none.
let env: Record<string, string>;
beforeAll(async () => {
  env = await stackEnvironment(db);
});

/** A user with an active Account (registered the way the registration screen does) and a live Auth session. */
async function activeAccount(client: Client, options: {session?: boolean} = {}) {
  const svc = api(client);
  const user = await addUser(client);
  const hash = codeHash();
  await svc.issue(hash, 'general', null);
  const receipt = await svc.register(user.id, hash);
  if (receipt.outcome !== 'registered') throw new Error(`The test Account was not created (${receipt.outcome}).`);
  const sessionId = options.session === false ? null : await addSession(client, user.id);
  return {user, accountId: receipt.account_id as string, workspaceId: receipt.workspace_id as string, sessionId: sessionId as string};
}

/** Ages a grant: when it was issued and when it was last used, as days before now. */
const age = (client: Client, sessionId: string, issuedDaysAgo: number, usedDaysAgo = 0) =>
  client.query(`update identity.session_grants set issued_at = clock_timestamp() - $2 * interval '1 day', last_used_at = clock_timestamp() - $3 * interval '1 day' where session_id = $1`, [sessionId, issuedDaysAgo, usedDaysAgo]);
/** The same, in seconds, for the edges of the 30-day and 7-day limits. */
const ageSeconds = (client: Client, sessionId: string, issuedSecondsAgo: number, usedSecondsAgo = 0) =>
  client.query(`update identity.session_grants set issued_at = clock_timestamp() - $2 * interval '1 second', last_used_at = clock_timestamp() - $3 * interval '1 second' where session_id = $1`, [sessionId, issuedSecondsAgo, usedSecondsAgo]);
const grantRow = async (client: Client, sessionId: string) => (await client.query('select * from identity.session_grants where session_id = $1', [sessionId])).rows[0];
const auditOf = async (client: Client, action: string, target: string) =>
  (await client.query('select actor, action, target from identity.audit_events where action = $1 and target = $2 order by id', [action, target])).rows;

const inactive = {account_id: null, workspace_id: null, role: null, epoch: null};

// ---------------------------------------------------------------------------------------------------
describe('issuing a grant (sign-in completes; registration or a claim activates an Account)', () => {
  it('issues exactly one grant for the session, at the Account\'s epoch, and audits it', async () => {
    await inTx(async (client) => {
      const svc = api(client);
      const {user, accountId, sessionId} = await activeAccount(client);
      expect(await svc.issueGrant(user.id, sessionId)).toEqual({outcome: 'issued', account_id: accountId, epoch: 1});
      const grant = await grantRow(client, sessionId);
      expect(grant).toMatchObject({session_id: sessionId, account_id: accountId, epoch: '1', revoked_at: null, revoked_by: null, revoked_reason: null});
      expect(grant.issued_at.getTime()).toBe(grant.last_used_at.getTime());
      expect(await auditOf(client, 'session.issued', `session:${sessionId}`)).toEqual([{actor: `account:${accountId}`, action: 'session.issued', target: `session:${sessionId}`}]);
    });
  });

  it('is idempotent: a repeat returns exists, changes nothing, and audits nothing more', async () => {
    await inTx(async (client) => {
      const svc = api(client);
      const {user, accountId, sessionId} = await activeAccount(client);
      await svc.issueGrant(user.id, sessionId);
      const before = await grantRow(client, sessionId);
      expect(await svc.issueGrant(user.id, sessionId)).toEqual({outcome: 'exists', account_id: accountId, epoch: 1});
      expect(await svc.issueGrant(user.id, sessionId)).toMatchObject({outcome: 'exists'});
      expect(await grantRow(client, sessionId)).toEqual(before);
      expect(await count(client, 'select count(*) as n from identity.session_grants where session_id = $1', [sessionId])).toBe(1);
      expect(await auditOf(client, 'session.issued', `session:${sessionId}`)).toHaveLength(1);
    });
  });

  it('gives each session of an Account its own grant', async () => {
    await inTx(async (client) => {
      const svc = api(client);
      const {user, accountId, sessionId} = await activeAccount(client);
      const other = await addSession(client, user.id);
      await svc.issueGrant(user.id, sessionId);
      await svc.issueGrant(user.id, other);
      expect(await count(client, 'select count(*) as n from identity.session_grants where account_id = $1', [accountId])).toBe(2);
    });
  });

  it('issues nothing for a user with no Account, and nothing for a disabled one', async () => {
    await inTx(async (client) => {
      const svc = api(client);
      const stranger = await addUser(client);
      const strangerSession = await addSession(client, stranger.id);
      expect(await svc.issueGrant(stranger.id, strangerSession)).toEqual({outcome: 'no_account', account_id: null, epoch: null});

      const {user, accountId, sessionId} = await activeAccount(client);
      await client.query(`update identity.accounts set status = 'disabled' where id = $1`, [accountId]);
      expect(await svc.issueGrant(user.id, sessionId)).toMatchObject({outcome: 'disabled'});
      expect(await count(client, 'select count(*) as n from identity.session_grants where session_id = any($1)', [[strangerSession, sessionId]])).toBe(0);
    });
  });

  it('issues nothing for a session Auth does not have for that user: another user\'s, one that never existed, one already gone', async () => {
    await inTx(async (client) => {
      const svc = api(client);
      const {user} = await activeAccount(client);
      const stranger = await addUser(client);
      const theirs = await addSession(client, stranger.id);
      expect(await svc.issueGrant(user.id, theirs)).toMatchObject({outcome: 'no_session'});
      expect(await svc.issueGrant(user.id, randomUUID())).toMatchObject({outcome: 'no_session'});
      const gone = await addSession(client, user.id);
      await client.query('delete from auth.sessions where id = $1', [gone]);
      expect(await svc.issueGrant(user.id, gone)).toMatchObject({outcome: 'no_session'});
      expect(await count(client, 'select count(*) as n from identity.session_grants where session_id = any($1)', [[theirs, gone]])).toBe(0);
    });
  });

  it('never revives a revoked grant, and reports an older epoch\'s as stale', async () => {
    await inTx(async (client) => {
      const svc = api(client);
      const {user, accountId, sessionId} = await activeAccount(client);
      await svc.issueGrant(user.id, sessionId);
      await svc.revokeGrants({session: sessionId});
      expect(await svc.issueGrant(user.id, sessionId)).toMatchObject({outcome: 'revoked'});
      expect((await grantRow(client, sessionId)).revoked_at).not.toBeNull();

      const second = await addSession(client, user.id);
      await svc.issueGrant(user.id, second);
      await svc.raiseEpoch(accountId);
      expect(await svc.issueGrant(user.id, second)).toMatchObject({outcome: 'stale', epoch: 2});
    });
  });

  it('reports a grant that has expired or idled out as that, not as one that exists: asking again does not make it valid', async () => {
    await inTx(async (client) => {
      const svc = api(client);
      const {user, sessionId} = await activeAccount(client);
      await svc.issueGrant(user.id, sessionId);
      await age(client, sessionId, 31, 0);
      expect(await svc.issueGrant(user.id, sessionId)).toMatchObject({outcome: 'expired'});
      await age(client, sessionId, 20, 8);
      expect(await svc.issueGrant(user.id, sessionId)).toMatchObject({outcome: 'idle'});
      await age(client, sessionId, 20, 1);
      expect(await svc.issueGrant(user.id, sessionId)).toMatchObject({outcome: 'exists'});
      // Nothing was rewritten by asking: the dates are the ones the test set.
      const row = await grantRow(client, sessionId);
      expect(Date.now() - row.issued_at.getTime()).toBeGreaterThan(19 * 86_400_000);
    });
  });

  it('reports a grant revoked for a subject mismatch as that, so the identity is refused again rather than told to try again', async () => {
    await inTx(async (client) => {
      const svc = api(client);
      const {user, sessionId} = await activeAccount(client);
      await svc.issueGrant(user.id, sessionId);
      await client.query(`update auth.identities set provider_id = 'changed-subject' where user_id = $1`, [user.id]);
      await svc.authorize(user.id, sessionId);
      await client.query(`update auth.identities set provider_id = $2 where user_id = $1`, [user.id, user.subject]);
      expect(await svc.issueGrant(user.id, sessionId)).toMatchObject({outcome: 'subject_mismatch'});
    });
  });

  it('records the epoch of the moment of issue: a grant issued after a bump is not stale', async () => {
    await inTx(async (client) => {
      const svc = api(client);
      const {user, accountId, sessionId} = await activeAccount(client);
      await svc.raiseEpoch(accountId);
      await svc.raiseEpoch(accountId);
      expect(await svc.issueGrant(user.id, sessionId)).toMatchObject({outcome: 'issued', epoch: 3});
      expect(await svc.authorize(user.id, sessionId)).toMatchObject({state: 'active', epoch: 3});
    });
  });

  it('refuses null arguments with the stable invalid-argument code', async () => {
    await inTx(async (client) => {
      for (const sql of ['select * from api.issue_grant(null, gen_random_uuid())', 'select * from api.issue_grant(gen_random_uuid(), null)']) {
        const result = await attempt(client, 'service_role', sql);
        expect(result.ok, sql).toBe(false);
        if (!result.ok) expect(result.code).toBe('22023');
      }
    });
  });
});

// ---------------------------------------------------------------------------------------------------
describe('authorizing a session (every private request)', () => {
  it('valid grant: active, with the Account, Workspace, role and epoch; and nothing is written but the last use', async () => {
    await inTx(async (client) => {
      const svc = api(client);
      const {user, accountId, workspaceId, sessionId} = await activeAccount(client);
      await svc.issueGrant(user.id, sessionId);
      expect(await svc.authorize(user.id, sessionId)).toEqual({state: 'active', account_id: accountId, workspace_id: workspaceId, role: 'member', epoch: 1});
      expect(await count(client, `select count(*) as n from identity.audit_events where target = $1`, [`session:${sessionId}`])).toBe(1);
    });
  });

  it('no user, no Account: unregistered, and nothing of anyone else\'s', async () => {
    await inTx(async (client) => {
      const svc = api(client);
      const stranger = await addUser(client);
      const session = await addSession(client, stranger.id);
      expect(await svc.authorize(stranger.id, session)).toEqual({state: 'unregistered', ...inactive});
      expect(await svc.authorize(randomUUID(), randomUUID())).toEqual({state: 'unregistered', ...inactive});
    });
  });

  it('active Account, no grant: no_grant, however valid the token that brought the session', async () => {
    await inTx(async (client) => {
      const svc = api(client);
      const {user, sessionId} = await activeAccount(client);
      expect(await svc.authorize(user.id, sessionId)).toEqual({state: 'no_grant', ...inactive});
      // A session Auth does not have for this user is not a session without a grant: it is no session.
      expect(await svc.authorize(user.id, randomUUID())).toEqual({state: 'no_session', ...inactive});
    });
  });

  it('a grant is for its own session and its own Account: another user\'s session is no session, and a grant of another Account is no grant', async () => {
    await inTx(async (client) => {
      const svc = api(client);
      const a = await activeAccount(client);
      const b = await activeAccount(client);
      await svc.issueGrant(a.user.id, a.sessionId);
      expect(await svc.authorize(a.user.id, a.sessionId)).toMatchObject({state: 'active'});
      // Borrowing a session ID does not help: Auth has no such session for the other user.
      expect(await svc.authorize(b.user.id, a.sessionId)).toMatchObject({state: 'no_session'});
      expect(await svc.authorize(a.user.id, b.sessionId)).toMatchObject({state: 'no_session'});
      // Even if a grant of Account A somehow named Auth's session of user B, B's Account does not accept it.
      await client.query('insert into identity.session_grants (session_id, account_id, epoch) values ($1, $2, 1)', [b.sessionId, a.accountId]);
      expect(await svc.authorize(b.user.id, b.sessionId)).toMatchObject({state: 'no_grant'});
    });
  });

  it('revoked grant: revoked, everywhere', async () => {
    await inTx(async (client) => {
      const svc = api(client);
      const {user, sessionId} = await activeAccount(client);
      await svc.issueGrant(user.id, sessionId);
      await svc.revokeGrants({session: sessionId});
      for (let request = 0; request < 3; request += 1) expect(await svc.authorize(user.id, sessionId)).toEqual({state: 'revoked', ...inactive});
    });
  });

  it('stale epoch: raising the Account\'s epoch refuses every older grant at once, and only that Account\'s', async () => {
    await inTx(async (client) => {
      const svc = api(client);
      const a = await activeAccount(client);
      const b = await activeAccount(client);
      const aSecond = await addSession(client, a.user.id);
      for (const [user, session] of [[a.user, a.sessionId], [a.user, aSecond], [b.user, b.sessionId]] as const) await svc.issueGrant(user.id, session);
      expect(await svc.raiseEpoch(a.accountId)).toEqual({account_id: a.accountId, epoch: 2});
      expect(await svc.authorize(a.user.id, a.sessionId)).toEqual({state: 'stale_epoch', ...inactive});
      expect(await svc.authorize(a.user.id, aSecond)).toEqual({state: 'stale_epoch', ...inactive});
      expect(await svc.authorize(b.user.id, b.sessionId)).toMatchObject({state: 'active', epoch: 1});
    });
  });

  it('31 days old: expired. 29 days old: still valid. Auth\'s own time-box is separate', async () => {
    await inTx(async (client) => {
      const svc = api(client);
      const {user, sessionId} = await activeAccount(client);
      await svc.issueGrant(user.id, sessionId);
      await age(client, sessionId, 29, 0);
      expect(await svc.authorize(user.id, sessionId)).toMatchObject({state: 'active'});
      await age(client, sessionId, 31, 0);
      expect(await svc.authorize(user.id, sessionId)).toEqual({state: 'expired', ...inactive});
      await age(client, sessionId, 30.01, 0);
      expect(await svc.authorize(user.id, sessionId)).toMatchObject({state: 'expired'});
    });
  });

  it('idle for 8 days: idle. Idle for 6: still valid, and 30 days old is not 7 days idle', async () => {
    await inTx(async (client) => {
      const svc = api(client);
      const {user, sessionId} = await activeAccount(client);
      await svc.issueGrant(user.id, sessionId);
      await age(client, sessionId, 20, 6);
      expect(await svc.authorize(user.id, sessionId)).toMatchObject({state: 'active'});
      await age(client, sessionId, 20, 8);
      expect(await svc.authorize(user.id, sessionId)).toEqual({state: 'idle', ...inactive});
      await age(client, sessionId, 20, 7.01);
      expect(await svc.authorize(user.id, sessionId)).toMatchObject({state: 'idle'});
    });
  });

  it('an idle or expired grant is not revived by asking: it stays refused, and its last use does not move', async () => {
    await inTx(async (client) => {
      const svc = api(client);
      const {user, sessionId} = await activeAccount(client);
      await svc.issueGrant(user.id, sessionId);
      await age(client, sessionId, 20, 8);
      const before = await grantRow(client, sessionId);
      await svc.authorize(user.id, sessionId);
      await svc.authorize(user.id, sessionId);
      expect(await grantRow(client, sessionId)).toEqual(before);
    });
  });

  it('disabled Account: disabled, even with a perfectly valid grant, and nothing of the Account', async () => {
    await inTx(async (client) => {
      const svc = api(client);
      const {user, accountId, sessionId} = await activeAccount(client);
      await svc.issueGrant(user.id, sessionId);
      await client.query(`update identity.accounts set status = 'disabled' where id = $1`, [accountId]);
      expect(await svc.authorize(user.id, sessionId)).toEqual({state: 'disabled', ...inactive});
      await client.query(`update identity.accounts set status = 'active' where id = $1`, [accountId]);
      // Enabling the Account again does not bring the old session back: the status change raised the epoch,
      // in the same update, so every grant issued before it is stale for good.
      expect(await svc.authorize(user.id, sessionId)).toEqual({state: 'stale_epoch', ...inactive});
      // Only a sign-in after it, which issues a grant under the new epoch, lets the person in.
      const later = await addSession(client, user.id);
      expect(await svc.issueGrant(user.id, later)).toMatchObject({outcome: 'issued', epoch: 3});
      expect(await svc.authorize(user.id, later)).toMatchObject({state: 'active', epoch: 3});
    });
  });

  it('refuses null arguments with the stable invalid-argument code', async () => {
    await inTx(async (client) => {
      for (const sql of ['select * from api.authorize_session(null, gen_random_uuid())', 'select * from api.authorize_session(gen_random_uuid(), null)']) {
        const result = await attempt(client, 'service_role', sql);
        expect(result.ok, sql).toBe(false);
        if (!result.ok) expect(result.code).toBe('22023');
      }
    });
  });

  describe('last use', () => {
    it('is written at most once a minute: a use within the minute leaves it, a use after it moves it to now', async () => {
      await inTx(async (client) => {
        const svc = api(client);
        const {user, sessionId} = await activeAccount(client);
        await svc.issueGrant(user.id, sessionId);

        await client.query(`update identity.session_grants set last_used_at = clock_timestamp() - interval '30 seconds', issued_at = clock_timestamp() - interval '1 hour' where session_id = $1`, [sessionId]);
        const recent = await grantRow(client, sessionId);
        await svc.authorize(user.id, sessionId);
        expect((await grantRow(client, sessionId)).last_used_at).toEqual(recent.last_used_at);

        await client.query(`update identity.session_grants set last_used_at = clock_timestamp() - interval '2 minutes' where session_id = $1`, [sessionId]);
        const stale = await grantRow(client, sessionId);
        await svc.authorize(user.id, sessionId);
        const moved = await grantRow(client, sessionId);
        expect(moved.last_used_at.getTime()).toBeGreaterThan(stale.last_used_at.getTime() + 100_000);
        expect(Date.now() - moved.last_used_at.getTime()).toBeLessThan(60_000);
        expect(moved.issued_at).toEqual(stale.issued_at);
      });
    });

    it('keeps a session that is used every few days alive for as long as the 30-day time-box allows, and no longer', async () => {
      await inTx(async (client) => {
        const svc = api(client);
        const {user, sessionId} = await activeAccount(client);
        await svc.issueGrant(user.id, sessionId);
        // Day 20, last used six days ago: valid, and the use moves the clock forward.
        await age(client, sessionId, 20, 6);
        expect(await svc.authorize(user.id, sessionId)).toMatchObject({state: 'active'});
        expect(Date.now() - (await grantRow(client, sessionId)).last_used_at.getTime()).toBeLessThan(60_000);
        // The same session a day later is not 7 days idle; but at day 31 it is expired however recently it was used.
        await age(client, sessionId, 31, 0);
        expect(await svc.authorize(user.id, sessionId)).toMatchObject({state: 'expired'});
      });
    });
  });
});

// ---------------------------------------------------------------------------------------------------
describe('the pinned Google subject is re-checked on every authorization', () => {
  it('another Google identity for the Administrator: the grant is revoked, the request refused, and it is audited', async () => {
    await inTx(async (client) => {
      const svc = api(client);
      const email = `admin-${randomUUID().slice(0, 8)}@example.test`;
      await svc.seed(email, 'administrator');
      const admin = await addUser(client, {email});
      const session = await addSession(client, admin.id);
      expect((await svc.consume(admin.id)).outcome).toBe('registered');
      expect(await svc.issueGrant(admin.id, session)).toMatchObject({outcome: 'issued'});
      expect(await svc.authorize(admin.id, session)).toMatchObject({state: 'active', role: 'administrator'});

      // Auth now reports a different Google subject for the same user.
      await client.query(`update auth.identities set provider_id = 'a-different-google-subject' where user_id = $1`, [admin.id]);
      expect(await svc.authorize(admin.id, session)).toEqual({state: 'subject_mismatch', ...inactive});
      const grant = await grantRow(client, session);
      expect(grant).toMatchObject({revoked_by: 'system:authorization', revoked_reason: 'subject_mismatch'});
      expect(grant.revoked_at).not.toBeNull();
      expect(await auditOf(client, 'session.subject_mismatch', `session:${session}`)).toEqual([
        {actor: 'system:authorization', action: 'session.subject_mismatch', target: `session:${session}`},
      ]);

      // From then on the session keeps being refused as a mismatch, on every request, so every one of them
      // still signs the identity out; and putting the identity back does not bring the grant back. It is not
      // audited again: the revocation was the event.
      for (let request = 0; request < 3; request += 1) expect(await svc.authorize(admin.id, session), `request ${request + 2}`).toEqual({state: 'subject_mismatch', ...inactive});
      await client.query(`update auth.identities set provider_id = $2 where user_id = $1`, [admin.id, admin.subject]);
      expect(await svc.authorize(admin.id, session)).toEqual({state: 'subject_mismatch', ...inactive});
      expect(await auditOf(client, 'session.subject_mismatch', `session:${session}`)).toHaveLength(1);
      expect(await auditOf(client, 'session.revoked', `session:${session}`)).toEqual([]);
    });
  });

  it('a second Google identity linked to the same Auth user is a mismatch too', async () => {
    await inTx(async (client) => {
      const svc = api(client);
      const {user, sessionId} = await activeAccount(client);
      await svc.issueGrant(user.id, sessionId);
      await client.query(
        `insert into auth.identities (provider_id, user_id, identity_data, provider, created_at, updated_at) values ('second-google-subject', $1, $2, 'google', now(), now())`,
        [user.id, JSON.stringify({sub: 'second-google-subject', email: user.email, email_verified: true})],
      );
      expect(await svc.authorize(user.id, sessionId)).toMatchObject({state: 'subject_mismatch'});
    });
  });

  it('an identity from another provider beside the Google one does not matter, and an identity that is gone is a mismatch', async () => {
    await inTx(async (client) => {
      const svc = api(client);
      const {user, sessionId} = await activeAccount(client);
      await svc.issueGrant(user.id, sessionId);
      await client.query(
        `insert into auth.identities (provider_id, user_id, identity_data, provider, created_at, updated_at) values ($1, $2, '{}', 'email', now(), now())`,
        [user.id, user.id],
      );
      expect(await svc.authorize(user.id, sessionId)).toMatchObject({state: 'active'});
      await client.query(`delete from auth.identities where user_id = $1 and provider = 'google'`, [user.id]);
      expect(await svc.authorize(user.id, sessionId)).toMatchObject({state: 'subject_mismatch'});
    });
  });

  it('issues no grant to a session whose Google identity is not the pinned one, and audits it at most once an hour', async () => {
    await inTx(async (client) => {
      const svc = api(client);
      const {user, sessionId} = await activeAccount(client);
      await client.query(`update auth.identities set provider_id = 'changed-subject' where user_id = $1`, [user.id]);
      expect(await svc.issueGrant(user.id, sessionId)).toMatchObject({outcome: 'subject_mismatch'});
      expect(await svc.issueGrant(user.id, sessionId)).toMatchObject({outcome: 'subject_mismatch'});
      expect(await count(client, 'select count(*) as n from identity.session_grants where session_id = $1', [sessionId])).toBe(0);
      expect(await auditOf(client, 'session.subject_mismatch', `session:${sessionId}`)).toHaveLength(1);
    });
  });

  it('leaves the other grants of the Account to be revoked as each next request finds the mismatch', async () => {
    await inTx(async (client) => {
      const svc = api(client);
      const {user, sessionId} = await activeAccount(client);
      const other = await addSession(client, user.id);
      await svc.issueGrant(user.id, sessionId);
      await svc.issueGrant(user.id, other);
      await client.query(`update auth.identities set provider_id = 'changed-subject' where user_id = $1`, [user.id]);
      expect(await svc.authorize(user.id, sessionId)).toMatchObject({state: 'subject_mismatch'});
      expect((await grantRow(client, other)).revoked_at).toBeNull();
      expect(await svc.authorize(user.id, other)).toMatchObject({state: 'subject_mismatch'});
      expect((await grantRow(client, other)).revoked_at).not.toBeNull();
    });
  });
});

// ---------------------------------------------------------------------------------------------------
describe('revoking grants: by session, by Account and below an epoch', () => {
  it('sign out: ends one session\'s grant, audits it once, and leaves the others', async () => {
    await inTx(async (client) => {
      const svc = api(client);
      const {user, accountId, sessionId} = await activeAccount(client);
      const other = await addSession(client, user.id);
      await svc.issueGrant(user.id, sessionId);
      await svc.issueGrant(user.id, other);
      expect(await svc.revokeGrants({session: sessionId, user: user.id, actor: `user:${user.id}`, reason: 'sign_out'})).toEqual({revoked: 1, live: 1});
      expect(await grantRow(client, sessionId)).toMatchObject({revoked_by: `user:${user.id}`, revoked_reason: 'sign_out'});
      expect(await svc.authorize(user.id, sessionId)).toMatchObject({state: 'revoked'});
      expect(await svc.authorize(user.id, other)).toMatchObject({state: 'active', account_id: accountId});
      expect(await auditOf(client, 'session.revoked', `session:${sessionId}`)).toEqual([{actor: `user:${user.id}`, action: 'session.revoked', target: `session:${sessionId}`}]);
    });
  });

  it('is final and idempotent: a second revocation ends nothing, audits nothing, and changes neither who nor why', async () => {
    await inTx(async (client) => {
      const svc = api(client);
      const {user, sessionId} = await activeAccount(client);
      await svc.issueGrant(user.id, sessionId);
      await svc.revokeGrants({session: sessionId, actor: 'user:first', reason: 'sign_out'});
      const before = await grantRow(client, sessionId);
      expect(await svc.revokeGrants({session: sessionId, actor: 'user:second', reason: 'recovery'})).toEqual({revoked: 0, live: 0});
      expect(await grantRow(client, sessionId)).toEqual(before);
      expect(await auditOf(client, 'session.revoked', `session:${sessionId}`)).toHaveLength(1);
    });
  });

  it('a session with no grant, or one that never existed, ends nothing and is not an error', async () => {
    await inTx(async (client) => {
      const svc = api(client);
      const {user, sessionId} = await activeAccount(client);
      expect(await svc.revokeGrants({session: sessionId})).toEqual({revoked: 0, live: 0});
      expect(await svc.revokeGrants({session: randomUUID()})).toEqual({revoked: 0, live: 0});
      expect(await count(client, 'select count(*) as n from identity.audit_events where target = $1', [`session:${sessionId}`])).toBe(0);
      expect(user.id).toMatch(uuidPattern);
    });
  });

  it('naming the user guards the session: another user\'s revocation of the grant ends nothing', async () => {
    await inTx(async (client) => {
      const svc = api(client);
      const a = await activeAccount(client);
      const b = await activeAccount(client);
      await svc.issueGrant(a.user.id, a.sessionId);
      expect(await svc.revokeGrants({session: a.sessionId, user: b.user.id})).toEqual({revoked: 0, live: 0});
      expect(await svc.authorize(a.user.id, a.sessionId)).toMatchObject({state: 'active'});
      expect(await svc.revokeGrants({session: a.sessionId, user: a.user.id})).toEqual({revoked: 1, live: 1});
    });
  });

  it('sign out my other sessions: every other grant of the Account at once, the current one continues, other Accounts untouched', async () => {
    await inTx(async (client) => {
      const svc = api(client);
      const a = await activeAccount(client);
      const b = await activeAccount(client);
      const sessions = [a.sessionId, await addSession(client, a.user.id), await addSession(client, a.user.id), await addSession(client, a.user.id)];
      for (const session of sessions) await svc.issueGrant(a.user.id, session);
      await svc.issueGrant(b.user.id, b.sessionId);
      // A grant that is already revoked is not counted again.
      await svc.revokeGrants({session: sessions[3]});

      expect(await svc.revokeGrants({account: a.accountId, except: sessions[0], actor: `user:${a.user.id}`, reason: 'sign_out_others'})).toEqual({revoked: 2, live: 2});
      expect(await svc.authorize(a.user.id, sessions[0])).toMatchObject({state: 'active'});
      for (const session of sessions.slice(1)) expect(await svc.authorize(a.user.id, session)).toMatchObject({state: 'revoked'});
      expect(await svc.authorize(b.user.id, b.sessionId)).toMatchObject({state: 'active'});
      expect((await grantRow(client, sessions[1])).revoked_reason).toBe('sign_out_others');
      expect(await count(client, `select count(*) as n from identity.audit_events where action = 'session.revoked' and actor = $1`, [`user:${a.user.id}`])).toBe(2);
    });
  });

  it('by Account without sparing anyone ends every grant (disabling and recovery will do this)', async () => {
    await inTx(async (client) => {
      const svc = api(client);
      const {user, accountId, sessionId} = await activeAccount(client);
      const other = await addSession(client, user.id);
      await svc.issueGrant(user.id, sessionId);
      await svc.issueGrant(user.id, other);
      expect(await svc.revokeGrants({account: accountId, reason: 'disabled'})).toEqual({revoked: 2, live: 2});
      expect(await svc.revokeGrants({account: accountId, reason: 'disabled'})).toEqual({revoked: 0, live: 0});
    });
  });

  it('below an epoch: only the Account\'s grants issued under a lower epoch, and only those still live', async () => {
    await inTx(async (client) => {
      const svc = api(client);
      const a = await activeAccount(client);
      const b = await activeAccount(client);
      const [old1, old2, fresh] = [a.sessionId, await addSession(client, a.user.id), await addSession(client, a.user.id)];
      await svc.issueGrant(a.user.id, old1);
      await svc.issueGrant(a.user.id, old2);
      await svc.issueGrant(b.user.id, b.sessionId);
      await svc.raiseEpoch(a.accountId);
      await svc.raiseEpoch(b.accountId);
      await svc.issueGrant(a.user.id, fresh);

      // Both were stale already (the Account is at epoch 2), so ending them is cleaning up, not signing anyone out.
      expect(await svc.revokeGrants({account: a.accountId, below: 2, reason: 'epoch'})).toEqual({revoked: 2, live: 0});
      expect((await grantRow(client, old1)).revoked_reason).toBe('epoch');
      expect(await svc.authorize(a.user.id, fresh)).toMatchObject({state: 'active', epoch: 2});
      // The other Account's older grant is not touched by this Account's revocation.
      expect((await grantRow(client, b.sessionId)).revoked_at).toBeNull();
      expect(await svc.revokeGrants({account: a.accountId, below: 2, reason: 'epoch'})).toEqual({revoked: 0, live: 0});
      expect(await svc.revokeGrants({account: a.accountId, below: 3, reason: 'epoch'})).toEqual({revoked: 1, live: 1});
    });
  });

  it('takes exactly one selector: anything else is an invalid argument and changes nothing', async () => {
    await inTx(async (client) => {
      const svc = api(client);
      const {user, accountId, sessionId} = await activeAccount(client);
      await svc.issueGrant(user.id, sessionId);
      const bad = [
        `select * from api.revoke_grants('seed', 'test')`,
        `select * from api.revoke_grants('seed', 'test', p_session_id => '${sessionId}', p_account_id => '${accountId}')`,
        `select * from api.revoke_grants('seed', 'test', p_session_id => '${sessionId}', p_below_epoch => 2)`,
        `select * from api.revoke_grants('seed', 'test', p_session_id => '${sessionId}', p_except_session_id => '${sessionId}')`,
        `select * from api.revoke_grants('seed', 'test', p_account_id => '${accountId}', p_user_id => '${user.id}')`,
        `select * from api.revoke_grants('seed', 'test', p_below_epoch => 2)`,
        `select * from api.revoke_grants('seed', 'test', p_account_id => '${accountId}', p_below_epoch => 0)`,
        `select * from api.revoke_grants('seed', 'test', p_account_id => '${accountId}', p_below_epoch => 2, p_except_session_id => '${sessionId}')`,
        `select * from api.revoke_grants(null, 'test', p_session_id => '${sessionId}')`,
        `select * from api.revoke_grants('Not An Actor', 'test', p_session_id => '${sessionId}')`,
        `select * from api.revoke_grants('seed', null, p_session_id => '${sessionId}')`,
        `select * from api.revoke_grants('seed', 'Not A Reason', p_session_id => '${sessionId}')`,
      ];
      for (const sql of bad) {
        const result = await attempt(client, 'service_role', sql);
        expect(result.ok, sql).toBe(false);
        if (!result.ok) expect(result.code, sql).toBe('22023');
      }
      expect((await grantRow(client, sessionId)).revoked_at).toBeNull();
    });
  });

  it('writes the audit events with content-free targets only', async () => {
    await inTx(async (client) => {
      const svc = api(client);
      const {user, accountId, sessionId} = await activeAccount(client);
      await svc.issueGrant(user.id, sessionId);
      await svc.raiseEpoch(accountId, `user:${user.id}`);
      await svc.revokeGrants({session: sessionId, actor: `user:${user.id}`, reason: 'sign_out'});
      const {rows: events} = await client.query(
        `select actor, action, target from identity.audit_events where target in ($1, $2) order by id`,
        [`session:${sessionId}`, `account:${accountId}`],
      );
      expect(events).toEqual(
        expect.arrayContaining([
          {actor: `account:${accountId}`, action: 'session.issued', target: `session:${sessionId}`},
          {actor: `user:${user.id}`, action: 'account.epoch_raised', target: `account:${accountId}`},
          {actor: `user:${user.id}`, action: 'session.revoked', target: `session:${sessionId}`},
        ]),
      );
      for (const event of events) expect(JSON.stringify(event)).not.toMatch(/@|token|cookie|jwt/i);
    });
  });
});

// ---------------------------------------------------------------------------------------------------
describe('the authorization epoch', () => {
  it('starts at 1, rises by one per call, is audited, and answers null for an Account that does not exist', async () => {
    await inTx(async (client) => {
      const svc = api(client);
      const {user, accountId} = await activeAccount(client);
      expect(Number((await client.query('select authorization_epoch from identity.accounts where id = $1', [accountId])).rows[0].authorization_epoch)).toBe(1);
      expect(await svc.raiseEpoch(accountId, `user:${user.id}`)).toEqual({account_id: accountId, epoch: 2});
      expect(await svc.raiseEpoch(accountId, `user:${user.id}`)).toEqual({account_id: accountId, epoch: 3});
      expect(await auditOf(client, 'account.epoch_raised', `account:${accountId}`)).toHaveLength(2);
      const unknown = randomUUID();
      expect(await svc.raiseEpoch(unknown)).toEqual({account_id: unknown, epoch: null});
      expect(await auditOf(client, 'account.epoch_raised', `account:${unknown}`)).toEqual([]);
    });
  });

  it('only rises: lowering it, or setting it below 1, is refused by the database itself', async () => {
    await inTx(async (client) => {
      const svc = api(client);
      const {accountId} = await activeAccount(client);
      await svc.raiseEpoch(accountId);
      const lower = await attempt(client, null, 'update identity.accounts set authorization_epoch = 1 where id = $1', [accountId]);
      expect(lower.ok).toBe(false);
      if (!lower.ok) expect(lower.code).toBe('55000');
      // Below 1 is refused as well (by the same guard, which runs before the column's own check).
      expect((await attempt(client, null, 'update identity.accounts set authorization_epoch = 0 where id = $1', [accountId])).ok).toBe(false);
    });
  });

  it('refuses a malformed actor and a null Account', async () => {
    await inTx(async (client) => {
      for (const sql of [`select * from api.raise_authorization_epoch(null, 'seed')`, `select * from api.raise_authorization_epoch(gen_random_uuid(), 'Not An Actor')`, 'select * from api.raise_authorization_epoch(gen_random_uuid(), null)']) {
        const result = await attempt(client, 'service_role', sql);
        expect(result.ok, sql).toBe(false);
        if (!result.ok) expect(result.code).toBe('22023');
      }
    });
  });

  it('keeps an Account\'s identity unchangeable while the epoch can rise', async () => {
    await inTx(async (client) => {
      const svc = api(client);
      const {accountId} = await activeAccount(client);
      expect((await attempt(client, null, `update identity.accounts set google_subject = 'x' where id = $1`, [accountId])).ok).toBe(false);
      expect((await svc.raiseEpoch(accountId)).epoch).toBe(2);
    });
  });
});

// ---------------------------------------------------------------------------------------------------
describe('the grant table', () => {
  it('cannot change what a grant is, and a revoked grant is final', async () => {
    await inTx(async (client) => {
      const svc = api(client);
      const {user, sessionId} = await activeAccount(client);
      const other = await activeAccount(client);
      await svc.issueGrant(user.id, sessionId);
      for (const sql of [
        `update identity.session_grants set session_id = gen_random_uuid() where session_id = $1`,
        `update identity.session_grants set epoch = epoch + 1 where session_id = $1`,
        `update identity.session_grants set account_id = '${other.accountId}' where session_id = $1`,
      ]) {
        const result = await attempt(client, null, sql, [sessionId]);
        expect(result.ok, sql).toBe(false);
        if (!result.ok) expect(result.code, sql).toBe('55000');
      }
      await svc.revokeGrants({session: sessionId, actor: 'user:first', reason: 'sign_out'});
      for (const sql of [
        `update identity.session_grants set revoked_at = null, revoked_by = null, revoked_reason = null where session_id = $1`,
        `update identity.session_grants set revoked_by = 'user:other' where session_id = $1`,
        `update identity.session_grants set revoked_reason = 'recovery' where session_id = $1`,
      ]) {
        const result = await attempt(client, null, sql, [sessionId]);
        expect(result.ok, sql).toBe(false);
        if (!result.ok) expect(result.code, sql).toBe('55000');
      }
    });
  });

  it('is consistent: revoked_at, revoked_by and revoked_reason come together, and last use is never before issue', async () => {
    await inTx(async (client) => {
      const svc = api(client);
      const {user, sessionId} = await activeAccount(client);
      await svc.issueGrant(user.id, sessionId);
      for (const sql of [
        `update identity.session_grants set revoked_at = now() where session_id = $1`,
        `update identity.session_grants set revoked_at = now(), revoked_by = 'user:x' where session_id = $1`,
        `update identity.session_grants set last_used_at = issued_at - interval '1 second' where session_id = $1`,
        `update identity.session_grants set revoked_at = now(), revoked_by = 'x y', revoked_reason = 'sign_out' where session_id = $1`,
        `update identity.session_grants set revoked_at = now(), revoked_by = 'user:x', revoked_reason = 'Sign Out' where session_id = $1`,
      ]) {
        const result = await attempt(client, null, sql, [sessionId]);
        expect(result.ok, sql).toBe(false);
        if (!result.ok) expect(result.code, sql).toBe('23514');
      }
    });
  });

  it('keeps an Account that has a grant: the Account cannot be deleted from under it', async () => {
    await inTx(async (client) => {
      const svc = api(client);
      const {user, accountId, sessionId} = await activeAccount(client);
      await svc.issueGrant(user.id, sessionId);
      const result = await attempt(client, null, 'delete from identity.accounts where id = $1', [accountId]);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.code).toBe('23503');
    });
  });

  it('outlives its Auth session as a record, but is refused the moment the session is gone, long before it expires', async () => {
    await inTx(async (client) => {
      const svc = api(client);
      const {user, sessionId} = await activeAccount(client);
      await svc.issueGrant(user.id, sessionId);
      expect(await svc.authorize(user.id, sessionId)).toMatchObject({state: 'active'});
      await client.query('delete from auth.sessions where id = $1', [sessionId]);
      expect(await grantRow(client, sessionId)).toBeDefined();
      expect(await svc.authorize(user.id, sessionId)).toEqual({state: 'no_session', ...inactive});
      const row = await grantRow(client, sessionId);
      expect(row.revoked_at).toBeNull();
      expect(Date.now() - row.issued_at.getTime()).toBeLessThan(60_000);
    });
  });

  it('is invisible to service_role, anon and authenticated, and to PostgREST', async () => {
    await inTx(async (client) => {
      for (const role of ['service_role', 'anon', 'authenticated']) {
        expect((await attempt(client, role, 'select * from identity.session_grants')).ok, role).toBe(false);
        expect((await attempt(client, role, 'delete from identity.session_grants')).ok, role).toBe(false);
        expect((await attempt(client, role, `insert into identity.session_grants (session_id, account_id, epoch) values (gen_random_uuid(), gen_random_uuid(), 1)`)).ok, role).toBe(false);
      }
      const {rows: policies} = await client.query(`select count(*)::int as n from pg_policy where polrelid = 'identity.session_grants'::regclass`);
      expect(policies[0].n).toBe(0);
      const {rows: flags} = await client.query(`select relrowsecurity from pg_class where oid = 'identity.session_grants'::regclass`);
      expect(flags[0].relrowsecurity).toBe(true);
    });
    const response = await fetch(`${stack.apiUrl}/rest/v1/session_grants`, {headers: {apikey: stack.serviceKey, authorization: `Bearer ${stack.serviceKey}`, 'accept-profile': 'identity'}});
    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(await response.text()).not.toMatch(/session_id/);
  });

  it('is the only thing these api functions write, besides the audit family and the Account epoch: nothing else in Identity or Projects changes', async () => {
    const tables = ['accounts', 'audit_events', 'invitations', 'preauthorizations', 'rate_limit_counters', 'registration_attempts', 'registration_commands', 'session_grants'];
    const snapshot = async (client: Client) => {
      const counts: Record<string, string> = {};
      for (const table of tables) counts[table] = JSON.stringify((await client.query(`select count(*)::int as n, md5(string_agg(t::text, '' order by t::text)) as digest from identity.${table} t`)).rows[0]);
      counts.workspaces = JSON.stringify((await client.query(`select count(*)::int as n, md5(string_agg(t::text, '' order by t::text)) as digest from projects.workspaces t`)).rows[0]);
      return counts;
    };
    const changed = (before: Record<string, string>, after: Record<string, string>) => Object.keys(before).filter((table) => before[table] !== after[table]).sort();
    await inTx(async (client) => {
      const svc = api(client);
      const {user, accountId, sessionId} = await activeAccount(client);
      const other = await addSession(client, user.id);

      let before = await snapshot(client);
      await svc.issueGrant(user.id, sessionId);
      expect(changed(before, await snapshot(client))).toEqual(['audit_events', 'session_grants']);

      // A request that finds a valid grant writes at most its last use.
      await age(client, sessionId, 1, 0.01);
      before = await snapshot(client);
      await svc.authorize(user.id, sessionId);
      expect(changed(before, await snapshot(client))).toEqual(['session_grants']);

      // A request that is refused writes nothing at all.
      await svc.issueGrant(user.id, other);
      await svc.revokeGrants({session: other});
      before = await snapshot(client);
      await svc.authorize(user.id, other);
      await svc.authorize(user.id, randomUUID());
      expect(changed(before, await snapshot(client))).toEqual([]);

      before = await snapshot(client);
      await svc.revokeGrants({session: sessionId});
      expect(changed(before, await snapshot(client))).toEqual(['audit_events', 'session_grants']);

      before = await snapshot(client);
      await svc.raiseEpoch(accountId);
      expect(changed(before, await snapshot(client))).toEqual(['accounts', 'audit_events']);

      before = await snapshot(client);
      await svc.preflight();
      await svc.confirmRegistration(user.id, randomUUID(), codeHash());
      expect(changed(before, await snapshot(client))).toEqual([]);
    });
  });
});

// ---------------------------------------------------------------------------------------------------
describe('concurrency (real connections, committed data)', () => {
  it('two simultaneous issues of one session make exactly one grant and one audit event', async () => {
    const first = await activeCommitted();
    const clients = await Promise.all([connect(), connect()]);
    const receipts = await Promise.all(clients.map((client) => client.query('select * from api.issue_grant($1, $2)', [first.user.id, first.sessionId])));
    expect(receipts.map((result) => result.rows[0].outcome).sort()).toEqual(['exists', 'issued']);
    expect(await count(db, 'select count(*) as n from identity.session_grants where session_id = $1', [first.sessionId])).toBe(1);
    expect(await count(db, `select count(*) as n from identity.audit_events where action = 'session.issued' and target = $1`, [`session:${first.sessionId}`])).toBe(1);
  });

  it('authorization does not wait for a request that is writing the same grant', async () => {
    const account = await activeCommitted();
    await db.query('select * from api.issue_grant($1, $2)', [account.user.id, account.sessionId]);
    await db.query(`update identity.session_grants set last_used_at = clock_timestamp() - interval '5 minutes', issued_at = clock_timestamp() - interval '1 day' where session_id = $1`, [account.sessionId]);
    const holder = await connect();
    await holder.query('begin');
    await holder.query('select * from identity.session_grants where session_id = $1 for update', [account.sessionId]);
    try {
      const started = Date.now();
      const asked = await db.query('select * from api.authorize_session($1, $2)', [account.user.id, account.sessionId]);
      expect(asked.rows[0].state).toBe('active');
      expect(Date.now() - started).toBeLessThan(2000);
    } finally {
      await holder.query('rollback');
    }
  });

  it('a revocation and an authorization racing: afterwards the grant is revoked, and every later request is refused', async () => {
    const account = await activeCommitted();
    const clients = await Promise.all([connect(), connect()]);
    await clients[0].query('select * from api.issue_grant($1, $2)', [account.user.id, account.sessionId]);
    const [revoked, authorized] = await Promise.all([
      clients[0].query(`select * from api.revoke_grants('seed:local:test', 'sign_out', $1)`, [account.sessionId]),
      clients[1].query('select * from api.authorize_session($1, $2)', [account.user.id, account.sessionId]),
    ]);
    expect(revoked.rows[0].revoked).toBe(1);
    expect(['active', 'revoked']).toContain(authorized.rows[0].state);
    expect((await db.query('select * from api.authorize_session($1, $2)', [account.user.id, account.sessionId])).rows[0].state).toBe('revoked');
  });

  it('an epoch raised while grants are being issued leaves no grant that is both current and older than the Account', async () => {
    const account = await activeCommitted();
    const ids: string[] = [];
    for (let index = 0; index < 6; index += 1) ids.push(await addSession(db, account.user.id));
    const clients = await Promise.all(ids.map(() => connect()));
    const bumper = await connect();
    await Promise.all([
      ...ids.map((id, index) => clients[index].query('select * from api.issue_grant($1, $2)', [account.user.id, id])),
      bumper.query(`select * from api.raise_authorization_epoch($1, 'seed:local:test')`, [account.accountId]),
    ]);
    const {rows: epoch} = await db.query('select authorization_epoch from identity.accounts where id = $1', [account.accountId]);
    for (const id of ids) {
      const state = (await db.query('select * from api.authorize_session($1, $2)', [account.user.id, id])).rows[0];
      const grant = await grantRow(db, id);
      // Either it was issued before the bump (and is stale), or after it (and is current): never current with an older epoch.
      expect(Number(grant.epoch)).toBeLessThanOrEqual(Number(epoch[0].authorization_epoch));
      expect(state.state).toBe(Number(grant.epoch) < Number(epoch[0].authorization_epoch) ? 'stale_epoch' : 'active');
    }
  });
});

// ---------------------------------------------------------------------------------------------------
describe('the same calls over REST, as the application makes them', () => {
  it('issue, authorize, sign out, sign out the others, raise the epoch: the typed calls round-trip', async () => {
    const account = await activeCommitted();
    const second = (await db.query(`insert into auth.sessions (id, user_id, created_at, updated_at, aal, refreshed_at) values (gen_random_uuid(), $1, now(), now(), 'aal1', now()) returning id`, [account.user.id])).rows[0].id as string;
    const options = {env};

    expect(await issueGrant(account.user.id, account.sessionId, options)).toEqual({outcome: 'issued', accountId: account.accountId, epoch: 1});
    expect(await issueGrant(account.user.id, second, options)).toMatchObject({outcome: 'issued'});
    expect(await authorizeSession(account.user.id, account.sessionId, options)).toEqual({state: 'active', accountId: account.accountId, workspaceId: account.workspaceId, role: 'member', epoch: 1, preferences: null});

    const actor = `user:${account.user.id}`;
    expect(await revokeAccountGrants({accountId: account.accountId, exceptSessionId: account.sessionId, actor, reason: 'sign_out_others'}, options)).toEqual({revoked: 1, live: 1});
    expect((await authorizeSession(account.user.id, second, options)).state).toBe('revoked');
    expect((await authorizeSession(account.user.id, account.sessionId, options)).state).toBe('active');

    expect(await raiseAuthorizationEpoch({accountId: account.accountId, actor}, options)).toEqual({accountId: account.accountId, epoch: 2});
    expect(await authorizeSession(account.user.id, account.sessionId, options)).toEqual({state: 'stale_epoch', accountId: null, workspaceId: null, role: null, epoch: null, preferences: null});
    expect(await revokeGrantsBelowEpoch({accountId: account.accountId, belowEpoch: 2, actor, reason: 'epoch'}, options)).toEqual({revoked: 1, live: 0});
    expect((await authorizeSession(account.user.id, account.sessionId, options)).state).toBe('revoked');
    expect(await revokeSessionGrant({sessionId: account.sessionId, userId: account.user.id, actor, reason: 'sign_out'}, options)).toEqual({revoked: 0, live: 0});
  });

  it('a signed-in user who is not the Account\'s is refused: the user ID in the call is not a claim anyone can borrow', async () => {
    const account = await activeCommitted();
    const intruder = await activeCommitted();
    const options = {env};
    await issueGrant(account.user.id, account.sessionId, options);
    // The intruder's own user ID with the other's session: Auth has no such session for them.
    expect((await authorizeSession(intruder.user.id, account.sessionId, options)).state).toBe('no_session');
    expect(await revokeSessionGrant({sessionId: account.sessionId, userId: intruder.user.id, actor: 'user:intruder', reason: 'sign_out'}, options)).toEqual({revoked: 0, live: 0});
    expect((await authorizeSession(account.user.id, account.sessionId, options)).state).toBe('active');
  });
});

// ---------------------------------------------------------------------------------------------------
describe('a change of status raises the epoch, in the same update, whoever makes it', () => {
  const epochOf = async (client: Client, accountId: string) => Number((await client.query('select authorization_epoch from identity.accounts where id = $1', [accountId])).rows[0].authorization_epoch);

  it('disabling raises it by one and so does enabling again, each audited as the system\'s doing', async () => {
    await inTx(async (client) => {
      const {accountId} = await activeAccount(client);
      expect(await epochOf(client, accountId)).toBe(1);
      await client.query(`update identity.accounts set status = 'disabled' where id = $1`, [accountId]);
      expect(await epochOf(client, accountId)).toBe(2);
      await client.query(`update identity.accounts set status = 'active' where id = $1`, [accountId]);
      expect(await epochOf(client, accountId)).toBe(3);
      expect(await auditOf(client, 'account.epoch_raised', `account:${accountId}`)).toEqual([
        {actor: 'system:accounts', action: 'account.epoch_raised', target: `account:${accountId}`},
        {actor: 'system:accounts', action: 'account.epoch_raised', target: `account:${accountId}`},
      ]);
    });
  });

  it('leaves the epoch alone when the status does not change, and when something else does', async () => {
    await inTx(async (client) => {
      const {accountId} = await activeAccount(client);
      await client.query(`update identity.accounts set status = 'active' where id = $1`, [accountId]);
      await client.query(`update identity.accounts set role = 'administrator' where id = $1`, [accountId]);
      await client.query(`update identity.accounts set role = 'member' where id = $1`, [accountId]);
      expect(await epochOf(client, accountId)).toBe(1);
      expect(await auditOf(client, 'account.epoch_raised', `account:${accountId}`)).toEqual([]);
    });
  });

  it('never lowers an epoch the caller raised further in the same update', async () => {
    await inTx(async (client) => {
      const {accountId} = await activeAccount(client);
      await client.query(`update identity.accounts set status = 'disabled', authorization_epoch = 7 where id = $1`, [accountId]);
      expect(await epochOf(client, accountId)).toBe(7);
      await client.query(`update identity.accounts set status = 'active', authorization_epoch = 8 where id = $1`, [accountId]);
      expect(await epochOf(client, accountId)).toBe(8);
      // A caller who leaves the epoch as it was still gets the rise.
      await client.query(`update identity.accounts set status = 'disabled' where id = $1`, [accountId]);
      expect(await epochOf(client, accountId)).toBe(9);
    });
  });

  it('is what refuses every session that was signed in before a disable, once the Account is enabled again', async () => {
    await inTx(async (client) => {
      const svc = api(client);
      const {user, accountId, sessionId} = await activeAccount(client);
      const other = await addSession(client, user.id);
      await svc.issueGrant(user.id, sessionId);
      await svc.issueGrant(user.id, other);
      await client.query(`update identity.accounts set status = 'disabled' where id = $1`, [accountId]);
      await client.query(`update identity.accounts set status = 'active' where id = $1`, [accountId]);
      for (const session of [sessionId, other]) expect(await svc.authorize(user.id, session), session).toEqual({state: 'stale_epoch', ...inactive});
    });
  });
});

// ---------------------------------------------------------------------------------------------------
describe('an Account\'s identity stays unchangeable (the guard was re-created for the epoch)', () => {
  it.each([
    ['id', `id = gen_random_uuid()`],
    ['google_subject', `google_subject = 'another-subject'`],
    ['source', `source = 'preauthorization'`],
    ['created_at', `created_at = created_at + interval '1 day'`],
  ])('refuses a change of %s', async (_column, assignment) => {
    await inTx(async (client) => {
      const {accountId} = await activeAccount(client);
      const result = await attempt(client, null, `update identity.accounts set ${assignment} where id = $1`, [accountId]);
      expect(result.ok, assignment).toBe(false);
      if (!result.ok) expect(result.code, assignment).toBe('55000');
    });
  });

  it('refuses a change of user_id', async () => {
    await inTx(async (client) => {
      const {accountId} = await activeAccount(client);
      const someoneElse = await addUser(client);
      const result = await attempt(client, null, 'update identity.accounts set user_id = $2 where id = $1', [accountId, someoneElse.id]);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.code).toBe('55000');
    });
  });

  it('still lets role and status change, which the stories that own them need', async () => {
    await inTx(async (client) => {
      const {accountId} = await activeAccount(client);
      expect((await attempt(client, null, `update identity.accounts set role = 'administrator' where id = $1`, [accountId])).ok).toBe(true);
      expect((await attempt(client, null, `update identity.accounts set status = 'disabled' where id = $1`, [accountId])).ok).toBe(true);
    });
  });

  it('is the same guard for an insert-then-update as for a later one: the pinned subject cannot be changed even to its own value\'s neighbour', async () => {
    await inTx(async (client) => {
      const {user, accountId} = await activeAccount(client);
      expect((await attempt(client, null, 'update identity.accounts set google_subject = $2 where id = $1', [accountId, `${user.subject}x`])).ok).toBe(false);
      expect((await attempt(client, null, 'update identity.accounts set google_subject = $2 where id = $1', [accountId, user.subject])).ok).toBe(true);
    });
  });
});

// ---------------------------------------------------------------------------------------------------
describe('the edges of the limits, to the second', () => {
  const state = async (client: Client, user: {id: string}, sessionId: string) => (await api(client).authorize(user.id, sessionId)).state;

  it('a grant one second inside 30 days is valid, and one second past is expired', async () => {
    await inTx(async (client) => {
      const {user, sessionId} = await activeAccount(client);
      await api(client).issueGrant(user.id, sessionId);
      await ageSeconds(client, sessionId, 30 * 86_400 - 1, 0);
      expect(await state(client, user, sessionId)).toBe('active');
      await ageSeconds(client, sessionId, 30 * 86_400 + 1, 0);
      expect(await state(client, user, sessionId)).toBe('expired');
    });
  });

  it('a grant unused for one second less than 7 days is valid, and for one second more is idle', async () => {
    await inTx(async (client) => {
      const {user, sessionId} = await activeAccount(client);
      await api(client).issueGrant(user.id, sessionId);
      await ageSeconds(client, sessionId, 20 * 86_400, 7 * 86_400 - 1);
      expect(await state(client, user, sessionId)).toBe('active');
      await ageSeconds(client, sessionId, 20 * 86_400, 7 * 86_400 + 1);
      expect(await state(client, user, sessionId)).toBe('idle');
    });
  });

  it('is the same edge for issuing again: a grant one second inside is "exists", one second past is the limit it hit', async () => {
    await inTx(async (client) => {
      const svc = api(client);
      const {user, sessionId} = await activeAccount(client);
      await svc.issueGrant(user.id, sessionId);
      await ageSeconds(client, sessionId, 30 * 86_400 - 1, 0);
      expect((await svc.issueGrant(user.id, sessionId)).outcome).toBe('exists');
      await ageSeconds(client, sessionId, 30 * 86_400 + 1, 0);
      expect((await svc.issueGrant(user.id, sessionId)).outcome).toBe('expired');
      await ageSeconds(client, sessionId, 20 * 86_400, 7 * 86_400 - 1);
      expect((await svc.issueGrant(user.id, sessionId)).outcome).toBe('exists');
      await ageSeconds(client, sessionId, 20 * 86_400, 7 * 86_400 + 1);
      expect((await svc.issueGrant(user.id, sessionId)).outcome).toBe('idle');
    });
  });

  it('touches the last use after a minute and not before it, to the second', async () => {
    await inTx(async (client) => {
      const svc = api(client);
      const {user, sessionId} = await activeAccount(client);
      await svc.issueGrant(user.id, sessionId);
      await client.query(`update identity.session_grants set issued_at = clock_timestamp() - interval '1 hour', last_used_at = clock_timestamp() - interval '59 seconds' where session_id = $1`, [sessionId]);
      const inside = (await grantRow(client, sessionId)).last_used_at;
      await svc.authorize(user.id, sessionId);
      expect((await grantRow(client, sessionId)).last_used_at).toEqual(inside);
      await client.query(`update identity.session_grants set last_used_at = clock_timestamp() - interval '61 seconds' where session_id = $1`, [sessionId]);
      const outside = (await grantRow(client, sessionId)).last_used_at;
      await svc.authorize(user.id, sessionId);
      expect((await grantRow(client, sessionId)).last_used_at.getTime()).toBeGreaterThan(outside.getTime() + 30_000);
    });
  });
});

// ---------------------------------------------------------------------------------------------------
describe('how many sessions a revocation signed out (live)', () => {
  it('counts only grants that were in use: lapsed, stale and Auth-less ones are cleaned up without being "signed out"', async () => {
    await inTx(async (client) => {
      const svc = api(client);
      const {user, accountId} = await activeAccount(client);
      const sessions = [];
      for (let index = 0; index < 4; index += 1) sessions.push(await addSession(client, user.id));
      const [expired, idle, gone, stale] = sessions;
      for (const session of sessions) await svc.issueGrant(user.id, session);
      await svc.raiseEpoch(accountId);
      const [valid1, valid2] = [await addSession(client, user.id), await addSession(client, user.id)];
      await svc.issueGrant(user.id, valid1);
      await svc.issueGrant(user.id, valid2);
      // expired, idle and gone would be valid but for their own limit; stale is stale for the epoch.
      await client.query(`update identity.session_grants set epoch = epoch where session_id = $1`, [stale]);
      await age(client, expired, 31, 0);
      await age(client, idle, 20, 8);
      await client.query('delete from auth.sessions where id = $1', [gone]);
      expect(await svc.revokeGrants({account: accountId, reason: 'recovery'})).toEqual({revoked: 6, live: 2});
      expect(await svc.revokeGrants({account: accountId, reason: 'recovery'})).toEqual({revoked: 0, live: 0});
    });
  });

  it('counts a valid grant revoked by session as one, and one that had already lapsed as none', async () => {
    await inTx(async (client) => {
      const svc = api(client);
      const {user, sessionId} = await activeAccount(client);
      const lapsed = await addSession(client, user.id);
      await svc.issueGrant(user.id, sessionId);
      await svc.issueGrant(user.id, lapsed);
      await age(client, lapsed, 40, 0);
      expect(await svc.revokeGrants({session: lapsed})).toEqual({revoked: 1, live: 0});
      expect(await svc.revokeGrants({session: sessionId})).toEqual({revoked: 1, live: 1});
    });
  });
});

// ---------------------------------------------------------------------------------------------------
describe('confirming a registration (the proof a retried registration needs)', () => {
  it('is true only for the command and code that created this user\'s active Account', async () => {
    await inTx(async (client) => {
      const svc = api(client);
      const user = await addUser(client);
      const [hash, otherHash] = [codeHash(), codeHash()];
      const command = randomUUID();
      await svc.issue(hash, 'general', null);
      expect((await svc.register(user.id, hash, {command})).outcome).toBe('registered');

      expect(await svc.confirmRegistration(user.id, command, hash)).toEqual({confirmed: true});
      expect(await svc.confirmRegistration(user.id, randomUUID(), hash)).toEqual({confirmed: false});
      expect(await svc.confirmRegistration(user.id, command, otherHash)).toEqual({confirmed: false});
      const stranger = await addUser(client);
      expect(await svc.confirmRegistration(stranger.id, command, hash)).toEqual({confirmed: false});
    });
  });

  it('is false for a user who got an Account some other way (a pre-authorization has no command), and for a disabled one', async () => {
    await inTx(async (client) => {
      const svc = api(client);
      const email = `confirm-${randomUUID().slice(0, 8)}@example.test`;
      await svc.seed(email, 'member');
      const invited = await addUser(client, {email});
      expect((await svc.consume(invited.id)).outcome).toBe('registered');
      expect(await svc.confirmRegistration(invited.id, randomUUID(), codeHash())).toEqual({confirmed: false});

      const user = await addUser(client);
      const [hash, command] = [codeHash(), randomUUID()];
      await svc.issue(hash, 'general', null);
      await svc.register(user.id, hash, {command});
      await client.query(`update identity.accounts set status = 'disabled' where user_id = $1`, [user.id]);
      expect(await svc.confirmRegistration(user.id, command, hash)).toEqual({confirmed: false});
    });
  });

  it('refuses null arguments and a hash that is not a hash with the stable invalid-argument code', async () => {
    await inTx(async (client) => {
      for (const sql of [
        'select * from api.confirm_registration(null, gen_random_uuid(), repeat($1, 64))',
        'select * from api.confirm_registration(gen_random_uuid(), null, repeat($1, 64))',
        'select * from api.confirm_registration(gen_random_uuid(), gen_random_uuid(), null)',
        `select * from api.confirm_registration(gen_random_uuid(), gen_random_uuid(), 'not-a-hash')`,
      ]) {
        const result = await attempt(client, 'service_role', sql, sql.includes('$1') ? ['a'] : []);
        expect(result.ok, sql).toBe(false);
        if (!result.ok) expect(result.code, sql).toBe('22023');
      }
    });
  });
});

// ---------------------------------------------------------------------------------------------------
describe('the preflight', () => {
  it('answers ok to the service role, and to nobody else', async () => {
    await inTx(async (client) => {
      expect(await api(client).preflight()).toEqual({ok: true});
      for (const role of ['anon', 'authenticated']) {
        const result = await attempt(client, role, 'select * from api.preflight()');
        expect(result.ok, role).toBe(false);
      }
    });
  });

  const tablesRead = [
    'identity.session_grants',
    'identity.accounts',
    'identity.account_preferences',
    'identity.step_up_nonces',
    'identity.fresh_authentications',
    'identity.recovery_tokens',
    'projects.projects',
    'projects.project_commands',
    'auth.sessions',
    'auth.identities',
    'auth.mfa_amr_claims',
  ];

  // The functions run as their owner. Hand this one to `anon`, which can use the auth schema but read none of
  // its tables, give it the right to read only some of the eleven, inside a transaction that is rolled back,
  // and see what the preflight says. (Everything granted here is undone with the transaction.)
  async function ownedByRoleThatCanRead(client: Client, readable: string[]) {
    await client.query('grant usage on schema api, identity, projects to anon');
    await client.query('grant create on schema api to anon');
    for (const table of readable) await client.query(`grant select on ${table} to anon`);
    await client.query('alter function api.preflight() owner to anon');
  }

  it('gets past all eleven reads when the role it runs as can read all eleven tables (the control for the next cases)', async () => {
    await inTx(async (client) => {
      await ownedByRoleThatCanRead(client, tablesRead);
      // Story 1.5 added a further thing the preflight asks of its owner: the privilege to delete from auth.sessions, which a
      // disable needs to end a person's sessions (and a recovery, Story 1.6, to end the others). `anon` cannot be given it (the
      // migration role holds it without the right to grant it), so the control is that the preflight reaches that check, which
      // comes after the eleven reads, and fails there.
      const result = await attempt(client, 'service_role', 'select * from api.preflight()');
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe('42501');
        expect(result.message).toContain('end Auth sessions');
      }
    });
  });

  it.each(tablesRead)('fails, naming a permission and not answering ok, when the role it runs as cannot read %s', async (blocked) => {
    await inTx(async (client) => {
      await ownedByRoleThatCanRead(client, tablesRead.filter((table) => table !== blocked));
      const result = await attempt(client, 'service_role', 'select * from api.preflight()');
      expect(result.ok, `${blocked} unreadable`).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe('42501');
        expect(result.message).toContain(blocked.split('.')[1]);
      }
    });
  });
});

// ---------------------------------------------------------------------------------------------------
describe('revoking an Account\'s grants while one is being issued (real connections, committed data)', () => {
  const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

  async function holdingTheIssue(account: Awaited<ReturnType<typeof activeCommitted>>) {
    const issuer = await connect();
    await issuer.query('begin');
    // Holds the Account FOR SHARE and has written a grant that nobody else can see yet.
    expect((await issuer.query('select outcome from api.issue_grant($1, $2)', [account.user.id, account.sessionId])).rows[0].outcome).toBe('issued');
    return issuer;
  }

  it('by Account: the revocation waits for the grant in flight and then ends it, so it cannot survive', async () => {
    const account = await activeCommitted();
    const issuer = await holdingTheIssue(account);
    const revoker = await connect();
    let finished = false;
    const revocation = revoker
      .query(`select revoked, live from api.revoke_grants('seed:local:test', 'recovery', p_account_id => $1)`, [account.accountId])
      .then((result) => {
        finished = true;
        return result;
      });
    await wait(500);
    expect(finished, 'the revocation must wait for the Account lock the issue holds').toBe(false);
    await issuer.query('commit');
    expect((await revocation).rows[0]).toEqual({revoked: 1, live: 1});
    expect(await grantRow(db, account.sessionId)).toMatchObject({revoked_by: 'seed:local:test', revoked_reason: 'recovery'});
    expect((await db.query('select state from api.authorize_session($1, $2)', [account.user.id, account.sessionId])).rows[0].state).toBe('revoked');
  });

  it('below an epoch: the same, for the grants of lower epochs', async () => {
    const account = await activeCommitted();
    const issuer = await holdingTheIssue(account);
    const revoker = await connect();
    let finished = false;
    const revocation = revoker
      .query(`select revoked, live from api.revoke_grants('seed:local:test', 'epoch', p_account_id => $1, p_below_epoch => 2)`, [account.accountId])
      .then((result) => {
        finished = true;
        return result;
      });
    await wait(500);
    expect(finished).toBe(false);
    await issuer.query('commit');
    expect((await revocation).rows[0]).toEqual({revoked: 1, live: 1});
    expect((await grantRow(db, account.sessionId)).revoked_reason).toBe('epoch');
  });

  it('the other way round: a grant issued while the revocation holds the lock waits, and is issued after it, valid', async () => {
    const account = await activeCommitted();
    const revoker = await connect();
    await revoker.query('begin');
    expect((await revoker.query(`select revoked from api.revoke_grants('seed:local:test', 'recovery', p_account_id => $1)`, [account.accountId])).rows[0].revoked).toBe(0);
    const issuer = await connect();
    let finished = false;
    const issue = issuer.query('select outcome from api.issue_grant($1, $2)', [account.user.id, account.sessionId]).then((result) => {
      finished = true;
      return result;
    });
    await wait(500);
    expect(finished, 'the issue must wait for the lock the revocation holds').toBe(false);
    await revoker.query('commit');
    expect((await issue).rows[0].outcome).toBe('issued');
    expect((await db.query('select state from api.authorize_session($1, $2)', [account.user.id, account.sessionId])).rows[0].state).toBe('active');
  });

  it('by session there is no lock to wait for: signing out one session never waits on the Account', async () => {
    const account = await activeCommitted();
    const other = await addSession(db, account.user.id);
    await db.query('select * from api.issue_grant($1, $2)', [account.user.id, other]);
    const holder = await connect();
    await holder.query('begin');
    await holder.query('select * from identity.accounts where id = $1 for update', [account.accountId]);
    try {
      const started = Date.now();
      const result = await db.query(`select revoked from api.revoke_grants('seed:local:test', 'sign_out', p_session_id => $1)`, [other]);
      expect(result.rows[0].revoked).toBe(1);
      expect(Date.now() - started).toBeLessThan(2000);
    } finally {
      await holder.query('rollback');
    }
  });

  it('audits a subject mismatch once when two requests find it together, and both are refused', async () => {
    const account = await activeCommitted();
    await db.query('select * from api.issue_grant($1, $2)', [account.user.id, account.sessionId]);
    await db.query(`update auth.identities set provider_id = 'changed-subject' where user_id = $1`, [account.user.id]);
    const clients = await Promise.all([connect(), connect(), connect()]);
    const answers = await Promise.all(clients.map((client) => client.query('select state from api.authorize_session($1, $2)', [account.user.id, account.sessionId])));
    expect(answers.map((answer) => answer.rows[0].state)).toEqual(['subject_mismatch', 'subject_mismatch', 'subject_mismatch']);
    expect(await auditOf(db, 'session.subject_mismatch', `session:${account.sessionId}`)).toHaveLength(1);
  });
});

// Committed fixtures for the cases that need real connections. The harness removes the users, Accounts,
// grants and codes registered here after the last test.
async function activeCommitted() {
  const user = await addUser(db);
  committed.users.push(user.id);
  const issued = await issueInvitation({kind: 'named', label: `grants ${user.id.slice(0, 8)}`, actor: 'seed:local:session-grants'}, {env});
  if (issued.outcome !== 'issued') throw new Error('The code was not issued.');
  committed.invitationIds.push(issued.invitationId);
  const receipt = await registerWithCode({userId: user.id, commandId: randomUUID(), code: issued.code, clientAddress: `203.0.113.${Math.floor(Math.random() * 250) + 1}`}, {env});
  if (receipt.outcome !== 'registered') throw new Error(`The test Account was not created (${receipt.outcome}).`);
  const sessionId = await addSession(db, user.id);
  return {user, accountId: receipt.accountId as string, workspaceId: receipt.workspaceId as string, sessionId};
}
