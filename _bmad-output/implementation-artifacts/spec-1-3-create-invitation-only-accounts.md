---
title: 'Story 1.3 (Part A: database): Create invitation-only accounts'
type: 'feature'
created: '2026-10-10'
status: 'done'
baseline_commit: 'b37d4b52e5ac1fff72b218a15df434629647e0c5'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-1-context.md'
  - '{project-root}/_bmad-output/specs/spec-nova3D-story-1-3/acceptance-criteria.md'
  - '{project-root}/_bmad-output/specs/spec-nova3D-story-1-3/implementation-constraints.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** There are no Accounts, invitations, Workspaces, rate limits or audit trail. Anyone who completes Google sign-in and is on an environment-variable list is "in", and nothing in the database can say who may register.

**Approach:** Part A builds the database half only: Accounts and Workspaces created solely by a registration function behind the service role, hashed single-use invitation codes, pre-authorized seed addresses, a Postgres rate limiter, an append-only audit family, a Before User Created hook and an audited seed command. Part B (registration screen, route gating, removing the email list) follows as a separate build.

## Boundaries & Constraints

**Always:** Consult `node_modules/next/dist/docs/` before writing Next.js code (AGENTS.md). Tables live in non-exposed schemas `identity` and `projects`; the only callable surface is schema `api`, with `EXECUTE` granted to `service_role` alone and nothing to `anon`, `authenticated` or `public`. The database never sees a raw code or client address: `lib/accounts.ts` computes HMAC-SHA256 with `INVITATION_HASH_KEY` and `RATE_LIMIT_HASH_KEY` (random, at least 32 bytes each) and passes hashes. Codes carry at least 128 bits from a CSPRNG and are shown once. Failures are generic and counted. Registration locks the `auth.users` row `FOR UPDATE`, persists the attempt time and creates Account and Workspace in one transaction; any exception rolls everything back. `identity.accounts` references `auth.users` with `ON DELETE RESTRICT`. A registration carries a command UUID: a repeat returns the original receipt and the same ID with a different payload is rejected. Audit rows are append-only (update, delete and truncate refused). Pre-authorization consumption reads email, verification and Google subject from `auth.users` and `auth.identities`, never from caller input.

**Ask First:** Changing the limits (5 failures per origin per 15 minutes, 100 per hour globally); adding Redis; enabling any non-Google provider; running the seed, pushing config or applying migrations to staging or production (Josh does that). HALT if the Before User Created hook payload cannot tell the provider and email verification apart.

**Never:** Touch `proxy.ts`, `lib/auth.ts`, `lib/auth-config.ts`, the auth callback, the login page or any route, or remove `AUTH_ALLOWED_EMAILS` (all Part B). Store a raw code or address. Require the new keys at application startup (only the seed script and `lib/accounts.ts` need them in Part A).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Concurrent redemption | one unused code, two auth users | one Account and Workspace; the other gets the generic failure | no partial Account |
| Retry | same command ID and payload | original receipt | N/A |
| Changed payload | same command ID, other code | rejected | generic |
| Bad code | invalid, used, revoked or never issued | generic failure, counted | rate limited |
| Sixth failure | one origin within 15 minutes | refused for that origin | generic |
| 101st failure | all origins within an hour | refused for everyone | generic |
| Mid-function error | exception after the code check | nothing committed, code unused | generic |
| Seeded first sign-in | pre-authorized verified Google email | Account created; Administrator subject pinned | audited |
| Subject mismatch | same email, another Google subject | refused, no Account | audited |
| Unlisted identity | verified Google, no pre-authorization, no code | no Account | N/A |
| Non-Google or unverified creation | email, phone, anonymous, unverified | hook rejects | no Auth user |
| Direct API call | `anon` or `authenticated` executes an `api` function or reads a table | denied | N/A |
| Purge race | delete of a locked identity | waits or deletes nothing | N/A |

</frozen-after-approval>

## Code Map

- `supabase/migrations/20261009120000_instance_identity.sql` -- pattern: schema, RLS on, role revokes, no policies.
- `supabase/config.toml` -- `[api] schemas` lists `lifecycle`; add `api` and the `[auth.hook.before_user_created]` entry.
- `supabase/seed.sql` -- local identity row only; leave unchanged.
- `lib/environment.ts`, `scripts/check-env.mjs`, `scripts/setup-env.mjs`, `.env*.example` -- validate key shape when present; `setup-env` generates local random keys.
- `tests/support/stack.ts`, `tests/integration/instance-identity.test.ts` -- local stack helpers and the integration pattern to follow.
- `docs/secrets.md`, `provisioning/ledger.json` -- already register the hash keys; keep names aligned.

## Tasks & Acceptance

