---
title: 'Story 1.7: Navigate My Projects and project state'
type: 'feature'
created: '2026-10-12'
status: 'done'
baseline_commit: '6e40c782d5246496ae66a17adfc3a980564e6961'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-1-context.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-1-5-disable-and-re-enable-account-access.md'
  - '{project-root}/_bmad-output/specs/spec-nova3D-story-1-7/acceptance-criteria.md'
  - '{project-root}/_bmad-output/specs/spec-nova3D-story-1-7/implementation-constraints.md'
  - '{project-root}/docs/authority-contract.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Home, My Projects and In Progress show synthetic sample data, so an Account owner cannot find or reopen a real Project. No Project record exists, and nothing defines a Project's stages, its revision counter, or how a Project link is resolved without disclosure.

**Approach:** Add the Projects-owned Project record behind service-role-only database functions, and replace the sample content with real pages that have honest empty states: Home, My Projects (search and stage filter), In Progress, and a Project overview with its Sources entry. Every read and command re-checks live ownership and authority, a foreign or stale link looks like any other unavailable link, and Rename is the first command to carry an expected revision.

## Boundaries & Constraints

**Always:** Consult `node_modules/next/dist/docs/` before writing Next.js code (AGENTS.md). The Account comes from the verified access (`access.account.accountId` and `epoch`), never from a request, form or URL. Table `projects.projects` is in the unexposed `projects` schema (RLS on, no policies, every privilege revoked, as `projects.workspaces`) and is reached only through `api` functions that only the service role executes, each beginning with `identity.assert_operation_authority(account, epoch)` (a refusal answers `denied`). A Project belongs to one Workspace and Account by a composite foreign key. Its fields: `id`, `title` (trimmed, 1 to 120 characters, no control characters), `stage` (`researching`, `awaiting_plan_approval`, `generating`, `awaiting_model_approval`, `validation_failed`, `export_ready`), `current_version` (0 means none), `revision` (starts at 1, +1 per committed command), `status_handle` (16 random bytes, unique, immutable, returned by no function), `created_at`, `updated_at`, `deleted_at` (hides the Project; nothing sets it yet). Foreign, deleted, unknown and malformed Project IDs all answer `unavailable`, shown as one page with HTTP 404 and nothing of any Project. Commands follow the Spine: Account, command ID (UUID), expected revision, typed payload; an immutable receipt in `projects.project_commands` makes replay return the original receipt; the same ID with another payload is rejected; a stale expected revision is rejected with the current revision and changes nothing (no ledger row). Rename is the first and only command, in one transaction under a lock on the Project row. Pages, each behind `requireActiveAccount`: Home (the three primary actions with real counts, recent Projects, empty states), My Projects (newest update first, search by title, stage filter, "empty" distinct from "no match", the result count announced), In Progress (no Jobs yet, and "Prints in Progress, coming later"), Project overview `/projects/[projectId]` (title, stage in words and shape, Version, updated time, the next required action stated, Model and Sources entries, Rename), and `/projects/[projectId]/sources` (an honest placeholder). Each stage has a label and a next-required-action sentence; its destination is null until the owning story registers it, and a null destination renders as text, never a dead link. The mutation is a Server Action behind `withActiveAccount`. English and Hebrew (right to left), light and dark, phone and desktop, WCAG 2.2 AA; new Hebrew is machine-drafted and flagged for native review. Remove the synthetic content this story makes untrue: the "synthetic shell" banner and sidebar mode card, Home's sample notice and activity list, the sample Account name (the Account panel shows the verified Google address), and the sample notification (an honest empty state). `/api/health` and `healthSummary` stay as they are. `/kit` keeps its sample card, fed by `lib/project-fixtures.ts`. The story provides the Project target resolver and the status-handle column; Stories 1.12 and 1.8 wire them in.

