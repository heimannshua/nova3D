import {randomUUID} from 'node:crypto';
import type {Client} from 'pg';
import {beforeAll, describe, expect, it} from 'vitest';
import {AccountsUnavailableError, issueCsrf, issueInvitation, registerWithCode, verifyCsrf} from '@/lib/accounts';
import {hashCsrfToken, newCsrfToken} from '@/lib/request-integrity';
import {codeHash, createHarness, stack} from '../support/accounts-db';
import {stackEnvironment} from '../support/stack';

// Story 1.4c against the Supabase CLI stack: the per-session CSRF token as a hash on the session grant, and the
// two api functions that store and check it, every database row of the I/O matrix. Most cases run inside a
// transaction that is rolled back, as the service role. The cases that need several real connections, and the
// REST round trip the application makes, commit real data that is removed afterwards.

const {db, connect, committed, inTx, addUser, addSession, attempt, api, count} = createHarness();

let env: Record<string, string>;
beforeAll(async () => {
  env = await stackEnvironment(db);
});

/** The hash of a token the server has just minted: what the proxy hands the database. */
const newHash = () => hashCsrfToken(newCsrfToken());
const grantRow = async (client: Client, sessionId: string) => (await client.query('select * from identity.session_grants where session_id = $1', [sessionId])).rows[0];

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

/** Moves the stored hash back in time by this many seconds. */
const ageHash = (client: Client, sessionId: string, seconds: number) =>
  client.query(`update identity.session_grants set csrf_issued_at = csrf_issued_at - $2 * interval '1 second' where session_id = $1`, [sessionId, seconds]);

// Whatever ends a grant, ends the right to a token, and nothing is written.
const ended: [string, (client: Client, m: Awaited<ReturnType<typeof member>>) => Promise<unknown>][] = [
  ['revoked', (client, m) => api(client).revokeGrants({session: m.sessionId})],
  ['expired (31 days)', (client, m) => client.query(`update identity.session_grants set issued_at = clock_timestamp() - interval '31 days' where session_id = $1`, [m.sessionId])],
  ['idle (8 days)', (client, m) => client.query(`update identity.session_grants set issued_at = clock_timestamp() - interval '10 days', last_used_at = clock_timestamp() - interval '8 days' where session_id = $1`, [m.sessionId])],
  ['stale (the epoch was raised)', (client, m) => api(client).raiseEpoch(m.accountId)],
  ['gone from Auth (the session ended)', (client, m) => client.query('delete from auth.sessions where id = $1', [m.sessionId])],
  ['of a disabled Account', (client, m) => client.query(`update identity.accounts set status = 'disabled' where id = $1`, [m.accountId])],
  ['absent (never issued)', (client, m) => client.query('delete from identity.session_grants where session_id = $1', [m.sessionId])],
];


