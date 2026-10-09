---
title: 'Story 1.10: Provision external accounts, credentials and spend limits'
type: 'feature'
created: '2026-10-09'
status: 'done'
baseline_commit: 'b50dd5d1c48fbf2c0b3392fe8189701b8696ddb7'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-1-context.md'
  - '{project-root}/_bmad-output/specs/spec-nova3D-story-1-10/acceptance-criteria.md'
  - '{project-root}/_bmad-output/specs/spec-nova3D-story-1-10/implementation-constraints.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Many later stories need accounts, keys and spend limits that only Josh can create, and nothing records who owns them, when each is due, or whether it exists. Builds would stall on a missing key or run without a spend backstop.

**Approach:** Add a machine-readable provisioning ledger with a per-story checker, a rendered guide, and an internal-secrets register. Items are `pending` until Josh attests or the secret is present; no account is created and no value is stored.

## Boundaries & Constraints

**Always:** The ledger holds names, dates and evidence references, never a secret value. Due-by order follows the build order in `_bmad-output/implementation-artifacts/sprint-status.yaml`, not numeric story order. A due-by story includes itself. The checker prints item IDs and variable names only. Reuse `lib/environment.ts` placeholder detection; run `.mjs` scripts through Node type stripping as `check-env` does.

**Ask First:** Recording any attestation (a dated evidence entry) needs Josh's real evidence; HALT rather than invent one. Any call to an external service, or creating an account, is Josh's.

**Never:** Create accounts, call providers, or commit a key, token, password or private key (including the age private key and test keys). Add runtime application code. Treat a pending item as passed.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| All due items present | `--story 1-4 --env staging`, every item due by then satisfied | Lists items as present, exit 0 | N/A |
| Missing secret | variable unset or placeholder | Names the item, its story and variable name, exit 1 | Value never printed |
| Item due later | due after the checked story in build order | Ignored | N/A |
| Attestation | no dated evidence for that environment | Missing | Exit 1 |
| Bad evidence | malformed or future date, no reference name | Invalid, treated as missing | Exit 1 |
| Unknown story or env | not in build order or ledger | Usage error | Exit 2 |
| Build order, not numeric | `--story 1-3` and an item due `1-10` (built before 1-3) or `1-4` (built after) | `1-10` is included, `1-4` is ignored | Exit 2 if `sprint-status.yaml` is unreadable |

</frozen-after-approval>

## Code Map

- `lib/environment.ts` -- `Env` type and the placeholder pattern to reuse (add an exported helper).
- `scripts/check-env.mjs` -- model for a type-stripped `.mjs` CLI: flags, exit codes, no secret output.
- `_bmad-output/implementation-artifacts/sprint-status.yaml` -- `development_status` key order is the build order.
- `scripts/ci/check-repository.mjs` -- Markdown link check list; add the new docs.
- `package.json`, `.github/workflows/ci.yml` -- add `check:provisioning` and `render:provisioning` scripts and a CI step.
- `tests/unit/` -- Vitest `unit` project (`vitest.config.ts`); add the new tests here.
- `docs/deployment-setup.md`, `README.md` -- link the new guide and register.
- `_bmad-output/planning-artifacts/architecture/architecture-nova3D-2026-09-14/ARCHITECTURE-SPINE.md` (Stack table, R-9, R-12) -- source for the services, tiers and limits recorded.

## Tasks & Acceptance

**Execution:**
- [x] `lib/provisioning.ts` -- ledger types, validation, build-order loader, due-by selection, item checks (pure functions) -- AC-1, AC-2
- [x] `provisioning/ledger.json` -- every external service in the Spine and the Story 1.10 task list: owner, plan, region, spend backstop, first-needed story, per-environment secret names, verification kind, free-tier limits with upgrade triggers; all items pending -- AC-1, AC-3
- [x] `scripts/check-provisioning.mjs` -- `--story <id> [--env <name>]`; `secret-present` items read `process.env`, `attestation` items need a dated evidence entry with a reference name -- AC-2, AC-3
- [x] `scripts/render-provisioning.mjs`, `docs/provisioning.md` -- render the ledger to a guide with how-to steps; `--check` fails on drift -- AC-1
- [x] `docs/secrets.md` -- register of internal secrets: owner, generation, per-environment location, rotation procedure and cadence -- AC-4
- [x] `tests/unit/provisioning.test.ts` -- ledger validity, every matrix row, register completeness, a secret-pattern scan of tracked files -- AC-1 to AC-4
- [x] `package.json`, `.github/workflows/ci.yml`, `scripts/ci/check-repository.mjs`, `README.md`, `docs/deployment-setup.md` -- scripts, CI step, link checks, pointers -- AC-1

