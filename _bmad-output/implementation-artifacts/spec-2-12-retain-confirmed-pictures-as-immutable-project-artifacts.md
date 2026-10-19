---
title: 'Story 2.12: Retain confirmed pictures as immutable Project artifacts'
type: 'feature'
created: '2026-10-20'
status: 'done'
baseline_commit: '52f587441f86f1abf664a7e3c79cd5bf3b62786a'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-2-context.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-2-3-choose-picture-mode-and-acknowledge-uncertainty.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-2-2-stage-ordered-multi-view-images-privately.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-1-12-transfer-private-files-through-the-authorized-gateway.md'
  - '{project-root}/_bmad-output/specs/spec-nova3D-story-2-12/acceptance-criteria.md'
  - '{project-root}/_bmad-output/specs/spec-nova3D-story-2-12/implementation-constraints.md'
  - '{project-root}/docs/authority-contract.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The pictures a person confirmed live only in lease-bounded staging, which lapses 24 hours after the last save and keeps their location data. A confirmed direct request can be stranded when its copies lapse, and nothing yet gives later steps (subject identification, research, conversion, recovery) the exact confirmed pictures to read.

**Approach:** At the end of the Story 2.3 review, keep the pictures: the gateway's attach step strips every metadata segment from the copy except the EXIF orientation, publishes it as an immutable manifest root, and the review's successor revision pins the ordered roots beside the staged digests they replace; staging copies then expire. Retention happens before the review is recorded, so a failure confirms nothing. A retained-picture resolver lets the application read the retained pictures back through single-use tickets, and a read lets later consumers resolve them in the confirmed order.

## Boundaries & Constraints

