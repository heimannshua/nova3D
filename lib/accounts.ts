// Story 1.3 (Part A). The application side of invitation-only Accounts: invitation code generation,
// keyed hashing, and typed calls to the `api` schema with the service role.
//
// SERVER-ONLY. This module reads INVITATION_HASH_KEY, RATE_LIMIT_HASH_KEY and the service-role key,
// none of which may reach a browser. It is not marked with the `server-only` package because the
// audited seed command (scripts/seed-accounts.mjs) imports it directly through Node type stripping,
// where that package throws. Instead it refuses to load in a browser, uses node:crypto (which a client
// bundle cannot resolve), and tests/unit/accounts.test.ts fails if a client component, or anything under
// components/, imports it.
//
// Like lib/environment.ts it uses erasable TypeScript syntax only and relative `.ts` imports.
//
// The database never sees a raw invitation code or a client address. This module hashes both with
// HMAC-SHA256 under keys that exist only in the server environment, and passes the hashes in.
// No function here logs, and no error message contains a code, an address, a hash or a key.
import {createHmac, randomBytes} from 'node:crypto';
import {isIPv4, isIPv6} from 'node:net';
import {decodeHashKey, hashKeyProblem, hashKeyVariables, isPlaceholder, type Env} from './environment.ts';

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

/** The Account, Workspace, role and epoch are present only when the state is `active`. */
export type SessionAuthorization = {
  state: AuthorizationState;
  accountId: string | null;
  workspaceId: string | null;
  role: Role | null;
  epoch: number | null;
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

type Row = Record<string, unknown>;

async function callApi(name: string, args: Row, options: AccountsOptions): Promise<unknown> {
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

const unexpected = (status?: number) =>
  new AccountsUnavailableError('The accounts database answered with an unexpected shape.', {status, retryable: false, outcomeUnknown: true});

async function callRow(name: string, args: Row, options: AccountsOptions): Promise<Row> {
  const body = await callApi(name, args, options);
  if (typeof body !== 'object' || body === null || Array.isArray(body)) throw unexpected();
  return body as Row;
}

const text = (value: unknown) => (typeof value === 'string' ? value : null);
const roleOf = (value: unknown): Role | null => (value === 'administrator' || value === 'member' ? value : null);
function oneOf<T extends string>(value: unknown, allowed: readonly T[]): T {
  if (typeof value === 'string' && (allowed as readonly string[]).includes(value)) return value as T;
  throw unexpected();
}

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function requireUuid(name: string, value: string) {
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
  if (state !== 'active') return {state, accountId: null, workspaceId: null, role: null, epoch: null};
  const accountId = text(row.account_id);
  const role = roleOf(row.role);
  const epoch = count(row.epoch);
  // An active answer that does not name its Account, role and epoch is not an answer.
  if (!accountId || !role || epoch === null) throw unexpected();
  return {state, accountId, workspaceId: text(row.workspace_id), role, epoch};
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
 * Audited seed command: generates a code, stores only its hash, and returns the code for the caller to
 * show once. A named code needs a label; a general code takes none and, while one is current, comes back
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

/** Audited seed command: revokes an unused code, by invitation ID or by the code itself. */
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
