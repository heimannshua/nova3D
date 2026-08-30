---
title: nova3D First-Version Screen and State Inventory
status: ready-for-handoff
updated: 2026-08-30
---

# First-Version Screen and State Inventory

This inventory defines UX coverage, not a required page architecture. Claude Design may combine a surface into a page, panel, sheet, drawer, dialog, or responsive state when that improves usability. It may not omit the capability or hide an approval boundary.

Every first-version surface needs usable desktop/laptop and phone designs. Where a row names an alternate state, show it either as a separate mockup or an explicit variant of the same mockup.

## Global access and shell

| ID | Surface | Must enable or show | Required states or variants |
|---|---|---|---|
| A-01 | Sign in | Account authentication, recovery entry, language access | Default, invalid credentials, disabled Account, loading |
| A-02 | Invitation registration | Single-use Invitation Code, Account creation, clear generic failures | Valid, invalid/revoked/used code, rate-limited, success |
| A-03 | Administrator recovery | Verified-email recovery without exposing other Workspaces | Request sent, expired/used link, success with session revocation |
| G-01 | Global shell | Access to Home, Notifications, Settings, Account, and contextual back navigation | Desktop/laptop, phone, LTR, RTL, light, dark |
| G-02 | Notifications | Actionable event list opening the exact related item | Unread/read, empty, failure, permission disabled, grouped Project events |
| G-03 | First-use guidance | Explain each workflow stage in ordinary language; dismiss and reopen later | First use, dismissed, reopened from Settings |

## Home and Projects

| ID | Surface | Must enable or show | Required states or variants |
|---|---|---|---|
| H-01 | Home dashboard | Three primary actions: **My Projects**, **Create**, **In Progress** | New Account/empty, active Jobs, unread Notification, desktop, phone |
| H-02 | My Projects | Model-focused collection of the Account's Projects | Empty, populated, search/filter if needed, locally saved, syncing, sync failed |
| H-03 | Project/model overview | Open a model, see current stage and Version, reach Sources and Project actions | Researching, awaiting Plan Approval, generating, awaiting Model Approval, validation failed, Export ready |
| H-04 | Project actions | Rename if supported, delete Project/Export, inspect history, resume next required action | Safe actions, destructive confirmation, tombstoned/cleanup state |

## Create

| ID | Surface | Must enable or show | Required states or variants |
|---|---|---|---|
| C-01 | Create entry | Two equal first-version choices: **Enter text** and **Upload picture** | Desktop, phone, offline availability indication |
| C-02 | Text request | Ordinary-language model description plus optional Personalization | Empty, writing, validation problem, example/help without pre-filling intent |
| C-03 | Picture intake | Choose existing image; on phone, take a photo; add several angles | Permission prompt, permission denied, image previews, replace/reorder/remove, file error |
| C-04 | Picture quality and coverage | Explain blur, obstruction, or missing angles and recommend better/additional views | Sufficient, insufficient, additional view requested, **Generate anyway** warning |
| C-05 | Picture path choice | Choose direct image-derived conversion or research-assisted evidence-backed reconstruction | Plain explanation of accuracy difference, online/offline availability |
| C-06 | Understood request | Show subject, scope, intended outcome, picture mode, and Personalization; wait for confirmation | Clear, ambiguous with clarification questions, edit request, confirmed |
| C-07 | Research and cache choices | After scope confirmation, choose free/paid research and cache reuse/fresh research | Cached revision/date shown, fresh research, paid disclosure and maximum charge, limit blocked |
| C-08 | Start confirmation | Summarize the exact Job that will begin without duplicating Plan Approval | Ready, offline direct conversion, provider disclosure unresolved, insufficient allowance |

## In Progress and active research

| ID | Surface | Must enable or show | Required states or variants |
|---|---|---|---|
| J-01 | In Progress overview | Active research, generation, validation, repair, and sync Jobs; **Prints in Progress — Coming later** | No Jobs, several concurrent Jobs, mixed states, future-print placeholder |
| J-02 | Job detail | Current stage, real progress, preserved state, cost impact when known, cancel action | Waiting, running, completed, failed, cancelled, stale result rejected |
| J-03 | Live Source activity | Actual Sources being examined and their role as lead or evidence; no fabricated hidden reasoning | Searching, Source opened, lead, accepted evidence, rejected, replacement search |
| J-04 | Source reader during Job | Read original text, translation, citation, and explanation without pausing research | Hebrew/English, RTL/LTR, excerpt unavailable/digest only, loading/failure |
| J-05 | Reject current-Project Source | **Do not use this Source**, explain effects, continue replacement research | Confirmation, affected Claims rechecking, replacement found/not found |

## Research Plan and Plan Approval

| ID | Surface | Must enable or show | Required states or variants |
|---|---|---|---|
| R-01 | Research Plan overview | Whole-Project status and grouped evidence packages for model sections | Incomplete, ready for review, approved, rejected, invalidated by successor revision |
| R-02 | Completeness checklist | Shape, dimensions, materials, placement, printability, historical interpretation, independent gap review | Complete, missing detail, unresolved gap, newly invalidated item |
| R-03 | Consequential Detail review | Claim, exact Source, reasoning, Detail Status, expected geometry effect | `sourced`, `inferred`, `disputed`, `unknown`, `user-added` |
| R-04 | Defensible Options | Recommended option, competing evidence, geometry effects, user's choice | Recommendation, no settled recommendation, required choice, rejected option |
| R-05 | Plan Approval | Approve or reject the exact Research Plan version only when complete | Blocked/not ready, review complete, approval confirmation, rejected with reason, approval invalidated |

