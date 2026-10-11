import {randomUUID} from 'node:crypto';
import type {Client} from 'pg';

// Test data for Accounts that does not depend on a test runner, so the Vitest integration tests
// (tests/support/accounts-db.ts) and the Playwright browser tests (tests/support/forged-session.ts) put
// users in, and take them out, the same way. Audit events are append-only and stay.

export type TestUser = {id: string; email: string; subject: string};

export type UserOptions = {
  email?: string;
  subject?: string;
  provider?: string;
  verified?: boolean;
  confirmed?: boolean;
  identity?: boolean;
  anonymous?: boolean;
  /** A ban that has not ended. */
  banned?: boolean;
  /** A ban that ended an hour ago. */
  banExpired?: boolean;
  /** Soft-deleted by Auth. */
  deleted?: boolean;
  /** The address Google reports on the identity, when it differs from the Auth user's. */
  identityEmail?: string;
};

/** An Auth user as GoTrue would leave it after a Google sign-in (inserted directly: the hook only guards GoTrue). */
export async function insertAuthUser(client: Client, options: UserOptions = {}): Promise<TestUser> {
  const id = randomUUID();
  const email = options.email ?? `u-${id.slice(0, 8)}@example.test`;
  const subject = options.subject ?? `sub-${id}`;
  const provider = options.provider ?? 'google';
  const verified = options.verified !== false;
  await client.query(
    `insert into auth.users (instance_id, id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, is_anonymous, banned_until, deleted_at, created_at, updated_at)
     values ('00000000-0000-0000-0000-000000000000', $1, 'authenticated', 'authenticated', $2, $3, $4, $5, $6, $7, $8, now(), now())`,
    [
      id,
      email,
      options.confirmed === false ? null : new Date(),
      JSON.stringify({provider, providers: [provider]}),
      JSON.stringify({email_verified: verified}),
      options.anonymous ?? false,
      options.banned ? new Date(Date.now() + 86_400_000) : options.banExpired ? new Date(Date.now() - 3_600_000) : null,
      options.deleted ? new Date() : null,
    ],
  );
  if (options.identity !== false) {
    await client.query(
      `insert into auth.identities (provider_id, user_id, identity_data, provider, created_at, updated_at) values ($1, $2, $3, $4, now(), now())`,
      [subject, id, JSON.stringify({sub: subject, email: options.identityEmail ?? email, email_verified: verified}), provider],
    );
  }
  return {id, email, subject};
}

/**
 * A live Auth session of the user, as GoTrue would hold it. A session grant can be issued only for a session
 * Auth has, and Auth deletes a user's sessions with the user.
 */
export async function insertAuthSession(client: Client, userId: string): Promise<string> {
  const id = randomUUID();
  await client.query(`insert into auth.sessions (id, user_id, created_at, updated_at, aal, refreshed_at) values ($1, $2, now(), now(), 'aal1', now())`, [id, userId]);
  return id;
}

export type CommittedData = {
  users: string[];
  emails: string[];
  origins: string[];
  hashes: string[];
  invitationIds: string[];
};

/** Removes committed test data in dependency order, in one transaction. */
export async function removeAccountData(client: Client, data: CommittedData) {
  await client.query('begin');
  try {
    const accounts = `(select id from identity.accounts where user_id = any($1))`;
    await client.query(`delete from identity.session_grants where account_id in ${accounts}`, [data.users]);
    await client.query(`delete from identity.registration_commands where account_id in ${accounts}`, [data.users]);
    await client.query(`delete from identity.invitations where redeemed_account_id in ${accounts} or code_hash = any($2) or id = any($3)`, [data.users, data.hashes, data.invitationIds]);
    await client.query(`delete from identity.preauthorizations where account_id in ${accounts} or email = any($2)`, [data.users, data.emails]);
    await client.query(`delete from projects.workspaces where account_id in ${accounts}`, [data.users]);
    await client.query('delete from identity.accounts where user_id = any($1)', [data.users]);
    await client.query('delete from auth.users where id = any($1)', [data.users]);
    if (data.origins.length) await releaseOrigins(client, data.origins);
    await client.query('commit');
  } catch (error) {
    await client.query('rollback');
    throw error;
  }
}

/** Gives back the global budget these origins used and forgets them, so repeated local runs cannot trip the hourly limit. */
export async function releaseOrigins(client: Client, origins: string[]) {
  await client.query(
    `with spent as (
       select (window_id / 4) as global_window, sum(failures) as failures
         from identity.rate_limit_counters where scope = 'origin' and key_hash = any($1) group by 1
     )
     update identity.rate_limit_counters g set failures = greatest(g.failures - spent.failures, 0)
       from spent where g.scope = 'global' and g.window_id = spent.global_window`,
    [origins],
  );
  await client.query('delete from identity.rate_limit_counters where key_hash = any($1)', [origins]);
}
