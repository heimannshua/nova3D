# nova3D Story Specifications

**58 story contracts across 8 epics.** Each folder contains `SPEC.md`, `acceptance-criteria.md`, `implementation-constraints.md` and its canonical `.memlog.md`.

The specs were produced with parallel Codex agents running Luna, then checked for source preservation, capability identity, dependencies and link integrity. These are planning contracts; engineering acceptance remains governed by the dated qualification evidence.

[Epic breakdown and full requirement inventory](../planning-artifacts/epics.md) · [Project contract](spec-nova3D/SPEC.md) · [Validation report](../planning-artifacts/story-specs-validation.md)

The order below respects declared dependencies. Story boundaries are delegated fast-path planning choices; no implementation dispatch or per-story checkpoint defaults were assigned.

## Epic 1: Enter and use a private workspace

Invited users can authenticate and use a responsive private workspace; Josh can control and recover access without inspecting private content.

| Story | Specification | Depends on | Engineering gates |
| --- | --- | --- | --- |
| 1.1 | [Bootstrap the qualified application seed](spec-nova3D-story-1-1/SPEC.md) | — | Inherited |
| 1.2 | [Establish accessible localized navigation and preferences](spec-nova3D-story-1-2/SPEC.md) | 1.1 | Inherited |
| 1.3 | [Create invitation-only accounts](spec-nova3D-story-1-3/SPEC.md) | 1.1, 1.2 | Inherited |
| 1.4 | [Authenticate with live workspace isolation](spec-nova3D-story-1-4/SPEC.md) | 1.3 | Inherited |
| 1.5 | [Disable and re-enable account access](spec-nova3D-story-1-5/SPEC.md) | 1.4 | Inherited |
| 1.6 | [Recover the sole Administrator securely](spec-nova3D-story-1-6/SPEC.md) | 1.4, 1.5 | Inherited |
| 1.7 | [Navigate My Projects and project state](spec-nova3D-story-1-7/SPEC.md) | 1.2, 1.4 | Inherited |

## Epic 2: Confirm requests and control background spending

Users can submit text or ordered pictures, authorize the exact work and costs, and follow durable jobs without losing approved state.

| Story | Specification | Depends on | Engineering gates |
| --- | --- | --- | --- |
| 2.1 | [Confirm natural-language intent and personalization](spec-nova3D-story-2-1/SPEC.md) | 1.7 | Inherited |
| 2.2 | [Stage ordered multi-view images privately](spec-nova3D-story-2-2/SPEC.md) | 1.4, 1.7 | Inherited |
| 2.3 | [Choose picture mode and acknowledge uncertainty](spec-nova3D-story-2-3/SPEC.md) | 2.1, 2.2 | Inherited |
| 2.4 | [Set accountable usage limits](spec-nova3D-story-2-4/SPEC.md) | 1.5 | Inherited |
| 2.5 | [Disclose and authorize provider categories](spec-nova3D-story-2-5/SPEC.md) | 2.1, 2.3, 2.4 | G-6 |
| 2.6 | [Reserve bounded costs atomically](spec-nova3D-story-2-6/SPEC.md) | 2.4, 2.5 | G-6 |
| 2.7 | [Accept and execute durable fenced jobs](spec-nova3D-story-2-7/SPEC.md) | 1.5, 2.6 | Inherited |
| 2.8 | [Reconcile ambiguous charges without replacement calls](spec-nova3D-story-2-8/SPEC.md) | 2.6, 2.7 | G-6 |
| 2.9 | [Select research payment and freshness separately](spec-nova3D-story-2-9/SPEC.md) | 2.5, 2.7 | Inherited |
| 2.10 | [Record actionable in-app notifications](spec-nova3D-story-2-10/SPEC.md) | 2.7 | Inherited |

## Epic 3: Research and approve a complete evidence plan

Users can inspect authoritative evidence, control source eligibility, resolve interpretations and approve one complete reconstruction plan.