// ---------------------------------------------------------------------------------------------------
describe('the columns on the session grant', () => {
  it('start empty: a grant is issued with no token, which the first page request gives it', async () => {
    await inTx(async (client) => {
      const m = await member(client);
      expect(await grantRow(client, m.sessionId)).toMatchObject({csrf_hash: null, csrf_issued_at: null});
    });
  });

  it('hold a hash and the time it was stored, together or not at all, and only a SHA-256 in hex', async () => {
    await inTx(async (client) => {
      const m = await member(client);
      const good = 'ab'.repeat(32);
      for (const sql of [
        `update identity.session_grants set csrf_hash = '${good}' where session_id = $1`,
        `update identity.session_grants set csrf_issued_at = now() where session_id = $1`,
        `update identity.session_grants set csrf_hash = 'not-a-hash', csrf_issued_at = now() where session_id = $1`,
        `update identity.session_grants set csrf_hash = '${good.toUpperCase()}', csrf_issued_at = now() where session_id = $1`,
        `update identity.session_grants set csrf_hash = '${good}0', csrf_issued_at = now() where session_id = $1`,
      ]) {
        const result = await attempt(client, null, sql, [m.sessionId]);
        expect(result.ok, sql).toBe(false);
        if (!result.ok) expect(result.code, sql).toBe('23514');
      }
      expect((await attempt(client, null, `update identity.session_grants set csrf_hash = '${good}', csrf_issued_at = now() where session_id = $1`, [m.sessionId])).ok).toBe(true);
    });
  });

  it('can change on a live grant, but never on a revoked one, which is final', async () => {
    await inTx(async (client) => {
      const svc = api(client);
      const m = await member(client);
      const first = 'ab'.repeat(32);
      const second = 'cd'.repeat(32);
      expect((await attempt(client, null, `update identity.session_grants set csrf_hash = $2, csrf_issued_at = now() where session_id = $1`, [m.sessionId, first])).ok).toBe(true);
      expect((await attempt(client, null, `update identity.session_grants set csrf_hash = $2, csrf_issued_at = now() where session_id = $1`, [m.sessionId, second])).ok).toBe(true);
      await svc.revokeGrants({session: m.sessionId});
      for (const sql of [
        `update identity.session_grants set csrf_hash = '${first}' where session_id = $1`,
        `update identity.session_grants set csrf_issued_at = csrf_issued_at + interval '1 second' where session_id = $1`,
        `update identity.session_grants set csrf_hash = null, csrf_issued_at = null where session_id = $1`,
      ]) {
        const result = await attempt(client, null, sql, [m.sessionId]);
        expect(result.ok, sql).toBe(false);
        if (!result.ok) expect(result).toMatchObject({code: '55000', message: expect.stringContaining('revoked session grant is final')});
      }
      expect((await grantRow(client, m.sessionId)).csrf_hash).toBe(second);
    });
  });

  it('are untouched by revoking, and by a last-use touch', async () => {
    await inTx(async (client) => {
      const svc = api(client);
      const m = await member(client);
      const hash = await newHash();
      await svc.issueCsrf(m.user.id, m.sessionId, hash);
      const before = await grantRow(client, m.sessionId);
      await client.query(`update identity.session_grants set issued_at = clock_timestamp() - interval '3 minutes', last_used_at = clock_timestamp() - interval '2 minutes' where session_id = $1`, [m.sessionId]);
      const aged = await grantRow(client, m.sessionId);
      await svc.authorize(m.user.id, m.sessionId);
      // The touch moved the last use and nothing about the token.
      const touched = await grantRow(client, m.sessionId);
      expect(touched.last_used_at.getTime()).toBeGreaterThan(aged.last_used_at.getTime());
      expect(touched).toMatchObject({csrf_hash: before.csrf_hash, csrf_issued_at: before.csrf_issued_at});
      await svc.revokeGrants({session: m.sessionId});
      expect(await grantRow(client, m.sessionId)).toMatchObject({csrf_hash: hash, csrf_issued_at: before.csrf_issued_at});
    });
  });
});

