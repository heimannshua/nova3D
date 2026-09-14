---
title: nova3D First-Version Screen and State Inventory
status: final
created: 2026-08-27
updated: 2026-09-14
imported-from: https://claude.ai/design/p/8bb862aa-3536-4bfc-901f-68f33676257e
supersedes: the 53-ID inventory at this path in commit f3340c9
sources:
  - ../../prds/prd-nova3D-2026-08-27/prd.md
  - CLAUDE-DESIGN-HANDOFF.md
  - UX-SCOPE-CHANGES.md
  - SCOPE-CHANGE-print.md
---

# nova3D — screen inventory

Supersedes the 53-ID inventory in `_bmad-output/planning-artifacts/ux-designs/ux-nova3D-2026-08-27/SCREEN-INVENTORY.md`.

**64 screens as imported, 80 after reconciliation.** The imported set covers 64. Reconciling it against the 53-ID inventory it supersedes found 16 capabilities with no ID in the imported set; they are added in the appendix. The claim that nothing was dropped did not hold, and the appendix records exactly what was missing.

Every ID is unique. Mockup files live in the Claude Design project; `Flow Map.dc.html` shows all 64 as linked cards in flow order.

## Create — 8

| ID | Screen | States shown |
| --- | --- | --- |
| C-01 | Choose how to start | Describe / photograph; offline capability |
| C-02 | Describe the subject | Free text; clarifying question |
| C-03 | Upload pictures | Empty, populated, offline |
| C-04 | What the pictures show | Good coverage, gaps named |
| C-05 | Picture path choice | Direct image-derived conversion, or research-assisted reconstruction; online and offline |
| C-06 | Confirm the scope | As understood, corrected |
| C-07 | Research and cache choices | Free or paid with disclosure and cap; reuse cached revision or research fresh; blocked by Usage Limit |
| C-08 | Research started | Running, leaving the page |

## Research Plan — 5

| ID | Screen | States shown |
| --- | --- | --- |
| R-01 | The Plan, area by area | Complete, in progress, unknown declared |
| R-02 | A Claim and its Sources | Bilingual: original, translation, explanation |
| R-03 | A disputed reading | Two readings, decision required, not consequential |
| R-04 | Revision comparison | What changed, what was withdrawn |
| R-05 | **Plan Approval** | Approve, reject with reason, approval invalidated |

## Model — 9

| ID | Screen | States shown |
| --- | --- | --- |
| M-01 | Model workspace | Read-only viewport, feature selected |
| M-02 | Feature evidence | Claim by Claim |
| M-03 | Versions | Comparison, supersession |
| M-04 | Inspection tools | Section, measure, isolate; keyboard paths |
| M-05 | Detail Status legend | All five statuses |
| M-06 | Report a problem | Request recorded, researched |
| M-07 | Repair | What changed, what failed |
| M-08 | Sources in this Project | Accepted, rejected for this Project |
| M-09 | **Model Approval** | Approve, reject, blocked with reason |

## Print — 17

Screens V-01 to V-10 are in `Mockups 4`; V-11 to V-17 are in `Mockups 7`.

| ID | Screen | States shown |
| --- | --- | --- |
| V-01 | Choose the printer | Found automatically, add by hand, offline |
| V-02 | Prepare the model | Auto-fixes with Undo; the "left alone" boundary |
| V-03 | **Evidence vs printability** | The decision; neither option preselected |
| V-04 | Arrange the build plate | Placement, orientation, consequences |
| V-05 | Slice | Running, complete, material mismatch |
| V-06 | Send and print | Confirmation, running, failed |
| V-07 | Printer control and camera | Printing with watching on, paused, no camera |
| V-08 | Problem found | Notification, evidence frames and fix, false alarm |
| V-09 | Full printer control | Idle, material loading, refused mid-print |
| V-10 | Printers and queue | All machines, queue, phone control sheet |
| V-11 | Colours across the model | By feature, by Detail Status, one colour, spool empty |
| V-12 | What this print will cost | Estimate from the slice, size comparison |
| V-13 | Print history and reprinting | History, reprint of a superseded Version |
| V-14 | Timelapse | Playback with the pause marked, recording setting |
| V-15 | Recovering a failed print | Resume possible, resume refused |
| V-16 | Machine upkeep | Upkeep list, raised at send time |
| V-17 | Print finished | Clean, with a carried warning, phone Notification |

