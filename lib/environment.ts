// Environment identity checks (AR-26). This file has no imports on purpose: Node runs it directly
// through type stripping (scripts/check-env.mjs, scripts/setup-env.mjs) and Next.js bundles it for
// instrumentation.ts, so erasable TypeScript syntax only.
//
// No function here may return or log a secret. Errors name the variable or the mismatch, never its value.

export type Env = Record<string, string | undefined>;

export const appEnvironments = ['local', 'staging', 'production'] as const;
export type AppEnvironment = (typeof appEnvironments)[number];

export type InstanceIdentity = {environment: string; instance_id: string};

export type IdentityFetch = (input: string, init?: RequestInit) => Promise<Response>;

const requiredVariables = [
  'APP_ENV',
  'NEXT_PUBLIC_APP_ENV',
  'ADMINISTRATOR_EMAIL',
  'INSTANCE_ID',
  'AUTH_ALLOWED_EMAILS',
  'PAID_ADAPTERS_ENABLED',
  'SYNTHETIC_DATA_ENABLED',
];
const supabaseVariables = ['NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY'];
// A preview must hold none of these: any SUPABASE_* or NEXT_PUBLIC_SUPABASE_* variable, a database
// URL, POSTGRES_* or STRIPE_*. Previews are protected by this rejection, not by a database check.
const previewForbiddenName = /^(?:(?:NEXT_PUBLIC_)?SUPABASE_|POSTGRES_|(?:NEXT_PUBLIC_)?STRIPE_)|^DATABASE_URL$/;
// Bare words are anchored so a real value such as todos@example.com is not mistaken for a placeholder.
const placeholder = /^(?:replace-with-|<[^>]+>)|^(?:changeme|todo)$/i;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const emailPattern = /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/;
const loopbackHost = /^(?:localhost|127(?:\.\d{1,3}){3}|\[::1\])$/;

/**
 * True for a placeholder such as replace-with-..., <name>, changeme or todo (whole values only).
 * Does not trim: callers that accept surrounding whitespace trim first. Shared with the provisioning checks.
 */
export function isPlaceholder(value: string | undefined) {
  return placeholder.test(value ?? '');
}

export function isPreview(env: Env) {
  return env.VERCEL_ENV === 'preview' || env.VERCEL_ENV === 'development';
}

export function isLoopbackUrl(value: string) {
  try {
    const url = new URL(value);
    return (url.protocol === 'http:' || url.protocol === 'https:') && loopbackHost.test(url.hostname);
  } catch {
    return false;
  }
}

export function isHttpsUrl(value: string) {
  try {
    return new URL(value).protocol === 'https:';
  } catch {
    return false;
  }
}

