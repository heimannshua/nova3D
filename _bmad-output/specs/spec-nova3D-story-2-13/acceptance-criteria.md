# Acceptance Criteria

**Story 2.13: Identify the pictured subject for research-assisted mode**

**Epic 2: Confirm requests and control background spending.** Users can submit text or ordered pictures, authorize the exact work and costs, and follow durable jobs without losing approved state.

As an Account owner,
I want to confirm what my pictures show before research starts,
So that research is aimed at the right subject and unsupported subjects stop early.

**Requirement IDs:** FR-5, FR-14, AR-17, SC-1, UX-DR8, FR-4, AR-7, AR-14, AR-16, NFR-9, UX-DR36

## Dependencies

- [2.3](../spec-nova3D-story-2-3/SPEC.md)
- [2.5](../spec-nova3D-story-2-5/SPEC.md)
- [2.7](../spec-nova3D-story-2-7/SPEC.md)
- [2.12](../spec-nova3D-story-2-12/SPEC.md)
- [2.1](../spec-nova3D-story-2-1/SPEC.md)
- [2.8](../spec-nova3D-story-2-8/SPEC.md)

## Scope

- In evidence_images mode, after the pictures are confirmed and retained (Story 2.12) and before scope confirmation, the user either names the pictured subject or grants an identification permission. That permission is its own category-and-purpose disclosure (purpose: identify the pictured subject; data: the retained pictures; maximum from the Story 2.6 calculator) and never authorizes a later research operation. Identification is a purpose of the synthesis/vision category, not a new category, and its Job has the ordinary $5 parent-Job cap.
- With that permission, one bounded Anthropic vision operation runs as its own Job (its own parent-Job cap, the $1 operation ceiling and the Account allowance) and returns a schema-validated (subject name, confidence, alternatives), untrusted proposal for the user to confirm or edit, built from transient provider-bound derivatives of the pictures (all metadata removed, re-encoded, long edge at most 1568 px, at most 5 MB each) that are never stored; a provider outage or ambiguous outcome follows Story 2.8 and the user can always name the subject instead; a successor request revision records the confirmed subject, not the proposal.
- A confirmed subject is matched by name or alias against the domain-package registry created in Story 2.1. No match ends with a no-generator outcome that lists the supported subjects and offers direct mode, and no research starts.

## Acceptance Criteria

### AC-1

**Given** evidence_images mode with confirmed pictures and the identification permission
**When** identification runs
**Then** one bounded operation, reserved and recorded like any billable operation, proposes a subject, the user confirms or edits it, and a successor request revision records the confirmed subject rather than the proposal; the same actions work on phone and desktop

### AC-2

**Given** free mode, no permission or insufficient allowance
**When** the user continues
**Then** they name the subject themselves and no billable call occurs

### AC-3

**Given** a confirmed subject with no registered domain package
**When** the subject is confirmed
**Then** no research or paid step starts and the user sees what is supported and the direct-mode alternative

### AC-4

**Given** pictures sent for identification
**When** the outbound payload is built
**Then** every image is a metadata-free derivative within the size limits, and nothing derived is stored

## Engineering Gates

G-6.

These are acceptance obligations, not claims that the implementation or qualification has passed.
