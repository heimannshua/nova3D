import {existsSync, readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {parseEnvValue, type Env} from '../../lib/environment';
import {localStack} from './stack';

// The environment the application server under test runs with, as the browser tests need to see it: the
// hashing keys behind the invitation codes and the origin limiter, and the service-role key. `next start`
// (NODE_ENV=production) reads .env.production.local, .env.local, .env.production and .env, the first file to
// set a variable winning, and lets the process environment beat all of them; this reads the same files in the
// same order, so the keys the tests hash with are always the keys the server uses. (It does not expand
// `$OTHER` references, which none of these variables use.) It also refuses to run against anything but the
// Supabase CLI stack: a browser test forges sessions and writes Accounts, and must never do that to a hosted
// project.

const root = resolve(import.meta.dirname, '../..');

function readEnvFile(path: string): Env {
  if (!existsSync(path)) return {};
  const values: Env = {};
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const match = /^(?:export[ \t]+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(line);
    if (match) values[match[1]] = parseEnvValue(match[2]);
  }
  return values;
}

/** Next's order for a production server, lowest priority first, so each later file overrides the one before it. */
export const envFilesLowestFirst = ['.env', '.env.production', '.env.local', '.env.production.local'];

/** The merged environment of those files under `directory`, then `processEnv` on top. */
export function mergeServerEnv(directory: string, processEnv: Env = process.env): Env {
  const merged: Env = {};
  for (const file of envFilesLowestFirst) Object.assign(merged, readEnvFile(resolve(directory, file)));
  for (const [name, value] of Object.entries(processEnv)) if (value !== undefined) merged[name] = value;
  return merged;
}

export function serverEnv(): Env {
  const env = mergeServerEnv(root);
  const stack = localStack();
  const url = env.NEXT_PUBLIC_SUPABASE_URL?.trim().replace(/\/+$/, '');
  if (url !== stack.apiUrl.replace(/\/+$/, '')) {
    throw new Error(
      'The application under test is not pointed at the local Supabase stack. Run `supabase start` and `node scripts/setup-env.mjs local`, ' +
        'or export NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY, INSTANCE_ID, INVITATION_HASH_KEY, RATE_LIMIT_HASH_KEY and RECOVERY_HASH_KEY for it, before building and testing.',
    );
  }
  for (const name of ['SUPABASE_SERVICE_ROLE_KEY', 'INVITATION_HASH_KEY', 'RATE_LIMIT_HASH_KEY', 'RECOVERY_HASH_KEY']) {
    if (!env[name]) throw new Error(`${name} is not set for the application under test (see node scripts/setup-env.mjs local).`);
  }
  return env;
}
