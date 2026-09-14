---
title: nova3D PRD
status: final
created: 2026-08-27
updated: 2026-08-31
amendments:
  - date: 2026-08-31
    scope: print pipeline
    record: ../../ux-designs/ux-nova3D-2026-08-27/SCOPE-CHANGE-print.md
  - date: 2026-08-31
    scope: UX scope changes SC-1 to SC-7
    record: ../../ux-designs/ux-nova3D-2026-08-27/UX-SCOPE-CHANGES.md
---

# PRD: nova3D

## 0. Document Purpose

This PRD defines the first implementable nova3D milestone for Josh, its Administrator, first user, and developer, plus controlled invited Accounts. It translates the approved product brief into grouped features, stable functional requirements, cross-cutting quality requirements, explicit non-goals, testable success metrics, and a gated decision register. Technical context and supporting architecture constraints belong in `addendum.md`.

### 0.1 Amendment — print pipeline, 31 August 2026

This PRD is **amended**, not superseded. The change is recorded in `../../ux-designs/ux-nova3D-2026-08-27/SCOPE-CHANGE-print.md` and is authoritative over any earlier statement in this document.

nova3D previously stopped at a validated Export and never sliced or controlled a printer. It now goes the whole way to the finished object: it slices, arranges the build plate, sends the job, controls the machine, and watches the print through the camera. Export still exists and is never blocked — it is one exit among several rather than the end of the product.

The evidence contract is unchanged and the print pipeline is subordinate to it. Plan Approval still gates all geometry generation; Model Approval still gates all printing. Nothing about printing may alter a Detail Status.

Amended in place: §1, §2.3 (UJ-1), §3, FR-7, §4.5, §5, §6.1, §6.2, NFR-3, SM-1, SM-3, SM-5. Added: §4.7 (FR-31–FR-38), NFR-13–NFR-15, SM-11–SM-12, D-4, AD-8–AD-12.

Requirement numbering below FR-30 is unchanged so that existing story, metric, and architecture references stay valid.

### 0.2 Amendment — UX scope changes SC-1 to SC-7, 31 August 2026

This PRD is likewise **amended** to absorb the seven scope changes approved during UX discovery and recorded in `../../ux-designs/ux-nova3D-2026-08-27/UX-SCOPE-CHANGES.md`, which is authoritative over any earlier statement in this document. They were approved after this PRD reached `status: final` and had not previously been reflected here.

| | Change | Effect |
| --- | --- | --- |
| SC-1 | Picture workflows move into the first version | Was a non-goal. Now in scope, both direct and research-assisted |
| SC-2 | Direct picture conversion works offline | New capability with a sync contract |
| SC-3 | Complete phone workflow | Phone is not a reduced companion |
| SC-4 | Internationalized interface | Any configured language, including full RTL |
| SC-5 | Phone push notifications | Category controls in Account Settings |
| SC-6 | Source exclusion controls | Per-Project rejection and Account-wide disabling, kept distinct |
| SC-7 | First-version accessibility and preferences | WCAG 2.2 AA target |

Amended in place: §3, FR-5, FR-7, FR-9, §5, §6.1, §6.2. Added: §4.8 (FR-39–FR-42), §4.9 (FR-43–FR-44), §4.10 (FR-45–FR-47), NFR-16–NFR-19, SM-13–SM-16, SM-C7, D-5, AD-13–AD-16.

Requirement numbering below FR-39 is unchanged.

## 1. Vision

nova3D is a private, browser-based evidence-to-fabrication system that creates precise, printable 3D reconstructions without manual modelling. Its first implementation turns the descriptions of the outer altar and ramp in Mishnah tractate Middot chapter 3 into a complete model. The user directs the project, judges disputed interpretations, and inspects the result; nova3D performs research orchestration, geometry generation, validation, and versioning.

The product promises complete traceability rather than impossible historical certainty. Every consequential model detail must be supported by evidence or explicitly classified as inferred, disputed, unknown, or user-added. Research culminates in a complete interpretation plan that requires approval before geometry generation. The generated model then requires a second approval before export or printing.

nova3D carries the approved model through to the physical object: it prepares and slices it, arranges the build plate, sends the job to the printer, controls the machine, and watches the print. It never claims that a print will succeed, and it never lets printing rewrite the reconstruction.

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

