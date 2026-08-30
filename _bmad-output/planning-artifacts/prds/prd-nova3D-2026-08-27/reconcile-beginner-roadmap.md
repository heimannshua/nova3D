---
title: nova3D Beginner Development Roadmap Reconciliation
status: complete
created: 2026-08-27
source: ../../../brainstorming/brainstorm-web-3d-modelling-app-2026-08-26/beginner-development-roadmap.md
targets:
  - prd.md
  - addendum.md
---

# Beginner Development Roadmap Reconciliation

## Reconciliation result

The PRD and addendum preserve most of the roadmap's end-state integrity chain: no manual modelling, explicit uncertainty, approval before generation, reproducible canonical geometry, read-only evidence inspection, focused correction, dependency-aware regeneration, restorable versions, inspection before export, and profile-qualified print validation. The altar and ramp from Middot chapter 3 are also a credible concrete thin slice.

The main loss is the roadmap's reason for existing: a first-time developer was meant to reach that outcome through small, ordered proofs with a pass/fail gate at every stage. The PRD flattens those proofs into a broad MVP that also contains multi-account administration, cost controls, concurrency, notifications, personalization, repair orchestration, shared caching, and deletion semantics. Several source-authority, dossier, traceability, correctness, repair-approval, expansion, and printer-refusal rules are also absent or weakened. A product can therefore satisfy the current PRD while being much harder to build safely and while bypassing some qualitative contracts that the roadmap called non-negotiable.

## Meaningful gaps and transformations

### R-1 — The beginner-safe sequence was flattened into one large milestone

**Classification:** Missing delivery contract and silently transformed milestone.

**Roadmap intent:** A validation gate is a pass/fail checkpoint before the next stage. Stages 0 through 7 each define a learning milestone, a prototype milestone, and a validation gate, beginning with a hand-written transformation and static walkthrough, then fixture-backed evidence records, one small generator, one dossier, inspection, regeneration, correction, and finally a print-ready file (`beginner-development-roadmap.md`, §3 and §5, especially lines 45 and 64–214). The practical build rhythm repeats one observable outcome, normal and refusal-path testing, an uncertainty record, and a passed gate before expansion (§7, lines 284–295).

**Current treatment:** The PRD puts its complete functional surface into one MVP and supplies end-state success metrics, but neither it nor the addendum defines implementation phases, entry criteria, prototype evidence, or a prohibition on starting later subsystems before the thin slice passes (`prd.md`, §6.1 and §8; `addendum.md`, Architecture Decisions Deferred).

**Why this matters:** This is not merely missing project-management detail. The staged proof was the roadmap's principal risk control for a first-time developer. Without it, research automation, geometry, print validation, authentication, caching, and distributed job state can all be started before the evidence-to-geometry transformation is understood.

**Reconciliation needed:** Add an authoritative delivery-and-gate companion to the PRD. Preserve at minimum the Stage 0 static walkthrough, Stage 1 hand-prepared evidence fixture and CRUD/restore proof, Stage 2 single-section generator, and the successive inspection, regeneration, correction, and export gates. Record normal-path, refusal-path, recovery, and remaining-uncertainty evidence before a phase is closed.

### R-2 — Explicitly deferred personal-platform work became MVP scope

**Classification:** Contradicted and materially expanded.

**Roadmap intent:** Until the thin slice passes Stage 7, defer the full reconstruction, unrelated domains, every printer capability, and other non-core work. Billing, collaboration, broad onboarding, and complex permissions are unnecessary because the application is personal-only (`beginner-development-roadmap.md`, §6, lines 269–282).

**Current treatment:** The PRD calls Josh the sole initial user but makes controlled Accounts, invited-user registration, isolated Workspaces, Account disabling, per-Account Usage Limits, shared-cache privacy, private deletion, Administrator recovery, and related security metrics part of MVP (`prd.md`, §2, UJ-2, FR-1–FR-4, FR-30, §6.1, NFR-1/NFR-2/NFR-9/NFR-12, SM-8/SM-9).

**Why this matters:** The first release becomes a multi-tenant platform with authorization, privacy, metering, cache, backup, and deletion obligations before the core proposition is proven. This directly consumes the beginner safety margin the roadmap was designed to protect.

