# Implementation Constraints

Read the [project SPEC](../spec-nova3D/SPEC.md) and every companion it names recursively. Implement only this story's declared slice. Mapped requirements constrain the touched behavior; their other slices remain assigned to the other stories.

## Governing Interpretation

Ratified R-1–R-11 and approved SC-1–SC-7 override conflicting older PRD wording. Whole-plan approval and deterministic recipe equivalence apply to evidence_text/evidence_images. Direct image work uses confirmed ordered images/scope and acknowledged uncertainty, with honest inference provenance and restorable snapshots; it has no synthetic Research Plan or identical-reinference guarantee. Exact-model approval and required profile checks gate qualified export in every mode.

Prepared offline work follows the adopted no-lease/reconnect policy: learned disable locks until newer authoritative re-enable, learned tombstones purge before import, and network uncertainty alone is not deletion. R-11 permits one atomically consumed full fallback slot per lineage. The parent contract supplies every detailed authority, money, geometry, lifecycle and UX invariant.

## Mapped Requirements

### FR-5

#### FR-5: Natural-language project intake

An Account can start a Project by describing the desired model in ordinary language without finding or uploading source texts.

**Consequences:**
- If the request permits materially different subjects, periods, scopes, or outcomes, nova3D asks clarifying questions before starting paid research.
- The user sees and confirms nova3D's understanding of the Project scope.

Source: PRD §4, FR-5.

**Ratified application:** SC-1 also requires ordered multi-view picture intake and the two explicit picture modes; natural-language intake does not defer them.

Source: `_bmad-output/planning-artifacts/epics.md`, line 133 in the captured input.

### FR-14

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

Source: PRD §4, FR-14.

Source: `_bmad-output/planning-artifacts/epics.md`, line 243 in the captured input.

### AR-17

**AR-17: Provider boundary and uncertain charges.** Adopt Anthropic Messages claude-sonnet-5-5 for evidence synthesis/vision and Brave Web Search v1 for discovery behind adapters, with version/rate/account-term verification before enablement; the Brave adapter stays disabled until its terms are reviewed, and a Brave result is transient discovery input only. Search receives normalized public subjects only; vision receives only permissioned purpose-required data. No paid external 3D provider, Files/Batch/Managed Agents storage, private raw prompts in search, or billable free-credit fallback in free-only mode. Own hosting/storage/worker/local inference is instance overhead. The reservation is a calculator-computed bound over a provider-independent input bound and the output limit actually sent; the per-call ceilings (200,000 input tokens, 16,000 output tokens, 20 search requests per step) are admission limits, and cache, batch, server-tool, fallback and speed options are unsupported. Persist external identity before dispatch; an ambiguous outcome (transport loss, timeout, 5xx, aborted stream) retains its full reservation until usage evidence or a 24-hour reconciliation deadline and then settles at the reservation, a definitive pre-processing rejection with a request ID is documented noncharge, and evidence above a reservation settles at the evidence and blocks further admissions for that provider until reviewed; corrections append ledger entries without replacement calls.

Source: R-6; AD-11; G-6.

Source: `_bmad-output/planning-artifacts/epics.md`, line 649 in the captured input.

### SC-1

##### SC-1: Picture workflows move into the first version

The PRD deferred picture workflows. The first version now includes both:

- **Direct picture-to-model:** labelled image-derived and not historically verified.
- **Research-assisted picture reconstruction:** identifies the subject, researches it, builds a complete Research Plan, and follows Plan Approval before evidence-backed generation.

Picture intake supports existing images, phone camera capture, and multiple images of one subject from different angles. Before conversion, nova3D checks clarity and angle coverage and recommends additional views. The user may choose **Generate anyway** after an explicit warning that incomplete views can cause invented or inaccurate geometry.

Source: UX-SCOPE-CHANGES SC-1; canonical ux-contract; applicable ratified decisions.

Source: `_bmad-output/planning-artifacts/epics.md`, line 483 in the captured input.

### UX-DR8

**UX-DR8: Intake sequence and paid consent.** Confirm subject, scope, outcome, picture mode and personalization after text/image intake. For research, separately select free/paid and cache/fresh afterward, before dispatch. Present provider/category/purpose, outbound-data/retention and maximum before paid permission. Scope confirmation, start confirmation, Plan Approval and Model Approval remain distinct.

Source: UX-2; FR-4/FR-5/FR-14.

Source: `_bmad-output/planning-artifacts/epics.md`, line 807 in the captured input.

### FR-4

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

