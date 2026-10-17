// Story 1.12. The service-signing contract: how one part of the system proves to another that it made a request. The file gateway uses it
// now (the application signs transfer tickets and delete commands, the gateway verifies them); Story 2.7 reuses it for the workers' callbacks.
//
// This file imports `node:crypto` and NOTHING else, so the gateway (workers/files, which Node runs through type stripping and which cannot
// reach the application's modules) and the application and the tests all read the one definition. Erasable TypeScript syntax only.
// It reads no environment variable and logs nothing: callers pass the key text in, and a refusal names no reason.
//
// ISSUERS. `application`, `gateway`, `cad-worker`, `engine-worker`, `backup-service`, `heartbeat`. Each issuer has one Ed25519 key pair at a time
// (plus at most one RETIRING key while a rotation settles). Only `application` issues anything in Story 1.12.
//
// KEY SET (public, not secret; `SERVICE_KEYS_<ISSUER>`): JSON
//     {"issuer": "application", "active": "<kid>", "retiring": {"kid": "<kid>", "until": "<ISO 8601 UTC>"} | null, "keys": {"<kid>": "<base64 SPKI>"}}
//   with at most one retiring key, `until` required with it (and at most ten minutes after the time the set is read: a rotation needs six), EXACTLY the named key IDs in `keys` (every named kid present, nothing else), each a
//   base64 SPKI Ed25519 public key, and no other member anywhere. The private key (`SERVICE_SIGNING_KEY_<ISSUER>`) is the base64 PKCS#8 of the
//   ACTIVE key and is checked to be the private half of the active public key.
//
// TOKEN. `base64url(header).base64url(payload).base64url(signature)`, header `{"v":1,"alg":"EdDSA","kid":"<kid>"}`, the signature over the label
// `nova3d/service-token/v1\0` followed by the first two parts as they are written. The payload holds `iss`, `aud`, `env` (the INSTANCE_ID of the
// environment it is for), `jti` (128 random bits, base64url: the one-use handle), `iat`, `exp`, `typ` and the claims of its type.
//
// VERIFICATION, in this order, with ONE refusal that names no reason (a caller can learn nothing about which check a forgery failed):
//   1. size            the token is a string of at most `maxTokenLength` characters
//   2. shape           three base64url parts, a header and a payload that are exactly what is described above
//   3. issuer, audience  the expected ones
//   4. environment     the expected INSTANCE_ID
//   5. key             the kid is the active key, or the retiring key and now is before its `until`
//   6. revocation      the key is not revoked, for a receiver that can read the revocations and passes `isRevoked`. The file gateway cannot (its database role
//                      may not read them), so it passes none and refuses a revoked kid where a token is REDEEMED instead (docs/authority-contract.md)
//   7. signature       Ed25519 over the label and the first two parts, with that kid's public key
//   8. lifetime        0 < exp - iat <= 300 seconds
//   9. issued          iat is at most 60 seconds ahead of now
//  10. expiry          now is not after exp
// and then the type. A reason is never returned: not in a result, not in an error, not in a log.
import {createPrivateKey, createPublicKey, randomBytes, sign, verify, type KeyObject} from 'node:crypto';

// Issuers, keys, tokens ----------------------------------------------------------------------------------------------------------

export const serviceIssuers = ['application', 'gateway', 'cad-worker', 'engine-worker', 'backup-service', 'heartbeat'] as const;
export type ServiceIssuer = (typeof serviceIssuers)[number];

export function isServiceIssuer(value: unknown): value is ServiceIssuer {
  return typeof value === 'string' && (serviceIssuers as readonly string[]).includes(value);
}

/** The environment variables of one issuer: its private key (held by the issuer only) and its public key set (held by every receiver). */
export const signingKeyVariable = (issuer: ServiceIssuer) => `SERVICE_SIGNING_KEY_${issuer.toUpperCase().replace(/-/g, '_')}`;
export const keySetVariable = (issuer: ServiceIssuer) => `SERVICE_KEYS_${issuer.toUpperCase().replace(/-/g, '_')}`;

