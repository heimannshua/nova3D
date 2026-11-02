---
title: 'Story 2.7: Accept and execute durable fenced jobs'
type: 'feature'
created: '2026-10-21'
status: 'done'
baseline_commit: '26c26295037eda35e0fe708f6044269f45b08293'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-2-context.md'
  - '{project-root}/_bmad-output/specs/spec-nova3D-story-2-7/acceptance-criteria.md'
  - '{project-root}/_bmad-output/specs/spec-nova3D-story-2-7/implementation-constraints.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-2-11-create-durable-job-attempt-step-and-operation-identities.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-2-6-reserve-bounded-costs-atomically.md'
  - '{project-root}/docs/authority-contract.md'
  - '{project-root}/_bmad-output/planning-artifacts/architecture/architecture-nova3D-2026-09-14/ARCHITECTURE-SPINE.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Jobs exist only as identities (Story 2.11) and costs can be reserved (Story 2.6), but nothing accepts work durably, dispatches it, runs a step, decides who may publish its result, or ends it when the user cancels or the Account is disabled. An accepted Job could vanish with a browser or a restart, a duplicate delivery could repeat work, a lost worker could publish late, and a disabled Account's work would keep running.

**Approach:** Every attempt commits a dispatch outbox row with it. A `submit_job` command commits the Job, its planned reservations and that outbox together. The request publishes at once and a per-minute sweep publishes what is left. An attempt is claimed once under a 120-second lease with a fencing token. A deterministic test workload runs as an application step that a signed, registered test worker can also take. User cancel and Account disable revoke commit authority first. Completion settles usage. Job detail and an In-progress list show it on phone and desktop. No provider, research or real worker exists yet.

## Boundaries & Constraints

