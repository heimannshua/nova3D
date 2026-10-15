// Story 1.8. The restore ledger's application half: the hash chain, the store port and the relay.
//
// The ledger is where a deletion, a disable, a consumed invitation or a recovery is remembered OUTSIDE the database, so that a
// restore cannot bring them back (Story 8.4 replays it before access reopens). The database queues an event for every such change in
// the same transaction as the change (`lifecycle.ledger_outbox`); the relay below copies the queue into a LedgerStore, in order,
// as a hash chain. Story 8.9 supplies the Backblaze store; until then a fixture store (lib/ledger-fixture.ts) stands in, and the
// relay is a FUNCTION. Story 1.9 runs it on a schedule (the `ledger-relay` task of lib/job-tasks.ts, every five minutes), and until a real store
// exists it records `no_store` and relays nothing; nothing registers its backlog alarm until Story 1.13.
//
// The objects. Each event is one object, under the instance's own prefix:
//
//   key  = <instance id>/<20-digit sequence>-<SHA-256 of the previous body>.json
//   body = {"sequence":n,"previous":"<SHA-256 of the previous body>","event":{...},"at":"2026-10-13T09:00:00.000Z"}
//
// The first object's `previous` is 64 zeros. `at` is the event's OWN time (when it was queued), never the time of the append, so
// appending the same event again writes identical bytes. The hash is over the previous body's exact text. The key carries the
// sequence AND the previous hash, so two relays that disagree about what comes next cannot both create the same key.
//
// The relay is claim -> append -> mark, one event at a time:
//   * claim   takes a short lease (lifecycle.ledger_relay): one relay at a time, and a crashed relay's lease runs out;
//   * append  puts the event after the store's head with putIfAbsent (create-only: the port has no overwrite and no delete);
//   * mark    marks the event relayed in the database, at once, before the next one.
// Marking each event as it is appended means a crash can leave at most ONE event appended and not yet marked, and it is the head.
// The next run finds the event at the head and marks it instead of appending it again, so the ledger never holds a duplicate. A
// lost race (the key exists) is harmless: if the bytes are the ones this relay would have written, it is the same append.
//
// A store that is down never throws out of the relay and never undoes anything: the change stays in force (it was committed with
// its event), the event stays pending (api.ledger_pending counts it and says how old the oldest is), and the next run resumes in order.
//
// SERVER-ONLY (it imports lib/lifecycle.ts). Erasable TypeScript syntax and relative `.ts` imports, like lib/accounts.ts.
import {createHash, randomUUID} from 'node:crypto';
import type {AccountsOptions} from './accounts.ts';
import {claimLedgerEvents, finishLedgerEvents, type LedgerEvent} from './lifecycle.ts';

// The chain ---------------------------------------------------------------------------------------------------------------------

/** The `previous` of the first object. */
export const zeroHash = '0'.repeat(64);

/** Hex SHA-256 of a body's text (UTF-8). */
export const hashBody = (body: string) => createHash('sha256').update(body, 'utf8').digest('hex');

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const hashPattern = /^[0-9a-f]{64}$/;
/** The longest sequence the key's 20 digits can hold is far beyond 2^53; the relay stops at the largest safe integer. */
export const sequenceDigits = 20;

/** The object key for a sequence after a previous body. The instance ID is the environment's (`INSTANCE_ID`). */
export function ledgerKey(instanceId: string, sequence: number, previous: string): string {
  if (!uuidPattern.test(instanceId)) throw new TypeError('instanceId must be a lower-case UUID');
  if (!Number.isSafeInteger(sequence) || sequence < 1) throw new TypeError('sequence must be a positive integer');
  if (!hashPattern.test(previous)) throw new TypeError('previous must be a SHA-256 in hex');
  return `${instanceId}/${String(sequence).padStart(sequenceDigits, '0')}-${previous}.json`;
}

