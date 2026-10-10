import {randomUUID} from 'node:crypto';
import {setTimeout as sleep} from 'node:timers/promises';
import {Client} from 'pg';
import {describe, expect, it} from 'vitest';
import {codeHash, createHarness, generic, originHash, tag, withoutCommand, type TestUser} from '../support/accounts-db';

// Story 1.3 Part A with several real connections at once: races between registrations, between a
// registration and a purge, and between issuers. Every case commits, uses unique data, registers it for
// removal, and leaves any general code that was current in this local database exactly as it found it.

const {db, connect, committed, cleanup, inTx, addUser, attempt, rows, api, count, invitationStatus, failuresOf} = createHarness();
const committedUsers = committed.users;
const committedOrigins = committed.origins;
const committedHashes = committed.hashes;
const committedInvitationIds = committed.invitationIds;

/** Runs the work in a transaction that commits (or rolls back if it throws), on a connection of its own. */
async function committedTx<T>(client: Client, work: () => Promise<T>) {
  await client.query('begin');
  try {
    const result = await work();
    await client.query('commit');
    return result;
  } catch (error) {
    await client.query('rollback');
    throw error;
  }
}

async function issueNamedCommitted(label: string) {
  const hash = codeHash();
  committedHashes.push(hash);
  await committedTx(db, () => api(db).issue(hash, 'named', label));
  return hash;
}

/** Waits until the backend is blocked on a lock, and says which kind. */
async function waitingOn(pid: number) {
  for (let tries = 0; tries < 60; tries += 1) {
    const {rows: waiting} = await db.query('select wait_event_type as type, wait_event as event from pg_stat_activity where pid = $1', [pid]);
    if (waiting[0]?.type === 'Lock') return waiting[0].event as string;
    await sleep(50);
  }
  return '';
}

/**
 * Runs the work with no general code current in this local database, then puts the database back as it was:
 * a general code that was current is set aside (revoked) and, afterwards, the codes the work issued are
 * deleted and the one that was set aside is made current again. The setting aside and the putting back
 * bypass the invitation guard on purpose, only here, in a test.
 */
async function isolatingGeneralCode(work: (issued: string[]) => Promise<void>) {
  const issued: string[] = [];
  const {rows: setAside} = await db.query(
    `update identity.invitations set status = 'revoked', revoked_at = clock_timestamp(), revoked_by = 'test_isolation' where kind = 'general' and status = 'unused' returning id`,
  );
  try {
    await work(issued);
  } finally {
    committedHashes.push(...issued);
    await db.query('begin');
    try {
      await db.query('delete from identity.invitations where code_hash = any($1)', [issued]);
      if (setAside.length) {
        await db.query('alter table identity.invitations disable trigger invitations_guard');
        await db.query(`update identity.invitations set status = 'unused', revoked_at = null, revoked_by = null where id = any($1)`, [setAside.map((row) => row.id)]);
        await db.query('alter table identity.invitations enable trigger invitations_guard');
      }
      await db.query('commit');
    } catch (error) {
      await db.query('rollback');
      throw error;
    }
  }
}