**Always:** Consult `node_modules/next/dist/docs/` before writing Next.js code (AGENTS.md). No new npm dependency, environment variable or secret, and no new `route.ts`. **Sequence:** (1) a read-only pre-check; (2) the attaches, in parallel; (3) the review writer, which pins what was published; (4) the staged copies expire. **Pre-check** `api.check_picture_retention(account, epoch, project_id, expected_seq, upload_ids)` (service role, no writes): `identity.assert_operation_authority` first (`denied`); the Project is the Account's, live and not tombstoned (`unavailable`, one answer); the latest revision's `seq` is `expected_seq`, it is a picture revision and its ordered uploads equal the supplied ones (`stale`; `not_editable` for a text request or a Project past the request stages); each upload is read from `artifacts` as the definer: another Account's or unknown is `unknown_upload`, a lease that is neither `complete` nor `attached` is `not_ready`, an expired lease without a manifest is `expired_upload` (all with the position); then the quota: the Account's retained pictures (the sum of `length` over its `artifacts.manifests` of kind `picture`) plus the staged lengths of the uploads that have no manifest yet must not exceed 2 GiB (2,147,483,648 bytes), else `quota_exceeded` for the whole confirmation with the bytes kept and the bytes asked; otherwise it answers, per position, `attach` (no manifest yet) or `retained` (a manifest of that upload exists, with its root). **Attach, in the gateway:** the existing application-signed `attach` command gains a transform, `strip-picture-metadata`, registered by the migration in `artifacts.attachment_transforms` (the transform `none` and the six-argument `publish_attachment` keep working exactly as before so the old gateway still works against the new database). With it the gateway reads the staged object (at most 12 MiB, so at most two objects are buffered at once), hashes it and refuses `bytes_changed` (409) unless its SHA-256 and length equal the lease's, strips it in memory with the new `workers/files/src/strip.ts`, hashes the result, builds the manifest body with the retained digest and length (canonical order unchanged: activity `upload:strip-picture-metadata`, children `[]`, digest, id, kind, length, scope, serialization), stores the result at `objects/<account>/<root>` and calls `publish_attachment`; a repeated attach recomputes the same bytes and so the same root (`exists`); a refused attach deletes its own copy as today. A picture whose structure it cannot parse is refused (`strip_failed`, 400) and never published unstripped. **The strip** is lossless for pixel data and removes metadata only, in plain Node with `node:zlib`'s `crc32` and no other import: *JPEG*: keep the start and end markers and every segment that decodes the image (DQT, SOF, DHT, DRI, DNL, SOS with its entropy-coded data and restart markers, and Adobe APP14), drop every other APPn (JFIF, EXIF, XMP, ICC, FlashPix, MPF, Photoshop and IPTC) and COM segment and anything after EOI; *PNG*: keep IHDR, PLTE, tRNS, IDAT, IEND, gAMA, cHRM, sRGB, sBIT, bKGD and the animation chunks acTL, fcTL, fdAT, drop every other chunk (tEXt, zTXt, iTXt, tIME, eXIf, iCCP, pHYs, sPLT, hIST and private ones); *WebP*: a simple file without VP8X holds no metadata and passes unchanged; with VP8X keep VP8, VP8L, ALPH, ANIM and ANMF, drop ICCP, EXIF, XMP and unknown chunks, clear their VP8X flags and rewrite the RIFF size. The EXIF orientation tag (0x0112, a value 1 to 8, read from the original EXIF with every offset bounds-checked) is the only metadata kept: re-written as a minimal orientation-only EXIF block (a 36-byte APP1 for JPEG, an `eXIf` chunk before the first IDAT for PNG, an `EXIF` chunk and the VP8X EXIF flag for WebP); no other tag, nor any GPS data, survives. Removing an ICC profile can change how a wide-gamut picture is displayed; this follows the story's "every metadata segment except orientation" and is documented. The Story 2.3 measurements stay valid because pixels are untouched. **Records** (migration `20261021120000_retained_pictures.sql`): `projects.request_images` gains nullable `retained_root` (64 lower-case hex), `retained_sha256` (64 hex) and `retained_length` (integer, at least 1), all present or all null; the review writer fills them from `artifacts.manifests` (never from the browser): for each upload it looks up the Account's manifest of kind `picture` by `upload_id` and takes root, digest and length from that row (the staged `sha256` stays beside them, so each retained digest maps to the staged digest the person confirmed, in order); the earlier test bans on those words in `request_images` column names are changed on purpose. `api.record_picture_review` keeps its signature and gains: every upload must have a manifest, else `not_retained` at the position; an `attached` lease is accepted when its manifest exists; `v_same` (the `unchanged` rule) also requires that the latest revision already pins the same roots; on commit the pinned leases' `expires_at` is set to the database clock so the hourly cleanup deletes the staged copies; replay by the unchanged command digest returns the same roots. `api.record_picture_set` accepts an `attached` lease whose picture manifest exists and carries that upload's pins into the unreviewed successor. `api.read_project_request` reports `available` true for a picture that is pinned. `api.read_retained_pictures(account, epoch, project_id)` (service role): `denied`, `unavailable`, `none` (nothing pinned), or `found` with the latest revision's pictures in order as `{position, upload_id, root, retained_sha256, retained_length, staged_sha256, label, content_type}` and nothing else. `artifacts.manifests` gains an index on `(account_id, kind)`. `publish_attachment` for the new transform takes the retained digest and length from the body (digest 64 hex; length from 1 to the lease's length plus 4,096), requires the staged lease as before, takes the advisory lock `nova3d:retained:<account>` and refuses `quota_exceeded` if the Account's retained pictures plus this length would pass 2 GiB (the race backstop for the pre-check). A manifest that is published but never pinned (a failed or abandoned confirmation) is kept, reused by the next attempt, and counted against the quota until Epic 8 can delete it. `api.preflight` is re-created with every earlier probe. **The resolver:** target kind `retained` (the ticket's `tid` is the picture's upload ID, equal to its manifest ID) in `lib/service-signing.ts`'s `transferTargetKinds` and in `workers/files/src/resolvers.ts`, backed by a new view `artifacts.retained_pictures` (security definer owner, read by the gateway role; it joins `projects.request_images`, `projects.projects` with `deleted_at is null`, an inline tombstone anti-join for kind `project`, and `artifacts.manifests`); a download is authorized only while the Account's session and Account are live (as every ticket) and the picture is pinned by a revision of a live Project of the same Account; it serves the object at `objects/<account>/<root>` with the retained length and content type; uploads of kind `retained` are refused. A foreign, unknown, deleted or tombstoned case is the same `unavailable`. **Application:** `lib/retention.ts` (server only; the one caller of the gateway's `attach` for pictures) runs the pre-check and then the attaches with at most 4 in flight, each with a 30-second limit (the client's attach timeout is raised for this), maps the gateway's answers to the named outcomes (`bytes_changed`, `lease_expired`, `not_complete`, `strip_failed`, `quota_exceeded`, `unavailable`, `manifest_conflict`) and keeps going on a retryable failure of one picture only to report it; `GatewayError` carries the gateway's error code. Two Server Actions: `retainPictures` (pre-check, attaches; idempotent; its own 60-second budget through `maxDuration` on the review page) and the existing `recordPictureReview`, which the screen calls only after `retainPictures` answered retained for every picture; the screen shows "Keeping your pictures privately…" with a count while it runs, then records. Every refusal is its own plain message with a remedy in both languages (a changed picture: add it again; an expired copy: add it again on the picture screen; quota exceeded: the Account's kept pictures are full at 2 GiB and deleting kept pictures arrives in a later release; the gateway unavailable: try again, nothing was confirmed). **Reading back:** the review's pixels come from the retained roots (kind `retained`) when a picture is pinned and from staging otherwise (`lib/picture-fetch.ts`); the Project page shows "Kept privately with this request" for a pinned picture instead of the staging lapse, and the staging-lapse copy, the lapse note on step 3 and the "cannot be recovered" message of Story 2.3 now apply only to an unpinned picture. **Docs:** `docs/authority-contract.md` (retention before confirmation, the resolver's authority, the quota), `docs/picture-quality.md` (the strip, orientation and ICC), `docs/staging.md` (migration row; deploy the migration first, the gateway image second; do not roll the gateway back below this migration's database), `README.md`.

**Ask First:** Any change to the transform's removal list, the kept orientation tag or the 2 GiB quota; a new route, dependency, environment variable or secret; a second public bucket or a reusable download URL; retaining a picture a person has not taken through the review; deleting or purging a retained object (Epic 8); any step against staging, production, Railway, GHCR or Backblaze.

**Never:** Provider-bound derivatives, their metadata removal or orientation baking (Story 2.5); identifying the subject (2.13); deleting, purging or restoring retained pictures, or freeing the quota (Epic 8); re-encoding, resizing or recompressing pixels; publishing an unstripped copy; a retained root or object key in a URL, log or page; a manifest root taken from the browser; editing an expectation to make a test pass except the pins this spec names.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Retain and confirm | 3 reviewed pictures, one with GPS EXIF | Each published as a manifest root; the review's successor pins the 3 ordered roots, retained digests and staged digests; the staged copies expire; the retained JPEG has no GPS and its orientation | N/A |
| Strip, JPEG | EXIF with GPS and orientation 6, XMP, ICC, a comment, bytes after EOI | Only an orientation-only APP1 (36 bytes, value 6) and the decoding segments remain; pixels identical; a JPEG with no orientation has no APP1 | N/A |
| Strip, PNG | tEXt, iTXt, eXIf with GPS and orientation, tIME, iCCP | Only critical and listed chunks remain plus an orientation-only `eXIf`; IDAT bytes identical | N/A |
| Strip, WebP | VP8X with EXIF, XMP, ICCP; and a simple file | The first loses them and keeps orientation with the flags and RIFF size right; the second is unchanged | N/A |
| Reproducible | The same picture attached twice | The same bytes, the same retained digest, the same root; `exists`, no duplicate artifact | N/A |
| Unparseable | A PNG with a broken chunk length; a truncated JPEG | `strip_failed`; nothing published; the picture reported with its position | Replace it |
| Changed bytes | The staged object's SHA-256 differs from the lease's | `bytes_changed`; nothing published; the review stays unrecorded | Add it again |
| Foreign / unknown / expired | Another Account's upload; an unknown ID; a lapsed lease with no manifest | `unknown_upload`, `unknown_upload`, `expired_upload` at the position; nothing published | Add it again |
| Quota | Kept 2 GiB − 10 MiB; asking 12 MiB | `quota_exceeded` for the whole confirmation, nothing published or recorded; the message says what is kept and what is asked | Exactly at the limit passes |
| Race | Two confirmations at once at the edge | The advisory lock admits one; the other gets `quota_exceeded`; its orphan manifests are reused by a retry | N/A |
| Twice | The same confirmation again | `retained` for each picture, no attach, the same roots; the writer's replay returns the same revision | N/A |
| Partial | Picture 2 of 3 fails | Pictures 1 and 3 may be published and kept for a retry; nothing is recorded; the failure names picture 2 | Retry is safe |
| Not retained | The writer called with no manifest for an upload | `not_retained` at the position; nothing written | N/A |
| Pins | After the review is recorded | `request_images` holds root, retained digest, length and the staged digest in order; the staged lease is expiring; `read_retained_pictures` returns them with no other field | N/A |
| Picture change after retention | Replace one picture on the picture screen | An unreviewed successor; the unchanged retained pictures keep their pins; the new one is staged | N/A |
| Read back | A retained picture's download ticket | Served from its retained object with the retained length; the review shows it after a reload; no staging read | N/A |
| Resolver refuses | Another Account; a deleted or tombstoned Project; an unpinned upload; an upload ticket of kind `retained` | The same `unavailable` / refused; nothing disclosed | N/A |
| Authority | Disabled, stale-epoch or tombstoned Account | `denied`; nothing published or written | N/A |
| Old gateway | The previous gateway with this migration | `none` attach still works | N/A |
| Gateway down | Attach times out or the gateway is unreachable | `unavailable` per picture; nothing recorded; no wrong "confirmed" | Retry |

</frozen-after-approval>

## Code Map

- `workers/files/src/strip.ts` -- new, pure, imports only `node:zlib`. The gateway's source files are pinned to exactly config, database, main, resolvers, server, storage and transfer (`gate-structure.test.ts` :1584; names `[a-z]+\.ts` :1789): add it on purpose; relative `../` imports are pinned to three (:1661-1666), `process.env` only in `main.ts` (:1796), every `log()` must be the class-name-only form (:1801), source must be erasable TypeScript. Image closure: the Dockerfile copies the worker directory, so no Dockerfile change, but `gate-structure.test.ts` :1661-1674 and `workflows.test.ts` :297-301 list files. No EXIF writer or reader exists in the repo; `lib/picture-quality.ts` :164-206 (`imageDimensions`) is pure but the gateway cannot import it without changing the COPY set. Test fixtures to extend: `tests/support/pictures-world.ts` :35-67 (a real `pngOf` with a CRC) and :68-82 (`tinyJpeg`); no GPS/EXIF fixture exists: build JPEG, PNG and WebP files with metadata by splicing segments and chunks in test helpers.
- `workers/files/src/server.ts` :529-572 (`attach`: reads the lease :530-532; builds the body from `lease.sha256` and `lease.length` :535; root :536-537; key `objects/<acct>/<root>` :538; server-side copy :540-541; `publishAttachment` :544; on refusal deletes its own copy unless a re-read says another attach published :549-557; statuses :558-571), :574-617 (`command()`: no Origin, 1 KiB body, token, jti once), :216, :476, :487 (resolver chosen by the ticket's `tk`), :277 (uploads accept `staging` only), :409 (`serve` answers 503 when stored length differs from the manifest's), `workers/files/src/database.ts` :281, :309, :314-329 (`lease`, `release`, `claimDeletion`, `publishAttachment`), :254-279 (the staging quota under the advisory lock `nova3d:staging:<acct>`; attached leases count nowhere), `workers/files/src/storage.ts` :18 (key pattern allows `objects/<acct>/<uuid|hex64>`), :93-130 (`put` multipart, `get` range, `copy`), `workers/files/src/transfer.ts` :10 (`blocks`), :61-72 (`leadingBytesMatch`), `workers/files/src/resolvers.ts` :15-28 (interface), :37-50 (`staging` resolver), :53-64 (registry), `main.ts` :79. Tests: `tests/unit/gateway-server.test.ts` :1637 on (attach cases assert exact storage calls such as `copy:`; the fake at `tests/support/gateway-fakes.ts` :112, :393-414 mirrors the SQL and must follow it), `tests/support/fixture-resolver.ts` (model for a resolver test), `tests/integration/file-gateway.test.ts` :1694-1800 (a real attach against Postgres and Storage, `gateway-world.ts` :77), `file-gateway-db.test.ts` :1355-1369 (asserts only `none` is registered; avoid `strip-metadata`, used as the "unregistered" example at :1355-1369, `file-gateway.test.ts` :1778 and `gateway-server.test.ts` :1680, :1732, :1825, :1837).
- `lib/service-signing.ts` :331 (`transferTargetKinds` is `['staging']`), :384 (a ticket's `tid` is a UUID; claims are an exact set), :404-425 (command types; attach claims `{acct, epoch, uid, tr}`), :316 (`transferLimits`); the unregistered-kind lists in tests include `project`, `manifest` and `export` (`gateway-helpers.test.ts` :225-229, `service-signing.test.ts` :984-986, `transfer-tickets.test.ts` :109-113, :309-313): use `retained`. `lib/transfer-tickets.ts` :86, :93 (the route accepts any registered kind and either direction), `app/api/transfers/tickets/route.ts`. `lib/gateway-client.ts` :95 (10 s timeout), :112-129 (`attach`, `GatewayError` carries only the status): `configuredGatewayClient` callers are pinned to `gateway-client.ts` and `job-tasks.ts` (`gate-structure.test.ts` :1647) and env readers to four files (:1627-1631): `lib/retention.ts` is the new caller and the pin is changed on purpose; `gateway-client.test.ts` :224-229 pins the manifest shape.
- `supabase/migrations/20261021120000_retained_pictures.sql` -- new. `20261015120000_file_gateway.sql`: `artifacts.manifests` :280-304 (root PK = SHA-256 of body; `id` = `upload_id`; update and delete blocked), `attachment_transforms` :265-278 (seeded with `none`; the gateway cannot insert), `publish_attachment` :396-470 (checks in order: body at most 4096 octets :409, authority :414, lease lock :421, manifest lookup `exists`/`root_mismatch` :427-433, not_complete :435, expired :439, transform :443, root :447, body equality :454-456 built from `lease.sha256` and `lease.length`, insert :461-463), `attachment_receipt` type (no digest or length: keep), the views and grants :342-346, :499-506 (the gateway role reads `session_authority`, `instance`, three tables, `publish_attachment`; it has no usage on `projects`, `identity` or `lifecycle`), `list_expired_staging` :581-605 (an `attached` lease whose `expires_at` has passed is cleaned). `20261020120000_picture_review.sql`: `record_picture_review` :434-658 (replay :506-525, Project lock and stale :528-553, lease re-read requires `complete` :556-577, obstruction :580, acknowledgment :587, `unchanged` :597-620, write :622-650), `request_images` review columns :63-73, `picture_review_digest` :163 and `picture_review_command_digest` :184 (read `l.sha256`; keep the command digest unchanged so roots are derived), the extended read :699-780 (`available` is `state = 'complete'`: make it true for a pinned picture; the view's column order is pinned at `picture-review.test.ts` :1114 and `picture-sets.test.ts` :1561: add retained facts through the new function, not the view). `20261019120000_picture_sets.sql`: `record_picture_set` :183-390 (requires `complete` leases; `picture-sets.test.ts` :681 pins that an `attached` lease is `not_ready`: change on purpose), `request_images` :109-149. Pins: `file-gateway-db.test.ts` :131-148 and :182 (eight relations: a ninth view changes it), :235 (exactly five `artifacts` functions: unchanged), :353 and :384 (the gateway's access map; only `publish_attachment` executable), :1355-1369, :1755 (`toHaveLength(36)` becomes 38 with `check_picture_retention` and `read_retained_pictures`, also `alarms.test.ts` :903, `picture-sets.test.ts` :1688, `request-revisions.test.ts` :1369), `accounts.test.ts` :53 (`apiFunctions`) and :47, `isolation.test.ts` :129-198 (a request body for each new `api` function) and :795 (relations), the preflight table lists in `session-grants.test.ts` :1190, `account-administration.test.ts` :956, `alarms.test.ts` :891, `picture-sets.test.ts` :1338-1342 (bans `manifest|root|retain|pin|ordinal|digest|approv|permission|payment|cost|job` in `request_images` column names: change on purpose to allow `retained_*`), `request-revisions.test.ts` :198-208, `picture-review.test.ts` :230; `staging-guide.test.ts` :25-40 (a `docs/staging.md` row, in order).
- Application: `app/projects/[projectId]/pictures/review/actions.ts` :58-120 (`withActiveAccount`, the 8 s `actionTimeoutMs` budget `lib/access.ts:56`, `operationOf`, `failed()`), `lib/projects.ts` :446-532 (`recordPictureReview`, outcomes pinned as an exact array :446-448 and by `gate-structure.test.ts`), `lib/picture-view.ts` :178-228 (`ReviewState`, `reviewKey`, `settleReview`), `components/projects/picture-review.tsx` :141- (steps; failures shown at :709-713; focus and command ID kept :283-303; `measureOne` holds Files and falls through to `fetchStagedPicture` ~:219-225), `lib/picture-fetch.ts` :108-142 (download ticket for `kind: 'staging'`; the retained read uses `kind: 'retained'` and the same hash check against `retained_sha256`), `lib/picture-review.ts`, `components/projects/request-section.tsx` :31-88 (the staging-lapse copy), `app/projects/[projectId]/pictures/review/page.tsx` (`maxDuration` goes here), `lib/i18n/en.ts` and `he.ts` (`review.confirm.*`, `picture.section.unavailable` ~:349, `review.confirm.lapseNote`, `review.unusable.confirmed`), `i18n.test.ts` :21-67, `design-tokens.test.ts` :110-190.
- E2E: Playwright starts the real gateway on port 4175 with the application's signing key (`playwright.config.ts` :105-117), so a real attach is testable end to end; `tests/e2e/picture-review.spec.ts` is the model; fake-camera flags need no change.

## Tasks & Acceptance

**Execution:**
- [x] `workers/files/src/strip.ts`, `workers/files/src/server.ts`, `workers/files/src/database.ts`, `workers/files/src/resolvers.ts` -- the strip, the transform-aware attach, the retained resolver -- AC-1, AC-2, AC-4, AC-5
- [x] `supabase/migrations/20261021120000_retained_pictures.sql` -- the transform, `publish_attachment` for it with the quota lock, pin columns, the pre-check, the extended writers and read, `read_retained_pictures`, the live-authorization view, the index, preflight -- AC-1 to AC-5
- [x] `lib/service-signing.ts`, `lib/gateway-client.ts`, `lib/retention.ts`, `lib/projects.ts`, `lib/picture-fetch.ts`, `lib/picture-view.ts`, `lib/picture-review.ts` -- the `retained` kind, error codes and timeouts, the server-only orchestration, typed calls, read-back from retained roots, the new states -- AC-1 to AC-4
- [x] `app/projects/[projectId]/pictures/review/actions.ts`, `app/projects/[projectId]/pictures/review/page.tsx`, `components/projects/picture-review.tsx`, `components/projects/request-section.tsx`, `lib/i18n/en.ts`, `lib/i18n/he.ts`, `app/globals.css` -- `retainPictures`, the retaining state, every refusal message, the kept-privately copy -- AC-1 to AC-4
- [x] `docs/authority-contract.md`, `docs/picture-quality.md`, `docs/staging.md`, `README.md` -- retention, the resolver, the strip and ICC note, deploy order -- housekeeping
- [x] `tests/` -- every matrix row: unit (the strip on spliced JPEG, PNG and WebP fixtures with GPS: every segment removed, orientation kept, pixels identical, truncated and corrupt input refused, reproducible digest; attach with the fake gateway world; the retained resolver; retention orchestration with fakes incl. partial failure and parallelism limit; the new states), integration (pre-check, quota exactly at the edge and over, race, writer pins and `not_retained`, `unchanged` needs pins, picture change keeps pins, `read_retained_pictures`, authority, isolation, immutability, view, preflight, a real attach against Postgres and Storage that strips a GPS JPEG), browser on desktop and phone in both languages against the real gateway (review, Confirm retains, reload shows the pictures from retained roots, quota exceeded, changed bytes, no GPS in the stored object, no URL leaks); update the pins above -- all ACs
- [x] `_bmad-output/implementation-artifacts/deferred-work.md` -- orphan manifests until Epic 8, quota never shrinks, ICC removal, provider derivatives bake orientation (2.5), thumbnails, resolver for other kinds (4.1), the closed Story 2.2/2.3 deferrals -- housekeeping

**Acceptance Criteria:**
- Given confirmed ordered pictures and their staged copies, when retention runs, then each picture has a verified manifest root, the successor revision pins the ordered roots, and the staging copies expire.
- Given changed bytes, a foreign owner or an expired lease before attachment, when retention is attempted, then nothing is published or recorded, the pictures stay unconfirmed with an actionable state, and the states are readable on phone and desktop.
- Given a later consumer needing the pictures, when it resolves them, then it reads the retained roots, and each retained digest maps to the original staged digest the user confirmed, in the confirmed order.
- Given the retained-picture quota is exceeded or an image carries location tags, when retention runs, then the quota rejects the whole confirmation with an actionable state, and the retained copy has no location tags while its digest and the confirmed order are recorded.
- Given a confirmation submitted twice, when retention runs both times, then the second run returns the same roots and creates no duplicate artifacts.

## Spec Change Log

## Design Notes

Retention comes first and the writer reads the roots it pins from `artifacts.manifests` itself, so the browser never names a root and a half-finished confirmation confirms nothing: a published manifest that is never pinned is a harmless, reusable orphan. The review writer keeps its signature; the application simply cannot reach it without having retained the pictures, and the database refuses with `not_retained` if it is called without.

The gateway cannot read the manifest table, so a repeated attach recomputes the strip from the staged object; the strip is deterministic, so the root is the same and `publish_attachment` answers `exists`. The application's pre-check skips the attach entirely once a manifest exists, which is also why the staged copies may expire.

Orientation is kept in the file (the browser and later steps apply it). The Story 2.5 provider derivative drops all metadata and must bake the orientation in first; that is recorded for it, not done here.

```
attach {tr: 'strip-picture-metadata', uid: <upload>}  ->  body {activity:'upload:strip-picture-metadata', children:[], digest:<sha256 of stripped>, id:<upload>, kind:'picture', length:<stripped length>, scope:<account>, serialization:'rfc8785-v1'}
request_images row: position 2, upload_id, sha256 <staged>, retained_root <root>, retained_sha256 <stripped>, retained_length <n>
```

## Verification

**Commands:**
- `npm run typecheck && npm run lint && npm run build` -- expected: exit 0
- `supabase start && npm test` -- expected: unit and integration pass, every matrix row covered
- `CI=1 npm run test:e2e` (stack started as CI does, fake Google active, gateway on its port) -- expected: all flows pass on both projects
- `node scripts/ci/check-repository.mjs && npm run render:provisioning -- --check && npm run test:env` -- expected: exit 0
- `docker build -f workers/files/Dockerfile -t nova3d-files:test .` -- expected: builds; started with no configuration it exits 1 listing the missing variables

**Manual checks (if no CLI):**
- With the stack and gateway up, save a JPEG that carries GPS EXIF, review it, Confirm: the Project shows "Kept privately with this request". Download the retained object from local Storage (`objects/<account>/<root>`) and confirm with `exiftool` or a hex dump that no GPS segment remains and the orientation tag does. Reload the review page: the picture appears again with no staging read.

## Suggested Review Order

**The strip (what a retained picture is)**

- Entry point: one pure function per type, refusing anything it cannot parse.
  [`strip.ts:384`](../../workers/files/src/strip.ts#L384)

- JPEG walk keeps decoding segments only; PNG and WebP follow the same shape.
  [`strip.ts:105`](../../workers/files/src/strip.ts#L105)
  [`strip.ts:255`](../../workers/files/src/strip.ts#L255)
  [`strip.ts:326`](../../workers/files/src/strip.ts#L326)

- The one thing kept: an orientation-only EXIF block, written fresh.
  [`strip.ts:81`](../../workers/files/src/strip.ts#L81)

**Publishing it (gateway and database)**

- The gateway attach reads, verifies, strips and stores under the new root.
  [`server.ts:633`](../../workers/files/src/server.ts#L633)

- The database registers the transform and enforces the 2 GiB quota under a per-Account lock.
  [`retained_pictures.sql:73`](../../supabase/migrations/20261021120000_retained_pictures.sql#L73)

- Read-only pre-check: authority, ownership, staleness and quota before anything is published.
  [`retained_pictures.sql:229`](../../supabase/migrations/20261021120000_retained_pictures.sql#L229)

**Pinning it to the confirmed review**

- The review writer takes roots from its own manifests, never from the browser.
  [`retained_pictures.sql:570`](../../supabase/migrations/20261021120000_retained_pictures.sql#L570)

- The picture-set writer carries pins into the unreviewed successor.
  [`retained_pictures.sql:339`](../../supabase/migrations/20261021120000_retained_pictures.sql#L339)

- Pin columns, all-or-none, plus the quota index.
  [`retained_pictures.sql:46`](../../supabase/migrations/20261021120000_retained_pictures.sql#L46)

**Application orchestration**

- Pre-check, then at most 4 attaches in flight, each limited to 30 seconds.
  [`retention.ts:141`](../../lib/retention.ts#L141)

- Confirm keeps first and records only when every picture is kept.
  [`actions.ts:90`](../../app/projects/%5BprojectId%5D/pictures/review/actions.ts#L90)
  [`picture-view.ts:264`](../../lib/picture-view.ts#L264)

- The screen drives both phases and announces each one.
  [`picture-review.tsx:315`](../../components/projects/picture-review.tsx#L315)

- Typed calls and the gateway's own error code surfaced to the application.
  [`projects.ts:564`](../../lib/projects.ts#L564)
  [`gateway-client.ts:49`](../../lib/gateway-client.ts#L49)

**Reading it back**

- A new `retained` ticket kind, signed and registered.
  [`service-signing.ts:334`](../../lib/service-signing.ts#L334)

- The gateway resolver serves a picture only while a live Project pins it.
  [`resolvers.ts:60`](../../workers/files/src/resolvers.ts#L60)
  [`retained_pictures.sql:196`](../../supabase/migrations/20261021120000_retained_pictures.sql#L196)

- Pixels for the review come from the retained root when pinned.
  [`picture-fetch.ts:273`](../../lib/picture-fetch.ts#L273)

- The Project page says "Kept privately" instead of the staging lapse.
  [`request-section.tsx:105`](../../components/projects/request-section.tsx#L105)

- The later consumers' read, and the preflight.
  [`retained_pictures.sql:922`](../../supabase/migrations/20261021120000_retained_pictures.sql#L922)
  [`retained_pictures.sql:989`](../../supabase/migrations/20261021120000_retained_pictures.sql#L989)

**Documentation**

- Retention before confirmation and the resolver's authority.
  [`authority-contract.md:79`](../../docs/authority-contract.md#L79)

- The strip, orientation and the ICC consequence.
  [`picture-quality.md:58`](../../docs/picture-quality.md#L58)

**Tests**

- Strip fixtures with GPS: every segment gone, orientation kept, pixels identical.
  [`strip.test.ts:71`](../../tests/unit/strip.test.ts#L71)

- Database: quota edge, pins, resolver view, immutability.
  [`retained-pictures.test.ts:136`](../../tests/integration/retained-pictures.test.ts#L136)

- Retention orchestration with fakes, including partial failure.
  [`retention.test.ts:83`](../../tests/unit/retention.test.ts#L83)

- End to end against the real gateway, both locales, announcements included.
  [`picture-retention.spec.ts:297`](../../tests/e2e/picture-retention.spec.ts#L297)
