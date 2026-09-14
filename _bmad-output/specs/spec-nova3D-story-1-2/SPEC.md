---
id: SPEC-nova3D-story-1-2
status: final
companions:
- acceptance-criteria.md
- implementation-constraints.md
- ../spec-nova3D/SPEC.md
sources:
- ../../planning-artifacts/story-inputs/story-1-2.json
---

# Story 1.2: Establish accessible localized navigation and preferences

## Why

An Account owner needs consistent navigation and readable controls. They can use their workspace on phone or computer.

## Capabilities

- **CAP-1**
  - **intent:** Use a readable localized interface on first visit.
  - **success:** Given a supported device language and no override, when the shell first opens, then it uses a configured language match, light neutral/slate/indigo styling and dismissible ordinary-language guidance.

- **CAP-2**
  - **intent:** Save language, theme and explanation preferences.
  - **success:** Given an Account preference change, when language, explicit dark mode or technical detail is selected, then the preference persists without changing evidence or decisions and guidance can be reopened.

- **CAP-3**
  - **intent:** Operate every shared control with accessible input and presentation.
  - **success:** Given keyboard, screen reader, enlarged text, high contrast, reduced motion or an RTL locale, when the shell and its shared controls are exercised on phone and desktop, then focus, names, announcements, contrast, reflow and logical directions preserve all actions; bilingual spans remain distinct.

All [acceptance criteria](acceptance-criteria.md) apply to the complete story.

## Constraints

- This story implements the declared slice after its listed dependencies; it does not absorb unrelated parent capabilities.
- The [implementation constraints](implementation-constraints.md) and recursively adopted parent contract are mandatory, including ratified overrides to older source wording.
- Existing product decisions remain binding. Spec completion does not establish implementation, device support or engineering-gate acceptance.

## Non-goals

- Implementing unassigned later-story behavior or creating all future domain entities in advance.
- Adding manual mesh editing, public registration, printer control or commercial storefront behavior.

## Success signal

It uses a configured language match, light neutral/slate/indigo styling and dismissible ordinary-language guidance. The exact criteria demonstrate the complete story outcome and its failure boundaries; any gate-status change requires actual qualification evidence.

## Assumptions

- Story boundaries and ordering are delegated fast-path planning choices; they do not claim separate user approval. Detailed shared assumptions remain in the constraints companion.
