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
  'PAID_ADAPTERS_ENABLED',
  'SYNTHETIC_DATA_ENABLED',
];
const supabaseVariables = ['NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY'];
// A preview must hold none of these: any SUPABASE_* or NEXT_PUBLIC_SUPABASE_* variable, a database
// URL, POSTGRES_* or STRIPE_*, the account hashing keys (Story 1.3), the recovery hashing key and the mail key
// (Story 1.6), and any QSTASH_* name (Story 1.9: the queue's token, URL and signing keys: a preview has no schedule to verify, and the
// route fails closed without the keys), and any SERVICE_SIGNING_KEY_* name (Story 1.12: the private half of a service-signing key, which signs transfer
// tickets and gateway commands: a preview must never be able to), and the file gateway's two secrets (GATEWAY_DATABASE_URL, the password of its database
// role, and GATEWAY_STORAGE_S3_SECRET_ACCESS_KEY, its Storage key: only the gateway service holds them, and a preview is not that). The gateway's non-secret
// names (GATEWAY_STORAGE_S3_ACCESS_KEY_ID, GATEWAY_STORAGE_S3_ENDPOINT, GATEWAY_STORAGE_S3_REGION) are not forbidden. Previews are protected by this
// rejection, not by a database check. The QStash names and the application's gateway names (SERVICE_KEYS_APPLICATION, FILE_GATEWAY_URL,
// SERVICE_SIGNING_KEY_APPLICATION) are NOT added to the hosted required list
// (`requiredVariables`, `supabaseVariables`): the routes that use them answer 503 without them, and /api/health is unchanged.
const previewForbiddenName = /^(?:(?:NEXT_PUBLIC_)?SUPABASE_|POSTGRES_|(?:NEXT_PUBLIC_)?STRIPE_|QSTASH_|SERVICE_SIGNING_KEY_)|^DATABASE_URL$|^(?:INVITATION|RATE_LIMIT|RECOVERY)_HASH_KEY$|^RESEND_API_KEY$|^GATEWAY_DATABASE_URL$|^GATEWAY_STORAGE_S3_SECRET_ACCESS_KEY$/;
// Bare words are anchored so a real value such as todos@example.com is not mistaken for a placeholder.
const placeholder = /^(?:replace-with-|<[^>]+>)|^(?:changeme|todo)$/i;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const emailPattern = /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/;
/** RFC 5321 limit. The database refuses longer addresses too. */
export const maxEmailLength = 254;
export const isEmailAddress = (value: string) => value.length <= maxEmailLength && emailPattern.test(value);
const loopbackHost = /^(?:localhost|127(?:\.\d{1,3}){3}|\[::1\])$/;

// Story 1.3: keys under which invitation codes and client addresses are hashed before they reach the
// database; Story 1.6 adds the one under which an Administrator recovery token is hashed. Required at
// startup everywhere except a preview (which must not hold them), and checked for shape whenever they are
// set. Every one is a different key.
export const hashKeyVariables = ['INVITATION_HASH_KEY', 'RATE_LIMIT_HASH_KEY', 'RECOVERY_HASH_KEY'] as const;
export type HashKeyName = (typeof hashKeyVariables)[number];
export const minHashKeyBytes = 32;

export type CheckOptions = {
  /**
   * The hashing keys this run needs, required and checked for shape. Defaults to both, which is what the
   * server needs. The audited seed command asks only for the keys its command uses.
   */
  hashKeys?: readonly HashKeyName[];
  /** Also call the accounts API's api.preflight, which really reads the tables the gate depends on, and expect ok: the hosted preflight. */
  accountsApi?: boolean;
  /**
   * Whether a staging or production environment must also hold what sends the recovery mail: RESEND_API_KEY and
   * APP_ORIGIN (Story 1.6). Defaults to true, which is what the server needs. The audited seed command, which sends no
   * mail, turns it off.
   */
  mail?: boolean;
};
const base64Text = /^[A-Za-z0-9+/_-]+={0,2}$/;

/** Decodes a hash key the one way every caller does: base64 (standard or URL-safe, padding optional). */
export function decodeHashKey(value: string) {
  return Buffer.from(value.trim(), 'base64');
}

/**
 * Why a hash key is unusable, or null. Names the problem, never the value. A key is base64 text of at
 * least 32 bytes (`openssl rand -base64 32`) with enough variety to rule out a typed-in or repeated value.
 */
export function hashKeyProblem(value: string): string | null {
  const text = value.trim();
  if (isPlaceholder(text)) return 'is a placeholder';
  if (!base64Text.test(text)) return 'must be base64 text, for example from `openssl rand -base64 32`';
  if (decodeHashKey(text).length < minHashKeyBytes) return `must decode to at least ${minHashKeyBytes} bytes`;
  if (new Set(text).size < 10) return 'is not random (too few distinct characters)';
  return null;
}