/** The text of a body: its four fields in this order, compact. The event is written as it was queued. */
export function ledgerBody(input: {sequence: number; previous: string; event: LedgerEvent['event']; at: string}): string {
  return JSON.stringify({sequence: input.sequence, previous: input.previous, event: input.event, at: input.at});
}

/** An object in a ledger store: its key and the exact text of its body. */
export type LedgerObject = {key: string; body: string};

/** The ledger store as the relay needs it. There is no overwrite and no delete: a ledger only grows. */
export interface LedgerStore {
  /** The object with the highest sequence, or null for an empty ledger. */
  head(): Promise<LedgerObject | null>;
  /** Creates the object if no object has the key. `exists` leaves the stored one untouched. */
  putIfAbsent(key: string, body: string): Promise<'created' | 'exists'>;
}

/** The ledger holds something that is not a valid chain, or a store answered something that is not an answer. */
export class LedgerChainError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LedgerChainError';
  }
}

/** What the relay needs to know about an object to chain the next one after it. */
export type ChainLink = {sequence: number; hash: string; eventId: string | null};

const keyPattern = /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/(\d{20})-([0-9a-f]{64})\.json$/;

/**
 * Reads one object of the ledger: the key must be in the form above for this instance, and the body must be what the key says (its
 * sequence, its previous hash). Throws a LedgerChainError for anything else.
 */
export function readObject(instanceId: string, object: LedgerObject): ChainLink & {previous: string} {
  const key = keyPattern.exec(object.key);
  if (!key || key[1] !== instanceId) throw new LedgerChainError('an object is not under this instance in the form of a ledger key');
  let body: unknown;
  try {
    body = JSON.parse(object.body);
  } catch {
    throw new LedgerChainError('an object body is not JSON');
  }
  if (typeof body !== 'object' || body === null || Array.isArray(body)) throw new LedgerChainError('an object body is not an object');
  const {sequence, previous, event, at} = body as Record<string, unknown>;
  const keySequence = Number(key[2]);
  if (!Number.isSafeInteger(keySequence) || sequence !== keySequence) throw new LedgerChainError('an object body disagrees with its key about its sequence');
  if (typeof previous !== 'string' || previous !== key[3]) throw new LedgerChainError('an object body disagrees with its key about the previous body');
  if (typeof at !== 'string' || typeof event !== 'object' || event === null || Array.isArray(event)) throw new LedgerChainError('an object body has no event or no time');
  const eventId = (event as Record<string, unknown>).id;
  return {sequence: keySequence, previous, hash: hashBody(object.body), eventId: typeof eventId === 'string' ? eventId : null};
}

/**
 * Checks a whole ledger read back in order: sequences 1, 2, 3 ..., each object's previous hash the SHA-256 of the body before it
 * (64 zeros for the first). `ok: true` with the number of objects, or the first problem.
 */
export function verifyChain(instanceId: string, objects: LedgerObject[]): {ok: true; length: number} | {ok: false; at: number; problem: string} {
  let previous = zeroHash;
  for (const [index, object] of objects.entries()) {
    try {
      const link = readObject(instanceId, object);
      if (link.sequence !== index + 1) return {ok: false, at: index, problem: 'the sequence is not the next one'};
      if (link.previous !== previous) return {ok: false, at: index, problem: 'the previous hash is not the hash of the body before'};
      previous = link.hash;
    } catch (error) {
      return {ok: false, at: index, problem: error instanceof Error ? error.message : 'unreadable'};
    }
  }
  return {ok: true, length: objects.length};
}

// The relay ---------------------------------------------------------------------------------------------------------------------

export type RelayOptions = {
  /** Where the ledger lives. Story 8.9 supplies the Backblaze store; the fixture store (lib/ledger-fixture.ts) stands in. */
  store: LedgerStore;
  /** The environment's instance ID (`INSTANCE_ID`, which mirrors lifecycle.instance_identity): the prefix of every key. */
  instanceId: string;
  /** Names this run in the lease. Default: a new random ID. */
  holder?: string;
  /** At most this many events per run (default 50, the most 200). A caller that wants more calls again. */
  limit?: number;
  /** How long the lease lasts (default 30 seconds). */
  leaseSeconds?: number;
  /** The database calls, the application's by default; the tests inject their own to crash a run at a chosen moment. */
  claim?: typeof claimLedgerEvents;
  finish?: typeof finishLedgerEvents;
  accounts?: AccountsOptions;
};

