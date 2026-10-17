// The resolver registry: what a transfer's TARGET is, and whether it may be reached right now. A ticket names a kind of target and an ID; the
// registry maps the kind to a function that reads ONE Postgres authorization view or table for it (never a cache), answers whether the Account
// may move bytes of this target in this direction at this moment, and says where its bytes are. A kind with no resolver is refused, here and
// by the route that issues the ticket (lib/service-signing.ts `transferTargetKinds`).
//
// The gateway asks the resolver before every chunk, after it has asked the session's authority (`artifacts.session_authority`): the answer for
// the Account says whether the PERSON may act, and this says whether the THING is still there to act on (a Project that was deleted, a file
// whose lease expired). Story 1.12 registers `staging`. Registering the rest is the extension point and belongs to the stories that attach files
// to something: Projects (the story that first attaches a file to one; the authority contract names resolveProjectTarget for the application
// side), retained pictures (2.12), artifact manifests (4.1), exports (6.9). A test-only fixture resolver lives under tests/support.
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

/** The registry of a gateway: `staging`, and whatever else the caller registers (the tests' fixture). A kind registered twice is a bug. */
export function createResolvers(extra: Record<string, Resolver> = {}): Resolvers {
  const registered = new Map<string, Resolver>([['staging', stagingResolver]]);
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