- **UJ-1. Josh turns Middot into an approved printable model.** Josh opens his private nova3D web app and starts a project by entering that he wants the altar and ramp from Middot chapter 3, including any personalization request. The app researches the evidence required for the complete model and shows its progress. When research finishes, Josh reviews every modelling decision, its sources, confidence, and available options for unclear details. He chooses the interpretations and gives the first approval. The app generates the complete model. Josh rotates and inspects it, selects parts to verify their evidence, and sends questionable parts back for focused research and regeneration. When satisfied, he gives the second approval and either downloads the print-ready model with its source record or prints it. nova3D finds his printer, prepares the model, tells him which fixes are printing-only and which would touch the reconstruction, arranges the plate, slices, states the time and material cost, and sends the job. While it prints, nova3D controls the machine and watches through the camera; if the print looks like it is failing, it pauses and tells him what it saw. The print record attaches to the Version, so the object on his shelf traces back to its evidence.

- **UJ-2. Josh controls trusted access and cost.** Josh signs in as the Administrator, issues an Invitation Code, and gives it to a trusted person. The person uses the single-use code to create an Account and receives an isolated Workspace. Josh can see that Account's paid usage, set or reset its Usage Limit, and disable the Account without gaining routine access to its private projects. When the Account reaches its limit, running Jobs finish but new paid Jobs are blocked with an explanation.

## 3. Glossary

- **Account** — An authenticated identity with one private Workspace.
- **Administrator** — Josh's privileged Account, which controls Invitation Codes, Account status, and Usage Limits within the explicit administrative capability boundary.
- **Invitation Code** — A private single-use code required to create an Account; public registration is disabled. A code remains valid until successful use or Administrator revocation.
- **Workspace** — The private set of Projects, Sources, decisions, Models, Versions, Jobs, Exports, usage records, and Notifications belonging to one Account.
- **Project** — One requested evidence-to-model outcome and its complete history.
- **Job** — A cancellable background research, generation, validation, repair, export, slice, or print activity with an explicit state.
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
- **Model Approval** — The user's authorization of an inspected Model Version for export or printing.
- **Model Version** — A restorable snapshot of geometry, parameters, provenance, validations, and approvals.
- **Source Record** — A readable PDF provenance report delivered with an Export and generated from nova3D's immutable structured provenance data.
- **Cached Research Revision** — An immutable, reusable bundle containing only Claims and provenance reproducible from identified non-private Sources; a correction creates a successor revision rather than changing the original.
- **Paid Work** — Any research, generation, validation, repair, regeneration, or export operation that can incur an external-service charge.
- **Target Print Profile** — The selected printer, material, physical size, and relevant print constraints used for validation and slicing. The printer is normally discovered automatically; adding one by hand is the exception path.
- **Export** — An approved 3MF print file, an optional STL compatibility copy, and the PDF Source Record.
- **Usage Limit** — An Administrator-configured paid-usage or spending boundary for an Account.
- **Printing-Only Fix** — An automatic change that affects printability alone — orientation, supports, brim, plate placement, or a surface fault that is not a described feature. Always listed, always reversible with an Undo.
- **Evidence Collision** — A conflict between printability and an evidence-backed dimension. nova3D never resolves one automatically; it asks, and records the choice in the Source Record.
- **Slice** — The machine instructions produced from an approved Model Version for a specific Target Print Profile, including layer count, estimated duration, and estimated material.
- **Print Job** — A cancellable Job that sends a Slice to a printer and tracks it to completion, stoppage, or failure.
- **Watching** — Frame-by-frame camera checking of a running Print Job that pauses the print and notifies when it detects a likely failure. Distinct from a live camera view, which only shows the print.
- **Image-Derived Project** — A Project whose geometry came from photographs rather than evidence. Permanently labelled *image-derived — not historically verified*; the label cannot be removed.
- **Rejected Source** — A Source excluded from one Project. Research continues without it and seeks replacement evidence.
- **Disabled Source** — A Source switched off across Projects in Account Settings. Distinct from a Rejected Source and never implied by one.
- **Print Record** — The durable record of one Print Job — printer, Slice, material type and colour, size printed, duration, pauses, camera findings, and outcome — attached to the Model Version it printed.

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
- Describing the subject and photographing it are two equal entry points; picture intake is specified in §4.8.

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
- Notifications cover research readiness, generation completion or failure, Export readiness, slice completion, print start, print completion, print failure, and detected print problems.
- Selecting a Notification opens the exact Project, approval item, failed Job, Export, Print Job, or print problem requiring attention.
- A detected print problem is always a Notification that needs a decision, never an informational one.
- Notifications distinguish those needing a decision from those for information.
- The same events can reach the user as phone push notifications under FR-46; in-app Notification history remains complete whether or not push is enabled.

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
- The user can exclude a Source from the current Project or disable it across Projects; these are distinct controls, specified in §4.9.

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
- Export and sending a print are both blocked until Model Approval exists for the exact Model Version.
- Geometry or Personalization changes invalidate Model Approval for the changed Version. A Slice produced from the invalidated Version cannot be sent.
- Model Approval records the approver and time.

