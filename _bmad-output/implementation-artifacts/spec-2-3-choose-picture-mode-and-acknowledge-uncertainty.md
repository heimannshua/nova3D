---
title: 'Story 2.3: Choose picture mode and acknowledge uncertainty'
type: 'feature'
created: '2026-10-19'
status: 'done'
baseline_commit: '6da6283f83e8c62080b3e8c84b314e54e3696fb0'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-2-context.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-2-2-stage-ordered-multi-view-images-privately.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-2-1-confirm-natural-language-intent-and-personalization.md'
  - '{project-root}/_bmad-output/specs/spec-nova3D-story-2-3/acceptance-criteria.md'
  - '{project-root}/_bmad-output/specs/spec-nova3D-story-2-3/implementation-constraints.md'
  - '{project-root}/docs/authority-contract.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** A saved set of pictures is only a list. Nothing tells the person whether the pictures are sharp, large and evenly lit enough, which views they show, or which views are missing; nothing records whether they chose direct image-derived conversion or research-assisted reconstruction; and nothing records that they knowingly accepted the risk of invented or inaccurate geometry. Direct conversion has no confirmed request at all.

**Approach:** Add a review of the saved pictures (screens C-04, C-05 and the picture variant of C-06): deterministic quality measurements in a shared, pure module that Story 7.9 reuses; the person's view labels and their confirmation that nothing blocks the subject; advice on missing views; the explicit mode choice with a plain accuracy explanation; and, for direct conversion, the confirmed scope and outcome and an explicit "Generate anyway" acknowledgment when inputs are incomplete. One idempotent command records all of it as an immutable successor request revision pinned to the ordered images. Nothing is converted, researched, retained or paid for here: those are Stories 2.12, 2.13, 2.9 and the engine stories.

## Boundaries & Constraints