**Always:** Consult `node_modules/next/dist/docs/` before any route, Server Action or page (AGENTS.md). No new npm dependency (`@upstash/qstash` is already one). New migration `20261027120000_durable_dispatch.sql`, additive (the number is provisional: Story 2.5 is being built beside this and owns earlier numbers). Recorded constants live in SQL (`jobs.*` constant functions) and are mirrored in `lib/job-dispatch.ts` with a test that they are equal: lease 120 s, renewal 30 s (the worker's duty), publish grace 15 s, publish lease 60 s, 3 open Jobs per Account, outbox alarm 120 s, expired-lease alarm 300 s, built-in step version 1, the one supported kind `test_workload`. **Tables** in the closed `jobs` schema (ids `uuid`, times `clock_timestamp()` UTC, composite foreign keys `restrict`, delete allowed for the Epic 8 purge, truncate refused): `jobs.outbox` (one row per attempt, `attempt_id` unique; `id`, `account_id`, `job_id`, `kind`, `plan` jsonb at most 4 KB, `account_epoch`, `project_revision`, `worker_version`, `created_at`, `publish_until`, `published_at`, `message_id` 1 to 200 printable ASCII; inserted only by a trigger on `jobs.attempts` insert, which pins the Account's current epoch, the Project's current revision, the worker version and the plan from transaction-local settings that only `submit_job` sets, so an attempt can never exist without its outbox row; the row refuses every update except the publisher's `publish_until` and the one-time `published_at` and `message_id`); `jobs.workers` (registry, global: `id`, `issuer` `cad-worker|engine-worker`, `worker_kind` word, `version` from 1, `image_digest` 64 lowercase hex, `kinds` 1 to 8 words, `registered_at`, `retired_at`; unique `(issuer, version, image_digest)`; refuses every update except the one retirement); `jobs.leases` (at most one per attempt: `id`, `account_id`, `attempt_id` unique, `worker_id` null for the built-in step, `fence` uuid unique, `claimed_at`, `renewed_at`, `expires_at`, `ended_at`, `end_reason` `completed|failed|cancelled|expired|revoked`, `detail` null or `user_cancelled|account_disabled|lease_expired|stale_revision|revoked_epoch|tombstoned|step_failed`, `result_digest`; updates only extend a live lease or end it once); `jobs.callbacks` (`jti` primary key, `issuer`, `kid`, `typ`, `command`, `attempt_id` null, `digest`, `created_at`; refuses update). `jobs.commands.kind` also allows `submit_job` and `cancel_job`. The insert triggers `jobs.check_step` and `jobs.check_operation` now also admit a `waiting` attempt (planning), and `api.begin_step` still answers `not_running` for it. **Stored attempt states, moves and reasons are unchanged**: stale or revoked work ends as `failed/step_failed` or `cancelled`, and the cause is the lease `detail`. Never retry automatically; the only way to a new attempt is `api.request_retry`, which now also yields an outbox row through the trigger. **Kinds and executors:** `submit_job` accepts only `test_workload`. An attempt is *executable* when its pinned `worker_version` is the built-in version and its kind is built in, or a non-retired registered worker has that version and lists the kind; registering a version retires the earlier versions of the same `(issuer, worker_kind)`. A waiting attempt that is not executable reads `awaiting_worker` (only in the new reads; `api.read_job` and `jobs.derived_reason` of Story 2.11 are unchanged), after `awaiting_reconciliation` (the gate) and before `awaiting_dispatch`. **Commands** (`security definer`, `set search_path = ''`, `grant execute` to `service_role` only, composite outcome types named to clash with nothing). The four user commands take `p_account_id`, `p_epoch` and `p_command_id` (reads take no command ID) and run: arguments (22023); `identity.assert_operation_authority` in `begin/exception when sqlstate 'N3010'` (`denied`); advisory lock `nova3d:jobs-command:<account>:<command>`; the subject belongs to the Account and its Project is held through `jobs.hold_project` (`unavailable`, one answer for foreign, deleted, unknown and tombstoned); advisory lock `nova3d:job:<job>`; the receipt by `(account, command_id)` in `jobs.commands` (same digest `replayed`, another `reused`); then the command's checks. `api.submit_job(…, p_project_id, p_kind, p_input_digest, p_plan default '{}', p_worker_version default null)`: the plan is `{outcome: complete|fail (default complete), operations: [≤3 of {step_key, ordinal 1 to 100, schedule_id, provider, model, api_version, request_bytes, image_count, output_limit, options}] }` with unique `(step_key, ordinal)`; after the receipt check, `at_capacity` (carrying the count and 3) when the Account already has 3 Jobs with a `waiting` or `running` attempt; then it creates the Job and attempt 1 as `api.accept_job` does (the trigger writes the outbox row), plans each operation (its step and a `planned` operation) and reserves it by calling `api.reserve_cost` through ONE internal function `jobs.reserve_planned` (so Story 2.5's permission argument is added in one place), all inside a sub-block: any refusal answers `refused` carrying the refusal word and the cost block, and nothing is written (no Job, outbox row, operation, reservation or receipt): `accepted|replayed|reused|denied|unavailable|at_capacity|refused`, carrying Job, attempt and outbox IDs. `api.cancel_job(…, p_job_id)`: the highest attempt must be `waiting` or `running` (`not_cancellable` carrying its state); FIRST end its lease (`cancelled`, detail `user_cancelled`), then move it to `cancelled/user_cancelled` (its `planned` operations become `abandoned`), then settle each abandoned operation that holds a reservation as `unused` (releasing it); `dispatched` and `ambiguous` operations stay chargeable and held: `cancelled|replayed|reused|denied|unavailable|not_cancellable`. `api.list_jobs(p_account_id, p_epoch, p_limit default 50)`: `found|denied`; the Account's Jobs whose Project is live (open attempts first, then newest ended) with Project ID and title, kind, public state, stage, reason (with `awaiting_worker`), times. `api.read_job_detail(p_account_id, p_epoch, p_job_id)`: `found|denied|unavailable`; the Job, public state, stage and reason, `can_cancel`, `can_retry`, every attempt, `progress` (steps begun, operations completed of planned), `cost` (microdollars reserved and still held, settled, released, count of potentially chargeable operations) and `ending` (the lease detail of the highest attempt, null while open); nothing else. The service commands take no Account or epoch from the caller: each reads the epoch bound in the outbox row, calls `assert_operation_authority` with it (a disabled Account or a later epoch is `revoked`) and holds the Project (`unavailable`). `api.register_worker(p_issuer, p_worker_kind, p_version, p_image_digest, p_kinds)`: `registered|replayed|superseded` (a version below a non-retired one). `api.claim_attempt(p_attempt_id, p_worker_id default null)` (null is the built-in step): under the job lock, a live or ended lease of the attempt answers `replayed` only for the same non-null worker (carrying its fence) and `already_claimed` otherwise; then the attempt must be `waiting` (`not_waiting`), the gate closed is `blocked`, a non-executable attempt is `waiting_for_worker`, a worker that is retired, of another version or without the kind is `incompatible`; otherwise it moves the attempt to `running` (stage `started`) and inserts the lease (`expires_at` 120 s ahead, a new `fence`): `claimed` carrying the fence, expiry, plan, input digest, bound revision and epoch. A failed authority cancels the attempt (`account_disabled`) and answers `revoked`; a Project not held is `unavailable`. `api.renew_lease(p_attempt_id, p_fence)`: `renewed` (expiry 120 s from now) or `fence_mismatch|expired|cancelled|revoked|not_running` (an `expired` lease is never renewed; a lease whose epoch is gone is ended `revoked`). `api.run_step(p_attempt_id, p_fence, p_step_key, p_ordinal default null)`: the fence checks, then `api.begin_step`, and when the ordinal names a planned reserved operation `api.advance_operation` to `dispatched`, under derived command IDs: `stepped|replayed|…|not_planned`. `api.finish_operation(p_attempt_id, p_fence, p_operation_id, p_outcome, p_input_tokens, p_output_tokens, p_returned_model, p_request_id)`: `completed` moves the operation then settles it as `evidence`; `noncharge` (with a request ID) moves it then settles `noncharge`; ambiguous outcomes are Story 2.8's. `api.finish_attempt(p_attempt_id, p_fence, p_to, p_result_digest default null)`: `failed` ends the lease and moves the attempt to `failed/step_failed` (its `dispatched` operations stay chargeable); `completed` first rechecks the bound revision against the Project's current one (a mismatch ends the lease `revoked` with detail `stale_revision`, fails the attempt `step_failed` and answers `rejected`), refuses `open_operations`, then ends the lease `completed`. Every fenced command (`renew_lease`, `run_step`, `finish_operation`, `finish_attempt`) checks in this order: the lease by fence belongs to the attempt (`fence_mismatch`), is not ended (`cancelled|expired|revoked` by its end reason), has `expires_at` in the future (`expired`), the attempt is `running`, authority with the bound epoch, the Project held; a failed authority ends the lease and cancels the attempt (`account_disabled`) before answering `revoked`. `api.record_callback(p_jti, p_issuer, p_kid, p_typ, p_command, p_attempt_id, p_digest)`: `recorded|duplicate|revoked`, as `api.record_heartbeat` (a revoked key is refused under the shared key lock). `api.claim_outbox(p_limit default 20, p_outbox_id default null)`: leases for publishing (`publish_until` 60 s ahead) with `for update skip locked` the unpublished rows older than 15 s whose lease is free, or the one named row at any age, returning them. `api.mark_published(p_outbox_id, p_message_id)`: sets `published_at` and `message_id` once (`marked|replayed|conflict`). `api.sweep_attempts()`: ends every live lease past its expiry (`expired`) and moves its attempt to `failed/lease_lost`; cancels every `waiting` or `running` attempt whose Account is disabled or whose epoch differs from the bound one (`account_disabled`, lease `revoked`); settles `unused` the abandoned operations that hold reservations; returns the counts. `api.cancel_account_jobs(p_account_id)`: the authority-free cancellation of every open attempt of the Account in the same way, writing ONE audit event `jobs.cancelled` (actor `system:jobs`, target `account:<id>`) when it cancelled any; safe to run twice. **Publishing and the step:** `lib/job-dispatch.ts` publishes `{attempt, instance}` to `<APP_ORIGIN>/api/dispatch` with `@upstash/qstash` `Client.publishJSON` with `retries: 0` and the outbox ID as the deduplication ID, right after `submit_job` (best effort: a failure leaves the row for the sweep) and in the sweep for every claimed row, then `mark_published`. The route `app/api/dispatch/route.ts` verifies the QStash signature, the body (`{attempt, instance}`), `INSTANCE_ID` and `checkInstanceIdentity` as `app/api/jobs/route.ts` does, claims the attempt as the built-in step and runs the test workload: for each planned operation in order run its own step and ordinal (`run_step`, then `finish_operation` completed with 1 input and 1 output token and the requested model), or with no operation begin the one step `work`, then `finish_attempt` `completed` with `sha256('nova3d-test-workload:v1:' || input digest)`, or `failed` when the plan says `fail` after dispatching its first operation; a duplicate delivery gets `already_claimed` and does nothing. The minute task `outbox-sweep` (cron `* * * * *`, 60 s) in `lib/schedules.ts` and `lib/job-tasks.ts` runs `sweep_attempts` and publishes the claimed rows. **Signed worker commands:** `app/api/workers/route.ts` takes one JSON command and a Bearer token (a new token type `worker-command`, issuers `cad-worker` and `engine-worker`, audience `application`, environment `INSTANCE_ID`, claims `cmd` `register|claim|renew|step|operation|finish`, `dig` the SHA-256 of the raw body, `att`, `fence`, `rev`, `wid`, lifetime at most 300 s, skew at most 60 s). It verifies in this order: size, token with the issuer's key set from `SERVICE_KEYS_<ISSUER>` (active key, or the retiring key before its `until`; a revoked key refused), `dig`, `api.record_callback` (a replayed `jti` is refused), then runs the command; a failed verification answers one reasonless 401 and writes nothing, and fenced failures answer 409 with the outcome word. **Cancellation on disable:** `lib/job-cancellation.ts` registers a canceller named `jobs` (`registerCanceller`) that calls `api.cancel_account_jobs` and returns the count; `instrumentation.ts` imports it for the Node runtime. **Alarms:** `api.alarm_observations()` also reports the age of the oldest unpublished outbox row and of the oldest live lease expired more than 300 s ago; `lib/alarm-conditions.ts` gets `outbox-age` (over 120 s) and `lease-expired-unclaimed` (over 300 s) with copy keys in both locales. **Screens:** `/progress` becomes the In-progress overview (J-01: no Jobs, several Jobs, mixed states, the "Prints in Progress — Coming later" placeholder kept) and `/progress/[jobId]` the Job detail (J-02: waiting, running, completed, failed, cancelled, stale result rejected), both reading `api.list_jobs` and `api.read_job_detail`; a failure shows the stage, the known cause, the preserved state, the cost impact when known and the next action in plain words, with no automatic retry implied; cancel is a Server Action with an idempotent command ID behind a confirmation. The page refreshes itself every 10 seconds while the Job is open (paused while hidden) and has a refresh button. English and Hebrew copy (`job.*` keys), light and dark, phone and desktop, 44 px targets, no horizontal scroll. `api.preflight` is re-created from the latest merged one keeping every earlier statement, with a Story 2.7 block (the four new tables, the constant functions and the fifteen new signatures) raising `N3020`; end with `notify pgrst, 'reload schema'`. **Typed modules:** `lib/job-commands.ts` is the only caller of the fifteen new functions (added to the four `callApi`/`callRow` allow-lists on purpose); `lib/job-dispatch.ts`, `lib/worker-commands.ts` and `lib/job-cancellation.ts` call it; `lib/job-view.ts` is client-safe. `lib/job-tasks.ts` and `lib/jobs.ts` name neither `job-records` nor `usage-reservations`.

