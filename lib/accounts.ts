// Story 1.3 (Part A). The application side of invitation-only Accounts: invitation code generation,
// keyed hashing, and typed calls to the `api` schema with the service role.
//
// SERVER-ONLY. This module reads INVITATION_HASH_KEY, RATE_LIMIT_HASH_KEY, RECOVERY_HASH_KEY and the
// service-role key, none of which may reach a browser. It is not marked with the `server-only` package because the
// audited seed command (scripts/seed-accounts.mjs) imports it directly through Node type stripping,
// where that package throws. Instead it refuses to load in a browser, uses node:crypto (which a client
// bundle cannot resolve), and tests/unit/accounts.test.ts fails if a client component, or anything under
// components/, imports it. Story 1.4d looked at this again and left it as it is: the `server-only` package
// would be a new dependency (an ask-first decision) and the seed script still imports this module, so the
// guard stays by test. Which module may call which typed call is pinned by tests/unit/gate-structure.test.ts.
//
// Like lib/environment.ts it uses erasable TypeScript syntax only and relative `.ts` imports.
//
// The database never sees a raw invitation code or a client address. This module hashes both with
// HMAC-SHA256 under keys that exist only in the server environment, and passes the hashes in.
// No function here logs, and no error message contains a code, an address, a hash or a key.
import {createHmac, randomBytes} from 'node:crypto';
import {isIPv4, isIPv6} from 'node:net';
import {decodeHashKey, hashKeyProblem, hashKeyVariables, isEmailAddress, isPlaceholder, type Env} from './environment.ts';
import {recoveryTokenPattern} from './recovery-state.ts';
import {consumedStepUpClasses, stepUpClasses, type StepUpClass} from './step-up.ts';

if (typeof window !== 'undefined') {
  throw new Error('lib/accounts.ts is server-only and must not be imported by browser code.');
}

// Invitation codes ------------------------------------------------------------------------------

/** 20 random bytes from the operating system's CSPRNG: 160 bits, above the 128-bit floor. */
export const invitationCodeBytes = 20;
export const invitationCodeEntropyBits = invitationCodeBytes * 8;

// Crockford base32: no I, L, O or U, so a code read aloud or typed from paper is hard to get wrong.
const alphabet = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const groupSize = 4;
const maxCodeInput = 128;

function encodeBase32(bytes: Uint8Array) {
  let bits = 0;
  let buffer = 0;
  let out = '';
  for (const byte of bytes) {
    buffer = (buffer << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += alphabet[(buffer >>> (bits - 5)) & 31];
      bits -= 5;
    }
    buffer &= (1 << bits) - 1;
  }
  if (bits > 0) out += alphabet[(buffer << (5 - bits)) & 31];
  return out;
}

/** A new invitation code such as `7H2K-9QXM-...` (eight groups of four). Shown once; only its hash is stored. */
export function generateInvitationCode(random: (size: number) => Uint8Array = randomBytes): string {
  const bytes = random(invitationCodeBytes);
  if (bytes.length !== invitationCodeBytes) throw new Error('The random source returned the wrong number of bytes.');
  const text = encodeBase32(bytes);
  return text.match(new RegExp(`.{1,${groupSize}}`, 'g'))!.join('-');
}

/**
 * The one spelling of a code that is hashed: upper case, without whitespace or any hyphen or dash
 * (ASCII hyphen, U+2010 to U+2015, U+2212) and with the Crockford look-alikes folded (O to 0, I and L to
 * 1). The input is cut to a bounded length before it is normalized, and anything that is not a string is
 * an empty code. Never throws: malformed input simply is not shaped like a code (see
 * looksLikeInvitationCode), and registerWithCode answers it without calling the database.
 */
export function canonicalizeInvitationCode(input: unknown) {
  if (typeof input !== 'string') return '';
  return input
    .slice(0, maxCodeInput * 4)
    .normalize('NFKC')
    .toUpperCase()
    .replace(/[\s\-\u2010-\u2015\u2212]+/g, '')
    .replace(/O/g, '0')
    .replace(/[IL]/g, '1')
    .slice(0, maxCodeInput);
}

/** True when the text is shaped like a code this module issues (after canonicalizing). */
export function looksLikeInvitationCode(input: unknown) {
  return new RegExp(`^[${alphabet}]{${Math.ceil(invitationCodeBytes * 8 / 5)}}$`).test(canonicalizeInvitationCode(input));
}

// Keys and hashing -------------------------------------------------------------------------------

export class AccountsConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AccountsConfigError';
  }
}

/** The key behind a variable, or an AccountsConfigError that names the variable and the problem, never the value. */
export function hashKey(env: Env, name: (typeof hashKeyVariables)[number]) {
  const value = env[name];
  if (!value?.trim()) throw new AccountsConfigError(`${name} is not set`);
  const problem = hashKeyProblem(value);
  if (problem) throw new AccountsConfigError(`${name} ${problem}`);
  return decodeHashKey(value);
}

function hmacHex(key: Uint8Array, domain: string, message: string) {
  return createHmac('sha256', key).update(`${domain}\0${message}`).digest('hex');
}

/** Hex HMAC-SHA256 of the canonical code under INVITATION_HASH_KEY: what the database stores and compares. */
export function hashInvitationCode(code: string, key: Uint8Array) {
  return hmacHex(key, 'nova3d/invitation-code/v1', canonicalizeInvitationCode(code));
}

// Client addresses ------------------------------------------------------------------------------

const maxAddressLength = 64;