**Always:** Consult `node_modules/next/dist/docs/` before writing Next.js code (AGENTS.md). No new npm dependency, environment variable, secret, `route.ts` or header policy, and no model, network call or server-side image decoding: every measurement is made in the browser, and what the browser reports is an untrusted claim that the database stores and cross-checks only for completeness. **The shared module** `lib/picture-quality.ts` (pure, client-safe, no runtime imports, no `Date.now`, `Math.random`, `crypto`, `fetch`, `process`) and its browser decoder `lib/picture-decode.ts` (injectable dependencies, like `lib/picture-camera.ts`). Definitions, written once in the module header and in `docs/picture-quality.md`, with the choices the Spine leaves open decided here and flagged for Josh's approval: the analyzer takes `{width, height, data}` RGBA of a copy whose long edge is at most 512 px (the decoder makes it with the platform's `drawImage` at high smoothing quality, never enlarging, after applying the image's EXIF orientation) and the picture's natural width and height; a pixel with alpha under 255 is composited over white in integers; luminance is the integer `(299·R + 587·G + 114·B + 500) div 1000`; the Laplacian is the 4-neighbour 3×3 kernel `[0 1 0; 1 −4 1; 0 1 0]` over interior pixels only; blur is the population variance of those integer responses; a copy under 3×3 has blur 0; clipped is the share of all pixels of the copy whose luminance is 0 or 255, one combined count; short edge is the smaller natural dimension. Thresholds: short edge at least 800 px, blur at least 100, clipped at most 0.35 (35%); each result is `ok` or the named problem `resolution`, `blur` or `exposure`, and the measurements are kept as numbers (short edge integer, blur to 3 decimals, clipped to 4). Labels: `front`, `back`, `left`, `right`, `top`, `bottom`, `detail`. Coverage: the distinct labels among `front` to `bottom` (a `detail` close-up is not an angle and does not count) must number at least 3 for direct conversion; the missing views are recommended in the order front, back, left, right, top, bottom, as many as are needed to reach 3. `coverage(labels)`, `assess(measurements)`, `incomplete(labels, measurements)` (coverage under 3 or any picture with a problem) and `reviewDigestInput(…)` are pure and unit-tested with synthetic pixel fixtures built from formulas (flat, ramp, 0/255 checkerboard, over- and under-exposed, seeded noise; a checkerboard's blur is 1,040,400 and a ramp's is 0), no binary files. **Getting the pixels:** from the `File`s of the picture screen when they exist; otherwise (after a reload) one picture at a time through a single-use download ticket (`POST /api/transfers/tickets` with `{direction:'download', kind:'staging', id}` by `csrfFetch`, then `GET <gateway>/v1/files/staging/<id>` with `Authorization: Ticket …` and the gateway origin from the ticket response), whose bytes are hashed and must equal the saved SHA-256 (else the picture is shown as changed and not used); the bytes live in memory only (never in a URL that is shown or stored, in storage, or in a log) and each picture is decoded and released before the next; the thumbnail is a small object URL of a JPEG drawn from the 512 copy. A picture whose lease lapsed, whose download is refused, or that cannot be decoded is shown with a plain reason, a remedy and a link back to the picture screen, and counts as a problem that cannot be acknowledged. Because this story is the first to download staged bytes, the structure pins that ban `direction: 'download'` in the picture files are changed on purpose to allow it in the one new module `lib/picture-fetch.ts`. **Records** (migration `20261020120000_picture_review.sql`, `projects` schema; new columns only, no new table, so the table lists and cleanup helpers do not change): `projects.request_images` gains nullable `view_label` (the seven), `short_edge_px` (integer, at least 1), `blur_variance` (numeric, 3 decimals, at least 0), `clipped_fraction` (numeric, 4 decimals, between 0 and 1), all four present or all four null; `projects.request_revisions` gains nullable `obstruction_confirmed_at`, `incomplete_acknowledged_at` and `incomplete_acknowledged_digest` (64 lower-case hex), the last two present together or both null, an acknowledgment only on a confirmed `image_direct` revision. `request_revisions_confirmed_shape` is replaced: `confirmed_at`, `scope` and `outcome` are all null or all not null, `description` is null on an unconfirmed revision and may be null on a confirmed `image_direct` one (a confirmed `evidence_text` still requires it and a confirmed `evidence_images` still may not omit it). Pictures keep no personalization: the wish is declined for `image_direct` as in Story 2.1. `api.record_picture_review(account, epoch, command_id, project_id, expected_seq, mode, scope, outcome, images, obstruction_confirmed, acknowledge)` (`images` one jsonb array of `{upload_id, label, short_edge_px, blur_variance, clipped_fraction}`, in order): validates its arguments (22023: 1 to 12 images, one label each from the seven, measurements in range, a mode of `evidence_images` or `image_direct`, scope and outcome present exactly for `image_direct` and shaped as Story 2.1's); `identity.assert_operation_authority` first (`denied`); the advisory lock `'project_command:'||account||':'||command`; refuses a command a rename or another revision used (`reused`) and replays the same command and digest (`replayed`); locks the Project row `FOR UPDATE` (Account's own, not deleted, not tombstoned, else `unavailable`); answers `stale` when the latest revision's `seq` is not `expected_seq`, when it is not a picture revision, or when its ordered upload IDs are not exactly the supplied ones, and `not_editable` for a Project whose latest revision is an `evidence_text` request; re-reads every lease as the definer (`unknown_upload`, `not_ready`, `expired_upload` at the position, as Story 2.2); refuses `obstruction_not_confirmed` unless `obstruction_confirmed` is true; for `image_direct` recomputes from the labels and measurements whether the inputs are incomplete (the same thresholds and rule as the module; a test holds the SQL and the module equal over a table of cases) and answers `acknowledgment_required` when they are and `acknowledge` is false, and records the acknowledgment (time and the digest) only when they are; otherwise in one transaction raises the Project revision by exactly one, sets the stage (`request_confirmed` for a confirmed direct revision, `request_draft` for `evidence_images`), inserts the successor (`seq + 1`, the given mode, confirmed with scope and outcome and no subject for direct, unconfirmed with none for evidence) and copies its ordered images with their labels and measurements, and renews the leases within the Story 2.2 bound. The digest the acknowledgment is pinned to is SHA-256 over length-prefixed fields: scope, outcome, then per position the upload, SHA-256 and label (the staged SHA-256, so Story 2.12's retained copies stay verifiable). `api.record_picture_set` is unchanged except that it now also accepts a latest revision that is an unconfirmed picture revision of either mode; a reviewed revision is superseded by an unreviewed successor, whose images carry no labels. `api.read_project_request` returns the new fields (per image: label and measurements; per revision: `obstruction_confirmed`, `acknowledged`). `api.preflight` is re-created with every earlier probe. **Application:** typed calls `recordPictureReview` and the extended `readProjectRequest` in `lib/projects.ts` with every outcome checked; one Server Action `recordPictureReview` in `app/projects/[projectId]/pictures/review/actions.ts` (`withActiveAccount`, `operationOf`, `withinBudget`, the command ID chosen when Confirm is pressed): `created` redirects to the Project, `denied` as rename does, an unknown outcome tells the person to check My Projects (a retry with the same command is safe), and every refusal outcome has its own message; the action recomputes nothing the database recomputes and trusts no pass/fail flag from the client. **Screens** (phone and desktop, English and Hebrew with parity, keyboard and screen-reader complete, focus moved to the new heading or first problem, `useAnnounce` for results, logical CSS properties only, no overflow at 200% text) at `/projects/[projectId]/pictures/review` (a new child of the pictures path: the undecodable-ID rewrite in `lib/project-paths.ts` covers it), a client component `components/projects/picture-review.tsx` in three steps with Back and Next: (1) **C-04 quality and coverage**: each picture in order with its thumbnail, a label chooser (a real radio group or select, one label each), its three measurements with ok or the problem and a plain remedy (resolution: use a larger or closer picture; blur: hold steady, refocus, retake; exposure: retake in even light), the coverage line (the views you have, what direct conversion needs, the missing views to add, with a button to the picture screen to add them), the obstruction confirmation as a labelled checkbox with its remedy text, and the states sufficient, insufficient and additional view requested; (2) **C-05 path choice**: two cards, "Direct image-derived conversion" (a model made from your pictures alone, labelled image-derived and not historically verified, geometry may be invented where views are missing, no Research Plan; works offline on a device prepared while online, when that ships) and "Research-assisted reconstruction" (identifies the subject, researches public sources online, builds a complete Research Plan you must approve before any model is made; needs a connection), chosen explicitly with no default, with the plain accuracy difference; (3) **C-06 picture variant**: for direct, the mode in words, editable scope and outcome (prefilled with localized sentences, 1 to 300 characters as Story 2.1), the Generate anyway warning with its explicit acknowledgment checkbox shown and required only when the inputs are incomplete (the sentence names the missing views or problems and says the geometry may be invented or inaccurate and is not historically verified), and Confirm, with the sentence that confirming starts no conversion, approves no plan and authorizes no cost; for research-assisted, the choice is recorded and the screen says that the subject is identified and the scope confirmed in a later step and nothing has started. The Project page (`request_draft` now has a destination, the review path, and its sentence says the pictures are saved and to review them) shows the review: mode, each picture's label and result, the obstruction confirmation and the acknowledgment (what was acknowledged and when, in UTC), with Review pictures again while the revision is a picture revision. Pictures already reviewed can be reviewed again: a change of mode is a successor. **Docs:** `docs/picture-quality.md` (the definitions, the decisions for Josh to approve, what Story 7.9 must reuse), `docs/authority-contract.md` (the review writer, the acknowledgment is not an approval), `docs/staging.md` (migration row; do not roll the build back once a direct revision exists), `README.md`.

