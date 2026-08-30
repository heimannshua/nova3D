---
title: nova3D Producer Brief for Claude Design
status: ready-for-handoff
updated: 2026-08-30
---

# Claude Design Handoff: nova3D

## Your role

You are the visual design producer for nova3D. Turn the supplied product and UX contracts into an original, coherent, accessible visual system and complete responsive mockups.

You own visual exploration and mockup production. You do not own product scope, workflow gates, evidence semantics, privacy rules, or safety claims. Do not silently omit a required state, merge two approval gates, invent a capability, fabricate research content, or resolve a source conflict through visual design. Ask Josh when a choice changes product behavior; show options when a visual choice remains open.

## Source authority

Read every supplied file before designing:

1. `prd.md` is the authoritative original product contract.
2. The PRD `addendum.md` is authoritative supporting technical context.
3. `UX-SCOPE-CHANGES.md` contains later user-approved changes and overrides the PRD only where explicit.
4. `brief.md` and its `addendum.md` provide supporting intent.
5. `SCREEN-INVENTORY.md` is the required design-coverage contract.

If two sources disagree outside an explicit scope change, surface the conflict and wait.

## Product summary

nova3D is a private browser-based evidence-to-fabrication app. Josh can describe a model or upload pictures; nova3D researches when required, explains every consequential modelling decision, waits for approval of the complete Research Plan, generates reproducible geometry, lets Josh inspect each Model Feature and its Sources, waits for approval of the exact Model Version, validates it against a Target Print Profile, and exports a 3MF with optional STL and a PDF Source Record.

The first evidence-backed proof is the outer altar and ramp described in Mishnah tractate Middot chapter 3. The promise is complete traceability, not impossible historical certainty.

## People and stakes

- **Josh** is the Administrator, first user, a first-time developer, and a non-modeller. He needs ordinary language and automatic generation without losing control.
- Trusted invited Accounts have isolated private Workspaces. Josh controls invitations, status, and paid usage but cannot browse their Project content.
- The complete workflow must work on desktop, laptop, and phone.
- The interface supports any configured language and RTL layouts. Evidence views handle original Hebrew alongside English translation and explanation.
- The experience targets WCAG 2.2 AA: keyboard, screen reader, enlarged text, visible focus, high contrast, non-colour cues, and reduced motion.

## Experience promise

Make these truths continuously understandable:

- nova3D performs research and modelling; the person remains the authority.
- Evidence, interpretation, geometry, validation, and approval form one inspectable chain.
- Uncertainty is visible and actionable, not hidden behind an opaque score.
- Historical reconstruction is distinct from Personalization.
- Image-derived output is distinct from evidence-backed reconstruction.
- Evidence-backed geometry waits for a complete approved Research Plan.
- Export waits for approval of the exact inspected Model Version and passing supported validation.
- Progress shows recorded Job and Source activity, never fabricated hidden reasoning.

## Canonical language

Preserve the capitalized product terms defined in the PRD. Detail Status is exactly one of `sourced`, `inferred`, `disputed`, `unknown`, or `user-added`.

Never collapse research leads with evidence, cached with fresh research, Plan Approval with Model Approval, preview with manufacturing geometry, warning with blocking failure, or current-Project Source rejection with Account-wide Source disabling.

## Voice and content rules

- Use short ordinary-language explanations by default; explain necessary technical terms.
- Settings can switch to more technical detail without changing evidence or actions.
- Failures state the failed stage, known cause, preserved state, known cost impact, and next action.
- Never claim historical proof, perfect accuracy, universal printability, or safety certification.
- Use real nova3D wording, not lorem ipsum.
- Do not fabricate Hebrew passages, quotations, citations, dimensions, conclusions, or scholars. If exact content is unavailable, use an explicit verified-content placeholder.

## Fixed information architecture

The first screen is a simple Home dashboard with three primary actions:

