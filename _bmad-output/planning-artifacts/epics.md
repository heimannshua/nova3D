---
stepsCompleted: [step-01-validate-prerequisites, step-02-design-epics, step-03-create-stories, step-04-final-validation]
currentStep: complete
status: complete
reviewMode: fast-path-delegated
storyBoundaries: inferred-from-ratified-requirements
updated: 2026-09-14
sourceSelectionConfirmed: true
requirementsExtractionComplete: true
requirementsReview: fast-path-delegated
inputDocuments:
  - "_bmad-output/planning-artifacts/prds/prd-nova3D-2026-08-27/prd.md"
  - "_bmad-output/planning-artifacts/prds/prd-nova3D-2026-08-27/addendum.md"
  - "_bmad-output/planning-artifacts/architecture/architecture-nova3D-2026-09-14/ARCHITECTURE-SPINE.md"
  - "_bmad-output/planning-artifacts/architecture/architecture-nova3D-2026-09-14/RATIFIED-DECISIONS.md"
  - "_bmad-output/specs/spec-nova3D/SPEC.md"
  - "_bmad-output/specs/spec-nova3D/scope-and-readiness.md"
  - "_bmad-output/specs/spec-nova3D/ux-contract.md"
  - "_bmad-output/planning-artifacts/ux-designs/ux-nova3D-2026-08-27/DESIGN.md"
  - "_bmad-output/planning-artifacts/ux-designs/ux-nova3D-2026-08-27/EXPERIENCE.md"
  - "_bmad-output/planning-artifacts/ux-designs/ux-nova3D-2026-08-27/SCREEN-INVENTORY.md"
  - "_bmad-output/planning-artifacts/ux-designs/ux-nova3D-2026-08-27/UX-SCOPE-CHANGES.md"
  - "_bmad-output/planning-artifacts/ux-designs/ux-nova3D-2026-08-27/CLAUDE-DESIGN-HANDOFF.md"
  - "_bmad-output/implementation-artifacts/qualification-2026-09-14/REPORT.md"
requirementCounts:
  functional: 30
  approvedScopeChanges: 7
  nonFunctional: 12
  architecture: 28
  uxDesign: 73
  uxSurfaces: 53
  canonicalCapabilities: 17
  engineeringGates: 9
---

# nova3D - Epic Breakdown

## Overview

This document provides nova3D's epic and story breakdown from the confirmed PRD, architecture, canonical spec, UX contract and qualification evidence.

**Current stage: 8 epics and 58 stories specified and validated.** Josh requested bmad-spec for each story using Codex agents running Luna. His fast-path direction is carried forward for decomposition and review. Story boundaries and dependency order are delegated planning choices, not newly claimed user approvals; all adopted product requirements remain binding. No source requirement, spec or local probe is treated as completed application functionality.

#### Inputs and authority

Josh confirmed the 13 documents listed in frontmatter. Paths there resolve from the repository root. They include the ratified PRD/addendum; architecture spine/decisions; SPEC and its scope/readiness and UX companions; the complete UX handoff, scope changes and screen inventory; and the September 14 qualification report.

Explicit user decisions, approved SC-1–SC-7 and ratified R-1–R-11 govern scope. The canonical spec/companions carry their overrides; remaining PRD consequences, definitions and metrics apply. Architecture AD-1–AD-19 govern implementation. PRD:AD-n identifies the older PRD decision register; AD-n identifies architecture decisions; screen AD-01 etc. identify administrative surfaces.

DESIGN.md and EXPERIENCE.md contain metadata only. Their inclusion preserves the discovered UX source pair, while the canonical UX contract, screen inventory and handoff supply substantive requirements. R-10 supersedes the old mandatory external-design-tool and alternative-direction approval ceremony; detailed visual layouts/tokens still need implementation and verification.

#### Binding scope and mode rules

- The first evidence-backed fixture is the outer altar/ramp from Middot chapter 3 plus clearly user-added personalization. Both direct and research-assisted picture paths, complete phone/computer operation and prepared offline direct conversion are first-version requirements.
- Immutable evidence_text and evidence_images modes require complete whole-plan approval before canonical evidence-backed generation. image_direct uses confirmed scope, ordered images and acknowledged uncertainty with honest image/inference provenance. It has no synthetic Research Plan.
- Exact-model approval and passing required checks for the exact print profile gate every qualified export. Direct-image qualified export is online. Preview geometry never becomes manufacturing authority.
- Evidence recipes must satisfy R-2 deterministic equivalence. Direct inference preserves immutable input/activity/output identities and restorable snapshots without claiming historical verification or identical re-inference.
- One constrained full fallback is bound to the validation lineage in both modes; retries, cancellation, failure and successor jobs cannot reset it. Direct reconversion uses pinned original images/scope/engine under R-11.
- Offline access has no disconnected time lease. Server revocation is immediate; learned disable locks until a newer authoritative re-enable, and learned tombstones purge before sync. Network uncertainty is not deletion. Disconnected/downloaded copies are outside controlled-backup erasure promises.
- Complete Temple/utensils, printer control/fleets, other research domains and commerce remain later work. Manual mesh editing, public registration, shared Workspaces, billing/storefront/marketplace are not implied. Printing status is an inactive Coming later placeholder.
- Ratification is complete; engineering qualification remains open. Story/spec drafting does not reopen adopted defaults or certify engineering gates.

Source links: [PRD](prds/prd-nova3D-2026-08-27/prd.md), [addendum](prds/prd-nova3D-2026-08-27/addendum.md), [architecture](architecture/architecture-nova3D-2026-09-14/ARCHITECTURE-SPINE.md), [ratified decisions](architecture/architecture-nova3D-2026-09-14/RATIFIED-DECISIONS.md), [SPEC](../specs/spec-nova3D/SPEC.md), [scope/readiness](../specs/spec-nova3D/scope-and-readiness.md), [UX contract](../specs/spec-nova3D/ux-contract.md), [screen inventory](ux-designs/ux-nova3D-2026-08-27/SCREEN-INVENTORY.md), [scope changes](ux-designs/ux-nova3D-2026-08-27/UX-SCOPE-CHANGES.md), [design handoff](ux-designs/ux-nova3D-2026-08-27/CLAUDE-DESIGN-HANDOFF.md), [qualification](../implementation-artifacts/qualification-2026-09-14/REPORT.md).

## Requirements Inventory

### Functional Requirements

Original PRD identities, wording and all Consequences are retained below. The explicit ratified notes and workflow-mode rules govern any older universal wording. SC-1–SC-7 follow as additional approved functional scope; they are not deferred because they lack an original FR number.

#### FR-1: Controlled account creation

The Administrator can issue and revoke Invitation Codes, and a new user can create an Account only by supplying a valid code.

**Consequences:**
- Public registration is unavailable.
- Each named invitation receives a different single-use code.
- The Administrator can also share one current general code; successful use immediately invalidates it and generates a different current code.
- Unused codes remain valid until successful use or Administrator revocation; they do not expire solely with time.
- Registration attempts are rate-limited to resist code guessing.
- Changing or revoking Invitation Codes does not invalidate existing Accounts.

Source: PRD §4, FR-1.

#### FR-2: Authentication and workspace isolation

An Account can authenticate and access only its own Workspace.

**Consequences:**
- Cross-Account access to Projects, Sources, decisions, Models, Versions, Jobs, Exports, and Notifications is denied.
- Administrative usage controls do not expose ordinary Project content.
- The Administrator cannot impersonate an Account, browse its private Workspace, or assign additional administrative privileges through the app.

Source: PRD §4, FR-2.

#### FR-3: Account administration

The Administrator can view Account status and disable or re-enable an invited Account.

**Consequences:**
- Disabling an Account immediately revokes every active session and download authorization.
- A disabled Account cannot authenticate, access its Workspace, or start operations or paid steps.
- Disabling safely cancels active Jobs and rejects any late result so it cannot mutate Workspace or cache state.
- Disabling an Account does not delete its Workspace.
- Administrative capabilities are limited to issuing and revoking Invitation Codes, viewing account status and usage, setting Usage Limits, and disabling or re-enabling Accounts.
- Invitation, Usage Limit, disable, re-enable, and recovery actions require fresh Administrator authentication and create immutable security audit events.
- The unique Administrator can recover access only through a single-use, short-lived link sent to the Administrator's verified email address.
- Successful Administrator recovery revokes all existing Administrator sessions and creates an immutable recovery audit event.

Source: PRD §4, FR-3.

**Ratified application:** R-8 / AR-23 governs already-local disconnected data: server access is revoked immediately, while a disconnected device learns disable/deletion on contact. A learned disable cannot be bypassed by returning offline.

#### FR-4: Usage visibility and limits

The Administrator can view per-Account paid usage or spending and configure a Usage Limit.

**Consequences:**
- Reaching a Usage Limit blocks new paid Jobs with an explanation.
- Already-running Jobs are allowed to finish.
- The Administrator can raise or reset the Usage Limit.
- Before a paid Job starts, nova3D atomically reserves its maximum estimated cost against settled usage and all outstanding reservations.
- A Job cannot start when the available allowance cannot cover its reservation.
- Duplicate submissions cannot create duplicate reservations, Jobs, or charges.
- Completion or cancellation settles actual usage and releases unused reserved allowance.
- Paid permission applies by category across all Paid Work. Before the first paid operation in a category, nova3D identifies the category, provider, purpose, and declared maximum charge and obtains permission for that Project.
- Permission for one paid category does not authorize another category; every category remains subject to the Account's Usage Limit and atomic reservation rules.
- Before an outside provider receives Project data, nova3D identifies the provider, the minimum data categories to be sent, and known retention or deletion limitations.
- Outbound data is limited to content from the current Project that is necessary for the operation; credentials, unrelated Workspace content, and Personalization not approved for that operation are prohibited.

Source: PRD §4, FR-4.

#### FR-5: Natural-language project intake

An Account can start a Project by describing the desired model in ordinary language without finding or uploading source texts.

**Consequences:**
- If the request permits materially different subjects, periods, scopes, or outcomes, nova3D asks clarifying questions before starting paid research.
- The user sees and confirms nova3D's understanding of the Project scope.

Source: PRD §4, FR-5.

**Ratified application:** SC-1 also requires ordered multi-view picture intake and the two explicit picture modes; natural-language intake does not defer them.

#### FR-6: Concurrent background jobs

An Account can use other Projects while multiple research or generation Jobs run independently.

**Consequences:**
- Each Job exposes waiting, running, completed, failed, and cancelled states.
- Project data and results cannot leak between concurrent Jobs.
- The user can cancel a Job without damaging previously approved data or Versions.
- Failed Jobs do not retry automatically; they preserve the last approved state, explain the known cause in beginner-friendly language, and wait for a user retry decision.

Source: PRD §4, FR-6.

#### FR-7: Actionable notifications

The app displays an app-wide Notification bar for Jobs and approval events.

**Consequences:**
- Notifications cover research readiness, generation completion or failure, Export readiness, and later printer events.
- Selecting a Notification opens the exact Project, approval item, failed Job, Export, or later printer event requiring attention.

Source: PRD §4, FR-7.

**Ratified application:** SC-5 adds first-version phone push for research, generation, validation and Export. Printing events remain inactive until later printer integration.

#### FR-8: Subject and source discovery

nova3D can identify the confirmed subject and locate relevant Sources without requiring the user to supply them.

**Consequences:**
- For the altar-and-ramp milestone, Mishnah tractate Middot chapter 3 is the governing spatial Source. Supplementary Sources and any resulting inferences are labelled as such.
- Claims retain the exact Source edition or revision, passage or location, retrieval date, and a captured excerpt or content digest for the content examined.
- Research may search the wider internet.

Source: PRD §4, FR-8.

#### FR-9: Source authority policy

nova3D distinguishes research leads from evidence used in recommendations.

**Consequences:**
- Low-authority pages may be used as leads only.
- Recommendations identify and cite primary texts, recognized commentaries, books, archaeological evidence, or work by named scholars.
- Sources retain identity and enough location context for the user to inspect the support for a Claim.
- Changed Source content creates a successor Source and Cached Research Revision; it cannot silently alter an existing Claim or approved Research Plan.
- Only Claims and provenance reproducible from identified non-private Sources qualify for admission to shared cached research.

Source: PRD §4, FR-9.

#### FR-10: Complete consequential-detail coverage

nova3D identifies every Consequential Detail needed for the complete requested Model and links it to Claims or an explicit Detail Status.

**Consequences:**
- nova3D builds a finite Project checklist covering shape, dimensions, materials, placement, printability, and historical interpretation.
- A second independent review pass searches the requested scope and Research Plan specifically for missing Consequential Details.
- The Research Plan is not ready for review while any checklist item is unaccounted for or the independent pass has an unresolved gap.
- The user can inspect the completed checklist and gap-review result before Plan Approval.
- No missing detail may be silently invented or presented as historically certain.

Source: PRD §4, FR-10.

#### FR-11: Explainable conclusions and options

For each uncertain Consequential Detail, nova3D presents its recommendation and Defensible Options with transparent reasoning.

**Consequences:**
- The user can inspect supporting Sources, conflicting evidence, the reasoning chain, and expected geometry effects.
- Confidence is explained through evidence and reasoning rather than only an opaque score.
- If evidence cannot settle the detail, the user must choose an option.

Source: PRD §4, FR-11.

#### FR-12: Whole-project review before generation

nova3D presents one complete Research Plan for the requested Model before any Canonical Model is generated.

**Consequences:**
- The review includes proposed choices, rejected or competing alternatives, citations, reasoning, Detail Status, and expected geometry effects.
- The review groups related Consequential Details into evidence packages for each model section while preserving one final whole-Project approval boundary.
- Apparently clear sections are not generated incrementally while other research remains unresolved.

Source: PRD §4, FR-12.

**Ratified application:** Whole-plan completeness and approval govern evidence_text and evidence_images. image_direct uses confirmed scope, ordered images and explicit uncertainty acknowledgment; it never fabricates a Research Plan.

#### FR-13: Version-bound plan approval

The user can approve or reject a specific Research Plan version.

**Consequences:**
- Geometry generation is blocked until Plan Approval exists.
- Plan Approval records the approver, time, selected and rejected options, and affected Consequential Details.
- A change to an approved Research Plan creates a new version and invalidates generation authority until that version is approved.

Source: PRD §4, FR-13.

**Ratified application:** Plan Approval gates only the two evidence modes. Direct conversion has its own immutable confirmed-input/uncertainty gate, followed by exact-model approval and validation for qualified export.

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

#### FR-15: Approved-plan generation

nova3D can generate the complete Canonical Model automatically from the approved Research Plan without manual modelling.

**Consequences:**
- Generation uses only the exact Research Plan version authorized by Plan Approval.
- Generation is blocked if approval is missing, invalidated, or belongs to another version.
- The resulting Model Version records the governing Research Plan, parameters, units, generation activity, and tool or model versions needed to explain its origin.

Source: PRD §4, FR-15.

**Ratified application:** This approved-plan generation contract applies to evidence-backed geometry. Direct conversion uses pinned image/scope/engine provenance and retains the same model-inspection, exact-model approval and print-validation obligations.

#### FR-16: Reproducible canonical model

nova3D preserves a Canonical Model representation from which approved geometry can be regenerated reproducibly.

**Consequences:**
- Identical approved inputs, governing tool versions, and generation settings must produce geometrically equivalent output within a defined tolerance.
- Probabilistic research or drafting output is not itself the Canonical Model.
- Exported print files do not replace or erase the Canonical Model history.

Source: PRD §4, FR-16.

**Ratified application:** Deterministic equivalence applies to evidence-backed recipes under R-2. Direct inference instead preserves exact input/activity/output identities and restorable snapshots; identical re-inference is not promised.

#### FR-17: Plain-language personalization

The user can include or change Personalization through ordinary language, such as adding a name.

**Consequences:**
- Personalization is generated automatically without manual mesh editing.
- Every personalized Model Feature is visibly classified as user-added and cannot inherit evidence-backed status.
- Personalization must participate in inspection, versioning, Model Approval, and print validation.

Source: PRD §4, FR-17.

#### FR-18: Read-only model inspection

The user can inspect a Model Version without manual geometry editing.

**Consequences:**
- Inspection supports rotating, panning, zooming, fitting or resetting the view, selecting standard or section views, hiding or isolating features, and measuring dimensions.
- Preview geometry is identified as a viewing representation and is not presented as proof of printability.

Source: PRD §4, FR-18.

#### FR-19: Feature-level evidence inspection

The user can select a Model Feature and inspect its complete evidence and decision context.

**Consequences:**
- The view includes linked Claims, Sources, Detail Status, supporting and conflicting evidence, reasoning, selected and rejected options, confidence explanation, Plan Approval, and the affected parameters.
- Navigation is bidirectional: a Model Feature reveals its Claims, and a Claim reveals every affected Model Feature.
- Evidence links remain stable through regeneration and Version restoration.

Source: PRD §4, FR-19.

**Ratified application:** For direct-image features expose image/inference provenance and uncertainty, with user-added features distinct. Do not invent historical claims to fill evidence navigation.

#### FR-20: Focused correction request

The user can select a questionable Model Feature and request targeted additional research or correction.

**Consequences:**
- nova3D opens a correction flow scoped to the linked Claims and affected Consequential Details.
- Changed interpretations require a new Research Plan version and Plan Approval before regeneration.

Source: PRD §4, FR-20.

**Ratified application:** Evidence corrections require a successor Research Plan and renewed Plan Approval. Direct-image work preserves honest image provenance; mode changes create successor request revisions rather than retroactive evidence labels.

#### FR-21: Dependency-aware regeneration

nova3D can regenerate every Model Feature affected by an approved correction.

**Consequences:**
- All dependent geometry is rebuilt.
- Unrelated geometry remains geometrically unchanged within the defined reproducibility tolerance.
- The regenerated output is a new Model Version with intact provenance.

Source: PRD §4, FR-21.

**Ratified application:** R-2 equivalence and dependency-closure guarantees apply to evidence recipes. Direct-image changes preserve exact version/snapshot history and do not promise identical re-inference.

#### FR-22: Restorable version history

The user can view, compare, and restore prior Model Versions.

**Consequences:**
- Each Version preserves geometry, parameters, Research Plan, approvals, validations, Personalization, and generation metadata.
- Comparing two Versions shows changed geometry, parameters, Claims, interpretation decisions, Personalization, approvals, and validation results.
- Restoring a Version does not erase later history.
- A restored Version retains its original approval states; the user must grant any approval required for a new Export.

Source: PRD §4, FR-22.

**Ratified application:** Restore mode-appropriate provenance: exact plan/approvals for evidence models; exact inputs, activity, uncertainty and snapshots for direct models. A new qualified export still checks current exact-model approval and validation.

#### FR-23: Version-bound model approval

The user can approve or reject a specific inspected Model Version.

**Consequences:**
- Export is blocked until Model Approval exists for the exact Model Version.
- Geometry or Personalization changes invalidate Model Approval for the changed Version.
- Model Approval records the approver and time.

Source: PRD §4, FR-23.

#### FR-24: Target print profile

Before validation, the user selects the intended printer, material, and physical model size as the Target Print Profile.

**Consequences:**
- The MVP fixture profile is a Bambu Lab A1 mini with its standard 0.4 mm nozzle, gold silk PLA, and a maximum 90 × 90 × 90 mm model envelope.
- Validation results and the Source Record identify the exact Target Print Profile.
- A change to the Target Print Profile requires validation to run again.

Source: PRD §4, FR-24.

#### FR-25: Profile-qualified print validation

nova3D validates the approved Model Version against geometric and Target Print Profile requirements.

**Consequences:**
- Geometric checks include explicit units, closed volume, manifold edges, outward orientation, positive volume, and nondegenerate geometry.
- Profile checks include build envelope, minimum wall or feature size, clearances, material assumptions, and any supported orientation or support constraints.
- Results distinguish passing checks, warnings, blocking failures, and unknowns.
- A passing result is described as validated for the named Target Print Profile, not as a universal guarantee of manufacturability or safety.

Source: PRD §4, FR-25.

**Ratified application:** R-3 / AR-11 makes unsupported or unknown required checks export-blocking; passing a limited synthetic fixture is not acceptance of general printability.

#### FR-26: Immediate automatic repair

When validation finds a fixable blocking failure, nova3D attempts an immediate repair and reruns all affected validation checks.

**Consequences:**
- Every repair records the detected problem, action taken, affected Model Features, and before-and-after result.
- If local repair fails, nova3D proceeds to FR-28 rather than looping indefinitely.

Source: PRD §4, FR-26.

**Ratified application:** R-3 / AR-12 permits only the listed bounded repair classes. A byte change always creates a new artifact; retaining the Model Version requires certified nonconsequential equivalence under R-2.