## Model, evidence, correction, and Versions

| ID | Surface | Must enable or show | Required states or variants |
|---|---|---|---|
| M-01 | Model workspace | Read-only 3D inspection with rotate, pan, zoom, fit/reset, standard/section views, hide/isolate, selection, and measurement | Loading, ready, degraded preview, WebGL/GPU failure, phone touch, keyboard alternatives |
| M-02 | Model Feature evidence | Selecting a part reveals the exact Sources, Claims, interpretation, Detail Status, approvals, and affected geometry | Sourced, disputed, user-added Personalization, now-disabled Source warning |
| M-03 | Evidence-to-model navigation | Select a Claim and reveal every affected Model Feature; return from feature to Claim | One-to-one, one-to-many, unavailable preview but intact provenance |
| M-04 | Focused correction | Explain what seems wrong and request additional evidence/research rather than manual mesh editing | Draft, affected dependencies preview, paid permission needed, submitted |
| M-05 | Correction result | Show revised Research Plan, changed details, dependent geometry impact, and renewed approval need | No change, evidence changed, Plan Approval required, generation blocked |
| M-06 | Version history | Timeline/list of immutable Model Versions with governing Plan, approvals, validation, repair, and timestamps | Current, older, restored, deleted exception |
| M-07 | Version comparison | Compare two Versions and identify changed versus unchanged features | Geometry change, evidence-only change, Personalization change, preview degraded |
| M-08 | Version restoration | Restore a Version without silently authorizing a new Export | Confirmation, restored, approval required for new Export |
| M-09 | Model Approval | Approve or reject the exact inspected Model Version | Not inspected, ready, approved, rejected, invalidated by later change |

## Print validation and Export

| ID | Surface | Must enable or show | Required states or variants |
|---|---|---|---|
| V-01 | Target Print Profile | Select printer, material, physical size; first fixture is Bambu Lab A1 mini, 0.4 mm nozzle, gold silk PLA, maximum 90 × 90 × 90 mm | Default fixture, changed profile, incomplete profile |
| V-02 | Validation results | Supported checks, profile, last checked time, pass/warning/failure/unknown; never claim universal safety | Pass, warning, blocking failure, unknown, stale after profile change |
| V-03 | Automatic repair | Show repair target, result, affected geometry, and whether renewed Model Approval is needed | Local repair running/succeeded/failed, substantive versus non-substantive |
| V-04 | Full regeneration fallback | At most one constrained attempt after local repair failure | Running, new Version awaiting inspection/approval, failed and stopped |
| V-05 | Export readiness | Require Model Approval for the exact Version and passing validation | Blocked by approval, blocked by validation, ready |
| V-06 | Export download | Primary 3MF, optional STL, readable PDF Source Record | Preparing, ready, individual/package download, failed, phone file handling |

## Settings and administration

| ID | Surface | Must enable or show | Required states or variants |
|---|---|---|---|
| S-01 | Account Settings | Language, light/dark choice, simple/technical explanation level, onboarding replay | Device-language default, manual override, RTL preview, light default/dark selected |
| S-02 | Notification Settings | Category-specific phone push controls while in-app history remains | Permission allowed/denied, all off, mixed categories |
| S-03 | Disabled Sources | Account-wide Source on/off list with provenance-safe history | Enabled, disabled, search/list empty, active Job affected, re-enabled |
| S-04 | Disabled-Source warning setting | Show or hide warning on completed Projects without changing provenance or Source Record | On by default, off, explanatory confirmation |
| S-05 | Account deletion | Fresh authentication, explicit consequences, immediate tombstone and 30-day backup removal | Confirmation, blocked/error, signed out/deletion underway |
| AD-01 | Invitation Codes | Unique named codes plus rotating single-use general code | Unused, used, revoked, newly rotated, copy action |
| AD-02 | Account administration | Account status, disable/re-enable, no private Workspace access | Enabled, disabling, disabled, re-enabled, active Jobs cancelled |
| AD-03 | Usage and limits | Per-Account paid usage, reservations, settlements, available allowance, set/reset limit | Under limit, nearly reached, reached, running Job allowed, new paid Job blocked |
| AD-04 | Administrator recovery/security | Sensitive actions require fresh authentication and create audit events | Reauthentication, success, failure, session revoked |
| AD-05 | Close instance | Destructive action without viewing private Workspace contents | Fresh authentication, explicit destructive confirmation, closing, complete |

## Cross-surface state requirements

Every relevant mockup must make these distinctions understandable without relying on colour alone:

- Research lead versus accepted evidence.
- `sourced`, `inferred`, `disputed`, `unknown`, and `user-added` Detail Status.
- Cached versus fresh research, including original Cached Research Revision date.
- Historical reconstruction versus Personalization.
- Plan Approval versus Model Approval.
- Preview geometry versus authoritative manufacturing geometry.
- Warning versus blocking failure versus unknown.
- Online, offline, locally saved, syncing, and sync failed.
- Job waiting, running, completed, failed, and cancelled.
- Current Project Source rejection versus Account-wide Source disabling.

## Mockup coverage contract

Claude Design must provide:

- A desktop/laptop and phone treatment for every surface group above.
- Light and dark design-system coverage; light is the default.
- At least one complete LTR example and one complete RTL example.
- Original Hebrew plus English translation on a representative Source/evidence screen.
- Keyboard focus, screen-reader semantics notes, enlarged text, high-contrast, and reduced-motion behavior.
- Real nova3D content rather than lorem ipsum.
- Explicit loading, empty, error, warning, blocked, permission, offline, and destructive states where named.