// ---------------------------------------------------------------------------------------------------
describe('api.issue_csrf: the first token of a session, and the minute that keeps two tabs on one', () => {
  it('stores the hash of the first token and says issued', async () => {
    await inTx(async (client) => {
      const svc = api(client);
      const m = await member(client);
      const hash = await newHash();
      expect(await svc.issueCsrf(m.user.id, m.sessionId, hash)).toEqual({outcome: 'issued'});
      const grant = await grantRow(client, m.sessionId);
      expect(grant.csrf_hash).toBe(hash);
      expect(grant.csrf_issued_at).toBeInstanceOf(Date);
      expect(Date.now() - grant.csrf_issued_at.getTime()).toBeLessThan(60_000);
    });
  });

  it('leaves a hash under a minute old, whoever asks: two first requests at once keep one token', async () => {
    await inTx(async (client) => {
      const svc = api(client);
      const m = await member(client);
      const first = await newHash();
      await svc.issueCsrf(m.user.id, m.sessionId, first);
      const stored = await grantRow(client, m.sessionId);
      for (let call = 0; call < 3; call += 1) expect(await svc.issueCsrf(m.user.id, m.sessionId, await newHash())).toEqual({outcome: 'exists'});
      // Not even the same hash again moves the clock.
      expect(await svc.issueCsrf(m.user.id, m.sessionId, first)).toEqual({outcome: 'exists'});
      expect(await grantRow(client, m.sessionId)).toMatchObject({csrf_hash: first, csrf_issued_at: stored.csrf_issued_at});
    });
  });

  // 59.5 here and 60 below pin the constant to within half a second. The clock moves on between the update and the
  // call, so the operator itself (<= against <) cannot be told apart by any test.
  it.each([0, 30, 59, 59.5])('still leaves a hash that is %s seconds old (under 60)', async (seconds) => {
    await inTx(async (client) => {
      const svc = api(client);
      const m = await member(client);
      const first = await newHash();
      await svc.issueCsrf(m.user.id, m.sessionId, first);
      await ageHash(client, m.sessionId, seconds);
      expect(await svc.issueCsrf(m.user.id, m.sessionId, await newHash())).toEqual({outcome: 'exists'});
      expect((await grantRow(client, m.sessionId)).csrf_hash).toBe(first);
    });
  });

  it.each([60, 61, 3600, 86_400 * 20])('replaces a hash that is %i seconds old (the cookie was lost; a hash 60 seconds old or older is replaced): the new token stands, the old one does not', async (seconds) => {
    await inTx(async (client) => {
      const svc = api(client);
      const m = await member(client);
      const first = await newHash();
      const second = await newHash();
      await svc.issueCsrf(m.user.id, m.sessionId, first);
      await ageHash(client, m.sessionId, seconds);
      expect(await svc.issueCsrf(m.user.id, m.sessionId, second)).toEqual({outcome: 'issued'});
      expect((await grantRow(client, m.sessionId)).csrf_hash).toBe(second);
      expect(await svc.verifyCsrf(m.user.id, m.sessionId, second)).toEqual({outcome: 'valid'});
      expect(await svc.verifyCsrf(m.user.id, m.sessionId, first)).toEqual({outcome: 'invalid'});
    });
  });

  it('gives an older grant, which never had a token, one on its next page request', async () => {
    await inTx(async (client) => {
      const svc = api(client);
      const m = await member(client);
      // Issued before this story: no hash, however old the grant.
      await client.query(`update identity.session_grants set issued_at = clock_timestamp() - interval '20 days', last_used_at = clock_timestamp() - interval '1 day' where session_id = $1`, [m.sessionId]);
      expect((await grantRow(client, m.sessionId)).csrf_hash).toBeNull();
      expect(await svc.issueCsrf(m.user.id, m.sessionId, await newHash())).toEqual({outcome: 'issued'});
    });
  });

  it('gives each session of an Account its own token', async () => {
    await inTx(async (client) => {
      const svc = api(client);
      const m = await member(client);
      const other = await addSession(client, m.user.id);
      await svc.issueGrant(m.user.id, other);
      const a = await newHash();
      const b = await newHash();
      expect(await svc.issueCsrf(m.user.id, m.sessionId, a)).toEqual({outcome: 'issued'});
      expect(await svc.issueCsrf(m.user.id, other, b)).toEqual({outcome: 'issued'});
      expect(await svc.verifyCsrf(m.user.id, m.sessionId, a)).toEqual({outcome: 'valid'});
      expect(await svc.verifyCsrf(m.user.id, other, b)).toEqual({outcome: 'valid'});
      expect(await svc.verifyCsrf(m.user.id, m.sessionId, b)).toEqual({outcome: 'invalid'});
      expect(await svc.verifyCsrf(m.user.id, other, a)).toEqual({outcome: 'invalid'});
    });
  });

  it.each(ended)('denies a session whose grant is %s, and stores nothing', async (_name, end) => {
    await inTx(async (client) => {
      const svc = api(client);
      const m = await member(client);
      await end(client, m);
      const before = await grantRow(client, m.sessionId);
      expect(await svc.issueCsrf(m.user.id, m.sessionId, await newHash())).toEqual({outcome: 'denied'});
      expect(await grantRow(client, m.sessionId)).toEqual(before);
    });
  });

  it('denies a user with no Account, a session that belongs to another user, and one that never existed', async () => {
    await inTx(async (client) => {
      const svc = api(client);
      const m = await member(client);
      const stranger = await addUser(client);
      const strangerSession = await addSession(client, stranger.id);
      expect(await svc.issueCsrf(stranger.id, strangerSession, await newHash())).toEqual({outcome: 'denied'});
      // Another user's session, with the right user: never theirs to take a token for.
      expect(await svc.issueCsrf(m.user.id, strangerSession, await newHash())).toEqual({outcome: 'denied'});
      expect(await svc.issueCsrf(stranger.id, m.sessionId, await newHash())).toEqual({outcome: 'denied'});
      expect(await svc.issueCsrf(m.user.id, randomUUID(), await newHash())).toEqual({outcome: 'denied'});
      expect((await grantRow(client, m.sessionId)).csrf_hash).toBeNull();
    });
  });

  it('refuses a missing or malformed argument with an invalid-argument error, and writes nothing', async () => {
    await inTx(async (client) => {
      const m = await member(client);
      const good = 'ab'.repeat(32);
      for (const [sql, params] of [
        ['select * from api.issue_csrf(null, $1, $2)', [m.sessionId, good]],
        ['select * from api.issue_csrf($1, null, $2)', [m.user.id, good]],
        ['select * from api.issue_csrf($1, $2, null)', [m.user.id, m.sessionId]],
        ['select * from api.issue_csrf($1, $2, $3)', [m.user.id, m.sessionId, 'not-a-hash']],
        ['select * from api.issue_csrf($1, $2, $3)', [m.user.id, m.sessionId, good.toUpperCase()]],
        ['select * from api.issue_csrf($1, $2, $3)', [m.user.id, m.sessionId, `${good}0`]],
        ['select * from api.issue_csrf($1, $2, $3)', [m.user.id, m.sessionId, newCsrfToken()]],
      ] as [string, unknown[]][]) {
        const result = await attempt(client, 'service_role', sql, params);
        expect(result.ok, sql).toBe(false);
        if (!result.ok) expect(result.code, sql).toBe('22023');
      }
      expect((await grantRow(client, m.sessionId)).csrf_hash).toBeNull();
    });
  });

  it('does not touch the audit trail: a token is not an event', async () => {
    await inTx(async (client) => {
      const svc = api(client);
      const m = await member(client);
      const before = await count(client, 'select count(*) as n from identity.audit_events');
      await svc.issueCsrf(m.user.id, m.sessionId, await newHash());
      await svc.verifyCsrf(m.user.id, m.sessionId, await newHash());
      expect(await count(client, 'select count(*) as n from identity.audit_events')).toBe(before);
    });
  });
});