**Ask First:** Any change to the thresholds, labels, the rule that `detail` does not count, the kernel, luma weights, resize or clipped definition once approved; storing anything but raw measurements, labels and the acknowledgment; a server-side decode, thumbnail or download URL; a new route, header, dependency, environment variable or secret; changing Story 2.2's writer beyond what is named; retaining or attaching a picture (Story 2.12); any step against staging, production or a provider.

**Never:** Retaining pictures, EXIF or location stripping, the retained quota or the retained-picture resolver (Story 2.12); identifying the subject or confirming scope for research-assisted mode (2.13); free or paid choice, provider disclosure, permission, reservation, start confirmation or any Job (2.5 to 2.9, 3.x); running, queuing or simulating a conversion or an offline bundle (Epic 7); a model or heuristic that detects obstruction; a pass/fail flag, approval, permission or payment field on a revision; an LLM; editing an expectation to make a test pass except the pins this spec names.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Sharp, large, even | 3 labelled pictures, 1200 px, high detail, mid-tones, front/left/top | C-04 sufficient: all `ok`, coverage met; Next enabled once obstruction is confirmed | N/A |
| Small | A 700 px picture | `resolution` with its pixels and the remedy | N/A |
| Blurry | A smooth ramp or flat picture | `blur` with the measured value and the remedy | N/A |
| Over/under exposed | A picture 40% white or black | `exposure` with the share and the remedy | N/A |
| Edge of a threshold | Short edge 800; blur exactly 100; clipped exactly 0.35 | Each is `ok` | N/A |
| Few views | Labels front, front, detail | Coverage insufficient: 1 distinct view, recommends back and left | Direct needs Generate anyway; research does not |
| Obstruction | Not confirmed | Next is blocked in both modes with the remedy | No override exists |
| Pixels after reload | Saved set, no Files | Each picture fetched once by single-use ticket, hashed, equal to the saved SHA-256, measured, thumbnailed | Lapsed lease, refused ticket, hash differs, undecodable: named reason, not used, link to the picture screen |
| Choose research-assisted | Reviewed, confirmed obstruction | Successor `seq + 1`, mode `evidence_images`, unconfirmed, labels and measurements kept, stage `request_draft`, nothing else | N/A |
| Choose direct, complete | 3 views, all ok, scope and outcome edited | Successor `image_direct`, confirmed, no subject, no description, stage `request_confirmed`, no acknowledgment | N/A |
| Direct, incomplete | 2 views or a failing picture | Generate anyway warning; Confirm needs the acknowledgment; recorded with its time and the digest of scope, outcome and ordered images | Without it: `acknowledgment_required`, nothing written |
| Forged claim | The browser sends all-ok measurements for a blurry picture | Stored as sent (untrusted claim); the acknowledgment rule is applied to the sent values; the module and SQL agree on every threshold case | N/A |
| Mode change | A confirmed direct revision, choose research-assisted | Successor unconfirmed, stage back to `request_draft`; the earlier revision unchanged | N/A |
| Stale | Another window saved a newer set or review | `stale`, nothing written, reload message | N/A |
| Same command twice | Same command and payload | The first result (`replayed`) | N/A |
| Command reused | Same command, another payload; an ID a rename or another writer used | `reused`, nothing written | N/A |
| Foreign/unknown/lapsed upload | At a position | `unknown_upload`, `not_ready`, `expired_upload` at that position | N/A |
| Authority | Disabled, stale-epoch, tombstoned Account; another Account's or deleted Project | `denied`; `unavailable` (one answer); nothing written | N/A |
| Text request Project | Review route for an `evidence_text` Project | `not_editable` / not found; nothing written | N/A |
| No start | Any confirmed direct or research choice | No conversion, plan, permission, cost or Job exists or is implied; both screens and the Project page say so | N/A |