**Reconciliation needed:** Restore a genuinely single-user Stage 0–7 slice and defer invited Accounts, Account administration, cross-Account Usage Limits, shared research caching, and multi-user deletion guarantees. If multi-account MVP scope is an approved supersession, record it explicitly and re-baseline the development roadmap rather than treating it as a faithful translation.

### R-3 — One reliable job was expanded into a general orchestration platform

**Classification:** Phased constraint weakened.

**Roadmap intent:** Use Upstash only when queued or delayed work is actually needed. First prove one reliable generation job with waiting, running, completed, and failed states—not a complex job platform (`beginner-development-roadmap.md`, Stage 2, line 121).

**Current treatment:** MVP requires multiple concurrent cancellable research and generation Jobs, continued cross-Project use, app-wide Notifications, durable worker recovery, stale-result protection, cross-job isolation, non-blocking navigation, cost reporting, repair, validation, and export activities (`prd.md`, FR-6, FR-7, FR-24–FR-29, NFR-4/NFR-5/NFR-8–NFR-10, §6.1). The addendum correctly keeps Upstash conditional, but does not restore the one-job proof as a prerequisite (`addendum.md`, Intended Platform Choices).

**Why this matters:** Concurrency and durable distributed state introduce races and failure modes before the generator's correctness is known.

**Reconciliation needed:** Make a single Project-scoped job and its four basic states the first job gate. Add cancellation, concurrency, global notifications, cross-Project scheduling, and cost reconciliation only after the narrow generation lifecycle and its refusal paths pass.

### R-4 — Middot's governing authority was reduced to generic source quality

**Classification:** Non-negotiable rule weakened.

**Roadmap intent:** Middot governs the initial reconstruction. Details from other books must be visibly labelled as supplements or inferences (`beginner-development-roadmap.md`, rule 2, line 27; Stage 3).

**Current treatment:** FR-8 requires relevant Middot material and permits broader research when details are missing, conflicting, or ambiguous. FR-9 distinguishes low-authority leads from acceptable evidence classes, but it does not give Middot precedence, require external contributions to be labelled supplemental or inferred, or define an explicit approval path for departing from Middot (`prd.md`, FR-8 and FR-9, lines 136–152).

**Why this matters:** A well-cited commentary, archaeological proposal, or scholarly reconstruction can silently displace the governing text while appearing equally authoritative.

**Reconciliation needed:** Add a domain source-authority policy: Middot is the default governing spatial specification; every non-Middot contribution is marked supplemental, inferred, or conflicting; and any departure from Middot is a disputed interpretation with explicit reasoning and Plan Approval.

### R-5 — Exact passage preservation was weakened to source identity and location context

**Classification:** Traceability gate weakened.

**Roadmap intent:** The evidence records include source works and exact passages, and preserving exact source passages is the first criterion of the first real release (`beginner-development-roadmap.md`, Stage 1 and §8 item 1, lines 90–93 and 299–301).

**Current treatment:** FR-9 requires source identity and “enough location context” to inspect support. FR-29 lists Claims and Sources in the Source Record, but neither requirement mandates preserving the exact passage or an immutable permitted extract (`prd.md`, FR-9 and FR-29).

**Why this matters:** A Claim can retain a bibliographic pointer while its actual supporting text changes, becomes inaccessible, or cannot be reconstructed from the stored record.

**Reconciliation needed:** Require each Claim to preserve the exact cited passage or an immutable, legally permitted extract together with source identity, edition/version where relevant, and locator. Define how the Export's Source Record carries or verifiably references that evidence.

### R-6 — Section-level decision dossiers became a monolithic whole-project review

**Classification:** Partly preserved and silently transformed.

**Roadmap intent:** Related disputes are reviewed in grouped, section-level dossiers containing the governing passage, other arguments, alternatives, recommendation, citations, confidence, source-status labels, and predicted geometry effects. The user approves the grouped set before those interpretations affect geometry (`beginner-development-roadmap.md`, rule 4 and Stage 3, lines 29 and 129–151).

**Current treatment:** FR-11 structures options per uncertain Consequential Detail, while FR-12 requires one complete Project-wide Research Plan before any Canonical Model is generated. The complete-plan gate is strong, but no requirement makes section dossiers the review unit or groups interacting decisions and their combined geometry effects (`prd.md`, FR-11 through FR-13).

