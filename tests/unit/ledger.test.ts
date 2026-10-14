import {createHash, randomUUID} from 'node:crypto';
import {describe, expect, it, vi} from 'vitest';
import {AccountsUnavailableError} from '@/lib/accounts';
import {hashBody, ledgerBody, ledgerKey, LedgerChainError, readObject, relayLedger, verifyChain, zeroHash, type LedgerObject, type LedgerStore} from '@/lib/ledger';
import {createFixtureLedgerStore, FixtureStoreError} from '@/lib/ledger-fixture';
import type {LedgerClaim, LedgerEvent} from '@/lib/lifecycle';

// The restore ledger's application half (Story 1.8, lib/ledger.ts): the hash chain, the store port, and the relay as a function:
// claim -> append -> mark, idempotent, in order, never throwing for a store that is down. The database is a stand-in that keeps an outbox
// and a lease the way api.claim_ledger_events and api.finish_ledger_events do (the real ones are tested in tests/integration/tombstones.test.ts).
const INSTANCE = '3f1c8a5e-7b2d-4c6a-9e0f-1a2b3c4d5e6f';

const event = (type: string, extra: Record<string, unknown> = {}): LedgerEvent['event'] => ({id: randomUUID(), type, ...extra});
function pending(count: number, start = 0): LedgerEvent[] {
  return Array.from({length: count}, (_, index) => {
    const body = event('account_authority', {account_id: randomUUID(), status: 'disabled', epoch: index + 2});
    return {id: body.id, seq: start + index + 1, event: body, at: `2026-10-13T09:00:${String(index).padStart(2, '0')}.${String(100 + index).padStart(3, '0')}Z`};
  });
}

/** An outbox and a lease with the semantics of the two database functions, and a log of every call. */
function fakeDatabase(events: LedgerEvent[]) {
  const outbox = events.map((item) => ({...item, relayed: false}));
  let holder: string | null = null;
  const calls: string[] = [];
  const claim = vi.fn(async (input: {holder: string; limit?: number}): Promise<LedgerClaim> => {
    calls.push('claim');
    if (holder !== null && holder !== input.holder) return {outcome: 'busy'};
    holder = input.holder;
    return {outcome: 'claimed', events: outbox.filter((item) => !item.relayed).slice(0, input.limit ?? 50).map(({relayed: _relayed, ...item}) => item)};
  });
  const finish = vi.fn(async (input: {holder: string; eventIds: string[]; release?: boolean}) => {
    calls.push(input.eventIds.length ? `mark ${input.eventIds.length}` : 'release');
    let marked = 0;
    for (const item of outbox) if (input.eventIds.includes(item.id) && !item.relayed) { item.relayed = true; marked += 1; }
    const released = input.release === true && holder === input.holder;
    if (released) holder = null;
    return {marked, released};
  });
  return {claim, finish, calls, pendingCount: () => outbox.filter((item) => !item.relayed).length, holder: () => holder, expireLease: () => { holder = null; }, outbox};
}

const run = (database: ReturnType<typeof fakeDatabase>, store: LedgerStore, extra: Record<string, unknown> = {}) =>
  relayLedger({store, instanceId: INSTANCE, claim: database.claim as never, finish: database.finish as never, ...extra});
const read = (store: ReturnType<typeof createFixtureLedgerStore>) => store.objects();