</frozen-after-approval>

## Code Map

- `supabase/migrations/20261020120000_picture_review.sql` -- new. Model on `20261019120000_picture_sets.sql`: `request_revisions` checks (`confirmed_shape` :72-74, `text_confirmed` :76, `unconfirmed_shape` :78-82; never edit the earlier migrations: `gate-structure.test.ts` pins their text), `request_images` :109-149 (primary key `(revision_id, position)`, never updated; `picture-sets.test.ts` :1340-1341 pins exactly eight columns and :1342 bans `manifest|root|retain|pin|ordinal|digest|approv|permission|payment|cost|job` in them: new columns are nullable and avoid those words), `check_revision_seq` :86-102, `projects.picture_set_digest` :157-173 and `projects.length_prefixed` (`20261018120000_request_revisions.sql` :171) for the digest, `record_picture_set` :183-390 as the order of checks (arguments 22023 :205-213, authority :216-221, advisory lock :224, rename collision :227, receipt :232-253, Project `FOR UPDATE` plus tombstone plus editability :256-270 where "latest is an unconfirmed `evidence_images`" must also accept either picture mode, leases :274-302, 60 MiB :306, renewal :363-365), `read_project_request` and `api.project_request_view` :445-542 (drop and re-create; `picture-sets.test.ts` :1556-1560 pins the view's column order and :1583-1587, :1646 the seven keys per image; `request-revisions.test.ts` :172-190, :1079, :1102, :1113-1120 the `nothing` object), `rename_project` :552- (already refuses a revision's command ID), `api.preflight` :649-865 (35 signatures :805-843 grow to 36; keep the probe aliases `q.` and `y.` and the "Story 2.2 migration" block; `toHaveLength(35)` in `alarms.test.ts` :903, `file-gateway-db.test.ts` :1755, `request-revisions.test.ts` :1358, `picture-sets.test.ts` :1675). Pins for new columns on `request_revisions`: `request-revisions.test.ts` :198-207 (exact list), :208 (bans `approv|permission|payment|paid|cost|price|job|reserv|manifest`), helper inserts need the columns nullable (:151, `picture-sets.test.ts` ~:200, `e2e/request.spec.ts` :640); `request-revisions.test.ts` :267 and :276 insert a confirmed `image_direct` WITH a description and subject (must still pass) and `picture-sets.test.ts` :1221-1238 needs a confirmed `evidence_images` without a description to fail with 23514 (must still fail). A new `api` function means `accounts.test.ts` :52-111 (sorted `apiFunctions`), `isolation.test.ts` :185-188 (a request body), the functions must not contain "handle" (`request-revisions.test.ts` :896-908). `docs/staging.md` needs a migration row in order (`staging-guide.test.ts` :25-40).
- `lib/projects.ts` :293 (`readProjectRequest`), :343 (`recordPictureSet`), :380 (`releaseStagedPictures`), `ProjectRequestRow` :266 (throws `unexpected` for a confirmed row without a description: a confirmed direct row has none, so relax it and type the union); only `lib/accounts.ts`, `lib/lifecycle.ts` and `lib/projects.ts` may call `callApi`/`callRow` and typed calls may not appear in pages or components (`gate-structure.test.ts` ~:2570-2580). Server Action model: `app/projects/new/pictures/actions.ts` :57-110 (`savePictureSet`, `discardPictures`), `lib/picture-view.ts` :35-145 (`attemptSave`, `settleSave`), `lib/request-view.ts` :119-207 (`commandIdFor` 15-minute window, `forgetCommandId`).
- Screen and routes: `components/projects/picture-intake.tsx` :107-119 (props), :145 (`savedSet`), :554 (`useActionState`), :595-600 (command ID at submit); `app/projects/[projectId]/pictures/page.tsx` :23-46 (locks unless `mode === 'evidence_images' && !confirmed`: relax to "an unconfirmed picture revision"), `components/projects/pictures-locked.tsx`, `lib/project-paths.ts` :7 (`picturesPath`), :20 (the rewrite regex `/^\/projects\/([^/]+)(?:\/(?:sources|pictures))?\/?$/`: add `pictures/review`; `project-view.test.ts` :68-69 must keep `/projects/%zz/pictures/more` and `/projects/%zz/other` false), `components/projects/request-section.tsx` :31-88 (`PicturesPart`; `modeKeys` already has `image_direct`), `lib/project-stage.ts` :19-26, :50-67 (`request_draft` destination is null and pinned: `project-stage.test.tsx` :49-51, `picture-pages.test.tsx` :962, :967, :978 (its sentence must match `/later release/`), :298, :903, :997 (link counts on the picture screen and Project page)), `lib/i18n/en.ts` :140 (`stage.request_draft.next`), :394 (the "quality… arrive in a later release" copy), `lib/project-pages.ts` :64 (`loadProjectRequest`; the review page must read through it, `gate-structure.test.ts` :2563). Text-flow C-06 for reference only, do not edit: `components/projects/request-intake.tsx` (pinned: one `newCommandId(`, four `dir="auto"`, `gate-structure.test.ts` :2486-2500; `confirmRequest`/`understandRequest` caller lists :2336-2337).
- Pixels and fixtures: `lib/picture-camera.ts` :11-90 is the injectable-dependency model (`CameraDeps`, `captureFrame` wraps canvas work in try/catch); `lib/picture-upload.ts` :61-121 (`sha256Hex`, `fetchTicket`, `uploadUrl`) and :238 (the queue) for the browser side of the gateway; gateway download contract: `app/api/transfers/tickets/route.ts` / `lib/transfer-tickets.ts` (`parseTicketRequest` accepts `direction:'download'` for `kind:'staging'`), `workers/files/src/server.ts` :473-480 (`GET /v1/files/staging/<id>`, single use, five-minute ticket, one range or the whole body, `content-disposition: attachment`), :621-655 (CORS allows GET with `authorization` and `range` for `APP_ORIGIN`), `workers/files/src/resolvers.ts` :37-50 (serves `complete` or `attached`, unexpired). Pins to change on purpose: `gate-structure.test.ts` :2651-2654 (`csrfFetch` and `fetchTicket` only in `lib/csrf-client.ts` and `lib/picture-upload.ts`), :2658 (no `direction: 'download'`, `/v1/files` or `fetch(` in the listed picture files), :2891-2897 (no "download", "ticket", "url" in the 2.2 read function: leave it), :2309-2316 (the `pure` list bans `process`, `fetch(`, `Date.now`, `Math.random`, `crypto.` and non-type imports: add `lib/picture-quality.ts`), :2669-2680 (`createObjectURL` once and `<img` once in `picture-intake.tsx`; no `<img`, `<video`, `<canvas`, `src=` in `request-section.tsx` and the listed pages and components: the review component is a new file and must have its own pin), :2597 (exact route list: no new `route.ts`), :2770 (no CSP). Fixtures: `tests/support/pictures-world.ts` :11-48 has a zlib PNG encoder (`png(rgb, size)` flat squares): generalize it to a `(x,y)=>rgb` function with a width and height for real 800 px, ramp, checkerboard and over-exposed PNGs (no new dependency; `sharp` is only an optional dependency of Next, `pngjs` and `jpeg-js` are absent); `tests/support/gateway-world.ts` :30-32 (`pngBytes` etc. are random bytes behind a signature: good for the undecodable case); `tests/e2e/pictures.spec.ts` (`choose`, `allReady`, `rowsOf`, `openNew`, `openChange`, `shownOrder`, fake camera flags :20) and `tests/support/e2e-helpers.ts`.
- UI: `components/ui/*` (`Button`, `LinkButton`, `Notice`, `EmptyState`, `ErrorState`, `StatusBadge`, `Choice` (radio only: no checkbox primitive, so use a plain labelled `input type=checkbox` with the existing classes), `useAnnounce`), icons `image`, `check-circle`, `alert-triangle`, `x-octagon`, `info-circle`, `clock`, `question`, `doc`, `inference` (`components/ui/icon.tsx` :3-7); `i18n.test.ts` :21-67 (parity, equal placeholders, no Latin word of two or more letters in `he.ts` except nova3D and Google: pass `px`, `JPEG` and the like as placeholders, as `formatParams` does, `lib/picture-set.ts` :21); `design-tokens.test.ts` :110-190 (logical properties, rem, 44 px targets); `page-guards.test.ts` :36-80 (a new `page.tsx` calls `await requireActiveAccount()` then `loadProject(access.account.accountId, access.account.epoch, projectId)`). No offline code exists (`navigator.onLine`, service worker): the availability lines are static text.
- Interfaces left for others: Story 7.9 reuses `lib/picture-quality.ts` and `lib/picture-decode.ts`; Story 2.12 reads the ordered images, their staged SHA-256 and the acknowledgment digest; Story 2.13 and later read the mode and labels; the stale-window guard that Story 2.2 deferred is part of this writer only (`expected_seq`).