### 4.5 Print Validation, Repair, and Export

**Description:** nova3D qualifies one approved Model Version against a named print setup, repairs fixable issues, and produces an Export without claiming universal manufacturability. Export is never blocked by the print pipeline in §4.7. Realizes UJ-1.

#### FR-24: Target print profile

Before validation, the user selects the intended printer, material, and physical model size as the Target Print Profile.

**Consequences:**
- nova3D discovers available printers automatically across the local network and any signed-in maker account, and offers them as Target Print Profiles. Adding a printer by hand remains available as the exception path.
- The MVP fixture profile is a Bambu Lab A1 mini with its standard 0.4 mm nozzle, gold silk PLA, and a maximum 90 × 90 × 90 mm model envelope.
- Validation results, the Slice, the Print Record, and the Source Record identify the exact Target Print Profile.
- A change to the Target Print Profile requires validation to run again, and invalidates any Slice produced from the previous profile.

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
- Export and printing both remain blocked until the repaired Version is approved and passes validation.
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

### 4.7 Print Preparation, Printing, and Monitoring

**Description:** nova3D takes an approved, validated Model Version to a finished physical object — preparing, slicing, sending, controlling, and watching the print — without ever altering the reconstruction to do it. Added by the print scope change of 31 August 2026. Realizes UJ-1.

These requirements are subordinate to the evidence contract. Model Approval gates every requirement in this section. Nothing here may alter a Detail Status, a Claim, a Model Feature, or an approval.

#### FR-31: Automatic printer discovery and selection

nova3D finds printers automatically and presents them for selection; manual addition is the exception path.

**Consequences:**
- Discovery covers the local network and any signed-in maker account.
- Each discovered printer states its model, connection state, camera presence, and whether nova3D can control it.
- A printer nova3D can see but not control says so, and states what remains available.
- Offline, nova3D lists previously known printers and states that sending is unavailable.

#### FR-32: Model preparation with a stated boundary

nova3D fixes printing-only problems automatically and states exactly what it did not touch.

**Consequences:**
- Printing-Only Fixes cover orientation, supports, brim, plate placement, and surface faults that are not described features.
- Every Printing-Only Fix is listed individually with an Undo.
- Reconstruction geometry — any dimension, Model Feature, or proportion — is never altered automatically, and the boundary is shown rather than footnoted.
- Preparation creates no new Model Version and requires no re-approval, because it changes no reconstruction geometry.

#### FR-33: Evidence-versus-printability decisions

Where printability and an evidence-backed dimension collide, nova3D stops and asks. Every time.

**Consequences:**
- Neither option is preselected.
- Each option states its cost to the reconstruction and its cost to the print in ordinary language.
- The decision, its alternatives, and the reasoning are recorded in the Source Record.
- Choosing to alter an evidence-backed dimension creates a new Model Version and requires Model Approval again.
- nova3D never resolves an Evidence Collision automatically, and never carries a previous collision decision forward silently into a new Version.

#### FR-34: Build plate arrangement and slicing

nova3D arranges the build plate and slices the prepared model for the Target Print Profile.

**Consequences:**
- Arrangement states placement and orientation consequences before slicing.
- A completed Slice reports layer count, estimated duration, and estimated material, each labelled as an estimate from the slicer.
- Slicing runs as a Job and does not block navigation.
- A Slice is bound to one Model Version and one Target Print Profile; either changing invalidates it.
- Slicing an approved Version is available offline for an already-known printer.

#### FR-35: Filament verification

nova3D reads filament colour and type from each spool and checks them against the Slice.

**Consequences:**
- A mismatch between the loaded material and the Slice is stated before sending, with the option to proceed after an explicit warning.
- Where a spool cannot be read, nova3D says so and refuses to check it rather than guessing.
- Material type and colour actually used are recorded in the Print Record and the Source Record.

#### FR-36: Sending and printer control

nova3D sends the Slice to the printer and controls the machine while it runs.