| Story | Specification | Depends on | Engineering gates |
| --- | --- | --- | --- |
| 3.1 | [Discover and capture licensed source revisions](spec-nova3D-story-3-1/SPEC.md) | 2.7, 2.9 | G-7 |
| 3.2 | [Control Project and Account source eligibility](spec-nova3D-story-3-2/SPEC.md) | 3.1 | Inherited |
| 3.3 | [Account for every consequential physical detail](spec-nova3D-story-3-3/SPEC.md) | 3.1, 3.2 | Inherited |
| 3.4 | [Inspect sources and choose defensible interpretations](spec-nova3D-story-3-4/SPEC.md) | 3.3 | Inherited |
| 3.5 | [Approve one complete immutable Research Plan](spec-nova3D-story-3-5/SPEC.md) | 3.3, 3.4 | Inherited |
| 3.6 | [Admit and reuse only public-source research](spec-nova3D-story-3-6/SPEC.md) | 3.1, 3.2, 3.5 | Inherited |
| 3.7 | [Show actual research activity and bounded escalation](spec-nova3D-story-3-7/SPEC.md) | 3.1, 3.5, 3.6, 2.8, 2.10 | Inherited |

## Epic 4: Generate and inspect traceable canonical geometry

Approved evidence recipes produce immutable models whose features remain linked to evidence and inspectable without changing manufacturing authority.

| Story | Specification | Depends on | Engineering gates |
| --- | --- | --- | --- |
| 4.1 | [Publish immutable artifact manifests](spec-nova3D-story-4-1/SPEC.md) | 2.2, 2.7 | Inherited |
| 4.2 | [Generate the approved altar and ramp recipe](spec-nova3D-story-4-2/SPEC.md) | 3.5, 4.1 | G-1 |
| 4.3 | [Certify corresponding geometry equivalence](spec-nova3D-story-4-3/SPEC.md) | 4.2 | G-2 |
| 4.4 | [Apply clearly user-added personalization](spec-nova3D-story-4-4/SPEC.md) | 4.2, 4.3 | Inherited |
| 4.5 | [Navigate reciprocal model and evidence links](spec-nova3D-story-4-5/SPEC.md) | 4.2, 4.4 | G-4 |
| 4.6 | [Inspect progressive read-only models](spec-nova3D-story-4-6/SPEC.md) | 4.5 | G-5 |

## Epic 5: Correct, compare and approve exact model versions

Users can request evidence corrections, regenerate only affected geometry, restore history and approve the exact model they inspected.

| Story | Specification | Depends on | Engineering gates |
| --- | --- | --- | --- |
| 5.1 | [Research a focused correction](spec-nova3D-story-5-1/SPEC.md) | 4.6, 3.7 | Inherited |
| 5.2 | [Regenerate only the affected dependency closure](spec-nova3D-story-5-2/SPEC.md) | 5.1, 4.3 | Inherited |
| 5.3 | [Compare immutable model history](spec-nova3D-story-5-3/SPEC.md) | 5.2 | Inherited |
| 5.4 | [Restore a version without silently authorizing export](spec-nova3D-story-5-4/SPEC.md) | 5.3 | Inherited |
| 5.5 | [Approve the exact inspected model](spec-nova3D-story-5-5/SPEC.md) | 4.6, 5.3 | Inherited |

## Epic 6: Qualify and export an evidence-backed printable model

An approved model can pass exact profile checks, receive bounded audited repair and be downloaded with immutable bilingual provenance.

