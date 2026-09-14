# PRD reconciliation after fast-path ratification

Date: 2026-09-14

## Verdict

**Conditional pass.** R-1–R-11 successfully ratify the previously open architecture/product choices without dropping the PRD's core obligations. G-1–G-9 are correctly retained as engineering evidence gates; “ratified” is not presented as “proven.” One material internal contract ambiguity must be corrected before implementation stories consume the mode semantics.

## Findings

1. **High — direct mode conflicts with the current AD-3 sentence.** AD-3 says “both evidence modes require complete research,” then defines `image_direct` as a mode with confirmed scope and coverage warnings; R-11 explicitly says direct-image recovery must never invent a Research Plan. Revise AD-3 to require complete research only for `evidence_text` and `evidence_images`; define `image_direct`'s gate as pinned ordered images, confirmed scope, acknowledged uncertainty/coverage, Model Approval and online qualified validation/export.

2. **Medium — offline authority semantics are intentionally weaker than the original deletion guarantee and need implementation-level prominence.** R-8 adopts indefinite disconnected usability of already-local drafts, revocation/deletion on reconnect, and excludes disconnected devices/user downloads from the 30-day controlled-backup guarantee. This is a deliberate ratified resolution, not a dropped obligation, but offline preparation UX, deletion copy, sync commands and lifecycle tests must state the limitation and must never imply immediate remote erasure.

3. **Medium — direct-image reconversion is a narrowly ratified exception that must not become generic retry behavior.** R-11 permits one full reconversion in the same immutable validation lineage, while AD-9 otherwise requires failed research/generation attempts to have zero automatic retries and user-directed new attempts. Encode the consumed lineage allowance and explicit failed-constraint trigger in the job/validation contract; ordinary worker retries and repair children must not reset it.

4. **Low — ratified provider/model choices remain acceptance targets, not PRD evidence.** R-6 selects Anthropic/Brave, caps paid research at $5 per research Job and $1 per external operation, and R-8 selects ONNX Runtime Web 1.29.0, but all experiments are explicitly NOT RUN. Keep provider and offline stories blocked by G-6/G-8 evidence, including actual retention/terms, bounded cost reconciliation, licensed pinned weights and device quality; do not treat the chosen names as proof of feasibility.

5. **Low — the new R-3 print profile is narrower and more explicit than the earlier PRD wording.** Bambu PLA Silk+ Gold, 0.20 mm layers, three perimeters and the stated wall/feature/clearance/relief thresholds are adopted engineering acceptance values, while support/overhang checks remain evidence-dependent. Validation stories must use the inherited profile digest and classify unknown support/slicing checks as export-blocking; they must not infer manufacturability from nozzle size alone.

## Scope retained

No ratification finding drops FR-1–FR-30, NFR-1–NFR-12 or SC-1–SC-7. Printer control, complete Temple expansion, commercial workflows and other later sequence items remain excluded. Engineering checks and provider/device qualification remain unrun as explicitly recorded.
