# Acceptance Criteria

**Story 1.2: Establish accessible localized navigation and preferences**

**Epic 1: Enter and use a private workspace.** Invited users can authenticate and use a responsive private workspace; Josh can control and recover access without inspecting private content.

As an Account owner,
I want consistent navigation and readable controls,
So that I can use my workspace on phone or computer.

**Requirement IDs:** AR-28, SC-3, SC-4, SC-7, UX-DR1, UX-DR2, UX-DR3, UX-DR4, UX-DR5, UX-DR6, UX-DR7, UX-DR20, UX-DR24, UX-DR26, UX-DR64

## Dependencies

- [1.1](../spec-nova3D-story-1-1/SPEC.md)

## Scope

- Implement semantic tokens and reusable focus, status, empty/error, confirmation and navigation patterns under R-10.
- Provide configured-language, light/dark and explanation preferences; every later surface inherits these patterns.

## Acceptance Criteria

### AC-1

**Given** a supported device language and no override
**When** the shell first opens
**Then** it uses a configured language match, light neutral/slate/indigo styling and dismissible ordinary-language guidance

### AC-2

**Given** an Account preference change
**When** language, explicit dark mode or technical detail is selected
**Then** the preference persists without changing evidence or decisions and guidance can be reopened

### AC-3

**Given** keyboard, screen reader, enlarged text, high contrast, reduced motion or an RTL locale
**When** the shell and its shared controls are exercised on phone and desktop
**Then** focus, names, announcements, contrast, reflow and logical directions preserve all actions; bilingual spans remain distinct

## Engineering Gates

This story has no separate gate ID; applicable project-wide gates still govern acceptance.

These are acceptance obligations, not claims that the implementation or qualification has passed.