**Execution:**
- [x] `supabase/migrations/*_accounts.sql` -- `identity` tables (accounts, invitations, preauthorizations, audit_events, rate_limit_counters, registration_commands, registration_attempts), `projects.workspaces` with `projects.provision_workspace`, append-only audit trigger, RLS on with no policies, role revokes -- AC-1 to AC-8
- [x] `supabase/migrations/*_api.sql` -- `api` functions: `register_with_code`, `consume_preauthorization`, `seed_preauthorization`, `issue_invitation`, `revoke_invitation`, `account_status`; limiter inside registration; the Before User Created hook function -- AC-1 to AC-5, AC-7
- [x] `supabase/config.toml` -- expose `api`, enable the hook -- AC-4
- [x] `lib/accounts.ts` -- code generation, HMAC helpers, client-address hashing, typed service-role calls (server-only) -- AC-3, AC-6
- [x] `scripts/seed-accounts.mjs` -- audited commands: pre-authorize `ADMINISTRATOR_EMAIL` and `SEED_ACCOUNT_EMAILS`, issue a named or general code (shown once), revoke -- AC-6, AC-7
- [x] `lib/environment.ts`, `scripts/setup-env.mjs`, `.env*.example`, `docs/auth-setup.md`, `docs/deployment-setup.md` -- optional key shape checks, local key generation, seed and hosted-setup steps -- AC-6
- [x] `tests/` -- unit (codes, HMAC, shape checks) and integration against the stack for every matrix row, including the delete race with two connections -- all Part A ACs
- [x] `_bmad-output/implementation-artifacts/deferred-work.md` -- Part B, plus hosted setup for Josh -- housekeeping

**Acceptance Criteria:**
- Given one unused invitation and concurrent registrations, when both redeem, then at most one Account and Workspace exist, retries return the original outcome, a changed payload is rejected and no partial Account exists.
- Given named and general codes, when revoked or redeemed, then only a successful general redemption retires that code and unused codes never expire.
- Given repeated invalid, used, revoked or guessed codes, when attempts continue, then failures are generic, the origin and global limits hold and no raw code or address is stored.
- Given non-Google or unverified creation, when an Auth user would be created, then the hook rejects it.
- Given a registration holding the identity lock, when a delete is attempted, then it waits or deletes nothing and the attempt time is persisted.
- Given issued codes, when inspected, then each has at least 128 bits and only its hash is stored.
- Given the seed run twice and each address presenting a first verified Google identity, when consumed, then each address has one pre-authorization and one Account, the Administrator subject is pinned, another subject is refused and unlisted identities get nothing.
- Given `anon` and `authenticated`, when they execute or read, then everything is denied.

## Spec Change Log

## Design Notes

Auth users are inserted directly in integration tests, with a Google row in `auth.identities` (`provider_id` is the subject, `identity_data.email_verified` true) and `email_confirmed_at` set; the hook function is unit-called with event JSON. Limiter windows: `floor(epoch/900)` per origin hash and `floor(epoch/3600)` for the global key, incremented in the same transaction as the check. Registration returns a receipt row keyed by command UUID. Hosted staging needs the `api` schema exposed, config pushed (Story 1.9), the migrations applied and the two keys set; Josh does these. Part B will make the keys required at startup.

## Verification

**Commands:**
- `npm run typecheck && npm run lint && npm run build` -- expected: exit 0
- `supabase start && npm test` -- expected: unit and integration pass, every matrix row covered
- `git diff --stat -- proxy.ts lib/auth.ts lib/auth-config.ts app` -- expected: empty (no route or gating change in Part A)

## Suggested Review Order

**Registration (the core idea)**

- One function creates an Account: code check, identity lock, workspace, all or nothing.
  [`api.sql:99`](../../supabase/migrations/20261010120100_api.sql#L99)

- Seeded addresses become Accounts at first verified Google sign-in; wrong subject is refused.
  [`api.sql:256`](../../supabase/migrations/20261010120100_api.sql#L256)

- "Verified Google" is read from Auth's own tables, never from the caller.
  [`api.sql:48`](../../supabase/migrations/20261010120100_api.sql#L48)

**Who can touch it**

- Tables hold nothing for browser roles; the new-function default is closed.
  [`accounts.sql:31`](../../supabase/migrations/20261010120000_accounts.sql#L31)

- Accounts reference the Auth identity so it cannot be deleted from under them.
  [`accounts.sql:38`](../../supabase/migrations/20261010120000_accounts.sql#L38)

- The audit log refuses update, delete and truncate.
  [`accounts.sql:203`](../../supabase/migrations/20261010120000_accounts.sql#L203)

- Only Google, verified, can create an Auth user; checked at creation.
  [`api.sql:612`](../../supabase/migrations/20261010120100_api.sql#L612)

- The hook is switched on in the Auth config.
  [`config.toml:75`](../../supabase/config.toml#L75)

**Codes, limits and the server helpers**

- The rate limiter's counters; the database never sees a raw code or address.
  [`accounts.sql:185`](../../supabase/migrations/20261010120000_accounts.sql#L185)

- Codes are 160 random bits; only keyed hashes leave this file.
  [`accounts.ts:53`](../../lib/accounts.ts#L53)

- Forwarded-address headers are trusted on Vercel only.
  [`accounts.ts:164`](../../lib/accounts.ts#L164)

- Registration fails closed and never counts an outage as a bad code.
  [`accounts.ts:337`](../../lib/accounts.ts#L337)

- Issuing a code: shown once, general code replaced only on request.
  [`api.sql:451`](../../supabase/migrations/20261010120100_api.sql#L451)

**Seed command**

- Audited commands to pre-authorize, issue, list and revoke; needs `--confirm` outside local.
  [`seed-accounts.mjs`](../../scripts/seed-accounts.mjs)

**Tests (supporting)**

- Every matrix row against the real local database.
  [`accounts.test.ts`](../../tests/integration/accounts.test.ts)

- Races: parallel guesses, two users, one code, delete versus registration.
  [`accounts-concurrency.test.ts`](../../tests/integration/accounts-concurrency.test.ts)

- Seed command and the `--confirm` guard.
  [`seed-accounts.test.ts`](../../tests/unit/seed-accounts.test.ts)
