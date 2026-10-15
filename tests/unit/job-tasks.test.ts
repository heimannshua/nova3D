import {randomUUID} from 'node:crypto';
import {describe, expect, it, vi} from 'vitest';
import {AccountsUnavailableError} from '@/lib/accounts';
import {configuredLedgerStore, LedgerConflictError, LedgerCorruptError, purgeBatchLimit, relayBatchLimit, relayLeaseSeconds, runTask, tasks} from '@/lib/job-tasks';
import {verifyChain, type LedgerStore} from '@/lib/ledger';
import {createFixtureLedgerStore} from '@/lib/ledger-fixture';
import {scheduledTasks} from '@/lib/schedules';

// The two tasks a schedule fires (Story 1.9, lib/job-tasks.ts) against a stand-in for the database that keeps an outbox and a lease the way
// api.claim_ledger_events, api.finish_ledger_events and api.ledger_pending do (the real ones are tested in tests/integration/tombstones.test.ts
// and the whole path in tests/integration/scheduled-jobs.test.ts), and a fixture store with outage injection.
const INSTANCE = '3f1c8a5e-7b2d-4c6a-9e0f-1a2b3c4d5e6f';
const env = {NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54321', SUPABASE_SERVICE_ROLE_KEY: 'service-key-for-tests-only'};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {status, headers: {'content-type': 'application/json'}});

function fakeDatabase(count: number, extra: Record<string, (body: Record<string, unknown>) => Response> = {}) {
  const outbox = Array.from({length: count}, (_, index) => {
    const id = randomUUID();
    return {id, seq: index + 1, event: {id, type: 'account_authority', account_id: randomUUID(), status: 'disabled', epoch: index + 2}, at: `2026-10-14T09:00:00.${String(index).padStart(3, '0')}Z`, relayed: false};
  });
  let holder: string | null = null;
  const calls: {name: string; body: Record<string, unknown>}[] = [];
  const fetch = async (input: string, init?: RequestInit): Promise<Response> => {
    const name = String(input).split('/rpc/')[1];
    const body = JSON.parse(String(init?.body));
    calls.push({name, body});
    if (extra[name]) return extra[name](body);
    const open = outbox.filter((item) => !item.relayed);
    if (name === 'ledger_pending') return json({pending: open.length, oldest_seconds: open.length ? 5 : null});
    if (name === 'claim_ledger_events') {
      if (holder !== null && holder !== body.p_holder) return json({outcome: 'busy', events: []});
      holder = String(body.p_holder);
      return json({outcome: 'claimed', events: open.slice(0, Number(body.p_limit)).map(({relayed: _relayed, ...item}) => item)});
    }
    if (name === 'finish_ledger_events') {
      let marked = 0;
      for (const item of outbox) if ((body.p_event_ids as string[]).includes(item.id) && !item.relayed) { item.relayed = true; marked += 1; }
      const released = body.p_release === true && holder === body.p_holder;
      if (released) holder = null;
      return json({marked, released});
    }
    throw new Error(`the test did not expect api.${name}`);
  };
  return {fetch, calls, names: () => calls.map((call) => call.name), pending: () => outbox.filter((item) => !item.relayed).length, holder: () => holder, expireLease: () => { holder = null; }};
}
const context = (database: {fetch: (input: string, init?: RequestInit) => Promise<Response>}, store?: ReturnType<typeof createFixtureLedgerStore> | null) => ({instanceId: INSTANCE, accounts: {env, fetch: database.fetch as never}, ...(store === undefined ? {} : {ledgerStore: store})});

describe('the registered tasks', () => {
  it('has a function for every registered task and none for any other', () => {
    expect(Object.keys(tasks).sort()).toEqual([...scheduledTasks].sort());
  });

  it('holds the limits the contract states: 50 events within one 30 second lease, 100 identities', () => {
    expect([relayBatchLimit, relayLeaseSeconds, purgeBatchLimit]).toEqual([50, 30, 100]);
  });

  it('configures no ledger store until Story 8.9: the fixture one is for the tests alone', () => {
    expect(configuredLedgerStore()).toBeNull();
  });
});

describe('ledger-relay', () => {
  it('is `idle` when nothing is pending, and does not ask the store or claim the lease', async () => {
    const database = fakeDatabase(0);
    const store = createFixtureLedgerStore();
    expect(await runTask('ledger-relay', context(database, store))).toEqual({outcome: 'idle', result: {pending: 0}});
    expect(database.names()).toEqual(['ledger_pending']);
    expect(store.calls).toEqual({head: 0, putIfAbsent: 0});
  });

  it('is `idle` with no store configured either: nothing pending needs none', async () => {
    const database = fakeDatabase(0);
    expect(await runTask('ledger-relay', context(database, null))).toEqual({outcome: 'idle', result: {pending: 0}});
    expect(await runTask('ledger-relay', context(database))).toEqual({outcome: 'idle', result: {pending: 0}});
  });

  it('is `no_store` when events are pending and no store is configured, recording how many wait, and touches nothing', async () => {
    const database = fakeDatabase(3);
    for (const given of [null, undefined]) {
      expect(await runTask('ledger-relay', context(database, given))).toEqual({outcome: 'no_store', result: {pending: 3}});
    }
    // Only the count was asked: the lease was not taken and nothing was marked.
    expect(new Set(database.names())).toEqual(new Set(['ledger_pending']));
    expect(database.pending()).toBe(3);
    expect(database.holder()).toBeNull();
  });

  it('relays the pending events once, in order, and records what the relay reported', async () => {
    const database = fakeDatabase(3);
    const store = createFixtureLedgerStore();
    expect(await runTask('ledger-relay', context(database, store))).toEqual({outcome: 'ran', result: {outcome: 'relayed', claimed: 3, appended: 3, marked: 3}});
    expect(database.pending()).toBe(0);
    expect(store.size).toBe(3);
    expect(verifyChain(INSTANCE, store.objects())).toEqual({ok: true, length: 3});
    // One claim, within one lease of 30 seconds and at most 50 events; the lease is let go.
    const claim = database.calls.find((call) => call.name === 'claim_ledger_events');
    expect(claim?.body).toMatchObject({p_limit: 50, p_lease_seconds: 30});
    expect(database.holder()).toBeNull();
    // The next firing finds nothing to do.
    expect((await runTask('ledger-relay', context(database, store))).outcome).toBe('idle');
    expect(store.size).toBe(3);
  });

  it('relays at most 50 events in one firing and leaves the rest for the next', async () => {
    const database = fakeDatabase(60);
    const store = createFixtureLedgerStore();
    expect(await runTask('ledger-relay', context(database, store))).toEqual({outcome: 'ran', result: {outcome: 'relayed', claimed: 50, appended: 50, marked: 50}});
    expect(database.pending()).toBe(10);
    expect(await runTask('ledger-relay', context(database, store))).toEqual({outcome: 'ran', result: {outcome: 'relayed', claimed: 10, appended: 10, marked: 10}});
    expect(database.pending()).toBe(0);
    expect(verifyChain(INSTANCE, store.objects())).toEqual({ok: true, length: 60});
  });

  it('records a store outage as a run, keeps the events pending and resumes at the next firing', async () => {
    const database = fakeDatabase(3);
    const store = createFixtureLedgerStore();
    store.setOutage(true);
    expect(await runTask('ledger-relay', context(database, store))).toEqual({outcome: 'ran', result: {outcome: 'store_unavailable', claimed: 3, appended: 0, marked: 0}});
    expect(database.pending()).toBe(3);
    expect(database.holder()).toBeNull();
    store.setOutage(false);
    expect(await runTask('ledger-relay', context(database, store))).toEqual({outcome: 'ran', result: {outcome: 'relayed', claimed: 3, appended: 3, marked: 3}});
    expect(database.pending()).toBe(0);
  });

  // A damaged chain is not a result: it will be damaged on the next firing too. The run throws, so the receipt is `failed` with the class name
  // and the route answers 500 (tests/unit/jobs-route.test.ts, tests/integration/scheduled-jobs.test.ts), and the events stay pending.
  describe('a chain that is damaged', () => {
    /** A store that already holds, at the key the relay would write, something other than what it would write. */
    const conflicting: LedgerStore = {head: async () => null, putIfAbsent: async () => 'exists'};
    /** A store whose newest object is not a link of the chain. */
    const corrupt: LedgerStore = {head: async () => ({key: 'not-a-ledger-key', body: 'not a body'}), putIfAbsent: async () => 'created'};

    it('throws LedgerConflictError for a `conflict`, returns no result, and leaves every event pending and the lease let go', async () => {
      const database = fakeDatabase(3);
      const failure = await runTask('ledger-relay', context(database, conflicting as never)).then(
        (answer) => ({answer}),
        (error: unknown) => ({error}),
      );
      expect(failure).not.toHaveProperty('answer');
      const {error} = failure as {error: Error};
      expect(error).toBeInstanceOf(LedgerConflictError);
      expect(error.name).toBe('LedgerConflictError');
      expect(database.pending()).toBe(3);
      expect(database.holder()).toBeNull();
    });

    it('throws LedgerCorruptError for a `corrupt`, returns no result, and leaves every event pending and the lease let go', async () => {
      const database = fakeDatabase(3);
      const failure = await runTask('ledger-relay', context(database, corrupt as never)).then(
        (answer) => ({answer}),
        (error: unknown) => ({error}),
      );
      expect(failure).not.toHaveProperty('answer');
      const {error} = failure as {error: Error};
      expect(error).toBeInstanceOf(LedgerCorruptError);
      expect(error.name).toBe('LedgerCorruptError');
      expect(database.pending()).toBe(3);
      expect(database.holder()).toBeNull();
    });

    it('names the class in a form a receipt may hold, and puts no key, ID or event in the message', async () => {
      const database = fakeDatabase(2);
      for (const [store, expected] of [[conflicting, LedgerConflictError], [corrupt, LedgerCorruptError]] as const) {
        const error = await runTask('ledger-relay', context(database, store as never)).then(
          () => {
            throw new Error('the task returned a result');
          },
          (caught: unknown) => caught as Error,
        );
        expect(error).toBeInstanceOf(expected);
        expect(error.name).toMatch(/^[A-Z][A-Za-z]{0,47}$/);
        expect(error.message).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}|not-a-ledger-key|not a body/);
      }
    });

    it('is no failure when the store is merely down or the relay is busy: those stay `ran`, as the next firing resumes', async () => {
      const down = createFixtureLedgerStore();
      down.setOutage(true);
      expect(await runTask('ledger-relay', context(fakeDatabase(1), down))).toMatchObject({outcome: 'ran', result: {outcome: 'store_unavailable'}});
      const busy = fakeDatabase(1);
      await busy.fetch('x/rpc/claim_ledger_events', {method: 'POST', body: JSON.stringify({p_holder: randomUUID(), p_limit: 1, p_lease_seconds: 30})});
      expect(await runTask('ledger-relay', context(busy, createFixtureLedgerStore()))).toMatchObject({outcome: 'ran', result: {outcome: 'busy'}});
    });
  });

  it('records a relay that finds another holder as a run that did nothing', async () => {
    const database = fakeDatabase(2);
    await database.fetch('x/rpc/claim_ledger_events', {method: 'POST', body: JSON.stringify({p_holder: randomUUID(), p_limit: 1, p_lease_seconds: 30})});
    const store = createFixtureLedgerStore();
    expect(await runTask('ledger-relay', context(database, store))).toEqual({outcome: 'ran', result: {outcome: 'busy', claimed: 0, appended: 0, marked: 0}});
    expect(store.calls).toEqual({head: 0, putIfAbsent: 0});
  });

  it('throws, so the run is `failed` and retried, when the database does not answer', async () => {
    const down = fakeDatabase(3, {ledger_pending: () => json({message: 'down'}, 503)});
    await expect(runTask('ledger-relay', context(down, createFixtureLedgerStore()))).rejects.toBeInstanceOf(AccountsUnavailableError);
    const claimless = fakeDatabase(3, {claim_ledger_events: () => json({message: 'down'}, 503)});
    await expect(runTask('ledger-relay', context(claimless, createFixtureLedgerStore()))).rejects.toBeInstanceOf(AccountsUnavailableError);
  });
});

