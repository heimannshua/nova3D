# Privacy and Security Requirements Review

## Final resolution status — 2026-08-27

**PASS.** After remediation and editorial cleanup, the final CRITICAL/HIGH-only re-review found no unresolved critical or high privacy or security findings. The original review below is retained as the audit trail that drove the changes.

## Verdict

**Not ready to freeze.** The PRD states the right high-level intent for Workspace isolation, secret handling, provenance, and deletion, but it does not yet close several ordinary failure paths at registration, administrative state changes, concurrent paid-Job admission, shared-cache promotion, and deletion. These are product-contract gaps, not requests for enterprise compliance machinery.

**Finding counts:** 0 critical, 11 high, 2 medium, 0 low.

## Findings

### PS-01 — A reusable Registration Credential does not bound who or how many people can register

- **Severity:** high
- **PRD location:** `prd.md` §3, Registration Credential; §4.1, FR-1 (lines 74–80)
- **Problem:** The current Registration Credential is the sole registration gate, but the PRD gives it no expiry, use count, failed-attempt limit, or unused-invitation revocation semantics. Rotation only helps after the Administrator notices a leak. A copied credential can therefore be replayed to create an arbitrary number of Accounts.
- **Consequence:** An untrusted person can obtain a private Workspace, consume paid services, and force the Administrator into manual incident cleanup.
- **Exact requirement-level fix:** Replace FR-1 with: “The Administrator issues revocable invitation credentials. Each invitation expires at a stated time, permits exactly one successful Account creation, and becomes unusable after use or revocation. Registration attempts are rate-limited, return a generic failure, and are recorded without storing the credential. Rotating or revoking registration access invalidates every unused credential selected by the Administrator and never affects existing Accounts.”

### PS-02 — The Administrator privilege boundary and recovery path are not closed

- **Severity:** high
- **PRD location:** `prd.md` §2, Target User; §3, Administrator; §4.1, FR-2 through FR-4; §9, OQ-5
- **Problem:** The document lists several Administrator abilities but never makes them a closed allowlist, defines how the unique Administrator identity is assigned, or forbids invited Accounts from acquiring that role. It also leaves recovery open without requiring that recovery preserve Workspace isolation. “Without gaining routine access” is weaker than an explicit prohibition on impersonation or private-content access.
- **Consequence:** A permissive role or recovery implementation could let an invited Account escalate privileges, or let an Administrator/recovery flow enter or export another Account’s Workspace.
- **Exact requirement-level fix:** Add: “There is exactly one predesignated Administrator identity in the MVP. Registration, profile editing, and Account re-enablement cannot grant or transfer the Administrator role. Administrator authority is limited to invitation management, Account status, and the usage fields explicitly allowed by FR-4; it cannot read, search, download, export, impersonate, or reset authentication as another Account. Registration-credential changes, disable/re-enable actions, Usage Limit changes, and Administrator recovery require fresh Administrator authentication and create an immutable audit event. Administrator recovery uses proof distinct from the Registration Credential, revokes existing Administrator sessions, and grants no access to another Workspace.”

### PS-03 — Disabling an Account does not define what happens to live access and live paid work

- **Severity:** high
- **PRD location:** `prd.md` §4.1, FR-3 (lines 90–96); FR-6 (lines 115–123)
- **Problem:** “Cannot authenticate or start Jobs” does not say whether already-issued sessions, download links, open browser sessions, queued Jobs, running Jobs, or provider callbacks remain valid after disablement.
- **Consequence:** A disabled user can continue reading or changing private data, and existing work can continue spending money after the Administrator believes access has stopped.
- **Exact requirement-level fix:** Add to FR-3: “Disabling an Account immediately revokes all of its active sessions and temporary download access, blocks every Workspace read and write, prevents queued or running Jobs from starting another external or paid operation, and moves those Jobs to cancellation at the next safe boundary. Results or callbacks arriving after disablement cannot become current or user-accessible. Re-enablement requires a new sign-in and does not automatically resume cancelled work.”

### PS-04 — Concurrent Job admission can overshoot a Usage Limit or duplicate a paid Job

- **Severity:** high
- **PRD location:** `prd.md` §4.1, FR-4 and FR-6; §7, NFR-9; §9, OQ-7; `addendum.md` Architecture Decisions Deferred, background Job orchestration
- **Problem:** The PRD checks for an “available Usage Limit” but allows multiple Jobs to run and finish concurrently. It does not require one atomic decision across settled spend, queued/running commitments, repeated clicks, network retries, and provider redelivery. Several Jobs can each observe the same remaining allowance, and one requested Job can be charged more than once.
- **Consequence:** An Account can exceed its configured boundary by an unbounded amount without any deliberate Administrator action.
- **Exact requirement-level fix:** Add: “Admission of a paid Job is atomic and idempotent for one user request. Before acceptance, the Job reserves a declared maximum charge against the Account; settled usage plus all outstanding reservations cannot exceed the Usage Limit. Every downstream paid step consumes that reservation and cannot exceed the Job maximum. Duplicate submissions or callbacks produce the same Job rather than another charge. Completion or cancellation reconciles actual usage and releases unused reservation. Raising or resetting a limit never erases usage history or excludes existing reservations.”

