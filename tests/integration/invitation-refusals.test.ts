import {randomUUID} from 'node:crypto';
import type {Client} from 'pg';
import {beforeAll, describe, expect, it} from 'vitest';
import {invitationRefusalActions, issueInvitation, recordInvitationRefusal, registerWithCode} from '@/lib/accounts';
import {codeHash, createHarness, stack} from '../support/accounts-db';
import {stackEnvironment} from '../support/stack';

// Story 1.11 against the Supabase CLI stack: api.record_invitation_refusal, the one function that records an
// invitation change that was refused. It is closed (service role only), validated (a real Account, the right kind
// of refusal for it), deduplicated (once an hour for one actor, action and target, even under concurrency) and
// carries no content (no label, code, hash or reason). Most cases run inside a transaction that is rolled back;
// the concurrent ones, and the typed call over REST, commit data that is removed afterwards. Audit events are
// append-only and stay, which is why every test that counts them uses an Account of its own.

const {db, connect, committed, inTx, addUser, addSession, attempt, api, count} = createHarness();

let env: Record<string, string>;
beforeAll(async () => {
  env = await stackEnvironment(db);
});

const call = 'select outcome from api.record_invitation_refusal($1, $2, $3)';

/** An Account (registered the way the registration screen does it) with the given role, inside the open transaction. */
async function account(client: Client, role: 'member' | 'administrator' = 'member') {
  const svc = api(client);
  const user = await addUser(client);
  const hash = codeHash();
  await svc.issue(hash, 'general', null);
  const receipt = await svc.register(user.id, hash);
  if (receipt.outcome !== 'registered') throw new Error(`The test Account was not created (${receipt.outcome}).`);
  if (role === 'administrator') await client.query(`update identity.accounts set role = 'administrator' where id = $1`, [receipt.account_id]);
  return {user, accountId: receipt.account_id as string};
}

/** A named code with a label that could be mistaken for content, inside the open transaction. */
async function named(client: Client, label = 'Daniel Cohen') {
  const row = await api(client).issue(codeHash(), 'named', label);
  return row.invitation_id as string;
}

const eventsOf = async (client: Client, actor: string, action?: string) =>
  (await client.query(`select actor, action, target, occurred_at from identity.audit_events where actor = $1 ${action ? 'and action = $2' : ''} order by id`, action ? [actor, action] : [actor])).rows as {
    actor: string;
    action: string;
    target: string | null;
    occurred_at: Date;
  }[];

// ---------------------------------------------------------------------------------------------------
describe('access: only the service role can record a refusal', () => {
  it('is in the api schema, runs as its owner with an empty search path, and takes an Auth user, an action and an invitation, and nothing else', async () => {
    const {rows} = await db.query(
      `select p.prosecdef as definer, p.proconfig as config, pg_get_function_arguments(p.oid) as args, pg_get_function_result(p.oid) as result
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'api' and p.proname = 'record_invitation_refusal'`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].definer).toBe(true);
    expect(rows[0].config).toEqual(['search_path=""']);
    // No label, code, hash, marker outcome or reason can be passed in: there is no parameter for one.
    expect(rows[0].args).toBe('p_user_id uuid, p_action text, p_invitation_id uuid DEFAULT NULL::uuid');
    expect(rows[0].result).toBe('api.invitation_refusal');
  });

  it('is executable by the service role and by no other role, public included', async () => {
    const {rows} = await db.query(`select r.rolname as role, has_function_privilege(r.oid, 'api.record_invitation_refusal(uuid, text, uuid)', 'execute') as can from pg_roles r where r.rolname in ('anon', 'authenticated', 'service_role', 'supabase_auth_admin') order by 1`);
    expect(Object.fromEntries(rows.map((row) => [row.role, row.can]))).toEqual({anon: false, authenticated: false, service_role: true, supabase_auth_admin: false});
    const acl = await db.query(`select (aclexplode(p.proacl)).grantee::regrole::text as grantee from pg_proc p where p.oid = 'api.record_invitation_refusal(uuid, text, uuid)'::regprocedure`);
    expect(acl.rows.map((row) => row.grantee).sort()).toEqual(['postgres', 'service_role']);
  });

  it.each(['anon', 'authenticated'])('is refused to %s with a database permission error, and writes nothing', async (role) => {
    await inTx(async (client) => {
      const m = await account(client, 'member');
      const before = await count(client, 'select count(*) as n from identity.audit_events');
      const result = await attempt(client, role, call, [m.user.id, 'invitation.denied', null]);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.message).toMatch(/permission denied for schema api/);
      expect(await count(client, 'select count(*) as n from identity.audit_events')).toBe(before);
    });
  });

  it('is refused to the browser roles over REST with a permission error, whoever the Auth user is', async () => {
    for (const key of [stack.anonKey]) {
      const response = await fetch(`${stack.apiUrl}/rest/v1/rpc/record_invitation_refusal`, {
        method: 'POST',
        headers: {apikey: stack.anonKey, authorization: `Bearer ${key}`, 'content-type': 'application/json', 'content-profile': 'api'},
        body: JSON.stringify({p_user_id: randomUUID(), p_action: 'invitation.denied', p_invitation_id: null}),
      });
      expect(response.status).toBeGreaterThanOrEqual(401);
      expect(response.status).toBeLessThan(500);
      expect((await response.json()).code).toBe('42501');
    }
  });
});

