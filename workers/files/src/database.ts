// The gateway's database, as its own role sees it (`nova3d_gateway`, supabase/migrations/20261015120000_file_gateway.sql): select on two views,
// insert and select on the redemptions, handles and leases (update on a lease's progress columns), execute on artifacts.publish_attachment.
// Nothing else. It never holds the service-role key, so it cannot call `api` functions; the views and tables of `artifacts` are the SQL twin of
// the application's guards.
//
// Every method is one question or one statement of the contract, and none of them caches an answer: the gateway asks again before every chunk.
// A database that does not answer makes a method THROW (a rejected promise), which the caller turns into 503 before bytes and a closed stream
// after: never into an allow. Nothing here logs, and no error message holds a ticket, a handle, a key or a body.
//
// Hosted, the gateway connects through the Supabase pooler in transaction mode: no session state, no named prepared statements. Everything here
// is plain parameterized text (pg's unnamed statements), and each transaction runs on one checked-out connection.
import {Pool} from 'pg';

/** Bigint columns arrive as text; the values here are small, so they are numbers. */
const whole = (value: unknown): number => {
  const number = typeof value === 'number' ? value : Number(value);
  if (!Number.isSafeInteger(number)) throw new TypeError('the database answered a number that is not a whole number');
  return number;
};
const text = (value: unknown): string => {
  if (typeof value !== 'string') throw new TypeError('the database answered a value that is not text');
  return value;
};

export type Row = Record<string, unknown>;
/** A read: what a resolver is given (lib of resolvers.ts). */
export type Query = (sql: string, params: unknown[]) => Promise<Row[]>;

export type SessionAuthority = {state: string; accountId: string; epoch: number};

export type TransferOpening = {
  jti: string;
  kid: string;
  accountId: string;
  sessionId: string;
  epoch: number;
  direction: 'upload' | 'download';
  targetKind: string;
  targetId: string;
  /** The ticket's own expiry. */
  expiresAt: Date;
  /** SHA-256 of the handle's 32 random bytes. */
  handleHash: Buffer;
  handleExpiresAt: Date;
  now: Date;
};

export type CommandRedemption = {jti: string; kid: string; accountId: string; name: string; targetId: string; expiresAt: Date; now: Date};

export type HandleAuthorization =
  | {outcome: 'allowed'; accountId: string; sessionId: string; epoch: number; direction: 'upload' | 'download'; targetKind: string; targetId: string}
  | {outcome: 'denied'};

export type LeaseState = 'receiving' | 'complete' | 'attached' | 'released' | 'deleted';
export type Lease = {
  id: string;
  accountId: string;
  kid: string;
  kind: 'picture' | 'file';
  length: number;
  sha256: string;
  contentType: string;
  receivedLength: number;
  state: LeaseState;
  expiresAt: Date;
};

export type NewLease = {id: string; accountId: string; kid: string; kind: 'picture' | 'file'; length: number; sha256: string; contentType: string; now: Date; expiresAt: Date; quotaBytes: number};

export type AttachmentOutcome = 'published' | 'exists' | 'denied' | 'not_found' | 'not_complete' | 'expired' | 'transform_unknown' | 'root_mismatch' | 'body_mismatch';
export type AttachmentReceipt = {outcome: AttachmentOutcome; root: string | null; manifestId: string | null};

