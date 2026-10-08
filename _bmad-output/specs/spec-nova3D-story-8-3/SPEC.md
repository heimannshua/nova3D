---
id: SPEC-nova3D-story-8-3
status: final
companions:
- acceptance-criteria.md
- implementation-constraints.md
- ../spec-nova3D/SPEC.md
sources:
- ../../planning-artifacts/story-inputs/story-8-3.json
---

# Story 8.3: Purge private records and enforce backup expiry

## Why

An Account owner needs to have deletion remove controlled copies. Retained data does not outlive the adopted limits.

## Capabilities

- **CAP-1**
  - **intent:** Purge controlled active private data within the adopted deadline.
  - **success:** Given a committed deletion, when active cleanup runs, then all controlled active private copies purge within 24 hours; immutable audit/billing records are not exempt from deletion.

- **CAP-2**
  - **intent:** Expire controlled backups without resetting their deletion deadline.
  - **success:** Given private backups of dumps and mirrored objects, when retention is applied, then controlled copies expire within 30 days measured from deletion, never extended by a later backup run (restore and rebackup are tested in Story 8.4).

- **CAP-3**
  - **intent:** Retain only permitted public data, aggregates and minimum deletion exclusions.
  - **success:** Given retained shared research, aggregates and deletion exclusions, when retention is audited, then only allowed public-source data, nonidentifying aggregates and the minimum restricted opaque-target anti-resurrection ledger remain; external/disconnected-copy limitations are disclosed accurately.

- **CAP-4**
  - **intent:** Prove a deletion reaches backups within the canary window.
  - **success:** Given a synthetic Account and Project in the monthly canary, when an internal system-actor deletion runs, then the Project is absent from the database and Storage, its mirrored objects are gone within 7 days, every dump created before the purge has expired within 14 days (judged from manifests and bucket listings, with an injected clock in tests), and a miss raises an alarm.

- **CAP-5**
  - **intent:** Keep spending totals unchanged when a Project is deleted.
  - **success:** Given a Project with settled usage in the current period, when it is deleted, then the period's settled and reserved totals are unchanged and no Project, Job or request identity remains on those rows.

All [acceptance criteria](acceptance-criteria.md) apply to the complete story.

## Constraints

- This story implements the declared slice after its listed dependencies; it does not absorb unrelated parent capabilities.
- The [implementation constraints](implementation-constraints.md) and recursively adopted parent contract are mandatory, including ratified overrides to older source wording.
- Existing product decisions remain binding. Spec completion does not establish implementation, device support or engineering-gate acceptance.

## Non-goals

- Implementing unassigned later-story behavior or creating all future domain entities in advance.
- Adding manual mesh editing, public registration, printer control or commercial storefront behavior.

## Success signal

All controlled active private copies purge within 24 hours; immutable audit/billing records are not exempt from deletion. The exact criteria demonstrate the complete story outcome and its failure boundaries; any gate-status change requires actual qualification evidence.

## Assumptions

- Story boundaries and ordering are delegated fast-path planning choices; they do not claim separate user approval. Detailed shared assumptions remain in the constraints companion.
