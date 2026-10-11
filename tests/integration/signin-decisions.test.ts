import {randomBytes, randomUUID} from 'node:crypto';
import {describe, expect, it} from 'vitest';
import {authorizeSession, consumePreauthorization, issueGrant, issueInvitation, registerWithCode, seedPreauthorization} from '@/lib/accounts';
import {claimPreauthorization, decideAccess, resolveAccess, type AuthReader} from '@/lib/access';
import {createHarness, stack, tag} from '../support/accounts-db';
import {sessionReader} from '../support/access-token';

// The callback's decision and the gate, over the receipts and authorizations the real local database
// returns (through the same REST calls the application makes). Only Auth's own answer is faked: the user,
// and the session they are in, are whatever the test says.
const {db, committed, addUser, addSession} = createHarness();
const keys = {INVITATION_HASH_KEY: randomBytes(32).toString('base64'), RATE_LIMIT_HASH_KEY: randomBytes(32).toString('base64')};
const env = {NEXT_PUBLIC_SUPABASE_URL: stack.apiUrl, SUPABASE_SERVICE_ROLE_KEY: stack.serviceKey, ...keys};
const signedInAs = (user: {id: string; email: string}, sessionId: string): AuthReader => ({
  auth: {
    getUser: async () => ({data: {user: {id: user.id, email: user.email, email_confirmed_at: '2026-10-10T00:00:00Z', is_anonymous: false, app_metadata: {provider: 'google', providers: ['google']}}}, error: null}),
    ...sessionReader(user.id, sessionId),
  },
});
const authorize = (userId: string, sessionId: string) => authorizeSession(userId, sessionId, {env});
/** What the callback does for a verified user in a session: consume the pre-authorization, issue the grant, decide. */
const callback = (user: {id: string; email: string}, sessionId: string) =>
  claimPreauthorization(
    {id: user.id, email: user.email, sessionId},
    {consume: (userId) => consumePreauthorization(userId, {env}), issue: (userId, session) => issueGrant(userId, session, {env})},
  );

