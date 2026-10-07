# Sprint Change Proposal: 2026-10-07

**Project:** nova3D · **Prepared for:** Josh · **Trigger:** `implementation-readiness.md` (readiness gate FAIL), findings 1, 3 and 8
**Status:** APPROVED by Josh on 2026-10-07. Sets A, B and C are applied to the Spine, R-8, `epics.md`, the UX inventory and scope-and-readiness, and propagated to the story specs, story inputs, index, manifest and validation report (the full multi-agent validation was not re-run; see the amendment in `story-specs-validation.md`). Still open: section 6 items and the remaining readiness findings.
**Mode:** Incremental was selected, then Josh said "you decide", so the decisions below are mine, taken from the stated leanings. Every one is reversible before approval.
**Scope class:** Moderate. No epic is added or removed and the PRD is unchanged. One architecture decision (AD-12 and AR-18) is amended, and five story specs need regeneration.

Citations are to `planning-artifacts/epics.md` unless noted. `Spine` is `architecture/architecture-nova3D-2026-09-14/ARCHITECTURE-SPINE.md`.

---

## 1. Issue summary

Three places where the recorded plan and the real project disagree or are silent:

| # | Issue | Type |
| --- | --- | --- |
| 1 | The plan assumes invitation-code registration and an unspecified credential. The deployed app uses Google sign-in gated by an env-var email list. | Build ran ahead of the plan |
| 3 | G-8 has no model. Nothing says what to build or when to decide while it is BLOCKED, and Epic 8 sits behind the Epic 7 chain. | Technical limitation found in qualification |
| 8 | Story 1.1 and AR-1 describe an empty, unbuilt application. A root-level mock-first shell is already deployed and drifts from the pinned contract. | Build ran ahead of the plan |

**Evidence (all re-read in source):**
- **Auth, plan side:** FR-1 (codes), AD-12 and AR-18 ("Disable public Supabase signup"), Stories 1.3, 1.4 and 1.6, UX-DR21 to UX-DR23 (`:859-871`). No document names a credential type or the Administrator identity ("configured sole Administrator", `:1596`).
- **Auth, built side:** `lib/auth-config.ts:5-13` (env-var allowlist), enforced in `proxy.ts:23` and `app/auth/callback/route.ts:12`. `lib/auth.ts` and `components/login-form.tsx` are Google only. There are no Account tables, no codes and no Administrator role.
- **G-8:** R-8 (RD:79) selects ONNX Runtime Web 1.29.0 and says "no model is claimed proven" and "a missing compliant engine remains release-blocking". Story 7.1 AC-2 (`:3066-3070`) records G-8 BLOCKED with scope unchanged. 7.2 to 7.5 hard-depend on 7.1 (`:3090`, `:3128`, `:3166`, `:3204`). Story 8.1 depends on 7.5 (`:3320`). The plan assumes the evidence path does not wait for the engine (`:3582-3586`), but deletion does.
- **Story 1.1:** the app is Next 16.3.5, React 19.3.0, TypeScript 5.9.3, Tailwind 4.3.3, supabase-js 2.116.0, ssr 0.12.7 and Upstash 1.3.3 / 1.38.4. These match AR-1.
  - `package.json` has `engines >=20.12.0`, but AR-1 pins Node 24.21.0. CI uses Node 24 and this machine runs v24.21.0, so the drift is in `engines`.
  - `bmad-method` is a runtime dependency, and `three` is not installed.
  - `scripts/check-env.mjs` validates the `APP_ENV` label only, not the immutable environment identifier the Spine requires (Spine:179).
  - CI runs `scripts/test-env.mjs`, which tests that script, but nothing runs `check-env.mjs` against a real deployment configuration.
  - Correction to the readiness findings: `--webpack` is not unexplained. The qualification report shows both the default and the Webpack builders passing (`qualification-2026-09-14/stack/qualification-report.md:63-70`). The choice just was not recorded as a decision.

## 2. Impact analysis

**Epics**
- **Epic 1:** Stories 1.1, 1.3, 1.4 and 1.6 are amended. 1.2 and 1.5 are unaffected. Epic 1 is completable.
- **Epic 7:** Story 7.1 is amended and an Epic 7 note is added. 7.2 to 7.5 only gain a meaning for the 7.1 dependency, with no text change.
- **Epic 8:** no text change. The decoupling follows from the Epic 7 amendments. The structural 7.5-versus-8.1 problem (finding 4) stays with `bmad-create-epics-and-stories`.
- **Epics 2 to 6:** no impact.

**Artifacts**