describe('the chain', () => {
  it('names an object <instance id>/<20-digit sequence>-<SHA-256 of the previous body>.json', () => {
    expect(ledgerKey(INSTANCE, 1, zeroHash)).toBe(`${INSTANCE}/00000000000000000001-${'0'.repeat(64)}.json`);
    const previous = hashBody('{"sequence":1}');
    expect(ledgerKey(INSTANCE, 12345, previous)).toBe(`${INSTANCE}/00000000000000012345-${previous}.json`);
    expect(previous).toBe(createHash('sha256').update('{"sequence":1}', 'utf8').digest('hex'));
    expect(previous).toMatch(/^[0-9a-f]{64}$/);
  });

  it('refuses a key that is not one: an instance that is not a UUID, a sequence that is not positive, a previous that is not a hash', () => {
    expect(() => ledgerKey('nope', 1, zeroHash)).toThrow(TypeError);
    expect(() => ledgerKey(INSTANCE.toUpperCase(), 1, zeroHash)).toThrow(TypeError);
    for (const sequence of [0, -1, 1.5, Number.NaN, Number.MAX_SAFE_INTEGER + 1]) expect(() => ledgerKey(INSTANCE, sequence, zeroHash), String(sequence)).toThrow(TypeError);
    for (const previous of ['', 'abc', 'g'.repeat(64), 'A'.repeat(64), '0'.repeat(63)]) expect(() => ledgerKey(INSTANCE, 1, previous), previous).toThrow(TypeError);
  });

  it('writes a body of its sequence, the previous body\'s hash, the event and the time, in that order, compact', () => {
    const body = ledgerBody({sequence: 2, previous: zeroHash, event: {id: 'e', type: 'account_authority', account_id: 'a', status: 'disabled', epoch: 3}, at: '2026-10-13T09:00:00.000Z'});
    expect(body).toBe(`{"sequence":2,"previous":"${zeroHash}","event":{"id":"e","type":"account_authority","account_id":"a","status":"disabled","epoch":3},"at":"2026-10-13T09:00:00.000Z"}`);
  });

  it('reads an object back and checks it against its key; anything that disagrees is a chain error', () => {
    const body = ledgerBody({sequence: 1, previous: zeroHash, event: {id: 'e1', type: 't'}, at: '2026-10-13T09:00:00.000Z'});
    const link = readObject(INSTANCE, {key: ledgerKey(INSTANCE, 1, zeroHash), body});
    expect(link).toEqual({sequence: 1, previous: zeroHash, hash: hashBody(body), eventId: 'e1'});
    const bad: [string, LedgerObject][] = [
      ['another instance', {key: ledgerKey(randomUUID(), 1, zeroHash), body}],
      ['a key that is not a ledger key', {key: `${INSTANCE}/1.json`, body}],
      ['a sequence the key does not carry', {key: ledgerKey(INSTANCE, 2, zeroHash), body}],
      ['a previous the key does not carry', {key: ledgerKey(INSTANCE, 1, 'a'.repeat(64)), body}],
      ['a body that is not JSON', {key: ledgerKey(INSTANCE, 1, zeroHash), body: 'nope'}],
      ['a body that is an array', {key: ledgerKey(INSTANCE, 1, zeroHash), body: '[]'}],
      ['a body with no event', {key: ledgerKey(INSTANCE, 1, zeroHash), body: `{"sequence":1,"previous":"${zeroHash}","at":"x"}`}],
    ];
    for (const [name, object] of bad) expect(() => readObject(INSTANCE, object), name).toThrow(LedgerChainError);
  });

  it('verifies a whole chain read back in order, and finds the first link that is wrong', async () => {
    const database = fakeDatabase(pending(4));
    const store = createFixtureLedgerStore();
    expect(await run(database, store)).toMatchObject({outcome: 'relayed', appended: 4});
    expect(verifyChain(INSTANCE, read(store))).toEqual({ok: true, length: 4});
    expect(verifyChain(INSTANCE, [])).toEqual({ok: true, length: 0});
    const objects = read(store);
    // A missing link, a duplicate, a swap and an altered body are each found.
    expect(verifyChain(INSTANCE, [objects[0], objects[2]])).toMatchObject({ok: false, at: 1});
    expect(verifyChain(INSTANCE, [objects[0], objects[0]])).toMatchObject({ok: false, at: 1});
    expect(verifyChain(INSTANCE, [objects[1], objects[0]])).toMatchObject({ok: false, at: 0});
    const altered = [objects[0], {...objects[1], body: objects[1].body.replace('"epoch":3', '"epoch":9')}, objects[2], objects[3]];
    expect(verifyChain(INSTANCE, altered)).toMatchObject({ok: false, at: 2});
  });
});