// ---------------------------------------------------------------------------------------------------
describe('validation: a real Account, and a refusal of the kind it can make', () => {
  it('names exactly the three actions the typed call knows', async () => {
    await inTx(async (client) => {
      const member = await account(client, 'member');
      const admin = await account(client, 'administrator');
      const accepted: string[] = [];
      for (const action of invitationRefusalActions) {
        for (const who of [member, admin]) {
          const result = await attempt(client, 'service_role', call, [who.user.id, action, null]);
          if (result.ok) accepted.push(action);
        }
      }
      // Each action is accepted for exactly one of the two roles.
      expect(accepted.sort()).toEqual([...invitationRefusalActions].sort());
    });
  });

  it.each([
    ['an action that is not a refusal', 'invitation.issued'],
    ['another audit family', 'step_up.limited'],
    ['an action with a different spelling', 'Invitation.Denied'],
    ['an empty action', ''],
    ['text that is no action', "invitation.denied'; delete from identity.audit_events"],
    ['no action', null],
  ])('refuses %s as an invalid argument, and writes nothing', async (_name, action) => {
    await inTx(async (client) => {
      const admin = await account(client, 'administrator');
      const before = await count(client, 'select count(*) as n from identity.audit_events');
      const result = await attempt(client, 'service_role', call, [admin.user.id, action, null]);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.code).toBe('22023');
      expect(await count(client, 'select count(*) as n from identity.audit_events')).toBe(before);
    });
  });

  it('refuses a missing user, an Auth user with no Account, and an Account that does not exist', async () => {
    await inTx(async (client) => {
      const stranger = await addUser(client);
      for (const user of [null, randomUUID(), stranger.id]) {
        const result = await attempt(client, 'service_role', call, [user, 'invitation.denied', null]);
        expect(result.ok, String(user)).toBe(false);
        if (!result.ok) expect(result.code, String(user)).toBe('22023');
      }
    });
  });

  it('refuses the wrong kind of refusal for the role: an Administrator is never "denied", and a member is never "refused for want of a marker"', async () => {
    await inTx(async (client) => {
      const member = await account(client, 'member');
      const admin = await account(client, 'administrator');
      const rejected = [
        [admin, 'invitation.denied'],
        [member, 'invitation.issue_refused'],
        [member, 'invitation.revoke_refused'],
      ] as const;
      for (const [who, action] of rejected) {
        const result = await attempt(client, 'service_role', call, [who.user.id, action, null]);
        expect(result.ok, action).toBe(false);
        if (!result.ok) expect(result.code, action).toBe('22023');
      }
      expect(await eventsOf(client, `user:${admin.user.id}`)).toEqual([]);
      expect(await eventsOf(client, `user:${member.user.id}`)).toEqual([]);
    });
  });

  it('refuses an issue that names an invitation: an issue has none', async () => {
    await inTx(async (client) => {
      const admin = await account(client, 'administrator');
      const id = await named(client);
      const result = await attempt(client, 'service_role', call, [admin.user.id, 'invitation.issue_refused', id]);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.code).toBe('22023');
    });
  });
});