| Artifact | Change |
| --- | --- |
| PRD | None. FR-1 and FR-3 are preserved. |
| Architecture (Spine, RD) | AD-12 amended, repository-layout note amended, R-8 gains one sentence. |
| `epics.md` | AR-1, AR-18, Stories 1.1, 1.3, 1.4, 1.6 and 7.1, UX-DR21 and UX-DR22, and the Epic 7 note. |
| UX (`SCREEN-INVENTORY.md`) | A-01 and A-02 state lists and descriptions. |
| `specs/spec-nova3D/scope-and-readiness.md` | The G-8 row gains the checkpoint reference. |
| Story specs | `specs/spec-nova3D-story-1-1`, `1-3`, `1-4`, `1-6` and `7-1` need updating, plus `story-inputs/story-1-1.json`, `1-3`, `1-4`, `1-6` and `7-1`. |
| Manifest and validation | `specs/story-specs-manifest.json` hashes `epics.md`, so it goes stale. `story-specs-validation.md` and its JSON describe the old text and must be re-run. |
| Code | Follow-up work through `bmad-build`, not part of this proposal (see section 4, Set C). |

**Ripple to watch:** Story 1.1's title changes, so its sprint-status key changes (`1-1-bootstrap-the-qualified-application-seed`). This has no effect yet because no `sprint-status.yaml` exists.

## 3. Recommended approach

**Option 1, Direct Adjustment.** Effort: medium. Risk: low to medium. It keeps first-version scope, the PRD and the epic structure unchanged.
- **Option 2, Rollback:** not viable. It would discard working, deployed Google auth to match a plan that never named a credential.
- **Option 3, MVP review:** not needed now. It becomes live only if the G-8 checkpoint (Edit B3) chooses "defer offline conversion" or "online fallback". Both would be recorded product decisions.

### Decisions taken on Josh's behalf

| Decision | Chosen | To reverse |
| --- | --- | --- |
| Sign-in model | Google as the only credential, invitation codes still gate Account creation. FR-1 unchanged. | Discard Set A, or switch to email allowlist (needs a PRD change to FR-1). |
| Administrator identity | One verified Google email in server-only config. The plan names no person. | Nothing to reverse; the build picks the address. |
| Recovery link (FR-3, Story 1.6) | Kept as written. It becomes the Administrator's only non-Google sign-in. | Replace with Google-only recovery (shrinks Story 1.6). |
| G-8 while BLOCKED | Keep scope. Build Epic 7 against a swappable engine port with a test engine. Open a product-decision checkpoint. | Skip Set B, or pick "defer" or "online fallback" at the checkpoint. |
| Repository layout | Keep the root-level Next app. Amend the Spine layout. Split into `packages/*` when a second consumer needs it. | Restructure to `apps/web` now. This risks the deployed Vercel root-directory setup. |
| Three 0.186.0 | Added by the first story that uses it (the viewer story, 4.6). | Install now as an unused dependency. |

**Note:** earlier I said recovery would "shrink to Google re-authentication". I changed that. Keeping the recovery link preserves FR-3, Story 1.6 and screen A-03 exactly, and it is the least change to a ratified guarantee.

## 4. Detailed change proposals

### Set A: Auth model (finding 1)

**A1. Spine AD-12, Rule, first two sentences**
OLD: "Disable public Supabase sign-up. One narrow registration service atomically claims a hashed invitation and idempotently provisions Auth identity plus Workspace; partial provisioning is unusable until activation completes."
NEW: "Google, through Supabase Auth, is the only sign-in credential; there are no passwords. Public Account creation is unavailable: an Auth identity without an activated Account has no access to any private path, and a Google sign-in alone is never authorization. One narrow registration service atomically claims a hashed invitation for the signed-in verified Google identity and idempotently provisions the Account plus Workspace; partial provisioning is unusable until activation completes. The sole Administrator is the one verified Google email held in server-only configuration, never taken from client input."
*Why:* disabling Supabase sign-up would, as I understand the setting, stop a new invitee from ever signing in with Google, so they could not reach redemption. The live-Account check that AD-12 and AR-18 already require gives the same protection. *Trade-off:* any Google user can create a dormant Auth identity with no access. Rate limits and a purge policy for dormant identities (delegated to architecture) contain it.

**A2. `epics.md` AR-18, first sentence**
OLD: "Disable public Supabase signup; hash/atomically claim invitations and idempotently provision Auth plus Workspace with unusable partial activation."
NEW: "Google is the only credential and an Auth identity without an activated Account has no access (no public Account creation); hash/atomically claim invitations for the signed-in verified Google identity and idempotently provision the Account plus Workspace with unusable partial activation."

**A3. Story 1.3, Scope**
OLD: "- Implement fresh-authenticated Administrator invitation issuance/revocation and narrow idempotent registration."
NEW: "- Implement fresh-authenticated Administrator invitation issuance/revocation and narrow idempotent registration: a user signs in with Google, then redeems an invitation code to activate an Account. No code, no Account.
- Provision the Administrator and the other currently allowlisted identity once through a documented, audited seed rather than code redemption."
**Story 1.3 AC-1, Then**
OLD: "...at most one activated Account/Workspace is created; retries return the original outcome and partial provisioning cannot sign in"
NEW: "...at most one activated Account/Workspace is created; retries return the original outcome, partial provisioning cannot sign in, and a signed-in Google identity with no activated Account reaches no private path"

