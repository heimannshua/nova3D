---
title: nova3D UX Scope Changes After PRD Finalization
status: approved-for-design-handoff
updated: 2026-08-30
sources:
  - ../../prds/prd-nova3D-2026-08-27/prd.md
  - .memlog.md
---

# UX Scope Changes After PRD Finalization

These decisions were approved during UX discovery after the PRD reached `status: final`. Claude Design must include them. Architecture and product planning must reconcile them before implementation. Except where this file explicitly changes scope, the final PRD remains authoritative.

## SC-1 — Picture workflows move into the first version

The PRD deferred picture workflows. The first version now includes both:

- **Direct picture-to-model:** labelled image-derived and not historically verified.
- **Research-assisted picture reconstruction:** identifies the subject, researches it, builds a complete Research Plan, and follows Plan Approval before evidence-backed generation.

Picture intake supports existing images, phone camera capture, and multiple images of one subject from different angles. Before conversion, nova3D checks clarity and angle coverage and recommends additional views. The user may choose **Generate anyway** after an explicit warning that incomplete views can cause invented or inaccurate geometry.

## SC-2 — Direct picture conversion works offline

Direct image-derived conversion must work without internet on supported computer and phone devices. Offline-created Projects remain usable locally, show pending or failed sync state, and automatically sync into **My Projects** when connectivity returns without duplication or overwriting a newer Model Version.

Research-assisted reconstruction remains online-only. Architecture must ratify on-device feasibility, performance, storage, privacy, and fallback behavior before implementation.

## SC-3 — Complete phone workflow

The first version supports the complete workflow on desktop, laptop, and phone. Phone is not a reduced companion: creation, research review, 3D inspection, approvals, validation, and downloads must all work.

## SC-4 — Internationalized interface

The interface supports any configured language, including full right-to-left layout. It initially follows the device language and can be changed in Account Settings. Original Source language, translation, and explanation remain distinguishable; Hebrew and English can appear together in evidence views.

## SC-5 — Phone push notifications

The first version adds phone push notifications for research, generation, validation, Export, and later printing events. Account Settings controls categories. In-app event history remains available when phone alerts are disabled.

## SC-6 — Source exclusion controls

- **Do not use this Source** affects only the current Project. Research continues, invalidated Claims and decisions are visibly rechecked, and nova3D seeks replacement evidence.
- **Disabled Sources** in Account Settings uses a simple on/off control across Projects.
- Switching a Source off during active research removes it from that Job and triggers replacement research.
- Completed approved Projects never mutate. They normally show a warning if they used a now-disabled Source; Settings may hide that warning, but provenance and the Source Record remain unchanged.

## SC-7 — First-version accessibility and preferences

The first version targets WCAG 2.2 AA and supports keyboard operation, screen readers, visible focus, text enlargement, high contrast, non-colour state cues, and reduced motion. Light mode is the default; dark mode is a manual option. Explanations use ordinary language by default, with a Settings option for more technical detail.
