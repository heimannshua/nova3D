---
title: nova3D PRD
status: final
created: 2026-08-27
updated: 2026-08-27
---

# PRD: nova3D

## 0. Document Purpose

This PRD defines the first implementable nova3D milestone for Josh, its Administrator, first user, and developer, plus controlled invited Accounts. It translates the approved product brief into grouped features, stable functional requirements, cross-cutting quality requirements, explicit non-goals, testable success metrics, and a gated decision register. Technical context and supporting architecture constraints belong in `addendum.md`.

## 1. Vision

nova3D is a private, browser-based evidence-to-fabrication system that creates precise, printable 3D reconstructions without manual modelling. Its first implementation turns the descriptions of the outer altar and ramp in Mishnah tractate Middot chapter 3 into a complete model. The user directs the project, judges disputed interpretations, and inspects the result; nova3D performs research orchestration, geometry generation, validation, and versioning.

The product promises complete traceability rather than impossible historical certainty. Every consequential model detail must be supported by evidence or explicitly classified as inferred, disputed, unknown, or user-added. Research culminates in a complete interpretation plan that requires approval before geometry generation. The generated model then requires a second approval before export or, in a later release, printing.

## 2. Target User

The primary user is Josh, a first-time developer and non-modeller building nova3D as a serious solo passion project. He is also the Administrator. He needs beginner-friendly language, control over interpretive decisions, and an automatic path from a natural-language goal to a defensible print-ready file. Trusted invited users may later create isolated private workspaces through controlled registration; public registration remains unavailable.

### 2.1 Jobs To Be Done

- Turn difficult textual evidence into connected 3D geometry without learning manual modelling.
- Understand the evidence and uncertainty behind every consequential generated feature.
- Choose among defensible interpretations before they become geometry.
- Inspect, correct, personalize, version, and export a printable model without breaking its provenance.
- Build toward reliable complete-Temple models that may later be sold and printed through nova3D.

### 2.2 Non-Users for the First Milestone

The first milestone does not serve customers, collaborators inside a shared project, teams, marketplace buyers, or manual modellers. Invited accounts use separate private workspaces rather than collaborating.

### 2.3 Key User Journey

- **UJ-1. Josh turns Middot into an approved printable model.** Josh opens his private nova3D web app and starts a project by entering that he wants the altar and ramp from Middot chapter 3, including any personalization request. The app researches the evidence required for the complete model and shows its progress. When research finishes, Josh reviews every modelling decision, its sources, confidence, and available options for unclear details. He chooses the interpretations and gives the first approval. The app generates the complete model. Josh rotates and inspects it, selects parts to verify their evidence, and sends questionable parts back for focused research and regeneration. When satisfied, he gives the second approval and downloads the print-ready model with its source record. In a later release, he can send it directly to a printer.

- **UJ-2. Josh controls trusted access and cost.** Josh signs in as the Administrator, issues an Invitation Code, and gives it to a trusted person. The person uses the single-use code to create an Account and receives an isolated Workspace. Josh can see that Account's paid usage, set or reset its Usage Limit, and disable the Account without gaining routine access to its private projects. When the Account reaches its limit, running Jobs finish but new paid Jobs are blocked with an explanation.

## 3. Glossary