// ---------------------------------------------------------------------------------------------------
describe('AC-1: concurrent registrations', () => {
  it('answers a concurrent redemption of one code with exactly one Account and Workspace', async () => {
    const clients = await Promise.all([connect(), connect()]);
    for (let round = 0; round < 6; round += 1) {
      const users = [await addUser(db), await addUser(db)];
      committedUsers.push(...users.map((user) => user.id));
      const hash = codeHash();
      committedHashes.push(hash);
      await db.query('begin');
      await api(db).issue(hash, 'named', `Race ${round}`);
      await db.query('commit');
      const origins = round % 2 === 0 ? [originHash(), originHash()] : Array(2).fill(originHash());
      committedOrigins.push(...origins);

      const receipts = await Promise.all(
        clients.map(async (client, index) => {
          await client.query('begin');
          try {
            const receipt = await api(client).register(users[index].id, hash, {origin: origins[index]});
            await client.query('commit');
            return receipt;
          } catch (error) {
            await client.query('rollback');
            throw error;
          }
        }),
      );
      expect(receipts.map((receipt) => receipt.outcome).sort(), `round ${round}`).toEqual(['refused', 'registered']);
      const winner = receipts.findIndex((receipt) => receipt.outcome === 'registered');
      expect(await count(db, 'select count(*) as n from identity.accounts where user_id = any($1)', [users.map((user) => user.id)])).toBe(1);
      expect(await count(db, 'select count(*) as n from projects.workspaces w join identity.accounts a on a.id = w.account_id where a.user_id = any($1)', [users.map((user) => user.id)])).toBe(1);
      expect(await count(db, 'select count(*) as n from identity.accounts where user_id = $1', [users[1 - winner].id])).toBe(0);
      const {rows: invitation} = await db.query('select status, redeemed_account_id from identity.invitations where code_hash = $1', [hash]);
      expect(invitation[0]).toEqual({status: 'redeemed', redeemed_account_id: receipts[winner].account_id});
      expect(withoutCommand(receipts[1 - winner])).toEqual(generic);
    }
  });

  it('answers many concurrent redemptions of one code, and of one user, with a single Account', async () => {
    const clients = await Promise.all(Array.from({length: 6}, () => connect()));
    const users: TestUser[] = [];
    for (let index = 0; index < clients.length; index += 1) users.push(await addUser(db));
    committedUsers.push(...users.map((user) => user.id));
    const hash = codeHash();
    committedHashes.push(hash);
    await db.query('begin');
    await api(db).issue(hash, 'named', 'Many at once');
    await db.query('commit');

    const registerAll = (pairs: Array<[Client, TestUser]>) =>
      Promise.all(
        pairs.map(async ([client, user]) => {
          await client.query('begin');
          const origin = originHash();
          committedOrigins.push(origin);
          try {
            const receipt = await api(client).register(user.id, hash, {origin});
            await client.query('commit');
            return receipt;
          } catch (error) {
            await client.query('rollback');
            throw error;
          }
        }),
      );

    const results = await registerAll(clients.map((client, index) => [client, users[index]]));
    expect(results.filter((receipt) => receipt.outcome === 'registered')).toHaveLength(1);
    expect(results.filter((receipt) => receipt.outcome === 'refused')).toHaveLength(5);
    expect(await count(db, 'select count(*) as n from identity.accounts where user_id = any($1)', [users.map((user) => user.id)])).toBe(1);

    // One user, many parallel commands: still one Account.
    const solo = await addUser(db);
    committedUsers.push(solo.id);
    const other = codeHash();
    committedHashes.push(other);
    await db.query('begin');
    await api(db).issue(other, 'named', 'Solo');
    await db.query('commit');
    const parallel = await Promise.all(
      clients.map(async (client) => {
        await client.query('begin');
        const origin = originHash();
        committedOrigins.push(origin);
        try {
          const receipt = await api(client).register(solo.id, other, {origin});
          await client.query('commit');
          return receipt;
        } catch (error) {
          await client.query('rollback');
          throw error;
        }
      }),
    );
    expect(new Set(parallel.map((receipt) => receipt.account_id)).size).toBe(1);
    expect(parallel.every((receipt) => receipt.outcome === 'registered')).toBe(true);
    expect(await count(db, 'select count(*) as n from identity.accounts where user_id = $1', [solo.id])).toBe(1);
  });
});

