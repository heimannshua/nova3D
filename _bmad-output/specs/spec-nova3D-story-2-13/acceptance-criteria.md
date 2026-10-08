# Acceptance Criteria

**Story 2.13: Identify the pictured subject for research-assisted mode**

**Epic 2: Confirm requests and control background spending.** Users can submit text or ordered pictures, authorize the exact work and costs, and follow durable jobs without losing approved state.

As an Account owner,
I want to confirm what my pictures show before research starts,
So that research is aimed at the right subject and unsupported subjects stop early.

**Requirement IDs:** FR-5, FR-14, AR-17, SC-1, UX-DR8, UX-DR34

## Dependencies

- [2.3](../spec-nova3D-story-2-3/SPEC.md)
- [2.5](../spec-nova3D-story-2-5/SPEC.md)
- [2.7](../spec-nova3D-story-2-7/SPEC.md)
- [2.12](../spec-nova3D-story-2-12/SPEC.md)

## Scope

- In evidence_images mode, propose the pictured subject: with the paid synthesis/vision permission granted, one bounded Anthropic vision operation proposes a subject from the retained pictures for the user to confirm or edit; otherwise the user names the subject.
- A confirmed subject maps to a registered domain package. A subject with no registered package ends with a clear no-generator outcome that offers direct mode, and no research starts.

## Acceptance Criteria

### AC-1

**Given** evidence_images mode with the paid vision permission
**When** identification runs
**Then** one bounded operation proposes a subject, the user confirms or edits it, and the confirmed subject (not the model proposal) is recorded in the request revision

### AC-2

**Given** free mode or no vision permission
**When** the user continues
**Then** they name the subject themselves and no billable call occurs

### AC-3

**Given** a subject with no registered domain package
**When** scope is confirmed
**Then** no research or paid step starts and the user sees what is supported and the direct-mode alternative

## Engineering Gates

G-6.

These are acceptance obligations, not claims that the implementation or qualification has passed.