/** The label the signature covers before the token's own parts, so a signature made for another purpose is never one of these. */
export const tokenLabel = 'nova3d/service-token/v1\0';
/** The most characters a token may have; a ticket is a few hundred. */
export const maxTokenLength = 4096;
/** A token lives at most this long, and a ticket or command is issued for exactly this long unless asked for less. */
export const maxLifetimeSeconds = 300;
export const defaultLifetimeSeconds = 300;
/** How far ahead of the receiver's clock an `iat` may be. */
export const maxSkewSeconds = 60;

const maxKeySetLength = 8192;
/**
 * How far ahead of the moment a key set is read its retiring key's `until` may be: ten minutes. A rotation needs only the window of a ticket (five minutes, with
 * a minute of skew, so six is the documented value); a key set that names a retiring key for hours or years would keep an old key in force long after the
 * rotation it belongs to. A moment that has passed is valid: the key is simply no longer accepted.
 */
export const maxRetiringWindowMs = 10 * 60 * 1000;
const kidPattern = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const typePattern = /^[a-z][a-z0-9-]{0,31}$/;
const jtiPattern = /^[A-Za-z0-9_-]{22}$/;
const partPattern = /^[A-Za-z0-9_-]+$/;
const base64Pattern = /^[A-Za-z0-9+/]+={0,2}$/;
const instantPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;
const reserved = ['iss', 'aud', 'env', 'jti', 'iat', 'exp', 'typ'];

export type RetiringKey = {kid: string; untilMs: number};

/** A key set that passed every check, with its public keys ready to verify with. */
export type ParsedKeySet = {
  issuer: ServiceIssuer;
  active: string;
  retiring: RetiringKey | null;
  /** The public key of each named kid. */
  publicKeys: ReadonlyMap<string, KeyObject>;
  /** The DER (SPKI) bytes of each, kept for comparing with a private key's public half. */
  spki: ReadonlyMap<string, Buffer>;
};

export type KeySetResult = {ok: true; keySet: ParsedKeySet} | {ok: false; problem: string};

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const hasExactly = (record: Record<string, unknown>, names: string[]) => {
  const own = Object.keys(record).sort();
  return own.length === names.length && [...names].sort().every((name, index) => own[index] === name);
};

function strictBase64(value: unknown): Buffer | null {
  if (typeof value !== 'string' || value.length > 4096 || !base64Pattern.test(value)) return null;
  const bytes = Buffer.from(value, 'base64');
  return bytes.length > 0 && bytes.toString('base64') === value ? bytes : null;
}

function publicKeyOf(value: unknown): {key: KeyObject; spki: Buffer} | null {
  const der = strictBase64(value);
  if (!der) return null;
  try {
    const key = createPublicKey({key: der, format: 'der', type: 'spki'});
    return key.asymmetricKeyType === 'ed25519' ? {key, spki: der} : null;
  } catch {
    return null;
  }
}

/**
 * Parses and checks a key set. `problem` says what is wrong with the SET (it is configuration, which an operator must fix, so it is
 * specific), and never holds a key. With `expectedIssuer`, a set for another issuer is refused. `nowMs` is the time the set is read at (the clock is injectable
 * for the tests): a retiring key's `until` more than `maxRetiringWindowMs` after it is refused.
 */