// ---------------------------------------------------------------------------------------------------
describe('api.verify_csrf: the hash of a request\'s token against the grant of its session', () => {
  it('says valid for the stored hash, and nothing else is valid', async () => {
    await inTx(async (client) => {
      const svc = api(client);
      const m = await member(client);
      const hash = await newHash();
      await svc.issueCsrf(m.user.id, m.sessionId, hash);
      expect(await svc.verifyCsrf(m.user.id, m.sessionId, hash)).toEqual({outcome: 'valid'});
      expect(await svc.verifyCsrf(m.user.id, m.sessionId, await newHash())).toEqual({outcome: 'invalid'});
      // A hash that differs in one character, and in case.
      const flipped = `${hash.slice(0, -1)}${hash.endsWith('0') ? '1' : '0'}`;
      expect(await svc.verifyCsrf(m.user.id, m.sessionId, flipped)).toEqual({outcome: 'invalid'});
      // The stored hash is the one it compares with: the token itself is not.
      expect(await attempt(client, 'service_role', 'select * from api.verify_csrf($1, $2, $3)', [m.user.id, m.sessionId, newCsrfToken()])).toMatchObject({ok: false, code: '22023'});
    });
  });

  it('says invalid, whatever is sent, for a grant that has no token yet (it predates this story, or no page was requested)', async () => {
    await inTx(async (client) => {
      const svc = api(client);
      const m = await member(client);
      for (const hash of [await newHash(), '0'.repeat(64), 'f'.repeat(64)]) expect(await svc.verifyCsrf(m.user.id, m.sessionId, hash)).toEqual({outcome: 'invalid'});
    });
  });

  it('says invalid for another session\'s token, of the same Account and of another', async () => {
    await inTx(async (client) => {
      const svc = api(client);
      const mine = await member(client);
      const theirs = await member(client);
      const sibling = await addSession(client, mine.user.id);
      await svc.issueGrant(mine.user.id, sibling);
      const [a, b, c] = [await newHash(), await newHash(), await newHash()];
      await svc.issueCsrf(mine.user.id, mine.sessionId, a);
      await svc.issueCsrf(theirs.user.id, theirs.sessionId, b);
      await svc.issueCsrf(mine.user.id, sibling, c);
      expect(await svc.verifyCsrf(mine.user.id, mine.sessionId, a)).toEqual({outcome: 'valid'});
      expect(await svc.verifyCsrf(mine.user.id, mine.sessionId, b)).toEqual({outcome: 'invalid'});
      expect(await svc.verifyCsrf(mine.user.id, mine.sessionId, c)).toEqual({outcome: 'invalid'});
      // And a session of another user cannot be named by this one at all.
      expect(await svc.verifyCsrf(mine.user.id, theirs.sessionId, b)).toEqual({outcome: 'denied'});
      expect(await svc.verifyCsrf(theirs.user.id, mine.sessionId, a)).toEqual({outcome: 'denied'});
    });
  });

  it.each(ended)('says denied for a session whose grant is %s, even for the hash that was valid', async (_name, end) => {
    await inTx(async (client) => {
      const svc = api(client);
      const m = await member(client);
      const hash = await newHash();
      await svc.issueCsrf(m.user.id, m.sessionId, hash);
      expect(await svc.verifyCsrf(m.user.id, m.sessionId, hash)).toEqual({outcome: 'valid'});
      await end(client, m);
      expect(await svc.verifyCsrf(m.user.id, m.sessionId, hash)).toEqual({outcome: 'denied'});
    });
  });

  it('keeps a token valid for as long as its grant is, however old the token: only the grant ends it', async () => {
    await inTx(async (client) => {
      const svc = api(client);
      const m = await member(client);
      const hash = await newHash();
      await svc.issueCsrf(m.user.id, m.sessionId, hash);
      await ageHash(client, m.sessionId, 86_400 * 20);
      expect(await svc.verifyCsrf(m.user.id, m.sessionId, hash)).toEqual({outcome: 'valid'});
    });
  });

  it('refuses a missing or malformed argument with an invalid-argument error', async () => {
    await inTx(async (client) => {
      const m = await member(client);
      const good = 'ab'.repeat(32);
      for (const [sql, params] of [
        ['select * from api.verify_csrf(null, $1, $2)', [m.sessionId, good]],
        ['select * from api.verify_csrf($1, null, $2)', [m.user.id, good]],
        ['select * from api.verify_csrf($1, $2, null)', [m.user.id, m.sessionId]],
        ['select * from api.verify_csrf($1, $2, $3)', [m.user.id, m.sessionId, '']],
        ['select * from api.verify_csrf($1, $2, $3)', [m.user.id, m.sessionId, good.slice(1)]],
      ] as [string, unknown[]][]) {
        const result = await attempt(client, 'service_role', sql, params);
        expect(result.ok, sql).toBe(false);
        if (!result.ok) expect(result.code, sql).toBe('22023');
      }
    });
  });

  it('changes nothing it reads', async () => {
    await inTx(async (client) => {
      const svc = api(client);
      const m = await member(client);
      const hash = await newHash();
      await svc.issueCsrf(m.user.id, m.sessionId, hash);
      const before = await grantRow(client, m.sessionId);
      await svc.verifyCsrf(m.user.id, m.sessionId, hash);
      await svc.verifyCsrf(m.user.id, m.sessionId, await newHash());
      const after = await grantRow(client, m.sessionId);
      expect({hash: after.csrf_hash, issued: after.csrf_issued_at}).toEqual({hash: before.csrf_hash, issued: before.csrf_issued_at});
    });
  });
});

