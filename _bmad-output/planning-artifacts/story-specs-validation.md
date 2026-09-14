# nova3D Story Specification Validation — September 14, 2026

**PASS for the planning artifact set: 8 epics, 58 story specs and 88 stable local capability IDs.** [Browse the specs](../specs/story-specs-index.md) or the [epic breakdown](epics.md).

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
| Story scope clauses | 70/70 preserved |
| Given/When/Then acceptance criteria | 174/174 preserved |
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