export type GatewayDatabase = {
  /** The environment and instance ID of this database (`artifacts.instance`). */
  instance(): Promise<{environment: string; instanceId: string}>;
  /** The liveness of one session grant (`artifacts.session_authority`), or null when no such grant exists. */
  authority(sessionId: string): Promise<SessionAuthority | null>;
  /** Redeems a ticket and opens its transfer handle in ONE transaction: `refused` for a replay (the jti is taken) and for a revoked key. */
  openTransfer(opening: TransferOpening): Promise<'opened' | 'refused'>;
  /** Redeems a command (the same record, no handle): `refused` for a replay and for a revoked key. */
  redeemCommand(redemption: CommandRedemption): Promise<'redeemed' | 'refused'>;
  /** Whether a handle is live and its session grant and Account are still allowed RIGHT NOW (never cached). */
  authorizeHandle(handleHash: Buffer, now: Date): Promise<HandleAuthorization>;
  /** A read for a resolver. */
  query: Query;
  /** Takes the upload ID and the Account's quota in one transaction: `exists` (anyone's lease has the ID) or `quota_exceeded` leave nothing behind. */
  createLease(lease: NewLease): Promise<'created' | 'exists' | 'quota_exceeded'>;
  lease(id: string, accountId: string): Promise<Lease | null>;
  /** Records bytes received and renews the lease; false when the lease is no longer `receiving` (it was released, or is gone). */
  progress(id: string, accountId: string, receivedLength: number, expiresAt: Date): Promise<boolean>;
  /** `receiving` -> `complete`, with every byte counted; false when the lease is no longer receiving. */
  complete(id: string, accountId: string, receivedLength: number, expiresAt: Date): Promise<boolean>;
  /** `receiving` -> `released`; false when it was not receiving. */
  release(id: string, accountId: string): Promise<boolean>;
  /**
   * The cleanup's one statement: marks the lease `released` only if it is, at this moment, expired or released already (and not deleted), and
   * says whether it did. A lease that was renewed meanwhile is not touched.
   */
  claimDeletion(id: string, accountId: string, now: Date): Promise<boolean>;
  /** `released` -> `deleted`, once its staging object is gone. */
  markDeleted(id: string, accountId: string): Promise<boolean>;
  publishAttachment(input: {accountId: string; epoch: number; uploadId: string; transform: string; root: string; body: string}): Promise<AttachmentReceipt>;
  close(): Promise<void>;
};

/** The unique-violation and the revoked-key codes a redemption can be refused with. */
const refusals = new Set(['23505', 'N3040']);

/** The part of a `pg` pool the gateway uses: the real pool, or a test's fake that hands out a connection that fails the way a dropped one does. */
export type PoolLike = Pick<Pool, 'connect' | 'query' | 'end' | 'on'>;

export type PostgresOptions = {
  connectionString: string;
  /** For a test: the pool to use instead of one made from `connectionString`. */
  pool?: PoolLike;
  /** At most this many connections (the pool's size). */
  max?: number;
  /** How long one query may take before the gateway gives up on it. */
  queryTimeoutMs?: number;
  connectionTimeoutMs?: number;
};