// ---------------------------------------------------------------------------------------------------
describe('access: closed by default, the service role alone', () => {
  it('lets only service_role execute the two functions, as their owner, with a pinned search path', async () => {
    const { rows } = await db.query(
      `select p.proname as name, p.prosecdef as definer, p.proconfig as config,
              coalesce((select array_agg(case when a.grantee = 0 then 'public' else a.grantee::regrole::text end order by 1)
                          from aclexplode(p.proacl) a where a.privilege_type = 'EXECUTE' and a.grantee <> p.proowner), '{}') as grantees
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'api' and p.proname in ('issue_csrf', 'verify_csrf') order by 1`,
    );
    expect(rows.map((row) => row.name)).toEqual(['issue_csrf', 'verify_csrf']);
    for (const row of rows) {
      expect(row.grantees, row.name).toEqual(['service_role']);
      expect(row.definer, row.name).toBe(true);
      expect(String(row.config), row.name).toContain('search_path=');
    }
  });

  it('refuses anon and authenticated, and gives no one access to the columns', async () => {
    await inTx(async (client) => {
      const m = await member(client);
      const hash = await newHash();
      for (const role of ['anon', 'authenticated']) {
        for (const sql of [
          'select * from api.issue_csrf($1, $2, $3)',
          'select * from api.verify_csrf($1, $2, $3)',
        ]) {
          const result = await attempt(client, role, sql, [m.user.id, m.sessionId, hash]);
          expect(result.ok, `${role}: ${sql}`).toBe(false);
          if (!result.ok) expect(result.code).toBe('42501');
        }
      }
      for (const role of ['anon', 'authenticated', 'service_role']) {
        const read = await attempt(client, role, 'select csrf_hash from identity.session_grants');
        expect(read.ok, role).toBe(false);
        const write = await attempt(client, role, `update identity.session_grants set csrf_hash = '${hash}', csrf_issued_at = now()`);
        expect(write.ok, role).toBe(false);
      }
    });
  });

  it('answers through the REST API to the service role, and refuses the anon key', async () => {
    const m = await committedMember();
    const hash = await newHash();
    const rpc = (key: string, name: string, body: object) =>
      fetch(`${stack.apiUrl}/rest/v1/rpc/${name}`, {method: 'POST', headers: {apikey: stack.anonKey, authorization: `Bearer ${key}`, 'content-type': 'application/json', 'content-profile': 'api'}, body: JSON.stringify(body)});
    const args = {p_user_id: m.user.id, p_session_id: m.sessionId, p_csrf_hash: hash};
    const refused = await rpc(stack.anonKey, 'issue_csrf', args);
    expect((await refused.json()).code).toBe('42501');
    expect((await (await rpc(stack.anonKey, 'verify_csrf', args)).json()).code).toBe('42501');
    const issued = await rpc(stack.serviceKey, 'issue_csrf', args);
    expect([issued.status, await issued.json()]).toEqual([200, {outcome: 'issued'}]);
    expect(await (await rpc(stack.serviceKey, 'verify_csrf', args)).json()).toEqual({outcome: 'valid'});
  });
});

