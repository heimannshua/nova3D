---
title: nova3D Product Brief
status: final
created: 2026-08-27
updated: 2026-08-27
---

# Product Brief: nova3D

## Executive Summary

nova3D is a private, browser-based evidence-to-fabrication system for creating precise, printable 3D reconstructions without manual modelling. Its first major outcome is a reconstruction of the Second Temple and its utensils, governed by Mishnah tractate Middot. Its first development model is deliberately narrower: the outer altar and ramp described in Middot chapter 3.

The system turns source material into explicit spatial claims, conducts additional research only when details are missing, ambiguous, or disputed, and presents a complete research and interpretation plan for the project. Only after approval does it generate deterministic 3D geometry. Every consequential feature remains linked to its source, alternatives, confidence, and approval history. Where historical certainty is impossible, nova3D promises complete traceability rather than false certainty.

One first-time developer is building nova3D as a practical personal tool for his own use. Its first milestone is a validated, print-ready altar-and-ramp file with a complete source record and a plain-language personalization test. Direct printer control, complete Temple generation, and commercial sale of reliable outputs follow later.

## Who This Serves

The initial and only application user is Josh: a first-time developer building a private tool for personal reconstruction projects. He does not want to become a manual 3D modeller. He needs beginner-friendly guidance, visible evidence, control over disputed interpretations, automatic construction, and a practical route to printable files. If the system becomes reliable, he intends to create a wider range of precise models and sell the outputs; the application itself will not become a customer-facing marketplace.

## The Problem

Historically defensible 3D reconstruction requires expertise in several disciplines: interpreting textual descriptions, finding and weighing relevant scholarship, resolving conflicting views, translating conclusions into connected dimensions and constraints, generating valid geometry, and preparing it for printing. Conventional 3D software leaves the geometry work to the user and does not preserve an auditable relationship between a source claim and the shape it produced.

For a first-time developer and non-modeller, that workflow is inaccessible. Generic AI generation does not solve the core problem: an attractive mesh may silently invent details, cite sources that do not support its geometry, or conceal uncertainty. A correction to one measurement can also require coordinated changes across many connected parts.

nova3D must therefore make the full reasoning chain inspectable while hiding manual modelling complexity. The user should direct the project, choose among defensible interpretations, approve the complete plan, inspect the result, and request targeted additional research when a feature appears incorrect. The system should own research orchestration, dependency-aware geometry generation, validation, and versioning.

## What Makes This Different

Individual parts of this workflow already exist in research assistants, generative 3D services, browser viewers, parametric modelling systems, slicers, and printer APIs. nova3D does not claim novelty for those pieces or promise magical text-to-CAD accuracy. Its differentiation is the governed chain connecting them:

`source passage -> explicit claim -> interpretation options -> user approval -> typed parameter or constraint -> deterministic geometry version -> print validation`

Research without geometry does not produce the desired object. Geometry without evidence cannot support a defensible reconstruction. nova3D makes every consequential choice inspectable, reversible, attributable, and regenerable. Personal additions use the same automatic generation experience but remain distinct from the historical evidence chain.

## The Solution Experience

The user starts a reconstruction project by choosing the source material and describing the desired outcome. For the first development model, nova3D reads the relevant material in Middot chapter 3 and extracts the claims needed to construct the outer altar and ramp. Explicit descriptions become sourced modelling rules. Missing, conflicting, or ambiguous details trigger broader internet research. The system uses low-authority pages only as leads and grounds recommendations in directly citable primary texts, recognized commentaries, books, archaeological evidence, or work by named scholars.

nova3D completes research across the whole requested model before generating any geometry. It then presents a review containing the proposed model, cited basis for each consequential decision, disputed alternatives, confidence, and clear options wherever evidence cannot settle a required detail. The user chooses among the defensible options and approves the complete plan. Geometry generation starts only after that approval.

The resulting parametric model preserves the relationships between approved claims and their dependent geometry. The user can rotate the model, zoom in or out, hide sections, and select any part to view its supporting evidence. A questionable feature can be sent back through focused research and approval; the system then regenerates every dependent part and saves a restorable version. The user can also request personal changes in plain language, such as adding a name. These additions remain visibly distinct from historically sourced geometry and must preserve printability.

## First Milestone Boundary

The first milestone proves the complete outer altar-and-ramp workflow: research and approve the model before automatic generation, preserve evidence and approval history, support inspection and correction with dependent regeneration, add clearly distinguished plain-language personalization, and export a validated, print-ready file with its source record.

This milestone excludes the complete Temple, autonomous printer control, multi-printer routing, cameras, physical-print completion, storefronts, sales tooling, collaboration, billing, and source-licensing assessment. Those concerns remain in the longer-term direction. The application records citations; the user remains responsible for commercial licensing decisions.

## Success Criteria for the First Milestone

The altar-and-ramp milestone succeeds when:

- Every consequential object, dimension, material, placement, and generated feature is linked to a cited source or explicitly marked as inferred, disputed, unknown, or user-added.
- The app identifies all unresolved project details and presents defensible options before any geometry is generated.
- No geometry is generated until the user approves the complete research and interpretation plan.
- The approved plan produces the complete altar-and-ramp model without manual modelling.
- Clicking a model feature reveals its supporting claim, sources, alternatives where relevant, confidence, and approval state.
- A plain-language personalization request produces clearly labelled custom geometry without breaking printability.
- Correcting an approved claim regenerates every dependent part and creates a restorable version.
- The final export passes automated checks for a closed, printable model and is delivered with its source record.

These criteria test traceability, workflow integrity, deterministic regeneration, and manufacturability. They do not claim that software can prove an objectively certain reconstruction where the historical record is incomplete.

## Build Direction

Development should preserve one end-to-end integrity chain rather than building disconnected feature demos. The first implementation uses React and Tailwind for the browser experience, Vercel for web deployment, Supabase for persistent project, evidence, approval, and version data, Upstash where queued background work is justified, and GitHub for source control. These technology choices are constraints, but each task should use only a service suited to it.

The build sequence is:

1. Prove the complete altar-and-ramp workflow, including one personalized variation.
2. Expand the same evidence and geometry system section by section until it can generate the complete Temple and utensils.
3. Add direct printer control, safe multi-printer queues, printer and filament status tracking, configuration settings, and camera feeds.
4. Generalize the source-to-model engine for other books, research domains, and model types.
5. Validate repeatable quality across multiple outputs before selling generated models.

## Vision

nova3D becomes a personal system for turning difficult source material into defensible physical reconstructions whose histories remain inspectable. The Second Temple is the proving domain, not a hard-coded limit: the same governed chain can later support other precise research-led models while preserving evidence, uncertainty, human authority, and reproducible fabrication.
