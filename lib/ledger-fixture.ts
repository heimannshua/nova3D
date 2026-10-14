// Story 1.8. The ledger store the relay writes to until Story 8.9 supplies the Backblaze adapter: the whole ledger in memory.
//
// It keeps what the port promises and nothing more: create-only writes (no overwrite, no delete) and the head. It is a FIXTURE: it
// lives and dies with the process, so it proves the relay and the chain and protects nothing across a restart. Nothing in the
// application constructs one for real use; the tests and `docs/deletion-verification.md`'s walk-through do.
//
// It can fail on request, to show what the relay does when the store is down:
//   * `setOutage(true)`          every call fails, as an unreachable store does, until `setOutage(false)`;
//   * `failNext(n)`              the next n calls fail and then it recovers;
//   * `loseNextAnswers(n)`       the next n writes are STORED and then fail, as a store does whose answer is lost on the way: the
//                                relay cannot know the write happened, and must not append the event twice when it runs again.
//
// Erasable TypeScript syntax and relative `.ts` imports, like the modules it serves.
import type {LedgerObject, LedgerStore} from './ledger.ts';

/** The store was told to fail (an outage), as an unreachable one would. */
export class FixtureStoreError extends Error {
  constructor(message = 'The fixture ledger store is unavailable.') {
    super(message);
    this.name = 'FixtureStoreError';
  }
}

export type FixtureLedgerStore = LedgerStore & {
  /** Every object, by ascending key (which is ascending sequence: keys carry a 20-digit zero-padded sequence). */
  objects(): LedgerObject[];
  /** How many objects the ledger holds. */
  readonly size: number;
  /** How many calls of each kind were made, failed ones included. */
  readonly calls: {head: number; putIfAbsent: number};
  setOutage(down: boolean): void;
  failNext(count: number): void;
  loseNextAnswers(count: number): void;
};

export function createFixtureLedgerStore(): FixtureLedgerStore {
  const stored = new Map<string, string>();
  const calls = {head: 0, putIfAbsent: 0};
  let down = false;
  let failures = 0;
  let lostAnswers = 0;

  const refuse = () => {
    if (down) throw new FixtureStoreError();
    if (failures > 0) {
      failures -= 1;
      throw new FixtureStoreError();
    }
  };
  const sorted = () => [...stored.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([key, body]) => ({key, body}));

  return {
    async head() {
      calls.head += 1;
      refuse();
      const all = sorted();
      return all.length === 0 ? null : all[all.length - 1];
    },
    async putIfAbsent(key, body) {
      calls.putIfAbsent += 1;
      refuse();
      if (stored.has(key)) return 'exists';
      stored.set(key, body);
      if (lostAnswers > 0) {
        lostAnswers -= 1;
        throw new FixtureStoreError('The fixture ledger store stored the object and then lost its answer.');
      }
      return 'created';
    },
    objects: sorted,
    get size() {
      return stored.size;
    },
    calls,
    setOutage(value) {
      down = value;
    },
    failNext(count) {
      failures = count;
    },
    loseNextAnswers(count) {
      lostAnswers = count;
    },
  };
}
