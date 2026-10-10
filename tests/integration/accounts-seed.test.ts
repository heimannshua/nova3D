import {spawn} from 'node:child_process';
import {randomBytes, randomUUID} from 'node:crypto';
import {userInfo} from 'node:os';
import {resolve} from 'node:path';
import {beforeAll, describe, expect, it} from 'vitest';
import {consumePreauthorization, hashInvitationCode, registerWithCode} from '@/lib/accounts';
import {createHarness, stack, tag, uuidPattern, type TestUser} from '../support/accounts-db';

// The audited seed command run against the Supabase CLI stack: what it writes, what it audits, and what a
// registration then does with it. Its guards and messages that need no database are in
// tests/unit/seed-accounts.test.ts.

const {db, committed, addUser, count, invitationStatus} = createHarness();
const committedUsers = committed.users;
const committedHashes = committed.hashes;
const committedInvitationIds = committed.invitationIds;
const operator = userInfo().username.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 64) || 'unknown';
const actor = `seed:local:${operator}`;

// ---------------------------------------------------------------------------------------------------
describe('the audited seed command (AC-6, AC-7)', () => {
  const script = resolve(import.meta.dirname, '../../scripts/seed-accounts.mjs');
  let instanceId = '';
  const keys = {INVITATION_HASH_KEY: randomBytes(32).toString('base64'), RATE_LIMIT_HASH_KEY: randomBytes(32).toString('base64')};
  const emails = {admin: `seed-admin-${tag()}@example.test`, members: [`seed-m1-${tag()}@example.test`, `seed-m2-${tag()}@example.test`]};

  const environment = (overrides: Record<string, string | undefined> = {}) => {
    const env: Record<string, string | undefined> = {
      PATH: process.env.PATH,
      APP_ENV: 'local',
      NEXT_PUBLIC_APP_ENV: 'local',
      NEXT_PUBLIC_SUPABASE_URL: stack.apiUrl,
      NEXT_PUBLIC_SUPABASE_ANON_KEY: stack.anonKey,
      SUPABASE_SERVICE_ROLE_KEY: stack.serviceKey,
      ADMINISTRATOR_EMAIL: emails.admin,
      INSTANCE_ID: instanceId,
      PAID_ADAPTERS_ENABLED: 'false',
      SYNTHETIC_DATA_ENABLED: 'true',
      SEED_ACCOUNT_EMAILS: emails.members.join(', '),
      ...keys,
      ...overrides,
    };
    return Object.fromEntries(Object.entries(env).filter(([, value]) => value !== undefined)) as NodeJS.ProcessEnv;
  };
  const run = (args: string[], env = environment(), stdin?: string) =>
    new Promise<{code: number; stdout: string; stderr: string}>((done) => {
      const child = spawn(process.execPath, [script, ...args], {env});
      let stdout = '';
      let stderr = '';
      child.stdout.on('data', (chunk) => (stdout += chunk));
      child.stderr.on('data', (chunk) => (stderr += chunk));
      child.on('close', (code) => done({code: code ?? 1, stdout, stderr}));
      child.stdin.end(stdin ?? '');
    });

  beforeAll(async () => {
    instanceId = (await db.query('select instance_id from lifecycle.instance_identity')).rows[0].instance_id;
    committed.emails.push(emails.admin, ...emails.members);
  });

  it('pre-authorizes the Administrator and the seed addresses, and a second run changes nothing', async () => {
    const first = await run(['preauthorize']);
    expect(first.code, first.stderr).toBe(0);
    expect(first.stdout).toContain(`administrator ${emails.admin}  pre-authorized`);
    for (const member of emails.members) expect(first.stdout).toContain(`member        ${member}  pre-authorized`);

    const second = await run(['preauthorize']);
    expect(second.code, second.stderr).toBe(0);
    expect(second.stdout.match(/already pre-authorized/g)).toHaveLength(3);
    expect(second.stdout).not.toMatch(/ {2}pre-authorized/);

    const everyone = [emails.admin, ...emails.members];
    const {rows: stored} = await db.query('select email, role, consumed_at from identity.preauthorizations where email = any($1) order by role, email', [everyone]);
    expect(stored.map((row) => [row.email, row.role, row.consumed_at])).toEqual([
      [emails.admin, 'administrator', null],
      ...[...emails.members].sort().map((email) => [email, 'member', null]),
    ]);
    const {rows: audit} = await db.query(
      `select count(*)::int as n from identity.audit_events e join identity.preauthorizations p on e.target = 'preauthorization:' || p.id where p.email = any($1) and e.action = 'preauthorization.created' and e.actor = $2`,
      [everyone, actor],
    );
    expect(audit[0].n).toBe(3);
    for (const output of [first, second]) {
      for (const secret of [keys.INVITATION_HASH_KEY, keys.RATE_LIMIT_HASH_KEY, stack.serviceKey]) expect(output.stdout + output.stderr).not.toContain(secret);
    }
  });

  it('activates each seeded address at its first verified Google sign-in, pins the Administrator, and refuses another subject', async () => {
    const options = {env: {NEXT_PUBLIC_SUPABASE_URL: stack.apiUrl, SUPABASE_SERVICE_ROLE_KEY: stack.serviceKey, ...keys}};
    const admin = await addUser(db, {email: emails.admin});
    const members: TestUser[] = [];
    for (const email of emails.members) members.push(await addUser(db, {email}));
    const stranger = await addUser(db);
    const impostor = await addUser(db, {email: emails.admin.replace('seed-admin', 'Seed-Admin'), subject: 'a-different-google-subject'});
    committedUsers.push(admin.id, ...members.map((user) => user.id), stranger.id, impostor.id);

    const receipts = [await consumePreauthorization(admin.id, options), ...(await Promise.all(members.map((user) => consumePreauthorization(user.id, options))))];
    expect(receipts.map((receipt) => receipt.outcome)).toEqual(['registered', 'registered', 'registered']);
    expect(receipts.map((receipt) => receipt.role)).toEqual(['administrator', 'member', 'member']);
    expect(await consumePreauthorization(stranger.id, options)).toMatchObject({outcome: 'none', accountId: null});
    expect(await consumePreauthorization(impostor.id, options)).toMatchObject({outcome: 'refused', accountId: null});

    const {rows: pinned} = await db.query(`select google_subject from identity.preauthorizations where email = $1`, [emails.admin]);
    expect(pinned).toEqual([{google_subject: admin.subject}]);
    expect(await count(db, 'select count(*) as n from identity.accounts where user_id = any($1)', [[admin.id, ...members.map((user) => user.id), stranger.id, impostor.id]])).toBe(3);

    // Seeding again after activation leaves the Accounts and the pin alone.
    const third = await run(['preauthorize']);
    expect(third.stdout.match(/already activated/g)).toHaveLength(3);
    expect((await db.query(`select google_subject from identity.preauthorizations where email = $1`, [emails.admin])).rows).toEqual([{google_subject: admin.subject}]);
  });

  it('issues a named code once, stores only its hash, and revokes it by ID or from standard input', async () => {
    const issued = await run(['issue', '--name', 'Seed Test Invitee']);
    expect(issued.code, issued.stderr).toBe(0);
    const code = issued.stdout.match(/^ {2}((?:[0-9A-HJKMNP-TV-Z]{4}-){7}[0-9A-HJKMNP-TV-Z]{4})$/m)?.[1];
    const id = issued.stdout.match(/Invitation ID: ([0-9a-f-]{36})/)?.[1];
    expect(code).toBeTruthy();
    expect(id).toMatch(uuidPattern);
    committedInvitationIds.push(id!);
    expect(issued.stdout).toContain('shown once');
    expect(issued.stderr).toBe('');
    expect(issued.stdout + issued.stderr).not.toContain(keys.INVITATION_HASH_KEY);
    expect(issued.stdout).not.toContain(hashInvitationCode(code!, Buffer.from(keys.INVITATION_HASH_KEY, 'base64')));

    const {rows: stored} = await db.query('select code_hash, kind, label, status, issued_by from identity.invitations where id = $1', [id]);
    expect(stored).toEqual([{code_hash: hashInvitationCode(code!, Buffer.from(keys.INVITATION_HASH_KEY, 'base64')), kind: 'named', label: 'Seed Test Invitee', status: 'unused', issued_by: actor}]);

    const revoked = await run(['revoke', '--id', id!]);
    expect(revoked.code, revoked.stderr).toBe(0);
    expect(revoked.stdout).toContain('Revoked.');
    expect((await run(['revoke', '--id', id!])).stdout).toContain('Already revoked');
    expect((await run(['revoke', '--id', randomUUID()])).code).toBe(1);

    const second = await run(['issue', '--name', 'Second Invitee']);
    const secondCode = second.stdout.match(/^ {2}(\S{39})$/m)![1];
    committedHashes.push(hashInvitationCode(secondCode, Buffer.from(keys.INVITATION_HASH_KEY, 'base64')));
    const byCode = await run(['revoke', '--code-stdin'], environment(), `${secondCode.toLowerCase()}\n`);
    expect(byCode.code, byCode.stderr).toBe(0);
    expect(byCode.stdout).toContain('Revoked.');
    expect(await invitationStatus(db, hashInvitationCode(secondCode, Buffer.from(keys.INVITATION_HASH_KEY, 'base64')))).toBe('revoked');
    const {rows: events} = await db.query(`select actor, action from identity.audit_events where target = any($1) order by id`, [[`invitation:${id}`]]);
    expect(events).toEqual([
      {actor, action: 'invitation.issued'},
      {actor, action: 'invitation.revoked'},
    ]);
  });

  it('lists the invitations it issued without a code or a hash, and exits non-zero for a code already redeemed', async () => {
    const issued = await run(['issue', '--name', 'Listed And Redeemed']);
    const code = issued.stdout.match(/^ {2}(\S{39})$/m)![1];
    const id = issued.stdout.match(/Invitation ID: ([0-9a-f-]{36})/)![1];
    committedInvitationIds.push(id);

    const listed = await run(['list']);
    expect(listed.code, listed.stderr).toBe(0);
    expect(listed.stdout).toMatch(new RegExp(`^${id}  named   unused   \\S+  Listed And Redeemed$`, 'm'));
    expect(listed.stdout).not.toContain(code);
    expect(listed.stdout).not.toContain(hashInvitationCode(code, Buffer.from(keys.INVITATION_HASH_KEY, 'base64')));

    const user = await addUser(db);
    committedUsers.push(user.id);
    const options = {env: {NEXT_PUBLIC_SUPABASE_URL: stack.apiUrl, SUPABASE_SERVICE_ROLE_KEY: stack.serviceKey, ...keys}};
    expect((await registerWithCode({userId: user.id, commandId: randomUUID(), code, clientAddress: null}, options)).outcome).toBe('registered');
    expect((await run(['list'])).stdout).toMatch(new RegExp(`^${id}  named   redeemed `, 'm'));

    const revoke = await run(['revoke', '--id', id]);
    expect(revoke.code).toBe(1);
    expect(revoke.stdout).toContain('already redeemed');
    const byCode = await run(['revoke', '--code-stdin'], environment(), code);
    expect(byCode.code).toBe(1);
    expect(byCode.stdout).toContain('already redeemed');
    expect(await invitationStatus(db, hashInvitationCode(code, Buffer.from(keys.INVITATION_HASH_KEY, 'base64')))).toBe('redeemed');
    expect((await run(['revoke', '--code-stdin'], environment(), 'not a code')).code).toBe(1);
  });

  it('refuses an address that already owns an Account, keeps seeding the others, and withdraws an unused pre-authorization', async () => {
    const owner = await addUser(db, {email: `owner-${tag()}@example.test`});
    committedUsers.push(owner.id);
    const issued = await run(['issue', '--name', 'Owner']);
    const ownerCode = issued.stdout.match(/^ {2}(\S{39})$/m)![1];
    committedInvitationIds.push(issued.stdout.match(/Invitation ID: ([0-9a-f-]{36})/)![1]);
    const options = {env: {NEXT_PUBLIC_SUPABASE_URL: stack.apiUrl, SUPABASE_SERVICE_ROLE_KEY: stack.serviceKey, ...keys}};
    expect((await registerWithCode({userId: owner.id, commandId: randomUUID(), code: ownerCode, clientAddress: null}, options)).outcome).toBe('registered');

    const other = `seed-other-${tag()}@example.test`;
    committed.emails.push(owner.email, other);
    const seeded = await run(['preauthorize'], environment({SEED_ACCOUNT_EMAILS: `${owner.email}, ${other}`}));
    expect(seeded.code).toBe(1);
    expect(seeded.stderr).toContain(`${owner.email}  refused`);
    expect(seeded.stderr).toContain('already owns an Account');
    expect(seeded.stdout).toContain(`${other}  pre-authorized`);
    expect(await count(db, 'select count(*) as n from identity.preauthorizations where email = $1', [owner.email])).toBe(0);

    const withdrawn = await run(['unauthorize', '--email', other.toUpperCase()]);
    expect(withdrawn.code, withdrawn.stderr).toBe(0);
    expect(withdrawn.stdout).toContain('Withdrawn.');
    expect(await count(db, 'select count(*) as n from identity.preauthorizations where email = $1', [other])).toBe(0);
    expect((await run(['unauthorize', '--email', other])).code).toBe(1);
    const events = await db.query(`select actor from identity.audit_events where action = 'preauthorization.withdrawn' and actor = $1`, [actor]);
    expect(events.rowCount).toBeGreaterThanOrEqual(1);
  });

  it('warns, without failing, when a different Administrator address is already pre-authorized', async () => {
    const first = `seed-admin-one-${tag()}@example.test`;
    const second = `seed-admin-two-${tag()}@example.test`;
    committed.emails.push(first, second);
    expect((await run(['preauthorize'], environment({ADMINISTRATOR_EMAIL: first, SEED_ACCOUNT_EMAILS: ''}))).code).toBe(0);
    const result = await run(['preauthorize'], environment({ADMINISTRATOR_EMAIL: second, SEED_ACCOUNT_EMAILS: ''}));
    expect(result.code, result.stderr).toBe(0);
    expect(result.stderr).toMatch(/Warning: \d+ other administrator pre-authorization/);
    expect(result.stdout).toContain(`administrator ${second}  pre-authorized`);
  });

  it('refuses a wrong usage, a missing key, a mixed-up environment and a preview, and writes nothing', async () => {
    const before = await count(db, 'select count(*) as n from identity.audit_events');
    expect((await run([])).code).toBe(2);
    expect((await run(['bogus'])).code).toBe(2);
    expect((await run(['issue'])).code).toBe(2);
    expect((await run(['issue', '--name', 'A', '--general'])).code).toBe(2);
    expect((await run(['issue', '--name', 'A', '--replace'])).code).toBe(2);
    expect((await run(['revoke'])).code).toBe(2);
    expect((await run(['preauthorize', '--name', 'A'])).code).toBe(2);
    expect((await run(['unauthorize'])).code).toBe(2);
    expect((await run(['list', '--general'])).code).toBe(2);
    // An empty standard input is a usage error, and nothing is sent.
    expect((await run(['revoke', '--code-stdin'], environment(), '\n')).code).toBe(2);

    const missing = await run(['issue', '--name', 'No key'], environment({INVITATION_HASH_KEY: undefined}));
    expect(missing.code).toBe(1);
    expect(missing.stderr).toContain('missing required variables: INVITATION_HASH_KEY');

    const weak = await run(['issue', '--name', 'Weak key'], environment({INVITATION_HASH_KEY: 'short'}));
    expect(weak.code).toBe(1);
    expect(weak.stderr).toContain('INVITATION_HASH_KEY must decode to at least 32 bytes');

    const mixed = await run(['preauthorize'], environment({INSTANCE_ID: '11111111-1111-4111-8111-111111111111'}));
    expect(mixed.code).toBe(1);
    expect(mixed.stderr).toContain('INSTANCE_ID differs');
    expect(mixed.stdout).not.toContain('pre-authorized');

    const preview = await run(['preauthorize'], environment({VERCEL: '1', VERCEL_ENV: 'preview'}));
    expect(preview.code).toBe(1);
    expect(await count(db, 'select count(*) as n from identity.audit_events')).toBe(before);
  });
});

