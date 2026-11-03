---
title: 'Story 2.8: Reconcile ambiguous charges without replacement calls'
type: 'feature'
created: '2026-11-02'
status: done
baseline_commit: '80213dc1730e86f71e356f8ed41d3f33ff91d5f5'
review_loop_iteration: 1
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-2-context.md'
  - '{project-root}/_bmad-output/specs/spec-nova3D-story-2-8/acceptance-criteria.md'
  - '{project-root}/_bmad-output/specs/spec-nova3D-story-2-8/implementation-constraints.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-2-6-reserve-bounded-costs-atomically.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-2-7-accept-and-execute-durable-fenced-jobs.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-2-11-create-durable-job-attempt-step-and-operation-identities.md'
  - '{project-root}/docs/authority-contract.md'
  - '{project-root}/_bmad-output/planning-artifacts/architecture/architecture-nova3D-2026-09-14/ARCHITECTURE-SPINE.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** An operation that was sent but whose outcome is unknown (a timeout, a 5xx, a lost connection, an aborted stream, a lost lease) keeps its full reservation for ever: nothing moves a `dispatched` operation to `ambiguous` (so its 24-hour clock never starts), nothing settles it at the deadline, a later usage report cannot correct a deadline booking, an overrun incident cannot be seen or cleared (so a provider stays blocked for every Account), and nothing raises an alarm. Known defects ride along: one operation that cannot settle aborts the whole sweep, a period total can pass the 10^15 microdollar bound at settlement, and a returned model is never compared with the reserved one.

**Approach:** A migration adds an authority-free move to `ambiguous`, a deadline stage in the Story 2.7 minute sweep that settles each due operation once at its reservation (class `deadline`) and then moves it to `settled`, an append-only correction entry for evidence that arrives after a deadline booking, a reconciliation command for late evidence or a proven noncharge, an Administrator list-and-clear of overrun incidents, and one more alarm observation. A pure classifier decides what a provider answer means (evidence, noncharge, or ambiguous), the adapters make exactly one request and keep the request ID, and the Administrator usage page lists incidents and clears them behind the fresh administration marker.

## Boundaries & Constraints

