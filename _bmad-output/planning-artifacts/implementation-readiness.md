# nova3D Implementation Readiness: FAIL

**Date:** 2026-10-07 · **Skill:** `bmad-sprint-planning` (readiness gate) · **Requested by:** Josh

**Question tested:** could a developer implement these epics without inventing decisions nothing records?

**Verdict: FAIL.** The plan is not implementable as recorded. `sprint-status.yaml` was not generated. Re-run `bmad-sprint-planning` after the fixes below.

The FAIL comes from missing recorded decisions, missing fallbacks, and stories in the wrong order. It does not come from G-1 to G-9 being open. The plan states that implementation and qualification may proceed while those gates are open (`specs/spec-nova3D/scope-and-readiness.md:85`).

**Resolution status (2026-10-07):** findings 1, 3 and 8 are addressed by `sprint-change-proposal-2026-10-07.md`, approved and applied to `epics.md`, the Spine, R-8, the UX inventory, `scope-and-readiness.md` and the five affected story specs. **Update (2026-10-08):** finding 2 and the architecture-owned items of finding 6 are resolved in the Spine and R-2/R-5/R-6/R-9 (architecture update run; reviews in `architecture/architecture-nova3D-2026-09-14/reviews/`). The change was propagated to `epics.md` and 20 story specs on 2026-10-08 (scripted parity check: 58/58 stories, 457/457 source lines, manifest 307/307; the full multi-agent validation was not re-run). Placements of newly required work are provisional and listed in the `epics.md` Planning Assumptions. **Update (2026-10-08, epics update):** findings 4, 5, 7 and 9 and the epics-owned items of finding 6 are resolved in `epics.md` and the derived artifacts: 9 stories were added (1.8, 1.9, 2.11, 2.12, 2.13, 4.7, 6.10, 7.8, 8.8), the build order changed and 49 existing stories were edited; 67 stories now carry 120 scope clauses and 211 acceptance criteria. The nine new stories have only a scripted parity check, not the independent review the original 58 received. Finding 10 housekeeping was also addressed (PRD and addendum scope notices, design-handoff supersession note, deferred-work story citations and Supabase restore status, AR-8 Python wording); the Supabase restore status remains unverified. Open: Josh's remaining decisions (phone and Safari device coverage, Vercel plan, Anthropic org key, Brave terms) and the missing independent review of the nine new stories. Answered 2026-10-08: Administrator is heimannshua@gmail.com, no sending domain (recovery mails through the Resend test sender), cloud sign-ups are on, and only the Windows laptop is available for G-5. Still open: how to cover phone/Safari qualification, Vercel plan, Anthropic org key, Brave terms. The gate verdict stays FAIL until they are resolved and sprint planning is re-run.

**Re-run 2026-10-08 (after the fixes above): still FAIL.** Four independent audits found four critical and about ten high problems; several were introduced by the 2026-10-08 restructure. They are listed in the last section, "Re-run 2026-10-08". The findings above are kept as history.

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

## Re-run 2026-10-08

**Verdict: FAIL.** Four fresh-eyes audits (new stories, dependency order, traceability, unrecorded decisions and conflicts) were told not to read this file or the resolution notes. Mechanical checks are clean: 67 stories, 120 scope bullets, 211 acceptance criteria, 506 requirement occurrences, coverage maps matching the Requirements lines, dependencies identical across `epics.md`, the index and the story inputs, no cycles in the declared graph, every dependency preceding its story. The problems are in what the stories need to exist, not in the bookkeeping. `sprint-status.yaml` was not generated.

Tags: [verified] means the auditor re-read the cited text; [inferred] means judgment. Line numbers are in `epics.md`. **(new)** marks a problem introduced by the 2026-10-08 restructure.

### Critical