## Tasks & Acceptance

**Execution:**
- [x] `lib/picture-quality.ts`, `lib/picture-decode.ts`, `lib/picture-fetch.ts`, `docs/picture-quality.md` -- the pure measurements and rules, the browser decoder, the download-by-ticket fetch with hash check -- AC-1, AC-2
- [x] `supabase/migrations/20261020120000_picture_review.sql` -- the columns and checks, the relaxed confirmed shape, the picture editability, `record_picture_review`, the extended read, preflight -- AC-2, AC-3
- [x] `lib/projects.ts`, `lib/project-stage.ts`, `lib/project-paths.ts`, `lib/picture-view.ts`, `lib/i18n/en.ts`, `lib/i18n/he.ts` -- typed calls, the `request_draft` destination, the new child path, all copy in both languages -- AC-1, AC-2, AC-3
- [x] `app/projects/[projectId]/pictures/review/page.tsx`, `app/projects/[projectId]/pictures/review/actions.ts`, `components/projects/picture-review.tsx` (and what it needs), `app/globals.css` -- C-04, C-05 and the picture C-06 -- AC-1, AC-2, AC-3
- [x] `app/projects/[projectId]/pictures/page.tsx`, `components/projects/request-section.tsx`, `components/projects/pictures-locked.tsx`, `lib/project-pages.ts` -- editability across modes, the review on the Project page -- AC-2, AC-3
- [x] `docs/authority-contract.md`, `docs/staging.md`, `README.md` -- the review writer, the acknowledgment is not an approval, rollout -- housekeeping
- [x] `tests/` -- every matrix row: unit (the module on synthetic pixel buffers incl. every threshold edge and `detail`, coverage and recommendations, the decoder port with fakes, the fetch with hash check, the view and action logic), integration (record, successor, stale, replay, reused, rename collision, foreign, lapsed, obstruction, acknowledgment required and recorded, digest recomputes, SQL and module agree on a table of threshold cases, mode change back, authority, isolation, immutability, checks, closure, preflight), component (every C-04, C-05, C-06 state), browser on desktop and phone in both languages with the real gateway (real generated PNGs: sharp, small, blurry, over-exposed; review right after saving and after a reload; both modes; Generate anyway; obstruction; mode change; axe, overflow, 200% text, keyboard); update the pins above -- all ACs
- [x] `_bmad-output/implementation-artifacts/deferred-work.md` -- Josh's approval of the quality definitions and of `detail` not counting, browser-resampling parity with Story 7.9, evidence_images scope confirmation (2.13), the unreviewed successor on a picture change, thumbnails memory, previews in other screens, the Project title -- housekeeping

