# Acceptance Criteria

**Story 1.7: Navigate My Projects and project state**

**Epic 1: Enter and use a private workspace.** Invited users can authenticate and use a responsive private workspace; Josh can control and recover access without inspecting private content.

As an Account owner,
I want to find and reopen my Projects,
So that I can resume the next required action.

**Requirement IDs:** FR-2, FR-5, AR-3, NFR-1, SC-3, UX-DR24, UX-DR27, UX-DR28, UX-DR29, UX-DR30

## Dependencies

- [1.2](../spec-nova3D-story-1-2/SPEC.md)
- [1.4](../spec-nova3D-story-1-4/SPEC.md)

## Scope

- Create Project identity and model-focused collection with My Projects, Create and In Progress.
- Expose current stage and navigation; feature-specific transitions and deletion are supplied by their owning stories.

## Acceptance Criteria

### AC-1

**Given** a new Account
**When** Home opens
**Then** the three primary actions and useful empty states are visible on phone and desktop

### AC-2

**Given** owned Projects with current stage/version metadata
**When** an item is opened
**Then** the model/stage and Sources entry are selected with the next required action reachable

### AC-3

**Given** a stale, deleted or foreign Project link
**When** navigation resolves it
**Then** live ownership/lifecycle checks prevent disclosure and a clear unavailable state is shown

## Engineering Gates

This story has no separate gate ID; applicable project-wide gates still govern acceptance.

These are acceptance obligations, not claims that the implementation or qualification has passed.
