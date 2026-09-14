# Implementation Constraints

Read the [project SPEC](../spec-nova3D/SPEC.md) and every companion it names recursively. Implement only this story's declared slice. Mapped requirements constrain the touched behavior; their other slices remain assigned to the other stories.

## Governing Interpretation

Ratified R-1–R-11 and approved SC-1–SC-7 override conflicting older PRD wording. Whole-plan approval and deterministic recipe equivalence apply to evidence_text/evidence_images. Direct image work uses confirmed ordered images/scope and acknowledged uncertainty, with honest inference provenance and restorable snapshots; it has no synthetic Research Plan or identical-reinference guarantee. Exact-model approval and required profile checks gate qualified export in every mode.

Prepared offline work follows the adopted no-lease/reconnect policy: learned disable locks until newer authoritative re-enable, learned tombstones purge before import, and network uncertainty alone is not deletion. R-11 permits one atomically consumed full fallback slot per lineage. The parent contract supplies every detailed authority, money, geometry, lifecycle and UX invariant.

## Mapped Requirements

### FR-1

#### FR-1: Controlled account creation

The Administrator can issue and revoke Invitation Codes, and a new user can create an Account only by supplying a valid code.

**Consequences:**
- Public registration is unavailable.
- Each named invitation receives a different single-use code.
- The Administrator can also share one current general code; successful use immediately invalidates it and generates a different current code.
- Unused codes remain valid until successful use or Administrator revocation; they do not expire solely with time.
- Registration attempts are rate-limited to resist code guessing.
- Changing or revoking Invitation Codes does not invalidate existing Accounts.

Source: PRD §4, FR-1.

Source: `_bmad-output/planning-artifacts/epics.md`, line 71 in the captured input.

### FR-2

#### FR-2: Authentication and workspace isolation

An Account can authenticate and access only its own Workspace.

**Consequences:**
- Cross-Account access to Projects, Sources, decisions, Models, Versions, Jobs, Exports, and Notifications is denied.
- Administrative usage controls do not expose ordinary Project content.
- The Administrator cannot impersonate an Account, browse its private Workspace, or assign additional administrative privileges through the app.

Source: PRD §4, FR-2.

Source: `_bmad-output/planning-artifacts/epics.md`, line 85 in the captured input.

### AR-18

**AR-18: Identity and administrative enforcement.** Disable public Supabase signup; hash/atomically claim invitations and idempotently provision Auth plus Workspace with unusable partial activation. Rate-limit guessing; rotate shared codes only after success. Verify JWT plus live Account and session grant on every private path, including direct RLS/storage access. The sole Administrator cannot impersonate, inspect private Workspaces or grant more administrators. Sensitive actions require fresh authentication and immutable audit; verified-email single-use short-lived recovery revokes prior sessions.

Source: AD-12; FR-1–FR-4.

Source: `_bmad-output/planning-artifacts/epics.md`, line 653 in the captured input.

### NFR-1

**NFR-1: Workspace privacy.** Every user-facing and background operation enforces Account ownership. Cross-Account access to private Workspace data must produce no data disclosure.

Source: `_bmad-output/planning-artifacts/epics.md`, line 541 in the captured input.

### NFR-2

**NFR-2: Secret protection.** Login, Invitation Code, recovery, provider, database, queue, signing, and callback-verification secrets are never stored or logged in readable form or exposed through browsers, URLs, prompts, Jobs, Notifications, Source Records, or Exports. Sensitive authentication actions require secure transport and protected sessions. Secrets support redaction, rotation, and revocation.

Source: `_bmad-output/planning-artifacts/epics.md`, line 543 in the captured input.

### UX-DR22

**UX-DR22: Invitation registration (A-02).** Single-use Invitation Code, Account creation, clear generic failures.

Required states/variants: Valid, invalid/revoked/used code, rate-limited, success.

Source: SCREEN-INVENTORY A-02; canonical ux-contract; applicable ratified decisions.

Source: `_bmad-output/planning-artifacts/epics.md`, line 865 in the captured input.

### UX-DR69

**UX-DR69: Invitation Codes (AD-01).** Unique named codes plus rotating single-use general code.

Required states/variants: Unused, used, revoked, newly rotated, copy action.

Source: SCREEN-INVENTORY AD-01; canonical ux-contract; applicable ratified decisions.

Source: `_bmad-output/planning-artifacts/epics.md`, line 1147 in the captured input.

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
