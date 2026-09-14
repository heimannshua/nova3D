---
title: nova3D Design
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
name: nova3D
description: >
  Visual system for nova3D, a private browser-based evidence-to-fabrication app.
  Newsprint foundation — near-black Source Serif 4 on paper — with the four process
  inks used as spot colour and as the product's own mark. Direction selected in
  Round 1: 1c "Plate & Proof" identity on 3a "Stepped flow" structure.
  Inherits the Broadsheet design system; nova3D-specific tokens and components are
  marked (nova3D) below.
colors:
  light:
    bg: "#f3f2f2"
    surface: "#eae9e9"
    text: "#201e1d"
    text-muted: "#605d5d"
    divider: "rgba(32, 30, 29, 0.16)"
    accent: "#0088b0"
    accent-strong: "#006786"
    accent-tint: "#e9f8ff"
    accent-2: "#d6006c"
    accent-2-strong: "#aa0b56"
    accent-2-tint: "#fff1f4"
    process-yellow: "#edbb00"
    neutral-100: "#f8f4f4"
    neutral-200: "#eae7e7"
    neutral-300: "#d7d3d3"
    neutral-400: "#bab6b6"
    neutral-500: "#9b9797"
    neutral-600: "#7d7979"
    neutral-700: "#605d5d"
    neutral-800: "#444141"
    neutral-900: "#2d2b2b"
  dark:
    bg: "#1a1918"
    surface: "#2d2b2b"
    text: "#f3f2f2"
    text-muted: "#bab6b6"
    divider: "rgba(243, 242, 242, 0.20)"
    accent: "#62c5ee"
    accent-strong: "#99e0ff"
    accent-tint: "#0a303e"
    accent-2: "#ff90b1"
    accent-2-strong: "#ffc0d0"
    accent-2-tint: "#3a2530"
    process-yellow: "#edbb00"
    neutral-100: "#2d2b2b"
    neutral-200: "#2d2b2b"
    neutral-300: "#444141"
    neutral-400: "#605d5d"
    neutral-500: "#7d7979"
    neutral-600: "#9b9797"
    neutral-700: "#bab6b6"
    neutral-800: "#d7d3d3"
    neutral-900: "#f8f4f4"
  semantic:
    status-sourced: "{colors.light.text}"
    status-inferred: "{colors.light.neutral-700}"
    status-disputed: "{colors.light.accent-2-strong}"
    status-unknown: "{colors.light.neutral-800}"
    status-user-added: "{colors.light.accent-strong}"
    job-running: "{colors.light.accent-strong}"
    job-waiting: "{colors.light.neutral-700}"
    job-completed: "{colors.light.text}"
    job-failed: "{colors.light.accent-2-strong}"
    job-cancelled: "{colors.light.neutral-700}"
    gate-open: "{colors.light.accent}"
    gate-blocked: "{colors.light.accent-2-strong}"
    offline: "{colors.light.neutral-800}"
typography:
  heading: "Source Serif 4, 600"
  body: "Source Serif 4, 400"
  emphasis: "Source Serif 4, 400 italic"
  scale:
    display: "68px / 0.95"
    plate-numeral: "40-64px / 0.9"
    h1: "42px / 1.12"
    h2: "32px / 1.12"
    h3: "25px / 1.12"
    h4: "20px / 1.12"
    body-lg: "15px / 1.55"
    body: "14px / 1.55"
    body-sm: "13px / 1.5"
    caption: "12px / 1.45"
    rail: "12px / 1.3, uppercase, 0.1em tracking"
rounded:
  sm: "1px"
  md: "2px"
  lg: "4px"
  full: "50%"
spacing:
  1: "5px"
  2: "10px"
  3: "15px"
  4: "20px"
  6: "30px"
  8: "40px"