// ---------------------------------------------------------------------------------------------------
describe('what is recorded: the actor, the action and the invitation, and when', () => {
  it('records an Administrator\'s refused issue with the actor and no target', async () => {
    await inTx(async (client) => {
      const admin = await account(client, 'administrator');
      const result = await attempt(client, 'service_role', call, [admin.user.id, 'invitation.issue_refused', null]);
      expect(result).toEqual({ok: true, rows: [{outcome: 'recorded'}]});
      const events = await eventsOf(client, `user:${admin.user.id}`);
      expect(events).toEqual([{actor: `user:${admin.user.id}`, action: 'invitation.issue_refused', target: null, occurred_at: expect.any(Date)}]);
      expect(Date.now() - events[0].occurred_at.getTime()).toBeLessThan(60_000);
    });
  });

  it('records a refused revoke against the invitation it named, and a denial of an Account that is not the Administrator the same way', async () => {
    await inTx(async (client) => {
      const admin = await account(client, 'administrator');
      const member = await account(client, 'member');
      const id = await named(client);
      expect((await attempt(client, 'service_role', call, [admin.user.id, 'invitation.revoke_refused', id])).ok).toBe(true);
      expect((await attempt(client, 'service_role', call, [member.user.id, 'invitation.denied', id])).ok).toBe(true);
      expect((await attempt(client, 'service_role', call, [member.user.id, 'invitation.denied', null])).ok).toBe(true);
      expect((await eventsOf(client, `user:${admin.user.id}`)).map((event) => [event.action, event.target])).toEqual([['invitation.revoke_refused', `invitation:${id}`]]);
      expect((await eventsOf(client, `user:${member.user.id}`)).map((event) => [event.action, event.target])).toEqual([
        ['invitation.denied', `invitation:${id}`],
        ['invitation.denied', null],
      ]);
    });
  });

  it('records an invitation that does not exist as an attempt with no target, so inventing IDs grows nothing', async () => {
    await inTx(async (client) => {
      const admin = await account(client, 'administrator');
      const actor = `user:${admin.user.id}`;
      for (let attemptNumber = 0; attemptNumber < 5; attemptNumber += 1) {
        const result = await attempt(client, 'service_role', call, [admin.user.id, 'invitation.revoke_refused', randomUUID()]);
        expect(result.ok).toBe(true);
      }
      // Five different IDs that name nothing are one event with no target, not five.
      expect(await eventsOf(client, actor, 'invitation.revoke_refused')).toEqual([expect.objectContaining({target: null})]);
    });
  });

  it('holds nothing but the actor, the action, the target and the time: no label, code, hash, marker outcome or reason', async () => {
    await inTx(async (client) => {
      const admin = await account(client, 'administrator');
      const code = codeHash();
      const id = (await api(client).issue(code, 'named', 'Daniel Cohen')).invitation_id as string;
      await attempt(client, 'service_role', call, [admin.user.id, 'invitation.revoke_refused', id]);
      await attempt(client, 'service_role', call, [admin.user.id, 'invitation.issue_refused', null]);
      const rows = (await client.query(`select to_jsonb(e) - 'id' - 'occurred_at' as event from identity.audit_events e where e.actor = $1 order by e.id`, [`user:${admin.user.id}`])).rows;
      expect(rows.map((row) => Object.keys(row.event).sort())).toEqual([['action', 'actor', 'target'], ['action', 'actor', 'target']]);
      const text = JSON.stringify(rows);
      for (const content of ['Daniel', 'Cohen', code, 'expired', 'none', 'stale']) expect(text, content).not.toContain(content);
      // The table has no column that could hold content.
      const columns = (await client.query(`select column_name from information_schema.columns where table_schema = 'identity' and table_name = 'audit_events' order by ordinal_position`)).rows.map((row) => row.column_name);
      expect(columns).toEqual(['id', 'occurred_at', 'actor', 'action', 'target']);
    });
  });

  it('is immutable once written: the audit table refuses an update, a delete and a truncate', async () => {
    await inTx(async (client) => {
      const admin = await account(client, 'administrator');
      await attempt(client, 'service_role', call, [admin.user.id, 'invitation.issue_refused', null]);
      for (const sql of [
        `update identity.audit_events set action = 'invitation.denied' where actor = $1`,
        `delete from identity.audit_events where actor = $1`,
      ]) {
        const result = await attempt(client, null, sql, [`user:${admin.user.id}`]);
        expect(result.ok, sql).toBe(false);
        if (!result.ok) expect(result.code).toBe('55000');
      }
      expect((await attempt(client, null, 'truncate identity.audit_events')).ok).toBe(false);
    });
  });
});

