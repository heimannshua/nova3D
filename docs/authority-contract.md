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

## What this does not do

It does not decide whether a *person* may open a page (that is the live authorization of a request) and it does not authorize file downloads (Story 1.12 builds the gateway on this contract). It deletes nothing: an Account's Workspace is kept when the Account is disabled.

The code is `lib/authority.ts`; the database functions are in `supabase/migrations/20261012130000_account_administration.sql`; the behavior is pinned by `tests/integration/account-administration.test.ts` and `tests/unit/authority.test.ts`.