#### FR-27: Approval after substantive repair

If a repair changes visible geometry, historical dimensions, or Personalization, nova3D creates a new Model Version and requires inspection and Model Approval again.

**Consequences:**
- Export remains blocked until the repaired Version is approved and passes validation.
- Repairs that do not change those properties still remain in the validation audit history.

Source: PRD §4, FR-27.

#### FR-28: Constrained full regeneration

If local repair cannot resolve printability, nova3D performs at most one full regeneration from the approved Research Plan using the Target Print Profile and failed validation constraints.

**Consequences:**
- The original Model Version and evidence chain remain available.
- The regenerated Model is a new Version requiring inspection, Model Approval, and validation.
- If that Version still fails, nova3D stops, explains the remaining problems, preserves every Version, and waits for the user to decide; no further automatic loop occurs.

Source: PRD §4, FR-28.

**Ratified application:** R-11 also allows at most one constrained full direct-image reconversion from the original pinned images/scope/engine and failed print constraints. Both modes atomically share the unresettable lineage slot across retries/children; a new Model Version requires inspection, approval and validation. An incapable engine or failed allowed attempt stops.

#### FR-29: Model and provenance export

The user can download an Export for a Model Version that has Model Approval and a passing validation result.

**Consequences:**
- The Export contains a 3MF file as its primary print-ready model, offers an optional STL compatibility copy, and includes a readable PDF Source Record.
- The Source Record identifies the Project, Research Plan, Consequential Details, Claims, Sources, reasoning, options, approvals, Personalization, Canonical Model identity, Model Version, Target Print Profile, validations, and repairs.
- The PDF uses stable identifiers and cross-references so the user can trace Claims to Model Features and Model Features back to Claims; it is generated from the same immutable structured provenance used by the app.
- The Export remains linked to its Source Record and structured provenance even though the print file may not contain editable parametric history.

Source: PRD §4, FR-29.

**Ratified application:** The immutable export carries mode-appropriate provenance, never a fabricated historical plan for direct images. R-4 defines shared structured provenance plus PDF; R-8 requires connection for qualified export.

#### FR-30: Private Project or Account deletion with non-user-visible research cache

An Account owner can permanently delete individual Projects and Exports or the complete Account and private Workspace after fresh authentication and explicit confirmation.

**Shared deletion guarantees**

- nova3D tombstones and hides the deletion target before cancellation or cleanup begins.
- Deletion cancels affected Jobs and rejects late worker writes and cache promotion so deleted data cannot reappear.
- Active private data is removed promptly. Remaining private copies in operational backups are removed within 30 days.
- Deletion tombstones survive backup restoration and prevent restored private data from becoming active or accessible.
- Any outside provider whose retention cannot satisfy these deletion guarantees must be disclosed before it receives private Project data.

**Project and Export deletion**

- Deletion removes Models, Exports, Personalization, approvals, private prompt wording beyond the normalized research subject, and private Project history from active private storage.

**Permitted shared-cache retention**

- nova3D may retain source-derived Claims and provenance in a shared research cache available to all Accounts.
- A Cached Research Revision may contain only fields reproducible from identified non-private Sources. It cannot contain or reveal Account identity, private prompt wording beyond a normalized research subject, uploaded private material, Personalization, Project decisions, Models, deleted files, or which Account requested a subject.
- Every cached Claim is pinned to immutable Source and Cached Research Revision identities. Corrections create linked successor revisions and cannot silently change evidence already approved by a Project.
- No Account can browse another Account's deleted files or private history through the cache. Reuse cannot recreate a deleted Project or its private decisions.

**Account deletion and instance closure**

- Whole-Account deletion immediately disables access and applies the shared guarantees to every Project, Job, Notification, Export, upload, Personalization item, usage-linked identifier, temporary artifact, and private operational record in that Workspace.
- Only Cached Research Revisions allowed above may remain, and they cannot reveal that the deleted Account requested or used them.
- Because the Administrator role is unique and non-transferable in the MVP, ordinary Administrator self-deletion is blocked while an invited Account exists.
- A separate close-instance action remains available after fresh Administrator authentication and explicit destructive confirmation. It tombstones every Account and Workspace without exposing their contents, revokes all sessions and Invitation Codes, cancels all Jobs, rejects late writes, and applies the shared deletion guarantees.
- When no invited Account remains, Administrator self-deletion performs the same close-instance action.

Source: PRD §4, FR-30.

**Ratified application:** R-9 sets active purge at no more than 24 hours and controlled-backup expiry at no more than 30 days from deletion, with deletion-ledger replay before reopening restored access. R-8 excludes disconnected/downloaded copies from remote erasure promises and requires learned tombstones to purge before sync.

#### Approved scope extensions

These seven approved changes supplement FR-1–FR-30. R-8, R-10 and R-11 resolve the earlier ratification requests; qualification remains engineering work.

##### SC-1: Picture workflows move into the first version

The PRD deferred picture workflows. The first version now includes both:

- **Direct picture-to-model:** labelled image-derived and not historically verified.
- **Research-assisted picture reconstruction:** identifies the subject, researches it, builds a complete Research Plan, and follows Plan Approval before evidence-backed generation.

Picture intake supports existing images, phone camera capture, and multiple images of one subject from different angles. Before conversion, nova3D checks clarity and angle coverage and recommends additional views. The user may choose **Generate anyway** after an explicit warning that incomplete views can cause invented or inaccurate geometry.

Source: UX-SCOPE-CHANGES SC-1; canonical ux-contract; applicable ratified decisions.

##### SC-2: Direct picture conversion works offline

Direct image-derived conversion must work without internet on supported computer and phone devices. Offline-created Projects remain usable locally, show pending or failed sync state, and automatically sync into **My Projects** when connectivity returns without duplication or overwriting a newer Model Version.

Research-assisted reconstruction remains online-only. R-8 adopts on-device limits, preparation and revocation behavior; G-8 still requires a qualifying engine, actual offline/device execution and sync evidence.

Source: UX-SCOPE-CHANGES SC-2; canonical ux-contract; applicable ratified decisions.

##### SC-3: Complete phone workflow

The first version supports the complete workflow on desktop, laptop, and phone. Phone is not a reduced companion: creation, research review, 3D inspection, approvals, validation, and downloads must all work.

Source: UX-SCOPE-CHANGES SC-3; canonical ux-contract; applicable ratified decisions.

##### SC-4: Internationalized interface

The interface supports any configured language, including full right-to-left layout. It initially follows the device language and can be changed in Account Settings. Original Source language, translation, and explanation remain distinguishable; Hebrew and English can appear together in evidence views.

Source: UX-SCOPE-CHANGES SC-4; canonical ux-contract; applicable ratified decisions.

##### SC-5: Phone push notifications

The first version adds phone push notifications for research, generation, validation, Export, and later printing events. Account Settings controls categories. In-app event history remains available when phone alerts are disabled.

Printing notifications remain inactive/Coming later in this version.

Source: UX-SCOPE-CHANGES SC-5; canonical ux-contract; applicable ratified decisions.

##### SC-6: Source exclusion controls

- **Do not use this Source** affects only the current Project. Research continues, invalidated Claims and decisions are visibly rechecked, and nova3D seeks replacement evidence.
- **Disabled Sources** in Account Settings uses a simple on/off control across Projects.
- Switching a Source off during active research removes it from that Job and triggers replacement research.
- Completed approved Projects never mutate. They normally show a warning if they used a now-disabled Source; Settings may hide that warning, but provenance and the Source Record remain unchanged.

Source: UX-SCOPE-CHANGES SC-6; canonical ux-contract; applicable ratified decisions.

##### SC-7: First-version accessibility and preferences

The first version targets WCAG 2.2 AA and supports keyboard operation, screen readers, visible focus, text enlargement, high contrast, non-colour state cues, and reduced motion. Light mode is the default; dark mode is a manual option. Explanations use ordinary language by default, with a Settings option for more technical detail.

R-10 adopts the light neutral/slate/indigo baseline and delegates detailed responsive design without another direction-selection checkpoint or a mandatory external design tool.

Source: UX-SCOPE-CHANGES SC-7; canonical ux-contract; applicable ratified decisions.

### NonFunctional Requirements

**NFR-1: Workspace privacy.** Every user-facing and background operation enforces Account ownership. Cross-Account access to private Workspace data must produce no data disclosure.

**NFR-2: Secret protection.** Login, Invitation Code, recovery, provider, database, queue, signing, and callback-verification secrets are never stored or logged in readable form or exposed through browsers, URLs, prompts, Jobs, Notifications, Source Records, or Exports. Sensitive authentication actions require secure transport and protected sessions. Secrets support redaction, rotation, and revocation.

**NFR-3: Provenance integrity.** Sources, Cached Research Revisions, Claims, decisions, approvals, repairs, validations, and derivative artifacts retain immutable identity, timestamps, actor, and version relationships. Every Claim pins the exact Source edition or revision, passage, retrieval date, and captured excerpt or content digest examined. Corrections and changed Source content use successor versions rather than mutation. Later printer integration cannot alter the approved evidence-to-geometry record.

**NFR-4: Durable job state.** Closing the browser, navigating to another Project, or a worker restart cannot lose an accepted Job, corrupt its Project, or misreport its final state.

**NFR-5: Safe concurrency.** Concurrent Jobs remain isolated and cannot overwrite newer approved Project state. Results generated from stale inputs cannot silently become current.

**NFR-6: Reproducibility.** Given fixed approved inputs, tool versions, and settings, nova3D reproduces geometrically equivalent Canonical Models within the tolerance ratified through AD-2.

Ratified application: this is evidence-recipe equivalence under R-2 / AR-10. The PRD's AD-2 means PRD:AD-2, not architecture AD-2. Direct inference preserves exact snapshots/provenance without an identical-reinference guarantee.

**NFR-7: Version durability.** Every Version presented as restorable must restore its geometry and provenance successfully. Deletion under FR-30 is the explicit exception.

**NFR-8: Explainable failures.** User-facing failures identify the failed stage, known cause, preserved state, cost impact where known, and permitted next action in beginner-friendly language.

**NFR-9: Cost control.** Paid Work cannot begin without category-specific Project permission, a disclosed maximum charge, and an atomic cost reservation within the available Usage Limit. Usage records, reservations, settlements, and releases must reconcile with each idempotent Job. nova3D must present the resulting spending record clearly enough for Josh to understand and control spending.

**NFR-10: Responsive workspace.** Research, generation, validation, repair, and export run without blocking navigation or ordinary Project inspection. Browser preview degradation or failure cannot damage manufacturing geometry.

**NFR-11: Honest print qualification.** Validation labels always identify the Target Print Profile, warnings, failures, unknowns, and last validation time; nova3D never presents validation as safety or universal manufacturability certification.

**NFR-12: Privacy-preserving cache and deletion.** Shared cached research contains only fields reproducible from identified non-private Sources and cannot expose user identity, private inputs, decisions, or deleted artifacts. Admission rejects all user- and Project-derived fields. Project or whole-Account deletion takes effect immediately through durable tombstones. It blocks late writes and cache promotion, promptly removes active private data, removes remaining copies from operational backups within 30 days, and remains enforced after backup restoration.

Source: PRD §7. All twelve NFRs apply across the capability set, with the explicit mode distinction above. Architecture requirements below supply measurable limits and enforcement contracts.

### Additional Requirements

The adopted architecture is an implementation contract. These work items retain all AD-1–AD-19 and R-1–R-11 obligations; referenced source detail remains binding.

**Starter requirement for Epic 1 Story 1:** AR-1 specifies the qualified greenfield seed. The first story below carries this bootstrap constraint.

**AR-1: Starter and pinned runtime.** Epic 1 Story 1 must initialize the official create-next-app 16.3.5 TypeScript/App Router/Tailwind starter with the documented Supabase SSR integration. Preserve Node 24.21.0, React/DOM 19.3.0, TypeScript 5.9.3, Tailwind 4.3.3, supabase-js 2.116.0, ssr 0.12.7, Upstash Workflow 1.3.3/Redis 1.38.4 and Three 0.186.0 as the qualified seed; compatible patches are delegated. Install, typecheck and production-build before accepting the application lockfile. The old with-supabase example's Tailwind 3/lint pins are not the seed. Local probes already pass but the application is unbuilt.

Source: Architecture Stack; R-1; qualification stack report.

**AR-2: Module boundaries and ownership.** Use a modular monolith with provider-neutral domain ports and versioned subject packages. Next.js handles commands/web delivery; trusted Railway native workers handle geometry/validation/export and large-file delivery. Models propose validated data, never executable scripts. Retain the architecture's sole ownership of Identity, Projects, Evidence, Geometry, Manufacturing, Artifacts, Jobs, Usage, Preferences/notifications and Lifecycle records; shared invariants use coordinated Postgres transactions.

Source: AD-1, AD-2; Structural Seed.

**AR-3: Transactional contracts.** Use auth-derived Account, UUID command/event/revision identities, expected revisions, SHA-256 content roots and UTC timestamps. Validate schema, ownership and idempotency; replay returns the original receipt and changed payload under the same ID is rejected. Commit business state, Job/reservation and outbox together. Sensitive tables deny browser DML; ownership-scoped foreign keys prevent cross-Workspace links. Redis, queues and client state cannot authorize transitions.

Source: AD-2; Consistency Conventions.

**AR-4: Explicit request modes.** Persist immutable evidence_text, evidence_images or image_direct revisions. Evidence modes need complete whole-plan approval of the exact digest. Direct mode needs confirmed scope, ordered image digests and acknowledged uncertainty, and never gains historical status. Changing modes creates a successor request. Every qualified export still requires exact-model approval and compatible validation.

Source: AD-3; R-8, R-11; scope-and-readiness.

**AR-5: Provenance and immutable publication.** Preserve SourceRevision → ClaimRevision → Detail/Option → PlanRevision/PlanApproval → Parameter → Feature → ModelVersion → ModelApproval/Validation → Export links, including reverse navigation, competing choices, actors and times. Stable logical features have version-specific geometry/claim bindings. Artifacts owns one canonical JSON manifest-root/digest family with immutable ID, ownership, size, kind, byte digest, canonical serialization version, producing activity and child references. Approval, gateway access, restore, cleanup and deletion resolve the same manifest roots; object keys cannot redefine them. Staged output becomes usable/restorable only through verified coordinated publication.

Source: AD-4, AD-13; shared artifact identity.

**AR-6: Complete and eligible research.** Use the Middot package's finite checklist for shape, dimensions, materials, placement, printability and interpretation; require an independent omission review with no unresolved gap. Middot chapter 3 governs spatial reconstruction; low-authority pages remain leads. Project exclusions and Account toggles target stable source identities, increment effective policy epochs and invalidate/recheck affected active conclusions. Pin the Account-policy revision, Project-exclusion revision and explicit source set in attempts, private cache-adoption records and plan digests. Filtering is deterministic for those inputs; active changes create a successor draft and rerun affected conclusions and completeness before approval. Approved records stay immutable.

Source: AD-5; evidence-policy identity.

**AR-7: Untrusted acquisition and output.** Restrict acquisition destinations/redirects, sizes and content types; block private-network and credential access. Source text, uploads and provider output are untrusted. Schema-validate output and verify citations before evidence acceptance. Never treat embedded instructions, prompts or proposed executable code as authority.

Source: AD-1, AD-5.

**AR-8: Canonical native geometry.** Evidence-backed authority is a versioned declarative recipe with typed finite parameters, source-unit conversions, acyclic operation/dependency graph, stable feature IDs and trusted generator identity. Retain generator/dependency-lock/image digests, execution settings, recipe and BREP/STEP snapshots. CadQuery 2.8.0 uses the qualified Python 3.12.14/OCP closure; STEP alone is not the recipe. Unsupported geometry requires extending the trusted generator through code review. Direct inference retains exact immutable mesh/input/model/settings snapshots with no identical-reinference claim.

Source: AD-6; R-1; G-1.

**AR-9: Coordinate frames, measurement and versions.** Canonical content uses millimetres, right-handed coordinates and Z-up, retaining approved historical unit conversions. GLB explicitly converts to metres/Y-up; final-print scale/orientation is separately versioned. Every LOD preserves semantic feature IDs independently of triangles. Measurements use canonical geometry or labelled exact dimensions. Corrections rebuild dependency closure; restoration appends history and rechecks approval/profile validity without erasing successors.

Source: AD-7; FR-18–FR-22.

**AR-10: Certified equivalence.** Compare corresponding semantic features under the same original pinned final-print scale/orientation, tessellator/settings and comparator version, with no best-fit or independent rescaling. Require matching feature/component/closed-solid topology, conservative bidirectional surface-distance upper bound ≤0.01 mm, bounds delta ≤0.01 mm and relative volume delta ≤0.1% using reference absolute volume. Tiny/zero/ill-conditioned or inconclusive results block acceptance. Cover dimensions, thin features, holes, rotations, units and scale; coarse bounds/volume probes are not the certified comparator.

Source: R-2; AD-6, AD-7; G-2.

**AR-11: Exact print profile and fail-closed checks.** Pin the manufacturer profile's complete inheritance closure for A1 mini 0.4 mm, Bambu PLA Silk+ Gold, ≤90 mm cube, 0.20 mm layers and an explicit three-perimeter override. Enforce wall ≥1.2 mm, isolated feature ≥0.8 mm, clearance ≥0.4 mm and relief ≥0.6 mm. Overhang >45° from vertical or bridge >5 mm requires verified support/slicing analysis. Validation binds model digest, profile revision, transform, tessellation and validator version; unsupported/unknown required checks block qualified export.

Source: AD-8; R-3; G-3.

**AR-12: Repair authority and one regeneration slot.** Every repaired byte representation gets a new artifact identity. Normals/winding fixes, duplicate/zero-area face removal or welding retain a Model Version only after R-2 proves nonconsequential equivalence. Hole filling, remeshing, thickening and dimension changes are consequential and require successor Model Version, inspection, approval and validation. Atomically consume unique (lineage_id, full_regeneration) with successor Job/outbox and any reservation; retries, cancellation, failure and children cannot rearm it. Evidence mode uses the approved plan; direct mode uses pinned original images/scope/engine, failed constraints and new settings digest, stopping if the engine cannot satisfy them.

Source: AD-8; R-3, R-11; G-3/G-8.

**AR-13: Shared export schema and PDF.** Implement provenance schema 1.0.0 in JSON Schema Draft 2020-12 with shared generated TypeScript/Python validation for header, evidence, approvals, geometry and manufacturing groups. Export primary 3MF, optional STL, PDF and structured provenance bound to one immutable manifest. Container PDF rendering uses Playwright 1.63.0 Chromium with pinned/licensed Noto Sans and Noto Sans Hebrew, escaped content and no remote resources/scripts. Verify bilingual glyphs/order, pagination, reciprocal links and zero orphans.

Source: AD-4, AD-8; R-4; G-4.

The shared schema must preserve these architecture-defined groups:

| Group | Required identity and relationships |
| --- | --- |
| Header | Schema version, request mode, Project/Model Version, export identity and creation activity. |
| Evidence | Source revisions with passage/content pins; claims; classifications; competing options; explanations; original/translated text distinction. |
| Approvals | Exact plan/model digests, approver/time, choices and affected details; direct-mode scope/uncertainty acknowledgment where applicable. |
| Geometry | Canonical recipe or image-derived snapshot kind, units/conversions, feature/parameter/dependency links and artifact digests. |
| Manufacturing | Target profile, scale/orientation, validator/tool versions, each check result, repairs, regenerated versions and qualified export manifest. |

**AR-14: Durable Jobs and bounded retries.** Accept Jobs only with committed dispatch outbox; persist Job → JobAttempt → StepExecution → ExternalOperation identities and receipts. Upstash orchestrates bounded HTTP steps and worker completions; Postgres owns state. Configure workflow, explicit queue publishes and provider SDKs for zero failed-work retries, verifying effective behavior with a deliberately failing research step. Duplicate transport returns existing receipts without repeated side effects; terminal failed/cancelled attempts cannot be reclaimed. Lease loss becomes interrupted failure; user retries create new linked attempts under the same Job and wait for prior potentially chargeable work to reconcile. Logical step keys are unique per attempt, and operation ordinals per step; Jobs owns receipts while Usage owns their ledger entries. Preserve last approved state and actionable failure details.

Source: AD-9; work/billing identity.

**AR-15: Fencing and authenticated service calls.** Each attempt binds input digest, Project revision, live Account authorization/evidence-policy epochs, lease and unique fencing token. Recheck before claim, each external step and publication. Cancel/disable/delete revoke commit authority before best-effort cancellation; stage output by attempt and clean it without publishing late results. Signed service requests bind environment, audience, Job/attempt, payload digest and nonce, expire within five minutes and allow at most 60 seconds skew. Verify native callback signatures and stored dispatch receipts; never infer callback identity from Project ID alone. Accept only the active signing key and one explicitly retiring key during the outstanding-request window; suspected compromise immediately revokes the key and affected leases. Reject replay mutations.

