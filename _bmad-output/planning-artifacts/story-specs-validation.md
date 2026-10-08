# nova3D Story Specification Validation — September 14, 2026

**PASS for the planning artifact set: 8 epics, 58 story specs and 88 stable local capability IDs.** *(Verdict as of 2026-09-14; see [Amendment 2026-10-07](#amendment-2026-10-07) and [Amendment 2026-10-08](#amendment-2026-10-08).)* [Browse the specs](../specs/story-specs-index.md) or the [epic breakdown](epics.md).

The unchanged project-wide SPEC retains CAP-1–CAP-17. Local capability IDs are unique within each story folder; the 15 batch-B stories retain their original CAP-1–CAP-3 identities and AC correspondence. The other 43 stories use CAP-1. Spec completion does not mean implementation or release acceptance.

## Coverage and preservation

| Check | Result |
| --- | --- |
| Original FRs and all detailed Consequences | 30/30 retained and mapped |
| NFRs | 12/12 retained and mapped |
| Approved scope changes | 7/7 retained and mapped |
| Architecture requirements | 28/28 mapped by meaning |
| UX requirements and screen/state coverage | 73/73 requirements; all 53 source surfaces retained |
| Total extracted requirement identities | 150/150 mapped |
| Full mapped requirement occurrences in story companions | 457/457 exact-text matches |
| Story scope clauses | 88/88 preserved (75/75 after 2026-10-07; 70/70 on 2026-09-14) |
| Given/When/Then acceptance criteria | 177/177 preserved (175/175 after 2026-10-07; 174/174 on 2026-09-14) |
| Story dependency graph | 58 unique IDs; every dependency exists earlier in the proposed order |
| Capability IDs and original meanings | 88/88 retained; no unrecorded retirement or reassignment |
| Required story artifacts | 58 kernels, 116 local companions, 58 canonical memory logs |
| Companion/source paths and recursive parent contract | Resolved |
| Kernel structure | Five fields, intent/success per capability, explicit non-goals, concrete success signal |
| Source requirement locations | All captured requirement text and current source lines match |

The first story initializes only the qualified starter and startup needs. Tables and domain records are introduced by their owning slices. UX surfaces are assigned to their actual implementation stories; final device work qualifies already-implemented surfaces. Evidence generation/export does not depend on the direct reconstruction engine, while complete first-version release still requires both modes and offline/device acceptance.

## Validation scope

Four Codex/Luna agents distilled disjoint story batches with bmad-spec. Parent review corrected semantic requirement mappings before inputs were frozen, then checked every generated story against its exact source. Whole-set checks found and corrected companion paths, unreadable JSON wrappers, actor labels, generic success wording and dropped local capability IDs. Corrective decisions and superseding coherence/preservation verdicts are appended to the canonical logs; intermediate PASS events are not the final verdict when superseded.

A separate narrow Luna review checked repair equivalence, the shared unresettable regeneration slot, monotonic offline disable/deletion, direct export authority and deletion-aware restore. Parent checks independently verify all scope/AC/source-text occurrences, dependency order, preserved IDs/meanings, local links and recursive companion paths. The saved [machine results](story-specs-validation.json) and [artifact manifest](../specs/story-specs-manifest.json) identify the final set.

## Engineering boundaries

The September 14 baseline remains G-1/G-2/G-3/G-6/G-9 PARTIAL, G-5/G-8 BLOCKED and G-4/G-7 NOT RUN. These are dated evidence statuses; actual qualification may change them. Planning documents do not close them. A compliant offline multi-view reconstruction engine, real-device workflow/performance evidence, certified geometry/general validation, integrated provider controls and deployed recovery/retention still require their assigned implementation and qualification stories.

All detailed PRD metrics and counter-metrics remain inherited through the parent contract. Physical printing and direct printer control are not required for the adopted altar/ramp software demonstration. Product scope and adopted guarantees are unchanged; no application implementation or deployment was performed by this specification run.

## Amendment 2026-10-07

Applies the approved [Sprint Change Proposal](sprint-change-proposal-2026-10-07.md) to the derived story artifacts. `epics.md`, the Spine, `RATIFIED-DECISIONS.md`, `SCREEN-INVENTORY.md` and `scope-and-readiness.md` were amended first and are the source of truth.

**Stories changed:** 1.1 (title, scope, AC-1 to AC-3, AR-1), 1.3 (scope, AC-1, AR-18, UX-DR22), 1.4 (scope, AC-3, AR-18, UX-DR21), 1.6 (scope, AR-18) and 7.1 (scope, AC-2, new AC-4). Stories 1.5 and 8.2 changed only in the quoted AR-18 constraint text.

**Re-verified mechanically on 2026-10-07 (scripted comparison, not a new review):**

- **Hashes:** every manifest SHA-256 and byte count was recomputed and matches the file on disk.
- **Counts:** acceptance criteria 174 to 175 (Story 7.1 gained AC-4) and scope clauses 70 to 75 (1.1 +1, 1.3 +1, 1.4 +2, 7.1 +1). The 58 stories, 88 local capability IDs, 150 requirement identities and 457 mapped occurrences are unchanged.
- **Source parity:** for all 58 stories the title, scope and Given/When/Then text in the story input and in `acceptance-criteria.md` equal `epics.md`, and per-story AC counts agree across `epics.md`, the input JSON and the companion. All 457 captured requirement texts appear verbatim in the story constraints, and all 457 source lines in `epics.md` still match.
- **Dependencies:** no dependency, requirement-ID or gate field changed, and every dependency still precedes its story in the index order.
- **Links:** all 581 relative links and companion/source paths in the story specs, the index and this report resolve.

**Not done:** the full multi-agent validation was NOT re-run. The per-story coherence and preservation verdicts in the JSON for 1.1, 1.3, 1.4, 1.6 and 7.1 remain the 2026-09-14 verdicts on the earlier text, and the PASS at the top of this report is not re-affirmed for the amended text. Descriptive prose above, such as the sentence that the first story initializes only the qualified starter, describes the 2026-09-14 text. Gate statuses are unchanged and nothing here was implemented or deployed.

## Amendment 2026-10-08

Applies the architecture update (Spine AD-5, AD-8, AD-11, AD-12, AD-15, AD-18, AD-19 and `RATIFIED-DECISIONS.md` R-2, R-5, R-6, R-9) to the derived story artifacts. `epics.md` was amended first and is the source of truth.

**Stories changed (scope and/or acceptance criteria):** 1.1, 1.3, 1.4 (new AC-4 step-up binding and AC-5 purge versus registration), 1.6, 2.5, 2.6, 2.9, 3.1, 3.3, 3.7, 4.3, 6.1, 6.2, 8.2, 8.3 and 8.4. **Quoted constraint text only:** AR-17 in 2.5, 2.8 and 3.7; AR-18 in 1.3, 1.4, 1.5, 1.6 and 8.2; AR-26 in 1.1, 2.7, 8.4 and 8.7. A Planning Assumptions bullet in `epics.md` records which placements of newly required work are provisional until `bmad-create-epics-and-stories` runs.

**Re-verified mechanically on 2026-10-08 (scripted comparison, not a new review):**

- **Hashes:** every manifest SHA-256 and byte count was recomputed and matches the file on disk.
- **Counts:** acceptance criteria 175 to 177 (Story 1.4 gained AC-4 and AC-5) and scope clauses 75 to 88 (+1 each in 1.1, 1.3, 1.4, 1.6, 2.6, 2.9, 3.1, 3.3, 4.3, 6.1, 8.2, 8.3 and 8.4). The 58 stories, 88 local capability IDs, 150 requirement identities and 457 mapped occurrences are unchanged.
- **Source parity:** for all 58 stories the scope and Given/When/Then text in the story input and in `acceptance-criteria.md` equal `epics.md`, and every captured AR text in the inputs and constraints matches its `epics.md` line. All 457 source lines in `epics.md` still match their recorded line numbers.
- **Not re-run:** the full multi-agent validation, the link check (no links were added) and the SPEC kernels, whose capability text did not change. The 2026-09-14 PASS is still dated as of that day.
- **Open:** findings 4, 5, 7, 9 and 10 of `implementation-readiness.md` are not addressed by this amendment; the placements flagged in `epics.md` Planning Assumptions need `bmad-create-epics-and-stories`.