**Consequences:**
- Sending requires Model Approval for the exact Version and a valid Slice; a queued print never starts without an explicit action.
- Controls include pause, resume, stop, temperatures, movement, fans, speed, material load and unload, calibration, chamber light, and the on-device queue.
- Pause, Resume, and Stop are primary controls; Stop states its irreversibility beside it.
- A control the printer refuses mid-print says so and states why.
- Print state is reported as the printer reported it, never as nova3D's own certainty.
- Sending and control require connectivity; offline, nova3D states this rather than queueing silently.

#### FR-37: Camera watching and problem detection

Where a printer has a camera and Watching is enabled, nova3D checks frames and pauses the print when it detects a likely failure.

**Consequences:**
- Camera presence and Watching are two separate stated conditions. A live view never implies anything is being checked.
- A printer with no camera states that it cannot be watched; absence of monitoring is never left to be inferred from silence.
- Detected conditions include corner lifting, print detachment, layer shift, material stoppage, and stray-material mass.
- An automatic pause shows the frames it acted on, and states what nova3D saw, why it happens, how to fix it now, and what would prevent it next time.
- Every automatic pause offers three real exits: resume after fixing, stop, and false alarm. The interface states that nova3D can be wrong.
- A false alarm deletes the kept frames, says so, and makes nova3D less eager on that shape.
- Frames are checked and discarded. Nothing is retained unless a problem is found, and retention is stated where the frames appear.
- A print problem never affects the Model, its Version, or its Source Record.

#### FR-38: Print records and reprinting

Every Print Job produces a durable Print Record attached to the Model Version it printed.

**Consequences:**
- The Print Record captures printer, Slice, material type and colour, size printed, duration, pauses, camera findings, and outcome.
- nova3D never claims to know whether the object came out well; the finish step asks the user, and keeps what the machine reported, what the camera observed, and the user's judgement as three separate statements.
- Print history is browsable per Project and per Version.
- Reprinting a superseded Version is permitted and states plainly that the Version is superseded.
- A failed print states the printer's reported reason, the layer it stopped at, material used, that the Model and Version are unchanged, that the print file is kept, and that nothing retries by itself.

### 4.8 Picture Intake and Offline Conversion

**Description:** nova3D accepts photographs as an equal entry point alongside description, and converts them on the device without a network. Added by SC-1 and SC-2. Geometry produced from pictures alone is never presented as evidence-backed.

#### FR-39: Picture intake and coverage assessment

A Project can start from photographs instead of a description.

**Consequences:**
- Intake accepts existing image files, phone camera capture, and multiple images of one subject from different angles.
- Before conversion, nova3D assesses clarity and angle coverage and names the specific gaps it found rather than reporting a single quality score.
- Where coverage is insufficient, nova3D recommends the additional views that would close the gap.
- The user may choose **Generate anyway** only after an explicit warning that incomplete views can cause invented or inaccurate geometry.
- nova3D never silently proceeds from insufficient coverage.

#### FR-40: Direct picture-to-model conversion

nova3D converts pictures directly to geometry without research.

**Consequences:**
- The result is permanently labelled *image-derived — not historically verified*, and the label follows the Project everywhere it appears, including Exports, Print Records, and the Source Record.
- Every Model Feature of an image-derived model carries a Detail Status that is never `sourced`.
- The label cannot be removed by any user action, including Personalization, repair, regeneration, or reprinting.
- An image-derived Project can be converted into a research-assisted Project under FR-41; the original remains labelled.

#### FR-41: Research-assisted picture reconstruction

nova3D can identify a photographed subject, research it, and reconstruct it under the full evidence contract.

**Consequences:**
- nova3D proposes its identification of the subject and the user confirms or corrects it before research begins.
- Research then follows FR-8 through FR-14 unchanged, producing a complete Research Plan.
- Plan Approval gates generation exactly as it does for a described subject; there is no shortened path because a picture exists.
- Where evidence and the photograph disagree, the disagreement is presented as a Consequential Detail rather than resolved automatically.
- Research-assisted reconstruction requires connectivity.

#### FR-42: Offline conversion and synchronization

Direct picture conversion works without internet on supported computer and phone devices.

**Consequences:**
- nova3D states plainly which capabilities work offline — reading, picture conversion, inspection, approval, and slicing for an already-known printer — and which do not: research, sending a print, watching a print, and sync.
- Offline-created Projects remain fully usable locally and show pending or failed sync state explicitly.
- Work synchronizes into My Projects automatically when connectivity returns, without duplication.
- A sync conflict keeps both versions and asks the user to decide. Nothing is ever silently overwritten, and sync never overwrites a newer approved Model Version.
- A failed sync states what was preserved and never discards local work.

### 4.9 Source Exclusion Controls

