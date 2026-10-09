import {execFileSync} from 'node:child_process';

export type Stack = {apiUrl: string; anonKey: string; serviceKey: string; dbUrl: string};

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
  const stack = {apiUrl: values.API_URL, anonKey: values.ANON_KEY, serviceKey: values.SERVICE_ROLE_KEY, dbUrl: values.DB_URL};
  if (!stack.apiUrl || !stack.anonKey || !stack.serviceKey || !stack.dbUrl) {
    throw new Error('`supabase status -o env` did not report the API URL, keys and DB URL.');
  }
  cached = stack;
  return stack;
}
