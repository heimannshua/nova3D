#!/usr/bin/env node
// Story 1.7: a LOCAL-ONLY fixture seed for Projects. Nothing in the application creates a Project until Story 2.1, so this is how
// a developer sees My Projects, the Project overview and every stage on a real page:
//
//   node scripts/seed-projects.mjs [--email <address>]
//       Gives the Account of <address> (default: ADMINISTRATOR_EMAIL) one Project for each of the six stages: the fixtures of
//       lib/project-fixtures.ts. A fixture whose title the Account already has (live) is left alone, so running it twice
//       changes nothing. The Account must exist and be active: sign in once and register first.
//   node scripts/seed-projects.mjs --remove [--email <address>]
//       Removes the fixtures this command made for that Account (the Projects with those titles, and their commands).
//
// It writes to the Supabase CLI stack's database directly, as its owner (there is no application function that creates a Project),
// and so it checks, before it connects, exactly this and nothing more: APP_ENV is `local`; the Supabase URL's host is a loopback
// address; the database URL (`SEED_DATABASE_URL`, default the CLI stack's own) names a loopback host; and that URL carries no
// `host`, `hostaddr`, `service`, `servicefile` or `options` parameter, which the Postgres client would let send the connection
// somewhere else than the host it names. There is no flag that skips a check. It cannot know where a loopback port leads: a tunnel
// to a hosted database on 127.0.0.1 would pass, and setting one up for this is on whoever does it. It prints titles and stages,
// never an ID, an address other than the one it was asked for, or a key.
//
// Usage: node scripts/seed-projects.mjs   (reads .env.local when it exists; the variables already in the environment win)
// Exit codes: 0 done, 1 refused or failed, 2 wrong usage.
import {existsSync} from 'node:fs';
import {parseArgs} from 'node:util';
import pg from 'pg';
import {projectFixtures} from '../lib/project-fixtures.ts';

const usage = `Usage:
  seed-projects.mjs [--email <address>]
  seed-projects.mjs --remove [--email <address>]`;

function fail(message, code = 1) {
  console.error(message);
  process.exit(code);
}

let parsed;
try {
  parsed = parseArgs({allowPositionals: true, options: {email: {type: 'string'}, remove: {type: 'boolean'}}});
} catch (error) {
  fail(`${error.message}\n${usage}`, 2);
}
if (parsed.positionals.length) fail(usage, 2);
const {email: emailArgument, remove = false} = parsed.values;

// .env.local is the developer's own local file; a variable that is already set (a test, a shell) wins over it.
if (existsSync('.env.local')) process.loadEnvFile('.env.local');

const loopback = new Set(['127.0.0.1', 'localhost', '[::1]', '::1']);
const hostOf = (value) => {
  try {
    return new URL(value).hostname;
  } catch {
    return null;
  }
};

if (process.env.APP_ENV !== 'local') fail(`Refusing to run: APP_ENV is ${process.env.APP_ENV ? `"${process.env.APP_ENV}"` : 'not set'}. This command is for the local stack only (APP_ENV=local).`);
if (!loopback.has(hostOf(process.env.NEXT_PUBLIC_SUPABASE_URL ?? '') ?? '')) fail('Refusing to run: NEXT_PUBLIC_SUPABASE_URL is not a loopback address. This command is for the local stack only.');
const databaseUrl = process.env.SEED_DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
if (!loopback.has(hostOf(databaseUrl) ?? '')) fail('Refusing to run: SEED_DATABASE_URL is not a loopback address. This command is for the local stack only.');
// The Postgres client lets these query parameters replace the host the URL names, so a loopback host alone proves nothing.
const routing = new Set(['host', 'hostaddr', 'service', 'servicefile', 'pgservicefile', 'options']);
for (const name of new URL(databaseUrl).searchParams.keys()) {
  if (routing.has(name.toLowerCase())) fail(`Refusing to run: SEED_DATABASE_URL carries a "${name.toLowerCase()}" parameter, which can send the connection somewhere other than the host it names.`);
}

const email = (emailArgument ?? process.env.ADMINISTRATOR_EMAIL ?? '').trim().toLowerCase();
if (!email) fail('Name the Account: pass --email <address> (ADMINISTRATOR_EMAIL is not set).', 2);

const client = new pg.Client({connectionString: databaseUrl});
try {
  await client.connect();
} catch (error) {
  fail(`Could not connect to the local database (${error.code ?? error.message}). Is the Supabase stack running (supabase start)?`);
}

try {
  const found = await client.query(
    `select a.id as account_id, w.id as workspace_id
       from identity.accounts a
       join auth.users u on u.id = a.user_id
       join projects.workspaces w on w.account_id = a.id
      where lower(u.email) = $1 and a.status = 'active'`,
    [email],
  );
  if (found.rowCount !== 1) fail(`No active Account is registered for ${email}. Sign in with it and register first, then run this again.`);
  const {account_id: accountId, workspace_id: workspaceId} = found.rows[0];

  await client.query('begin');
  if (remove) {
    let removed = 0;
    for (const fixture of projectFixtures) {
      const ids = (await client.query('select id from projects.projects where account_id = $1 and title = $2', [accountId, fixture.title])).rows.map((row) => row.id);
      if (!ids.length) continue;
      await client.query('delete from projects.project_commands where account_id = $1 and project_id = any($2)', [accountId, ids]);
      await client.query('delete from projects.projects where account_id = $1 and id = any($2)', [accountId, ids]);
      removed += ids.length;
      console.log(`removed   ${fixture.stage.padEnd(24)} ${fixture.title}`);
    }
    await client.query('commit');
    console.log(`Removed ${removed} fixture Project${removed === 1 ? '' : 's'} from ${email}.`);
  } else {
    let added = 0;
    for (const [index, fixture] of projectFixtures.entries()) {
      const exists = await client.query('select 1 from projects.projects where account_id = $1 and title = $2 and deleted_at is null', [accountId, fixture.title]);
      if (exists.rowCount) {
        console.log(`kept      ${fixture.stage.padEnd(24)} ${fixture.title}`);
        continue;
      }
      // An hour apart (the kit's fixtureRows in lib/project-fixtures.ts are a day apart), the first newest, so the list shows them in the order of lib/project-fixtures.ts.
      await client.query(
        `insert into projects.projects (workspace_id, account_id, title, stage, current_version, updated_at)
         values ($1, $2, $3, $4, $5, now() - $6 * interval '1 hour')`,
        [workspaceId, accountId, fixture.title, fixture.stage, fixture.currentVersion, index + 1],
      );
      added += 1;
      console.log(`added     ${fixture.stage.padEnd(24)} ${fixture.title}`);
    }
    await client.query('commit');
    console.log(`Added ${added} fixture Project${added === 1 ? '' : 's'} to ${email}; ${projectFixtures.length - added} already there.`);
  }
} catch (error) {
  await client.query('rollback').catch(() => undefined);
  fail(`The seed failed and changed nothing: ${error.message}`);
} finally {
  await client.end().catch(() => undefined);
}
