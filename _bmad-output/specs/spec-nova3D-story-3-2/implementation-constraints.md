# Implementation Constraints

Read the [project SPEC](../spec-nova3D/SPEC.md) and every companion it names recursively. Implement only this story's declared slice. Mapped requirements constrain the touched behavior; their other slices remain assigned to the other stories.

## Governing Interpretation

Ratified R-1–R-11 and approved SC-1–SC-7 override conflicting older PRD wording. Whole-plan approval and deterministic recipe equivalence apply to evidence_text/evidence_images. Direct image work uses confirmed ordered images/scope and acknowledged uncertainty, with honest inference provenance and restorable snapshots; it has no synthetic Research Plan or identical-reinference guarantee. Exact-model approval and required profile checks gate qualified export in every mode.

Prepared offline work follows the adopted no-lease/reconnect policy: learned disable locks until newer authoritative re-enable, learned tombstones purge before import, and network uncertainty alone is not deletion. R-11 permits one atomically consumed full fallback slot per lineage. The parent contract supplies every detailed authority, money, geometry, lifecycle and UX invariant.

## Mapped Requirements

### FR-9

#### FR-9: Source authority policy

nova3D distinguishes research leads from evidence used in recommendations.

**Consequences:**
- Low-authority pages may be used as leads only.
- Recommendations identify and cite primary texts, recognized commentaries, books, archaeological evidence, or work by named scholars.
- Sources retain identity and enough location context for the user to inspect the support for a Claim.
- Changed Source content creates a successor Source and Cached Research Revision; it cannot silently alter an existing Claim or approved Research Plan.
- Only Claims and provenance reproducible from identified non-private Sources qualify for admission to shared cached research.

Source: PRD §4, FR-9.

Source: `_bmad-output/planning-artifacts/epics.md`, line 180 in the captured input.

### FR-14

#### FR-14: Research mode and paid escalation

The user can choose per Project whether research may use paid services or must remain free-only.

**Consequences:**
- nova3D cannot start paid research without explicit user permission.
- Paid research is also subject to the Account's Usage Limit.
- If free-only research cannot resolve complete Consequential Detail coverage, nova3D shows the remaining gaps and asks whether to switch the Project to paid research.
- Declining paid escalation leaves the Project unready for Plan Approval while blocking gaps remain.
- Before research begins, the user separately chooses whether to reuse available cached research or research the subject again from scratch.
- Cached results show their original research date, immutable revision identity, and cached status; nova3D does not automatically re-verify them.
- A correction creates a new Cached Research Revision linked to its predecessor; it never changes an existing revision in place.
- An approved Project remains pinned to the revision it used. Adopting a successor revision creates a new Research Plan version and requires renewed Plan Approval before regeneration.
- Paid research also follows the Paid Work permission, disclosure, Usage Limit, and reservation rules in FR-4.

Source: PRD §4, FR-14.

Source: `_bmad-output/planning-artifacts/epics.md`, line 243 in the captured input.

### AR-6

**AR-6: Complete and eligible research.** Use the Middot package's finite checklist for shape, dimensions, materials, placement, printability and interpretation; require an independent omission review with no unresolved gap. Middot chapter 3 governs spatial reconstruction; low-authority pages remain leads. Project exclusions and Account toggles target stable source identities, increment effective policy epochs and invalidate/recheck affected active conclusions. Pin the Account-policy revision, Project-exclusion revision and explicit source set in attempts, private cache-adoption records and plan digests. Filtering is deterministic for those inputs; active changes create a successor draft and rerun affected conclusions and completeness before approval. Approved records stay immutable.

Source: AD-5; evidence-policy identity.

Source: `_bmad-output/planning-artifacts/epics.md`, line 595 in the captured input.

### AR-20

**AR-20: Source editions and public-cache admission.** Initial editions are Sefaria Middot 3 Hebrew Torat Emet 357 and English Mishnah Yomit by Joshua Kulp. Capture exact edition metadata, attribution, URL, license and examined passage/digest before body retention. Allow only verified Public Domain/CC0/CC-BY with attribution; ambiguous/restricted sources retain metadata/digest and cannot support approved claims without inspectable authorized evidence. Public cache admits dedicated source-reproducible allowlisted records, never serialized plans or private IDs/prompts/uploads/personalization/decisions/geometry. Explicit reuse preserves immutable original dates; fresh research cannot substitute cached conclusions; adoption associations remain private/deletable.