- **Account** — An authenticated identity with one private Workspace.
- **Administrator** — Josh's privileged Account, which controls Invitation Codes, Account status, and Usage Limits within the explicit administrative capability boundary.
- **Invitation Code** — A private single-use code required to create an Account; public registration is disabled. A code remains valid until successful use or Administrator revocation.
- **Workspace** — The private set of Projects, Sources, decisions, Models, Versions, Jobs, Exports, usage records, and Notifications belonging to one Account.
- **Project** — One requested evidence-to-model outcome and its complete history.
- **Job** — A cancellable background research, generation, validation, repair, or export activity with an explicit state.
- **Notification** — An app-wide actionable event that links to the exact Project item requiring attention.
- **Source** — An identifiable edition or revision of a work or page used as evidence or as a lead to evidence, pinned to the exact content nova3D examined.
- **Claim** — A modelling-relevant statement extracted from a Source.
- **Consequential Detail** — A property that changes Model shape, dimensions, material, placement, printability, or historical interpretation.
- **Detail Status** — Exactly one of sourced, inferred, disputed, unknown, or user-added.
- **Defensible Option** — A possible treatment of an unresolved Consequential Detail, supported and challenged by visible evidence.
- **Research Plan** — The complete Project-wide set of Claims, Consequential Details, reasoning, Defensible Options, proposed choices, and expected Model effects presented before generation.
- **Plan Approval** — The user's authorization of a specific Research Plan version to become geometry.
- **Canonical Model** — The reproducible editable representation generated from an approved Research Plan.
- **Model Feature** — A selectable part or property of a Canonical Model linked to Claims and decisions.
- **Personalization** — User-requested geometry intentionally outside the historical evidence chain.
- **Model Approval** — The user's authorization of an inspected Model Version for export or later printing.
- **Model Version** — A restorable snapshot of geometry, parameters, provenance, validations, and approvals.
- **Source Record** — A readable PDF provenance report delivered with an Export and generated from nova3D's immutable structured provenance data.
- **Cached Research Revision** — An immutable, reusable bundle containing only Claims and provenance reproducible from identified non-private Sources; a correction creates a successor revision rather than changing the original.
- **Paid Work** — Any research, generation, validation, repair, regeneration, or export operation that can incur an external-service charge.
- **Target Print Profile** — The selected printer, material, physical size, and relevant print constraints used for validation.
- **Export** — An approved 3MF print file, an optional STL compatibility copy, and the PDF Source Record.
- **Usage Limit** — An Administrator-configured paid-usage or spending boundary for an Account.

## 4. Features and Functional Requirements

### 4.1 Controlled Access, Projects, and Background Work

**Description:** Accounts use isolated Workspaces. Josh administers access and cost. Users can start Projects from natural language and continue using the app while multiple Jobs run concurrently. Realizes UJ-1 and UJ-2.

#### FR-1: Controlled account creation

The Administrator can issue and revoke Invitation Codes, and a new user can create an Account only by supplying a valid code.

**Consequences:**
- Public registration is unavailable.
- Each named invitation receives a different single-use code.
- The Administrator can also share one current general code; successful use immediately invalidates it and generates a different current code.
- Unused codes remain valid until successful use or Administrator revocation; they do not expire solely with time.
- Registration attempts are rate-limited to resist code guessing.
- Changing or revoking Invitation Codes does not invalidate existing Accounts.

#### FR-2: Authentication and workspace isolation

An Account can authenticate and access only its own Workspace.

**Consequences:**
- Cross-Account access to Projects, Sources, decisions, Models, Versions, Jobs, Exports, and Notifications is denied.
- Administrative usage controls do not expose ordinary Project content.
- The Administrator cannot impersonate an Account, browse its private Workspace, or assign additional administrative privileges through the app.

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

#### FR-5: Natural-language project intake

An Account can start a Project by describing the desired model in ordinary language without finding or uploading source texts.

**Consequences:**
- If the request permits materially different subjects, periods, scopes, or outcomes, nova3D asks clarifying questions before starting paid research.
- The user sees and confirms nova3D's understanding of the Project scope.

#### FR-6: Concurrent background jobs

An Account can use other Projects while multiple research or generation Jobs run independently.

**Consequences:**
- Each Job exposes waiting, running, completed, failed, and cancelled states.
- Project data and results cannot leak between concurrent Jobs.
- The user can cancel a Job without damaging previously approved data or Versions.
- Failed Jobs do not retry automatically; they preserve the last approved state, explain the known cause in beginner-friendly language, and wait for a user retry decision.

#### FR-7: Actionable notifications

The app displays an app-wide Notification bar for Jobs and approval events.

**Consequences:**
- Notifications cover research readiness, generation completion or failure, Export readiness, and later printer events.
- Selecting a Notification opens the exact Project, approval item, failed Job, Export, or later printer event requiring attention.

### 4.2 Evidence Research and Plan Approval

**Description:** nova3D discovers Sources from the user's confirmed goal, builds a complete evidence model, explains uncertainty, and obtains Plan Approval before generating geometry. Realizes UJ-1.

#### FR-8: Subject and source discovery

nova3D can identify the confirmed subject and locate relevant Sources without requiring the user to supply them.

**Consequences:**
- For the altar-and-ramp milestone, Mishnah tractate Middot chapter 3 is the governing spatial Source. Supplementary Sources and any resulting inferences are labelled as such.
- Claims retain the exact Source edition or revision, passage or location, retrieval date, and a captured excerpt or content digest for the content examined.
- Research may search the wider internet.