Source: AD-10; service authentication and delivery conventions.

**AR-16: Atomic money and paid permissions.** Paid categories independently disclose provider, purpose, outbound-data/retention categories and maximum, with Project permission off by default. Use one Usage-owned checked integer USD-microdollar/rational calculator: sum under immutable model/options/rates, apply billing increments, round upward once per operation, reject overflow/unknown rates/foreign currency/unsupported parameters. Atomically enforce Account-period allowance, $5 lifetime research-Job cap across attempts and $1 external-operation cap. Defaults are $25/invitee and $50/Administrator per UTC month. Preserve outstanding liabilities across resets; already-authorized work retains reservations while disable cancels it.

Source: AD-11; R-6; G-6.

**AR-17: Provider boundary and uncertain charges.** Adopt Anthropic Messages claude-sonnet-5 for evidence synthesis/vision and Brave Web Search v1 for discovery behind adapters, with version/rate/account-term verification before enablement. Search receives normalized public subjects only; vision receives only permissioned purpose-required data. No paid external 3D provider, Files/Batch/Managed Agents storage, private raw prompts in search, or billable free-credit fallback in free-only mode. Own hosting/storage/worker/local inference is instance overhead. Persist external identity before dispatch; uncertain charge retains full reservation until evidence, conservative maximum settlement or proven noncharge; corrections append ledger entries without replacement calls.

Source: R-6; AD-11; G-6.

**AR-18: Identity and administrative enforcement.** Disable public Supabase signup; hash/atomically claim invitations and idempotently provision Auth plus Workspace with unusable partial activation. Rate-limit guessing; rotate shared codes only after success. Verify JWT plus live Account and session grant on every private path, including direct RLS/storage access. The sole Administrator cannot impersonate, inspect private Workspaces or grant more administrators. Sensitive actions require fresh authentication and immutable audit; verified-email single-use short-lived recovery revokes prior sessions.

Source: AD-12; FR-1–FR-4.

**AR-19: Revocable artifact transfer.** Keep buckets private and use ownership-scoped immutable keys and quota/lease-bounded upload staging. Verify checksums/content before attachment. Container gateway streams large uploads/downloads/ranges; authorize each range and every chunk of at most 1 MiB against live Account/session/Project/artifact state. Do not expose reusable signed download URLs or cache private responses/authorization; stop future chunks on revocation. Delivered or in-flight bytes cannot be recalled. Cleanup respects active leases.

Source: AD-13; file authorization.

**AR-20: Source editions and public-cache admission.** Initial editions are Sefaria Middot 3 Hebrew Torat Emet 357 and English Mishnah Yomit by Joshua Kulp. Capture exact edition metadata, attribution, URL, license and examined passage/digest before body retention. Allow only verified Public Domain/CC0/CC-BY with attribution; ambiguous/restricted sources retain metadata/digest and cannot support approved claims without inspectable authorized evidence. Public cache admits dedicated source-reproducible allowlisted records, never serialized plans or private IDs/prompts/uploads/personalization/decisions/geometry. Explicit reuse preserves immutable original dates; fresh research cannot substitute cached conclusions; adoption associations remain private/deletable.

Source: AD-14; R-7; G-7.

**AR-21: Deletion and tested recovery.** Tombstone/hide before cancellation/purge; cover database, images, models, exports, staging, notifications, usage associations and private operational records. Active purge ≤24 h; all controlled private backup copies expire ≤30 days from deletion, never extended by restore/rebackup. Back up database daily and objects independently; target RPO/RTO ≤24 h. Persist the minimum restricted anti-resurrection ledger of opaque target identities outside restore rollback and replay before reopening access. Verify interrupted cross-store deletion and restore; apart from that minimum ledger, preserve only permitted public claims/nonidentifying aggregates. Apply sole-Administrator close-instance safeguards and disclose external retention exceptions.

Source: AD-15; R-9; FR-30; G-9.

**AR-22: Prepared offline inference and sync.** Direct conversion uses a verified cached public app/model bundle in a dedicated worker, Account-scoped IndexedDB metadata and OPFS binary artifacts. R-8 selects ONNX Runtime Web 1.29.0 as the first browser backend with supported WebGPU or WASM execution; no reconstruction engine or weights are yet qualified. Qualify licensed/digest-pinned multi-view weights and the full preparation bundle at ≤500 MiB preparation download, ≤1 GiB working memory and ≤120 s conversion on R-5 devices, with held-out shape/coverage, eviction and interruption checks. Online preparation/export are required; no silent upload/cloud fallback. Sync stable UUIDs into the original Account with live status, expected revision, digest verification and idempotent import; retain conflicting versions for explicit selection.

Source: AD-16; R-8; G-8.

**AR-23: Offline revocation state.** Already-local work remains usable while disconnected without a time lease. On contact, authoritative status precedes sync/export: disable locks stores and work; learned Account/Project tombstone purges affected files and pending commands. Only a newer server authorization epoch can unlock a known disable; stale replies, token refresh, connectivity or Account switching cannot. Network/auth uncertainty is not deletion. Sign-out clears private stores; never attach another Account's drafts or reuse deleted IDs. Disconnected/downloaded copies are outside controlled-backup erasure promises.

Source: AD-16; R-8.

**AR-24: Viewer and device acceptance.** Qualify current/previous stable Chrome/Edge/Firefox, macOS/iOS Safari and Android Chrome on MacBook Air M2 16 GB, Windows 11 i5-1235U/Iris Xe 16 GB, iPhone 16 Pro and Pixel 9 Pro; freeze actual OS/browser builds. Maximum preview fixture 100,000 triangles; ≤5 MB coarse first view and ≤20 MB full initial GLB. Cold model open-to-interactive ≤5 s at shaped 20 Mbps includes code, network, decode and working orbit/feature-evidence navigation; p95 frame time ≤33 ms after load. LOD swaps retain semantic selection/provenance. GPU loss keeps canonical data and semantic/static fallbacks without claiming a passed 3D benchmark.

Source: AD-7, AD-17; R-5; G-5.

**AR-25: Notification delivery and privacy.** Commit one durable in-app notification per recipient/event; deduplicate unreliable realtime/push and refresh canonical state. Resolve exact targets with live authorization. Push carries opaque event references and generic category text, no private excerpts/model names/images. Persist per-category research/generation/validation/export preferences and contextual permission/install guidance; denial does not erase in-app history. Printing notifications remain inactive.

Source: AD-18; SC-5.

**AR-26: Deployment and operations.** Separate local/staging/production Supabase, queues, storage, secrets and callback origins in one repo; previews use synthetic data and disabled paid adapters. Verify immutable environment IDs at CI/startup/dispatch; prevent preview/production mixing. Adopt Vercel iad1, Supabase us-east-1, Railway Virginia us-east4-eqdc4a and nearest available Upstash with actual paid plans/topology recorded before acceptance. Pin command/result schemas, generator versions and worker images at Job acceptance; an unavailable compatible worker leaves the Job waiting with a reason. Declare and validate additive compatibility; major changes use separate workers/endpoints. Deploy consumers before producers, retain old consumers until their Jobs terminate, and retain generator images/locks needed by non-deleted reproducible Versions. Use expand/migrate/contract with rollback preserving money/provenance/deletion. Monitor outbox age, leases, failures, unknown costs, storage integrity and purge deadlines with redacted IDs; outages fail authorization closed.

Source: AD-19; R-9; G-9.

**AR-27: Acceptance evidence and remaining work.** Implement real application seams for two-Account API/storage denial, invitation races, replayed commands/callbacks, cancel/delete-versus-result races, concurrent budgets/unknown charges, stale approval, source-policy changes, cache privacy, offline duplicate/conflict sync, deletion-aware restore, canonical/preview transforms, accessible navigation and bilingual exports. Local primitives do not close application gates. G-1/G-2/G-3/G-6/G-9 are PARTIAL, G-5/G-8 BLOCKED and G-4/G-7 NOT RUN; retain these as explicit implementation/qualification obligations. No full release while applicable gates remain open.

Source: Qualification REPORT; architecture implementation gates.

**AR-28: Shared interface preferences and semantics.** Use configured locale catalogs, logical layout directions and isolated mixed-language evidence spans; preserve original source, translation and explanation separately. Choose supported device locale initially and persist Account language/theme/detail overrides. Light default, explicit dark and reduced-motion/accessible semantic controls apply to the full phone/computer workflow. Technical explanations change depth only, not decisions or evidence. Complete visual/token/state work under R-10 without treating historical empty UX spines as approved mockups.

Source: AD-17; R-10; canonical UX contract.

#### Source capability crosswalk

Each row inherits all consequences of the referenced requirements and the applicable cross-cutting constraints; it does not select only the examples mentioned by the kernel.

| Capability | Product requirements | Architecture decisions |
| --- | --- | --- |
| CAP-1 | FR-1, FR-2, FR-3 | AD-2, AD-10, AD-12, AD-13, AD-15 |
| CAP-2 | FR-4, FR-14 | AD-2, AD-9, AD-10, AD-11 |
| CAP-3 | FR-5; SC-1 | AD-3, AD-5, AD-6, AD-16 |
| CAP-4 | FR-6, FR-7; SC-5 | AD-9, AD-10, AD-18 |
| CAP-5 | FR-8, FR-9, FR-10, FR-11, FR-12 | AD-4, AD-5, AD-14 |
| CAP-6 | SC-6 | AD-5, AD-14, AD-17 |
| CAP-7 | FR-10, FR-11, FR-12, FR-13, FR-14; SC-1 | AD-3, AD-4, AD-5 |
| CAP-8 | FR-15, FR-16, FR-17; SC-1 | AD-3, AD-4, AD-6, AD-7 |
| CAP-9 | FR-18, FR-19; SC-3, SC-7 | AD-4, AD-7, AD-17 |
| CAP-10 | FR-20, FR-21, FR-22 | AD-4, AD-6, AD-7, AD-10, AD-13 |
| CAP-11 | FR-23, FR-27 | AD-3, AD-4, AD-8 |
| CAP-12 | FR-24, FR-25, FR-26, FR-27, FR-28 | AD-8, AD-10, AD-11 |
| CAP-13 | FR-29 | AD-3, AD-4, AD-8, AD-13 |
| CAP-14 | FR-30 | AD-10, AD-12, AD-13, AD-15, AD-16 |
| CAP-15 | FR-8, FR-9, FR-14, FR-30 | AD-4, AD-5, AD-14, AD-15 |
| CAP-16 | SC-2 | AD-3, AD-6, AD-10, AD-13, AD-15, AD-16 |
| CAP-17 | SC-3, SC-4, SC-7 | AD-7, AD-17, AD-18 |

All NFRs apply across these rows. NFR-1/2 cover private access and secrets; NFR-3 covers immutable provenance; NFR-4/5 durable isolated work; NFR-6/7 reproducibility and restoration; NFR-8 explainable failures; NFR-9 cost control; NFR-10 responsiveness; NFR-11 qualified print claims; NFR-12 private cache admission/deletion. The adopted architecture's capability map assigns implementation responsibility for each.

This source-to-source crosswalk complements the story coverage map below.

#### Inherited acceptance metrics

**Primary**

- **SM-1 — Complete evidence-led outcome:** Josh can progress one altar-and-ramp Project from a natural-language request to an approved Export and Source Record without manual modelling. Validates FR-5 and FR-8 through FR-29.
- **SM-2 — Consequential Detail coverage:** 100% of Consequential Details in the approved Research Plan have linked evidence or an explicit Detail Status. Validates FR-10 through FR-13.
- **SM-2a — Independent completeness check:** 100% of approved Research Plans have a completed finite detail checklist, a recorded independent gap-review pass, and no unresolved gap. Validates FR-10 and FR-13.
- **SM-3 — Approval integrity:** In every test case, generation is blocked without valid Plan Approval, and Export is blocked without valid Model Approval for the exact Version. Validates FR-13, FR-15, FR-23, and FR-29.
- **SM-4 — Reproducible regeneration:** 100% of the MVP regression corpus regenerates geometrically equivalent output from fixed approved inputs, tool versions, and settings within the resolved tolerance. Validates FR-16 and FR-21.
- **SM-5 — Print-validation integrity:** Every MVP Export passes all supported blocking checks for its Target Print Profile and retains the full validation and repair record. Validates FR-24 through FR-29.

**Secondary**

- **SM-6 — Dependency correctness:** Correction tests rebuild all affected Model Features while unrelated geometry stays within the reproducibility tolerance. Validates FR-20 and FR-21.
- **SM-7 — Recoverability:** Every non-deleted Version in the MVP test set restores its geometry and provenance successfully. Validates FR-22 and NFR-7.
- **SM-8 — Account isolation:** In every authorization test, one Account's private Workspace content remains inaccessible to another Account. Validates FR-2, FR-30, NFR-1, and NFR-12.
- **SM-9 — Controlled paid work:** Zero paid Jobs start without both Project permission and available Usage Limit. Validates FR-4 and FR-14.
- **SM-10 — Bidirectional traceability:** Every Consequential Model Feature resolves to its governing Claims, and every approved Claim resolves to all affected Model Features, with no orphaned links in the MVP corpus. Validates FR-10, FR-15, and FR-19.

**Counter-Metrics**

- **SM-C1 — Source count is not quality:** Do not optimize the number of Sources at the expense of authority, relevance, or correct support for Claims. Counterbalances SM-2.
- **SM-C2 — Speed is not evidence completeness:** Do not reduce time to Model by skipping unresolved Consequential Details or approval. Counterbalances SM-1.
- **SM-C3 — Validation pass rate is not safety:** Do not improve pass rate by suppressing warnings, weakening checks, or implying universal manufacturability. Counterbalances SM-5.
- **SM-C4 — Cache reuse is not freshness:** Do not describe cached research as refreshed or re-verified when it was reused without new research.

**Mode application:** SM-3's Plan Approval gate applies to evidence_text/evidence_images; image_direct uses confirmed images/scope and acknowledged uncertainty. Exact-model approval and passing required profile validation apply to every qualified export. SM-4/SM-6 certify evidence-recipe equivalence; direct inference retains exact restorable snapshots and honest provenance. The altar/ramp demonstration does not replace the first-version picture/offline/device scope.

Source: PRD §8; canonical scope-and-readiness acceptance rules.

#### September 14 qualification baseline

Local synthetic probes establish component feasibility only. Application acceptance and release remain open. The exact web stack passes clean production builds and loopback HTTP; headless capability emulation does not qualify actual phones or offline inference. Preserve the following status snapshot and remaining work when planning.

| Gate | Status | Evidence now available | Evidence still required |
| --- | --- | --- | --- |
| G-1 — Canonical worker | **PARTIAL** | Native toolchain, synthetic generation/personalization/correction/restore and bounded cancellation. | Approved evidence-backed altar/ramp corpus; application recipe/version integration; deployed worker resources, fencing and restore behavior. |
| G-2 — Geometry equivalence | **PARTIAL** | Coarse repeated/serialized geometry comparisons and deliberate dimensional, thin-feature, hole, scale and unit negatives. | Certified bidirectional surface-distance upper bound ≤0.01 mm; corresponding features under the pinned final-print transform; rotations, tiny/ill-conditioned features and repair corpus. |
| G-3 — Print qualification | **PARTIAL** | Profile closure and override, independent fixtures, one successful official-slicer run; SQL unique-slot primitive from recovery. | General required geometric/support checks that fail closed on unknown; consequential/nonconsequential repair handling; successor Job/outbox/lineage atomicity, retry and renewed approval. Physical printing is a separate unverified claim and is not required for the adopted altar/ramp demonstration. |
| G-4 — Provenance/export | **NOT RUN** | No qualifying schema/PDF/export-package run. | Cross-runtime schema, reciprocal feature/evidence links and readable Hebrew/English PDF from the same immutable export. |
| G-5 — Supported devices | **BLOCKED** | Headless Linux API/storage/fixture feasibility. | Real MacBook Air M2, Windows/Iris Xe, iPhone 16 Pro and Pixel 9 Pro browser matrix; full workflow accessibility; progressive semantic viewer and ≤5 s/≤33 ms timing; GPU-loss recovery. |
| G-6 — Paid-operation control | **PARTIAL** | Synthetic integer/rational arithmetic and concurrent Account/parent-Job ceilings. | Actual account terms/rates and permission/disclosure; bounded request calculator, ambiguous-charge settlement/reconciliation, cancellation and authenticated application enforcement. |
| G-7 — Evidence rights | **NOT RUN** | No edition-ingestion or retention-path qualification. | Pinned edition rights, inspectable source records and permitted private/shared retention. |
| G-8 — Offline conversion/sync | **BLOCKED** | Storage/API/runtime primitives and import deduplication prototype; four candidate source reviews. | A compliant pinned reconstruction model; offline bundle preparation and execution on real devices; quality/coverage, eviction/interruption, authoritative reconnect revocation and conflict sync. |
| G-9 — Recovery/deletion | **PARTIAL** | Local Postgres/object restore with intervening deletion and external ledger replay. | Provisioned provider plans/regions, private-file and callback path, full app deletion/fencing, active purge ≤24 h, controlled backup expiry ≤30 d and measured RPO/RTO ≤24 h. |

A passing adopted altar/ramp software demonstration does not require a physical print or printer control. Complete first-version release still requires the applicable picture, offline, device and production gates. The reviewed models failing the adopted target do not prove that the target is impossible. Changing scope or weakening limits requires a recorded product decision.

Source: September 14 qualification REPORT; canonical scope-and-readiness; AR-27.

### UX Design Requirements

UX is a first-class implementation input. UX-DR1–UX-DR20 capture shared behavior and design work; the following per-surface requirements preserve every named screen and required state. Apply the ratified mode rules to all surfaces: plan-only views belong to evidence modes; direct-image views expose honest image provenance. Each surface also inherits the shared responsive/accessibility/localization requirements. Conditional options such as rename or search remain conditional as written in the source.

**UX-DR1: Implement the ratified light/dark token system.** Define semantic tokens for neutral surfaces, slate text, indigo actions, evidence/status colors, typography, spacing, radii, elevation and component states. Apply consistent tokens to approvals, jobs, notifications, image-quality warnings, source exclusions, sync, validation, destructive actions and 3D selection. Preserve contrast in both themes; light is default. Specific values/components are delegated design work, not already-approved outputs.

Source: R-10; UX-7; design handoff.

**UX-DR2: Complete responsive workflow.** Every required surface has usable phone and desktop/laptop treatment. Desktop centers the model and evidence inspector; phones use stacked panels/drawers preserving every creation, review, inspection, approval, validation and download control. Maintain secondary global navigation without replacing My Projects, Create and In Progress.

Source: SC-3; UX-1/UX-5/UX-7.

**UX-DR3: Keyboard and screen-reader inspection.** Expose labelled semantic feature lists and evidence/inspection actions beyond canvas. Support complete keyboard navigation, visible focus, accessible names and dynamic-state announcements; touch alternatives cannot depend on hover, right-click or precision pointing.

Source: SC-7; UX-5; AD-17.

**UX-DR4: Accessible layout and state cues.** Verify WCAG 2.2 AA contrast, text enlargement/reflow, usable touch targets, non-colour status distinctions and reduced motion across every relevant surface. Use text/shape plus color for evidence, approvals, failures and warnings; do not remove functionality in accessibility modes.

Source: SC-7; UX-5; design handoff.

**UX-DR5: Configured localization and full RTL.** Initial locale matches a supported device language; an Account override persists. Use logical directions and support text expansion without clipping or semantic reversal; isolate mixed-direction IDs, units, extensions and citations. Keep original-language evidence, translation and explanation distinct and show Hebrew/English together correctly.

Source: SC-4; UX-3/UX-5; AD-17.

**UX-DR6: Honest language and guidance.** Use concise ordinary language and real nova3D terms; technical-detail preference changes explanation depth only. First-use guidance is dismissible and reopenable. Never fabricate passages/citations/dimensions/scholars or claim historical certainty, universal printability or safety certification; unverified design sample content is explicitly labelled.

Source: UX-1/UX-5; design handoff.

**UX-DR7: Explicit workflow and evidence distinctions.** Keep sourced, inferred, disputed, unknown and user-added distinct; internal user_added maps to the display label user-added. Distinguish lead/evidence, cached/fresh dates, reconstruction/personalization, direct/evidence modes, Plan/Model Approval, preview/manufacturing geometry, warning/failure/unknown, Project source exclusion/Account disabling, and every Job/local-sync state.

