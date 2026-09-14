# Architecture consistency review

Verdict: **Conditional pass.** The spine establishes unusually strong approval, provenance, fencing, and deletion invariants, but five seams still allow independently built features to produce incompatible records or authority. Resolve these before contract/schema work; they are feature-level ambiguities rather than missing story detail.

## Findings

### 1. Offline deletion has two valid authorities

**Priority: P0 — lifecycle/privacy**
**Location:** AD-15, AD-16, G-8

An offline client can retain an image/model in OPFS and metadata in IndexedDB while disconnected. Implementation A treats AD-15's “local operational traces” as a deletion-manifest item and purges only after reconnect; Implementation B treats the device store as an account-scoped cache outside server deletion, relying on AD-16's explicit statement that disconnected-device revocation/erasure is not guaranteed. Both can claim compliance with the current text, but they produce different post-delete states and different sync behavior: A must reject/purge a queued import, while B may import it after a later sign-in.

**Concrete fix:** In AD-15/AD-16, normalize only the online boundary now: a sync command must recheck live Account/tombstone/disable state; a tombstoned or disabled Account can never import local work; once the client learns the tombstone it must purge private local stores and discard queued sync commands (with an explicit local failure state). Keep the choice between indefinite disconnected use and immediate remote disable/deletion as the unresolved G-8 product gate; do not silently choose a lease or claim remote erasure while disconnected. G-8 must additionally specify the remaining offline divergence: whether a pre-tombstone local artifact may be retained/exported while disconnected and the maximum residual lifetime after reconnect failure.

### 2. Model/artifact manifest ownership is underspecified

**Priority: P1 — approval, restore, deletion**
**Location:** AD-6, AD-13, AD-15, Structural Seed module table and ER diagram

Implementation A makes `ModelVersion` authoritative via a Postgres manifest containing artifact keys/digests and treats Storage as blobs. Implementation B makes a signed manifest object in Storage authoritative and stores only a pointer/digest in `ModelVersion`. Both satisfy “committed, verified manifest,” “Model Version retains … artifact manifest,” and private Storage rules, yet restore, orphan cleanup, approval digest calculation, and deletion replay can resolve different roots. A partially restored model may be usable in A but not B, or vice versa.

**Concrete fix:** Add one canonical `ArtifactManifest` ownership rule: record family owned by Geometry or Manufacturing, canonical serialization and digest, authoritative location (database row or object), and the transaction that binds it to a Model/Export revision. Require all restore, approval, gateway, orphan cleanup, and deletion paths to resolve that one root; pointers may only be indexes.

### 3. Nonconsequential repair permits incompatible model identity

**Priority: P1 — stale approval/export risk**
**Location:** AD-7, AD-8, AD-3

Implementation A records every repair as a successor `ModelVersion`; Implementation B retains the same Model Version and records a repair derivative plus equivalence evidence because AD-8 permits “other repairs” without renewed Model Approval. Both follow the text. Their exports then disagree about whether `ModelApproval.model_content_digest` names the pre-repair model, post-repair artifact, or an equivalence class, and whether a later plan change invalidates the repair lineage.

**Concrete fix:** Define repair identity and digest semantics in AD-8: every physical artifact gets a distinct immutable artifact/derivative ID; specify when a new Model Version is mandatory, what exact content Model Approval covers for a nonconsequential repair, and whether export binds to the repaired derivative plus an equivalence proof. Make validation lineage and current-pointer behavior explicit.

### 4. Source exclusion timing yields different plan provenance

**Priority: P1 — reproducibility and cache privacy**
**Location:** AD-5, AD-14

Implementation A applies Account source exclusions as a query-time filter when adopting a public cache record. Implementation B materializes a filtered successor plan/claim set at adoption time and treats that snapshot as the effective evidence policy. Both satisfy “source exclusions still filter reuse” and immutable cache records, but the same cache revision can yield different plan digests, completeness results, and later behavior when the exclusion changes. Builders may also disagree whether a filtered cache adoption counts as fresh research.

**Concrete fix:** Specify the policy evaluation point and persisted evidence-policy identity: record the exclusion-set revision/epoch and source identities in the adoption/plan revision; define whether changing exclusions creates a successor plan and reruns completeness. Require cache adoption to produce the same deterministic filtered claim set for a given policy revision.

### 5. Job attempt and external operation identity can be shaped incompatibly

**Priority: P1 — duplicate paid work and recovery**
**Location:** AD-9, AD-10, AD-11, Structural Seed Jobs ownership

Implementation A gives one Job one attempt token and uses the provider operation/idempotency identity as the retry/reconciliation key. Implementation B gives each workflow step its own attempt and operation rows, with the Job token only fencing the final commit. Both satisfy “persist each step's execution identity,” “unique attempt/fencing token,” and “persist provider operation/idempotency identity before dispatch,” but cancellation, uncertain outcomes, and transport redelivery can resolve to different reservation/settlement rows. A user retry may therefore be treated as the same external operation in A and a new billable operation in B.

**Concrete fix:** Add a canonical identity hierarchy: `Job → JobAttempt → StepExecution → ExternalOperation`, with uniqueness constraints, ownership, and which node owns cost reservation/idempotency. Define whether user retry always creates a new JobAttempt and when an uncertain ExternalOperation may be reconciled versus superseded. Make cancellation and commit checks reference the same level.

## Recommended gate

Keep the fast-path architecture draft, but add these five decisions to the contract/schema readiness gate. Until then, independent feature work can pass unit tests while disagreeing on offline deletion, manifest restoration, approval digests, cache reproducibility, or paid-operation reconciliation.

## Final disposition after spine revision

Findings 2–5 are **closed** by the mandatory shared identities under Consistency Conventions: canonical `ArtifactManifest` roots, repair artifact/model-approval binding, policy snapshot identity, and the Job/Attempt/Step/ExternalOperation hierarchy now constrain ownership, digests, reconciliation, and retries.

Finding 1 is **partially closed and remains the only actionable blocker**. The spine now mandates live tombstone/disable rejection at sync, local locking/purge on observed disable/tombstone, and no ID reuse. G-8 correctly remains unresolved on the product policy for indefinite disconnected access versus immediate remote disable/deletion, plus residual retention/export and maximum lifetime when reconnect fails. Offline auth/sync stories and complete-scope release must remain gated until that policy is ratified; no documentation decision is required here.

Final verdict: **Conditional pass — one explicit G-8 product gate remains; no other consistency blocker found.**
