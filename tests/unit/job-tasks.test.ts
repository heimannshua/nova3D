import {randomUUID} from 'node:crypto';
import {describe, expect, it, vi} from 'vitest';
import {AccountsUnavailableError} from '@/lib/accounts';
import {GatewayError, GatewayUnavailableError, type GatewayClient} from '@/lib/gateway-client';
import {configuredLedgerStore, LedgerConflictError, LedgerCorruptError, purgeBatchLimit, relayBatchLimit, relayLeaseSeconds, runTask, stagingCleanupLimit, StagingCleanupIncompleteError, tasks} from '@/lib/job-tasks';
import {isJobResult} from '@/lib/lifecycle';
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

// Story 1.12: the hourly staging cleanup. The database is the same stand-in (`list_expired_staging` is the one call the task makes), and the gateway is
// a fake client that records the signed commands the real one would send (the real client is tests/unit/gateway-client.test.ts, the gateway's
// handling of `delete-staging` tests/unit/gateway-server.test.ts, and the whole path tests/integration/file-gateway.test.ts).
describe('staging-cleanup', () => {
  const lease = (index: number) => ({upload_id: `0000000${index}-aaaa-4bbb-8ccc-00000000000${index}`, account_id: `1111111${index}-dddd-4eee-8fff-11111111111${index}`});
  const asked = (leases: unknown) => fakeDatabase(0, {list_expired_staging: () => json({leases})});
  const gatewayOf = (answers: ('deleted' | 'kept' | Error)[] = []) => {
    const calls: {accountId: string; uploadId: string}[] = [];
    const deleteStaging = vi.fn(async (input: {accountId: string; uploadId: string}) => {
      calls.push(input);
      const answer = answers[calls.length - 1] ?? 'deleted';
      if (answer instanceof Error) throw answer;
      return {outcome: answer};
    });
    const client: GatewayClient = {deleteStaging, deleteRoot: vi.fn(), attach: vi.fn()};
    return {client, calls, deleteStaging};
  };
  const withGateway = (database: {fetch: (input: string, init?: RequestInit) => Promise<Response>}, gateway: GatewayClient | null | undefined) => ({
    ...context(database),
    ...(gateway === undefined ? {} : {gateway}),
  });

  it('holds the limit the contract states: at most 50 leases in one firing', () => {
    expect(stagingCleanupLimit).toBe(50);
  });

  it('is `no_store` with no gateway configured, and reads nothing: no list, no database call at all', async () => {
    const database = asked([lease(1)]);
    expect(await runTask('staging-cleanup', withGateway(database, null))).toEqual({outcome: 'no_store', result: {configured: false}});
    expect(database.calls).toEqual([]);
  });

  it('uses the gateway the environment configures when none is passed, and with none configured that is `no_store` too', async () => {
    for (const name of ['SERVICE_SIGNING_KEY_APPLICATION', 'SERVICE_KEYS_APPLICATION', 'FILE_GATEWAY_URL']) vi.stubEnv(name, '');
    try {
      const database = asked([lease(1)]);
      expect(await runTask('staging-cleanup', withGateway(database, undefined))).toEqual({outcome: 'no_store', result: {configured: false}});
      expect(database.calls).toEqual([]);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('is `idle` when nothing is expired or released, having asked for at most 50 and sent no command', async () => {
    const database = asked([]);
    const gateway = gatewayOf();
    expect(await runTask('staging-cleanup', withGateway(database, gateway.client))).toEqual({outcome: 'idle', result: {expired: 0}});
    expect(database.calls).toEqual([{name: 'list_expired_staging', body: {p_limit: 50}}]);
    expect(gateway.deleteStaging).not.toHaveBeenCalled();
  });

  it('sends one signed delete command for each lease, in the order listed, for that upload and that Account, and records counts only', async () => {
    const database = asked([lease(1), lease(2), lease(3)]);
    const gateway = gatewayOf(['deleted', 'kept', 'deleted']);
    const answer = await runTask('staging-cleanup', withGateway(database, gateway.client));
    expect(answer).toEqual({outcome: 'ran', result: {expired: 3, deleted: 2, kept: 1}});
    expect(gateway.calls).toEqual([1, 2, 3].map((index) => ({accountId: lease(index).account_id, uploadId: lease(index).upload_id})));
    // One at a time, in order: the second command is not sent until the first has been answered.
    expect(gateway.deleteStaging.mock.invocationCallOrder).toEqual([...gateway.deleteStaging.mock.invocationCallOrder].sort((a, b) => a - b));
    expect(isJobResult(answer.result)).toBe(true);
    expect(Object.keys(answer.result).sort()).toEqual(['deleted', 'expired', 'kept']);
    expect(JSON.stringify(answer)).not.toMatch(/0000000|1111111/);
    expect(database.names()).toEqual(['list_expired_staging']);
  });

  it('keeps a lease the gateway keeps (renewed meanwhile) and counts it, without failing the run', async () => {
    const answer = await runTask('staging-cleanup', withGateway(asked([lease(1), lease(2)]), gatewayOf(['kept', 'kept']).client));
    expect(answer).toEqual({outcome: 'ran', result: {expired: 2, deleted: 0, kept: 2}});
  });

  it('signs the lower-case, canonical spelling of an ID the database answered in capitals', async () => {
    const gateway = gatewayOf();
    await runTask('staging-cleanup', withGateway(asked([{upload_id: lease(1).upload_id.toUpperCase(), account_id: lease(1).account_id.toUpperCase()}]), gateway.client));
    // lib/lifecycle.ts lower-cases an ID it has accepted, so what is signed is the canonical spelling.
    expect(gateway.calls).toEqual([{accountId: lease(1).account_id, uploadId: lease(1).upload_id}]);
  });

  it('FAILS the run at the first lease when the gateway is UNAVAILABLE (cannot be reached, or says so), and attempts no other: the class of the error survives to the receipt', async () => {
    const database = asked([lease(1), lease(2), lease(3)]);
    const down = gatewayOf([new GatewayUnavailableError()]);
    await expect(runTask('staging-cleanup', withGateway(database, down.client))).rejects.toMatchObject({name: 'GatewayUnavailableError'});
    expect(down.calls).toHaveLength(1);
    const refused = gatewayOf(['deleted', new GatewayError(503)]);
    await expect(runTask('staging-cleanup', withGateway(database, refused.client))).rejects.toMatchObject({name: 'GatewayError', status: 503});
    // The second lease met an unavailable gateway: the first was deleted and the third was never tried. The next firing lists afresh and the commands are idempotent.
    expect(refused.calls).toHaveLength(2);
    const failing = gatewayOf([new GatewayError(500)]);
    await expect(runTask('staging-cleanup', withGateway(database, failing.client))).rejects.toMatchObject({name: 'GatewayError', status: 500});
    expect(failing.calls).toHaveLength(1);
  });

  // Story 1.12 review (P10): the finding was real. One lease the gateway refuses for itself (a 4xx, an answer that is not an answer) used to fail the run at
  // that lease, so a poison lease at the head of the list kept every lease behind it from ever being cleaned.
  it('handles each lease on its own when the gateway refuses ONE of them: a poison lease first does not keep the others from being cleaned, and the run still fails', async () => {
    const database = asked([lease(1), lease(2), lease(3)]);
    for (const refusal of [new GatewayError(401), new GatewayError(400), new GatewayError(404), new GatewayError(409), new GatewayError(200)]) {
      const gateway = gatewayOf([refusal, 'deleted', 'kept']);
      await expect(runTask('staging-cleanup', withGateway(database, gateway.client)), String(refusal.status)).rejects.toMatchObject({name: 'StagingCleanupIncompleteError'});
      // All three were tried, in order: the poison lease did not stop the loop.
      expect(gateway.calls).toEqual([1, 2, 3].map((index) => ({accountId: lease(index).account_id, uploadId: lease(index).upload_id})));
    }
  });

  it('records the failure by class name only (no ID, no count of leases in the message), and counts stay in the result only when the run succeeds', async () => {
    const database = asked([lease(1), lease(2)]);
    const error = await runTask('staging-cleanup', withGateway(database, gatewayOf([new GatewayError(401), 'deleted']).client)).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(StagingCleanupIncompleteError);
    expect(error).toMatchObject({name: 'StagingCleanupIncompleteError'});
    expect(String((error as Error).message)).not.toMatch(/0000000|1111111/);
    expect(/^[A-Z][A-Za-z]{0,47}$/.test((error as Error).name)).toBe(true);
    // A run in which every lease is handled succeeds, with its counts.
    expect(await runTask('staging-cleanup', withGateway(database, gatewayOf(['deleted', 'kept']).client))).toEqual({outcome: 'ran', result: {expired: 2, deleted: 1, kept: 1}});
  });

  it('stops at an unavailable gateway even after an earlier lease was refused for itself: the run fails as unavailable and the rest are not tried', async () => {
    const gateway = gatewayOf([new GatewayError(403), new GatewayUnavailableError()]);
    await expect(runTask('staging-cleanup', withGateway(asked([lease(1), lease(2), lease(3)]), gateway.client))).rejects.toMatchObject({name: 'GatewayUnavailableError'});
    expect(gateway.calls).toHaveLength(2);
  });

  it('throws when the database does not answer, and sends no command', async () => {
    const database = fakeDatabase(0, {list_expired_staging: () => json({message: 'down'}, 503)});
    const gateway = gatewayOf();
    await expect(runTask('staging-cleanup', withGateway(database, gateway.client))).rejects.toBeInstanceOf(AccountsUnavailableError);
    expect(gateway.deleteStaging).not.toHaveBeenCalled();
  });

  it.each([
    ['text', 'staged'],
    ['a list that is not a list', {leases: {}}],
    ['more than were asked for', {leases: Array.from({length: 51}, (_unused, index) => ({upload_id: `0000${String(index).padStart(4, '0')}-aaaa-4bbb-8ccc-000000000000`, account_id: lease(1).account_id}))}],
    ['an upload that is not an ID', {leases: [{upload_id: '../../objects', account_id: lease(1).account_id}]}],
    ['an Account that is not an ID', {leases: [{upload_id: lease(1).upload_id, account_id: 'staging/x'}]}],
    ['a lease with no Account', {leases: [{upload_id: lease(1).upload_id}]}],
    ['a lease that is not an object', {leases: ['x']}],
  ])('throws for %s, and sends no command: an ID names the prefix that is deleted', async (_name, answer) => {
    const database = fakeDatabase(0, {list_expired_staging: () => json(answer)});
    const gateway = gatewayOf();
    await expect(runTask('staging-cleanup', withGateway(database, gateway.client))).rejects.toBeInstanceOf(AccountsUnavailableError);
    expect(gateway.deleteStaging).not.toHaveBeenCalled();
  });
});