/** The eight 16-bit groups of an address that node:net has already accepted as IPv6 (zone removed). */
function ipv6Groups(address: string) {
  let text = address;
  const dotted = /(\d+\.\d+\.\d+\.\d+)$/.exec(text);
  if (dotted) {
    const [a, b, c, d] = dotted[1].split('.').map(Number);
    text = `${text.slice(0, -dotted[1].length)}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }
  const [head, tail] = text.split('::');
  const left = head ? head.split(':') : [];
  const right = tail ? tail.split(':') : [];
  const fill = text.includes('::') ? 8 - left.length - right.length : 0;
  return [...left, ...Array<string>(fill).fill('0'), ...right].map((group) => parseInt(group, 16));
}

/**
 * The network origin of a reported address. IPv4 is kept whole; IPv6 is reduced to its /64 network, since
 * one subscriber commonly holds a whole /64 and could otherwise rotate addresses to dodge the limit; an
 * IPv4-mapped IPv6 address counts as its IPv4. Validity is node:net's (isIPv4, isIPv6). Anything missing,
 * over 64 characters or invalid becomes one shared `unknown` origin, which fails closed: it shares a single
 * budget instead of escaping the limit.
 */
export function normalizeClientAddress(address: string | null | undefined) {
  let text = typeof address === 'string' ? address.trim().toLowerCase() : '';
  if (!text || text.length > maxAddressLength) return 'unknown';
  if (text.startsWith('[') && text.endsWith(']')) text = text.slice(1, -1);
  if (isIPv4(text)) return text;
  if (!isIPv6(text)) return 'unknown';
  const groups = ipv6Groups(text.replace(/%.*$/, ''));
  if (groups.slice(0, 5).every((group) => group === 0) && groups[5] === 0xffff) {
    return [groups[6] >> 8, groups[6] & 255, groups[7] >> 8, groups[7] & 255].join('.');
  }
  return `${groups.slice(0, 4).map((group) => group.toString(16)).join(':')}::/64`;
}

/** Hex HMAC-SHA256 of the normalized client address under RATE_LIMIT_HASH_KEY. The address itself is never kept. */
export function hashClientAddress(address: string | null | undefined, key: Uint8Array) {
  return hmacHex(key, 'nova3d/client-address/v1', normalizeClientAddress(address));
}

type HeaderReader = {get(name: string): string | null};

/**
 * The client address the platform reports, or null. Only a deployment on Vercel (VERCEL is set) has a
 * platform that overwrites `x-vercel-forwarded-for` and `x-forwarded-for` with the connecting client, so
 * only there is the first entry of the first usable header believed; anywhere else a caller could send
 * any value, so every request shares the `unknown` origin. A header longer than 64 characters or whose
 * first entry is not an IP address is ignored.
 */
export function clientAddressFromHeaders(headers: HeaderReader, env: Env = process.env) {
  if (!env.VERCEL) return null;
  for (const name of ['x-vercel-forwarded-for', 'x-real-ip', 'x-forwarded-for']) {
    const value = headers.get(name);
    if (!value || value.length > maxAddressLength) continue;
    const first = value.split(',')[0].trim();
    if (normalizeClientAddress(first) !== 'unknown') return first;
  }
  return null;
}

// Typed service-role calls -----------------------------------------------------------------------

/**
 * The database could not be reached or answered with an error. Registration treats this as a closed door.
 * `retryable` is true for a network failure, a timeout or an HTTP 5xx, and false for a request the
 * database understood and rejected (a 4xx such as 42501 or 22023). `outcomeUnknown` is true whenever the
 * request may have reached the database, so a command that issues something must not assume it did not.
 */
export class AccountsUnavailableError extends Error {
  readonly status: number | undefined;
  readonly code: string | undefined;
  readonly retryable: boolean;
  readonly outcomeUnknown: boolean;
  constructor(message: string, details: {status?: number; code?: string; retryable?: boolean; outcomeUnknown?: boolean} = {}) {
    super(message);
    this.name = 'AccountsUnavailableError';
    this.status = details.status;
    this.code = details.code;
    this.retryable = details.retryable ?? false;
    this.outcomeUnknown = details.outcomeUnknown ?? this.retryable;
  }
}

export type AccountsOptions = {
  env?: Env;
  fetch?: (input: string, init?: RequestInit) => Promise<Response>;
  timeoutMs?: number;
};

export type Role = 'administrator' | 'member';

export type RegistrationReceipt = {
  commandId: string;
  /**
   * `refused` covers a bad, used, revoked or never-issued code and every expected failure alike.
   * `disabled` is an Account that exists but is disabled: never a success.
   */
  outcome: 'registered' | 'refused' | 'limited' | 'disabled';
  accountId: string | null;
  workspaceId: string | null;
  role: Role | null;
  replayed: boolean;
};

export type ActivationReceipt = {
  outcome: 'registered' | 'active' | 'disabled' | 'none' | 'refused';
  accountId: string | null;
  workspaceId: string | null;
  role: Role | null;
};

export type AccountState = {
  status: 'none' | 'active' | 'disabled';
  accountId: string | null;
  workspaceId: string | null;
  role: Role | null;
};

/**
 * What api.authorize_session says about a user's session. Only `active` is access. `unregistered` is a user
 * with no Account (it may reach the registration screen), `disabled` an Account that is disabled, and the
 * rest are a session that holds no valid grant: Auth no longer has the session (`no_session`), none issued,
 * revoked, older than 30 days, idle for more than 7, issued under an older epoch than the Account's, or
 * (`subject_mismatch`) an Auth user whose Google identity is no longer the one pinned to the Account.
 */
export type AuthorizationState = 'active' | 'unregistered' | 'disabled' | 'no_session' | 'no_grant' | 'revoked' | 'expired' | 'idle' | 'stale_epoch' | 'subject_mismatch';
export const authorizationStates: readonly AuthorizationState[] = ['active', 'unregistered', 'disabled', 'no_session', 'no_grant', 'revoked', 'expired', 'idle', 'stale_epoch', 'subject_mismatch'];

/**
 * The Account, Workspace, role and epoch are present only when the state is `active`. So is `preferences`
 * (Story 1.4d), and even then it is null for an Account with no record: the Account's preferences record as the
 * database returned it, unvalidated (lib/preferences.ts `parsePreferenceRecord` is what reads it).
 */
export type SessionAuthorization = {
  state: AuthorizationState;
  accountId: string | null;
  workspaceId: string | null;
  role: Role | null;
  epoch: number | null;
  preferences: Record<string, unknown> | null;
};

export const grantOutcomes = ['issued', 'exists', 'revoked', 'expired', 'idle', 'stale', 'no_account', 'disabled', 'no_session', 'subject_mismatch'] as const;
export type GrantOutcome = (typeof grantOutcomes)[number];
export type GrantReceipt = {outcome: GrantOutcome; accountId: string | null; epoch: number | null};
/**
 * How many grants a revocation ended (`revoked`; a grant that was already revoked is not counted) and, of
 * those, how many were still valid (`live`): the sessions a person is told were signed out.
 */
export type GrantRevocation = {revoked: number; live: number};
export type EpochReceipt = {accountId: string; epoch: number | null};

/**
 * api.start_step_up: `started` (a nonce now exists, valid until `expiresAt`), `limited` (10 starts in the last hour
 * for this Account; nothing was started or voided) or `refused` (the session does not hold a valid grant of an
 * active Account, or the Google identity is not the pinned one).
 */
export type StepUpStartReceipt = {outcome: 'started' | 'limited' | 'refused'; expiresAt: string | null};
/**
 * api.complete_step_up: `accepted` (the new session has its grant and its marker, the initiating grant is
 * revoked), `rejected` (this was the step-up's own sign-in, but it cannot be accepted: `reason` says why, and the
 * caller must end only the new session) or `not_step_up` (the sign-in is not this step-up's: an ordinary sign-in).
 */
export type StepUpReceipt = {
  outcome: 'accepted' | 'rejected' | 'not_step_up';
  reason: string | null;
  actionClass: StepUpClass | null;
};
export const markerOutcomes = ['allowed', 'none', 'expired', 'used', 'stale', 'denied'] as const;
export type MarkerOutcome = (typeof markerOutcomes)[number];

/**
 * api.issue_csrf: `issued` (the hash is now the grant's, so the caller delivers the token it is the hash of),
 * `exists` (the grant holds a hash under a minute old, left as it was: the caller delivers nothing) or `denied`
 * (the session does not hold a valid grant of an active Account).
 */
export const csrfIssueOutcomes = ['issued', 'exists', 'denied'] as const;
export type CsrfIssueOutcome = (typeof csrfIssueOutcomes)[number];
/** api.verify_csrf: `valid` is the only permission. `denied` is a session that no longer holds a valid grant. */
export const csrfCheckOutcomes = ['valid', 'invalid', 'denied'] as const;
export type CsrfCheckOutcome = (typeof csrfCheckOutcomes)[number];

export type PreauthorizationReceipt = {
  preauthorizationId: string;
  role: Role;
  created: boolean;
  consumed: boolean;
  /** Administrator pre-authorizations of other addresses: more than zero means a second Administrator is being seeded. */
  otherAdministrators: number;
};
export type IssuedInvitation = {outcome: 'issued'; code: string; invitationId: string; kind: 'named' | 'general'; replacedInvitationId: string | null};
/** A current general code (or this code's hash) already exists. No code was stored, so none is returned. */
export type ExistingInvitation = {outcome: 'exists'; invitationId: string | null; kind: 'named' | 'general'};
export type RevocationReceipt = {invitationId: string | null; outcome: 'revoked' | 'already_revoked' | 'redeemed' | 'not_found'};
export type WithdrawalReceipt = {outcome: 'withdrawn' | 'consumed' | 'not_found'};
export type InvitationSummary = {invitationId: string; kind: 'named' | 'general'; label: string | null; state: 'unused' | 'redeemed' | 'revoked'; createdAt: string};

// Story 1.7: the call helpers below are exported for lib/projects.ts, which makes the typed calls of the Projects functions in the
// same way (the service role, an `api` function, an answer read and checked, never trusted). Nothing else outside this file calls them.
export type Row = Record<string, unknown>;

export async function callApi(name: string, args: Row, options: AccountsOptions): Promise<unknown> {
  const env = options.env ?? process.env;
  const base = env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!base) throw new AccountsConfigError('NEXT_PUBLIC_SUPABASE_URL is not set');
  if (!serviceKey || isPlaceholder(serviceKey)) throw new AccountsConfigError('SUPABASE_SERVICE_ROLE_KEY is not set');
  let origin: string;
  try {
    origin = new URL(base).origin;
  } catch {
    throw new AccountsConfigError('NEXT_PUBLIC_SUPABASE_URL is not a valid URL');
  }

  const headers = {
    apikey: serviceKey,
    authorization: `Bearer ${serviceKey}`,
    'content-type': 'application/json',
    'content-profile': 'api',
    accept: 'application/json',
  };
  try {
    new Headers(headers);
  } catch {
    throw new AccountsConfigError('SUPABASE_SERVICE_ROLE_KEY is not a valid HTTP header value');
  }

  let response: Response;
  try {
    // redirect: 'error' so the service key can never follow a redirect to another host.
    response = await (options.fetch ?? fetch)(`${origin}/rest/v1/rpc/${name}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(args),
      redirect: 'error',
      signal: AbortSignal.timeout(options.timeoutMs ?? 10_000),
      cache: 'no-store',
    });
  } catch {
    throw new AccountsUnavailableError('The accounts database did not answer.', {retryable: true});
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    body = undefined;
  }
  if (!response.ok) {
    const code = typeof (body as Row | undefined)?.code === 'string' ? ((body as Row).code as string) : undefined;
    throw new AccountsUnavailableError(`The accounts database refused the call (HTTP ${response.status}).`, {
      status: response.status,
      code,
      retryable: response.status >= 500,
      outcomeUnknown: response.status >= 500,
    });
  }
  return body;
}

