import {randomBytes, randomUUID} from 'node:crypto';
import {describe, expect, it} from 'vitest';
import {accountStatus, consumePreauthorization, issueInvitation, registerWithCode, seedPreauthorization} from '@/lib/accounts';
import {decideAccess, decideSignIn, resolveAccess, type AuthReader} from '@/lib/access';
import {createHarness, stack, tag} from '../support/accounts-db';

// The sign-in callback's decision and the gate, over the receipts and Account states the real local
// database returns (through the same REST calls the application makes). Only Auth's own answer is faked:
// the user is whoever the test says is signed in.
const {db, committed, addUser} = createHarness();
const keys = {INVITATION_HASH_KEY: randomBytes(32).toString('base64'), RATE_LIMIT_HASH_KEY: randomBytes(32).toString('base64')};
const env = {NEXT_PUBLIC_SUPABASE_URL: stack.apiUrl, SUPABASE_SERVICE_ROLE_KEY: stack.serviceKey, ...keys};
const signedInAs = (user: {id: string; email: string}): AuthReader => ({
  auth: {getUser: async () => ({data: {user: {id: user.id, email: user.email, email_confirmed_at: '2026-10-10T00:00:00Z', is_anonymous: false, app_metadata: {provider: 'google', providers: ['google']}}}, error: null})},
});
const lookup = (userId: string) => accountStatus(userId, {env});
const callback = async (user: {id: string; email: string}) => decideSignIn({kind: 'user', user: {id: user.id, email: user.email}}, await consumePreauthorization(user.id, {env}));

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

    // Before its first sign-in the address is a stranger to the gate: the registration screen only.
    const before = await resolveAccess(signedInAs(invited), {lookup});
    expect(before.state).toBe('unregistered');
    expect(decideAccess('/', before)).toEqual({action: 'redirect', to: '/register', signOut: false});

    // First verified sign-in: the Account exists and the callback goes Home.
    expect(await callback(invited)).toEqual({to: '/', signOut: false});
    const active = await resolveAccess(signedInAs(invited), {lookup});
    expect(active).toMatchObject({state: 'active', account: {role: 'member'}});
    expect(decideAccess('/projects', active)).toEqual({action: 'allow'});
    expect(decideAccess('/register', active)).toEqual({action: 'redirect', to: '/', signOut: false});

    // Later sign-ins of the same Account go Home too.
    expect(await callback(invited)).toEqual({to: '/', signOut: false});

    // An identity nobody listed has no Account, and the callback sends it to register.
    expect(await callback(stranger)).toEqual({to: '/register', signOut: false});
    expect((await resolveAccess(signedInAs(stranger), {lookup})).state).toBe('unregistered');

    // The same address under another Google subject is refused and signed out, and gets no Account.
    expect(await callback(impostor)).toEqual({to: '/login?error=not_allowed', signOut: true, scope: 'global'});
    expect((await resolveAccess(signedInAs(impostor), {lookup})).state).toBe('unregistered');

    // Disabling the Account signs it out at the next request and at the next sign-in.
    await db.query('update identity.accounts set status = $2 where user_id = $1', [invited.id, 'disabled']);
    const disabled = await resolveAccess(signedInAs(invited), {lookup});
    expect(disabled.state).toBe('disabled');
    expect(decideAccess('/', disabled)).toEqual({action: 'redirect', to: '/login?error=account_disabled', signOut: true, scope: 'global'});
    expect(await callback(invited)).toEqual({to: '/login?error=account_disabled', signOut: true, scope: 'global'});
  });

  it('gives a registered Account the same live state as a seeded one, and denies when the database answers an error', async () => {
    const issued = await issueInvitation({kind: 'named', label: `signin ${tag()}`, actor: 'seed:local:signin-decisions'}, {env});
    if (issued.outcome !== 'issued') throw new Error('The code was not issued.');
    committed.invitationIds.push(issued.invitationId);
    const user = await addUser(db);
    committed.users.push(user.id);
    expect((await registerWithCode({userId: user.id, commandId: randomUUID(), code: issued.code, clientAddress: null}, {env})).outcome).toBe('registered');
    expect(await resolveAccess(signedInAs(user), {lookup})).toMatchObject({state: 'active'});

    // A wrong service key is a database that refuses the call: the gate denies instead of guessing.
    const refusing = (userId: string) => accountStatus(userId, {env: {...env, SUPABASE_SERVICE_ROLE_KEY: 'not-the-service-role-key'}});
    expect(await resolveAccess(signedInAs(user), {lookup: refusing, log: () => undefined})).toEqual({state: 'unavailable'});
    // And a database nobody listens on is a database that is down.
    const down = (userId: string) => accountStatus(userId, {env: {...env, NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:1'}, timeoutMs: 2000});
    expect(await resolveAccess(signedInAs(user), {lookup: down, log: () => undefined})).toEqual({state: 'unavailable'});
    await expect(consumePreauthorization(user.id, {env: {...env, NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:1'}, timeoutMs: 2000})).rejects.toThrow();
  });
});