components:
  inherited-from-broadsheet:
    - btn (primary, secondary, ghost, icon, block)
    - tag (accent, accent-2, neutral, outline)
    - field, input, radio, seg
    - card, elev-sm/md/lg
    - nav, table, dialog
    - cmyk, cmyk-num, cmyk-head, halftone
  nova3d-specific:
    - step-bar
    - action-bar
    - gate-panel
    - status-token
    - job-strip
    - step-blocks
    - evidence-row
    - source-reader
    - plate-mark
    - print-job-strip
    - printer-control
    - problem-alert
---

# nova3D DESIGN.md

Round 1 selection: **1c Plate & Proof** for identity, **3a Stepped flow** for structure. This document is the visual contract. It does not define product behavior; `prd.md`, `UX-SCOPE-CHANGES.md` and `SCREEN-INVENTORY.md` do.

## Brand & Style

nova3D is a record-keeping instrument that happens to make geometry. The visual system says so twice: newsprint typography for everything a person reads, and the four-colour process plate for the product's own mark.

The plate is a physical record of how an image was made, which is the product's argument in one image. It is used in exactly three places — the wordmark, the display numerals that label the three primary actions, and the plate numeral on a Version stamp. It never touches a Detail Status, an approval gate, a Job state, or any control label, because a misregistered fringe reduces contrast and these are the elements that must be unambiguous.

Everything else is quiet: paper ground, near-black serif, cyan for interactive, magenta for "needs your attention", whitespace instead of boxes wherever a box is not carrying a discrete item.

Voice in the interface: ordinary language first, one idea per sentence, the consequence before the mechanism. "Nothing is charged on this step" rather than "no billing event will be triggered". Never a claim of historical proof, universal printability or safety.

## Colors

Light is the default. Dark is a manual choice in Account Settings and must preserve every status distinction.

| Role | Light | Dark | Use |
| --- | --- | --- | --- |
| `bg` | #f3f2f2 | #1a1918 | The sheet |
| `surface` | #eae9e9 | #2d2b2b | Rails, panels, action bars, radio cards |
| `text` | #201e1d | #f3f2f2 | All body copy |
| `text-muted` | #605d5d | #bab6b6 | Secondary copy — the floor is 6:1, never an alpha fade |
| `accent` | #0088b0 | #62c5ee | Interactive fills, current step, running Job |
| `accent-strong` | #006786 | #99e0ff | Accent **text** at body and label size |
| `accent-2` | #d6006c | #ff90b1 | Unread, disputed, failure — the rarer ink |
| `accent-2-strong` | #aa0b56 | #ffc0d0 | Accent-2 text on tint |
| `process-yellow` | #edbb00 | #edbb00 | Plate treatment only. Never chrome, never text |

Rules:

- Accent at #0088b0 measures 3.37:1 on paper. It is a **fill** colour, not a text colour. Any accent-coloured word at 15px or below uses `accent-strong`.
- No alpha-faded ink for small text. Use `text-muted` or a neutral ramp step.
- Never both accents in one small component.
- Tints (`accent-tint`, `accent-2-tint`) always carry a 3px left edge or a leading glyph, so the fill is never the only signal.
- Dark mode inverts the ground but not the plate: plate constructions keep their own paper patch (`--color-bg: #f3f2f2` scoped to the element), because process inks multiply and vanish on ink.

## Typography

Source Serif 4 throughout — headings at 600, body at 400, true italic for pull quotes and for original-language emphasis. No sans-serif anywhere; the serif is the chrome.

- Display 68px: the wordmark only.
- Plate numerals 40–64px: the three primary actions on Home, the Version stamp.
- h3 25px: the question a step is asking. Step screens do not use h1/h2 — a 42px headline turns a task into an article.
- Body 14px, body-lg 15px inside inputs and radio cards, body-sm 13px for supporting lines, caption 12px minimum anywhere.
- Rail labels: 12px uppercase, 0.1em tracking. 12px is the floor; nothing below it, ever.
- Original Source language, translation and explanation are three semantically separate blocks — never one paragraph with mixed direction. Hebrew sets at 1.15× the Latin size for equal apparent weight, `lang` and `dir` on the element, italic reserved for the explanation.

