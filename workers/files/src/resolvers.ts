// The resolver registry: what a transfer's TARGET is, and whether it may be reached right now. A ticket names a kind of target and an ID; the
// registry maps the kind to a function that reads ONE Postgres authorization view or table for it (never a cache), answers whether the Account
// may move bytes of this target in this direction at this moment, and says where its bytes are. A kind with no resolver is refused, here and
// by the route that issues the ticket (lib/service-signing.ts `transferTargetKinds`).
//
// The gateway asks the resolver before every chunk, after it has asked the session's authority (`artifacts.session_authority`): the answer for
// the Account says whether the PERSON may act, and this says whether the THING is still there to act on (a Project that was deleted, a file
// whose lease expired). Story 1.12 registers `staging`; Story 2.12 registers `retained`. Registering the rest is the extension point and belongs to the
// stories that attach files to something: Projects (the story that first attaches a file to one; the authority contract names resolveProjectTarget for
// the application side), artifact manifests (4.1), exports (6.9). A test-only fixture resolver lives under tests/support.
import type {Query} from './database.ts';

export type Direction = 'upload' | 'download';

export type ResolveInput = {accountId: string; targetId: string; direction: Direction; now: Date};

/** `allowed`: the target is there for this direction, with where its bytes are. Anything else is `unavailable`, one answer with nothing in it. */
export type ResolvedTarget =
  | {outcome: 'allowed'; key: string; length: number; contentType: string; etag: string}
  | {outcome: 'unavailable'};

export type Resolver = (query: Query, input: ResolveInput) => Promise<ResolvedTarget>;

export type Resolvers = {
  /** The resolver of a kind, or undefined when there is none: the transfer is refused. */
  resolver(kind: string): Resolver | undefined;
  kinds(): string[];
};

const unavailable: ResolvedTarget = {outcome: 'unavailable'};

/**
 * `staging`: a lease of THIS Account that is not expired and not released. An upload goes to a lease that is `receiving`; a download reads one
 * that is `complete` (or `attached`: the staged copy stays until the cleanup). The bytes are `staging/<account>/<upload>`, both parts UUIDs the
 * database validated, never text from the caller.
 */
export const stagingResolver: Resolver = async (query, input) => {
  const states = input.direction === 'upload' ? ['receiving'] : ['complete', 'attached'];
  const rows = await query(
    `select length, content_type, sha256
       from artifacts.staging_leases
      where id = $1 and account_id = $2 and state = any($3) and expires_at > $4`,
    [input.targetId, input.accountId, states, input.now],
  );
  const row = rows[0];
  if (!row) return unavailable;
  const length = Number(row.length);
  if (!Number.isSafeInteger(length) || typeof row.content_type !== 'string' || typeof row.sha256 !== 'string') return unavailable;
  return {outcome: 'allowed', key: `staging/${input.accountId}/${input.targetId}`, length, contentType: row.content_type, etag: row.sha256};
};

/**
 * `retained` (Story 2.12): a picture the person confirmed, kept as a manifest root. The target's ID is the picture's UPLOAD ID, which is its manifest's ID
 * too. It is served only while it is PINNED by a revision of a live Project of the same Account (`artifacts.retained_pictures`: the Project is not deleted and
 * has no tombstone; the Account's own liveness is the session's, asked before every resolver), from the object at `objects/<account>/<root>`, with the retained
 * length and content type, and the retained digest as its entity tag. A retained picture is only ever READ: a ticket to upload to this kind is refused, and so
 * a foreign, unknown, deleted, tombstoned or unpinned picture is the one answer, `unavailable`, with nothing in it. The Account in the key is the handle's,
 * and the root is a 64-character hexadecimal digest the database validated, never text from the caller.
 */
export const retainedResolver: Resolver = async (query, input) => {
  if (input.direction !== 'download') return unavailable;
  const rows = await query(
    `select root, digest, length, content_type
       from artifacts.retained_pictures
      where upload_id = $1 and account_id = $2
      limit 1`,
    [input.targetId, input.accountId],
  );
  const row = rows[0];
  if (!row) return unavailable;
  const length = Number(row.length);
  if (
    !Number.isSafeInteger(length) || length < 1 || typeof row.root !== 'string' || !/^[0-9a-f]{64}$/.test(row.root) ||
    typeof row.digest !== 'string' || typeof row.content_type !== 'string'
  ) {
    return unavailable;
  }
  return {outcome: 'allowed', key: `objects/${input.accountId}/${row.root}`, length, contentType: row.content_type, etag: row.digest};
};

/** The registry of a gateway: `staging` and `retained`, and whatever else the caller registers (the tests' fixture). A kind registered twice is a bug. */
export function createResolvers(extra: Record<string, Resolver> = {}): Resolvers {
  const registered = new Map<string, Resolver>([
    ['staging', stagingResolver],
    ['retained', retainedResolver],
  ]);
  for (const [kind, resolver] of Object.entries(extra)) {
    if (!/^[a-z][a-z0-9-]{0,31}$/.test(kind)) throw new TypeError('a target kind is a lower-case word');
    if (registered.has(kind)) throw new Error(`a resolver for ${kind} is already registered`);
    registered.set(kind, resolver);
  }
  return {
    resolver: (kind) => registered.get(kind),
    kinds: () => [...registered.keys()].sort(),
  };
}