**Ask First:** Any new npm dependency or environment variable; pushing a dispatch to a worker (workers claim, nothing pushes); attempt-scoped gateway tickets and staged worker outputs (left to the first real worker); a retry action on the screens; automatic retry in any form; ambiguous outcomes or reconciliation; extra stored reasons or states; paid kinds, providers or research steps; notifications (Story 2.10); raising the concurrency limit; any audit event beyond `jobs.cancelled`; changing `api.accept_job`, `api.read_job` or `jobs.derived_reason`; any step against staging, production, Railway, GHCR, Upstash or Backblaze.

**Never:** A second claim for an attempt; reclaiming a terminal attempt; publishing a result without a live lease, a matching fence, authority and a current revision; trusting QStash, Redis or the client for authority; inferring a caller from a Project ID; a retry that skips the gate; a cancel that starts a new external step; a float or a hidden amount in a screen; a real provider call; editing a finished row; reading `jobs` rows from application code other than through the commands; editing an expectation to make a test pass except the pins this spec names.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Submit | A new command, live Project, a free `test_workload` | One Job, attempt 1 `waiting/accepted`, one outbox row pinning epoch, revision and version; `accepted`; published once at once | N/A |
| Submit with a plan | One planned operation under a fixture schedule | The Job, the step, the `planned` operation, its reservation and the outbox row commit together | N/A |
| Submit refused | The reservation is refused (allowance, caps, unknown rate, bound) | `refused` with the word and the cost block; no Job, outbox row, operation, reservation or receipt | Fix the plan |
| Capacity | A fourth Job with a `waiting` or `running` attempt | `at_capacity` with the count and 3; nothing written | Wait |
| Replay / reuse | The same command / another kind, Project, digest, plan or version | `replayed`, one Job / `reused`, nothing written | N/A |
| Invalid | A kind other than `test_workload`, a bad plan, ID, digest or version | 22023; nothing written | Fix the call |
| Outbox | Any new attempt, including a retry | Exactly one outbox row in the same transaction; a missing row cannot exist | N/A |
| Publish | The request, then the sweep; the row is published, already published, or the publish failed | Published once (outbox ID as deduplication ID); a published row is skipped; a failed one is claimed again after 60 s; never two message IDs | Next sweep |
| Claim | A waiting, executable attempt | `running`, stage `started`, a 120 s lease, a fence; a second claim `already_claimed`; the same worker again `replayed` with its fence | N/A |
| Waiting for a worker | A pinned version nobody serves | Reads `awaiting_worker`; claim `waiting_for_worker`; a compatible registered worker lets it run; a retired, other-version or other-kind worker is `incompatible` | Register |
| Gate | A retry while an earlier operation is chargeable | Claim `blocked`; reads `awaiting_reconciliation` | Reconcile |
| Run | A claimed test workload with one planned operation | Step, dispatch, completion, evidence settled, unused remainder released, attempt `completed`; the reservation figure falls, history unrewritten | N/A |
| Failed step | The plan says `fail` | `failed/step_failed`; a dispatched operation stays chargeable; no new attempt appears by itself | User retries |
| Lease | A renewal in time / none for 120 s | Expiry moves to 120 s from now / the sweep ends the lease `expired` and fails the attempt `lease_lost`; a late renewal, step or finish is refused and publishes nothing | Retry |
| Fence | A wrong or foreign fence, an ended or expired lease, a changed revision at publication, a raised epoch, a tombstoned Project | `fence_mismatch` / `cancelled`, `expired`, `revoked` / `rejected` with the attempt failed and detail `stale_revision` / `revoked` and the attempt cancelled / `unavailable`; nothing published | N/A |
| Signed commands | A valid command; a replayed `jti`, wrong environment or audience, bad signature, revoked or non-active key, a retiring key past its window, expiry above 300 s, skew above 60 s, a digest mismatch, an unknown command | The valid one runs; every other is one reasonless 401 and writes nothing; a retiring key works inside its window | N/A |
| Cancel | A running Job; a waiting one; one already terminal; again | The lease ends first, then `cancelled/user_cancelled`, planned operations abandoned and settled `unused`, dispatched kept held, no new step starts; `replayed`; `not_cancellable` with the state | N/A |
| Disable | The Account is disabled with waiting and running Jobs | The canceller cancels them all (`account_disabled`), one audit event, dispatched reservations held; if it did not run, the next sweep does; twice is safe | N/A |
| Sweep | Run twice, or two at once | Rows published once, leases expired once; counts reported; no double side effect | N/A |
| Alarms | An unpublished row older than 120 s; a lease expired more than 300 s | `outbox-age` and `lease-expired-unclaimed` raise and clear | N/A |
| Reads | `read_job_detail`, `list_jobs` | State, stage and reason equal the records (with `awaiting_worker`); cost, progress and ending shown; a foreign, unknown, deleted or tombstoned Project's Job is `unavailable` or absent | N/A |
| Authority / hidden | A stale epoch, disabled or tombstoned Account, a foreign Job | `denied` / `unavailable`; nothing written or revealed | N/A |
| Concurrency | Two claims; a cancel against a claim and against a finish; duplicate submits; two sweeps; a tombstone against a step | One claim; one winner and a consistent answer; one Job; one publish; a tombstone never lets a step land after it | N/A |
| Immutability / closure | Update or truncate a protected row; a browser role or the gateway | Refused / no privilege; delete (purge) allowed | N/A |
| Screens | J-01 and J-02 in every state, both locales and themes, phone and desktop | Readable, no overflow, 44 px targets, the cancel confirmation, no automatic retry implied, announced changes | N/A |