## Layout & Spacing

Spacing scale 5 / 10 / 15 / 20 / 30 / 40. Do not tighten it.

Two shells:

**Step shell** (all Create, research, approval, validation and Export screens). Header 44px: leave, Project name, save/online state, unread marker. Step bar: numbered steps with connectors, current filled, passed ✓, ahead outlined. Content: one column at 62–64ch, optional 296–340px aside for examples, disclosures or clarification questions. Action bar pinned at the foot: Back left, one primary action right, one line of consequence text between them.

**Workspace shell** (Model workspace and Research Plan review, where a viewport or a long structured document must stay on screen). Left stage rail 96px, panel 352px with its primary action pinned at the foot, viewport, right inspector 328px with tabs, status strip along the bottom.

Phone: same order, stacked. The step bar becomes six segments plus a spoken "Step 4 of 6". Panels become sheets. The action bar stays pinned. Touch targets 44px minimum, 48px for a gate.

RTL: the whole shell mirrors. Identifiers, measurements, file extensions and citations stay LTR inside mirrored text via `dir="auto"` on the run, never by reversing the string. Two-column rows stack rather than mirror-crop.

## Elevation & Depth

Almost flat. `shadow-sm` for floating viewport controls and the axis gizmo, `shadow-lg` for dialogs only. Panels and rails are separated by a 1px divider and a `surface` fill, not by shadow. No shadow on any resting content block.

## Shapes

Radius 2px on controls, 4px on dialogs, 0 on panels and rails. Squares, not pills. Progress is five to seven discrete step blocks rather than a continuous bar, so it is countable as well as coloured. The dashed edge in the system marks a stated absence — a printer with no camera, a locked step and its reason — never a decorative boundary.

> Reconciled 2 September 2026. This paragraph previously read "the reserved future-print area". Printing is no longer reserved or future: `SCOPE-CHANGE-print.md` records that live prints replace that area on `H-01`, and the dashed edge now carries the no-camera block described under `printer-control`.

## Components

### status-token (nova3D)

A glyph, a word, and only then a colour. Never colour alone, never an icon alone.

| Status | Glyph | Word | Colour |
| --- | --- | --- | --- |
| sourced | ● | sourced | text |
| inferred | ○ | inferred | neutral-700 |
| disputed | ◐ | disputed | accent-2-strong |
| unknown | ? | unknown | neutral-800 |
| user-added | + | user-added | accent-strong |

Research lead versus accepted evidence is a different axis and takes words, not glyphs: "lead — not yet evidence" and "accepted evidence".

### step-bar / action-bar (nova3D)

Step bar states: passed (`✓`, neutral-300 fill, reachable), current (accent fill, 600 weight, `aria-current="step"`), ahead (outlined, neutral-700), locked (dashed outline plus a reason line). The action bar carries exactly one primary action; a disabled primary must state its blocking reason immediately above it, in `accent-2-strong` with a ▲ glyph.

### gate-panel (nova3D)

Plan Approval and Model Approval share one component and never share a screen. Required parts: the version stamp in the header (`Revision 4`, `Version 3`), what is being approved in one sentence, the review checklist with counts, a "what approval does not mean" block on `accent-tint`, reject-with-reason at equal visual weight to approve, and the invalidation rule stated in place. When a change invalidates approval, the panel shows the withdrawn state and what must be redone — never a silently carried-forward approval.

### job-strip / step-blocks (nova3D)

Job states: `▶ running`, `◷ waiting`, `✓ completed`, `▲ failed`, `⊘ cancelled`. Every strip carries stage, real recorded progress, cost impact when known, and cancel where cancel is legal. Failed strips state the failed stage, the known cause, what was preserved, cost impact, and the next action — and say that nothing retries by itself. Progress is `step-blocks`; an indeterminate stage shows "working" with no fake bar.