**Always:** Consult `node_modules/next/dist/docs/` before any route, Server Action or page (AGENTS.md). No new npm dependency. One new migration `20261101120000_reconcile_ambiguous_charges.sql`, additive and forward-only, after `20261031120000`. **Ledger rules:** every settlement, correction and incident row is append-only (updates and truncates refused; an incident has exactly one clearing); a settlement is never edited; the stored class stays `deadline` for a charge settled at its reservation and the operation keeps `outcome_at`, so the record still says it was ambiguous. Money is integer microdollars; `api.settle_cost` stays authority-free (no epoch, status or Project check, as Story 2.6 decided). **Moves:** `jobs.mark_ambiguous(operation)` (authority-free, internal, no API role) moves a `dispatched` operation to `ambiguous` and sets `outcome_at = clock_timestamp()` once, under the Job lock and the operation row `FOR UPDATE`. The sweep, in the existing global lock `nova3d:jobs-sweep`, adds two stages after lease expiry: (1) mark every `dispatched` operation whose attempt is no longer `running` (failed, cancelled, completed) `ambiguous` (bounded by 100); (2) for every `ambiguous` operation with a reservation, no settlement and `outcome_at + usage.ambiguity_deadline() <= clock_timestamp()` (bounded by 100, oldest first): take the Job lock, lock the operation row `FOR UPDATE`, re-check, `api.settle_cost(..., 'deadline')` under a derived command ID, then move the operation to `settled` (which opens the gate for a waiting retry). Each operation runs in its own sub-block: a failure is counted (`failed`) and the sweep goes on; `jobs.settle_abandoned` gets the same isolation and `api.cancel_job` never fails because one abandoned operation cannot settle. `api.dispatch_sweep` gains `marked`, `reconciled` and `failed` (additive). **Evidence and corrections:** `api.settle_cost` `evidence` requires the returned model to equal the reservation's pinned model (otherwise `invalid_evidence`, so the caller reports the operation `ambiguous` and the deadline decides); a settlement that would take the period's settled total (carry + figure + this amount) over 10^15 answers the existing word `overflow` and writes nothing. When the reservation is already settled by `deadline`, an `evidence` call appends ONE correction (`usage.corrections`: unique per reservation, signed settled delta = evidence minus reserved, tokens, model, digest, period) and answers `corrected` (the same evidence again is `replayed`, different evidence `already_settled`); evidence above the reservation also writes an overrun incident on the original settlement. `usage.period_figures` and `usage.job_exposure` count corrections. `api.reconcile_operation(p_operation_id, p_outcome 'evidence'|'noncharge', p_input_tokens, p_output_tokens, p_returned_model, p_request_id)` (service role, authority-free): `ambiguous` + evidence settles at the evidence then moves the operation to `settled`; `ambiguous` + noncharge (a request ID is required) moves it to `noncharge` then settles `noncharge`; `settled` after a deadline booking + evidence appends the correction; each under derived command IDs, so a repeat is `replayed`; outcomes `reconciled|corrected|replayed|not_reconcilable|unavailable` or the settlement's refusal word. `api.finish_operation` also accepts `p_outcome = 'ambiguous'` (fenced, request ID optional): it moves the operation to `ambiguous`, settles nothing and keeps the reservation; a second report for a finished operation answers a word and never raises 55000. **Incidents:** `api.list_overrun_incidents(p_account_id, p_epoch, p_limit default 50)` and `api.clear_overrun_incident(p_account_id, p_epoch, p_command_id, p_incident_id)` (service role). Both run `identity.assert_operation_authority` (`denied`), require the Administrator role, and read or clear the incident across Accounts; clearing locks the incident row, sets `cleared_at` and `cleared_by = 'user:<Auth user id>'` once, writes the audit event `usage.incident_cleared` (target `incident:<id>`) in the same transaction and answers `cleared|already_cleared|unavailable|denied`; the provider's admissions resume when its last incident is cleared. The fresh administration marker is checked by the application exactly as Story 2.4 does (`administered()`, 5 minutes); `api.record_usage_refusal` accepts one more action, `usage.incident_refused`, for a refused clear. **Alarm:** `api.alarm_observations()` gains `unknown_cost_oldest` (seconds since `coalesce(outcome_at, dispatched_at)` of the oldest operation in `dispatched` or `ambiguous` that has a reservation and no settlement); `lib/alarm-conditions.ts` gets `unknown-cost` (raises over 24 hours plus 10 minutes of sweep slack, SQL constant mirrored in TypeScript and tested equal) with copy in both locales. **Providers:** the adapters keep the response's request ID, make exactly one request and never retry; `lib/providers/outcome.ts` is a pure classifier: a 2xx with priced usage is `completed`; 400, 401, 403, 404, 413 and 422 with a request ID are `noncharge`; a 2xx without usable usage, any other status (408, 409, 429, 5xx), a timeout, a transport loss and an aborted stream are `ambiguous`. `lib/operation-outcome.ts` supplies the adapters' `markDispatched` (it calls `run_step`, true for `stepped` or `replayed`, false otherwise, so nothing is sent before the identity is committed) and reports a classified answer through `finish_operation` (a refused `completed` is reported `ambiguous`). **Screens:** the Administrator usage page lists each incident (provider, operation, reserved, evidence, over, when, open or cleared and by whom) and offers Review and clear behind a confirmation and the step-up notice; English and Hebrew, light and dark, phone and desktop, 44 px targets, axe clean. `api.preflight` is re-created from the newest earlier one keeping every statement, with a Story 2.8 block (the new table, constants and signatures) raising `N3020`; end with `notify pgrst, 'reload schema'`. Typed calls live in `lib/usage.ts` (list and clear), `lib/job-commands.ts` (reconcile, ambiguous finish, sweep counts) and `lib/usage-reservations.ts` (settle outcome words); `lib/usage-reservations.ts` stays unimported by `lib/usage.ts` and `lib/usage-view.ts`.

