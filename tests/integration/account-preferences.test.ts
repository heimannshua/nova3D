import {randomUUID} from 'node:crypto';
import type {Client} from 'pg';
import {beforeAll, describe, expect, it} from 'vitest';
import {adoptPreferences, authorizeSession, issueGrant, issueInvitation, registerWithCode, setAccountPreference} from '@/lib/accounts';
import {details, guidanceStates, themes} from '@/lib/preferences';
import {locales} from '@/lib/i18n';
import {codeHash, createHarness} from '../support/accounts-db';
import {stackEnvironment} from '../support/stack';

// Story 1.4d against the Supabase CLI stack: the Account-owned preferences record, every row of the I/O matrix
// at the database. Most cases run inside a transaction that is rolled back, as the service role. The cases that
// need several real connections, and the typed calls over REST, commit real data that is removed afterwards.

const {db, connect, committed, inTx, addUser, addSession, attempt, api, count} = createHarness();

let env: Record<string, string>;
beforeAll(async () => {
  env = await stackEnvironment(db);
});

/** A user with an active Account (registered the way the registration screen does), a live Auth session and its grant. */
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

const recordOf = async (client: Client, accountId: string) => (await client.query('select * from identity.account_preferences where account_id = $1', [accountId])).rows[0];
const deviceChoice = {locale: 'he', theme: 'dark', detail: 'technical', guidance: 'dismissed'};
const defaults = {locale: null, theme: 'light', detail: 'simple', guidance: 'shown'};
const shape = (row: Record<string, unknown>) => ({locale: row.locale, theme: row.theme, detail: row.detail, guidance: row.guidance});

// ---------------------------------------------------------------------------------------------------
describe('the table: allowed values, ownership and access', () => {
  it('has CHECK constraints equal to the allowed values in lib/preferences.ts (a value added in one place and not the other fails here)', async () => {
    const {rows} = await db.query(
      `select a.attname as name, pg_get_constraintdef(c.oid) as definition
         from pg_constraint c join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any (c.conkey)
        where c.conrelid = 'identity.account_preferences'::regclass and c.contype = 'c' order by 1`,
    );
    // `locale = ANY (ARRAY['en'::text, 'he'::text])`: the quoted words, in order.
    const allowedIn = (definition: string) => [...definition.matchAll(/'([^']+)'::text/g)].map((match) => match[1]);
    const stored = Object.fromEntries(rows.map((row) => [row.name, allowedIn(row.definition)]));
    expect(Object.keys(stored).sort()).toEqual(['detail', 'guidance', 'locale', 'theme']);
    expect(stored.locale).toEqual([...locales]);
    expect(stored.theme).toEqual([...themes]);
    expect(stored.detail).toEqual([...details]);
    expect(stored.guidance).toEqual([...guidanceStates]);
  });

  it('has one row per Account, keyed by the Account, and refuses to delete an Account that has a record (ON DELETE RESTRICT)', async () => {
    const {rows} = await db.query(
      `select a.attname as column, c.contype, c.confrelid::regclass::text as references, c.confdeltype
         from pg_constraint c join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any (c.conkey)
        where c.conrelid = 'identity.account_preferences'::regclass and c.contype in ('p', 'f') order by c.contype`,
    );
    expect(rows).toEqual([
      {column: 'account_id', contype: 'f', references: 'identity.accounts', confdeltype: 'r'},
      {column: 'account_id', contype: 'p', references: '-', confdeltype: ' '},
    ]);
    await inTx(async (client) => {
      const m = await member(client);
      await api(client).adoptPreferences(m.accountId, deviceChoice);
      const refused = await attempt(client, null, 'delete from identity.accounts where id = $1', [m.accountId]);
      expect(refused.ok).toBe(false);
      if (!refused.ok) expect(refused.code).toBe('23503');
    });
  });

  it('defaults a record to light, simple and shown, with no language chosen', async () => {
    await inTx(async (client) => {
      const m = await member(client);
      await client.query('insert into identity.account_preferences (account_id) values ($1)', [m.accountId]);
      expect(shape(await recordOf(client, m.accountId))).toEqual(defaults);
    });
  });

  it.each([
    ['a language that is not offered', 'locale', 'fr'],
    ['a theme that is not offered', 'theme', 'neon'],
    ['a detail level that is not offered', 'detail', 'expert'],
    ['a guidance state that is not offered', 'guidance', 'hidden'],
    ['an empty theme', 'theme', ''],
  ])('refuses %s in the table itself', async (_name, column, value) => {
    await inTx(async (client) => {
      const m = await member(client);
      const result = await attempt(client, null, `insert into identity.account_preferences (account_id, ${column}) values ($1, $2)`, [m.accountId, value]);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.code).toBe('23514');
    });
  });

  it('never lets a record change whose it is, or when it was made', async () => {
    await inTx(async (client) => {
      const [a, b] = [await member(client), await member(client)];
      await api(client).adoptPreferences(a.accountId);
      const moved = await attempt(client, null, 'update identity.account_preferences set account_id = $2 where account_id = $1', [a.accountId, b.accountId]);
      expect(moved.ok).toBe(false);
      if (!moved.ok) expect(moved.code).toBe('55000');
      const backdated = await attempt(client, null, `update identity.account_preferences set created_at = created_at - interval '1 day' where account_id = $1`, [a.accountId]);
      expect(backdated.ok).toBe(false);
    });
  });
});