### evidence-row / source-reader (nova3D)

An evidence row is a Model Feature or Claim with its status token, its Claim count and its governing Plan revision. The source reader keeps three separate blocks — original language (`lang`, `dir`, larger), translation, explanation (italic) — plus the citation as its own LTR run. Where content is not yet verified, the block reads "verified content pending" rather than inventing a passage. Rejecting a Source for the current Project and disabling a Source Account-wide are different controls with different words, never one toggle.

### plate-mark (nova3D)

The `cmyk-head` / `cmyk-num` construction: a paper layer carrying the real string plus three `aria-hidden` C/M/Y plate repeats at half offsets. Requires a paper ground, so in dark mode it carries its own patch. Flat single-colour fallback under `forced-colors` and `prefers-contrast: more`; plate drift is off under `prefers-reduced-motion`.

### print-job-strip (nova3D)

nova3D prepares, arranges, slices and sends print jobs to a vendor-linked printer. Print states: `▶ printing`, `◷ queued`, `✓ finished`, `▲ failed`, `⊘ stopped`. Progress is reported layers plus step blocks, always labelled as reported by the printer rather than as nova3D's own certainty. A running job carries Stop at 44px on the strip itself. A failure states the printer's reported reason, the layer it stopped at, material used, that the model and Version are unchanged, that the print file is kept, and that nothing retries by itself. nova3D never claims to know whether the object came out well — it asks.

### printer-control (nova3D)

Printers are discovered automatically (network plus any signed-in maker account); adding one by hand is the exception, not the entry point. A controlled printer exposes Pause, Resume and Stop as primary controls at 44px desktop / 48px phone, with Stop's irreversibility stated beside them. Camera presence and watching are **two separate stated rows** — a live view never implies anything is being checked, and a printer with no camera says so in a dashed block with the consequence spelled out. Camera frames are checked and discarded; retention is stated where the frames appear.

### problem-alert (nova3D)

When camera watching detects a failure (corner lifting, print coming loose, layer shift, material stopped, stray-material mass) nova3D pauses the print and notifies. The alert has four labelled blocks: what nova3D saw, why it happens, how to fix it now, and what would prevent it next time. The frames it based the decision on are shown as evidence with descriptive captions. Because detection can be wrong, the alert always offers three real exits — resume after fixing, stop, and false alarm — and carries the sentence "nova3D can be wrong" directly above them. A false alarm deletes the kept frames and says so. The model, its Version and its Source Record are never affected by a print problem.

**The three printing rules.** Printing-only problems (orientation, supports, brim, plate placement, surface faults) are fixed automatically and each fix is listed with an Undo. Reconstruction geometry is never altered automatically. Where printability and an evidence-backed dimension collide, nova3D asks every time, with neither option preselected and each stating its cost to the reconstruction and to the print; the chosen route is recorded in the Source Record.

## Do's and Don'ts

**Do**

- Put the consequence next to the action: what will be charged, what will be preserved, what will need re-approval.
- Keep one decision per step screen and one primary action per action bar.
- State a blocked gate's reason where the disabled button is.
- Give every state a word and a shape before a colour.
- Keep preview geometry labelled as preview, and read-only where it is read-only.
- Separate printing settings from the reconstruction at the control, not in a footnote.

**Don't**

- Don't put a plate treatment on a status, a gate, or a control label.
- Don't use accent #0088b0 for small text; use accent-strong.
- Don't merge Plan Approval and Model Approval, cached and fresh research, warning and blocking failure, or Source rejection and Source disabling.
- Don't show a continuous progress bar for work whose steps are countable, or any bar for work whose progress is unknown.
- Don't let an automatic fix touch reconstruction geometry, and don't resolve a printability-versus-evidence collision without asking.
- Don't set body copy in the accent, in a plate, or below 12px.
