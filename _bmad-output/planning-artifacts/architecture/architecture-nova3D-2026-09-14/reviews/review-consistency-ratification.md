# Ratification consistency review

Verdict: **Conditional pass with four actionable contract clarifications.** Ratification closes the earlier ownership seams, but independently implemented modules can still disagree on money rounding, equivalence coordinates, offline re-enable state, and direct-reconversion consumption. Engineering checks remain explicitly NOT RUN; these are contract gaps, not claims that the selected designs are infeasible.

## Findings

### 1. Microdollar reservation and settlement can diverge

**Priority: P1 — overspend and ledger correctness**
**Location:** RATIFIED-DECISIONS.md R-6; ARCHITECTURE-SPINE.md AD-11

Implementation A rounds each provider token/search estimate up per request and reserves that integer microdollar amount; implementation B computes a decimal aggregate and rounds only at settlement. Both use USD integer microdollars and conservative reservations, but concurrent retries, minimum provider charges, FX-free USD billing, and ambiguous calls can produce different reservation release amounts and a remaining ceiling that is valid in one implementation and overspent in the other.

**Concrete fix:** Define one cost arithmetic contract: provider-unit-to-microdollar rate snapshot, rounding mode and stage (per line item versus aggregate), minimum/zero-charge behavior, tax/fee treatment, and settlement bounds. Require the same canonical cost estimate/receipt digest to drive reservation, reconciliation, release, and allowance comparisons; all reservation and ledger transitions remain integer and monotonic.

### 2. R-2 equivalence has no canonical comparison frame with R-3

**Priority: P1 — repair approval and geometry qualification**
**Location:** R-2, R-3, AD-7/AD-8

Implementation A measures the 0.01 mm surface/bounds tolerance after the R-3 print-scale transform and mesh tessellation; implementation B measures canonical millimetre BREP geometry before transform, then treats scale/orientation as a validation identity. Both can claim “at final print scale” while producing different pass/fail outcomes for unit conversion, rotation, or quantized print meshes. R-3’s allowed vertex welding/face cleanup also needs a stable feature correspondence definition.

**Concrete fix:** Pin R-2’s comparison inputs: canonical geometry or print-scale artifact, exact transform/rounding, units, tessellation/approximation method, and whether tolerances are absolute in physical millimetres. Require feature/component IDs and topology checks before distance/volume checks, and make the R-3 repair fixture invoke that exact shared comparator.

### 3. Offline re-enable and local state transitions remain underspecified

**Priority: P1 — account isolation and data loss**
**Location:** R-8, AD-12, AD-16

Implementation A treats a client that learned `disable` as permanently locked until a fresh session grant is issued; implementation B unlocks it when the next online authority check sees `active`. Both satisfy “do not unlock … without authoritative re-enable,” but they produce different behavior when an administrator re-enables an Account, and may differ on whether retained drafts can be viewed before re-enable. The no-lease decision intentionally remains, but this state machine is still needed for safe sync and account switching.

**Concrete fix:** Define local states and server transitions (`active`, `disabled-known`, `tombstoned-known`, `uncertain`), the exact authoritative re-enable event/session requirement, and which operations are allowed in each state. Keep G-8’s disconnected revocation limitation unchanged; this clarification does not claim remote erasure while disconnected.

### 4. R-11’s one-reconversion allowance needs an atomic consumption identity

**Priority: P1 — duplicate generation/cost and lineage integrity**
**Location:** R-11, R-6, AD-9/AD-10

Implementation A consumes the one reconversion allowance on the Job Attempt; implementation B consumes it on the validation lineage or Model Version. Concurrent worker redelivery/user retry can therefore admit two reconversions before either commit, while both appear to obey “at most one” and “a retry cannot reset” the allowance. Their successor Model Versions and cost reservations then diverge.

**Concrete fix:** Add a unique, transactionally consumed `direct_reconversion_slot` keyed by immutable validation-lineage ID (or explicitly choose another identity), with a compare-and-set state transition before dispatch. Every R-11 attempt references that slot; redelivery reconciles the same ExternalOperation, and all later retries fail with the same terminal code. Bind the successor Model Version and new settings digest to the consumed slot.

## Final disposition after ratification closure

The four P1 findings are **closed** in the current ratified record:

- R-6 now mandates one integer/rational calculator, upward rounding once per operation, immutable rate snapshots, and atomic Account-period/Job/operation ceilings.
- R-2/R-3 now share the pinned print transform, target-profile lineage, tessellator/comparator and error-bound identity; preview LOD is excluded from authority.
- R-8 now defines monotonic `permitted_local → locked_disabled → tombstoned`, authoritative re-enable epochs, and anti-downgrade behavior. Its no-lease product limitation remains explicit.
- R-11 now uses a unique `(lineage_id, full_regeneration)` slot consumed atomically with successor Job/outbox/reservation and never reset.

The former P2 R-5 finding is also **closed**: the record defines cold open-to-interactive timing, the ≤5 MB coarse first view, ≤20 MB progressive detail set, and version-compatible semantic maps with atomic switching.

Final verdict: **Pass for this targeted closure review.** Engineering qualification remains NOT RUN by design, but no actionable consistency blocker from this review remains.