export function parseKeySet(text: unknown, expectedIssuer?: ServiceIssuer, nowMs: number = Date.now()): KeySetResult {
  const refuse = (problem: string): KeySetResult => ({ok: false, problem});
  if (typeof text !== 'string' || !text.trim()) return refuse('the key set is not set');
  if (text.length > maxKeySetLength) return refuse('the key set is too long');
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return refuse('the key set is not JSON');
  }
  if (!isRecord(parsed) || !hasExactly(parsed, ['issuer', 'active', 'retiring', 'keys'])) {
    return refuse('the key set must be exactly {issuer, active, retiring, keys}');
  }
  const {issuer, active, retiring, keys} = parsed;
  if (!isServiceIssuer(issuer)) return refuse('the key set names an issuer that does not exist');
  if (expectedIssuer !== undefined && issuer !== expectedIssuer) return refuse(`the key set is for another issuer than ${expectedIssuer}`);
  if (typeof active !== 'string' || !kidPattern.test(active)) return refuse('the active key ID is not a key ID');

  let retiringKey: RetiringKey | null = null;
  if (retiring !== null) {
    if (!isRecord(retiring) || !hasExactly(retiring, ['kid', 'until'])) return refuse('the retiring key must be exactly {kid, until}');
    if (typeof retiring.kid !== 'string' || !kidPattern.test(retiring.kid)) return refuse('the retiring key ID is not a key ID');
    if (retiring.kid === active) return refuse('the retiring key is the active key');
    if (typeof retiring.until !== 'string' || !instantPattern.test(retiring.until) || !Number.isFinite(Date.parse(retiring.until))) {
      return refuse('the retiring key needs an until that is an ISO 8601 UTC time');
    }
    retiringKey = {kid: retiring.kid, untilMs: Date.parse(retiring.until)};
  }

  if (!isRecord(keys)) return refuse('keys must be an object of key ID to public key');
  const named = retiringKey ? [active, retiringKey.kid] : [active];
  for (const kid of named) if (!Object.prototype.hasOwnProperty.call(keys, kid)) return refuse('a named key ID has no public key in keys');
  if (!hasExactly(keys, named)) return refuse('keys holds a key ID that is neither the active nor the retiring key');

  const publicKeys = new Map<string, KeyObject>();
  const spki = new Map<string, Buffer>();
  for (const kid of named) {
    const key = publicKeyOf(keys[kid]);
    if (!key) return refuse('a public key is not a base64 SPKI Ed25519 public key');
    publicKeys.set(kid, key.key);
    spki.set(kid, key.spki);
  }
  // Last, so that a set that is wrong in another way says so: the rotation window is short (a ticket lives five minutes, with a minute of skew).
  if (retiringKey !== null && retiringKey.untilMs > nowMs + maxRetiringWindowMs) return refuse('the retiring key\'s until is more than ten minutes ahead (a rotation needs six)');
  return {ok: true, keySet: {issuer, active, retiring: retiringKey, publicKeys, spki}};
}

/** What signs: the issuer's active key. */
export type Signer = {issuer: ServiceIssuer; kid: string; privateKey: KeyObject};

export type SignerResult = {ok: true; signer: Signer} | {ok: false; problem: string};

/** Loads the private key (base64 PKCS#8, Ed25519) and checks that it is the private half of the key set's ACTIVE public key. */
export function loadSigner(privateKeyText: unknown, keySet: ParsedKeySet): SignerResult {
  const der = typeof privateKeyText === 'string' ? strictBase64(privateKeyText.trim()) : null;
  if (!der) return {ok: false, problem: 'the private key is not set or is not base64'};
  let privateKey: KeyObject;
  try {
    privateKey = createPrivateKey({key: der, format: 'der', type: 'pkcs8'});
  } catch {
    return {ok: false, problem: 'the private key is not a PKCS#8 key'};
  }
  if (privateKey.asymmetricKeyType !== 'ed25519') return {ok: false, problem: 'the private key is not an Ed25519 key'};
  const half = createPublicKey(privateKey).export({type: 'spki', format: 'der'});
  if (!keySet.spki.get(keySet.active)?.equals(half)) return {ok: false, problem: 'the private key is not the private half of the active public key'};
  return {ok: true, signer: {issuer: keySet.issuer, kid: keySet.active, privateKey}};
}

/** 128 random bits, base64url: the `jti` of a token. */
export function newJti(): string {
  return randomBytes(16).toString('base64url');
}

