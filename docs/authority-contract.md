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

An operation that acts on a Project (a Job for it, a file of it, a status request about it) must name the Project by its ID and ask whether **this** operation may act on it **now**. Story 1.7 provides the resolver for that. The file gateway (Story 1.12, "The file gateway" below) has a resolver registry of its own and registers `staging` and, since Story 2.12, `retained` ("Retaining pictures", below); the Project resolver arrives with the first story that attaches a file to a Project as a general target, and nothing but the tests calls `resolveProjectTarget` until then. The tombstone guard of Story 1.8 (below) is asked in addition for a named target, through `authorizeTarget`.

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

## Confirming a request: the create command and request revisions

Story 2.1 (confirm natural-language intent and personalization) is the one place a Project is created. Nothing is stored before the person confirms: understanding a description is free and deterministic (`understandRequest`: the matching reads no database, calls no model and no network; the action still runs behind `withActiveAccount`, which asks for the live authorization like every Server Action, and that check does use the database), so an abandoned draft leaves no trace and no Project is ever in a stage that is not true. `confirmRequest` (`app/projects/new/actions.ts`) recomputes everything from the submitted fields, takes the Account from the verified access (`operationOf(access.account)`) and calls `createProjectRequest` (`lib/projects.ts`), the only caller of `api.create_project_request`.

```ts
const receipt = await createProjectRequest(operationOf(access.account), {commandId, request});   // request = what checkRequest worked out
// receipt.outcome: created | replayed (both carry projectId and requestId) | reused | denied
```

`api.create_project_request` follows the order of `api.rename_project`. Its arguments are checked first (a shape the application would never send raises 22023); then `identity.assert_operation_authority` (a refusal, N3010, answers `denied` and writes nothing); then the command ID is serialized under the advisory lock `'project_command:' || account || ':' || command` (the lock Rename takes, so a creation and a rename of one command ID are never in flight together); then a command ID that a **rename** already used is `reused` ("One command ID, one command", below, says the rule once, for every writer and in both directions). Then a command ID that a revision already used answers the original receipt for the same payload (`replayed`) while its Project is live, and `unavailable` (with no ID) once the Project has been deleted or tombstoned, as a receipt does not outlive its Project's visibility in Rename either; the same command ID with another payload is `reused`. Otherwise ONE transaction creates the Project (title, stage `request_confirmed`, revision 1, in the Account's Workspace) and its request revision `seq` 1, and answers `created` with both IDs. The payload's identity is `digest`: SHA-256 over the length-prefixed fields, the Project's title included.

The revision is its own receipt. `projects.request_revisions` is closed like `projects.project_commands` (row-level security on, no policy, every privilege revoked, reached only through the service-role `api` functions). A row is never updated and the table is never truncated; deleting is left for the Epic 8 purge, so the foreign key to the Project restricts and the cleanup helpers delete revisions first. It holds the subject, the scope and outcome the person confirmed, the mode (`evidence_text`, `evidence_images` or `image_direct`), the description, and the personalization as understood (applied with its text and style, or not applied with its reason). It has **no approval, permission, payment, cost or Job field**: scope confirmation, start confirmation, Plan Approval and paid permission stay distinct and never imply one another.

`api.read_project_request(account, epoch, project)` answers `denied`, `unavailable` (unknown, another Account's, deleted or tombstoned: one answer with nothing in it), `none` (a Project without a revision) or `found` with the latest revision's fields: whether it is `confirmed`, the text fields (null for an unconfirmed revision) and, for a picture revision, its `images` (Story 2.2, below).

### One command ID, one command

A command ID names ONE command, whichever writer it is sent to and whichever way it is sent again. Three functions record a command with one: `api.rename_project` (a receipt in `projects.project_commands`), `api.create_project_request` and `api.record_picture_set` (the receipt is the request revision itself, whose `command_id` is unique per Account). They share the advisory lock `'project_command:' || account || ':' || command`, so no two are ever in flight together for one command ID, and each refuses a command ID that another kind of command used with `reused`:

- `api.create_project_request` and `api.record_picture_set` answer `reused` for a command ID that a rename used, and for the same command ID with another payload (another digest); the same payload answers the original receipt (`replayed`) while its Project is live.
- `api.rename_project` answers `reused` for a command ID that a request revision used (a confirmation, or a picture set). This was missing in Story 2.1, which left Rename unchanged, so a rename could reuse a creation's command ID and a later retry of that creation then answered `reused` instead of `replayed`. Story 2.2 re-creates `api.rename_project` with the check, after the Project row is locked and before its own ledger is read (so a Project that is not available is still `unavailable`).

The application chooses a new command ID for each command, so none of this happens through the screens; it is what the database holds when a client is wrong or hostile.

### A writer that appends a successor revision

Stories 2.2, 2.3, 2.12 and 2.13 append revisions with `seq + 1` to an **existing** Project (a mode change makes a successor; a revision is never edited). That writer publishes for a Project, so it follows the rule of "The tombstone guard" below: in the transaction of its write and before the write it holds the Project's row `FOR SHARE` (or `FOR UPDATE`, if it also changes the Project) with `deleted_at is null` and the Account's own `account_id`, calls `lifecycle.assert_not_tombstoned('project', id)`, and **raises the Project's revision by exactly one** (`projects.guard_project` refuses any other change). Holding the row makes the append and a tombstone serial, and the revision rising by one is what a stale device or a second window sees. It begins with `identity.assert_operation_authority` like every command here, and it takes the same advisory lock on its command ID.

## Saving pictures: the picture-set writer

Story 2.2 (stage ordered multi-view images privately) is the writer of the second kind of request revision: an **unconfirmed picture revision**. The pictures themselves never pass through the application. The browser hashes each file, asks `POST /api/transfers/tickets` for an upload ticket and sends the file to the file gateway ("The file gateway", below), which stages it under a lease; what the application records is which uploads, in which order. `api.record_picture_set(account, epoch, command, project, title, upload_ids)` (typed as `recordPictureSet` in `lib/projects.ts`, called by the `savePictureSet` Server Action) is the only function that does it, and it follows the rules of a writer of a successor revision, above:

- It begins with `identity.assert_operation_authority` (a refusal answers `denied`), takes the advisory lock on the command ID that rename and create take, and answers `reused` and `replayed` as "One command ID, one command", above, says (`reused` for a command ID that a rename used or for another set, `replayed` for the same command with the same digest while its Project is live).
- A Project is **born at the first save**, with `project` null and a `title` (a title is given only then): stage `request_draft`, revision 1, and revision `seq` 1. A later save is a **successor**: the Project row is held `FOR UPDATE` with the Account's own, `deleted_at is null` and no tombstone (`unavailable`: another Account's, deleted, tombstoned and unknown Projects are one answer), its revision is raised by **exactly one** and `updated_at` set, and `seq` is the Project's highest plus one (`projects.check_revision_seq` refuses any other number, whoever inserts). It is only allowed while the latest revision is an unconfirmed picture revision (`not_editable` otherwise: a text request, a confirmed revision, a Project without a revision).
- The browser's word about a file is never used. Every upload is read from `artifacts.staging_leases` as the table owner, in position order: another Account's, unknown or not a `picture` is `unknown_upload`, one that is not `complete` is `not_ready`, one past its expiry is `expired_upload`, and one whose SHA-256 is the same as an earlier position's is `duplicate_image` (each with its position; the positions are examined in order and the first problem wins, so a picture's own lease is judged before it is called a duplicate). The digest compared is the lease's, never the browser's: two different uploads holding the same bytes are refused here even when the browser's own check (which only sees what it hashed) let them through, and the same upload ID twice is an argument error (22023). The lengths read from the leases may add up to 60 MiB (`too_large`). The SHA-256, length and content type recorded in `projects.request_images` are the lease's. The digest of the command is SHA-256 over the length-prefixed project, then each position, upload, SHA-256, length and type.
- The same ordered uploads as the latest revision is `unchanged`: **no revision is written, the Project is not touched (its revision and `updated_at` stay) and nothing is released, but the included leases are renewed within the same bound as a recorded save** (below). Pressing Save on a set that has not changed is how a person keeps it for another 24 hours, so "24 hours after your last save" is true of an unchanged one too.
- **Lease renewal is bounded.** A save that records a revision, and a save that is `unchanged`, sets each included lease's `expires_at` to the earlier of 24 hours from the database clock and 7 days after the lease was created, so a lease can be kept for a week at most, whatever the person does; the gateway's own renewal by activity is unchanged, and a `complete` lease is never renewed by it. A lease that has expired is `expired_upload`, and the hourly cleanup (Story 1.12) may delete its object at any moment.
- **Release rules.** The save releases (state `released`, at once: the lease stops counting toward the 250 MiB quota, and the hourly cleanup removes the object) every lease the previous revision used that the new revision does not carry and that no other Project's latest revision still uses. `api.release_staged_pictures(account, epoch, upload_ids)` (called by the `discardPictures` Server Action when a picture is replaced or removed before it was saved) releases only the Account's own `picture` leases in state `receiving` or `complete` that no `projects.request_images` row uses, and answers how many; anything else in the list is left alone. A lease that was never saved or discarded lapses on its own after 24 hours.
- `projects.request_images` is closed like `projects.request_revisions` (row-level security on, no policy, no privilege for any role), never updated or truncated; rows leave only with their revision (Epic 8), so the cleanup helpers of the tests delete pictures before revisions. `api.read_project_request` answers each picture's position, upload ID, SHA-256, length, content type, expiry and whether the upload is still available (`complete` and unexpired): never a Storage key, an address or a download URL. The application never fetches, stores, renders or links a download of a staged picture, and issues no download ticket for one; a preview on the picture screen is the local object URL of the file the person chose.

