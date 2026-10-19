import {describe, expect, it, vi} from 'vitest';
import {AccountsUnavailableError} from '@/lib/accounts';
import {listUsage, maxUsageListed, recordUsageRefusal, setUsageLimit} from '@/lib/usage';

// The typed calls of the Usage functions (lib/usage.ts), against a fake fetch: what each sends (the Administrator's Account and epoch from the operation,
// the actor from the session, nothing a request chose), what each accepts as an answer, and that an answer that cannot be got, or makes no sense, is an
// error: no empty list, and no number invented.
const ADMIN = '7a1b2c3d-4e5f-4a6b-8c7d-0e1f2a3b4c5d';
const TARGET = '9d8c7b6a-5f4e-4d3c-8b2a-1f0e9d8c7b6a';
const OTHER = 'aa8c7b6a-5f4e-4d3c-8b2a-1f0e9d8c7b6b';
const COMMAND = '11111111-2222-4333-8444-555555555555';
const USER = '5f0d6c1e-8a52-4c1b-9d57-2b6a1f0e7c44';
const ACTOR = `user:${USER}`;
const env = {NEXT_PUBLIC_SUPABASE_URL: 'https://abcdefgh.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'service-key-for-tests-only'};
const operation = {accountId: ADMIN, epoch: 3};

type Sent = {name: string; body: Record<string, unknown>; headers: Record<string, string>};
function fake(answer: unknown, status = 200) {
  const sent: Sent[] = [];
  const fetch = vi.fn(async (input: string, init?: RequestInit) => {
    sent.push({name: input.split('/rpc/')[1], body: JSON.parse(String(init?.body)), headers: init?.headers as Record<string, string>});
    return new Response(JSON.stringify(answer), {status, headers: {'content-type': 'application/json'}});
  });
  return {fetch, sent, options: {env, fetch}};
}

const usageRow = {
  account_id: TARGET,
  email: 'dana@example.com',
  role: 'member',
  status: 'active',
  seq: 2,
  month_start: '2026-10-01',
  limit_microdollars: 40_000_000,
  settled_microdollars: 10_000_000,
  reserved_microdollars: 2_000_000,
  cause: 'change',
};

describe('listUsage', () => {
  it('asks for the Administrator\'s Account and epoch, as the service role, and reads each Account\'s current period', async () => {
    const {sent, options} = fake({outcome: 'listed', accounts: [usageRow]});
    expect(await listUsage(operation, options)).toEqual({
      outcome: 'listed',
      rows: [{accountId: TARGET, email: 'dana@example.com', role: 'member', status: 'active', seq: 2, monthStart: '2026-10-01', limit: 40_000_000, settled: 10_000_000, reserved: 2_000_000, cause: 'change'}],
    });
    expect(sent).toEqual([expect.objectContaining({name: 'list_usage', body: {p_admin_account_id: ADMIN, p_epoch: 3}})]);
    expect(sent[0].headers).toMatchObject({authorization: 'Bearer service-key-for-tests-only', 'content-profile': 'api'});
  });

  it('reads an Account whose address Auth no longer vouches for, and an empty list', async () => {
    const listed = await listUsage(operation, fake({outcome: 'listed', accounts: [{...usageRow, email: null}]}).options);
    expect(listed).toMatchObject({rows: [{email: null}]});
    expect(await listUsage(operation, fake({outcome: 'listed', accounts: []}).options)).toEqual({outcome: 'listed', rows: []});
  });

  it('answers denied, with no rows, when the database does', async () => {
    expect(await listUsage(operation, fake({outcome: 'denied', accounts: null}).options)).toEqual({outcome: 'denied'});
  });

  it('refuses an operation that is not shaped like one, before asking', async () => {
    const {fetch, options} = fake({});
    await expect(listUsage({accountId: 'not-an-id', epoch: 1}, options)).rejects.toBeInstanceOf(TypeError);
    await expect(listUsage({accountId: ADMIN, epoch: 0}, options)).rejects.toBeInstanceOf(TypeError);
    await expect(listUsage({accountId: ADMIN, epoch: 1.5}, options)).rejects.toBeInstanceOf(TypeError);
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([
    ['a body that is not an object', []],
    ['an outcome it does not know', {outcome: 'maybe', accounts: []}],
    ['no accounts', {outcome: 'listed'}],
    ['accounts that are not a list', {outcome: 'listed', accounts: {}}],
    ['more Accounts than a list carries', {outcome: 'listed', accounts: Array.from({length: maxUsageListed + 1}, (_unused, index) => ({...usageRow, account_id: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`}))}],
    ['the same Account twice', {outcome: 'listed', accounts: [usageRow, usageRow]}],
    ['a row with a bad ID', {outcome: 'listed', accounts: [{...usageRow, account_id: 'nope'}]}],
    ['a row with no ID', {outcome: 'listed', accounts: [{...usageRow, account_id: null}]}],
    ['a role it does not know', {outcome: 'listed', accounts: [{...usageRow, role: 'owner'}]}],
    ['a status it does not know', {outcome: 'listed', accounts: [{...usageRow, status: 'paused'}]}],
    ['a cause it does not know', {outcome: 'listed', accounts: [{...usageRow, cause: 'refund'}]}],
    ['a seq of 0', {outcome: 'listed', accounts: [{...usageRow, seq: 0}]}],
    ['a month that is not the first', {outcome: 'listed', accounts: [{...usageRow, month_start: '2026-10-02'}]}],
    ['a month in the wrong shape', {outcome: 'listed', accounts: [{...usageRow, month_start: '2026-10'}]}],
    ['an email that is not text', {outcome: 'listed', accounts: [{...usageRow, email: 7}]}],
    ['a limit that is a float', {outcome: 'listed', accounts: [{...usageRow, limit_microdollars: 25_000_000.5}]}],
    ['a limit that is not whole cents', {outcome: 'listed', accounts: [{...usageRow, limit_microdollars: 25_000_001}]}],
    ['a limit over the ceiling', {outcome: 'listed', accounts: [{...usageRow, limit_microdollars: 10_000_010_000}]}],
    ['a negative limit', {outcome: 'listed', accounts: [{...usageRow, limit_microdollars: -10_000}]}],
    ['a limit that is text', {outcome: 'listed', accounts: [{...usageRow, limit_microdollars: '25000000'}]}],
    ['a negative settled amount', {outcome: 'listed', accounts: [{...usageRow, settled_microdollars: -1}]}],
    ['a reserved amount that is a float', {outcome: 'listed', accounts: [{...usageRow, reserved_microdollars: 0.5}]}],
    ['a reserved amount that is not a safe integer', {outcome: 'listed', accounts: [{...usageRow, reserved_microdollars: 2 ** 60}]}],
    ['a settled amount that is missing', {outcome: 'listed', accounts: [{...usageRow, settled_microdollars: undefined}]}],
  ])('treats %s as no answer at all', async (_name, answer) => {
    await expect(listUsage(operation, fake(answer).options)).rejects.toBeInstanceOf(AccountsUnavailableError);
  });

  it('throws, and does not return an empty list, when the database cannot be reached or refuses', async () => {
    await expect(listUsage(operation, {env, fetch: async () => { throw new TypeError('fetch failed'); }})).rejects.toMatchObject({name: 'AccountsUnavailableError', retryable: true, outcomeUnknown: true});
    await expect(listUsage(operation, fake({message: 'no'}, 503).options)).rejects.toMatchObject({retryable: true});
    await expect(listUsage(operation, fake({code: '42501'}, 401).options)).rejects.toMatchObject({retryable: false, code: '42501'});
  });
});

describe('setUsageLimit', () => {
  const change = {actor: ACTOR, targetAccountId: TARGET, commandId: COMMAND, kind: 'change' as const, limit: 40_000_000, expectedSeq: 1};
  const reset = {actor: ACTOR, targetAccountId: TARGET, commandId: COMMAND, kind: 'reset' as const, limit: null, expectedSeq: 1};
  const period = (over: Record<string, unknown> = {}) => ({period_id: OTHER, seq: 2, month_start: '2026-10-01', limit_microdollars: 40_000_000, previous_limit_microdollars: 25_000_000, cause: 'change', ...over});

  it('sends the actor, the Administrator\'s Account and epoch from the operation, the target, the command ID, the kind, the limit and the period the person saw', async () => {
    const {sent, options} = fake({outcome: 'changed', ...period()});
    const receipt = await setUsageLimit(operation, change, options);
    expect(receipt).toEqual({outcome: 'changed', period: {seq: 2, monthStart: '2026-10-01', limit: 40_000_000, previousLimit: 25_000_000, cause: 'change'}});
    expect(sent).toEqual([
      expect.objectContaining({
        name: 'set_usage_limit',
        body: {
          p_actor: ACTOR,
          p_admin_account_id: ADMIN,
          p_epoch: 3,
          p_target_account_id: TARGET,
          p_command_id: COMMAND,
          p_kind: 'change',
          p_limit_microdollars: 40_000_000,
          p_expected_seq: 1,
        },
      }),
    ]);
  });

  it('sends a reset with no limit and reads the period it made', async () => {
    const {sent, options} = fake({outcome: 'reset', ...period({limit_microdollars: 25_000_000, cause: 'reset'})});
    expect(await setUsageLimit(operation, reset, options)).toEqual({outcome: 'reset', period: {seq: 2, monthStart: '2026-10-01', limit: 25_000_000, previousLimit: 25_000_000, cause: 'reset'}});
    expect(sent[0].body).toMatchObject({p_kind: 'reset', p_limit_microdollars: null});
  });

  it.each(['replayed', 'unchanged', 'stale'] as const)('reads the period that %s carries', async (outcome) => {
    const receipt = await setUsageLimit(operation, change, fake({outcome, ...period({seq: 7, previous_limit_microdollars: null, cause: 'initial'})}).options);
    expect(receipt).toEqual({outcome, period: {seq: 7, monthStart: '2026-10-01', limit: 40_000_000, previousLimit: null, cause: 'initial'}});
  });

  it.each(['reused', 'invalid_limit', 'disabled', 'not_found', 'denied'] as const)('reads %s as that and nothing more', async (outcome) => {
    expect(await setUsageLimit(operation, change, fake({outcome, period_id: null, seq: null, month_start: null, limit_microdollars: null, previous_limit_microdollars: null, cause: null}).options)).toEqual({outcome});
  });

  it('refuses what is not a command before asking: an actor that is not a user, a kind it does not know, a period that is not one, a limit that is not a whole number or is given to a reset', async () => {
    const {fetch, options} = fake({});
    const bad: unknown[] = [
      {...change, actor: 'seed'},
      {...change, actor: `user:${USER}:x`},
      {...change, actor: ''},
      {...change, kind: 'delete'},
      {...change, expectedSeq: 0},
      {...change, expectedSeq: 1.5},
      {...change, limit: null},
      {...change, limit: 0.5},
      {...change, limit: Number.NaN},
      {...reset, limit: 0},
      {...reset, limit: 40_000_000},
      {...change, targetAccountId: 'not-an-id'},
      {...change, commandId: 'not-an-id'},
    ];
    for (const input of bad) await expect(setUsageLimit(operation, input as typeof change, options)).rejects.toBeInstanceOf(TypeError);
    await expect(setUsageLimit({accountId: 'not-an-id', epoch: 1}, change, options)).rejects.toBeInstanceOf(TypeError);
    await expect(setUsageLimit({accountId: ADMIN, epoch: 0}, change, options)).rejects.toBeInstanceOf(TypeError);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('passes a limit the database will refuse (not whole cents, negative, over the ceiling) on to it, which answers invalid_limit', async () => {
    for (const limit of [12_345, -10_000, 10_000_010_000]) {
      const {sent, options} = fake({outcome: 'invalid_limit'});
      expect(await setUsageLimit(operation, {...change, limit}, options)).toEqual({outcome: 'invalid_limit'});
      expect(sent[0].body.p_limit_microdollars).toBe(limit);
    }
  });

  it.each([
    ['a body that is not an object', []],
    ['an outcome it does not know', {outcome: 'maybe'}],
    ['a change with no period', {outcome: 'changed'}],
    ['a change that is not the next period of the one the person saw', {outcome: 'changed', ...period({seq: 5})}],
    ['a change whose period is not a change', {outcome: 'changed', ...period({cause: 'reset'})}],
    ['a reset whose period is not a reset', {outcome: 'reset', ...period({cause: 'change'})}],
    ['a period with a bad month', {outcome: 'changed', ...period({month_start: '2026-10-05'})}],
    ['a period with a limit that is not whole cents', {outcome: 'changed', ...period({limit_microdollars: 40_000_001})}],
    ['a period with a previous limit that is not a limit', {outcome: 'changed', ...period({previous_limit_microdollars: -5})}],
    ['a period with a cause it does not know', {outcome: 'replayed', ...period({cause: 'refund'})}],
  ])('treats %s as no answer at all', async (_name, answer) => {
    await expect(setUsageLimit(operation, change, fake(answer).options)).rejects.toBeInstanceOf(AccountsUnavailableError);
  });

  it('throws, so the caller can tell the person to check, when the database cannot be reached: the command may have been made', async () => {
    await expect(setUsageLimit(operation, change, {env, fetch: async () => { throw new TypeError('fetch failed'); }})).rejects.toMatchObject({name: 'AccountsUnavailableError', retryable: true, outcomeUnknown: true});
    await expect(setUsageLimit(operation, change, fake({message: 'no'}, 503).options)).rejects.toMatchObject({retryable: true, outcomeUnknown: true});
    await expect(setUsageLimit(operation, change, fake({code: '22023'}, 400).options)).rejects.toMatchObject({retryable: false, outcomeUnknown: false});
  });
});

describe('recordUsageRefusal', () => {
  it.each(['usage.limit_refused', 'usage.denied'] as const)('records %s for the user, naming the Account when there is one', async (action) => {
    const {sent, options} = fake({outcome: 'recorded'});
    expect(await recordUsageRefusal({userId: USER, action, accountId: TARGET}, options)).toBe('recorded');
    expect(sent[0]).toMatchObject({name: 'record_usage_refusal', body: {p_user_id: USER, p_action: action, p_target_account_id: TARGET}});
    const none = fake({outcome: 'repeated'});
    expect(await recordUsageRefusal({userId: USER, action}, none.options)).toBe('repeated');
    expect(none.sent[0].body.p_target_account_id).toBeNull();
  });

  it('sends nothing but the user, the action and the Account: no limit, no amount, no reason', async () => {
    const {sent, options} = fake({outcome: 'recorded'});
    await recordUsageRefusal({userId: USER, action: 'usage.limit_refused', accountId: TARGET}, options);
    expect(Object.keys(sent[0].body).sort()).toEqual(['p_action', 'p_target_account_id', 'p_user_id']);
  });

  it('refuses an action it does not know and an ID that is not one, before asking, and reads nothing but recorded or repeated', async () => {
    const {fetch, options} = fake({outcome: 'recorded'});
    await expect(recordUsageRefusal({userId: USER, action: 'account.denied' as 'usage.denied'}, options)).rejects.toBeInstanceOf(TypeError);
    await expect(recordUsageRefusal({userId: 'nope', action: 'usage.denied'}, options)).rejects.toBeInstanceOf(TypeError);
    await expect(recordUsageRefusal({userId: USER, action: 'usage.denied', accountId: 'nope'}, options)).rejects.toBeInstanceOf(TypeError);
    expect(fetch).not.toHaveBeenCalled();
    await expect(recordUsageRefusal({userId: USER, action: 'usage.denied'}, fake({outcome: 'maybe'}).options)).rejects.toBeInstanceOf(AccountsUnavailableError);
  });
});
