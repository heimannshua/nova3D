---
id: SPEC-nova3D-story-2-16
status: final
companions:
- acceptance-criteria.md
- implementation-constraints.md
- ../spec-nova3D/SPEC.md
sources:
- ../../planning-artifacts/story-inputs/story-2-16.json
---

# Story 2.16: Pay a request through hosted checkout

## Why

An Account owner needs to pay a request by card on a secure page. The credit is added without their card details touching nova3D.

## Capabilities

- **CAP-1**
  - **intent:** An Account owner can pay a request by card on a secure page.
  - **success:** A Checkout Session for exactly the request's price in USD is created, any earlier open session is expired and the owner is redirected; another Account cannot create one and a disabled Account is refused.

All [acceptance criteria](acceptance-criteria.md) apply to the complete story.

## Constraints

- This story implements the declared slice after its listed dependencies; it does not absorb unrelated parent capabilities.
- The [implementation constraints](implementation-constraints.md) and recursively adopted parent contract are mandatory, including ratified overrides to older source wording.
- Existing product decisions remain binding. Spec completion does not establish implementation, device support or engineering-gate acceptance.

## Non-goals

- Implementing unassigned later-story behavior or creating all future domain entities in advance.
- Adding manual mesh editing, public registration, printer control or commercial storefront behavior.

## Success signal

A Checkout Session for exactly the request's price in USD is created, any earlier open session is expired and the owner is redirected; another Account cannot create one and a disabled Account is refused. The exact criteria demonstrate the complete story outcome and its failure boundaries; any gate-status change requires actual qualification evidence.

## Assumptions

- Story boundaries and ordering are delegated fast-path planning choices; they do not claim separate user approval. Detailed shared assumptions remain in the constraints companion.