Source: AD-14; R-7; G-7.

Source: `_bmad-output/planning-artifacts/epics.md`, line 661 in the captured input.

### SC-6

##### SC-6: Source exclusion controls

- **Do not use this Source** affects only the current Project. Research continues, invalidated Claims and decisions are visibly rechecked, and nova3D seeks replacement evidence.
- **Disabled Sources** in Account Settings uses a simple on/off control across Projects.
- Switching a Source off during active research removes it from that Job and triggers replacement research.
- Completed approved Projects never mutate. They normally show a warning if they used a now-disabled Source; Settings may hide that warning, but provenance and the Source Record remain unchanged.

Source: UX-SCOPE-CHANGES SC-6; canonical ux-contract; applicable ratified decisions.

Source: `_bmad-output/planning-artifacts/epics.md`, line 522 in the captured input.

### UX-DR12

**UX-DR12: Project exclusion versus Account source policy.** Do not use this Source affects only the current Project; Account Disabled Sources uses per-source on/off controls across Projects. Active changes visibly invalidate/recheck claims and continue replacement research. Completed approvals never mutate; now-disabled warnings can be hidden without altering provenance/export. Project interpretation corrections require a successor plan and renewed approval.

Source: SC-6; UX-3.

Source: `_bmad-output/planning-artifacts/epics.md`, line 823 in the captured input.

### UX-DR43

**UX-DR43: Reject current-Project Source (J-05).** **Do not use this Source**, explain effects, continue replacement research.

Required states/variants: Confirmation, affected Claims rechecking, replacement found/not found.

Source: SCREEN-INVENTORY J-05; canonical ux-contract; applicable ratified decisions.

Source: `_bmad-output/planning-artifacts/epics.md`, line 991 in the captured input.

### UX-DR66

**UX-DR66: Disabled Sources (S-03).** Account-wide Source on/off list with provenance-safe history.

Required states/variants: Enabled, disabled, search/list empty, active Job affected, re-enabled.

Source: SCREEN-INVENTORY S-03; canonical ux-contract; applicable ratified decisions.

Source: `_bmad-output/planning-artifacts/epics.md`, line 1129 in the captured input.

### UX-DR67

**UX-DR67: Disabled-Source warning setting (S-04).** Show or hide warning on completed Projects without changing provenance or Source Record.

Required states/variants: On by default, off, explanatory confirmation.

Source: SCREEN-INVENTORY S-04; canonical ux-contract; applicable ratified decisions.

Source: `_bmad-output/planning-artifacts/epics.md`, line 1135 in the captured input.

## Planning Assumptions

- Story boundaries and the proposed order are delegated fast-path planning choices inferred from ratified requirements, not separately claimed user approvals.
- Evidence-backed generation and export can be implemented without waiting for the direct reconstruction engine; full first-version release still requires both picture modes and qualified offline/device behavior.
- Each story creates only the records and interfaces needed by its slice; later features inherit live authorization, immutable provenance, money, lifecycle and accessible UI contracts.
- Per-story specs have local stable CAP IDs and adopt the unchanged project-wide contract. No implementation dispatch, spec_checkpoint or done_checkpoint defaults are set in this planning run.
- Exact compatible patches, deployed resources, licensed font files and reconstruction weights remain delegated selections within adopted limits; missing qualifying evidence is engineering work, not a newly invented product question.

## Qualification Snapshot — September 14, 2026

| Gate | Recorded status |
| --- | --- |
| G-1 | PARTIAL |
| G-2 | PARTIAL |
| G-3 | PARTIAL |
| G-4 | NOT RUN |
| G-5 | BLOCKED |
| G-6 | PARTIAL |
| G-7 | NOT RUN |
| G-8 | BLOCKED |
| G-9 | PARTIAL |

Only actual qualifying evidence changes these statuses. Creating or validating a story spec does not pass an engineering gate. A missing offline engine or device result remains release-blocking under the adopted scope.
