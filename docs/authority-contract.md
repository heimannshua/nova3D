# The authority contract: what every Job and every file path must ask

Story 1.5 (disable and re-enable account access) defines the check that a long-running operation must pass before it publishes anything or takes a step outside the database. Disabling an Account takes its authority away in one database transaction; this contract is how that reaches work that is already running. It is short on purpose. Read it before you write a Job, a worker, or anything that moves a file for an Account.

## The rule

An operation acts **for an Account, under an epoch**. Before every step that publishes or reaches outside the database, it asks whether that Account still has the authority it started with. If the answer is anything but "yes", the step does not happen. An answer that cannot be got is "no".

## Register under the epoch of the request that started you

Every Account has an **authorization epoch** (`identity.accounts.authorization_epoch`). It only rises. A change of status raises it: disabling raises it, and enabling again raises it once more. Session grants carry the epoch they were issued under, and the live authorization of a request (`api.authorize_session`) carries the Account's current one.

An operation registers under **the epoch of the live authorization that started it**:

```ts
import {operationOf} from '@/lib/authority';

const access = await requireActiveAccount();           // or the access a Server Action received
const operation = operationOf(access.account);        // {accountId, epoch}: the database's, never a request's
```

Store `operation` with the Job (the Job record, the queue message, the file transfer). Never take an Account ID or an epoch from a form, a header or a query string.

## In the application: `authorizeStep`

```ts
import {authorizeStep} from '@/lib/authority';

const decision = await authorizeStep(operation);
if (!decision.allowed) return stop(decision.reason);   // do not publish, do not call out
```

`authorizeStep` calls `api.guard_operation(account, epoch)`. It never throws, and it answers `allowed` only when the database said so:

| reason | meaning |
| --- | --- |
| `disabled` | the Account is disabled |
| `stale_epoch` | the Account's epoch is not the one the operation registered under: a disable or a re-enable (or a revocation by epoch) happened since |
| `no_account` | there is no such Account |
| `tombstoned` | the Account is deleted (Story 1.8): decided first, before anything else about the Account is read; see "The tombstone guard" below |
| `unreachable` | the database did not answer, or answered something that is not an answer (**denied**) |
| `invalid` | the operation is not shaped like one (**denied**) |

Ask **before each step**, not once at the start: an operation outlives the request that began it. Claim, every external call (a provider, a payment, a notification), every file chunk, and the publication of a result are each a step.

An operation that was refused after a disable stays refused **after the Account is enabled again**: re-enabling gives the person a new sign-in and a newer epoch, never an old operation a new life. Start a new operation from a new request.

## In SQL that publishes: `identity.assert_operation_authority`

A SQL function that writes a result (a Job's output, a file's final state) calls this in the transaction of the write, **before** the write:

```sql
perform identity.assert_operation_authority(p_account_id, p_epoch);
-- ... then the insert or update that publishes
```

It refuses a tombstoned Account first (see "The tombstone guard" below), then takes the Account row `FOR SHARE` and keeps it until the transaction ends. Disabling takes the same row `FOR UPDATE`, so a disable cannot commit between the check and the write: either the publication commits first and the disable then proceeds, or the disable commits first and the check raises `N3010` (`operation authority denied: no_account | disabled | stale_epoch | tombstoned`), and nothing is written. The function is callable by no API role; only SQL that runs as the table owner (a `security definer` function in the `api` schema, say) can reach it.

## Cancellation comes after the authority is gone

Disabling revokes the authority first, in `api.disable_account`, and only after that transaction has **committed** does the application send cancellation signals. A story that owns a kind of work registers a canceller for it:

```ts
import {registerCanceller} from '@/lib/authority';

registerCanceller({
  name: 'research-jobs',
  cancel: async ({accountId, epoch}) => {
    // stop this Account's work registered under an epoch lower than `epoch`; return how many Jobs were cancelled
    return stopped;
  },
});
```

Cancellers run best effort and together, each with its own time limit; one that throws or hangs is counted as failed and never stops the others or undoes the disable. A canceller can ask `authorizeStep` and will always find it denying. It must be safe to run twice. The Accounts page shows the number of Jobs cancelled, and says so when a canceller did not finish: that work cannot publish anyway, because the authority is already gone.