const toPart = (value: unknown) => Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
const signedBytes = (header: string, payload: string) => Buffer.from(`${tokenLabel}${header}.${payload}`, 'utf8');

export type SignInput = {
  audience: ServiceIssuer;
  /** The INSTANCE_ID of the environment the token is for. */
  environment: string;
  type: string;
  /** The claims of the type: strings, numbers and booleans. They may not be named like a standard claim. */
  claims: Record<string, string | number | boolean>;
  /** Seconds since the epoch; now by default. */
  now?: number;
  /** 1 to 300; 300 by default. */
  lifetimeSeconds?: number;
  jti?: string;
};

/** Signs a token with the signer's key. Throws a TypeError when the input could not make a token a receiver would accept. */
export function signToken(signer: Signer, input: SignInput): string {
  const now = Math.floor(input.now ?? Date.now() / 1000);
  const lifetime = input.lifetimeSeconds ?? defaultLifetimeSeconds;
  if (!isServiceIssuer(input.audience)) throw new TypeError('audience must be a service');
  if (typeof input.environment !== 'string' || !input.environment || input.environment.length > 64) throw new TypeError('environment must be an instance ID');
  if (typeof input.type !== 'string' || !typePattern.test(input.type)) throw new TypeError('type must be a lower-case word');
  if (!Number.isSafeInteger(lifetime) || lifetime < 1 || lifetime > maxLifetimeSeconds) throw new TypeError(`lifetime must be 1 to ${maxLifetimeSeconds} seconds`);
  if (!Number.isSafeInteger(now) || now < 0) throw new TypeError('now must be a time in seconds');
  const jti = input.jti ?? newJti();
  if (!jtiPattern.test(jti)) throw new TypeError('jti must be 128 bits in base64url');
  for (const [name, value] of Object.entries(input.claims)) {
    if (reserved.includes(name)) throw new TypeError('a claim may not be named like a standard claim');
    if (!(typeof value === 'string' || typeof value === 'boolean' || (typeof value === 'number' && Number.isSafeInteger(value)))) throw new TypeError('a claim is a string, a boolean or a whole number');
  }
  const header = toPart({v: 1, alg: 'EdDSA', kid: signer.kid});
  const payload = toPart({iss: signer.issuer, aud: input.audience, env: input.environment, jti, iat: now, exp: now + lifetime, typ: input.type, ...input.claims});
  const signature = sign(null, signedBytes(header, payload), signer.privateKey).toString('base64url');
  return `${header}.${payload}.${signature}`;
}

export type TokenPayload = {iss: ServiceIssuer; aud: ServiceIssuer; env: string; jti: string; iat: number; exp: number; typ: string} & Record<string, unknown>;

export type VerifyOptions = {
  issuer: ServiceIssuer;
  audience: ServiceIssuer;
  /** The INSTANCE_ID this receiver runs for. */
  environment: string;
  keySet: ParsedKeySet;
  /** Seconds since the epoch (may be fractional). */
  now: number;
  /** When given, the token must be of this type. */
  type?: string;
  /**
   * Whether a key is revoked (Story 1.12: a row of artifacts.service_key_revocations). Asked before the signature. It may throw (the database did
   * not answer): that is NOT a verdict on the token, so it is not caught here: the receiver answers "try again", never "valid".
   */
  isRevoked?: (issuer: ServiceIssuer, kid: string) => boolean | Promise<boolean>;
};

export type Verified = {ok: true; kid: string; payload: TokenPayload} | {ok: false};

const refused: Verified = {ok: false};

function decodePart(part: string): unknown {
  const bytes = Buffer.from(part, 'base64url');
  // One spelling for one value: a part that does not re-encode to itself is not one this module wrote.
  if (bytes.toString('base64url') !== part) return undefined;
  try {
    return JSON.parse(bytes.toString('utf8'));
  } catch {
    return undefined;
  }
}