describe('relayLedger: events in, a chain out', () => {
  it('appends the pending events in outbox order as hash-chained objects, marks each, and ends with nothing pending', async () => {
    const events = pending(3);
    const database = fakeDatabase(events);
    const store = createFixtureLedgerStore();
    const report = await run(database, store);
    expect(report).toEqual({outcome: 'relayed', claimed: 3, appended: 3, marked: 3});
    expect(database.pendingCount()).toBe(0);
    const objects = read(store);
    expect(objects.map((object) => object.key)).toEqual([
      ledgerKey(INSTANCE, 1, zeroHash),
      ledgerKey(INSTANCE, 2, hashBody(objects[0].body)),
      ledgerKey(INSTANCE, 3, hashBody(objects[1].body)),
    ]);
    expect(objects.map((object) => JSON.parse(object.body).event.id)).toEqual(events.map((item) => item.id));
    expect(JSON.parse(objects[0].body)).toEqual({sequence: 1, previous: zeroHash, event: events[0].event, at: events[0].at});
    expect(verifyChain(INSTANCE, objects)).toEqual({ok: true, length: 3});
  });

  it('marks each event as it is appended, then lets go of the lease: claim, append, mark, append, mark, release', async () => {
    const database = fakeDatabase(pending(2));
    await run(database, createFixtureLedgerStore());
    expect(database.calls).toEqual(['claim', 'mark 1', 'mark 1', 'release']);
    expect(database.holder()).toBeNull();
  });

  it('is idempotent: a second run appends nothing and the store holds the same objects', async () => {
    const database = fakeDatabase(pending(3));
    const store = createFixtureLedgerStore();
    await run(database, store);
    const before = read(store);
    expect(await run(database, store)).toEqual({outcome: 'relayed', claimed: 0, appended: 0, marked: 0});
    expect(read(store)).toEqual(before);
    expect(store.calls.putIfAbsent).toBe(3);
  });

  it('continues the chain from the store\'s head, whichever run wrote it, and takes at most the limit in a run', async () => {
    const events = pending(5);
    const database = fakeDatabase(events);
    const store = createFixtureLedgerStore();
    expect(await run(database, store, {limit: 2})).toMatchObject({claimed: 2, appended: 2});
    expect(await run(database, store, {limit: 2})).toMatchObject({claimed: 2, appended: 2});
    expect(await run(database, store, {limit: 2})).toMatchObject({claimed: 1, appended: 1});
    expect(verifyChain(INSTANCE, read(store))).toEqual({ok: true, length: 5});
    expect(read(store).map((object) => JSON.parse(object.body).event.id)).toEqual(events.map((item) => item.id));
  });

  it('writes the same bytes for the same event however often it is retried: the time is the event\'s own', async () => {
    const events = pending(1);
    const first = createFixtureLedgerStore();
    const second = createFixtureLedgerStore();
    await run(fakeDatabase(events), first);
    await run(fakeDatabase(events), second);
    expect(read(first)).toEqual(read(second));
    expect(JSON.parse(read(first)[0].body).at).toBe(events[0].at);
  });

  it('does nothing, and still lets go of the lease, when nothing is pending', async () => {
    const database = fakeDatabase([]);
    const store = createFixtureLedgerStore();
    expect(await run(database, store)).toEqual({outcome: 'relayed', claimed: 0, appended: 0, marked: 0});
    expect(store.calls).toEqual({head: 0, putIfAbsent: 0});
    expect(database.calls).toEqual(['claim', 'release']);
  });

  it('refuses an instance ID that is not one before it asks for anything', async () => {
    const database = fakeDatabase(pending(1));
    await expect(relayLedger({store: createFixtureLedgerStore(), instanceId: 'local', claim: database.claim as never, finish: database.finish as never})).rejects.toBeInstanceOf(TypeError);
    expect(database.claim).not.toHaveBeenCalled();
  });
});