#### FR-9: Source authority policy

nova3D distinguishes research leads from evidence used in recommendations.

**Consequences:**
- Low-authority pages may be used as leads only.
- Recommendations identify and cite primary texts, recognized commentaries, books, archaeological evidence, or work by named scholars.
- Sources retain identity and enough location context for the user to inspect the support for a Claim.
- Changed Source content creates a successor Source and Cached Research Revision; it cannot silently alter an existing Claim or approved Research Plan.
- Only Claims and provenance reproducible from identified non-private Sources qualify for admission to shared cached research.

#### FR-10: Complete consequential-detail coverage

nova3D identifies every Consequential Detail needed for the complete requested Model and links it to Claims or an explicit Detail Status.

**Consequences:**
- nova3D builds a finite Project checklist covering shape, dimensions, materials, placement, printability, and historical interpretation.
- A second independent review pass searches the requested scope and Research Plan specifically for missing Consequential Details.
- The Research Plan is not ready for review while any checklist item is unaccounted for or the independent pass has an unresolved gap.
- The user can inspect the completed checklist and gap-review result before Plan Approval.
- No missing detail may be silently invented or presented as historically certain.

#### FR-11: Explainable conclusions and options

For each uncertain Consequential Detail, nova3D presents its recommendation and Defensible Options with transparent reasoning.

**Consequences:**
- The user can inspect supporting Sources, conflicting evidence, the reasoning chain, and expected geometry effects.
- Confidence is explained through evidence and reasoning rather than only an opaque score.
- If evidence cannot settle the detail, the user must choose an option.

#### FR-12: Whole-project review before generation

nova3D presents one complete Research Plan for the requested Model before any Canonical Model is generated.

**Consequences:**
- The review includes proposed choices, rejected or competing alternatives, citations, reasoning, Detail Status, and expected geometry effects.
- The review groups related Consequential Details into evidence packages for each model section while preserving one final whole-Project approval boundary.
- Apparently clear sections are not generated incrementally while other research remains unresolved.

#### FR-13: Version-bound plan approval

The user can approve or reject a specific Research Plan version.

**Consequences:**
- Geometry generation is blocked until Plan Approval exists.
- Plan Approval records the approver, time, selected and rejected options, and affected Consequential Details.
- A change to an approved Research Plan creates a new version and invalidates generation authority until that version is approved.

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

### 4.3 Automatic Geometry and Personalization

**Description:** nova3D converts one approved Research Plan into a reproducible Canonical Model and keeps Personalization distinct from historical reconstruction. Realizes UJ-1.

#### FR-15: Approved-plan generation

nova3D can generate the complete Canonical Model automatically from the approved Research Plan without manual modelling.

**Consequences:**
- Generation uses only the exact Research Plan version authorized by Plan Approval.
- Generation is blocked if approval is missing, invalidated, or belongs to another version.
- The resulting Model Version records the governing Research Plan, parameters, units, generation activity, and tool or model versions needed to explain its origin.

#### FR-16: Reproducible canonical model

nova3D preserves a Canonical Model representation from which approved geometry can be regenerated reproducibly.

**Consequences:**
- Identical approved inputs, governing tool versions, and generation settings must produce geometrically equivalent output within a defined tolerance.
- Probabilistic research or drafting output is not itself the Canonical Model.
- Exported print files do not replace or erase the Canonical Model history.

#### FR-17: Plain-language personalization

The user can include or change Personalization through ordinary language, such as adding a name.

**Consequences:**
- Personalization is generated automatically without manual mesh editing.
- Every personalized Model Feature is visibly classified as user-added and cannot inherit evidence-backed status.
- Personalization must participate in inspection, versioning, Model Approval, and print validation.

### 4.4 Inspection, Correction, and Version Control

**Description:** The user inspects generated geometry and provenance, requests evidence-led corrections, compares outcomes, and gives the second approval. Realizes UJ-1.

#### FR-18: Read-only model inspection

The user can inspect a Model Version without manual geometry editing.

**Consequences:**
- Inspection supports rotating, panning, zooming, fitting or resetting the view, selecting standard or section views, hiding or isolating features, and measuring dimensions.
- Preview geometry is identified as a viewing representation and is not presented as proof of printability.

