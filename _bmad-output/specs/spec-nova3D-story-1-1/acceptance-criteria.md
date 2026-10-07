# Acceptance Criteria

**Story 1.1: Adopt and harden the qualified application seed**

**Epic 1: Enter and use a private workspace.** Invited users can authenticate and use a responsive private workspace; Josh can control and recover access without inspecting private content.

As a maintainer,
I want a reproducible application startup,
So that implementation starts from the qualified runtime.

**Requirement IDs:** AR-1, AR-2, AR-26, NFR-2

## Dependencies

None.

## Scope

- Adopt the existing root Next.js App Router application (Next 16.3.5, React 19.3.0, TypeScript 5.9.3, Tailwind 4.3.3, Supabase SSR, interim Google sign-in) as the qualified seed and bring it to the pinned contract.
- Verify the environment at startup and in the deployment build, and exercise the check in CI. Label the mock dashboard a synthetic shell that later stories replace.
- Define module ownership and environment boundaries; later stories introduce their own entities.

## Acceptance Criteria

### AC-1

**Given** a clean checkout and the ratified package set
**When** dependencies install, typechecking and production build run
**Then** the lockfile records the adopted versions, `engines` and CI both pin Node 24.21.0, build-only tooling is not a runtime dependency, the bundler choice is recorded with its qualification evidence, and a loopback production page responds successfully

### AC-2

**Given** a preview environment
**When** configuration is loaded
**Then** production credentials and paid adapters are unavailable, and a mixed or unverifiable environment identifier fails startup and the deployment build. The check verifies an immutable environment identifier against each configured resource, not only the `APP_ENV` label, and CI exercises it against fixture environments. A credential-free local build still succeeds

### AC-3

**Given** the adopted shell
**When** its routes, data and modules are reviewed
**Then** it contains only startup needs and a clearly labeled synthetic dashboard, with no persisted-data claim, no future domain tables, and no claim that deployed providers are qualified

## Engineering Gates

This story has no separate gate ID; applicable project-wide gates still govern acceptance.

These are acceptance obligations, not claims that the implementation or qualification has passed.