</frozen-after-approval>

## Code Map

- `supabase/migrations/20261031120000_durable_dispatch.sql` -- new. Command skeleton `job_records.sql:512-571` (`accept_job`), helpers `jobs.hold_project` `:438`, `jobs.command_digest` `:459`, `jobs.record_command` `:474`, `jobs.charge_open` `:388`, `jobs.derived_reason` `:406`, `jobs.public_state` `:421`; triggers `jobs.check_step` `:237`, `jobs.check_operation` `:287`, `jobs.guard_operation_change` `:309`, `attempts_guard` `:178` (an attempt's moves; `started_at` and `ended_at` once); `jobs.commands.kind` check `:349`; `api.begin_step` `:589` (running only, `:669`), `api.advance_operation` `:708`, `api.move_attempt` `:840` (reasons `:855-863`, abandoning planned operations `:946-951`), `api.request_retry` `:988`; closed schema blocks `:368-379`, `:1468-1470`. Usage side `usage_reservations.sql`: `api.reserve_cost` `:693`, `api.settle_cost` `:912` (class to state map `:1014-1019`: `evidence` completed, `noncharge` noncharge, `unused` abandoned), the `(id, account_id)` key on `jobs.operations` `:155`. Patterns to copy: `api.record_heartbeat` `alarms.sql:542-570` and `artifacts.ticket_redemptions` `file_gateway.sql:163-210` (replay and revoked-key check under `nova3d:service-key:<issuer>:<kid>`), `api.claim_ledger_events` `tombstones_and_ledger.sql:656` (claim and finish), `api.alarm_observations` `alarms.sql:476-532`. `api.preflight`: the latest in the merged tree (it is re-created by every migration; this one must keep every statement of the newest earlier one, including Story 2.5's, so rebase before merging).
- `lib/job-commands.ts`, `lib/job-dispatch.ts`, `lib/worker-commands.ts`, `lib/job-cancellation.ts`, `lib/job-view.ts` -- new. Typed-call style `lib/job-records.ts` and `lib/usage-reservations.ts` (`callRow`, `oneOf`, `requireUuid`, `unexpected`, `requireOperation` from `lib/accounts.ts:324-400`). Signing: add `worker-command` claims and `signWorkerCommand` to `lib/service-signing.ts` beside `signHeartbeat` `:471` (strict `*ClaimsOf`, the module imports only `node:crypto`); key sets `parseKeySet` `:118`; `verifyToken` `:264` with `isRevoked`. Routes copy `lib/jobs.ts` (QStash `Receiver`, instance checks) and `app/api/jobs/route.ts`; machine paths `lib/public-paths.ts:19-20`. Scheduler `lib/schedules.ts` (registry; header `:13` reserves this task), `lib/job-tasks.ts:159`, `scripts/schedules.mjs`. Alarms `lib/alarm-conditions.ts:34,71-77,186`, `lib/lifecycle.ts:596`, `lib/operations.ts:22-29`, copy near `lib/i18n/en.ts` and `he.ts` `~805-810`. Canceller `lib/authority.ts:106,135`, `app/admin/accounts/actions.ts:102`, `instrumentation.ts:4`.
- Screens: `app/progress/page.tsx` and `components/nova-dashboard.tsx:112-148` (the placeholder), nav `components/shell/shell.tsx:22-26`, CSS `.job-list` and `.progress-track` `app/globals.css:662,790-801`; model the detail on `app/projects/[projectId]/page.tsx`, `components/projects/project-overview.tsx`, `components/ui/{status-badge,states,explain}.tsx`, the action on `app/projects/actions.ts:58` with `lib/project-view.ts:193` command IDs and `components/use-usage-action.ts`; `lib/usage-view.ts:49` `formatDollars` (pinned to three callers: change on purpose). Copy keys `job.*` in both catalogs (Hebrew bans Latin words: use `{placeholders}` with `isolateLtr`); pins `tests/unit/i18n.test.ts`, `page-guards.test.ts:72-83`.
- Pins to change on purpose: preflight count 54 to 69 (Story 2.5 is merged and counts 54; this story adds fifteen) in `alarms.test.ts:905`, `usage-limits.test.ts:1673`, `job-records.test.ts:2176`, `request-revisions.test.ts:1371`, `picture-sets.test.ts:1692`, `usage-reservations.test.ts:2304`, `file-gateway-db.test.ts:1783`; `accounts.test.ts:53-124` (apiFunctions, equality `:176-184`); `isolation.test.ts:135-251` (a body per function); `job-records.test.ts:167-178` (five tables to nine), `:212-238` (function list), the truncate guards `:1760`, the test "adds a step and an operation to a running attempt only" `:499` (now waiting or running); `usage-limits.test.ts:179`; `gate-structure.test.ts`: allow-lists `:1038,:2270,:2595,:2969`, routes `:2615,:3154,:3664,:4035,:4562`, key readers `:1635-1637,:2799-2800`, scheduler lists `:1441-1449`, the 2.11 and 2.6 name bans `:4034-4037,:4585`, the `lib/jobs.ts` env list `:1429-1439`, the dependency lists stay; `schedules.test.ts:85-103,149,353,545`, `job-tasks.test.ts:53`, `alarm-conditions.test.ts`, `service-signing.test.ts`, `docs/staging.md:81-82` (row and schedule), README rows `:57-58`. Cleanup, outbox, leases and callbacks first: `tests/support/accounts-data.ts:113-135`, `forged-session.ts:336-345`, `usage-ledger.ts` `removeLedger`, `scripts/seed-projects.mjs:100-112`, `tombstones.test.ts` hand deletes.
- Tests to write: `tests/integration/job-dispatch.test.ts` (every row), `tests/unit/job-dispatch.test.ts`, `worker-commands.test.ts`, `job-view.test.ts`, page and action tests, `tests/e2e/jobs-progress.spec.ts`; helpers `tests/support/job-world.ts` (a fake publisher that records and can fail, a test worker signing as `cad-worker` with `tests/support/service-keys.ts`). Copy `job-records.test.ts` and `usage-reservations.test.ts` (two connections, lock waits) and `picture-review.spec.ts` / `usage.spec.ts` (axe per variant, 44 px, Hebrew).
- Left for others: Story 2.8 reconciles ambiguous charges and settles past 24 hours in the same sweep; Story 2.10 notifies on terminal states; Story 2.5 (built beside this) re-matches permissions inside `reserve_cost`, so `jobs.reserve_planned` is the one place to add its argument; the first Railway worker adds push delivery, attempt-scoped gateway tickets, staged outputs and the registry of image digests; the retry action and a retry's own reservations come with the first paid kinds.