## Home and work — 9

| ID | Screen | States shown |
| --- | --- | --- |
| H-01 | Home | Live print and running work, phone, first run |
| H-02 | My Projects | Populated, device-only, empty |
| H-03 | Project overview | Full history, stalled at a rejected Plan |
| H-04 | Search | Grouped results, no results |
| J-01 | In Progress | Six Job kinds, empty |
| J-02 | Job detail | Completed research, running print |
| J-03 | Job failure | Paid failure with released reservation, generation failure |
| J-04 | Notifications | Needs a decision vs for information |
| J-05 | Offline and sync | Offline capability, conflict keeping both |

## Access and shell — 6

| ID | Screen | States shown |
| --- | --- | --- |
| A-01 | Sign in | Gate, failure, fresh sign-in required |
| A-02 | Password reset | Requested, new password |
| A-03 | Session ended | Signed out, expired mid-task |
| G-01 | Application shell — **dark mode** | Model workspace, desktop and phone |
| G-02 | Application shell — **RTL** | Research Plan, desktop and phone |
| G-03 | Errors and empty states | Broke, missing, not permitted |

## Settings — 5

| ID | Screen | States shown |
| --- | --- | --- |
| S-01 | Settings overview | Grouped, Administrator items marked |
| S-02 | Language, direction, wording | Language and direction separate; wording examples |
| S-03 | Sources available to new Projects | List, confirmation |
| S-04 | Watching prints | Three options, per-printer state |
| S-05 | Usage Limit and spending | Limit with reservation, history |

## Administrator — 5

| ID | Screen | States shown |
| --- | --- | --- |
| AD-01 | Administrator overview | Tools, recorded actions |
| AD-02 | Paid research providers | Enabled, blocked for incomplete disclosure |
| AD-03 | Printers and links | Permissions per machine, unlinking mid-print |
| AD-04 | Data export | Contents, running |
| AD-05 | Delete the Workspace | Confirmation, blocked while printing |

## Coverage held across the set

- Desktop and phone for every screen where both are used in practice.
- One full dark-mode screen (G-01, desktop and phone) and one full RTL screen (G-02, desktop and phone).
- One bilingual evidence screen (R-02), with original language, translation and explanation as three separate blocks.
- Touch targets 44px minimum, 48px on gates. No text below 12px anywhere.
- Every state carries a glyph and a word before any colour.

---

# Appendix — reconciliation with the 53-ID inventory

Added 2 September 2026 during the repo import; corrected 14 September 2026 against the mockup files themselves. The imported inventory stated that its 64 IDs contained all 53 of the previous ones and that nothing was dropped. That is not correct: the `V-` namespace was reused for print, and several `A-`, `S-` and `AD-` IDs were reassigned to different screens. Sixteen capabilities lost their surface.

> **Correction, 14 September 2026.** This appendix originally claimed eighteen. Two of them — a picture path choice and a cached-or-fresh research choice — were not missing. Reading `Mockups 1 - Create.dc.html` directly shows `C-05` **is** the picture path choice (both accuracy claims side by side, online and offline), and `C-07` **does** carry `2 · Cached or fresh research` as its second labelled block with the Cached Research Revision date. The imported table mislabelled both rows, and the appendix trusted the table rather than the mockups. The two rows are corrected above, the proposed `C-09` and `C-10` are withdrawn, and the total is **80**, not 82. The image-derived warning that the table had placed at `C-05` is a state of `C-04` ("Generate anyway · explicit warning dialog"), not a screen of its own.

This appendix does two things: it maps every one of the 53 previous IDs onto the current set, and it defines the 16 screens needed to close the gap. **Total after reconciliation: 80.**

Nothing in the imported 64 is changed. The previous inventory remains readable in commit `f3340c9`.

## A.1 Added screens

### Validation and Export — 6 (`X-`)

A new prefix, because the `V-` namespace now means print. These are PRD §4.5, which survives the print scope change unaltered — `SCOPE-CHANGE-print.md` states that Export "still exists and is never blocked", and `DESIGN.md` scopes the Step shell to "Create, research, approval, validation and Export screens". Without these, the document asserts screens that do not exist.

