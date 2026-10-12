import {randomBytes, randomUUID} from 'node:crypto';
import {Client} from 'pg';
import {afterAll, beforeAll, beforeEach, describe, expect, it} from 'vitest';
import {
  AccountsConfigError,
  AccountsUnavailableError,
  checkRecovery,
  hashKey,
  hashRecoveryToken,
  issueInvitation,
  issueRecovery,
  newRecoveryToken,
  redeemRecoveryToken,
  registerWithCode,
  voidRecovery,
} from '@/lib/accounts';
import {codeHash, createHarness, insertAmrClaim, stack, tag, type TestUser} from '../support/accounts-db';
import {stackEnvironment} from '../support/stack';

// Story 1.6 against the Supabase CLI stack: identity.recovery_tokens, api.issue_recovery / void_recovery / check_recovery /
// redeem_recovery, the marker's nullable nonce and `source`, the guard triggers, the closure of every new object and the preflight,
// every row of the I/O matrix at the database.
//
// Recovery is a GLOBAL SINGLETON: one outstanding token and limits that count every issuance in the database. So this is the
// ONLY integration file that touches identity.recovery_tokens, and it empties the table before every case and after the file.
// (The browser flows, tests/e2e/recovery.spec.ts, are the only other writer and run under Playwright, never in the same run.)
// Most cases run inside a transaction that is rolled back, as the service role. The cases that need several real connections,
// and the REST round trip the application makes, commit data that is removed afterwards. Audit events are append-only and
// stay, which is why every case that counts them uses an Account of its own, and why a refusal that names no Account
// (system:recovery, no target) is first set aside inside the rolled-back transaction (`forgetUntargeted`): it is recorded once
// an hour across the whole table, and an earlier run's committed row would otherwise hide what the call under test writes.

const {db, connect, committed, inTx, addUser, addSession, attempt, rows, api, count} = createHarness();

let env: Record<string, string>;
beforeAll(async () => {
  env = await stackEnvironment(db);
});
beforeEach(async () => {
  await db.query('delete from identity.recovery_tokens');
});
afterAll(async () => {
  // A connection of its own: the harness may already have closed `db` (and has removed the committed Accounts' tokens).
  const client = new Client({connectionString: stack.dbUrl});
  await client.connect();
  try {
    await client.query('delete from identity.recovery_tokens');
  } finally {
    await client.end();
  }
});

const ACTOR = 'system:recovery';
const minutes = (n: number) => `${n} minutes`;
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// Fixtures --------------------------------------------------------------------------------------------------------------

type Admin = {user: TestUser; email: string; accountId: string; sessions: string[]};

/**
 * An Account registered the way the registration screen does it, made the Administrator (or left a member), with the given
 * number of live Auth sessions that each hold their grant. Its Auth user has a unique test address and one Google identity.
 */
async function account(client: Client, options: {role?: 'administrator' | 'member'; email?: string; sessions?: number} = {}): Promise<Admin> {
  const svc = api(client);
  const user = await addUser(client, {email: options.email ?? `recovery-${tag()}${tag()}@example.test`});
  const code = codeHash();
  await svc.issue(code, 'general', null);
  const receipt = await svc.register(user.id, code);
  if (receipt.outcome !== 'registered') throw new Error(`The test Account was not created (${receipt.outcome}).`);
  if ((options.role ?? 'administrator') === 'administrator') await client.query(`update identity.accounts set role = 'administrator' where id = $1`, [receipt.account_id]);
  const sessions: string[] = [];
  for (let index = 0; index < (options.sessions ?? 1); index += 1) {
    const sessionId = await addSession(client, user.id);
    const grant = await svc.issueGrant(user.id, sessionId);
    if (grant.outcome !== 'issued') throw new Error(`The test grant was not issued (${grant.outcome}).`);
    sessions.push(sessionId);
  }
  return {user, email: user.email, accountId: receipt.account_id as string, sessions};
}

/** The same Administrator, committed (for the cases that need real connections), removed with the harness's other committed data. */
async function committedAdministrator(options: {sessions?: number} = {}): Promise<Admin> {
  const user = await addUser(db, {email: `recovery-${tag()}${tag()}@example.test`});
  committed.users.push(user.id);
  const issued = await issueInvitation({kind: 'named', label: `recovery ${user.id.slice(0, 8)}`, actor: 'seed:local:recovery'}, {env});
  if (issued.outcome !== 'issued') throw new Error('The code was not issued.');
  committed.invitationIds.push(issued.invitationId);
  const receipt = await registerWithCode({userId: user.id, commandId: randomUUID(), code: issued.code, clientAddress: `203.0.113.${Math.floor(Math.random() * 250) + 1}`}, {env});
  if (receipt.outcome !== 'registered') throw new Error(`The test Account was not created (${receipt.outcome}).`);
  await db.query(`update identity.accounts set role = 'administrator' where id = $1`, [receipt.accountId]);
  const sessions: string[] = [];
  for (let index = 0; index < (options.sessions ?? 1); index += 1) {
    const sessionId = await addSession(db, user.id);
    const grant = await db.query('select outcome from api.issue_grant($1, $2)', [user.id, sessionId]);
    if (grant.rows[0].outcome !== 'issued') throw new Error(`The test grant was not issued (${grant.rows[0].outcome}).`);
    sessions.push(sessionId);
  }
  return {user, email: user.email, accountId: receipt.accountId as string, sessions};
}

// The four functions, as the service role calls them.
const one = async (client: Client, sql: string, params: unknown[] = []) => (await rows(client, 'service_role', sql, params))[0];
const issue = (client: Client, hash: string, email: string) => one(client, 'select outcome, expires_at from api.issue_recovery($1, $2)', [hash, email]);
const voidToken = (client: Client, hash: string, definitive: boolean) => one(client, 'select outcome from api.void_recovery($1, $2)', [hash, definitive]);
const check = (client: Client, hash: string, email: string) => one(client, 'select outcome, user_id, email from api.check_recovery($1, $2)', [hash, email]);
const redeem = (client: Client, hash: string, email: string, userId: string, sessionId: string) =>
  one(client, 'select outcome, sessions_ended, epoch::integer as epoch from api.redeem_recovery($1, $2, $3, $4)', [hash, email, userId, sessionId]);

/** A token issued for the Administrator now (the function must say `issued`). Returns its hash. */
async function issued(client: Client, admin: Admin, hash = codeHash()) {
  const receipt = await issue(client, hash, admin.email);
  if (receipt.outcome !== 'issued') throw new Error(`The recovery token was not issued (${receipt.outcome}).`);
  return hash;
}

// Reading what the database holds.
const tokenCount = (client: Client) => count(client, 'select count(*) as n from identity.recovery_tokens');
const tokenOf = async (client: Client, hash: string) => (await client.query('select * from identity.recovery_tokens where token_hash = $1', [hash])).rows[0];
const auditOf = async (client: Client, action: string, target: string) =>
  (await client.query('select actor, action, target from identity.audit_events where action = $1 and target = $2 order by id', [action, target])).rows;
// Within the last hour only: what is older neither dedupes a new event nor is of this case.
const untargeted = async (client: Client, action: string, actor = ACTOR) =>
  (
    await client.query(
      `select actor, action, target from identity.audit_events
        where action = $1 and actor = $2 and target is null and occurred_at > clock_timestamp() - interval '1 hour' order by id`,
      [action, actor],
    )
  ).rows;
const epochOf = async (client: Client, accountId: string) => Number((await client.query('select authorization_epoch as epoch from identity.accounts where id = $1', [accountId])).rows[0].epoch);
const authSessionsOf = async (client: Client, userId: string) => (await client.query('select id from auth.sessions where user_id = $1 order by id', [userId])).rows.map((row) => row.id as string);
const grantRowsOf = async (client: Client, accountId: string) =>
  (await client.query('select session_id, epoch::int as epoch, revoked_at, revoked_by, revoked_reason from identity.session_grants where account_id = $1 order by session_id', [accountId])).rows;
const markerRowsOf = async (client: Client, accountId: string) => (await client.query('select * from identity.fresh_authentications where account_id = $1 order by session_id, action_class', [accountId])).rows;
const stateOf = async (client: Client, admin: Admin, sessionId: string) => (await api(client).authorize(admin.user.id, sessionId)).state as string;

/** What a recovery could change about a person, as one value to compare before and after, with the tokens (global) and the audit trail apart. */
async function snapshot(client: Client, admin: Admin) {
  const account = (await client.query('select authorization_epoch::int as epoch, status, role from identity.accounts where id = $1', [admin.accountId])).rows[0];
  const tokens = (await client.query('select id, token_hash, issued_at, expires_at, used_at, voided_at from identity.recovery_tokens order by id')).rows;
  const audit = (
    await client.query(
      `select actor, action, target from identity.audit_events
        where target = $1 or target in (select 'session:' || g.session_id::text from identity.session_grants g where g.account_id = $2)
        order by id`,
      [`account:${admin.accountId}`, admin.accountId],
    )
  ).rows;
  return {
    // The tokens (a global table) are apart from what a recovery of ANOTHER Account must leave as it was.
    tokens,
    state: {
      account,
      grants: await grantRowsOf(client, admin.accountId),
      sessions: await authSessionsOf(client, admin.user.id),
      markers: (await markerRowsOf(client, admin.accountId)).map((marker) => ({session_id: marker.session_id, action_class: marker.action_class, source: marker.source, consumed_at: marker.consumed_at})),
    },
    audit,
  };
}

/**
 * Audit events are append-only, and a refusal that names no Account is recorded once an hour across the whole table. Inside
 * the rolled-back transaction, this sets the recent ones aside (and puts the guard back) so a case sees what its own call writes.
 */
async function forgetUntargeted(client: Client) {
  await client.query('alter table identity.audit_events disable trigger audit_events_append_only');
  await client.query(`delete from identity.audit_events where actor = 'system:recovery' and target is null and occurred_at > clock_timestamp() - interval '3 hours'`);
  await client.query('alter table identity.audit_events enable trigger audit_events_append_only');
}

/** Puts a token's issue time (and, 15 minutes later, its expiry) this long ago on the database clock. */
const placeAt = (client: Client, hash: string, ago: string) =>
  client.query(`update identity.recovery_tokens set issued_at = clock_timestamp() - $2::interval, expires_at = clock_timestamp() - $2::interval + interval '15 minutes' where token_hash = $1`, [hash, ago]);
/** The same for every token. */
const placeAllAt = (client: Client, ago: string) =>
  client.query(`update identity.recovery_tokens set issued_at = clock_timestamp() - $1::interval, expires_at = clock_timestamp() - $1::interval + interval '15 minutes'`, [ago]);

/** Waits until the backend is blocked on a lock, so a test knows the other connection really is waiting for it. */
async function untilBlocked(pid: number) {
  for (let attemptNumber = 0; attemptNumber < 100; attemptNumber += 1) {
    const {rows: found} = await db.query(`select wait_event_type from pg_stat_activity where pid = $1`, [pid]);
    if (found[0]?.wait_event_type === 'Lock') return;
    await wait(50);
  }
  throw new Error('The other connection never started waiting for the lock.');
}

/** What can happen to an Administrator after a token was issued (or before it is asked for), each of which loses eligibility. */
type Loss = {name: string; apply: (client: Client, admin: Admin) => Promise<{email?: string} | void>};
const losses: Loss[] = [
  {name: 'no Administrator has this address (the address is nobody\'s)', apply: async () => ({email: `nobody-${tag()}@example.test`})},
  {
    name: 'the address is a member\'s, not the Administrator\'s',
    apply: async (client) => {
      const member = await account(client, {role: 'member'});
      return {email: member.email};
    },
  },
  {
    name: 'the Account is a member (role member), whatever the address',
    apply: async (client, admin) => {
      await client.query(`update identity.accounts set role = 'member' where id = $1`, [admin.accountId]);
    },
  },
  {
    name: 'the Account is disabled',
    apply: async (client, admin) => {
      await client.query(`update identity.accounts set status = 'disabled' where id = $1`, [admin.accountId]);
    },
  },
  {
    name: 'the Auth user\'s address is not the configured one (it changed)',
    apply: async (client, admin) => {
      const moved = `moved-${tag()}@example.test`;
      await client.query(`update auth.users set email = $2 where id = $1`, [admin.user.id, moved]);
      await client.query(`update auth.identities set identity_data = jsonb_set(identity_data, '{email}', to_jsonb(($2)::text)) where user_id = $1`, [admin.user.id, moved]);
    },
  },
  {
    name: 'the Google identity says another address than the Auth user\'s',
    apply: async (client, admin) => {
      await client.query(`update auth.identities set identity_data = jsonb_set(identity_data, '{email}', '"another@example.test"') where user_id = $1`, [admin.user.id]);
    },
  },
  {
    name: 'the Google subject changed (identity.subject_pinned is false)',
    apply: async (client, admin) => {
      await client.query(`update auth.identities set provider_id = 'a-new-subject' where user_id = $1`, [admin.user.id]);
    },
  },
  {
    name: 'a second Google identity is linked to the Auth user',
    apply: async (client, admin) => {
      await client.query(
        `insert into auth.identities (provider_id, user_id, identity_data, provider, created_at, updated_at) values ('extra-subject', $1, '{"email_verified": true}', 'google', now(), now())`,
        [admin.user.id],
      );
    },
  },
  {
    name: 'Google no longer vouches for the address (email_verified false)',
    apply: async (client, admin) => {
      await client.query(`update auth.identities set identity_data = jsonb_set(identity_data, '{email_verified}', 'false') where user_id = $1`, [admin.user.id]);
    },
  },
  {
    name: 'the Auth user\'s address is unconfirmed',
    apply: async (client, admin) => {
      await client.query('update auth.users set email_confirmed_at = null where id = $1', [admin.user.id]);
    },
  },
  {
    name: 'the Auth user is banned',
    apply: async (client, admin) => {
      await client.query(`update auth.users set banned_until = now() + interval '1 day' where id = $1`, [admin.user.id]);
    },
  },
  {
    name: 'the Auth user was deleted (soft)',
    apply: async (client, admin) => {
      await client.query('update auth.users set deleted_at = now() where id = $1', [admin.user.id]);
    },
  },
  {
    name: 'more than one Account is an eligible Administrator for the address',
    apply: async (client, admin) => {
      // Auth's unique index on the address is case-sensitive, so a second user may hold the same address in capitals.
      const twin = await account(client, {role: 'administrator', email: admin.email.toUpperCase()});
      expect(twin.user.id).not.toBe(admin.user.id);
    },
  },
];