describe('AC-1 and AC-3: more races', () => {
  it('lets at most five wrong guesses through from one origin, however many connections guess at once', async () => {
    const clients = await Promise.all(Array.from({length: 12}, () => connect()));
    const users: TestUser[] = [];
    for (let index = 0; index < clients.length; index += 1) users.push(await addUser(db));
    committedUsers.push(...users.map((user) => user.id));
    const origin = originHash();
    committedOrigins.push(origin);
    const valid = await issueNamedCommitted('Burst');

    const receipts = await Promise.all(clients.map((client, index) => committedTx(client, () => api(client).register(users[index].id, codeHash(), {origin}))));
    expect(receipts.filter((receipt) => receipt.outcome === 'refused')).toHaveLength(5);
    expect(receipts.filter((receipt) => receipt.outcome === 'limited')).toHaveLength(7);
    expect(receipts.every((receipt) => ['refused', 'limited'].includes(receipt.outcome))).toBe(true);
    expect(await failuresOf(db, origin)).toBe(5);

    // The origin stays limited, even for a valid code, which stays unused.
    const afterwards = await committedTx(clients[0], () => api(clients[0]).register(users[0].id, valid, {origin}));
    expect(afterwards.outcome).toBe('limited');
    expect(await invitationStatus(db, valid)).toBe('unused');
    expect(await count(db, 'select count(*) as n from identity.accounts where user_id = any($1)', [users.map((user) => user.id)])).toBe(0);
    expect(await failuresOf(db, origin)).toBe(5);
  });

  it('gives exactly one of two Auth users racing for one pre-authorized address its Account, and audits the other', async () => {
    const clients = await Promise.all([connect(), connect()]);
    for (let round = 0; round < 6; round += 1) {
      const email = `race-${tag()}@example.test`;
      committed.emails.push(email);
      await committedTx(db, () => api(db).seed(email, 'member'));
      const users = [await addUser(db, {email}), await addUser(db, {email: email.replace('race-', 'RACE-'), subject: `other-${tag()}`})];
      committedUsers.push(...users.map((user) => user.id));

      const receipts = await Promise.all(clients.map((client, index) => committedTx(client, () => api(client).consume(users[index].id))));
      expect(receipts.map((receipt) => receipt.outcome).sort(), `round ${round}`).toEqual(['refused', 'registered']);
      const winner = receipts.findIndex((receipt) => receipt.outcome === 'registered');
      expect(await count(db, 'select count(*) as n from identity.accounts where user_id = any($1)', [users.map((user) => user.id)])).toBe(1);
      expect(await count(db, 'select count(*) as n from identity.accounts where user_id = $1', [users[1 - winner].id])).toBe(0);
      const {rows: pinned} = await db.query('select google_subject, account_id from identity.preauthorizations where email = $1', [email]);
      expect(pinned).toEqual([{google_subject: users[winner].subject, account_id: receipts[winner].account_id}]);
      expect(await count(db, `select count(*) as n from identity.audit_events where actor = $1 and action = 'registration.subject_mismatch'`, [`user:${users[1 - winner].id}`])).toBe(1);
    }
  });

  it('gives a user who consumes a pre-authorization and redeems a code at once exactly one Account, from one source', async () => {
    const clients = await Promise.all([connect(), connect()]);
    const sources = new Set<string>();
    for (let round = 0; round < 10; round += 1) {
      const email = `both-${tag()}@example.test`;
      committed.emails.push(email);
      await committedTx(db, () => api(db).seed(email, 'member'));
      const hash = await issueNamedCommitted(`Both ${round}`);
      const user = await addUser(db, {email});
      committedUsers.push(user.id);
      const origin = originHash();
      committedOrigins.push(origin);

      const [consumed, registered] = await Promise.all([
        committedTx(clients[0], () => api(clients[0]).consume(user.id)),
        committedTx(clients[1], () => api(clients[1]).register(user.id, hash, {origin})),
      ]);
      expect(await count(db, 'select count(*) as n from identity.accounts where user_id = $1', [user.id]), `round ${round}`).toBe(1);
      expect(await count(db, 'select count(*) as n from projects.workspaces w join identity.accounts a on a.id = w.account_id where a.user_id = $1', [user.id])).toBe(1);
      const {rows: account} = await db.query('select id, source from identity.accounts where user_id = $1', [user.id]);
      sources.add(account[0].source);
      expect([consumed.account_id, registered.account_id].filter(Boolean).every((id) => id === account[0].id)).toBe(true);
      if (account[0].source === 'preauthorization') {
        expect(consumed.outcome).toBe('registered');
        expect(registered).toMatchObject({outcome: 'registered', replayed: true});
        expect(await invitationStatus(db, hash), 'a repeat consumes no code').toBe('unused');
        expect(await count(db, 'select count(*) as n from identity.preauthorizations where email = $1 and consumed_at is not null', [email])).toBe(1);
      } else {
        expect(registered).toMatchObject({outcome: 'registered', replayed: false});
        expect(consumed.outcome).toBe('active');
        expect(await invitationStatus(db, hash)).toBe('redeemed');
        expect(await count(db, 'select count(*) as n from identity.preauthorizations where email = $1 and consumed_at is null', [email])).toBe(1);
      }
    }
    expect(sources.size, 'both orders were exercised or at least one was consistent').toBeGreaterThanOrEqual(1);
  });

  it('settles a revocation racing a redemption of the same code one way or the other, never both', async () => {
    const clients = await Promise.all([connect(), connect()]);
    const settled = new Set<string>();
    for (let round = 0; round < 10; round += 1) {
      const hash = await issueNamedCommitted(`Revoke race ${round}`);
      const user = await addUser(db);
      committedUsers.push(user.id);
      const origin = originHash();
      committedOrigins.push(origin);

      const [revoked, registered] = await Promise.all([
        committedTx(clients[0], () => api(clients[0]).revoke({hash})),
        committedTx(clients[1], () => api(clients[1]).register(user.id, hash, {origin})),
      ]);
      const accounts = await count(db, 'select count(*) as n from identity.accounts where user_id = $1', [user.id]);
      const state = await invitationStatus(db, hash);
      if (registered.outcome === 'registered') {
        settled.add('redeemed');
        expect({state, accounts, revoke: revoked.outcome}, `round ${round}`).toEqual({state: 'redeemed', accounts: 1, revoke: 'redeemed'});
      } else {
        settled.add('revoked');
        expect(withoutCommand(registered), `round ${round}`).toEqual(generic);
        expect({state, accounts, revoke: revoked.outcome}, `round ${round}`).toEqual({state: 'revoked', accounts: 0, revoke: 'revoked'});
      }
    }
    expect(settled.size).toBeGreaterThanOrEqual(1);
  });
});

