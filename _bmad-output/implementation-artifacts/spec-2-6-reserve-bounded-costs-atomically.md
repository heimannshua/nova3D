---
title: 'Story 2.6: Reserve bounded costs atomically'
type: 'feature'
created: '2026-10-20'
status: 'done'
baseline_commit: 'b9abf33fdca0d57c68d0ba2228ea599bde8449d1'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-2-context.md'
  - '{project-root}/_bmad-output/specs/spec-nova3D-story-2-6/acceptance-criteria.md'
  - '{project-root}/_bmad-output/specs/spec-nova3D-story-2-6/implementation-constraints.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-2-4-set-accountable-usage-limits.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-2-11-create-durable-job-attempt-step-and-operation-identities.md'
  - '{project-root}/docs/authority-contract.md'
  - '{project-root}/_bmad-output/planning-artifacts/architecture/architecture-nova3D-2026-09-14/ARCHITECTURE-SPINE.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Nothing bounds what paid work may cost. Settled and reserved amounts are a stand-in (Story 2.4), no rate is recorded and no external operation is reserved, so concurrent work could overspend, a duplicate could reserve twice, and an overrun or an uncertain charge has nowhere to be recorded. Stories 2.5, 2.7, 2.8 and 2.14 all build on the calculator, the ledgers and the admission.

**Approach:** On the existing closed `usage` schema: immutable versioned rate schedules (fixture rates only), one checked integer/rational calculator in SQL, and an append-only reservation and settlement ledger keyed to Story 2.11's external operations, behind three `api` commands (`quote_cost`, `reserve_cost`, `settle_cost`). Real figures replace `usage.fixture_figures`. A typed server-side module wraps the commands. There is no screen, provider adapter, dispatch or worker.

## Boundaries & Constraints