## Tasks & Acceptance

**Execution:**
- [x] `supabase/migrations/20261031120000_durable_dispatch.sql`, `docs/staging.md` -- tables, guards, trigger, relaxed planning triggers, constants, the fifteen commands, reads, alarm observations, preflight, migration and schedule rows -- AC-1 to AC-7
- [x] `lib/job-commands.ts`, `lib/job-dispatch.ts`, `lib/worker-commands.ts`, `lib/job-cancellation.ts`, `lib/service-signing.ts`, `app/api/dispatch/route.ts`, `app/api/workers/route.ts`, `lib/schedules.ts`, `lib/job-tasks.ts`, `lib/public-paths.ts`, `instrumentation.ts`, `lib/alarm-conditions.ts`, `lib/lifecycle.ts`, `lib/operations.ts` -- typed calls, publisher, step, signed endpoint, canceller, task, conditions -- AC-1 to AC-7
- [x] `app/progress/**`, `components/**`, `lib/job-view.ts`, `lib/i18n/en.ts`, `lib/i18n/he.ts`, `app/globals.css` -- J-01, J-02, the cancel action, copy -- AC-1, AC-4
- [x] `tests/` -- every matrix row (integration, unit, e2e, helpers), the pins above, cleanup helpers -- all ACs
- [x] `README.md`, `docs/authority-contract.md`, `docs/secrets.md`, `docs/provisioning.md` -- dispatch, leases, fencing, cancel and disable, the sweep, readers of `QSTASH_TOKEN` and `SERVICE_KEYS_*` -- housekeeping
- [x] `_bmad-output/implementation-artifacts/deferred-work.md` -- push delivery and worker URLs, attempt-scoped tickets and staged outputs, retry action and retry reservations, notifications, the QStash destination binding, sweep settling past 24 hours, closed kind list -- housekeeping

