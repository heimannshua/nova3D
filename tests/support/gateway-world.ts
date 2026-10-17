import {createHash, randomBytes, randomUUID} from 'node:crypto';
import type {Client} from 'pg';
import {issueGrant, issueInvitation, registerWithCode} from '../../lib/accounts';
import {signCommand, signTicket, type CommandClaims, type ParsedKeySet, type Signer, type TicketClaims} from '../../lib/service-signing';
import {start, type StartOptions, type Started} from '../../workers/files/src/main';
import {createS3Storage, type GatewayStorage} from '../../workers/files/src/storage';
import {testSigner, type TestKeySetOptions} from './service-keys';
import {localStack, s3Of} from './stack';

// What the tests that run the file gateway (Story 1.12) share: the gateway started in-process against the real local database as its OWN role and
// the real local Storage, Accounts with a live session grant, tickets and commands signed with the test keys, and a Storage client of the test's
// own (the stack's key pair) to put an object where a test needs one and to see what is, and is not, there afterwards.

/** The password of the local gateway role (supabase/seed.sql). It opens nothing but the local database on loopback. */
const localRolePassword = 'nova3d-gateway-local';

export const roleUrl = () => {
  const url = new URL(localStack().dbUrl);
  url.username = 'nova3d_gateway';
  url.password = localRolePassword;
  return url.href;
};

/** The origin the application is "served from" in these tests: the one the gateway allows. */
export const appOrigin = 'http://127.0.0.1:4173';

export const sha256 = (bytes: Uint8Array | string) => createHash('sha256').update(bytes).digest('hex');
export const MiB = 1024 * 1024;

/** A PNG's eight-byte signature followed by random bytes: what the gateway's leading-bytes check calls a PNG. */
export const pngBytes = (length: number) => Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), randomBytes(Math.max(0, length - 8))]).subarray(0, length);
export const jpegBytes = (length: number) => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), randomBytes(Math.max(0, length - 4))]).subarray(0, length);
export const webpBytes = (length: number) => Buffer.concat([Buffer.from('RIFF'), Buffer.from([0, 0, 0, 0]), Buffer.from('WEBP'), randomBytes(Math.max(0, length - 12))]).subarray(0, length);

export type Member = {accountId: string; userId: string; sessionId: string; email: string};

/** An Account with a live Auth session and its session grant, registered the way the registration screen registers one. */
export async function createMember(
  db: Client,
  env: Record<string, string>,
  helpers: {addUser: (client: Client) => Promise<{id: string; email: string}>; addSession: (client: Client, userId: string) => Promise<string>; committedUsers: string[]; committedInvitations: string[]},
): Promise<Member> {
  const user = await helpers.addUser(db);
  helpers.committedUsers.push(user.id);
  const issued = await issueInvitation({kind: 'named', label: `gateway ${user.id.slice(0, 8)}`, actor: 'seed:local:gateway'}, {env});
  if (issued.outcome !== 'issued') throw new Error('The code was not issued.');
  helpers.committedInvitations.push(issued.invitationId);
  const receipt = await registerWithCode({userId: user.id, commandId: randomUUID(), code: issued.code, clientAddress: `203.0.113.${Math.floor(Math.random() * 250) + 1}`}, {env});
  if (receipt.outcome !== 'registered' || !receipt.accountId) throw new Error(`The test Account was not created (${receipt.outcome}).`);
  const sessionId = await helpers.addSession(db, user.id);
  const grant = await issueGrant(user.id, sessionId, {env});
  if (grant.outcome !== 'issued') throw new Error(`The test grant was not issued (${grant.outcome}).`);
  return {accountId: receipt.accountId, userId: user.id, sessionId, email: user.email};
}

/** The claims of a ticket a test signs: the Account, the session and the epoch default to the member's own (and epoch 1), the kind to `staging`. */
export type TicketInput = {dir: 'upload' | 'download'; tid: string; tk?: string; acct?: string; sid?: string; epoch?: number; cls?: string; len?: number; sha?: string; ct?: string};

