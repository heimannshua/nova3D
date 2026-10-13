---
title: 'Story 1.8: Define tombstones and the hidden-state contract'
type: 'feature'
created: '2026-10-13'
status: 'in-progress'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-1-context.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-1-7-navigate-my-projects-and-project-state.md'
  - '{project-root}/_bmad-output/specs/spec-nova3D-story-1-8/acceptance-criteria.md'
  - '{project-root}/_bmad-output/specs/spec-nova3D-story-1-8/implementation-constraints.md'
  - '{project-root}/docs/authority-contract.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Nothing makes a deleted Account or Project unreachable for every later feature at once, and nothing outside the database remembers a deletion, a disable, a consumed invitation or a recovery, so a restore could bring them back. A Project has a status handle that nothing reads, an Account has none, and a device whose Account is gone has no way to ask what became of it.

**Approach:** Add the Lifecycle-owned tombstone record, one monotonic revision per target and a tombstone guard beside the epoch guard; a transactional outbox with a relay that writes hash-chained events to a ledger-store port (a fixture store until Story 8.9); an Account status handle and an unauthenticated, rate-limited status route; and the written deletion-verification procedure. Nothing in the application creates a tombstone yet: Epic 8's deletion commands will, through the one writer this story provides.

## Boundaries & Constraints

**Always:** Consult `node_modules/next/dist/docs/` before writing Next.js code (AGENTS.md). New tables live in the `lifecycle` schema, which the Data API lists, so each is closed explicitly (RLS on, no policies, every privilege revoked from public, anon, authenticated and service_role) and reached only through `api` functions that only the service role executes, each `security definer` with `search_path = ''`. Tables: `lifecycle.tombstones`, `lifecycle.ledger_outbox`, `lifecycle.ledger_relay`, `lifecycle.status_requests`. A tombstone holds only its kind (`account` or `project`), target ID, status handle, revision and time; it is unique per target and per handle and is never updated, deleted or truncated. `api.record_tombstone(kind, id)` is its one writer, with no caller in the application: idempotent (a second call changes nothing), it locks the target row, takes revision = the target's next revision, and in one transaction hides first (an Account becomes `disabled` with its epoch raised by one, which ends every grant and operation registered under an older epoch; a Project gets `deleted_at` and its revision raised by one), then inserts the tombstone and queues its ledger event. A tombstoned Account cannot be enabled (the Account guard trigger refuses; `api.enable_account` answers `not_found`), and an Account or Project row cannot be inserted with a tombstoned ID (BEFORE INSERT triggers). The guard: `lifecycle.assert_not_tombstoned(kind, id)` raises N3010 `tombstoned` for SQL that publishes and is called first in `identity.assert_operation_authority` and `api.guard_operation` (new outcome `tombstoned`); `api.guard_target(account, epoch, kind, id)` and `authorizeTarget` in `lib/authority.ts` answer `allowed`, the existing denials, `tombstoned` or `unavailable` (a foreign, unknown, deleted or tombstoned Project is the same `unavailable`). Every guard rejects before any other effect and discloses no content. A Server-side step that gets no answer is denied. `lib/hidden-state.ts` (no imports, client-safe) holds the merge rule of two status replies `{state: active|disabled|deleted, revision}`: `deleted` is terminal and never replaced; otherwise the higher revision wins; at equal revisions the more restrictive state wins (deleted over disabled over active); a lower revision never replaces a higher. An Account's revision is its authorization epoch, a Project's is its own revision, a tombstone's is the revision it was recorded at. The Account gets `status_handle` (16 random bytes from `extensions.gen_random_bytes`, unique, not null, immutable, backfilled for existing rows), created with it; no page, payload or function returns a handle to a browser. The outbox: every committed Account status or epoch change (disable, re-enable, recovery's epoch raise), invitation or preauthorization consumption, invitation revocation (a rotation revokes then issues), recovery redemption and tombstone queues exactly one event in the same transaction, by AFTER triggers on the tables so no path can forget; a rolled-back change leaves no event. An event is `{id, type, ...}` holding opaque IDs, statuses and revisions only: never an address, title, code, token or hash of one; a tombstone event carries the handle. Outbox rows are immutable apart from being marked relayed once. The relay (`lib/ledger.ts`, a function: `claim → append → mark`) takes a short lease (`lifecycle.ledger_relay`), appends events in outbox order to a `LedgerStore` port (`head()` and create-only `putIfAbsent(key, body)`; no overwrite, no delete), as `<instance id>/<20-digit sequence>-<SHA-256 of the previous body>.json` with body `{sequence, previous, event, at}` (first object: 64 zeros; `at` is the event's own time, so a retry writes identical bytes), and marks it relayed. It is idempotent (an event already at the head is marked, not appended again), never throws for a store outage (the change stays in force, the event stays pending), and `api.ledger_pending()` reports how many are pending and how old the oldest is. The fixture store is in memory with outage injection. The status route is `POST /api/status` (public, same-origin by the proxy, body `{"handle": 32 lowercase hex}` of at most 256 bytes, so the handle never enters a URL or a log): `api.lookup_status(handle, origin_hash)` counts the request first (120 per origin per minute, 1,200 globally per minute, every request counted, origin hashed as registration does) and answers `{state, revision}`; deleted handles stay answerable from the tombstone. The deletion-verification procedure is `docs/deletion-verification.md`: for each store (database, Storage and object stores, backups, notifications, logs, plus outside providers) how absence is proven, who runs it and when, and where the evidence is kept. `api.preflight` is re-created carrying every earlier probe plus the new ones. No new environment variable or secret.

