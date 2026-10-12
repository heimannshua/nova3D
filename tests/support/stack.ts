import {execFileSync} from 'node:child_process';
import {randomBytes} from 'node:crypto';
import type {Client} from 'pg';

export type Stack = {apiUrl: string; anonKey: string; serviceKey: string; dbUrl: string; jwtSecret: string | undefined};

let cached: Stack | undefined;

/** Connection details of the Supabase CLI stack, read from `supabase status`. Never from the app's .env files. */
export function localStack(): Stack {
  if (cached) return cached;
  let output: string;
  try {
    output = execFileSync('supabase', ['status', '-o', 'env'], {encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 30_000});
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') throw new Error('The Supabase CLI is not installed or not on PATH.');
    if (code === 'ETIMEDOUT') throw new Error('`supabase status` did not answer within 30 s. Check that Docker is running.');
    throw new Error('The local Supabase stack is not running. Run `supabase start` first.');
  }
  const values = Object.fromEntries([...output.matchAll(/^([A-Z0-9_]+)="?([^"\n]*)"?$/gm)].map((match) => [match[1], match[2]]));
  const stack = {apiUrl: values.API_URL, anonKey: values.ANON_KEY, serviceKey: values.SERVICE_ROLE_KEY, dbUrl: values.DB_URL, jwtSecret: values.JWT_SECRET};
  if (!stack.apiUrl || !stack.anonKey || !stack.serviceKey || !stack.dbUrl) {
    throw new Error('`supabase status -o env` did not report the API URL, keys and DB URL.');
  }
  cached = stack;
  return stack;
}

/** The stack's JWT secret, for the one test that signs a token. Read lazily so no other test depends on it. */
export function jwtSecretOf(stack: Stack) {
  if (!stack.jwtSecret) throw new Error('`supabase status -o env` did not report JWT_SECRET, which this test needs to sign a token.');
  return stack.jwtSecret;
}

/**
 * The application environment for a test that calls the accounts API from Node, built from the running stack
 * alone: its URL and keys (`supabase status`), the identity of its database, and fresh random hashing keys.
 * It reads no .env file, so the test passes the same with a stale `.env.local` (one that points at a hosted
 * project) or none. The browser tests are the exception: they must use the keys the server under test runs
 * with, and read them from the same files the server does (server-env.ts).
 */
export async function stackEnvironment(client: Client): Promise<Record<string, string>> {
  const stack = localStack();
  const {rows} = await client.query('select instance_id from lifecycle.instance_identity');
  if (rows.length !== 1) throw new Error('The local stack has no single lifecycle.instance_identity row.');
  return {
    APP_ENV: 'local',
    NEXT_PUBLIC_APP_ENV: 'local',
    NEXT_PUBLIC_SUPABASE_URL: stack.apiUrl,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: stack.anonKey,
    SUPABASE_SERVICE_ROLE_KEY: stack.serviceKey,
    INSTANCE_ID: String(rows[0].instance_id),
    INVITATION_HASH_KEY: randomBytes(32).toString('base64'),
    RATE_LIMIT_HASH_KEY: randomBytes(32).toString('base64'),
    // Story 1.6: the key of the recovery token's hash.
    RECOVERY_HASH_KEY: randomBytes(32).toString('base64'),
  };
}