#### FR-19: Feature-level evidence inspection

The user can select a Model Feature and inspect its complete evidence and decision context.

**Consequences:**
- The view includes linked Claims, Sources, Detail Status, supporting and conflicting evidence, reasoning, selected and rejected options, confidence explanation, Plan Approval, and the affected parameters.
- Navigation is bidirectional: a Model Feature reveals its Claims, and a Claim reveals every affected Model Feature.
- Evidence links remain stable through regeneration and Version restoration.

#### FR-20: Focused correction request

The user can select a questionable Model Feature and request targeted additional research or correction.

**Consequences:**
- nova3D opens a correction flow scoped to the linked Claims and affected Consequential Details.
- Changed interpretations require a new Research Plan version and Plan Approval before regeneration.

#### FR-21: Dependency-aware regeneration

nova3D can regenerate every Model Feature affected by an approved correction.

**Consequences:**
- All dependent geometry is rebuilt.
- Unrelated geometry remains geometrically unchanged within the defined reproducibility tolerance.
- The regenerated output is a new Model Version with intact provenance.

#### FR-22: Restorable version history

The user can view, compare, and restore prior Model Versions.

**Consequences:**
- Each Version preserves geometry, parameters, Research Plan, approvals, validations, Personalization, and generation metadata.
- Comparing two Versions shows changed geometry, parameters, Claims, interpretation decisions, Personalization, approvals, and validation results.
- Restoring a Version does not erase later history.
- A restored Version retains its original approval states; the user must grant any approval required for a new Export.

#### FR-23: Version-bound model approval

The user can approve or reject a specific inspected Model Version.

**Consequences:**
- Export is blocked until Model Approval exists for the exact Model Version.
- Geometry or Personalization changes invalidate Model Approval for the changed Version.
- Model Approval records the approver and time.

### 4.5 Print Validation, Repair, and Export

**Description:** nova3D qualifies one approved Model Version against a named print setup, repairs fixable issues, and produces an Export without claiming universal manufacturability. Realizes UJ-1.

#### FR-24: Target print profile

Before validation, the user selects the intended printer, material, and physical model size as the Target Print Profile.

**Consequences:**
- The MVP fixture profile is a Bambu Lab A1 mini with its standard 0.4 mm nozzle, gold silk PLA, and a maximum 90 × 90 × 90 mm model envelope.
- Validation results and the Source Record identify the exact Target Print Profile.
- A change to the Target Print Profile requires validation to run again.

#### FR-25: Profile-qualified print validation

nova3D validates the approved Model Version against geometric and Target Print Profile requirements.

**Consequences:**
- Geometric checks include explicit units, closed volume, manifold edges, outward orientation, positive volume, and nondegenerate geometry.
- Profile checks include build envelope, minimum wall or feature size, clearances, material assumptions, and any supported orientation or support constraints.
- Results distinguish passing checks, warnings, blocking failures, and unknowns.
- A passing result is described as validated for the named Target Print Profile, not as a universal guarantee of manufacturability or safety.

#### FR-26: Immediate automatic repair

When validation finds a fixable blocking failure, nova3D attempts an immediate repair and reruns all affected validation checks.

**Consequences:**
- Every repair records the detected problem, action taken, affected Model Features, and before-and-after result.
- If local repair fails, nova3D proceeds to FR-28 rather than looping indefinitely.

#### FR-27: Approval after substantive repair

If a repair changes visible geometry, historical dimensions, or Personalization, nova3D creates a new Model Version and requires inspection and Model Approval again.

**Consequences:**
- Export remains blocked until the repaired Version is approved and passes validation.
- Repairs that do not change those properties still remain in the validation audit history.

#### FR-28: Constrained full regeneration

If local repair cannot resolve printability, nova3D performs at most one full regeneration from the approved Research Plan using the Target Print Profile and failed validation constraints.

**Consequences:**
- The original Model Version and evidence chain remain available.
- The regenerated Model is a new Version requiring inspection, Model Approval, and validation.
- If that Version still fails, nova3D stops, explains the remaining problems, preserves every Version, and waits for the user to decide; no further automatic loop occurs.

#### FR-29: Model and provenance export

The user can download an Export for a Model Version that has Model Approval and a passing validation result.

