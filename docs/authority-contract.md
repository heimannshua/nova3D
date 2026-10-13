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

It takes the Account row `FOR SHARE` and keeps it until the transaction ends. Disabling takes the same row `FOR UPDATE`, so a disable cannot commit between the check and the write: either the publication commits first and the disable then proceeds, or the disable commits first and the check raises `N3010` (`operation authority denied: no_account | disabled | stale_epoch`), and nothing is written. The function is callable by no API role; only SQL that runs as the table owner (a `security definer` function in the `api` schema, say) can reach it.

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

An operation that acts on a Project (a Job for it, a file of it, a status request about it) must name the Project by its ID and ask whether **this** operation may act on it **now**. Story 1.7 provides the resolver for that; Story 1.12's file gateway and Story 1.8's status route register it for the kind of target "project" (neither does yet, and this story wires neither in).

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

Two things follow from how the answer is made. An ID that cannot be a Project's (anything that is not a UUID in its canonical spelling: it is not trimmed, so a padded or encoded one is no ID) is `unavailable` without asking the database at all: nothing can be learned from it, so nothing is asked. And the person's own request has already passed the page gate (`requireActiveAccount`), which checks the Account's authority first, so for a request the gate let through the resolver's `denied` can only mean the authority changed since: it is the answer for a well-formed ID, and an ID that is none says `unavailable` whatever the Account's state (the gate, not the resolver, is what stops a disabled Account).
| `unreachable` | the database did not answer, or answered something that is not an answer (**denied**; and **not** `unavailable`: a person whose database is down is told to try again, never that the Project is not theirs) |

A Project also carries a random 128-bit **status handle** (`projects.projects.status_handle`, unique, never changed). It is Story 1.8's: no function returns it, no page shows it, and nothing in the application reads it until that story defines how it is used. Story 1.8 consults its tombstone guard in addition to `deleted_at` (which hides a Project from every function here; nothing sets it until a deletion exists).

Commands on a Project follow the same shape as everything else here: the Account (from the verified access), a command ID (a UUID), the **expected revision** and a typed payload. The first and so far only one is Rename (`api.rename_project`, `app/projects/actions.ts`). A command that carries a stale expected revision is rejected with the current revision and changes nothing; the same command ID with the same payload answers the original receipt, and with another payload is refused. A receipt does not outlive its Project's visibility: a replay of a command whose Project has since been deleted is `unavailable`, not the original receipt (the Project is locked, and a deleted one refused, before the ledger is read).

## What this does not do

It does not decide whether a *person* may open a page (that is the live authorization of a request) and it does not authorize file downloads (Story 1.12 builds the gateway on this contract, with the Project resolver above). It deletes nothing: an Account's Workspace is kept when the Account is disabled.

The code is `lib/authority.ts` and `lib/project-target.ts`; the database functions are in `supabase/migrations/20261012130000_account_administration.sql` and `supabase/migrations/20261012150000_projects.sql`; the behavior is pinned by `tests/integration/account-administration.test.ts`, `tests/integration/projects.test.ts`, `tests/unit/authority.test.ts` and `tests/unit/projects.test.ts`.