// ---------------------------------------------------------------------------------------------------------------------
describe('issuing a token: Request and Limited', () => {
  it('issues for the eligible Administrator: 15 minutes on the database clock, the keyed hash only, audited', async () => {
    await inTx(async (client) => {
      const admin = await account(client);
      const hash = codeHash();
      const receipt = await issue(client, hash, admin.email);
      expect(receipt.outcome).toBe('issued');
      const stored = (await client.query('select t.*, extract(epoch from t.expires_at - t.issued_at)::int as life, clock_timestamp() as now from identity.recovery_tokens t')).rows;
      expect(stored).toHaveLength(1);
      expect(stored[0]).toMatchObject({account_id: admin.accountId, token_hash: hash, used_at: null, voided_at: null, life: 900});
      expect(stored[0].token_hash).toMatch(/^[0-9a-f]{64}$/);
      expect(receipt.expires_at).toEqual(stored[0].expires_at);
      expect(Math.abs(stored[0].issued_at.getTime() - stored[0].now.getTime())).toBeLessThan(5_000);
      // The table holds a hash and times, and nothing else.
      const {rows: columns} = await client.query(`select column_name from information_schema.columns where table_schema = 'identity' and table_name = 'recovery_tokens' order by 1`);
      expect(columns.map((row) => row.column_name)).toEqual(['account_id', 'expires_at', 'id', 'issued_at', 'token_hash', 'used_at', 'voided_at']);
      expect(await auditOf(client, 'recovery.issued', `account:${admin.accountId}`)).toEqual([{actor: ACTOR, action: 'recovery.issued', target: `account:${admin.accountId}`}]);
    });
  });

  it('takes a hash and an address and nothing else: a raw token in place of the hash is refused, and nothing is stored', async () => {
    await inTx(async (client) => {
      const admin = await account(client);
      const raw = newRecoveryToken();
      expect(raw).toHaveLength(43);
      const result = await attempt(client, 'service_role', 'select * from api.issue_recovery($1, $2)', [raw, admin.email]);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.code).toBe('22023');
      expect(await tokenCount(client)).toBe(0);
    });
  });

  it('limits issuance to one per 15 minutes: the second is limited, nothing is inserted, recovery.limited is audited once an hour', async () => {
    await inTx(async (client) => {
      const admin = await account(client);
      const first = await issued(client, admin);
      const second = await issue(client, codeHash(), admin.email);
      expect(second).toEqual({outcome: 'limited', expires_at: null});
      expect(await tokenCount(client)).toBe(1);
      // The first token is untouched: a limited request voids nothing.
      expect(await tokenOf(client, first)).toMatchObject({used_at: null, voided_at: null});
      // Asked again and again, the refusal is recorded once an hour.
      await issue(client, codeHash(), admin.email);
      await issue(client, codeHash(), admin.email);
      expect(await auditOf(client, 'recovery.limited', `account:${admin.accountId}`)).toEqual([{actor: ACTOR, action: 'recovery.limited', target: `account:${admin.accountId}`}]);
      expect(await auditOf(client, 'recovery.issued', `account:${admin.accountId}`)).toHaveLength(1);
    });
  });

  it('counts the 15 minutes from the issue time: 14 minutes 55 seconds ago is limited, 15 minutes 5 seconds ago is allowed', async () => {
    await inTx(async (client) => {
      const admin = await account(client);
      const first = await issued(client, admin);
      await client.query(`update identity.recovery_tokens set issued_at = clock_timestamp() - interval '14 minutes 55 seconds', expires_at = clock_timestamp() + interval '5 seconds' where token_hash = $1`, [first]);
      expect((await issue(client, codeHash(), admin.email)).outcome).toBe('limited');
      await client.query(`update identity.recovery_tokens set issued_at = clock_timestamp() - interval '15 minutes 5 seconds', expires_at = clock_timestamp() - interval '5 seconds' where token_hash = $1`, [first]);
      expect((await issue(client, codeHash(), admin.email)).outcome).toBe('issued');
      expect(await tokenCount(client)).toBe(2);
    });
  });

  it('limits issuance to 5 in 24 hours: the sixth is limited and nothing is inserted', async () => {
    await inTx(async (client) => {
      const admin = await account(client);
      for (let index = 0; index < 5; index += 1) {
        const hash = await issued(client, admin);
        // Aged past the 15-minute spacing (and past its own expiry), so only the daily limit is left to say no.
        await placeAt(client, hash, minutes(20 + index));
      }
      const sixth = await issue(client, codeHash(), admin.email);
      expect(sixth).toEqual({outcome: 'limited', expires_at: null});
      expect(await tokenCount(client)).toBe(5);
      await issue(client, codeHash(), admin.email);
      expect(await auditOf(client, 'recovery.limited', `account:${admin.accountId}`)).toHaveLength(1);
    });
  });

  it('counts every issuance toward the five: voided, used and expired ones as much as an outstanding one', async () => {
    await inTx(async (client) => {
      const admin = await account(client);
      const made: string[] = [];
      for (let index = 0; index < 5; index += 1) {
        const hash = await issued(client, admin);
        made.push(hash);
        if (index === 0) expect((await voidToken(client, hash, true)).outcome).toBe('voided');
        if (index === 1) await client.query('update identity.recovery_tokens set used_at = clock_timestamp() where token_hash = $1', [hash]);
        if (index === 2) await client.query('update identity.recovery_tokens set voided_at = clock_timestamp() where token_hash = $1', [hash]);
        await placeAt(client, hash, minutes(20 + index));
      }
      expect((await issue(client, codeHash(), admin.email)).outcome).toBe('limited');
      // A day later (24 hours and a bit) the five are forgotten.
      await placeAllAt(client, '24 hours 5 minutes');
      expect((await issue(client, codeHash(), admin.email)).outcome).toBe('issued');
      expect(await tokenCount(client)).toBe(6);
    });
  });

  it('reads the day from the issue time: 23 hours 55 minutes ago still counts, 24 hours 5 minutes ago does not', async () => {
    await inTx(async (client) => {
      const admin = await account(client);
      for (let index = 0; index < 5; index += 1) await placeAt(client, await issued(client, admin), minutes(20 + index));
      await placeAllAt(client, '23 hours 55 minutes');
      expect((await issue(client, codeHash(), admin.email)).outcome).toBe('limited');
      await placeAllAt(client, '24 hours 5 minutes');
      expect((await issue(client, codeHash(), admin.email)).outcome).toBe('issued');
    });
  });

  it('counts the limits over the whole table, whoever the Account: a token issued for another Account is one of the five (and the one in 15 minutes)', async () => {
    await inTx(async (client) => {
      const admin = await account(client);
      const other = await account(client, {role: 'member'});
      await client.query(`insert into identity.recovery_tokens (account_id, token_hash, issued_at, expires_at) values ($1, $2, clock_timestamp(), clock_timestamp() + interval '15 minutes')`, [other.accountId, codeHash()]);
      expect((await issue(client, codeHash(), admin.email)).outcome).toBe('limited');
      expect(await tokenCount(client)).toBe(1);
    });
  });

  it('is `refused` rather than `limited` when nobody is eligible, whatever was issued before', async () => {
    await inTx(async (client) => {
      await forgetUntargeted(client);
      const admin = await account(client);
      await issued(client, admin);
      const result = await issue(client, codeHash(), `nobody-${tag()}@example.test`);
      expect(result).toEqual({outcome: 'refused', expires_at: null});
      expect(await tokenCount(client)).toBe(1);
      expect(await auditOf(client, 'recovery.limited', `account:${admin.accountId}`)).toEqual([]);
    });
  });

  it('voids an outstanding token when a new one is issued, so one is outstanding at a time (the limit window aged to allow it)', async () => {
    await inTx(async (client) => {
      const admin = await account(client);
      const first = await issued(client, admin);
      // Out of the 15-minute spacing but, as an operator might leave it, still unexpired and unused.
      await client.query(`update identity.recovery_tokens set issued_at = clock_timestamp() - interval '16 minutes', expires_at = clock_timestamp() + interval '5 minutes' where token_hash = $1`, [first]);
      const second = await issued(client, admin);
      expect(await tokenOf(client, first)).toMatchObject({used_at: null});
      expect((await tokenOf(client, first)).voided_at).not.toBeNull();
      expect(await tokenOf(client, second)).toMatchObject({used_at: null, voided_at: null});
      expect(await count(client, 'select count(*) as n from identity.recovery_tokens where used_at is null and voided_at is null and expires_at > clock_timestamp()')).toBe(1);
      // The voided one cannot be redeemed.
      expect((await check(client, first, admin.email)).outcome).toBe('voided');
      expect((await check(client, second, admin.email)).outcome).toBe('valid');
    });
  });

  it('leaves an expired token as it was when a new one is issued (there is nothing outstanding to void)', async () => {
    await inTx(async (client) => {
      const admin = await account(client);
      const first = await issued(client, admin);
      await placeAt(client, first, minutes(30));
      await issued(client, admin);
      expect(await tokenOf(client, first)).toMatchObject({used_at: null, voided_at: null});
    });
  });

  it('answers concurrent requests with exactly one token: four connections at once, one issued, the rest limited, one audit event each way', async () => {
    const admin = await committedAdministrator();
    const clients = await Promise.all(Array.from({length: 4}, () => connect()));
    const answers = await Promise.all(clients.map((client) => client.query('select outcome from api.issue_recovery($1, $2)', [codeHash(), admin.email])));
    const outcomes = answers.map((answer) => answer.rows[0].outcome as string).sort();
    expect(outcomes).toEqual(['issued', 'limited', 'limited', 'limited']);
    expect(await tokenCount(db)).toBe(1);
    expect(await auditOf(db, 'recovery.issued', `account:${admin.accountId}`)).toHaveLength(1);
    expect(await auditOf(db, 'recovery.limited', `account:${admin.accountId}`)).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
describe('issuing a token: who is eligible', () => {
  it.each(losses)('refuses when $name: refused, recovery.rejected.administrator audited, nothing inserted', async (loss) => {
    await inTx(async (client) => {
      await forgetUntargeted(client);
      const admin = await account(client);
      const override = await loss.apply(client, admin);
      const result = await issue(client, codeHash(), override?.email ?? admin.email);
      expect(result).toEqual({outcome: 'refused', expires_at: null});
      expect(await tokenCount(client)).toBe(0);
      expect(await untargeted(client, 'recovery.rejected.administrator')).toEqual([{actor: ACTOR, action: 'recovery.rejected.administrator', target: null}]);
      // Again: recorded once an hour.
      await issue(client, codeHash(), override?.email ?? admin.email);
      expect(await untargeted(client, 'recovery.rejected.administrator')).toHaveLength(1);
      expect(await tokenCount(client)).toBe(0);
    });
  });

  it('matches the address case-insensitively, whatever the case of either side, and ignores surrounding blanks', async () => {
    await inTx(async (client) => {
      const admin = await account(client);
      for (const spelling of [admin.email, admin.email.toUpperCase(), `  ${admin.email}  `, `  ${admin.email.replace(/^./, (letter) => letter.toUpperCase())} `]) {
        await client.query('delete from identity.recovery_tokens');
        expect((await issue(client, codeHash(), spelling)).outcome, JSON.stringify(spelling)).toBe('issued');
      }
      // The Auth user's address stored in capitals is the same person.
      await client.query(`update auth.users set email = upper(email) where id = $1`, [admin.user.id]);
      await client.query(`update auth.identities set identity_data = jsonb_set(identity_data, '{email}', to_jsonb(upper(identity_data ->> 'email'))) where user_id = $1`, [admin.user.id]);
      for (const spelling of [admin.email, admin.email.toUpperCase()]) {
        await client.query('delete from identity.recovery_tokens');
        expect((await issue(client, codeHash(), spelling)).outcome, spelling).toBe('issued');
      }
    });
  });

  it('serves the one Administrator and none of the other Accounts: a member with the same kind of address is refused, the Administrator is not', async () => {
    await inTx(async (client) => {
      const admin = await account(client);
      const member = await account(client, {role: 'member'});
      expect((await issue(client, codeHash(), member.email)).outcome).toBe('refused');
      expect(await tokenCount(client)).toBe(0);
      expect((await issue(client, codeHash(), admin.email)).outcome).toBe('issued');
      expect(await tokenOf(client, (await client.query('select token_hash from identity.recovery_tokens')).rows[0].token_hash)).toMatchObject({account_id: admin.accountId});
    });
  });

  it('accepts an address of 254 characters (and refuses one of 255 as an invalid argument)', async () => {
    await inTx(async (client) => {
      await forgetUntargeted(client);
      const long = `${'a'.repeat(254 - '@example.test'.length)}@example.test`;
      expect(long).toHaveLength(254);
      expect((await issue(client, codeHash(), long)).outcome).toBe('refused');
      const tooLong = await attempt(client, 'service_role', 'select * from api.issue_recovery($1, $2)', [codeHash(), `a${long}`]);
      expect(tooLong.ok).toBe(false);
      if (!tooLong.ok) expect(tooLong.code).toBe('22023');
    });
  });
});

// ---------------------------------------------------------------------------------------------------------------------
describe('invalid arguments are refused with 22023 by every function, and change nothing', () => {
  const badHashes: [string, string | null][] = [
    ['null', null],
    ['empty', ''],
    ['short', 'abc'],
    ['63 characters', 'a'.repeat(63)],
    ['65 characters', 'a'.repeat(65)],
    ['upper-case hex', 'A'.repeat(64)],
    ['not hex', 'g'.repeat(64)],
    ['a trailing newline', `${'a'.repeat(64)}\n`],
    ['a base64url token', newRecoveryToken()],
  ];
  const badAddresses: [string, string | null][] = [
    ['null', null],
    ['empty', ''],
    ['blanks', '   '],
    ['255 characters', `${'a'.repeat(242)}@example.test`],
  ];

  it('issue_recovery', async () => {
    await inTx(async (client) => {
      const admin = await account(client);
      const sql = 'select * from api.issue_recovery($1, $2)';
      const bad: [string, unknown[]][] = [
        ...badHashes.map(([name, value]) => [`hash ${name}`, [value, admin.email]] as [string, unknown[]]),
        ...badAddresses.map(([name, value]) => [`address ${name}`, [codeHash(), value]] as [string, unknown[]]),
      ];
      for (const [name, args] of bad) {
        const result = await attempt(client, 'service_role', sql, args);
        expect(result.ok, name).toBe(false);
        if (!result.ok) expect(result.code, name).toBe('22023');
      }
      expect(await tokenCount(client)).toBe(0);
    });
  });

  it('check_recovery', async () => {
    await inTx(async (client) => {
      const admin = await account(client);
      const sql = 'select * from api.check_recovery($1, $2)';
      const bad: [string, unknown[]][] = [
        ...badHashes.map(([name, value]) => [`hash ${name}`, [value, admin.email]] as [string, unknown[]]),
        ...badAddresses.map(([name, value]) => [`address ${name}`, [codeHash(), value]] as [string, unknown[]]),
      ];
      for (const [name, args] of bad) {
        const result = await attempt(client, 'service_role', sql, args);
        expect(result.ok, name).toBe(false);
        if (!result.ok) expect(result.code, name).toBe('22023');
      }
    });
  });

  it('void_recovery', async () => {
    await inTx(async (client) => {
      const sql = 'select * from api.void_recovery($1, $2)';
      const bad: [string, unknown[]][] = [...badHashes.map(([name, value]) => [`hash ${name}`, [value, true]] as [string, unknown[]]), ['definitive null', [codeHash(), null]]];
      for (const [name, args] of bad) {
        const result = await attempt(client, 'service_role', sql, args);
        expect(result.ok, name).toBe(false);
        if (!result.ok) expect(result.code, name).toBe('22023');
      }
    });
  });

  it('redeem_recovery', async () => {
    await inTx(async (client) => {
      const admin = await account(client);
      const hash = await issued(client, admin);
      const fresh = await addSession(client, admin.user.id);
      const sql = 'select * from api.redeem_recovery($1, $2, $3, $4)';
      const bad: [string, unknown[]][] = [
        ...badHashes.map(([name, value]) => [`hash ${name}`, [value, admin.email, admin.user.id, fresh]] as [string, unknown[]]),
        ...badAddresses.map(([name, value]) => [`address ${name}`, [hash, value, admin.user.id, fresh]] as [string, unknown[]]),
        ['user null', [hash, admin.email, null, fresh]],
        ['session null', [hash, admin.email, admin.user.id, null]],
      ];
      const before = await snapshot(client, admin);
      for (const [name, args] of bad) {
        const result = await attempt(client, 'service_role', sql, args);
        expect(result.ok, name).toBe(false);
        if (!result.ok) expect(result.code, name).toBe('22023');
      }
      expect(await snapshot(client, admin)).toEqual(before);
    });
  });
});

// ---------------------------------------------------------------------------------------------------------------------
describe('void_recovery: Cannot send', () => {
  it('a definitive refusal voids the outstanding token and audits recovery.mail_failed (against the Account, no more)', async () => {
    await inTx(async (client) => {
      const admin = await account(client);
      const hash = await issued(client, admin);
      expect(await voidToken(client, hash, true)).toEqual({outcome: 'voided'});
      const token = await tokenOf(client, hash);
      expect(token.voided_at).not.toBeNull();
      expect(token.used_at).toBeNull();
      expect(await auditOf(client, 'recovery.mail_failed', `account:${admin.accountId}`)).toEqual([{actor: ACTOR, action: 'recovery.mail_failed', target: `account:${admin.accountId}`}]);
      // Nothing usable remains.
      expect((await check(client, hash, admin.email)).outcome).toBe('voided');
      // The issuance still counts: the next request is limited.
      expect((await issue(client, codeHash(), admin.email)).outcome).toBe('limited');
    });
  });

  it('an outcome that is not known (not definitive) only audits it, and leaves the token as it was and redeemable', async () => {
    await inTx(async (client) => {
      const admin = await account(client);
      const hash = await issued(client, admin);
      const before = await tokenOf(client, hash);
      expect(await voidToken(client, hash, false)).toEqual({outcome: 'recorded'});
      expect(await tokenOf(client, hash)).toEqual(before);
      expect(await auditOf(client, 'recovery.mail_failed', `account:${admin.accountId}`)).toHaveLength(1);
      expect((await check(client, hash, admin.email)).outcome).toBe('valid');
    });
  });

  it('an unknown hash is not_found, and nothing is audited', async () => {
    await inTx(async (client) => {
      const audits = await count(client, `select count(*) as n from identity.audit_events where action = 'recovery.mail_failed'`);
      expect(await voidToken(client, codeHash(), true)).toEqual({outcome: 'not_found'});
      expect(await voidToken(client, codeHash(), false)).toEqual({outcome: 'not_found'});
      expect(await count(client, `select count(*) as n from identity.audit_events where action = 'recovery.mail_failed'`)).toBe(audits);
    });
  });

  it('a used token is not voided (recorded: the failure is audited, the token stays used)', async () => {
    await inTx(async (client) => {
      const admin = await account(client);
      const hash = await issued(client, admin);
      await client.query('update identity.recovery_tokens set used_at = clock_timestamp() where token_hash = $1', [hash]);
      const before = await tokenOf(client, hash);
      expect(await voidToken(client, hash, true)).toEqual({outcome: 'recorded'});
      expect(await tokenOf(client, hash)).toEqual(before);
      expect((await tokenOf(client, hash)).voided_at).toBeNull();
      expect(await auditOf(client, 'recovery.mail_failed', `account:${admin.accountId}`)).toHaveLength(1);
    });
  });

  it('an already voided token stays as it was (recorded)', async () => {
    await inTx(async (client) => {
      const admin = await account(client);
      const hash = await issued(client, admin);
      expect((await voidToken(client, hash, true)).outcome).toBe('voided');
      const before = await tokenOf(client, hash);
      expect(await voidToken(client, hash, true)).toEqual({outcome: 'recorded'});
      expect(await tokenOf(client, hash)).toEqual(before);
    });
  });
});

// ---------------------------------------------------------------------------------------------------------------------
describe('check_recovery: Scanner GET and Bad link, read-only as to the token', () => {
  it('is valid for an unused, unvoided, unexpired token: the Auth user\'s id and its own address, and it changes nothing', async () => {
    await inTx(async (client) => {
      const admin = await account(client);
      const hash = await issued(client, admin);
      // The Auth user's address is stored in capitals; the configured one is in any case: the answer is the Auth user's own, lower-cased.
      await client.query(`update auth.users set email = upper(email) where id = $1`, [admin.user.id]);
      await client.query(`update auth.identities set identity_data = jsonb_set(identity_data, '{email}', to_jsonb(upper(identity_data ->> 'email'))) where user_id = $1`, [admin.user.id]);
      const before = await snapshot(client, admin);
      for (const configured of [admin.email, admin.email.toUpperCase()]) {
        expect(await check(client, hash, configured)).toEqual({outcome: 'valid', user_id: admin.user.id, email: admin.email});
      }
      // Asked again and again (a mail scanner, two windows): nothing about the token, the Account or the audit trail moves.
      for (let index = 0; index < 3; index += 1) expect((await check(client, hash, admin.email)).outcome).toBe('valid');
      expect(await snapshot(client, admin)).toEqual(before);
    });
  });

  it('says unknown for a hash that was never issued, audited once an hour with no target', async () => {
    await inTx(async (client) => {
      await forgetUntargeted(client);
      const admin = await account(client);
      await issued(client, admin);
      const hash = codeHash();
      expect(await check(client, hash, admin.email)).toEqual({outcome: 'unknown', user_id: null, email: null});
      await check(client, hash, admin.email);
      await check(client, codeHash(), admin.email);
      expect(await untargeted(client, 'recovery.rejected.unknown')).toEqual([{actor: ACTOR, action: 'recovery.rejected.unknown', target: null}]);
    });
  });

  it.each([
    {
      reason: 'used',
      change: (client: Client, hash: string) => client.query('update identity.recovery_tokens set used_at = clock_timestamp() where token_hash = $1', [hash]),
    },
    {
      reason: 'voided',
      change: (client: Client, hash: string) => client.query('update identity.recovery_tokens set voided_at = clock_timestamp() where token_hash = $1', [hash]),
    },
    {reason: 'expired', change: (client: Client, hash: string) => placeAt(client, hash, minutes(20))},
  ])('says $reason for a $reason token, audited once an hour against the Account with nothing of the token or the address in it', async ({reason, change}) => {
    await inTx(async (client) => {
      const admin = await account(client);
      const hash = await issued(client, admin);
      await change(client, hash);
      const before = await tokenOf(client, hash);
      expect(await check(client, hash, admin.email)).toEqual({outcome: reason, user_id: null, email: null});
      await check(client, hash, admin.email);
      await check(client, hash, admin.email.toUpperCase());
      expect(await tokenOf(client, hash)).toEqual(before);
      const events = await auditOf(client, `recovery.rejected.${reason}`, `account:${admin.accountId}`);
      expect(events).toEqual([{actor: ACTOR, action: `recovery.rejected.${reason}`, target: `account:${admin.accountId}`}]);
      expect(JSON.stringify(events)).not.toContain(hash);
      expect(JSON.stringify(events)).not.toContain(admin.email);
    });
  });

  it('judges expiry at the moment of the call: a token with a second left is valid, one that ran out a second ago is expired', async () => {
    await inTx(async (client) => {
      const admin = await account(client);
      const hash = await issued(client, admin);
      await client.query(`update identity.recovery_tokens set issued_at = clock_timestamp() - interval '14 minutes 58 seconds', expires_at = clock_timestamp() + interval '2 seconds' where token_hash = $1`, [hash]);
      expect((await check(client, hash, admin.email)).outcome).toBe('valid');
      await client.query(`update identity.recovery_tokens set issued_at = clock_timestamp() - interval '15 minutes 1 second', expires_at = clock_timestamp() - interval '1 second' where token_hash = $1`, [hash]);
      expect((await check(client, hash, admin.email)).outcome).toBe('expired');
    });
  });

  it('puts used before expired, and voided before expired', async () => {
    await inTx(async (client) => {
      const admin = await account(client);
      const used = await issued(client, admin);
      await placeAt(client, used, minutes(30));
      await client.query('update identity.recovery_tokens set used_at = clock_timestamp() where token_hash = $1', [used]);
      expect((await check(client, used, admin.email)).outcome).toBe('used');
      const voided = await issued(client, admin);
      await placeAt(client, voided, minutes(40));
      await client.query('update identity.recovery_tokens set voided_at = clock_timestamp() where token_hash = $1', [voided]);
      expect((await check(client, voided, admin.email)).outcome).toBe('voided');
    });
  });

  it.each(losses)('says administrator when $name after the token was issued, audited against the Account', async (loss) => {
    await inTx(async (client) => {
      const admin = await account(client);
      const hash = await issued(client, admin);
      const override = await loss.apply(client, admin);
      const before = await tokenOf(client, hash);
      expect(await check(client, hash, override?.email ?? admin.email)).toEqual({outcome: 'administrator', user_id: null, email: null});
      expect(await tokenOf(client, hash)).toEqual(before);
      expect(await auditOf(client, 'recovery.rejected.administrator', `account:${admin.accountId}`)).toEqual([
        {actor: ACTOR, action: 'recovery.rejected.administrator', target: `account:${admin.accountId}`},
      ]);
    });
  });
});

// ---------------------------------------------------------------------------------------------------------------------
describe('redeem_recovery: the transaction (Redeem, the marker)', () => {
  /** An Administrator with three signed-in sessions, one more Auth session with no grant, the inert session the Admin API just minted, and another person. */
  async function ready(client: Client) {
    const admin = await account(client, {role: 'administrator', sessions: 3});
    const hash = await issued(client, admin);
    const grantless = await addSession(client, admin.user.id);
    const fresh = await addSession(client, admin.user.id);
    const other = await account(client, {role: 'member', sessions: 1});
    return {admin, hash, grantless, fresh, other};
  }

  it('does everything in one go: token used, epoch raised, every grant revoked as recovery, the other sessions deleted, the new session granted and marked, audited', async () => {
    await inTx(async (client) => {
      const {admin, hash, grantless, fresh, other} = await ready(client);
      const otherBefore = (await snapshot(client, other)).state;
      const before = Date.now();
      const result = await redeem(client, hash, admin.email, admin.user.id, fresh);
      // Three granted sessions and one without a grant are the other sessions; the epoch went from 1 to 2.
      expect(result).toEqual({outcome: 'redeemed', sessions_ended: 4, epoch: 2});

      // The token is used, not voided, and used now.
      const token = await tokenOf(client, hash);
      expect(token.used_at).not.toBeNull();
      expect(token.voided_at).toBeNull();
      expect(Math.abs(token.used_at.getTime() - before)).toBeLessThan(10_000);
      expect(token.used_at.getTime()).toBeLessThan(token.expires_at.getTime());

      // The epoch was raised by one.
      expect(await epochOf(client, admin.accountId)).toBe(2);

      // Every grant the Account held is revoked, for recovery, by the person; the new session holds the only live one, at the new epoch.
      const grants = await grantRowsOf(client, admin.accountId);
      expect(grants).toHaveLength(4);
      const old = grants.filter((grant) => admin.sessions.includes(grant.session_id));
      expect(old).toHaveLength(3);
      for (const grant of old) {
        expect(grant, grant.session_id).toMatchObject({epoch: 1, revoked_by: `user:${admin.user.id}`, revoked_reason: 'recovery'});
        expect(grant.revoked_at).not.toBeNull();
      }
      expect(grants.filter((grant) => grant.session_id === fresh)).toEqual([{session_id: fresh, epoch: 2, revoked_at: null, revoked_by: null, revoked_reason: null}]);

      // Every other Auth session of the person is gone, and only theirs.
      expect(await authSessionsOf(client, admin.user.id)).toEqual([fresh]);
      for (const gone of [...admin.sessions, grantless]) expect(await count(client, 'select count(*) as n from auth.sessions where id = $1', [gone])).toBe(0);

      // The marker: this session only, class administration, five minutes, source recovery, no nonce.
      const markers = (await client.query('select m.*, extract(epoch from m.expires_at - m.issued_at)::int as life from identity.fresh_authentications m where m.account_id = $1', [admin.accountId])).rows;
      expect(markers).toHaveLength(1);
      expect(markers[0]).toMatchObject({session_id: fresh, action_class: 'administration', account_id: admin.accountId, nonce_id: null, source: 'recovery', consumed_at: null, life: 300});
      expect(Math.abs(markers[0].issued_at.getTime() - before)).toBeLessThan(10_000);

      // Audited: the recovery, by the person, against the Account; and the epoch, the revocations and the grant under the same actor.
      expect(await auditOf(client, 'recovery.redeemed', `account:${admin.accountId}`)).toEqual([{actor: `user:${admin.user.id}`, action: 'recovery.redeemed', target: `account:${admin.accountId}`}]);
      expect(await auditOf(client, 'account.epoch_raised', `account:${admin.accountId}`)).toEqual([{actor: `user:${admin.user.id}`, action: 'account.epoch_raised', target: `account:${admin.accountId}`}]);
      for (const session of admin.sessions) {
        expect(await auditOf(client, 'session.revoked', `session:${session}`)).toEqual([{actor: `user:${admin.user.id}`, action: 'session.revoked', target: `session:${session}`}]);
      }
      expect(await auditOf(client, 'session.issued', `session:${fresh}`)).toHaveLength(1);

      // Another person is untouched.
      expect((await snapshot(client, other)).state).toEqual(otherBefore);
    });
  });

  it('gives the new session the administration marker and nothing else: the other classes, every other session and every other person get none', async () => {
    await inTx(async (client) => {
      const svc = api(client);
      const {admin, hash, fresh, other} = await ready(client);
      expect((await redeem(client, hash, admin.email, admin.user.id, fresh)).outcome).toBe('redeemed');
      // Administration: allowed, again and again (it is reusable for its five minutes), and not consumed.
      expect(await svc.useMarker(admin.user.id, fresh, 'administration')).toEqual({outcome: 'allowed'});
      expect(await svc.useMarker(admin.user.id, fresh, 'administration')).toEqual({outcome: 'allowed'});
      expect((await markerRowsOf(client, admin.accountId))[0].consumed_at).toBeNull();
      // The other classes: none, whether reusable or consumed by use.
      expect(await svc.useMarker(admin.user.id, fresh, 'owner_deletion')).toEqual({outcome: 'none'});
      expect(await svc.useMarker(admin.user.id, fresh, 'account_deletion', new Date(0))).toEqual({outcome: 'none'});
      expect(await svc.useMarker(admin.user.id, fresh, 'close_instance', new Date(0))).toEqual({outcome: 'none'});
      // Another session of the Administrator, with a perfectly valid grant, has no marker.
      const later = await addSession(client, admin.user.id);
      expect((await svc.issueGrant(admin.user.id, later)).outcome).toBe('issued');
      expect(await svc.useMarker(admin.user.id, later, 'administration')).toEqual({outcome: 'none'});
      // The sessions that were ended are denied outright, another person's session has no marker of its own, and nobody else can use this session's.
      expect(await svc.useMarker(admin.user.id, admin.sessions[0], 'administration')).toEqual({outcome: 'denied'});
      expect(await svc.useMarker(other.user.id, other.sessions[0], 'administration')).toEqual({outcome: 'none'});
      expect(await svc.useMarker(other.user.id, fresh, 'administration')).toEqual({outcome: 'denied'});
    });
  });

  it('keeps the marker for five minutes and no longer', async () => {
    await inTx(async (client) => {
      const svc = api(client);
      const {admin, hash, fresh} = await ready(client);
      await redeem(client, hash, admin.email, admin.user.id, fresh);
      await client.query(`update identity.fresh_authentications set issued_at = clock_timestamp() - interval '4 minutes 59 seconds', expires_at = clock_timestamp() + interval '1 second' where session_id = $1`, [fresh]);
      expect(await svc.useMarker(admin.user.id, fresh, 'administration')).toEqual({outcome: 'allowed'});
      await client.query(`update identity.fresh_authentications set issued_at = clock_timestamp() - interval '5 minutes 1 second', expires_at = clock_timestamp() - interval '1 second' where session_id = $1`, [fresh]);
      expect(await svc.useMarker(admin.user.id, fresh, 'administration')).toEqual({outcome: 'expired'});
    });
  });

  it('authorizes the new session at the new epoch, and no session that was ended', async () => {
    await inTx(async (client) => {
      const svc = api(client);
      const {admin, hash, grantless, fresh} = await ready(client);
      expect(await svc.authorize(admin.user.id, fresh)).toMatchObject({state: 'no_grant'});
      expect((await redeem(client, hash, admin.email, admin.user.id, fresh)).outcome).toBe('redeemed');
      expect(await svc.authorize(admin.user.id, fresh)).toMatchObject({state: 'active', account_id: admin.accountId, role: 'administrator', epoch: 2});
      for (const old of [...admin.sessions, grantless]) expect((await svc.authorize(admin.user.id, old)).state, old).toBe('no_session');
    });
  });

  it('works for an Administrator that has no other session at all (nothing to end)', async () => {
    await inTx(async (client) => {
      const admin = await account(client, {sessions: 0});
      const hash = await issued(client, admin);
      const fresh = await addSession(client, admin.user.id);
      expect(await redeem(client, hash, admin.email, admin.user.id, fresh)).toEqual({outcome: 'redeemed', sessions_ended: 0, epoch: 2});
      expect(await stateOf(client, admin, fresh)).toBe('active');
    });
  });

  it('leaves the audit trail free of the token, its hash and every address', async () => {
    await inTx(async (client) => {
      const {admin, hash, fresh} = await ready(client);
      await redeem(client, hash, admin.email, admin.user.id, fresh);
      const {rows: events} = await client.query(
        `select actor, action, coalesce(target, '') as target from identity.audit_events
          where actor = $1 or target = $2 or target in (select 'session:' || g.session_id::text from identity.session_grants g where g.account_id = $3)`,
        [`user:${admin.user.id}`, `account:${admin.accountId}`, admin.accountId],
      );
      expect(events.length).toBeGreaterThanOrEqual(6);
      const text = JSON.stringify(events);
      for (const value of [hash, admin.email, admin.email.split('@')[0]]) expect(text).not.toContain(value);
    });
  });

  describe('a replay and a refusal change nothing', () => {
    it('a used token is refused as used: the second session gets no grant and no marker (the caller ends it), and the first recovery stands', async () => {
      await inTx(async (client) => {
        const {admin, hash, fresh} = await ready(client);
        expect((await redeem(client, hash, admin.email, admin.user.id, fresh)).outcome).toBe('redeemed');
        const second = await addSession(client, admin.user.id);
        const before = await snapshot(client, admin);
        expect(await redeem(client, hash, admin.email, admin.user.id, second)).toEqual({outcome: 'used', sessions_ended: null, epoch: null});
        expect(await redeem(client, hash, admin.email, admin.user.id, second)).toEqual({outcome: 'used', sessions_ended: null, epoch: null});
        const after = await snapshot(client, admin);
        expect(after.state).toEqual(before.state);
        expect(after.tokens).toEqual(before.tokens);
        expect(after.audit.slice(0, before.audit.length)).toEqual(before.audit);
        // The one new event is the refusal, once an hour, by the person against the Account.
        expect(after.audit.slice(before.audit.length)).toEqual([{actor: `user:${admin.user.id}`, action: 'recovery.rejected.used', target: `account:${admin.accountId}`}]);
        // The first session is still the one live session, the second is only an inert Auth session.
        expect(await epochOf(client, admin.accountId)).toBe(2);
        expect(await authSessionsOf(client, admin.user.id)).toEqual([fresh, second].sort());
        expect(await stateOf(client, admin, fresh)).toBe('active');
        expect(await stateOf(client, admin, second)).toBe('no_grant');
        expect(await markerRowsOf(client, admin.accountId)).toHaveLength(1);
        expect(await auditOf(client, 'recovery.redeemed', `account:${admin.accountId}`)).toHaveLength(1);
      });
    });

    const refusals = [
      {
        reason: 'unknown',
        prepare: async (client: Client, ctx: {hash: string}) => {
          ctx.hash = codeHash();
        },
      },
      {
        reason: 'used',
        prepare: async (client: Client, ctx: {hash: string}) => {
          await client.query('update identity.recovery_tokens set used_at = clock_timestamp() where token_hash = $1', [ctx.hash]);
        },
      },
      {
        reason: 'voided',
        prepare: async (client: Client, ctx: {hash: string}) => {
          await client.query('update identity.recovery_tokens set voided_at = clock_timestamp() where token_hash = $1', [ctx.hash]);
        },
      },
      {
        reason: 'expired',
        prepare: async (client: Client, ctx: {hash: string}) => {
          await placeAt(client, ctx.hash, minutes(20));
        },
      },
    ];

    it.each(refusals)('a $reason token is refused as $reason: nothing is changed, the refusal is audited once an hour by the person', async ({reason, prepare}) => {
      await inTx(async (client) => {
        const {admin, hash, grantless, fresh} = await ready(client);
        const ctx = {hash};
        await prepare(client, ctx);
        const before = await snapshot(client, admin);
        expect(await redeem(client, ctx.hash, admin.email, admin.user.id, fresh)).toEqual({outcome: reason, sessions_ended: null, epoch: null});
        await redeem(client, ctx.hash, admin.email, admin.user.id, fresh);
        const after = await snapshot(client, admin);
        expect(after.state).toEqual(before.state);
        expect(after.tokens).toEqual(before.tokens);
        expect(after.state.sessions).toEqual([...admin.sessions, grantless, fresh].sort());
        expect(after.state.markers).toEqual([]);
        expect(after.audit).toEqual(before.audit.concat(reason === 'unknown' ? [] : [{actor: `user:${admin.user.id}`, action: `recovery.rejected.${reason}`, target: `account:${admin.accountId}`}]));
        if (reason === 'unknown') {
          // An unknown token names no Account, so its refusal names none either; the actor is the person, so it is theirs alone.
          expect(await untargeted(client, 'recovery.rejected.unknown', `user:${admin.user.id}`)).toHaveLength(1);
        }
        expect(await auditOf(client, 'recovery.redeemed', `account:${admin.accountId}`)).toEqual([]);
      });
    });

    it.each(losses)('is refused as administrator, and nothing changes, when $name after the token was issued', async (loss) => {
      await inTx(async (client) => {
        const {admin, hash, grantless, fresh} = await ready(client);
        const override = await loss.apply(client, admin);
        const before = await snapshot(client, admin);
        expect(await redeem(client, hash, override?.email ?? admin.email, admin.user.id, fresh)).toEqual({outcome: 'administrator', sessions_ended: null, epoch: null});
        const after = await snapshot(client, admin);
        expect(after.state).toEqual(before.state);
        expect(after.tokens).toEqual(before.tokens);
        expect(after.state.sessions).toEqual([...admin.sessions, grantless, fresh].sort());
        expect(after.audit.slice(before.audit.length)).toEqual([{actor: `user:${admin.user.id}`, action: 'recovery.rejected.administrator', target: `account:${admin.accountId}`}]);
        expect(await auditOf(client, 'recovery.redeemed', `account:${admin.accountId}`)).toEqual([]);
      });
    });

    it('a user that is not the Account\'s user is refused as administrator, and the stranger\'s own session is not granted, marked or ended', async () => {
      await inTx(async (client) => {
        const {admin, hash, grantless, fresh, other} = await ready(client);
        const strangerSession = await addSession(client, other.user.id);
        const before = await snapshot(client, admin);
        const otherBefore = await snapshot(client, other);
        expect(await redeem(client, hash, admin.email, other.user.id, strangerSession)).toEqual({outcome: 'administrator', sessions_ended: null, epoch: null});
        const after = await snapshot(client, admin);
        expect(after.state).toEqual(before.state);
        expect(after.state.sessions).toEqual([...admin.sessions, grantless, fresh].sort());
        // The stranger's own state is unchanged (the refusal is theirs: the actor is the user that asked).
        const otherAfter = await snapshot(client, other);
        expect(otherAfter.state).toEqual(otherBefore.state);
        expect(otherAfter.state.sessions).toContain(strangerSession);
        expect(await auditOf(client, 'recovery.rejected.administrator', `account:${admin.accountId}`)).toEqual([
          {actor: `user:${other.user.id}`, action: 'recovery.rejected.administrator', target: `account:${admin.accountId}`},
        ]);
        // The token is still redeemable by the right person.
        expect((await redeem(client, hash, admin.email, admin.user.id, fresh)).outcome).toBe('redeemed');
      });
    });
  });

  describe('ROLLBACK: a session that cannot be granted undoes the whole redemption', () => {
    /** Everything as it was, and only the refusal itself recorded. */
    async function expectUndone(client: Client, admin: Admin, before: Awaited<ReturnType<typeof snapshot>>, hash: string) {
      const after = await snapshot(client, admin);
      expect(after.state).toEqual(before.state);
      expect(after.tokens).toEqual(before.tokens);
      expect((await tokenOf(client, hash)).used_at, 'the token is still unused').toBeNull();
      expect(await epochOf(client, admin.accountId), 'the epoch is unchanged').toBe(1);
      for (const session of admin.sessions) expect((await grantRowsOf(client, admin.accountId)).find((grant) => grant.session_id === session), 'an old grant is not revoked').toMatchObject({revoked_at: null, revoked_by: null, revoked_reason: null});
      expect(await markerRowsOf(client, admin.accountId), 'no marker').toEqual([]);
      expect(await auditOf(client, 'recovery.redeemed', `account:${admin.accountId}`)).toEqual([]);
      // The audit events of the steps that were undone are undone with them; the refusal stays.
      expect(after.audit.slice(0, before.audit.length)).toEqual(before.audit);
      expect(after.audit.slice(before.audit.length)).toEqual([{actor: `user:${admin.user.id}`, action: 'recovery.rejected.administrator', target: `account:${admin.accountId}`}]);
      expect(await stateOf(client, admin, admin.sessions[0])).toBe('active');
    }

    it('an Auth session that does not exist: refused as administrator, and everything stays as it was, the deleted sessions included', async () => {
      await inTx(async (client) => {
        const {admin, hash, grantless, fresh} = await ready(client);
        const before = await snapshot(client, admin);
        expect(await redeem(client, hash, admin.email, admin.user.id, randomUUID())).toEqual({outcome: 'administrator', sessions_ended: null, epoch: null});
        await expectUndone(client, admin, before, hash);
        // Every Auth session of the person is still there: the deletion that preceded the failed grant was undone.
        expect(await authSessionsOf(client, admin.user.id)).toEqual([...admin.sessions, grantless, fresh].sort());
        // And the token still redeems.
        expect((await redeem(client, hash, admin.email, admin.user.id, fresh)).outcome).toBe('redeemed');
      });
    });

    it('an Auth session that is another user\'s: refused as administrator, undone, and that user\'s session is not touched', async () => {
      await inTx(async (client) => {
        const {admin, hash, other} = await ready(client);
        const before = await snapshot(client, admin);
        const otherBefore = await snapshot(client, other);
        expect(await redeem(client, hash, admin.email, admin.user.id, other.sessions[0])).toEqual({outcome: 'administrator', sessions_ended: null, epoch: null});
        await expectUndone(client, admin, before, hash);
        expect((await snapshot(client, other)).state).toEqual(otherBefore.state);
      });
    });

    it('a session whose grant is already revoked cannot be granted again: refused as administrator, undone', async () => {
      await inTx(async (client) => {
        const {admin, hash, fresh} = await ready(client);
        await client.query('insert into identity.session_grants (session_id, account_id, epoch) values ($1, $2, 1)', [fresh, admin.accountId]);
        await client.query(`update identity.session_grants set revoked_at = clock_timestamp(), revoked_by = 'system:test', revoked_reason = 'test' where session_id = $1`, [fresh]);
        const before = await snapshot(client, admin);
        expect(await redeem(client, hash, admin.email, admin.user.id, fresh)).toEqual({outcome: 'administrator', sessions_ended: null, epoch: null});
        const after = await snapshot(client, admin);
        expect(after.state).toEqual(before.state);
        expect(await epochOf(client, admin.accountId)).toBe(1);
        expect((await tokenOf(client, hash)).used_at).toBeNull();
        expect(await markerRowsOf(client, admin.accountId)).toEqual([]);
        expect(await authSessionsOf(client, admin.user.id)).toContain(admin.sessions[0]);
        expect(await stateOf(client, admin, admin.sessions[0])).toBe('active');
      });
    });
  });
});

// ---------------------------------------------------------------------------------------------------------------------
describe('Two windows: the same link at once (real connections, committed data)', () => {
  const redeemSql = 'select outcome, sessions_ended, epoch::int as epoch from api.redeem_recovery($1, $2, $3, $4)';

  /** An Administrator with two sessions, a token, and the inert sessions the Admin API minted for each window. */
  async function windows(count_: number) {
    const admin = await committedAdministrator({sessions: 2});
    const hash = codeHash();
    expect((await db.query('select outcome from api.issue_recovery($1, $2)', [hash, admin.email])).rows[0].outcome).toBe('issued');
    const fresh: string[] = [];
    for (let index = 0; index < count_; index += 1) fresh.push(await addSession(db, admin.user.id));
    return {admin, hash, fresh};
  }

  async function expectOneRecovery(admin: Admin, hash: string, winner: string, losers: string[]) {
    expect((await tokenOf(db, hash)).used_at).not.toBeNull();
    expect(await epochOf(db, admin.accountId)).toBe(2);
    // Exactly one grant and one marker survive: the winner's.
    expect((await grantRowsOf(db, admin.accountId)).filter((grant) => grant.revoked_at === null)).toEqual([{session_id: winner, epoch: 2, revoked_at: null, revoked_by: null, revoked_reason: null}]);
    expect((await markerRowsOf(db, admin.accountId)).map((marker) => ({session_id: marker.session_id, source: marker.source, nonce_id: marker.nonce_id}))).toEqual([{session_id: winner, source: 'recovery', nonce_id: null}]);
    expect(await auditOf(db, 'recovery.redeemed', `account:${admin.accountId}`)).toHaveLength(1);
    // The losers were Auth sessions of the person, committed before the race, so the winner's transaction deleted them with the
    // rest; none holds a grant or a marker. (The caller ends its own session, which is then already gone.)
    expect(await authSessionsOf(db, admin.user.id)).toEqual([winner]);
    for (const loser of losers) {
      expect(await count(db, 'select count(*) as n from identity.session_grants where session_id = $1', [loser])).toBe(0);
      expect(await count(db, 'select count(*) as n from identity.fresh_authentications where session_id = $1', [loser])).toBe(0);
    }
  }

  it('three windows at the same moment: exactly one recovers, the others find the link used, one grant and one marker survive', async () => {
    const {admin, hash, fresh} = await windows(3);
    const clients = await Promise.all(fresh.map(() => connect()));
    const answers = await Promise.all(clients.map((client, index) => client.query(redeemSql, [hash, admin.email, admin.user.id, fresh[index]])));
    const outcomes = answers.map((answer) => answer.rows[0] as {outcome: string; sessions_ended: number | null; epoch: number | null});
    expect(outcomes.map((row) => row.outcome).sort()).toEqual(['redeemed', 'used', 'used']);
    const winnerIndex = outcomes.findIndex((row) => row.outcome === 'redeemed');
    expect(outcomes[winnerIndex]).toEqual({outcome: 'redeemed', sessions_ended: 4, epoch: 2});
    for (const row of outcomes.filter((entry) => entry.outcome === 'used')) expect(row).toEqual({outcome: 'used', sessions_ended: null, epoch: null});
    await expectOneRecovery(admin, hash, fresh[winnerIndex], fresh.filter((_, index) => index !== winnerIndex));
    // The losers' refusals are recorded once an hour (the same actor, action and target).
    expect(await auditOf(db, 'recovery.rejected.used', `account:${admin.accountId}`)).toEqual([{actor: `user:${admin.user.id}`, action: 'recovery.rejected.used', target: `account:${admin.accountId}`}]);
  });

  it('a window that waits for the other\'s transaction reads what it left: the first commits, the second is refused as used and ends only its own session', async () => {
    const {admin, hash, fresh} = await windows(2);
    const winner = await connect();
    const loser = await connect();
    try {
      await winner.query('begin');
      expect((await winner.query(redeemSql, [hash, admin.email, admin.user.id, fresh[0]])).rows[0].outcome).toBe('redeemed');
      const pid = (await loser.query('select pg_backend_pid() as pid')).rows[0].pid as number;
      const pending = loser.query(redeemSql, [hash, admin.email, admin.user.id, fresh[1]]);
      // The second window really is queued on the Account lock the first holds.
      await untilBlocked(pid);
      await winner.query('commit');
      expect((await pending).rows[0]).toEqual({outcome: 'used', sessions_ended: null, epoch: null});
    } finally {
      await winner.query('rollback').catch(() => undefined);
    }
    await expectOneRecovery(admin, hash, fresh[0], [fresh[1]]);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
describe('the marker table: a nullable nonce and a source', () => {
  /** A member's Account and what a marker row needs. */
  async function markerFixture(client: Client) {
    const member = await account(client, {role: 'member', sessions: 1});
    const nonce = async () =>
      (
        await client.query(
          // Ended (voided) nonces, so any number may exist for one Account (only one may be open).
          `insert into identity.step_up_nonces (account_id, session_id, action_class, secret_hash, verifier_hash, email_hash, expires_at, status, ended_at)
           values ($1, $2, 'administration', $3, $4, $5, clock_timestamp() + interval '10 minutes', 'voided', clock_timestamp()) returning id`,
          [member.accountId, member.sessions[0], codeHash(), randomBytes(32).toString('base64url'), codeHash()],
        )
      ).rows[0].id as string;
    const insert = (options: {session?: string; actionClass?: string; nonce?: string | null; source?: string | null}) =>
      attempt(
        client,
        null,
        options.source === null
          ? `insert into identity.fresh_authentications (session_id, action_class, account_id, nonce_id, step_up_started_at, expires_at) values ($1, $2, $3, $4, clock_timestamp(), clock_timestamp() + interval '5 minutes') returning *`
          : `insert into identity.fresh_authentications (session_id, action_class, account_id, nonce_id, step_up_started_at, expires_at, source) values ($1, $2, $3, $4, clock_timestamp(), clock_timestamp() + interval '5 minutes', $5) returning *`,
        options.source === null
          ? [options.session ?? randomUUID(), options.actionClass ?? 'administration', member.accountId, options.nonce ?? null]
          : [options.session ?? randomUUID(), options.actionClass ?? 'administration', member.accountId, options.nonce ?? null, options.source ?? 'recovery'],
      );
    return {member, nonce, insert};
  }

  it('a recovery marker has source recovery and no nonce (the one a redemption writes)', async () => {
    await inTx(async (client) => {
      const {insert} = await markerFixture(client);
      const written = await insert({source: 'recovery', nonce: null});
      expect(written.ok).toBe(true);
      if (written.ok) expect(written.rows[0]).toMatchObject({source: 'recovery', nonce_id: null});
    });
  });

  it('a step-up marker still needs its nonce, and a recovery marker may not have one (the check constraint)', async () => {
    await inTx(async (client) => {
      const {insert, nonce} = await markerFixture(client);
      for (const [name, options] of [
        ['a step_up marker with no nonce', {source: 'step_up', nonce: null}],
        ['a marker with no source (the default is step_up) and no nonce', {source: null, nonce: null}],
        ['a recovery marker with a nonce', {source: 'recovery', nonce: await nonce()}],
        ['a source that is neither', {source: 'magic', nonce: null}],
      ] as const) {
        const result = await insert(options);
        expect(result.ok, name).toBe(false);
        if (!result.ok) expect(result.code, name).toBe('23514');
      }
      // The step-up marker as it always was, with the default source.
      const written = await insert({source: null, nonce: await nonce()});
      expect(written.ok).toBe(true);
      if (written.ok) expect(written.rows[0]).toMatchObject({source: 'step_up'});
      expect(written.ok && written.rows[0].nonce_id).not.toBeNull();
    });
  });

  it('many recovery markers may exist: the nonce is unique, and NULLs do not collide', async () => {
    await inTx(async (client) => {
      const {insert} = await markerFixture(client);
      expect((await insert({source: 'recovery', nonce: null})).ok).toBe(true);
      expect((await insert({source: 'recovery', nonce: null})).ok).toBe(true);
      expect((await insert({source: 'recovery', nonce: null, actionClass: 'owner_deletion'})).ok).toBe(true);
    });
  });

  it('the guard still refuses changing the session, class, Account, nonce, step-up start or source, and a NULL nonce cannot gain a value (or a value lose it)', async () => {
    await inTx(async (client) => {
      const {insert, nonce} = await markerFixture(client);
      const recovery = await insert({source: 'recovery', nonce: null});
      const stepUp = await insert({source: 'step_up', nonce: await nonce()});
      expect(recovery.ok && stepUp.ok).toBe(true);
      if (!recovery.ok || !stepUp.ok) return;
      const target = (row: Record<string, any>) => ({session: row.session_id as string, class: row.action_class as string});
      const cases: [string, Record<string, any>, string, unknown][] = [
        ['session_id', recovery.rows[0], 'session_id', randomUUID()],
        ['action_class', recovery.rows[0], 'action_class', 'close_instance'],
        ['account_id', recovery.rows[0], 'account_id', randomUUID()],
        ['step_up_started_at', recovery.rows[0], 'step_up_started_at', new Date(Date.now() - 60_000)],
        ['source (recovery to step_up)', recovery.rows[0], 'source', 'step_up'],
        ['nonce_id: NULL to a value', recovery.rows[0], 'nonce_id', await nonce()],
        ['nonce_id: a value to another value', stepUp.rows[0], 'nonce_id', await nonce()],
        ['nonce_id: a value to NULL', stepUp.rows[0], 'nonce_id', null],
        ['source (step_up to recovery)', stepUp.rows[0], 'source', 'recovery'],
      ];
      for (const [name, row, column, value] of cases) {
        const result = await attempt(client, null, `update identity.fresh_authentications set ${column} = $3 where session_id = $1 and action_class = $2`, [target(row).session, target(row).class, value]);
        expect(result.ok, name).toBe(false);
        if (!result.ok) expect(result.code, name).toBe('55000');
      }
      // What it always allowed: consumption once, and nothing more.
      const consume = await attempt(client, null, 'update identity.fresh_authentications set consumed_at = clock_timestamp() where session_id = $1 and action_class = $2', [target(stepUp.rows[0]).session, target(stepUp.rows[0]).class]);
      expect(consume.ok).toBe(true);
      const unconsume = await attempt(client, null, 'update identity.fresh_authentications set consumed_at = null where session_id = $1 and action_class = $2', [target(stepUp.rows[0]).session, target(stepUp.rows[0]).class]);
      expect(unconsume.ok).toBe(false);
      if (!unconsume.ok) expect(unconsume.code).toBe('55000');
    });
  });

  it('a completed step-up still writes a source step_up marker that names its nonce (the existing behaviour is unchanged)', async () => {
    await inTx(async (client) => {
      const svc = api(client);
      const member = await account(client, {role: 'member', sessions: 1});
      const secret = codeHash();
      const verifier = randomBytes(32).toString('base64url');
      expect((await svc.startStepUp(member.user.id, member.sessions[0], 'owner_deletion', secret, verifier)).outcome).toBe('started');
      const fresh = await addSession(client, member.user.id);
      await insertAmrClaim(client, fresh);
      expect((await svc.completeStepUp(member.user.id, fresh, secret, verifier)).outcome).toBe('accepted');
      const markers = await markerRowsOf(client, member.accountId);
      expect(markers).toHaveLength(1);
      expect(markers[0]).toMatchObject({session_id: fresh, action_class: 'owner_deletion', source: 'step_up'});
      expect(markers[0].nonce_id).toBe((await client.query('select id from identity.step_up_nonces where secret_hash = $1', [secret])).rows[0].id);
      expect(await svc.useMarker(member.user.id, fresh, 'owner_deletion')).toEqual({outcome: 'allowed'});
    });
  });
});

// ---------------------------------------------------------------------------------------------------------------------
describe('identity.recovery_tokens: what the table refuses, whoever writes', () => {
  async function tokenFixture(client: Client) {
    const admin = await account(client);
    const hash = await issued(client, admin);
    return {admin, hash};
  }
  const update = (client: Client, hash: string, set: string, params: unknown[] = []) => attempt(client, null, `update identity.recovery_tokens set ${set} where token_hash = $1`, [hash, ...params]);

  it('a token cannot change what it is: id, Account and hash are immutable (55000)', async () => {
    await inTx(async (client) => {
      const {hash} = await tokenFixture(client);
      for (const [column, value] of [
        ['id', randomUUID()],
        ['account_id', randomUUID()],
        ['token_hash', codeHash()],
      ] as const) {
        const result = await update(client, hash, `${column} = $2`, [value]);
        expect(result.ok, column).toBe(false);
        if (!result.ok) expect(result.code, column).toBe('55000');
      }
    });
  });

  it('the two times of its life stay writable (a test or an operator ages a token), and a used token may still be aged', async () => {
    await inTx(async (client) => {
      const {hash} = await tokenFixture(client);
      expect((await update(client, hash, `issued_at = issued_at - interval '1 hour', expires_at = expires_at - interval '1 hour'`)).ok).toBe(true);
      await client.query('update identity.recovery_tokens set used_at = clock_timestamp() where token_hash = $1', [hash]);
      expect((await update(client, hash, `issued_at = issued_at - interval '1 hour', expires_at = expires_at - interval '1 hour'`)).ok).toBe(true);
      const backwards = await update(client, hash, `expires_at = issued_at`);
      expect(backwards.ok).toBe(false);
      if (!backwards.ok) expect(backwards.code).toBe('23514');
    });
  });

  it('a used or voided token is final: neither time can be cleared, moved or swapped (55000)', async () => {
    await inTx(async (client) => {
      const used = await tokenFixture(client);
      await client.query('update identity.recovery_tokens set used_at = clock_timestamp() where token_hash = $1', [used.hash]);
      for (const set of ['used_at = null', `used_at = used_at + interval '1 second'`, 'voided_at = clock_timestamp()']) {
        const result = await update(client, used.hash, set);
        expect(result.ok, set).toBe(false);
        if (!result.ok) expect(result.code, set).toBe('55000');
      }
      await client.query('delete from identity.recovery_tokens');
      const voided = await tokenFixture(client);
      await client.query('update identity.recovery_tokens set voided_at = clock_timestamp() where token_hash = $1', [voided.hash]);
      for (const set of ['voided_at = null', `voided_at = voided_at + interval '1 second'`, 'used_at = clock_timestamp()']) {
        const result = await update(client, voided.hash, set);
        expect(result.ok, set).toBe(false);
        if (!result.ok) expect(result.code, set).toBe('55000');
      }
    });
  });

  it('used and voided are mutually exclusive (the check constraint), at once and by insert', async () => {
    await inTx(async (client) => {
      const {admin, hash} = await tokenFixture(client);
      const both = await update(client, hash, 'used_at = clock_timestamp(), voided_at = clock_timestamp()');
      expect(both.ok).toBe(false);
      if (!both.ok) expect(both.code).toBe('23514');
      const inserted = await attempt(
        client,
        null,
        `insert into identity.recovery_tokens (account_id, token_hash, issued_at, expires_at, used_at, voided_at)
         values ($1, $2, clock_timestamp(), clock_timestamp() + interval '15 minutes', clock_timestamp(), clock_timestamp())`,
        [admin.accountId, codeHash()],
      );
      expect(inserted.ok).toBe(false);
      if (!inserted.ok) expect(inserted.code).toBe('23514');
    });
  });

  it('a hash is 64 lower-case hex characters and unique, expiry follows issue, and the Account must exist and cannot be deleted from under a token', async () => {
    await inTx(async (client) => {
      const {admin, hash} = await tokenFixture(client);
      const insertToken = (accountId: string, tokenHash: string, expires = `clock_timestamp() + interval '15 minutes'`) =>
        attempt(client, null, `insert into identity.recovery_tokens (account_id, token_hash, issued_at, expires_at) values ($1, $2, clock_timestamp(), ${expires})`, [accountId, tokenHash]);
      for (const bad of ['abc', 'A'.repeat(64), newRecoveryToken(), `${'a'.repeat(64)}\n`]) {
        const result = await insertToken(admin.accountId, bad);
        expect(result.ok, bad).toBe(false);
        if (!result.ok) expect(result.code, bad).toBe('23514');
      }
      const duplicate = await insertToken(admin.accountId, hash);
      expect(duplicate.ok).toBe(false);
      if (!duplicate.ok) expect(duplicate.code).toBe('23505');
      const stranger = await insertToken(randomUUID(), codeHash());
      expect(stranger.ok).toBe(false);
      if (!stranger.ok) expect(stranger.code).toBe('23503');
      const instant = await insertToken(admin.accountId, codeHash(), 'clock_timestamp() - interval \'1 second\'');
      expect(instant.ok).toBe(false);
      if (!instant.ok) expect(instant.code).toBe('23514');
      // The Account reference is RESTRICT, like every other Account reference.
      const {rows: references} = await client.query(`select confdeltype from pg_constraint where conrelid = 'identity.recovery_tokens'::regclass and contype = 'f'`);
      expect(references).toEqual([{confdeltype: 'r'}]);
      const erase = await attempt(client, null, 'delete from identity.accounts where id = $1', [admin.accountId]);
      expect(erase.ok).toBe(false);
    });
  });
});

// ---------------------------------------------------------------------------------------------------------------------
describe('Privacy: no token, hash, address or reason in the audit trail or the table', () => {
  it('records only the opaque events, and nothing of the token, its hash or any address, across a whole recovery', async () => {
    await inTx(async (client) => {
      await forgetUntargeted(client);
      const key = hashKey(env, 'RECOVERY_HASH_KEY');
      const admin = await account(client, {sessions: 2});
      const stranger = await account(client, {role: 'member', sessions: 1});
      const token = newRecoveryToken();
      const hash = hashRecoveryToken(token, key);
      const fresh = await addSession(client, admin.user.id);
      const strangerSession = await addSession(client, stranger.user.id);

      expect((await issue(client, hash, admin.email)).outcome).toBe('issued');
      expect((await issue(client, codeHash(), admin.email)).outcome).toBe('limited');
      expect((await issue(client, codeHash(), `nobody-${tag()}@example.test`)).outcome).toBe('refused');
      expect((await check(client, hash, admin.email)).outcome).toBe('valid');
      expect((await check(client, hashRecoveryToken(newRecoveryToken(), key), admin.email)).outcome).toBe('unknown');
      expect((await voidToken(client, hash, false)).outcome).toBe('recorded');
      expect((await voidToken(client, hashRecoveryToken(newRecoveryToken(), key), true)).outcome).toBe('not_found');
      expect((await redeem(client, hashRecoveryToken(newRecoveryToken(), key), admin.email, admin.user.id, fresh)).outcome).toBe('unknown');
      expect((await redeem(client, hash, admin.email, stranger.user.id, strangerSession)).outcome).toBe('administrator');
      expect((await redeem(client, hash, admin.email, admin.user.id, fresh)).outcome).toBe('redeemed');
      expect((await redeem(client, hash, admin.email, admin.user.id, await addSession(client, admin.user.id))).outcome).toBe('used');
      expect((await check(client, hash, admin.email)).outcome).toBe('used');

      const {rows: events} = await client.query(
        `select actor, action, target from identity.audit_events
          where actor = any($1) or target = any($2)
             or target in (select 'session:' || g.session_id::text from identity.session_grants g where g.account_id = any($3))
             or (actor = 'system:recovery' and target is null)`,
        [[`user:${admin.user.id}`, `user:${stranger.user.id}`], [`account:${admin.accountId}`, `account:${stranger.accountId}`], [admin.accountId, stranger.accountId]],
      );
      expect(events.length).toBeGreaterThanOrEqual(10);
      for (const event of events) {
        expect(event.actor, JSON.stringify(event)).toMatch(/^(system:recovery|user:[0-9a-f-]{36}|account:[0-9a-f-]{36})$/);
        expect(event.action, JSON.stringify(event)).toMatch(/^[a-z][a-z_]*(\.[a-z][a-z_]*)+$/);
        if (event.target !== null) expect(event.target, JSON.stringify(event)).toMatch(/^(account|session):[0-9a-f-]{36}$/);
      }
      const recoveryEvents = events.filter((event) => event.action.startsWith('recovery.'));
      expect([...new Set(recoveryEvents.map((event) => event.action as string))].sort()).toEqual([
        'recovery.issued',
        'recovery.limited',
        'recovery.mail_failed',
        'recovery.redeemed',
        'recovery.rejected.administrator',
        'recovery.rejected.unknown',
        'recovery.rejected.used',
      ]);
      const text = JSON.stringify(events);
      for (const secret of [token, hash, Buffer.from(key).toString('hex'), admin.email, admin.email.split('@')[0], stranger.email, stranger.email.split('@')[0]]) expect(text).not.toContain(secret);

      // The table: the keyed hash and times, never the token or an address.
      const {rows: stored} = await client.query('select row_to_json(t)::text as row from identity.recovery_tokens t');
      expect(stored).toHaveLength(1);
      for (const secret of [token, admin.email, admin.email.split('@')[0]]) expect(stored[0].row).not.toContain(secret);
      expect(stored[0].row).toContain(hash);
    });
  });

  it('every recovery event the database has ever recorded is one of the documented kinds, with an opaque target', async () => {
    const {rows} = await db.query(`select action, actor, target from identity.audit_events where action like 'recovery.%'`);
    const allowed = /^recovery\.(issued|limited|mail_failed|redeemed|rejected\.(unknown|used|expired|voided|administrator))$/;
    for (const row of rows) {
      expect(row.action).toMatch(allowed);
      expect(row.actor).toMatch(/^(system:recovery|user:[0-9a-f-]{36})$/);
      if (row.target !== null) expect(row.target).toMatch(/^account:[0-9a-f-]{36}$/);
    }
  });

  it('takes a hash, an address, a user, a session or a flag: no argument can carry a reason or any text', async () => {
    const signatures: [string, string][] = [
      ['api.issue_recovery(text, text)', 'p_token_hash text, p_administrator_email text'],
      ['api.void_recovery(text, boolean)', 'p_token_hash text, p_definitive boolean'],
      ['api.check_recovery(text, text)', 'p_token_hash text, p_administrator_email text'],
      ['api.redeem_recovery(text, text, uuid, uuid)', 'p_token_hash text, p_administrator_email text, p_user_id uuid, p_session_id uuid'],
    ];
    for (const [signature, args] of signatures) {
      const {rows: found} = await db.query(`select pg_get_function_arguments($1::regprocedure) as args`, [signature]);
      expect(found[0].args, signature).toBe(args);
    }
  });
});

// ---------------------------------------------------------------------------------------------------------------------
describe('Closure: service role only, nothing for anon or authenticated', () => {
  const apiSignatures = ['api.issue_recovery(text, text)', 'api.void_recovery(text, boolean)', 'api.check_recovery(text, text)', 'api.redeem_recovery(text, text, uuid, uuid)'];
  const helperSignatures = ['identity.recovery_administrator(text)', 'identity.record_recovery_refusal(text, text, text)', 'identity.guard_recovery_token()'];
  const calls = [
    `select * from api.issue_recovery(repeat('a', 64), 'admin@example.test')`,
    `select * from api.void_recovery(repeat('a', 64), false)`,
    `select * from api.check_recovery(repeat('a', 64), 'admin@example.test')`,
    `select * from api.redeem_recovery(repeat('a', 64), 'admin@example.test', gen_random_uuid(), gen_random_uuid())`,
  ];
  const helperCalls = [`select * from identity.recovery_administrator('admin@example.test')`, `select identity.record_recovery_refusal('system:recovery', 'recovery.rejected.unknown', null)`];

  it('has row-level security on the table and no policies, and no privilege of any kind for public, anon, authenticated or service_role', async () => {
    const {rows: table} = await db.query(
      `select c.relrowsecurity as rls, (select count(*) from pg_policy p where p.polrelid = c.oid)::int as policies
         from pg_class c where c.oid = 'identity.recovery_tokens'::regclass`,
    );
    expect(table[0]).toEqual({rls: true, policies: 0});
    for (const role of ['public', 'anon', 'authenticated', 'service_role']) {
      const {rows: privileges} = await db.query(
        `select has_table_privilege($1, 'identity.recovery_tokens', 'select,insert,update,delete,truncate,references,trigger') as any_table,
                has_any_column_privilege($1, 'identity.recovery_tokens', 'select,insert,update,references') as any_column`,
        [role],
      );
      expect(privileges[0], role).toEqual({any_table: false, any_column: false});
    }
    const {rows: acl} = await db.query(`select count(*)::int as n from pg_class c, aclexplode(c.relacl) a where c.oid = 'identity.recovery_tokens'::regclass and a.grantee <> c.relowner`);
    expect(acl[0].n).toBe(0);
  });

  it('refuses every statement on the table to anon, authenticated and service_role at the database', async () => {
    await inTx(async (client) => {
      for (const role of ['anon', 'authenticated', 'service_role']) {
        for (const sql of [
          'select * from identity.recovery_tokens',
          `insert into identity.recovery_tokens (account_id, token_hash, expires_at) values (gen_random_uuid(), repeat('a', 64), now() + interval '15 minutes')`,
          'update identity.recovery_tokens set used_at = now()',
          'delete from identity.recovery_tokens',
          'truncate identity.recovery_tokens',
        ]) {
          const result = await attempt(client, role, sql);
          expect(result.ok, `${role}: ${sql}`).toBe(false);
          if (!result.ok) expect(result.code, `${role}: ${sql}`).toBe('42501');
        }
      }
    });
  });

  it('puts the four functions in the api schema, running as their owner with an empty search path, executable by the service role and by nobody else', async () => {
    const {rows: found} = await db.query(
      `select p.oid::regprocedure::text as signature, p.prosecdef as definer, p.proconfig as config, p.proacl is null as default_acl,
              coalesce((select array_agg(case when a.grantee = 0 then 'public' else a.grantee::regrole::text end order by 1) from aclexplode(p.proacl) a where a.privilege_type = 'EXECUTE' and a.grantee <> p.proowner), '{}') as grantees
         from pg_proc p where p.oid = any($1::regprocedure[]) order by 1`,
      [apiSignatures],
    );
    expect(found).toHaveLength(4);
    for (const row of found) {
      expect(row.definer, row.signature).toBe(true);
      expect(row.config, row.signature).toEqual(['search_path=""']);
      expect(row.default_acl, row.signature).toBe(false);
      expect(row.grantees, row.signature).toEqual(['service_role']);
    }
    for (const signature of apiSignatures) {
      for (const role of ['public', 'anon', 'authenticated']) {
        expect((await db.query(`select has_function_privilege($1, $2, 'execute') as can`, [role, signature])).rows[0].can, `${role} on ${signature}`).toBe(false);
      }
      expect((await db.query(`select has_function_privilege('service_role', $1, 'execute') as can`, [signature])).rows[0].can, signature).toBe(true);
    }
  });

  it('keeps the helpers and the trigger function callable by no API role at all, service_role included', async () => {
    const {rows: found} = await db.query(
      `select p.oid::regprocedure::text as signature, p.proconfig as config,
              coalesce((select array_agg(case when a.grantee = 0 then 'public' else a.grantee::regrole::text end order by 1) from aclexplode(p.proacl) a where a.privilege_type = 'EXECUTE' and a.grantee <> p.proowner), '{}') as grantees
         from pg_proc p where p.oid = any($1::regprocedure[]) order by 1`,
      [helperSignatures],
    );
    expect(found).toHaveLength(3);
    for (const row of found) {
      expect(row.config, row.signature).toEqual(['search_path=""']);
      expect(row.grantees, row.signature).toEqual([]);
    }
    for (const signature of helperSignatures) {
      for (const role of ['public', 'anon', 'authenticated', 'service_role']) {
        expect((await db.query(`select has_function_privilege($1, $2, 'execute') as can`, [role, signature])).rows[0].can, `${role} on ${signature}`).toBe(false);
      }
    }
  });

  it('refuses a real call of each function to anon and authenticated, and of each helper to every API role (service_role calls the four)', async () => {
    await inTx(async (client) => {
      for (const role of ['anon', 'authenticated']) {
        for (const sql of calls) {
          const result = await attempt(client, role, sql);
          expect(result.ok, `${role}: ${sql}`).toBe(false);
          if (!result.ok) expect(result.code, `${role}: ${sql}`).toBe('42501');
        }
      }
      for (const role of ['anon', 'authenticated', 'service_role']) {
        for (const sql of helperCalls) {
          const result = await attempt(client, role, sql);
          expect(result.ok, `${role}: ${sql}`).toBe(false);
          if (!result.ok) expect(result.code, `${role}: ${sql}`).toBe('42501');
        }
      }
      // The service role is let in (an unknown token is a refusal, not an error).
      for (const sql of calls) {
        const result = await attempt(client, 'service_role', sql);
        expect(result.ok, `service_role: ${sql}`).toBe(true);
      }
    });
  });
});

// ---------------------------------------------------------------------------------------------------------------------
describe('the same calls over REST, as the application makes them (committed data)', () => {
  const rpc = (name: string, body: unknown, key = stack.serviceKey) =>
    fetch(`${stack.apiUrl}/rest/v1/rpc/${name}`, {
      method: 'POST',
      headers: {apikey: key, authorization: `Bearer ${key}`, 'content-type': 'application/json', 'content-profile': 'api', accept: 'application/json'},
      body: JSON.stringify(body),
    });
  const asEnvironment = (admin: Admin): Record<string, string> => ({...env, ADMINISTRATOR_EMAIL: admin.email});

  it('issues, checks, voids and refuses through lib/accounts: outcomes in camelCase, a refusal is a value and not an exception, and only the keyed hash is stored', async () => {
    const admin = await committedAdministrator({sessions: 2});
    const options = {env: asEnvironment(admin)};
    const key = hashKey(options.env, 'RECOVERY_HASH_KEY');

    const first = await issueRecovery(options);
    expect(first).toEqual({outcome: 'issued', token: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/), expiresAt: expect.any(String)});
    if (first.outcome !== 'issued') throw new Error('The token was not issued.');
    const lifetime = Date.parse(first.expiresAt) - Date.now();
    expect(lifetime).toBeGreaterThan(14 * 60_000);
    expect(lifetime).toBeLessThanOrEqual(15 * 60_000 + 5_000);
    expect((await db.query('select account_id, token_hash from identity.recovery_tokens')).rows).toEqual([{account_id: admin.accountId, token_hash: hashRecoveryToken(first.token, key)}]);

    // Limited, and refused for a stranger's address: values.
    expect(await issueRecovery(options)).toEqual({outcome: 'limited'});
    expect(await issueRecovery({env: {...env, ADMINISTRATOR_EMAIL: `nobody-${tag()}@example.test`}})).toEqual({outcome: 'refused'});

    expect(await checkRecovery({token: first.token}, options)).toEqual({outcome: 'valid', userId: admin.user.id, email: admin.email});
    expect(await checkRecovery({token: newRecoveryToken()}, options)).toEqual({outcome: 'unknown'});
    // Anything a request carries is hashed and refused like any other unknown token.
    expect(await checkRecovery({token: 'not a token at all'}, options)).toEqual({outcome: 'unknown'});
    expect(await checkRecovery({token: 'x'.repeat(5_000)}, options)).toEqual({outcome: 'unknown'});

    expect(await voidRecovery({token: newRecoveryToken(), definitive: true}, options)).toBe('not_found');
    expect(await voidRecovery({token: first.token, definitive: false}, options)).toBe('recorded');
    expect(await checkRecovery({token: first.token}, options)).toMatchObject({outcome: 'valid'});
    expect(await voidRecovery({token: first.token, definitive: true}, options)).toBe('voided');
    expect(await checkRecovery({token: first.token}, options)).toEqual({outcome: 'voided'});
    expect(await redeemRecoveryToken({token: first.token, userId: admin.user.id, sessionId: await addSession(db, admin.user.id)}, options)).toEqual({outcome: 'voided'});
  });

  it('redeems through lib/accounts: sessions ended and the new epoch in camelCase, then the replay is a value too', async () => {
    const admin = await committedAdministrator({sessions: 2});
    const options = {env: asEnvironment(admin)};
    const issuance = await issueRecovery(options);
    if (issuance.outcome !== 'issued') throw new Error('The token was not issued.');
    const fresh = await addSession(db, admin.user.id);
    expect(await redeemRecoveryToken({token: issuance.token, userId: admin.user.id, sessionId: fresh}, options)).toEqual({outcome: 'redeemed', sessionsEnded: 2, epoch: 2});

    expect((await db.query('select state, epoch::int as epoch from api.authorize_session($1, $2)', [admin.user.id, fresh])).rows[0]).toEqual({state: 'active', epoch: 2});
    for (const old of admin.sessions) expect((await db.query('select state from api.authorize_session($1, $2)', [admin.user.id, old])).rows[0].state).toBe('no_session');
    expect((await db.query(`select outcome from api.use_marker($1, $2, 'administration', null)`, [admin.user.id, fresh])).rows[0].outcome).toBe('allowed');

    const second = await addSession(db, admin.user.id);
    expect(await redeemRecoveryToken({token: issuance.token, userId: admin.user.id, sessionId: second}, options)).toEqual({outcome: 'used'});
    expect(await checkRecovery({token: issuance.token}, options)).toEqual({outcome: 'used'});
    // Whoever asks, a used token is used.
    const stranger = await addUser(db);
    committed.users.push(stranger.id);
    expect(await redeemRecoveryToken({token: issuance.token, userId: stranger.id, sessionId: await addSession(db, stranger.id)}, options)).toEqual({outcome: 'used'});
  });

  it('puts the wire shape on the record: a composite is one JSON object with the database\'s own column names', async () => {
    const admin = await committedAdministrator({sessions: 1});
    const hash = codeHash();

    const issuedBody = await (await rpc('issue_recovery', {p_token_hash: hash, p_administrator_email: admin.email})).json();
    expect(Object.keys(issuedBody).sort()).toEqual(['expires_at', 'outcome']);
    expect(issuedBody.outcome).toBe('issued');
    expect(Number.isNaN(Date.parse(issuedBody.expires_at))).toBe(false);
    expect(await (await rpc('issue_recovery', {p_token_hash: codeHash(), p_administrator_email: admin.email})).json()).toEqual({outcome: 'limited', expires_at: null});

    const checked = await (await rpc('check_recovery', {p_token_hash: hash, p_administrator_email: admin.email})).json();
    expect(checked).toEqual({outcome: 'valid', user_id: admin.user.id, email: admin.email});
    expect(await (await rpc('check_recovery', {p_token_hash: codeHash(), p_administrator_email: admin.email})).json()).toEqual({outcome: 'unknown', user_id: null, email: null});

    expect(await (await rpc('void_recovery', {p_token_hash: codeHash(), p_definitive: true})).json()).toEqual({outcome: 'not_found'});
    expect(await (await rpc('void_recovery', {p_token_hash: hash, p_definitive: false})).json()).toEqual({outcome: 'recorded'});

    const fresh = await addSession(db, admin.user.id);
    const redeemed = await (await rpc('redeem_recovery', {p_token_hash: hash, p_administrator_email: admin.email, p_user_id: admin.user.id, p_session_id: fresh})).json();
    expect(redeemed).toEqual({outcome: 'redeemed', sessions_ended: 1, epoch: 2});
    expect(await (await rpc('redeem_recovery', {p_token_hash: hash, p_administrator_email: admin.email, p_user_id: admin.user.id, p_session_id: fresh})).json()).toEqual({outcome: 'used', sessions_ended: null, epoch: null});

    // The browser roles are refused with a database permission error and no data.
    for (const [name, body] of [
      ['issue_recovery', {p_token_hash: codeHash(), p_administrator_email: admin.email}],
      ['check_recovery', {p_token_hash: hash, p_administrator_email: admin.email}],
      ['void_recovery', {p_token_hash: hash, p_definitive: true}],
      ['redeem_recovery', {p_token_hash: hash, p_administrator_email: admin.email, p_user_id: admin.user.id, p_session_id: fresh}],
    ] as const) {
      const response = await rpc(name, body, stack.anonKey);
      const payload = await response.json();
      expect(response.status, name).toBeGreaterThanOrEqual(401);
      expect(response.status, name).toBeLessThan(500);
      expect(payload.code, name).toBe('42501');
    }
  });

  /** The typed calls, with the request body altered on its way to the database. */
  const tampering = (admin: Admin, change: (body: Record<string, unknown>) => Record<string, unknown>) => ({
    env: asEnvironment(admin),
    fetch: (url: string, init?: RequestInit) => fetch(url, {...init, body: JSON.stringify(change(JSON.parse(String(init?.body))))}),
  });
  const failure = async (promise: Promise<unknown>) => {
    try {
      await promise;
    } catch (error) {
      return error;
    }
    throw new Error('The call did not fail.');
  };

  it('answers an argument the database refuses with an AccountsUnavailableError carrying a 4xx, not retryable and not an unknown outcome', async () => {
    const admin = await committedAdministrator();
    const fresh = await addSession(db, admin.user.id);
    const cases: [string, () => Promise<unknown>, number, string][] = [
      ['issueRecovery, a hash that is not a hash', () => issueRecovery(tampering(admin, (body) => ({...body, p_token_hash: 'not-a-hash'}))), 400, '22023'],
      ['checkRecovery, an address that is empty', () => checkRecovery({token: newRecoveryToken()}, tampering(admin, (body) => ({...body, p_administrator_email: ''}))), 400, '22023'],
      ['voidRecovery, a flag that is null', () => voidRecovery({token: newRecoveryToken(), definitive: true}, tampering(admin, (body) => ({...body, p_definitive: null}))), 400, '22023'],
      [
        'redeemRecoveryToken, a session that is null',
        () => redeemRecoveryToken({token: newRecoveryToken(), userId: admin.user.id, sessionId: fresh}, tampering(admin, (body) => ({...body, p_session_id: null}))),
        400,
        '22023',
      ],
      ['issueRecovery, a parameter the function does not have', () => issueRecovery(tampering(admin, (body) => ({...body, p_reason: 'because'}))), 404, 'PGRST202'],
      ['checkRecovery, a parameter missing', () => checkRecovery({token: newRecoveryToken()}, tampering(admin, ({p_administrator_email: _gone, ...body}) => body)), 404, 'PGRST202'],
    ];
    for (const [name, call, status, code] of cases) {
      const error = await failure(call());
      expect(error, name).toBeInstanceOf(AccountsUnavailableError);
      expect(error, name).toMatchObject({status, code, retryable: false, outcomeUnknown: false});
    }
    // Nothing was issued, redeemed or audited as a recovery by any of them.
    expect(await tokenCount(db)).toBe(0);
  });

  it('answers a key that the database does not accept with an AccountsUnavailableError carrying a 4xx too', async () => {
    const admin = await committedAdministrator();
    const options = {env: {...asEnvironment(admin), SUPABASE_SERVICE_ROLE_KEY: stack.anonKey}};
    const error = await failure(issueRecovery(options));
    expect(error).toBeInstanceOf(AccountsUnavailableError);
    expect(error).toMatchObject({code: '42501', retryable: false, outcomeUnknown: false});
    expect((error as AccountsUnavailableError).status).toBeGreaterThanOrEqual(401);
    expect((error as AccountsUnavailableError).status).toBeLessThan(500);
    expect(await tokenCount(db)).toBe(0);
  });

  it('fails before it reaches the database when the input or the configuration is wrong', async () => {
    const admin = await committedAdministrator();
    const options = {env: asEnvironment(admin)};
    await expect(redeemRecoveryToken({token: newRecoveryToken(), userId: 'not-a-uuid', sessionId: randomUUID()}, options)).rejects.toThrow(TypeError);
    await expect(redeemRecoveryToken({token: newRecoveryToken(), userId: randomUUID(), sessionId: 'nope'}, options)).rejects.toThrow(TypeError);
    const {ADMINISTRATOR_EMAIL: _unset, ...withoutAddress} = options.env;
    await expect(issueRecovery({env: withoutAddress})).rejects.toBeInstanceOf(AccountsConfigError);
    await expect(checkRecovery({token: newRecoveryToken()}, {env: withoutAddress})).rejects.toThrow(/ADMINISTRATOR_EMAIL/);
    const {RECOVERY_HASH_KEY: _key, ...withoutKey} = options.env;
    await expect(issueRecovery({env: withoutKey})).rejects.toThrow(/RECOVERY_HASH_KEY/);
    expect(await tokenCount(db)).toBe(0);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
describe('api.preflight probes the recovery objects', () => {
  const asPreflight = (client: Client) => attempt(client, 'service_role', 'select * from api.preflight()');

  it('answers ok, and reads the table, the marker\'s new columns and the four functions without writing anything', async () => {
    await inTx(async (client) => {
      expect(await api(client).preflight()).toEqual({ok: true});
      const {rows} = await client.query(`select pg_get_functiondef('api.preflight()'::regprocedure) as definition`);
      for (const needle of ['recovery_tokens', 'token_hash', 'used_at', 'voided_at', 'm.nonce_id', 'm.source', 'api.issue_recovery(text,text)', 'api.void_recovery(text,boolean)', 'api.check_recovery(text,text)', 'api.redeem_recovery(text,text,uuid,uuid)', 'identity.recovery_administrator(text)', 'identity.record_recovery_refusal(text,text,text)']) {
        expect(rows[0].definition, needle).toContain(needle);
      }
      // It still carries every earlier probe forward.
      for (const needle of ['session_grants', 'csrf_hash', 'account_preferences', 'step_up_nonces', 'fresh_authentications', 'mfa_amr_claims', 'api.disable_account(text,uuid)', 'identity.assert_operation_authority(uuid,bigint)', 'delete on auth.sessions']) {
        expect(rows[0].definition, needle).toContain(needle);
      }
      expect(await tokenCount(client)).toBe(0);
    });
  });

  it.each([
    'api.issue_recovery(text, text)',
    'api.void_recovery(text, boolean)',
    'api.check_recovery(text, text)',
    'api.redeem_recovery(text, text, uuid, uuid)',
    'identity.recovery_administrator(text)',
    'identity.record_recovery_refusal(text, text, text)',
  ])('fails the build with one line, naming %s, when it is not there', async (signature) => {
    await inTx(async (client) => {
      await client.query(`drop function ${signature}`);
      const result = await asPreflight(client);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe('N3020');
        expect(result.message).toContain(signature.replace(/, /g, ','));
        expect(result.message).toContain('Story 1.6 migration is not applied');
      }
    });
  });

  it('fails when the service role cannot execute one of the four functions', async () => {
    await inTx(async (client) => {
      await client.query('revoke execute on function api.redeem_recovery(text, text, uuid, uuid) from service_role');
      const result = await asPreflight(client);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe('42501');
        expect(result.message).toContain('api.redeem_recovery(text,text,uuid,uuid)');
      }
    });
  });

  it('fails when the marker has no source column (an unapplied migration), instead of answering ok', async () => {
    await inTx(async (client) => {
      await client.query('alter table identity.fresh_authentications drop column source');
      const result = await asPreflight(client);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe('42703');
        expect(result.message).toContain('source');
      }
    });
  });

  it('fails when the recovery table is not there', async () => {
    await inTx(async (client) => {
      await client.query('drop table identity.recovery_tokens');
      const result = await asPreflight(client);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.message).toContain('recovery_tokens');
    });
  });
});
