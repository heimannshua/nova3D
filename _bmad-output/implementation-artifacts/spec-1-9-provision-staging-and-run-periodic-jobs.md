---
title: 'Story 1.9: Provision staging and run periodic jobs'
type: 'feature'
created: '2026-10-14'
status: 'done'
baseline_commit: 'aede81a6d028dd1e2a4afc1e2bd0121a1f0523fd'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-1-context.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-1-8-define-tombstones-and-the-hidden-state-contract.md'
  - '{project-root}/_bmad-output/specs/spec-nova3D-story-1-9/acceptance-criteria.md'
  - '{project-root}/_bmad-output/specs/spec-nova3D-story-1-9/implementation-constraints.md'
  - '{project-root}/docs/staging.md'
  - '{project-root}/docs/secrets.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Housekeeping and recovery still depend on someone remembering them: nothing runs the ledger relay or removes Auth identities that never became Accounts, hosted staging has no pipeline (migrations and the deploy are by hand, and nothing fails when its Auth settings drift from `supabase/config.toml`), and there is no worker image path. Registration can also race a purge that does not exist yet.

**Approach:** Ship five things, none run against a hosted service from here. (1) A schedule registry, a signature-verified `POST /api/jobs` route with immutable receipts and idempotency, and the first two tasks: the ledger relay retry and the dormant-identity purge. (2) An Auth-settings drift check. (3) Staging and manual-only production workflows. (4) A worker image workflow, by digest. (5) Ledger items and a runbook for the accounts and checks only Josh can do. Hosted behavior is proved by fixtures and structure tests here, and by `hosted-*-check` attestations later.

## Boundaries & Constraints

