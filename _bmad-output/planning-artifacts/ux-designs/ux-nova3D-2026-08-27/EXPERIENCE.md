---
title: nova3D Experience
status: final
created: 2026-08-27
updated: 2026-09-14
imported-from: https://claude.ai/design/p/8bb862aa-3536-4bfc-901f-68f33676257e
sources:
  - ../../prds/prd-nova3D-2026-08-27/prd.md
  - ../../prds/prd-nova3D-2026-08-27/addendum.md
  - ../../briefs/brief-nova3D-2026-08-27/brief.md
  - ../../briefs/brief-nova3D-2026-08-27/addendum.md
  - CLAUDE-DESIGN-HANDOFF.md
  - SCREEN-INVENTORY.md
  - UX-SCOPE-CHANGES.md
  - SCOPE-CHANGE-print.md
---

# nova3D — EXPERIENCE.md

The intended experience, end to end, including the print scope change recorded in `SCOPE-CHANGE-print.md`.

Companion documents: `DESIGN.md` (visual contract), `SCREEN-INVENTORY.md` (80 screens), and the browsable React scaffold in `app/`.

## What nova3D is for

One person reconstructs a physical object from historical description, and ends up holding it. The claim nova3D makes is not that the object is correct — it is that **every decision is traceable to the evidence that produced it, or is marked as not being evidence at all.**

Everything else in the experience follows from defending that claim.

## The user

Josh, in a private single-user Workspace. Also the Administrator, so permission screens are his own decisions rather than someone else's policy. Historically literate; not a 3D modeller and not a print technician. He can read a primary source and judge a disputed reading. He cannot be expected to know what a nozzle diameter implies for a wall thickness — so nova3D states consequences in ordinary language, and asks rather than assumes.

## Five commitments

Each is enforced somewhere specific in the screens, not just stated.

**1. Nothing is built before the evidence is read.** Research produces a Plan; the Plan is read; the Plan is approved. Only then does geometry exist. There is no path from a sentence to a model that skips this. — `R-05`

**2. Nothing is printed before the model is inspected.** Model Approval is a second gate, never merged with the first, never carried forward when the evidence changes underneath it. — `M-09`

**3. Uncertainty is declared, not smoothed.** Five Detail Statuses, each a glyph and a word: ● sourced, ○ inferred, ◐ disputed, ? unknown, + user-added. A disputed reading is presented with both options and a stated consequence; nova3D does not decide it. An unknown is left unknown. — `R-01`, `R-03`, `M-05`

**4. Printing never quietly rewrites the reconstruction.** Printing-only problems are fixed automatically and listed with an Undo. Reconstruction geometry is never touched automatically. Where the two collide, nova3D stops and asks, every time. — `V-02`, `V-03`

**5. nova3D says what it does not know.** No invented citation, no invented dimension, no invented price, no claim that a print will succeed, no implication that a camera is watching when it is not. — throughout

## The journey

**Starting.** Two equal ways in: describe it, or photograph it. Describing leads to evidence-backed reconstruction. Photographing is faster, works offline, and is permanently marked *image-derived — not historically verified*; that label follows the Project everywhere afterwards. nova3D restates what it understood before anything runs, and confirming the scope costs nothing. — `C-01` … `C-06`

**Research.** Free research runs by default. Paid research asks first, showing the provider, what it receives, what it never receives, its retention, and the maximum charge; a provider that cannot state its retention cannot be enabled at all. A reservation is taken and settled to the real amount; a failure releases it and charges nothing. — `C-07`, `AD-02`, `S-05`, `J-03`

**Reading the Plan.** Seven completeness areas, each reported. Every Claim carries its Sources, with original language, translation and explanation as three separate blocks — never one paragraph of mixed direction. Inference is shown with its reasoning in full. Disputed readings are the moment the product earns its keep: both readings, what each would change, and the decision left to the user. Deciding one creates a new revision and withdraws any approval that preceded it, in place, saying what must be redone. — `R-01` … `R-05`

**The model.** Read-only. There is no mesh editing anywhere in nova3D, because a hand-moved vertex has no evidence behind it. Corrections go back through the evidence instead: report what is wrong, and nova3D researches it. Every Model Feature stays attached to the Claims that govern it. Repair fixes holes and self-intersections and states what it did not touch. — `M-01` … `M-08`

**Printing.** Prepare, arrange, slice, send, control, watch. The printer is found automatically. nova3D fixes what is safe to fix, asks about what is not, and states what a print will cost in time and material before starting. Filament colour and type are read from each spool and checked against the slice. While printing, nova3D controls the machine and watches through the camera; if a print looks like it is failing it pauses and says what it saw, why it happens, how to fix it now, and what would prevent it next time — always offering resume, because detection can be wrong. — `V-01` … `V-17`