/** Verifies a token in the order the header of this file lists. The answer is `{ok: false}` and nothing else for every refusal. */
export async function verifyToken(token: unknown, options: VerifyOptions): Promise<Verified> {
  // 1. size
  if (typeof token !== 'string' || token.length === 0 || token.length > maxTokenLength) return refused;
  // 2. shape
  const parts = token.split('.');
  if (parts.length !== 3 || !parts.every((part) => partPattern.test(part))) return refused;
  const header = decodePart(parts[0]);
  const payload = decodePart(parts[1]);
  const signature = Buffer.from(parts[2], 'base64url');
  if (!isRecord(header) || !hasExactly(header, ['v', 'alg', 'kid']) || header.v !== 1 || header.alg !== 'EdDSA' || typeof header.kid !== 'string' || !kidPattern.test(header.kid)) return refused;
  if (signature.length !== 64 || signature.toString('base64url') !== parts[2]) return refused;
  if (!isRecord(payload)) return refused;
  const {iss, aud, env, jti, iat, exp, typ} = payload;
  if (typeof iss !== 'string' || typeof aud !== 'string' || typeof env !== 'string' || typeof typ !== 'string' || typeof jti !== 'string' || !jtiPattern.test(jti)) return refused;
  if (typeof iat !== 'number' || typeof exp !== 'number' || !Number.isSafeInteger(iat) || !Number.isSafeInteger(exp)) return refused;
  // 3. issuer, audience
  if (iss !== options.issuer || aud !== options.audience || options.keySet.issuer !== options.issuer) return refused;
  // 4. environment
  if (env.toLowerCase() !== options.environment.toLowerCase()) return refused;
  // 5. key: the active one, or the retiring one before its `until`
  const kid = header.kid;
  const retiring = options.keySet.retiring;
  const live = kid === options.keySet.active || (retiring !== null && kid === retiring.kid && options.now * 1000 < retiring.untilMs);
  const publicKey = live ? options.keySet.publicKeys.get(kid) : undefined;
  if (!publicKey) return refused;
  // 6. not revoked
  if (options.isRevoked && (await options.isRevoked(options.issuer, kid))) return refused;
  // 7. signature
  let genuine = false;
  try {
    genuine = verify(null, signedBytes(parts[0], parts[1]), publicKey, signature);
  } catch {
    genuine = false;
  }
  if (!genuine) return refused;
  // 8. lifetime  9. issued  10. expiry
  if (exp - iat <= 0 || exp - iat > maxLifetimeSeconds) return refused;
  if (iat > options.now + maxSkewSeconds) return refused;
  if (options.now > exp) return refused;
  if (options.type !== undefined && typ !== options.type) return refused;
  return {ok: true, kid, payload: payload as TokenPayload};
}

// Tickets and commands ---------------------------------------------------------------------------------------------------------

/** The limits of a transfer, in one place: the application checks them when it issues a ticket and the gateway again when it is used. */
export const transferLimits = {
  /** The most bytes of one chunk: every chunk is authorized against live state before it moves. */
  chunkBytes: 1024 * 1024,
  pictureBytes: 12 * 1024 * 1024,
  fileBytes: 100 * 1024 * 1024,
  /** The most bytes of one Account's open staging. */
  stagingQuotaBytes: 250 * 1024 * 1024,
  /** A ticket and a command: 5 minutes. A transfer handle: at most 30 minutes. A staging lease: 24 hours, renewed by activity. */
  ticketSeconds: 300,
  handleSeconds: 30 * 60,
  leaseSeconds: 24 * 60 * 60,
} as const;

export const uploadClasses = ['picture', 'file'] as const;
export type UploadClass = (typeof uploadClasses)[number];
export const pictureTypes = ['image/jpeg', 'image/png', 'image/webp'] as const;
export const fileType = 'application/octet-stream';