The revision carries no subject, scope, outcome, description or personalization (`confirmed_at` and those columns are null, together and only together, and `personalization_applied` is false), and the **provisional mode `evidence_images`**, which no screen presents as a choice: Story 2.3 records the explicit choice of how the pictures are used as a successor revision, and Story 2.12 retains them. Saving confirms nothing, approves nothing, starts nothing and spends nothing.

## Reviewing pictures: the review writer and the acknowledgment

Story 2.3 (choose picture mode and acknowledge uncertainty) is the writer of the third kind of request revision: a **reviewed picture revision**. The browser measures each picture (`lib/picture-decode.ts`, `lib/picture-quality.ts`; [picture-quality.md](picture-quality.md)) and the person labels each view, confirms that nothing blocks the subject, and chooses how the pictures are used. `api.record_picture_review(account, epoch, command, project, expected_seq, mode, scope, outcome, images, obstruction_confirmed, acknowledge)` (typed as `recordPictureReview` in `lib/projects.ts`, called by the `recordPictureReview` Server Action in `app/projects/[projectId]/pictures/review/actions.ts`) is the only function that records it, and it follows the rules of a writer of a successor revision, above:

- It begins with `identity.assert_operation_authority` (a refusal answers `denied`), takes the advisory lock on the command ID that rename, create and the picture-set writer take, and answers `reused` and `replayed` as "One command ID, one command" says. The command's digest covers the Project, the revision it reviewed, the mode, scope, outcome, both flags and, for each position, the upload, the **lease's** SHA-256, the label and the three measurements.
- It locks the Project row `FOR UPDATE` with the Account's own, `deleted_at is null` and no tombstone (`unavailable`: one answer), reads the **latest** revision and answers `not_editable` for a text request **and for a Project that is no longer at the request stage** (its stage is not `request_draft` or `request_confirmed`: a review never moves a Project backwards, so one that has gone on to research or beyond is answered `not_editable` with nothing written, and the stage update is guarded by the same rule), and **`stale`** (nothing written) when the latest revision's `seq` is not `expected_seq`, when there is none, or when its ordered upload IDs are not exactly the supplied ones: a review is of one revision, and a second window that saved a newer set or review is told to load the page again.
- Every upload is read again from `artifacts.staging_leases` as the table owner, in position order (`unknown_upload`, `not_ready`, `expired_upload` with the position, as the picture-set writer). Then it refuses `obstruction_not_confirmed` unless the person confirmed that nothing blocks the subject. There is no override.
- **An identical re-confirmation is not a new revision.** After the acknowledgment check, if the latest revision already holds the same mode, scope, outcome, obstruction confirmation and acknowledgment state, and for each position the same upload, label and measurements, the answer is **`unchanged`** with the current Project, revision ID and `seq`, and nothing is written (the Project is not raised and no revision is added). It happens when an answer was lost and Confirm is pressed again from the reloaded screen (a new command ID and the new `expected_seq`). The leases are still renewed within the same bound, as an unchanged picture set's are. The action sends the person to the Project, as for `created`. The lease and obstruction checks come first: a copy that lapsed is `expired_upload`, never `unchanged`.
- **The browser's measurements are claims.** They are stored as sent (`projects.request_images.short_edge_px`, `blur_variance`, `clipped_fraction`, with `view_label`; all four or none) after their range and shape are checked. For `image_direct` the database **recomputes whether the inputs are incomplete from the labels and measurements** (`projects.picture_review_incomplete`, the same thresholds and rule as `lib/picture-quality.ts`, held equal by a test over a table of cases) and answers `acknowledgment_required` when they are and `acknowledge` is false. No pass or fail flag is a field of the command or of a revision.
- Otherwise, in one transaction, it raises the Project's revision by exactly one, sets its stage (`request_confirmed` for a confirmed direct revision, `request_draft` for research-assisted) and inserts the successor (`seq + 1`) with its images in order, with their labels and measurements, and renews the leases within the bound of the picture-set writer (the earlier of 24 hours from now and 7 days after they were created). The Project's earlier revision is unchanged. A **mode change is a successor**.
- **Research-assisted** (`evidence_images`) records the choice, the labels and the measurements and **no scope**: the successor is unconfirmed, with no scope, outcome, description or subject. The subject is identified and the scope confirmed in Story 2.13, and the whole Research Plan is approved later. **Direct** (`image_direct`) records a confirmed revision with the scope and outcome the person edited, **no subject and no description**, and no personalization (a picture request has no declared surface). It has no Research Plan.
- **The acknowledgment is not an approval.** For `image_direct` with incomplete inputs it records `incomplete_acknowledged_at` and `incomplete_acknowledged_digest`: the SHA-256 of the length-prefixed scope, outcome and, for each position in order, its position, the upload, the **staged SHA-256** and the label (`projects.picture_review_digest`; `reviewDigestInput` in `lib/picture-quality.ts` is the same text). It is pinned to these pictures in this order and this scope, so it cannot be reused for others. It authorizes no cost, starts no conversion and approves no plan; the revision has no approval, permission, payment, cost or Job field, and no pass or fail verdict. Exact-model approval and compatible validation still gate every qualified export.
- `api.record_picture_set` now accepts a latest revision that is an unconfirmed picture revision of either mode; a reviewed revision is **superseded by an unreviewed successor**, whose images carry no labels or measurements. A confirmed direct revision's pictures are not changed there (`not_editable`): review it again and choose research-assisted to unlock them. Its staged copies lapse like any others (24 hours after the last save or review, never past 7 days after the upload) **until the pictures are retained** ("Retaining pictures", below, Story 2.12). Since that story the review writer records only retained pictures, so a copy that has lapsed no longer matters once its picture is pinned. **A picture that was never retained and whose staged copy has lapsed cannot be brought back, and a request made of it cannot be reviewed again** (the writer reads the lease of an unretained picture and answers `expired_upload`); the review screen says so for such a picture and offers no link to the locked picture screen.
- `api.read_project_request` returns, per picture, the label and the three measurements (null when the set was never reviewed) and, per revision, `obstruction_confirmed` and `acknowledged` with their times. The application still never fetches or links a staged picture for display; the **only** read-back is the review's: a single-use download ticket in the browser (`lib/picture-fetch.ts`), the bytes in memory only and checked against the saved SHA-256, from the picture's retained root (kind `retained`) when it is pinned and from staging (kind `staging`) when it is not.

## Retaining pictures: retention before confirmation

Story 2.12 (retain confirmed pictures as immutable Project artifacts) keeps the pictures a person confirmed. Until it, a confirmed picture lived only in lease-bounded staging, which lapses 24 hours after the last save and keeps the location data of the photograph. Now, at the end of the review, each picture is **published as an immutable manifest root with its metadata removed**, the review's successor revision **pins the ordered roots** beside the staged digests they replace, and the staged copies expire. Later consumers (subject identification, research, conversion, recovery) read the retained roots and never staging.

**Retention happens before the review is recorded**, so a failure confirms nothing. The sequence is the application's (`lib/retention.ts`, the `retainPictures` Server Action, then the `recordPictureReview` Server Action; the screen calls the second only after the first answered `retained` for every picture):