describe('the callback and the gate over the real database', () => {
  it('walks a pre-authorized address, a second Google subject, a stranger and a disabled Account through both', async () => {
    const actor = 'seed:local:signin-decisions';
    const email = `signin-${tag()}@example.test`;
    committed.emails.push(email);
    expect((await seedPreauthorization({email, role: 'member', actor}, {env})).created).toBe(true);

    const invited = await addUser(db, {email});
    // Auth keeps one user per exact address, so the second Google subject arrives with a different spelling of it.
    const impostor = await addUser(db, {email: email.replace('signin-', 'Signin-'), subject: 'another-google-subject'});
    const stranger = await addUser(db);
    committed.users.push(invited.id, stranger.id, impostor.id);
    const first = await addSession(db, invited.id);
    const second = await addSession(db, invited.id);

    // Before its first sign-in the address is a stranger to the gate: the registration screen only.
    const before = await resolveAccess(signedInAs(invited, first), {authorize});
    expect(before.state).toBe('unregistered');
    expect(decideAccess('/', before)).toEqual({action: 'redirect', to: '/register', signOut: false});

    // First verified sign-in: the Account exists, the session has its grant, and the callback goes Home.
    // Until then the gate had no grant to find, which for a user with an Account means the session has ended.
    expect(await callback(invited, first)).toEqual({to: '/', signOut: false});
    const active = await resolveAccess(signedInAs(invited, first), {authorize});
    expect(active).toMatchObject({state: 'active', user: {sessionId: first}, account: {role: 'member', epoch: 1}});
    expect(decideAccess('/projects', active)).toEqual({action: 'allow'});
    expect(decideAccess('/register', active)).toEqual({action: 'redirect', to: '/', signOut: false});

    // Another session of the same Account holds no grant until it signs in itself.
    expect(await resolveAccess(signedInAs(invited, second), {authorize})).toMatchObject({state: 'session-ended', reason: 'no_grant'});
    expect(await callback(invited, second)).toEqual({to: '/', signOut: false});
    expect((await resolveAccess(signedInAs(invited, second), {authorize})).state).toBe('active');
    // And signing in again in the same session changes nothing.
    expect(await callback(invited, second)).toEqual({to: '/', signOut: false});
    expect(Number((await db.query('select count(*) as n from identity.session_grants where account_id = (select id from identity.accounts where user_id = $1)', [invited.id])).rows[0].n)).toBe(2);

    // An identity nobody listed has no Account, no grant, and the callback sends it to register.
    const strangerSession = await addSession(db, stranger.id);
    expect(await callback(stranger, strangerSession)).toEqual({to: '/register', signOut: false});
    expect((await resolveAccess(signedInAs(stranger, strangerSession), {authorize})).state).toBe('unregistered');

    // The same address under another Google subject is refused and signed out, and gets no Account or grant.
    const impostorSession = await addSession(db, impostor.id);
    expect(await callback(impostor, impostorSession)).toEqual({to: '/login?error=not_allowed', signOut: true, scope: 'global'});
    expect((await resolveAccess(signedInAs(impostor, impostorSession), {authorize})).state).toBe('unregistered');
    expect(Number((await db.query('select count(*) as n from identity.session_grants where session_id = any($1)', [[strangerSession, impostorSession]])).rows[0].n)).toBe(0);

    // Disabling the Account signs it out at the next request and at the next sign-in.
    await db.query('update identity.accounts set status = $2 where user_id = $1', [invited.id, 'disabled']);
    const disabled = await resolveAccess(signedInAs(invited, first), {authorize});
    expect(disabled.state).toBe('disabled');
    expect(decideAccess('/', disabled)).toEqual({action: 'redirect', to: '/login?error=account_disabled', signOut: true, scope: 'global'});
    expect(await callback(invited, second)).toEqual({to: '/login?error=account_disabled', signOut: true, scope: 'global'});
  });

  it('gives a registered Account the same live state as a seeded one once its session has a grant, and denies when the database answers an error', async () => {
    const issued = await issueInvitation({kind: 'named', label: `signin ${tag()}`, actor: 'seed:local:signin-decisions'}, {env});
    if (issued.outcome !== 'issued') throw new Error('The code was not issued.');
    committed.invitationIds.push(issued.invitationId);
    const user = await addUser(db);
    committed.users.push(user.id);
    const session = await addSession(db, user.id);
    expect((await registerWithCode({userId: user.id, commandId: randomUUID(), code: issued.code, clientAddress: null}, {env})).outcome).toBe('registered');
    // Registered, but no grant yet: the session has ended, whatever the token says.
    expect(await resolveAccess(signedInAs(user, session), {authorize})).toMatchObject({state: 'session-ended', reason: 'no_grant'});
    expect((await issueGrant(user.id, session, {env})).outcome).toBe('issued');
    expect(await resolveAccess(signedInAs(user, session), {authorize})).toMatchObject({state: 'active'});

    // A wrong service key is a database that refuses the call: the gate denies instead of guessing.
    const refusing = (userId: string, sessionId: string) => authorizeSession(userId, sessionId, {env: {...env, SUPABASE_SERVICE_ROLE_KEY: 'not-the-service-role-key'}});
    expect(await resolveAccess(signedInAs(user, session), {authorize: refusing, log: () => undefined})).toEqual({state: 'unavailable'});
    // And a database nobody listens on is a database that is down.
    const down = (userId: string, sessionId: string) => authorizeSession(userId, sessionId, {env: {...env, NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:1'}, timeoutMs: 2000});
    expect(await resolveAccess(signedInAs(user, session), {authorize: down, log: () => undefined})).toEqual({state: 'unavailable'});
    await expect(consumePreauthorization(user.id, {env: {...env, NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:1'}, timeoutMs: 2000})).rejects.toThrow();
    await expect(issueGrant(user.id, session, {env: {...env, NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:1'}, timeoutMs: 2000})).rejects.toThrow();
  });
});
