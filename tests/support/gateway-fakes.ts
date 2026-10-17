import {createHash, randomBytes, randomUUID} from 'node:crypto';
import type {AttachmentReceipt, CommandRedemption, GatewayDatabase, HandleAuthorization, Lease, LeaseState, NewLease, Row, SessionAuthority, TransferOpening} from '../../workers/files/src/database';
import {MissingObject, type ByteRange, type GatewayStorage, type StoredBody} from '../../workers/files/src/storage';

// In-memory stand-ins for the file gateway's two collaborators (Story 1.12), for the unit tests of workers/files/src/server.ts: a database that
// behaves the way the gateway role's database does (the same state machine of a lease, the same quota, the same redemption that refuses a replay and
// a revoked key, the same live read of a handle against its session grant, the same artifacts.publish_attachment) and a Storage that holds
// objects in memory. Nothing here is reachable but through the interfaces the gateway uses, and each can be told to be unreachable.
//
// The fakes record every call, in order, so a test can say what was asked ("zero database calls") and in which order ("an authorization read before
// every chunk"). They are deliberately strict where the real thing is: a key that is not one of the two the bucket holds, a lease that breaks its own
// constraints, a redemption that repeats, all throw or refuse here as they do there.

export const MiB = 1024 * 1024;

/** The database could not be reached. The message is the kind a driver writes (a host, a role): it must never reach a response or a log. */
export class DatabaseUnavailable extends Error {
  constructor() {
    super('connection refused by db.internal.example:5432 (password authentication failed for role "nova3d_gateway")');
    this.name = 'DatabaseUnavailable';
  }
}

/** The database's clock, as the gateway sees it: a time a test moves. */
export type FakeClock = {ms: number; now: () => Date; seconds: () => number; set: (ms: number) => void; advance: (ms: number) => void};

export function fakeClock(start: number): FakeClock {
  const clock = {
    ms: start,
    now: () => new Date(clock.ms),
    seconds: () => Math.floor(clock.ms / 1000),
    set: (ms: number) => {
      clock.ms = ms;
    },
    advance: (ms: number) => {
      clock.ms += ms;
    },
  };
  return clock;
}

// Bytes ---------------------------------------------------------------------------------------------------------------------

/** A PNG's eight-byte signature followed by random bytes. */
export const pngBytes = (length: number) => Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), randomBytes(Math.max(0, length - 8))]).subarray(0, length);
export const jpegBytes = (length: number) => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), randomBytes(Math.max(0, length - 4))]).subarray(0, length);
export const webpBytes = (length: number) => Buffer.concat([Buffer.from('RIFF'), Buffer.from([0, 0, 0, 0]), Buffer.from('WEBP'), randomBytes(Math.max(0, length - 12))]).subarray(0, length);
export const sha256 = (bytes: Uint8Array | string) => createHash('sha256').update(bytes).digest('hex');

// The database ----------------------------------------------------------------------------------------------------------------

export type FakeAccount = {epoch: number; status: 'active' | 'disabled' | 'tombstoned'};
/** A session grant as artifacts.session_authority shows it: the Account it belongs to and its liveness (`active`, `revoked`, `disabled`, ...). */
export type FakeSession = {accountId: string; state: string};
export type FakeMember = {accountId: string; sessionId: string; epoch: number};
export type FakeRedemption = {jti: string; typ: 'ticket' | 'command'; kid: string; accountId: string; sessionId: string | null; direction: string | null; targetKind: string; targetId: string; expiresAt: Date; redeemedAt: Date};
export type FakeHandle = {hash: string; jti: string; sessionId: string; accountId: string; epoch: number; direction: 'upload' | 'download'; targetKind: string; targetId: string; kid: string; createdAt: Date; expiresAt: Date; endedAt: Date | null};
export type FakeManifest = {root: string; id: string; accountId: string; uploadId: string; kind: string; digest: string; length: number; activity: string; body: string};

