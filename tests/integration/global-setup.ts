import {localStack} from '../support/stack';

// Fail once, with an instruction, instead of once per test.
export default async function setup() {
  const stack = localStack();
  const response = await fetch(`${stack.apiUrl}/auth/v1/health`, {headers: {apikey: stack.anonKey}}).catch(() => undefined);
  if (!response?.ok) throw new Error('The local Supabase stack is up but Auth is not answering. Run `supabase stop && supabase start`.');
}
