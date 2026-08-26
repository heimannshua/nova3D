# Beginner Development Roadmap: Evidence-Aware Automatic 3D Generation

## 1. The product to build

Build a private, browser-based application that turns deep research into an automatically generated, precise 3D model. The first subject is the Second Temple and its sacred utensils, using Mishnah tractate Middot as the governing spatial specification.

The application must not ask the user to model geometry manually. The user's role is to review research, approve interpretations, inspect results, and request focused re-research when something looks questionable. The application's role is to create and rebuild all geometry.

The visible outcome is a validated, print-ready 3D model file. Every feature and modelling decision must remain traceable to its supporting passages, alternative interpretations, confidence, and approved choice.

The intended stack is:

- React for the browser interface.
- Tailwind for interface styling.
- Supabase for saved application data.
- Upstash for queued or delayed work.
- Vercel for running the web application.
- GitHub for source control and keeping a recoverable history of the code.

For a first-time developer, the safest path is to prove one complete, narrow workflow before expanding the historical scope or adding printer management.

## 2. Non-negotiable product rules

These rules should guide every stage:

1. Research and geometry are one feature. A research result is incomplete until it affects generated geometry, and generated geometry is incomplete unless its evidence is visible.
2. Middot governs the initial reconstruction. Details from other books must be labelled as supplements or inferences.
3. Ambiguity is never hidden. Every detail must be marked as sourced, inferred, disputed, or unknown; the application must never silently invent an answer.
4. Disputed interpretations are reviewed in grouped, section-level dossiers rather than interrupting generation for each detail.
5. The application may recommend an interpretation, but it must wait for user approval before applying it.
6. Geometry is always generated automatically. Inspection may expose problems but must not become a manual modelling interface.
7. Changing an approved measurement must rebuild every connected part and save a new model version.
8. The output is the 3D model only. Images, videos, explanations, and product listings are outside the product scope.
9. The user must inspect a completed model before it can be sent to a printer.
10. Printer fleet features come after the research-to-generation integrity chain works reliably.

## 3. A few terms in plain language

- **Spatial claim:** a structured statement extracted from a source, such as a measurement, position, relationship, or material.
- **Parametric geometry:** a shape built from named measurements and rules, so changing a measurement can automatically rebuild the shape.
- **Provenance:** the record of where a fact or decision came from.
- **Evidence graph:** the connections between model parts, measurements, passages, alternatives, and approvals.
- **Decision dossier:** a grouped review containing disputed claims, competing interpretations, a recommendation, citations, confidence, and expected effects on geometry.
- **Dependency:** a connection showing that one part or measurement relies on another. Dependencies tell the application what must be rebuilt after a change.
- **Validation gate:** a pass/fail checkpoint that must be satisfied before moving to the next stage.
- **Vertical slice:** the smallest complete journey through the product, from source material to a usable model result.

## 4. Recommended scope for the first success

Do not begin with the whole Second Temple, every utensil, or multiple books. Choose one small section from Middot that contains enough information to demonstrate:

- source passages;
- at least one measurement or spatial relationship;
- at least one ambiguity;
- an approved interpretation;
- automatically generated geometry;
- a clickable model part with visible evidence; and
- a saved model version.

This thin vertical slice is the first meaningful product. It tests the indispensable capability without requiring the entire domain to be solved at once.

## 5. Staged roadmap

### Stage 0 — Learn the workflow and define the thin slice

**Goal:** understand the product as a sequence of small data transformations before building a broad interface.

Write down one example by hand:

`passage -> spatial claim -> ambiguity or accepted meaning -> user approval -> geometry rule -> generated part -> evidence shown on click`

Define the chosen section's boundaries and list the minimum model parts it contains. For each part, note whether the current detail is sourced, inferred, disputed, or unknown. Sketch the screens on paper or as simple static pages:

1. source and claim view;
2. grouped decision dossier;
3. generation status;
4. read-only 3D inspection; and
5. evidence panel for a selected part.

**Learning milestone:** explain in plain language how a passage becomes a model part and why approval occurs before disputed geometry is generated.

**Prototype milestone:** a static React and Tailwind walkthrough using one small, hand-prepared example. No research automation or working 3D generation is required yet.

**Validation gate:** the walkthrough contains no manual modelling controls, every displayed part can point back to evidence, and the user can identify exactly where approval is required.

### Stage 1 — Create the evidence and decision records

**Goal:** make traceability work before adding automatic geometry.

In Supabase, represent the minimum information needed for:

- source works and exact passages;
- spatial claims extracted from those passages;
- model sections and parts;
- measurements, materials, and placements;
- competing interpretations;
- confidence;
- status: sourced, inferred, disputed, or unknown;
- recommendations;
- user approvals and rejected alternatives; and
- links from decisions to the geometry they will affect.

Build simple screens to enter or review this information for the selected thin slice. At this stage, manual entry of a small test set is acceptable as scaffolding for learning the structure; it is not the final product workflow.