/**
 * The kinds of target a transfer can name (the gateway's resolver registry has one resolver for each; a ticket for any other kind is refused
 * by the route that issues it and again by the gateway). Story 1.12 registers `staging`; the stories that attach files to a Project (1.7's
 * wiring), retained pictures (2.12), artifact manifests (4.1) and exports (6.9) add theirs here and in the registry.
 */
export const transferTargetKinds = ['staging'] as const;
export type TransferTargetKind = (typeof transferTargetKinds)[number];

export function isTransferTargetKind(value: unknown): value is TransferTargetKind {
  return typeof value === 'string' && (transferTargetKinds as readonly string[]).includes(value);
}

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const hexPattern = /^[0-9a-f]{64}$/;
const kindPattern = /^[a-z][a-z0-9-]{0,31}$/;
const contentTypePattern = /^[a-z]+\/[a-z0-9.+-]{1,60}$/;

export const isUuid = (value: unknown): value is string => typeof value === 'string' && uuidPattern.test(value);
export const isSha256Hex = (value: unknown): value is string => typeof value === 'string' && hexPattern.test(value);
/** Whether a declared content type is shaped like one (`type/subtype`): the shape only, which `uploadProblem` then holds to the allowed ones. */
export const isContentTypeText = (value: unknown): value is string => typeof value === 'string' && contentTypePattern.test(value);

/** What an upload declares: why it cannot be accepted, or null. The one rule, for the route that issues the ticket and the gateway that takes the bytes. */
export function uploadProblem(upload: {cls: unknown; len: unknown; ct: unknown}): 'class' | 'length' | 'content_type' | 'too_large' | null {
  if (upload.cls !== 'picture' && upload.cls !== 'file') return 'class';
  if (typeof upload.len !== 'number' || !Number.isSafeInteger(upload.len) || upload.len < 1) return 'length';
  if (typeof upload.ct !== 'string') return 'content_type';
  if (upload.cls === 'picture' ? !(pictureTypes as readonly string[]).includes(upload.ct) : upload.ct !== fileType) return 'content_type';
  if (upload.len > (upload.cls === 'picture' ? transferLimits.pictureBytes : transferLimits.fileBytes)) return 'too_large';
  return null;
}

/** The claims of a transfer ticket (`typ: "ticket"`, `iss: "application"`, `aud: "gateway"`). No storage credential, no URL, nothing reusable. */
export type TicketClaims = {
  /** The Account, the session grant and the Account's authorization epoch the ticket was issued under (the database's, from the verified access). */
  acct: string;
  sid: string;
  epoch: number;
  dir: 'upload' | 'download';
  /** The kind of target and its ID. */
  tk: string;
  tid: string;
} & ({dir: 'download'} | {dir: 'upload'; cls: UploadClass; len: number; sha: string; ct: string});

export type UploadTicketClaims = Extract<TicketClaims, {dir: 'upload'}>;

/** Whether a ticket is for an upload (and so carries its class, length, SHA-256 and content type). */
export const isUploadTicket = (claims: TicketClaims): claims is UploadTicketClaims => claims.dir === 'upload';

const ticketBase = ['acct', 'sid', 'epoch', 'dir', 'tk', 'tid'];
const uploadOnly = ['cls', 'len', 'sha', 'ct'];

