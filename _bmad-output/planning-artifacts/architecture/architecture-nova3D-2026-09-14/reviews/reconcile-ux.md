# UX reconciliation review

Reviewed `ARCHITECTURE-SPINE.md` against the approved `UX-SCOPE-CHANGES.md` and `.memlog.md` (2026-09-14).

## Verdict

**PASS WITH ONE CLARIFICATION.** The spine preserves the approved UX scope and does not present the unproven offline capability as implementation-ready. It explicitly carries both picture paths, multi-view intake, clarity/coverage warnings with **Generate anyway**, conflict-safe offline sync, equivalent phone capabilities, localization/RTL and source/translation distinction, push plus durable in-app history, accessibility/preferences, and the separate Project exclusion versus Account-wide source toggle semantics. The revocation/deletion contradiction for disconnected devices is honestly surfaced in G-8 rather than silently promised.

## Evidence checked

- SC-1 is covered by AD-3 and AD-16: direct mode is image-derived/not historically verified; research-assisted mode retains research and Plan Approval; ordered multi-view/camera input, coverage checks, acknowledged uncertainty, and the non-blocking Generate anyway path are explicit.
- SC-2 is covered by AD-16 and G-8: prepared local worker, IndexedDB/OPFS, stable IDs, idempotent sync, conflict retention, failed/pending states, no automatic cloud fallback, and an explicit offline feasibility/revocation gate.
- SC-3/SC-7 are covered by AD-17: the same workflow capabilities are required on phone, laptop and desktop, with keyboard/screen-reader controls, visible focus, text enlargement, contrast/non-colour states, reduced motion and WCAG 2.2 AA target.
- SC-4/SC-5 are covered by AD-17/AD-18: device-language default plus Account override, logical bidirectional layout, separate original/translation/explanation fields, durable notification history, category preferences and opaque push payloads.
- SC-6 is covered by AD-5/AD-10/AD-14: stable source identity across revisions, project/account policy epochs, invalidation and replacement research, immutable completed projects, warning suppression without provenance mutation, and exclusion during cache reuse.

## Actionable finding

1. **Make the online-only boundary for research-assisted picture reconstruction explicit in AD-16 or the workflow contract.** The UX change states that this path remains online-only. The spine clearly makes direct conversion local and requires online preparation/qualified export, but it does not state as directly that research-assisted reconstruction cannot begin or continue as an offline workflow. Add one sentence tying research-assisted intake/research/Plan Approval to authenticated online execution; retain offline direct conversion only. This is a clarification, not a scope defect, and should remain subject to G-8/provider gates.

No other approved UX change was found to be dropped or contradicted. The architecture correctly keeps printing notifications as a configured future category and does not imply printer control exists in v1.