| Story | Specification | Depends on | Engineering gates |
| --- | --- | --- | --- |
| 6.1 | [Pin the exact target print profile](spec-nova3D-story-6-1/SPEC.md) | 5.5 | G-3 |
| 6.2 | [Validate manufacturing mesh structure](spec-nova3D-story-6-2/SPEC.md) | 6.1 | G-3 |
| 6.3 | [Validate profile-specific features and support](spec-nova3D-story-6-3/SPEC.md) | 6.2 | G-3 |
| 6.4 | [Perform bounded local repair with equivalence proof](spec-nova3D-story-6-4/SPEC.md) | 6.3, 4.3 | G-3 |
| 6.5 | [Allow one lineage-bound evidence regeneration](spec-nova3D-story-6-5/SPEC.md) | 6.4, 5.2, 2.8 | G-3 |
| 6.6 | [Define and validate the shared provenance envelope](spec-nova3D-story-6-6/SPEC.md) | 4.5, 5.5, 6.5 | G-4 |
| 6.7 | [Render a readable bilingual PDF Source Record](spec-nova3D-story-6-7/SPEC.md) | 6.6 | G-4 |
| 6.8 | [Assemble qualified manufacturing exports](spec-nova3D-story-6-8/SPEC.md) | 6.3, 6.6, 6.7 | G-3, G-4 |
| 6.9 | [Stream private files with live revocation](spec-nova3D-story-6-9/SPEC.md) | 6.8, 4.1, 1.5 | Inherited |

## Epic 7: Create direct models offline and synchronize safely

Prepared supported devices can create honestly labeled image-derived models offline, preserve them locally and synchronize without privacy or history loss.

| Story | Specification | Depends on | Engineering gates |
| --- | --- | --- | --- |
| 7.1 | [Qualify a bounded multi-view reconstruction engine](spec-nova3D-story-7-1/SPEC.md) | 2.3, 4.1 | G-8 |
| 7.2 | [Prepare a verified offline bundle](spec-nova3D-story-7-2/SPEC.md) | 7.1 | G-8 |
| 7.3 | [Convert and retain image-derived models locally](spec-nova3D-story-7-3/SPEC.md) | 7.2, 2.3, 4.1, 4.6 | G-8 |
| 7.4 | [Synchronize offline drafts without overwriting history](spec-nova3D-story-7-4/SPEC.md) | 7.3, 1.4 | G-8 |
| 7.5 | [Enforce learned offline revocation before sync](spec-nova3D-story-7-5/SPEC.md) | 7.4, 1.5 | G-8 |
| 7.6 | [Qualify and recover direct models through the shared lineage](spec-nova3D-story-7-6/SPEC.md) | 7.3, 7.5, 6.5, 6.9 | G-3, G-8 |
| 7.7 | [Deliver optional private phone push](spec-nova3D-story-7-7/SPEC.md) | 2.10, 6.9 | Inherited |

## Epic 8: Delete private work and prove release readiness

Users can remove their data, Josh can close the instance, and the complete product is accepted only with real application/device and recovery evidence.

| Story | Specification | Depends on | Engineering gates |
| --- | --- | --- | --- |
| 8.1 | [Tombstone Project and Export deletion before cleanup](spec-nova3D-story-8-1/SPEC.md) | 6.9, 7.5 | G-9 |
| 8.2 | [Delete an Account or close the instance](spec-nova3D-story-8-2/SPEC.md) | 8.1, 1.6 | G-9 |
| 8.3 | [Purge private records and enforce backup expiry](spec-nova3D-story-8-3/SPEC.md) | 8.2 | G-9 |
| 8.4 | [Restore the service without resurrecting deleted data](spec-nova3D-story-8-4/SPEC.md) | 8.3 | G-9 |
| 8.5 | [Qualify the complete accessible device workflow](spec-nova3D-story-8-5/SPEC.md) | 7.6, 7.7, 8.2 | G-5 |
| 8.6 | [Qualify offline execution and authoritative sync](spec-nova3D-story-8-6/SPEC.md) | 7.6, 8.5 | G-8 |
| 8.7 | [Prove cross-provider and first-version acceptance](spec-nova3D-story-8-7/SPEC.md) | 8.4, 8.5, 8.6 | G-1, G-2, G-3, G-4, G-5, G-6, G-7, G-8, G-9 |