export const unexpected = (status?: number) =>
  new AccountsUnavailableError('The accounts database answered with an unexpected shape.', {status, retryable: false, outcomeUnknown: true});

export async function callRow(name: string, args: Row, options: AccountsOptions): Promise<Row> {
  const body = await callApi(name, args, options);
  if (typeof body !== 'object' || body === null || Array.isArray(body)) throw unexpected();
  return body as Row;
}

const text = (value: unknown) => (typeof value === 'string' ? value : null);
const roleOf = (value: unknown): Role | null => (value === 'administrator' || value === 'member' ? value : null);
export function oneOf<T extends string>(value: unknown, allowed: readonly T[]): T {
  if (typeof value === 'string' && (allowed as readonly string[]).includes(value)) return value as T;
  throw unexpected();
}

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function requireUuid(name: string, value: string) {
  if (!uuidPattern.test(value)) throw new TypeError(`${name} must be a UUID`);
  return value.toLowerCase();
}

/**
 * Redeems an invitation code for a signed-in Auth user. `commandId` identifies the attempt: repeat it,
 * with the same code, to get the original receipt back. Fails closed: if the database cannot be reached
 * this throws, and no Account exists. Input that is not shaped like a code is refused here, generically,
 * without calling the database and without using any of the limiter's budget.
 */
export async function registerWithCode(
  input: {userId: string; commandId: string; code: string; clientAddress: string | null | undefined},
  options: AccountsOptions = {},
): Promise<RegistrationReceipt> {
  const env = options.env ?? process.env;
  const userId = requireUuid('userId', input.userId);
  const commandId = requireUuid('commandId', input.commandId);
  const invitationKey = hashKey(env, 'INVITATION_HASH_KEY');
  const rateLimitKey = hashKey(env, 'RATE_LIMIT_HASH_KEY');
  if (!looksLikeInvitationCode(input.code)) {
    return {commandId, outcome: 'refused', accountId: null, workspaceId: null, role: null, replayed: false};
  }
  const row = await callRow(
    'register_with_code',
    {
      p_user_id: userId,
      p_command_id: commandId,
      p_code_hash: hashInvitationCode(input.code, invitationKey),
      p_origin_hash: hashClientAddress(input.clientAddress, rateLimitKey),
    },
    options,
  );
  return {
    commandId: text(row.command_id) ?? commandId,
    outcome: oneOf(row.outcome, ['registered', 'refused', 'limited', 'disabled'] as const),
    accountId: text(row.account_id),
    workspaceId: text(row.workspace_id),
    role: roleOf(row.role),
    replayed: row.replayed === true,
  };
}

/** Consumes the pre-authorization of the signed-in user's verified Google address, if one exists. */
export async function consumePreauthorization(userId: string, options: AccountsOptions = {}): Promise<ActivationReceipt> {
  const row = await callRow('consume_preauthorization', {p_user_id: requireUuid('userId', userId)}, options);
  return {
    outcome: oneOf(row.outcome, ['registered', 'active', 'disabled', 'none', 'refused'] as const),
    accountId: text(row.account_id),
    workspaceId: text(row.workspace_id),
    role: roleOf(row.role),
  };
}

/**
 * The Account state of an Auth user: none, active or disabled. Story 1.4a's gate no longer uses it
 * (`authorizeSession` answers the Account and the session's grant in one call); it stays as the plain
 * Account read of Story 1.3, which has its own tests.
 */
export async function accountStatus(userId: string, options: AccountsOptions = {}): Promise<AccountState> {
  const row = await callRow('account_status', {p_user_id: requireUuid('userId', userId)}, options);
  return {
    status: oneOf(row.status, ['none', 'active', 'disabled'] as const),
    accountId: text(row.account_id),
    workspaceId: text(row.workspace_id),
    role: roleOf(row.role),
  };
}

const count = (value: unknown) => (typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : null);

/**
 * The live authorization of a private request (Story 1.4a): the Account state, then the session grant, in one
 * call. The user ID is the verified Auth user's and the session ID the one in the verified access token; the
 * caller never takes either from a client. Anything but `active` is not access. Fails closed: if the database
 * cannot be reached this throws.
 */
export async function authorizeSession(userId: string, sessionId: string, options: AccountsOptions = {}): Promise<SessionAuthorization> {
  const row = await callRow('authorize_session', {p_user_id: requireUuid('userId', userId), p_session_id: requireUuid('sessionId', sessionId)}, options);
  const state = oneOf(row.state, authorizationStates);
  if (state !== 'active') return {state, accountId: null, workspaceId: null, role: null, epoch: null, preferences: null};
  const accountId = text(row.account_id);
  const role = roleOf(row.role);
  const epoch = count(row.epoch);
  // An active answer that does not name its Account, role and epoch is not an answer.
  if (!accountId || !role || epoch === null) throw unexpected();
  // The preferences record is not part of the decision: an answer without one (or with one that is not an object)
  // is an Account with no record, never a reason to refuse access.
  const preferences = typeof row.preferences === 'object' && row.preferences !== null && !Array.isArray(row.preferences) ? (row.preferences as Row) : null;
  return {state, accountId, workspaceId: text(row.workspace_id), role, epoch, preferences};
}

/**
 * Issues the grant of the verified session, once it belongs to an active Account (Story 1.4a). Idempotent:
 * `issued` the first time and `exists` after. Anything else is not a grant: a revoked or stale one, a
 * session Auth does not have, a disabled Account, or a Google identity that is not the pinned one.
 */