/** The database of a running gateway: a pool of connections as the gateway role. */
export function createPostgresDatabase(options: PostgresOptions): GatewayDatabase {
  // The limits are the CLIENT's (a query that takes too long is given up on here), not startup parameters sent to the server: a pooler in transaction
  // mode does not accept every startup parameter, and holds no session state for a `set` to live in.
  const pool: PoolLike =
    options.pool ??
    new Pool({
      connectionString: options.connectionString,
      max: options.max ?? 10,
      query_timeout: options.queryTimeoutMs ?? 10_000,
      connectionTimeoutMillis: options.connectionTimeoutMs ?? 5_000,
      idleTimeoutMillis: 30_000,
    });
  // An idle connection that the database drops is reported here and replaced by the pool; it must not end the process.
  pool.on('error', () => undefined);

  const query: Query = async (sql, params) => (await pool.query(sql, params)).rows as Row[];

  async function transaction<T>(work: (run: Query) => Promise<T>): Promise<T> {
    const client = await pool.connect();
    // The pool listens for a connection's 'error' only while it is idle. A connection that is checked out and dropped (the database restarted, the pooler cut
    // it) emits 'error' with nobody listening, and an unhandled 'error' event ends the process. The listener does nothing: the query that was waiting on
    // that connection fails by itself (which is how the caller learns), and the connection is not trusted again.
    const ignore = () => undefined;
    client.on('error', ignore);
    let failure: unknown;
    try {
      await client.query('begin');
      const result = await work(async (sql, params) => (await client.query(sql, params)).rows as Row[]);
      await client.query('commit');
      return result;
    } catch (error) {
      failure = error;
      await client.query('rollback').catch(() => undefined);
      throw error;
    } finally {
      // A connection that failed is not trusted again.
      client.off('error', ignore);
      client.release(failure !== undefined ? true : undefined);
    }
  }

  const leaseOf = (row: Row): Lease => ({
    id: text(row.id),
    accountId: text(row.account_id),
    kid: text(row.kid),
    kind: row.kind === 'picture' ? 'picture' : 'file',
    length: whole(row.length),
    sha256: text(row.sha256),
    contentType: text(row.content_type),
    receivedLength: whole(row.received_length),
    state: text(row.state) as LeaseState,
    expiresAt: row.expires_at as Date,
  });

  return {
    async instance() {
      const rows = await query('select environment, instance_id from artifacts.instance', []);
      if (rows.length !== 1) throw new Error('artifacts.instance does not hold exactly one row');
      return {environment: text(rows[0].environment), instanceId: text(rows[0].instance_id)};
    },

    async authority(sessionId) {
      const rows = await query('select state, account_id, epoch from artifacts.session_authority where session_id = $1', [sessionId]);
      if (rows.length === 0) return null;
      return {state: text(rows[0].state), accountId: text(rows[0].account_id), epoch: whole(rows[0].epoch)};
    },

    async openTransfer(opening) {
      try {
        await transaction(async (run) => {
          await run(
            `insert into artifacts.ticket_redemptions (jti, typ, issuer, kid, account_id, session_id, direction, target_kind, target_id, expires_at, redeemed_at)
             values ($1, 'ticket', 'application', $2, $3, $4, $5, $6, $7, $8, $9)`,
            [opening.jti, opening.kid, opening.accountId, opening.sessionId, opening.direction, opening.targetKind, opening.targetId, opening.expiresAt, opening.now],
          );
          await run(
            `insert into artifacts.transfer_handles (hash, jti, session_id, account_id, epoch, direction, target_kind, target_id, kid, created_at, expires_at)
             values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
            [opening.handleHash, opening.jti, opening.sessionId, opening.accountId, opening.epoch, opening.direction, opening.targetKind, opening.targetId, opening.kid, opening.now, opening.handleExpiresAt],
          );
        });
        return 'opened';
      } catch (error) {
        if (refusals.has(String((error as {code?: unknown}).code))) return 'refused';
        throw error;
      }
    },

    async redeemCommand(redemption) {
      try {
        await query(
          `insert into artifacts.ticket_redemptions (jti, typ, issuer, kid, account_id, target_kind, target_id, expires_at, redeemed_at)
           values ($1, 'command', 'application', $2, $3, $4, $5, $6, $7)`,
          [redemption.jti, redemption.kid, redemption.accountId, redemption.name, redemption.targetId, redemption.expiresAt, redemption.now],
        );
        return 'redeemed';
      } catch (error) {
        if (refusals.has(String((error as {code?: unknown}).code))) return 'refused';
        throw error;
      }
    },

    async authorizeHandle(handleHash, now) {
      const rows = await query(
        `select h.account_id, h.session_id, h.epoch, h.direction, h.target_kind, h.target_id,
                (h.expires_at > $2 and h.ended_at is null) as live,
                s.state as session_state, s.account_id as session_account, s.epoch as session_epoch
           from artifacts.transfer_handles h
           left join artifacts.session_authority s on s.session_id = h.session_id
          where h.hash = $1`,
        [handleHash, now],
      );
      const row = rows[0];
      if (!row || row.live !== true || row.session_state !== 'active') return {outcome: 'denied'};
      // The Account the grant belongs to must be the one the handle was opened for, still under the epoch the ticket was issued under.
      if (row.session_account !== row.account_id || whole(row.session_epoch) !== whole(row.epoch)) return {outcome: 'denied'};
      const direction = row.direction === 'upload' ? 'upload' : 'download';
      return {
        outcome: 'allowed',
        accountId: text(row.account_id),
        sessionId: text(row.session_id),
        epoch: whole(row.epoch),
        direction,
        targetKind: text(row.target_kind),
        targetId: text(row.target_id),
      };
    },

    query,

    async createLease(lease) {
      return transaction(async (run) => {
        // One Account's uploads queue here, so two that are each within the quota cannot be together over it.
        await run('select pg_advisory_xact_lock(hashtextextended($1, 0))', [`nova3d:staging:${lease.accountId}`]);
        const inserted = await run(
          `insert into artifacts.staging_leases (id, account_id, kid, kind, length, sha256, content_type, created_at, expires_at)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
           on conflict (id) do nothing
           returning id`,
          [lease.id, lease.accountId, lease.kid, lease.kind, lease.length, lease.sha256, lease.contentType, lease.now, lease.expiresAt],
        );
        if (inserted.length === 0) return 'exists';
        const open = await run(
          `select coalesce(sum(length), 0)::text as bytes from artifacts.staging_leases where account_id = $1 and state in ('receiving', 'complete') and expires_at > $2`,
          [lease.accountId, lease.now],
        );
        if (whole(open[0].bytes) > lease.quotaBytes) {
          // Nothing is left behind: the insert is undone with the rest of the transaction.
          throw new QuotaExceeded();
        }
        return 'created';
      }).catch((error: unknown) => {
        if (error instanceof QuotaExceeded) return 'quota_exceeded' as const;
        throw error;
      });
    },

    async lease(id, accountId) {
      const rows = await query(
        'select id, account_id, kid, kind, length, sha256, content_type, received_length, state, expires_at from artifacts.staging_leases where id = $1 and account_id = $2',
        [id, accountId],
      );
      return rows.length === 0 ? null : leaseOf(rows[0]);
    },

    async progress(id, accountId, receivedLength, expiresAt) {
      const rows = await query(
        `update artifacts.staging_leases set received_length = $3, expires_at = $4
          where id = $1 and account_id = $2 and state = 'receiving' and received_length <= $3
          returning id`,
        [id, accountId, receivedLength, expiresAt],
      );
      return rows.length === 1;
    },

    async complete(id, accountId, receivedLength, expiresAt) {
      const rows = await query(
        `update artifacts.staging_leases set received_length = $3, state = 'complete', expires_at = $4
          where id = $1 and account_id = $2 and state = 'receiving' and length = $3
          returning id`,
        [id, accountId, receivedLength, expiresAt],
      );
      return rows.length === 1;
    },

    async release(id, accountId) {
      const rows = await query(`update artifacts.staging_leases set state = 'released' where id = $1 and account_id = $2 and state = 'receiving' returning id`, [id, accountId]);
      return rows.length === 1;
    },

    async claimDeletion(id, accountId, now) {
      const rows = await query(
        `update artifacts.staging_leases set state = 'released'
          where id = $1 and account_id = $2 and state <> 'deleted' and (state = 'released' or expires_at <= $3)
          returning id`,
        [id, accountId, now],
      );
      return rows.length === 1;
    },

    async markDeleted(id, accountId) {
      const rows = await query(`update artifacts.staging_leases set state = 'deleted' where id = $1 and account_id = $2 and state = 'released' returning id`, [id, accountId]);
      return rows.length === 1;
    },

    async publishAttachment(input) {
      const rows = await query('select outcome, root, manifest_id from artifacts.publish_attachment($1, $2, $3, $4, $5, $6)', [
        input.accountId,
        input.epoch,
        input.uploadId,
        input.transform,
        input.root,
        input.body,
      ]);
      const row = rows[0];
      if (!row) throw new Error('artifacts.publish_attachment answered nothing');
      return {outcome: text(row.outcome) as AttachmentOutcome, root: typeof row.root === 'string' ? row.root : null, manifestId: typeof row.manifest_id === 'string' ? row.manifest_id : null};
    },

    async close() {
      await pool.end();
    },
  };
}

class QuotaExceeded extends Error {
  constructor() {
    super('the staging quota is exceeded');
    this.name = 'QuotaExceeded';
  }
}