**Ask First:** A provider request of any kind issued by this story, an SDK retry, a change to the 24-hour deadline, the $1/$5 caps or the 10^15 bound, a new settlement class word, an incident clear that does not need the fresh marker, or a per-Account provider block.

**Never:** Editing or deleting a settlement, correction or incident row; settling `deadline` before the deadline; a replacement or retry request after an ambiguous outcome; a retry that skips the gate; releasing reserved money for a `dispatched` or `ambiguous` operation other than by evidence, a proven noncharge or the deadline; clearing an incident as the owner or without the Administrator role; sending the request ID, tokens or a key to a log or a page; redelivery of unclaimed dispatches and worker discovery (deferred); the first paid kind, real provider enablement or Anthropic/Brave credentials (Stories 2.9 and 2.13).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Ambiguous outcome | A dispatched operation; the adapter times out, loses the connection, aborts, or gets a 5xx/429/408/409 or a 2xx with no usable usage | Exactly one request was made; `finish_operation(ambiguous)` moves it to `ambiguous` with `outcome_at`; the full reservation stays held; the Job's retry is `blocked` | No SDK retry, no replacement call |
| Lost attempt | An attempt fails (lease lost) or is cancelled with a `dispatched` operation | The sweep marks it `ambiguous` (24-hour clock starts); reservation held; cancel releases only `planned` ones | N/A |
| Definitive rejection | 400/401/403/404/413/422 with a request ID | `noncharge`; settled 0, whole reservation released; gate opens | Without a request ID: `ambiguous` |
| Evidence in time | `reconcile_operation(evidence)` or `finish_operation(completed)` before the deadline | Settled at the priced evidence, remainder released, operation `settled`/`completed`; a returned model other than the pinned one is `invalid_evidence`, reported `ambiguous` | N/A |
| Deadline | An `ambiguous` operation 24 hours past `outcome_at` | The sweep settles exactly the reservation, class `deadline`, then moves it to `settled`; a waiting retry now runs; a second sweep changes nothing | A failing operation is counted `failed`; others still settle |
| Late evidence | Evidence after a deadline booking | One correction entry (lower: releases the difference; higher: settles the excess and opens an incident); the settlement row is unchanged; same evidence `replayed`, other `already_settled` | N/A |
| Overrun incident | Evidence above the reservation | Settled at the evidence, counts against every limit, provider `provider_blocked` for every Account; listed on the usage page | N/A |
| Clear | The Administrator with a fresh marker clears an incident | `cleared`, audited, admissions resume when the provider has no open incident; again `already_cleared` | No marker or expired: refused, audited `usage.incident_refused`, nothing changes; not an Administrator: 404/`denied` |
| Unresolved charge and the caps | Retry, cancel, disable or allowance reset while a charge is unresolved | Retry waits; cancel/disable keep the reservation held; a reset keeps the liability; the Job's $5 cap still counts it (and any correction) | N/A |
| Overflow | A settlement that would take a period's settled total over 10^15 | `overflow`; nothing written; the operation stays unsettled and the alarm shows it | N/A |
| Alarm | An unsettled unknown-cost operation older than 24 hours plus 10 minutes | `unknown-cost` raises; clears when settled | N/A |
| Concurrency | Two sweeps; the sweep against a late `reconcile_operation`; a clear against another clear; a deadline settlement against `finish_operation` | One settlement; one winner with a consistent answer; no deadlock (Job lock, then operation row, then usage lock) | N/A |

</frozen-after-approval>

## Code Map

