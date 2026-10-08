# nova3D Implementation Readiness: FAIL

**Date:** 2026-10-07 · **Skill:** `bmad-sprint-planning` (readiness gate) · **Requested by:** Josh

**Question tested:** could a developer implement these epics without inventing decisions nothing records?

**Verdict: FAIL.** The plan is not implementable as recorded. `sprint-status.yaml` was not generated. Re-run `bmad-sprint-planning` after the fixes below.

The FAIL comes from missing recorded decisions, missing fallbacks, and stories in the wrong order. It does not come from G-1 to G-9 being open. The plan states that implementation and qualification may proceed while those gates are open (`specs/spec-nova3D/scope-and-readiness.md:85`).

**Resolution status (2026-10-07):** findings 1, 3 and 8 are addressed by `sprint-change-proposal-2026-10-07.md`, approved and applied to `epics.md`, the Spine, R-8, the UX inventory, `scope-and-readiness.md` and the five affected story specs. **Update (2026-10-08):** finding 2 and the architecture-owned items of finding 6 are resolved in the Spine and R-2/R-5/R-6/R-9 (architecture update run; reviews in `architecture/architecture-nova3D-2026-09-14/reviews/`). The change was propagated to `epics.md` and 20 story specs on 2026-10-08 (scripted parity check: 58/58 stories, 457/457 source lines, manifest 307/307; the full multi-agent validation was not re-run). Placements of newly required work are provisional and listed in the `epics.md` Planning Assumptions. Open: findings 4, 5, 7, 9, 10, the epics-owned items of finding 6, and Josh's remaining decisions. Answered 2026-10-08: Administrator is heimannshua@gmail.com, no sending domain (recovery mails through the Resend test sender), cloud sign-ups are on, and only the Windows laptop is available for G-5. Still open: how to cover phone/Safari qualification, Vercel plan, Anthropic org key, Brave terms. The gate verdict stays FAIL until they are resolved and sprint planning is re-run.

## How this was produced

Three parallel read-only audits (dependencies/independence, requirements traceability, unrecorded decisions/plan-vs-reality), plus my own reading of `specs/spec-nova3D/SPEC.md` and `scope-and-readiness.md`.

Each finding is tagged:
- **[verified]**: I re-read the cited source myself after the audits.
- **[audit]**: reported by an audit with file:line evidence; I did not re-open the citation.
- **[inferred]**: the audit marked it as inference, not verified.

Line numbers are in `planning-artifacts/epics.md` unless noted. `RD` is `architecture/architecture-nova3D-2026-09-14/RATIFIED-DECISIONS.md`. `Spine` is `ARCHITECTURE-SPINE.md` in the same folder.

## What is sound

- All 58 stories' declared dependencies agree across `specs/story-specs-index.md`, `epics.md`, each story's `acceptance-criteria.md` and `story-inputs/*.json`. The graph is acyclic with no forward edges. [audit]
- Counts match their sources: 30 FR (126 consequence bullets identical to the PRD), 12 NFR, 7 SC, 73 UX-DR, 28 AR, 8 epics, 58 stories, 174 Given/When/Then ACs, 88 CAP IDs. The FR map and Additional Requirement map exactly invert the stories' Requirements lines. [audit]
- G-1 to G-9 statuses agree across the qualification REPORT, RD, Spine, `epics.md` and `scope-and-readiness.md`. [audit]
- R-2, R-3, R-5, R-6 and R-9 numeric limits are recorded, and no numeric conflicts were found across the sources. [audit]
- "150/150 mapped" and "457/457" prove requirement text was copied into stories, not that the ACs implement it. No story names an SM metric except 8.7, generically. [audit]

## Findings, most severe first

### 1. The built auth contradicts the plan (Epic 1)

- The app uses Google-only login through Supabase with an env-var email allowlist (`docs/auth-setup.md:3`, `lib/auth-config.ts:5-13`, `proxy.ts:23`, `app/auth/callback/route.ts:11-15`).
- Stories 1.3, 1.4 and 1.6 assume invitation codes, credentials and a recovery link (`:1467-1500`, `:1594-1610`; "invalid credentials" at `:861`). No story names a credential type. [audit]
- The Administrator identity and bootstrap are unrecorded ("configured sole Administrator", `:1596`). Both allowlisted emails are treated identically, and the dashboard hard-codes "Josh" (`components/nova-dashboard.tsx:74,92`). [audit]
- Story 1.1 bootstraps an "empty application" and Spine:26, `:575` and the qualification REPORT call the app unbuilt. A mock dashboard now exists at the repo root, not in `apps/web` (Spine:288). [audit]
- `supabase/config.toml` has no `[auth]` block. Google OAuth creates the Auth user before the allowlist check (callback:11-15), against AD-12's "disable public sign-up" (Spine:118). The cloud setting is unverified. [audit, inferred]
- Both the epics and the code need amending. The epics should record Google as the credential, the Administrator bootstrap, and migration of the two identities. The code is interim and gets replaced when 1.3 and 1.4 are built.
- **Fix:** `bmad-correct-course`.