export async function issueGrant(userId: string, sessionId: string, options: AccountsOptions = {}): Promise<GrantReceipt> {
  const row = await callRow('issue_grant', {p_user_id: requireUuid('userId', userId), p_session_id: requireUuid('sessionId', sessionId)}, options);
  const outcome = oneOf(row.outcome, grantOutcomes);
  // Every answer but "no such Account" comes from a known Account, which has an epoch.
  if (outcome === 'no_account') return {outcome, accountId: null, epoch: null};
  const accountId = text(row.account_id);
  const epoch = count(row.epoch);
  if (!accountId || epoch === null) throw unexpected();
  return {outcome, accountId, epoch};
}

const csrfHashPattern = /^[0-9a-f]{64}$/;

/**
 * Stores the hash of a new CSRF token on the grant of the verified session (Story 1.4c), when the grant has no
 * hash or its hash is 60 seconds old or older. The user is the verified Auth user's and the session the verified
 * access token's, never a client's; the hash is the SHA-256 of a token the server has just minted
 * (hashCsrfToken in lib/request-integrity.ts), and the token itself never comes here. Only `issued` means the
 * caller may deliver the token. If this throws, nothing is known to be stored and nothing is delivered.
 */
export async function issueCsrf(input: {userId: string; sessionId: string; hash: string}, options: AccountsOptions = {}): Promise<CsrfIssueOutcome> {
  if (!csrfHashPattern.test(input.hash)) throw new TypeError('hash must be a hex SHA-256');
  const row = await callRow(
    'issue_csrf',
    {p_user_id: requireUuid('userId', input.userId), p_session_id: requireUuid('sessionId', input.sessionId), p_csrf_hash: input.hash},
    options,
  );
  return oneOf(row.outcome, csrfIssueOutcomes);
}

/**
 * Compares the hash of a request's CSRF token with the one on the grant of the verified session (Story 1.4c).
 * Only `valid` is permission. Fails closed: if the database cannot be reached this throws, and the caller
 * refuses the request as retryable.
 */
export async function verifyCsrf(input: {userId: string; sessionId: string; hash: string}, options: AccountsOptions = {}): Promise<CsrfCheckOutcome> {
  if (!csrfHashPattern.test(input.hash)) throw new TypeError('hash must be a hex SHA-256');
  const row = await callRow(
    'verify_csrf',
    {p_user_id: requireUuid('userId', input.userId), p_session_id: requireUuid('sessionId', input.sessionId), p_csrf_hash: input.hash},
    options,
  );
  return oneOf(row.outcome, csrfCheckOutcomes);
}

/**
 * api.adopt_preferences: `created` (the Account had no record and now has the device's), `exists` (it already had
 * one, left as it was; this is also what the loser of two first requests at once gets) or `denied` (no such
 * Account, or it is not active).
 */
export const preferenceAdoptionOutcomes = ['created', 'exists', 'denied'] as const;
export type PreferenceAdoptionOutcome = (typeof preferenceAdoptionOutcomes)[number];
/** api.set_preference: `saved`, or `denied` (no such Account, or it is not active). */
export const preferenceSaveOutcomes = ['saved', 'denied'] as const;
export type PreferenceSaveOutcome = (typeof preferenceSaveOutcomes)[number];

const preferenceNamePattern = /^(?:locale|theme|detail|guidance)$/;
// A preference value is a short word; anything longer is not one, whatever the database would say.
const maxPreferenceValue = 16;
function requirePreferenceText(name: string, value: string | null, allowNull: boolean) {
  if (value === null && allowNull) return null;
  if (typeof value !== 'string' || !value || value.length > maxPreferenceValue) throw new TypeError(`${name} must be a short word${allowNull ? ' or null' : ''}`);
  return value;
}

/**
 * Adopts the device's choices as the Account's preferences record, when the Account has none (Story 1.4d). The
 * Account is the one the server derived from the verified session, never a client's. The values are the device's
 * valid cookies, already checked against the allowed sets (lib/preferences.ts `recordFromCookies`); the database
 * checks them again and refuses a value outside the sets. An existing record is never touched. If this throws,
 * nothing is known to be stored: the page goes on with the cookies and the next navigation tries again.
 */
export async function adoptPreferences(
  input: {accountId: string; locale: string | null; theme: string; detail: string; guidance: string},
  options: AccountsOptions = {},
): Promise<PreferenceAdoptionOutcome> {
  const row = await callRow(
    'adopt_preferences',
    {
      p_account_id: requireUuid('accountId', input.accountId),
      p_locale: requirePreferenceText('locale', input.locale, true),
      p_theme: requirePreferenceText('theme', input.theme, false),
      p_detail: requirePreferenceText('detail', input.detail, false),
      p_guidance: requirePreferenceText('guidance', input.guidance, false),
    },
    options,
  );
  return oneOf(row.outcome, preferenceAdoptionOutcomes);
}

/**
 * Saves one preference of the Account (Story 1.4d). The Account is the one the server derived from the verified
 * session, never a client's. `value` is null only for the language ("match my device"). The database checks the
 * name and the value against the allowed sets and refuses anything else. Only `saved` means the record holds it.
 */
export async function setAccountPreference(
  input: {accountId: string; name: string; value: string | null},
  options: AccountsOptions = {},
): Promise<PreferenceSaveOutcome> {
  if (typeof input.name !== 'string' || !preferenceNamePattern.test(input.name)) throw new TypeError('name must be a preference name');
  const row = await callRow(
    'set_preference',
    {p_account_id: requireUuid('accountId', input.accountId), p_name: input.name, p_value: requirePreferenceText('value', input.value, input.name === 'locale')},
    options,
  );
  return oneOf(row.outcome, preferenceSaveOutcomes);
}

const actorPattern = /^[a-z][a-z_]*(?::[A-Za-z0-9_-]{1,64}){0,2}$/;
const reasonPattern = /^[a-z][a-z_]{0,39}$/;

function requireActor(actor: string, reason?: string) {
  if (!actorPattern.test(actor)) throw new TypeError('actor must look like "user:<id>" or "system:<name>"');
  if (reason !== undefined && !reasonPattern.test(reason)) throw new TypeError('reason must be lower-case words joined by underscores');
}

async function revokeGrants(args: Row, options: AccountsOptions): Promise<GrantRevocation> {
  const row = await callRow('revoke_grants', args, options);
  const revoked = count(row.revoked);
  const live = count(row.live);
  if (revoked === null || live === null || live > revoked) throw unexpected();
  return {revoked, live};
}

/**
 * Ends the grant of one session (Story 1.4a): sign-out. Pass `userId` to require that the grant is that
 * user's. A session with no grant, or one already revoked, ends nothing and is not an error. If this throws
 * the revocation was not recorded, and the caller must not end the session.
 */
export async function revokeSessionGrant(
  input: {sessionId: string; userId?: string; actor: string; reason: string},
  options: AccountsOptions = {},
): Promise<GrantRevocation> {
  requireActor(input.actor, input.reason);
  return revokeGrants(
    {
      p_actor: input.actor,
      p_reason: input.reason,
      p_session_id: requireUuid('sessionId', input.sessionId),
      p_user_id: input.userId === undefined ? null : requireUuid('userId', input.userId),
    },
    options,
  );
}

/** Ends every grant of an Account, leaving `exceptSessionId` standing when given: "sign out my other sessions", and (Stories 1.5, 1.6) disabling and recovery. */
export async function revokeAccountGrants(
  input: {accountId: string; exceptSessionId?: string; actor: string; reason: string},
  options: AccountsOptions = {},
): Promise<GrantRevocation> {
  requireActor(input.actor, input.reason);
  return revokeGrants(
    {
      p_actor: input.actor,
      p_reason: input.reason,
      p_account_id: requireUuid('accountId', input.accountId),
      p_except_session_id: input.exceptSessionId === undefined ? null : requireUuid('exceptSessionId', input.exceptSessionId),
    },
    options,
  );
}