| ID | Screen | States shown | Requirement |
| --- | --- | --- | --- |
| X-01 | Target Print Profile | Printer, material, physical size; profile change invalidates validation and Slice | FR-24 |
| X-02 | Validation results | Passing, warning, blocking failure, unknown; named profile and last validation time | FR-25, NFR-11 |
| X-03 | Automatic repair | What was detected, what was repaired, before and after, repair failed | FR-26, FR-27 |
| X-04 | Full regeneration fallback | Offered, running, still failing and stopped with every Version preserved | FR-28 |
| X-05 | Export readiness | Blocked by approval, blocked by validation, ready | FR-29, FR-23 |
| X-06 | Export download | 3MF primary, optional STL, PDF Source Record, phone file handling, failed | FR-29, D-1 |

`X-01` extends `V-01`, which covers printer choice only. Material and physical size are part of the Target Print Profile and have no surface in the imported set.

### Access — 2

| ID | Screen | States shown | Requirement |
| --- | --- | --- | --- |
| A-04 | Invitation registration | Valid code, invalid, revoked, already used, rate-limited, success | FR-1 |
| A-05 | Administrator recovery | Request sent, expired or used link, success with all sessions revoked | D-2 |

New `A-02` Password reset covers an ordinary reset. It does not cover the single-use Invitation Code path, nor the verified-email Administrator recovery that revokes sessions and writes an audit event.

### Work in progress — 1

| ID | Screen | States shown | Requirement |
| --- | --- | --- | --- |
| J-06 | Sources during a running Job | Live Source activity, read a Source mid-Job, reject it and trigger replacement research | FR-43, SC-6 |

`M-08` covers Sources already accepted or rejected in a Project. It does not cover rejecting a Source while research is still running, which SC-6 requires to remove it from that Job.

### Shell — 1

| ID | Screen | States shown | Requirement |
| --- | --- | --- | --- |
| G-04 | First-use guidance | First use, dismissed, reopened from Settings | NFR-8 |

`H-01` has a first-run state; the stage-by-stage explanation in ordinary language is a separate surface.

### Settings — 3

| ID | Screen | States shown | Requirement |
| --- | --- | --- | --- |
| S-06 | Notification categories | Per-category push on and off, permission denied or revoked, all off with in-app history intact | FR-46, SC-5 |
| S-07 | Delete a Project or this Account | Confirmation, what is removed, what is retained and why, blocked while printing | FR-30 |
| S-08 | Appearance and accessibility | Light and dark, text size, high contrast, reduced motion, ordinary versus technical wording | FR-47, SC-7 |

`S-04` covers whether prints are watched. It is not the notification-category control that SC-5 requires, and the imported set has no surface for it. `S-08` is where dark mode is chosen; `G-01` shows the result but not the control.

### Administrator — 3

| ID | Screen | States shown | Requirement |
| --- | --- | --- | --- |
| AD-06 | Invitation Codes | Unused, used, revoked, newly rotated, copy action | FR-1 |
| AD-07 | Sensitive actions and audit | Fresh authentication required, success, failure, sessions revoked, recorded events | D-2, NFR-2 |
| AD-08 | Accounts and limits | Account list and status, disable and re-enable, set or reset another Usage Limit, limit reached | FR-3, FR-4 |

New `AD-01` Administrator overview lists tools and recorded actions but carries no Account administration, and `S-05` covers only the spending of the signed-in Account.

## A.2 Mapping of all 53 previous IDs

Bold marks an ID added by this appendix. "Covered" means the capability survives under a different ID, not that the screen is identical.