describe('relayLedger: a crash after the store accepted', () => {
  it('finds the event at the head on the next run, marks it and does not append it again', async () => {
    const events = pending(3);
    const database = fakeDatabase(events);
    const store = createFixtureLedgerStore();
    // The second mark never happens: the run dies after the store accepted the second event.
    let marks = 0;
    const dying = vi.fn(async (input: {holder: string; eventIds: string[]; release?: boolean}) => {
      if (input.eventIds.length) {
        marks += 1;
        if (marks === 2) throw new AccountsUnavailableError('The accounts database did not answer.', {retryable: true});
      }
      return database.finish(input);
    });
    await expect(run(database, store, {finish: dying as never})).rejects.toBeInstanceOf(AccountsUnavailableError);
    expect(read(store)).toHaveLength(2);
    expect(database.pendingCount()).toBe(2);
    // The lease ran out with the crashed run.
    database.expireLease();

    const report = await run(database, store);
    expect(report).toEqual({outcome: 'relayed', claimed: 2, appended: 1, marked: 2});
    const objects = read(store);
    expect(objects).toHaveLength(3);
    expect(objects.map((object) => JSON.parse(object.body).event.id)).toEqual(events.map((item) => item.id));
    expect(verifyChain(INSTANCE, objects)).toEqual({ok: true, length: 3});
    expect(database.pendingCount()).toBe(0);
  });

  it('survives a store whose answer was lost: the object is there, the run reports the store as unavailable, and the next run marks it without a duplicate', async () => {
    const events = pending(2);
    const database = fakeDatabase(events);
    const store = createFixtureLedgerStore();
    store.loseNextAnswers(1);
    expect(await run(database, store)).toEqual({outcome: 'store_unavailable', claimed: 2, appended: 0, marked: 0});
    expect(read(store)).toHaveLength(1);
    expect(database.pendingCount()).toBe(2);
    expect(database.holder()).toBeNull();
    expect(await run(database, store)).toEqual({outcome: 'relayed', claimed: 2, appended: 1, marked: 2});
    expect(verifyChain(INSTANCE, read(store))).toEqual({ok: true, length: 2});
    expect(database.pendingCount()).toBe(0);
  });
});

describe('relayLedger: a store that answers with something that is not an answer', () => {
  it.each([
    ['undefined', undefined],
    ['an unknown string', 'maybe'],
    ['null', null],
    ['a boolean', true],
  ])('treats %s from putIfAbsent as corrupt: nothing is appended or marked, the event stays pending, and the lease is let go', async (_name, answer) => {
    const database = fakeDatabase(pending(2));
    const put = vi.fn(async () => answer as never);
    const store: LedgerStore = {head: async () => null, putIfAbsent: put};
    expect(await run(database, store)).toEqual({outcome: 'corrupt', claimed: 2, appended: 0, marked: 0});
    expect(put).toHaveBeenCalledTimes(1);
    expect(database.pendingCount()).toBe(2);
    expect(database.holder()).toBeNull();
    // Nothing was marked: the only calls the database saw are the claim and the release.
    expect(database.calls).toEqual(['claim', 'release']);
  });
});

