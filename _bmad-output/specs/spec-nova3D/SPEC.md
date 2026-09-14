---
id: SPEC-nova3D
status: final
created: 2026-09-14
updated: 2026-09-14
companions:
  - scope-and-readiness.md
  - ux-contract.md
  - ../../planning-artifacts/prds/prd-nova3D-2026-08-27/prd.md
  - ../../planning-artifacts/architecture/architecture-nova3D-2026-09-14/ARCHITECTURE-SPINE.md
  - ../../planning-artifacts/architecture/architecture-nova3D-2026-09-14/RATIFIED-DECISIONS.md
sources:
  - ../../planning-artifacts/ux-designs/ux-nova3D-2026-08-27/UX-SCOPE-CHANGES.md
  - ../../planning-artifacts/briefs/brief-nova3D-2026-08-27/brief.md
  - ../../planning-artifacts/briefs/brief-nova3D-2026-08-27/addendum.md
  - ../../planning-artifacts/prds/prd-nova3D-2026-08-27/addendum.md
---

# nova3D Build Specification

This kernel and every file in `companions:` form the complete contract. Apply the explicit precedence and workflow-mode rules in [scope-and-readiness.md](scope-and-readiness.md) when reading the adopted PRD. Josh ratified the fast-path defaults on 2026-09-14. The companion decisions close all recorded product questions; the [qualification run](../../implementation-artifacts/qualification-2026-09-14/REPORT.md) now records scoped local evidence, while every full application acceptance gate remains open.

## Why

Josh needs to turn difficult historical evidence into defensible printable models without learning manual modelling. nova3D makes the source-to-geometry reasoning, uncertainty, approval and correction history inspectable, beginning with the Middot chapter 3 outer altar and ramp plus personalization, while serving controlled private Accounts and the approved first-version picture workflows.

## Capabilities

- **CAP-1 — Controlled access and private Workspaces**
  - **intent:** Josh can invite trusted users and administer access while each Account works privately.
  - **success:** Single-use invitation races create at most one Account; cross-Account reads/writes/downloads are denied; disable/re-enable, scoped administration and verified-email recovery follow the adopted access rules.

- **CAP-2 — Permissioned spending**
  - **intent:** Accounts can choose research payment mode and Josh can control each Account's paid usage.
  - **success:** Zero paid operations start without the required Project/category/provider disclosure, permission and sufficient reservation; concurrent/replayed operations cannot exceed allowance or double-charge; uncertain costs remain reconcilable.

- **CAP-3 — Confirmed text or picture requests**
  - **intent:** Accounts can describe a model or submit images and choose direct conversion or research-assisted reconstruction.
  - **success:** The user confirms subject, scope, outcome and personalization before work; image requests support multiple views and clarity/coverage guidance; incomplete direct inputs can proceed only after an explicit uncertainty warning.

- **CAP-4 — Background work and actionable progress**
  - **intent:** Accounts can continue using Projects while work runs and receive actionable completion or failure events.
  - **success:** Accepted Jobs survive navigation/restart with isolated state; cancellation and failure preserve approved work; failures await user retry; in-app events and permitted push open the exact authorized item.

- **CAP-5 — Complete evidence research**
  - **intent:** nova3D can discover authoritative sources and prepare a complete, explainable reconstruction plan.
  - **success:** Every consequential detail has exact evidence or an explicit classification; a finite six-dimension checklist and independent omission review have no unresolved gap; source authority, alternatives and expected geometry effects are inspectable.

- **CAP-6 — Source eligibility control**
  - **intent:** Accounts can exclude a source from one Project or disable it across their Projects.
  - **success:** Active research removes excluded evidence, visibly rechecks affected conclusions and seeks replacements; completed approved records stay immutable; warning suppression cannot change provenance or exported records.

- **CAP-7 — Whole-plan approval**
  - **intent:** Accounts can choose interpretations and authorize the complete research plan before evidence-backed generation.
  - **success:** Generation is denied without approval of the exact complete plan; changed interpretations require a successor plan and renewed approval; no clear section generates early while other details remain unresolved.

- **CAP-8 — Automatic traceable geometry and personalization**
  - **intent:** nova3D can generate the approved reconstruction and plain-language personal additions without manual modelling.
  - **success:** The altar/ramp and one personalized variation generate automatically; fixed approved inputs reproduce equivalent canonical geometry under ratified tolerances; personal additions remain user-added and image-derived output never gains historical-verification status.

- **CAP-9 — Model and evidence inspection**
  - **intent:** Accounts can inspect geometry and navigate between each consequential feature and its evidence.
  - **success:** Required view/section/isolation/measurement controls work; every consequential evidence-backed feature and governing claim have reciprocal links, with no orphaned links; preview degradation preserves canonical data and provenance access.

- **CAP-10 — Focused correction and restorable versions**
  - **intent:** Accounts can correct selected features, regenerate their dependents, compare versions and restore history.
  - **success:** All affected geometry updates after the required plan approval, unrelated geometry stays within tolerance, comparisons expose geometry and provenance changes, and every non-deleted restorable version restores without erasing later history.

- **CAP-11 — Version-specific model approval**
  - **intent:** Accounts can approve or reject the exact model they inspected.
  - **success:** Export is denied without Model Approval for the exact version/content; consequential geometry or personalization changes require renewed inspection and approval, with approver/time recorded.

