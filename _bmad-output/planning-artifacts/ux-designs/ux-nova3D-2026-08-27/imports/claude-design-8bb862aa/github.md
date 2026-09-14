repo: heimannshua/nova3D
branch: main
path: _bmad-output/planning-artifacts

## Last sync

date: 2026-08-31T14:32:00Z

### Updated in this project

- Read the Claude Design handoff, screen inventory and post-PRD scope changes. Repo contains no application code, so there was no existing UI to recreate.
- Round 1: three visual directions plus a stepped-flow structure round; user selected 1c Plate & Proof on the 3a stepped shell.
- Round 2: DESIGN.md and six mockup files covering 60 screen IDs, with MOCKUP-MANIFEST.md reconciling them.
- Icon treatment: pulled 30 genuine Phosphor duotone SVGs from phosphor-icons/core (assets/duotone) and inlined them as a page sprite on currentColor. The bound design system ships only 12 icons in its own foundation page, so the rest came from the upstream Phosphor repo, per the system's "Phosphor, duotone, inlined" rule. No icon webfont, no CDN dependency.
- Batch 7 added (V-11 … V-17): colours, cost, history and reprints, timelapse, resume-from-layer, upkeep, print finished. Set total 64 screens.
- Flow Map.dc.html added — all 64 screens as linked cards in flow order.
- repo-docs/ written: corrected SCREEN-INVENTORY (64 IDs), completed EXPERIENCE.md, and SCOPE-CHANGE-print.md. These are for the USER to commit — my access is read-only. prd.md still contradicts the print scope and needs their decision.
- Type floor swept across all six mockup files: 60 occurrences below 12px raised to the 12px minimum in DESIGN.md.
- Print scope reversed on user instruction: nova3D now prepares, arranges, slices, sends, controls and camera-watches prints. Recorded in MOCKUP-MANIFEST.md.

## Secondary source

repo: phosphor-icons/core
branch: main
path: assets/duotone
used for: the icon sprite in Icons and Personality - proof.dc.html (30 glyphs). MIT licensed.

## Screen map

| Project screen | Repo files |
| --- | --- |
| DESIGN.md | CLAUDE-DESIGN-HANDOFF.md, HANDOFF-README.md |
| Mockups 1 - Create.dc.html (C-01…C-08) | SCREEN-INVENTORY.md, UX-SCOPE-CHANGES.md |
| Mockups 2 - Research Plan.dc.html (R-01…R-05) | SCREEN-INVENTORY.md, prd.md |
| Mockups 3 - Model Workspace.dc.html (M-01…M-09) | SCREEN-INVENTORY.md |
| Mockups 4 - Prepare Slice Print.dc.html (V-01…V-10) | SCREEN-INVENTORY.md — superseded by in-chat scope change |
| Mockups 5 - Home Projects Jobs.dc.html (H-01…H-04, J-01…J-05) | SCREEN-INVENTORY.md |
| Mockups 6 - Account and Admin.dc.html (A, G, S, AD groups) | SCREEN-INVENTORY.md, UX-SCOPE-CHANGES.md |
| Icons and Personality - proof.dc.html (treatment proof for H-01, V-09) | phosphor-icons/core assets/duotone; _ds/broadsheet foundations/icons.html |
| Mockups 7 - Print Operations.dc.html (V-11…V-17) | in-chat scope change; no repo source |
| Flow Map.dc.html (all 64 screens) | SCREEN-INVENTORY.md |
| repo-docs/*.md (to be committed back) | prd.md, SCREEN-INVENTORY.md, EXPERIENCE.md, UX-SCOPE-CHANGES.md |

## Sync history

- 2026-08-30 — initial read of planning artifacts; Round 1 visual directions built.