1. **A read-only pre-check**, `api.check_picture_retention(account, epoch, project, expected_seq, upload_ids)` (service role, writes nothing). It begins with `identity.assert_operation_authority` (`denied`); the Project is the Account's own, live and not tombstoned (`unavailable`, one answer); the latest revision's `seq` is the expected one, it is a picture revision and its ordered uploads are exactly the supplied ones (`stale`; `not_editable` for a text request or a Project past the request stages); each upload is read from `artifacts` as the table owner (another Account's or unknown is `unknown_upload`; an upload with a manifest is `retained` whatever has become of its staged copy; otherwise a lease that is neither `complete` nor `attached` is `not_ready` and an expired one is `expired_upload`, each with the position); then the **quota**: the Account's retained pictures plus the staged lengths of the uploads with no manifest yet must not exceed 2 GiB, else `quota_exceeded` for the **whole confirmation** (nothing is kept for part of it), with the bytes kept and the bytes asked. It answers, per position, `attach` or `retained` (with the root).
2. **The attaches**, in parallel (at most 4 in flight, 30 seconds each), only for the positions that answered `attach`: the application-signed `attach` command with the transform `strip-picture-metadata`. The gateway reads the staged object (at most 12 MiB, so at most two copies of a picture are in memory at once), hashes it and refuses `bytes_changed` unless its SHA-256 and length are the lease's, **strips it in memory** (`workers/files/src/strip.ts`, lossless for the pixels; [picture-quality.md](picture-quality.md) says what is removed and what is kept), hashes the result, builds the manifest body with the **retained** digest and length (the canonical order of members is unchanged: activity `upload:strip-picture-metadata`, children `[]`, digest, id, kind, length, scope, serialization), stores the result at `objects/<account>/<root>` and calls `artifacts.publish_attachment`. A picture whose structure it cannot parse is refused `strip_failed` and **never published unstripped**; a refused attach deletes its own copy. The strip is deterministic, so a repeated attach recomputes the same bytes and the same root and `publish_attachment` answers `exists`: the confirmation can be submitted twice and creates no second artifact.
3. **The review writer**, `api.record_picture_review` (same signature, same command digest, so a replay is the same receipt), reads the roots it pins from `artifacts.manifests` itself: for each upload the Account's manifest of kind `picture` supplies the root, the retained digest and the retained length, **never the browser**; the staged `sha256` stays beside them, so each retained digest maps to the staged digest the person confirmed, in order (`projects.request_images.retained_root`, `retained_sha256`, `retained_length`, all three or none). Every upload must have a manifest (`not_retained` at the position otherwise); a lease whose staged copy is gone is accepted when its manifest exists; the `unchanged` rule also requires that the latest revision already pins the same roots; and on commit the pinned leases' `expires_at` is set to the database clock, so the hourly cleanup of Story 1.12 deletes the staged copies.
4. **The staged copies expire.** Nothing renews a retained picture's staged copy again (`api.record_picture_set` renews only `complete` leases, and a `deleted` lease is final).

`artifacts.publish_attachment` for this transform takes the digest (64 lower-case hexadecimal characters) and the length (from 1 to the lease's length plus 4,096) from the canonical body and still requires the whole body to be, byte for byte, the canonical text it builds, the lease to be a **picture's**, the staged lease `complete` and unexpired, and the Account's authority to hold in the same transaction. After the lookup of an existing manifest (a repeat counts nothing again) it takes the advisory lock `nova3d:retained:<account>` and refuses `quota_exceeded` if the Account's manifests of kind `picture` plus this length would pass 2 GiB (2,147,483,648 bytes): this is the **race backstop** for the pre-check, so two confirmations at the edge are admitted one at a time. **A manifest that is published but never pinned** (a confirmation that failed or was abandoned) **is kept**, reused by the next attempt, and counted against the quota until Epic 8 can delete it; nothing in this story deletes, purges or restores a retained picture, and the quota never shrinks until then.

`api.record_picture_set` accepts an upload whose picture manifest exists (an `attached` lease, or one the cleanup has since released or deleted) and carries its pins into the unreviewed successor, so a person who changes one picture on the picture screen keeps the pins of the others. `api.read_project_request` reports `available` true for a pinned picture (and for an `attached` lease that has not lapsed, which the staging resolver still serves); its shape is unchanged. **`api.read_retained_pictures(account, epoch, project)`** (service role) is how a later consumer asks: `denied`, `unavailable` (one answer for another Account's, deleted, tombstoned and unknown Projects), `none` (nothing is pinned) or `found` with the latest revision's pinned pictures **in the confirmed order** as `{position, upload_id, root, retained_sha256, retained_length, staged_sha256, label, content_type}` and nothing else. A root is a server-side fact: it is never put in a URL, a log or a page, and no key of Storage is ever returned.

**The retained-picture resolver.** The ticket route accepts the target kind `retained` for a **download** (the ticket's `tid` is the picture's upload ID, which is also its manifest's ID; an upload ticket of this kind is refused `unknown_target`, by the route and by the gateway). The gateway's resolver reads the view `artifacts.retained_pictures` before every chunk, like every resolver: the picture is served **only while a revision of a live Project of the same Account pins it** (the Project is not deleted and has no tombstone: the view runs as its owner and writes the tombstone test out as an anti-join, because the gateway role may not execute `lifecycle` functions), and, as for every ticket, only while the Account's session and the Account itself are live. It serves the object at `objects/<account>/<root>` with the retained length and content type, and the retained digest as its entity tag. A foreign, unknown, deleted, tombstoned or unpinned picture is the same `unavailable`; a Project that is deleted between two chunks closes the stream.

The code is `workers/files/src/strip.ts`, `workers/files/src/server.ts` (the attach), `workers/files/src/resolvers.ts`, `lib/retention.ts`, `lib/gateway-client.ts` and `supabase/migrations/20261021120000_retained_pictures.sql`; the behavior is pinned by `tests/unit/strip.test.ts`, `tests/unit/gateway-server.test.ts`, `tests/unit/retention.test.ts`, `tests/integration/retained-pictures.test.ts`, `tests/integration/picture-review.test.ts`, `tests/integration/file-gateway.test.ts` and `tests/e2e/picture-retention.spec.ts`.

## Usage periods: the monthly allowance and its limits

Story 2.4 (set accountable usage limits) records what an Account may spend each month, and lets the fresh-authenticated Administrator see and change it. The reservations and settlements that count against it came with Story 2.6 ("Reservations and settlements", below); the rate schedules they are priced by are fixtures (the owner's, in the tests) until Story 2.5 writes real ones; credit and payments are Stories 2.14 to 2.17. This story creates the **allowance period** they reserve against. Money is integer USD **microdollars** (`bigint` in SQL, a safe integer in TypeScript), never a float; dollars appear on screen only through `formatDollars` (`lib/usage-view.ts`: `$25.00`, no `Intl`).

### A period is an immutable row

`usage.periods` (the closed `usage` schema, like `identity`, `projects` and `artifacts`: row-level security on, no policy, every privilege revoked, not exposed by the Data API) holds one row for each period of an Account: `seq` from 1, `month_start` (the UTC first of the month, `date_trunc('month', clock_timestamp() at time zone 'UTC')`, never the session's time zone), the limit (0 to 10,000,000,000 microdollars, that is $10,000, in whole cents: a multiple of 10,000), what is **carried** in (`carried_settled_microdollars`, `carried_reserved_microdollars`), the `cause` (`initial`, `month`, `change`, `reset`), the limit before (`previous_limit_microdollars`, null for `initial`), the actor (`user:<id>` or `system`), the Administrator's `command_id`, a `digest` and the time. A row is **immutable**: update and truncate are refused by trigger (`55000`), delete is left for the Epic 8 purge, the Account's key restricts, and `(account_id, seq)` and `(account_id, command_id)` are unique. The **current** period is the highest `seq`. A limit is never edited: the row IS the record of the actor, the time and the old and new limits, and `identity.audit_events` (whose five columns are pinned) carries only that a change happened (`usage.limit_changed`, `usage.limit_reset`, actor and `account:<id>`).

A new Account gets its `initial` period in the transaction that creates it (`identity.activate_account`, which both registration paths call): $25 for an invitee and $50 for the Administrator (`usage.default_limit`). The migration backfilled the Accounts that existed.

### Rollover is lazy

`usage.ensure_period(account)` is internal (callable by no API role). When the latest period is of an earlier UTC month it appends a `month` period under the advisory lock **`nova3d:usage:<account>`**: the same limit, settled carry 0, and the reserved carry kept (the previous carry plus the previous period's reserved figure). A second call in the same month appends nothing. Every Usage `api` function calls it first, and nothing is scheduled. **Story 2.6 takes the same advisory lock** to reserve and to settle against the current period (`api.reserve_cost`, `api.settle_cost`), and judges the allowance headroom (the limit less settled plus reserved, never below 0: `usage.available_microdollars(account)` answers it without the lock; credit joins in Story 2.14).

### Figures: the ledgers' signed deltas (since Story 2.6)

The settled and reserved figures of a period come only from `usage.period_figures(period_id)`. Story 2.4 built it over an owner-written stand-in, the table **`usage.fixture_figures`**, which was empty (so every figure was zero) in every real environment; **Story 2.6 replaced the body of `usage.period_figures` with the ledgers and dropped the table** (the function keeps its signature). The figures are now **signed deltas** (see "Figures and the Job's exposure", below): the period's reserved figure is the reservations made in it less what the settlements made in it released (negative when it releases a reservation of an earlier period, which the successor period's carry still counts), and its settled figure is what the settlements made in it settled. Nothing else changed: shown settled = carried settled + the figure; shown reserved = carried reserved + the figure; used = settled + reserved; available = max(limit - used, 0); when used exceeds the limit the amount over is shown too, so the amounts always reconcile (settled + reserved + available = limit, or limit + over = used). The **state** is by integer arithmetic only: `under` (used x 5 < limit x 4), `nearly` (used x 5 >= limit x 4 and used < limit), `reached` (used >= limit; a limit of 0 included). `reached` means **new paid work is blocked** (`api.reserve_cost` answers `insufficient_allowance`); running work finishes, and disabling an Account still cancels it (Account disable and its cancellers are untouched). The tests make a period `nearly` or `reached` with real ledger rows made by the owner (`tests/support/usage-ledger.ts`), and no real Account has a reservation until Stories 2.5 to 2.8 call the commands.

### Changing a limit and resetting the count

`api.set_usage_limit(actor, admin account, epoch, target account, command ID, kind, limit, expected seq)` appends a **successor** period that carries the liabilities. In this order, and nothing is appended before all of it passes: the arguments (`22023`); `identity.assert_operation_authority` for the Administrator (`denied`); the caller is an Administrator (`denied`); the target exists and has no tombstone (`not_found`); the advisory lock; the target is not disabled (`disabled`); `usage.ensure_period`; the receipt by (target, command ID): the same digest is `replayed` (the same period), another is `reused`; the latest `seq` is not the expected one (`stale`, carrying the current `seq`); the limit is out of range, not whole cents, missing for a `change` or given for a `reset` (`invalid_limit`); a `change` to the current limit is `unchanged` (no period, no audit event); otherwise it appends `seq + 1` and audits in the same transaction. The **carry**:

- `change` keeps counting everything so far: carried settled = the previous carry + its settled figure, carried reserved likewise;
- `reset` restarts the count but keeps the liabilities: carried settled 0, carried reserved as for a change, and the limit stays;
- both keep what is already reserved reserved, so work that is reserved keeps its reservation.

With 25M of limit, 10M settled and 2M reserved: a change to 40M makes `seq` 2 carry 10M and 2M (available 28M); a reset makes it carry 0 and 2M (available 23M). Lowering a limit below what is used is accepted: the Account is at its limit, with the amount over shown, and nothing already reserved or settled is touched. A disabled Account's limit is not changed (re-enable it first).

### The gate, the refusals and the read

The fresh `administration` marker is checked in TypeScript by `administered()` (`lib/administered.ts`), the only gate, and a refusal changes nothing; `administered` now also hands the change the verified access, so the Administrator's Account and epoch (`operationOf`) come from the session and never from the form. Refusals are recorded, once an hour per actor and Account, by `api.record_usage_refusal` (`usage.limit_refused` for an Administrator without a valid marker, `usage.denied` for an Account that is not one). `api.list_usage(admin account, epoch)` answers `denied` unless an active Administrator, rolls the month over for each Account, and returns at most 200 Accounts in the order of `api.list_accounts` with their address, role, status and current period (month, limit, shown settled, shown reserved, cause), and nothing else. The page is `/admin/usage`; `lib/usage.ts` is the only caller of the three functions; the step-up still returns to `/admin`.

### Rollout

The migration (`supabase/migrations/20261022120000_usage_limits.sql`) is additive and goes first; the previous build never calls it, and `identity.activate_account` behaves as before apart from the extra period. The code is `lib/usage.ts`, `lib/usage-view.ts`, `app/admin/usage/`, `components/admin/usage-*.tsx`; the behavior is pinned by `tests/unit/usage-view.test.ts`, `tests/unit/usage.test.ts`, `tests/unit/usage-actions.test.ts`, `tests/unit/usage-page.test.tsx`, `tests/unit/usage-admin-page.test.tsx`, `tests/unit/gate-structure.test.ts`, `tests/integration/usage-limits.test.ts` and `tests/e2e/usage.spec.ts`.

## Jobs: durable identities for background work

Story 2.11 (create durable Job, attempt, step and operation identities) records every unit of background work under a unique identity, so a duplicate command cannot duplicate work or a charge, and a retry cannot start while an earlier charge is unresolved. It records and guards: the reservation of a cost (Story 2.6), the dispatch, leases and workers (Story 2.7), the reconciliation process (Story 2.8) and the Job detail screen build on it. There is no screen, route, notification, dispatch or worker in this story, and nothing in the application calls the commands yet (`lib/job-records.ts` has no caller, as `lib/project-target.ts` has none).

### Four record families and a receipt

The closed `jobs` schema (row-level security on, no policy, every privilege revoked from `public`, `anon`, `authenticated` and `service_role`, not exposed by the Data API, `api` stays functions only; the file gateway's role has no privilege on it either) holds:

| table | one row for | unique by | changes |
| --- | --- | --- | --- |
| `jobs.jobs` | a Job: its Account, its Project (a composite foreign key to `projects.projects (id, account_id)`), its `kind` | its ID | never edited |
| `jobs.attempts` | an attempt: `number` from 1, `previous_attempt_id` (null only for 1), the `input_digest` it pins, `state`, `stage`, the stored `reason`, and `created_at`, `started_at`, `ended_at` | (Job, number); and at most one attempt of a Job is open (`waiting` or `running`) | only the guarded moves below |
| `jobs.steps` | a step: `step_key` | (attempt, step key) | never edited |
| `jobs.operations` | an external operation: `ordinal` 1 to 100, `state`, `request_id`, `created_at`, `dispatched_at`, `outcome_at` | (step, ordinal) | only the guarded moves below |
| `jobs.commands` | the immutable receipt of a command: (Account, command ID), `kind`, `digest`, `subject_id` | (Account, command ID) | never edited |

Every row carries its `account_id`, and ownership is by composite foreign keys with `restrict`, so a Job cannot name another Account's Project and a step cannot name another Account's attempt. Times are the database clock. Update and truncate are refused by trigger (`55000`) on Jobs, steps and receipts; attempts and operations refuse truncate and every update except the guarded moves, never change an identity column, never leave a finished state, and write `started_at`, `ended_at`, `dispatched_at`, `outcome_at` and `request_id` once. Deleting is left for the Epic 8 purge, which removes the families children first. A step is only ever added to a `running` attempt, and an operation is created `planned`.

**A Job has no state column.** Its public state, stage and reason are its **highest attempt's** (`jobs.public_state`): the stored values, except a `waiting` attempt's reason, which is derived each time it is read (`awaiting_reconciliation` while the gate below is closed for its number, else `awaiting_dispatch`) and stored nowhere. So the state shown, the stage and the reason cannot disagree with the records.

- **Attempt states:** `waiting`, `running`, `completed`, `failed`, `cancelled`. Moves: `waiting` to `running` or `cancelled`, `running` to `completed`, `failed` or `cancelled`. The stored reason is null for `waiting`, `running` and `completed`; `step_failed` or `lease_lost` for `failed`; `user_cancelled` or `account_disabled` for `cancelled`. **Stage** is `accepted` at attempt 1, `retry` at a later attempt, `started` when it starts, the step key when `api.begin_step` creates a step, and is left as it was when the attempt ends.
- **Operation states:** `planned`, `dispatched`, `completed`, `ambiguous`, `noncharge`, `settled`, `abandoned`. Moves: `planned` to `dispatched` or `abandoned`; `dispatched` to `completed`, `ambiguous` or `noncharge`; `ambiguous` to `settled` or `noncharge`. A `noncharge` needs a `request_id` (the provider's, printable ASCII without spaces, 1 to 200 characters), and a stored `request_id` never changes. `outcome_at` is written at the first move out of `dispatched` (completed, ambiguous or noncharge), and reconciling later does not rewrite it. An operation is **potentially chargeable** while `dispatched` or `ambiguous`; **reconciled or terminal** are `completed`, `noncharge`, `settled` and `abandoned`.

### The gate: a retry waits, and no number gets past it

`jobs.charge_open(job, before_number)` is true when any operation of **any** attempt of the Job numbered below `before_number` is potentially chargeable. It is asked at the one move that could bypass the wait, `waiting` to `running` (`api.move_attempt`), and it looks at every earlier attempt, so a new attempt number gains nothing and a third attempt would be held by an unresolved charge in the first. A user retry (`api.request_retry`) never waits inside its transaction and never starts the attempt: it creates attempt `number + 1`, linked to the failed one, `waiting`, stage `retry`, and returns the derived reason, so the screen can say "waiting for the earlier charge to be reconciled". Starting it is `blocked` (carrying `awaiting_reconciliation`) until the operation is `completed`, `noncharge` or `settled`; then the reason reads `awaiting_dispatch` and the start succeeds. Only a `failed` attempt is retried (`not_retryable` carries the state of the highest attempt, `stale` carries its number); a retry from a `cancelled` or `completed` attempt is not allowed. Only `api.accept_job` and `api.request_retry` insert attempts: nothing retries by itself. Failing or cancelling an attempt turns its `planned` operations `abandoned` in the same transaction while its `dispatched` and `ambiguous` operations stay potentially chargeable; a late outcome of an ended attempt is still recorded (`api.advance_operation` works in any attempt state but for the dispatch), which is how an ambiguous charge is reconciled. An attempt completes only when none of its operations is `planned`, `dispatched` or `ambiguous` (`open_operations`).

### The six commands

`api.accept_job`, `api.begin_step`, `api.advance_operation`, `api.move_attempt`, `api.request_retry` (the writes) and `api.read_job` are `security definer` with `search_path = ''` and executable by the service role alone; `lib/job-records.ts` is the only caller (it exports the typed calls and the vocabularies of states, reasons, stages and operation states, and a pure `isChargeable(state)`). Every write takes the Account, its epoch and a command ID, and runs in this order, nothing written before all of it passes:

1. **the arguments** (a shape the application would never send raises `22023`);
2. **`identity.assert_operation_authority`**, which also refuses a tombstoned Account: a refusal (`N3010`) answers `denied`;
3. **the advisory lock `nova3d:jobs-command:<account>:<command>`**: one command ID at a time;
4. **the subject belongs to the Account and its Project row is held `FOR SHARE`**, not deleted and not tombstoned (`unavailable`: ONE answer, with nothing in it, for a foreign, a deleted, an unknown and a tombstoned Project, Job, attempt or operation). `api.record_tombstone` takes the same row `FOR UPDATE`, so a step can never land after a tombstone, as "The tombstone guard" asks of every writer that publishes for a Project;
5. **the advisory lock `nova3d:job:<job>`**: one command at a time for a Job, so a retry and a reconcile are never in flight together and the gate answer is consistent (`api.accept_job` has no Job yet);
6. **the receipt** by (Account, command ID): the same digest answers `replayed` with the original records (as they are now), another is `reused`;
7. **the command's own checks**: replays and gates before state checks, so a lost answer always replays.

The digest is SHA-256 over the kind and every argument the caller supplied except the Account, the epoch and the command ID, each length-prefixed. **Every command that answers `replayed` or does its work leaves a `jobs.commands` row**, so a second command ID that finds the work already done (a second `begin_step` for the same attempt, step key and ordinal, a second `advance_operation` for the state the operation is already in) is recorded and replays too. A receipt does not outlive its Project's visibility: a replay after the Project is deleted or tombstoned is `unavailable`.

| command | outcomes |
| --- | --- |
| `api.accept_job (project, kind, input digest)` | `created` (Job and attempt 1: `waiting`, stage `accepted`, reason `awaiting_dispatch`), `replayed`, `reused`, `denied`, `unavailable` |
| `api.begin_step (attempt, step key, ordinal default null)` | `created`, `replayed` (what exists is returned and never recreated, whatever the attempt's state), `reused`, `denied`, `unavailable`, `not_running` (carrying the attempt's state; the attempt must be `running` to create) |
| `api.advance_operation (operation, to, request id default null)` | `advanced`, `replayed` (the operation as it is now: the state it is already in with the same request ID, or an earlier command of this ID sent again after the operation has moved on, as when a lost answer is recovered), `reused`, `denied`, `unavailable`, `not_running` (a dispatch needs a `running` attempt), `invalid_transition` (a move not listed, a changed request ID, or a noncharge with none; carries the state) |
| `api.move_attempt (attempt, to, reason default null)` | `moved`, `replayed`, `reused`, `denied`, `unavailable`, `blocked` (the gate), `open_operations`, `invalid_transition` (carries the state) |
| `api.request_retry (job, expected number, input digest)` | `created`, `replayed`, `reused`, `denied`, `unavailable`, `stale`, `not_retryable` |
| `api.read_job (job)` | `found` (the Job, its public state, `can_retry`, and every attempt in order with its state, stage, reason, times and the count of its potentially chargeable operations, and nothing else; all from ONE statement, so one snapshot: a command that commits while the read runs cannot show the Job in one state and its highest attempt in another), `denied`, `unavailable` |

### What this leaves to others

Story 2.6 has added the reservation (Usage-owned, keyed to the operation ID, with the receipt pins: provider API version, requested model and rate schedule), as "Reservations and settlements" (below) says: it is Usage's, so no column was added to the Jobs records. Story 2.7 wraps `api.accept_job` to reserve the Job's planned operations (with `api.reserve_cost`) and commit the reservation and the dispatch outbox together, makes a dispatch need a reservation, adds leases, fencing, signing, the worker registry, the cancel and disable recording path (it needs an authority-free internal move) and the Job detail screen with its copy; Story 2.8 reconciles ambiguous charges; Epic 8 purges `jobs` rows (no purge registry exists yet).

### Rollout

The migration (`supabase/migrations/20261023120000_job_records.sql`) is additive and goes first; the previous build never calls it and nothing else depends on it yet. `api.preflight` is re-created carrying every earlier probe and the new ones (forty-seven `api` functions in all), so a missing migration fails the build. The code is `lib/job-records.ts`; the behavior is pinned by `tests/integration/job-records.test.ts`, `tests/unit/job-records.test.ts` and `tests/unit/gate-structure.test.ts`.

## Reservations and settlements: bounded costs, reserved atomically

Story 2.6 (reserve bounded costs atomically) bounds what paid work may cost. Before an external operation may go out, its **enforceable maximum** is reserved against the Account's allowance, the Job's $5 cap across all its attempts and the $1 cap of the operation, in one transaction, so concurrent work can neither overspend nor reserve twice; a **settlement** later releases the reservation and records what happened. It is Usage's, in the closed `usage` schema: three `api` functions (`api.quote_cost`, `api.reserve_cost`, `api.settle_cost`, executable by the service role alone), five tables and one calculator, with `lib/usage-reservations.ts` the only caller. **Nothing in the application calls it yet** (as `lib/job-records.ts` has no caller): there is no screen, route, provider adapter, dispatch or worker. Story 2.5 adds the rate schedules, the provider adapters and the permission matching inside this admission; Story 2.7 reserves a Job's planned operations when it accepts the Job (so a running Job finishes under a reached limit), makes a dispatch need a reservation and builds the cancel and disable path; Story 2.8 reconciles, sweeps the deadline and clears incidents; Story 2.14 adds the credit funding split. Money is integer USD **microdollars** (`bigint` in SQL, a safe integer in TypeScript), never a float; a single amount is from 1 to 1e15; every intermediate is an exact `numeric`.

### The calculator: one implementation, rounded up once

`usage.input_bound` and `usage.price` are the **only** arithmetic of cost, and quote, reserve and settle all use them (`usage.bound_cost` is the quote's judgement, shared by the quote and the reservation; the settlement calls `usage.price` on the evidence). Nothing in TypeScript computes a price.

- **Input bound** (tokens) = `ceil((request bytes + 2,000 + 5,000 x images) x 11 / 10)`: the byte length of the serialized request with image data excluded (no token is shorter than a byte), the fixed overhead, the tokens of each image, raised by the 10% margin. A bound equal to the ceiling passes; one above it is refused.
- **Billed units**: the input bound and the output limit, each rounded up to the schedule's billing increment (1 to 1,000,000 tokens). These are tokens, not money.
- **Price** = `ceil(((input units x input rate) + (output units x output rate) + (requests x request rate)) x multiplier)`. The rates and the multiplier are rationals (a numerator and a denominator): the three terms are summed over their common denominator and multiplied by the multiplier, all in integers, and the quotient is **rounded up once** per operation, as an integer division of `numeric`. No float, no earlier rounding of money.
- **Refusals**, judged in this order, each an `unavailable_bound` with its reason: `unknown_rate` (no such schedule), `foreign_rate` (the schedule's provider, model or API version differ from those given), `foreign_currency` (not `USD`), `unsupported_option` (any key in the options object: no option is supported, among them cache, batch, server tools, fallbacks, speed and streaming; `detail` names the first key in byte order), `over_input_ceiling` (the raised bound is above 200,000), `over_output_ceiling` (above 16,000), `over_request_ceiling` (above 20), `overflow` (the price is above 1e15) and `unpriced` (the price is 0).
- **`api.quote_cost`** (Account, epoch, schedule, provider, model, API version, request bytes, image count, output limit, request count default 1, options default `{}`): arguments (`22023`), authority (`denied`), then the calculator. It answers `quoted` (the input bound, the billed input and output units and the microdollars) or `unavailable_bound`. It is read-only and takes no advisory lock; it does not judge the caps, the allowance or the provider block, and does not roll the month over. An operation is exactly **one provider request**: `request count` exists only on the quote, and a reservation always prices one.

### Rate schedules

`usage.rate_schedules` is **global** (not Account-owned) and **immutable** (update and truncate are refused): a provider and a model (words), a `version` from 1 (unique with them), the provider's `api_version`, the `currency`, the input, output and request rates (each a numerator 0 to 1e12 over a denominator 1 to 1e12, in microdollars per token or request), the two billing increments and the geography multiplier (a rational of at least 1). **No `api` function and no application code writes one**, so a real environment has none until Story 2.5 adds the writer and the real rates; every quote and reservation there is `unavailable_bound` / `unknown_rate`. The tests insert fixture schedules as the owner. A rate that changes is a new version, never an edit.

### The ledgers

| table | one row for | unique by | changes |
| --- | --- | --- | --- |
| `usage.reservations` | an external operation: the Account, the period it was made in, the Job, the operation, the pins (rate schedule, provider, requested model, API version), the three calculator inputs (`request_bytes`, `image_count`, `output_limit`), the input bound (checked against the calculator), the reserved amount, the digest of the command | the operation | never edited |
| `usage.settlements` | a reservation: the `classification`, the period it was made in (the current one, which may be later than the reservation's), the settled amount, the released amount (always the reservation's whole amount) and, for `evidence` only, the input and output tokens and the returned model | the reservation | never edited |
| `usage.overrun_incidents` | a settlement whose evidence exceeded its reservation: the provider, the reserved and evidence amounts | the reservation and the settlement | only its one clearing (`cleared_at` and `cleared_by`, set together, once); written only by `api.settle_cost`; no function here clears one (Story 2.8) |
| `usage.commands` | a command that did its work or replayed: (Account, command ID), `reserve` or `settle`, the digest, the reservation or settlement it made or found | (Account, command ID) | never edited |

Every Account-owned row carries its `account_id`, and ownership is by composite foreign keys with `restrict` (to the period, the Job and the operation, which is why the migration adds the unique keys `usage.periods (id, account_id)` and `jobs.operations (id, account_id)`; no Jobs function or row changes). Update and truncate are refused by trigger (`55000`); delete is left for the Epic 8 purge, which will de-link settlements, reservations and incidents from Project, Job and operation while keeping amounts, provider and period (the keys restrict today). The tables are closed like the rest of `usage`: row-level security on, no policy, every privilege revoked.

### Reserving: `api.reserve_cost`

`api.reserve_cost(account, epoch, command ID, operation, rate schedule, provider, model, API version, request bytes, image count, output limit, options)` runs in this order. **A refusal writes no reservation, settlement, incident or receipt**; the month may turn first (`usage.ensure_period`, step 5, runs before the gates, as the story orders it, so a refusal in the first call of a new UTC month can leave the `month` period behind):

1. **the arguments** (a shape the application would never send, such as a negative or fractional size or an options value that is not an object, raises `22023`);
2. **`identity.assert_operation_authority`**, in `begin/exception when sqlstate 'N3010'` (`denied`);
3. **the advisory lock `nova3d:usage-command:<account>:<command>`**: one command ID at a time;
4. **the operation belongs to the Account and its Project row is held `FOR SHARE`** through `jobs.hold_project`, live and without a tombstone (`unavailable`: ONE answer for a foreign, a deleted, an unknown and a tombstoned one; `api.record_tombstone` takes the same row `FOR UPDATE`, so a reservation can never land after a tombstone). The operation's own row is held `FOR SHARE` too, so a move of the operation and the reservation are serial;
5. **the advisory lock `nova3d:usage:<account>`** (the lock Story 2.4 reserved, which `api.set_usage_limit` takes too) and **`usage.ensure_period`**: the month turns when work is first asked for;
6. **the receipt** by (Account, command ID): the same digest answers `replayed` with the original reservation, another is `reused` (a command ID that a settlement used is `reused` too);
7. **the operation already holds a reservation** under another command ID: the same payload is `replayed` (and recorded under this ID too), another is `already_reserved` (it carries the reservation), with no reservation or receipt written;
8. **the operation is not `planned`**: `not_reservable`, carrying its state (`dispatched`, `completed`, `ambiguous`, `noncharge`, `settled`, `abandoned`);
9. **the calculator**: `unavailable_bound`, with the reason;
10. **a provider with an uncleared overrun incident**: `provider_blocked`, for every Account;
11. **the operation cap**: a reservation above 1,000,000 microdollars ($1) is `over_operation_cap`;
12. **the Job cap**: the Job's exposure plus this reservation above 5,000,000 ($5) is `over_job_cap`;
13. **the allowance**: a reservation above `available` is `insufficient_allowance` (exactly equal succeeds; a limit of 0 refuses);
14. otherwise **one reservation in the current period and a receipt**: `reserved`.

**Replays and gates run before state checks** (steps 6 and 7 before 8), so a lost answer always replays, and an existing reservation still replays when the operation has since moved on. The digest is SHA-256 over the kind and every argument the caller supplied except the Account, the epoch and the command ID (the options object included), each length-prefixed. Several refusals at once are judged in the order above: the bound, then the provider, then the operation cap, then the Job cap, then the allowance.

**The cost block.** Every money refusal (`unavailable_bound`, `provider_blocked`, `over_operation_cap`, `over_job_cap`, `insufficient_allowance`) carries the exact cost block and writes no reservation, settlement, incident or receipt (the month may have turned first, as above), so no external side effect can follow it: `requested` (the amount the request would reserve; null for `unavailable_bound`, where nothing could be priced), the cap or limit that applies (`limit`: the operation cap, the Job cap, or the Account's period limit for the others), what is `used` against it and what is `available` under it. A success carries the reservation and no block.

### Settling: `api.settle_cost`

`api.settle_cost(account, command ID, operation, classification, input tokens, output tokens, returned model)` settles a reservation **once**, releasing its whole amount. It runs: the arguments (`22023`, including evidence fields given for any class but `evidence` or missing for it); the command lock; the operation belongs to the Account (`unavailable`, which hides a foreign or unknown one); the usage lock and `usage.ensure_period`; the receipt (`replayed` or `reused`); no reservation (`not_reserved`); already settled (the same classification and evidence is `replayed` and recorded under this command ID too, another is `already_settled`, carrying the settlement); the operation's state does not fit the class (`not_settleable`, carrying it); a deadline before it is due (`not_due`, carrying the due time); the evidence priced (`invalid_evidence` with the reason `overflow`); then one settlement in the current period and, when the evidence exceeds the reservation, one overrun incident, in the same transaction (`settled`).

| classification | the operation is | settles | released |
| --- | --- | --- | --- |
| `evidence` | `completed`, `ambiguous` or `settled` | the provider's usage report priced by the calculator at the pinned schedule (billing increments apply); above the reservation it settles at the evidence, records an incident and the over amount (settled - released) | the reservation |
| `deadline` | `ambiguous` or `settled`, and 24 hours or more after `outcome_at` | exactly the reservation | the reservation |
| `noncharge` | `noncharge` (a definitive pre-processing rejection with a request ID) | 0 | the reservation |
| `unused` | `abandoned` (it never went out) | 0 | the reservation |

**There is no Account epoch, Account status or Project check.** Settling records what already happened or releases what never went out, and refusing it for a disabled, stale or tombstoned Account, or a deleted Project, would strand the money. The only gate is that the operation is the Account's own. An ambiguous charge holds its reservation until usage evidence or the 24-hour deadline; the operation's state and its settlement are separate records (`api.advance_operation` to `settled` needs no settlement, and a settlement does not move the operation), so the reconciliation of Story 2.8 does both.

**Evidence above a reservation** settles at the evidence, counts against the period and against the Job cap (the Job's exposure counts the settled amount, not the reserved one), and writes an overrun incident: **until it is cleared that provider is blocked for every Account** (`provider_blocked`). Listing and clearing incidents, the 24-hour sweep and the alarms are Story 2.8's; no function here clears an incident.

### Figures and the Job's exposure

A period's figures are **signed deltas** from the ledgers (`usage.period_figures`): reserved = the reservations made in the period less the `released` amounts of the settlements made in the period; settled = the `settled` amounts of the settlements made in the period. A reservation made in one month and settled in the next leaves the successor's carry correct without rewriting any row:

```
limit 25M, reserve 1M (period 1)  -> reserved 1M, available 24M
month turns                       -> period 2 carries reserved 1M
settle 400k (period 2)            -> period 2 reserved -1M (shown 0), settled +400k (shown 400k), available 24.6M
```

A change or a reset in between keeps the same arithmetic (the carry of "Changing a limit and resetting the count"). **The Job's exposure** (`usage.job_exposure`) is, over every reservation of the Job across all attempts, the settled amount where it is settled and the reserved amount where it is not, so an ambiguous or dispatched charge holds its reservation, a later attempt's reservation counts the earlier attempts', and an overrun counts at the evidence.

### The recorded constants

Changeable only by a recorded decision. They live in SQL, as constant functions of `usage` (callable by no API role), and `lib/usage-reservations.ts` mirrors them as `usageConstants`; a test holds the two equal.

| constant | SQL function | value |
| --- | --- | --- |
| fixed overhead | `usage.overhead_tokens()` | 2,000 tokens |
| tokens per image | `usage.image_tokens()` | 5,000 |
| margin | `usage.margin_percent()` | 10% |
| input ceiling (the raised bound) | `usage.input_ceiling()` | 200,000 tokens |
| output ceiling | `usage.output_ceiling()` | 16,000 tokens |
| request ceiling | `usage.request_ceiling()` | 20 |
| operation cap | `usage.operation_cap()` | 1,000,000 microdollars ($1) |
| Job cap | `usage.job_cap()` | 5,000,000 microdollars ($5) |
| ambiguity deadline | `usage.ambiguity_deadline()` | 24 hours |

### Rollout

The migration (`supabase/migrations/20261024120000_usage_reservations.sql`) is additive except that it **drops `usage.fixture_figures`** (Story 2.4's empty stand-in, read only by `usage.period_figures`) and **re-creates `usage.period_figures` and `api.preflight`** (fifty `api` functions in all, without the fixture probe); the previous build never calls the new functions, so it is unaffected, and the new build's preflight fails with one line if the file is missing. The code is `lib/usage-reservations.ts` (typed calls, the constants, the vocabularies and the cost block); the behavior is pinned by `tests/integration/usage-reservations.test.ts`, `tests/unit/usage-reservations.test.ts` and `tests/unit/gate-structure.test.ts`; `tests/support/usage-ledger.ts` makes real ledger rows as the owner for the tests that need a period in a state.

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

Every committed Account status or epoch change, invitation or pre-authorization consumption, invitation revocation, recovery redemption and tombstone queues exactly one event in `lifecycle.ledger_outbox` **in the same transaction**, by triggers on the tables themselves, so no path can forget and a rolled-back change leaves no event. An event holds opaque IDs, statuses and revisions only (never an address, a title, a code, a token or a hash of one); a tombstone's carries the status handle. The relay (`relayLedger` in `lib/ledger.ts`, a function: claim, append, mark) copies the events, in order, into a `LedgerStore` as hash-chained objects; a store outage leaves the change in force and the event pending (`api.ledger_pending` counts it). Story 1.9 schedules the relay (it records `no_store` and relays nothing until Story 8.9 supplies the store). A restore cannot roll the ledger back, because it is outside the database; Story 8.4 replays it before access reopens.

## The file gateway

Story 1.12 builds the one place a user's private file moves: `workers/files`, a Node HTTP gateway on Railway. No user file crosses a Vercel function (it caps a request or response body at 4.5 MB), no storage credential or reusable URL ever reaches a browser, and access stops mid-transfer when it is revoked. It is built on this contract: it cannot call `lib/authority.ts` (it holds no service-role key and reaches Postgres directly, as its own role, `nova3d_gateway`), so the SQL views and functions of the `artifacts` schema are the SQL twin of the application's guards, and a test keeps them equal. The schema is closed by default: it is not exposed by the Data API, every table has row-level security on, and every privilege is revoked from `public`, `anon`, `authenticated` and `service_role`. A table with row-level security on admits a role that is not its owner only through a policy, so the three tables the gateway's role reads and writes (`staging_leases`, `ticket_redemptions`, `transfer_handles`) carry policies **only `to nova3d_gateway`**, one for each command the role is granted; no policy names another role or `PUBLIC`, the other three tables have none, and the grants (not the policies) decide which commands and columns the role has.

### A ticket opens one transfer

The application signs a **ticket** (`POST /api/transfers/tickets`, a private route: origin, signed-in Account and CSRF token first) and answers `{ticket, gateway}`. A ticket is an Ed25519 token (`lib/service-signing.ts`) valid for five minutes and for ONE use, bound to the verified Account, the session grant and the Account's authorization epoch (all from `access`, never from the request), one direction (`upload` or `download`), one kind of target and one target ID, and, for an upload, the class (`picture` or `file`), length, SHA-256 and content type the gateway then holds the bytes to. It holds no storage credential, no URL and nothing reusable.

The gateway verifies it in this order, with one refusal that names no reason (`401 invalid_ticket`): size, shape, issuer and audience, environment, key (the active one, or the retiring one before its `until`), signature, lifetime (at most 300 seconds), skew (`iat` at most 60 seconds ahead) and expiry. It then checks that the session grant is live and is the Account's and epoch's the ticket names, and REDEEMS the ticket by inserting its `jti` into `artifacts.ticket_redemptions` (the primary key: a replay fails) together with a **transfer handle** (32 random bytes, of which only the SHA-256 is stored) bound to the session grant, Account, epoch, target, direction and signing key for at most 30 minutes. The redemption is also where a revoked key is refused ("Keys and compromise", below): the verifier above does not take the revocation, because the gateway's role may not read the revocations. The handle is internal unless the browser-native download hands it out. Resuming an interrupted download, or reading another range, needs a new ticket; an interrupted upload restarts.

### Every chunk asks again

Before **every chunk of at most 1 MiB**, in both directions, the gateway reads `artifacts.session_authority` through the handle and the target's state through its resolver, in Postgres, and never caches the answer. For a **download** the answer is:

| answer | what the gateway does |
| --- | --- |
| `allowed` | the chunk moves |
| the handle ended, expired, or the session grant, Account or epoch is no longer allowed | stops: 403 before the first byte, a closed stream after |
| the target is not there for this direction (the resolver says `unavailable`) | stops: 404 before, a closed stream after |
| the database does not answer | stops: 503 before the first byte, a closed stream after, never a cached allow |

A download that ends having sent fewer bytes than its `Content-Length` (the object was cut short in Storage) is not finished quietly: the gateway cancels the read and destroys the response, so a client sees a failed transfer and never a short file that looks whole.

An **upload** has no such table, because its answer is the end of the request, not the start of a stream. The check before each chunk is the same, and a chunk that is not `allowed` halts the upload at that chunk: the multipart upload is aborted (no object and no parts remain), the lease is released, and the request is answered with a status after all (a client that has gone away is not answered). The status is `403 forbidden` when the handle ended or expired, or the session grant, Account or epoch is no longer allowed (a key revoked meanwhile ends the handle, so it is this too); `409 upload_ended` when the lease itself is gone from under the upload (the resolver says the target is not there, or the write that records progress or completion finds the lease released or expired); `503 unavailable` when the database did not answer; and `400` when the bytes are not what the ticket promised (`content_mismatch`, `checksum_mismatch`, `length_mismatch`). A ticket redeemed under a revoked key never gets that far: it is a `401 invalid_ticket` at redemption. An upload that is refused or halted does not make the gateway read what the client is still sending: it reads and discards at most 64 KiB, however large a length was declared, answers, and then destroys the connection, so a refused upload of a hundred megabytes costs the gateway at most that much.

Bytes already delivered are not recalled. `artifacts.session_authority` is one row per session grant with the liveness `api.authorize_session` answers (tombstoned, disabled, no Auth session, revoked, expired at 30 days, idle at 7, stale epoch, subject mismatch), and never writes. A **resolver** maps a kind of target to a function that reads one Postgres authorization view or table for it: Story 1.12 registers `staging` (a lease of the same Account, not expired, not released; a download reads one that is complete), and Story 2.12 registers `retained` ("Retaining pictures", below). A kind with no resolver is refused, by the route that issues the ticket (400) and again by the gateway. The Project resolver (Story 1.7's wiring), artifact manifests (4.1) and exports (6.9) register theirs in `workers/files/src/resolvers.ts` and in `transferTargetKinds` (`lib/service-signing.ts`): the registry is the extension point.

### Staging, attaching, deleting

An upload streams into the private bucket `private-files` (multipart, the gateway's own S3 key pair), computing SHA-256 as it goes, and is `complete` only after the checksum, the content type (a picture's leading bytes must be a JPEG, PNG or WebP's, at most 12 MiB; any other file is `application/octet-stream`, at most 100 MiB), the size, the owner and the Account's open-staging quota (250 MiB) have passed; a failed upload deletes its partial object and releases its lease. A lease lasts 24 hours and activity renews it. Attaching is a command (`POST /v1/commands`, `attach`, application-signed). The gateway builds the manifest body, serializes it with RFC 8785 (`lib/canonical-json.ts`) and takes its SHA-256, the **root**; copies the verified staged object to `objects/<account>/<root>`; and calls `artifacts.publish_attachment`. The key is the manifest's own: the body holds the upload's ID, so two uploads of the same bytes are two manifests with two roots and two objects, and `delete-root` with a manifest's root deletes exactly that manifest's object and no other. If the function answers anything but `published` or `exists`, the gateway deletes the copy it just made, so a refused attach leaves nothing under `objects/` (unless the lease, read again, says another attach of the same upload published meanwhile: that manifest has the same root, so the copy is its object and stays); a repeat of an attach that already published returns the same manifest and does not touch the object.

`artifacts.publish_attachment` asserts the operation's authority in the transaction of the write (`identity.assert_operation_authority`, so a disable cannot commit between the check and the write); checks that the lease is the Account's own, `complete` and not expired (a lease whose time has run out may be deleted by the cleanup at any moment, so it is `expired`, not attachable) and that the transform is registered (`none`, and since Story 2.12 `strip-picture-metadata`, which describes the stripped copy: "Retaining pictures", below); requires the root to be the SHA-256 of the body and the body to be, byte for byte, the canonical text the function itself builds from the lease (so whitespace, another order of members, a repeated member or an escape is refused: a root is only ever the hash of canonical bytes); and inserts the immutable manifest and marks the lease `attached`, once.

Only the gateway deletes Storage objects. The application sends signed commands (`delete-staging` for an upload's exact prefix, `delete-root` for one object) that the gateway executes with its own key; the hourly `staging-cleanup` task (Story 1.9's scheduler) sends one `delete-staging` for each lease `api.list_expired_staging` names (expired or released), and the gateway re-checks, in one statement, that the lease is still expired or released before it deletes anything: a lease that was renewed meanwhile is kept. A lease is marked `deleted` only after the store has deleted every object under its prefix: Storage can answer a batch delete with 200 and a list of keys it could not delete, and the gateway reads that list, answers 503 for the command and leaves the lease `released`, so the next run lists it again. The task handles each lease on its own: a gateway that is unreachable or answers 5xx stops the run (the rest would fail the same way), any other refusal of one lease is counted and the run goes on to the leases behind it, and a run with any lease uncleaned fails at the end with the class `StagingCleanupIncompleteError` (and nothing else), so the scheduler retries it. A command is redeemed once through the same record as a ticket, is refused when it carries an `Origin`, and deletes nothing unless the application's key signed it.

### Keys and compromise

The service-signing contract (`lib/service-signing.ts`, `docs/secrets.md`) keeps one active key and at most one explicitly retiring key for each issuer; a ticket under the retiring key is accepted only until its `until`. A suspected compromise is `api.revoke_service_key(issuer, kid, reason)`: in one transaction it records the revocation and ends every staging lease and transfer handle opened under the key.

**Where a revocation bites.** The pure verifier (`verifyToken`) has an optional `isRevoked` hook for a receiver that can read the revocations, but the gateway does not pass one: its role may not read `artifacts.service_key_revocations`, so a revoked key still passes verification. The refusal is made by the insert that redeems: a BEFORE INSERT trigger on `artifacts.ticket_redemptions` raises `N3040` for a revoked `kid`, and the gateway answers `401 invalid_ticket` (the same refusal as any other bad ticket). The trigger and `api.revoke_service_key` take the same advisory lock, keyed by the key ID, so a redemption in flight is ended by the revocation, and one that waits for it is refused. The revocation also ends the key's open leases and handles, so an upload already moving is halted at its next chunk (`403 forbidden`, its handle has ended) and a download is closed at its next. A revoked `kid` is never reused: a rotation always uses a new `kid`, and a revoked one stays refused for ever. The browser-native download (`GET /d/<ticket>`, a 303 to `/h/<handle>/<target id>`) is a bearer capability tied to the session grant, revoked with it, limited to 30 minutes and sent with `Referrer-Policy: no-referrer`; it is not bound to the browser.

The code is `workers/files/src/` (the server, the resolvers, the storage and the database layers), `lib/service-signing.ts`, `lib/canonical-json.ts`, `lib/transfer-tickets.ts`, `lib/gateway-client.ts` and `app/api/transfers/tickets/route.ts`; the database is `supabase/migrations/20261015120000_file_gateway.sql`; the behavior is pinned by `tests/unit/gateway-server.test.ts`, `tests/unit/service-signing.test.ts`, `tests/integration/file-gateway.test.ts`, `tests/integration/file-gateway-db.test.ts` and `tests/e2e/file-gateway.spec.ts`.

## What this does not do

It does not decide whether a *person* may open a page (that is the live authorization of a request), and it does not itself move a file (the gateway above does, under this contract, with the resolver registry in place of `resolveProjectTarget` until a story attaches files to a Project as a general target). It deletes nothing: an Account's Workspace is kept when the Account is disabled, and a tombstone only hides (the deletion commands, the manifests and the purge are Stories 8.1 to 8.3; the procedure that proves absence is [deletion-verification.md](deletion-verification.md)).

The code is `lib/authority.ts`, `lib/project-target.ts`, `lib/lifecycle.ts`, `lib/hidden-state.ts` and `lib/ledger.ts` (and, for the gateway, the files named at the end of "The file gateway"; for Jobs, `lib/job-records.ts`); the database functions are in `supabase/migrations/20261012130000_account_administration.sql`, `supabase/migrations/20261012150000_projects.sql` and `supabase/migrations/20261013120000_tombstones_and_ledger.sql`; the behavior is pinned by `tests/integration/account-administration.test.ts`, `tests/integration/projects.test.ts`, `tests/integration/tombstones.test.ts`, `tests/unit/authority.test.ts`, `tests/unit/projects.test.ts`, `tests/unit/hidden-state.test.ts` and `tests/unit/ledger.test.ts`.