**Acceptance Criteria:**
- Given unclear or incomplete views, when quality review runs, then measured blur, resolution or exposure problems, unconfirmed obstruction and missing labelled views are explained with useful remedies, and the same actions work on phone and desktop.
- Given incomplete direct inputs, when Generate anyway is selected, then an explicit acknowledgment that geometry may be invented or inaccurate is recorded pinned to the ordered images and the confirmed scope, and without it nothing is recorded.
- Given a picture-mode choice or a later mode change, when the request is confirmed, then research-assisted mode records no scope and requires whole-plan approval later, direct mode has no synthetic Research Plan, a mode change is a successor revision, and each mode's accuracy explanation and offline availability are shown.

## Spec Change Log

## Design Notes

Measurements and labels are claims made in the browser, because the server never decodes an image; what makes the acknowledgment meaningful is that it is pinned to the staged SHA-256 values in order, the labels and the confirmed scope, so it cannot be reused for other pictures. The database applies the same thresholds to the claimed numbers only to decide whether an acknowledgment is required; it cannot and does not prove the numbers.

The pure analyzer takes a copy that the decoder produced, so the exact part (grayscale, kernel, variance, clipped share, thresholds, coverage) is identical on every device, and only the platform's downscale differs; thresholds have wide margins (a sharp photograph's variance is in the hundreds to thousands). Story 7.9 reuses both files.