**Description:** The user can remove a Source from one Project or from all future Projects. Added by SC-6. The two controls are deliberately distinct and are never merged into one toggle.

#### FR-43: Per-Project Source rejection

**Do not use this Source** affects only the current Project.

**Consequences:**
- Research continues without the rejected Source and seeks replacement evidence.
- Claims and decisions that depended on the rejected Source are visibly rechecked rather than silently dropped.
- Rejecting a Source during an active research Job removes it from that Job and triggers replacement research.
- Rejection is recorded in the Source Record with its reason where the user gave one.
- Rejection never affects other Projects and never changes the Account-wide Source list.

#### FR-44: Account-wide disabled Sources

Account Settings carries a simple on/off control for each Source across Projects.

**Consequences:**
- Disabling a Source prevents its use in new Projects and in new research for existing Projects.
- Completed approved Projects never mutate when a Source is later disabled.
- Such a Project normally shows a warning that it used a now-disabled Source. Settings may hide that warning, but provenance and the Source Record remain unchanged either way.
- Disabling a Source Account-wide and rejecting one for a Project are separate controls with separate wording; neither implies the other.

### 4.10 Interface, Language, Notifications, and Accessibility

**Description:** nova3D is usable in any configured language and reading direction, on phone as fully as on desktop, by keyboard and screen reader. Added by SC-3, SC-4, SC-5, and SC-7.

#### FR-45: Interface language and reading direction

The interface supports any configured language, including full right-to-left layout.

**Consequences:**
- The interface initially follows the device language and can be changed in Account Settings.
- Interface language and reading direction are set independently, so either combination is selectable and RTL is demonstrable rather than assumed.
- Source content is never affected by these settings: original Source language, translation, and explanation remain three distinguishable blocks, and Hebrew and English can appear together in one evidence view.
- Identifiers, citations, measurements, and file names remain left-to-right inside mirrored text.

#### FR-46: Phone push notifications

nova3D can deliver Notification events to the user's phone.

**Consequences:**
- Push covers research, generation, validation, Export, slice, print, and detected-problem events.
- Account Settings controls which categories are pushed, independently per category.
- In-app Notification history remains complete and available when phone alerts are disabled or permission is denied.
- A denied or revoked operating-system permission is stated in Settings rather than left to be inferred from silence.
- A push notification never contains private Project content beyond what is needed to identify the item.

#### FR-47: Appearance, wording, and accessibility preferences

Account Settings carries the presentation preferences that affect how nova3D reads.

**Consequences:**
- Light mode is the default; dark mode is a manual option and preserves every Detail Status, Job state, and gate distinction.
- Explanations use ordinary language by default, with an option for more technical detail; both say the same thing.
- Text enlargement, high contrast, and reduced motion are honoured, following the operating system where it expresses a preference.
- No state is conveyed by colour alone anywhere in the interface.

## 5. Non-Goals

- Manual geometry or mesh editing.
- Guaranteed historical truth where evidence is incomplete or disputed.
- Complete Temple and utensil generation in the MVP.
- Multi-printer fleet management, print farms, scheduling across machines, or unattended queue automation. nova3D controls the user's own printers one job at a time.
- Any claim that a print will succeed, or that a detected problem is certainly real. Detection can be wrong and the interface always says so.
- Any presentation of image-derived geometry as historically verified, or any path that removes the image-derived label.
- Offline research, offline print sending, or offline print watching. Direct picture conversion is the offline capability; the rest state that they need connectivity.
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
- Model Approval before export or printing.
- Target Print Profile selection, validation, automatic repair, one bounded full-regeneration fallback, and audit history.
- Downloadable print-ready model file and Source Record.
- Automatic printer discovery, model preparation with reversible printing-only fixes, and the stated left-alone boundary.
- Evidence-versus-printability decisions surfaced to the user and recorded in the Source Record.
- Build plate arrangement, slicing, filament verification, sending, and full printer control.
- Camera watching with problem detection, evidence frames, and a false-alarm exit.
- Print Records attached to Versions, print history, and reprinting.
- Picture intake with coverage assessment, direct image-derived conversion, and research-assisted picture reconstruction.
- Offline direct conversion with explicit capability statements and conflict-preserving sync.
- Per-Project Source rejection and Account-wide disabled Sources as distinct controls.
- Complete desktop, laptop, and phone workflows.
- Configurable interface language with full right-to-left layout.
- Phone push notifications with per-category control.
- WCAG 2.2 AA accessibility, dark mode, and ordinary-versus-technical wording.
- Private Project or whole-Account deletion with privacy-preserving shared reuse of source-derived research.

