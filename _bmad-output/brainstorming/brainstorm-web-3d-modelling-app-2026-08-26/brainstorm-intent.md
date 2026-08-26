# Product Intent: Evidence-Traceable 3D Reconstruction

## Purpose

Build a private, browser-based system that turns researched historical sources into precise, automatically generated, print-ready 3D models. The first domain is a reconstruction of the Second Temple and its sacred utensils, using Mishnah tractate Middot as the governing spatial specification.

This is a personal tool for a first-time developer. It should use clear, beginner-friendly language and hide modelling and file-format complexity.

## Core Outcome

The user supplies or selects source material, reviews disputed interpretations in grouped decision dossiers, approves the positions to use, and receives a validated 3D model ready for inspection and printing. The user directs research and approves interpretations; the system performs all geometry construction.

## Integrity Principle

Guaranteed historical certainty is impossible where evidence is incomplete or disputed. The product must instead provide complete traceability: every object, measurement, material, placement, and modelling decision is linked to its exact sources, competing interpretations, confidence, and approval record. Each detail must be explicitly classified as sourced, inferred, disputed, or unknown; the system must never silently invent certainty.

## Essential Workflow

1. Parse Middot into spatial claims and identify ambiguities or missing details.
2. Research relevant books and arguments for disputed claims.
3. Present section-level dossiers containing alternatives, citations, a recommended interpretation, confidence, and predicted geometry effects.
4. Wait for user approval before applying disputed interpretations.
5. Convert approved claims into parametric geometry while preserving source links and rejected alternatives.
6. Generate and validate a print-ready model.
7. Let the user inspect the completed model in a read-only viewer: rotate, zoom, hide sections, and click any part to inspect its evidence.
8. From a questionable part, trigger focused re-research, approval, and automatic regeneration of all dependent geometry.
9. Save every approved or regenerated model state as a restorable version.

## MVP Priority

The indispensable first capability is the complete research-to-model chain: deep research, interpretation approval, automatic geometry generation, evidence inspection, dependency-aware regeneration, and a print-ready model file. Research without geometry and geometry without evidence are both incomplete.

## Printing Direction

After inspection and confirmation, the app should connect to multiple personal 3D printers and automatically route or queue the job using printer availability, build dimensions, capabilities, loaded filament colour and material, and queue time. It must never interrupt an active print. The app should expose printer settings, fleet status, job queues, filament state, and live camera feeds.

## Product Boundaries

- No manual modelling tools; geometry is always system-generated.
- The primary deliverable is the 3D model, not separate images, videos, explanations, or sales listings.
- No billing, collaboration, marketplace, broad onboarding, or complex permissions.
- Inspection is read-only; corrections happen through research revision and regeneration, not direct mesh editing.

## Technical Direction

Use React and Tailwind for the web interface, Vercel for deployment, Supabase for persistent data, Upstash where appropriate for queues or transient coordination, and GitHub for source control. Architect the product as a reusable source-to-model engine, with Middot as the first domain package rather than hard-coding the system to one reconstruction.

## Later Expansion

Allow other books and research topics to become domain packages so the same evidence-aware pipeline can generate other kinds of accurate, commercially saleable 3D models.
