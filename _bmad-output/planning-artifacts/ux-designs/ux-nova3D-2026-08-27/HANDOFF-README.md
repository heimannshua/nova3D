---
title: nova3D Claude Design Handoff Guide
status: final
updated: 2026-09-14
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

**Updated 14 September 2026 — step 6 closed. The four documents are final.**

The Claude Design outputs were imported from project `8bb862aa-3536-4bfc-901f-68f33676257e`, reconciled, and closed out through `bmad-ux` in Update mode:

- `DESIGN.md` — the visual contract. Design tokens plus the restored BMad frontmatter. One stale paragraph reconciled, marked in place. **final**
- `EXPERIENCE.md` — the end-to-end narrative, plus an appendix covering Export, validation and repair, notifications, and reach and access, which the imported narrative omitted. **final**
- `SCREEN-INVENTORY.md` — the 64-screen imported set, plus an appendix mapping all 53 previous IDs and adding the 16 capabilities that lost their surface. **80 screens. final**
- `SCOPE-CHANGE-print.md` — records the print scope change. **approved**
- `CLAUDE-DESIGN-HANDOFF.md` — the producer brief that was sent. **delivered-historical**; it is a record of the handoff, not a live contract.

`prd.md` was amended rather than superseded, absorbing both the print scope change (§0.1) and SC-1 to SC-7 (§0.2). It is no longer contradicted by the UX artifacts.

### What closing step 6 changed

1. **Native sources landed.** `imports/claude-design-8bb862aa/` now holds the seven mockup files, the flow map, the icon proof, the Round 1 directions, the uploads, and the Broadsheet design-system sources. Until now `imports/` was empty and no visual decision could be checked against its origin.
2. **The 18-screen gap was re-measured against the mockups and is 16.** The appendix had trusted the imported inventory table rather than the mockup files. `C-05` **is** the picture path choice and `C-07` **does** carry the cached-or-fresh block, so the proposed `C-09` and `C-10` are withdrawn and both table rows corrected. Total 80, not 82.
3. **The mockup gap is closed in code rather than in mockups.** All 80 screens — the imported 64 and the added 16 — are built as browsable React + TypeScript screens in `app/`. That is the working visual reference for the added 16 and the implementation base for all of them.

### Still outstanding — not UX work

Gated architecture decisions AD-8 to AD-16 in `prd.md`: the five print-engineering questions from `SCOPE-CHANGE-print.md` (printer integration per vendor, the problem-detection model and its false-positive budget, spool-tag reading, the slicing engine, the Print Record schema) and the four from the UX scope changes (on-device picture conversion, push delivery, internationalization mechanism, accessibility conformance method). Each names an owner and a ratification gate. They block implementation of the requirements they name; they do not block the UX spine, and the scaffold states its assumption wherever it renders one of them.