describe('api.preflight', () => {
  it('answers ok and reads the new columns, so a database without the migration fails the build with one line', async () => {
    await inTx(async (client) => {
      expect(await api(client).preflight()).toEqual({ok: true});
      const { rows } = await client.query(`select pg_get_functiondef('api.preflight()'::regprocedure) as definition`);
      expect(rows[0].definition).toContain('csrf_hash');
      expect(rows[0].definition).toContain('csrf_issued_at');
      // It still reads what the earlier stories needed.
      for (const table of ['session_grants', 'accounts', 'step_up_nonces', 'fresh_authentications', 'sessions', 'identities', 'mfa_amr_claims']) expect(rows[0].definition, table).toContain(table);
    });
  });

  it('writes nothing', async () => {
    await inTx(async (client) => {
      const m = await member(client);
      const before = await grantRow(client, m.sessionId);
      await api(client).preflight();
      expect(await grantRow(client, m.sessionId)).toEqual(before);
    });
  });
});

// ---------------------------------------------------------------------------------------------------
// Committed fixtures for the cases that need real connections. The harness removes the users, Accounts, grants
// and codes registered here after the last test.
async function committedMember() {
  const user = await addUser(db);
  committed.users.push(user.id);
  const issued = await issueInvitation({kind: 'named', label: `csrf ${user.id.slice(0, 8)}`, actor: 'seed:local:csrf'}, {env});
  if (issued.outcome !== 'issued') throw new Error('The code was not issued.');
  committed.invitationIds.push(issued.invitationId);
  const receipt = await registerWithCode({userId: user.id, commandId: randomUUID(), code: issued.code, clientAddress: `203.0.113.${Math.floor(Math.random() * 250) + 1}`}, {env});
  if (receipt.outcome !== 'registered') throw new Error(`The test Account was not created (${receipt.outcome}).`);
  const sessionId = await addSession(db, user.id);
  await db.query('select * from api.issue_grant($1, $2)', [user.id, sessionId]);
  return {user, accountId: receipt.accountId as string, sessionId};
}