## Naming a Project: the target resolver

An operation that acts on a Project (a Job for it, a file of it, a status request about it) must name the Project by its ID and ask whether **this** operation may act on it **now**. Story 1.7 provides the resolver for that; Story 1.12's file gateway registers it for the kind of target "project" (it does not yet, and nothing but the tests calls it). The tombstone guard of Story 1.8 (below) is asked in addition for a named target, through `authorizeTarget`.

```ts
import {operationOf} from '@/lib/authority';
import {resolveProjectTarget} from '@/lib/project-target';

const resolution = await resolveProjectTarget(operation, projectId);   // operation = operationOf(access.account), as above
if (resolution.outcome !== 'resolved') return stop(resolution.outcome); // do not publish, do not move a file, do not call out
```

It asks `api.get_project(account, epoch, project)` every time, so ownership and lifecycle are the database's at the moment of the step, never remembered from the request that started the operation and never cached. The function begins with `identity.assert_operation_authority`, so a disabled Account or a stale epoch is refused there as well. `resolveProjectTarget` never throws and answers `resolved` (with the Account, the Project and its current revision) only when the database said so:

| outcome | meaning |
| --- | --- |
| `resolved` | the Project exists, is this Account's and is not deleted |
| `unavailable` | the Project is another Account's, is deleted, is unknown, or the ID is not an ID at all. These four are **one** answer, with nothing in it: show the same page or send the same refusal for each, so a link cannot be used to find out whether a Project exists |
| `denied` | the Account has no authority for this request (disabled, or under another epoch than the operation's) |
| `unreachable` | the database did not answer, or answered something that is not an answer (**denied**; and **not** `unavailable`: a person whose database is down is told to try again, never that the Project is not theirs) |

Two things follow from how the answer is made. An ID that cannot be a Project's (anything that is not a UUID in its canonical spelling: it is not trimmed, so a padded or encoded one is no ID) is `unavailable` without asking the database at all: nothing can be learned from it, so nothing is asked. And the person's own request has already passed the page gate (`requireActiveAccount`), which checks the Account's authority first, so for a request the gate let through the resolver's `denied` can only mean the authority changed since: it is the answer for a well-formed ID, and an ID that is none says `unavailable` whatever the Account's state (the gate, not the resolver, is what stops a disabled Account).

A Project also carries a random 128-bit **status handle** (`projects.projects.status_handle`, unique, never changed), and so does every Account. No function returns one to a browser and no page shows one; Story 1.8 defines the two ways a handle is used, in "The tombstone guard" below. `deleted_at` hides a Project from every function here; Story 1.8's tombstone guard is consulted in addition (`api.guard_target`), and `api.record_tombstone` is what sets `deleted_at`, together with a tombstone (nothing in the application calls it until Epic 8).

Commands on a Project follow the same shape as everything else here: the Account (from the verified access), a command ID (a UUID), the **expected revision** and a typed payload. The first and so far only one is Rename (`api.rename_project`, `app/projects/actions.ts`). A command that carries a stale expected revision is rejected with the current revision and changes nothing; the same command ID with the same payload answers the original receipt, and with another payload is refused. A receipt does not outlive its Project's visibility: a replay of a command whose Project has since been deleted is `unavailable`, not the original receipt (the Project is locked, and a deleted one refused, before the ledger is read).

## The tombstone guard

Story 1.8 (define tombstones and the hidden-state contract) makes a deleted Account or Project unreachable for every later feature at once, and remembers a deletion outside the rows a restore could roll back. Deleting is Epic 8's (Stories 8.1 to 8.3); this story provides the record, the one writer, the guard, the merge rule, the status route and the ledger.

### Tombstone first, then everything else

A **tombstone** (`lifecycle.tombstones`) holds a target's kind (`account` or `project`), its ID, its status handle, the revision it was recorded at and the time: nothing else, and it is never updated, deleted or truncated. Its one writer is `api.record_tombstone(kind, id)` (typed: `recordTombstone` in `lib/lifecycle.ts`), which nothing in the application calls yet. In one transaction, under a lock on the target's row, it **hides the target first** and only then records the tombstone and queues its ledger event:

| target | the hide | the tombstone's revision |
| --- | --- | --- |
| an Account | the Account becomes `disabled` and its authorization epoch rises by one, which ends every grant and every operation registered under an older epoch; its Auth sessions are deleted too (as `api.disable_account` does), so no refresh token can mint another access token | the Account's epoch after the raise |
| a Project | `deleted_at` is set and its revision rises by one, which hides it from every function | the Project's revision after the raise |

A second call changes nothing and answers the first revision. A tombstoned Account cannot be enabled (the Account guard trigger refuses, and `api.enable_account` answers `not_found`), a tombstoned Project cannot be shown again, and an Account or Project row cannot be inserted with a tombstoned ID: a deleted ID is never reused, and only its opaque identity is kept.

### The guard, in SQL and in the application

In SQL that publishes, `lifecycle.assert_not_tombstoned(kind, id)` raises `N3010` (`tombstoned`). It is the **first** call of `identity.assert_operation_authority` and of `api.guard_operation` (new outcome `tombstoned`), so a tombstoned Account is refused before its row is read, and an api function that already catches a refusal of authority answers `denied` for it with no edit. The Account's epoch guard says nothing about a Project, and later Jobs, files and cache promotion; the tombstone guard and `api.guard_target` do name a Project, but **both are reads**: they answer for the moment they were asked, and a tombstone can be recorded a moment later.

So a step that **writes** for a Project (a Job's result, a file's final state, a cache promotion) must not rely on having asked. In the transaction of its write, and before the write, it asks `lifecycle.assert_not_tombstoned('project', id)` **and holds the Project's row `FOR SHARE`** (`where id = ... and account_id = ... and deleted_at is null`), exactly as `identity.assert_operation_authority` holds the Account's row. `api.record_tombstone` takes the Project's row `FOR UPDATE`, so it waits for a write that holds the row (the write commits first, and the purge that follows removes it) or commits first and the write's lock then finds the Project deleted and refuses. Stories 1.12 and Epic 3 must do this in every function that publishes for a Project; asking `authorizeTarget` from the application before a step is the other half, for the steps that reach outside the database.

In the application, a step that acts on a named target asks `authorizeTarget` (`lib/authority.ts`), which is `api.guard_target(account, epoch, kind, id)`:

```ts
import {authorizeTarget, operationOf} from '@/lib/authority';

const decision = await authorizeTarget(operationOf(access.account), {kind: 'project', id: projectId});
if (!decision.allowed) return stop(decision.reason);   // do not read, write, import, call back or promote anything
```

| reason | meaning |
| --- | --- |
| `disabled`, `stale_epoch`, `no_account`, `tombstoned` | the Account's own answer, exactly as `authorizeStep` gives it (the Account is asked first) |
| `unavailable` | the target is another Account's, unknown, deleted or tombstoned, or the ID is not an ID: **one** answer with nothing in it, so the denial cannot be used to find out whether a target exists |
| `unreachable`, `invalid` | the database did not answer, or the operation or the target kind is not shaped like one (**denied**) |

Every guard rejects **before any other effect** and discloses no content. A server-side step that gets no answer is denied. Ask before each read, write, import, callback and cache promotion, once for each target; nothing is remembered between asks.

### Revisions and stale answers: `lib/hidden-state.ts`

A device (or a worker) that holds earlier answers about a target merges each new status reply `{state, revision}` (`active`, `disabled` or `deleted`) with `mergeStatus`, a pure function with no imports: `deleted` is terminal and never replaced; otherwise the higher revision wins; at equal revisions the more restrictive state wins (deleted over disabled over active); a lower revision never replaces a higher one. An Account's revision is its authorization epoch. A Project's is **its own revision plus its Account's authorization epoch**: both only rise, so the Account's disable and its re-enable each raise the number a Project's next reply carries (and a rename raises it too), and a Project that is `disabled` because its Account is turns `active` again on the reply after the re-enable. (With the Project's own revision alone the two replies would carry the same number and the more restrictive state would stay for ever.) A tombstone's revision is the revision it was recorded at; `deleted` is terminal, so that number never lifts anything. A Project's `disabled` follows its Account.