### 6.2 Out of Scope for MVP

- Complete Temple and utensil generation — follows proof of the altar-and-ramp integrity chain.
- Fleet control across multiple machines — follows reliable single-printer operation.
- Other research domains and model categories — follow the Temple domain.
- Commercial sales workflow — follows repeatable quality across multiple outputs.

## 7. Cross-Cutting Non-Functional Requirements

- **NFR-1 — Workspace privacy:** Every user-facing and background operation enforces Account ownership. Cross-Account access to private Workspace data must produce no data disclosure.
- **NFR-2 — Secret protection:** Login, Invitation Code, recovery, provider, database, queue, signing, and callback-verification secrets are never stored or logged in readable form or exposed through browsers, URLs, prompts, Jobs, Notifications, Source Records, or Exports. Sensitive authentication actions require secure transport and protected sessions. Secrets support redaction, rotation, and revocation.
- **NFR-3 — Provenance integrity:** Sources, Cached Research Revisions, Claims, decisions, approvals, repairs, validations, and derivative artifacts retain immutable identity, timestamps, actor, and version relationships. Every Claim pins the exact Source edition or revision, passage, retrieval date, and captured excerpt or content digest examined. Corrections and changed Source content use successor versions rather than mutation. Slicing, printing, printer control, and camera watching cannot alter the approved evidence-to-geometry record; Print Records attach to a Version without modifying it.
- **NFR-4 — Durable job state:** Closing the browser, navigating to another Project, or a worker restart cannot lose an accepted Job, corrupt its Project, or misreport its final state.
- **NFR-5 — Safe concurrency:** Concurrent Jobs remain isolated and cannot overwrite newer approved Project state. Results generated from stale inputs cannot silently become current.
- **NFR-6 — Reproducibility:** Given fixed approved inputs, tool versions, and settings, nova3D reproduces geometrically equivalent Canonical Models within the tolerance ratified through AD-2.
- **NFR-7 — Version durability:** Every Version presented as restorable must restore its geometry and provenance successfully. Deletion under FR-30 is the explicit exception.
- **NFR-8 — Explainable failures:** User-facing failures identify the failed stage, known cause, preserved state, cost impact where known, and permitted next action in beginner-friendly language.
- **NFR-9 — Cost control:** Paid Work cannot begin without category-specific Project permission, a disclosed maximum charge, and an atomic cost reservation within the available Usage Limit. Usage records, reservations, settlements, and releases must reconcile with each idempotent Job. nova3D must present the resulting spending record clearly enough for Josh to understand and control spending.
- **NFR-10 — Responsive workspace:** Research, generation, validation, repair, and export run without blocking navigation or ordinary Project inspection. Browser preview degradation or failure cannot damage manufacturing geometry.
- **NFR-11 — Honest print qualification:** Validation labels always identify the Target Print Profile, warnings, failures, unknowns, and last validation time; nova3D never presents validation as safety or universal manufacturability certification. Slice figures are labelled as slicer estimates and print progress as reported by the printer, never as nova3D's own certainty.
- **NFR-12 — Privacy-preserving cache and deletion:** Shared cached research contains only fields reproducible from identified non-private Sources and cannot expose user identity, private inputs, decisions, or deleted artifacts. Admission rejects all user- and Project-derived fields. Project or whole-Account deletion takes effect immediately through durable tombstones. It blocks late writes and cache promotion, promptly removes active private data, removes remaining copies from operational backups within 30 days, and remains enforced after backup restoration.
- **NFR-13 — Reconstruction integrity under printing:** No automatic action taken to make a model printable may alter reconstruction geometry. Printing-Only Fixes are always enumerated and individually reversible. An Evidence Collision must always be presented as a user decision with neither option preselected, and the resolution recorded in the Source Record. A violation of this requirement is a correctness defect, not a usability one.
- **NFR-14 — Honest monitoring:** nova3D must never imply that a print is being watched when it is not. Camera presence and Watching are stated separately wherever either appears, and a printer without a camera states that it cannot be watched. Every automatic pause presents the frames it acted on and offers resume, stop, and false alarm. Detection confidence is never presented as certainty. Camera frames are discarded unless a problem is found, and retention is stated where frames appear.
- **NFR-15 — Print record durability:** Every Print Job produces a Print Record that survives printer disconnection, browser closure, and worker restart, and that reconciles with the Version, Slice, and Target Print Profile it names. A print that fails or is stopped still produces a Print Record stating what happened.
- **NFR-16 — Device parity:** Every first-version capability — creation, picture intake, research review, 3D inspection, both approval gates, validation, Export, printing, and printer control — is fully usable on desktop, laptop, and phone. Phone is not a reduced companion. Where a capability is genuinely device-limited, nova3D states the limitation rather than hiding the control.
- **NFR-17 — Internationalization:** All interface text is externalized and translatable, with no concatenated sentence fragments and no text baked into images. Layout must survive a doubling of string length. Right-to-left is a supported layout, not a mirrored afterthought: identifiers, citations, measurements, and file names stay left-to-right inside mirrored text, and Source language, translation, and explanation remain separately marked with correct `lang` and `dir`.
- **NFR-18 — Accessibility:** The first version targets WCAG 2.2 AA. Every interactive element is keyboard reachable and operable in a sensible order with visible focus; every state carries a non-colour cue; screen readers announce Detail Status, Job state, gate state, and print state as words. Text enlargement, high contrast, and reduced motion are honoured. Both approval gates and every print control must be fully operable without a pointing device.
- **NFR-19 — Offline integrity:** Offline work is durable on the device and never lost by reconnecting. Sync is conflict-preserving: a conflict keeps both versions and requires a user decision, and no sync path can overwrite a newer approved Model Version or silently discard local work. Capabilities unavailable offline are stated explicitly rather than failing silently or appearing to succeed.

