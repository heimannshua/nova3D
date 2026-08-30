---
title: nova3D Claude Design Handoff Guide
status: ready-for-handoff
updated: 2026-08-30
---

# nova3D Claude Design Handoff Guide

This folder is ready to hand to Claude Design. The external design work should create the visual system and mockups; it must not redefine product behavior.

## Give Claude Design these files

1. `CLAUDE-DESIGN-HANDOFF.md` — the producer prompt and delivery contract.
2. `SCREEN-INVENTORY.md` — every first-version surface and required state.
3. `UX-SCOPE-CHANGES.md` — approved changes made after the PRD was finalized.
4. `../../prds/prd-nova3D-2026-08-27/prd.md` — authoritative product requirements.
5. `../../prds/prd-nova3D-2026-08-27/addendum.md` — authoritative technical context.
6. `../../briefs/brief-nova3D-2026-08-27/brief.md` — supporting product vision.
7. `../../briefs/brief-nova3D-2026-08-27/addendum.md` — supporting research and roadmap context.

If Claude Design cannot access repository paths, upload the seven files together.

## Paste this instruction

> Read every supplied file. Follow `CLAUDE-DESIGN-HANDOFF.md` as the working brief and source hierarchy. Begin with Round 1 visual directions only. Do not produce the complete mockup set until Josh chooses a direction. Do not silently resolve a product conflict or remove a required state.

## Expected sequence

1. Claude Design checks the source hierarchy and flags any contradiction.
2. It creates three genuinely different visual directions using the same nova3D home dashboard and real product wording.
3. Josh selects or combines a direction.
4. Claude Design creates `DESIGN.md` and the complete responsive mockup set in the agreed native format, plus viewable exports.
5. Save or copy the outputs into this UX workspace, preferably under `imports/` for native source files and `mockups/` for viewable exports.
6. Return to `bmad-ux` in Update mode. The outputs will then be reconciled into final `DESIGN.md` and `EXPERIENCE.md` contracts.

## Current spine status

`DESIGN.md` and `EXPERIENCE.md` remain intentionally incomplete. They must not be marked final until Claude Design outputs have been imported, reconciled, reviewed, and approved.