### PS-05 — “Paid research” permission does not govern every billable operation

- **Severity:** high
- **PRD location:** `prd.md` §3, Job and Usage Limit; §4.2, FR-14; §4.3–§4.5, generation, validation, repair, regeneration, and export; §7, NFR-9
- **Problem:** FR-14 asks permission for paid research, while the Job glossary and later requirements allow generation, validation, repair, regeneration, and export Jobs that may also call paid services. NFR-9 then refers to the Project’s “paid-research permission” as though it covers all paid work.
- **Consequence:** A non-research stage can incur charges that the user never knowingly authorized, or different teams can interpret the same Project switch inconsistently.
- **Exact requirement-level fix:** Replace the narrow permission with: “Paid Work means any billable external operation in research, generation, validation, repair, regeneration, or export. Before the first paid operation in each enabled category, the Project records explicit user permission after showing the category and the Job’s maximum charge or usage allowance. Free-only mode blocks every new Paid Work operation, not only research. Every paid category remains subject to the Account Usage Limit and the reservation rule in FR-4.”

### PS-06 — External-service disclosure of private Project data is unspecified

- **Severity:** high
- **PRD location:** `prd.md` §4.1, FR-5; §4.2, FR-8 and FR-14; §7, NFR-1, NFR-9, and NFR-12
- **Problem:** The app may search the internet and use free or paid services, but the PRD never states which Project fields may leave nova3D. Natural-language goals, Personalization, source material, correction prompts, identifiers, or unrelated Workspace context could be sent to a provider without the user understanding that disclosure.
- **Consequence:** Private user material can be disclosed to an external service or retained outside the Workspace and deletion boundary.
- **Exact requirement-level fix:** Add: “Before a Project first uses an external provider, nova3D identifies the provider class and the categories of Project data that will be sent. Each request sends only data required for the current Project and operation; it never sends Account identifiers, authentication material, unrelated Workspace content, or Personalization unless that field is required and the user explicitly approves it. Provider requests, responses, and errors are private Workspace data. Provider retention or training that cannot be disabled, and any limit on provider-side deletion, must be disclosed before permission is granted.”

### PS-07 — Credential protection omits service, signing, recovery, and callback secrets

- **Severity:** high
- **PRD location:** `prd.md` §7, NFR-2
- **Problem:** NFR-2 protects login secrets and the Registration Credential only. nova3D will also depend on paid-provider keys, database and queue credentials, signing keys, recovery secrets, and callback-verification secrets, none of which are inside the stated product contract.
- **Consequence:** A secret can appear in a browser bundle, URL, prompt, Job record, error, log, Notification, or Export and enable unauthorized service use, forged callbacks, or data access.
- **Exact requirement-level fix:** Replace NFR-2 with: “All authentication, recovery, provider, database, queue, signing, and callback-verification secrets are confidential credentials. They are never returned to the browser, embedded in URLs, supplied to research or model prompts, or stored in readable logs, Jobs, Notifications, Source Records, or Exports. User-visible and Administrator-visible errors redact credentials. Secrets can be revoked and rotated without exposing their current values.”

### PS-08 — Project deletion can race with a running Job and resurrect deleted data

- **Severity:** high
- **PRD location:** `prd.md` §4.1, FR-6; §4.6, FR-30; §7, NFR-4 and NFR-5
- **Problem:** FR-30 does not define deletion while a Job is waiting, running, cancelling, or returning a delayed provider result. A Job can write a Model, Notification, usage-linked Project record, or cache entry after the user sees deletion succeed.
- **Consequence:** Deleted private data can reappear, be retained in the shared cache, or continue to incur charges.
- **Exact requirement-level fix:** Add to FR-30: “A deletion request first makes the Project unavailable and permanently ineligible for new Jobs, retries, paid steps, cache promotion, and Export download. Every waiting or running Project Job is cancelled; late results and callbacks are discarded and cannot recreate Project records or populate the shared cache. Project Notifications and temporary download access are removed. Deletion is reported complete only after active work is terminal and all covered active-storage artifacts have been removed.”

### PS-09 — The deletion contract omits whole-Workspace deletion and has no bounded backup/provider outcome

- **Severity:** high
- **PRD location:** `prd.md` §3, Workspace; §4.1, FR-3; §4.6, FR-30; §7, NFR-7; §9, OQ-9; `addendum.md` Architecture Decisions Deferred, deletion and backup retention
- **Problem:** A user can delete Projects and Exports, but cannot delete the Account and entire Workspace. The enumerated deletion result does not expressly cover Jobs, Notifications, intermediate files, previews, usage-linked identifiers, operational logs, temporary copies, or provider-held copies. Backup retention is left open even though FR-30 says “permanently delete” and “recoverable” storage.
- **Consequence:** Disabled Accounts or deleted Projects can leave private material indefinitely, and backup restoration can silently bring deleted material back.
- **Exact requirement-level fix:** Add a deletion requirement before implementation: “An Account can request deletion of its entire Account and Workspace as well as individual Projects. The deletion scope explicitly includes Projects, Sources, decisions, Models, Versions, Jobs, Exports, Personalization, approvals, Notifications, temporary and preview artifacts, and identifying operational records. Covered active data is removed within a stated maximum time; backup copies expire within a separate stated maximum, and every restore reapplies deletion tombstones before user access or Job processing. Provider-side deletion is requested where supported, and unavoidable provider retention is disclosed before use. Any retained usage/audit record has a field-level purpose and retention limit and cannot identify Project content. Shared-cache survival is permitted only for entries that independently satisfy the cache-admission requirement.”