**Acceptance Criteria:**
- Given an accepted Job followed by a browser close or a dispatcher restart, when dispatch resumes, then the committed outbox and unique receipts keep it waiting, running, completed, failed or cancelled without a duplicate side effect, and its state is readable on phone and desktop.
- Given a failed test-workload step, a lost lease or a duplicate delivery, when the workflow and queue are exercised, then failed work stays terminal until an explicit retry, duplicates return receipts, and an interrupted failure preserves approved state with cause, cost and next action.
- Given a signed command with a stale revision, a revoked epoch, an expired lease, an invalid signature or the wrong environment, when it is presented, then it is rejected and nothing is published; a valid one binds nonce, digest and attempt within five minutes and 60 seconds of skew; a revoked or non-active key is refused and a retiring key only inside its window; a missing compatible worker leaves the Job waiting with a reason.
- Given a running Job that the user cancels or whose Account is disabled, when it commits, then commit authority is revoked first, no new external step starts, the Job reaches cancelled with approved state preserved, only demonstrably unused allowance is released, held reservations stay held, and the disable leaves one audit event.
- Given a Job whose operations complete, when completion is committed, then actual usage settles against the reservation and the unused remainder is released without rewriting history.
- Given an unpublished outbox row older than 15 seconds, when the sweep runs, then it is published exactly once, a published row is skipped, an expired lease becomes an interrupted failure, and an outbox age over 120 seconds or a lease expired for 5 minutes raises the alarm.

## Spec Change Log