// ---------------------------------------------------------------------------------------------------
describe('api.adopt_preferences: a first sign-in adopts the device (I/O matrix)', () => {
  it('first sign-in, the device chose Hebrew and dark: the record is created with exactly those, and follows the Account', async () => {
    await inTx(async (client) => {
      const m = await member(client);
      expect(await api(client).adoptPreferences(m.accountId, deviceChoice)).toEqual({outcome: 'created'});
      expect(shape(await recordOf(client, m.accountId))).toEqual(deviceChoice);
      expect((await api(client).authorizedPreferences(m.user.id, m.sessionId)).preferences).toEqual(deviceChoice);
    });
  });

  it('first sign-in with no cookies: no language chosen, light, simple, shown', async () => {
    await inTx(async (client) => {
      const m = await member(client);
      expect(await api(client).adoptPreferences(m.accountId)).toEqual({outcome: 'created'});
      expect(shape(await recordOf(client, m.accountId))).toEqual(defaults);
    });
  });

  it('inserts only when there is no record: an existing one is left exactly as it was', async () => {
    await inTx(async (client) => {
      const m = await member(client);
      await api(client).adoptPreferences(m.accountId, deviceChoice);
      const before = await recordOf(client, m.accountId);
      expect(await api(client).adoptPreferences(m.accountId, {locale: 'en', theme: 'light', detail: 'simple', guidance: 'shown'})).toEqual({outcome: 'exists'});
      expect(await recordOf(client, m.accountId)).toEqual(before);
    });
  });

  it('a new device does not change the record: the cookies of any other device adopt nothing once one exists', async () => {
    await inTx(async (client) => {
      const m = await member(client);
      await api(client).setPreference(m.accountId, 'theme', 'dark');
      expect(await api(client).adoptPreferences(m.accountId, {locale: 'he'})).toEqual({outcome: 'exists'});
      expect(shape(await recordOf(client, m.accountId))).toEqual({...defaults, theme: 'dark'});
    });
  });

  it('denies an Account that does not exist, and one that is disabled, and stores nothing', async () => {
    await inTx(async (client) => {
      const m = await member(client);
      expect(await api(client).adoptPreferences(randomUUID(), deviceChoice)).toEqual({outcome: 'denied'});
      await client.query(`update identity.accounts set status = 'disabled' where id = $1`, [m.accountId]);
      expect(await api(client).adoptPreferences(m.accountId, deviceChoice)).toEqual({outcome: 'denied'});
      expect(await recordOf(client, m.accountId)).toBeUndefined();
    });
  });

  it.each([
    ['a language outside the set', {locale: 'fr'}],
    ['a theme outside the set', {theme: 'neon'}],
    ['a detail level outside the set', {detail: 'expert'}],
    ['a guidance state outside the set', {guidance: 'maybe'}],
    ['no theme', {theme: null}],
    ['no detail level', {detail: null}],
    ['no guidance state', {guidance: null}],
  ])('refuses %s as an invalid argument, and stores nothing (a tampered cookie is the server\'s to turn into a default, not the database\'s)', async (_name, values) => {
    await inTx(async (client) => {
      const m = await member(client);
      const args = {locale: null, theme: 'light', detail: 'simple', guidance: 'shown', ...values};
      const result = await attempt(client, 'service_role', 'select * from api.adopt_preferences($1, $2, $3, $4, $5)', [m.accountId, args.locale, args.theme, args.detail, args.guidance]);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.code).toBe('22023');
      expect(await recordOf(client, m.accountId)).toBeUndefined();
    });
  });

  it('refuses a missing Account as an invalid argument', async () => {
    await inTx(async (client) => {
      const result = await attempt(client, 'service_role', `select * from api.adopt_preferences(null, null, 'light', 'simple', 'shown')`);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.code).toBe('22023');
    });
  });
});