export type FakeDatabase = GatewayDatabase & {
  accounts: Map<string, FakeAccount>;
  sessions: Map<string, FakeSession>;
  redemptions: Map<string, FakeRedemption>;
  handles: Map<string, FakeHandle>;
  leases: Map<string, Lease>;
  manifests: Map<string, FakeManifest>;
  transforms: Set<string>;
  revokedKeys: Set<string>;
  /** Every method asked of the database, in order (a `query` is one entry). */
  calls: string[];
  count: (method: string) => number;
  /** When true every method rejects with DatabaseUnavailable (the call is still logged). */
  down: boolean;
  /** Methods that reject while the rest answer. */
  failing: Set<string>;
  addMember: (options?: {epoch?: number; status?: FakeAccount['status']; state?: string}) => FakeMember;
  /** Adds another session grant of the same Account. */
  addSession: (accountId: string, state?: string) => string;
  disableAccount: (accountId: string) => void;
  tombstoneAccount: (accountId: string) => void;
  raiseEpoch: (accountId: string) => void;
  revokeSession: (sessionId: string, state?: string) => void;
  /** What api.revoke_service_key does: the key is refused from now on, and its handles and open leases end. */
  revokeKey: (kid: string) => {leases: number; transfers: number};
  seedLease: (lease: Partial<Lease> & {id: string; accountId: string}) => Lease;
  openBytes: (accountId: string) => number;
  /** The manifest of an upload, or undefined. */
  manifestOf: (uploadId: string) => FakeManifest | undefined;
};

const stagingQueryPattern = /from artifacts\.staging_leases/;
const pictureTypes = ['image/jpeg', 'image/png', 'image/webp'];