### 2. Free-only research has no defined engine (blocks 2.9, 3.1, 3.3 to 3.7)

- The plan offers a free-only research choice (`:245`, `:250`, `:1825`, `:2271`). No story says how source discovery or claim synthesis works without paid calls. [verified: search of `epics.md` finds no such description]
- RD:61 selects Anthropic for synthesis and Brave for discovery, and bars metered use in free-only mode. I did not read the full R-6 text. [audit]
- The single free/paid toggle is not mapped to R-6's two permission categories (PRD:218; SCREEN-INVENTORY:43). [audit]
- **Fix:** `bmad-architecture`, then update the epics.

### 3. G-8 has no model and no fallback (Epic 7, and Epic 8 transitively)

- The only decision recorded is the runtime, ONNX Runtime Web 1.29.0 (RD:79). Four candidate models were rejected (REPORT.md:16), and `:3056` says no engine is currently qualified. [audit]
- The plan names a "recorded product decision" as the only way to change scope (REPORT.md:48), with no owner, trigger, timebox or candidate family. [audit]
- Story 7.1 AC-2 (`:3066-3070`) already handles a negative result: G-8 stays BLOCKED and scope is unchanged. What is missing is what that means for dependents. Stories 7.2 to 7.5 hard-depend on 7.1 (`:3090`, `:3128`, `:3166`, `:3204`) with no rule for building them while the engine is unqualified, and "done" for 7.1 is ambiguous when its outcome is BLOCKED. The held-out corpus and its thresholds are also undefined (`:3062`). [verified]
- The plan's own assumption that evidence-backed generation and export "can be implemented without waiting for the direct reconstruction engine" (`:3582-3586`) does not extend to Epic 8, which depends on 7.5. [verified]
- Epic 8 is gated through 8.1 → 7.5 → 7.4 → 7.3 → 7.2 → 7.1. `:3582` frees only the evidence path. [audit]
- SC-2 says to ratify feasibility before implementation (UX-SCOPE-CHANGES:29), but R-8 sets targets with no qualifying engine (RD:79). [audit]
- **Fix:** `bmad-correct-course`. This needs a product decision from Josh.

### 4. Story order is inverted in several places

- **2.4/2.5/2.6 before 2.7 [verified]:**
  - Story 2.6 depends only on 2.4 and 2.5 (`:1839-1847`).
  - It enforces a "$5 parent research-Job lifetime" ceiling and returns "its original receipt" (`:1851-1852`, `:1860`).
  - Job, attempt, step and operation identities are first created in Story 2.7, which depends on 2.6 (`:1878-1893`).
  - Story 2.5 AC-1 discloses a maximum that comes from the 2.6 calculator (`:1821`).
  - Story 2.4 AC-2 and AC-3 use reservations that 2.6 creates (`:1790`, `:1796`).
- **7.5 and 8.1 depend on each other in substance [verified]:**
  - Story 7.5 implements tombstoned states and monotonic server revisions, and AC-2 purges on a learned tombstone (`:3196-3222`). It depends only on 7.4 and 1.5.
  - Story 8.1 depends on 6.9 and 7.5 and is where the server tombstone is created (`:3312-3335`).
- **5.3 and 5.4 reference later work [audit]:**
  - They compare and restore approval and validation (`:2600`, `:2644`, `:2654-2656`).
  - Approval is created in 5.5 and validation in 6.1 to 6.3.
- **2.9 and 3.2 look ahead [audit]:**
  - 2.9 AC-2 needs a reusable eligible revision (`:1977`).
  - 3.2 AC-2 pins cache adoption or Plan Revision (`:2091-2093`). Those come from 3.6 and 3.5.
- **Epic 2 delivers no value alone [audit].** No workload exists, and 2.7 AC-2 tests "failed research" (`:1903`).
- **Looking ahead to later stories, besides the cases above [audit]:**
  - 1.5 offers fencing for future Jobs and revokes download authority (`:1554-1566`).
  - Deletion is referenced by 1.7, 3.6 and 6.9 before Epic 8.
  - 4.4 AC-3 relies on approval and validation from later stories (`:2431`).
  - 2.10 AC-1 needs events from Epics 3, 4 and 6 (`:2007`).
- **Fix:** `bmad-create-epics-and-stories`. Resequence, or split the tombstone contract out of 8.1 into an early story.

### 5. Deliverables with no owning story