/**
 * What a run did. `relayed`: every claimed event is in the store and marked. `busy`: another relay holds the lease (nothing was
 * read). `store_unavailable`: the store failed or did not answer; the events not yet appended stay pending. `conflict`: the store
 * already holds a different object where this event belongs; nothing further was appended. `corrupt`: the store's head is not a valid
 * link of the chain; nothing was appended. `claimed` is how many events the run read, `appended` how many it wrote and `marked` how
 * many it marked (an event found already at the head is marked and not appended).
 */
export type RelayReport = {
  outcome: 'relayed' | 'busy' | 'store_unavailable' | 'conflict' | 'corrupt';
  claimed: number;
  appended: number;
  marked: number;
};

/**
 * Copies pending ledger events into the store, in outbox order. It never throws for a store that is down or that holds something it
 * cannot chain after; it does throw when the DATABASE cannot be reached (a scheduler needs to see that run fail), after letting go of
 * the lease as best it can.
 */
export async function relayLedger(options: RelayOptions): Promise<RelayReport> {
  const {store, instanceId} = options;
  const claim = options.claim ?? claimLedgerEvents;
  const finish = options.finish ?? finishLedgerEvents;
  const accounts = options.accounts ?? {};
  const holder = options.holder ?? randomUUID();
  if (!uuidPattern.test(instanceId)) throw new TypeError('instanceId must be a lower-case UUID');

  const claimed = await claim({holder, limit: options.limit, leaseSeconds: options.leaseSeconds}, accounts);
  if (claimed.outcome === 'busy') return {outcome: 'busy', claimed: 0, appended: 0, marked: 0};

  const report: RelayReport = {outcome: 'relayed', claimed: claimed.events.length, appended: 0, marked: 0};
  try {
    if (claimed.events.length === 0) return report;

    let head: ChainLink | null;
    try {
      const object = await store.head();
      head = object === null ? null : readObject(instanceId, object);
    } catch (error) {
      report.outcome = error instanceof LedgerChainError ? 'corrupt' : 'store_unavailable';
      return report;
    }

    for (const item of claimed.events) {
      // An event that is already the head was appended by a run that crashed before it could mark it: mark it, do not append it again.
      if (head === null || head.eventId !== item.id) {
        const sequence = (head?.sequence ?? 0) + 1;
        if (!Number.isSafeInteger(sequence)) {
          report.outcome = 'corrupt';
          return report;
        }
        const previous = head?.hash ?? zeroHash;
        const key = ledgerKey(instanceId, sequence, previous);
        const body = ledgerBody({sequence, previous, event: item.event, at: item.at});
        try {
          const put = await store.putIfAbsent(key, body);
          if (put === 'exists') {
            // Someone created this key first. If it is exactly the object this run would have written, it is the same append.
            const current = await store.head();
            if (current === null || current.key !== key || current.body !== body) {
              report.outcome = 'conflict';
              return report;
            }
          } else if (put === 'created') {
            report.appended += 1;
          } else {
            throw new LedgerChainError('a store answered neither created nor exists');
          }
        } catch (error) {
          report.outcome = error instanceof LedgerChainError ? 'corrupt' : 'store_unavailable';
          return report;
        }
        head = {sequence, hash: hashBody(body), eventId: item.id};
      }
      await finish({holder, eventIds: [item.id]}, accounts);
      report.marked += 1;
    }
    return report;
  } finally {
    // Let go of the lease. If the database cannot be reached for this either, it simply runs out.
    await finish({holder, eventIds: [], release: true}, accounts).catch(() => undefined);
  }
}