export function fakeDatabase(options: {clock: FakeClock; instanceId?: string}): FakeDatabase {
  const {clock} = options;
  const calls: string[] = [];
  const hex = (hash: Buffer) => hash.toString('hex');
  const state = {down: false};
  const failing = new Set<string>();

  const enter = (method: string) => {
    calls.push(method);
    if (state.down || failing.has(method)) throw new DatabaseUnavailable();
  };

  const accounts = new Map<string, FakeAccount>();
  const sessions = new Map<string, FakeSession>();
  const redemptions = new Map<string, FakeRedemption>();
  const handles = new Map<string, FakeHandle>();
  const leases = new Map<string, Lease>();
  const manifests = new Map<string, FakeManifest>();
  const transforms = new Set<string>(['none']);
  const revokedKeys = new Set<string>();

  const openBytes = (accountId: string, now = clock.now()) =>
    [...leases.values()].filter((lease) => lease.accountId === accountId && (lease.state === 'receiving' || lease.state === 'complete') && lease.expiresAt > now).reduce((sum, lease) => sum + lease.length, 0);

  /** The row constraints of artifacts.staging_leases, so a lease the gateway writes that the real table would refuse is refused here. */
  function checkLease(lease: Lease) {
    const ok =
      lease.length >= 1 &&
      lease.length <= 100 * MiB &&
      /^[0-9a-f]{64}$/.test(lease.sha256) &&
      (lease.kind === 'picture' ? lease.length <= 12 * MiB && pictureTypes.includes(lease.contentType) : lease.contentType === 'application/octet-stream') &&
      lease.receivedLength >= 0 &&
      lease.receivedLength <= lease.length;
    if (!ok) throw new Error('new row for relation "staging_leases" violates a check constraint');
  }

  const transitions: Record<LeaseState, LeaseState[]> = {
    receiving: ['complete', 'released'],
    complete: ['attached', 'released'],
    attached: ['released'],
    released: ['deleted'],
    deleted: [],
  };
  /** artifacts.guard_lease: a lease moves forward only. */
  function move(lease: Lease, next: LeaseState) {
    if (next !== lease.state && !transitions[lease.state].includes(next)) throw new Error(`a staging lease cannot go from ${lease.state} to ${next}`);
    lease.state = next;
  }

  const db: FakeDatabase = {
    accounts,
    sessions,
    redemptions,
    handles,
    leases,
    manifests,
    transforms,
    revokedKeys,
    calls,
    count: (method) => calls.filter((call) => call === method).length,
    get down() {
      return state.down;
    },
    set down(value: boolean) {
      state.down = value;
    },
    failing,
    openBytes,
    manifestOf: (uploadId) => manifests.get(uploadId),

    addMember(settings = {}) {
      const accountId = randomUUID();
      const sessionId = randomUUID();
      const epoch = settings.epoch ?? 1;
      accounts.set(accountId, {epoch, status: settings.status ?? 'active'});
      sessions.set(sessionId, {accountId, state: settings.state ?? 'active'});
      return {accountId, sessionId, epoch};
    },
    addSession(accountId, sessionState = 'active') {
      const sessionId = randomUUID();
      sessions.set(sessionId, {accountId, state: sessionState});
      return sessionId;
    },
    disableAccount(accountId) {
      const account = accounts.get(accountId)!;
      account.status = 'disabled';
      account.epoch += 1;
      for (const session of sessions.values()) if (session.accountId === accountId) session.state = 'disabled';
    },
    tombstoneAccount(accountId) {
      db.disableAccount(accountId);
      accounts.get(accountId)!.status = 'tombstoned';
      for (const session of sessions.values()) if (session.accountId === accountId) session.state = 'tombstoned';
    },
    raiseEpoch(accountId) {
      accounts.get(accountId)!.epoch += 1;
      for (const session of sessions.values()) if (session.accountId === accountId && session.state === 'active') session.state = 'stale_epoch';
    },
    revokeSession(sessionId, sessionState = 'revoked') {
      sessions.get(sessionId)!.state = sessionState;
    },
    revokeKey(kid) {
      revokedKeys.add(kid);
      let transfers = 0;
      let ended = 0;
      for (const handle of handles.values()) {
        if (handle.kid === kid && handle.endedAt === null) {
          handle.endedAt = clock.now();
          transfers += 1;
        }
      }
      for (const lease of leases.values()) {
        if (lease.kid === kid && (lease.state === 'receiving' || lease.state === 'complete')) {
          move(lease, 'released');
          ended += 1;
        }
      }
      return {leases: ended, transfers};
    },
    seedLease(seed) {
      const length = seed.length ?? 1000;
      const lease: Lease = {
        kid: 'test-application-1',
        kind: 'file',
        length,
        sha256: sha256(String(length)),
        contentType: seed.kind === 'picture' ? 'image/png' : 'application/octet-stream',
        receivedLength: seed.state === undefined || seed.state === 'receiving' ? 0 : length,
        state: 'complete',
        expiresAt: new Date(clock.ms + 24 * 3600 * 1000),
        ...seed,
      };
      checkLease(lease);
      leases.set(lease.id, lease);
      return lease;
    },

    async instance() {
      enter('instance');
      return {environment: 'local', instanceId: options.instanceId ?? '3f0d6c1e-8a52-4c1b-9d57-2b6a1f0e7c44'};
    },

    async authority(sessionId): Promise<SessionAuthority | null> {
      enter('authority');
      const session = sessions.get(sessionId);
      if (!session) return null;
      return {state: session.state, accountId: session.accountId, epoch: accounts.get(session.accountId)!.epoch};
    },

    async openTransfer(opening: TransferOpening) {
      enter('openTransfer');
      // One transaction: the redemption, then the handle. A replay (the jti is the key) and a revoked key refuse it, and nothing is left behind.
      if (redemptions.has(opening.jti) || revokedKeys.has(opening.kid)) return 'refused';
      if (opening.handleExpiresAt.getTime() <= opening.now.getTime() || opening.handleExpiresAt.getTime() - opening.now.getTime() > 30 * 60 * 1000) {
        throw new Error('new row for relation "transfer_handles" violates check constraint "transfer_handles_check"');
      }
      redemptions.set(opening.jti, {
        jti: opening.jti,
        typ: 'ticket',
        kid: opening.kid,
        accountId: opening.accountId,
        sessionId: opening.sessionId,
        direction: opening.direction,
        targetKind: opening.targetKind,
        targetId: opening.targetId,
        expiresAt: opening.expiresAt,
        redeemedAt: opening.now,
      });
      handles.set(hex(opening.handleHash), {
        hash: hex(opening.handleHash),
        jti: opening.jti,
        sessionId: opening.sessionId,
        accountId: opening.accountId,
        epoch: opening.epoch,
        direction: opening.direction,
        targetKind: opening.targetKind,
        targetId: opening.targetId,
        kid: opening.kid,
        createdAt: opening.now,
        expiresAt: opening.handleExpiresAt,
        endedAt: null,
      });
      return 'opened';
    },

    async redeemCommand(redemption: CommandRedemption) {
      enter('redeemCommand');
      if (redemptions.has(redemption.jti) || revokedKeys.has(redemption.kid)) return 'refused';
      redemptions.set(redemption.jti, {
        jti: redemption.jti,
        typ: 'command',
        kid: redemption.kid,
        accountId: redemption.accountId,
        sessionId: null,
        direction: null,
        targetKind: redemption.name,
        targetId: redemption.targetId,
        expiresAt: redemption.expiresAt,
        redeemedAt: redemption.now,
      });
      return 'redeemed';
    },

    async authorizeHandle(handleHash, now): Promise<HandleAuthorization> {
      enter('authorizeHandle');
      const handle = handles.get(hex(handleHash));
      if (!handle || !(handle.expiresAt > now) || handle.endedAt !== null) return {outcome: 'denied'};
      const session = sessions.get(handle.sessionId);
      const account = session ? accounts.get(session.accountId) : undefined;
      if (!session || !account || session.state !== 'active' || session.accountId !== handle.accountId || account.epoch !== handle.epoch) return {outcome: 'denied'};
      return {outcome: 'allowed', accountId: handle.accountId, sessionId: handle.sessionId, epoch: handle.epoch, direction: handle.direction, targetKind: handle.targetKind, targetId: handle.targetId};
    },

    // The only read the gateway's registered resolvers make: the staging resolver's (workers/files/src/resolvers.ts).
    async query(sql, params): Promise<Row[]> {
      enter('query');
      if (!stagingQueryPattern.test(sql) || !/state = any\(\$3\)/.test(sql)) throw new Error('the fake database does not know this query');
      const [id, accountId, states, now] = params as [string, string, string[], Date];
      const lease = leases.get(id);
      if (!lease || lease.accountId !== accountId || !states.includes(lease.state) || !(lease.expiresAt > now)) return [];
      return [{length: String(lease.length), content_type: lease.contentType, sha256: lease.sha256}];
    },

    async createLease(lease: NewLease) {
      enter('createLease');
      // The one transaction of the real method: the upload ID is taken once (by anyone), then the Account's open staging is summed, new lease included.
      if (leases.has(lease.id)) return 'exists';
      const next: Lease = {
        id: lease.id,
        accountId: lease.accountId,
        kid: lease.kid,
        kind: lease.kind,
        length: lease.length,
        sha256: lease.sha256,
        contentType: lease.contentType,
        receivedLength: 0,
        state: 'receiving',
        expiresAt: lease.expiresAt,
      };
      checkLease(next);
      leases.set(next.id, next);
      if (openBytes(lease.accountId, lease.now) > lease.quotaBytes) {
        leases.delete(next.id);
        return 'quota_exceeded';
      }
      return 'created';
    },

    async lease(id, accountId) {
      enter('lease');
      const lease = leases.get(id);
      return lease && lease.accountId === accountId ? {...lease} : null;
    },

    async progress(id, accountId, receivedLength, expiresAt) {
      enter('progress');
      const lease = leases.get(id);
      if (!lease || lease.accountId !== accountId || lease.state !== 'receiving' || lease.receivedLength > receivedLength) return false;
      lease.receivedLength = receivedLength;
      lease.expiresAt = expiresAt;
      checkLease(lease);
      return true;
    },

    async complete(id, accountId, receivedLength, expiresAt) {
      enter('complete');
      const lease = leases.get(id);
      if (!lease || lease.accountId !== accountId || lease.state !== 'receiving' || lease.length !== receivedLength) return false;
      lease.receivedLength = receivedLength;
      lease.expiresAt = expiresAt;
      move(lease, 'complete');
      return true;
    },

    async release(id, accountId) {
      enter('release');
      const lease = leases.get(id);
      if (!lease || lease.accountId !== accountId || lease.state !== 'receiving') return false;
      move(lease, 'released');
      return true;
    },

    async claimDeletion(id, accountId, now) {
      enter('claimDeletion');
      const lease = leases.get(id);
      if (!lease || lease.accountId !== accountId || lease.state === 'deleted' || !(lease.state === 'released' || lease.expiresAt <= now)) return false;
      move(lease, 'released');
      return true;
    },

    async markDeleted(id, accountId) {
      enter('markDeleted');
      const lease = leases.get(id);
      if (!lease || lease.accountId !== accountId || lease.state !== 'released') return false;
      move(lease, 'deleted');
      return true;
    },

    // artifacts.publish_attachment, step for step.
    async publishAttachment(input): Promise<AttachmentReceipt> {
      enter('publishAttachment');
      const receipt = (outcome: AttachmentReceipt['outcome'], root: string | null = null, manifestId: string | null = null): AttachmentReceipt => ({outcome, root, manifestId});
      const account = accounts.get(input.accountId);
      if (!account || account.status !== 'active' || account.epoch !== input.epoch) return receipt('denied');
      const lease = leases.get(input.uploadId);
      if (!lease || lease.accountId !== input.accountId) return receipt('not_found');
      const existing = manifests.get(input.uploadId);
      if (existing) return receipt(existing.root === input.root ? 'exists' : 'root_mismatch', existing.root, existing.id);
      if (lease.state !== 'complete') return receipt('not_complete');
      // A lease whose time has passed is not attachable (the cleanup may be deleting its staging object).
      if (lease.expiresAt.getTime() <= options.clock.ms) return receipt('expired');
      if (!transforms.has(input.transform)) return receipt('transform_unknown');
      if (sha256(input.body) !== input.root) return receipt('root_mismatch');
      // The body must be, byte for byte, the canonical text of this lease's manifest: built here the way the SQL builds it, and compared whole.
      const canonical = `{"activity":"upload:${input.transform}","children":[],"digest":"${lease.sha256}","id":"${input.uploadId}","kind":"${lease.kind}","length":${lease.length},"scope":"${input.accountId}","serialization":1}`;
      if (input.body !== canonical) return receipt('body_mismatch');
      const expected = {activity: `upload:${input.transform}`};
      manifests.set(input.uploadId, {root: input.root, id: input.uploadId, accountId: input.accountId, uploadId: input.uploadId, kind: lease.kind, digest: lease.sha256, length: lease.length, activity: expected.activity, body: input.body});
      move(lease, 'attached');
      return receipt('published', input.root, input.uploadId);
    },

    async close() {
      // Nothing to close.
    },
  };
  return db;
}