// ---------------------------------------------------------------------------------------------------
describe('api.set_preference: a change made signed in', () => {
  it.each([
    ['locale', 'he', {...defaults, locale: 'he'}],
    ['locale', 'en', {...defaults, locale: 'en'}],
    ['theme', 'dark', {...defaults, theme: 'dark'}],
    ['detail', 'technical', {...defaults, detail: 'technical'}],
    ['guidance', 'dismissed', {...defaults, guidance: 'dismissed'}],
  ])('saves %s = %s and nothing else', async (name, value, expected) => {
    await inTx(async (client) => {
      const m = await member(client);
      await api(client).adoptPreferences(m.accountId);
      expect(await api(client).setPreference(m.accountId, name, value)).toEqual({outcome: 'saved'});
      expect(shape(await recordOf(client, m.accountId))).toEqual(expected);
    });
  });

  it('"Match my device": a null language is saved as null, and the other three stay', async () => {
    await inTx(async (client) => {
      const m = await member(client);
      await api(client).adoptPreferences(m.accountId, deviceChoice);
      expect(await api(client).setPreference(m.accountId, 'locale', null)).toEqual({outcome: 'saved'});
      expect(shape(await recordOf(client, m.accountId))).toEqual({...deviceChoice, locale: null});
      expect((await api(client).authorizedPreferences(m.user.id, m.sessionId)).preferences).toEqual({...deviceChoice, locale: null});
    });
  });

  it('keeps the other three and moves only updated_at, never created_at', async () => {
    await inTx(async (client) => {
      const m = await member(client);
      await api(client).adoptPreferences(m.accountId, deviceChoice);
      await client.query(`update identity.account_preferences set updated_at = clock_timestamp() - interval '2 hours' where account_id = $1`, [m.accountId]);
      const before = await recordOf(client, m.accountId);
      await api(client).setPreference(m.accountId, 'theme', 'light');
      const after = await recordOf(client, m.accountId);
      expect(shape(after)).toEqual({...deviceChoice, theme: 'light'});
      expect(after.created_at).toEqual(before.created_at);
      expect(after.updated_at.getTime()).toBeGreaterThan(before.updated_at.getTime());
    });
  });

  it('creates the record, with the defaults for the other three, when the Account has none', async () => {
    await inTx(async (client) => {
      const m = await member(client);
      expect(await recordOf(client, m.accountId)).toBeUndefined();
      expect(await api(client).setPreference(m.accountId, 'theme', 'dark')).toEqual({outcome: 'saved'});
      expect(shape(await recordOf(client, m.accountId))).toEqual({...defaults, theme: 'dark'});
      expect(await count(client, 'select count(*) as n from identity.account_preferences where account_id = $1', [m.accountId])).toBe(1);
    });
  });

  it('denies an Account that does not exist, and one that is disabled, and changes nothing', async () => {
    await inTx(async (client) => {
      const m = await member(client);
      await api(client).adoptPreferences(m.accountId, deviceChoice);
      expect(await api(client).setPreference(randomUUID(), 'theme', 'dark')).toEqual({outcome: 'denied'});
      await client.query(`update identity.accounts set status = 'disabled' where id = $1`, [m.accountId]);
      expect(await api(client).setPreference(m.accountId, 'theme', 'light')).toEqual({outcome: 'denied'});
      expect(shape(await recordOf(client, m.accountId))).toEqual(deviceChoice);
      // Enabling it again brings the record back as it was; disabling kept it.
      await client.query(`update identity.accounts set status = 'active' where id = $1`, [m.accountId]);
      expect(await api(client).setPreference(m.accountId, 'theme', 'light')).toEqual({outcome: 'saved'});
    });
  });

  it.each([
    ['an unknown name', 'font', 'big'],
    ['a name in another case', 'Theme', 'dark'],
    ['a language outside the set', 'locale', 'fr'],
    ['a theme outside the set', 'theme', 'neon'],
    ['a null theme', 'theme', null],
    ['a null detail level', 'detail', null],
    ['a null guidance state', 'guidance', null],
    ['a detail level in the theme', 'theme', 'technical'],
    ['no name', null, 'dark'],
  ])('refuses %s as an invalid argument, and changes nothing', async (_name, name, value) => {
    await inTx(async (client) => {
      const m = await member(client);
      await api(client).adoptPreferences(m.accountId, deviceChoice);
      const result = await attempt(client, 'service_role', 'select * from api.set_preference($1, $2, $3)', [m.accountId, name, value]);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.code).toBe('22023');
      expect(shape(await recordOf(client, m.accountId))).toEqual(deviceChoice);
    });
  });
});

