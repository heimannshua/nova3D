# Acceptance Criteria

**Story 1.1: Bootstrap the qualified application seed**

**Epic 1: Enter and use a private workspace.** Invited users can authenticate and use a responsive private workspace; Josh can control and recover access without inspecting private content.

As a maintainer,
I want a reproducible application startup,
So that implementation starts from the qualified runtime.

**Requirement IDs:** AR-1, AR-2, AR-26, NFR-2

## Dependencies

None.

## Scope

- Initialize only the official pinned Next/App Router/TypeScript/Tailwind seed, Supabase SSR wiring and environment checks needed to serve an empty application.
- Define module ownership and environment boundaries; later stories introduce their own entities.

## Acceptance Criteria

### AC-1

**Given** a clean checkout and the ratified package set
**When** dependencies install, typechecking and production build run
**Then** the lockfile records the adopted versions and a loopback production page responds successfully

### AC-2

**Given** a preview environment
**When** configuration is loaded
**Then** production credentials and paid adapters are unavailable, and mixed environment identifiers fail startup

### AC-3

**Given** the initial starter
**When** its migrations and modules are reviewed
**Then** it contains only startup needs, not all future domain tables or a claim that deployed providers are qualified

## Engineering Gates

This story has no separate gate ID; applicable project-wide gates still govern acceptance.

These are acceptance obligations, not claims that the implementation or qualification has passed.