/** Ends every grant of an Account that was issued under an epoch lower than `belowEpoch`. */
export async function revokeGrantsBelowEpoch(
  input: {accountId: string; belowEpoch: number; actor: string; reason: string},
  options: AccountsOptions = {},
): Promise<GrantRevocation> {
  requireActor(input.actor, input.reason);
  if (!Number.isSafeInteger(input.belowEpoch) || input.belowEpoch < 1) throw new TypeError('belowEpoch must be a positive integer');
  return revokeGrants(
    {p_actor: input.actor, p_reason: input.reason, p_account_id: requireUuid('accountId', input.accountId), p_below_epoch: input.belowEpoch},
    options,
  );
}

/** Raises an Account's authorization epoch by one, which refuses every grant issued before it. `epoch` is null for an unknown Account. */
export async function raiseAuthorizationEpoch(input: {accountId: string; actor: string}, options: AccountsOptions = {}): Promise<EpochReceipt> {
  requireActor(input.actor);
  const row = await callRow('raise_authorization_epoch', {p_account_id: requireUuid('accountId', input.accountId), p_actor: input.actor}, options);
  // The database answers null for an Account that does not exist. Anything else must be a real epoch: a
  // value that is not a number for an Account that does exist is no answer, and must not read as "unknown".
  if (row.epoch === null) return {accountId: text(row.account_id) ?? input.accountId, epoch: null};
  const epoch = count(row.epoch);
  if (epoch === null) throw unexpected();
  return {accountId: text(row.account_id) ?? input.accountId, epoch};
}

/**
 * Whether this registration command, with this code, created the user's Account: the proof a retried
 * registration needs before its session may be given a grant (the Account exists, the first attempt's answer
 * was lost, and the session never got its grant). Any other session of a user that has an Account fails this,
 * so it cannot buy a grant by posting a code. Only the hash of the code leaves this module.
 */
export async function confirmRegistration(input: {userId: string; commandId: string; code: string}, options: AccountsOptions = {}): Promise<boolean> {
  const env = options.env ?? process.env;
  const userId = requireUuid('userId', input.userId);
  const commandId = requireUuid('commandId', input.commandId);
  const key = hashKey(env, 'INVITATION_HASH_KEY');
  if (!looksLikeInvitationCode(input.code)) return false;
  const row = await callRow('confirm_registration', {p_user_id: userId, p_command_id: commandId, p_code_hash: hashInvitationCode(input.code, key)}, options);
  if (typeof row.confirmed !== 'boolean') throw unexpected();
  return row.confirmed;
}

const secretHashPattern = /^[0-9a-f]{64}$/;
const verifierHashPattern = /^[A-Za-z0-9_-]{43}$/;

function requireStepUpClass(value: string): StepUpClass {
  if (!(stepUpClasses as readonly string[]).includes(value)) throw new TypeError('actionClass must be one of the step-up classes');
  return value as StepUpClass;
}

/**
 * Starts a step-up for the session that is asking (Story 1.4b). The user is the verified Auth user's and the
 * session the verified access token's; the secret hash is the SHA-256 of the random secret that goes in this
 * browser's httpOnly cookie and the verifier hash is the PKCE challenge of the Google sign-in this start begins
 * (lib/step-up-flow.ts). Fails closed: if the database cannot be reached this throws, and no nonce exists the
 * caller can rely on.
 */
export async function startStepUp(
  input: {userId: string; sessionId: string; actionClass: string; secretHash: string; verifierHash: string},
  options: AccountsOptions = {},
): Promise<StepUpStartReceipt> {
  const actionClass = requireStepUpClass(input.actionClass);
  if (!secretHashPattern.test(input.secretHash)) throw new TypeError('secretHash must be a hex SHA-256');
  if (!verifierHashPattern.test(input.verifierHash)) throw new TypeError('verifierHash must be a base64url SHA-256');
  const row = await callRow(
    'start_step_up',
    {
      p_user_id: requireUuid('userId', input.userId),
      p_session_id: requireUuid('sessionId', input.sessionId),
      p_action_class: actionClass,
      p_secret_hash: input.secretHash,
      p_verifier_hash: input.verifierHash,
    },
    options,
  );
  const outcome = oneOf(row.outcome, ['started', 'limited', 'refused'] as const);
  const expiresAt = text(row.expires_at);
  // A start that does not say when it expires is not a start.
  if (outcome === 'started' && !expiresAt) throw unexpected();
  return {outcome, expiresAt: outcome === 'started' ? expiresAt : null};
}

/**
 * Hands the sign-in that has just come back to the database to accept or reject (Story 1.4b). `sessionId` is the
 * NEW session, taken from the access token the code exchange returned for the user Auth then vouched for; the
 * database reads everything else from its own tables and Auth's, never from the caller. If this throws, nothing
 * was accepted: the caller ends only the new session.
 */
export async function completeStepUp(
  input: {userId: string; sessionId: string; secretHash: string; verifierHash: string},
  options: AccountsOptions = {},
): Promise<StepUpReceipt> {
  if (!secretHashPattern.test(input.secretHash)) throw new TypeError('secretHash must be a hex SHA-256');
  if (!verifierHashPattern.test(input.verifierHash)) throw new TypeError('verifierHash must be a base64url SHA-256');
  const row = await callRow(
    'complete_step_up',
    {
      p_user_id: requireUuid('userId', input.userId),
      p_session_id: requireUuid('sessionId', input.sessionId),
      p_secret_hash: input.secretHash,
      p_verifier_hash: input.verifierHash,
    },
    options,
  );
  const outcome = oneOf(row.outcome, ['accepted', 'rejected', 'not_step_up'] as const);
  const actionClass = row.action_class === null || row.action_class === undefined ? null : oneOf(row.action_class, stepUpClasses);
  // An acceptance that does not name the class it is for is not an acceptance.
  if (outcome === 'accepted' && actionClass === null) throw unexpected();
  return {outcome, reason: text(row.reason), actionClass};
}

/**
 * Checks, and for account_deletion and close_instance consumes, the fresh-authentication marker of the session
 * that is asking (Story 1.4b). A later story's command calls it in the transaction of the sensitive change (the
 * SQL function api.use_marker), or from the server before it. `startedAfter` is the moment the destructive
 * confirmation was shown: the two consumed classes require it, and a marker whose step-up started at or before it
 * is `stale`. Anything but `allowed` is not permission.
 */
export async function checkMarker(
  input: {userId: string; sessionId: string; actionClass: string; startedAfter?: Date | string | null},
  options: AccountsOptions = {},
): Promise<MarkerOutcome> {
  const actionClass = requireStepUpClass(input.actionClass);
  let startedAfter: string | null = null;
  // `null` is missing, like `undefined`: it must never become a time (`new Date(null)` is the epoch).
  if (input.startedAfter != null) {
    const moment = new Date(input.startedAfter);
    if (Number.isNaN(moment.getTime())) throw new TypeError('startedAfter must be a valid time');
    startedAfter = moment.toISOString();
  }
  if (startedAfter === null && (consumedStepUpClasses as readonly string[]).includes(actionClass)) {
    throw new TypeError('startedAfter is required for a class whose marker is consumed by use');
  }
  const row = await callRow(
    'use_marker',
    {
      p_user_id: requireUuid('userId', input.userId),
      p_session_id: requireUuid('sessionId', input.sessionId),
      p_action_class: actionClass,
      p_started_after: startedAfter,
    },
    options,
  );
  return oneOf(row.outcome, markerOutcomes);
}