### The status handle and the status route

Each Account and each Project has a random 128-bit status handle, created with it and never changed. A device that holds one asks `POST /api/status` with `{"handle": "<32 lower-case hexadecimal characters>"}` (in the body, never in a URL, and nothing is logged), without signing in: the Account, or its Auth identity, may be gone, and a deleted handle is answered from its tombstone. The database counts every request first (120 per origin and 1,200 in all, per minute), so guessing a handle is infeasible and rate limited. The proxy lets only a request from the application's own origin through, so the device sends its own `Origin`. Delivering handles to devices is Story 7.4's.

What the route answers, and what a device does with each:

| answer | when | what the device does |
| --- | --- | --- |
| 200 `{"state", "revision"}` (`active`, `disabled` or `deleted`) | a handle that is known | merge it into what it already knows with `mergeStatus`, and act on the merged state |
| 200 `{"state": "unknown"}` | no row and no tombstone holds the handle: this deployment never issued it | nothing: it is no state and not an input of the merge. It is **not** `deleted` (a deleted target answers `deleted` for ever); keep what it knows |
| 400 | the body is not exactly `{"handle": ...}` of at most 256 bytes | a bug in the caller: do not send the same request again |
| 403 | the request did not come from the application's own origin (no `Origin`, a foreign one, or a cross-site fetch); nothing was looked up or counted | send the application's own `Origin`; this says nothing about the target |
| 405 | any method but POST | use POST with a body |
| 429 with `Retry-After` | the origin's or everyone's budget for the minute is spent; nothing was looked up | ask again after that many seconds |
| 503 with `Retry-After` | the database did not answer | ask again later |
| no answer at all (a network failure, a timeout) | | ask again later |