// ---------------------------------------------------------------------------------------------------
describe('deduplication: once an hour for one actor, action and target', () => {
  it('records the first and answers "repeated" to the rest, writing nothing', async () => {
    await inTx(async (client) => {
      const admin = await account(client, 'administrator');
      const answers: unknown[] = [];
      for (let index = 0; index < 4; index += 1) answers.push((await attempt(client, 'service_role', call, [admin.user.id, 'invitation.issue_refused', null])).ok && 'ok');
      expect(answers).toEqual(['ok', 'ok', 'ok', 'ok']);
      const rows = (await client.query(`select outcome from api.record_invitation_refusal($1, 'invitation.issue_refused', null)`, [admin.user.id])).rows;
      expect(rows).toEqual([{outcome: 'repeated'}]);
      expect(await eventsOf(client, `user:${admin.user.id}`, 'invitation.issue_refused')).toHaveLength(1);
    });
  });

  it('is once for each actor, each action and each target', async () => {
    await inTx(async (client) => {
      const first = await account(client, 'administrator');
      const second = await account(client, 'administrator');
      const [one, two] = [await named(client, 'One'), await named(client, 'Two')];
      const outcomes: string[] = [];
      for (const [who, action, target] of [
        [first, 'invitation.issue_refused', null],
        [first, 'invitation.issue_refused', null],
        [second, 'invitation.issue_refused', null],
        [first, 'invitation.revoke_refused', one],
        [first, 'invitation.revoke_refused', one],
        [first, 'invitation.revoke_refused', two],
        [first, 'invitation.revoke_refused', null],
        [first, 'invitation.revoke_refused', null],
      ] as const) {
        const result = await attempt(client, 'service_role', call, [who.user.id, action, target]);
        if (!result.ok) throw new Error(result.message);
        outcomes.push(result.rows[0].outcome);
      }
      expect(outcomes).toEqual(['recorded', 'repeated', 'recorded', 'recorded', 'repeated', 'recorded', 'recorded', 'repeated']);
    });
  });

  it('records the same refusal again once the last one is more than an hour old', async () => {
    await inTx(async (client) => {
      const admin = await account(client, 'administrator');
      const actor = `user:${admin.user.id}`;
      // An hour and a minute ago: the audit table is append-only, so the old event is written old, not aged.
      await client.query(`insert into identity.audit_events (occurred_at, actor, action) values (clock_timestamp() - interval '61 minutes', $1, 'invitation.issue_refused')`, [actor]);
      expect((await attempt(client, 'service_role', call, [admin.user.id, 'invitation.issue_refused', null])).ok && 'ok').toBe('ok');
      expect(await eventsOf(client, actor, 'invitation.issue_refused')).toHaveLength(2);
      // ... and not again straight away.
      expect(((await client.query(`select outcome from api.record_invitation_refusal($1, 'invitation.issue_refused', null)`, [admin.user.id])).rows[0]).outcome).toBe('repeated');
      // An event 59 minutes old still counts.
      const other = await account(client, 'administrator');
      await client.query(`insert into identity.audit_events (occurred_at, actor, action) values (clock_timestamp() - interval '59 minutes', $1, 'invitation.issue_refused')`, [`user:${other.user.id}`]);
      expect(((await client.query(`select outcome from api.record_invitation_refusal($1, 'invitation.issue_refused', null)`, [other.user.id])).rows[0]).outcome).toBe('repeated');
    });
  });

  it('is exactly once when many refusals arrive at the same moment (real connections, committed data)', async () => {
    const user = await addUser(db);
    committed.users.push(user.id);
    const issued = await issueInvitation({kind: 'named', label: `refusal ${user.id.slice(0, 8)}`, actor: 'seed:local:refusals'}, {env});
    if (issued.outcome !== 'issued') throw new Error('The code was not issued.');
    committed.invitationIds.push(issued.invitationId);
    const receipt = await registerWithCode({userId: user.id, commandId: randomUUID(), code: issued.code, clientAddress: `203.0.113.${Math.floor(Math.random() * 250) + 1}`}, {env});
    if (receipt.outcome !== 'registered') throw new Error(`The test Account was not created (${receipt.outcome}).`);
    await db.query(`update identity.accounts set role = 'administrator' where user_id = $1`, [user.id]);

    const clients = await Promise.all(Array.from({length: 8}, () => connect()));
    const answers = await Promise.all(clients.map((client) => client.query(call, [user.id, 'invitation.issue_refused', null])));
    const outcomes = answers.map((answer) => answer.rows[0].outcome);
    expect(outcomes.filter((outcome) => outcome === 'recorded')).toHaveLength(1);
    expect(outcomes.filter((outcome) => outcome === 'repeated')).toHaveLength(7);
    expect(await eventsOf(db, `user:${user.id}`, 'invitation.issue_refused')).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------------------------------
describe('the typed call over REST, as the application makes it (committed data)', () => {
  it('records a refusal, then reports the repeat, for the verified Auth user', async () => {
    const user = await addUser(db);
    committed.users.push(user.id);
    const issued = await issueInvitation({kind: 'named', label: `refusal rest ${user.id.slice(0, 8)}`, actor: 'seed:local:refusals'}, {env});
    if (issued.outcome !== 'issued') throw new Error('The code was not issued.');
    committed.invitationIds.push(issued.invitationId);
    const receipt = await registerWithCode({userId: user.id, commandId: randomUUID(), code: issued.code, clientAddress: `203.0.113.${Math.floor(Math.random() * 250) + 1}`}, {env});
    if (receipt.outcome !== 'registered') throw new Error(`The test Account was not created (${receipt.outcome}).`);
    await addSession(db, user.id);

    // A member is denied; the actor is built by the database from the Auth user.
    expect(await recordInvitationRefusal({userId: user.id, action: 'invitation.denied', invitationId: issued.invitationId}, {env})).toBe('recorded');
    expect(await recordInvitationRefusal({userId: user.id, action: 'invitation.denied', invitationId: issued.invitationId}, {env})).toBe('repeated');
    expect(await eventsOf(db, `user:${user.id}`)).toEqual([{actor: `user:${user.id}`, action: 'invitation.denied', target: `invitation:${issued.invitationId}`, occurred_at: expect.any(Date)}]);
    // Not an Administrator's refusal, whatever the application says.
    await expect(recordInvitationRefusal({userId: user.id, action: 'invitation.issue_refused'}, {env})).rejects.toMatchObject({code: '22023', retryable: false});
    // An Administrator's.
    await db.query(`update identity.accounts set role = 'administrator' where user_id = $1`, [user.id]);
    expect(await recordInvitationRefusal({userId: user.id, action: 'invitation.issue_refused'}, {env})).toBe('recorded');
    await expect(recordInvitationRefusal({userId: user.id, action: 'invitation.denied'}, {env})).rejects.toMatchObject({code: '22023', retryable: false});
    // The code that was issued is nowhere in what the trail holds.
    expect(JSON.stringify(await eventsOf(db, `user:${user.id}`))).not.toContain(issued.code);
  });
});