describe('concurrency (real connections, committed data)', () => {
  it('two first page requests at once: one token is stored and the other request is told so, whichever wins', async () => {
    for (let round = 0; round < 5; round += 1) {
      const m = await committedMember();
      const clients = await Promise.all([connect(), connect()]);
      const hashes = [await newHash(), await newHash()];
      const answers = await Promise.all(clients.map((client, i) => client.query('select outcome from api.issue_csrf($1, $2, $3)', [m.user.id, m.sessionId, hashes[i]])));
      const outcomes = answers.map((answer) => answer.rows[0].outcome as string);
      expect([...outcomes].sort(), `round ${round}`).toEqual(['exists', 'issued']);
      // The stored hash is the winner's: the one whose token the winner delivers, and the only one that is valid.
      const winner = hashes[outcomes.indexOf('issued')];
      const loser = hashes[outcomes.indexOf('exists')];
      expect((await grantRow(db, m.sessionId)).csrf_hash, `round ${round}`).toBe(winner);
      expect((await db.query('select outcome from api.verify_csrf($1, $2, $3)', [m.user.id, m.sessionId, winner])).rows[0].outcome).toBe('valid');
      expect((await db.query('select outcome from api.verify_csrf($1, $2, $3)', [m.user.id, m.sessionId, loser])).rows[0].outcome).toBe('invalid');
    }
  });

  it('many first page requests at once still leave exactly one token', async () => {
    const m = await committedMember();
    const clients = await Promise.all(Array.from({length: 8}, () => connect()));
    const hashes = await Promise.all(clients.map(() => newHash()));
    const answers = await Promise.all(clients.map((client, i) => client.query('select outcome from api.issue_csrf($1, $2, $3)', [m.user.id, m.sessionId, hashes[i]])));
    const outcomes = answers.map((answer) => answer.rows[0].outcome as string);
    expect(outcomes.filter((outcome) => outcome === 'issued')).toHaveLength(1);
    expect(outcomes.filter((outcome) => outcome === 'exists')).toHaveLength(7);
    expect((await grantRow(db, m.sessionId)).csrf_hash).toBe(hashes[outcomes.indexOf('issued')]);
  });

  it('a request that waited for the grant\'s lock judges the minute from when it could act, not from when it was called', async () => {
    const m = await committedMember();
    const old = await newHash();
    await db.query('select * from api.issue_csrf($1, $2, $3)', [m.user.id, m.sessionId, old]);
    // 59 seconds old, so a call made now is told `exists`, but one that can act two seconds later is not.
    await db.query(`update identity.session_grants set csrf_issued_at = clock_timestamp() - interval '59 seconds' where session_id = $1`, [m.sessionId]);
    const holder = await connect();
    await holder.query('begin');
    try {
      await holder.query('select 1 from identity.session_grants where session_id = $1 for update', [m.sessionId]);
      const caller = await connect();
      const fresh = await newHash();
      let finished = false;
      const pending = caller.query('select outcome from api.issue_csrf($1, $2, $3)', [m.user.id, m.sessionId, fresh]).then((result) => {
        finished = true;
        return result;
      });
      await new Promise((resolve) => setTimeout(resolve, 2300));
      expect(finished, 'the call must wait for the grant\'s row lock').toBe(false);
      await holder.query('commit');
      expect((await pending).rows[0].outcome).toBe('issued');
      expect((await grantRow(db, m.sessionId)).csrf_hash).toBe(fresh);
    } finally {
      // Whatever failed above, the row lock does not outlive the test.
      await holder.query('rollback').catch(() => undefined);
    }
  });

  it('a grant revoked while a request waits for its lock is denied, and the token is not stored', async () => {
    const m = await committedMember();
    const holder = await connect();
    await holder.query('begin');
    try {
      await holder.query(`update identity.session_grants set revoked_at = clock_timestamp(), revoked_by = 'seed:local:csrf', revoked_reason = 'test' where session_id = $1`, [m.sessionId]);
      const caller = await connect();
      const hash = await newHash();
      const pending = caller.query('select outcome from api.issue_csrf($1, $2, $3)', [m.user.id, m.sessionId, hash]);
      await new Promise((resolve) => setTimeout(resolve, 500));
      await holder.query('commit');
      expect((await pending).rows[0].outcome).toBe('denied');
      expect((await grantRow(db, m.sessionId)).csrf_hash).toBeNull();
    } finally {
      await holder.query('rollback').catch(() => undefined);
    }
  });
});