Evidence-backed pictures reach C-06 only after Story 2.13 identifies the subject, so choosing research-assisted here records the mode and labels and leaves the revision unconfirmed; direct conversion has no subject, so its confirmation (scope, outcome, acknowledgment) happens here.

```
review(pictures: front 1200x900 ok, left 1200x900 blur 41 (blur), detail 900x900 ok) -> distinct views = 2 (<3) -> incomplete
direct: Generate anyway required -> acknowledged_digest = sha256(len(scope) len(outcome) 1:upload:sha:front 2:upload:sha:left 3:upload:sha:detail)
```

## Verification

**Commands:**
- `npm run typecheck && npm run lint && npm run build` -- expected: exit 0
- `supabase start && npm test` -- expected: unit and integration pass, every matrix row covered
- `CI=1 npm run test:e2e` (stack started as CI does, fake Google active, gateway on its port) -- expected: all flows pass on both projects
- `node scripts/ci/check-repository.mjs && npm run render:provisioning -- --check && npm run test:env` -- expected: exit 0

**Manual checks (if no CLI):**
- With the stack and gateway up, save three pictures of one subject (one blurry, one very small), open the Project, Review pictures: label them, see the measurements and remedies, confirm nothing blocks the subject, choose direct conversion, edit scope and outcome, tick the Generate anyway acknowledgment, Confirm: the Project is "Request confirmed". Reload the review page and see the thumbnails come back. Review again and choose research-assisted: the Project returns to the draft stage.

## Suggested Review Order

**The one command that records the review (start here)**