- 2026-10-29, before implementation: Story 2.5 is now merged (`fffc4cc`, migration `20261030120000_bind_provider_permission_to_operation.sql`). Consequences for this story, none touching the frozen intent: (1) the newest `api.preflight` to copy is the one in that migration (54 `api` signatures plus the `provider_private.permissions` probe and the Story 2.5 migration probe); (2) `api.reserve_cost` now has a 12-argument form that refuses any permissioned provider (`provider_private.is_permissioned_provider`) and an 18-argument form that takes the live grant, so `jobs.reserve_planned` keeps calling the 12-argument form for the unpermissioned test workload and a plan naming a permissioned provider is `refused` with the refusal word it returns (no permission argument is added in this story); (3) `provider_private` is a closed schema, so new closure and schema-grant lists in the older integration tests must keep it; (4) the new migration is `20261031120000_durable_dispatch.sql`, after `20261030120000`.
- 2026-11-02, review (iteration 0; Blind Hunter, Edge Case Hunter and Verification Gap, each on the code diff; no intent_gap and no bad_spec, so no loop-back): **patched in place**, with two additive, defaulted parameters on commands the frozen text lists, so every call written to the frozen text still works: `api.claim_attempt(p_attempt_id, p_worker_id default null, p_issuer default null)` answers `incompatible` for a registered worker whose issuer is not the verified token issuer (a key of one issuer could claim as another issuer's worker); `api.finish_attempt(..., p_revision bigint default null)` takes the signed `rev` claim and treats a completion naming another revision as the stale-revision case (AC-3: a signed command with a stale revision is rejected). Also patched: `jobs.cancel_attempts` uses the sweep's predicate (Account not active, or epoch not the bound one) for a single Account, so a late canceller cannot cancel a re-enabled Account's Jobs; the sweep also ends an expired live lease whose attempt is no longer running; `runOutboxSweep` publishes even when the database sweep fails and then fails the run; a cancelled Job whose lease ended `revoked_epoch` or `tombstoned` no longer reads "your Account was switched off" (`job.cause.authority_changed`); the cancel dialog says something for the `invalid` answer; the plan size is measured as the database measures the jsonb text; a Job with no planned operation shows no determinate progress bar; the card isolates the Project title; the list announcement carries its locale. Tests added: the real QStash publisher against a stubbed `fetch`, the Story 2.7 preflight failure paths, the proxy rewrite of an undecodable Job link, the seed script's removal of a claimed attempt. Test support: `usage-reservations` and `job-records` now give back the sessions they borrow after each test (they alone held about 71 and 42 database connections, and with the new file on the second worker the suite ran out of the 97 usable ones). **Known-bad states avoided / KEEP:** keep the lease ended first on cancel, the outbox trigger, `jobs.reserve_planned` as the one reservation call, the fence checks in their stated order, `released - settled` in the cost block (a settlement's released amount is always the whole reservation), and replay of a claim by the same worker for an ended lease (the spec says so; the fence is worthless once the lease has ended). **Deferred** (entries in `deferred-work.md`): redelivery of a published but unclaimed dispatch, waiting attempts of a deleted or tombstoned Project (nothing deletes a Project before Story 8.x), worker discovery and the pinned worker version, the pre-migration backfill, a poison operation in the sweep, the list-card wording of a rejected result, and the refresh and announcement e2e cases.

## Design Notes

The outbox is a trigger, not a convention: every attempt that exists has a row that committed with it, so "accepted" and "dispatchable" cannot diverge, and a retry gets one without a second code path. Publication is idempotent twice over (the outbox ID as the queue's deduplication ID, and `mark_published` once), so the request and the sweep can race. The fence is a random token handed out once; a copy of it with an ended lease is worth nothing, and the lease is ended before anything else on cancel and disable, so a late result has nowhere to land. The disable path has two layers, the in-process canceller and the sweep that cancels any attempt whose Account has moved on, because cancellers live in one process.

```
submit_job   -> Job + attempt 1 + outbox (+ planned operation + reservation)   one commit
request      -> publish {attempt}  (best effort)      sweep -> publish rows older than 15 s
dispatch     -> claim (lease 120 s, fence) -> run_step -> finish_operation (settle) -> finish_attempt
cancel       -> end lease -> attempt cancelled -> planned operations abandoned -> settle unused
```

## Verification

**Commands:**
- `npm run typecheck && npm run lint && npm run build` -- expected: exit 0
- `supabase db reset && npm test` -- expected: unit and integration pass, every matrix row covered
- `CI=1 npm run test:e2e` (stack started as CI does, fake Google active) -- expected: all existing flows pass on both projects and the new Job screens pass axe in every variant
- `node scripts/ci/check-repository.mjs && npm run render:provisioning -- --check && npm run test:env` -- expected: exit 0

**Manual checks (if no CLI):**
- None: no screen starts a Job yet. Inspect that `\dt jobs.*` shows nine tables after `supabase db reset` and that `select * from api.preflight(...)` as the service role raises nothing.

## Suggested Review Order

**The durable record (start here)**

- The outbox is a trigger: every attempt that exists has a row that committed with it.
  [`durable_dispatch.sql:274`](../../supabase/migrations/20261031120000_durable_dispatch.sql#L274)

- One command commits the Job, its planned reservations and the outbox row, or nothing.
  [`durable_dispatch.sql:698`](../../supabase/migrations/20261031120000_durable_dispatch.sql#L698)

- Reservations go through one internal call, so the later permission argument has one home.
  [`durable_dispatch.sql:557`](../../supabase/migrations/20261031120000_durable_dispatch.sql#L557)

- The new tables: nine in `jobs` now, each immutable except its one stated change.
  [`durable_dispatch.sql:191`](../../supabase/migrations/20261031120000_durable_dispatch.sql#L191)

**Claiming and the fence**

- Claim once, under a lease and a fence; a worker is bound to its signing issuer.
  [`durable_dispatch.sql:1176`](../../supabase/migrations/20261031120000_durable_dispatch.sql#L1176)

- Every fenced command checks lease, expiry, state, authority and Project in one fixed order.
  [`durable_dispatch.sql:588`](../../supabase/migrations/20261031120000_durable_dispatch.sql#L588)

- Completion rechecks the revision, including the signed `rev` claim, before anything lands.
  [`durable_dispatch.sql:1554`](../../supabase/migrations/20261031120000_durable_dispatch.sql#L1554)

- A step dispatches only an operation that is planned and reserved.
  [`durable_dispatch.sql:1366`](../../supabase/migrations/20261031120000_durable_dispatch.sql#L1366)

**Cancel, disable and the sweep**

- Cancel ends the lease first, then the attempt, then releases what never went out.
  [`durable_dispatch.sql:852`](../../supabase/migrations/20261031120000_durable_dispatch.sql#L852)

- Disable has two layers; both use one predicate so a re-enabled Account is safe.
  [`durable_dispatch.sql:1764`](../../supabase/migrations/20261031120000_durable_dispatch.sql#L1764)

- The sweep: authority before expiry, orphan leases ended, abandoned reservations released.
  [`durable_dispatch.sql:1812`](../../supabase/migrations/20261031120000_durable_dispatch.sql#L1812)

- Publishing is leased for 60 seconds with skip-locked, so request and sweep never double-publish.
  [`durable_dispatch.sql:1682`](../../supabase/migrations/20261031120000_durable_dispatch.sql#L1682)

**Publishing, the step and signed workers**

- The real queue call: no queue retries, and the outbox ID is the deduplication ID.
  [`job-dispatch.ts:102`](../../lib/job-dispatch.ts#L102)

- The sweep publishes even when the database sweep fails, then fails the run visibly.
  [`job-dispatch.ts:192`](../../lib/job-dispatch.ts#L192)

- The dispatch route claims as the built-in step and runs the test workload.
  [`job-dispatch.ts:351`](../../lib/job-dispatch.ts#L351)

- Signed worker commands verify in a fixed order and answer one reasonless 401.
  [`worker-commands.ts:286`](../../lib/worker-commands.ts#L286)

- The token carries `rev` and the verified issuer into the database calls.
  [`worker-commands.ts:188`](../../lib/worker-commands.ts#L188)

- The only caller of the fifteen new functions; plan size is measured as the database measures it.
  [`job-commands.ts:142`](../../lib/job-commands.ts#L142)

- Signing the new `worker-command` token type.
  [`service-signing.ts:544`](../../lib/service-signing.ts#L544)

**Schedules, alarms and the Account disable**

- The minute task that sweeps and publishes.
  [`schedules.ts:12`](../../lib/schedules.ts#L12)

- Two new alarm conditions: an old unpublished row, a lease nobody ended.
  [`alarm-conditions.ts:193`](../../lib/alarm-conditions.ts#L193)

- The canceller of Jobs registers itself when disabling an Account.
  [`job-cancellation.ts:12`](../../lib/job-cancellation.ts#L12)

**Screens**

- What the user is told: cause, stage and next action, never an invented cause.
  [`job-view.ts:256`](../../lib/job-view.ts#L256)

- Progress is real or absent; no full bar without planned operations.
  [`job-view.ts:238`](../../lib/job-view.ts#L238)

- The In-progress overview.
  [`page.tsx:16`](../../app/progress/page.tsx#L16)

- The Job detail and its self-refresh while the Job is open.
  [`job-detail.tsx:71`](../../components/jobs/job-detail.tsx#L71)
  [`job-refresh.tsx:15`](../../components/jobs/job-refresh.tsx#L15)

- Cancel is a Server Action with an idempotent command ID behind a confirmation.
  [`actions.ts:45`](../../app/progress/actions.ts#L45)

**Tests and support**

- The database matrix: submit, fence, cancel, disable, sweep, concurrency, closure.
  [`job-dispatch.test.ts:255`](../../tests/integration/job-dispatch.test.ts#L255)
  [`job-dispatch.test.ts:1088`](../../tests/integration/job-dispatch.test.ts#L1088)

- The dispatch route and signed commands against the real database.
  [`job-dispatch.test.ts:1354`](../../tests/integration/job-dispatch.test.ts#L1354)

- A fake publisher that records and can fail, and a signing test worker.
  [`job-world.ts:1`](../../tests/support/job-world.ts#L1)

- The Job screens in every state, locale and theme, with axe.
  [`jobs-progress.spec.ts:1`](../../tests/e2e/jobs-progress.spec.ts#L1)

- Connection hygiene: borrowed sessions are given back after each test.
  [`usage-reservations.test.ts:20`](../../tests/integration/usage-reservations.test.ts#L20)