describe('the typed calls, over REST', () => {
  it('round-trips an issue and a check with the key the application holds', async () => {
    const m = await committedMember();
    const token = newCsrfToken();
    const hash = await hashCsrfToken(token);
    expect(await issueCsrf({userId: m.user.id, sessionId: m.sessionId, hash}, {env})).toBe('issued');
    expect(await issueCsrf({userId: m.user.id, sessionId: m.sessionId, hash: await newHash()}, {env})).toBe('exists');
    expect(await verifyCsrf({userId: m.user.id, sessionId: m.sessionId, hash}, {env})).toBe('valid');
    expect(await verifyCsrf({userId: m.user.id, sessionId: m.sessionId, hash: await newHash()}, {env})).toBe('invalid');
    expect(await verifyCsrf({userId: m.user.id, sessionId: randomUUID(), hash}, {env})).toBe('denied');
  });

  it('fails closed when the database cannot be reached', async () => {
    const m = await committedMember();
    const unreachable = {...env, NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:1'};
    await expect(verifyCsrf({userId: m.user.id, sessionId: m.sessionId, hash: await newHash()}, {env: unreachable, timeoutMs: 2000})).rejects.toBeInstanceOf(AccountsUnavailableError);
    await expect(issueCsrf({userId: m.user.id, sessionId: m.sessionId, hash: await newHash()}, {env: unreachable, timeoutMs: 2000})).rejects.toMatchObject({retryable: true});
  });
});