- `supabase/migrations/20261101120000_reconcile_ambiguous_charges.sql` -- new. Ledger: `usage.settlements` `20261024120000_usage_reservations.sql:231-262` (classes `:240`, deadline shape `:261`), `api.settle_cost` `:912-1075` (state fit `:1013-1023`, due check `:1025`, incident write `:1056-1060`), `usage.ambiguity_deadline` `:64`, `usage.job_exposure` `:535`, `usage.period_figures` `:552`, `usage.overrun_incidents` and guard `:307-379`, the provider block in the unchecked reserve (renamed in `20261029120000_require_provider_permission.sql`, re-created in `20261030120000_...`), refusal guard `:138`. Jobs: `jobs.operations` and guard `20261023120000_job_records.sql:257-340` (time-shape check `:274`; `outcome_at` is written once `:812`), `api.advance_operation` `:708-823`, `jobs.charge_open` `:388`. Sweep: `20261031120000_durable_dispatch.sql` `jobs.settle_abandoned` `:521-551`, `api.sweep_attempts` `:1812-1853` (type `api.dispatch_sweep` `:1801`), `api.finish_operation` `:1455-1538`, `jobs.check_fence` `:588`, `api.alarm_observations` `:1892` (columns added by `alter type ... add attribute` `:1889`), `api.preflight` `:1949-2349` (69 `api` signatures), `identity.record_audit` `20261010120000_accounts.sql:230`, `api.record_usage_refusal` and the pattern for administrator commands `20261022120000_usage_limits.sql:392-532, 613-640`. Locks: Job lock, then the operation row `FOR UPDATE`, then the usage lock (`nova3d:usage:<account>`); the sweep keeps `nova3d:jobs-sweep` first.
- `lib/providers/adapters.ts` (131 lines; no production caller; all non-2xx are `ambiguous/provider_error`, request ID dropped `:89,123`; 2xx without usage returns null tokens `:96`), new `lib/providers/outcome.ts`, new `lib/operation-outcome.ts`; `lib/job-commands.ts` (`finishOperation` `:763-783` throws for any outcome but completed/noncharge; `sweepAttempts` `:911`), `lib/worker-commands.ts:176-210` (the `operation` command: add `ambiguous`), `lib/job-dispatch.ts:184-199` and `lib/job-tasks.ts:180-196` (sweep result keys; `isJobResult` `lib/lifecycle.ts:246` takes counts and words).
- Usage page: `app/admin/usage/page.tsx`, `app/admin/usage/actions.ts` (`command()` `:86`, `administered` wrapper `lib/administered.ts:45`), `components/admin/usage-content.tsx`, `usage-list.tsx` (`ResetControl` `:272` is the confirm-dialog pattern), `components/use-usage-action.ts`, `lib/usage.ts` (`listUsage` `:73`, `recordUsageRefusal` `:184`, action list `:172`), `lib/usage-view.ts` (`attemptUsageAction` `:260`, keys `:270-281`), step-up `components/admin/step-up-notice.tsx`; copy `usage.*` in `lib/i18n/en.ts:826-893` and `he.ts:828-890` (Hebrew bans Latin words; amounts through `isolateLtr`).
- Alarms: `lib/alarm-conditions.ts` (`Observations` `:34-55`, `outboxAgeCondition` `:193`, registry `:217-226`), `lib/lifecycle.ts:597-624`, `lib/operations.ts:20-33`, copy `operations.condition.*` (en `:929`, he `:930`).
- Pins to change on purpose: preflight count 69 to 72 in `request-revisions.test.ts:1373`, `alarms.test.ts:907`, `usage-limits.test.ts:1675`, `picture-sets.test.ts:1694`, `file-gateway-db.test.ts:1785`, `job-records.test.ts:2237`, `usage-reservations.test.ts:2319`, `job-dispatch.test.ts:1977`; `isolation.test.ts:139-289` (a body per function) and `accounts.test.ts:52+` (apiFunctions); `usage-reservations` unit `:182,190-198,775-781` and integration `:363,1217-1220,1649,1711-1727` (incident clearing by the owner stays refused), `usage-limits.test.ts:172-181` (usage tables: seven now), `:1373-1380` (refusal actions); alarms `alarm-conditions.test.ts:47-98`, `operations.test.ts:51-70`, `operations-page.test.tsx:250-262`, `alarms.test.ts:326-376`, `lifecycle.test.ts:828-880`, `support/alarm-fakes.ts:22-45`, `support/alarm-observations.ts`, `alarms.test.ts` integration `:594,969,1163`; sweep `job-dispatch.test.ts` unit `:377-441` and integration `:1018` (an `ambiguous` outcome is now accepted), `:1078,1853`, `job-tasks.test.ts:438-540`, `job-commands.test.ts:1334-1352`; `gate-structure.test.ts`: `:451, :687` (`administered` callers), `:2084-2088` (condition ids), `:3497-3600` (usage page files and actions), `:4136-4200, :4636` (Story 2.6 name bans: list/clear go in `lib/usage.ts`), `:5036,:5070`, doc needles `:4660-4665`. Cleanups: `tests/support/accounts-data.ts`, `forged-session.ts`, `usage-ledger.ts` (`removeLedger` deletes incidents first; add corrections).
- Tests to write: `tests/integration/charge-reconciliation.test.ts` (every row, two-connection races), `tests/unit/provider-outcome.test.ts` and `provider-adapters.test.ts` additions (exactly one `fetch` on 5xx, timeout, abort, transport loss; request ID kept), `operation-outcome.test.ts`, usage page/action/view tests, `alarm-conditions` additions, `tests/e2e/usage.spec.ts` additions (incident fixture: `ledgerJob`, `insertReservation`, `insertSettlement` above the reservation, `insertIncident`; real step-up needs `npm run fake-google:up`).
- Left for others: the first paid kind and real credentials (2.9, 2.13); redelivery of an unclaimed dispatch and re-publish when the gate opens (deferred, 2.7); notifications (2.10); credit funding of settlements (2.14); a per-Account provider block; a noncharge proven after a deadline booking.