| Previous | Previous name | Now | Note |
| --- | --- | --- | --- |
| A-01 | Sign in | A-01 | Covered |
| A-02 | Invitation registration | **A-04** | Namespace reassigned to Password reset |
| A-03 | Administrator recovery | **A-05** | A-02 covers ordinary reset only |
| G-01 | Global shell | G-01, G-02 | Split into dark-mode and RTL shells |
| G-02 | Notifications | J-04 | Moved namespace |
| G-03 | First-use guidance | **G-04** | H-01 first-run state is partial |
| H-01 | Home dashboard | H-01 | Covered; reserved print area now live |
| H-02 | My Projects | H-02 | Covered |
| H-03 | Project/model overview | H-03 | Covered |
| H-04 | Project actions | H-03, **S-07** | Deletion had no surface |
| C-01 | Create entry | C-01 | Covered |
| C-02 | Text request | C-02 | Covered |
| C-03 | Picture intake | C-03 | Covered |
| C-04 | Picture quality and coverage | C-04 | Covered |
| C-05 | Picture path choice | C-05 | Covered — see the correction above |
| C-06 | Understood request | C-06 | Covered |
| C-07 | Research and cache choices | C-07 | Covered — both choices are labelled blocks on one screen |
| C-08 | Start confirmation | C-08 | Covered |
| J-01 | In Progress overview | J-01 | Covered; six Job kinds |
| J-02 | Job detail | J-02 | Covered |
| J-03 | Live Source activity | **J-06** | |
| J-04 | Source reader during Job | **J-06** | Namespace reassigned to Notifications |
| J-05 | Reject current-Project Source | **J-06**, M-08 | Mid-Job rejection had no surface |
| R-01 | Research Plan overview | R-01 | Covered |
| R-02 | Completeness checklist | R-01 | Folded into the area-by-area view |
| R-03 | Consequential Detail review | R-02, R-03 | Covered |
| R-04 | Defensible Options | R-03 | Covered by the disputed-reading screen |
| R-05 | Plan Approval | R-05 | Covered |
| M-01 | Model workspace | M-01 | Covered |
| M-02 | Model Feature evidence | M-02 | Covered |
| M-03 | Evidence-to-model navigation | M-02, M-04 | Covered |
| M-04 | Focused correction | M-06 | Covered |
| M-05 | Correction result | M-06, M-07 | Covered |
| M-06 | Version history | M-03 | Covered |
| M-07 | Version comparison | M-03 | Covered |
| M-08 | Version restoration | M-03 | Covered |
| M-09 | Model Approval | M-09 | Covered |
| V-01 | Target Print Profile | **X-01** | V-01 covers printer choice only |
| V-02 | Validation results | **X-02** | Namespace reassigned to print |
| V-03 | Automatic repair | **X-03** | Namespace reassigned to print |
| V-04 | Full regeneration fallback | **X-04** | Namespace reassigned to print |
| V-05 | Export readiness | **X-05** | Namespace reassigned to print |
| V-06 | Export download | **X-06** | Namespace reassigned to print |
| S-01 | Account Settings | S-01 | Covered |
| S-02 | Notification Settings | **S-06** | Namespace reassigned to language |
| S-03 | Disabled Sources | S-03 | Covered |
| S-04 | Disabled-Source warning setting | S-03 | A state of S-03, not a screen |
| S-05 | Account deletion | **S-07** | Namespace reassigned to Usage Limit |
| AD-01 | Invitation Codes | **AD-06** | Namespace reassigned to overview |
| AD-02 | Account administration | **AD-08** | Namespace reassigned to providers |
| AD-03 | Usage and limits | S-05, **AD-08** | Own spending vs another Usage Limit |
| AD-04 | Administrator recovery/security | **AD-07** | Namespace reassigned to data export |
| AD-05 | Close instance | AD-05 | Covered as Delete the Workspace |

## A.3 Coverage the added screens must also hold

The rules stated for the imported 64 apply unchanged to all 16 added screens: desktop and phone wherever both are used, a glyph and a word before any colour, 44px touch targets and 48px on gates, nothing below 12px, and no state carried by colour alone. Per SC-3 every added screen is a full phone workflow, not a reduced companion.

## A.4 Still open

- **Mockups do not exist for the 16 added screens.** They are specified here and in the PRD, but the Claude Design project covers the imported 64 only. `Flow Map.dc.html` shows 64 cards, not 80. All 80 are built as browsable React screens in `app/` (see `../../../../app/README.md`), which is now the working reference for the added 16.
- **`A.2` is a capability mapping, not a design equivalence.** Where a row says "covered", a reviewer should confirm the required states genuinely survived the fold rather than assuming they did.