Source: Screen inventory cross-surface states; UX-3; AD-3/AD-4.

**UX-DR8: Intake sequence and paid consent.** Confirm subject, scope, outcome, picture mode and personalization after text/image intake. For research, separately select free/paid and cache/fresh afterward, before dispatch. Present provider/category/purpose, outbound-data/retention and maximum before paid permission. Scope confirmation, start confirmation, Plan Approval and Model Approval remain distinct.

Source: UX-2; FR-4/FR-5/FR-14.

**UX-DR9: Ordered multi-view image intake.** Support file selection and a phone Take photo action, requesting camera permission only after that action. Preview, add, replace, reorder and remove angles of one subject within one request; handle denied camera access and bad files. Choose direct image-derived versus online research-assisted reconstruction explicitly.

Source: SC-1; UX-2.

**UX-DR10: Image clarity and coverage guidance.** Before conversion explain blur/obstruction/coverage issues and recommend specific additional views. Direct conversion may proceed with incomplete coverage only after explicit Generate anyway acknowledgment of potentially invented/inaccurate geometry; warnings remain associated with the immutable request/model.

Source: SC-1; UX-2.

**UX-DR11: Recorded research activity and source reading.** Show actual acquisition/acceptance stages and source roles while Jobs run. Reading original text, translation, citation and evidence-based explanation does not pause the Job. Show unavailable excerpts/digest-only evidence honestly; never fabricate hidden model reasoning.

Source: UX-3; AD-18.

**UX-DR12: Project exclusion versus Account source policy.** Do not use this Source affects only the current Project; Account Disabled Sources uses per-source on/off controls across Projects. Active changes visibly invalidate/recheck claims and continue replacement research. Completed approvals never mutate; now-disabled warnings can be hidden without altering provenance/export. Project interpretation corrections require a successor plan and renewed approval.

Source: SC-6; UX-3.

**UX-DR13: Prepared offline creation and honest failure.** Show preparation/download verification, missing preparation, storage unavailability, eviction/interruption and local inference failure as actionable states. Direct output remains saved/usable locally and labelled image-derived. Research-assisted mode is online-only; qualified export requires connection. Never silently upload or substitute paid cloud generation after local failure.

Source: SC-2; UX-4; R-8.

**UX-DR14: Offline authority and conflict visibility.** Explain no offline time lease and revocation-on-reconnect during preparation. Show locally saved, pending, syncing, failed and conflict states; automatically import into original Account's My Projects without duplicates/overwrites. Learned disable locks until newer authoritative re-enable; learned deletion purges before import; network uncertainty preserves work. Sign-out clears private stores and Account switching never transfers drafts.

Source: UX-4; R-8.

**UX-DR15: Progressive model viewing and degradation.** Maintain feature/evidence selection across coarse/full LOD transitions, with accurate canonical dimension controls. Preserve feature/evidence/dimension lists and static views on GPU failure; distinguish degraded preview from successful 3D inspection. Qualify full code/network/decode interaction on the R-5 device matrix and timing budgets.

Source: FR-18/FR-19; AD-7; R-5.

**UX-DR16: Immutable approvals and comparison.** Show exact plan/model version and readiness before approval. Compare geometry, parameters, evidence/choices, personalization, approvals and validation; restoration preserves later history and does not silently authorize an export. Changed interpretations, substantive repair and personalization route to the relevant successor approval.

Source: FR-12/FR-13/FR-20–FR-23/FR-27.

**UX-DR17: Print-validation and bounded recovery states.** Expose exact profile/transform, check support, last-checked time, pass/warning/fail/unknown and stale results. Required unknowns block export. Show each repair and affected geometry; one full regeneration/reconversion is lineage-bound, preserves originals and returns to inspection/approval/validation. Failure after the allowed attempt stops with an actionable explanation.

Source: FR-24–FR-28; R-3/R-11.

**UX-DR18: Notifications and permissions.** Keep durable app-wide history and exact authorized deep links whether phone push is allowed, denied or off. Offer contextual install/permission guidance and independent research/generation/validation/export toggles; payload previews contain generic categories/opaque references only. Printing remains Coming later.

Source: SC-5; UX-6; AD-18.

**UX-DR19: Failure and destructive-action clarity.** For failures show stage, known cause, preserved state, known cost impact and permitted next action, with no automatic retry implied. Sensitive/deletion/instance-closure flows show required fresh authentication, exact consequences and explicit confirmation; immediate hidden/tombstoned state remains distinct from cleanup completion.

Source: NFR-8; FR-3/FR-6/FR-30; screen inventory.

**UX-DR20: Traceable responsive design coverage.** Complete and verify every screen/state below under R-10, with desktop/phone, light/dark, a complete RTL journey, bilingual evidence, focus/names/announcements, enlarged text, contrast and reduced-motion coverage. Maintain a screen-to-implemented-design/state mapping when surfaces combine. DESIGN.md/EXPERIENCE.md are metadata-only historical drafts; neither a new direction-selection checkpoint nor a specific external design tool is required.

Source: R-10; UX-7; screen inventory/design handoff.

**UX-DR21: Sign in (A-01).** Account authentication, recovery entry, language access.

Required states/variants: Default, invalid credentials, disabled Account, loading.

Source: SCREEN-INVENTORY A-01; canonical ux-contract; applicable ratified decisions.

**UX-DR22: Invitation registration (A-02).** Single-use Invitation Code, Account creation, clear generic failures.

Required states/variants: Valid, invalid/revoked/used code, rate-limited, success.

Source: SCREEN-INVENTORY A-02; canonical ux-contract; applicable ratified decisions.

**UX-DR23: Administrator recovery (A-03).** Verified-email recovery without exposing other Workspaces.

Required states/variants: Request sent, expired/used link, success with session revocation.

Source: SCREEN-INVENTORY A-03; canonical ux-contract; applicable ratified decisions.

**UX-DR24: Global shell (G-01).** Access to Home, Notifications, Settings, Account, and contextual back navigation.

Required states/variants: Desktop/laptop, phone, LTR, RTL, light, dark.

Source: SCREEN-INVENTORY G-01; canonical ux-contract; applicable ratified decisions.

**UX-DR25: Notifications (G-02).** Actionable event list opening the exact related item.

Required states/variants: Unread/read, empty, failure, permission disabled, grouped Project events.

Source: SCREEN-INVENTORY G-02; canonical ux-contract; applicable ratified decisions.

**UX-DR26: First-use guidance (G-03).** Explain each workflow stage in ordinary language; dismiss and reopen later.

Required states/variants: First use, dismissed, reopened from Settings.

Source: SCREEN-INVENTORY G-03; canonical ux-contract; applicable ratified decisions.

**UX-DR27: Home dashboard (H-01).** Three primary actions: **My Projects**, **Create**, **In Progress**.

Required states/variants: New Account/empty, active Jobs, unread Notification, desktop, phone.

Source: SCREEN-INVENTORY H-01; canonical ux-contract; applicable ratified decisions.

**UX-DR28: My Projects (H-02).** Model-focused collection of the Account's Projects.

Required states/variants: Empty, populated, search/filter if needed, locally saved, syncing, sync failed.

Source: SCREEN-INVENTORY H-02; canonical ux-contract; applicable ratified decisions.

**UX-DR29: Project/model overview (H-03).** Open a model, see current stage and Version, reach Sources and Project actions.

Required states/variants: Researching, awaiting Plan Approval, generating, awaiting Model Approval, validation failed, Export ready.

Source: SCREEN-INVENTORY H-03; canonical ux-contract; applicable ratified decisions.

**UX-DR30: Project actions (H-04).** Rename if supported, delete Project/Export, inspect history, resume next required action.

Required states/variants: Safe actions, destructive confirmation, tombstoned/cleanup state.

Source: SCREEN-INVENTORY H-04; canonical ux-contract; applicable ratified decisions.

**UX-DR31: Create entry (C-01).** Two equal first-version choices: **Enter text** and **Upload picture**.

Required states/variants: Desktop, phone, offline availability indication.

Source: SCREEN-INVENTORY C-01; canonical ux-contract; applicable ratified decisions.

**UX-DR32: Text request (C-02).** Ordinary-language model description plus optional Personalization.

Required states/variants: Empty, writing, validation problem, example/help without pre-filling intent.

Source: SCREEN-INVENTORY C-02; canonical ux-contract; applicable ratified decisions.

**UX-DR33: Picture intake (C-03).** Choose existing image; on phone, take a photo; add several angles.

Required states/variants: Permission prompt, permission denied, image previews, replace/reorder/remove, file error.

Source: SCREEN-INVENTORY C-03; canonical ux-contract; applicable ratified decisions.

**UX-DR34: Picture quality and coverage (C-04).** Explain blur, obstruction, or missing angles and recommend better/additional views.

Required states/variants: Sufficient, insufficient, additional view requested, **Generate anyway** warning.

Source: SCREEN-INVENTORY C-04; canonical ux-contract; applicable ratified decisions.

**UX-DR35: Picture path choice (C-05).** Choose direct image-derived conversion or research-assisted evidence-backed reconstruction.

Required states/variants: Plain explanation of accuracy difference, online/offline availability.

Source: SCREEN-INVENTORY C-05; canonical ux-contract; applicable ratified decisions.

**UX-DR36: Understood request (C-06).** Show subject, scope, intended outcome, picture mode, and Personalization; wait for confirmation.

Required states/variants: Clear, ambiguous with clarification questions, edit request, confirmed.

Source: SCREEN-INVENTORY C-06; canonical ux-contract; applicable ratified decisions.

**UX-DR37: Research and cache choices (C-07).** After scope confirmation, choose free/paid research and cache reuse/fresh research.

Required states/variants: Cached revision/date shown, fresh research, paid disclosure and maximum charge, limit blocked.

Source: SCREEN-INVENTORY C-07; canonical ux-contract; applicable ratified decisions.

**UX-DR38: Start confirmation (C-08).** Summarize the exact Job that will begin without duplicating Plan Approval.

Required states/variants: Ready, offline direct conversion, provider disclosure unresolved, insufficient allowance.

Source: SCREEN-INVENTORY C-08; canonical ux-contract; applicable ratified decisions.

**UX-DR39: In Progress overview (J-01).** Active research, generation, validation, repair, and sync Jobs; **Prints in Progress — Coming later**.

Required states/variants: No Jobs, several concurrent Jobs, mixed states, future-print placeholder.

Source: SCREEN-INVENTORY J-01; canonical ux-contract; applicable ratified decisions.

**UX-DR40: Job detail (J-02).** Current stage, real progress, preserved state, cost impact when known, cancel action.

Required states/variants: Waiting, running, completed, failed, cancelled, stale result rejected.

Source: SCREEN-INVENTORY J-02; canonical ux-contract; applicable ratified decisions.

**UX-DR41: Live Source activity (J-03).** Actual Sources being examined and their role as lead or evidence; no fabricated hidden reasoning.

Required states/variants: Searching, Source opened, lead, accepted evidence, rejected, replacement search.

Source: SCREEN-INVENTORY J-03; canonical ux-contract; applicable ratified decisions.

**UX-DR42: Source reader during Job (J-04).** Read original text, translation, citation, and explanation without pausing research.

Required states/variants: Hebrew/English, RTL/LTR, excerpt unavailable/digest only, loading/failure.

Source: SCREEN-INVENTORY J-04; canonical ux-contract; applicable ratified decisions.

**UX-DR43: Reject current-Project Source (J-05).** **Do not use this Source**, explain effects, continue replacement research.

Required states/variants: Confirmation, affected Claims rechecking, replacement found/not found.

Source: SCREEN-INVENTORY J-05; canonical ux-contract; applicable ratified decisions.

**UX-DR44: Research Plan overview (R-01).** Whole-Project status and grouped evidence packages for model sections.

Required states/variants: Incomplete, ready for review, approved, rejected, invalidated by successor revision.

Source: SCREEN-INVENTORY R-01; canonical ux-contract; applicable ratified decisions.

**UX-DR45: Completeness checklist (R-02).** Shape, dimensions, materials, placement, printability, historical interpretation, independent gap review.

Required states/variants: Complete, missing detail, unresolved gap, newly invalidated item.

Source: SCREEN-INVENTORY R-02; canonical ux-contract; applicable ratified decisions.

**UX-DR46: Consequential Detail review (R-03).** Claim, exact Source, reasoning, Detail Status, expected geometry effect.

Required states/variants: `sourced`, `inferred`, `disputed`, `unknown`, `user-added`.

Source: SCREEN-INVENTORY R-03; canonical ux-contract; applicable ratified decisions.

**UX-DR47: Defensible Options (R-04).** Recommended option, competing evidence, geometry effects, user's choice.

Required states/variants: Recommendation, no settled recommendation, required choice, rejected option.

Source: SCREEN-INVENTORY R-04; canonical ux-contract; applicable ratified decisions.

**UX-DR48: Plan Approval (R-05).** Approve or reject the exact Research Plan version only when complete.

Required states/variants: Blocked/not ready, review complete, approval confirmation, rejected with reason, approval invalidated.

Source: SCREEN-INVENTORY R-05; canonical ux-contract; applicable ratified decisions.

**UX-DR49: Model workspace (M-01).** Read-only 3D inspection with rotate, pan, zoom, fit/reset, standard/section views, hide/isolate, selection, and measurement.

Required states/variants: Loading, ready, degraded preview, WebGL/GPU failure, phone touch, keyboard alternatives.

Source: SCREEN-INVENTORY M-01; canonical ux-contract; applicable ratified decisions.

**UX-DR50: Model Feature evidence (M-02).** Selecting a part reveals the exact Sources, Claims, interpretation, Detail Status, approvals, and affected geometry.

Required states/variants: Sourced, disputed, user-added Personalization, now-disabled Source warning.

Source: SCREEN-INVENTORY M-02; canonical ux-contract; applicable ratified decisions.

**UX-DR51: Evidence-to-model navigation (M-03).** Select a Claim and reveal every affected Model Feature; return from feature to Claim.

Required states/variants: One-to-one, one-to-many, unavailable preview but intact provenance.

Source: SCREEN-INVENTORY M-03; canonical ux-contract; applicable ratified decisions.

**UX-DR52: Focused correction (M-04).** Explain what seems wrong and request additional evidence/research rather than manual mesh editing.

Required states/variants: Draft, affected dependencies preview, paid permission needed, submitted.

Source: SCREEN-INVENTORY M-04; canonical ux-contract; applicable ratified decisions.

**UX-DR53: Correction result (M-05).** Show revised Research Plan, changed details, dependent geometry impact, and renewed approval need.

Required states/variants: No change, evidence changed, Plan Approval required, generation blocked.

Source: SCREEN-INVENTORY M-05; canonical ux-contract; applicable ratified decisions.

**UX-DR54: Version history (M-06).** Timeline/list of immutable Model Versions with governing Plan, approvals, validation, repair, and timestamps.

Required states/variants: Current, older, restored, deleted exception.

Source: SCREEN-INVENTORY M-06; canonical ux-contract; applicable ratified decisions.

**UX-DR55: Version comparison (M-07).** Compare two Versions and identify changed versus unchanged features.

Required states/variants: Geometry change, evidence-only change, Personalization change, preview degraded.

Source: SCREEN-INVENTORY M-07; canonical ux-contract; applicable ratified decisions.

**UX-DR56: Version restoration (M-08).** Restore a Version without silently authorizing a new Export.

Required states/variants: Confirmation, restored, approval required for new Export.

Source: SCREEN-INVENTORY M-08; canonical ux-contract; applicable ratified decisions.

**UX-DR57: Model Approval (M-09).** Approve or reject the exact inspected Model Version.

Required states/variants: Not inspected, ready, approved, rejected, invalidated by later change.

Source: SCREEN-INVENTORY M-09; canonical ux-contract; applicable ratified decisions.

**UX-DR58: Target Print Profile (V-01).** Select printer, material, physical size; first fixture is Bambu Lab A1 mini, 0.4 mm nozzle, gold silk PLA, maximum 90 × 90 × 90 mm. R-3 refines this to the exact Bambu PLA Silk+ Gold profile closure and overrides in AR-11.

Required states/variants: Default fixture, changed profile, incomplete profile.

Source: SCREEN-INVENTORY V-01; canonical ux-contract; applicable ratified decisions.

**UX-DR59: Validation results (V-02).** Supported checks, profile, last checked time, pass/warning/failure/unknown; never claim universal safety.

Required states/variants: Pass, warning, blocking failure, unknown, stale after profile change.

Source: SCREEN-INVENTORY V-02; canonical ux-contract; applicable ratified decisions.

**UX-DR60: Automatic repair (V-03).** Show repair target, result, affected geometry, and whether renewed Model Approval is needed.

Required states/variants: Local repair running/succeeded/failed, substantive versus non-substantive.

Source: SCREEN-INVENTORY V-03; canonical ux-contract; applicable ratified decisions.

**UX-DR61: Full regeneration fallback (V-04).** At most one constrained attempt after local repair failure. R-11 applies the same one-attempt lineage rule to direct-image constrained reconversion.

Required states/variants: Running, new Version awaiting inspection/approval, failed and stopped.

Source: SCREEN-INVENTORY V-04; canonical ux-contract; applicable ratified decisions.

**UX-DR62: Export readiness (V-05).** Require Model Approval for the exact Version and passing validation.

Required states/variants: Blocked by approval, blocked by validation, ready.

Source: SCREEN-INVENTORY V-05; canonical ux-contract; applicable ratified decisions.

**UX-DR63: Export download (V-06).** Primary 3MF, optional STL, readable PDF Source Record.

Required states/variants: Preparing, ready, individual/package download, failed, phone file handling.

Source: SCREEN-INVENTORY V-06; canonical ux-contract; applicable ratified decisions.

**UX-DR64: Account Settings (S-01).** Language, light/dark choice, simple/technical explanation level, onboarding replay.

Required states/variants: Device-language default, manual override, RTL preview, light default/dark selected.

Source: SCREEN-INVENTORY S-01; canonical ux-contract; applicable ratified decisions.

**UX-DR65: Notification Settings (S-02).** Category-specific phone push controls while in-app history remains.

Required states/variants: Permission allowed/denied, all off, mixed categories.

Source: SCREEN-INVENTORY S-02; canonical ux-contract; applicable ratified decisions.

**UX-DR66: Disabled Sources (S-03).** Account-wide Source on/off list with provenance-safe history.

Required states/variants: Enabled, disabled, search/list empty, active Job affected, re-enabled.

Source: SCREEN-INVENTORY S-03; canonical ux-contract; applicable ratified decisions.

**UX-DR67: Disabled-Source warning setting (S-04).** Show or hide warning on completed Projects without changing provenance or Source Record.

Required states/variants: On by default, off, explanatory confirmation.

Source: SCREEN-INVENTORY S-04; canonical ux-contract; applicable ratified decisions.

**UX-DR68: Account deletion (S-05).** Fresh authentication, explicit consequences, immediate tombstone and 30-day backup removal.

Required states/variants: Confirmation, blocked/error, signed out/deletion underway.

Source: SCREEN-INVENTORY S-05; canonical ux-contract; applicable ratified decisions.

**UX-DR69: Invitation Codes (AD-01).** Unique named codes plus rotating single-use general code.

Required states/variants: Unused, used, revoked, newly rotated, copy action.

Source: SCREEN-INVENTORY AD-01; canonical ux-contract; applicable ratified decisions.

**UX-DR70: Account administration (AD-02).** Account status, disable/re-enable, no private Workspace access.

Required states/variants: Enabled, disabling, disabled, re-enabled, active Jobs cancelled.

Source: SCREEN-INVENTORY AD-02; canonical ux-contract; applicable ratified decisions.

**UX-DR71: Usage and limits (AD-03).** Per-Account paid usage, reservations, settlements, available allowance, set/reset limit.

Required states/variants: Under limit, nearly reached, reached, running Job allowed, new paid Job blocked.

Source: SCREEN-INVENTORY AD-03; canonical ux-contract; applicable ratified decisions.

**UX-DR72: Administrator recovery/security (AD-04).** Sensitive actions require fresh authentication and create audit events.

Required states/variants: Reauthentication, success, failure, session revoked.

Source: SCREEN-INVENTORY AD-04; canonical ux-contract; applicable ratified decisions.

**UX-DR73: Close instance (AD-05).** Destructive action without viewing private Workspace contents.

Required states/variants: Fresh authentication, explicit destructive confirmation, closing, complete.

Source: SCREEN-INVENTORY AD-05; canonical ux-contract; applicable ratified decisions.

### FR Coverage Map