- **GLB derivatives [verified]:** Story 4.6 scope only "uses" coarse and full GLB derivatives (`:2486`). No story produces them.
- **Canonical manufacturing mesh [audit, partly checked]:** Story 6.2 validates it (`:2758`, `:2770`). Story 4.3 touches tessellation for comparison (`:2380`), so the finding is only partly confirmed.
- **Inspection record [audit]:** Story 5.5 AC-1 blocks approval when a model is not inspected (`:2678-2680`). Story 4.6 has no AC that records an inspection event (`:2485-2506`), and "inspected" is undefined (M-09).
- **Research-assisted picture mode [audit]:**
  - "Identifies the subject" (`:488`) is in no story, and the SC-1 map row lists no Epic 3 story (`:1218`).
  - Only one domain generator exists (Spine:82), and no AC handles an out-of-domain subject.
- **Staged images [audit, inferred]:** they live only in lease-bounded staging (`:1723`), but later work needs them (vision calls, evidence_images research, the pinned originals for 7.6).
- **Fix:** `bmad-create-epics-and-stories`.

### 6. Decisions and numbers that nothing records

Fixes are `bmad-architecture` or `bmad-create-epics-and-stories` as noted.

- **Provider rates, token caps and terms** (RD:61, RD:63; needed for the $1 operation calculator at `:1860`). The Brave plan and Anthropic retention arrangement are not recorded. Unknown terms only block enablement. [audit] (`bmad-architecture`)
- **Provider tiers.** RD:89 says "smallest paid tiers" with no plan named. A Supabase plan upgrade is an "Ask First" item with no recorded approval (`implementation-artifacts/spec-mock-first-vercel-supabase-deployment.md:25`). Railway and Upstash are unprovisioned, but 2.7, 4.2, 6.9 and Epic 8 need them. [audit] (`bmad-architecture`)
- **One cloud Supabase project serves local and deployed use** (`docs/auth-setup.md:6-12`, `.env.local`), against AD-19 (Spine:160). `docs/deployment-setup.md:3` says they are separate. [audit] (`bmad-architecture`)
- **G-5 devices.** RD:53 calls them "test targets, not claims of owned hardware". No record says who has the four devices. `:3498` bars emulation, so 4.6, 8.5 and 8.6 cannot be completed. [audit] (`bmad-correct-course`)
- **Missing numbers and providers** [audit] (`bmad-create-epics-and-stories`):
  - registration rate limit (`:80`, `:1500`);
  - upload quota, image count, size and format, and lease durations (`:657`, `:1721`, `:1723`);
  - the clarity, obstruction and coverage algorithm and thresholds (`:1739`);
  - recovery email and push providers (`:1590`, `:3284`);
  - shipped UI locales (`:510`);
  - the offline bundle host (`:669` against `:657`);
  - "short-lived" link TTL, fresh-auth window and the "nearly reached" threshold.
- **Licence and attribution are lost at export.** R-7 (RD:71) and 3.1 AC-2 (`:2055`) capture CC-BY attribution, but the provenance Evidence group (Spine:195; `:632`) and the 6.6 and 6.7 ACs have no such field. [audit] (`bmad-create-epics-and-stories`)
- **Orphaned security rule.** Spine:171 requires origin and CSRF checks on cookie mutations. No AR item or story carries it. [audit] (add to AR-3 and Story 1.4)
- **G-7 and G-1.** If the edition rights check fails there is no alternate edition, so 3.1 AC-1 (`:2049`) fails. The G-1 corpus approver is unrecorded (REPORT.md:28). [audit]
- **Unrecorded engineering defaults** [audit]: tessellation tolerance (R-2 needs ≤0.01 mm), print scale and orientation defaults, physical units for direct-mode meshes, the personalization envelope (kinds, fonts, placement), and the operation receipt's pinned API version and model identity (RD:63).

### 7. Mapped as covered but no acceptance criterion [audit]

- FR-4 "completion settles, cancellation releases" (prd.md:125) appears only in 2.8's ambiguous-charge paths (`:1939-1947`).
- FR-6 user cancel (prd.md:142; UX-DR40, `:977`) has fencing only (`:1891`).
- FR-14 declining paid escalation (prd.md:224) has no AC. Successor Cached Research Revision creation or adoption (prd.md:227-228) is also uncovered. Check 3.6 and 3.7 (`:2233`, `:2271`).
- PRD D-3, an auditable verification procedure before deletion work begins (prd.md:498), is mapped nowhere.
- FR-30 "no invited Account, so self-deletion equals close-instance" (prd.md:410): 8.2 AC-2 covers only the blocked case.
- Offline conflict-selection, locked-store and preparation screens are not in the 53-surface inventory. H-02 (SCREEN-INVENTORY:29) has no "conflict" state and the inventory predates R-8. 7.2, 7.4 and 7.5 need them.
- SC-3 and UX-DR2 to UX-DR4 map only to 1.2, 4.6 and 8.5 (`:1220`, `:1266-1268`). No phone AC exists for 3.4, 3.5, 5.5 or the Epic 6 stories. UX-DR29 states map only to 1.7 (`:1293`).
- Orphan on the backward trace: "secrets" in 8.2 AC-3 (`:3382`) is not in FR-30 (prd.md:409).

