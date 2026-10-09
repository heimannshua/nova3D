#!/usr/bin/env node
// Usage: node scripts/setup-env.mjs [local|staging|production]
//
// staging and production: copy the template once; fill it in locally or in Vercel.
// local: needs the Supabase CLI stack (`supabase start`). Creates .env.local if missing, then
//        points it at the local stack and writes INSTANCE_ID from the stack's instance_identity row.
//        Values are never printed. When it replaces a hosted Supabase URL it first writes a
//        one-time backup, .env.local.bak, and never overwrites an existing backup.
//
// NOVA3D_SETUP_ROOT overrides the project root (tests point it at a temporary directory).
import {spawnSync} from 'node:child_process';
import {chmodSync, constants, copyFileSync, existsSync, readFileSync, writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fetchInstanceIdentity, isLoopbackUrl} from '../lib/environment.ts';

const target = process.argv[2] || 'local';
if (!['local', 'staging', 'production'].includes(target)) { console.error('Usage: node scripts/setup-env.mjs [local|staging|production]'); process.exit(2); }

const root = resolve(process.env.NOVA3D_SETUP_ROOT || resolve(import.meta.dirname, '..'));
const source = resolve(root, target === 'local' ? '.env.example' : `.env.${target}.example`);
const destination = resolve(root, target === 'local' ? '.env.local' : `.env.${target}`);

const created = !existsSync(destination);
if (created) {
  copyFileSync(source, destination);
  chmodSync(destination, 0o600);
  console.log(`Created ${destination} from ${source}.`);
}

if (target !== 'local') {
  if (!created) console.log(`${destination} already exists; leaving it unchanged.`);
  else console.log('Replace the placeholders locally; the file is ignored by git.');
  process.exit(0);
}

const status = spawnSync('supabase', ['status', '-o', 'env'], {cwd: root, encoding: 'utf8', timeout: 30_000});
if (status.error?.code === 'ENOENT') {
  console.error('The Supabase CLI is not installed or not on PATH. Install it (https://supabase.com/docs/guides/local-development/cli/getting-started), run `supabase start`, then run this again.');
  process.exit(1);
}
if (status.error?.code === 'ETIMEDOUT') {
  console.error('`supabase status` did not answer within 30 s. Check that Docker is running, then run this again.');
  process.exit(1);
}
if (status.error || status.status !== 0) {
  console.error('The local Supabase stack is not running. Run `supabase start`, then `node scripts/setup-env.mjs local` again.');
  process.exit(1);
}
const stack = Object.fromEntries([...status.stdout.matchAll(/^([A-Z0-9_]+)="?([^"\n]*)"?$/gm)].map((match) => [match[1], match[2]]));
const apiUrl = stack.API_URL;
const anonKey = stack.ANON_KEY;
const serviceKey = stack.SERVICE_ROLE_KEY;
if (!apiUrl || !anonKey || !serviceKey || !isLoopbackUrl(apiUrl)) {
  console.error('`supabase status` did not report a loopback API URL with anon and service keys.');
  process.exit(1);
}

const {identity, error} = await fetchInstanceIdentity({NEXT_PUBLIC_SUPABASE_URL: apiUrl, SUPABASE_SERVICE_ROLE_KEY: serviceKey});
if (error || !identity) {
  console.error(`${error ?? 'instance_identity could not be read'}. Run \`supabase db reset\` to apply the migration and seed the local row.`);
  process.exit(1);
}
if (identity.environment !== 'local') {
  console.error(`The local stack's instance_identity row says "${identity.environment}", not "local". Run \`supabase db reset\`.`);
  process.exit(1);
}

const updates = {
  APP_ENV: 'local',
  NEXT_PUBLIC_APP_ENV: 'local',
  NEXT_PUBLIC_SUPABASE_URL: apiUrl,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: anonKey,
  SUPABASE_SERVICE_ROLE_KEY: serviceKey,
  INSTANCE_ID: identity.instance_id,
};
let text = readFileSync(destination, 'utf8');
// Variables the template gained since this file was written (for example ADMINISTRATOR_EMAIL).
for (const [, name, value] of readFileSync(source, 'utf8').matchAll(/^([A-Z][A-Z0-9_]*)=(.*)$/gm)) {
  if (!(name in updates) && !new RegExp(`^(?:export[ \\t]+)?${name}=`, 'm').test(text)) updates[name] = value;
}

// Matches `NAME=value` and `export NAME=value`, every occurrence.
const lineFor = (name) => new RegExp(`^(export[ \\t]+)?${name}=(.*)$`, 'gm');
const unquote = (value) => value.trim().replace(/^(["'])(.*)\1$/, '$2');

const previousUrl = [...text.matchAll(lineFor('NEXT_PUBLIC_SUPABASE_URL'))][0]?.[2];
const replacingHosted = Boolean(previousUrl && unquote(previousUrl) && !/^(?:replace-with|<)/i.test(unquote(previousUrl)) && !isLoopbackUrl(unquote(previousUrl)));

const changed = [];
for (const [name, value] of Object.entries(updates)) {
  const occurrences = [...text.matchAll(lineFor(name))];
  if (occurrences.length === 0) {
    text = `${text.replace(/\n*$/, '\n')}${name}=${value}\n`;
    changed.push(name);
  } else if (!occurrences.every((match) => match[2] === value)) {
    text = text.replace(lineFor(name), (_line, prefix) => `${prefix ?? ''}${name}=${value}`);
    changed.push(name);
  }
}

if (changed.length) {
  if (replacingHosted) {
    const backup = `${destination}.bak`;
    try {
      copyFileSync(destination, backup, constants.COPYFILE_EXCL);
      chmodSync(backup, 0o600);
      console.log(`The previous file held a non-loopback Supabase URL. Backed it up to ${backup} (git-ignored, private); delete it when you no longer need those values.`);
    } catch (copyError) {
      if (copyError.code !== 'EEXIST') throw copyError;
      console.log(`The previous file held a non-loopback Supabase URL. ${backup} already exists and was left as it is, so those values are not backed up again.`);
    }
    console.log('Local development now uses the local stack, not a hosted project.');
  }
  writeFileSync(destination, text, {mode: 0o600});
}
chmodSync(destination, 0o600);

console.log(changed.length ? `Updated ${destination}: ${changed.join(', ')} (values not shown).` : `${destination} already matches the local stack.`);