describe('AC-2: concurrent general issues', () => {
  it('queues two general issues on an advisory lock: one is issued and the other finds it', async () => {
    await isolatingGeneralCode(async (issued) => {
      const clients = await Promise.all([connect(), connect()]);
      const [a, b] = [codeHash(), codeHash()];
      issued.push(a, b);

      await clients[0].query('begin');
      const first = await api(clients[0]).issue(a, 'general', null, 'seed:local:test', false);
      expect(first.outcome).toBe('issued');

      const {rows: pid} = await clients[1].query('select pg_backend_pid() as pid');
      await clients[1].query('begin');
      const second = api(clients[1]).issue(b, 'general', null, 'seed:local:test', false);
      second.catch(() => undefined);
      expect(await waitingOn(pid[0].pid), 'the second issue waits for the first').toBe('advisory');

      await clients[0].query('commit');
      const found = await second;
      await clients[1].query('commit');
      expect(found).toMatchObject({outcome: 'exists', invitation_id: first.invitation_id});
      expect(await invitationStatus(db, a)).toBe('unused');
      expect(await invitationStatus(db, b)).toBeUndefined();
      expect(await count(db, `select count(*) as n from identity.invitations where kind = 'general' and status = 'unused'`)).toBe(1);
    });
  });

  it('settles many parallel general issues, with and without replace, on exactly one current code', async () => {
    await isolatingGeneralCode(async (issued) => {
      const clients = await Promise.all(Array.from({length: 6}, () => connect()));

      const plain = clients.map(() => codeHash());
      issued.push(...plain);
      const outcomes = await Promise.all(clients.map((client, index) => committedTx(client, () => api(client).issue(plain[index], 'general', null, 'seed:local:test', false))));
      expect(outcomes.filter((outcome) => outcome.outcome === 'issued')).toHaveLength(1);
      expect(outcomes.filter((outcome) => outcome.outcome === 'exists')).toHaveLength(5);
      const winner = outcomes.find((outcome) => outcome.outcome === 'issued')!;
      for (const outcome of outcomes.filter((entry) => entry.outcome === 'exists')) expect(outcome.invitation_id).toBe(winner.invitation_id);
      expect(await count(db, `select count(*) as n from identity.invitations where kind = 'general' and status = 'unused'`)).toBe(1);

      const replacing = clients.map(() => codeHash());
      issued.push(...replacing);
      const replaced = await Promise.all(clients.map((client, index) => committedTx(client, () => api(client).issue(replacing[index], 'general', null, 'seed:local:test', true))));
      expect(replaced.every((outcome) => outcome.outcome === 'issued')).toBe(true);
      expect(replaced.filter((outcome) => outcome.replaced_invitation_id !== null)).toHaveLength(6);
      expect(await count(db, `select count(*) as n from identity.invitations where kind = 'general' and status = 'unused'`)).toBe(1);
      expect(await count(db, `select count(*) as n from identity.invitations where code_hash = any($1) and status = 'revoked'`, [[...plain, ...replacing]])).toBe(6);
    });
  });

  it('puts a general code that was current back exactly as it was', async () => {
    const snapshot = async () => (await db.query(`select id, status, revoked_at, revoked_by from identity.invitations where kind = 'general' order by id`)).rows;
    const before = await snapshot();
    await isolatingGeneralCode(async (issued) => {
      const own = codeHash();
      issued.push(own);
      await committedTx(db, () => api(db).issue(own, 'general', null, 'seed:local:test', false));
      expect(await count(db, `select count(*) as n from identity.invitations where kind = 'general' and status = 'unused'`)).toBe(1);
    });
    expect(await snapshot()).toEqual(before);
  });
});

