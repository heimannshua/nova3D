---
title: nova3D — import notes
status: final
created: 2026-09-14
source-project: https://claude.ai/design/p/8bb862aa-3536-4bfc-901f-68f33676257e
---

# Import notes

What was landed from the Claude Design project on 14 September 2026, and what was
not. Until this date `imports/` was empty: the spines had been reconciled from the
outputs directly, so no visual decision could be checked against its origin.

## Landed — `claude-design-8bb862aa/`

| Path | What it is |
| --- | --- |
| `mockups/Mockups 1 - Create.dc.html` | `C-01` … `C-08`, 21 frames |
| `mockups/Mockups 2 - Research Plan.dc.html` | `R-01` … `R-05`, 13 frames |
| `mockups/Mockups 3 - Model Workspace.dc.html` | `M-01` … `M-09`, 21 frames |
| `mockups/Mockups 4 - Prepare Slice Print.dc.html` | `V-01` … `V-10`, 32 frames |
| `mockups/Mockups 5 - Home Projects Jobs.dc.html` | `H-01` … `H-04`, `J-01` … `J-05`, 19 frames |
| `mockups/Mockups 6 - Account and Admin.dc.html` | `A-01` … `A-03`, `G-01` … `G-03`, `S-01` … `S-05`, `AD-01` … `AD-05`, 33 frames |
| `mockups/Mockups 7 - Print Operations.dc.html` | `V-11` … `V-17`, 17 frames |
| `Round 1 - Visual Directions.dc.html` | The three directions; `1c` on `3a` was selected |
| `Icons and Personality - proof.dc.html` | The approved icon and press-furniture treatment |
| `support.js` | The `.dc.html` runtime the mockup files load |
| `repo-docs/README.md` | The design project's own handoff instructions |

**156 frames across 64 screens.** Open a mockup file in a browser to view it; the
`.dc.html` format needs `support.js` beside it, which is why it is here.

## Not landed — still in the design project only

| Path | Why it was left |
| --- | --- |
| `_ds/broadsheet-…/styles.css` | The Broadsheet token sheet. Its tokens are transcribed with attribution into `app/src/styles/tokens.css`, which is the working copy. Retrieve the original from the project if you need to diff it. |
| `_ds/broadsheet-…/readme.md` | The Broadsheet usage guide. Its rules are quoted where they bind, in `app/src/styles/*.css`. |
| `_ds/broadsheet-…/_ds_bundle.js`, `_adherence.oxlintrc.json`, `_ds_manifest.json` | Design-system build artifacts. Not needed to read a mockup or to build the app. |
| `Flow Map.dc.html` | The 64 screens as linked cards. Superseded as a navigational aid by the 80-screen browser in `app/`, and it would be misleading to keep a 64-card map beside an 80-screen inventory. |
| `MOCKUP-MANIFEST.md` | The design project's own ID reconciliation. Superseded by, and contradicted on two rows by, the appendix in `SCREEN-INVENTORY.md` — see below. |
| `repo-docs/SCREEN-INVENTORY.md`, `repo-docs/EXPERIENCE.md`, `repo-docs/SCOPE-CHANGE-print.md` | Pre-reconciliation originals. The repo copies supersede them. |
| `_ds/broadsheet-…/theme.json` | Referenced by the Broadsheet readme but not served by the API. |
| `uploads/*.png` | The four images uploaded during the design rounds. Each is roughly 192KB, and base64 of that exceeds the 256KB transfer cap on a single file read — every copy came back with `"truncated": true`, giving a valid PNG header with no IEND chunk. `get_file` has no range parameter, so they cannot be retrieved whole through this route. Truncated files were **not** committed: a corrupt image in a provenance archive is worse than a stated absence. Download them from the design project directly if they are needed. |

## The correction the mockups forced

`MOCKUP-MANIFEST.md` and the imported `SCREEN-INVENTORY.md` table both mislabel two
Create screens. Reading `Mockups 1 - Create.dc.html` directly:

- **`C-05` is "Picture path choice"** — the one screen where the two accuracy claims
  are set side by side, in online and offline states. The table called it
  "Image-derived warning", which is in fact a state of `C-04`
  ("Generate anyway · explicit warning dialog").
- **`C-07` is "Research and cache choices"** — it carries `2 · Cached or fresh
  research` as its second labelled block, with the Cached Research Revision date.
  The table called it "Research permission" and recorded the cache choice as having
  no surface.

The reconciliation appendix had trusted the table rather than the files, and so
proposed two screens — `C-09` and `C-10` — for capabilities that already existed.
Both are withdrawn, both table rows are corrected, and the total is **80**, not 82.

The other 16 gaps were checked against the mockup files the same way and are real:
nothing in the imported set covers invitation registration, Administrator recovery,
mid-Job Source rejection, first-use guidance, notification categories, Project or
Account deletion, appearance and accessibility, Invitation Codes, sensitive actions
and audit, Accounts and limits, or any of the six validation and Export screens.

Those 16 are built as React screens in `app/`, which is now their only visual.