- Stale check, obstruction, completeness recomputed from labels and measurements, then one successor.
  [`picture_review.sql:434`](../../supabase/migrations/20261020120000_picture_review.sql#L434)

- The rule the database applies to the browser's claims, held equal to the TypeScript module.
  [`picture_review.sql:147`](../../supabase/migrations/20261020120000_picture_review.sql#L147)
  [`picture_review.sql:99`](../../supabase/migrations/20261020120000_picture_review.sql#L99)

- The acknowledgment is a time and a digest pinned to the ordered pictures and the scope.
  [`picture_review.sql:163`](../../supabase/migrations/20261020120000_picture_review.sql#L163)
  [`picture_review.sql:89`](../../supabase/migrations/20261020120000_picture_review.sql#L89)

- A confirmed direct revision has no description; the confirmed shape is relaxed for it alone.
  [`picture_review.sql:81`](../../supabase/migrations/20261020120000_picture_review.sql#L81)

- The read returns labels, measurements and the acknowledgment; the picture writer accepts either picture mode.
  [`picture_review.sql:699`](../../supabase/migrations/20261020120000_picture_review.sql#L699)
  [`picture_review.sql:214`](../../supabase/migrations/20261020120000_picture_review.sql#L214)

**The shared quality module (Story 7.9 reuses it)**

- Thresholds, labels and the three-view rule, with `detail` not counting.
  [`picture-quality.ts:36`](../../lib/picture-quality.ts#L36)
  [`picture-quality.ts:239`](../../lib/picture-quality.ts#L239)

- The exact part: alpha over white, integer luma, 4-neighbour Laplacian, population variance, clipped share.
  [`picture-quality.ts:98`](../../lib/picture-quality.ts#L98)

- Header dimensions refuse an image over 100 megapixels before any decode.
  [`picture-quality.ts:164`](../../lib/picture-quality.ts#L164)

- What 'incomplete' means, and the digest input the acknowledgment is pinned to.
  [`picture-quality.ts:248`](../../lib/picture-quality.ts#L248)
  [`picture-quality.ts:275`](../../lib/picture-quality.ts#L275)

- The platform decoder: orientation applied, a 512 px copy, a small thumbnail, a 30 second limit.
  [`picture-decode.ts:175`](../../lib/picture-decode.ts#L175)

- Pixels after a reload: a single-use download ticket, a capped read, the SHA-256 must match.
  [`picture-fetch.ts:200`](../../lib/picture-fetch.ts#L200)
  [`picture-fetch.ts:305`](../../lib/picture-fetch.ts#L305)

- The definitions and the choices for Josh to approve.
  [`picture-quality.md:7`](../../docs/picture-quality.md#L7)
  [`picture-quality.md:67`](../../docs/picture-quality.md#L67)

**The three steps and the action**

- C-04, C-05 and the picture C-06 in one client component.
  [`picture-review.tsx:141`](../../components/projects/picture-review.tsx#L141)

- What the first step needs before Next, and what the warning says.
  [`picture-review.ts:115`](../../lib/picture-review.ts#L115)
  [`picture-review.ts:157`](../../lib/picture-review.ts#L157)

- The Server Action recomputes nothing the database recomputes and trusts no pass flag.
  [`actions.ts:65`](../../app/projects/[projectId]/pictures/review/actions.ts#L65)
  [`projects.ts:476`](../../lib/projects.ts#L476)

- The review page, a new child of the pictures path.
  [`page.tsx:24`](../../app/projects/[projectId]/pictures/review/page.tsx#L24)
  [`project-paths.ts:9`](../../lib/project-paths.ts#L9)

**Where it shows**

- `request_draft` now leads to the review; the sentences say nothing has started.
  [`project-stage.ts:55`](../../lib/project-stage.ts#L55)

- The Project page shows the review, with what the browser reported.
  [`request-section.tsx:34`](../../components/projects/request-section.tsx#L34)

**Docs**

- The review writer, the stage rule, and why the acknowledgment is not an approval.
  [`authority-contract.md:146`](../../docs/authority-contract.md#L146)

- The migration row and why not to roll back once a direct revision exists.
  [`staging.md:78`](../../docs/staging.md#L78)

**Tests (peripheral)**

- The command against the real database, mutation-checked for the acknowledgment and the stage guard.
  [`picture-review.test.ts:262`](../../tests/integration/picture-review.test.ts#L262)
  [`picture-review.test.ts:696`](../../tests/integration/picture-review.test.ts#L696)

- The database and the module agree on every threshold case.
  [`picture-review.test.ts:1124`](../../tests/integration/picture-review.test.ts#L1124)

- The module on synthetic pixels, the decoder and the fetch with fakes.
  [`picture-quality.test.ts:1`](../../tests/unit/picture-quality.test.ts#L1)
  [`picture-decode.test.ts:1`](../../tests/unit/picture-decode.test.ts#L1)
  [`picture-fetch.test.ts:1`](../../tests/unit/picture-fetch.test.ts#L1)

- The review in a real browser with generated PNGs, phone and desktop, both languages.
  [`picture-review.spec.ts:191`](../../tests/e2e/picture-review.spec.ts#L191)
  [`picture-review.spec.ts:566`](../../tests/e2e/picture-review.spec.ts#L566)