// ---------------------------------------------------------------------------------------------------
describe('api.authorize_session carries the record, in the active answer only', () => {
  it('returns null for an Account with no record, and the record once it has one', async () => {
    await inTx(async (client) => {
      const m = await member(client);
      expect(await api(client).authorizedPreferences(m.user.id, m.sessionId)).toEqual({state: 'active', preferences: null});
      await api(client).adoptPreferences(m.accountId, deviceChoice);
      expect(await api(client).authorizedPreferences(m.user.id, m.sessionId)).toEqual({state: 'active', preferences: deviceChoice});
    });
  });

  it('carries only the values, nothing about when or whose', async () => {
    await inTx(async (client) => {
      const m = await member(client);
      await api(client).adoptPreferences(m.accountId, deviceChoice);
      const {preferences} = await api(client).authorizedPreferences(m.user.id, m.sessionId);
      expect(Object.keys(preferences!).sort()).toEqual(['detail', 'guidance', 'locale', 'theme']);
    });
  });

  it('is null in every state that is not access: a revoked grant, a disabled Account, a session with no grant, a user with no Account', async () => {
    await inTx(async (client) => {
      const svc = api(client);
      const m = await member(client);
      await svc.adoptPreferences(m.accountId, deviceChoice);
      const fresh = await addSession(client, m.user.id);
      expect(await svc.authorizedPreferences(m.user.id, fresh)).toEqual({state: 'no_grant', preferences: null});
      await svc.revokeGrants({session: m.sessionId});
      expect(await svc.authorizedPreferences(m.user.id, m.sessionId)).toEqual({state: 'revoked', preferences: null});
      await client.query(`update identity.accounts set status = 'disabled' where id = $1`, [m.accountId]);
      expect(await svc.authorizedPreferences(m.user.id, fresh)).toEqual({state: 'disabled', preferences: null});
      const stranger = await addUser(client);
      expect(await svc.authorizedPreferences(stranger.id, randomUUID())).toEqual({state: 'unregistered', preferences: null});
    });
  });

  it('never shows one Account the record of another: a session that is not the user\'s gets no_session and no record', async () => {
    await inTx(async (client) => {
      const svc = api(client);
      const [a, b] = [await member(client), await member(client)];
      await svc.adoptPreferences(a.accountId, deviceChoice);
      await svc.adoptPreferences(b.accountId, {theme: 'dark'});
      expect((await svc.authorizedPreferences(a.user.id, a.sessionId)).preferences).toEqual(deviceChoice);
      expect((await svc.authorizedPreferences(b.user.id, b.sessionId)).preferences).toEqual({...defaults, theme: 'dark'});
      expect(await svc.authorizedPreferences(a.user.id, b.sessionId)).toEqual({state: 'no_session', preferences: null});
      expect(await svc.authorizedPreferences(b.user.id, a.sessionId)).toEqual({state: 'no_session', preferences: null});
    });
  });

  it('costs the decision nothing: the state, Account, role and epoch are as they were', async () => {
    await inTx(async (client) => {
      const svc = api(client);
      const m = await member(client);
      const without = await svc.authorize(m.user.id, m.sessionId);
      await svc.adoptPreferences(m.accountId, deviceChoice);
      expect(await svc.authorize(m.user.id, m.sessionId)).toEqual(without);
    });
  });
});