**Why this matters:** Review can become either atomized into many independent detail choices or cognitively overwhelming as one flat, whole-model decision surface. In later Temple expansion, one unrelated unresolved detail can also block feedback on an otherwise complete bounded section.

**Reconciliation needed:** Keep version-bound whole-plan approval if desired, but require the plan to be composed of navigable section dossiers whose progress can be saved and whose related alternatives and combined effects are reviewed together. For post-MVP expansion, define whether an approved, explicitly bounded section may generate independently without weakening the complete-plan rule inside that section.

### R-7 — Reproducibility replaced the “intended result” correctness gate

**Classification:** Validation gate weakened.

**Roadmap intent:** Stage 2 requires rebuilding the same approved inputs to produce the intended result, not merely an identical result (`beginner-development-roadmap.md`, Stage 2 validation gate, line 127).

**Current treatment:** FR-16 and SM-4 require geometrically equivalent output from fixed inputs, versions, settings, and a future tolerance. SM-1 verifies completion of the journey, but no metric compares the generated altar and ramp against a known expected set of dimensions, relationships, placements, and required parts (`prd.md`, FR-16, SM-1, and SM-4).

**Why this matters:** A deterministic generator can produce the same wrong geometry every time and satisfy the current reproducibility metric.

**Reconciliation needed:** Add a thin-slice correctness oracle or acceptance fixture. It should state the approved expected parts, named dimensions, spatial relationships, placements, and allowed tolerances, then require both semantic agreement with that oracle and deterministic regeneration.

### R-8 — Total and bidirectional geometry-to-evidence traceability is not guaranteed

**Classification:** Potentially weakened at the core join.

**Roadmap intent:** Every proposed and generated part, measurement, material, placement, feature, and modelling decision must be traceable or explicitly unknown. Every generated part retains its evidence link, a selected part reveals the complete context, and the generated result can show which geometry changed because of each approved decision (`beginner-development-roadmap.md`, Stage 1–4 gates, lines 111, 127, 151, and 170).

**Current treatment:** FR-10 covers every defined Consequential Detail and FR-19 provides rich evidence for a selected Model Feature. The PRD does not explicitly require every visible generated object and every consequential property to be represented by a selectable Model Feature, nor does it require the reverse decision-to-all-affected-geometry view (`prd.md`, glossary, FR-10, FR-13, FR-19, and FR-21).

**Why this matters:** The evidence database can be complete while some visible geometry cannot be selected, or while users can navigate from geometry to a decision but cannot audit the full geometric reach of that decision.

**Reconciliation needed:** Require total mapping in both directions: every generated part and consequential property maps to its status, Claims, decisions, and approval; every Claim and decision maps to all affected parameters and Model Features. Define fallback viewer behavior for geometry that cannot be selected directly, and add a decision-impact highlight or equivalent audit view.

### R-9 — The model may visually overstate evidentiary certainty

**Classification:** Qualitative direction weakened.

**Roadmap intent:** Every exposed feature must be investigable, and no part may appear more certain than its evidence allows (`beginner-development-roadmap.md`, Stage 4 validation gate, line 170).

**Current treatment:** FR-19 displays Detail Status, conflicting evidence, reasoning, alternatives, and a confidence explanation after selection. No requirement governs the model view, selection affordance, labels, or default presentation so that inferred, disputed, unknown, and sourced geometry are distinguishable before or during inspection (`prd.md`, FR-18 and FR-19).

**Why this matters:** A disputed reconstruction can look visually definitive until the user happens to inspect the right feature, undermining the promise of honest uncertainty.

**Reconciliation needed:** Add a certainty-presentation requirement using accessible, non-misleading visual or textual cues with a legend and progressive disclosure. The default model view must not make uncertain geometry indistinguishable from sourced geometry without a clear route to see its status.

### R-10 — Version comparison is described but not required

**Classification:** Prototype behavior weakened and not testable.

**Roadmap intent:** Change an approved value, regenerate affected geometry, compare the new and previous model states, and restore the earlier state (`beginner-development-roadmap.md`, Stage 5 prototype milestone, line 182).

