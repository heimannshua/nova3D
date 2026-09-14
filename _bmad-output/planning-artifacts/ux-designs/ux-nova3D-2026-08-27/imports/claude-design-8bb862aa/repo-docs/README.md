# repo-docs

Corrected planning documents for the **heimannshua/nova3D** repository, produced during the Claude Design mockup round (August 2026).

These are written to be committed into the repo. They are here because my GitHub access is read-only — I can read the repo, not push to it.

## Why these exist

The repo's planning artifacts predate the print scope change. As they stand they describe a product that stops at export and never touches a printer, while the mockups describe one that slices, sends, controls and watches. Anyone building from the repo today would build the wrong thing.

## The files

| File | Replaces | What it does |
| --- | --- | --- |
| `SCOPE-CHANGE-print.md` | the print sections of `UX-SCOPE-CHANGES.md` and `prd.md` | Records the change, the three printing rules, the camera honesty rule, and the five engineering questions it opens |
| `SCREEN-INVENTORY.md` | `SCREEN-INVENTORY.md` (53 IDs) | 64 screens with their states, grouped and reconciled |
| `EXPERIENCE.md` | `EXPERIENCE.md` (draft) | The intended experience end to end, with each commitment tied to the screens that enforce it |

`DESIGN.md` in this project's root is the visual contract and is already complete — commit it alongside these.

## Suggested repo placement

```
_bmad-output/planning-artifacts/ux-designs/ux-nova3D-2026-08-27/
  EXPERIENCE.md          ← replace
  SCREEN-INVENTORY.md    ← replace
  SCOPE-CHANGE-print.md  ← add
  DESIGN.md              ← replace (from this project's root)
```

Keep the originals in git history rather than deleting them — the 53-ID inventory is what the PRD was written against, and the delta is the story.

## Still outstanding after this

These are named in `SCOPE-CHANGE-print.md` and are not design work:

1. **`prd.md` itself still says nova3D never slices or controls a printer.** These documents record the change; they do not rewrite the PRD. That needs a decision from you about whether the PRD is amended or superseded.
2. **Printer integration spike** — per-vendor, partly undocumented, sometimes cloud-only.
3. **Camera problem detection** — a trained model with a stated false-positive budget.
4. **Slicing engine** — owned, embedded, or wrapped.
5. **Data model** — the mockups define the shapes (Claim, Source, Model Feature, Detail Status, Plan revision, Job, print record) but not their fields or persistence.
6. **Real content** — every Source, citation, dimension, price and duration in the mockups reads "pending" by design.
