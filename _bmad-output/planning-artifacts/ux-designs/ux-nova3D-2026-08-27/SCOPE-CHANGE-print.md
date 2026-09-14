---
title: nova3D Print Scope Change Record
status: approved
created: 2026-08-31
updated: 2026-09-02
imported-from: https://claude.ai/design/p/8bb862aa-3536-4bfc-901f-68f33676257e
authoritative-over:
  - the print sections of UX-SCOPE-CHANGES.md
  - the printing statements of ../../prds/prd-nova3D-2026-08-27/prd.md
reflected-in:
  - ../../prds/prd-nova3D-2026-08-27/prd.md
---

# nova3D — scope change record

Supersedes the print-related sections of `UX-SCOPE-CHANGES.md` and the printing sections of `prd.md`.

Date: 31 August 2026
Origin: design review with Josh during the Claude Design mockup round.
Status: reflected in the mockups; **not yet reflected in `prd.md` or the architecture docs**.

## What changed

The PRD stated that nova3D validates a model against a printer profile, exports a package, and never slices or controls a printer. That is no longer the product.

nova3D now goes the whole way to the finished object.

| | Was | Now |
| --- | --- | --- |
| Slicing | Never. User takes the mesh to their own slicer. | nova3D slices. |
| Build plate | Not addressed. | nova3D arranges the plate. |
| Sending a job | Never. Download only. | nova3D sends to the machine. |
| Printer discovery | Not addressed. | Automatic — local network and signed-in maker account. Manual add is the exception path. |
| Printer control | None. | Pause, resume, stop, temperatures, movement, fans, speed, material load/unload, calibration, chamber light, on-device queue. |
| Camera | Not addressed. | Live view, plus frame-by-frame problem detection that pauses the print and notifies. |
| Filament | Not addressed. | Colour and type read from each spool, checked against the slice, recorded in the Source Record. |
| "Prints in Progress" | Reserved, non-functional, labelled "Coming later". | Live. |

Export still exists and is never blocked. It is now one exit among several rather than the end of the product.

## What did not change

The evidence contract is untouched, and the print pipeline is subordinate to it.

- Plan Approval still gates all geometry generation. Model Approval still gates all printing.
- Neither gate is bypassed, merged, or carried forward silently.
- Detail Status, Claims, Sources, the Source Record and the disputed-reading flow are unchanged.
- Nothing about printing may alter a Detail Status.

## Three rules the print pipeline must obey

These are the reason the pipeline is not simply an embedded slicer.

1. **Printing-only problems are auto-fixed, and listed with an Undo.** Orientation, supports, brim, plate placement, and surface faults that are not described features.
2. **Reconstruction geometry is never altered automatically.** No dimension, no Model Feature, no proportion.
3. **Where printability and an evidence-backed dimension collide, nova3D asks — every time.** Neither option preselected. Each states its cost to the reconstruction and to the print. The decision is recorded in the Source Record.

Rule 3 was a product decision, not a default: an auto-fix policy here would silently corrupt reconstructions, which is the one thing nova3D exists to prevent.

## The camera honesty rule

Detection can be wrong. Therefore:

- Every automatic pause shows the frames it acted on.
- Every automatic pause offers three real exits: resume after fixing, stop, and false alarm.
- A false alarm deletes the kept frames and makes nova3D less eager on that shape.
- Frames are checked and discarded. Nothing is retained unless a problem is found.
- A printer with no camera **states that it cannot be watched.** Absence of monitoring is never left to be inferred from silence.

## Engineering questions this raises

Named here because the mockups assume answers that do not exist yet.

1. **Printer integration is per-vendor and partly undocumented.** Discovery, job submission, control and camera access differ by manufacturer, and some are cloud-only. Needs a spike before the V-06…V-17 screens are a commitment.
2. **Problem detection is a trained model, not a rule.** Corner lifting, print detachment, layer shift, material stoppage and stray-material mass. Needs a training set and a stated false-positive budget. The UI already handles being wrong; the detector does not exist.
3. **Filament identity depends on spool tags.** Where a spool cannot be read, nova3D says so and refuses to check it against a slice rather than guessing (V-09).
4. **Slicing engine.** Owned, embedded, or wrapped — undecided, and it determines whether V-05's layer and time figures are real.
5. **Print records are now first-class data.** Material used, size printed, pauses, camera findings and outcome, all attached to a Version. This extends the data model.

## Screens affected

New or rewritten: `V-01` … `V-17` (see `SCREEN-INVENTORY.md`).
Changed by knock-on: `H-01` (live prints replace the reserved area), `J-01` (print and slice Job kinds), `J-04` (print problem Notifications), `S-01`, `S-04` (watching setting), `AD-01`, `AD-03` (printer permissions and unlinking).