/**
 * Audited seed command: records a pre-authorization for an address. Idempotent. Rejects with code N3001
 * (the address already owns an Account) or N3002 (it is pre-authorized with another role).
 */
export async function seedPreauthorization(
  input: {email: string; role: Role; actor: string},
  options: AccountsOptions = {},
): Promise<PreauthorizationReceipt> {
  const row = await callRow('seed_preauthorization', {p_email: input.email, p_role: input.role, p_actor: input.actor}, options);
  const id = text(row.preauthorization_id);
  if (!id) throw unexpected();
  return {
    preauthorizationId: id,
    role: roleOf(row.role) ?? input.role,
    created: row.created === true,
    consumed: row.consumed === true,
    otherAdministrators: typeof row.other_administrators === 'number' ? row.other_administrators : 0,
  };
}

/** Audited seed command: withdraws a pre-authorization that no sign-in has consumed yet. */
export async function withdrawPreauthorization(input: {email: string; actor: string}, options: AccountsOptions = {}): Promise<WithdrawalReceipt> {
  const row = await callRow('withdraw_preauthorization', {p_email: input.email, p_actor: input.actor}, options);
  return {outcome: oneOf(row.outcome, ['withdrawn', 'consumed', 'not_found'] as const)};
}

/**
 * Audited seed command, and (Story 1.11) the Administrator's invitation page, behind a fresh-authentication marker
 * that the page's Server Action checks first: generates a code, stores only its hash, and returns the code for the
 * caller to show once. A named code needs a label; a general code takes none and, while one is current, comes back
 * as `exists` unless `replace` (which revokes the current one). When the outcome is `exists` no code was
 * stored and none is returned. If this throws an AccountsUnavailableError with `outcomeUnknown`, the
 * code may have been stored: list the invitations and revoke any you do not recognise before issuing again.
 */
export async function issueInvitation(
  input: {kind: 'named'; label: string; actor: string} | {kind: 'general'; actor: string; replace?: boolean},
  options: AccountsOptions = {},
): Promise<IssuedInvitation | ExistingInvitation> {
  const env = options.env ?? process.env;
  const key = hashKey(env, 'INVITATION_HASH_KEY');
  const code = generateInvitationCode();
  const row = await callRow(
    'issue_invitation',
    {
      p_code_hash: hashInvitationCode(code, key),
      p_kind: input.kind,
      p_label: input.kind === 'named' ? input.label : null,
      p_actor: input.actor,
      p_replace: input.kind === 'general' ? input.replace === true : false,
    },
    options,
  );
  if (oneOf(row.outcome, ['issued', 'exists'] as const) === 'exists') {
    return {outcome: 'exists', invitationId: text(row.invitation_id), kind: input.kind};
  }
  const id = text(row.invitation_id);
  if (!id) throw unexpected();
  return {outcome: 'issued', code, invitationId: id, kind: input.kind, replacedInvitationId: text(row.replaced_invitation_id)};
}

/** Audited seed command, and (Story 1.11) the invitation page, which checks the marker first: revokes an unused code, by invitation ID or by the code itself. */
export async function revokeInvitation(
  input: {actor: string} & ({invitationId: string; code?: undefined} | {code: string; invitationId?: undefined}),
  options: AccountsOptions = {},
): Promise<RevocationReceipt> {
  const env = options.env ?? process.env;
  let args: Row;
  if (input.invitationId !== undefined) {
    args = {p_actor: input.actor, p_invitation_id: requireUuid('invitationId', input.invitationId)};
  } else {
    const key = hashKey(env, 'INVITATION_HASH_KEY');
    // Something that is not shaped like a code cannot be one that was issued.
    if (!looksLikeInvitationCode(input.code)) return {invitationId: null, outcome: 'not_found'};
    args = {p_actor: input.actor, p_code_hash: hashInvitationCode(input.code, key)};
  }
  const row = await callRow('revoke_invitation', args, options);
  return {
    invitationId: text(row.invitation_id),
    outcome: oneOf(row.outcome, ['revoked', 'already_revoked', 'redeemed', 'not_found'] as const),
  };
}

/**
 * The refusals of an invitation change that api.record_invitation_refusal records (Story 1.11): an Administrator
 * who tried to issue a code (named or general) or to revoke one without a valid fresh-authentication marker, and
 * an Account that is not an Administrator who tried either.
 */
export const invitationRefusalActions = ['invitation.issue_refused', 'invitation.revoke_refused', 'invitation.denied'] as const;
export type InvitationRefusalAction = (typeof invitationRefusalActions)[number];
/** `recorded` (a new audit event) or `repeated` (the same refusal was recorded in the last hour; nothing was written). */
export const invitationRefusalOutcomes = ['recorded', 'repeated'] as const;
export type InvitationRefusalOutcome = (typeof invitationRefusalOutcomes)[number];

/**
 * Records a refused invitation change in the audit trail (Story 1.11): the actor (`user:<id>`, built by the
 * database from the verified Auth user the server passes, never from input) and, for an attempt to revoke, the
 * invitation as the target. It records no label, code, marker outcome or reason text, and takes none. Once an hour
 * per actor, action and target. The application has already refused the change when it calls this: a failure to
 * record is logged by the caller and never turns the refusal into a permission.
 */
export async function recordInvitationRefusal(
  input: {userId: string; action: InvitationRefusalAction; invitationId?: string | null},
  options: AccountsOptions = {},
): Promise<InvitationRefusalOutcome> {
  if (!(invitationRefusalActions as readonly string[]).includes(input.action)) throw new TypeError('action must be one of the invitation refusal actions');
  const row = await callRow(
    'record_invitation_refusal',
    {
      p_user_id: requireUuid('userId', input.userId),
      p_action: input.action,
      p_invitation_id: input.invitationId == null ? null : requireUuid('invitationId', input.invitationId),
    },
    options,
  );
  return oneOf(row.outcome, invitationRefusalOutcomes);
}

/** Invitation ID, kind, label, state and creation time, newest first. Never a hash or a code. */
export async function listInvitations(options: AccountsOptions = {}): Promise<InvitationSummary[]> {
  const body = await callApi('list_invitations', {}, options);
  if (!Array.isArray(body)) throw unexpected();
  return body.map((item) => {
    const row = (typeof item === 'object' && item !== null ? item : {}) as Row;
    const id = text(row.invitation_id);
    if (!id) throw unexpected();
    return {
      invitationId: id,
      kind: oneOf(row.kind, ['named', 'general'] as const),
      label: text(row.label),
      state: oneOf(row.state, ['unused', 'redeemed', 'revoked'] as const),
      createdAt: text(row.created_at) ?? '',
    };
  });
}

// Account administration (Story 1.5) ---------------------------------------------------------------------------

/** One Account as the Administrator's list shows it: who, how they came, their role and status. Never Workspace content, a project name or usage. */
export type AccountSummary = {
  accountId: string;
  /** The Google address Auth verified, or null if Auth no longer vouches for one. */
  email: string | null;
  /** The kind of invitation code that made the Account; null for an Account no code made (the pre-authorized Administrator). */
  invitationKind: 'named' | 'general' | null;
  /** The name of a named code. A general code carries none. */
  invitationLabel: string | null;
  role: Role;
  status: 'active' | 'disabled';
  createdAt: string;
};

/**
 * api.disable_account: `disabled` (done in one transaction: status and epoch, every session grant, the Auth
 * sessions, the audit event), `already_disabled`, `administrator` (the Administrator's Account cannot be disabled) or
 * `not_found`. `sessionsEnded` counts the Auth sessions that were ended and `grantsRevoked` the session grants.
 */