**Current treatment:** Section 4.4 says the user “compares outcomes,” but FR-22 requires only viewing and restoring prior Versions. No functional requirement or metric defines geometry, parameter, interpretation, evidence, or validation differences between two Versions (`prd.md`, §4.4 description and FR-22).

**Why this matters:** A history list and restore button do not help the user understand what an interpretation or correction actually changed.

**Reconciliation needed:** Add a normative Version comparison requirement: at minimum show changed decisions, parameters, affected Model Features, validation state, and a usable structured or graphical geometry difference before restoration or approval.

### R-11 — Automatic repair can export geometry that was not the approved artifact

**Classification:** Validation and refusal path weakened.

**Roadmap intent:** The print-ready file must come from an approved and inspected Version, and the completed model must be inspected before it is eligible for printing (`beginner-development-roadmap.md`, rule 9 and Stage 7, lines 34 and 202–214).

**Current treatment:** FR-26 permits immediate automatic repair after validation. FR-27 creates a new Version and requires new inspection and Model Approval only when repair changes visible geometry, historical dimensions, or Personalization; other repairs can remain only in validation history. FR-29 then permits Export after Model Approval and passing validation (`prd.md`, FR-26, FR-27, and FR-29).

**Why this matters:** A topology, shell, orientation, or other manufacturing-geometry repair may change the exported artifact without being classified as “visible” or historical. The approved Version and the fabricated file can therefore diverge.

**Reconciliation needed:** Every geometry- or topology-changing repair must create a new Model Version, invalidate Model Approval, and require inspection of the exact repaired artifact. Only a genuinely metadata-only correction may retain the prior approval.

### R-12 — Print-constrained regeneration can bypass interpretation approval

**Classification:** Approval boundary under-specified.

**Roadmap intent:** Research and geometry are one linked feature; geometry-affecting uncertainty is classified and approved; and no geometry change occurs in the correction loop before revised approval (`beginner-development-roadmap.md`, rules 1, 3, and 5; Stage 6 validation gate).

**Current treatment:** FR-28 permits one full regeneration from the approved Research Plan using the Target Print Profile and failed validation constraints. The result is a new Model Version requiring Model Approval, but the requirement does not say when new print-driven parameters, altered dimensions, added supports/features, or a different treatment must become Consequential Details in a new Research Plan with Plan Approval (`prd.md`, FR-28).

**Why this matters:** Printer-driven geometry can enter the Canonical Model through a weaker approval route than evidence- or correction-driven geometry.

**Reconciliation needed:** Define the boundary explicitly. If constrained regeneration changes any consequential parameter, feature, dimension, placement, material assumption, Personalization, or interpretive treatment, record the change with status and reasoning in a new Research Plan version and obtain Plan Approval before regeneration. Reserve Model Approval alone for a faithfully regenerated representation of already approved decisions.

### R-13 — The reusable engine/Middot domain-package boundary disappeared

**Classification:** Missing architecture invariant.

**Roadmap intent:** The small generator keeps domain rules separate from the general application so Middot is the first domain package rather than a permanent hard-coded limit. Later stages refine that reusable engine and attempt another book only after several Middot sections pass (`beginner-development-roadmap.md`, Stages 2 and 8, lines 117 and 220–228).

**Current treatment:** The PRD and addendum defer other domains, but neither requires an engine/domain seam or prevents the altar-and-ramp implementation from hard-coding Middot-specific extraction, adjudication, claim types, and geometry mappings throughout the system (`prd.md`, §6.2; `addendum.md`, Architecture Decisions Deferred and Deferred Product Capabilities).

**Why this matters:** The MVP can conform while making future sections or domains require a rewrite or allowing domain-specific logic to contaminate general provenance, approval, versioning, and export behavior.

**Reconciliation needed:** Add an architecture acceptance invariant without prematurely selecting a framework: Middot-specific vocabulary, source policy, parsing, adjudication, and geometry mappings must be separable from the reusable evidence, approval, dependency, versioning, validation, and export pipeline.

### R-14 — Post-MVP expansion lost its one-section-at-a-time gates

**Classification:** Phased constraint weakened.

**Roadmap intent:** Add one section or object group at a time. Every addition repeats the evidence, ambiguity, approval, generation, inspection, regeneration, versioning, and print-readiness gates; several sections must work before another book or research topic is tried (`beginner-development-roadmap.md`, Stage 8, lines 216–228).

