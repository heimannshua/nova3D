---
title: 'Story 2.2: Stage ordered multi-view images privately'
type: 'feature'
created: '2026-10-19'
status: 'done'
baseline_commit: '796d11e27afd9b9c4cab75878ebe8a1f788e40c9'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-2-context.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-2-1-confirm-natural-language-intent-and-personalization.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-1-12-transfer-private-files-through-the-authorized-gateway.md'
  - '{project-root}/_bmad-output/specs/spec-nova3D-story-2-2/acceptance-criteria.md'
  - '{project-root}/_bmad-output/specs/spec-nova3D-story-2-2/implementation-constraints.md'
  - '{project-root}/docs/authority-contract.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** A person cannot start from pictures. Nothing lets them choose or photograph several views of one subject, see and order them, and keep them privately, so no request can preserve which pictures, in which order, a later quality check, subject identification and research will start from. Nothing yet uses the Story 1.12 gateway from a browser either.

**Approach:** Add the picture intake screen (C-03): choose files, take a photo on a device with a camera, preview, add, replace, reorder and remove up to 12 angles locally; hash each file in the browser and send it to the gateway's private staging with a single-use ticket, so no image body crosses a Vercel function. Saving records the ordered set as an immutable request revision of a Project (the Project is created by the first save; a later save is a successor), through one idempotent command that reads each upload's trusted digest, length and type from its lease, enforces the limits, renews the leases within a bound and frees the uploads that left the set. Nothing is chosen, researched, retained or confirmed yet: those are Stories 2.3, 2.12 and 2.13.

## Boundaries & Constraints

