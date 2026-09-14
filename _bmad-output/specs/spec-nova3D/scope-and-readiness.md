# Scope, Acceptance and Readiness

## Contract precedence

Read this companion, [ux-contract.md](ux-contract.md), the adopted [PRD](../../planning-artifacts/prds/prd-nova3D-2026-08-27/prd.md) and [architecture spine](../../planning-artifacts/architecture/architecture-nova3D-2026-09-14/ARCHITECTURE-SPINE.md) with SPEC.md and the adopted [ratified decisions](../../planning-artifacts/architecture/architecture-nova3D-2026-09-14/RATIFIED-DECISIONS.md). Detailed PRD consequences, glossary, quality rules and metrics remain contractual; the capability kernel is not a replacement for those details.

1. Explicit user decisions, including September 14 fast-path ratification R-1–R-11 and the approved post-PRD UX changes, determine current product scope.
2. This spec and its UX companion carry those changes forward; the override table below identifies the obsolete source statements.
3. The final PRD governs remaining behavior, including all FR-1–FR-30, NFR-1–NFR-12 and its acceptance metrics.
4. The architecture supplies ratified implementation invariants and diagrams with original AD IDs. G-1–G-9 now track engineering verification; adopted defaults do not certify tests passed.
5. Briefs/addenda provide absorbed background and later direction; they cannot restore superseded sole-user, source-upload or picture-deferral behavior.

`CAP-n` identifies specification capabilities; `FR-n`, `NFR-n` and `SM-n` retain PRD identities; `SC-n` identifies approved UX scope changes. `AD-n` refers to the architecture; `PRD:AD-n` refers to the separate PRD ratification register. `G-n` retains the architecture gate identity; Q-1–Q-11 identify resolved questions whose dispositions are R-1–R-11. Historical assumptions A-1–A-3 are adopted under those decisions.

## Explicit scope and workflow-mode rules

| Source statement or ambiguity | Governing interpretation |
| --- | --- |
| Brief says Josh is the only user and starts by choosing source material. | PRD controlled Accounts and natural-language intake apply. nova3D discovers the governing sources; the user need not upload or choose them first. |
| PRD §5/§6 and its addendum defer picture workflows. | SC-1 places both direct image-derived and research-assisted picture workflows in the first version. This supersedes the deferral wherever repeated. |
| Desktop browser matrix was deferred. | SC-3 requires the complete phone, laptop and desktop workflow. R-5 fixes qualification devices/browsers and measurable targets; G-5 verifies them. |
| PRD plan-approval wording and SM-3 refer to all generation. | Whole-plan approval gates evidence-text and research-assisted picture generation. Direct conversion uses confirmed scope/images and explicit uncertainty acknowledgment; exact-model approval and print validation still gate qualified export. |
| PRD canonical reproducibility and SM-4/SM-6 presume approved-plan geometry. | Deterministic-equivalence requirements apply to evidence-backed recipes. Direct inference retains exact input/activity/output identities and restorable snapshots; it cannot claim historically verified geometry or identical re-inference. |
| Every feature must expose evidence. | Evidence-backed features expose claims/source support and explicit status. Direct-image features expose image/inference provenance and uncertainty, not fabricated source claims. User-added features remain distinguishable in both branches. |
| FR-28 regenerates from an approved Research Plan after failed local repair. | Evidence mode regenerates from its approved plan. R-11 allows one full direct-image reconversion from pinned images/scope/engine with failed print constraints, in the same immutable validation lineage; new inspection, exact-model approval and validation follow. No synthetic plan or waived check. |
| Offline persistence conflicts with immediate remote disable/deletion. | R-8 preserves immediate cloud revocation and adopts revocation on reconnect for already-local data, without a disconnected time lease. Learned disable locks; learned deletion purges before import. Disconnected devices/downloaded files are outside controlled-backup erasure deadlines. |
| UX visual outputs and architecture are labelled draft/final. | R-10 selects the visual baseline and delegates detailed layouts without another direction-selection checkpoint. Existing mockups remain historical drafts. Technical defaults are ratified; local qualification evidence is available; full engineering acceptance remains open. |

The first evidence-backed development fixture remains the outer altar/ramp from Middot chapter 3 plus a clearly user-added personalization. Both picture modes are also first-version scope; unrelated evidence-research domains remain later work. Research uses clear governing descriptions directly, expands for missing/ambiguous/disputed consequential details, and stops when complete defensible options are ready for whole-plan review.

## Capability traceability

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

## Acceptance rules

The PRD's SM-1–SM-10, including SM-2a, remain the quantitative acceptance criteria. In particular, the evidence-backed regression corpus must achieve complete consequential-detail coverage and omission checks, complete reciprocal feature/claim traceability, exact-version approval enforcement, equivalent regeneration and unaffected geometry within ratified tolerance, restoration of every non-deleted restorable version, no cross-Account disclosure, no unauthorized paid work, and a valid profile-qualified export with repair history.