// Storage ----------------------------------------------------------------------------------------------------------------------

export type FakeObject = {bytes: Buffer; contentType: string};

export type FakeStorage = GatewayStorage & {
  objects: Map<string, FakeObject>;
  /** Every call, in order, as `method:key`. */
  calls: string[];
  /** How many uploads were abandoned because their stream threw: nothing of them is stored. */
  abortedPuts: number;
  /** The sizes of the pieces each put was given, by key (the gateway hands Storage chunks of at most 1 MiB). */
  putPieces: Map<string, number[]>;
  /** How many reads were cancelled by the gateway (each counted once). */
  cancels: number;
  /** Called before each piece a read yields: the per-read throttle. */
  beforeRead: (() => void | Promise<void>) | null;
  /** The size of the pieces a read yields (a socket's, not a chunk's). */
  pieceBytes: number;
  /** How many bytes fewer than its reported length a read yields before it ends WITHOUT an error: a stored object that is shorter than it says. */
  truncateBy: number;
  /** When set, every method rejects with this. */
  failure: Error | null;
  keys: () => string[];
};

const keyPattern = /^(?:staging|objects)\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/(?:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|[0-9a-f]{64})$/;

export function fakeStorage(): FakeStorage {
  const objects = new Map<string, FakeObject>();
  const calls: string[] = [];
  const putPieces = new Map<string, number[]>();
  const checked = (key: string) => {
    if (!keyPattern.test(key)) throw new TypeError('not a key of this bucket');
    return key;
  };

  const storage: FakeStorage = {
    objects,
    calls,
    abortedPuts: 0,
    putPieces,
    cancels: 0,
    beforeRead: null,
    pieceBytes: 64 * 1024,
    truncateBy: 0,
    failure: null,
    keys: () => [...objects.keys()].sort(),

    async put(key, body, options) {
      calls.push(`put:${key}`);
      if (storage.failure) throw storage.failure;
      checked(key);
      const parts: Buffer[] = [];
      const sizes: number[] = [];
      putPieces.set(key, sizes);
      try {
        for await (const piece of body) {
          parts.push(Buffer.from(piece));
          sizes.push(piece.byteLength);
        }
      } catch (error) {
        // The multipart upload is aborted with its parts: nothing is stored.
        storage.abortedPuts += 1;
        throw error;
      }
      objects.set(key, {bytes: Buffer.concat(parts), contentType: options.contentType});
    },

    async get(key, range: ByteRange | null): Promise<StoredBody> {
      calls.push(`get:${key}`);
      if (storage.failure) throw storage.failure;
      const object = objects.get(checked(key));
      if (!object) throw new MissingObject();
      const start = range ? range.start : 0;
      const end = range ? Math.min(range.end, object.bytes.length - 1) : object.bytes.length - 1;
      const slice = object.bytes.subarray(start, end + 1);
      // What the read yields: all of it, or (truncateBy) fewer bytes than the length it reports, ending as if it were done.
      const yielded = slice.subarray(0, Math.max(0, slice.length - storage.truncateBy));
      const state = {cancelled: false};
      async function* pieces() {
        for (let offset = 0; offset < yielded.length; offset += storage.pieceBytes) {
          if (state.cancelled) return;
          if (storage.beforeRead) await storage.beforeRead();
          if (state.cancelled) return;
          yield yielded.subarray(offset, Math.min(offset + storage.pieceBytes, yielded.length));
        }
      }
      return {
        body: pieces(),
        length: slice.length,
        cancel: () => {
          // A read is cancelled once, however many times the gateway says so.
          if (state.cancelled) return;
          state.cancelled = true;
          storage.cancels += 1;
        },
      };
    },

    async copy(from, to) {
      calls.push(`copy:${from}>${to}`);
      if (storage.failure) throw storage.failure;
      const object = objects.get(checked(from));
      if (!object) throw new MissingObject();
      objects.set(checked(to), {bytes: Buffer.from(object.bytes), contentType: object.contentType});
    },

    async delete(key) {
      calls.push(`delete:${key}`);
      if (storage.failure) throw storage.failure;
      objects.delete(checked(key));
    },

    async deletePrefix(prefix) {
      calls.push(`deletePrefix:${prefix}`);
      if (storage.failure) throw storage.failure;
      if (!keyPattern.test(prefix)) throw new TypeError('not a prefix of this bucket');
      let deleted = 0;
      // Exactly this prefix: the key itself, or something beneath `prefix/`.
      for (const key of [...objects.keys()]) {
        if (key === prefix || key.startsWith(`${prefix}/`)) {
          objects.delete(key);
          deleted += 1;
        }
      }
      return deleted;
    },
  };
  return storage;
}