**Ask First:** Any change to the session-grant functions beyond what this story needs; new environment variables, secrets or external accounts; a different route method, path or rate budget; giving the application any way to create a tombstone or delete data; storing anything but opaque identifiers in a tombstone or event; any step against staging, production or Backblaze.

**Never:** Deletion commands, confirmation screens, manifests, cleanup or purge (Stories 8.1 to 8.3); the Backblaze adapter or a real ledger bucket (8.9); restore replay or the restore lock (8.4); scheduling the relay or registering the pending-count alarm (1.9, 1.13); registering the guard with the file gateway (1.12); delivering handles to devices or purging a device (7.4, 7.5); a handle in a URL, log, page or RSC payload; changing `/api/health`; editing an expectation to make a test pass.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Tombstoned Project | Any Project function, or `guard_target`, for a tombstoned Project | `unavailable`, nothing read or written, same as unknown or foreign | N/A |
| Tombstoned Account | `guard_operation`, `assert_operation_authority`, `authorize_session`, a Project call | `tombstoned` (or the existing `disabled`/`denied`); no sessions; cannot be enabled | N/A |
| Record twice | `record_tombstone` for the same target | Second call changes nothing and returns the first revision | N/A |
| Tombstone immutability | Update, delete or truncate a tombstone | Refused | N/A |
| Reused ID | Insert an Account or Project with a tombstoned ID | Refused, nothing written | N/A |
| Stale reply | Known `deleted`, or known `disabled` at revision 5, then an `active` reply at 4 | Known state kept; `active` at 6 replaces `disabled`; equal revisions keep the more restrictive | N/A |
| Event queued | Disable, enable, consumption, revocation, recovery, tombstone | One outbox event in the same transaction; a rolled-back change leaves none | N/A |
| Relay | Pending events, store up | Hash-chained objects in order; pending 0; a second run appends nothing | Crash after the store accepted: next run marks it, no duplicate |
| Store outage | Store fails during a relay | Change in force, event pending and counted, no throw | Next run resumes in order |
| Two relays | Overlapping runs | One holds the lease, the other reports busy | Lease expires after a crash |
| Status lookup | Active, disabled or deleted handle | `{state, revision}`; deleted answers without authentication after the Auth user is gone | N/A |
| Bad lookup | Unknown handle; malformed body; wrong method; cross-site POST | `unknown` (200); 400; 405; 403 | Database down: 503, never `unknown` |
| Rate limit | Over the origin or global budget | 429 with `Retry-After`, no lookup | N/A |
| Procedure | Deletion work about to begin | `docs/deletion-verification.md` names every store, proof and runner | N/A |

</frozen-after-approval>

## Code Map