**R1. Four stories cannot pass their own acceptance criteria with their listed dependencies [verified].**
- **6.1 and 6.10 are circular in substance (new).** 6.1 takes the default print scale from the bounding box of "the oriented manufacturing mesh" (L3024). 6.10 builds that mesh at 6.1's scale (L3062) and depends on 6.1. No story creates the validation lineage record that stores the scale (Spine AD-8); 6.5 only "owns" it (L3215). Both stories also own the never-rescale rule.
- **1.3 uses a step-up that 1.4 creates.** 1.3 needs fresh-authenticated invitation issuance and audit (L1481, L1504). Step-up and markers are defined in 1.4 (L1522), which depends on 1.3.
- **6.8 AC-2 "package download works" (L3345)** needs the gateway of 6.9, which depends on 6.8.
- **8.3's backup lifecycle, post-restore scrub, monthly canary and AC-2 (L3800, L3812)** need the backup service and restore built in 8.4, which depends on 8.3.
- Fix: `bmad-create-epics-and-stories` (re-cut these seams; for 6.1/6.10 take the scale from the canonical solid's bounding box or move the lineage record into its own earlier story).

**R2. The file gateway is built after the stories that need it [verified].** AD-13 and AR-19 route large transfers through the Railway gateway because of Vercel's 4.5 MB body limit. It first appears in 6.9 (L3369), but 2.2 accepts 12 MiB images and 60 MiB requests (L1813), and 2.12, 4.6 and 4.7 serve or retain large files. Fix: `bmad-create-epics-and-stories` (move the gateway to an early story).

**R3. Story 7.8 has no execution venue [verified].** The reconversion commits a "successor Job/outbox" (L3649-51), but the direct engine runs only in the browser with no cloud fallback (7.1 AC-3, 7.3 AC-3). An online worker path is the undecided G-8 checkpoint option (L4025). The engine port has no input for print constraints, and nothing retains pictures for models created offline. The old 7.6 AC-2 had the same gap. Fix: a decision from Josh, then `bmad-create-epics-and-stories`.

**R4. Binding money and authorization rules have no acceptance criterion [verified].**
- Permission for one category or Project must not authorize another, and is re-matched at every operation (PRD:126, AD-11). It is mapped to 2.5, whose ACs do not test it.
- Authorization fails closed on infrastructure outage (Spine AD-19, AR-26).
- Service-key rotation and compromise revocation (Spine L177, AR-15): 2.7 AC-3 tests only expiry and skew.
- Fix: `bmad-create-epics-and-stories`.

### High

**R5. Story 2.13 is contradictory (new) [verified].** Vision permission is offered only after scope confirmation (2.5 AC-1, 2.9, UX-DR8), but 2.13 needs it before the confirmed subject is recorded. The request revision is immutable, so recording the subject means a successor revision. The identification call has no parent research Job for the $5 cap. "Registered domain package" has no owner before Epics 3 and 4. 2.13 does not depend on 2.9, and 3.1 does not depend on 2.13, so "no research starts" is unenforced. Its UX-DR34 is the wrong requirement (UX-DR36 fits), and FR-4, AR-7, AR-14, AR-16 and NFR-9 are missing.

**R6. Story 1.9 (new) [verified].** AC-3 tests an in-flight registration for a different identity, not the purge-versus-registration race on the same identity. It silently amends 1.3 (row lock, persisted attempt time). It says "create the staging project" while 1.1 says the existing project becomes staging, and 1.6 needs staging before 1.9 exists. The existing project looks Free and paused against R-9's Pro, with no upgrade story. AC-4 has no interval or alarm channel. Nothing deploys a staging app or Google OAuth client for QStash to call. AR-18 is missing from its requirements.

**R7. External accounts and provisioning have no owner [verified].** Three Google OAuth clients and their consent-screen status, the Anthropic and Brave accounts and spend backstops, where the Brave terms review is recorded, the Resend key, the Vercel plan, the VAPID keys and the Before User Created hook appear in no story.

**R8. Records and formats nothing defines [verified].** The environment identifier (format, table, value; `check-env.mjs` checks labels only); the store for the registration rate limiter (1.3 needs it before Upstash exists); the validation lineage record; the domain-package registry; the money constants (per-image maximum, margin, bytes-to-token rule) and the reviewer of an overrun incident; the intake clarification mechanism of 2.1 and the subject mapping of 2.13, both needed before any paid permission is possible.

**R9. Backup and restore gaps [verified].** Restoring a state that reverts disables, invitation consumption and recovery revocations is in 8.4 scope only; its ACs test deletion replay only (L3843-3859). Encryption-key custody, alarm routing and owner, and the B2 region are unrecorded. The canary, abort rule and alarm have no ACs. Backups are "daily" in RD:95 and AR-21 but every 12 hours elsewhere.

**R10. Stories needing things from later epics [verified].** 3.6 AC-3 needs private associations deleted (deletion commands are 8.1 to 8.3). 4.3, 4.4 and 5.2 need the print frame and profile from 6.1. 4.1 AC-3, 4.6 AC-4, 5.4 AC-3 and 5.5 AC-3 describe consumers that come later without saying fixture. 4.7 has no trigger (4.2, 4.4, 5.2 and 6.4 never mention it) and 7.3 has no on-device GLB path. 2.11, 2.7 and 2.10 omit 1.7 and 1.8 from their declared closures.

**R11. Rules mapped to a story but verified by no criterion [verified unless noted].** The free-mode completeness gate (seeded-omission fixture plus an independent pass); a Research Plan reject path (FR-13, UX-DR48); notification producers in Epics 3 to 6 (FR-7); FR-3 "disable cancels active Jobs" and audit events for limit changes; the 8.2 step-up rules (marker consumed by use, step-up after the confirmation is shown) and the action class for Project/Export deletion; direct-mode provenance, PDF and repair (7.6 has two ACs); failed print constraints as input in 6.5; offline local intake (Spine AD-16: local images, camera, coverage checks, stable UUIDs, service-worker scope) which no story scopes [inferred]; AR-3 same-ID-different-payload rejection.

**R12. Device and phone parity wording.** 8.5 AC-1's When clause (L3884) still lists macOS, iOS and Android though 8.5 is Windows-only (new). 8.8 has no completion rule if devices are never procured, which blocks 8.6 and 8.7. The Then clauses of 8.5 and 8.8 AC-1 say only "recorded", with no pass criterion. 11 stories (2.1, 2.3, 2.9, 2.10, 2.13, 3.3, 3.7, 4.5, 5.1, 5.3, 5.4) have no phone clause. 8.7 AC-3 cannot pass while G-8 is BLOCKED.

### Medium

- Fresh authentication, tombstones, deletion and the scheduler reach back into earlier stories: the 1.3 allowlist gate is removed only in 1.4; 1.2 AC-2 persists Account preferences before Accounts exist; the 1.9 scheduler is not in the closure of 2.2, 2.6 or 2.12 though lease expiry and the 24-hour deadline need it.
- 2.11 has an unused dependency on 2.4 and undefined "potentially chargeable" and "reconciled"; 2.12 and 4.1 both define the manifest fields; 2.12 omits AR-2 and AR-5.
- 7.3 and 7.6 under-specify image-derived models (no canonical solid, no capture record for the real-world dimension); 7.7 push needs a service worker no story owns.
- 7.2's public bucket conflicts with "private buckets" in the Spine; FR-8 "wider internet" conflicts with free mode having no open web (override missing from scope-and-readiness.md).
- A user-chosen scale as a "new validation identity" may rearm the single regeneration slot (R-11).
- Unrecorded numbers: lease TTL, outbox relay, fetch limits, task intervals, EXIF handling, retained-picture quota. Free-tier fit is unproven (Vercel body limit, Hobby terms, QStash quota, Railway's $5 across worker, gateway and backup) [inferred].
- Repo versus Story 1.1: `scripts/restore-supabase.mjs` is required by `check-repository.mjs`; the LAN redirect in `docs/auth-setup.md`; an exact Node pin conflicts with Vercel-managed patches; 1.4's removal list omits `.env*.example`, `test-env.mjs` and `lib/auth.ts`.
- Numeric defaults in ACs (2.2 limits, 2.3 thresholds, 2.4 80%, 1.3 limits) trace only to an [ASSUMPTION] in the architecture memlog, not to the Spine or Ratified Decisions.

### What is sound

Invitation races (1.3), live authorization and step-up binding (1.4), recovery (1.6), atomic reservation and calculator (2.6), ambiguous charges (2.8), fencing (2.7 AC-3), source-policy epochs (3.2), cache admission (3.6), equivalence comparator and corpus (4.3), repair classes (6.4), the shared lineage slot (6.5/7.8), chunk-level revocation (6.9), learned offline revocation (7.5), the tombstone contract (1.8, 8.1). Fixtures are labelled where earlier stories look ahead (1.5, 2.4, 2.9, 2.10, 3.2, 4.4, 5.3, 5.4). The 7.1 BLOCKED-report rule is explicit. The splits 2.11/2.7, 7.8/7.6 and 8.8/8.5 moved acceptance criteria cleanly, apart from stale wording. Epic 2 still delivers no standalone value, only intake, settings and a test workload, and deletion arrives only in Epic 8; both are design choices, not defects.

### Fix routing

| Finding | Skill | Needs Josh? |
| --- | --- | --- |
| R1 seams, R2 gateway placement, R4, R10, R11, R12 | `bmad-create-epics-and-stories` (update) | No, except the device rule in R12 |
| R3 reconversion venue | decision, then `bmad-create-epics-and-stories` | Yes: where reconversion runs |
| R5, R6 | `bmad-create-epics-and-stories` | No |
| R7 provisioning ownership | `bmad-create-epics-and-stories`, tasks that only Josh can do | Yes: the accounts are his |
| R8 formats and records, R9 key custody and alarm routing | `bmad-architecture` (small update), then epics | Some: alarm owner, key custody |

**Process lesson:** the nine stories added on 2026-10-08 went in with only a scripted parity check, and the independent review found five problems in them (R1 first item, R5, R6, R12 first item, parts of R10). New stories need independent review before they are propagated.