| Requirement | Stories |
| --- | --- |
| FR-1 | 1.3 |
| FR-2 | 1.3, 1.4, 1.7, 6.9 |
| FR-3 | 1.5, 1.6, 6.9, 7.5 |
| FR-4 | 2.4, 2.5, 2.6, 2.8 |
| FR-5 | 1.7, 2.1, 2.3 |
| FR-6 | 2.7, 2.8, 3.7 |
| FR-7 | 2.10, 3.7, 7.7 |
| FR-8 | 3.1, 3.6 |
| FR-9 | 3.1, 3.2, 3.4, 3.6 |
| FR-10 | 3.3 |
| FR-11 | 3.3, 3.4 |
| FR-12 | 2.3, 3.3, 3.5 |
| FR-13 | 2.3, 3.5 |
| FR-14 | 2.5, 2.9, 3.2, 3.6, 3.7 |
| FR-15 | 4.2 |
| FR-16 | 4.2, 4.3, 7.3 |
| FR-17 | 2.1, 4.4, 7.3 |
| FR-18 | 4.6 |
| FR-19 | 4.5, 6.6 |
| FR-20 | 5.1 |
| FR-21 | 4.3, 5.2 |
| FR-22 | 5.3, 5.4, 8.4 |
| FR-23 | 5.5, 7.6 |
| FR-24 | 6.1, 7.6 |
| FR-25 | 6.2, 6.3, 7.6 |
| FR-26 | 4.3, 6.4, 7.6 |
| FR-27 | 5.5, 6.4, 7.6 |
| FR-28 | 6.5, 7.6 |
| FR-29 | 6.6, 6.7, 6.8, 6.9, 7.6 |
| FR-30 | 3.6, 7.5, 8.1, 8.2, 8.3, 8.4 |

### Additional Requirement Coverage

Every mapped requirement retains its detailed inventory conditions. Shared constraints apply to each contributing story; a row does not claim application acceptance.

| Requirement | Stories |
| --- | --- |
| SC-1 | 2.1, 2.2, 2.3, 7.1, 7.3, 7.6 |
| SC-2 | 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 8.6 |
| SC-3 | 1.2, 1.7, 2.2, 4.6, 7.3, 8.5, 8.6 |
| SC-4 | 1.2, 8.5 |
| SC-5 | 2.10, 7.7 |
| SC-6 | 3.2 |
| SC-7 | 1.2, 4.6, 8.5 |
| NFR-1 | 1.3, 1.4, 1.5, 1.6, 1.7, 2.2, 4.1, 6.9, 7.4, 7.5, 8.1, 8.2, 8.7 |
| NFR-2 | 1.1, 1.3, 1.4, 1.5, 1.6, 2.2, 2.5, 3.1, 6.7, 6.9, 8.7 |
| NFR-3 | 3.1, 3.3, 3.6, 4.1, 4.2, 4.4, 4.5, 5.2, 5.3, 5.5, 6.4, 6.5, 6.6, 6.7, 6.8, 8.7 |
| NFR-4 | 2.7, 8.6, 8.7 |
| NFR-5 | 2.6, 2.7, 4.1, 5.2, 7.4, 8.1, 8.6, 8.7 |
| NFR-6 | 4.2, 4.3, 5.2, 8.7 |
| NFR-7 | 4.1, 5.3, 5.4, 7.4, 8.4, 8.7 |
| NFR-8 | 2.7, 3.3, 3.7, 8.7 |
| NFR-9 | 2.4, 2.5, 2.6, 2.8, 3.7, 6.5, 8.7 |
| NFR-10 | 2.7, 3.7, 4.6, 7.1, 8.6, 8.7 |
| NFR-11 | 6.1, 6.2, 6.3, 6.8, 8.7 |
| NFR-12 | 3.1, 3.6, 7.5, 8.1, 8.2, 8.3, 8.4, 8.7 |
| AR-1 | 1.1 |
| AR-2 | 1.1, 4.1, 4.2 |
| AR-3 | 1.4, 1.7, 2.6, 2.7, 4.1, 7.4 |
| AR-4 | 2.1, 2.3, 3.5, 5.5, 6.8, 7.3, 7.6 |
| AR-5 | 3.4, 3.5, 4.1, 4.4, 4.5, 5.1, 5.3, 5.4, 5.5, 6.6, 6.8, 7.3, 7.4 |
| AR-6 | 2.9, 3.1, 3.2, 3.3, 3.5, 3.6, 5.1 |
| AR-7 | 2.2, 3.1 |
| AR-8 | 4.2, 4.4, 5.2 |
| AR-9 | 4.2, 4.5, 4.6, 5.2, 5.3, 5.4, 6.1 |
| AR-10 | 4.3, 5.2, 6.4 |
| AR-11 | 6.1, 6.2, 6.3 |
| AR-12 | 6.4, 6.5, 7.6 |
| AR-13 | 6.6, 6.7, 6.8, 7.6 |
| AR-14 | 2.7, 2.8, 3.7, 6.5 |
| AR-15 | 1.5, 2.7, 3.7, 5.2, 8.1 |
| AR-16 | 2.4, 2.6, 2.8, 6.5 |
| AR-17 | 2.5, 2.8, 3.7 |
| AR-18 | 1.3, 1.4, 1.5, 1.6, 8.2 |
| AR-19 | 2.2, 4.1, 5.4, 6.9 |
| AR-20 | 2.9, 3.1, 3.2, 3.6, 8.3 |
| AR-21 | 8.1, 8.2, 8.3, 8.4 |
| AR-22 | 7.1, 7.2, 7.3, 7.4, 7.6, 8.6 |
| AR-23 | 7.2, 7.5, 8.6 |
| AR-24 | 4.6, 7.1, 8.5 |
| AR-25 | 2.10, 3.7, 7.7 |
| AR-26 | 1.1, 2.7, 8.4, 8.7 |
| AR-27 | 7.1, 8.5, 8.6, 8.7 |
| AR-28 | 1.2, 8.5 |
| UX-DR1 | 1.2 |
| UX-DR2 | 1.2, 4.6, 8.5 |
| UX-DR3 | 1.2, 4.6, 8.5 |
| UX-DR4 | 1.2, 4.6, 8.5 |
| UX-DR5 | 1.2, 3.4, 6.7, 8.5 |
| UX-DR6 | 1.2, 3.4 |
| UX-DR7 | 1.2, 4.4, 4.5, 7.3 |
| UX-DR8 | 2.1, 2.3, 2.5, 2.9 |
| UX-DR9 | 2.2 |
| UX-DR10 | 2.3 |
| UX-DR11 | 3.4, 3.7 |
| UX-DR12 | 3.2 |
| UX-DR13 | 7.2, 7.3, 8.6 |
| UX-DR14 | 7.2, 7.4, 7.5, 8.6 |
| UX-DR15 | 4.6 |
| UX-DR16 | 3.5, 5.1, 5.3, 5.4, 5.5 |
| UX-DR17 | 6.1, 6.2, 6.3, 6.4, 6.5, 7.6 |
| UX-DR18 | 2.10, 7.7 |
| UX-DR19 | 2.7, 8.1, 8.2 |
| UX-DR20 | 1.2, 8.5 |
| UX-DR21 | 1.4 |
| UX-DR22 | 1.3 |
| UX-DR23 | 1.6 |
| UX-DR24 | 1.2, 1.7 |
| UX-DR25 | 2.10 |
| UX-DR26 | 1.2 |
| UX-DR27 | 1.7 |
| UX-DR28 | 1.7, 7.4 |
| UX-DR29 | 1.7 |
| UX-DR30 | 1.7, 8.1 |
| UX-DR31 | 2.1, 7.2 |
| UX-DR32 | 2.1 |
| UX-DR33 | 2.2 |
| UX-DR34 | 2.3 |
| UX-DR35 | 2.3, 7.3 |
| UX-DR36 | 2.1, 2.3 |
| UX-DR37 | 2.5, 2.9 |
| UX-DR38 | 2.3, 2.5, 2.9, 7.2 |
| UX-DR39 | 2.7, 2.10, 3.7 |
| UX-DR40 | 2.7, 2.10, 3.7 |
| UX-DR41 | 3.7 |
| UX-DR42 | 3.4 |
| UX-DR43 | 3.2 |
| UX-DR44 | 3.5 |
| UX-DR45 | 3.3 |
| UX-DR46 | 3.3, 3.4, 4.4 |
| UX-DR47 | 3.4 |
| UX-DR48 | 3.5 |
| UX-DR49 | 4.6 |
| UX-DR50 | 4.4, 4.5, 7.3 |
| UX-DR51 | 4.5 |
| UX-DR52 | 5.1 |
| UX-DR53 | 5.1 |
| UX-DR54 | 5.3 |
| UX-DR55 | 5.3 |
| UX-DR56 | 5.4 |
| UX-DR57 | 5.5, 7.6 |
| UX-DR58 | 6.1 |
| UX-DR59 | 6.2, 6.3 |
| UX-DR60 | 6.4 |
| UX-DR61 | 6.5, 7.6 |
| UX-DR62 | 6.8, 7.6 |
| UX-DR63 | 6.7, 6.8, 6.9, 7.6 |
| UX-DR64 | 1.2 |
| UX-DR65 | 7.7 |
| UX-DR66 | 3.2 |
| UX-DR67 | 3.2 |
| UX-DR68 | 8.2 |
| UX-DR69 | 1.3 |
| UX-DR70 | 1.5 |
| UX-DR71 | 2.4 |
| UX-DR72 | 1.5, 1.6 |
| UX-DR73 | 8.2 |

## Epic List

### Epic 1: Enter and use a private workspace

Invited users can authenticate and use a responsive private workspace; Josh can control and recover access without inspecting private content.

**FRs covered:** FR-1, FR-2, FR-3, FR-5

### Epic 2: Confirm requests and control background spending

Users can submit text or ordered pictures, authorize the exact work and costs, and follow durable jobs without losing approved state.

**FRs covered:** FR-4, FR-5, FR-6, FR-7, FR-12, FR-13, FR-14, FR-17

### Epic 3: Research and approve a complete evidence plan

Users can inspect authoritative evidence, control source eligibility, resolve interpretations and approve one complete reconstruction plan.

**FRs covered:** FR-6, FR-7, FR-8, FR-9, FR-10, FR-11, FR-12, FR-13, FR-14, FR-30

### Epic 4: Generate and inspect traceable canonical geometry

Approved evidence recipes produce immutable models whose features remain linked to evidence and inspectable without changing manufacturing authority.

**FRs covered:** FR-15, FR-16, FR-17, FR-18, FR-19, FR-21, FR-26

### Epic 5: Correct, compare and approve exact model versions

Users can request evidence corrections, regenerate only affected geometry, restore history and approve the exact model they inspected.

**FRs covered:** FR-20, FR-21, FR-22, FR-23, FR-27

### Epic 6: Qualify and export an evidence-backed printable model

An approved model can pass exact profile checks, receive bounded audited repair and be downloaded with immutable bilingual provenance.

**FRs covered:** FR-2, FR-3, FR-19, FR-24, FR-25, FR-26, FR-27, FR-28, FR-29

### Epic 7: Create direct models offline and synchronize safely

Prepared supported devices can create honestly labeled image-derived models offline, preserve them locally and synchronize without privacy or history loss.

**FRs covered:** FR-3, FR-7, FR-16, FR-17, FR-23, FR-24, FR-25, FR-26, FR-27, FR-28, FR-29, FR-30

### Epic 8: Delete private work and prove release readiness

Users can remove their data, Josh can close the instance, and the complete product is accepted only with real application/device and recovery evidence.

**FRs covered:** FR-22, FR-30

## Epic 1: Enter and use a private workspace

Invited users can authenticate and use a responsive private workspace; Josh can control and recover access without inspecting private content.

### Story 1.1: Bootstrap the qualified application seed

As a maintainer,
I want a reproducible application startup,
So that implementation starts from the qualified runtime.

**Requirements:** AR-1, AR-2, AR-26, NFR-2

**Dependencies:** None.

**Scope:**

- Initialize only the official pinned Next/App Router/TypeScript/Tailwind seed, Supabase SSR wiring and environment checks needed to serve an empty application.
- Define module ownership and environment boundaries; later stories introduce their own entities.

**Acceptance Criteria:**

**AC-1**

**Given** a clean checkout and the ratified package set
**When** dependencies install, typechecking and production build run
**Then** the lockfile records the adopted versions and a loopback production page responds successfully

**AC-2**

**Given** a preview environment
**When** configuration is loaded
**Then** production credentials and paid adapters are unavailable, and mixed environment identifiers fail startup

**AC-3**

**Given** the initial starter
**When** its migrations and modules are reviewed
**Then** it contains only startup needs, not all future domain tables or a claim that deployed providers are qualified

**Story contract:** [SPEC.md](../specs/spec-nova3D-story-1-1/SPEC.md).

### Story 1.2: Establish accessible localized navigation and preferences

As an Account owner,
I want consistent navigation and readable controls,
So that I can use my workspace on phone or computer.

**Requirements:** AR-28, SC-3, SC-4, SC-7, UX-DR1, UX-DR2, UX-DR3, UX-DR4, UX-DR5, UX-DR6, UX-DR7, UX-DR20, UX-DR24, UX-DR26, UX-DR64

**Dependencies:** 1.1

**Scope:**

- Implement semantic tokens and reusable focus, status, empty/error, confirmation and navigation patterns under R-10.
- Provide configured-language, light/dark and explanation preferences; every later surface inherits these patterns.

**Acceptance Criteria:**

**AC-1**

**Given** a supported device language and no override
**When** the shell first opens
**Then** it uses a configured language match, light neutral/slate/indigo styling and dismissible ordinary-language guidance

**AC-2**

**Given** an Account preference change
**When** language, explicit dark mode or technical detail is selected
**Then** the preference persists without changing evidence or decisions and guidance can be reopened

**AC-3**

**Given** keyboard, screen reader, enlarged text, high contrast, reduced motion or an RTL locale
**When** the shell and its shared controls are exercised on phone and desktop
**Then** focus, names, announcements, contrast, reflow and logical directions preserve all actions; bilingual spans remain distinct

**Story contract:** [SPEC.md](../specs/spec-nova3D-story-1-2/SPEC.md).

### Story 1.3: Create invitation-only accounts

As an invited user,
I want to register with a valid invitation,
So that my account starts in its own private workspace.

**Requirements:** FR-1, FR-2, AR-18, NFR-1, NFR-2, UX-DR22, UX-DR69

**Dependencies:** 1.1, 1.2

**Scope:**

- Implement fresh-authenticated Administrator invitation issuance/revocation and narrow idempotent registration.
- Named and current general codes are hashed, single-use and nonexpiring until used or revoked; partial Auth provisioning is unusable.

**Acceptance Criteria:**

**AC-1**

**Given** one unused invitation and concurrent registrations
**When** both attempt redemption
**Then** at most one activated Account/Workspace is created; retries return the original outcome and partial provisioning cannot sign in

**AC-2**

**Given** named codes and the current general code
**When** a code is revoked or successfully redeemed
**Then** only successful general-code redemption rotates that code; unused codes do not time-expire and existing Accounts remain valid

**AC-3**

**Given** invalid, used, revoked or guessed codes
**When** registration is attempted repeatedly
**Then** generic failures and rate limits prevent guessing, code values are not logged, and fresh-authenticated administration records an audit event

**Story contract:** [SPEC.md](../specs/spec-nova3D-story-1-3/SPEC.md).

### Story 1.4: Authenticate with live workspace isolation

As an Account owner,
I want to access only my workspace,
So that my projects and files stay private.

**Requirements:** FR-2, AR-3, AR-18, NFR-1, NFR-2, UX-DR21

**Dependencies:** 1.3

**Scope:**

- Enforce JWT plus live Account and session grant on every currently implemented private API and direct database/storage path.
- Carry ownership-scoped IDs, foreign keys and denial behavior into every subsequent module.

**Acceptance Criteria:**

**AC-1**

**Given** two Accounts and private records
**When** one tries the other Account through APIs, direct RLS paths and storage identifiers
**Then** reads and writes disclose no private content and cannot create cross-Workspace references

**AC-2**

**Given** a valid JWT with a revoked grant or inactive Account
**When** a private request arrives
**Then** live authorization rejects it even if the browser bypasses the UI

**AC-3**

**Given** invalid credentials or an Administrator session
**When** sign-in or private browsing is attempted
**Then** generic failure states are usable and the Administrator cannot impersonate, browse another Workspace or grant administrators

**Story contract:** [SPEC.md](../specs/spec-nova3D-story-1-4/SPEC.md).

### Story 1.5: Disable and re-enable account access

As an Administrator,
I want to disable an invited Account,
So that I can revoke access without deleting its work.

**Requirements:** FR-3, AR-15, AR-18, NFR-1, NFR-2, UX-DR70, UX-DR72

**Dependencies:** 1.4

**Scope:**

- Implement fresh-authenticated account-status transitions, revocable session grants and authorization epochs.
- Expose a cancellation/fencing contract that every future Job and file path must use.

**Acceptance Criteria:**

**AC-1**

**Given** an enabled invited Account with live sessions
**When** a freshly authenticated Administrator disables it
**Then** session/download authority and commit epochs revoke atomically before cancellation signals, while its Workspace is retained

**AC-2**

**Given** a revoked epoch and a late registered operation
**When** the operation attempts publication or another external step
**Then** the authority guard denies it and audit evidence records the transition without private contents

**AC-3**

**Given** a disabled Account
**When** the Administrator re-enables it
**Then** new authentication can regain access under a newer epoch; previously revoked sessions remain revoked

**Story contract:** [SPEC.md](../specs/spec-nova3D-story-1-5/SPEC.md).

### Story 1.6: Recover the sole Administrator securely

As an Administrator,
I want to recover Administrator access,
So that I can regain control without bypassing workspace privacy.

**Requirements:** FR-3, AR-18, NFR-1, NFR-2, UX-DR23, UX-DR72

**Dependencies:** 1.4, 1.5

**Scope:**

- Use a short-lived single-use verified-email recovery link and fresh authentication for sensitive actions.

**Acceptance Criteria:**

**AC-1**

**Given** the configured sole Administrator
**When** recovery is requested
**Then** only the verified email receives the protected link and the response does not expose other Workspaces

**AC-2**

**Given** an expired, used or replayed link
**When** redemption is attempted
**Then** access is denied without partial recovery

**AC-3**

**Given** a valid recovery link
**When** redemption succeeds
**Then** all prior Administrator sessions are revoked and an immutable recovery audit event is recorded

**Story contract:** [SPEC.md](../specs/spec-nova3D-story-1-6/SPEC.md).

### Story 1.7: Navigate My Projects and project state

As an Account owner,
I want to find and reopen my Projects,
So that I can resume the next required action.

**Requirements:** FR-2, FR-5, AR-3, NFR-1, SC-3, UX-DR24, UX-DR27, UX-DR28, UX-DR29, UX-DR30

**Dependencies:** 1.2, 1.4

**Scope:**

- Create Project identity and model-focused collection with My Projects, Create and In Progress.
- Expose current stage and navigation; feature-specific transitions and deletion are supplied by their owning stories.

**Acceptance Criteria:**

**AC-1**

**Given** a new Account
**When** Home opens
**Then** the three primary actions and useful empty states are visible on phone and desktop

**AC-2**

**Given** owned Projects with current stage/version metadata
**When** an item is opened
**Then** the model/stage and Sources entry are selected with the next required action reachable

**AC-3**

**Given** a stale, deleted or foreign Project link
**When** navigation resolves it
**Then** live ownership/lifecycle checks prevent disclosure and a clear unavailable state is shown

**Story contract:** [SPEC.md](../specs/spec-nova3D-story-1-7/SPEC.md).

## Epic 2: Confirm requests and control background spending

Users can submit text or ordered pictures, authorize the exact work and costs, and follow durable jobs without losing approved state.

### Story 2.1: Confirm natural-language intent and personalization

As an Account owner,
I want to describe the desired model and personal additions,
So that work starts from my confirmed intent.

**Requirements:** FR-5, FR-17, AR-4, SC-1, UX-DR8, UX-DR31, UX-DR32, UX-DR36

**Dependencies:** 1.7

**Scope:**

- Persist immutable subject, scope, outcome, mode and optional user-added personalization; clarify ambiguity before research.

**Acceptance Criteria:**

**AC-1**

**Given** an ambiguous or invalid description
**When** the user submits it
**Then** clarifications or actionable field errors appear before any research or paid step

**AC-2**

**Given** an understood request
**When** the user edits and confirms it
**Then** the exact revision records subject, scope, outcome and distinct personalization

**AC-3**

**Given** no scope confirmation
**When** start is requested
**Then** no Job begins and scope confirmation is not mistaken for Plan Approval or paid permission

**Story contract:** [SPEC.md](../specs/spec-nova3D-story-2-1/SPEC.md).

### Story 2.2: Stage ordered multi-view images privately