/** Label and format checks. Reads no network. Returns one message per problem. */
export function validateEnvironment(env: Env): string[] {
  const errors: string[] = [];
  const environment = env.APP_ENV;
  const preview = isPreview(env);
  const needed = preview ? requiredVariables : [...requiredVariables, ...supabaseVariables];

  const missing = needed.filter((name) => !env[name]);
  const placeholders = needed.filter((name) => isPlaceholder(env[name]));

  if (!appEnvironments.includes(environment as AppEnvironment)) errors.push('APP_ENV must be local, staging, or production');
  if (missing.length) errors.push(`missing required variables: ${missing.join(', ')}`);
  if (placeholders.length) errors.push(`placeholder values are not allowed: ${placeholders.join(', ')}`);
  if (env.NEXT_PUBLIC_APP_ENV !== environment) errors.push('APP_ENV and NEXT_PUBLIC_APP_ENV must match');
  if (!env.AUTH_ALLOWED_EMAILS?.split(',').map((value) => value.trim()).filter(Boolean).length) {
    errors.push('AUTH_ALLOWED_EMAILS must contain at least one email address');
  }
  if (env.ADMINISTRATOR_EMAIL && !isPlaceholder(env.ADMINISTRATOR_EMAIL) && !emailPattern.test(env.ADMINISTRATOR_EMAIL.trim())) {
    errors.push('ADMINISTRATOR_EMAIL must be one email address');
  }
  if (env.INSTANCE_ID && !isPlaceholder(env.INSTANCE_ID) && !uuidPattern.test(env.INSTANCE_ID.trim())) {
    errors.push('INSTANCE_ID must be a UUID');
  }
  for (const name of ['PAID_ADAPTERS_ENABLED', 'SYNTHETIC_DATA_ENABLED']) {
    if (env[name] && !['true', 'false'].includes(env[name]!)) errors.push(`${name} must be true or false`);
  }

  if (env.NEXT_PUBLIC_SUPABASE_URL) {
    try {
      new URL(env.NEXT_PUBLIC_SUPABASE_URL);
    } catch {
      errors.push('NEXT_PUBLIC_SUPABASE_URL must be a valid URL');
    }
    if (environment === 'local' && !isLoopbackUrl(env.NEXT_PUBLIC_SUPABASE_URL)) {
      errors.push('APP_ENV=local is valid only against a loopback Supabase URL (127.0.0.1, localhost or [::1])');
    }
    if ((environment === 'staging' || environment === 'production') && !isHttpsUrl(env.NEXT_PUBLIC_SUPABASE_URL)) {
      errors.push('NEXT_PUBLIC_SUPABASE_URL must use https for staging and production');
    }
  }

  if (preview) {
    if (environment !== 'staging') errors.push('Vercel preview/development deployments must use APP_ENV=staging');
    if (env.SYNTHETIC_DATA_ENABLED !== 'true') errors.push('preview/development requires SYNTHETIC_DATA_ENABLED=true');
    if (env.PAID_ADAPTERS_ENABLED !== 'false') errors.push('preview/development requires PAID_ADAPTERS_ENABLED=false');
    const held = Object.keys(env).filter((name) => previewForbiddenName.test(name) && env[name]);
    if (held.length) errors.push(`preview/development deployments must hold no Supabase, database or Stripe variables: ${held.sort().join(', ')}`);
  }
  if (environment === 'production' && env.SYNTHETIC_DATA_ENABLED === 'true') errors.push('production cannot enable synthetic data');

  return errors;
}

export type IdentityRead = {identity?: InstanceIdentity; error?: string; retryable?: boolean};

function describeFetchFailure(error: unknown, origin: string, timeoutMs: number): IdentityRead {
  const name = typeof error === 'object' && error !== null ? String((error as {name?: unknown}).name) : '';
  const message = error instanceof Error ? error.message : '';
  const cause = error instanceof Error && error.cause instanceof Error ? `${error.cause.name} ${error.cause.message}` : '';
  if (name === 'TimeoutError' || name === 'AbortError') {
    return {error: `instance_identity cannot be verified: the database at ${origin} did not answer within ${Math.round(timeoutMs / 1000)} s`, retryable: true};
  }
  if (/redirect/i.test(message) || /redirect/i.test(cause)) {
    return {error: `instance_identity cannot be verified: ${origin} answered with a redirect, which is refused so the service key is never forwarded`, retryable: false};
  }
  if (/invalid header|invalid value/i.test(message)) {
    return {error: 'instance_identity cannot be read: SUPABASE_SERVICE_ROLE_KEY is not a valid HTTP header value', retryable: false};
  }
  return {error: `instance_identity cannot be verified: the database at ${origin} is unreachable`, retryable: true};
}

/**
 * Reads the single lifecycle.instance_identity row with the service role. `retryable` marks
 * failures that may clear on their own (network errors, timeouts, 5xx); everything else is final.
 */