### 8. Story 1.1 against the built shell [audit]

- AC-1: Three 0.186.0 is absent (`:575`), and `bmad-method` is a runtime dependency (`package.json:23`). `engines` is `>=20.12.0` (`package.json:7`), not the Node 24.21.0 AR-1 requires, although CI and the local machine use Node 24. `build` uses `--webpack` (`package.json:12`); the qualification report shows both the default and Webpack builders passing (`qualification-2026-09-14/stack/qualification-report.md:63-70`), but the choice is not recorded as a decision. [verified]
- AC-2: `scripts/check-env.mjs` is not run at build or startup. CI runs only `scripts/test-env.mjs`, which tests the checker (`.github/workflows/ci.yml:33-34`). It checks APP_ENV labels, not an immutable environment ID (Spine:179). [verified]
- AC-3: a full mock dashboard contradicts "empty application", and the code is not in `apps/web` or `packages/*`.
- Story 1.4: there are no tables, RLS, session grants or epochs. A "live Account" is an env var that needs a redeploy to change.
- Story 1.7: project open is a no-op (`components/nova-dashboard.tsx:100`) and there is no Project route. The sidebar is hidden at phone width (`app/globals.css:52`).

### 9. Oversized stories [audit]

All 58 stories have exactly three ACs, but they are dense. 14 have five or more clauses in the "Then" lines, and 11 map 10 or more requirement IDs.
- 7.6: 18 IDs, spanning approval, validation and reconversion.
- 2.7: 12 IDs, covering outbox, signing, worker registry and fencing.
- 8.7: 14 IDs and 9 gates, an umbrella acceptance story.
- 8.5: 53 surfaces across 4 devices.
- Also large: 3.7, 1.2, 3.1 and 6.3.
- 7.1 is a research spike that may end BLOCKED.
- The G-8 limits are proven in both 7.1 AC-1 (`:3064`) and 8.6 AC-1 (`:3522`).

### 10. Housekeeping

- The Supabase restore item looks stale. It remains in `implementation-artifacts/deferred-work.md:9-11`, the unchecked task in `spec-mock-first-vercel-supabase-deployment.md:55`, `docs/deployment-setup.md:9` and `scripts/restore-supabase.mjs`. Commit `1606107` and `spec-google-sign-in.md:17` suggest the project is working. [inferred; Supabase was not contacted]
- The two open deferred items (the print validator, and cross-store deletion crash windows) map to 6.3 (`:2800-2808`) and 8.1 AC-3 (`:3342`) but cite no story. `qualification-2026-09-14/REVIEW-DISPOSITION.md` lines 13, 23, 24, 27 and 29 hold other "remains X" items. [audit]
- The PRD still defers pictures (prd.md:418, 446; addendum.md:37) against SC-1. `scope-and-readiness.md:20` resolves this, but the PRD carries no notice. [audit]
- `CLAUDE-DESIGN-HANDOFF.md:157` says "stop after Round 1", which R-10 (RD:97) supersedes with no notice there. [audit]
- AR-8 pins Python 3.12.14 (`:603`) while Spine:216 and R-1 delegate the patch version. Low. [audit]

## Fix routing

| Finding | Skill | Needs Josh's decision? |
| --- | --- | --- |
| 1 Auth contradiction | `bmad-correct-course` | Yes: confirm Google as the credential and the Administrator bootstrap |
| 2 Free-only research | `bmad-architecture`, then epics | Yes: what free-only does |
| 3 G-8 model/fallback | `bmad-correct-course` | Yes: timebox and fallback scope |
| 4 Story order | `bmad-create-epics-and-stories` | No |
| 5 Unowned deliverables | `bmad-create-epics-and-stories` | No |
| 6 Unrecorded decisions | `bmad-architecture` and `bmad-create-epics-and-stories` | Some: provider tiers (billing), device ownership |
| 7 AC gaps | `bmad-create-epics-and-stories` | No |
| 8 Story 1.1 drift | `bmad-correct-course` (amend epics) | No |
| 9 Oversized stories | `bmad-create-epics-and-stories` | No |
| 10 Housekeeping | manual edits | No |

**Suggested order:** run `bmad-correct-course` first with this file, since findings 1, 3 and 8 are cross-cutting. Then run `bmad-architecture` for 2 and 6, then `bmad-create-epics-and-stories` for 4, 5, 7 and 9. Then re-run `bmad-sprint-planning`.