export type DisableReceipt = {
  outcome: 'disabled' | 'already_disabled' | 'administrator' | 'not_found';
  sessionsEnded: number;
  grantsRevoked: number;
  epoch: number | null;
};
/** api.enable_account: `enabled` (active again under a newer epoch), `already_enabled` or `not_found`. */
export type EnableReceipt = {outcome: 'enabled' | 'already_enabled' | 'not_found'; epoch: number | null};

/**
 * api.guard_operation: `allowed` is the only permission. `disabled`: the Account is disabled. `stale_epoch`: the Account's
 * epoch is not the one the operation registered under (a disable or a re-enable raised it since). `no_account`: no such Account.
 * `epoch` is the Account's current epoch (null for `no_account`).
 */
export const operationOutcomes = ['allowed', 'disabled', 'stale_epoch', 'no_account'] as const;
export type OperationOutcome = (typeof operationOutcomes)[number];
export type OperationGuard = {outcome: OperationOutcome; epoch: number | null};

/** The refusals of an Account change that api.record_account_refusal records (Story 1.5). */
export const accountRefusalActions = ['account.disable_refused', 'account.enable_refused', 'account.denied'] as const;
export type AccountRefusalAction = (typeof accountRefusalActions)[number];
/** `recorded` (a new audit event) or `repeated` (the same refusal was recorded in the last hour; nothing was written). */
export const accountRefusalOutcomes = ['recorded', 'repeated'] as const;
export type AccountRefusalOutcome = (typeof accountRefusalOutcomes)[number];

/**
 * The Accounts, newest first (at most 200): ID, the verified Google address, the invitation that made the Account, role,
 * status and creation time (Story 1.5). Never Workspace content, a project name or usage.
 */
export async function listAccounts(options: AccountsOptions = {}): Promise<AccountSummary[]> {
  const body = await callApi('list_accounts', {}, options);
  if (!Array.isArray(body)) throw unexpected();
  return body.map((item) => {
    const row = (typeof item === 'object' && item !== null ? item : {}) as Row;
    const id = text(row.account_id);
    const role = roleOf(row.role);
    if (!id || !role) throw unexpected();
    return {
      accountId: id,
      email: text(row.email),
      invitationKind: row.invitation_kind === null || row.invitation_kind === undefined ? null : oneOf(row.invitation_kind, ['named', 'general'] as const),
      invitationLabel: text(row.invitation_label),
      role,
      status: oneOf(row.status, ['active', 'disabled'] as const),
      createdAt: text(row.created_at) ?? '',
    };
  });
}

/** An epoch the database may answer as null (an Account that does not exist), or a real one; anything else is no answer. */
function epochOrNull(value: unknown) {
  if (value === null || value === undefined) return null;
  const epoch = count(value);
  if (epoch === null) throw unexpected();
  return epoch;
}

/**
 * Disables a member Account in one transaction (Story 1.5): the status and the authorization epoch, every session grant,
 * the Auth sessions, and the `account.disabled` audit event; the Workspace is untouched. The actor (`user:<Auth user ID>`)
 * is the verified Administrator's, taken by the caller from the session and never from input. The caller has already
 * checked the role and the fresh-authentication marker. Cancellation signals are sent by the caller only after this
 * returns, never before (lib/authority.ts). If this throws an AccountsUnavailableError with `outcomeUnknown`, the Account
 * may or may not have been disabled: read the list before trying again.
 */
export async function disableAccount(input: {accountId: string; actor: string}, options: AccountsOptions = {}): Promise<DisableReceipt> {
  requireActor(input.actor);
  const row = await callRow('disable_account', {p_actor: input.actor, p_account_id: requireUuid('accountId', input.accountId)}, options);
  const outcome = oneOf(row.outcome, ['disabled', 'already_disabled', 'administrator', 'not_found'] as const);
  const sessionsEnded = count(row.sessions_ended);
  const grantsRevoked = count(row.grants_revoked);
  const epoch = epochOrNull(row.epoch);
  // A disable that does not say what it ended, or the epoch it raised the Account to (the cancellers are told it), is not an answer.
  if (outcome === 'disabled' && (sessionsEnded === null || grantsRevoked === null || epoch === null)) throw unexpected();
  return {outcome, sessionsEnded: sessionsEnded ?? 0, grantsRevoked: grantsRevoked ?? 0, epoch};
}

/**
 * Enables a disabled Account under a newer epoch (Story 1.5) and audits `account.enabled`. The sessions that were ended
 * stay ended: the person signs in anew. Same actor and caller rules as `disableAccount`.
 */
export async function enableAccount(input: {accountId: string; actor: string}, options: AccountsOptions = {}): Promise<EnableReceipt> {
  requireActor(input.actor);
  const row = await callRow('enable_account', {p_actor: input.actor, p_account_id: requireUuid('accountId', input.accountId)}, options);
  const outcome = oneOf(row.outcome, ['enabled', 'already_enabled', 'not_found'] as const);
  const epoch = epochOrNull(row.epoch);
  if (outcome === 'enabled' && epoch === null) throw unexpected();
  return {outcome, epoch};
}

/**
 * The authority check for an operation's own step (Story 1.5): `epoch` is the authorization epoch the operation registered
 * under, which is the epoch of the live authorization that started it. Only `allowed` is permission. This throws when the
 * database cannot be reached: lib/authority.ts turns that into a denial, and is what Jobs and the file gateway call.
 */
export async function guardOperation(input: {accountId: string; epoch: number}, options: AccountsOptions = {}): Promise<OperationGuard> {
  if (!Number.isSafeInteger(input.epoch) || input.epoch < 1) throw new TypeError('epoch must be a positive integer');
  const row = await callRow('guard_operation', {p_account_id: requireUuid('accountId', input.accountId), p_epoch: input.epoch}, options);
  const outcome = oneOf(row.outcome, operationOutcomes);
  const epoch = epochOrNull(row.epoch);
  // Every answer but "no such Account" comes from a known Account, which has an epoch.
  if (outcome !== 'no_account' && epoch === null) throw unexpected();
  return {outcome, epoch};
}

/**
 * Records a refused Account change in the audit trail (Story 1.5): the actor (`user:<id>`, built by the database from the
 * verified Auth user the server passes, never from input) and, when it exists, the Account the attempt named as the target.
 * It records no reason, marker outcome, address or content, and takes none. Once an hour per actor, action and target. The
 * application has already refused the change when it calls this: a failure to record is logged by the caller and never turns
 * the refusal into a permission.
 */
export async function recordAccountRefusal(
  input: {userId: string; action: AccountRefusalAction; accountId?: string | null},
  options: AccountsOptions = {},
): Promise<AccountRefusalOutcome> {
  if (!(accountRefusalActions as readonly string[]).includes(input.action)) throw new TypeError('action must be one of the Account refusal actions');
  const row = await callRow(
    'record_account_refusal',
    {
      p_user_id: requireUuid('userId', input.userId),
      p_action: input.action,
      p_account_id: input.accountId == null ? null : requireUuid('accountId', input.accountId),
    },
    options,
  );
  return oneOf(row.outcome, accountRefusalOutcomes);
}

// Administrator recovery (Story 1.6) ---------------------------------------------------------------------------

/** 32 random bytes from the operating system's CSPRNG: 256 bits. The token travels once, in the mailed link's fragment. */
export const recoveryTokenBytes = 32;

/** A new recovery token: 32 random bytes as 43 URL-safe characters. Only its keyed hash is ever stored; it is never logged. */
export function newRecoveryToken(random: (size: number) => Uint8Array = randomBytes): string {
  const bytes = random(recoveryTokenBytes);
  if (bytes.length !== recoveryTokenBytes) throw new Error('The random source returned the wrong number of bytes.');
  return Buffer.from(bytes).toString('base64url');
}