**Acceptance Criteria:**
- Given the ledger, when reviewed, then each service names an owner, plan, region, spend backstop, first-needed story, verification kind and per-environment secret names, with its relied-on free-tier limits and upgrade trigger.
- Given an environment and a story, when `check-provisioning --story <id>` runs, then it fails naming each missing item due by that story, ignores later items, and never prints a value.
- Given an attestation, when its due story is reached, then it passes only with a dated evidence entry that names an off-repository export.
- Given the register, when reviewed, then every internal secret has all five fields and no secret value appears in tracked files.

## Spec Change Log

## Design Notes

Ledger item shape: `{id, service, kind: "secret-present"|"attestation", due: "1-3", environments: ["staging","production"], secrets: ["GOOGLE_CLIENT_ID"], howto, evidence: {staging: {date: "2026-10-09", ref: "console-export-name"}}}`. Hosted-only secrets (Vercel, Railway, GitHub environments) are attestations; `secret-present` suits what the process environment holds (`node --env-file=.env.staging scripts/check-provisioning.mjs ...`). Seed the ledger from the Story 1.10 task list: Google OAuth per environment (1-3), staging Vercel project, Supabase Pro and access token (1-4), Resend (1-6), Upstash and Railway, GHCR and Railway tokens (1-9), Anthropic and Brave with spend limits and the Brave terms review (2-5), Stripe, Vercel Pro and terms text (2-16), public asset bucket (7-2), VAPID (7-7), Backblaze buckets, keys and the age key pair (8-9), restore project (8-4).

## Verification

**Commands:**
- `npm run typecheck && npm run lint` -- expected: exit 0
- `npm run test:unit` -- expected: all provisioning tests pass
- `node scripts/render-provisioning.mjs --check && node scripts/check-provisioning.mjs --story 1-3 --env staging` -- expected: render check passes; the checker exits 1 listing pending items, no values

## Suggested Review Order

**The ledger (what must exist, and when)**

- Every outside service with owner, plan, region and spend backstop; nothing is recorded yet.
  [`ledger.json:5`](../../provisioning/ledger.json#L5)

- The 40 items, each tagged with the story that first needs it.
  [`ledger.json:198`](../../provisioning/ledger.json#L198)

**The checker (how "missing" is decided)**

- Due-by selection follows the build order in sprint-status, not story numbers.
  [`provisioning.ts:279`](../../lib/provisioning.ts#L279)

- Attestations need dated evidence that names an export kept outside the repo.
  [`provisioning.ts:312`](../../lib/provisioning.ts#L312)

- One item check: key variables by presence, or the evidence entry.
  [`provisioning.ts:325`](../../lib/provisioning.ts#L325)

- The ledger validator rejects production keys held in files and broken text.
  [`provisioning.ts:140`](../../lib/provisioning.ts#L140)

- The command-line tool: names only, never values, never echoes odd arguments.
  [`check-provisioning.mjs`](../../scripts/check-provisioning.mjs)

**The guides**

- The step-by-step guide is rendered from the ledger so it cannot drift.
  [`provisioning.ts:420`](../../lib/provisioning.ts#L420)

- The register of the app's own secrets: owner, creation, location, rotation.
  [`secrets.md:19`](../../docs/secrets.md#L19)

**Wiring and tests (supporting)**

- CI fails if the generated guide is out of date.
  [`ci.yml:40`](../../.github/workflows/ci.yml#L40)

- Every matrix row, the register check and a scan for stray keys in tracked files.
  [`provisioning.test.ts`](../../tests/unit/provisioning.test.ts)