The approval ledger must record the chosen interpretation, rejected alternatives, citations, confidence, approver, and affected geometry. Since this is a personal application, the approver can simply be the user; team permissions are unnecessary.

**Learning milestone:** create, read, update, and restore the small set of records needed for one disputed claim.

**Prototype milestone:** click a proposed model part in the interface and see its passage, interpretation alternatives, confidence, and approval state, even before the real geometry exists.

**Validation gate:** every proposed measurement, material, placement, and part in the thin slice has traceable evidence or an explicit unknown state. Nothing appears as an unexplained fact.

### Stage 2 — Build the first automatic geometry generator

**Goal:** prove that approved structured claims can generate a model without manual construction.

Implement a small generation module for only the selected section. Keep the domain rules separate from the general application so that Middot is the first domain package, not a permanent hard-coded limit.

The generator should consume approved claims and named measurements, create the required parts, and retain a stable link between each generated part and its evidence records. If a required fact is disputed and unapproved, generation must wait. If a fact is unknown, the system must surface that state rather than silently filling the gap.

Use Upstash only where queued or delayed generation work is actually needed. The first target is a reliable job with visible states such as waiting, running, completed, or failed—not a complex job platform.

**Learning milestone:** understand how one named measurement controls one generated shape and how a source identifier stays attached to that shape.

**Prototype milestone:** press one generate action and receive an automatically created 3D result for the thin slice. No manual geometry editing is available.

**Validation gate:** rebuilding from the same approved inputs produces the intended result; unapproved disputes block the affected generation; and every generated part retains its evidence link.

### Stage 3 — Add grouped research adjudication

**Goal:** turn ambiguity into an explicit, reviewable process.

For one model section, gather its disputed claims into a decision dossier. Each dossier should show:

- the relevant Middot passage;
- relevant arguments from other books;
- competing interpretations;
- the application's recommended position;
- citations and confidence;
- which details are supplemental or inferred; and
- the predicted geometry effects of each choice.

The user approves the grouped set before those interpretations affect geometry. Research support may recommend, compare, and cite, but it may not approve on the user's behalf.

Begin with a deliberately small research set that can be checked carefully. Expand only when the process consistently preserves passages, alternatives, and labels.

**Learning milestone:** trace one disputed claim from its source arguments through the recommendation and approval ledger.

**Prototype milestone:** approve a section dossier and automatically trigger generation using the selected interpretations.

**Validation gate:** no recommended interpretation enters the model before approval, rejected alternatives remain visible, and the generated result can show which geometry changed because of each approved decision.

### Stage 4 — Make the model inspectable and evidence-aware

**Goal:** let the user judge the completed model without exposing modelling tools.

Create a read-only inspection view that supports:

- rotate;
- zoom;
- hide sections; and
- select a part to inspect evidence.

When a part is selected, reveal its exact sources, alternatives, confidence, approved interpretation, and status. Keep the interface focused on inspection and evidence rather than geometry editing.

**Learning milestone:** connect a selected visible part to the correct evidence and approval records.

**Prototype milestone:** inspect the entire thin-slice model and retrieve the evidence for every selectable part.

**Validation gate:** every generated feature and modelling decision exposed in the slice can be investigated from the model, and no part appears more certain than its evidence allows.

### Stage 5 — Add dependency-aware regeneration and versions

**Goal:** make corrections safe and automatic.

Record which parts depend on each approved claim and measurement. When the user changes an approved measurement or interpretation, rebuild every connected part, leave unrelated parts unchanged, and save the output as a new version.

Each version should preserve enough context to understand which approved decisions produced it. Earlier versions must be restorable so interpretations can be compared without losing work.

**Learning milestone:** demonstrate a dependency chain in which one changed measurement affects more than one connected part.

**Prototype milestone:** change an approved value, regenerate the affected geometry, compare the new and previous model states, and restore the earlier state.

**Validation gate:** the application identifies all affected geometry, saves a new version rather than overwriting history, and can restore the prior version with its evidence links intact.

### Stage 6 — Close the inspection-to-research loop

**Goal:** turn a visual concern into focused research and automatic correction.

From the inspection view, let the user mark a selected part as questionable. The application should open focused re-research for that part, assemble the relevant alternatives into a new or revised dossier, wait for approval, regenerate all affected geometry, and save another version.

This is the full core loop:

`research -> recommendation -> approval -> generation -> inspection -> focused re-research -> approval -> regeneration`

**Learning milestone:** explain how a visual concern travels back through evidence and returns as revised geometry without manual modelling.

**Prototype milestone:** complete that loop once for a deliberately chosen questionable part.

**Validation gate:** no geometry changes before the revised decision is approved; all connected parts rebuild; and both the original and revised states remain traceable and restorable.

### Stage 7 — Produce and validate the print-ready file

**Goal:** deliver the promised model outcome before connecting to printers.

Add a final validation step that prepares the generated model as a print-ready file. Keep file-format and modelling complexity hidden from the normal user experience. The user must inspect and explicitly accept the completed model before it becomes eligible for printing.