## Tasks & Acceptance

**Execution:**
- [x] `supabase/migrations/20261101120000_reconcile_ambiguous_charges.sql`, `docs/staging.md` -- corrections table and guards, figures and exposure, settle_cost changes, `jobs.mark_ambiguous`, sweep stages and counts, isolation in `settle_abandoned`, `finish_operation` ambiguous, `reconcile_operation`, incident list and clear, refusal action, alarm observation, preflight, migration row -- AC-1 to AC-5
- [x] `lib/providers/adapters.ts`, `lib/providers/outcome.ts`, `lib/operation-outcome.ts`, `lib/job-commands.ts`, `lib/worker-commands.ts`, `lib/usage-reservations.ts`, `lib/job-dispatch.ts`, `lib/job-tasks.ts` -- one request, request ID, classifier, dispatch marker, ambiguous reports, sweep counts -- AC-1, AC-2, AC-5
- [x] `lib/usage.ts`, `lib/usage-view.ts`, `app/admin/usage/**`, `components/admin/**`, `lib/i18n/en.ts`, `lib/i18n/he.ts`, `app/globals.css` -- incident list, review and clear, refusal copy -- AC-4
- [x] `lib/alarm-conditions.ts`, `lib/lifecycle.ts`, `lib/operations.ts` -- the `unknown-cost` observation and condition -- scope
- [x] `tests/` -- every matrix row (integration, unit, e2e, helpers), the pins above, cleanups -- all ACs
- [x] `README.md`, `docs/authority-contract.md`, `docs/staging.md`, `lib/schedules.ts` header -- reconciliation, corrections, incidents, the alarm, the sweep keys; resolve the matching entries in `deferred-work.md` and record what stays deferred -- housekeeping