describe('relayLedger: a store outage', () => {
  it('never throws: the events stay pending, the lease is let go, and the next run resumes in order', async () => {
    const events = pending(4);
    const database = fakeDatabase(events);
    const store = createFixtureLedgerStore();
    store.setOutage(true);
    expect(await run(database, store)).toEqual({outcome: 'store_unavailable', claimed: 4, appended: 0, marked: 0});
    expect(database.pendingCount()).toBe(4);
    expect(database.holder()).toBeNull();
    expect(read(store)).toEqual([]);
    store.setOutage(false);
    expect(await run(database, store)).toEqual({outcome: 'relayed', claimed: 4, appended: 4, marked: 4});
    expect(read(store).map((object) => JSON.parse(object.body).event.id)).toEqual(events.map((item) => item.id));
    expect(database.pendingCount()).toBe(0);
  });

  it('stops at the first failure and marks only what is in the store: an outage in the middle of a run', async () => {
    const events = pending(4);
    const database = fakeDatabase(events);
    const store = createFixtureLedgerStore();
    const real = store.putIfAbsent;
    let puts = 0;
    store.putIfAbsent = async (key, body) => {
      puts += 1;
      if (puts === 3) throw new FixtureStoreError();
      return real(key, body);
    };
    expect(await run(database, store)).toEqual({outcome: 'store_unavailable', claimed: 4, appended: 2, marked: 2});
    expect(database.pendingCount()).toBe(2);
    store.putIfAbsent = real;
    expect(await run(database, store)).toEqual({outcome: 'relayed', claimed: 2, appended: 2, marked: 2});
    expect(verifyChain(INSTANCE, read(store))).toEqual({ok: true, length: 4});
  });

  it('treats a head that cannot be read as an outage too, and a head that is not a link of the chain as corrupt: nothing is appended after it', async () => {
    const database = fakeDatabase(pending(2));
    const down = createFixtureLedgerStore();
    down.failNext(1);
    expect(await run(database, down)).toMatchObject({outcome: 'store_unavailable', appended: 0});

    const corrupt: LedgerStore = {head: async () => ({key: `${INSTANCE}/00000000000000000001-${zeroHash}.json`, body: 'not json'}), putIfAbsent: vi.fn(async () => 'created' as const)};
    expect(await run(database, corrupt)).toMatchObject({outcome: 'corrupt', appended: 0, marked: 0});
    expect(corrupt.putIfAbsent).not.toHaveBeenCalled();
    expect(database.pendingCount()).toBe(2);
  });

  it('reports a conflict, and marks nothing, when the store already holds a different object where this event belongs', async () => {
    const events = pending(1);
    const database = fakeDatabase(events);
    // Another writer got the first position with another event. The store's head is stale when the relay reads it (empty), but the key is
    // taken, and what is there when the relay looks again is the other writer's object.
    const other = ledgerBody({sequence: 1, previous: zeroHash, event: {id: randomUUID(), type: 'tombstone'}, at: '2026-10-13T08:00:00.000Z'});
    const heads = [null, {key: ledgerKey(INSTANCE, 1, zeroHash), body: other}];
    const raced: LedgerStore = {head: async () => heads.shift() ?? null, putIfAbsent: async () => 'exists'};
    expect(await run(database, raced)).toEqual({outcome: 'conflict', claimed: 1, appended: 0, marked: 0});
    expect(database.pendingCount()).toBe(1);
  });

  it('counts a lost race for the very same object as the same append: it is marked, not reported as a conflict', async () => {
    const events = pending(1);
    const database = fakeDatabase(events);
    const body = ledgerBody({sequence: 1, previous: zeroHash, event: events[0].event, at: events[0].at});
    const heads = [null, {key: ledgerKey(INSTANCE, 1, zeroHash), body}];
    const racedStore: LedgerStore = {head: async () => heads.shift() ?? null, putIfAbsent: async () => 'exists'};
    expect(await run(database, racedStore)).toEqual({outcome: 'relayed', claimed: 1, appended: 0, marked: 1});
    expect(database.pendingCount()).toBe(0);
  });

  it('lets a database that cannot be reached throw, after trying to let go of the lease', async () => {
    const database = fakeDatabase(pending(1));
    const failing = vi.fn(async () => {
      throw new AccountsUnavailableError('The accounts database did not answer.', {retryable: true});
    });
    await expect(run(database, createFixtureLedgerStore(), {claim: failing as never})).rejects.toBeInstanceOf(AccountsUnavailableError);
    // A failure to release the lease is not a second failure: it simply runs out.
    const store = createFixtureLedgerStore();
    const marking = vi.fn(async (input: {holder: string; eventIds: string[]; release?: boolean}) => {
      if (input.release) throw new AccountsUnavailableError('The accounts database did not answer.', {retryable: true});
      return database.finish(input);
    });
    expect(await run(database, store, {finish: marking as never})).toMatchObject({outcome: 'relayed', appended: 1, marked: 1});
  });
});