describe('dormant-identity-purge', () => {
  it('asks the database to purge at most 100 identities, with no age, and records the four counts', async () => {
    const database = fakeDatabase(0, {purge_dormant_identities: () => json({deleted: 4, kept: 2, locked: 1, remaining: 9})});
    expect(await runTask('dormant-identity-purge', context(database))).toEqual({outcome: 'ran', result: {deleted: 4, kept: 2, locked: 1, remaining: 9}});
    expect(database.calls).toEqual([{name: 'purge_dormant_identities', body: {p_limit: 100}}]);
  });

  it('records zeros as a run, not as idle: it looked and found none', async () => {
    const database = fakeDatabase(0, {purge_dormant_identities: () => json({deleted: 0, kept: 0, locked: 0, remaining: 0})});
    expect(await runTask('dormant-identity-purge', context(database))).toEqual({outcome: 'ran', result: {deleted: 0, kept: 0, locked: 0, remaining: 0}});
  });

  it.each([
    ['more than a batch', {deleted: 90, kept: 10, locked: 1, remaining: 0}],
    ['a negative count', {deleted: -1, kept: 0, locked: 0, remaining: 0}],
    ['a count that is not a number', {deleted: '1', kept: 0, locked: 0, remaining: 0}],
    ['a missing count', {deleted: 1, kept: 0, locked: 0}],
    ['text', 'purged'],
  ])('throws for %s: that is not a report', async (_name, answer) => {
    const database = fakeDatabase(0, {purge_dormant_identities: () => json(answer)});
    await expect(runTask('dormant-identity-purge', context(database))).rejects.toBeInstanceOf(AccountsUnavailableError);
  });

  it('throws when the database does not answer', async () => {
    const database = fakeDatabase(0, {purge_dormant_identities: () => json({code: '57014'}, 500)});
    await expect(runTask('dormant-identity-purge', context(database))).rejects.toBeInstanceOf(AccountsUnavailableError);
  });
});

describe('what a receipt may hold', () => {
  it('refuses a task that answers a result a receipt could not hold, by name, before anything is recorded', async () => {
    const spy = vi.spyOn(tasks, 'ledger-relay').mockResolvedValue({outcome: 'ran', result: {address: 'someone@example.test'}});
    await expect(runTask('ledger-relay', {instanceId: INSTANCE})).rejects.toThrow(TypeError);
    spy.mockResolvedValue({outcome: 'ran', result: {count: 1.5}});
    await expect(runTask('ledger-relay', {instanceId: INSTANCE})).rejects.toThrow(TypeError);
    spy.mockResolvedValue({outcome: 'ran', result: {count: 3, ok: true, outcome: 'relayed', error_class: 'TypeError'}});
    await expect(runTask('ledger-relay', {instanceId: INSTANCE})).resolves.toMatchObject({outcome: 'ran'});
    spy.mockRestore();
  });
});
