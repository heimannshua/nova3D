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

- Record, in a committed provisioning ledger (`docs/provisioning.md`, never a secret value), every external service the Spine names: owner, plan and tier, region, spend backstop, the story that needs it first, the secret names for each environment, and the free-tier limits the design relies on (Vercel 4.5 MB bodies and Hobby terms, Upstash and QStash quotas, Railway's monthly credit shared by the engine, gateway and backup services) with the trigger for upgrading.
- Do the tasks only Josh can do: one Google OAuth client per environment (local, staging, production) with exact redirect URIs and the consent screen set to In production, because Testing mode silently allowlists and expires grants; the Supabase organization plan (Pro before Story 1.9, since a Free project pauses) and the existing project's status and region; an Anthropic workspace with a dedicated spend limit, its API key, and whether an organization Admin key exists; a Brave account with prepaid credit and no auto-recharge; a Resend account registered with the Administrator address and its API key; the Vercel plan (Hobby only for non-commercial use, otherwise Pro) and the staging project; Upstash, Railway and Backblaze accounts with the two US East buckets that Stories 1.8 and 8.9 use; and a VAPID key pair per environment.
- Add `scripts/check-provisioning.mjs`, which reports for one environment which required secrets and settings are present, names the story that needs each missing one and never prints a value. Record the Brave terms review (section 3(b) bars storing or caching results) in the ledger before Story 2.5 may enable that adapter.

## Acceptance Criteria

### AC-1

**Given** the Spine's list of external services
**When** the provisioning ledger is reviewed
**Then** each service names an owner, plan, region, spend backstop, first-needed story and per-environment secret names, and the free-tier limits relied on are recorded with the trigger for upgrading

### AC-2

**Given** an environment and a story that needs a credential
**When** `check-provisioning` runs
**Then** it fails naming the missing item and the story that needs it, passes when everything is present and never prints a secret value

### AC-3

**Given** the Google consent screen, the Anthropic and Brave spend limits and the Supabase plan
**When** the Administrator records them
**Then** the ledger holds a dated evidence entry for each (console exports kept outside the repository and referenced by name), and the Brave adapter stays disabled until the terms-review entry exists

## Engineering Gates

This story has no separate gate ID; applicable project-wide gates still govern acceptance.

These are acceptance obligations, not claims that the implementation or qualification has passed.