**Always:** Consult `node_modules/next/dist/docs/` before writing Next.js code (AGENTS.md). No new npm dependency (no image or HEIC library), environment variable or secret, no CSP or Permissions-Policy header, no new `route.ts`. **Limits:** 1 to 12 images, each JPEG, PNG or WebP of 1 byte to 12 MiB, 60 MiB for the set, no two images with the same SHA-256 in a set; the 250 MiB staging quota and the content checks stay the gateway's. Everything the browser says about a file is checked again by the database from the lease. **The set** (`lib/picture-set.ts`, pure, client-safe, no runtime imports): constants; the item model (a key, `state` of `checking|uploading|ready|failed`, progress, SHA-256, length, content type, upload ID, a local preview URL); `addFiles`, `replaceItem`, `removeItem`, `moveItem` (to an earlier or later position), `totals`, `orderedUploadIds`; and `fileProblem(file, set)` naming one of `type`, `empty`, `too_large`, `too_many`, `set_too_large`, `duplicate`, `unreadable`. A HEIC or HEIF file is a `type` problem whose message names the three accepted formats through placeholders (the Hebrew catalog may not contain a Latin word). **Upload** (`lib/picture-upload.ts`, browser, every dependency injectable): `crypto.subtle.digest('SHA-256')` of the whole file (a secure context is required, and the screen says so when it is missing); an upload ID from `crypto.randomUUID()`, new for every attempt (the gateway never accepts an ID twice); the ticket fetched immediately before its upload with the existing `csrfFetch` and the exact body `{direction:'upload', kind:'staging', id, class:'picture', length, sha256, contentType}`; the upload is `PUT <gateway>/v1/uploads/<id>` by `XMLHttpRequest` so progress can be shown, with `Authorization: Ticket …`, the file's content type, `x-content-sha256`, and the file itself as the body (Content-Length is required); the gateway's origin is the one in the ticket response and nowhere else. Uploads run one at a time. Every gateway answer becomes a named problem: 400 and 413 (content, type, length, checksum, size, `quota_exceeded`), 401 and 403 (ask the person to reload), 409 (retry with a new ID), 503 and a cut connection (try again); a refused upload may be cut before its answer is read, which is a retryable `network` outcome, never a crash. **Camera:** a Take photo button appears after hydration only where `navigator.mediaDevices.getUserMedia` exists; pressing it, and nothing earlier, asks for the camera; granted shows a live preview with Capture and Cancel and stops every track on capture, cancel and unmount; a captured frame becomes a JPEG `File` (canvas, quality 0.92) that enters the set like a chosen file; denied, no camera or an error shows the permission-denied state with words and leaves the file picker working; nothing is recorded about the camera. **Previews** are local object URLs of the chosen `File`s, revoked when an item leaves or the screen unmounts; the application never fetches, stores, renders or links a download of a staged image, and no reusable download URL exists on any page or payload. **Screen C-03** at `/projects/new/pictures` (a new set; the Create dialog's Upload picture Continue leads here, and its "later release" message and the no-match note are removed) and at `/projects/[projectId]/pictures` (the set of a Project whose latest revision is an unconfirmed picture request): permission prompt and permission denied (camera), choose files (multiple), previews with the position number, type and size, per-item Move earlier, Move later, Replace and Remove as real buttons (keyboard and touch complete, no drag and drop), per-item progress and error with Retry, set-level problems, an empty state, and Save pictures; phone and desktop, English and Hebrew with parity, focus moved to the new heading or first error, `useAnnounce` for every change of order and result, `aria-invalid`/`aria-describedby` on problems, logical CSS properties only, 44 px targets, no overflow at 200% text. Remove and Replace of an upload not yet saved call the Server Action `discardPictures`, which releases it at once. **Records** (migration `20261019120000_picture_sets.sql`, `projects` schema): `projects.request_revisions` gains the unconfirmed state: `confirmed_at`, `description`, `scope` and `outcome` may be null together and only together, `mode = evidence_text` requires them, and a picture revision created here has them null, `subject_id` null, no personalization (`applied` false), and the provisional mode `evidence_images`, which no screen presents as a choice (Story 2.3 persists the explicit choice as a successor); `projects.request_images` (`revision_id`, `project_id`, `account_id`, `position` 1 to 12, `upload_id`, `sha256`, `length`, `content_type`; primary key `(revision_id, position)`, unique `(revision_id, upload_id)`, restricted foreign keys, checks copied from `artifacts.staging_leases`, never updated or truncated, closed like `request_revisions`); a trigger makes `seq` exactly the Project's highest `seq` plus one; the Project stage check gains `request_draft`. `api.record_picture_set(account, epoch, command_id, project_id, title, upload_ids)` (`project_id` null creates the Project): validates its arguments (22023: 1 to 12 IDs, no repeated ID, a title only when creating); `identity.assert_operation_authority` first (`denied`); the advisory lock `'project_command:'||account||':'||command`; replay for the same command and digest, `reused` for another digest or a command a rename used; for an existing Project the row locked `FOR UPDATE` with the Account, `deleted_at is null`, not tombstoned (`unavailable`, one answer), and only while its latest revision is an unconfirmed picture revision (`not_editable` otherwise); every upload read from `artifacts.staging_leases` as the definer: another Account's, unknown, or not `picture` is `unknown_upload` with its position, not `complete` is `not_ready`, expired is `expired_upload`; the sum of lengths over 60 MiB is `too_large`; the same ordered uploads as the latest revision is `unchanged`; otherwise one transaction inserts the Project at revision 1 with stage `request_draft` (creating) or raises its revision by exactly one and sets `updated_at` (successor), inserts the revision and its images in order with the digest (SHA-256 over length-prefixed fields: project, ordered position, upload, SHA-256, length, type), sets each included lease's `expires_at` to the earlier of 24 hours from the database clock and 7 days after the lease was created, and releases (state `released`) every lease the previous revision used that no recorded revision of the Account still uses. `api.release_staged_pictures(account, epoch, upload_ids)` releases only the Account's own `picture` leases in state `receiving` or `complete` that no `request_images` row uses and answers how many. `api.read_project_request` returns, for the latest revision, `confirmed`, the nullable text fields, and `images` (position, upload ID, SHA-256, length, content type, expiry and whether it is still available); `api.rename_project` refuses a command ID that a revision used (`reused`), closing the one-directional lock of Story 2.1. `api.preflight` is re-created with every earlier probe. **Application:** typed calls `recordPictureSet`, `releaseStagedPictures` and the extended `readProjectRequest` in `lib/projects.ts` with every outcome checked; Server Actions `savePictureSet` and `discardPictures` in `app/projects/new/pictures/actions.ts` (`withActiveAccount`, `operationOf`, `withinBudget`, the command ID chosen when Save is pressed): `created` redirects to the new Project, `revised` and `unchanged` to its page, `denied` as rename does, an unknown outcome tells the person to check My Projects (a retry with the same command is safe); every refusal outcome becomes its own message. **The Project page** shows a Pictures part in its Request section for a picture revision (count, position, type, size, a short SHA-256, when the staging lapses, a warning for an expired one, "not confirmed yet") with a Change pictures link while it is editable; `request_draft` has a label, a next-action sentence saying the pictures are saved privately, that choosing how to use them and confirming arrive later and that nothing has started or was charged, an icon no other stage uses, a tone and no destination. The undecodable-ID rewrite in `lib/project-paths.ts` covers the new `/pictures` child. **Docs:** `docs/authority-contract.md` (the picture-set writer follows the successor rules; lease renewal is bounded; release rules), `docs/staging.md` (migration row; the gateway origin must equal the application's origin setting for browser uploads, locally included), `README.md`.

**Ask First:** Any change to the gateway, its tickets or its CORS; a new route, header policy, dependency, environment variable or secret; retaining, attaching, transforming or stripping a picture (Story 2.12); choosing a picture mode, checking quality or angle coverage, Generate anyway (2.3); any download, thumbnail or preview of a staged image from the server; a different limit or lease bound; any step against staging, production or a provider.

**Never:** Picture mode choice, quality checks, view labels or Generate anyway (2.3); retained pictures, EXIF or location stripping, the 2 GiB quota or the retained-picture resolver (2.12); identifying the subject, research, plans, permissions, cost or Jobs (2.13, 2.5 to 2.9, 3.x); device capture, offline bundles or sync (7.x); a server-side image decode, resize or conversion; drag and drop as the only way to order; any image body in a Server Action, a Vercel function or a log; editing an expectation to make a test pass except the pins this spec names.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Choose files | 3 valid images | Hashed, previewed in order, uploaded one at a time with progress, each ready | A refused one shows its own problem with Retry; the others stay |
| Bad files | A text file; HEIC; 0 bytes; 12 MiB + 1; a 13th image; a set over 60 MiB; the same file twice | `type`, `type`, `empty`, `too_large`, `too_many`, `set_too_large`, `duplicate`: not added, plain words, nothing uploaded | Named per file in both languages |
| Content lies | A `.png` that is not an image | The gateway's `content_mismatch` shown as a file problem; nothing staged | Retry offered after replacing it |
| Reorder | Move image 3 earlier | Positions renumbered, announced, order kept in the saved set | N/A |
| Replace / Remove | An unsaved upload | `discardPictures` releases its lease at once; quota freed | Failure to release is silent and the lease lapses on its own |
| Take photo granted | Phone, camera allowed | Camera asked only now; live preview; Capture adds a JPEG as the next angle; tracks stopped | N/A |
| Take photo denied | Camera blocked or absent | Permission-denied state in words; Choose files still works | N/A |
| Save new set | 3 ready images | One command creates the Project (stage `request_draft`, revision 1) and revision 1 with the 3 images in order; redirect to the Project | N/A |
| Edit and save | Reorder, replace one, remove one, save again | Successor revision `seq + 1`, Project revision + 1, images in the new order; the previous revision unchanged; uploads that left the set are released; the same order again is `unchanged` | N/A |
| Same command twice | Same command, same set | The first result (`replayed`), no second Project or revision | N/A |
| Command reused | Same command, another set; or an ID a rename used | `reused`, nothing written | N/A |
| Foreign or unknown upload | Another Account's upload ID; a made-up ID; an ID of a `file` upload | `unknown_upload` with the position, nothing recorded; the page says to add it again | N/A |
| Not ready / expired | An upload still receiving; a lease past its expiry | `not_ready`; `expired_upload` with the position | Replace it and save again |
| Set too large | Lengths sum over 60 MiB (database check, not the browser's) | `too_large`, nothing recorded | N/A |
| Lease renewal | Save at hour 23; save after day 7 | Included leases renewed to 24 h from now, never past 7 days from their creation | An expired lease is `expired_upload` |
| Authority | Disabled, stale-epoch or tombstoned Account; a deleted or another Account's Project | `denied`; `unavailable` (one answer for the Project cases); nothing written | N/A |
| Not editable | A text request Project, or a confirmed revision | `not_editable`, nothing written | N/A |
| No download URL | Any page, payload or response of this flow | No reusable download URL, no download ticket, no thumbnail from the server | N/A |
| Gateway or database down | Ticket 503; upload cut; save unreachable | Retryable messages; nothing recorded; a retry never makes two Projects | N/A |

</frozen-after-approval>

## Code Map

- `supabase/migrations/20261019120000_picture_sets.sql` -- new. Model on `20261018120000_request_revisions.sql`: table and checks :82-138 (mode :90, `subject_required` :128, `applied_shape`/`not_applied_shape`/`reason_shape` :130-137, `unique (project_id, seq)` :126, `unique (account_id, command_id)` :127), `refuse_revision_change` :144-156, closure :160-163, `projects.length_prefixed` :171-177 (digest), `create_project_request` :203-348 (order of checks: arguments 22023 :235-265, authority N3010 to `denied` :268-273, advisory lock :276, `project_commands` check :279, replay :302-320, tombstone via `lifecycle.is_tombstoned` :311), `read_project_request` :355-412 and its types :182-199 (changing `api.project_request_view` means dropping and recreating the function and the type; `request-revisions.test.ts` :174-206 and :1036-1052 pin the exact shape and the column list and forbid `manifest|job|cost|price|payment` in column names), stage check `20261012150000_projects.sql` :62-63, `guard_project` :87-104 (revision +1 exactly on every UPDATE), `rename_project` :254-335. `artifacts.staging_leases` `20261015120000_file_gateway.sql` :96-115 (states receiving, complete, attached, released, deleted; `guard_lease` :128-159 allows complete→released and does not constrain `expires_at`; no `project_id`; the application role cannot read `artifacts`, so the new functions are definers like `list_expired_staging` :581-605 and `publish_attachment` :396-470, whose checks :421-442 are the template for ownership, `complete` and not expired). The latest `api.preflight` is in `20261018120000_request_revisions.sql` :422- (re-create it carrying every probe; the `toHaveLength(33)` signature lists grow).
- `lib/projects.ts` :172 (`createProjectRequest`), :263 (`readProjectRequest`), `callRow`/`oneOf`/`requireUuid`/`unexpected` (`lib/accounts.ts` :324-403): the typed calls live here only (`gate-structure.test.ts` ~:2240-2258). `app/projects/new/actions.ts` is pinned to exactly two exports (:2261-2275): the new actions go in `app/projects/new/pictures/actions.ts` (a `'use server'` file; no `requireMutationAccess`, `verifyCsrf` or `csrfHeaderName`, :409-413; no `route.ts` may have "project" in its path, :1125-1128 and :2272, so there is no API route). Model: `app/projects/new/actions.ts` :38 and :68 and `app/projects/actions.ts` :62-110 (`withActiveAccount` `lib/auth.ts:176`, `operationOf`, `withinBudget`, `failed()`, `outcomeUnknown`).
- Client pieces to follow: `components/projects/request-intake.tsx` (`useActionState` :108/:139, refs for focus :76-82, hidden inputs :374-377, command ID chosen at submit :246-254 via `lib/request-view.ts` :119-207; do not edit it, it is pinned: exactly one `newCommandId(` and four `dir="auto"`, :2486-2500). `lib/csrf-client.ts` :65 `csrfFetch` (same-origin only, so the gateway PUT uses `XMLHttpRequest`; the proxy sets the CSRF cookie only on a document navigation, so a missing cookie is a 403 until a reload). `components/ui/announcer.tsx` :12 (`useAnnounce`), `Button`, `IconButton`, `Notice`, `EmptyState`, `Dialog`; icons available (`components/ui/icon.tsx` :3-7): `image`, `close`, `plus`, `check`, `back`, `arrow`, `chevron-down`, `clock`, `alert-triangle`, `info-circle`, `help`. There is no camera, upload or trash icon: add what is needed or use words. Components under `components/projects/*` may not import `@/lib/{accounts,access,auth,authority,projects,project-pages,project-target}`, `next/headers`, `next/cache` or `node:crypto` (:1112-1116, :2331-2334); the Web Crypto global is fine. `FILE_GATEWAY_URL`, `SERVICE_KEYS_*` and `SERVICE_SIGNING_KEY_*` are read only by four lib files (:1627-1631): the browser learns the gateway from the ticket response, never from the environment. `'x-csrf-token'` and `'nova3d-csrf'` appear only in `lib/request-integrity.ts` (:380-386). Dependencies are pinned (:2347-2350).
- Gateway contract the browser meets: `app/api/transfers/tickets/route.ts` :11-15 (POST, `requireMutationAccess`, body cap 4096, exact member list, 200 `{ticket, gateway}`, 400 `invalid_request` with `field`, 413, 503 `unavailable`), `lib/transfer-tickets.ts` :78 and :103-107 (the body needs `sha256`, `length`, `contentType`), `lib/service-signing.ts` :310-321 (limits), :325 (types), :351 (`uploadProblem`), `workers/files/src/server.ts` :73 and :662 (`PUT /v1/uploads/<uuid>`), :272-287 (required headers), :349 (201 `{id,length,sha256}`), :160 and :167-173 (503 `retry-after: 5`; a refused upload drains 64 KiB and the connection is cut), :621-655 (CORS: exact `APP_ORIGIN`, preflight for the upload route, allowed headers `authorization, content-type, x-content-sha256`; `localhost` and `127.0.0.1` are different origins), `workers/files/src/database.ts` :254-276 (quota), :289-307 (lease renewal per chunk and at completion; a `complete` lease never renews), :309 (`release` works only on `receiving`), :314-322 (`delete-staging` answers `kept` for a live lease). Dev and e2e wiring: `playwright.config.ts` :18-20 and :105-117 (gateway on PORT+2 = 4175 with `APP_ORIGIN` http://127.0.0.1:4173), `tests/support/service-keys.ts` :59-62, `tests/support/gateway-world.ts` :31-33 (png, jpeg, webp bytes), `tests/e2e/file-gateway.spec.ts` :40-47 and :66-90 (`memberPage`, `uploadFromPage`), `tests/unit/playwright-config.test.ts` :95-140 (pins server count, ports and env: launch options for a fake camera are outside it).
- Stage and Project page: `lib/project-stage.ts` :19-26, :50-67 (no two stages share an icon: search, doc, spark, grid, x-octagon, check-circle and the one 2.1 added are taken), `lib/i18n/en.ts` :137-148, `lib/project-fixtures.ts` and `projects-filter.ts`, `scripts/seed-projects.mjs` (reads `project-stage.ts` through type stripping and deletes revisions before Projects :95), `components/projects/request-section.tsx` :29 and `personalization-summary.tsx`, `lib/project-pages.ts` :64 (`loadProjectRequest`), `app/projects/[projectId]/page.tsx` :41, `lib/project-paths.ts` :17-35 (the undecodable-ID rewrite covers `/projects/<id>` and `/sources` only: add `/pictures`; pinned by `project-view.test.ts` :68-69), `tests/unit/page-guards.test.ts` :36-80 (every `page.tsx` calls `await requireActiveAccount()`; project pages call `loadProject(access.account.accountId, access.account.epoch, projectId)` after it).
- Create dialog and stubs: `components/shell/create-dialog.tsx` :54-57 (`create.imageLater`, Continue only for text), `components/projects/request-intake.tsx` :349-351 (`request.noMatch.pictureLater`); pinned by `tests/unit/request-pages.test.tsx` :391 and :416, `tests/e2e/request.spec.ts` :126, :149, :484, :753, `signed-in-shell.spec.ts` :282-296, `shell.test.tsx` :230-269.
- Pins and helpers for the database half: `accounts.test.ts` :47 (`tables.projects`), :127 (17 tables), :52 and :166 (`apiFunctions`, in database sort order); `isolation.test.ts` :135-198 (a request body for every `api` function); the non-owner preflight probes need the new tables in `session-grants.test.ts` :1167-1213, `account-administration.test.ts` :934-964, `scheduled-jobs.test.ts` :1158 and :1218, `file-gateway-db.test.ts` :1818 and :1860; `staging-guide.test.ts` :29-48 (a `docs/staging.md` row, in order, three cells over ten characters); request-revisions tests that insert successors directly :244-247 and :1054-1055 (the `seq` trigger changes them on purpose); cleanup deletes `request_images` before `request_revisions` in `tests/support/accounts-data.ts` :112, `forged-session.ts` :334 and `scripts/seed-projects.mjs` :95. The 2.1 spec's Code Map (`spec-2-1-…md`) lists the screen, i18n (`i18n.test.ts` :18-62, no Latin word of two or more letters in `he.ts` except nova3D and Google: write JPEG, PNG, WebP and MiB through placeholders), CSS (`design-tokens.test.ts` :110-190) and e2e helper pins (`tests/support/e2e-helpers.ts`: `variants`, `violations`, `overflowReport`, `setFontSize`, `hydrated`, `alertOf`).
- Names to avoid: `manifest` (artifacts), `root`, `retained`, `pin` (Story 2.12), `ordinal` (Jobs), `digest` for the image column (use `sha256`).

## Tasks & Acceptance

**Execution:**
- [x] `supabase/migrations/20261019120000_picture_sets.sql` -- the unconfirmed state, `request_images`, the `seq` trigger, `request_draft`, `record_picture_set`, `release_staged_pictures`, the extended read, the rename collision check, closure, preflight -- AC-2, AC-3, AC-4
- [x] `lib/picture-set.ts`, `lib/picture-upload.ts` -- the pure set and the browser hash, ticket and upload -- AC-2, AC-3
- [x] `lib/projects.ts`, `lib/project-stage.ts`, `lib/project-fixtures.ts`, `lib/project-paths.ts`, `lib/i18n/en.ts`, `lib/i18n/he.ts` -- typed calls, the stage, the rewrite, all copy in both languages -- AC-1, AC-2
- [x] `app/projects/new/pictures/page.tsx`, `app/projects/[projectId]/pictures/page.tsx`, `app/projects/new/pictures/actions.ts`, `components/projects/picture-intake.tsx` (and what it needs), `app/globals.css` -- C-03 -- AC-1, AC-2, AC-3
- [x] `components/shell/create-dialog.tsx`, `components/projects/request-intake.tsx`, `components/projects/request-section.tsx`, `lib/project-pages.ts`, `app/projects/[projectId]/page.tsx` -- the Create entry, the no-match note, the Pictures part of the Project page -- AC-2
- [x] `docs/authority-contract.md`, `docs/staging.md`, `README.md` -- the writer, the lease bound, the gateway origin -- housekeeping
- [x] `tests/` -- every matrix row: unit (the set operations and every problem, hashing and upload with injected fakes incl. each gateway answer and a cut connection), integration (record, successor, replayed, reused, rename collision, foreign, not ready, expired, too large, unchanged, renewal and its bound, release, authority, isolation, immutability, `seq` trigger, closure, preflight), component (every C-03 state), browser on desktop and phone in both languages with the real gateway (choose, preview, reorder, replace, remove, bad files, 12 MiB + 1, camera granted with a fake device and denied, save, reload, edit, a foreign upload ID, no download URL, axe, overflow, 200% text, keyboard); update the pins above -- all ACs
- [x] `_bmad-output/implementation-artifacts/deferred-work.md` -- previews after a reload (2.3), retained pictures and EXIF (2.12), gateway rate limits and open-lease cap, orphaned uploads that were never saved, HEIC, drag and drop, the provisional mode, the 7-day bound -- housekeeping

**Acceptance Criteria:**
- Given a phone with no camera permission, when Take photo is selected, then permission is requested then, and denial leaves existing-file intake usable.
- Given several images of one subject, when images are previewed, added, replaced, reordered or removed and the set is saved, then one immutable successor request revision preserves the resulting ordered digests, read from the leases and not from the browser.
- Given bad files, oversize data or a foreign upload ID, when attachment is attempted, then content, ownership and quota checks reject it, private bytes stay in lease-bounded staging, and no reusable download URL is exposed.
- Given an image that was replaced or removed, when the set is saved or the upload is discarded, then its staging is released at once and no longer counts toward the Account's quota.

## Spec Change Log

## Design Notes

The Project is born at the first save because the documents leave the birth of a picture Project undefined and Story 2.1 stores nothing unconfirmed for text: bytes must be staged before any Project can exist, and a successor needs a first revision. So a picture revision may be unconfirmed (nothing about scope is claimed), carries the provisional mode `evidence_images` (the explicit choice is Story 2.3's successor) and leaves the Project in `request_draft`, which says nothing has started.

The browser must hash first because the gateway's ticket binds the exact SHA-256, length and type. The database trusts none of it: it reads each lease. The gateway has no early release and no renewal, so the owner-run functions flip a replaced upload to `released` and move `expires_at` within a bound (24 hours from the database clock, never past 7 days from creation); a never-saved upload that is not discarded lapses on its own in 24 hours. Previews are local object URLs only, so there is no download URL to leak; after a reload the saved set shows as ordered rows without thumbnails.

```
POST /api/transfers/tickets  {"direction":"upload","kind":"staging","id":"<uuid>","class":"picture","length":482113,"sha256":"<64 hex>","contentType":"image/jpeg"}
PUT  <gateway>/v1/uploads/<uuid>   Authorization: Ticket …   x-content-sha256: <64 hex>   Content-Type: image/jpeg   (body = the file)
api.record_picture_set(account, epoch, command, null, 'Picture request', '{<uuid1>,<uuid2>,<uuid3>}') -> created, project, revision 1
```

## Verification

**Commands:**
- `npm run typecheck && npm run lint && npm run build` -- expected: exit 0
- `supabase start && npm test` -- expected: unit and integration pass, every matrix row covered
- `CI=1 npm run test:e2e` (stack started as CI does, fake Google active, gateway on its port) -- expected: all flows pass on both projects
- `node scripts/ci/check-repository.mjs && npm run render:provisioning -- --check && npm run test:env` -- expected: exit 0

**Manual checks (if no CLI):**
- With the stack and gateway up, sign in as a member, open Create, choose Upload picture, add three images, move one earlier, replace one, remove one, Save: the Project opens in "Request in progress" with the pictures in order. Change pictures, reorder, save: a successor. In a browser with the camera blocked, Take photo shows the denied state and Choose files still works.

## Suggested Review Order

**The one command that records the ordered set (start here)**

- Authority, lock, replay, then every upload read from its lease: ownership, readiness, expiry, size, duplicates.
  [`picture_sets.sql:183`](../../supabase/migrations/20261019120000_picture_sets.sql#L183)

- A picture revision may be unconfirmed; the checks tie that state to the picture mode.
  [`picture_sets.sql:65`](../../supabase/migrations/20261019120000_picture_sets.sql#L65)
  [`picture_sets.sql:72`](../../supabase/migrations/20261019120000_picture_sets.sql#L72)

- The ordered images, never updated; the seq trigger makes a revision follow the one before.
  [`picture_sets.sql:109`](../../supabase/migrations/20261019120000_picture_sets.sql#L109)
  [`picture_sets.sql:86`](../../supabase/migrations/20261019120000_picture_sets.sql#L86)

- Replaced and removed uploads are released at once, so the quota is freed.
  [`picture_sets.sql:403`](../../supabase/migrations/20261019120000_picture_sets.sql#L403)

- The read now returns the images and whether each is still available; rename refuses a revision's command ID.
  [`picture_sets.sql:469`](../../supabase/migrations/20261019120000_picture_sets.sql#L469)
  [`picture_sets.sql:552`](../../supabase/migrations/20261019120000_picture_sets.sql#L552)

**The browser: hash, ticket, upload**

- The gateway needs the exact SHA-256 first, so the file is hashed in the browser.
  [`picture-upload.ts:61`](../../lib/picture-upload.ts#L61)

- Ticket, then a PUT by XHR for progress; every gateway answer becomes a named problem.
  [`picture-upload.ts:101`](../../lib/picture-upload.ts#L101)
  [`picture-upload.ts:154`](../../lib/picture-upload.ts#L154)

- A queue runs uploads one at a time; a refused upload may be cut before its answer is read.
  [`picture-upload.ts:238`](../../lib/picture-upload.ts#L238)

- The camera is asked for only when Take photo is pressed; denial leaves files usable.
  [`picture-camera.ts:36`](../../lib/picture-camera.ts#L36)
  [`picture-camera.ts:75`](../../lib/picture-camera.ts#L75)

**The ordered set and the screen**

- The pure set: add, replace, remove, move, totals and every file problem.
  [`picture-set.ts:211`](../../lib/picture-set.ts#L211)
  [`picture-set.ts:294`](../../lib/picture-set.ts#L294)

- How a Save answer changes the screen, one pure function for every outcome.
  [`picture-view.ts:145`](../../lib/picture-view.ts#L145)

- C-03 itself: previews, per-item controls, progress, camera, Save.
  [`picture-intake.tsx:107`](../../components/projects/picture-intake.tsx#L107)

- The Server Actions: save the set, or discard what was never saved.
  [`actions.ts:57`](../../app/projects/new/pictures/actions.ts#L57)
  [`actions.ts:104`](../../app/projects/new/pictures/actions.ts#L104)

- The typed calls, every outcome checked.
  [`projects.ts:343`](../../lib/projects.ts#L343)
  [`projects.ts:380`](../../lib/projects.ts#L380)

**Where it shows**

- Two pages for the same screen: a new set, and the set of a Project.
  [`page.tsx:13`](../../app/projects/new/pictures/page.tsx#L13)
  [`page.tsx:23`](../../app/projects/[projectId]/pictures/page.tsx#L23)

- The Create dialog now leads on to pictures; the Project page shows them in order.
  [`create-dialog.tsx:20`](../../components/shell/create-dialog.tsx#L20)
  [`request-section.tsx:31`](../../components/projects/request-section.tsx#L31)

- A new stage tells the truth: pictures saved, nothing started.
  [`project-stage.ts:19`](../../lib/project-stage.ts#L19)

**Docs**

- The writer, the lease bound and the release rules.
  [`authority-contract.md:132`](../../docs/authority-contract.md#L132)

- The migration row, the gateway-origin requirement and why not to roll back.
  [`staging.md:77`](../../docs/staging.md#L77)

**Tests (peripheral)**

- The command against the real database: first save, successor, replay, foreign, duplicate, renewal, release.
  [`picture-sets.test.ts:247`](../../tests/integration/picture-sets.test.ts#L247)

- A tombstone must wait behind a save (mutation-checked).
  [`picture-sets.test.ts:596`](../../tests/integration/picture-sets.test.ts#L596)

- The set, upload, camera and save-answer logic with injected fakes.
  [`picture-set.test.ts:1`](../../tests/unit/picture-set.test.ts#L1)
  [`picture-upload.test.ts:1`](../../tests/unit/picture-upload.test.ts#L1)
  [`picture-view.test.ts:1`](../../tests/unit/picture-view.test.ts#L1)

- The whole flow in a real browser against the real gateway, phone and desktop, camera granted and denied.
  [`pictures.spec.ts:158`](../../tests/e2e/pictures.spec.ts#L158)
  [`pictures.spec.ts:752`](../../tests/e2e/pictures.spec.ts#L752)