As an Account owner,
I want to choose images or take photos of one subject,
So that the request preserves all useful views.

**Requirements:** AR-7, AR-19, NFR-1, NFR-2, SC-1, SC-3, UX-DR9, UX-DR33

**Dependencies:** 1.4, 1.7

**Scope:**

- Implement authenticated bounded image staging, checksum/content checks and ordered image editing.

**Acceptance Criteria:**

**AC-1**

**Given** a phone with no camera permission
**When** Take photo is selected
**Then** permission is requested then; denial leaves existing-file intake usable

**AC-2**

**Given** several images of one subject
**When** images are previewed, added, replaced, reordered or removed
**Then** one immutable successor request preserves the resulting ordered digests

**AC-3**

**Given** bad files, oversize data or a foreign upload ID
**When** attachment is attempted
**Then** content/ownership/quota checks reject it; private bytes stay in lease-bounded staging and no reusable download URL is exposed

**Story contract:** [SPEC.md](../specs/spec-nova3D-story-2-2/SPEC.md).

### Story 2.3: Choose picture mode and acknowledge uncertainty

As an Account owner,
I want to choose direct conversion or evidence research,
So that I understand what the resulting geometry can claim.

**Requirements:** FR-5, FR-12, FR-13, AR-4, SC-1, UX-DR8, UX-DR10, UX-DR34, UX-DR35, UX-DR36, UX-DR38

**Dependencies:** 2.1, 2.2

**Scope:**

- Check clarity/obstruction/angle coverage and recommend useful additional views before conversion.
- Persist evidence_images versus image_direct with the appropriate confirmed-input gate.

**Acceptance Criteria:**

**AC-1**

**Given** unclear or incomplete views
**When** quality review runs
**Then** detected blur, obstruction or missing angles and useful remedies are explained

**AC-2**

**Given** incomplete direct inputs
**When** Generate anyway is selected
**Then** explicit invented/inaccurate-geometry acknowledgment is pinned to the ordered images and confirmed scope

**AC-3**

**Given** a picture-mode choice or later mode change
**When** the request is confirmed
**Then** research-assisted mode requires whole-plan approval later; direct mode has no synthetic Research Plan, and mode changes create successor requests

**Story contract:** [SPEC.md](../specs/spec-nova3D-story-2-3/SPEC.md).

### Story 2.4: Set accountable usage limits

As an Administrator,
I want to inspect and control paid usage,
So that spending stays within my allowance.

**Requirements:** FR-4, AR-16, NFR-9, UX-DR71

**Dependencies:** 1.5

**Scope:**

- Create immutable USD usage periods and Administrator limit controls; show settled usage, outstanding reservations and available allowance.

**Acceptance Criteria:**

**AC-1**

**Given** a new Account allowance period
**When** defaults are initialized
**Then** invitees receive $25 and the Administrator $50 per UTC month, recorded in integer USD microdollars

**AC-2**

**Given** outstanding liabilities and existing settlements
**When** a fresh-authenticated Administrator resets or changes a limit
**Then** the new period carries liabilities without rewriting history; already reserved work retains its reservation

**AC-3**

**Given** nearly reached or reached allowance
**When** usage is displayed
**Then** settled, reserved and available amounts reconcile; new paid work is blocked when insufficient while disable still revokes active work

**Story contract:** [SPEC.md](../specs/spec-nova3D-story-2-4/SPEC.md).

### Story 2.5: Disclose and authorize provider categories

As an Account owner,
I want to approve each billable purpose and data transfer,
So that paid work uses only the data and maximum I permitted.

**Requirements:** FR-4, FR-14, AR-17, NFR-2, NFR-9, UX-DR8, UX-DR37, UX-DR38

**Dependencies:** 2.1, 2.3, 2.4

**Scope:**

- Implement provider-neutral Anthropic/Brave adapters and permission snapshots; provider terms/rates must be verified before enablement.
- Use no paid external 3D provider or billable free-credit fallback; instance hosting/local inference remains overhead.

**Acceptance Criteria:**

**AC-1**

**Given** a confirmed research request with default permissions off
**When** a paid category is offered
**Then** provider, purpose, outbound-data categories, retention limitations and maximum are disclosed before explicit permission

**AC-2**

**Given** free-only mode or unverified/unenforceable provider terms
**When** an adapter is asked to dispatch
**Then** no billable request runs; search receives only normalized public subjects and no credentials/private raw prompts

**AC-3**

**Given** a permissioned vision/synthesis operation
**When** its outbound payload is formed
**Then** only purpose-required approved content is included, excluding unrelated Workspace data and unapproved personalization

**Engineering gates:** G-6; planning completion does not change their qualification status.

**Story contract:** [SPEC.md](../specs/spec-nova3D-story-2-5/SPEC.md).

### Story 2.6: Reserve bounded costs atomically

As an Account owner,
I want to start only work with an enforceable maximum,
So that concurrent requests cannot overspend.

**Requirements:** FR-4, AR-3, AR-16, NFR-5, NFR-9

**Dependencies:** 2.4, 2.5

**Scope:**

- Use one Usage-owned checked integer/rational calculator and immutable request/options/rate snapshots.
- Reserve against Account period, $5 parent research-Job lifetime across all attempts, and $1 external-operation ceilings in one transaction.

**Acceptance Criteria:**

**AC-1**

**Given** concurrent operations near any ceiling
**When** maximum costs are reserved
**Then** settled usage plus all outstanding reservations cannot exceed any limit; duplicate admission returns its original receipt

**AC-2**

**Given** pinned billing increments and rational rates
**When** the calculator evaluates bounded requests
**Then** it rounds upward once per operation to microdollars and rejects overflow, unknown/foreign rates and unsupported parameters

**AC-3**

**Given** an unavailable bound or insufficient allowance
**When** admission is attempted
**Then** no external side effect occurs and the user sees the exact cost block

**Engineering gates:** G-6; planning completion does not change their qualification status.

**Story contract:** [SPEC.md](../specs/spec-nova3D-story-2-6/SPEC.md).

### Story 2.7: Accept and execute durable fenced jobs

As an Account owner,
I want to continue using Projects while work runs,
So that accepted work survives navigation and failures stay controlled.

**Requirements:** FR-6, AR-3, AR-14, AR-15, AR-26, NFR-4, NFR-5, NFR-8, NFR-10, UX-DR19, UX-DR39, UX-DR40

**Dependencies:** 1.5, 2.6

**Scope:**

- Commit Job, attempt/step/operation identities, initial reservation and dispatch outbox together.
- Use signed environment-bound bounded steps, compatible worker registration and cancellation fencing; never automatically retry failed work.

**Acceptance Criteria:**

**AC-1**

**Given** an accepted Job followed by browser close or dispatcher restart
**When** dispatch resumes
**Then** committed outbox and unique receipts retain waiting/running/completed/failed/cancelled state without duplicate side effects

**AC-2**

**Given** failed research, worker lease loss or a duplicate transport delivery
**When** the configured workflow and queue are exercised
**Then** failed work stays terminal until explicit user retry; duplicates return receipts and interrupted failure preserves approved state with cause/cost/next action

**AC-3**

**Given** a signed callback with stale revision, revoked epoch, expired lease, invalid signature or wrong environment
**When** publication is attempted
**Then** it is rejected; valid requests bind nonce/digest/attempt with ≤5-minute expiry and ≤60-second skew; a missing compatible pinned worker leaves work waiting

**Story contract:** [SPEC.md](../specs/spec-nova3D-story-2-7/SPEC.md).

### Story 2.8: Reconcile ambiguous charges without replacement calls

As an Account owner,
I want to understand and settle uncertain provider costs,
So that retries cannot double-charge me.

**Requirements:** FR-4, FR-6, AR-14, AR-16, AR-17, NFR-9

**Dependencies:** 2.6, 2.7

**Scope:**

- Persist operation identity before dispatch and reconcile under that identity; user retries remain under the parent Job.

**Acceptance Criteria:**

**AC-1**

**Given** a timeout after a potentially chargeable request
**When** its outcome is uncertain
**Then** the full reservation remains and no SDK retry or replacement request is issued

**AC-2**

**Given** provider evidence, conservative maximum settlement or proven noncharge
**When** reconciliation completes
**Then** append-only settlement/release records preserve classification; later corrections append entries instead of rewriting history

**AC-3**

**Given** a retry, cancellation or allowance reset while a charge is unresolved
**When** another attempt is requested
**Then** it waits for reconciliation, releases only demonstrably unused allowance and cannot bypass the parent-Job lifetime cap

**Engineering gates:** G-6; planning completion does not change their qualification status.

**Story contract:** [SPEC.md](../specs/spec-nova3D-story-2-8/SPEC.md).

### Story 2.9: Select research payment and freshness separately

As an Account owner,
I want to choose free or paid work and reuse or fresh research,
So that scope, cost and freshness stay explicit.

**Requirements:** FR-14, AR-6, AR-20, UX-DR8, UX-DR37, UX-DR38

**Dependencies:** 2.5, 2.7

**Scope:**

- After scope confirmation present independent payment and cache/fresh choices; dispatch pins these choices.

**Acceptance Criteria:**

**AC-1**

**Given** a confirmed evidence request
**When** research settings open
**Then** free/paid and reuse/fresh are separate controls following scope confirmation

**AC-2**

**Given** a reusable eligible revision
**When** reuse is selected
**Then** the original immutable revision/date is shown without a freshness or re-verification claim

**AC-3**

**Given** fresh research, missing permission or insufficient allowance
**When** start is attempted
**Then** fresh work cannot silently substitute cached conclusions, and missing paid authority blocks dispatch

**Story contract:** [SPEC.md](../specs/spec-nova3D-story-2-9/SPEC.md).

### Story 2.10: Record actionable in-app notifications

As an Account owner,
I want to open the exact item needing attention,
So that background progress remains usable across sessions.

**Requirements:** FR-7, AR-25, SC-5, UX-DR18, UX-DR25, UX-DR39, UX-DR40

**Dependencies:** 2.7

**Scope:**

- Commit durable per-recipient event history and authorized deep links; realtime delivery is a hint.

**Acceptance Criteria:**

**AC-1**

**Given** research readiness, generation success/failure or export readiness
**When** the event is committed
**Then** one durable notification per recipient/event appears in the app-wide bar and history

**AC-2**

**Given** duplicate, missing or delayed realtime delivery
**When** the client refreshes
**Then** canonical history reconciles without losing or duplicating events

**AC-3**

**Given** an unread/read notification or deleted/foreign target
**When** it is selected
**Then** the exact live-authorized item opens or an unavailable state appears; Prints in Progress remains Coming later

**Story contract:** [SPEC.md](../specs/spec-nova3D-story-2-10/SPEC.md).

## Epic 3: Research and approve a complete evidence plan

Users can inspect authoritative evidence, control source eligibility, resolve interpretations and approve one complete reconstruction plan.

### Story 3.1: Discover and capture licensed source revisions

As an Account owner,
I want to discover relevant authoritative sources,
So that I need not locate or upload the texts myself.

**Requirements:** FR-8, FR-9, AR-6, AR-7, AR-20, NFR-2, NFR-3, NFR-12

**Dependencies:** 2.7, 2.9

**Scope:**

- Discover public sources through constrained acquisition; pin exact Middot editions and permitted evidence retention.

**Acceptance Criteria:**

**AC-1**

**Given** the altar/ramp request
**When** research begins
**Then** Middot chapter 3 governs spatial evidence with Hebrew Torat Emet 357 and English Mishnah Yomit/Joshua Kulp edition metadata pinned; supplementary sources remain labeled

**AC-2**

**Given** a retrieved passage
**When** a Source Revision is accepted
**Then** edition, passage/location, retrieval date, examined excerpt or digest, attribution and verified Public Domain/CC0/CC-BY rights are recorded before permitted body retention

**AC-3**

**Given** a low-authority page, restricted/ambiguous rights or hostile redirect/payload
**When** acquisition and eligibility run
**Then** leads cannot become accepted evidence without inspectable authorized support; size/type/redirect/private-network restrictions and citation/schema checks reject unsafe input

**Engineering gates:** G-7; planning completion does not change their qualification status.

**Story contract:** [SPEC.md](../specs/spec-nova3D-story-3-1/SPEC.md).

### Story 3.2: Control Project and Account source eligibility

As an Account owner,
I want to exclude a source locally or across my Projects,
So that research follows my source choices without rewriting history.

**Requirements:** FR-9, FR-14, AR-6, AR-20, SC-6, UX-DR12, UX-DR43, UX-DR66, UX-DR67

**Dependencies:** 3.1

**Scope:**

- Implement Project exclusions, Account toggles and versioned deterministic policy snapshots for research, cache adoption and plans.

**Acceptance Criteria:**

**AC-1**

**Given** a source used in active research
**When** Project exclusion or Account disable is applied
**Then** the effective epoch changes immediately, affected draft claims/choices are reconsidered and replacement research continues with the proper scope

**AC-2**

**Given** an attempt, cache adoption or Plan Revision
**When** policy is pinned
**Then** Account-policy revision, Project-exclusion revision and explicit source identity set determine eligibility and stale-epoch completion is rejected

**AC-3**

**Given** a completed approved Project or re-enabled source
**When** a toggle or warning preference changes
**Then** approved records and exports remain immutable; re-enable restores future eligibility and hiding warnings changes presentation only

**Story contract:** [SPEC.md](../specs/spec-nova3D-story-3-2/SPEC.md).

### Story 3.3: Account for every consequential physical detail

As an Account owner,
I want to see complete evidence and unresolved gaps,
So that I do not approve a reconstruction with hidden omissions.

**Requirements:** FR-10, FR-11, FR-12, AR-6, NFR-3, NFR-8, UX-DR45, UX-DR46

**Dependencies:** 3.1, 3.2

**Scope:**

- Build the finite subject-specific detail checklist, statuses and independent omission review; product FRs are not physical detail records.

**Acceptance Criteria:**

**AC-1**

**Given** a requested reconstruction scope
**When** completeness is assessed
**Then** shape, dimensions, materials, placement, printability and historical interpretation are accounted for with evidence or explicit sourced/inferred/disputed/unknown/user-added status

**AC-2**

**Given** a missing checklist item or unresolved independent-review gap
**When** plan readiness is evaluated
**Then** whole-plan approval is blocked until the gap is resolved; the separate omission pass is retained

**AC-3**

**Given** uncertainty or a personal addition
**When** a detail is displayed
**Then** evidence, reasoning/confidence, expected geometry effect and honest status are visible without fabricated historical detail

**Story contract:** [SPEC.md](../specs/spec-nova3D-story-3-3/SPEC.md).

### Story 3.4: Inspect sources and choose defensible interpretations

As an Account owner,
I want to compare explanations and alternatives,
So that I can select an interpretation with its geometry consequences.

**Requirements:** FR-9, FR-11, AR-5, UX-DR5, UX-DR6, UX-DR11, UX-DR42, UX-DR46, UX-DR47

**Dependencies:** 3.3

**Scope:**

- Provide original/translation/explanation reader and competing options linked to exact claims and affected details.

**Acceptance Criteria:**

**AC-1**

**Given** Hebrew and English source content
**When** the reader opens during research
**Then** original, translation, citation and explanation remain distinct and readable without pausing the Job

**AC-2**

**Given** competing defensible options
**When** the user reviews a detail
**Then** recommended and rejected options retain support, conflicts, reasoning and expected geometry effects

**AC-3**

**Given** no settled recommendation
**When** approval is considered
**Then** a required explicit choice is obtained rather than silently inventing certainty

**Story contract:** [SPEC.md](../specs/spec-nova3D-story-3-4/SPEC.md).

### Story 3.5: Approve one complete immutable Research Plan

As an Account owner,
I want to approve the complete plan once,
So that evidence-backed geometry follows my exact decisions.

**Requirements:** FR-12, FR-13, AR-4, AR-5, AR-6, UX-DR16, UX-DR44, UX-DR48

**Dependencies:** 3.3, 3.4

**Scope:**

- Group section evidence for review while retaining one whole-Project approval gate.

**Acceptance Criteria:**

**AC-1**

**Given** an incomplete plan or unsettled required choice
**When** approval or partial-section generation is requested
**Then** both are blocked even when some sections appear clear

**AC-2**

**Given** a complete checklist and independent gap pass
**When** the user approves the whole plan
**Then** the immutable exact digest, approver/time, choices and affected details are recorded

**AC-3**

**Given** a successor interpretation or policy-driven draft
**When** generation authority is checked
**Then** the successor needs renewed approval; previous approved records remain immutable and do not authorize changed content

**Story contract:** [SPEC.md](../specs/spec-nova3D-story-3-5/SPEC.md).

### Story 3.6: Admit and reuse only public-source research

As an Account owner,
I want to reuse eligible research explicitly,
So that reuse saves work without exposing anyone’s private history.

**Requirements:** FR-8, FR-9, FR-14, FR-30, AR-6, AR-20, NFR-3, NFR-12

**Dependencies:** 3.1, 3.2, 3.5

**Scope:**

- Create dedicated source-reproducible allowlisted shared records and private adoption associations.

**Acceptance Criteria:**

**AC-1**

**Given** a proposed shared cache record
**When** admission validates every field
**Then** only identified non-private source-reproducible content is admitted; user/Project IDs, prompts, uploads, decisions, personalization and geometry are rejected

**AC-2**

**Given** explicit reuse and a current source policy
**When** a revision is adopted
**Then** immutable original dates and policy snapshots are retained and excluded sources cannot support new conclusions

**AC-3**

**Given** fresh research or Project/Account deletion
**When** the cache/adoption paths execute
**Then** fresh work does not substitute cached conclusions and private associations are deleted without promoting tombstoned private data

**Story contract:** [SPEC.md](../specs/spec-nova3D-story-3-6/SPEC.md).

### Story 3.7: Show actual research activity and bounded escalation

As an Account owner,
I want to follow sources being examined and approve needed paid work,
So that background research stays understandable and controlled.

**Requirements:** FR-6, FR-7, FR-14, AR-14, AR-15, AR-17, AR-25, NFR-8, NFR-9, NFR-10, UX-DR11, UX-DR39, UX-DR40, UX-DR41

**Dependencies:** 3.1, 3.5, 3.6, 2.8, 2.10

**Scope:**

- Render recorded searching/opened/lead/accepted/rejected/replacement events and permitted escalation.

**Acceptance Criteria:**

**AC-1**

**Given** a running research Job
**When** sources are examined or replaced
**Then** actual activity and evidence-based explanations appear without fabricated hidden reasoning

**AC-2**

**Given** free research leaves a material gap
**When** paid escalation is proposed
**Then** it explains the gap and requires matching disclosure/permission and a bounded reservation before a paid operation

**AC-3**

**Given** failure, cancellation, policy change or stale inputs
**When** a step finishes
**Then** fencing preserves approved state, actionable cost/failure status is visible, and retries wait for the user and any charge reconciliation

**Story contract:** [SPEC.md](../specs/spec-nova3D-story-3-7/SPEC.md).

## Epic 4: Generate and inspect traceable canonical geometry

Approved evidence recipes produce immutable models whose features remain linked to evidence and inspectable without changing manufacturing authority.

### Story 4.1: Publish immutable artifact manifests

As an Account owner,
I want to rely on usable and restorable model files,
So that partial output cannot masquerade as a completed version.

**Requirements:** AR-2, AR-3, AR-5, AR-19, NFR-1, NFR-3, NFR-5, NFR-7

**Dependencies:** 2.2, 2.7

**Scope:**

- Implement the Artifacts-owned manifest family and coordinated verified publication; mutable staging leases are separate.

**Acceptance Criteria:**

**AC-1**

**Given** staged worker bytes and a producing activity
**When** publication commits
**Then** verified digest/length, ownership, kind, serialization version and child references form one canonical JSON manifest root

**AC-2**

**Given** a partial upload, changed bytes or revoked attempt
**When** attachment is attempted
**Then** no usable/restorable artifact is published and cleanup respects active leases

**AC-3**

**Given** approval, gateway, restoration or deletion consumers
**When** they resolve artifact identity
**Then** all use the same immutable manifest roots rather than independently interpreting object keys

**Story contract:** [SPEC.md](../specs/spec-nova3D-story-4-1/SPEC.md).

### Story 4.2: Generate the approved altar and ramp recipe

As an Account owner,
I want to generate the approved reconstruction automatically,
So that I can obtain canonical geometry without manual modeling.

**Requirements:** FR-15, FR-16, AR-2, AR-8, AR-9, NFR-3, NFR-6

**Dependencies:** 3.5, 4.1

**Scope:**

- Implement trusted declarative subject recipe and pinned native CadQuery worker for the evidence-backed altar/ramp fixture.

**Acceptance Criteria:**

**AC-1**