**A4. Story 1.4, Scope (add) and AC-3**
Scope, add: "- Sign in uses Google OAuth through Supabase. Fresh authentication for sensitive actions means Google re-authentication within the fresh-authentication window.
- Replace the interim `AUTH_ALLOWED_EMAILS` gate with the live-Account check in the same change, and remove the variable from the proxy, callback, health route, environment checks and docs."
AC-3 OLD: "**Given** invalid credentials or an Administrator session ..."
AC-3 NEW: "**Given** a failed Google sign-in, a Google identity with no activated Account, or an Administrator session ..." (the *Then* line is unchanged)

**A5. Story 1.6, Scope (add one clause)**
OLD: "- Use a short-lived single-use verified-email recovery link and fresh authentication for sensitive actions."
NEW: "- Use a short-lived single-use verified-email recovery link and fresh authentication for sensitive actions. The link is the only non-Google sign-in path and exists only for the sole Administrator."

**A6. UX: `SCREEN-INVENTORY.md` A-01, A-02; `epics.md` UX-DR21 and UX-DR22**
A-01 states OLD: "Default, invalid credentials, disabled Account, loading"
A-01 states NEW: "Default, Google sign-in failed, no activated Account (redeem an invitation), disabled Account, loading"
A-02 OLD: "Single-use Invitation Code, Account creation, clear generic failures"
A-02 NEW: "Single-use Invitation Code redeemed by a signed-in Google identity, Account activation, clear generic failures"
UX-DR21 and UX-DR22 are updated to match. A-03 is unchanged.

**A7. Action (not an artifact edit):** check the cloud project's "Allow new users to sign up" setting in the Supabase dashboard. The interim allowlist is today's only gate. I cannot check this from here.

### Set B: G-8 fallback (finding 3)

**B1. Story 7.1, Scope (add) and new AC-4**
Scope, add: "- Expose the engine through a versioned engine port with a conformance test suite and a deterministic test engine, so Stories 7.2 to 7.5 can be built and accepted without qualified weights."
New AC-4:
"**AC-4**
**Given** Story 7.1 has completed with a recorded BLOCKED evidence report
**When** Stories 7.2 to 7.5 are built
**Then** they run against the engine port using only the test engine, label every output non-qualified, never offer it to users as reconstruction, and cannot close G-8"
**Story 7.1 AC-2, Then:** append "; Story 7.1 completes with that recorded BLOCKED report and the Epic 7 checkpoint opens".

**B2. `epics.md` Epic 7 intro, add a note**
"A dependency on Story 7.1 means 7.1 has completed with either a qualified engine or a recorded BLOCKED report. Qualified-engine acceptance gates release, not build order."

**B3. `epics.md` Planning Assumptions, `scope-and-readiness.md` G-8 row, and R-8 (one sentence each)**
NEW: "G-8 product-decision checkpoint: when Epic 6 is complete, or Story 7.1 has evaluated every available candidate (whichever comes first), and G-8 is still BLOCKED, Josh records one of: keep waiting, defer offline direct conversion to a later release, or add an online worker path. Until that record exists, scope and limits are unchanged and full first-version release stays blocked."
*Why:* R-8 forbids dropping scope without a recorded decision. This gives that decision a trigger and a decision-maker.

**B4. No text change to Epic 8.** With B1 and B2, 8.1 no longer waits on engine qualification. 8.6 and 8.7 still require G-8 evidence. The 7.5/8.1 circularity itself goes to `bmad-create-epics-and-stories`.

### Set C: Story 1.1 against the shell (finding 8)