**Ask First:** Any change to what `identity.assert_operation_authority`, `api.guard_operation` or the session-grant functions do; new environment variables, secrets or external accounts; a command other than Rename, or a Project field beyond those listed; anything that sets `deleted_at` or touches tombstones or the status handle (Story 1.8's); any change to `/api/health`; any step against staging or production.

**Never:** Creating a Project from the app (Story 2.1); deleting one (Story 8.x); Jobs, Sources content, Versions or models; offline and sync states (locally saved, syncing, sync failed, conflict, locked by disable), which later stories feed; registering with the Story 1.12 gateway or calling Story 1.8's guard, status route or ledger; a browser-only check; any unauthenticated read of a Project; the Administrator reading Projects; showing the status handle; sample or fabricated Project data for a real Account.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| New Account | Home opens, no Projects | The three actions with "0 projects" and "No active jobs", Recent shows "No projects yet" with Create; no sample content | N/A |
| Populated | Account with Projects | My Projects lists newest update first: title, stage badge, Version, updated time; each card opens its overview | Unreadable list: an error state with retry, nothing else shown |
| Search and filter | Text and/or a stage | Matching cards, count announced; none: "No matching projects", distinct from the empty state | N/A |
| Open owned | An owned, live Project | Overview: stage, Version, next required action, Model and Sources entries, Rename | N/A |
| Unavailable link | Foreign, deleted, unknown or malformed ID, also on `/sources` | One "unavailable" page, 404, identical for all four, no Project data, a link to My Projects | Database unreachable: a retryable error, never "unavailable" |
| Rename, current revision | Expected equals current | Title and revision +1 everywhere, a confirming notice | N/A |
| Rename, stale | Expected is older (another window renamed) | Rejected with the current revision and title; nothing changes; the page shows the current title and says it changed | N/A |
| Replay | Same command ID, same payload | The original receipt, no second bump | N/A |
| Reused ID | Same command ID, another payload | Rejected, nothing changes | N/A |
| Bad title | Blank, over 120 characters, control characters | A field error, nothing changes | N/A |
| Authority lost | Account disabled, session revoked or epoch stale mid-request | Refused by the gate and by the function; nothing changes | N/A |
| Outage | Database down during Rename | Retryable; outcome unknown: told to check the title before retrying | N/A |
| Privacy | Pages, RSC payload, logs, REST | Nothing of another Account's Projects; no title in any log | N/A |

</frozen-after-approval>

## Code Map

- `components/nova-dashboard.tsx` -- `Home` :100, `Projects` :145 (the disabled "All projects" filter :175 is this story's to implement), `InProgress` :188, `ProjectCard` :41 (also used by `/kit`), `Progress` :32. Replace the sample data with real props. `lib/mock-data.ts` -- keep only `healthSummary`; `lib/projects-filter.ts` filters `MockProject`.
- `components/shell/shell.tsx` -- `SyntheticBanner` :28, the sidebar mode card :208-213, `NotificationsMenu` :62 (`sampleProjectById`), `AccountPanel` :97 (`sampleAccount`). `app/layout.tsx` renders `<Shell>`; `getAccess` (`lib/auth.ts` :45) is cached per request, so the layout can pass the verified address down. `components/shell/routes.ts` `parentRoute` already maps `/projects/<id>` to `/projects`.
- `app/page.tsx`, `app/projects/page.tsx`, `app/progress/page.tsx` -- `requireActiveAccount` (`lib/auth.ts` :54) and the `generateMetadata` pattern. `lib/access.ts` :74 `AccessAccount` (`accountId`, `workspaceId`, `epoch`); `withActiveAccount` `lib/auth.ts` :176; the nearest action pattern is `app/admin/accounts/actions.ts` (without its role and marker steps).
- `lib/accounts.ts` -- `callApi` :317, `callRow`, `unexpected`, `oneOf`, `requireUuid` are module-private: export them for `lib/projects.ts`. `AccountsUnavailableError` :187 (`outcomeUnknown`). `lib/authority.ts` `operationOf`; `docs/authority-contract.md` gains the Project resolver.
- Migrations -- `20261010120000_accounts.sql` :258 `projects.workspaces` (needs `unique (id, account_id)`), :31-34 closed-by-default privileges; `20261012130000_account_administration.sql` :234 `identity.assert_operation_authority`; `20261012140000_administrator_recovery.sql` :457 `api.preflight` (re-create carrying every probe). New: `20261012150000_projects.sql`. `extensions.gen_random_bytes(16)` and `sha256(bytea)` exist locally.
- Tests that read the sample data (survey): `tests/unit/{synthetic-shell,projects-filter,shell,i18n,metadata}.test.ts[x]` (`home.greeting` and `home.projectsDetail` serve `i18n.test.ts` as plural and placeholder fixtures), `tests/e2e/{signed-in-shell,shell}.spec.ts` (`/kit` card), `tests/e2e/public-surface.spec.ts` (`/api/health`, unchanged). `page-guards.test.ts` discovers every page and needs `requireActiveAccount`; `gate-structure.test.ts` pins callers; `metadata.test.ts` lists pages by hand.
- `tests/support/accounts-data.ts` :110 and `forged-session.ts` :333 delete `projects.workspaces`: clear Projects and commands first. `accountsWorld().activate()` makes a member with a Workspace and no Projects (the default e2e Account). `tests/integration/isolation.test.ts` :195 expects every `projects` table to answer 406 over REST. `scripts/seed-accounts.mjs` shows the local-only script style.

## Tasks & Acceptance

**Execution:**
- [x] `supabase/migrations/20261012150000_projects.sql`, `lib/accounts.ts` -- `projects.projects`, `projects.project_commands`, guard triggers, closure; `api.list_projects`, `api.get_project`, `api.rename_project` (authority first, no-disclosure `unavailable`, ledger replay, stale rejected with the current revision); preflight carrying every earlier probe; export the call helpers -- AC-3, AC-4
- [x] `lib/projects.ts`, `lib/project-stage.ts`, `lib/project-target.ts`, `lib/project-fixtures.ts` -- typed calls; the six stages (label, tone, icon, next-action sentence, nullable destination); the resolver `docs/authority-contract.md` describes; fixtures for the kit and tests -- AC-2, AC-3
- [x] `app/page.tsx`, `app/projects/**`, `app/progress/page.tsx`, `components/nova-dashboard.tsx` and new `components/projects/*` -- Home, My Projects with search and stage filter, In Progress, overview, Sources placeholder, unavailable page, Rename dialog and the `renameProject` Server Action -- AC-1, AC-2, AC-3, AC-4
- [x] `components/shell/shell.tsx`, `app/layout.tsx`, `lib/mock-data.ts`, `lib/i18n/{en,he}.ts` -- remove the synthetic banner, sample Account, notification and activity; the verified address in the Account panel; the notifications empty state; new strings in both languages -- AC-1
- [x] `tests/` -- every matrix row: integration (functions, closure, composite FK, ledger replay and conflict, stale, authority denied, a race on two connections, preflight, REST 406), unit (stage registry, actions with faked calls, pages, resolver), browser on desktop and phone (empty and populated Home and My Projects, all six stages, overview, unavailable, Rename and its stale case in two windows, axe in four variants, 320 px at 200% text, keyboard focus); rewrite the tests that read sample data; update the structural tests and cleanup helpers -- all ACs
- [x] `scripts/seed-projects.mjs`, `docs/{authority-contract,staging}.md`, `README.md`, `deferred-work.md` -- a local-only fixture seed (all six stages); the staging migration note; deferrals recorded: gateway registration (1.12), tombstone guard and status route (1.8), sync and lock states, Hebrew review -- housekeeping

**Acceptance Criteria:**
- Given a new Account, when Home opens, then the three primary actions and useful empty states are visible on phone and desktop, with no sample content.
- Given owned Projects with stage and version, when one is opened, then the model and stage and the Sources entry are shown with the next required action reachable, and the labels cover all six stages including awaiting Model Approval and Export ready.
- Given a stale, deleted or foreign Project link, when navigation resolves it, then live ownership and lifecycle checks reveal nothing and one clear unavailable page is shown.
- Given a Rename carrying a stale expected revision, when it is submitted, then it is rejected with the current revision and changes nothing; with the current revision it commits and bumps the revision once.

## Spec Change Log

## Design Notes

The Epic's build order puts Stories 1.8 and 1.12 before this one, and neither exists. Everything here that needs them is provided as a seam and not wired: the status-handle column (1.8 defines how it is used), `deleted_at` as the hide marker (1.8's tombstone guard is consulted in addition when it lands), and the resolver (1.12 registers it with the gateway). Foreign, deleted and unknown IDs share one answer and one page so a link cannot be used to probe for existence. Rename is the one real command so AC-4 is shown through a user-visible flow with two windows, not only in SQL. A null next-action destination keeps the page honest until Epic 3 and later stories register real routes. Home's greeting no longer names anyone: an Account has only a verified address, which the Account panel shows.

## Verification

**Commands:**
- `npm run typecheck && npm run lint && npm run build` -- expected: exit 0
- `supabase start && npm test` -- expected: unit and integration pass, every matrix row covered
- `CI=1 npm run test:e2e` (stack started as CI does, fake Google active, `.env.local` from `scripts/setup-env.mjs local`) -- expected: all flows pass on both projects
- `node scripts/ci/check-repository.mjs && npm run render:provisioning -- --check && npm run test:env` -- expected: exit 0

**Manual checks (if no CLI):**
- After `node scripts/seed-projects.mjs` against the local stack, open Home, My Projects and one Project of each stage on a phone-width window in Hebrew and dark: every stage reads in words, the next action is stated, and Rename works with the keyboard.

## Suggested Review Order

**The record and its commands (start here)**

- The Project table: composite key to Workspace and Account, immutable status handle, closed to every role.
  [`20261012150000_projects.sql:53`](../../supabase/migrations/20261012150000_projects.sql#L53)

- Rename: authority first, one lock, ledger replay, stale answers the current revision and writes nothing.
  [`20261012150000_projects.sql:254`](../../supabase/migrations/20261012150000_projects.sql#L254)

- Foreign, deleted and unknown IDs all answer one `unavailable`, with every field empty.
  [`20261012150000_projects.sql:209`](../../supabase/migrations/20261012150000_projects.sql#L209)

- The list reads its rows and total in one statement, so they cannot disagree.
  [`20261012150000_projects.sql:160`](../../supabase/migrations/20261012150000_projects.sql#L160)

- The preflight carries every earlier probe plus the new ones.
  [`20261012150000_projects.sql:346`](../../supabase/migrations/20261012150000_projects.sql#L346)

**Typed calls and the seam for later stories**

- Every answer is checked; a foreign row is never trusted; outcome-unknown is kept apart.
  [`projects.ts:120`](../../lib/projects.ts#L120)

- The Project target resolver Stories 1.12 and 1.8 will register; wired to nothing here.
  [`project-target.ts:43`](../../lib/project-target.ts#L43)

- Six stages, each with label, tone, icon, next-action sentence and a nullable destination.
  [`project-stage.ts:46`](../../lib/project-stage.ts#L46)

- The call helpers are exported so Projects uses the one service-role path.
  [`accounts.ts:320`](../../lib/accounts.ts#L320)

**Pages and the state the person sees**

- Home with real counts and honest empty states; the sample content is gone.
  [`nova-dashboard.tsx:41`](../../components/nova-dashboard.tsx#L41)

- My Projects: search and stage filter in the browser, empty told apart from no match.
  [`projects-list.tsx:23`](../../components/projects/projects-list.tsx#L23)

- The overview: stage in words and shape, next required action, Model and Sources entries.
  [`project-overview.tsx:24`](../../components/projects/project-overview.tsx#L24)

- One unavailable page and a 404 for every link that cannot be opened.
  [`page.tsx:24`](../../app/projects/[projectId]/page.tsx#L24)

- A database outage is a retryable error, never "unavailable".
  [`unreadable.tsx`](../../components/projects/unreadable.tsx)

**Rename**

- The Server Action behind `withActiveAccount`; the Account never comes from the form.
  [`actions.ts:50`](../../app/projects/actions.ts#L50)

- One command ID per change asked for, kept across an unknown answer so a retry is a replay.
  [`rename-dialog.tsx:54`](../../components/projects/rename-dialog.tsx#L54)

- While a save is in flight no path closes the dialog, so the result cannot be lost.
  [`dialog.tsx:16`](../../components/ui/dialog.tsx#L16)

- Title rules shared by the dialog and the action, checked again by the database.
  [`project-view.ts:78`](../../lib/project-view.ts#L78)

**The gate: a link that does not even decode**

- A non-API request at such a path is rewritten to the unavailable page, built like any page response.
  [`proxy.ts:183`](../../proxy.ts#L183)

- The path test for an ID that is not valid percent-encoding.
  [`project-paths.ts:17`](../../lib/project-paths.ts#L17)

**Shell: the synthetic content removed**

- The Account panel shows the verified Google address and no sample name.
  [`shell.tsx:84`](../../components/shell/shell.tsx#L84)

- The address comes from the request's verified access and nowhere else.
  [`account-address.server.ts:13`](../../lib/account-address.server.ts#L13)

- Notifications are an honest empty state.
  [`shell.tsx:56`](../../components/shell/shell.tsx#L56)

**Operations and documents**

- The local-only seed refuses any URL that could send the connection elsewhere.
  [`seed-projects.mjs:13`](../../scripts/seed-projects.mjs#L13)

- The resolver's contract, including what an ID that cannot be a Project's answers.
  [`authority-contract.md:76`](../../docs/authority-contract.md#L76)

- Apply the migration to staging by hand, before the build that uses it deploys.
  [`staging.md:71`](../../docs/staging.md#L71)

- The provisioning item that tells Josh to do it.
  [`ledger.json:372`](../../provisioning/ledger.json#L372)

**Tests**

- Functions, closure, ledger, authority, two real connections racing, the status handle going nowhere.
  [`projects.test.ts:82`](../../tests/integration/projects.test.ts#L82)

- Unavailable page, Rename in two windows, retry after a lost answer, axe, 320 px at 200% text.
  [`projects.spec.ts:448`](../../tests/e2e/projects.spec.ts#L448)

- The undecodable-ID rewrite, with its cookies and its order against the access decision.
  [`proxy-gating.test.ts:215`](../../tests/unit/proxy-gating.test.ts#L215)

- The action with faked calls: what it checks, in what order, and what it prints.
  [`project-actions.test.ts:96`](../../tests/unit/project-actions.test.ts#L96)