- **CAP-12 — Print qualification and bounded recovery**
  - **intent:** nova3D can qualify a model for the user's printer/material/size and repair blocking defects.
  - **success:** Exports pass required checks for the exact target profile; every repair is audited and consequential repairs require new approval; failed local repair permits at most one lineage-bound full regeneration or direct-image reconversion under the ratified mode-specific rules.

- **CAP-13 — Model and Source Record export**
  - **intent:** Accounts can download an approved printable model together with readable, traceable provenance.
  - **success:** Each export includes primary 3MF, optional STL and readable PDF from the same immutable provenance; feature/claim links, approvals, personalization, target profile, validation and repairs match the exported version.

- **CAP-14 — Private deletion and instance closure**
  - **intent:** Accounts can delete their Projects, Exports or Workspace, and Josh can close the instance.
  - **success:** Cloud targets become inaccessible before cleanup; late work cannot republish them; controlled backups lose private copies within 30 days; restores enforce tombstones; disconnected copies follow ratified reconnect revocation and sole-Administrator closure follows the adopted safeguards.

- **CAP-15 — Privacy-preserving research reuse**
  - **intent:** Accounts can explicitly reuse public-source research or choose fresh research.
  - **success:** Cached reuse preserves immutable revisions/original dates without implying re-verification, respects source exclusions, and exposes no requesting identity, uploads, private prompts, personalization, decisions or deleted artifacts.

- **CAP-16 — Offline direct conversion and safe sync**
  - **intent:** Accounts can create and retain image-derived models offline on supported devices and sync them later.
  - **success:** On the prepared-device qualification matrix, conversion succeeds without network services and local results remain usable; reconnection checks live authority and imports without duplicates or overwrites, locks on disable and purges learned deletions; failed/conflicting sync remains visible.

- **CAP-17 — Complete responsive, localized and accessible workflow**
  - **intent:** Accounts can use the full workflow on phones, laptops and desktops with language, theme, notification and explanation preferences.
  - **success:** Creation through downloads is available on every supported form factor; original-language evidence stays distinct from translation/explanation; RTL, keyboard/screen-reader operation, text enlargement, contrast, focus and reduced motion meet the adopted accessibility target.

## Constraints

- Preserve every PRD functional requirement, non-functional requirement and acceptance metric, subject to the explicit scope/mode and September 14 ratification overrides recorded in the companions.
- Public registration and cross-Account private access are forbidden; Administrator authority is an explicit allowlist, not permission to inspect or impersonate invited Workspaces.
- Evidence-backed generation requires complete research and exact-plan approval, followed by exact-model approval before qualified export. Direct image-derived output must never claim historically verified or deterministic evidence-backed reconstruction.
- Every consequential detail is sourced, inferred, disputed, unknown or user-added, with the required evidence or explicit uncertainty; personalization cannot inherit historical authority.
- Paid research is opt-in. Every paid-work category requires its own disclosed Project permission and enforceable reservation; unknown charges, transport duplicates and budget resets cannot bypass spending limits. Ratifying the provider/budget defaults does not grant those in-app permissions.
- Failed research/generation awaits user retry. Cancellation and stale-result rejection preserve approved state; the explicitly bounded mode-specific print-recovery path cannot reset its allowance through a new repair or validation child.
- Cloud deletion takes effect before cleanup and cannot be undone by late Jobs or restore. Controlled backup removal is bounded by 30 days. Already-local offline data follows revocation on reconnect; no disconnected erasure deadline is promised.
- The entire workflow must work on qualified phones, laptops and desktops with RTL/localization, themes and WCAG 2.2 AA. Offline direct conversion remains required; preparation and qualified export require connectivity.
- Adopt architecture AD-1–AD-19 and ratified R-1–R-11, including the React/Tailwind, Vercel, Supabase, Upstash and GitHub direction. Technical seed and measurable defaults live in the architecture and ratified-decisions companions.
- Product approval is complete for the ratified defaults. Engineering may implement and qualify them now; G-1–G-9 remain open acceptance/release checks with partial local evidence, as recorded in the readiness companion. Document approval cannot prove feasibility or silently remove first-version scope.

## Non-goals

- Manual geometry/mesh editing, guaranteed historical truth, universal manufacturability or safety certification.
- Complete Temple/utensil generation, unrelated evidence-research domains and printer connection/control/fleet operation in the first version.
- Shared Projects, real-time collaboration, teams, public sign-up, customer billing, storefronts, sales tooling and marketplaces.
- Commercial source-licensing assessment; recording provenance does not decide permission to sell a model.
- Physical print completion as a requirement for the altar/ramp integrity demonstration.

## Success signal

Josh completes the altar/ramp journey with one personalized variation: confirms scope, reviews complete source-linked options, approves the plan, inspects and corrects generated geometry, approves the final version and downloads a profile-qualified 3MF plus readable Source Record without manual modelling. The regression corpus meets the PRD's complete detail/traceability, approval, reproducibility, isolation, spending and restoration criteria.

The complete first version additionally demonstrates both picture workflows, offline direct conversion/safe sync on the ratified devices, and the full accessible/localized phone/computer workflow. Passing the altar/ramp demonstration alone does not establish readiness of all first-version capabilities.