**Given** an exact approved evidence plan
**When** native generation executes
**Then** typed finite parameters, original-unit conversions, acyclic operations, semantic features and generator/toolchain digests produce retained BREP/STEP snapshots

**AC-2**

**Given** unapproved inputs, unsupported operations or a changed Project revision
**When** generation or publication is attempted
**Then** the trusted schema and fences reject it; models cannot supply executable scripts and extending geometry requires reviewed generator code

**AC-3**

**Given** a successful canonical result
**When** its version is recorded
**Then** recipe, settings, dependencies and source-to-parameter provenance remain authoritative in millimetres/right-handed/Z-up; STEP alone is not the recipe

**Engineering gates:** G-1; planning completion does not change their qualification status.

**Story contract:** [SPEC.md](../specs/spec-nova3D-story-4-2/SPEC.md).

### Story 4.3: Certify corresponding geometry equivalence

As an Account owner,
I want to verify that unchanged geometry stayed unchanged,
So that regeneration and minor repair cannot silently alter the model.

**Requirements:** FR-16, FR-21, FR-26, AR-10, NFR-6

**Dependencies:** 4.2

**Scope:**

- Implement a certified comparator and deliberate negative corpus independently of preview meshes.

**Acceptance Criteria:**

**AC-1**

**Given** corresponding features under the original pinned final-print transform
**When** comparison runs with the same tessellator/settings and error-bound version
**Then** feature identity, component count and closed-solid topology match; no best-fit or independent rescaling is used

**AC-2**

**Given** certified surface-distance and volume calculations
**When** equivalence is decided
**Then** bidirectional distance upper bound and bounds delta are ≤0.01 mm and relative volume delta ≤0.1% using reference absolute volume

**AC-3**

**Given** dimensional, thin-feature, hole, rotation, unit, scale or tiny/zero/ill-conditioned fixtures
**When** the regression corpus runs
**Then** inconclusive or violating results fail closed; coarse bounds/volume alone and preview LOD cannot certify equivalence

**Engineering gates:** G-2; planning completion does not change their qualification status.

**Story contract:** [SPEC.md](../specs/spec-nova3D-story-4-3/SPEC.md).

### Story 4.4: Apply clearly user-added personalization

As an Account owner,
I want to add personal details in ordinary language,
So that my additions remain distinct from historical reconstruction.

**Requirements:** FR-17, AR-5, AR-8, NFR-3, UX-DR7, UX-DR46, UX-DR50

**Dependencies:** 4.2, 4.3

**Scope:**

- Generate a personalized altar/ramp variation through the trusted recipe with explicit user-added feature provenance.

**Acceptance Criteria:**

**AC-1**

**Given** an approved reconstruction and confirmed personal addition
**When** personalization generates
**Then** the addition is a new versioned user-added feature with separate parameters and provenance

**AC-2**

**Given** an unsupported or ambiguous addition
**When** the generator evaluates it
**Then** clarification or an actionable unsupported result occurs without inventing a historical source

**AC-3**

**Given** changed visible personalization
**When** the candidate is inspected
**Then** prior exact-model approval and validation cannot authorize the changed candidate; unchanged recipe features satisfy the comparator

**Story contract:** [SPEC.md](../specs/spec-nova3D-story-4-4/SPEC.md).

### Story 4.5: Navigate reciprocal model and evidence links

As an Account owner,
I want to move between a feature and its evidence,
So that I can inspect what justifies each consequential shape.

**Requirements:** FR-19, AR-5, AR-9, NFR-3, UX-DR7, UX-DR50, UX-DR51

**Dependencies:** 4.2, 4.4

**Scope:**

- Expose stable logical feature IDs with version-specific claim/parameter bindings and reciprocal navigation.

**Acceptance Criteria:**

**AC-1**

**Given** an evidence-backed feature
**When** it is selected
**Then** exact Source/Claim, status, options, governing approval and affected geometry are visible

**AC-2**

**Given** a governing claim with one or many features
**When** it is selected
**Then** every affected feature is revealed with no orphaned links in the regression corpus

**AC-3**

**Given** a disabled source or unavailable preview
**When** existing provenance is opened
**Then** approved history stays immutable and evidence/feature lists remain accessible with the proper warning

**Engineering gates:** G-4; planning completion does not change their qualification status.

**Story contract:** [SPEC.md](../specs/spec-nova3D-story-4-5/SPEC.md).

### Story 4.6: Inspect progressive read-only models

As an Account owner,
I want to inspect shape and exact dimensions,
So that I can understand the model on phone or computer.

**Requirements:** FR-18, AR-9, AR-24, NFR-10, SC-3, SC-7, UX-DR2, UX-DR3, UX-DR4, UX-DR15, UX-DR49

**Dependencies:** 4.5

**Scope:**

- Implement rotate/pan/zoom/fit/reset, standard and section views, hide/isolate, selection and canonical measurement.
- Use semantic coarse/full GLB derivatives with explicit mm/Z-up to metres/Y-up transforms.

**Acceptance Criteria:**

**AC-1**

**Given** a model with canonical dimensions
**When** view and measurement controls are used by touch or keyboard
**Then** all required inspection actions operate and dimensions use canonical geometry or labeled exact records rather than pixels

**AC-2**

**Given** coarse and full derivatives
**When** LOD switches
**Then** semantic feature/evidence selection is preserved atomically while preview transformations never alter manufacturing content

**AC-3**

**Given** GPU/WebGL loss or a degraded preview
**When** inspection falls back
**Then** static views and semantic feature/evidence/dimension lists remain usable without claiming a passed interactive 3D benchmark

**Engineering gates:** G-5; planning completion does not change their qualification status.

**Story contract:** [SPEC.md](../specs/spec-nova3D-story-4-6/SPEC.md).

## Epic 5: Correct, compare and approve exact model versions

Users can request evidence corrections, regenerate only affected geometry, restore history and approve the exact model they inspected.

### Story 5.1: Research a focused correction

As an Account owner,
I want to explain a problem with selected features,
So that the evidence can be reconsidered without manual mesh editing.

**Requirements:** FR-20, AR-5, AR-6, UX-DR16, UX-DR52, UX-DR53

**Dependencies:** 4.6, 3.7

**Scope:**

- Link a correction to selected claims/details, preview affected dependencies and route required research through existing cost controls.

**Acceptance Criteria:**

**AC-1**

**Given** selected consequential features
**When** a plain-language correction is submitted
**Then** the issue, affected details/dependencies and requested evidence are retained

**AC-2**

**Given** new evidence changes an interpretation
**When** a correction result is produced
**Then** a successor whole plan exposes changed choices and blocks regeneration pending renewed Plan Approval

**AC-3**

**Given** research finds no change or fails
**When** the result is shown
**Then** original approved state remains intact with reasons, known cost and permitted next action

**Story contract:** [SPEC.md](../specs/spec-nova3D-story-5-1/SPEC.md).

### Story 5.2: Regenerate only the affected dependency closure

As an Account owner,
I want to apply an approved correction,
So that unrelated geometry stays within the agreed tolerance.

**Requirements:** FR-21, AR-8, AR-9, AR-10, AR-15, NFR-3, NFR-5, NFR-6

**Dependencies:** 5.1, 4.3

**Scope:**

- Rebuild the complete dependency closure from the newly approved plan into a successor immutable Model Version.

**Acceptance Criteria:**

**AC-1**

**Given** an approved corrected plan
**When** regeneration executes
**Then** every dependent feature is rebuilt and records the new activity, recipe and evidence bindings

**AC-2**

**Given** unrelated canonical features
**When** old and new versions are compared
**Then** correspondence and geometry remain within the ratified R-2 tolerance under the same pinned frame

**AC-3**

**Given** stale, cancelled or superseded correction work
**When** publication is attempted
**Then** fencing rejects it and prior versions remain available; failed generation waits for explicit retry

**Story contract:** [SPEC.md](../specs/spec-nova3D-story-5-2/SPEC.md).

### Story 5.3: Compare immutable model history

As an Account owner,
I want to compare two versions and their reasons,
So that I can see what changed and why.

**Requirements:** FR-22, AR-5, AR-9, NFR-3, NFR-7, UX-DR16, UX-DR54, UX-DR55

**Dependencies:** 5.2

**Scope:**

- Present immutable history and two-version comparison for geometry, parameters, evidence, choices, personalization, approval and validation.

**Acceptance Criteria:**

**AC-1**

**Given** two non-deleted versions
**When** comparison opens
**Then** changed and unchanged features plus every listed provenance/parameter/approval/validation dimension are distinguishable

**AC-2**

**Given** an older version
**When** its details open
**Then** exact governing inputs, artifacts, activities and timestamps resolve rather than current mutable data

**AC-3**

**Given** preview degradation or a restored event
**When** history is inspected
**Then** semantic differences remain readable and later history is retained

**Story contract:** [SPEC.md](../specs/spec-nova3D-story-5-3/SPEC.md).

### Story 5.4: Restore a version without silently authorizing export

As an Account owner,
I want to return to a previous version,
So that restoration preserves both geometry and history.

**Requirements:** FR-22, AR-5, AR-9, AR-19, NFR-7, UX-DR16, UX-DR56

**Dependencies:** 5.3

**Scope:**

- Restore verified immutable geometry and mode-appropriate provenance through a new history event.

**Acceptance Criteria:**

**AC-1**

**Given** a non-deleted version advertised as restorable
**When** restoration runs
**Then** all geometry, parameters, governing inputs, approvals, validation and personalization restore from verified manifests

**AC-2**

**Given** later versions or missing/corrupt/tombstoned content
**When** restore is requested
**Then** later history is never erased and unavailable content is not reported restored or resurrected

**AC-3**

**Given** a restored model and a new export request
**When** readiness is checked
**Then** the exact current model digest/approval and profile validation are rechecked; restoration itself grants no export authority

**Story contract:** [SPEC.md](../specs/spec-nova3D-story-5-4/SPEC.md).

### Story 5.5: Approve the exact inspected model

As an Account owner,
I want to approve or reject the model I inspected,
So that export cannot use a different candidate.

**Requirements:** FR-23, FR-27, AR-4, AR-5, NFR-3, UX-DR16, UX-DR57

**Dependencies:** 4.6, 5.3

**Scope:**

- Bind Model Approval to immutable version and canonical recipe/snapshot digest with approver/time.

**Acceptance Criteria:**

**AC-1**

**Given** a model not yet inspected or changed since inspection
**When** approval is attempted
**Then** approval is blocked and the exact required inspection is identified

**AC-2**

**Given** an inspected unchanged candidate
**When** the user approves or rejects
**Then** the exact version/digest, actor, time and outcome are retained immutably

**AC-3**

**Given** a successor, consequential repair or personalization change
**When** export authority is queried
**Then** old approval cannot authorize the changed candidate and renewed inspection/approval is required

**Story contract:** [SPEC.md](../specs/spec-nova3D-story-5-5/SPEC.md).

## Epic 6: Qualify and export an evidence-backed printable model

An approved model can pass exact profile checks, receive bounded audited repair and be downloaded with immutable bilingual provenance.

### Story 6.1: Pin the exact target print profile

As an Account owner,
I want to select printer, material and final physical size,
So that validation applies to the intended output.

**Requirements:** FR-24, AR-9, AR-11, NFR-11, UX-DR17, UX-DR58

**Dependencies:** 5.5

**Scope:**

- Pin the complete manufacturer profile inheritance plus explicit application overrides and print transform.

**Acceptance Criteria:**

**AC-1**

**Given** the initial profile
**When** it is selected
**Then** A1 mini 0.4 mm, Bambu PLA Silk+ Gold, ≤90 mm cube, 0.20 mm layers and explicit three perimeters resolve from the pinned inheritance closure

**AC-2**

**Given** profile, scale or orientation changes
**When** validation identity is computed
**Then** a new revision makes incompatible prior results stale

**AC-3**

**Given** an incomplete or unknown profile
**When** qualification is requested
**Then** missing fields are visible and qualified export is blocked without a universal safety claim

**Engineering gates:** G-3; planning completion does not change their qualification status.

**Story contract:** [SPEC.md](../specs/spec-nova3D-story-6-1/SPEC.md).

### Story 6.2: Validate manufacturing mesh structure

As an Account owner,
I want to know whether the model is a valid solid,
So that structural defects cannot reach qualified export.

**Requirements:** FR-25, AR-11, NFR-11, UX-DR17, UX-DR59

**Dependencies:** 6.1

**Scope:**

- Validate units, closure/manifoldness, outward orientation, positive/nondegenerate geometry and physical bounds on manufacturing authority.

**Acceptance Criteria:**

**AC-1**

**Given** valid and deliberately defective meshes
**When** structural validation runs
**Then** each required check records pass/warning/fail/unknown for the exact model/profile/transform/tessellation/validator identity

**AC-2**

**Given** an unsupported required check or open/nonmanifold/degenerate/out-of-bounds mesh
**When** readiness is evaluated
**Then** unknown or failure blocks qualified export with its reason

**AC-3**

**Given** a preview derivative or stale validation record
**When** it is offered as manufacturing evidence
**Then** it cannot substitute for the canonical export mesh and exact validation identity

**Engineering gates:** G-3; planning completion does not change their qualification status.

**Story contract:** [SPEC.md](../specs/spec-nova3D-story-6-2/SPEC.md).

### Story 6.3: Validate profile-specific features and support

As an Account owner,
I want to understand thin features, clearances and support needs,
So that the export meets the adopted profile checks.

**Requirements:** FR-25, AR-11, NFR-11, UX-DR17, UX-DR59

**Dependencies:** 6.2

**Scope:**

- Implement general wall/feature/clearance/relief and verified overhang/bridge support analysis, not only the local box fixture.

**Acceptance Criteria:**

**AC-1**

**Given** profile-specific feature fixtures
**When** validation measures them
**Then** wall ≥1.2 mm, isolated feature ≥0.8 mm, mating clearance ≥0.4 mm and raised/recessed relief ≥0.6 mm are enforced

**AC-2**

**Given** an overhang >45° from vertical or a bridge >5 mm
**When** support is assessed
**Then** verified support/slicing analysis is required; unsupported or unknown analysis blocks qualified export

**AC-3**

**Given** general and adversarial geometry
**When** the validator corpus runs
**Then** warnings and unknowns remain explicit with profile/time/tool identity; a successful box slice does not qualify arbitrary geometry

**Engineering gates:** G-3; planning completion does not change their qualification status.

**Story contract:** [SPEC.md](../specs/spec-nova3D-story-6-3/SPEC.md).

### Story 6.4: Perform bounded local repair with equivalence proof

As an Account owner,
I want to repair fixable defects automatically,
So that small repairs preserve approved shape and larger changes return for review.

**Requirements:** FR-26, FR-27, AR-10, AR-12, NFR-3, UX-DR17, UX-DR60

**Dependencies:** 6.3, 4.3

**Scope:**

- Create a new artifact for every byte change and audit the allowed local repair attempt before rerunning checks.

**Acceptance Criteria:**

**AC-1**

**Given** normals/winding, duplicate/zero-area faces or weldable vertices
**When** local repair runs
**Then** the repaired artifact is recorded and may retain Model Version only when certified canonical-to-repaired equivalence proves no consequential change

**AC-2**

**Given** hole filling, remeshing, thickening or dimensional change
**When** repair is proposed or performed
**Then** it is consequential, creates a successor Model Version and requires new inspection, exact approval and validation

**AC-3**

**Given** a repair succeeds or fails
**When** its outcome is published
**Then** the target, change and proof are retained; all checks rerun and bounded failure cannot loop indefinitely

**Engineering gates:** G-3; planning completion does not change their qualification status.

**Story contract:** [SPEC.md](../specs/spec-nova3D-story-6-4/SPEC.md).

### Story 6.5: Allow one lineage-bound evidence regeneration

As an Account owner,
I want to recover once after local repair fails,
So that automatic recovery has a firm limit.

**Requirements:** FR-28, AR-12, AR-14, AR-16, NFR-3, NFR-9, UX-DR17, UX-DR61

**Dependencies:** 6.4, 5.2, 2.8

**Scope:**

- Manufacturing owns an immutable validation lineage and one full_regeneration slot; this story implements the evidence-plan adapter and shared authority used later by direct reconversion.

**Acceptance Criteria:**

**AC-1**

**Given** failed local repair and an exact approved evidence plan
**When** concurrent fallback triggers arrive
**Then** one unique (lineage_id, full_regeneration) slot commits atomically with successor Job/outbox and required reservation; duplicates return its receipt

**AC-2**

**Given** a consumed slot followed by failed dispatch, cancellation, ambiguous charge, child version or retry
**When** another fallback is requested
**Then** none can rearm the slot or evade the original lineage

**AC-3**

**Given** the permitted regeneration succeeds or fails
**When** its result is processed
**Then** success preserves the original and creates a candidate needing inspection/approval/full validation; failure stops, and changed interpretations return to Plan Approval

**Engineering gates:** G-3; planning completion does not change their qualification status.

**Story contract:** [SPEC.md](../specs/spec-nova3D-story-6-5/SPEC.md).

### Story 6.6: Define and validate the shared provenance envelope

As an Account owner,
I want to retain a consistent source record with every export,
So that model and evidence remain reciprocal across runtimes.

**Requirements:** FR-19, FR-29, AR-5, AR-13, NFR-3

**Dependencies:** 4.5, 5.5, 6.5

**Scope:**

- Implement schema 1.0.0 / JSON Schema Draft 2020-12 and shared TypeScript/Python validation for the five required groups.

**Acceptance Criteria:**

**AC-1**

**Given** an export provenance document
**When** both runtimes validate it
**Then** header, evidence, approvals, geometry and manufacturing preserve all architecture-defined identities and relationships

**AC-2**

**Given** missing links, a changed model digest or incompatible schema
**When** validation runs
**Then** the envelope is rejected and no orphaned feature/claim or mismatched approval enters an export

**AC-3**

**Given** the complete evidence fixture
**When** reciprocal navigation and records are checked
**Then** exact editions/passages, choices, personalization, profile, every check and repair resolve from one immutable manifest

**Engineering gates:** G-4; planning completion does not change their qualification status.

**Story contract:** [SPEC.md](../specs/spec-nova3D-story-6-6/SPEC.md).

### Story 6.7: Render a readable bilingual PDF Source Record

As an Account owner,
I want to read the provenance outside the app,
So that the exported explanation remains legible and linked.

**Requirements:** FR-29, AR-13, NFR-2, NFR-3, UX-DR5, UX-DR63

**Dependencies:** 6.6

**Scope:**

- Render the shared immutable provenance using pinned container Playwright/Chromium and licensed Noto fonts with no external resources.

**Acceptance Criteria:**

**AC-1**

**Given** one validated immutable export envelope
**When** the PDF is rendered
**Then** Hebrew original and English translation/explanation have readable glyphs, correct order, pagination and reciprocal stable links

**AC-2**

**Given** untrusted source text or embedded script/remote-resource references
**When** rendering executes
**Then** content is escaped and remote resources/scripts cannot run

**AC-3**

**Given** the same package record
**When** PDF and structured provenance are compared
**Then** model, approvals, profile, validation, repairs and personal additions agree; no external refresh changes the source record

**Engineering gates:** G-4; planning completion does not change their qualification status.

**Story contract:** [SPEC.md](../specs/spec-nova3D-story-6-7/SPEC.md).

### Story 6.8: Assemble qualified manufacturing exports

As an Account owner,
I want to download an approved printable model with its record,
So that the file package matches the model I accepted.

**Requirements:** FR-29, AR-4, AR-5, AR-13, NFR-3, NFR-11, UX-DR62, UX-DR63

**Dependencies:** 6.3, 6.6, 6.7

**Scope:**

- Create primary 3MF, optional STL, structured provenance and PDF as one immutable qualified package.

**Acceptance Criteria:**

**AC-1**

**Given** missing exact-model approval, stale profile results or a required unknown/failure
**When** export is requested
**Then** no qualified package is emitted and the precise blocked state is shown

**AC-2**

**Given** valid exact approval and all required checks passing
**When** export commits
**Then** 3MF, optional STL, PDF and structured provenance share the approved version and manifest-root lineage

**AC-3**

**Given** repair history or personalization
**When** the package is inspected
**Then** every derivative, proof, warning, check and user-added detail remains represented without implying historical certainty or universal manufacturability

**Engineering gates:** G-3, G-4; planning completion does not change their qualification status.

**Story contract:** [SPEC.md](../specs/spec-nova3D-story-6-8/SPEC.md).

### Story 6.9: Stream private files with live revocation

As an Account owner,
I want to download my exports on phone or computer,
So that large files remain private and access stops when revoked.

**Requirements:** FR-2, FR-3, FR-29, AR-19, NFR-1, NFR-2, UX-DR63