**Always:** Consult `node_modules/next/dist/docs/` before any Next.js code (AGENTS.md); none is expected. No new npm dependency, environment variable, secret, route, Server Action, page or `lib/i18n` copy. New migration `20261024120000_usage_reservations.sql`, additive except that it drops `usage.fixture_figures` and replaces `usage.period_figures` and `api.preflight`. Money is integer USD microdollars (`bigint` in SQL, a safe integer in TypeScript, at most 1e15), never a float; every intermediate is exact `numeric`. **Recorded constants** (changeable only by a recorded decision): 2,000 tokens of overhead, 5,000 tokens per image, a 10% margin; admission ceilings of 200,000 input tokens (applied to the raised bound), 16,000 output tokens and 20 requests; an operation cap of 1,000,000 and a Job cap of 5,000,000 microdollars; a 24-hour ambiguity deadline. They live in SQL (`usage.*` constant functions) and are mirrored in the module, with a test that the two are equal. **Tables** on `usage` (closed already; ids `uuid`, times `clock_timestamp()` UTC, every Account-owned row carries `account_id`, ownership by composite foreign keys, `restrict`): `usage.rate_schedules` (global, not Account-owned: `id`, `provider` and `model` words, `version` from 1, `api_version` printable ASCII without spaces, `currency` three capitals, `input`, `output` and `request` rates each as a numerator and a denominator of microdollars per unit (numerator 0 to 1e12, denominator 1 to 1e12), `input_increment` and `output_increment` (billing increments in tokens, 1 to 1,000,000), a geography multiplier as numerator and denominator (at least 1), `created_at`; unique `(provider, model, version)`; written by no `api` function or application code, so a real environment has none until Story 2.5 adds the writer; tests insert as owner); `usage.reservations` (`id`, `account_id`, `period_id` to `usage.periods`, `job_id` to `jobs.jobs`, `operation_id` to `jobs.operations`, unique, `rate_schedule_id`, `provider`, `requested_model`, `api_version`, the three calculator inputs `request_bytes`, `image_count`, `output_limit`, `input_bound`, `reserved_microdollars` 1 to 1e15, `digest`, `created_at`; a trigger requires the operation to belong to the Job and provider, model and API version to equal the schedule's); `usage.settlements` (`id`, `account_id`, `reservation_id` unique, `period_id`, `classification` `evidence|deadline|noncharge|unused`, `settled_microdollars` 0 to 1e15, `released_microdollars` equal to the reservation's whole amount, `input_tokens`, `output_tokens` and `returned_model` for `evidence` only, `digest`, `created_at`; `deadline` settles exactly the reserved amount, `noncharge` and `unused` settle 0; over by `settled - released`); `usage.overrun_incidents` (`id`, `account_id`, `reservation_id` and `settlement_id` unique, `provider`, `reserved_microdollars`, `evidence_microdollars` above it, `created_at`, `cleared_at` and `cleared_by` null together or set together, set once, no other column ever changes; written only by `settle_cost`; no function here clears one, which is Story 2.8's); `usage.commands` (`account_id`, `command_id`, `kind` `reserve|settle`, `digest`, `subject_id`, `created_at`; primary key `(account_id, command_id)`). Schedules, reservations, settlements and commands refuse update and truncate (an incident refuses everything but its one clearing); delete stays allowed (Epic 8 purge). The migration adds the unique keys `usage.periods (id, account_id)` and `jobs.operations (id, account_id)` (additive; no Jobs function or row changes). **The calculator** (one SQL implementation: `usage.input_bound` and `usage.price`, used by quote, reserve and settle alike): input bound = `ceil((request_bytes + 2000 + 5000 * images) * 11 / 10)`; billed units are rounded up to each increment; price = `ceil(((input units x input rate) + (output units x output rate) + (requests x request rate)) x multiplier)` computed over a common denominator in integers and rounded up ONCE per operation; the result above 1e15 is `overflow`, and one that prices nothing is `unpriced`. A quote refuses with `unavailable_bound` and a reason: `unknown_rate` (no such schedule), `foreign_rate` (the schedule's provider, model or API version differ from those given), `foreign_currency` (not `USD`), `unsupported_option` (a key in the options object: no option is supported, among them cache, batch, server tools, fallbacks, speed and streaming, and the first key is named in `detail`), `over_input_ceiling`, `over_output_ceiling`, `over_request_ceiling`, `overflow`, `unpriced`. An operation is exactly one provider request: `reserve_cost` always prices one. **Figures:** `usage.period_figures(period)` keeps its signature and returns signed deltas from the ledger: reserved = reservations made in the period minus `released_microdollars` of settlements made in the period (negative when it releases a reservation of an earlier period, which the successor period's carry still counts); settled = `settled_microdollars` of settlements made in the period. The shown figures, the reconcile identity and `isMicrodollars` stay as in 2.4. **The Job exposure** (`usage.job_exposure(job)`) is, over every reservation of the Job across all attempts, the settled amount where settled and the reserved amount where not (an ambiguous or dispatched charge holds its reservation). **Commands** (`security definer`, `set search_path = ''`, `grant execute` to `service_role` only, composite outcome types named so they clash with nothing). `api.quote_cost(p_account_id, p_epoch, p_rate_schedule_id, p_provider, p_model, p_api_version, p_request_bytes, p_image_count, p_output_limit, p_request_count default 1, p_options default '{}')`: arguments (22023), authority (`denied`), then the calculator: `quoted` carrying the input bound, billed units and microdollars, or `unavailable_bound`; read-only, takes no lock. `api.reserve_cost(p_account_id, p_epoch, p_command_id, p_operation_id, p_rate_schedule_id, p_provider, p_model, p_api_version, p_request_bytes, p_image_count, p_output_limit, p_options default '{}')` runs in this order: arguments (22023); `identity.assert_operation_authority` in `begin/exception when sqlstate 'N3010'` (`denied`); advisory lock `nova3d:usage-command:<account>:<command>`; the operation belongs to the Account and its Project row is held `FOR SHARE` through `jobs.hold_project`, live and without a tombstone (`unavailable`, one answer for foreign, deleted, unknown and tombstoned); advisory lock `nova3d:usage:<account>` (the lock Story 2.4 reserved) and `usage.ensure_period` (the month turns when work is first asked for); the receipt by `(account, command_id)`: the same digest replays (`replayed`, the original reservation), another is `reused`; the operation already holds a reservation under another command ID: the same digest replays and is recorded, another is `already_reserved` carrying it, nothing written; the operation is not `planned` (`not_reservable`, carrying its state); the calculator (`unavailable_bound`); a provider with an uncleared incident (`provider_blocked`, for every Account); `reserved > 1,000,000` (`over_operation_cap`); Job exposure plus reserved above 5,000,000 (`over_job_cap`); reserved above `usage.available_microdollars` (`insufficient_allowance`); otherwise one reservation in the current period and a receipt (`reserved`). Every refusal carries the exact cost block: `requested`, the cap or limit, what is used and what is available, and nothing is written. `api.settle_cost(p_account_id, p_command_id, p_operation_id, p_classification, p_input_tokens default null, p_output_tokens default null, p_returned_model default null)` is an internal-style command with NO Account epoch, Account status or Project check (settling records what already happened or releases what never went out; refusing it for a disabled, stale or tombstoned Account would strand the money): arguments (22023, including evidence fields given for any other class or missing for `evidence`); the command lock; the operation belongs to the Account (`unavailable`); the usage lock and `ensure_period`; the receipt (`replayed|reused`); no reservation (`not_reserved`); already settled: the same classification and evidence replays and is recorded, another is `already_settled` carrying the settlement; the operation's state does not fit the class (`not_settleable`, carrying it): `evidence` needs `completed|ambiguous|settled`, `deadline` needs `ambiguous|settled`, `noncharge` needs `noncharge`, `unused` needs `abandoned`; `deadline` before `outcome_at` plus 24 hours (`not_due`, carrying the due time); `evidence` priced by the calculator at the pinned schedule (`invalid_evidence` with a reason when it overflows); then one settlement in the current period, and when the evidence exceeds the reservation also one incident, in the same transaction (`settled`). Evidence above a reservation settles at the evidence, counts against the period and the Job cap, and blocks that provider for everyone until Story 2.8 clears it. **Replays and gates run before state checks**, so a lost answer always replays. `api.preflight` is re-created from `job_records.sql:1173` keeping every earlier statement but the `usage.fixture_figures` probe, with a Story 2.6 block (the five tables, the constant functions and the three signatures: 50 in all) raising `N3020`; end with `notify pgrst, 'reload schema'`. **`lib/usage-reservations.ts`**: the only caller of the three functions (add it to the four `callApi`/`callRow` allow-lists on purpose), typed with outcome unions validated by `oneOf` and `unexpected()` as `lib/usage.ts`, exporting the constants, the classification and refusal vocabularies and the cost block shape; it imports only `@/lib/accounts`, `@/lib/authority` and `@/lib/usage-view`, has no caller yet (pinned as `lib/job-records.ts` is) and no word `tombstone` in code.

**Ask First:** A credit or funding-split column (Story 2.14); a Job-level reservation; a screen, route, notification or `lib/i18n` copy; writing a rate schedule from application code; changing any recorded constant; a block of one Account instead of the provider; making dispatch require a reservation or editing a Jobs function; registering a canceller or releasing a reservation on cancellation; any audit event; any step against staging, production, Railway, GHCR or Backblaze.

**Never:** Provider adapters, permissions, disclosure and picture derivatives (2.5); dispatch, outbox, workers, leases, signing and the cancel and disable path (2.7); the reconciliation process, the deadline sweep, listing and clearing incidents and alarms (2.8); credit, freezes and payments (2.14 to 2.17); editing a finished row; a float or a rounding anywhere but the one round-up; reserving for a second operation more than once; settling twice; keeping `usage.fixture_figures`; any amount, rate or request in a result a foreign Account can read; changing the Account disable or its cancellation; editing an expectation to make a test pass except the pins this spec names.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Input bound | 10,000 bytes, 2 images | `ceil((10000 + 2000 + 10000) x 11 / 10)` = 24,200 tokens; none, one and many images; a result equal to the ceiling passes, one above is refused | N/A |
| One round-up | Rational rates with increments, e.g. 3/7 per unit | The sum is exact and rounded up once to microdollars; never twice | N/A |
| Unavailable bound | Unknown or foreign schedule, foreign currency, any option key, a bound, output or request count over its ceiling, overflow, nothing priced | `unavailable_bound` with the reason (and the option key); nothing written | Fix the call |
| Reserve | A new command for a `planned` operation in range | One reservation: pins, the inputs, the period and the amount; `reserved`; period reserved up by the amount, available down by it, identity holds | N/A |
| Replay / reuse | The same command ID again / with another payload; another ID for the same operation with the same / another payload | `replayed`, one reservation / `reused`; `replayed` recorded / `already_reserved`; nothing duplicated | N/A |
| Not reservable | The operation is `dispatched`, `completed`, `ambiguous`, `noncharge`, `settled` or `abandoned` | `not_reservable` carrying the state; nothing written; an existing reservation still replays | N/A |
| Operation cap | A bound above $1 | `over_operation_cap` with the cost block; nothing written | Lower the output |
| Job cap | Exposure across attempts plus this one above $5, including a held ambiguous reservation, a settled amount and an overrun | `over_job_cap`; a later attempt's reservation counts the earlier attempts | N/A |
| Allowance | Bound above what is available; exactly equal; limit 0 | `insufficient_allowance` with the cost block / `reserved` / refused; running reservations untouched | Raise the limit |
| Provider blocked | An uncleared incident for the provider; cleared; another provider | `provider_blocked` for every Account / admits again / unaffected | N/A |
| Precedence | Several refusals at once | bound, then provider, then operation cap, then Job cap, then allowance | N/A |
| Settle evidence | Operation `completed` or `ambiguous`; evidence below, equal to and above the reservation | Settled at the evidence priced by the calculator; the unused part is released; above it: `settled` with an incident and over amount | N/A |
| Settle by class | `deadline` at 23h59 and at 24h; `noncharge`; `unused`; each with a wrong operation state | `not_due` with the due time / settled at the reservation / settled 0 and the headroom back / `not_settleable` carrying the state | Wait, reconcile |
| Settle replay | The same command again; another ID with the same class; another class or evidence | `replayed` / `replayed`, recorded / `already_settled`; one settlement | N/A |
| Authority | Reserve with a stale epoch, a disabled or tombstoned Account / settle for a disabled Account | `denied`, nothing written / settles | N/A |
| Hidden | A foreign, unknown, deleted or tombstoned Project's, or a foreign Account's operation | `unavailable` for reserve; `unavailable` for a foreign settle; nothing written, nothing revealed | N/A |
| Periods | Reserve in one UTC month, roll over, settle in the next; a change and a reset in between | The successor carries the reservation; the settlement shows as negative reserved and positive settled; settled + reserved + available = limit, or limit + over = used, throughout | N/A |
| Concurrency | n identical reserves; n reserves near the limit and near the Job cap; a reserve against a limit change, a settle and a tombstone | One reservation; settled + reserved never exceeds any limit and exactly the ones that fit succeed; a tombstone never lets a reservation land after it | N/A |
| Fixture retired | The migration is applied | `usage.fixture_figures` is gone; `api.list_usage` figures come from the ledger; no fixture row exists | N/A |
| Immutability | Update or truncate a schedule, reservation, settlement, command or incident (but one clearing); change an identity column | Refused; delete (purge) allowed | N/A |
| Invalid arguments | Bad ID, negative or fractional size, option not an object, bad class, evidence out of place | 22023 raised; nothing written | Fix the call |
| Closure | Browser roles or `nova3d_gateway` against the new tables and functions | No privilege on any | N/A |

</frozen-after-approval>

## Code Map

- `supabase/migrations/20261024120000_usage_reservations.sql` -- new. `usage.periods` `usage_limits.sql:72-107` (add unique `(id, account_id)`), triggers `:113-148`, the stand-in `usage.fixture_figures` `:154-161` and `usage.period_figures` `:268-276` (same signature, `returns table(settled_microdollars, reserved_microdollars)`, stable; callers `ensure_period` `:322`, `available_microdollars` `:346`, `set_usage_limit` `:507`, `list_usage` `:590`), `usage.command_digest` `:206-213`, `usage.ensure_period` `:288-329` (the lock `nova3d:usage:<account>` and the carry), `usage.available_microdollars` `:336-349` (takes no lock: the reserver must), composite types `:382-390`, `api.set_usage_limit` `:392-532` (the command order to mirror; lock at `:441`). Jobs side `job_records.sql`: `jobs.jobs` unique `(id, account_id)` `:83`; `jobs.operations` `:258-281` (no `(id, account_id)` key and no `job_id`: add the key, reach the Job through steps and attempts as `api.advance_operation` does `:742-747`); `jobs.hold_project` `:438-452`, `jobs.command_digest` `:459-468`, `jobs.record_command` `:474-481` to mirror or call; `outcome_at` `:309-337` (the 24-hour deadline counts from it). `api.preflight` latest at `job_records.sql:1173` (47 signatures; the `usage.fixture_figures` probe at `:1212` goes). Names taken: `usage.command_digest`, `api.usage_limit_change`, `api.usage_list`. End with `notify pgrst, 'reload schema'`.
- `lib/usage-reservations.ts` -- new; follow `lib/job-records.ts` and `lib/usage.ts` (`requireOperation` `:31`, `rowOf` `:37`) with `callRow`, `oneOf`, `requireUuid`, `unexpected` from `lib/accounts.ts:324,383,386,394,400` and `isMicrodollars` `lib/usage-view.ts:33`. `lib/usage.ts` and `lib/usage-view.ts` stay as they are. `lib/authority.ts:106-135` (`registerCanceller`) is left alone: nothing registers a canceller here.
- Pins to change on purpose (47 to 50): `toHaveLength(47)` at `alarms.test.ts:904`, `request-revisions.test.ts:1370`, `picture-sets.test.ts:1691`, `file-gateway-db.test.ts:1776`, `usage-limits.test.ts:1644`, `job-records.test.ts:2162` (`gate-structure.test.ts:4021` pins the 2.11 migration's own text: leave it, add a 2.6 block like `:4007-4033`). The `usage.fixture_figures` entries must go and the new tables come in at `usage-limits.test.ts:1634,1676,1681`, `job-records.test.ts:2199`, `file-gateway-db.test.ts:1842,1884`, `account-administration.test.ts:966`, `session-grants.test.ts:1202`, `scheduled-jobs.test.ts:1158`, `isolation.test.ts:824`. `usage-limits.test.ts` exact two tables `:170-189`, function list `:233-246`, helper `figures()` `:87`, truncate `:332`. `isolation.test.ts` `bodiesAgainst` `:135` (a body per new `api` function, equality `:241-243`); `accounts.test.ts` sorted `apiFunctions` `:53-124` (equality `:181`); `file-gateway-db.test.ts` refused reads `:402-412`. `gate-structure.test.ts` allow-lists `:1037,:2268,:2592,:2965`, the no-caller pin (~`:3750`), the `fixture_figures` ban in `lib app scripts workers` `:3555`, the 2.4 docs needles (`:3692-3699`: keep 'forty-one', 'Story 2.6', 'carried' or change on purpose); routes stay seven. `docs/staging.md:80-81` migration row (`staging-guide.test.ts`).
- Fixtures to replace: every `usage.fixture_figures` writer (`usage-limits.test.ts:87,95-115,332`, `tests/e2e/usage.spec.ts:14,125` `setFigures`) becomes one shared helper, `tests/support/usage-ledger.ts`, that makes real rows as owner (a Job, attempt, step and operation, then a reservation and a settlement of the wanted amounts, bypassing admission). Cleanup order, ledger first: incidents, settlements, reservations, `usage.commands`, then the `jobs` family, then periods: `tests/support/accounts-data.ts:112-118`, `tests/support/forged-session.ts:335-341`, `scripts/seed-projects.mjs:98-104`; `tombstones.test.ts:597,1437` delete periods by hand.
- Tests to copy: `tests/integration/usage-limits.test.ts` (rollover by `replacePeriods()` `:95-115`, two-connection concurrency `:1443-1490`, lock wait `:1535-1553`, `createHarness` `tests/support/accounts-db.ts:29`), `job-records.test.ts` (commands, hidden, tombstone race, typed calls), `tests/unit/job-records.test.ts` (module).
- Docs: `docs/authority-contract.md` Usage section `:180-214` (the stand-in text `:196` and the forward reference `:268` change; add Reservations and settlements); `README.md` Usage row `:57`; `docs/provisioning.md:28,127` already state the $1 and $5 ceilings.
- Left for others: 2.5 adds the schedule writer, adapters and permission matching inside this admission; 2.7 reserves a Job's planned operations when it accepts it (so a running Job finishes under a reached limit), makes dispatch need a reservation, and builds the cancel and disable path with an authority-free move (a cancelled never-dispatched operation is settled `unused`); 2.8 reconciles, sweeps the 24-hour deadline, lists and clears incidents; 2.14 adds the funding split; Epic 8 de-links settlements, reservations and incidents from Project, Job and operation (the foreign keys restrict today) while keeping amounts, provider and period.

## Tasks & Acceptance

**Execution:**
- [x] `supabase/migrations/20261024120000_usage_reservations.sql`, `docs/staging.md` -- the unique keys, schedules, reservations, settlements, incidents, commands, guards, the calculator and constants, the exposure, the new figures and the drop of the fixture table, three commands, preflight, migration row -- AC-1 to AC-4
- [x] `lib/usage-reservations.ts` -- typed calls, constants, vocabularies, the cost block -- AC-1 to AC-4
- [x] `tests/` -- every matrix row: integration (the calculator against hand-computed values, each refusal and its precedence, reserve, replay, reuse, duplicate, not reservable, caps, allowance at the edge, provider block and clearing as owner, settle by every class, overrun, deadline, periods with rollover, change and reset, authority, hidden, concurrency including a tombstone, immutability, invalid arguments, closure, fixture retired, preflight), unit (the module: validation, every outcome, shape errors, constants equal the SQL); the shared ledger helper; update the pins above -- all ACs
- [x] `tests/support/accounts-data.ts`, `tests/support/forged-session.ts`, `scripts/seed-projects.mjs` -- delete the ledger rows first -- housekeeping
- [x] `README.md`, `docs/authority-contract.md` -- the Usage row, the calculator, the ledgers, the admission order, the settle rules, rollout -- housekeeping
- [x] `_bmad-output/implementation-artifacts/deferred-work.md` -- the up-front reservation of a Job's operations and dispatch needing one (2.7), the credit funding split (2.14), clearing and listing incidents and the deadline sweep (2.8), schedule writer and real rates (2.5), de-link on purge (Epic 8), the global provider block -- housekeeping

**Acceptance Criteria:**
- Given concurrent operations near the Account allowance, the $5 Job cap or the $1 operation cap, when their maximum costs are reserved, then settled usage plus all outstanding reservations never exceeds any limit and exactly the ones that fit succeed, and a duplicate admission returns its original receipt.
- Given pinned increments and rational rates, when the calculator evaluates a bounded request, then it rounds up once per operation to microdollars and rejects overflow, unknown and foreign rates and every unsupported option.
- Given an unavailable bound or an insufficient allowance, when admission is attempted, then nothing is written, no external side effect can follow, and the refusal carries the exact cost block.
- Given a request with text and images, when the input bound is derived, then it is the byte length plus 2,000 plus 5,000 per image, raised by 10%, and usage evidence above the reservation settles at the evidence, counts against the period and the Job cap, and blocks that provider until cleared.

## Spec Change Log

## Design Notes

A reservation is the enforceable upper bound of one external operation, held in the Account's period and the Job's lifetime until it is settled, so every limit is checked against the same two sums under one lock. Settlement never needs the Account's authority: it records what happened. The new figures are signed deltas, so a reservation made in one month and settled in the next leaves the successor's carry correct without rewriting any row.

```
limit 25M, reserve 1M (period 1)  -> reserved 1M, available 24M
month turns                       -> period 2 carries reserved 1M
settle 400k (period 2)            -> period 2 reserved -1M (shown 0), settled +400k (shown 400k), available 24.6M
```

## Verification

**Commands:**
- `npm run typecheck && npm run lint && npm run build` -- expected: exit 0
- `supabase db reset && npm test` -- expected: unit and integration pass, every matrix row covered
- `CI=1 npm run test:e2e` (stack started as CI does, fake Google active) -- expected: all existing flows pass on both projects (the Usage screen's fixtures and the cleanup helpers changed)
- `node scripts/ci/check-repository.mjs && npm run render:provisioning -- --check && npm run test:env` -- expected: exit 0

**Manual checks (if no CLI):**
- None: nothing in the application calls the commands yet. Inspect that `\dt usage.*` shows `periods`, `rate_schedules`, `reservations`, `settlements`, `overrun_incidents` and `commands`, and that `select * from api.preflight(...)` as the service role raises nothing.

## Suggested Review Order

**The recorded numbers and the one calculator**

- Every constant lives in SQL: overhead, image tokens, margin, ceilings, the two caps, the deadline.
  [`usage_reservations.sql:56`](../../supabase/migrations/20261024120000_usage_reservations.sql#L56)

- Exact rational price, rounded up once per operation, overflow and unknown rates refused.
  [`usage_reservations.sql:429`](../../supabase/migrations/20261024120000_usage_reservations.sql#L429)

- The bound a request is held to, or the reason it has none.
  [`usage_reservations.sql:467`](../../supabase/migrations/20261024120000_usage_reservations.sql#L467)

**The ledgers and why they cannot be edited**

- Versioned rate schedules: global, immutable, written by no command until Story 2.5.
  [`usage_reservations.sql:107`](../../supabase/migrations/20261024120000_usage_reservations.sql#L107)

- One reservation per external operation, pinned to the schedule it was priced on.
  [`usage_reservations.sql:159`](../../supabase/migrations/20261024120000_usage_reservations.sql#L159)

- Settlement releases the whole reservation and books what happened; an overrun adds an incident.
  [`usage_reservations.sql:231`](../../supabase/migrations/20261024120000_usage_reservations.sql#L231)

- The Job's exposure across every attempt, which the $5 cap is judged against.
  [`usage_reservations.sql:535`](../../supabase/migrations/20261024120000_usage_reservations.sql#L535)

- The stand-in is gone; period figures are signed deltas read from the ledgers.
  [`usage_reservations.sql:552`](../../supabase/migrations/20261024120000_usage_reservations.sql#L552)

**Admission and settlement**

- The operation row is held for share, so a dispatch and a reservation are serial.
  [`usage_reservations.sql:753`](../../supabase/migrations/20261024120000_usage_reservations.sql#L753)

- Refusals in order: provider, operation cap, Job cap, allowance; each carries the cost block.
  [`usage_reservations.sql:832`](../../supabase/migrations/20261024120000_usage_reservations.sql#L832)

- A replay whose receipt names a missing record fails closed rather than answering empty.
  [`usage_reservations.sql:771`](../../supabase/migrations/20261024120000_usage_reservations.sql#L771)

- Settlement needs no Account authority; the class must fit the operation's state and the deadline.
  [`usage_reservations.sql:1020`](../../supabase/migrations/20261024120000_usage_reservations.sql#L1020)

**The typed module**

- The only caller of the three commands, with the same constants and vocabularies.
  [`usage-reservations.ts:36`](../../lib/usage-reservations.ts#L36)

- Reserve: validated inputs, a closed outcome union, a cost block that must add up.
  [`usage-reservations.ts:365`](../../lib/usage-reservations.ts#L365)

**Proof**

- A reservation counts what a month turn, a change and a reset carried in.
  [`usage-reservations.test.ts:1550`](../../tests/integration/usage-reservations.test.ts#L1550)

- A reserve and a dispatch of one operation commit in either order, never both.
  [`usage-reservations.test.ts:2111`](../../tests/integration/usage-reservations.test.ts#L2111)

- The deadline settles the whole reservation, and only after 24 hours.
  [`usage-reservations.test.ts:1228`](../../tests/integration/usage-reservations.test.ts#L1228)

- The module's validation, outcomes and shape errors without a database.
  [`unit/usage-reservations.test.ts:1`](../../tests/unit/usage-reservations.test.ts#L1)
