---
type: ratified-implementation-decisions
status: adopted
created: 2026-09-14
updated: 2026-09-14
authority: Josh — ratify all fast path
---

# Ratified Implementation Decisions

Josh's September 14 instruction, “ratify all fast path,” adopts the existing technical proposals and delegates the remaining baseline choices recorded here. These decisions close A-1–A-3, Q-1–Q-11 and the product-approval portions of G-1–G-9 and PRD:AD-1–PRD:AD-7. They bind the architecture and spec; no further approval is required to implement these defaults.

At ratification the implementation experiments were unrun. The subsequent [qualification report](../../../implementation-artifacts/qualification-2026-09-14/REPORT.md) records local component passes and the remaining partial, blocked and unrun gates. A selected design, version or budget is an acceptance target, not evidence of working software, owned hardware or a provisioned subscription. Engineering may implement and qualify these decisions; affected capability acceptance and full release still require evidence. This approval does not replace each app user's Project/paid-work/Plan/Model approvals.

This record supersedes conflicting earlier proposed/awaiting-ratification wording. R-8 explicitly scopes remote revocation/deletion to connected, controlled copies; R-10 replaces the earlier mandatory visual-direction selection ceremony; R-11 defines direct-image recovery without inventing an evidence plan. Other adopted requirements remain binding. Historical source documents and memlogs retain their earlier wording with ratification notices.

## R-1 — Stack and canonical geometry

Resolves Q-1 / A-1 / G-1 / PRD:AD-1.

Adopt AD-1–AD-19, the modular monolith, current stack seed and CadQuery recipe/solid authority on Railway. Bootstrap locks the maintained Python 3.12 patch, OCP dependency closure and container digest and proves the altar/ramp plus personalization, cancellation and restore. Engineering may select compatible patches without another product approval; version existence is not installation or feasibility evidence.