### PS-10 — “Source-derived” is not a sufficient admission rule for a cache shared across Accounts

- **Severity:** high
- **PRD location:** `prd.md` §4.2, FR-14; §4.6, FR-30; §7, NFR-12
- **Problem:** The PRD defines the desired cache contents but no acceptance boundary for promoting research created inside a private Project. A Claim can be influenced by a private prompt, correction, chosen scope, Personalization, uploaded/private material, or generated reasoning while still being described loosely as source-derived.
- **Consequence:** Private input or a user-specific decision can be served to another Account through a cache that appears safe.
- **Exact requirement-level fix:** Add: “A cache entry is eligible for shared reuse only when every retained field is reproducible from an identified non-private Source and a retained source passage or location. Admission rejects Account, Workspace, Project, Job, and request identifiers; prompts and search queries; Personalization; uploaded or private material; user choices, annotations, corrections, and free-text notes; Model data; and values inferred only from those fields. Cache promotion performs a disclosure check against this allowlist before the entry becomes reusable. An entry that cannot prove eligibility remains private and is deleted with its Project.”

### PS-11 — Approved provenance is not pinned to immutable Source and cache revisions

- **Severity:** high
- **PRD location:** `prd.md` §4.2, FR-9 and FR-13; §4.4, FR-19 and FR-22; §4.5, FR-29; §7, NFR-3
- **Problem:** Sources retain identity and location context, but a web page, edition, extracted passage, or shared cache entry can change. The PRD does not require a Claim in an approved Plan to reference the exact immutable content revision it used, or require a cache correction to create a successor rather than rewrite history.
- **Consequence:** Evidence supporting an approved Model or Source Record can silently change, corrupting the claimed evidence-to-geometry lineage.
- **Exact requirement-level fix:** Add: “Every Claim references an immutable Source revision containing the source identity, edition or revision where available, exact passage/location, retrieval date, and a content identity sufficient to detect later change. Reused research also references an immutable cache-entry version. Source updates, extraction corrections, and cache corrections create successor versions and never alter evidence attached to an approved Research Plan, Model Version, or Export. Adopting a successor requires a new Research Plan version and Plan Approval.”

### PS-12 — Cache freshness metadata can reveal another user’s research activity

- **Severity:** medium
- **PRD location:** `prd.md` §4.2, FR-14 consequences (lines 199–200); §4.6 description and FR-30
- **Problem:** Cached results expose their “original research date,” while §4.6 promises that retained research cannot reveal user activity. In a small invited population, a rare subject plus an exact cache date—or a browsable cache inventory—can reveal that another person recently researched that subject even without an Account ID.
- **Consequence:** One Account can infer sensitive activity in another Account’s otherwise private Workspace.
- **Exact requirement-level fix:** Amend FR-14 and FR-30: “Accounts cannot browse cache inventory, hit counts, request times, or cache-only subject lists. Shared results may be labelled cached only after the requesting Account independently supplies the subject. The displayed freshness date is the Source capture or independent verification date, never the originating user-request time; any shared processing timestamp is coarse enough not to identify an individual request. Cache publication is separated from the requesting Account and exposes no event that can be attributed to that Account.”

### PS-13 — Administrator usage visibility has no field-level privacy boundary

- **Severity:** medium
- **PRD location:** `prd.md` §4.1, FR-2 and FR-4; §7, NFR-9
- **Problem:** “Paid usage or spending” and “ordinary Project content” do not define the allowed administrative fields. Job labels, provider payloads, Project names, source URLs, timestamps, errors, or drill-down identifiers can reveal a Project’s subject even if the Model itself is hidden.
- **Consequence:** The Administrator can receive private Project content or strong subject inferences through the cost-control interface or a usage export.
- **Exact requirement-level fix:** Add to FR-4: “Administrator usage visibility is an allowlist limited to Account identity and status, reporting period, paid-service category, quantity, currency or usage unit, settled amount, outstanding reservation, and coarse Job state/time needed to reconcile cost. It excludes Project names and identifiers, subjects, prompts, filenames, Personalization, source titles or URLs, provider requests/responses, and content-bearing errors. Administrative identifiers cannot be followed into a private Workspace, and the same allowlist applies to exported usage records and Notifications.”

## Release gate

Resolve every high-severity finding as normative FR/NFR acceptance language before treating the PRD as implementation-ready. PS-12 and PS-13 can use deliberately simple MVP policies, but those policies still need to be explicit so that cache reuse and cost administration do not quietly weaken Workspace isolation.