At this stage, stop at producing the validated file. The user can confirm that the core product works without introducing device connections, printer settings, queues, cameras, or filament tracking.

**Learning milestone:** understand the difference between generated geometry, an inspected model version, and the final validated file.

**Prototype milestone:** complete the thin slice from its sources to an inspected, approved, print-ready model file.

**Validation gate:** the file comes from an approved and inspected version, contains no silently invented details, and every included model feature remains traceable to evidence and decisions.

### Stage 8 — Expand the reconstruction carefully

**Goal:** grow from one proven section to the broader Second Temple reconstruction and utensils.

Add one section or object group at a time. Each expansion must pass the same gates for evidence, ambiguity, approval, generation, inspection, regeneration, versioning, and print readiness. Avoid a large one-time expansion that makes failures difficult to trace.

Use what was learned to refine the reusable source-to-model engine while keeping Middot-specific rules in the first domain package. Only after several sections work through the same pipeline should another book or research topic be tried.

**Learning milestone:** identify what belongs to the reusable engine and what belongs only to the Middot domain package.

**Prototype milestone:** generate multiple connected sections through the same workflow and update a shared measurement safely.

**Validation gate:** added sections do not weaken evidence visibility, approval control, dependency rebuilding, or version restoration.

### Stage 9 — Add one-printer confirmation and submission

**Goal:** connect physical output only after the model pipeline is trustworthy.

Start with one personal printer and one explicit confirmation step. The application should validate the geometry, prepare it for that selected printer, show the final model for inspection, and submit the job only after confirmation.

Keep this stage narrow. Detailed device information, automatic selection, settings control, cameras, filament state, and multi-printer queues are separate later risks.

**Learning milestone:** understand the boundary between producing a print-ready model and submitting a confirmed print job.

**Prototype milestone:** send one inspected and confirmed model to one printer without bypassing the final approval.

**Validation gate:** no job is submitted without inspection and confirmation, and printer integration cannot alter the approved source-to-geometry record.

### Stage 10 — Add printer fleet management last

**Goal:** support multiple connected printers without compromising active jobs or the core model workflow.

Add fleet capabilities incrementally:

1. show multiple printers and detailed device information;
2. show availability and existing queues;
3. track loaded filament colour and material type;
4. match model needs against printer build dimensions, capabilities, and loaded filament;
5. automatically choose the best printer using model requirements, availability, filament, and queue time;
6. queue a new job when no suitable printer is free, never interrupting an active print;
7. expose printer settings; and
8. add camera feeds for live monitoring.

Each item should be proven before the next is added. The fleet console is valuable, but it is not the indispensable first capability and should not delay the evidence-aware generator.

**Learning milestone:** trace why a job was matched to a printer and why it was queued instead of interrupting an active print.

**Prototype milestone:** route one confirmed job safely across a small set of connected printers using availability, requirements, filament, and queue information.

**Validation gate:** active prints are never interrupted; automatic selection is explainable from the recorded criteria; and the user can inspect printer state, job state, filament, settings, and camera information without weakening the final confirmation rule.

## 6. What to defer deliberately

Until the end-to-end thin slice passes Stage 7, defer:

- the full Second Temple complex;
- every sacred utensil;
- support for unrelated books or research topics;
- multiple printers;
- automatic printer selection;
- printer settings control;
- camera monitoring;
- filament inventory and matching;
- fleet queues; and
- any deliverable other than the 3D model.

Billing, collaboration, marketplace features, broad onboarding, and complex permissions are unnecessary because the application is personal-only. Selling the resulting models is the user's eventual purpose, but the application itself does not need to generate sales materials or product listings.

## 7. A practical build rhythm for a first-time developer

For every stage, use the same small cycle:

1. Choose one observable outcome.
2. Build it with the smallest possible example.
3. Save the code in GitHub.
4. Test the normal path and the important refusal path, such as an unapproved dispute that must not generate geometry.
5. Record what the prototype proved and what remains uncertain.
6. Pass the stage's validation gate before expanding scope.

Use Vercel, Supabase, Upstash, React, Tailwind, and GitHub only as needed to support the current stage. Do not turn learning every part of the stack into a separate prerequisite. The product should grow as a chain of working proofs.

## 8. Definition of the first real release

The first real release is not the full reconstruction or a printer fleet. It is one carefully bounded section that can complete all of the following:

1. preserve exact source passages;
2. extract and display structured spatial claims;
3. identify sourced, inferred, disputed, and unknown details;
4. research and compare disputed interpretations;
5. present a grouped dossier with citations, confidence, recommendations, and predicted geometry effects;
6. wait for user approval;
7. generate all geometry automatically;
8. show evidence for every generated feature and decision;
9. support read-only inspection;
10. turn a questionable part into focused re-research;
11. regenerate every dependent part after approval;
12. save and restore model versions; and
13. produce an inspected, validated, print-ready 3D model file.

Once this release works, the central product idea has been proven. Broader reconstruction, new research domains, and printer automation can then be added without losing the integrity chain that makes the model trustworthy.