[Existing verified stack baseline](ARCHITECTURE-SPINE.md#stack).

## R-2 — Equivalence

Resolves Q-2 / A-3 / G-2 / PRD:AD-2.

Adopt corresponding-feature topology checks, bidirectional surface distance ≤0.01 mm at final print scale, bounds delta ≤0.01 mm and relative volume delta ≤0.1%. Use a conservative distance upper bound: measured distance plus certified approximation/error bound must pass; inconclusive or tiny/zero-volume cases fail closed. Require exact feature identity, component count and closed-solid topology, and a fixed corpus including deliberate dimensional, thin-feature, hole, unit and scale failures. No physical printer accuracy is implied.

R-2/R-3 geometry comparison: compare canonical content in millimetres after the same pinned final-print scale/orientation transform; both sides use the original validation-lineage target-profile/transform revision, never independent best-fit/rescaling. Correspond corresponding semantic features under the same tessellator/settings and comparator/error-bound version; prohibit preview LOD as comparison authority. Volume delta denominator is the reference feature's absolute volume; zero/ill-conditioned feature volume is unknown/blocking. Nonconsequential equivalence proves canonical-to-repaired artifact under that same frame. G-2 includes rotations, unit scale and tiny-feature failures.

## R-3 — Print qualification

Resolves Q-3 / G-3 / PRD:AD-3.

Adopt Bambu PLA Silk+ Gold, A1 mini 0.4 mm nozzle, ≤90 mm cube, 0.20 mm layers and three perimeters; inherit Bambu PLA Silk+ @BBL A1M manufacturer's profile and pin its full inheritance closure at qualification. Initial product validation thresholds: wall ≥1.2 mm, isolated feature ≥0.8 mm, mating clearance ≥0.4 mm, raised/recessed relief ≥0.6 mm. Unsupported overhang >45° from vertical or bridge >5 mm requires verified support/slicing analysis; unknown required checks block export. These are engineering acceptance values requiring fixture evidence, not manufacturer guarantees. Nonconsequential repairs are limited to normals/winding, duplicate or zero-area face removal and vertex welding only if R-2 proves topology/geometry unchanged; hole filling, remeshing, thickening and dimension changes are consequential.

[Manufacturer A1 mini Silk+ profile](https://github.com/bambulab/BambuStudio/blob/master/resources/profiles/BBL/filament/Bambu%20PLA%20Silk%2B%20%40BBL%20A1M.json). Record its commit and inherited profile digests in the qualified profile; do not track `master` at runtime.

## R-4 — Provenance and PDF

Resolves Q-4 / G-4 / PRD:AD-4.

Adopt provenance schema 1.0.0 expressed in JSON Schema Draft 2020-12, one shared contract generating TypeScript/Python validation, and Playwright 1.63.0 bundled Chromium PDF rendering in the container. Bundle Noto Sans and Noto Sans Hebrew with license files; pin font digests. Render escaped immutable evidence with no remote resources or script execution. Bilingual reading order, glyphs, reciprocal links, pagination and zero orphan links require fixture verification.

[JSON Schema specification](https://json-schema.org/draft/2020-12), [Playwright PDF API](https://playwright.dev/docs/api/class-page#page-pdf), [Playwright version](https://registry.npmjs.org/playwright/1.63.0), [Noto Hebrew font source](https://github.com/notofonts/hebrew).

## R-5 — Supported-device qualification

Resolves Q-5 / A-3 / G-5 / PRD:AD-5.

Adopt current and previous stable desktop Chrome/Edge/Firefox, macOS/iOS Safari and Android Chrome. Qualification devices: MacBook Air M2 with 16 GB, Windows 11 Intel i5-1235U/Iris Xe laptop with 16 GB, iPhone 16 Pro and Pixel 9 Pro; these are test targets, not claims of owned or supported hardware. Freeze exact OS/browser builds in each report. Viewer maximum fixture 100,000 preview triangles, initial GLB ≤20 MB, ≤5 s interactive at 20 Mbps and p95 frame time ≤33 ms after load. Keep feature-map, accessibility and GPU-loss checks. For the 5 s target progressively load a coarse ≤5 MB first-view derivative; the 20 MB cap covers the full initial-detail set, not a single blocking download.

R-5 viewer timing: measure open-to-interactive from the user's model-open action, including transfer/decoding of required viewer code and the first-view derivative on a cold model cache at shaped 20 Mbps. First view means working orbit plus selected-feature/evidence navigation; load <=5 MB coarse geometry within the adopted 5-second total budget and full initial details <=20 MB progressively. Both derivatives carry version-compatible semantic feature maps; switch atomically without losing selection/provenance. The geometry budgets alone do not prove the latency target. G-5 measures code/network/decode/render together.

## R-6 — Providers, permissions and costs

Resolves Q-6 / G-6 / PRD:AD-6.

Select Anthropic Messages API claude-sonnet-5 for paid evidence synthesis/vision and Brave Web Search v1 for optional paid discovery; no paid third-party 3D provider. Use USD integer microdollars, default UTC-calendar-month limits $25/invitee and $50/Administrator, $5 research Job maximum cumulative across retries and $1 maximum per external operation. Each request preflights capped input/output tokens or bounded search-call count against a versioned rate snapshot, with atomic reservations; request-cost upper bounds must fit every remaining ceiling. Default permissions are off; research search and synthesis/vision are separate disclosed categories. Fixed managed hosting, storage, own-worker compute and local inference are instance overhead, outside personal paid-research allowance; free-only cannot call a metered AI/search endpoint even if it has promotional credits. Disable provider SDK automatic retries. Ambiguous calls hold their full reservation until matching usage evidence, conservative maximum settlement, or documented noncharge; no duplicate request is sent. Search sends normalized public subjects only, never private uploads, names, personalization or raw prompts. Anthropic receives only purpose-required selected content after data-category/retention disclosure; use stateless Messages, no Files/Batch/Managed Agents storage. Provider retention exceptions are disclosed and are outside controlled-backup deletion guarantees; unknown account terms block enablement. This ratifies product defaults, not live account spending or credentials.

[Anthropic model IDs](https://platform.claude.com/docs/en/models/overview), [pricing](https://platform.claude.com/docs/en/about-claude/pricing) and [retention](https://platform.claude.com/docs/en/manage-claude/api-and-data-retention); [Brave Search pricing](https://brave.com/search/api/) and [API privacy policy](https://api-dashboard.search.brave.com/privacy-policy). Brave documents query-log retention up to 90 days; Anthropic retention depends on the actual arrangement/features, with flagged-content/legal-hold exceptions. Pin the API version, returned model identity and rate schedule in each operation receipt; model aliases do not establish deterministic generation.

R-6/AD-11 arithmetic: use checked integer USD microdollars and rational rates, never binary floats. One Usage-owned calculator sums all billable components under the operation's immutable rate/model/options snapshot, applies provider billing increments, and rounds upward once per operation to a microdollar; reservation uses the provable maximum of those components. Reject overflow, missing/foreign-currency rates and unsupported request parameters. All outstanding reservations, actual settlements and conservative maximum settlements count atomically against Account-period, parent-Job lifetime $5, and operation $1 limits; all attempts share that Job aggregate across resets. Conservative settlement retains its classification and maximum; later evidence appends a correcting ledger entry, never rewrites history. No new charge for reconciliation. G-6 tests concurrent attempt/admission, boundary rounding and ambiguous settlements.

## R-7 — Source editions and retention

Resolves Q-7 / G-7 / PRD:AD-7.

Select Middot chapter 3 Hebrew Torat Emet 357 and English Mishnah Yomit by Dr. Joshua Kulp as the initial acquisition editions. Sefaria API metadata currently reports Public Domain and CC-BY respectively; capture exact metadata, attribution, source URL, license identifier/link, retrieved passage and digest before retaining bodies. Edition metadata must substantiate permitted retention and attribution; ambiguous/missing license details block body storage until verified. Public Domain, CC0 and verified CC-BY records with preserved attribution may enter the source allowlist; no generalized permission inferred from citation, public availability or search snippets. Unknown/restricted sources retain metadata and digest only and cannot substantiate approved claims without inspectable authorized evidence. Public approved revisions may persist while licensed; private associations follow deletion. Historical unit/interpretation choices still require each Project's Plan Approval.

[Sefaria edition response](https://www.sefaria.org/api/v3/texts/Mishnah_Middot.3?version=primary&version=translation), [Sefaria API metadata guide](https://developers.sefaria.org/reference/tutorial-dvar-torah-outliner). Metadata is evidence to verify for the exact captured edition, not a blanket grant over linked content.

## R-8 — Offline execution and authority

Resolves Q-8 / A-2 / G-8.

Adopt online preparation and online qualified export, plus revocation on reconnect for prepared offline direct conversion. Already-local private drafts remain usable while disconnected with no time lease; remote disable/deletion cannot erase them before contact. On contact, check authority before sync, lock on disable and purge on learned Account/Project deletion; explicit sign-out clears private stores. Network/auth uncertainty retains local work; do not unlock a previously learned disable without authoritative re-enable. Cloud access revokes immediately; the 30-day controlled-backup limit excludes disconnected devices and user-downloaded files. Make this limitation clear during offline preparation. Select ONNX Runtime Web 1.29.0 as first browser backend with supported WebGPU or WASM execution. Engineering is delegated model/weights selection, digest/license pinning and browser-compatible adaptation under unchanged multi-view/phone/offline quality scope; no model is claimed proven. Qualification targets ≤500 MiB preparation download, ≤1 GiB working memory and ≤120 s local conversion on R-5 devices, with held-out multi-view shape/coverage checks, eviction and interruption tests. A missing compliant engine remains release-blocking; it is not another permission question or authority to drop phone/multi-view requirements.

[ONNX browser execution and operator support](https://onnxruntime.ai/docs/tutorials/web/), [runtime version](https://registry.npmjs.org/onnxruntime-web/1.29.0), [browser large-model limits](https://onnxruntime.ai/docs/tutorials/web/large-models.html). Backend availability does not establish that suitable reconstruction weights run on the target devices.

R-8/AD-16 local state: permitted_local, locked_disabled and tombstoned. Fresh server-authorized Account and Project status is checked before each reconnect sync or qualified export; only a newer live authorization epoch for the original Account may transition locked_disabled to permitted_local. JWT refresh, successful connectivity or account switching cannot unlock it. Learned tombstones are terminal for their IDs and purge pending commands/files; older status responses cannot downgrade known disable/deletion revisions. Never interpret timeout as tombstone. Local status is not server authority.

## R-9 — Deployment and recovery

Resolves Q-9 / A-3 / G-9.

Adopt US East primary layout: Vercel iad1, Supabase us-east-1 and Railway Virginia us-east4-eqdc4a; use nearest available Upstash primary and record actual topology. Select the smallest paid production tiers meeting required runtime, backup and recovery capabilities, with separate staging; engineering records exact plans/resources before provisioning acceptance. No private residency promise extends to global orchestration/AI/search. Active purge ≤24 h; controlled private backups ≤30 days after deletion; daily database and independent object backup, RPO ≤24 h and RTO ≤24 h, restore exclusion ledger replayed before access. Expiry must be measured from deletion, not extended by restoration/rebackup. Restore drills and actual plan settings remain unverified. This documentation work provisions no service.

[Vercel regions](https://vercel.com/docs/regions), [Supabase regions](https://supabase.com/docs/guides/platform/regions), [Railway regions](https://docs.railway.com/deployments/regions), [Supabase backup scope](https://supabase.com/docs/guides/platform/backups). Exact Upstash placement and account-tier capabilities are bootstrap evidence, not claimed provisioned facts.

## R-10 — Visual direction

Resolves Q-10 / UX.

Select a calm light workspace with neutral surfaces, slate text, indigo primary actions, semantic evidence badges and an explicit dark option. Desktop uses a model viewport with evidence inspector; phones use stacked panels/drawers exposing every workflow control. Preserve RTL and WCAG 2.2 AA. Fast-path delegation supersedes the requirement to pause for alternative visual-direction selection or a specific external design-tool handoff. UX may complete the full authentication/admin/intake/research/jobs/model/correction/version/validation/export/settings responsive designs under this baseline; existing draft mockups are not retroactively marked produced, approved or tested.

## R-11 — Direct-image recovery

Resolves Q-11 / G-3 / G-8.

For direct-image failed local repair, allow at most one full reconversion in the same immutable validation lineage, using pinned ordered original images, confirmed scope, original validated inference bundle and explicit failed print constraints. Pin a new settings digest; if the engine cannot accept and satisfy the constraints, stop with an actionable failure. Create a successor Model Version, preserve the original and require inspection, exact-version Model Approval and full validation. Never invent a Research Plan for direct mode. A new validation record, worker retry or repair child cannot reset the consumed lineage allowance; ordinary failures still require user retry and all billable exceptions obey R-6. Evidence-backed regeneration retains exact-plan approval.

R-11/AD-8 bounded recovery: Manufacturing owns one immutable validation-lineage ID inherited by all repaired/regenerated versions, validations and Job attempts. A database-unique (lineage_id, full_regeneration) slot is atomically consumed with the successor Job/outbox and any initial cost reservation before dispatch; duplicate triggers return the same receipt. Once consumed, failure, cancellation, ambiguous charge, a new child/version/validation, or user retry cannot rearm it. User may explicitly start a separate modelling request with fresh inputs/scope/approvals, never implicitly reset the existing lineage. G-3/G-8 test simultaneous triggers and failed dispatch/retry.

## Verification ownership and acceptance

Architecture/engineering owns G-1/G-2/G-4; manufacturing engineering owns G-3; frontend/UX owns G-5; provider integration owns G-6; evidence ingestion owns G-7; offline engineering owns G-8; operations owns G-9. These are roles for implementation, not claims of assigned staff.

| Gate | Adopted baseline | Status | Evidence and remaining work | Affected capabilities |
| --- | --- | --- | --- | --- |
| G-1 | R-1 | PARTIAL | Synthetic native generation/correction/restore/cancellation passed. Complete the approved corpus and deployed application worker. | CAP-8, CAP-10; geometry in CAP-3/CAP-12 |
| G-2 | R-2 | PARTIAL | Coarse comparisons passed. Certified surface-distance/error bounds and final-print correspondence remain unimplemented. | CAP-8, CAP-10, CAP-12 |
| G-3 | R-3, R-11 | PARTIAL | Profile closure, three-perimeter override, fixtures and one BambuStudio slice passed. General validation/support, repair and lineage integration remain unimplemented. | CAP-12, CAP-13 |
| G-4 | R-4 | NOT RUN | Cross-runtime schema, linked immutable export and bilingual PDF remain unrun. | CAP-9, CAP-13 and provenance consumers |
| G-5 | R-5, R-10 | BLOCKED | Headless Linux API/storage probes passed. Real named devices, viewer timing, accessibility and GPU-loss recovery remain unqualified. | CAP-9, CAP-10, CAP-11, CAP-17 |
| G-6 | R-6 | PARTIAL | Local integer budget/concurrency probes passed. Provider terms, permission enforcement and ambiguous-charge reconciliation remain unqualified. | CAP-2 and every billable operation |
| G-7 | R-7 | NOT RUN | Exact edition/rights ingestion and permitted retention paths remain unrun. | CAP-5, CAP-6, CAP-13, CAP-15 |
| G-8 | R-8, R-11 | BLOCKED | Storage/runtime primitives passed. No reviewed reconstruction model meets the adopted phone target; offline inference, device quality and authoritative sync remain unqualified. | CAP-16 and offline CAP-1/CAP-3/CAP-8/CAP-14/CAP-17 |
| G-9 | R-9 | PARTIAL | Local database/object restore with intervening deletion passed. Full app/cloud restore, live fencing, retention and RPO/RTO remain unqualified. | All production private-data capabilities |

Implementing these checks and prototypes may proceed now. A failing check triggers correction or an explicit recorded design change; it cannot be silently bypassed. Runtime/model compatibility selection is delegated under the adopted contracts. Dropping required offline/phone/multi-view scope, widening private-data sharing or weakening approval/deletion guarantees is a product change, outside that delegation. Final UX layouts require implementation review against R-10 and the full UX contract; no uncreated mockups are approved by this record.