**Consequences:**
- The Export contains a 3MF file as its primary print-ready model, offers an optional STL compatibility copy, and includes a readable PDF Source Record.
- The Source Record identifies the Project, Research Plan, Consequential Details, Claims, Sources, reasoning, options, approvals, Personalization, Canonical Model identity, Model Version, Target Print Profile, validations, and repairs.
- The PDF uses stable identifiers and cross-references so the user can trace Claims to Model Features and Model Features back to Claims; it is generated from the same immutable structured provenance used by the app.
- The Export remains linked to its Source Record and structured provenance even though the print file may not contain editable parametric history.

### 4.6 Project Deletion and Shared Research Reuse

**Description:** Accounts can remove private Project artifacts or their complete Account and Workspace while nova3D retains only reusable source-derived research that cannot reveal user activity.

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

## 5. Non-Goals

- Manual geometry or mesh editing.
- Guaranteed historical truth where evidence is incomplete or disputed.
- Complete Temple and utensil generation in the MVP.
- Direct printer connection, job submission, printer queues, filament tracking, settings, or cameras in the MVP.
- Direct picture-to-model or research-assisted picture reconstruction in the MVP.
- Support for unrelated research domains in the MVP.
- Shared Projects, real-time collaboration, teams, public registration, billing, storefronts, marketplace functions, or sales-listing generation.
- Commercial source-licensing assessment; nova3D records provenance, while users remain responsible for licensing decisions.
- Structural, safety, or universal manufacturability certification.
- Using probabilistic text-to-mesh output as the authoritative Canonical Model.

## 6. MVP Scope

### 6.1 In Scope

- Controlled Accounts, private Workspaces, Administrator controls, and Usage Limits.
- Natural-language Project creation for the outer altar and ramp from Middot chapter 3.
- Clarification of ambiguous requests before paid work begins.
- Per-Project free-only or paid research choice and cache-reuse or fresh-research choice.
- Concurrent cancellable Jobs, explicit states, transparent failure handling, and actionable in-app Notifications.
- Automatic source discovery, authority filtering, Claim extraction, Consequential Detail coverage, explainable uncertainty, and complete Research Plan review.
- Plan Approval before generation.
- Automatic reproducible Canonical Model generation with plain-language Personalization.
- Read-only inspection, feature-level evidence, focused correction, dependent regeneration, and restorable Versions.
- Model Approval before export.
- Target Print Profile selection, validation, automatic repair, one bounded full-regeneration fallback, and audit history.
- Downloadable print-ready model file and Source Record.
- Private Project or whole-Account deletion with privacy-preserving shared reuse of source-derived research.

### 6.2 Out of Scope for MVP

- Complete Temple and utensil generation — follows proof of the altar-and-ramp integrity chain.
- Printer integration and fleet control — follows reliable model generation and validation.
- Picture workflows — follow reliable text-led generation.
- Other research domains and model categories — follow the Temple domain.
- Commercial sales workflow — follows repeatable quality across multiple outputs.

## 7. Cross-Cutting Non-Functional Requirements