// ---------------------------------------------------------------------------------------------------
describe('two first requests at once (real connections, committed data)', () => {
  async function committedMember() {
    const user = await addUser(db);
    committed.users.push(user.id);
    const issued = await issueInvitation({kind: 'named', label: `prefs ${user.id.slice(0, 8)}`, actor: 'seed:local:preferences'}, {env});
    if (issued.outcome !== 'issued') throw new Error('The code was not issued.');
    committed.invitationIds.push(issued.invitationId);
    const receipt = await registerWithCode({userId: user.id, commandId: randomUUID(), code: issued.code, clientAddress: `203.0.113.${Math.floor(Math.random() * 250) + 1}`}, {env});
    if (receipt.outcome !== 'registered') throw new Error(`The test Account was not created (${receipt.outcome}).`);
    const sessionId = await addSession(db, user.id);
    await issueGrant(user.id, sessionId, {env});
    return {user, accountId: receipt.accountId as string, sessionId};
  }

  it('leaves one record, the first one\'s, and tells everyone else it already exists', async () => {
    const m = await committedMember();
    const choices = [
      {locale: 'he', theme: 'dark', detail: 'technical', guidance: 'dismissed'},
      {locale: 'en', theme: 'light', detail: 'simple', guidance: 'shown'},
      {locale: null, theme: 'dark', detail: 'simple', guidance: 'shown'},
      {locale: 'he', theme: 'light', detail: 'technical', guidance: 'shown'},
      {locale: 'en', theme: 'dark', detail: 'technical', guidance: 'dismissed'},
    ];
    const clients = await Promise.all(choices.map(() => connect()));
    const answers = await Promise.all(clients.map((client, index) => client.query('select outcome from api.adopt_preferences($1, $2, $3, $4, $5)', [m.accountId, ...Object.values(choices[index])])));
    const outcomes = answers.map((answer) => answer.rows[0].outcome);
    expect(outcomes.filter((outcome) => outcome === 'created')).toHaveLength(1);
    expect(outcomes.filter((outcome) => outcome === 'exists')).toHaveLength(choices.length - 1);
    const winner = choices[outcomes.indexOf('created')];
    expect(await count(db, 'select count(*) as n from identity.account_preferences where account_id = $1', [m.accountId])).toBe(1);
    expect(shape(await recordOf(db, m.accountId))).toEqual(winner);
  });

  it('keeps a later change when a slow first request arrives after it', async () => {
    const m = await committedMember();
    await db.query(`select * from api.set_preference($1, 'theme', 'dark')`, [m.accountId]);
    const late = await db.query(`select outcome from api.adopt_preferences($1, 'he', 'light', 'technical', 'dismissed')`, [m.accountId]);
    expect(late.rows[0].outcome).toBe('exists');
    expect(shape(await recordOf(db, m.accountId))).toEqual({...defaults, theme: 'dark'});
  });

  it('waits for a disable instead of racing it: an adoption that starts after the Account is disabled is denied', async () => {
    const m = await committedMember();
    const holder = await connect();
    await holder.query('begin');
    await holder.query(`update identity.accounts set status = 'disabled' where id = $1`, [m.accountId]);
    const waiting = db.query(`select outcome from api.adopt_preferences($1, null, 'light', 'simple', 'shown')`, [m.accountId]);
    await new Promise((resolve) => setTimeout(resolve, 300));
    await holder.query('commit');
    expect((await waiting).rows[0].outcome).toBe('denied');
    expect(await recordOf(db, m.accountId)).toBeUndefined();
    await db.query(`update identity.accounts set status = 'active' where id = $1`, [m.accountId]);
  });
});

// ---------------------------------------------------------------------------------------------------
describe('the typed calls over REST, as the application makes them (committed data)', () => {
  it('round-trips adoption, a change, "match my device" and the record on the authorization', async () => {
    const user = await addUser(db);
    committed.users.push(user.id);
    const issued = await issueInvitation({kind: 'named', label: `prefs rest ${user.id.slice(0, 8)}`, actor: 'seed:local:preferences'}, {env});
    if (issued.outcome !== 'issued') throw new Error('The code was not issued.');
    committed.invitationIds.push(issued.invitationId);
    const receipt = await registerWithCode({userId: user.id, commandId: randomUUID(), code: issued.code, clientAddress: `203.0.113.${Math.floor(Math.random() * 250) + 1}`}, {env});
    if (receipt.outcome !== 'registered' || !receipt.accountId) throw new Error('The test Account was not created.');
    const sessionId = await addSession(db, user.id);
    const options = {env};
    await issueGrant(user.id, sessionId, options);

    expect((await authorizeSession(user.id, sessionId, options)).preferences).toBeNull();
    expect(await adoptPreferences({accountId: receipt.accountId, locale: 'he', theme: 'dark', detail: 'simple', guidance: 'shown'}, options)).toBe('created');
    expect(await adoptPreferences({accountId: receipt.accountId, locale: null, theme: 'light', detail: 'simple', guidance: 'shown'}, options)).toBe('exists');
    expect((await authorizeSession(user.id, sessionId, options)).preferences).toEqual({locale: 'he', theme: 'dark', detail: 'simple', guidance: 'shown'});
    expect(await setAccountPreference({accountId: receipt.accountId, name: 'locale', value: null}, options)).toBe('saved');
    expect(await setAccountPreference({accountId: receipt.accountId, name: 'guidance', value: 'dismissed'}, options)).toBe('saved');
    expect((await authorizeSession(user.id, sessionId, options)).preferences).toEqual({locale: null, theme: 'dark', detail: 'simple', guidance: 'dismissed'});
    // The database refuses what the allowed sets do not hold, even if a caller forgot to check.
    await expect(setAccountPreference({accountId: receipt.accountId, name: 'theme', value: 'neon'}, options)).rejects.toMatchObject({code: '22023', retryable: false});
  });
});