- `supabase/migrations/20261013120000_tombstones_and_ledger.sql` -- new. Model on `20261012150000_projects.sql` (closure, triggers, `api.preflight` :346, grants :443, `notify pgrst, 'reload schema'`). Creates the four tables, the guards, triggers, `record_tombstone`, `guard_target`, `lookup_status`, `claim_ledger_events`, `finish_ledger_events`, `ledger_pending`, the Account handle column.
- `20261010120000_accounts.sql` :38 `identity.accounts`; :57 `identity.guard_account` was replaced by `20261010130000_session_grants.sql` :36 (epoch rises; a status change raises it): re-create it from the live `pg_get_functiondef`, adding handle immutability and refusing activation of a tombstoned Account. Invitations :72, preauthorizations :118 (status and `consumed_at`), `identity.record_audit` :230 (audit stays separate: tests pin exact audit lists). The `lifecycle` schema (`20261009120000_instance_identity.sql`) is not covered by the default-privilege revokes of :31-34.
- `20261012130000_account_administration.sql` :89 `disable_account`, :149 `enable_account` (add the tombstone filter), :197 `guard_operation`, :234 `assert_operation_authority`. `20261012140000_administrator_recovery.sql` :58 `recovery_tokens`, :370 `redeem_recovery`. `20261012150000_projects.sql` :87 `guard_project`, :346 `preflight` (re-create carrying every probe).
- `lib/accounts.ts` -- `operationOutcomes` :971 (add `tombstoned`), `guardOperation` :1052, `callApi`/`callRow` :320/:382, `clientAddressFromHeaders` :168, `hashClientAddress` :155. `lib/authority.ts` -- `DeniedReason` :43, `authorizeStep` :59: add `authorizeTarget`.
- `lib/projects.ts` is the pattern for a typed module: `lib/lifecycle.ts` (new) holds `recordTombstone`, `guardTarget`, `lookupStatus`, `claimLedgerEvents`, `finishLedgerEvents`, `ledgerPending`; `lib/hidden-state.ts`, `lib/ledger.ts` (chain, relay, `LedgerStore`), `lib/ledger-fixture.ts` (new).
- `app/api/status/route.ts` (new; Next 16 route handler, `app/api/health/route.ts` is the public pattern), `lib/public-paths.ts` :5 (add `/api/status`).
- Pins to change on purpose: `tests/unit/proxy.test.ts` :12 (the exact public list), `tests/unit/gate-structure.test.ts` :136 (`exempt`), :195 (public routes change nothing: allow the one lookup POST, with its reason), :1034, :1068, :1096 (Story 1.7's bans on `status_handle`, `deleted_at`, `tombstone`, `statusRoute`), :1000 (`callApi` callers) and the literal-name lists :710/:991; `tests/integration/projects.test.ts` :232 (no function returns a handle: `lookup_status` and the tombstone ledger event are the two exceptions, tested); `tests/integration/instance-identity.test.ts` :50 (`lifecycle` tables), `accounts.test.ts` :31 `tables`, :48 `apiFunctions`, the denial lists, `isolation.test.ts` :172 `bodiesAgainst`; cleanup `tests/support/accounts-data.ts` :81 and `tests/support/forged-session.ts` :326 (tombstones and outbox rows have no FK, so they accumulate: assert on own IDs, never on global counts).
- `docs/authority-contract.md` -- add "The tombstone guard" after :76-102 and fix the cut-off table at :96-97; keep the needles pinned at `gate-structure.test.ts` :791/:1105. `docs/staging.md` migration table :62-71, `provisioning/ledger.json` :364 (add the apply-by-hand item; regenerate `docs/provisioning.md`), `README.md` :52 (Lifecycle row), new `docs/deletion-verification.md` (PRD D-3, `epics.md` :1873, AR-21, AD-15 in `ARCHITECTURE-SPINE.md` :132; test it like `tests/unit/staging-guide.test.ts`).

## Tasks & Acceptance

**Execution:**
- [ ] `supabase/migrations/20261013120000_tombstones_and_ledger.sql` -- tables, closure, tombstone writer and guards, anti-reuse and refusal triggers, Account handle, outbox triggers, relay lease functions, status lookup with its counters, preflight carrying every earlier probe -- AC-1, AC-2, AC-3, AC-5, AC-6
- [ ] `lib/hidden-state.ts`, `lib/lifecycle.ts`, `lib/ledger.ts`, `lib/ledger-fixture.ts`, `lib/accounts.ts`, `lib/authority.ts` -- merge rule, typed calls with every answer checked, hash chain and relay, fixture store with outage injection, `tombstoned` outcome and `authorizeTarget` -- AC-1, AC-2, AC-5
- [ ] `app/api/status/route.ts`, `lib/public-paths.ts` -- the public POST lookup (size cap, hex check, no-store, status mapping, nothing logged) -- AC-6
- [ ] `docs/deletion-verification.md`, `docs/authority-contract.md`, `docs/staging.md`, `provisioning/ledger.json`, `docs/provisioning.md`, `README.md` -- the procedure, the guard contract, the staging step -- AC-4
- [ ] `tests/` -- every matrix row: integration (writer, hide order, guards at every path, immutability, reused ID, enable refused, triggers and rollback, lease and two relays, REST closure, preflight, lookup states and limits), unit (merge rule, hash chain and relay with crash and outage, route mapping, documents), browser (route over HTTP, no-store, 403/405/400/503, deleted without a session); update the pins and cleanup helpers above -- all ACs
- [ ] `_bmad-output/implementation-artifacts/deferred-work.md` -- gateway registration (1.12), Epic 8 commands and purge, adapter (8.9), replay (8.4), scheduling and alarm (1.9, 1.13), handle delivery (7.4/7.5), outbox retention, preauthorization withdrawal not ledgered -- housekeeping

**Acceptance Criteria:**
- Given a target marked tombstoned, when any read, write, import, callback or cache-promotion path touches it, then the guard rejects it before any other effect and returns an unavailable state without disclosing contents.
- Given a stale status reply carrying an older revision, when it is compared with a recorded tombstone or disable, then the higher monotonic revision wins and a tombstone is never downgraded.
- Given a deleted Project or Account ID, when a new record is created, then the ID cannot be reused and only its opaque identity is retained for anti-resurrection.
- Given deletion work about to begin, when the verification procedure is reviewed, then an auditable procedure naming each store, the proof of absence and its runner is recorded before purge code ships.
- Given an Account disable, an invitation consumption or a recovery revocation, when it commits, then a ledger event is queued with the change and relayed idempotently, and a ledger store outage leaves the change in force with the event pending and counted.
- Given a deleted Account whose Auth identity no longer exists, when a device presents its cached status handle, then the status route answers deleted without authentication, and guessing handles is infeasible and rate-limited.

## Spec Change Log

## Design Notes

Tombstoning an Account also disables it, so every existing path that already refuses a disabled Account (`authorize_session`, the preference and step-up functions, `issue_grant`) refuses a deleted one with no edit. The explicit tombstone guard is for what the epoch guard cannot see: a Project, and later Jobs, files and cache promotion.

Triggers on the underlying tables queue the events, so Stories 1.3, 1.5 and 1.6 "append through the port from this story on" without rewriting their functions, and a path added later cannot forget. Ledger events stay out of `identity.audit_events`, whose exact lists tests pin.

The relay needs no cross-call transaction: `putIfAbsent` on a key that holds the sequence makes a lost race harmless, the lease keeps order, and an event found at the head is marked instead of appended. A restore cannot roll the ledger back because it is outside the database; Story 8.4 replays it.

A Project's `disabled` reply follows its Account; only the Account's newer epoch lifts it (R-8), which the equal-revision rule gives for free.

```
key  = 7c1e…/00000000000000000002-<sha256 of body 1>.json
body = {"sequence":2,"previous":"<sha256 of body 1>","event":{"id":"…","type":"account_authority","account_id":"…","status":"disabled","epoch":3},"at":"2026-10-13T09:00:00.000Z"}
```

## Verification

**Commands:**
- `npm run typecheck && npm run lint && npm run build` -- expected: exit 0
- `supabase start && npm test` -- expected: unit and integration pass, every matrix row covered
- `CI=1 npm run test:e2e` (stack started as CI does, fake Google active) -- expected: all flows pass on both projects
- `node scripts/ci/check-repository.mjs && npm run render:provisioning -- --check && npm run test:env` -- expected: exit 0

**Manual checks (if no CLI):**
- With the stack up, record a tombstone for a seeded Account and Project through the service role, then POST their handles to `/api/status` and open the Project link: `deleted`, `unavailable`, no sessions. Relay with the fixture store and read the chain back.