Source: PRD §4, FR-4.

Source: `_bmad-output/planning-artifacts/epics.md`, line 114 in the captured input.

### AR-7

**AR-7: Untrusted acquisition and output.** Restrict acquisition destinations/redirects, sizes and content types; block private-network and credential access. Source text, uploads and provider output are untrusted. Schema-validate output and verify citations before evidence acceptance. Never treat embedded instructions, prompts or proposed executable code as authority.

Source: AD-1, AD-5.

Source: `_bmad-output/planning-artifacts/epics.md`, line 599 in the captured input.

### AR-14

**AR-14: Durable Jobs and bounded retries.** Accept Jobs only with committed dispatch outbox; persist Job → JobAttempt → StepExecution → ExternalOperation identities and receipts. Upstash orchestrates bounded HTTP steps and worker completions; Postgres owns state. Configure workflow, explicit queue publishes and provider SDKs for zero failed-work retries, verifying effective behavior with a deliberately failing research step. Duplicate transport returns existing receipts without repeated side effects; terminal failed/cancelled attempts cannot be reclaimed. Lease loss becomes interrupted failure; user retries create new linked attempts under the same Job and wait for prior potentially chargeable work to reconcile. Logical step keys are unique per attempt, and operation ordinals per step; Jobs owns receipts while Usage owns their ledger entries. Preserve last approved state and actionable failure details.

Source: AD-9; work/billing identity.

Source: `_bmad-output/planning-artifacts/epics.md`, line 637 in the captured input.

### AR-16

**AR-16: Atomic money and paid permissions.** Paid categories independently disclose provider, purpose, outbound-data/retention categories and maximum, with Project permission off by default. Use one Usage-owned checked integer USD-microdollar/rational calculator: sum under immutable model/options/rates, apply billing increments, round upward once per operation, reject overflow/unknown rates/foreign currency/unsupported parameters. Atomically enforce Account-period allowance, $5 lifetime research-Job cap across attempts and $1 external-operation cap. Defaults are $25/invitee and $50/Administrator per UTC month. Preserve outstanding liabilities across resets; already-authorized work retains reservations while disable cancels it.

Source: AD-11; R-6; G-6.

Source: `_bmad-output/planning-artifacts/epics.md`, line 645 in the captured input.

### NFR-9

**NFR-9: Cost control.** Paid Work cannot begin without category-specific Project permission, a disclosed maximum charge, and an atomic cost reservation within the available Usage Limit. Usage records, reservations, settlements, and releases must reconcile with each idempotent Job. nova3D must present the resulting spending record clearly enough for Josh to understand and control spending.

Source: `_bmad-output/planning-artifacts/epics.md`, line 559 in the captured input.

### UX-DR36

**UX-DR36: Understood request (C-06).** Show subject, scope, intended outcome, picture mode, and Personalization; wait for confirmation.

Required states/variants: Clear, ambiguous with clarification questions, edit request, confirmed.

Source: SCREEN-INVENTORY C-06; canonical ux-contract; applicable ratified decisions.

Source: `_bmad-output/planning-artifacts/epics.md`, line 949 in the captured input.

## Planning Assumptions

- Story boundaries and the proposed order are delegated fast-path planning choices inferred from ratified requirements, not separately claimed user approvals.
- Evidence-backed generation and export can be implemented without waiting for the direct reconstruction engine; full first-version release still requires both picture modes and qualified offline/device behavior.
- Each story creates only the records and interfaces needed by its slice; later features inherit live authorization, immutable provenance, money, lifecycle and accessible UI contracts.
- Per-story specs have local stable CAP IDs and adopt the unchanged project-wide contract. No implementation dispatch, spec_checkpoint or done_checkpoint defaults are set in this planning run.
- Exact compatible patches, deployed resources, licensed font files and reconstruction weights remain delegated selections within adopted limits; missing qualifying evidence is engineering work, not a newly invented product question.

## Qualification Snapshot — September 14, 2026

| Gate | Recorded status |
| --- | --- |
| G-1 | PARTIAL |
| G-2 | PARTIAL |
| G-3 | PARTIAL |
| G-4 | NOT RUN |
| G-5 | BLOCKED |
| G-6 | PARTIAL |
| G-7 | NOT RUN |
| G-8 | BLOCKED |
| G-9 | PARTIAL |

Only actual qualifying evidence changes these statuses. Creating or validating a story spec does not pass an engineering gate. A missing offline engine or device result remains release-blocking under the adopted scope.
