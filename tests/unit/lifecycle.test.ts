import {randomBytes, randomUUID} from 'node:crypto';
import {describe, expect, it, vi} from 'vitest';
import {AccountsUnavailableError, hashClientAddress} from '@/lib/accounts';
import {claimJobRun, claimLedgerEvents, defaultPurgeLimit, finishJobRun, finishLedgerEvents, guardTarget, isJobResult, isStatusHandle, jobOutcomes, lastJobRun, ledgerPending, lookupStatus, maxPurgeLimit, purgeDormantIdentities, recordTombstone, targetOutcomes} from '@/lib/lifecycle';

// The typed calls of the Lifecycle functions (lib/lifecycle.ts, Story 1.8) against a fake fetch: what each sends, what each accepts as
// an answer, and that an answer that cannot be got is an error, never an "unknown" handle, an empty backlog or a permission.
const ACCOUNT = '7a1b2c3d-4e5f-4a6b-8c7d-0e1f2a3b4c5d';
const TARGET = '9d8c7b6a-5f4e-4d3c-8b2a-1f0e9d8c7b6a';
const HOLDER = '11111111-2222-4333-8444-555555555555';
const HANDLE = 'a1b2c3d4e5f60718293a4b5c6d7e8f90';
const rateKey = randomBytes(32);
const env = {NEXT_PUBLIC_SUPABASE_URL: 'https://abcdefgh.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'service-key-for-tests-only', RATE_LIMIT_HASH_KEY: rateKey.toString('base64')};

type Sent = {name: string; body: Record<string, unknown>; headers: Record<string, string>};
function fake(answer: unknown, status = 200) {
  const sent: Sent[] = [];
  const fetch = vi.fn(async (input: string, init?: RequestInit) => {
    sent.push({name: input.split('/rpc/')[1], body: JSON.parse(String(init?.body)), headers: init?.headers as Record<string, string>});
    return new Response(JSON.stringify(answer), {status, headers: {'content-type': 'application/json'}});
  });
  return {fetch, sent, options: {env, fetch}};
}
const down = {env, fetch: async () => { throw new TypeError('fetch failed'); }};

describe('recordTombstone', () => {
  it('asks for the kind and the ID, as the service role, and reads the receipt', async () => {
    const {sent, options} = fake({outcome: 'recorded', kind: 'account', target_id: ACCOUNT, revision: 4});
    expect(await recordTombstone({kind: 'account', id: ACCOUNT.toUpperCase()}, options)).toEqual({outcome: 'recorded', kind: 'account', targetId: ACCOUNT, revision: 4});
    expect(sent).toEqual([expect.objectContaining({name: 'record_tombstone', body: {p_kind: 'account', p_target_id: ACCOUNT}})]);
    expect(sent[0].headers).toMatchObject({authorization: 'Bearer service-key-for-tests-only', 'content-profile': 'api'});
  });

  it('reads `exists` with the first revision, and `not_found` with nothing', async () => {
    expect(await recordTombstone({kind: 'project', id: TARGET}, fake({outcome: 'exists', kind: 'project', target_id: TARGET, revision: 2}).options)).toEqual({outcome: 'exists', kind: 'project', targetId: TARGET, revision: 2});
    expect(await recordTombstone({kind: 'project', id: TARGET}, fake({outcome: 'not_found', kind: 'project', target_id: TARGET, revision: null}).options)).toEqual({outcome: 'not_found'});
  });

  it('refuses a kind that is not one and an ID that is not a UUID, without asking', async () => {
    const {fetch, options} = fake({});
    await expect(recordTombstone({kind: 'workspace' as never, id: TARGET}, options)).rejects.toBeInstanceOf(TypeError);
    await expect(recordTombstone({kind: 'project', id: 'nope'}, options)).rejects.toBeInstanceOf(TypeError);
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([
    ['an outcome it does not know', {outcome: 'done', kind: 'account', target_id: ACCOUNT, revision: 1}],
    ['no revision', {outcome: 'recorded', kind: 'account', target_id: ACCOUNT, revision: null}],
    ['a revision of 0', {outcome: 'recorded', kind: 'account', target_id: ACCOUNT, revision: 0}],
    ['another kind than the one asked for', {outcome: 'recorded', kind: 'project', target_id: ACCOUNT, revision: 2}],
    ['another target than the one asked for', {outcome: 'recorded', kind: 'account', target_id: TARGET, revision: 2}],
    ['text', 'recorded'],
  ])('treats %s as no answer at all', async (_name, answer) => {
    await expect(recordTombstone({kind: 'account', id: ACCOUNT}, fake(answer).options)).rejects.toBeInstanceOf(AccountsUnavailableError);
  });

  it('throws when the database cannot be reached, with the outcome unknown: the caller may call again, the writer is idempotent', async () => {
    await expect(recordTombstone({kind: 'account', id: ACCOUNT}, down)).rejects.toMatchObject({name: 'AccountsUnavailableError', retryable: true, outcomeUnknown: true});
  });
});

describe('guardTarget', () => {
  it('names the answers of the operation guard and `unavailable`', () => {
    expect([...targetOutcomes]).toEqual(['allowed', 'disabled', 'stale_epoch', 'no_account', 'tombstoned', 'unavailable']);
  });

  it('sends the Account, the epoch it registered under, the kind and the target, and maps each answer', async () => {
    const {sent, options} = fake({outcome: 'allowed', epoch: 3});
    expect(await guardTarget({accountId: ACCOUNT, epoch: 3, kind: 'project', id: TARGET.toUpperCase()}, options)).toEqual({outcome: 'allowed', epoch: 3});
    expect(sent[0]).toMatchObject({name: 'guard_target', body: {p_account_id: ACCOUNT, p_epoch: 3, p_kind: 'project', p_target_id: TARGET}});
    for (const [outcome, epoch] of [['disabled', 4], ['stale_epoch', 4], ['no_account', null], ['tombstoned', 4], ['tombstoned', null], ['unavailable', 3]] as const) {
      expect(await guardTarget({accountId: ACCOUNT, epoch: 3, kind: 'project', id: TARGET}, fake({outcome, epoch}).options), `${outcome} ${epoch}`).toEqual({outcome, epoch});
    }
  });

  it('answers unavailable, without asking, for an ID that cannot be a target\'s: nothing can be learned from it, so nothing is asked', async () => {
    const {fetch, options} = fake({outcome: 'allowed', epoch: 3});
    for (const id of ['nope', '', `  ${TARGET}`, `${TARGET}\n`, `%20${TARGET}`, 7 as never, null as never]) {
      expect(await guardTarget({accountId: ACCOUNT, epoch: 3, kind: 'project', id}, options), String(id)).toEqual({outcome: 'unavailable', epoch: null});
    }
    expect(fetch).not.toHaveBeenCalled();
  });

  it('refuses an operation or a kind that is not shaped like one, before asking', async () => {
    const {fetch, options} = fake({});
    await expect(guardTarget({accountId: 'nope', epoch: 3, kind: 'project', id: TARGET}, options)).rejects.toBeInstanceOf(TypeError);
    for (const epoch of [0, -1, 1.5, Number.NaN]) await expect(guardTarget({accountId: ACCOUNT, epoch, kind: 'project', id: TARGET}, options)).rejects.toBeInstanceOf(TypeError);
    await expect(guardTarget({accountId: ACCOUNT, epoch: 3, kind: 'job' as never, id: TARGET}, options)).rejects.toBeInstanceOf(TypeError);
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([
    ['an outcome it does not know', {outcome: 'ok', epoch: 1}],
    ['an allowed answer with no epoch', {outcome: 'allowed', epoch: null}],
    ['a stale answer with no epoch', {outcome: 'stale_epoch'}],
    ['an epoch that is not a number', {outcome: 'allowed', epoch: 'three'}],
    ['text', 'allowed'],
  ])('treats %s as no answer at all, which is never permission', async (_name, answer) => {
    await expect(guardTarget({accountId: ACCOUNT, epoch: 3, kind: 'project', id: TARGET}, fake(answer).options)).rejects.toBeInstanceOf(AccountsUnavailableError);
  });
});

describe('lookupStatus', () => {
  it('sends the handle and the origin as a keyed hash, never the address, and reads the state and revision', async () => {
    const {sent, options} = fake({outcome: 'disabled', revision: 4, retry_after: null});
    expect(await lookupStatus({handle: HANDLE, clientAddress: '198.51.100.7'}, options)).toEqual({outcome: 'found', state: 'disabled', revision: 4});
    expect(sent[0].name).toBe('lookup_status');
    expect(sent[0].body).toEqual({p_handle: HANDLE, p_origin_hash: hashClientAddress('198.51.100.7', rateKey)});
    expect(JSON.stringify(sent[0])).not.toContain('198.51.100.7');
  });

  it('shares one origin among the callers whose address is not known, as registration does (a shared budget fails closed)', async () => {
    const {sent, options} = fake({outcome: 'unknown', revision: null, retry_after: null});
    await lookupStatus({handle: HANDLE, clientAddress: null}, options);
    await lookupStatus({handle: HANDLE, clientAddress: 'garbage'}, options);
    expect(sent[0].body.p_origin_hash).toBe(sent[1].body.p_origin_hash);
  });

  it.each(['active', 'disabled', 'deleted'] as const)('reads %s', async (state) => {
    expect(await lookupStatus({handle: HANDLE, clientAddress: null}, fake({outcome: state, revision: 2, retry_after: null}).options)).toEqual({outcome: 'found', state, revision: 2});
  });

  it('reads unknown and limited, and the seconds to wait', async () => {
    expect(await lookupStatus({handle: HANDLE, clientAddress: null}, fake({outcome: 'unknown', revision: null, retry_after: null}).options)).toEqual({outcome: 'unknown'});
    expect(await lookupStatus({handle: HANDLE, clientAddress: null}, fake({outcome: 'limited', revision: null, retry_after: 17}).options)).toEqual({outcome: 'limited', retryAfter: 17});
  });

  it('refuses a handle that is not 32 lower-case hexadecimal characters, without asking', async () => {
    const {fetch, options} = fake({});
    for (const handle of ['', 'abc', HANDLE.toUpperCase(), `${HANDLE}0`, HANDLE.slice(1), ` ${HANDLE}`, 'g'.repeat(32), 7 as never]) {
      await expect(lookupStatus({handle, clientAddress: null}, options), String(handle)).rejects.toBeInstanceOf(TypeError);
    }
    expect(fetch).not.toHaveBeenCalled();
    expect(isStatusHandle(HANDLE)).toBe(true);
    expect(isStatusHandle(HANDLE.toUpperCase())).toBe(false);
  });

  it('needs the rate-limit key to hash the origin, and says which variable is missing, never a value', async () => {
    const { RATE_LIMIT_HASH_KEY: _removed, ...withoutKey } = env;
    await expect(lookupStatus({handle: HANDLE, clientAddress: null}, {env: withoutKey, fetch: fake({}).fetch})).rejects.toThrow('RATE_LIMIT_HASH_KEY is not set');
  });

  it.each([
    ['an outcome it does not know', {outcome: 'present', revision: 1}],
    ['a known state with no revision', {outcome: 'active', revision: null}],
    ['a revision of 0', {outcome: 'deleted', revision: 0}],
    ['limited with nothing to wait', {outcome: 'limited', retry_after: null}],
    ['limited with a wait of 0', {outcome: 'limited', retry_after: 0}],
    ['text', 'unknown'],
  ])('treats %s as no answer at all: never unknown', async (_name, answer) => {
    await expect(lookupStatus({handle: HANDLE, clientAddress: null}, fake(answer).options)).rejects.toBeInstanceOf(AccountsUnavailableError);
  });

  it('throws, and does not answer unknown, when the database cannot be reached or refuses', async () => {
    await expect(lookupStatus({handle: HANDLE, clientAddress: null}, down)).rejects.toMatchObject({retryable: true});
    await expect(lookupStatus({handle: HANDLE, clientAddress: null}, fake({message: 'no'}, 503).options)).rejects.toMatchObject({retryable: true});
  });

  it('puts the handle in no error message', async () => {
    for (const options of [down, fake({message: 'no'}, 503).options, fake('nonsense').options]) {
      const error = await lookupStatus({handle: HANDLE, clientAddress: null}, options).catch((caught: Error) => caught);
      expect(String((error as Error).message)).not.toContain(HANDLE);
    }
  });
});

describe('claimLedgerEvents, finishLedgerEvents and ledgerPending', () => {
  const eventId = randomUUID();
  const item = {id: eventId, seq: 5, event: {id: eventId, type: 'account_authority', account_id: ACCOUNT, status: 'disabled', epoch: 3}, at: '2026-10-13T09:00:00.123Z'};

  it('claims for a holder with a limit and a lease, and reads the events in order', async () => {
    const second = randomUUID();
    const {sent, options} = fake({outcome: 'claimed', events: [item, {...item, id: second, seq: 6, event: {...item.event, id: second}}]});
    const claimed = await claimLedgerEvents({holder: HOLDER.toUpperCase(), limit: 10, leaseSeconds: 20}, options);
    expect(claimed).toEqual({outcome: 'claimed', events: [item, {...item, id: second, seq: 6, event: {...item.event, id: second}}]});
    expect(sent[0]).toMatchObject({name: 'claim_ledger_events', body: {p_holder: HOLDER, p_limit: 10, p_lease_seconds: 20}});
  });

  it('asks for 50 events and a 30 second lease by default, and reads busy', async () => {
    const {sent, options} = fake({outcome: 'busy', events: []});
    expect(await claimLedgerEvents({holder: HOLDER}, options)).toEqual({outcome: 'busy'});
    expect(sent[0].body).toEqual({p_holder: HOLDER, p_limit: 50, p_lease_seconds: 30});
  });

  it('refuses a limit, a lease or a holder out of range, without asking', async () => {
    const {fetch, options} = fake({});
    for (const limit of [0, 201, 1.5]) await expect(claimLedgerEvents({holder: HOLDER, limit}, options)).rejects.toBeInstanceOf(TypeError);
    for (const leaseSeconds of [0, 301, 2.5]) await expect(claimLedgerEvents({holder: HOLDER, leaseSeconds}, options)).rejects.toBeInstanceOf(TypeError);
    await expect(claimLedgerEvents({holder: 'me'}, options)).rejects.toBeInstanceOf(TypeError);
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([
    ['events that are out of order', {outcome: 'claimed', events: [{...item, seq: 6}, {...item, id: randomUUID(), seq: 5}]}],
    ['events with the same place twice', {outcome: 'claimed', events: [item, {...item}]}],
    ['an event that does not name itself', {outcome: 'claimed', events: [{...item, event: {...item.event, id: randomUUID()}}]}],
    ['an event with no type', {outcome: 'claimed', events: [{...item, event: {id: eventId}}]}],
    ['an event with a time that is not UTC to the millisecond', {outcome: 'claimed', events: [{...item, at: '2026-10-13T09:00:00Z'}]}],
    ['an event with an ID that is not a UUID', {outcome: 'claimed', events: [{...item, id: 'nope', event: {...item.event, id: 'nope'}}]}],
    ['an event with no place', {outcome: 'claimed', events: [{...item, seq: 0}]}],
    ['events that are not a list', {outcome: 'claimed', events: 'none'}],
    ['an outcome it does not know', {outcome: 'maybe', events: []}],
  ])('treats %s as no answer at all', async (_name, answer) => {
    await expect(claimLedgerEvents({holder: HOLDER}, fake(answer).options)).rejects.toBeInstanceOf(AccountsUnavailableError);
  });

  it('treats more events than were asked for as no answer', async () => {
    const many = Array.from({length: 3}, (_, index) => { const id = randomUUID(); return {...item, id, seq: index + 1, event: {...item.event, id}}; });
    await expect(claimLedgerEvents({holder: HOLDER, limit: 2}, fake({outcome: 'claimed', events: many}).options)).rejects.toBeInstanceOf(AccountsUnavailableError);
  });

  it('marks events and optionally lets go of the lease', async () => {
    const {sent, options} = fake({marked: 1, released: true});
    expect(await finishLedgerEvents({holder: HOLDER, eventIds: [eventId.toUpperCase()], release: true}, options)).toEqual({marked: 1, released: true});
    expect(sent[0]).toMatchObject({name: 'finish_ledger_events', body: {p_holder: HOLDER, p_event_ids: [eventId], p_release: true}});
    const none = fake({marked: 0, released: false});
    expect(await finishLedgerEvents({holder: HOLDER, eventIds: []}, none.options)).toEqual({marked: 0, released: false});
    expect(none.sent[0].body.p_release).toBe(false);
  });

  it('refuses IDs that are not UUIDs and more than 200 of them, and treats a count it cannot believe as no answer', async () => {
    const {fetch, options} = fake({});
    await expect(finishLedgerEvents({holder: HOLDER, eventIds: ['nope']}, options)).rejects.toBeInstanceOf(TypeError);
    await expect(finishLedgerEvents({holder: HOLDER, eventIds: Array.from({length: 201}, () => randomUUID())}, options)).rejects.toBeInstanceOf(TypeError);
    expect(fetch).not.toHaveBeenCalled();
    await expect(finishLedgerEvents({holder: HOLDER, eventIds: [eventId]}, fake({marked: 2, released: false}).options)).rejects.toBeInstanceOf(AccountsUnavailableError);
    await expect(finishLedgerEvents({holder: HOLDER, eventIds: [eventId]}, fake({marked: 1}).options)).rejects.toBeInstanceOf(AccountsUnavailableError);
  });

  it('reads how many events wait and how old the oldest is', async () => {
    expect(await ledgerPending(fake({pending: 3, oldest_seconds: 120}).options)).toEqual({pending: 3, oldestSeconds: 120});
    expect(await ledgerPending(fake({pending: 0, oldest_seconds: null}).options)).toEqual({pending: 0, oldestSeconds: null});
  });

  it.each([
    ['a count that is not a number', {pending: 'many', oldest_seconds: 1}],
    ['a negative count', {pending: -1, oldest_seconds: null}],
    ['something pending with no oldest', {pending: 2, oldest_seconds: null}],
    ['nothing pending with an oldest', {pending: 0, oldest_seconds: 4}],
    ['an age that is not a number', {pending: 1, oldest_seconds: 'old'}],
    ['text', 'none'],
  ])('treats %s as no answer: never an empty backlog', async (_name, answer) => {
    await expect(ledgerPending(fake(answer).options)).rejects.toBeInstanceOf(AccountsUnavailableError);
  });

  it('throws when the database cannot be reached', async () => {
    await expect(ledgerPending(down)).rejects.toBeInstanceOf(AccountsUnavailableError);
    await expect(claimLedgerEvents({holder: HOLDER}, down)).rejects.toBeInstanceOf(AccountsUnavailableError);
    await expect(finishLedgerEvents({holder: HOLDER, eventIds: []}, down)).rejects.toBeInstanceOf(AccountsUnavailableError);
  });
});

// Scheduled jobs (Story 1.9) ------------------------------------------------------------------------------------------------------------
const RECEIPT = '0d9c8b7a-6f5e-4d3c-8b2a-1f0e9d8c7b6a';

describe('isJobResult', () => {
  it('accepts a small flat object of whole numbers, booleans and single words', () => {
    for (const result of [{}, {pending: 0}, {deleted: 4, kept: 2, locked: 1, remaining: 9}, {outcome: 'store_unavailable', claimed: 3}, {error_class: 'TypeError'}, {ok: true, count: 999_999_999_999 - 1}]) {
      expect(isJobResult(result), JSON.stringify(result)).toBe(true);
    }
  });

  it('refuses everything else: an address, an ID, a key, a message, a nested value, a list, a fraction, a negative number, a bad name', () => {
    for (const result of [
      {address: 'someone@example.test'},
      {id: RECEIPT},
      {key: ['sk', 'live', '4eC39HqLyjWDarjtT1zdp7dc'].join('_')},
      {message: 'Something went wrong while relaying'},
      {message: 'a b'},
      {nested: {a: 1}},
      {list: [1]},
      {fraction: 1.5},
      {big: 1e12},
      {negative: -1},
      {not_finite: Number.POSITIVE_INFINITY},
      {Upper: 1},
      {'has space': 1},
      {empty: ''},
      {nothing: null},
      {longword: 'x'.repeat(40)},
      null,
      [],
      'text',
      7,
      Object.fromEntries(Array.from({length: 60}, (_, index) => [`key_${index}`, 1_000_000_000_000 - 1])),
    ]) {
      expect(isJobResult(result), JSON.stringify(result)?.slice(0, 40)).toBe(false);
    }
  });
});

describe('claimJobRun', () => {
  const key = {task: 'ledger-relay', scheduleId: 'scd_8f3a', messageId: 'msg_5b1c'};

  it('names the outcomes of a finished run: the only one a retry replaces is `failed`', () => {
    expect([...jobOutcomes]).toEqual(['ran', 'idle', 'no_store', 'failed']);
  });

  it('claims one run of a schedule and message, as the service role, with the default 300 second lease', async () => {
    const {sent, options} = fake({outcome: 'claimed', receipt_id: RECEIPT.toUpperCase(), attempt: 1});
    expect(await claimJobRun(key, options)).toEqual({outcome: 'claimed', receiptId: RECEIPT, attempt: 1});
    expect(sent).toEqual([expect.objectContaining({name: 'claim_job_run', body: {p_task: 'ledger-relay', p_schedule_id: 'scd_8f3a', p_message_id: 'msg_5b1c', p_lease_seconds: 300}})]);
    expect(sent[0].headers).toMatchObject({authorization: 'Bearer service-key-for-tests-only', 'content-profile': 'api'});
  });

  it('reads `duplicate` and `running` with nothing more than the outcome', async () => {
    expect(await claimJobRun(key, fake({outcome: 'duplicate', receipt_id: RECEIPT, attempt: 1}).options)).toEqual({outcome: 'duplicate'});
    expect(await claimJobRun(key, fake({outcome: 'running', receipt_id: RECEIPT, attempt: 2}).options)).toEqual({outcome: 'running'});
  });

  it('passes the lease it is given', async () => {
    const {sent, options} = fake({outcome: 'claimed', receipt_id: RECEIPT, attempt: 3});
    expect(await claimJobRun({...key, leaseSeconds: 60}, options)).toEqual({outcome: 'claimed', receiptId: RECEIPT, attempt: 3});
    expect(sent[0].body.p_lease_seconds).toBe(60);
  });

  it('refuses a task, schedule ID, message ID or lease that is not shaped like one, before asking', async () => {
    const {fetch, options} = fake({});
    for (const change of [{task: 'Ledger'}, {task: ''}, {task: 'a'.repeat(70)}, {scheduleId: ''}, {scheduleId: 'scd 1'}, {scheduleId: 'x'.repeat(129)}, {messageId: 'msg/1'}, {messageId: ''}, {leaseSeconds: 0}, {leaseSeconds: 3601}, {leaseSeconds: 1.5}]) {
      await expect(claimJobRun({...key, ...change}, options), JSON.stringify(change)).rejects.toBeInstanceOf(TypeError);
    }
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([
    ['an outcome it does not know', {outcome: 'ok', receipt_id: RECEIPT, attempt: 1}],
    ['no receipt', {outcome: 'claimed', attempt: 1}],
    ['a receipt that is not a UUID', {outcome: 'claimed', receipt_id: 'nope', attempt: 1}],
    ['no attempt', {outcome: 'duplicate', receipt_id: RECEIPT}],
    ['an attempt of 0', {outcome: 'claimed', receipt_id: RECEIPT, attempt: 0}],
    ['an attempt that is not a number', {outcome: 'claimed', receipt_id: RECEIPT, attempt: 'one'}],
    ['text', 'claimed'],
  ])('treats %s as no answer at all, which is never permission to run', async (_name, answer) => {
    await expect(claimJobRun(key, fake(answer).options)).rejects.toBeInstanceOf(AccountsUnavailableError);
  });

  it('throws when the database cannot be reached or refuses, so the route answers 503 and the delivery comes back', async () => {
    await expect(claimJobRun(key, down)).rejects.toMatchObject({name: 'AccountsUnavailableError', retryable: true});
    await expect(claimJobRun(key, fake({message: 'no'}, 503).options)).rejects.toMatchObject({retryable: true});
  });
});

describe('finishJobRun', () => {
  it('finishes a receipt with an outcome and a result, and reads the three answers', async () => {
    const {sent, options} = fake({outcome: 'finished'});
    expect(await finishJobRun({receiptId: RECEIPT.toUpperCase(), outcome: 'ran', result: {deleted: 1}}, options)).toEqual({outcome: 'finished'});
    expect(sent[0]).toMatchObject({name: 'finish_job_run', body: {p_receipt_id: RECEIPT, p_outcome: 'ran', p_result: {deleted: 1}}});
    for (const outcome of ['already_finished', 'not_found'] as const) expect(await finishJobRun({receiptId: RECEIPT, outcome: 'idle', result: {}}, fake({outcome}).options)).toEqual({outcome});
  });

  it('refuses a receipt, an outcome or a result a receipt cannot hold, before asking', async () => {
    const {fetch, options} = fake({});
    await expect(finishJobRun({receiptId: 'nope', outcome: 'ran', result: {}}, options)).rejects.toBeInstanceOf(TypeError);
    await expect(finishJobRun({receiptId: RECEIPT, outcome: 'done' as never, result: {}}, options)).rejects.toBeInstanceOf(TypeError);
    await expect(finishJobRun({receiptId: RECEIPT, outcome: 'ran', result: {address: 'someone@example.test'}}, options)).rejects.toBeInstanceOf(TypeError);
    await expect(finishJobRun({receiptId: RECEIPT, outcome: 'ran', result: [] as never}, options)).rejects.toBeInstanceOf(TypeError);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('treats an unknown answer as no answer, and throws when the database cannot be reached', async () => {
    await expect(finishJobRun({receiptId: RECEIPT, outcome: 'ran', result: {}}, fake({outcome: 'done'}).options)).rejects.toBeInstanceOf(AccountsUnavailableError);
    await expect(finishJobRun({receiptId: RECEIPT, outcome: 'ran', result: {}}, down)).rejects.toMatchObject({retryable: true});
  });
});

describe('lastJobRun', () => {
  const finished = {outcome: 'ran', attempt: 2, started_at: '2026-10-14T03:00:00.100+00:00', finished_at: '2026-10-14T03:00:01.200+00:00', result: {deleted: 3, kept: 0, locked: 0, remaining: 0}};

  it('reads the newest finished receipt of a task', async () => {
    const {sent, options} = fake(finished);
    expect(await lastJobRun('dormant-identity-purge', options)).toEqual({outcome: 'ran', attempt: 2, startedAt: finished.started_at, finishedAt: finished.finished_at, result: finished.result});
    expect(sent[0]).toMatchObject({name: 'last_job_run', body: {p_task: 'dormant-identity-purge'}});
  });

  it('answers null for a task that has never finished a run, and nothing else for an answer of nulls', async () => {
    expect(await lastJobRun('ledger-relay', fake({outcome: null, attempt: null, started_at: null, finished_at: null, result: null}).options)).toBeNull();
  });

  it.each([
    ['an outcome it does not know', {...finished, outcome: 'done'}],
    ['no attempt', {...finished, attempt: null}],
    ['no finish time', {...finished, finished_at: null}],
    ['a result a receipt could not hold', {...finished, result: {address: 'someone@example.test'}}],
    ['no outcome but other fields', {outcome: null, attempt: 1, started_at: null, finished_at: null, result: null}],
    ['text', 'ran'],
  ])('treats %s as no answer at all: never "has never run"', async (_name, answer) => {
    await expect(lastJobRun('ledger-relay', fake(answer).options)).rejects.toBeInstanceOf(AccountsUnavailableError);
  });

  it('refuses a task that is not shaped like one, and throws when the database cannot be reached', async () => {
    await expect(lastJobRun('Ledger Relay', fake({}).options)).rejects.toBeInstanceOf(TypeError);
    await expect(lastJobRun('ledger-relay', down)).rejects.toMatchObject({retryable: true});
  });
});

describe('purgeDormantIdentities', () => {
  it('purges at most 100 by default, and 1 to 500 when asked, and reads the four counts', async () => {
    expect([defaultPurgeLimit, maxPurgeLimit]).toEqual([100, 500]);
    const {sent, options} = fake({deleted: 4, kept: 2, locked: 1, remaining: 9});
    expect(await purgeDormantIdentities({}, options)).toEqual({deleted: 4, kept: 2, locked: 1, remaining: 9});
    expect(await purgeDormantIdentities(undefined, options)).toEqual({deleted: 4, kept: 2, locked: 1, remaining: 9});
    expect(await purgeDormantIdentities({limit: 500}, options)).toEqual({deleted: 4, kept: 2, locked: 1, remaining: 9});
    expect(sent.map((call) => [call.name, call.body])).toEqual([['purge_dormant_identities', {p_limit: 100}], ['purge_dormant_identities', {p_limit: 100}], ['purge_dormant_identities', {p_limit: 500}]]);
  });

  it('has no age parameter: 30 days is not a setting', async () => {
    const {sent, options} = fake({deleted: 0, kept: 0, locked: 0, remaining: 0});
    await purgeDormantIdentities({limit: 5, olderThanDays: 1, age: '1 day'} as never, options);
    expect(Object.keys(sent[0].body)).toEqual(['p_limit']);
  });

  it('refuses a limit out of range before asking', async () => {
    const {fetch, options} = fake({});
    for (const limit of [0, -1, 501, 1.5, Number.NaN, '5' as never]) await expect(purgeDormantIdentities({limit}, options), String(limit)).rejects.toBeInstanceOf(TypeError);
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([
    ['a count that is not a number', {deleted: '1', kept: 0, locked: 0, remaining: 0}],
    ['a negative count', {deleted: -1, kept: 0, locked: 0, remaining: 0}],
    ['a missing count', {deleted: 1, kept: 0, locked: 0}],
    ['more examined than asked for', {deleted: 3, kept: 2, locked: 1, remaining: 0}],
    ['text', 'purged'],
  ])('treats %s as no answer at all', async (_name, answer) => {
    await expect(purgeDormantIdentities({limit: 5}, fake(answer).options)).rejects.toBeInstanceOf(AccountsUnavailableError);
  });

  it('throws when the database cannot be reached: the batch is one transaction, so nothing is half done', async () => {
    await expect(purgeDormantIdentities({}, down)).rejects.toMatchObject({retryable: true, outcomeUnknown: true});
  });
});