**Acceptance Criteria:**
- Given a timeout after a potentially chargeable request, when the outcome is uncertain, then the full reservation remains, exactly one request was made and the Job's retry waits (AC-1).
- Given evidence, the deadline or a proven noncharge, when reconciliation completes, then append-only settlement and correction entries record it, a deadline booking stays classified `deadline` and later evidence only appends (AC-2).
- Given a retry, cancellation or allowance reset while a charge is unresolved, when another attempt is requested, then it waits, only demonstrably unused allowance is released and the Job's $5 cap still counts the charge (AC-3).
- Given provider usage above a reservation, when the incident is recorded, then it settles at the evidence, blocks that provider, shows on the usage page and only the freshly authenticated Administrator can clear it (AC-4).
- Given an ambiguous charge past 24 hours, when the minute sweep runs, then it settles at the reservation exactly once, a repeat changes nothing, one failing operation does not stop the others, and the alarm rises if one stays unresolved (AC-5).

## Spec Change Log

## Design Notes

The two records are separate on purpose: a settlement books money, an operation's state says what happened (Story 2.6). Reconciliation therefore always does both, in one sub-block, settle first and then move to `settled`, because the gate only opens when the operation leaves `ambiguous`. A lost attempt is the case nobody reports, so the sweep, not a worker, starts the clock. Corrections are the only way a booking changes: a successor row with a signed delta, counted by the figures and the Job's exposure, so history is never rewritten and a month turn stays correct (signed deltas, as Story 2.6 already allows). The classifier is conservative by construction: anything that is not clearly a priced answer or a clear pre-processing rejection is ambiguous and keeps the whole reservation, which is the maximum the Account was already shown.

```
dispatched --(reports timeout/5xx | attempt ended)--> ambiguous --(evidence)--> settled   settle: evidence, remainder released
                                                          |--(proven noncharge, request ID)--> noncharge   settle: 0
                                                          '--(24 h, sweep)--> settled        settle: deadline = reservation
settled after deadline --(late evidence)--> + one correction row (signed delta; excess opens an incident)
```

## Verification

**Commands:**
- `npm run typecheck && npm run lint && npm run build` -- expected: exit 0
- `supabase db reset && npm test -- --maxWorkers=2` -- expected: unit and integration pass (the `allowlist-removal` unit failure is the deleted skills, not this story), every matrix row covered
- `npm run fake-google:up && CI=1 npm run test:e2e && npm run fake-google:down` -- expected: all flows pass on both projects and the incident list passes axe in every variant
- `node scripts/ci/check-repository.mjs && npm run render:provisioning -- --check && npm run test:env` -- expected: exit 0

**Manual checks (if no CLI):**
- None: no real provider is enabled. After `supabase db reset`, `\dt usage.*` shows seven tables and `select * from api.preflight(...)` as the service role raises nothing.

## Suggested Review Order

**The provider answer: what a request outcome means**