export async function fetchInstanceIdentity(
  env: Env,
  fetchImpl: IdentityFetch = fetch,
  timeoutMs = 5000,
): Promise<IdentityRead> {
  const base = env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const key = env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!base || !key) return {error: 'instance_identity cannot be read: Supabase URL or service key is missing', retryable: false};

  let origin: string;
  let endpoint: string;
  try {
    const url = new URL(base);
    origin = url.origin;
    endpoint = `${origin}/rest/v1/instance_identity?select=environment,instance_id`;
  } catch {
    return {error: 'instance_identity cannot be read: NEXT_PUBLIC_SUPABASE_URL is not a valid URL', retryable: false};
  }

  const headers = {apikey: key, authorization: `Bearer ${key}`, 'accept-profile': 'lifecycle', accept: 'application/json'};
  try {
    new Headers(headers);
  } catch {
    return describeFetchFailure(new TypeError('invalid header value'), origin, timeoutMs);
  }

  let response: Response;
  try {
    // redirect: 'error' so the service key can never follow a redirect to another host.
    response = await fetchImpl(endpoint, {headers, redirect: 'error', signal: AbortSignal.timeout(timeoutMs), cache: 'no-store'});
  } catch (error) {
    return describeFetchFailure(error, origin, timeoutMs);
  }
  if (!response.ok) {
    return {
      error: `instance_identity cannot be verified: ${origin} answered HTTP ${response.status} (is the lifecycle schema exposed and the migration applied?)`,
      retryable: response.status >= 500,
    };
  }

  let rows: unknown;
  try {
    rows = await response.json();
  } catch {
    return {error: 'instance_identity cannot be verified: the response was not JSON', retryable: false};
  }
  if (!Array.isArray(rows) || rows.length === 0) return {error: 'instance_identity has no row: this database was never provisioned', retryable: false};
  if (rows.length > 1) return {error: 'instance_identity has more than one row', retryable: false};
  const row = rows[0] as Partial<InstanceIdentity> | null;
  if (!row || typeof row.environment !== 'string' || typeof row.instance_id !== 'string') {
    return {error: 'instance_identity row is malformed', retryable: false};
  }
  return {identity: {environment: row.environment, instance_id: row.instance_id}};
}

/** Compares the row with APP_ENV and INSTANCE_ID. Names the mismatch, never prints the UUIDs. */
export function compareIdentity(env: Env, identity: InstanceIdentity): string[] {
  const errors: string[] = [];
  if (identity.environment !== env.APP_ENV) {
    errors.push(`environment mismatch: the instance_identity row says "${identity.environment}" but APP_ENV is "${env.APP_ENV}"`);
  }
  if (identity.instance_id.toLowerCase() !== (env.INSTANCE_ID || '').trim().toLowerCase()) {
    errors.push('instance mismatch: INSTANCE_ID differs from the instance_identity row');
  }
  return errors;
}

/** One line that says how to repair a mismatch. Never contains a UUID or a key. */
export function identityMismatchHint(env: Env) {
  if (env.APP_ENV === 'local') return 'fix: run node scripts/setup-env.mjs local after supabase db reset, so INSTANCE_ID follows the local stack';
  return "fix: set INSTANCE_ID to the instance_id of this project's lifecycle.instance_identity row, and check that NEXT_PUBLIC_SUPABASE_URL belongs to this APP_ENV (docs/deployment-setup.md)";
}

/**
 * Full verification: labels and formats first, then the row. Previews never read the database.
 * Fails closed: an unreachable database or a missing row is an error. `retryable` is true only
 * for failures that may clear by themselves; a mismatch, an absent row or a 4xx is final.
 */
export async function checkInstanceIdentity(env: Env, fetchImpl: IdentityFetch = fetch): Promise<{errors: string[]; retryable: boolean}> {
  const errors = validateEnvironment(env);
  if (errors.length || isPreview(env)) return {errors, retryable: false};
  const {identity, error, retryable} = await fetchInstanceIdentity(env, fetchImpl);
  if (!identity) return {errors: [error ?? 'instance_identity cannot be verified'], retryable: Boolean(retryable)};
  const mismatches = compareIdentity(env, identity);
  return {errors: mismatches.length ? [...mismatches, identityMismatchHint(env)] : [], retryable: false};
}

export async function verifyInstanceIdentity(env: Env, fetchImpl: IdentityFetch = fetch): Promise<string[]> {
  return (await checkInstanceIdentity(env, fetchImpl)).errors;
}