/**
 * The value of an environment-file line the way Node's `--env-file` reads it: a quoted value runs to its
 * closing quote, an unquoted one ends at the first ` #` (a trailing comment) and is trimmed.
 */
export function parseEnvValue(raw: string) {
  const text = raw.trim();
  const quote = /^(["'`])/.exec(text)?.[1];
  if (quote) {
    const end = text.indexOf(quote, 1);
    if (end > 0) return text.slice(1, end);
  }
  return text.replace(/(^|\s)#.*$/, '').trim();
}

/** Two key values are the same key when they decode to the same bytes, however they are spelled. */
export function sameKey(a: string, b: string) {
  return decodeHashKey(a).equals(decodeHashKey(b));
}

/** SEED_ACCOUNT_EMAILS as lowercase, de-duplicated addresses. Invalid entries are kept so the caller can name them. */
export function parseEmailList(value: string | undefined) {
  const entries = (value ?? '').split(',').map((entry) => entry.trim().toLowerCase()).filter(Boolean);
  return [...new Set(entries)];
}

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

/**
 * Why APP_ORIGIN (the origin of the application's own links, Story 1.6) is unusable, or null: it must be an origin and
 * nothing more (a scheme and a host, optionally a port; no path, query, fragment or credentials), and https for staging
 * and production. Locally the recovery link is built from the request's own origin and this is not read.
 */
export function appOriginProblem(value: string, environment?: string): string | null {
  const text = value.trim();
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return 'must be an origin such as https://nova3d.example (a scheme and a host)';
  }
  if (url.origin === 'null' || url.origin !== text || url.username || url.password) {
    return 'must be an origin and nothing more: a scheme and a host (and a port), with no path, query, fragment or credentials';
  }
  if ((environment === 'staging' || environment === 'production') && url.protocol !== 'https:') return 'must be an https origin for staging and production';
  return null;
}

/** Label and format checks. Reads no network. Returns one message per problem. */
export function validateEnvironment(env: Env, options: CheckOptions = {}): string[] {
  const errors: string[] = [];
  const environment = env.APP_ENV;
  const preview = isPreview(env);
  const keys = options.hashKeys ?? hashKeyVariables;
  // Hosted environments send the recovery mail through Resend and build its link from APP_ORIGIN (Story 1.6); the local
  // stack sends it to its own Mailpit and uses the request's origin.
  const hostedMail = !preview && options.mail !== false && (environment === 'staging' || environment === 'production') ? ['RESEND_API_KEY', 'APP_ORIGIN'] : [];
  const needed = preview ? requiredVariables : [...requiredVariables, ...supabaseVariables, ...keys, ...hostedMail];

  const missing = needed.filter((name) => !env[name]?.trim());
  const placeholders = needed.filter((name) => isPlaceholder(env[name]));

  if (!appEnvironments.includes(environment as AppEnvironment)) errors.push('APP_ENV must be local, staging, or production');
  if (missing.length) errors.push(`missing required variables: ${missing.join(', ')}`);
  if (placeholders.length) errors.push(`placeholder values are not allowed: ${placeholders.join(', ')}`);
  if (env.NEXT_PUBLIC_APP_ENV !== environment) errors.push('APP_ENV and NEXT_PUBLIC_APP_ENV must match');
  if (env.ADMINISTRATOR_EMAIL && !isPlaceholder(env.ADMINISTRATOR_EMAIL) && !isEmailAddress(env.ADMINISTRATOR_EMAIL.trim())) {
    errors.push(`ADMINISTRATOR_EMAIL must be one email address of at most ${maxEmailLength} characters`);
  }
  if (env.INSTANCE_ID && !isPlaceholder(env.INSTANCE_ID) && !uuidPattern.test(env.INSTANCE_ID.trim())) {
    errors.push('INSTANCE_ID must be a UUID');
  }
  for (const name of ['PAID_ADAPTERS_ENABLED', 'SYNTHETIC_DATA_ENABLED']) {
    if (env[name] && !['true', 'false'].includes(env[name]!)) errors.push(`${name} must be true or false`);
  }
  for (const name of keys) {
    const problem = env[name]?.trim() ? hashKeyProblem(env[name]!) : null;
    if (problem) errors.push(`${name} ${problem}`);
  }
  // No two hashing keys are the same key: a hash under one must never be valid under another.
  const usable = keys.filter((name) => env[name]?.trim() && !hashKeyProblem(env[name]!));
  for (const [index, first] of usable.entries()) {
    for (const second of usable.slice(index + 1)) {
      if (sameKey(env[first]!, env[second]!)) errors.push(`${first} and ${second} must be different keys`);
    }
  }
  if (env.RESEND_API_KEY?.trim() && !isPlaceholder(env.RESEND_API_KEY) && /\s/.test(env.RESEND_API_KEY.trim())) {
    errors.push('RESEND_API_KEY must be one token without spaces');
  }
  if (env.APP_ORIGIN?.trim() && !isPlaceholder(env.APP_ORIGIN)) {
    const problem = appOriginProblem(env.APP_ORIGIN, environment);
    if (problem) errors.push(`APP_ORIGIN ${problem}`);
  }
  if (env.SEED_ACCOUNT_EMAILS?.trim() && !parseEmailList(env.SEED_ACCOUNT_EMAILS).every(isEmailAddress)) {
    errors.push(`SEED_ACCOUNT_EMAILS must be a comma-separated list of email addresses (each at most ${maxEmailLength} characters)`);
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
    if (held.length) errors.push(`preview/development deployments must hold no Supabase, database or Stripe variables, account hashing keys, mail key, service-signing keys, file gateway secrets or QStash variables: ${held.sort().join(', ')}`);
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

/**
 * The hosted preflight (Stories 1.3 and 1.4a): calls api.preflight with the service role, which reads one row
 * at most of each table the gate depends on (the grants, the Accounts, and Auth's sessions and identities) and
 * answers ok. It fails with one line when the `api` schema is not exposed, the migrations are not applied, the
 * service key is wrong, a privilege on one of those tables is missing (the hosted `auth` tables in
 * particular), or the database does not answer. It cannot tell an unseeded database from a seeded one, and does not try: an unseeded deployment
 * locks everyone out (see docs/deployment-setup.md).
 */
export async function checkAccountsApi(env: Env, fetchImpl: IdentityFetch = fetch, timeoutMs = 5000): Promise<IdentityRead> {
  const base = env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const key = env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!base || !key) return {error: 'the accounts API cannot be checked: Supabase URL or service key is missing', retryable: false};
  let origin: string;
  try {
    origin = new URL(base).origin;
  } catch {
    return {error: 'the accounts API cannot be checked: NEXT_PUBLIC_SUPABASE_URL is not a valid URL', retryable: false};
  }
  const headers = {apikey: key, authorization: `Bearer ${key}`, 'content-type': 'application/json', 'content-profile': 'api', accept: 'application/json'};
  try {
    new Headers(headers);
  } catch {
    return {error: 'the accounts API cannot be checked: SUPABASE_SERVICE_ROLE_KEY is not a valid HTTP header value', retryable: false};
  }

  let response: Response;
  try {
    // redirect: 'error' so the service key can never follow a redirect to another host.
    response = await fetchImpl(`${origin}/rest/v1/rpc/preflight`, {
      method: 'POST',
      headers,
      body: JSON.stringify({}),
      redirect: 'error',
      signal: AbortSignal.timeout(timeoutMs),
      cache: 'no-store',
    });
  } catch (error) {
    const name = typeof error === 'object' && error !== null ? String((error as {name?: unknown}).name) : '';
    const slow = name === 'TimeoutError' || name === 'AbortError';
    return {error: `the accounts API cannot be verified: the database at ${origin} ${slow ? `did not answer within ${Math.round(timeoutMs / 1000)} s` : 'is unreachable'}`, retryable: true};
  }
  if (!response.ok) {
    return {
      error: `the accounts API cannot be verified: ${origin} answered HTTP ${response.status} for api.preflight (is the api schema exposed, the Story 1.3 and 1.4a migrations applied, the service key right and every table it reads readable?)`,
      retryable: response.status >= 500,
    };
  }
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return {error: 'the accounts API cannot be verified: api.preflight did not answer with JSON', retryable: false};
  }
  if (typeof body !== 'object' || body === null || (body as {ok?: unknown}).ok !== true) {
    return {error: 'the accounts API cannot be verified: api.preflight did not answer ok (are the Story 1.3 and 1.4a migrations applied to this database?)', retryable: false};
  }
  return {};
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
export async function checkInstanceIdentity(env: Env, fetchImpl: IdentityFetch = fetch, options: CheckOptions = {}): Promise<{errors: string[]; retryable: boolean}> {
  const errors = validateEnvironment(env, options);
  if (errors.length || isPreview(env)) return {errors, retryable: false};
  const {identity, error, retryable} = await fetchInstanceIdentity(env, fetchImpl);
  if (!identity) return {errors: [error ?? 'instance_identity cannot be verified'], retryable: Boolean(retryable)};
  const mismatches = compareIdentity(env, identity);
  if (mismatches.length) return {errors: [...mismatches, identityMismatchHint(env)], retryable: false};
  if (options.accountsApi) {
    const accounts = await checkAccountsApi(env, fetchImpl);
    if (accounts.error) return {errors: [accounts.error], retryable: Boolean(accounts.retryable)};
  }
  return {errors: [], retryable: false};
}

export async function verifyInstanceIdentity(env: Env, fetchImpl: IdentityFetch = fetch, options: CheckOptions = {}): Promise<string[]> {
  return (await checkInstanceIdentity(env, fetchImpl, options)).errors;
}