**Current treatment:** The PRD says the complete Temple follows proof of the altar-and-ramp chain and other domains follow the Temple domain. The addendum lists both as deferred capabilities. Neither defines the increment size, repeated gate suite, shared-measurement regression proof, or several-section prerequisite (`prd.md`, §6.2; `addendum.md`, Deferred Product Capabilities).

**Why this matters:** Later work can jump to a large Temple expansion or another domain while still appearing consistent with the PRD package, losing the failure isolation that the roadmap requires.

**Reconciliation needed:** Preserve a post-MVP expansion policy: one section or object group per increment, the complete integrity-gate suite on every increment, an explicit shared-dependency regression test, and multiple successful Middot sections before another governing corpus is attempted.

### R-15 — Deferred printer behavior lost its safety and refusal contract

**Classification:** Correctly deferred, materially under-specified.

**Roadmap intent:** Printer integration begins with one personal printer and a separate inspection/confirmation step. Fleet routing comes last, considers build dimensions, model requirements, capabilities, loaded filament colour and material, availability, and queue time, queues when no suitable printer is free, never interrupts an active print, and explains automatic selection (`beginner-development-roadmap.md`, Stages 9 and 10, lines 230–265).

**Current treatment:** Printer integration is correctly outside MVP. The addendum retains direct control, queues, device and filament state, explainable routing, settings, and cameras, while NFR-3 prevents later printer integration from altering the evidence record. It does not retain the one-printer-first constraint, separate submission confirmation, no-pre-emption refusal, full routing inputs, or queue-when-busy behavior (`prd.md`, §5, §6.2, and NFR-3; `addendum.md`, Deferred Product Capabilities).

**Why this matters:** Deferral should postpone implementation, not erase the behavioral constraints that make later physical output safe and explainable.

**Reconciliation needed:** Add a deferred-requirements register preserving those exact future rules. In particular, no submission without inspection and confirmation, no automatic interruption of active jobs, safe queuing when no suitable printer is free, and an inspectable routing rationale from the recorded criteria.

### R-16 — Beginner-friendly behavior is narrower than the roadmap's beginner intent

**Classification:** Qualitative direction weakened.

**Roadmap intent:** The document defines domain terms in plain language, hides file-format and modelling complexity from normal use, and treats Josh's first-time-developer status as a reason for small proofs and understandable decisions (`beginner-development-roadmap.md`, §3, Stage 7, and §7).

**Current treatment:** The Target User section calls for beginner-friendly language and NFR-8 applies it to failure messages. The PRD does not require guided explanations when confirming scope, assessing source authority, comparing interpretations, approving a dossier, selecting a Target Print Profile, judging warnings, accepting a repair, or restoring a Version (`prd.md`, §2, FR-5, FR-11, FR-18–FR-28, and NFR-8).

**Why this matters:** Plain failure copy does not make research, CAD, and fabrication decisions accessible to a non-modeller. The interface can be transparent but still require expertise the target user does not have.

**Reconciliation needed:** Add a cross-cutting guided-decision requirement: every user decision explains in plain language what is being chosen, why it matters, likely evidence/geometry/cost effects, the safe default where one exists, and the available next or refusal action. Necessary jargon should be defined in context and implementation details hidden behind progressive disclosure.

### R-17 — The model-only deliverable boundary now has unapproved exceptions

**Classification:** Silently expanded, with a potentially justified exception.

**Roadmap intent:** The output is the 3D model only; images, videos, explanations, product listings, and other deliverables are outside scope (`beginner-development-roadmap.md`, rule 8 and §6).

**Current treatment:** FR-29 makes a separate Source Record part of every Export, and FR-17 adds Personalization throughout the MVP pipeline. The Source Record is strongly aligned with traceability, but it is still an additional artifact format and schema; Personalization is an additional geometry/provenance regime not present in this roadmap (`prd.md`, FR-17, FR-29, and §6.1; `addendum.md`, Architecture Decisions Deferred).

**Why this matters:** Both may be valid decisions from other approved inputs, but the roadmap alone does not authorize their cost or their effect on the first-release gates.

