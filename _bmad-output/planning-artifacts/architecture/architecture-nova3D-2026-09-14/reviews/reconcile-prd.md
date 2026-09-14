# Architecture / PRD reconciliation

Date: 2026-09-14

## Verdict

**Pass with maintenance actions.** The spine covers the final PRD's FR-1–FR-30, NFR-1–NFR-12, deletion/cache rules, cost controls, provenance, deterministic geometry, validation, jobs, accessibility and the Vercel/Supabase/Upstash direction. It also carries the brief's central constraint that evidence and geometry remain inspectable and that printer control, commercial workflows and broader Temple scope are later work. The spine explicitly adopts the authoritative UX override, so the historical PRD/addendum conflict is not an architecture contradiction. The listed feasibility gates correctly avoid claiming that gated capabilities are proven.

## Findings

1. **Medium — source maintenance, not an architecture contradiction: picture workflows.** The historical PRD addendum defers direct picture-to-model and research-assisted reconstruction, while the spine's opening explicitly adopts the authoritative August 30 UX scope change and therefore makes both picture workflows first-version scope. Keep that precedence statement and the UX scope-change file in the architecture's `sources` list; optionally add a decision-register cross-reference so builders can find the supersession. Keep G-8 as a release gate and ensure image-derived output is never represented as historically verified.

2. **High — offline capability remains unproven.** AD-16 describes a prepared client, local inference bundle, IndexedDB/OPFS storage, conflict-safe sync and qualified online export; G-8 says no engine/device benchmark has been demonstrated and identifies the revocation-versus-disconnected-access conflict. Keep SC-1–SC-3 implementation gated until named-device quality, runtime, storage, interruption, lease/revocation and retention decisions are ratified; do not mark the complete first-version release ready on architecture text alone.

3. **Low — source coverage metadata.** The architecture cites `brief.md` but not `briefs/.../addendum.md`, even though that addendum supplies load-bearing feasibility constraints (generic image-to-3D is non-authoritative, commercial licensing remains user responsibility, and printer integration is parked). Add the addendum to `sources` or record it as reconciled so future builders can discover the governing input; this is maintenance, not a missing runtime contract.

4. **High — phase gates must be enforced in implementation planning.** The PRD's AD-1–AD-7 are phase-blocking decisions, not optional backlog items. The spine maps them to G-1–G-7 and labels trial tolerances and browser targets as unproven, which is correct. Make each gate an acceptance prerequisite in stories; local modules must not silently choose CadQuery/toolchain closure, equivalence tolerance, A1 mini validation evidence, provenance/PDF fixtures, viewer targets, provider cost/retention contracts or source-retention policy.

5. **Medium — proposed platform choices need ratification at the stated gates.** The PRD constrains the product direction to React/Tailwind, Vercel, Supabase, Upstash and GitHub; it does not select Railway, CadQuery, or the pinned package versions. Keep these marked as assumptions and require G-1/G-6/G-9 evidence before treating Railway, CadQuery, provider integrations or exact versions as production commitments.

## Coverage check

The capability map provides coverage for every PRD FR/NFR and the additional SC requirements. The architecture also preserves the brief's non-goals: printer control/physical printing, complete Temple expansion, collaboration, storefronts and commercial licensing decisions remain outside the first milestone.