- **NFR-1 — Workspace privacy:** Every user-facing and background operation enforces Account ownership. Cross-Account access to private Workspace data must produce no data disclosure.
- **NFR-2 — Secret protection:** Login, Invitation Code, recovery, provider, database, queue, signing, and callback-verification secrets are never stored or logged in readable form or exposed through browsers, URLs, prompts, Jobs, Notifications, Source Records, or Exports. Sensitive authentication actions require secure transport and protected sessions. Secrets support redaction, rotation, and revocation.
- **NFR-3 — Provenance integrity:** Sources, Cached Research Revisions, Claims, decisions, approvals, repairs, validations, and derivative artifacts retain immutable identity, timestamps, actor, and version relationships. Every Claim pins the exact Source edition or revision, passage, retrieval date, and captured excerpt or content digest examined. Corrections and changed Source content use successor versions rather than mutation. Later printer integration cannot alter the approved evidence-to-geometry record.
- **NFR-4 — Durable job state:** Closing the browser, navigating to another Project, or a worker restart cannot lose an accepted Job, corrupt its Project, or misreport its final state.
- **NFR-5 — Safe concurrency:** Concurrent Jobs remain isolated and cannot overwrite newer approved Project state. Results generated from stale inputs cannot silently become current.
- **NFR-6 — Reproducibility:** Given fixed approved inputs, tool versions, and settings, nova3D reproduces geometrically equivalent Canonical Models within the tolerance ratified through AD-2.
- **NFR-7 — Version durability:** Every Version presented as restorable must restore its geometry and provenance successfully. Deletion under FR-30 is the explicit exception.
- **NFR-8 — Explainable failures:** User-facing failures identify the failed stage, known cause, preserved state, cost impact where known, and permitted next action in beginner-friendly language.
- **NFR-9 — Cost control:** Paid Work cannot begin without category-specific Project permission, a disclosed maximum charge, and an atomic cost reservation within the available Usage Limit. Usage records, reservations, settlements, and releases must reconcile with each idempotent Job. nova3D must present the resulting spending record clearly enough for Josh to understand and control spending.
- **NFR-10 — Responsive workspace:** Research, generation, validation, repair, and export run without blocking navigation or ordinary Project inspection. Browser preview degradation or failure cannot damage manufacturing geometry.
- **NFR-11 — Honest print qualification:** Validation labels always identify the Target Print Profile, warnings, failures, unknowns, and last validation time; nova3D never presents validation as safety or universal manufacturability certification.
- **NFR-12 — Privacy-preserving cache and deletion:** Shared cached research contains only fields reproducible from identified non-private Sources and cannot expose user identity, private inputs, decisions, or deleted artifacts. Admission rejects all user- and Project-derived fields. Project or whole-Account deletion takes effect immediately through durable tombstones. It blocks late writes and cache promotion, promptly removes active private data, removes remaining copies from operational backups within 30 days, and remains enforced after backup restoration.

## 8. Success Metrics

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

## 9. Decision Register

### 9.1 Resolved Product Decisions

- **D-1 — Export package:** 3MF is the primary print-ready file, STL is an optional compatibility copy, and the Source Record is a readable PDF generated from immutable structured provenance.
- **D-2 — Administrator recovery:** The sole Administrator recovers access through a short-lived, single-use link sent to the verified Administrator email. Success revokes all existing Administrator sessions and creates an immutable audit event.
- **D-3 — Private deletion:** FR-30 private data is removed from operational backups within 30 days; durable deletion tombstones prevent restoration or late Jobs from resurrecting it. The implementation must define an auditable verification procedure before deletion work begins.

### 9.2 Phase-Blocking Architecture Decisions

These are not optional implementation details. The named owner must propose a measurable contract and Josh must ratify it at the stated gate.

| ID | Decision required | Owner | Ratification gate | Affected requirements |
|---|---|---|---|---|
| AD-1 | Canonical geometry representation, deterministic toolchain, and execution boundary | Architecture | Before generation and Version stories are accepted for implementation | FR-15–FR-22, NFR-3, NFR-6 |
| AD-2 | Geometric equivalence method and tolerance for regeneration and unaffected geometry | Architecture | Before the first reproducibility test corpus is accepted | FR-16, FR-21, SM-4, SM-6, NFR-6 |
| AD-3 | Exact wall, feature, clearance, orientation, support, and related rules for the approved Bambu Lab A1 mini fixture profile | Architecture with research evidence | Before validation or repair stories are accepted for implementation | FR-24–FR-29, SM-5, NFR-11 |
| AD-4 | Structured provenance schema that generates the approved PDF Source Record | Architecture | Before export stories are accepted for implementation | FR-19, FR-29, SM-10, NFR-3 |
| AD-5 | Supported desktop browsers, fixture complexity tier, and measurable viewer performance/degradation targets | UX and Architecture | Before viewer stories are accepted for implementation | FR-17, FR-18, NFR-10 |
| AD-6 | Provider-specific estimation, reservation, settlement, reconciliation, and manual reset rules for each Paid Work category | Architecture | Before any Paid Work story is accepted for implementation | FR-4, FR-14, SM-9, NFR-9 |
| AD-7 | Source-content retention allowlist, including when to retain a minimal excerpt versus only a content digest, under source licences and terms | Product and Architecture | Before shared-cache ingestion is accepted for implementation | FR-8, FR-9, FR-30, NFR-3, NFR-12 |

## 10. Assumptions Index

No unresolved inline product assumptions are included. Phase-blocking technical decisions, owners, and ratification gates are tracked in §9, with supporting context in `addendum.md`.