**Afterwards.** The finish screen keeps three kinds of certainty apart: what the machine reported, what the camera observed, and whether the object is good, which only the user can judge. The print record — material, size, pauses, camera findings, outcome — attaches to the Version, so an object on a shelf can be traced back to its evidence months later. — `V-17`, `V-13`

## How failure behaves

Every failure answers the same six questions in the same order: what stage failed, the known cause, what was preserved, the cost impact, what needs re-approval, and whether it will retry. **Nothing retries by itself** — a failure waits for a decision instead of looping. No Job blocks navigation; research, slicing and printing all run while the user reads a Source. — `J-03`, `M-07`, `V-02`

Offline, nova3D states plainly what works (reading, picture conversion, inspection, approval, slicing for a known printer) and what does not (research, sending a print, watching, sync). Work made offline is saved on the device and synced later. A sync conflict keeps both versions and asks; **nothing is ever silently overwritten.** — `J-05`

## Language and reading

Interface language and reading direction are set separately, so either combination works and RTL is provably supported rather than assumed. Wording has two levels — ordinary language by default, technical terms for anyone citing the work — saying the same thing either way. Source text is never affected by these settings: original language, translation and explanation stay three separate blocks, with identifiers, citations and measurements always left-to-right inside mirrored text. — `S-02`, `G-02`, `R-02`

## What nova3D never does

- Claim historical proof, universal printability, or that a print will succeed.
- Decide a disputed reading, or resolve an unknown by inventing a value.
- Alter evidence-backed geometry to make something printable.
- Merge Plan Approval with Model Approval, cached research with fresh, warning with blocking failure, or Source rejection with Source disabling.
- Retry a failed Job by itself, or start a queued print without asking.
- Retain camera video, or imply a print is being watched when it is not.
- Offer mesh editing.

---

# Appendix — what the imported narrative did not cover

Added 2 September 2026 during the repo import. The narrative above is unchanged. These four areas are first-version scope in `prd.md` but had no place in it, and each is now specified there and given a screen in the `SCREEN-INVENTORY.md` appendix.

## Export

Export survives the print scope change untouched. `SCOPE-CHANGE-print.md` is explicit that it "still exists and is never blocked" — printing did not replace it, it joined it.

Downloading is a real ending, not a consolation for not owning a printer. An Export is a 3MF print file, an optional STL compatibility copy, and the PDF Source Record that makes the model defensible away from nova3D. It is gated exactly as printing is: Model Approval for the exact Version, and a passing validation result. Neither gate is softened because the file is only being downloaded.

The Source Record is the point. It carries the Project, the Plan, every Consequential Detail, Claim, Source, reasoning, option, approval, Personalization, Version, print profile, validation and repair — with stable identifiers so a Claim can be traced to a Model Feature and back months later, by someone who has never used nova3D. — `X-05`, `X-06`

## Validation and repair

Before either exit, nova3D qualifies the model against the named Target Print Profile: geometry checks and profile checks, reported as passing, warning, blocking failure, or unknown. A pass is described as validated for that named profile — never as safety, never as universal manufacturability.

Fixable failures are repaired immediately, and every repair records what it found, what it did, and the before and after. A repair that changes visible geometry, a historical dimension, or Personalization creates a new Version and sends it back through Model Approval. If local repair cannot resolve printability, nova3D regenerates once from the approved Plan — and if that still fails it stops, explains what remains, keeps every Version, and waits. It does not loop. — `X-01` … `X-04`

## Reaching the user

Notifications reach the phone as well as the app. Categories are controlled individually in Settings, and the in-app history stays complete whether or not push is on — so turning alerts off never costs the user the record. A denied or revoked operating-system permission is stated in Settings rather than left to be inferred from an absence of alerts, which is the same honesty rule the camera follows. A push never carries private Project content beyond what identifies the item. — `S-06`

## Reach and access

Every capability works on a phone. Not a viewer, not a companion: creation, research review, inspection, both approval gates, validation, Export, printing, and printer control. Where something is genuinely device-limited, nova3D says so rather than hiding the control.

The first version targets WCAG 2.2 AA. Everything is keyboard reachable with visible focus; both gates and every print control are fully operable without a pointing device. Every state carries a glyph and a word, so nothing depends on colour or on seeing colour accurately. Text enlargement, high contrast and reduced motion are honoured. Light is the default and dark is a manual choice that preserves every distinction. — `S-08`, `G-01`, `G-04`

Getting in is deliberately narrow: a single-use Invitation Code, no public registration. Administrator recovery runs through a short-lived link to the verified address and revokes every existing session on success, because the Administrator is the one account with no one above it to appeal to. — `A-04`, `A-05`, `AD-06`, `AD-07`