export type Gateway = {
  url: string;
  started: Started;
  instanceId: string;
  signer: Signer;
  keySet: ParsedKeySet;
  keySetJson: string;
  /** The test's own Storage client (the stack's key pair): where it puts an object, and how it sees what is there. */
  storage: GatewayStorage;
  close: () => Promise<void>;
  /** A ticket for a member, signed with the test key. */
  ticket: (member: Member, claims: TicketInput, options?: {now?: number; lifetimeSeconds?: number; jti?: string; epoch?: number; environment?: string; signer?: Signer}) => string;
  command: (claims: CommandClaims, options?: {now?: number; lifetimeSeconds?: number; jti?: string; environment?: string; signer?: Signer}) => string;
};

export type GatewayOptions = StartOptions & {keys?: TestKeySetOptions; env?: Record<string, string | undefined>};

/** Starts the gateway on a free loopback port: the real database as its own role, the real Storage, the test keys. */
export async function startGateway(instanceId: string, options: GatewayOptions = {}): Promise<Gateway> {
  const stack = localStack();
  const s3 = s3Of(stack);
  const keys = testSigner(options.keys);
  const started = await start(
    {
      APP_ENV: 'local',
      INSTANCE_ID: instanceId,
      APP_ORIGIN: appOrigin,
      SERVICE_KEYS_APPLICATION: keys.json,
      GATEWAY_DATABASE_URL: roleUrl(),
      GATEWAY_STORAGE_S3_ENDPOINT: s3.endpoint,
      GATEWAY_STORAGE_S3_REGION: s3.region,
      GATEWAY_STORAGE_S3_ACCESS_KEY_ID: s3.accessKeyId,
      GATEWAY_STORAGE_S3_SECRET_ACCESS_KEY: s3.secretAccessKey,
      ...options.env,
    },
    {port: 0, host: '127.0.0.1', ...options},
  );
  const environment = instanceId;
  return {
    url: `http://127.0.0.1:${started.port}`,
    started,
    instanceId,
    signer: keys.signer,
    keySet: keys.keySet,
    keySetJson: keys.json,
    storage: createS3Storage(s3),
    close: () => started.close(),
    ticket: (member, claims, signing = {}) => {
      const base = {acct: member.accountId, sid: member.sessionId, epoch: signing.epoch ?? 1, tk: claims.tk ?? 'staging'};
      // A claim a test leaves `undefined` is one it does not override (the member's own, or the default kind, stays).
      const given = Object.fromEntries(Object.entries(claims).filter(([, value]) => value !== undefined));
      const merged = {...base, ...given};
      return signTicket(signing.signer ?? keys.signer, signing.environment ?? environment, merged as unknown as TicketClaims, signing);
    },
    command: (claims, signing = {}) => signCommand(signing.signer ?? keys.signer, signing.environment ?? environment, claims, signing),
  };
}

/** What a client sends with an upload: the headers the ticket's claims must equal. */
export function uploadHeaders(ticket: string, bytes: Uint8Array, contentType = 'image/png', sha = sha256(bytes)) {
  return {authorization: `Ticket ${ticket}`, 'content-type': contentType, 'content-length': String(bytes.length), 'x-content-sha256': sha};
}

/** The claims of an upload ticket for these bytes. */
export function uploadClaims(id: string, bytes: Uint8Array, options: {cls?: 'picture' | 'file'; ct?: string; sha?: string} = {}) {
  const cls = options.cls ?? 'picture';
  return {dir: 'upload' as const, tid: id, cls, len: bytes.length, sha: options.sha ?? sha256(bytes), ct: options.ct ?? (cls === 'picture' ? 'image/png' : 'application/octet-stream')};
}

/** The member's epoch as the database has it (a ticket carries the epoch the Account is under). */
export async function epochOf(db: Client, accountId: string): Promise<number> {
  const {rows} = await db.query('select authorization_epoch::int as epoch from identity.accounts where id = $1', [accountId]);
  return rows[0].epoch;
}