## 8. Success Metrics

**Primary**

- **SM-1 — Complete evidence-led outcome:** Josh can progress one altar-and-ramp Project from a natural-language request to an approved Export and Source Record without manual modelling, and from there to a finished printed object. Validates FR-5, FR-8 through FR-29, and FR-31 through FR-38.
- **SM-2 — Consequential Detail coverage:** 100% of Consequential Details in the approved Research Plan have linked evidence or an explicit Detail Status. Validates FR-10 through FR-13.
- **SM-2a — Independent completeness check:** 100% of approved Research Plans have a completed finite detail checklist, a recorded independent gap-review pass, and no unresolved gap. Validates FR-10 and FR-13.
- **SM-3 — Approval integrity:** In every test case, generation is blocked without valid Plan Approval, and Export and sending a print are both blocked without valid Model Approval for the exact Version. Validates FR-13, FR-15, FR-23, FR-29, and FR-36.
- **SM-4 — Reproducible regeneration:** 100% of the MVP regression corpus regenerates geometrically equivalent output from fixed approved inputs, tool versions, and settings within the resolved tolerance. Validates FR-16 and FR-21.
- **SM-5 — Print-validation integrity:** Every MVP Export passes all supported blocking checks for its Target Print Profile and retains the full validation and repair record. Validates FR-24 through FR-29.
- **SM-11 — Reconstruction untouched by printing:** Across the MVP print corpus, zero automatic preparation actions alter reconstruction geometry, 100% of Printing-Only Fixes are listed and reversible, and 100% of Evidence Collisions are presented as user decisions rather than resolved automatically. Validates FR-32, FR-33, and NFR-13.
- **SM-12 — Monitoring honesty:** In every test case a printer without a camera states that it cannot be watched, camera presence and Watching are never conflated, every automatic pause presents its frames and all three exits, and a false alarm demonstrably deletes the kept frames. Validates FR-37 and NFR-14.
- **SM-13 — Device parity:** Every first-version capability completes successfully on phone as well as on desktop across the MVP test set, with no capability unavailable and no control hidden rather than stated. Validates NFR-16.
- **SM-14 — Accessibility and internationalization conformance:** The MVP screen set passes a WCAG 2.2 AA audit with zero unresolved AA failures, is fully keyboard operable including both approval gates and every print control, and renders correctly in a right-to-left locale with Source language, translation, and explanation still distinguishable. Validates FR-45, FR-47, NFR-17, and NFR-18.
- **SM-15 — Offline sync integrity:** Across the offline test corpus, zero Projects are lost or duplicated on reconnection, 100% of conflicts keep both versions and require a decision, and no sync overwrites a newer approved Model Version. Validates FR-42 and NFR-19.
- **SM-16 — Image-derived labelling durability:** In every test case the image-derived label survives Personalization, repair, regeneration, Export, printing, and reprinting, and no user action removes it. Validates FR-40.

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
- **SM-C5 — Print success rate is not reconstruction fidelity:** Do not improve print success by widening what may be automatically altered, by preselecting the printable option in an Evidence Collision, or by suppressing the collision prompt. Counterbalances SM-1 and SM-11.
- **SM-C6 — Fewer alerts is not better watching:** Do not reduce false-positive rate by weakening detection to the point of missing real failures, and do not present a lower alert count as improved reliability without reporting missed failures alongside it. Counterbalances SM-12.
- **SM-C7 — Picture speed is not evidence:** Do not present the image-derived path as equivalent to evidence-backed reconstruction, weaken the coverage warning to raise conversion rate, or let the label become less visible over the life of a Project. Counterbalances SM-1 and SM-16.