**C1. Story 1.1, title, Scope and ACs**
Title OLD: "Bootstrap the qualified application seed" → NEW: "Adopt and harden the qualified application seed"
Scope OLD: "- Initialize only the official pinned Next/App Router/TypeScript/Tailwind seed, Supabase SSR wiring and environment checks needed to serve an empty application.
- Define module ownership and environment boundaries; later stories introduce their own entities."
Scope NEW: "- Adopt the existing root Next.js App Router application (Next 16.3.5, React 19.3.0, TypeScript 5.9.3, Tailwind 4.3.3, Supabase SSR, interim Google sign-in) as the qualified seed and bring it to the pinned contract.
- Verify the environment at startup and in the deployment build, and exercise the check in CI. Label the mock dashboard a synthetic shell that later stories replace.
- Define module ownership and environment boundaries; later stories introduce their own entities."
AC-1 Then OLD: "the lockfile records the adopted versions and a loopback production page responds successfully"
AC-1 Then NEW: "the lockfile records the adopted versions, `engines` and CI both pin Node 24.21.0, build-only tooling is not a runtime dependency, the bundler choice is recorded with its qualification evidence, and a loopback production page responds successfully"
AC-2 Then OLD: "production credentials and paid adapters are unavailable, and mixed environment identifiers fail startup"
AC-2 Then NEW: "production credentials and paid adapters are unavailable, and a mixed or unverifiable environment identifier fails startup and the deployment build. The check verifies an immutable environment identifier against each configured resource, not only the `APP_ENV` label, and CI exercises it against fixture environments. A credential-free local build still succeeds."
AC-3 OLD: "**Given** the initial starter / **When** its migrations and modules are reviewed / **Then** it contains only startup needs, not all future domain tables or a claim that deployed providers are qualified"
AC-3 NEW: "**Given** the adopted shell / **When** its routes, data and modules are reviewed / **Then** it contains only startup needs and a clearly labeled synthetic dashboard, with no persisted-data claim, no future domain tables, and no claim that deployed providers are qualified"

**C2. `epics.md` AR-1**
OLD: "Epic 1 Story 1 must initialize the official create-next-app 16.3.5 TypeScript/App Router/Tailwind starter ... Preserve Node 24.21.0, ... Three 0.186.0 as the qualified seed; ... Local probes already pass but the application is unbuilt."
NEW: "Epic 1 Story 1 adopts the existing Next 16.3.5 TypeScript/App Router/Tailwind application ... Preserve Node 24.21.0 (pinned in `engines` and CI), ... as the qualified seed; Three 0.186.0 is added at this pin by the first story that uses it. The application exists as a mock-first shell at the repository root."

**C3. Spine repository layout (`~:288`)**
Add above the layout block: "Until a second TypeScript package needs shared code, the Next.js application lives at the repository root (`app/`, `components/`, `lib/`, `proxy.ts`). Extract `packages/*` when a consumer other than the web app needs it. Workers stay under `workers/`."
Also correct any "application is unbuilt" wording in the Spine and `epics.md`. The Spine's wording is not confirmed. The qualification REPORT is dated evidence and is not edited.

**C4. Code follow-ups (through `bmad-build` on Story 1.1, not applied here)**
- Set `engines` to Node 24.21.0.
- Move `bmad-method` out of runtime dependencies.
- Make `check-env.mjs` verify an immutable environment ID, and run it at deployment build and startup.
- Add a CI step that runs it against fixture environments.
- Record the Webpack-versus-default bundler decision.
- After Story 1.4, drop `AUTH_ALLOWED_EMAILS` from `check-env.mjs` and `.env*.example`.

## 5. Implementation handoff

- **Architect (Winston):** review A1 and C3, the only architecture edits.
- **Developer (Amelia):**
  1. Apply approved edits to `epics.md`, the UX inventory and `scope-and-readiness.md`.
  2. Update the five story specs and their `story-inputs` JSON, then regenerate the manifest and re-run validation.
  3. Execute C4 under Story 1.1 when it is built.
- **Remaining readiness findings (2, 4, 5, 6, 7, 9, 10):** `bmad-architecture` for free-only research and provider decisions, then `bmad-create-epics-and-stories` for ordering, unowned deliverables and AC gaps. Re-run `bmad-sprint-planning` afterwards.

**Success criteria**
- No planning document says the application is unbuilt or that Supabase sign-up is disabled.
- Stories 1.1, 1.3, 1.4, 1.6 and 7.1 and their specs agree with `epics.md`, and the manifest hashes match.
- G-8 has a checkpoint trigger and a decision-maker.
- Epic 8 does not wait on engine qualification.

## 6. Open items I did not decide

- **Administrator address:** choose at build time between `heimannshua@gmail.com` and `daniel@orvex.ai`. The other becomes a seeded invited Account.
- **Recovery-email provider and fresh-authentication window length:** routed to `bmad-architecture` (finding 6).
- **Supabase sign-up setting:** unverified (A7).
- **Checkpoint trigger:** "Epic 6 complete or all candidates evaluated" is my proposal. You may prefer a calendar date.

## Checklist record

- **1.1 to 1.3** done.
- **2.1 to 2.5** done: Epic 1 completable with amendments, Epic 7 amended, no epic added, removed or reordered by this change.
- **3.1 PRD** done: no change. **3.2 Architecture** done: AD-12, layout, R-8. **3.3 UX** done: A-01, A-02. **3.4** done: code and CI follow-ups.
- **4.1 Direct Adjustment** viable. **4.2 Rollback** not viable. **4.3 MVP review** not needed. **4.4** done: Option 1.
- **5.1 to 5.5** done.
- **6.1 to 6.2** done. **6.3** action-needed: approval. **6.4** N/A: no `sprint-status.yaml` exists. **6.5** action-needed: confirm handoff.