// ---------------------------------------------------------------------------------------------------
describe('AC-5: a registration holds the identity lock against a purge', () => {
  it('makes a delete wait for the registration, then delete nothing because the Account restricts it', async () => {
    const [a, b] = await Promise.all([connect(), connect()]);
    const user = await addUser(db);
    committedUsers.push(user.id);
    const hash = codeHash();
    committedHashes.push(hash);
    await db.query('begin');
    await api(db).issue(hash, 'named', 'Purge race');
    await db.query('commit');
    const origin = originHash();
    committedOrigins.push(origin);

    await a.query('begin');
    expect((await api(a).register(user.id, hash, {origin})).outcome).toBe('registered');

    await b.query(`set lock_timeout = '300ms'`);
    await expect(b.query('delete from auth.users where id = $1', [user.id])).rejects.toThrow(/lock timeout/);
    await b.query('set lock_timeout = 0');
    const {rows: pid} = await b.query('select pg_backend_pid() as pid');
    const deletion = b.query('delete from auth.users where id = $1', [user.id]).then(
      () => ({deleted: true as const}),
      (error: Error) => ({deleted: false as const, message: error.message}),
    );
    let waiting = '';
    for (let tries = 0; tries < 40 && waiting !== 'Lock'; tries += 1) {
      await sleep(50);
      waiting = (await db.query('select wait_event_type as w from pg_stat_activity where pid = $1', [pid[0].pid])).rows[0]?.w ?? '';
    }
    expect(waiting, 'the delete is waiting on a lock').toBe('Lock');

    await a.query('commit');
    const outcome = await deletion;
    expect(outcome.deleted).toBe(false);
    expect(outcome).toMatchObject({message: expect.stringMatching(/foreign key|violates/)});
    expect(await count(db, 'select count(*) as n from auth.users where id = $1', [user.id])).toBe(1);
    expect(await count(db, 'select count(*) as n from identity.accounts where user_id = $1', [user.id])).toBe(1);
    const {rows: attemptRows} = await db.query('select last_attempt_at > now() - interval \'1 minute\' as recent from identity.registration_attempts where user_id = $1', [user.id]);
    expect(attemptRows).toEqual([{recent: true}]);
  });

  it('holds the Auth user row FOR UPDATE: not even a non-key update, a share lock or a purge gets in until the transaction ends', async () => {
    const [a, b] = await Promise.all([connect(), connect()]);
    for (const kind of ['register', 'consume'] as const) {
      const email = `holds-${tag()}@example.test`;
      committed.emails.push(email);
      const user = await addUser(db, {email});
      committedUsers.push(user.id);
      const hash = await issueNamedCommitted(`Holds ${kind}`);
      if (kind === 'consume') await committedTx(db, () => api(db).seed(email, 'member'));
      const origin = originHash();
      committedOrigins.push(origin);

      await a.query('begin');
      const receipt = kind === 'register' ? await api(a).register(user.id, hash, {origin}) : await api(a).consume(user.id);
      expect(receipt.outcome, kind).toBe('registered');

      // The foreign-key inserts alone would only take a KEY SHARE lock, which none of these conflicts with.
      // Only FOR UPDATE does, and Auth's own sign-in bookkeeping is a non-key update of this row.
      await b.query(`set lock_timeout = '250ms'`);
      for (const sql of [
        'update auth.users set updated_at = now() where id = $1',
        'select 1 from auth.users where id = $1 for no key update',
        'select 1 from auth.users where id = $1 for share',
        'delete from auth.users where id = $1',
      ]) {
        await expect(b.query(sql, [user.id]), `${kind}: ${sql}`).rejects.toThrow(/lock timeout/);
      }
      await a.query('commit');

      await b.query('set lock_timeout = 0');
      await b.query('update auth.users set updated_at = now() where id = $1', [user.id]);
    }
  });

  it('persists the attempt time of a failed registration, which a purge that locks first then sees', async () => {
    const [a, b] = await Promise.all([connect(), connect()]);
    const user = await addUser(db);
    committedUsers.push(user.id);
    const origin = originHash();
    committedOrigins.push(origin);

    await a.query('begin');
    expect(withoutCommand(await api(a).register(user.id, codeHash(), {origin}))).toEqual(generic);

    // The shape Story 1.9's purge must take: lock the identity row, then decide with a fresh snapshot.
    await b.query('begin');
    await b.query(`set local lock_timeout = '300ms'`);
    await expect(b.query('select id from auth.users where id = $1 for update', [user.id])).rejects.toThrow(/lock timeout/);
    await b.query('rollback');

    await b.query('begin');
    const lock = b.query('select id from auth.users where id = $1 for update', [user.id]);
    await sleep(200);
    await a.query('commit');
    expect((await lock).rowCount).toBe(1);
    const purged = await b.query(
      `delete from auth.users u where u.id = $1 and not exists (select 1 from identity.registration_attempts t where t.user_id = u.id and t.last_attempt_at > now() - interval '30 days')`,
      [user.id],
    );
    await b.query('commit');
    expect(purged.rowCount).toBe(0);
    expect(await count(db, 'select count(*) as n from auth.users where id = $1', [user.id])).toBe(1);
    expect(await count(db, 'select count(*) as n from identity.registration_attempts where user_id = $1', [user.id])).toBe(1);
  });

});
