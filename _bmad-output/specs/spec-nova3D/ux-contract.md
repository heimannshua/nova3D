# Approved UX Contract

This companion preserves the approved August 30 UX behavior and the September 14 ratified offline and visual decisions. It governs CAP-3, CAP-4, CAP-6, CAP-9, CAP-16 and CAP-17 alongside the PRD. It specifies the required experience; no complete visual implementation or benchmark is claimed.

## UX-1 — Navigation and guidance

- The initial dashboard has My Projects, Create and In Progress. My Projects is model-focused: opening an item opens the model, with its sources accessible from the model and selectable features.

- In Progress shows active model generation and actual recorded research activity. A Prints in Progress section is labelled Coming later; no first-version screen implies live printer control.

- First-use guidance explains each workflow stage in ordinary language, can be dismissed and can be reopened. A more technical explanation setting changes detail only, not evidence, decisions or actions.

## UX-2 — Intake and confirmation

- Create offers Enter text and Upload picture. Picture requests choose direct image-derived conversion or research-assisted reconstruction; both belong to the first version.

- Picture intake supports existing files and, on phone, Take photo. Request camera permission only after that action. Multiple angles of one subject remain one request, with add, preview, replace, reorder and remove controls.

- Check clarity and angle coverage before conversion; explain detected problems and useful additional views. Missing views do not permanently block direct conversion: Generate anyway requires an explicit warning that uncertain geometry may be invented or inaccurate.

- After input and mode choice, show understood subject, scope, intended outcome and personalization and wait for explicit confirmation. For research workflows, ask free-only versus paid and reuse versus fresh research in a separate subsequent step before starting the Job. Scope confirmation does not authorize a paid category.

## UX-3 — Evidence and source controls

- Evidence shows original source language, translation and explanation distinctly, including adjacent right-to-left Hebrew and left-to-right English. Feature-to-evidence and evidence-to-feature navigation reveal the exact part, detail status and governing choices.

- During research, show the sources actually being examined and their role, including lead versus accepted evidence. Display recorded activity and evidence-based explanations; never fabricate hidden reasoning. Opening/reading a source does not interrupt its background Job.

- Do not use this Source excludes it only from the current Project. Affected active claims/decisions are visibly invalidated and reconsidered while research automatically searches for replacements; other Projects remain unaffected.

- Settings has an Account-wide Disabled Sources list with one on/off toggle per source. Off prevents eligibility; on restores eligibility without deleting source records/history. Turning a source off during research applies immediately and triggers replacement evidence.

- Completed approved records never mutate. An Account-wide toggle normally adds a now-disabled-source warning; Settings may hide that warning without changing approvals, history, provenance or the exported Source Record. A Project correction affecting an approved interpretation follows the successor-plan and renewed-approval path.

## UX-4 — Offline behavior

- Offline execution applies only to direct image-derived picture conversion on supported computers and phones; research-assisted reconstruction remains online-only. Direct results remain labelled image-derived and not historically verified.

- An offline-created model remains usable and saved on its device. Show pending, failed and conflicting sync states; automatically synchronize into the original Account's My Projects when connectivity returns without duplicate Projects or overwriting newer versions.

- Online preparation installs and verifies the inference bundle; qualified export requires connectivity. Do not silently upload images or substitute paid cloud generation after local failure. G-8 must demonstrate the adopted engine/device, storage, eviction and interrupted-work behavior before release.

- R-8 adopts revocation on reconnect: already-local drafts remain usable while disconnected without a time lease. Explain this during preparation. On contact, reject disabled/deleted sync, lock on disable and purge learned deletion before import; a known disable stays locked until authoritative re-enable. Explicit sign-out clears private stores; network uncertainty alone cannot erase work. Immediate cloud revocation and the controlled-backup deletion deadline remain binding; disconnected devices and user-downloaded files are outside that erasure guarantee.

## UX-5 — Responsive access and preferences

- The complete workflow works on desktop, laptop and phone: creation, research review, 3D inspection, approvals, validation and downloads. Phone is not a reduced companion.

- Support any configured interface language and full RTL layout. First use selects a supported device-language match; Settings permits a persistent Account override. Configured languages are not a promise of automatic accurate translation into every language.

- Light mode is the default on every device; dark mode is an explicit option. Evidence statuses, warnings, approval state and 3D inspection remain legible in either theme.

- Target WCAG 2.2 AA: complete keyboard operation, screen-reader semantics and announcements, visible focus, text enlargement, sufficient contrast, non-colour statuses and reduced motion. Inspection and evidence controls must remain operable through semantic controls as well as the viewport.

## UX-6 — Notifications

- Phone push covers research, generation, validation and export events, and later printing. Category-specific Account settings control these alerts; denied/disabled push never removes essential in-app Project event history.

- Selecting an alert opens the exact related Project item after authorization. The app-wide notification bar covers research readiness, generation completion/failure and export readiness; delivery behavior and private-payload restrictions follow the architecture.

## UX-7 — Ratified visual direction

- R-10 selects neutral light surfaces, slate text, indigo primary actions and semantic evidence badges, with an explicit dark option. Desktop centers the model with an evidence inspector; phone layouts use stacked panels/drawers while preserving all controls, RTL and WCAG 2.2 AA.

- The existing visual handoff covers the complete application: authentication, Account/Administrator surfaces, creation, research/approvals, In Progress, inspection/correction/versions, validation/export, Settings, responsive and accessibility states.

- Josh's fast-path ratification delegates completion under this baseline and removes the requirement to pause for alternative-direction selection or a specific external design-tool handoff. Existing DESIGN.md and EXPERIENCE.md remain historical drafts, not newly approved mockups. Complete responsive states still require design and implementation verification.