Apply SM-3/SM-4/SM-6 to the workflow modes described above. Direct-image output retains its own honest provenance, version approval, validation, history and privacy obligations. No capability is verified merely because a UI mockup or plan document exists.

Preserve all counter-metrics: do not optimize source count over authority, speed over complete evidence/approval, validation pass rate by suppressing checks or warnings, or cache reuse by claiming freshness. Source Records retain validation profile, warnings/unknowns, timestamp and repairs; successful software checks are not historical, safety or universal manufacturing certification.

The initial physical envelope is at most 90 × 90 × 90 mm with the adopted A1 mini, standard 0.4 mm nozzle and gold silk PLA. R-3 fixes PLA Silk+ Gold, profile inheritance, initial thresholds and permitted repairs; G-3 verifies the profile and validators. A physical print and direct printer integration are not required for the altar/ramp demonstration.

## Ratification and engineering readiness

Josh's “ratify all fast path” closes A-1–A-3, Q-1–Q-11 and the product-approval portions of PRD:AD-1–PRD:AD-7. [RATIFIED-DECISIONS.md](../../planning-artifacts/architecture/architecture-nova3D-2026-09-14/RATIFIED-DECISIONS.md) records each question's disposition, binding defaults and evidence responsibilities. There are no remaining user-approval questions for those defaults. The [qualification run](../../implementation-artifacts/qualification-2026-09-14/REPORT.md) records the subsequent local evidence and its application/device boundaries.

| Gate | Adopted baseline | Status | Evidence and remaining work | Affected capabilities |
| --- | --- | --- | --- | --- |
| G-1 | R-1 | PARTIAL | Synthetic native generation/correction/restore/cancellation passed. Complete the approved corpus and deployed application worker. | CAP-8, CAP-10; geometry in CAP-3/CAP-12 |
| G-2 | R-2 | PARTIAL | Coarse comparisons passed. Certified surface-distance/error bounds and final-print correspondence remain unimplemented. | CAP-8, CAP-10, CAP-12 |
| G-3 | R-3, R-11 | PARTIAL | Profile closure, three-perimeter override, fixtures and one BambuStudio slice passed. General validation/support, repair and lineage integration remain unimplemented. | CAP-12, CAP-13 |
| G-4 | R-4 | NOT RUN | Cross-runtime schema, linked immutable export and bilingual PDF remain unrun. | CAP-9, CAP-13 and provenance consumers |
| G-5 | R-5, R-10 | BLOCKED | Headless Linux API/storage probes passed. Real named devices, viewer timing, accessibility and GPU-loss recovery remain unqualified. | CAP-9, CAP-10, CAP-11, CAP-17 |
| G-6 | R-6 | PARTIAL | Local integer budget/concurrency probes passed. Provider terms, permission enforcement and ambiguous-charge reconciliation remain unqualified. | CAP-2 and every billable operation |
| G-7 | R-7 | NOT RUN | Exact edition/rights ingestion and permitted retention paths remain unrun. | CAP-5, CAP-6, CAP-13, CAP-15 |
| G-8 | R-8, R-11 | BLOCKED | Storage/runtime primitives passed. No reviewed reconstruction model meets the adopted phone target; offline inference, device quality and authoritative sync remain unqualified. | CAP-16 and offline CAP-1/CAP-3/CAP-8/CAP-14/CAP-17 |
| G-9 | R-9 | PARTIAL | Local database/object restore with intervening deletion passed. Full app/cloud restore, live fencing, retention and RPO/RTO remain unqualified. | All production private-data capabilities |
| UX / Q-10 | R-10 | NOT RUN | Complete responsive layouts and verification against the UX contract; no uncreated mockups are approved. | CAP-17 and other visual surfaces |
| Q-11 | R-11 | PARTIAL | SQL unique-slot primitive only; application direct-image constrained reconversion and unresettable lineage limit, covered by G-3/G-8. | CAP-12, CAP-13 |

Implementation and qualification work may proceed now. An affected capability cannot be accepted, and the complete first version cannot be released, until its engineering evidence passes. Exact compatible dependency patches, deployed tiers/resources, font files and offline weights are delegated selections under the adopted contracts; a missing suitable offline engine remains release-blocking. These implementation responsibilities do not create another ratification ceremony. A proposal to change product scope or weaken an adopted guarantee requires a recorded product decision.

## Later sequence and inherited limits

After proving the altar/ramp integrity chain and satisfying the approved first-version scope, expand to the complete Temple and utensils, then printer control/fleet management, then reusable packages for other research domains/model types. Commercial sale follows repeatable output quality; storefront/billing features are not implied.

The later printer direction retains printer/device/filament state, authenticated integration, configuration, camera feeds, safe queues and explainable selection without interrupting active jobs. Upload, printer selection and print start remain separate gates with explicit final confirmation, live progress/errors/pause/cancel, duplicate-start prevention and an audit trail that cannot alter approved provenance.

Commercial licensing decisions remain the user's responsibility. This does not remove the separate source-content retention policy required before ingestion/cache use.