**Reconciliation needed:** Explicitly classify the Source Record as a supporting provenance sidecar rather than a separate product output, if that is the accepted interpretation. Confirm Personalization as an approved MVP addition or move it behind the Stage 7 evidence-derived slice. Continue to exclude images, videos, sales explanations, and product listings.

## Preserved roadmap intent

No corrective reconciliation is needed for the following roadmap decisions:

| Roadmap intent | Current PRD treatment |
| --- | --- |
| Private, browser-based evidence-to-fabrication product | Vision and Target User preserve the browser experience and private Workspace direction, subject to R-2's multi-account conflict. |
| No manual modelling controls | Vision, FR-15, FR-17, FR-18, and the manual-editing non-goal keep geometry generation automatic and inspection read-only. |
| Explicit sourced, inferred, disputed, and unknown states | The Detail Status model preserves all four and adds `user-added` for Personalization. |
| No silent invention | FR-10, SM-2, and SM-C2 require complete Consequential Detail coverage or an explicit status. |
| Human approval before disputed interpretation becomes geometry | FR-13 and FR-15 strongly block generation without version-bound Plan Approval. |
| Selected and rejected alternatives, citations, reasoning/confidence, approver, and affected details | FR-11 through FR-13 and FR-19 preserve the decision ledger, subject to R-8's missing reverse impact view. |
| Reliable generation states and understandable failures | FR-6, NFR-4, and NFR-8 strengthen failure-state preservation, although R-3 identifies premature breadth. |
| Read-only rotate/zoom/hide/select inspection | FR-18 and FR-19 preserve and extend the inspection controls. |
| Focused re-research and approval before dependent regeneration | FR-20 and FR-21 preserve the core correction loop and unchanged-unrelated-geometry rule. |
| Non-destructive, restorable version history | FR-21 and FR-22 preserve new Versions and restoration without erasing later history. |
| Inspected, validated print-ready model before printer integration | FR-23 through FR-29 preserve a strong export gate, subject to R-11 and R-12. |
| Complete Temple, printer integration, other domains, and commercial sales deferred | §6.2 and the addendum retain these deferrals, subject to R-14 and R-15's lost sequencing and constraints. |
| Intended React, Tailwind, Vercel, Supabase, conditional Upstash, and GitHub direction | The addendum preserves these as architecture constraints and correctly says each service should be used only where it fits. |

## Additions requiring explicit authority

The following PRD capabilities are plausible elaborations, but they are not decisions in the beginner roadmap and should not silently redefine its first-release path:

- trusted invited Accounts, Registration Credential rotation, Administrator controls, Workspace isolation, and Account disabling;
- per-Account Usage Limits, paid/free research mode, cost reconciliation, and cache-versus-fresh research choice;
- multiple concurrent cross-Project Jobs and an app-wide Notification bar;
- shared source-derived research caching and permanent Project deletion semantics;
- plain-language Personalization throughout generation, approval, repair, validation, and export;
- a second formal, version-bound Model Approval after Plan Approval;
- Target Print Profiles, automatic local repair, and one constrained full-regeneration fallback;
- a mandatory Source Record sidecar; and
- picture-to-model workflows as a named deferred capability.

This is an authority check, not a recommendation to delete every addition. Each should either be traceable to another approved input, explicitly accepted as a PRD elaboration, or sequenced after the roadmap's Stage 7 gate.

## Recommended reconciliation order

1. Restore an authoritative phase-and-gate plan and decide whether the first release is genuinely personal-only.
2. Reinstate Middot governance, exact-passage preservation, section dossiers, and total bidirectional geometry/evidence mapping.
3. Add a semantic thin-slice correctness oracle in addition to reproducibility.
4. Close both post-validation approval gaps: any geometry repair must produce the exact inspected Version, and consequential print-driven regeneration must return through Plan Approval.
5. Add version comparison, certainty-aware presentation, and cross-cutting beginner guidance.
6. Preserve the reusable engine/domain seam, repeated section-expansion gates, and the deferred printer safety contract.
7. Explicitly accept, defer, or remove the additions that the beginner roadmap did not authorize.

Until the first two items are resolved, the current PRD remains implementable but is not a faithful beginner development roadmap: it preserves the destination while removing much of the staged risk control intended to make reaching it realistic.