describe('relayLedger: two relays', () => {
  it('lets one hold the lease while the other reports busy and touches nothing', async () => {
    const database = fakeDatabase(pending(3));
    const store = createFixtureLedgerStore();
    const holder = randomUUID();
    // A first relay has the lease (a claim that has not finished).
    await database.claim({holder});
    const report = await run(database, store, {holder: randomUUID()});
    expect(report).toEqual({outcome: 'busy', claimed: 0, appended: 0, marked: 0});
    expect(store.calls).toEqual({head: 0, putIfAbsent: 0});
    expect(database.pendingCount()).toBe(3);
    // Once the lease is free (it ran out or was released), the other proceeds.
    database.expireLease();
    expect(await run(database, store, {holder: randomUUID()})).toMatchObject({outcome: 'relayed', appended: 3});
  });

  it('keeps the chain whole when overlapping runs both reach the store: whichever writes a key first wins and the other finds it', async () => {
    const events = pending(6);
    const database = fakeDatabase(events);
    const store = createFixtureLedgerStore();
    // Two relays with the same pending list (the lease had run out under the first): they interleave at the store.
    const lenient = {
      claim: async (input: {holder: string; limit?: number}) => ({outcome: 'claimed' as const, events: database.outbox.filter((item) => !item.relayed).slice(0, input.limit ?? 50).map(({relayed: _relayed, ...item}) => item)}),
      finish: database.finish,
    };
    const reports = await Promise.all([
      relayLedger({store, instanceId: INSTANCE, claim: lenient.claim as never, finish: lenient.finish as never}),
      relayLedger({store, instanceId: INSTANCE, claim: lenient.claim as never, finish: lenient.finish as never}),
    ]);
    expect(reports.every((report) => ['relayed', 'conflict'].includes(report.outcome))).toBe(true);
    // Whatever interleaving happened, the ledger is a valid chain with no event twice.
    const objects = read(store);
    expect(verifyChain(INSTANCE, objects)).toMatchObject({ok: true});
    const ids = objects.map((object) => JSON.parse(object.body).event.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual(events.slice(0, ids.length).map((item) => item.id));
    // And one more run finishes the job.
    database.expireLease();
    await run(database, store);
    expect(verifyChain(INSTANCE, read(store))).toEqual({ok: true, length: 6});
    expect(database.pendingCount()).toBe(0);
  });
});

describe('the fixture store', () => {
  it('is create-only: a key that exists is left as it was, and there is no way to overwrite or delete', async () => {
    const store = createFixtureLedgerStore();
    expect(await store.putIfAbsent('a/1.json', 'first')).toBe('created');
    expect(await store.putIfAbsent('a/1.json', 'second')).toBe('exists');
    expect(store.objects()).toEqual([{key: 'a/1.json', body: 'first'}]);
    expect(Object.keys(store).filter((name) => /delete|remove|overwrite|put$/i.test(name))).toEqual([]);
  });

  it('answers the object with the highest key as its head, null when empty', async () => {
    const store = createFixtureLedgerStore();
    expect(await store.head()).toBeNull();
    await store.putIfAbsent(ledgerKey(INSTANCE, 2, 'a'.repeat(64)), 'two');
    await store.putIfAbsent(ledgerKey(INSTANCE, 10, 'b'.repeat(64)), 'ten');
    await store.putIfAbsent(ledgerKey(INSTANCE, 1, zeroHash), 'one');
    expect((await store.head())?.body).toBe('ten');
    expect(store.objects().map((object) => object.body)).toEqual(['one', 'two', 'ten']);
  });

  it('fails on request: an outage, a number of calls, and an answer lost after the write', async () => {
    const store = createFixtureLedgerStore();
    store.setOutage(true);
    await expect(store.head()).rejects.toBeInstanceOf(FixtureStoreError);
    await expect(store.putIfAbsent('k', 'v')).rejects.toBeInstanceOf(FixtureStoreError);
    store.setOutage(false);
    store.failNext(2);
    await expect(store.head()).rejects.toBeInstanceOf(FixtureStoreError);
    await expect(store.putIfAbsent('k', 'v')).rejects.toBeInstanceOf(FixtureStoreError);
    expect(await store.putIfAbsent('k', 'v')).toBe('created');
    store.loseNextAnswers(1);
    await expect(store.putIfAbsent('lost', 'v')).rejects.toBeInstanceOf(FixtureStoreError);
    expect(store.objects().map((object) => object.key)).toEqual(['k', 'lost']);
    expect(await store.putIfAbsent('lost', 'v')).toBe('exists');
    expect(store.calls).toEqual({head: 2, putIfAbsent: 5});
  });
});