**Dependencies:** 6.8, 4.1, 1.5

**Scope:**

- Use the container gateway for large authenticated downloads/ranges and existing staging uploads.

**Acceptance Criteria:**

**AC-1**

**Given** a large owned export
**When** download or range transfer runs
**Then** each range and each chunk of at most 1 MiB checks live session/Account/Project/artifact state; no reusable signed storage URL is exposed

**AC-2**

**Given** disable, deletion or grant revocation during transfer
**When** the next chunk is authorized
**Then** future chunks stop without cached authorization; previously delivered or in-flight bytes are not claimed recalled

**AC-3**

**Given** phone file handling, interrupted download or a foreign object
**When** the user requests files
**Then** usable preparing/ready/failed states and individual/package downloads remain private with no-store responses and lease-aware cleanup

**Story contract:** [SPEC.md](../specs/spec-nova3D-story-6-9/SPEC.md).

## Epic 7: Create direct models offline and synchronize safely

Prepared supported devices can create honestly labeled image-derived models offline, preserve them locally and synchronize without privacy or history loss.

### Story 7.1: Qualify a bounded multi-view reconstruction engine

As a maintainer,
I want to have a viable on-device conversion engine,
So that offline creation can meet the adopted device limits.

**Requirements:** AR-22, AR-24, AR-27, NFR-10, SC-1, SC-2

**Dependencies:** 2.3, 4.1

**Scope:**

- Select/adapt licensed pinned weights with ONNX Runtime Web 1.29.0 as the first browser backend; no engine is currently qualified.

**Acceptance Criteria:**

**AC-1**

**Given** a candidate model and held-out multi-view corpus
**When** license, shape/coverage and resource qualification runs
**Then** exact weights/runtime/digests and evidence establish ≤500 MiB preparation download, ≤1 GiB working memory and ≤120 s local conversion on the adopted R-5 devices

**AC-2**

**Given** no compliant candidate or missing device evidence
**When** readiness is evaluated
**Then** G-8 remains BLOCKED and the first-version scope/limits stay unchanged; backend identity-model success is not reconstruction success

**AC-3**

**Given** WebGPU/WASM execution, eviction or interruption
**When** the candidate is exercised
**Then** documented supported behavior preserves privacy and recovery without silently substituting cloud inference

**Engineering gates:** G-8; planning completion does not change their qualification status.

**Story contract:** [SPEC.md](../specs/spec-nova3D-story-7-1/SPEC.md).

### Story 7.2: Prepare a verified offline bundle

As an Account owner,
I want to prepare my device while online,
So that conversion assets are available when disconnected.

**Requirements:** AR-22, AR-23, SC-2, UX-DR13, UX-DR14, UX-DR31, UX-DR38

**Dependencies:** 7.1

**Scope:**

- Cache verified public app/model assets with Account-scoped IndexedDB metadata and OPFS private artifacts.

**Acceptance Criteria:**

**AC-1**

**Given** an online supported device and pinned bundle
**When** preparation completes
**Then** all required app/runtime/model bytes are verified and readiness records exact versions and storage state

**AC-2**

**Given** interrupted preparation, eviction, insufficient storage or missing bytes
**When** offline conversion is requested
**Then** actionable missing-preparation/storage states prevent an unverified run and never silently upload images

**AC-3**

**Given** offline preparation guidance
**When** the user prepares
**Then** online preparation/qualified export and revocation-on-reconnect are explained, including no disconnected time lease and limits on remote erasure

**Engineering gates:** G-8; planning completion does not change their qualification status.

**Story contract:** [SPEC.md](../specs/spec-nova3D-story-7-2/SPEC.md).

### Story 7.3: Convert and retain image-derived models locally

As an Account owner,
I want to generate from confirmed images without internet,
So that my direct model remains usable on its device.

**Requirements:** FR-16, FR-17, AR-4, AR-5, AR-22, SC-1, SC-2, SC-3, UX-DR7, UX-DR13, UX-DR35, UX-DR50

**Dependencies:** 7.2, 2.3, 4.1, 4.6

**Scope:**

- Execute the qualified direct engine in a dedicated worker and retain exact immutable image/scope/engine/settings/output snapshots.

**Acceptance Criteria:**

**AC-1**

**Given** verified preparation, ordered confirmed images/scope and uncertainty acknowledgment with no network
**When** direct conversion runs
**Then** a local model and provenance persist and reopen offline without network inference or a synthetic Research Plan

**AC-2**

**Given** direct features or personal additions
**When** the model is inspected
**Then** image/inference uncertainty and user-added provenance remain distinct from historically evidenced claims; identical re-inference is not promised

**AC-3**

**Given** inference interruption or failure
**When** the user returns to the Project
**Then** preserved inputs/drafts and actionable status remain, with no silent upload or paid cloud fallback

**Engineering gates:** G-8; planning completion does not change their qualification status.

**Story contract:** [SPEC.md](../specs/spec-nova3D-story-7-3/SPEC.md).

### Story 7.4: Synchronize offline drafts without overwriting history

As an Account owner,
I want to find local work in My Projects after reconnecting,
So that sync does not duplicate or discard versions.

**Requirements:** AR-3, AR-5, AR-22, NFR-1, NFR-5, NFR-7, SC-2, UX-DR14, UX-DR28

**Dependencies:** 7.3, 1.4

**Scope:**

- Import stable UUIDs only into the original authorized Account with verified artifacts and expected parent revision.

**Acceptance Criteria:**

**AC-1**

**Given** an authorized reconnect and a local draft
**When** sync is delivered more than once
**Then** one idempotent import appears in original My Projects using verified digests and stable identities

**AC-2**

**Given** a newer server version or divergent local history
**When** import checks revisions
**Then** both versions are retained for explicit conflict selection rather than silently overwriting either

**AC-3**

**Given** network/authentication uncertainty or a failed import
**When** sync stops
**Then** pending/failed/conflict state is visible and local work is not erased or attached to another Account

**Engineering gates:** G-8; planning completion does not change their qualification status.

**Story contract:** [SPEC.md](../specs/spec-nova3D-story-7-4/SPEC.md).

### Story 7.5: Enforce learned offline revocation before sync

As an Account owner,
I want to have private local state honor server authority on contact,
So that disabled or deleted work cannot be republished.

**Requirements:** FR-3, FR-30, AR-23, NFR-1, NFR-12, SC-2, UX-DR14

**Dependencies:** 7.4, 1.5

**Scope:**

- Implement permitted_local, locked_disabled and terminal tombstoned states with monotonic server revisions.

**Acceptance Criteria:**

**AC-1**

**Given** a learned Account disable
**When** contact occurs before sync/export
**Then** local work and private stores lock until a newer authoritative re-enable for the original Account

**AC-2**

**Given** a learned Account or Project tombstone
**When** authority is checked
**Then** affected private files and pending commands purge before import; deleted IDs cannot be reused

**AC-3**

**Given** older status responses, JWT refresh, Account switching, connectivity changes or timeout
**When** local state is reconsidered
**Then** none bypass known disable/deletion; uncertainty alone is not deletion, disconnected permitted drafts have no time lease and explicit sign-out clears private stores

**Engineering gates:** G-8; planning completion does not change their qualification status.

**Story contract:** [SPEC.md](../specs/spec-nova3D-story-7-5/SPEC.md).

### Story 7.6: Qualify and recover direct models through the shared lineage

As an Account owner,
I want to validate and export an image-derived model,
So that direct mode receives the same model and print gates.

**Requirements:** FR-23, FR-24, FR-25, FR-26, FR-27, FR-28, FR-29, AR-4, AR-12, AR-13, AR-22, SC-1, SC-2, UX-DR17, UX-DR57, UX-DR61, UX-DR62, UX-DR63

**Dependencies:** 7.3, 7.5, 6.5, 6.9

**Scope:**

- Integrate direct snapshots with online exact-model approval, print validation and the existing full-regeneration slot.

**Acceptance Criteria:**

**AC-1**

**Given** a synchronized direct candidate
**When** qualified export is requested
**Then** connection, trusted exact-model approval and all required profile checks are enforced; local labels or approvals do not establish server authority

**AC-2**

**Given** failed local repair and an unused shared lineage slot
**When** direct reconversion is dispatched
**Then** the unique slot and successor Job/outbox commit atomically using pinned original images/scope/engine, failed print constraints and a new settings digest

**AC-3**

**Given** an incapable engine, consumed slot or completed reconversion
**When** recovery finishes
**Then** failure stops without resetting lineage; success preserves the original and returns a new version to inspection/approval/full validation with honest direct provenance

**Engineering gates:** G-3, G-8; planning completion does not change their qualification status.

**Story contract:** [SPEC.md](../specs/spec-nova3D-story-7-6/SPEC.md).

### Story 7.7: Deliver optional private phone push

As an Account owner,
I want to receive useful phone alerts,
So that I can return to completed work without losing in-app history.

**Requirements:** FR-7, AR-25, SC-5, UX-DR18, UX-DR65

**Dependencies:** 2.10, 6.9

**Scope:**

- Implement category preferences and contextual install/permission guidance for research/generation/validation/export; printing remains inactive.

**Acceptance Criteria:**

**AC-1**

**Given** an enabled category and a committed event
**When** push delivery is attempted
**Then** payloads contain opaque references and generic category text, not private names, images or source excerpts

**AC-2**

**Given** permission denied, alerts off or failed/duplicate delivery
**When** the event is reviewed
**Then** essential in-app history remains intact and deduplicated; delivery is not falsely guaranteed

**AC-3**

**Given** a received alert
**When** it is selected
**Then** live authorization opens the exact related item or shows its unavailable state

**Story contract:** [SPEC.md](../specs/spec-nova3D-story-7-7/SPEC.md).

## Epic 8: Delete private work and prove release readiness

Users can remove their data, Josh can close the instance, and the complete product is accepted only with real application/device and recovery evidence.

### Story 8.1: Tombstone Project and Export deletion before cleanup

As an Account owner,
I want to delete selected Projects or Exports,
So that private content becomes inaccessible immediately.

**Requirements:** FR-30, AR-15, AR-21, NFR-1, NFR-5, NFR-12, UX-DR19, UX-DR30

**Dependencies:** 6.9, 7.5

**Scope:**

- Implement fresh-authenticated explicit deletion intent and manifests across record owners before best-effort cancellation/purge.

**Acceptance Criteria:**

**AC-1**

**Given** an owned Project or Export and fresh authentication
**When** explicit deletion confirmation commits
**Then** the target is hidden/tombstoned before cleanup and all dependent private paths reject access

**AC-2**

**Given** late Jobs, callbacks, uploads, imports or cache promotion
**When** they race deletion
**Then** revoked commit authority and tombstones prevent mutation or resurrection even after retries

**AC-3**

**Given** interrupted multi-store cleanup
**When** deletion resumes
**Then** the durable manifest remains retryable and distinguishes immediately inaccessible from cleanup complete

**Engineering gates:** G-9; planning completion does not change their qualification status.

**Story contract:** [SPEC.md](../specs/spec-nova3D-story-8-1/SPEC.md).

### Story 8.2: Delete an Account or close the instance

As an Account owner or sole Administrator within the applicable authority,
I want to remove my Workspace or close the service,
So that all authorized private targets enter the deletion process.

**Requirements:** FR-30, AR-18, AR-21, NFR-1, NFR-12, UX-DR19, UX-DR68, UX-DR73

**Dependencies:** 8.1, 1.6

**Scope:**

- Implement Account deletion, sole-Administrator safeguards and the separate global close-instance flow without private browsing.

**Acceptance Criteria:**

**AC-1**

**Given** a normal Account with fresh authentication
**When** whole-Account deletion is explicitly confirmed
**Then** sessions revoke and all owned private targets, jobs and pending work enter the durable deletion manifest

**AC-2**

**Given** the sole Administrator while invitees remain
**When** ordinary self-deletion is requested
**Then** it is blocked with the close-instance consequence explained rather than leaving orphaned administration

**AC-3**

**Given** a freshly authenticated Administrator
**When** close-instance destructive confirmation succeeds
**Then** all Accounts/Workspaces are tombstoned, invitations/secrets and jobs revoke globally, and cleanup proceeds without exposing private contents

**Engineering gates:** G-9; planning completion does not change their qualification status.

**Story contract:** [SPEC.md](../specs/spec-nova3D-story-8-2/SPEC.md).

### Story 8.3: Purge private records and enforce backup expiry

As an Account owner,
I want to have deletion remove controlled copies,
So that retained data does not outlive the adopted limits.

**Requirements:** FR-30, AR-20, AR-21, NFR-12

**Dependencies:** 8.2

**Scope:**

- Purge database, files, models, exports, staging, notifications, private usage/adoption associations and operational traces under the deletion manifest.

**Acceptance Criteria:**

**AC-1**

**Given** a committed deletion
**When** active cleanup runs
**Then** all controlled active private copies purge within 24 hours; immutable audit/billing records are not exempt from deletion

**AC-2**

**Given** private backups and subsequent restore/rebackup
**When** retention is applied
**Then** controlled copies expire within 30 days measured from deletion, never extended by restoration or rebackup

**AC-3**

**Given** retained shared research, aggregates and deletion exclusions
**When** retention is audited
**Then** only allowed public-source data, nonidentifying aggregates and the minimum restricted opaque-target anti-resurrection ledger remain; external/disconnected-copy limitations are disclosed accurately

**Engineering gates:** G-9; planning completion does not change their qualification status.

**Story contract:** [SPEC.md](../specs/spec-nova3D-story-8-3/SPEC.md).

### Story 8.4: Restore the service without resurrecting deleted data

As an Account owner,
I want to recover surviving work after a failure,
So that backups restore geometry and enforce every intervening deletion.

**Requirements:** FR-22, FR-30, AR-21, AR-26, NFR-7, NFR-12

**Dependencies:** 8.3

**Scope:**

- Back up database daily and objects independently; keep the restricted deletion ledger outside rollback and drill actual provisioned restore paths.

**Acceptance Criteria:**

**AC-1**

**Given** a database backup, independent artifact backups and deletions after backup
**When** a restore drill runs
**Then** the external deletion ledger replays before access opens and every surviving manifest/artifact is verified

**AC-2**

**Given** a cross-store crash or a missing/corrupt surviving object
**When** recovery executes
**Then** deleted data remains excluded and incomplete restoration is reported rather than exposed as successful

**AC-3**

**Given** the provisioned recovery setup
**When** a measured drill completes
**Then** RPO and RTO are each ≤24 hours and active-purge/backup-expiry settings and provider plans are evidenced

**Engineering gates:** G-9; planning completion does not change their qualification status.

**Story contract:** [SPEC.md](../specs/spec-nova3D-story-8-4/SPEC.md).

### Story 8.5: Qualify the complete accessible device workflow

As an Account owner,
I want to use every supported workflow on the adopted devices,
So that phone, desktop and assistive access have measured evidence.

**Requirements:** AR-24, AR-27, AR-28, SC-3, SC-4, SC-7, UX-DR2, UX-DR3, UX-DR4, UX-DR5, UX-DR20

**Dependencies:** 7.6, 7.7, 8.2

**Scope:**

- Validate all 53 already-implemented surfaces and required states with a screen-to-implementation map; this story is qualification, not a deferred UX implementation bucket.

**Acceptance Criteria:**

**AC-1**

**Given** MacBook Air M2 16 GB, Windows 11 i5-1235U/Iris Xe 16 GB, iPhone 16 Pro and Pixel 9 Pro
**When** current/previous stable desktop Chrome/Edge/Firefox, macOS/iOS Safari and Android Chrome are qualified
**Then** actual OS/browser builds and complete phone/computer flows, RTL/bilingual evidence, light/dark, keyboard/screen-reader and accessibility states are recorded

**AC-2**

**Given** a cold model cache at shaped 20 Mbps and a ≤100,000-triangle fixture
**When** open-to-interactive is measured
**Then** viewer code/network/decode and working orbit/feature-evidence navigation fit ≤5 seconds with ≤5 MB coarse and ≤20 MB full initial GLB; p95 frame time is ≤33 ms after load

**AC-3**

**Given** LOD switches, GPU loss, enlarged text, high contrast or reduced motion
**When** the full journey is exercised
**Then** selection/provenance and all semantic controls survive; headless emulation cannot substitute for hardware/accessibility acceptance

**Engineering gates:** G-5; planning completion does not change their qualification status.

**Story contract:** [SPEC.md](../specs/spec-nova3D-story-8-5/SPEC.md).

### Story 8.6: Qualify offline execution and authoritative sync

As an Account owner,
I want to rely on offline creation across supported devices,
So that storage and inference evidence covers real failures and reconnects.

**Requirements:** AR-22, AR-23, AR-27, NFR-4, NFR-5, NFR-10, SC-2, SC-3, UX-DR13, UX-DR14

**Dependencies:** 7.6, 8.5

**Scope:**

- Run the G-8 held-out multi-view, offline asset, local persistence, eviction/interruption and conflict/revocation matrix on real devices.

**Acceptance Criteria:**

**AC-1**

**Given** a prepared supported device disconnected from all network services
**When** held-out conversion and reopen tests run
**Then** the real reconstruction model satisfies the 500 MiB/1 GiB/120-second limits with honest quality/coverage and retained original bytes

**AC-2**

**Given** eviction, interruption, duplicate import, newer server work, disable or deletion
**When** the device reconnects
**Then** recorded failures preserve allowed work and prove idempotency, conflict retention, monotonic locking and purge-before-import

**AC-3**

**Given** a missing compliant engine or unrun required device case
**When** release readiness is evaluated
**Then** G-8 stays BLOCKED and full first-version release remains blocked without dropping phone/multi-view/offline scope

**Engineering gates:** G-8; planning completion does not change their qualification status.

**Story contract:** [SPEC.md](../specs/spec-nova3D-story-8-6/SPEC.md).

### Story 8.7: Prove cross-provider and first-version acceptance

As a maintainer,
I want to see evidence that the integrated product meets its contract,
So that release decisions reflect the complete application.

**Requirements:** AR-26, AR-27, NFR-1, NFR-2, NFR-3, NFR-4, NFR-5, NFR-6, NFR-7, NFR-8, NFR-9, NFR-10, NFR-11, NFR-12

**Dependencies:** 8.4, 8.5, 8.6

**Scope:**

- Record actual US East provider topology, smallest suitable paid tiers/resources and pinned compatible deployment contracts.
- Exercise all application seams and inherited PRD success/counter-metrics; retain historical probe boundaries.

**Acceptance Criteria:**

**AC-1**

**Given** staging services and actual provider settings
**When** callback, private-file, environment isolation and rollout/rollback drills run
**Then** the recorded Vercel/Supabase/Railway/Upstash topology enforces signed environment identity, consumer-before-producer evolution and redacted operational monitoring

**AC-2**

**Given** the complete evidence altar/ramp and direct/offline regression suites
**When** integrated acceptance runs
**Then** all original PRD metrics, two-account isolation, invitations, cost/retry races, stale approvals, source-policy/cache privacy, repair lineage and deletion-aware restore have required evidence

**AC-3**

**Given** the September 14 PARTIAL/BLOCKED/NOT RUN baseline
**When** release is considered
**Then** no applicable G-1–G-9 remains open; local probes, documents and a physical-box slice do not establish app acceptance, and physical printing/printer control are not required for the adopted software demonstration

**Engineering gates:** G-1, G-2, G-3, G-4, G-5, G-6, G-7, G-8, G-9; planning completion does not change their qualification status.

**Story contract:** [SPEC.md](../specs/spec-nova3D-story-8-7/SPEC.md).

## Planning Assumptions

- Story boundaries and the proposed order are delegated fast-path planning choices inferred from ratified requirements, not separately claimed user approvals.
- Evidence-backed generation and export can be implemented without waiting for the direct reconstruction engine; full first-version release still requires both picture modes and qualified offline/device behavior.
- Each story creates only the records and interfaces needed by its slice; later features inherit live authorization, immutable provenance, money, lifecycle and accessible UI contracts.
- Per-story specs have local stable CAP IDs and adopt the unchanged project-wide contract. No implementation dispatch, spec_checkpoint or done_checkpoint defaults are set in this planning run.
- Exact compatible patches, deployed resources, licensed font files and reconstruction weights remain delegated selections within adopted limits; missing qualifying evidence is engineering work, not a newly invented product question.

Per-story spec folders carry their own stable capability IDs and canonical append-only memory. The project-wide SPEC retains CAP-1–CAP-17. Implementation dispatch checkpoints are not assigned by this planning run.

[Browse all 58 story specifications](../specs/story-specs-index.md). Each spec has its own acceptance criteria, implementation constraints and canonical memory. See [validation results](story-specs-validation.md) for coverage and preservation checks.