1. **My Projects** — model-focused access to saved Projects and Versions.
2. **Create** — begins with **Enter text** or **Upload picture**.
3. **In Progress** — active research, generation, validation, repair, and sync Jobs, plus **Prints in Progress — Coming later** without implying printer control works.

Notifications, Settings, Account, Administrator tools, help, and back navigation are globally reachable but secondary. Choose their responsive treatment after Josh selects a visual direction. Do not demote or rename the three primary actions.

`SCREEN-INVENTORY.md` defines every required surface and state. A surface may become a page, panel, drawer, sheet, dialog, or responsive state, but its behavior cannot disappear.

## Core journeys

### Evidence-backed model from text

1. Josh selects **Create** and **Enter text**, describes the model and optional Personalization, then reviews nova3D's understood subject, scope, and outcome.
2. After scope confirmation, he chooses free or paid research and cached or fresh research. Paid Work discloses provider, purpose, outbound data, retention limits, and maximum charge before permission.
3. The Job runs in the background. Josh may use other Projects or open actual Sources without interrupting research.
4. The complete Research Plan groups related details but keeps one whole-Project approval boundary. Josh reviews completeness, the independent gap check, Claims, Sources, reasoning, Defensible Options, expected geometry effects, and unresolved choices.
5. **Plan Approval:** Josh approves the exact Research Plan version; only then may nova3D generate evidence-backed geometry.
6. Josh inspects the Model Version, selects Model Features to see their Sources, and may request focused correction. Changed evidence requires a new Plan version, renewed Plan Approval, dependent regeneration, and a new Model Version.
7. **Model Approval:** Josh approves the exact inspected Model Version.
8. He selects the Target Print Profile, reviews validation and bounded repair, then downloads the 3MF, optional STL, and PDF Source Record.

### Direct image-derived model

1. Josh selects **Upload picture** and adds one or several views from files or a phone camera.
2. nova3D checks clarity and angle coverage. Josh may add views or choose **Generate anyway** after a clear uncertainty warning.
3. He chooses direct conversion, confirms nova3D's understood request, and can generate offline on supported devices.
4. The Project remains labelled image-derived and not historically verified. Local and sync states remain visible until it safely joins **My Projects**.
5. Josh inspects and approves the model before validation and Export.

### Research-assisted picture reconstruction

Picture capture and quality review match direct conversion. Josh instead asks nova3D to identify and research the subject. After scope confirmation, the experience follows the complete Research Plan, Plan Approval, generation, Model Approval, validation, and Export journey above.

### Source rejection

- **Do not use this Source** affects only the current Project. nova3D removes it from evidence, visibly rechecks affected Claims and decisions, and continues seeking replacement evidence.
- **Disabled Sources** in Settings uses Account-wide on/off controls. Switching a Source off during active research triggers the same recheck.
- Completed approved Projects never mutate. They normally warn that a disabled Source was used. Settings may hide that warning, but provenance and the Source Record remain unchanged.

### Invited access and spend

Josh issues single-use Invitation Codes, sees Account status and paid usage without seeing private Project content, sets Usage Limits, and disables or re-enables Accounts. Sensitive and destructive actions require fresh authentication, explicit consequences, and the required confirmation.

## Behavioral invariants

- Background work never blocks navigation or inspection.
- Job states are `waiting`, `running`, `completed`, `failed`, and `cancelled`.
- Failed Jobs do not retry automatically; they preserve approved state and wait for the user's decision.
- Notifications open the exact related item. Phone push categories are configurable while in-app history remains.
- Selecting a Model Feature opens its Sources, Claims, interpretation, Detail Status, and decisions. Selecting a Claim can reveal every affected Model Feature.
- Manual mesh editing is not a feature. Corrections are evidence-led and regeneration-based.
- Changes invalidate the relevant Plan Approval or Model Approval rather than silently carrying approval forward.
- Automatic repair may try local repair and at most one constrained full regeneration; it never loops indefinitely.
- Deletion appears immediately tombstoned and hidden while cleanup continues.
- Direct printer control is unavailable. Show only the clearly labelled future printing area.