/** The ticket claims of a verified payload, or null when it is not exactly a ticket (an unknown claim is as bad as a missing one). */
export function ticketClaimsOf(payload: TokenPayload): TicketClaims | null {
  if (payload.typ !== 'ticket' || payload.iss !== 'application' || payload.aud !== 'gateway') return null;
  const {acct, sid, epoch, dir, tk, tid} = payload;
  if (!isUuid(acct) || !isUuid(sid) || !isUuid(tid) || typeof epoch !== 'number' || !Number.isSafeInteger(epoch) || epoch < 1) return null;
  if (typeof tk !== 'string' || !kindPattern.test(tk)) return null;
  const standard = [...reserved];
  const own = Object.keys(payload).filter((name) => !standard.includes(name)).sort();
  if (dir === 'download') {
    if (own.join() !== [...ticketBase].sort().join()) return null;
    return {acct, sid, epoch, dir, tk, tid};
  }
  if (dir === 'upload') {
    if (own.join() !== [...ticketBase, ...uploadOnly].sort().join()) return null;
    const {cls, len, sha, ct} = payload;
    // The SHAPE of an upload's claims only. Whether it is within the limits is decided where the bytes arrive (`uploadProblem`: 413 for a size over
    // the limit, 400 for a type that is not allowed), so that a ticket that is oversize is a refused upload and not an unreadable ticket.
    if ((cls !== 'picture' && cls !== 'file') || typeof len !== 'number' || !Number.isSafeInteger(len) || len < 1 || !isContentTypeText(ct) || !isSha256Hex(sha)) return null;
    return {acct, sid, epoch, dir, tk, tid, cls, len, sha, ct};
  }
  return null;
}

/** The commands the application sends the gateway (`typ: "command"`). The gateway's only deleter is the gateway; these are how it is told to. */
export const commandNames = ['attach', 'delete-staging', 'delete-root'] as const;
export type CommandName = (typeof commandNames)[number];

export type CommandClaims =
  | {cmd: 'attach'; acct: string; epoch: number; uid: string; tr: string}
  | {cmd: 'delete-staging'; acct: string; uid: string}
  | {cmd: 'delete-root'; acct: string; root: string};

const transferPattern = /^[a-z][a-z0-9-]{0,62}$/;

/** The command claims of a verified payload, or null when it is not exactly a command. */
export function commandClaimsOf(payload: TokenPayload): CommandClaims | null {
  if (payload.typ !== 'command' || payload.iss !== 'application' || payload.aud !== 'gateway') return null;
  const own = Object.keys(payload).filter((name) => !reserved.includes(name)).sort().join();
  const {cmd, acct} = payload;
  if (!isUuid(acct)) return null;
  if (cmd === 'attach') {
    const {epoch, uid, tr} = payload;
    if (own !== ['acct', 'cmd', 'epoch', 'tr', 'uid'].join() || !isUuid(uid) || typeof epoch !== 'number' || !Number.isSafeInteger(epoch) || epoch < 1) return null;
    if (typeof tr !== 'string' || !transferPattern.test(tr)) return null;
    return {cmd, acct, epoch, uid, tr};
  }
  if (cmd === 'delete-staging') {
    const {uid} = payload;
    if (own !== ['acct', 'cmd', 'uid'].join() || !isUuid(uid)) return null;
    return {cmd, acct, uid};
  }
  if (cmd === 'delete-root') {
    const {root} = payload;
    if (own !== ['acct', 'cmd', 'root'].join() || !isSha256Hex(root)) return null;
    return {cmd, acct, root};
  }
  return null;
}

/** Signs a transfer ticket for the gateway. The claims are checked as the gateway will check them, so a ticket it would refuse is never made. */
export function signTicket(signer: Signer, environment: string, claims: TicketClaims, options: {now?: number; lifetimeSeconds?: number; jti?: string} = {}): string {
  const record: Record<string, string | number> = {...claims};
  const token = signToken(signer, {audience: 'gateway', environment, type: 'ticket', claims: record, ...options});
  const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8')) as TokenPayload;
  if (ticketClaimsOf(payload) === null) throw new TypeError('the claims are not those of a ticket');
  return token;
}

/** Signs a command for the gateway. */
export function signCommand(signer: Signer, environment: string, claims: CommandClaims, options: {now?: number; lifetimeSeconds?: number; jti?: string} = {}): string {
  const record: Record<string, string | number> = {...claims};
  const token = signToken(signer, {audience: 'gateway', environment, type: 'command', claims: record, ...options});
  const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8')) as TokenPayload;
  if (commandClaimsOf(payload) === null) throw new TypeError('the claims are not those of a command');
  return token;
}