/** Whether a value is shaped like a token this module makes. Anything else cannot be one (and is still hashed and refused like any unknown token). */
export function isRecoveryToken(value: unknown): value is string {
  return typeof value === 'string' && recoveryTokenPattern.test(value);
}

/**
 * Hex HMAC-SHA-256 of a recovery token under RECOVERY_HASH_KEY: what the database stores and compares. The input is cut
 * to a bounded length first, so a request cannot make this hash an arbitrary amount of text.
 */
export function hashRecoveryToken(token: unknown, key: Uint8Array) {
  return hmacHex(key, 'nova3d/recovery-token/v1', typeof token === 'string' ? token.slice(0, 256) : '');
}

/**
 * The configured Administrator address, the only one recovery serves and the only one it mails: ADMINISTRATOR_EMAIL, lower
 * case, from the server's own environment. It is never a parameter of a call, so no request can supply one.
 */
function administratorAddress(env: Env) {
  const value = env.ADMINISTRATOR_EMAIL?.trim().toLowerCase();
  if (!value || isPlaceholder(value)) throw new AccountsConfigError('ADMINISTRATOR_EMAIL is not set');
  if (!isEmailAddress(value)) throw new AccountsConfigError('ADMINISTRATOR_EMAIL is not an email address');
  return value;
}

/**
 * api.issue_recovery: `issued` (a token now exists until `expiresAt`: the caller mails the link that carries `token`, which
 * exists nowhere else), `limited` (an issuance in the last 15 minutes, or 5 in the last 24 hours; nothing was issued) or
 * `refused` (no eligible Administrator, or the pinned Google subject no longer matches; nothing was issued).
 */
export type RecoveryIssuance = {outcome: 'issued'; token: string; expiresAt: string} | {outcome: 'limited'} | {outcome: 'refused'};

/** Why a recovery token cannot be redeemed. `administrator`: the Account is not, or is no longer, the one eligible Administrator. */
export const recoveryRefusals = ['unknown', 'used', 'expired', 'voided', 'administrator'] as const;
export type RecoveryRefusal = (typeof recoveryRefusals)[number];

/** api.check_recovery: `valid` carries the Auth user to mint a session for and its own address; anything else says why not. */
export type RecoveryCheck = {outcome: 'valid'; userId: string; email: string} | {outcome: RecoveryRefusal};

/** api.redeem_recovery: `redeemed` carries how many OTHER Auth sessions were ended and the Account's new epoch. */
export type RecoveryRedemption = {outcome: 'redeemed'; sessionsEnded: number; epoch: number} | {outcome: RecoveryRefusal};

/** api.void_recovery: `voided`, `recorded` (audited, the token left as it was) or `not_found`. */
export const recoveryVoidOutcomes = ['voided', 'recorded', 'not_found'] as const;
export type RecoveryVoidOutcome = (typeof recoveryVoidOutcomes)[number];

/**
 * Issues a recovery token for the configured Administrator (Story 1.6). The token is made here (32 random bytes) and only
 * its HMAC under RECOVERY_HASH_KEY goes to the database; it is returned for the caller to put in the one mailed link and
 * nowhere else. The address is ADMINISTRATOR_EMAIL from `options.env`, never an argument. If this throws an
 * AccountsUnavailableError the token may or may not have been stored, and nobody holds it: nothing usable exists.
 */
export async function issueRecovery(options: AccountsOptions = {}): Promise<RecoveryIssuance> {
  const env = options.env ?? process.env;
  const key = hashKey(env, 'RECOVERY_HASH_KEY');
  const administrator = administratorAddress(env);
  const token = newRecoveryToken();
  const row = await callRow('issue_recovery', {p_token_hash: hashRecoveryToken(token, key), p_administrator_email: administrator}, options);
  const outcome = oneOf(row.outcome, ['issued', 'limited', 'refused'] as const);
  if (outcome !== 'issued') return {outcome};
  const expiresAt = text(row.expires_at);
  // An issuance that does not say when it expires is not one the caller may mail.
  if (!expiresAt) throw unexpected();
  return {outcome, token, expiresAt};
}

/**
 * Records that the recovery mail could not be sent (`recovery.mail_failed`) and, when `definitive` (the provider refused
 * the message, so it was not sent), voids the token so nothing usable remains. A failure whose outcome is unknown (a timeout:
 * the mail may have gone out) is not definitive, and leaves the token as it was.
 */
export async function voidRecovery(input: {token: string; definitive: boolean}, options: AccountsOptions = {}): Promise<RecoveryVoidOutcome> {
  const env = options.env ?? process.env;
  const key = hashKey(env, 'RECOVERY_HASH_KEY');
  const row = await callRow('void_recovery', {p_token_hash: hashRecoveryToken(input.token, key), p_definitive: input.definitive === true}, options);
  return oneOf(row.outcome, recoveryVoidOutcomes);
}

/**
 * Whether a token from a request can be redeemed, and for which Auth user (Story 1.6). Changes nothing about the token; a
 * refusal is audited by the database. The token is whatever the request carried: it is cut to a bounded length, hashed
 * like any other, and an unknown one is simply `unknown`. The configured address is `options.env`'s, never an argument.
 */
export async function checkRecovery(input: {token: string}, options: AccountsOptions = {}): Promise<RecoveryCheck> {
  const env = options.env ?? process.env;
  const key = hashKey(env, 'RECOVERY_HASH_KEY');
  const administrator = administratorAddress(env);
  const row = await callRow('check_recovery', {p_token_hash: hashRecoveryToken(input.token, key), p_administrator_email: administrator}, options);
  const outcome = oneOf(row.outcome, ['valid', ...recoveryRefusals] as const);
  if (outcome !== 'valid') return {outcome};
  const userId = text(row.user_id);
  const email = text(row.email);
  // A token that is valid for nobody is not valid.
  if (!userId || !uuidPattern.test(userId) || !email) throw unexpected();
  return {outcome, userId: userId.toLowerCase(), email};
}

/**
 * The transaction (Story 1.6): redeems the token for the verified user and the session in the verified access token that
 * the Auth Admin API's link has just minted. ONE database transaction under a lock on the Account marks the token used,
 * raises the epoch, revokes every grant of the Account, deletes the person's other Auth sessions, grants this session and
 * gives it the fresh-authentication marker; any refusal undoes all of it. If this throws an AccountsUnavailableError with
 * `outcomeUnknown`, the transaction may have committed: the caller must NOT end the session it holds, and tells the person
 * to open Administration.
 */
export async function redeemRecoveryToken(input: {token: string; userId: string; sessionId: string}, options: AccountsOptions = {}): Promise<RecoveryRedemption> {
  const env = options.env ?? process.env;
  const key = hashKey(env, 'RECOVERY_HASH_KEY');
  const administrator = administratorAddress(env);
  const userId = requireUuid('userId', input.userId);
  const sessionId = requireUuid('sessionId', input.sessionId);
  const row = await callRow(
    'redeem_recovery',
    {p_token_hash: hashRecoveryToken(input.token, key), p_administrator_email: administrator, p_user_id: userId, p_session_id: sessionId},
    options,
  );
  const outcome = oneOf(row.outcome, ['redeemed', ...recoveryRefusals] as const);
  if (outcome !== 'redeemed') return {outcome};
  const sessionsEnded = count(row.sessions_ended);
  const epoch = count(row.epoch);
  // A redemption that does not say what it ended, or the epoch it moved the Account to, is not an answer.
  if (sessionsEnded === null || epoch === null) throw unexpected();
  return {outcome, sessionsEnded, epoch};
}