**Always:** Consult `node_modules/next/dist/docs/` before writing Next.js code (AGENTS.md). **Route.** `POST /api/jobs` is the one new route (exact path, exports `POST` only, `force-dynamic`, no CSRF cookie): `lib/public-paths.ts` gains `machinePaths` and `proxy.ts` skips only `originRefusal` for them (a QStash call has no browser Origin); every other proxy rule, and the signature as the only authentication, stay. All provider code lives in `lib/jobs.ts` (the structural test bans `upstash` and `redis` under `app/`). The body is `{"task": <registered id>, "instance": <INSTANCE_ID>}`, at most 1 KB read raw. `Receiver` from `@upstash/qstash` (added as a direct dependency, pinned to the locked 2.11.3) verifies `Upstash-Signature` over the raw body with the current key, then the next. `Upstash-Message-Id` and `Upstash-Schedule-Id` are both required (a message that is not from a schedule is refused). The route answers: 200 `{outcome}` (ran, idle, no_store or duplicate); 400 bad body, unknown task or no schedule ID; 401 missing or invalid signature; 403 `wrong_environment` (instance differs from `INSTANCE_ID`, or `checkInstanceIdentity` fails); 405; 409 `running`; 500 when the task failed (QStash retries); 503 when keys are unset or the database does not answer. It checks, in this order: method (405), keys set (503), signature (401), body and headers (400), environment (403), then the database claim (503, 409 or `duplicate`), then the run (500); so a foreign or invalid call runs nothing and writes no receipt; it logs nothing from the body and never reflects a signature or key. **Receipts.** `lifecycle.job_receipts` (closed like the 1.8 tables: RLS on, no policies, every privilege revoked) holds id, task, schedule ID, message ID, attempt, start, finish, outcome (`ran`, `idle`, `no_store`, `failed`) and a small `json` result of counts and class names only, never an address, ID, key or message. It is unique per (schedule ID, message ID, attempt), and immutable apart from being finished once; no delete, no truncate. `api.claim_job_run(task, schedule_id, message_id, lease_seconds)` is serialized per key (advisory lock) and answers `claimed` (a new attempt), `duplicate` (the latest attempt finished with anything but `failed`) or `running` (unfinished and younger than the lease, 300 s default); an unfinished attempt past its lease, or a `failed` one, is replaced by attempt + 1. `api.finish_job_run(receipt_id, outcome, result)` finishes once. `api.last_job_run(task)` reads the newest finished receipt (for the Story 1.13 alarm). Typed calls are in `lib/lifecycle.ts` (the only caller of `callRow`/`api.*` names besides `lib/accounts.ts`), all service-role-only, `security definer`, `search_path = ''`. QStash documents no scheduled-time header, so the idempotency key is the (schedule ID, message ID) pair (a retry reuses the message ID); two messages for one slot are covered by each task being idempotent. **Registry.** `lib/schedules.ts` (no imports) lists `{task, cron, description}`: `dormant-identity-purge` at `0 3 * * *` and `ledger-relay` at `*/5 * * * *`, both UTC; later stories add their tasks there and in `lib/job-tasks.ts`. `scripts/schedules.mjs` (`list`, `check`, `apply`, using the `@upstash/qstash` client with `QSTASH_URL` and `QSTASH_TOKEN`) makes the live schedules equal the registry (destination `<origin>/api/jobs`, the body above, one schedule per task), exits 1 on drift, and is run by an operator, never by CI. **Tasks** (`lib/job-tasks.ts`). `ledger-relay`: `ledgerPending()` is 0 → `idle` with no store call; events are pending and no store is configured (the real adapter is Story 8.9) → `no_store`, pending count recorded; otherwise `relayLedger` runs once within one lease (at most 50 events) and its report is the result, a store outage included. `dormant-identity-purge`: `api.purge_dormant_identities(limit)` (default 100, 1 to 500, no age parameter) selects Auth identities with no `identity.accounts` row and with `coalesce(last_sign_in_at, created_at)` and any `identity.registration_attempts.last_attempt_at` all older than 30 days, then for each one takes `select … from auth.users where id = $1 for update skip locked` (the lock registration takes first, `api.register_with_code` and `api.consume_preauthorization`), **re-reads** the conditions in a separate statement, deletes the identity, and counts a foreign-key refusal as kept. It returns `{deleted, kept, locked, remaining}` as counts only (each identity in its own sub-block, so one refusal cannot undo the others; the batch is one transaction), and the receipt records them. A registration that finds its identity gone answers a new `no_identity` outcome (not a counted failure) that the register page turns into "sign in again". `api.preflight` is re-created carrying every earlier probe plus the new tables, functions and `has_table_privilege('auth.users','DELETE')`. **Settings drift.** `supabase/config.toml` declares every sign-in method and external provider explicitly (only Google enabled; email, sms, anonymous and every other provider off), `enable_signup`, `site_url`, `additional_redirect_urls` and `otp_expiry`, so `supabase config diff` can see them; `scripts/ci/check-repository.mjs` (already in the baseline job) fails when one is not declared or a provider other than Google is enabled; `scripts/staging-config.mjs` writes a scratch `--workdir` whose site URL and redirect URLs come from `STAGING_SITE_URL` (the committed root block stays loopback). **Workflows** (new files, YAML `${{ secrets.X }}` only, nothing literal): `staging.yml` runs on push to `staging` only, environment `staging`, no cancel-in-progress, `permissions: contents: read`: `supabase link`, `supabase db push`, `supabase config diff --exit-code` against the scratch config, then a POST to `VERCEL_STAGING_DEPLOY_HOOK` so a deployment always follows the migration (Vercel's Git build can fail the `prebuild` preflight when it wins the race). `production-migrate.yml` has `workflow_dispatch` as its only trigger, environment `production`, a required typed instance ID, and stops with a clear message when the project is not provisioned; no other file may name the production environment or push to a production project. `workers.yml` runs on changes under `workers/**`: `scripts/ci/list-workers.mjs` finds each `workers/*/Dockerfile` (none exists yet, so the job is skipped), builds, pushes to GHCR by digest and deploys that digest to Railway. **Docs.** `docs/staging.md` replaces "Nothing in this repository applies anything to a hosted project" with what the workflows now do (and its pinning test changes with it); `docs/secrets.md` registers `VERCEL_STAGING_DEPLOY_HOOK` and `STAGING_SITE_URL`, moves nothing else, and says QStash names are never set in a preview (`lib/environment.ts` adds them to the preview-forbidden names; they are not added to the hosted required list, because the route fails closed); `provisioning/ledger.json` gains `vercel-deploy-hook`, `hosted-pipeline-check` and `hosted-schedules-check`, and `docs/provisioning.md` is re-rendered. No other new environment variable or secret.

**Ask First:** Any step against a hosted service, QStash, Railway, Vercel, GHCR or staging; any secret, variable or dependency beyond those named; a different route path or method, schedule time, retry or lease value; any change to `api.register_with_code` beyond the `no_identity` outcome; the first Railway or Vercel API call (read the provider's current public API reference first and quote the operation; if a deploy-by-digest call usable with a project token cannot be found, stop and ask, leaving that step a documented manual one).

**Never:** Cleanup tasks beyond the two (session grants, step-up nonces, recovery tokens, outbox retention: these stay deferred); the Backblaze ledger adapter or a real store (8.9); alarms (1.13); the file gateway (1.12); production project creation (8.7); restore replay (8.4); changing `/api/health` or the hosted required-variable list; a Railway, Vercel or QStash call written from memory; a literal secret, token or hook URL anywhere; a deployment or migration from any workflow but the two above; editing an expectation to make a test pass except the pins this spec names.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Scheduled run | Valid signature, registered task, this instance, new message | One claim, the task runs, one finished receipt; 200 | N/A |
| Duplicate | Same schedule and message again | 200 `duplicate`, nothing runs, no new row | N/A |
| Still running | Same message while unfinished, inside the lease | 409 `running`; after the lease, attempt + 1 | A `failed` receipt allows a retry |
| Foreign call | Missing, wrong-key or tampered signature | 401, no claim, no receipt | N/A |
| Wrong environment | Body instance not this one, or identity row differs | 403, no claim, no receipt | N/A |
| Bad request | Not POST; body over 1 KB, not JSON, unknown task; no schedule ID | 405 or 400, nothing run | N/A |
| Not configured | Keys unset, or database down | 503, never 200 | QStash retries |
| Task fails | The task throws | `failed` receipt (class only); 500 | Retried by QStash |
| Relay | Nothing pending; pending with no store; pending with store; store down | `idle`; `no_store`; events appended; change kept, rest pending | Next firing resumes |
| Purge, dormant | No Account, 30 days idle, no recent attempt | Identity deleted, counted | N/A |
| Purge, not dormant | Has an Account; or signed in or attempted within 30 days | Kept | A foreign-key refusal is kept |
| Purge vs registration | Same identity, concurrent | One outcome: purge first, registration answers `no_identity`; or registration first, purge deletes nothing | No orphaned Account or Workspace |
| Purge vs other | A different identity in flight | Only the dormant one is deleted | N/A |
| Drift | A declared setting missing or a second provider on; live differs from the scratch config | Check fails; diff exits 1 | N/A |
| Schedules | Live differs from the registry | `check` exits 1 listing it; `apply` makes them equal | Run by an operator |
| Workflows | Push to staging; dispatch; a `workers/` change | Migrate and deploy; production only by dispatch; image by digest | Skipped with no workers |

</frozen-after-approval>

## Code Map

- `supabase/migrations/20261014120000_scheduled_jobs.sql` -- new. Model on `20261013120000_tombstones_and_ledger.sql`: closed table (:71, :201 guard pattern `lifecycle.guard_outbox` :221), `api.ledger_pending` :726 and `claim_ledger_events` :656 (typed composite, grants :980, `notify pgrst`), `api.preflight` :857-971 re-created from `pg_get_functiondef` carrying every probe (the arrays by story :884-936, executable :938-962, `auth.sessions` DELETE :964). Pinned by substring in `administrator-recovery.test.ts:1713`, `tombstones.test.ts:1723`, `session-grants.test.ts:1157`.
- `20261010120100_api.sql` -- `api.register_with_code` :99-243 (lock `perform 1 from auth.users … for update` :134, attempt upsert :136, identity-gone path :199-204 → add `no_identity`), `api.consume_preauthorization` :256-342 (lock :273, returns `none` when gone). `identity.registration_attempts(user_id pk, last_attempt_at)` `accounts.sql:159`, `accounts.user_id` RESTRICT :41, every other table hangs off `identity.accounts`. `auth.users.last_sign_in_at` can be NULL (`tests/support/accounts-data.ts:36`).
- `lib/accounts.ts` (register outcome enum and typed receipt), `app/register/actions.ts:39` and `lib/sign-in.ts:9` (not-signed-in redirect), `lib/lifecycle.ts` (newest typed-call pattern; add `claimJobRun`, `finishJobRun`, `lastJobRun`, `purgeDormantIdentities`), `lib/ledger.ts:164` `relayLedger`, `lib/ledger-fixture.ts`.
- `app/api/status/route.ts` -- the route pattern (capped raw read :25-54, handler :70). `proxy.ts:147-154` (public branch; `originRefusal` :63-66), `lib/request-integrity.ts:114-140` (`origin_missing`), `lib/public-paths.ts:8`. `lib/environment.ts` `checkInstanceIdentity` :389, preview-forbidden names :28. `@upstash/qstash` `Receiver.verify` (`node_modules/@upstash/qstash/index.js:1165`; a missing key throws a plain Error → 503). Docs: signature check on the unparsed body; headers `Upstash-Message-Id`, `Upstash-Schedule-Id`, `Upstash-Signature`, `Upstash-Retried`.
- Pins to change on purpose: `tests/unit/proxy.test.ts:12`; `gate-structure.test.ts` :136-144 and :201-212 (public POST lists), :339-345 (exact path literal in `lib/public-paths.ts`), :948 (no `upstash|redis` in `app/**`), :1024-1026 (`callRow` callers), :1176-1181 (`api.*` names), :1188-1199 (the "no scheduler" pins on `relayLedger`, `claimLedgerEvents`, `ledgerPending` callers); `proxy-gating.test.ts` :425, :914, :1197 (add the machine path); `staging-guide.test.ts:262` (the "applies nothing" sentence) and :128 (only listed CLI commands and flags); `provisioning.test.ts` (rendered doc equality :829, secret scan covers new workflows :1146, names must be in `docs/secrets.md` :1084); `environment.test.ts` and `scripts/test-env.mjs` (preview-forbidden list). `repository-contract.test.ts` reads only `jobs.baseline.steps` of `ci.yml`: add no step there.
- `supabase/config.toml` -- `[auth]` :32-46, `[auth.email]` :49 (`otp_expiry` 900), `[auth.sms]` :56, `[auth.external.google]` :65; no other provider is declared. `tests/unit/supabase-config.test.ts:82` pins the root redirect URLs. `docs/staging.md` :120-132 documents `supabase config diff … --exit-code`. `.github/workflows/ci.yml` runs on every push (CLI 2.120.0 via `supabase/setup-cli@v1`). `vercel.json` builds `staging` only; `scripts/check-env.mjs:21` runs in `prebuild`.
- `provisioning/ledger.json` -- existing items due 1-9: `supabase-cli-credentials` :233, `github-staging-environment` :249 (branches limited to `staging`), `vercel-staging-project` :264, `upstash-account` :403, `upstash-credentials` :419, `railway-account` :462, `ghcr-token` :478, `railway-project-token` :493; new items need a due story, secrets named in `docs/secrets.md` (`GHCR_TOKEN` :281, `RAILWAY_TOKEN` :291, `QSTASH_*` :189-216 already there). `docs/provisioning.md` is generated (`npm run render:provisioning`).
- Tests: `tests/support/accounts-db.ts` (`createHarness`, `inTx`, `attempt`), `tests/integration/accounts-concurrency.test.ts:18` `committedTx`, :38 `waitingOn`, :428-457 (the lock-first purge shape), `tombstones.test.ts:1209` (two real connections). Cleanup helper `tests/support/accounts-data.ts:92` (receipts and outbox rows are append-only: assert on own IDs). Valid test deliveries are signed with the real `Receiver`'s own JWT format (HS256 with test keys, claims `iss` Upstash, `sub`, `jti`, `body` = base64url SHA-256), so no fake verifier is needed; e2e sets the test keys in the web server environment, not in `.env.example`.

## Tasks & Acceptance

**Execution:**
- [x] `supabase/migrations/20261014120000_scheduled_jobs.sql` -- receipts table and guards, claim/finish/last-run functions, `purge_dormant_identities`, `no_identity` in the registration function, preflight carrying every earlier probe -- AC-2, AC-3, AC-4
- [x] `package.json`, `package-lock.json` -- `@upstash/qstash` 2.11.3 as a direct dependency -- AC-2
- [x] `lib/schedules.ts`, `lib/jobs.ts`, `lib/job-tasks.ts`, `lib/lifecycle.ts`, `lib/accounts.ts`, `lib/environment.ts` -- registry, verify-claim-run-finish, the two tasks, typed calls, `no_identity`, preview-forbidden names -- AC-2, AC-3
- [x] `app/api/jobs/route.ts`, `lib/public-paths.ts`, `proxy.ts`, `app/register/actions.ts` -- the machine path and the register redirect -- AC-2, AC-3
- [x] `scripts/schedules.mjs` -- list, check, apply against the registry with an injected client -- AC-2, AC-6
- [x] `supabase/config.toml`, `scripts/ci/check-repository.mjs`, `scripts/staging-config.mjs` -- explicit declarations, the static check, the scratch config -- AC-1
- [x] `.github/workflows/staging.yml`, `production-migrate.yml`, `workers.yml`, `scripts/ci/list-workers.mjs` -- pipelines -- AC-5, AC-7 (the Railway deploy-by-digest call is left a documented manual step: Railway documents no call for it with a project token; Josh chose to keep it manual on 2026-10-15, so AC-7 is only partly met)
- [x] `docs/staging.md`, `docs/secrets.md`, `docs/provisioning.md`, `provisioning/ledger.json`, `README.md` -- runbook, secrets, ledger items -- AC-5, AC-6
- [x] `tests/` -- every matrix row: integration (receipts, claim races with real connections, purge and registration at once, other identity in flight, FK refusal, closure over REST, preflight), unit (signature verification, every status and order of checks, registry, `schedules.mjs` with a fake client, config declarations, workflow structure, `list-workers`), browser (the route over HTTP with a signed call); update the pins above -- all ACs
- [x] `_bmad-output/implementation-artifacts/deferred-work.md` -- the cleanups left deferred (re-mapped), a real ledger store (8.9), alarms (1.13), schedule time not carried by QStash, the Vercel race note, hosted verification of each workflow -- housekeeping

**Acceptance Criteria:**
- Given `supabase/config.toml` and the live staging project, when CI diffs them, then drift in enabled providers, the sign-up setting, redirect URLs or OTP expiry fails the check.
- Given a scheduled task, when it fires twice, or with an invalid signature or for another environment, then one run executes, foreign calls are rejected and every run writes an immutable receipt.
- Given an identity with no Account idle 30 days and a registration for it arriving as the purge runs, when both run at once, then exactly one outcome occurs under the shared lock and nothing is orphaned.
- Given such an identity and a registration in flight for another identity, when the purge runs, then only the dormant identity is deleted.
- Given a push to `staging`, when CI runs, then migrations apply with the CLI and a deployment follows; a production migration can run only from the dispatched workflow.
- Given the provisioning ledger, when this story is accepted, then it names what Josh must create and attest (QStash plan and region, the Railway project, the hook), with nothing created from here.
- Given a change under `workers/`, when CI runs, then an image is pushed by digest and that digest is deployed.

## Spec Change Log

## Design Notes

Receipts are claimed before the task runs and finished once after, like the 1.8 outbox, so "only one run executes" holds without a long transaction and a crash leaves an unfinished receipt that the lease later replaces. The purge locks first and decides after in a second statement because a single `delete … where not exists` would use its pre-lock snapshot (the Story 1.3 note); the RESTRICT foreign key from `accounts.user_id` is the backstop that makes an orphan impossible.

`config diff` only compares what the file declares, so the static check makes the file declare every provider and sign-in method; a provider switched on in the dashboard is then drift. Staging's site and redirect URLs come from a scratch copy because the committed root block must stay loopback.

```
POST /api/jobs   Upstash-Signature: <jwt>  Upstash-Message-Id: msg_…  Upstash-Schedule-Id: scd_…
{"task":"ledger-relay","instance":"<INSTANCE_ID>"}   →  200 {"outcome":"idle"}
```

## Verification

**Commands:**
- `npm run typecheck && npm run lint && npm run build` -- expected: exit 0
- `supabase start && npm test` -- expected: unit and integration pass, every matrix row covered
- `CI=1 npm run test:e2e` (stack started as CI does, fake Google active) -- expected: all flows pass on both projects
- `node scripts/ci/check-repository.mjs && npm run render:provisioning -- --check && npm run test:env` -- expected: exit 0
- `node scripts/schedules.mjs list` -- expected: the two registered schedules, no network call

**Manual checks (if no CLI):**
- With the stack up and test signing keys, POST a signed body to the production build twice: the second answers `duplicate`; read the receipts through `api.last_job_run`. Back-date an Auth identity, run the purge, and confirm it is gone and an Account's identity is not.


## Suggested Review Order

**The signed route (start here)**

- The whole request path in order: method, keys, raw body, signature, body, environment, claim, run, finish.
  [`jobs.ts:154`](../../lib/jobs.ts#L154)

- Verification is the only authentication; the SDK's dev mode is switched off on purpose.
  [`jobs.ts:122`](../../lib/jobs.ts#L122)

- The route is one POST; the proxy skips only the Origin refusal for it.
  [`route.ts:17`](../../app/api/jobs/route.ts#L17)

- The one machine path, and the proxy line that honours it.
  [`public-paths.ts:13`](../../lib/public-paths.ts#L13)
  [`proxy.ts:153`](../../proxy.ts#L153)

**Receipts and idempotency**

- The immutable receipt table: unique per schedule, message and attempt; finished once; never deleted.
  [`scheduled_jobs.sql:62`](../../supabase/migrations/20261014120000_scheduled_jobs.sql#L62)

- Claim is serialized per key: new, duplicate, running, or the next attempt after a failure or lapsed lease.
  [`scheduled_jobs.sql:127`](../../supabase/migrations/20261014120000_scheduled_jobs.sql#L127)

- What a result may hold: counts and single words only.
  [`scheduled_jobs.sql:39`](../../supabase/migrations/20261014120000_scheduled_jobs.sql#L39)

**The two tasks**

- Locks each identity, re-reads dormancy in a second statement, then deletes; the RESTRICT key backstops it.
  [`scheduled_jobs.sql:270`](../../supabase/migrations/20261014120000_scheduled_jobs.sql#L270)

- A registration that finds its identity purged answers `no_identity`, not a counted failure.
  [`scheduled_jobs.sql:354`](../../supabase/migrations/20261014120000_scheduled_jobs.sql#L354)
  [`actions.ts:99`](../../app/register/actions.ts#L99)

- The relay task: idle, no store yet, or relay once; a damaged chain is a failed run.
  [`job-tasks.ts:70`](../../lib/job-tasks.ts#L70)

- The registry both the route and the operator command read.
  [`schedules.ts:20`](../../lib/schedules.ts#L20)

**Keeping QStash equal to the registry**

- Compares live schedules with the registry and deletes only what points at this app.
  [`schedules.mjs:137`](../../scripts/schedules.mjs#L137)
  [`schedules.mjs:239`](../../scripts/schedules.mjs#L239)

**Auth-settings drift and the pipelines**

- The config reader fails closed on any form it does not understand; the static check names every provider.
  [`config-toml.mjs:75`](../../scripts/config-toml.mjs#L75)
  [`config-toml.mjs:172`](../../scripts/config-toml.mjs#L172)

- The scratch config that carries staging's site URL, so the diff compares like with like.
  [`staging-config.mjs:61`](../../scripts/staging-config.mjs#L61)

- Staging: link, migrate, diff, then ask Vercel to deploy.
  [`staging.yml:1`](../../.github/workflows/staging.yml#L1)

- Production migrates only from a dispatch with a typed instance ID.
  [`production-migrate.yml:10`](../../.github/workflows/production-migrate.yml#L10)

- Worker images build and push by digest; the Railway step is manual by decision.
  [`workers.yml:40`](../../.github/workflows/workers.yml#L40)

**Docs and the provisioning ledger**

- Runbook: pipeline, schedules, worker images, and how to verify each.
  [`staging.md:183`](../../docs/staging.md#L183)

- What Josh must create and attest; nothing was created from here.
  [`ledger.json:508`](../../provisioning/ledger.json#L508)

**Tests (peripheral)**

- The purge against registration, with real connections and the re-read proven necessary.
  [`scheduled-jobs.test.ts:735`](../../tests/integration/scheduled-jobs.test.ts#L735)

- Claim races and receipts.
  [`scheduled-jobs.test.ts:270`](../../tests/integration/scheduled-jobs.test.ts#L270)

- Every status and the order of checks on the route.
  [`jobs-route.test.ts:73`](../../tests/unit/jobs-route.test.ts#L73)

- The route over HTTP with a real signature.
  [`jobs.spec.ts:48`](../../tests/e2e/jobs.spec.ts#L48)

- Workflow structure and the no-literal-secrets rule.
  [`workflows.test.ts:30`](../../tests/unit/workflows.test.ts#L30)