- Entry point: a pure classifier turns any provider answer into completed, noncharge or ambiguous, never retrying.
  [`outcome.ts:50`](../../lib/providers/outcome.ts#L50)

- Adapters make exactly one request, never follow a redirect, and keep the request ID.
  [`adapters.ts:83`](../../lib/providers/adapters.ts#L83)

- Brave refuses to dispatch without a pinned model rather than guessing one.
  [`adapters.ts:120`](../../lib/providers/adapters.ts#L120)

- The identity is committed before anything is sent; a repeat step still passes (decision kept, deferred).
  [`operation-outcome.ts:31`](../../lib/operation-outcome.ts#L31)

- A refused `completed` or `noncharge` report is reported ambiguous, holding the whole reservation.
  [`operation-outcome.ts:52`](../../lib/operation-outcome.ts#L52)

**Moving to ambiguous and settling at the deadline**

- The authority-free move that starts the 24-hour clock.
  [`reconcile_ambiguous_charges.sql:474`](../../supabase/migrations/20261101120000_reconcile_ambiguous_charges.sql#L474)

- Sweep stages 3 and 4: mark ended attempts' operations, then lock-ordered deadline settlement.
  [`reconcile_ambiguous_charges.sql:953`](../../supabase/migrations/20261101120000_reconcile_ambiguous_charges.sql#L953)

- One failing operation is counted in its own sub-block and no longer aborts the sweep.
  [`reconcile_ambiguous_charges.sql:507`](../../supabase/migrations/20261101120000_reconcile_ambiguous_charges.sql#L507)

- `finish_operation` accepts `ambiguous` and answers a word instead of raising on a second report.
  [`reconcile_ambiguous_charges.sql:558`](../../supabase/migrations/20261101120000_reconcile_ambiguous_charges.sql#L558)

**Evidence, corrections and the money rules**

- Model pin, 10^15 overflow, and the one-correction path after a deadline booking.
  [`reconcile_ambiguous_charges.sql:224`](../../supabase/migrations/20261101120000_reconcile_ambiguous_charges.sql#L224)

- The append-only correction ledger, unique per reservation.
  [`reconcile_ambiguous_charges.sql:44`](../../supabase/migrations/20261101120000_reconcile_ambiguous_charges.sql#L44)

- Period figures and Job exposure now count corrections as signed deltas.
  [`reconcile_ambiguous_charges.sql:184`](../../supabase/migrations/20261101120000_reconcile_ambiguous_charges.sql#L184)

- Late evidence or a proven noncharge, under derived command IDs so a repeat is `replayed`.
  [`reconcile_ambiguous_charges.sql:679`](../../supabase/migrations/20261101120000_reconcile_ambiguous_charges.sql#L679)

**Overrun incidents and the alarm**

- Administrator-only clearing: epoch authority, locked row, audit event in the same transaction.
  [`reconcile_ambiguous_charges.sql:843`](../../supabase/migrations/20261101120000_reconcile_ambiguous_charges.sql#L843)

- The app checks the fresh administration marker and audits a refused clear.
  [`actions.ts:153`](../../app/admin/usage/actions.ts#L153)

- The `unknown-cost` observation, measured from the outcome time of the oldest unsettled operation.
  [`reconcile_ambiguous_charges.sql:1080`](../../supabase/migrations/20261101120000_reconcile_ambiguous_charges.sql#L1080)

- The condition raises over 24 hours plus sweep slack, mirrored from the SQL constant.
  [`alarm-conditions.ts:231`](../../lib/alarm-conditions.ts#L231)

**Typed calls and screens**

- Typed finish, reconcile and sweep calls carry the database's words and reason.
  [`job-commands.ts:769`](../../lib/job-commands.ts#L769)

- Incident list and clear calls, bounded and validated.
  [`usage.ts:262`](../../lib/usage.ts#L262)

- Incident cards with a confirm dialog that starts on Cancel, English and Hebrew.
  [`usage-incidents.tsx:66`](../../components/admin/usage-incidents.tsx#L66)

- The page reads incidents beside the Accounts and degrades to an error state on its own.
  [`page.tsx:34`](../../app/admin/usage/page.tsx#L34)

**Preflight and docs**

- `api.preflight` re-created with the Story 2.8 block (72 signatures).
  [`reconcile_ambiguous_charges.sql:1143`](../../supabase/migrations/20261101120000_reconcile_ambiguous_charges.sql#L1143)

- The contract documents settlement order, corrections and the reconciliation commands.
  [`authority-contract.md:345`](../../docs/authority-contract.md#L345)

**Tests (peripheral)**

- Database behaviour: sweep, deadline, corrections, incidents, locking, alarm.
  [`charge-reconciliation.test.ts:1`](../../tests/integration/charge-reconciliation.test.ts#L1)

- Classifier table and outcome reporting, including the identity check.
  [`provider-outcome.test.ts:1`](../../tests/unit/provider-outcome.test.ts#L1)
  [`operation-outcome.test.ts:1`](../../tests/unit/operation-outcome.test.ts#L1)

- Incident list and clear in both locales, light and dark, phone and desktop, with axe.
  [`usage.spec.ts:19`](../../tests/e2e/usage.spec.ts#L19)