## Responsive, international, and accessible behavior

- Design the complete workflow for desktop/laptop and phone; phone is not a status-only companion.
- Preserve 3D inspection on touch devices and provide alternatives to hover, right-click, or precision pointing.
- Support text expansion and mirrored RTL layout without clipping or semantic reversal.
- Keep identifiers, measurements, extensions, and mixed-direction citations readable in RTL.
- Separate original Source language, translation, and explanation semantically.
- Light is the default; dark is manually selectable and must preserve status clarity.
- Use text or shape as well as colour for every state.
- Provide visible focus, accessible names, usable touch targets, dynamic-state announcements, enlarged-text behavior, and reduced-motion behavior.

## Round 1 — visual directions only

Josh has not chosen a reference product, palette, typography, density, shape language, or visual personality. Do not choose one silently.

Create exactly three genuinely different visual directions applied to the same nova3D content. Each must be a complete visual personality, not a palette swap. Vary hierarchy, density, typographic character, rhythm, depth, shapes, icon treatment, and motion implication while preserving identical behavior.

For each direction, show:

- the Home dashboard at desktop/laptop and phone sizes;
- light mode as the primary treatment and enough dark-mode treatment to prove translation;
- **My Projects**, **Create**, and **In Progress** as the three primary actions;
- one active-generation state and **Prints in Progress — Coming later**;
- one unread Notification state;
- a short rationale, early token sample, accessibility risks, and trade-offs.

Use the example Project name **Outer Altar and Ramp — Middot 3**. Do not fabricate Sources or geometry claims.

Stop after Round 1. Ask Josh to select one direction, combine named aspects, or request another exploration. Do not produce the complete design system or mockup set before approval.

## Round 2 — after direction approval

### DESIGN.md

Create `DESIGN.md` following the Google Labs `design.md` contract:

- YAML frontmatter with `name`, `description`, `colors`, `typography`, `rounded`, `spacing`, and `components` tokens.
- Kebab-case colour tokens and `{path.to.token}` references.
- Complete light and dark theme coverage.
- Body sections in this order when present: **Brand & Style**, **Colors**, **Typography**, **Layout & Spacing**, **Elevation & Depth**, **Shapes**, **Components**, **Do's and Don'ts**.
- Visual treatments for evidence statuses, approvals, Jobs, Notifications, picture-quality warnings, offline/sync, Source rejection, validation, destructive actions, and 3D selection.
- If proposing a base UI system such as shadcn/ui, separate inherited defaults from nova3D-specific tokens and components.

### Complete mockups

Create the complete first-version set in `SCREEN-INVENTORY.md`:

- native editable output in Claude Design's normal format;
- viewable exports for every surface group and named state;
- desktop/laptop and phone coverage;
- at least one complete RTL mockup and a bilingual Hebrew/English evidence screen;
- light and dark system proof;
- accessibility annotations for focus, names, announcements, text enlargement, contrast, reduced motion, and touch alternatives;
- interaction notes for non-obvious behavior without rewriting product requirements.

### Mockup manifest

Create `MOCKUP-MANIFEST.md` mapping every `SCREEN-INVENTORY.md` ID to its native artifact/frame, viewable export, viewport, theme, represented states, and any genuine unresolved question. If surfaces are combined, list every covered ID. No required screen may disappear because it resembles another.

## Final quality check

Verify and report that:

- all screen IDs are covered;
- both approval gates remain visible and version-bound;
- evidence states and Source controls do not rely on colour alone;
- phone supports the complete workflow;
- the two picture modes and their accuracy claims remain distinct;
- offline direct conversion and sync states are shown;
- printer control is not falsely shown as available;
- the Administrator cannot see invited users' private Workspace content;
- destructive and paid actions expose consequences before commitment;
- no Source passage, citation, dimension, or research conclusion was fabricated;
- ordinary language is the default;
- outputs are ready to import into the nova3D UX workspace.
