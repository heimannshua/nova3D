# Acceptance Criteria

**Story 1.10: Provision external accounts, credentials and spend limits**

**Epic 1: Enter and use a private workspace.** Invited users can authenticate and use a responsive private workspace; Josh can control and recover access without inspecting private content.

As an Administrator,
I want to have every external account, credential and spend limit created, recorded and checked for each environment,
So that no later story stalls on an account only I can create.

**Requirement IDs:** AR-17, AR-26, NFR-2, NFR-9

## Dependencies

- [1.1](../spec-nova3D-story-1-1/SPEC.md)

## Scope

- Record, in a committed provisioning ledger (`docs/provisioning.md`, never a secret value), every external service the Spine names: owner, plan and tier, region, spend backstop, the story that first needs it, the secret names for each environment, and the free-tier limits the design relies on (Vercel 4.5 MB bodies and Hobby terms, Upstash and QStash quotas including the periodic-message budget, Railway's monthly credit shared by the CAD worker, engine worker, gateway and backup service) with the trigger for upgrading.
- Record an internal-secrets register in `docs/secrets.md` (names and purposes, never values): the rate-limiter keyed-hash secret, the invitation and recovery hashing keys, the service-signing and transfer-ticket keys and the age public key. For each: owner, how it is generated, where it lives in each environment, and its rotation procedure and cadence (yearly, and at once on suspected compromise).
- Do the tasks only Josh can do, each tagged with the story that first needs it so none blocks earlier work than it must. Before Story 1.3: one Google OAuth client per environment with exact redirect URIs and the consent screen set to In production (Testing mode silently allowlists and expires grants). Before Story 1.6: a Resend account registered with the Administrator address, and its API key. Before Story 1.9: the Supabase organization plan (Pro, since a Free project pauses) with the existing project's status and region, the Vercel plan (Hobby only for non-commercial use) and the staging Vercel project, and the Upstash and Railway accounts. Before Story 2.5: an Anthropic workspace with a dedicated spend limit and its API key (noting whether an organization Admin key exists), and a Brave account with prepaid credit and no auto-recharge. Before Story 7.2: the choice and creation of the public model-asset bucket. Before Story 7.7: a VAPID key pair per environment. Before Story 8.9: a Backblaze account with a backup bucket per environment in US East, a separate ledger bucket, a read-only manifest key, and the age key pair (the private key only in the Administrator's password manager). Before the first Story 8.4 drill: permission to create and delete a restore project.
- Add `scripts/check-provisioning.mjs --story <id>`, which reports for one environment which items due by that story are present, names each missing one and the story that needs it, and never prints a value. Record the Brave terms review (section 3(b) bars storing or caching results) in the ledger before Story 2.5 may enable that adapter.

## Acceptance Criteria

### AC-1

**Given** the Spine's list of external services
**When** the provisioning ledger is reviewed
**Then** each service names an owner, plan, region, spend backstop, first-needed story and per-environment secret names, and the free-tier limits relied on are recorded with the trigger for upgrading

### AC-2

**Given** an environment and a story ID
**When** `check-provisioning --story <id>` runs
**Then** it fails naming each missing item due by that story, passes when they are all present, ignores items due later, and never prints a secret value

### AC-3

**Given** the Google consent screen, the Anthropic and Brave spend limits and the Supabase plan
**When** the Administrator records them
**Then** the ledger holds a dated evidence entry for each (console exports kept outside the repository and referenced by name), and the Brave adapter stays disabled until the terms-review entry exists

### AC-4

**Given** the internal-secrets register
**When** it is reviewed
**Then** every internal secret has an owner, generation method, per-environment location, rotation procedure and cadence, and none appears in the repository

## Engineering Gates

This story has no separate gate ID; applicable project-wide gates still govern acceptance.

These are acceptance obligations, not claims that the implementation or qualification has passed.