## 9. Decision Register

### 9.1 Resolved Product Decisions

- **D-1 — Export package:** 3MF is the primary print-ready file, STL is an optional compatibility copy, and the Source Record is a readable PDF generated from immutable structured provenance.
- **D-2 — Administrator recovery:** The sole Administrator recovers access through a short-lived, single-use link sent to the verified Administrator email. Success revokes all existing Administrator sessions and creates an immutable audit event.
- **D-3 — Private deletion:** FR-30 private data is removed from operational backups within 30 days; durable deletion tombstones prevent restoration or late Jobs from resurrecting it. The implementation must define an auditable verification procedure before deletion work begins.
- **D-4 — Print pipeline in scope, subordinate to evidence (31 August 2026):** nova3D slices, arranges, sends, controls, and watches prints. Export is retained and never blocked. The three printing rules are product decisions, not defaults: printing-only problems are auto-fixed and reversible, reconstruction geometry is never altered automatically, and an Evidence Collision is always asked. An auto-fix policy for collisions was rejected because it would silently corrupt reconstructions, which is the one outcome nova3D exists to prevent. Recorded in `../../ux-designs/ux-nova3D-2026-08-27/SCOPE-CHANGE-print.md`.

- **D-5 — UX scope changes adopted (31 August 2026):** SC-1 through SC-7 are adopted into the first version. Picture workflows are no longer deferred; direct conversion works offline while research-assisted reconstruction stays online-only; phone is a full workflow rather than a companion; the interface is internationalized including RTL; push notifications are per-category with in-app history always complete; per-Project Source rejection and Account-wide disabling remain two distinct controls; and WCAG 2.2 AA is the accessibility target. Recorded in `../../ux-designs/ux-nova3D-2026-08-27/UX-SCOPE-CHANGES.md`.

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
| AD-8 | Printer integration contract per vendor — discovery, job submission, control, and camera access, including which vendors are cloud-only and what degrades when a vendor supports less | Architecture, after a spike | Before FR-31, FR-36, or FR-37 stories are accepted for implementation | FR-31, FR-35, FR-36, FR-37 |
| AD-9 | Problem-detection model, its training corpus, the detected condition set, and a stated false-positive budget with a measured missed-failure rate | Architecture with product ratification of the budget | Before FR-37 stories are accepted for implementation | FR-37, NFR-14, SM-12, SM-C6 |
| AD-10 | Slicing engine decision — owned, embedded, or wrapped — and whether it makes FR-34 layer and duration figures real | Architecture | Before FR-34 stories are accepted for implementation | FR-34, FR-35, NFR-11 |
| AD-11 | Spool-tag reading method per vendor, and the stated behaviour where a spool cannot be read | Architecture | Before FR-35 stories are accepted for implementation | FR-35, NFR-11 |
| AD-12 | Print Record schema and persistence — fields, Version attachment, and durability across disconnection and restart — extending the AD-4 provenance schema | Architecture | Before FR-38 stories are accepted for implementation | FR-38, NFR-3, NFR-15 |
| AD-13 | On-device picture conversion — feasibility, performance, storage footprint, privacy, and the stated fallback when a device cannot run it | Architecture | Before FR-40 or FR-42 stories are accepted for implementation | FR-40, FR-42, NFR-19 |
| AD-14 | Push notification delivery — transport per platform, permission handling, payload minimization, and behaviour when permission is denied or revoked | Architecture | Before FR-46 stories are accepted for implementation | FR-7, FR-46, NFR-1 |
| AD-15 | Internationalization mechanism and translation ownership — string externalization, locale negotiation, RTL layout strategy, and who supplies and reviews translations | Product and Architecture | Before FR-45 stories are accepted for implementation | FR-45, NFR-17 |
| AD-16 | Accessibility conformance method — audit tooling, assistive-technology test matrix, and the definition of an accepted AA pass | UX and Architecture | Before the first accessibility acceptance run | FR-47, NFR-18, SM-14 |

## 10. Assumptions Index

No unresolved inline product assumptions are included. Phase-blocking technical decisions, owners, and ratification gates are tracked in §9, with supporting context in `addendum.md`.