A 429, a 503 or a network failure means **ask again later and keep what you know**: never `unknown`, and never `deleted`. A timeout is not a tombstone (R-8); only a `deleted` answer is.

### The ledger

Every committed Account status or epoch change, invitation or pre-authorization consumption, invitation revocation, recovery redemption and tombstone queues exactly one event in `lifecycle.ledger_outbox` **in the same transaction**, by triggers on the tables themselves, so no path can forget and a rolled-back change leaves no event. An event holds opaque IDs, statuses and revisions only (never an address, a title, a code, a token or a hash of one); a tombstone's carries the status handle. The relay (`relayLedger` in `lib/ledger.ts`, a function: claim, append, mark) copies the events, in order, into a `LedgerStore` as hash-chained objects; a store outage leaves the change in force and the event pending (`api.ledger_pending` counts it). Story 1.9 schedules the relay and Story 8.9 supplies the store. A restore cannot roll the ledger back, because it is outside the database; Story 8.4 replays it before access reopens.

## What this does not do

It does not decide whether a *person* may open a page (that is the live authorization of a request) and it does not authorize file downloads (Story 1.12 builds the gateway on this contract, with the Project resolver above). It deletes nothing: an Account's Workspace is kept when the Account is disabled, and a tombstone only hides (the deletion commands, the manifests and the purge are Stories 8.1 to 8.3; the procedure that proves absence is [deletion-verification.md](deletion-verification.md)).

The code is `lib/authority.ts`, `lib/project-target.ts`, `lib/lifecycle.ts`, `lib/hidden-state.ts` and `lib/ledger.ts`; the database functions are in `supabase/migrations/20261012130000_account_administration.sql`, `supabase/migrations/20261012150000_projects.sql` and `supabase/migrations/20261013120000_tombstones_and_ledger.sql`; the behavior is pinned by `tests/integration/account-administration.test.ts`, `tests/integration/projects.test.ts`, `tests/integration/tombstones.test.ts`, `tests/unit/authority.test.ts`, `tests/unit/projects.test.ts`, `tests/unit/hidden-state.test.ts` and `tests/unit/ledger.test.ts`.
