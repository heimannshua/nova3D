
- source_spec: `_bmad-output/implementation-artifacts/spec-architecture-qualification.md`
  summary: Qualify application support/overhang/bridge behavior and invalid geometry through the selected slicer.
  evidence: Blind review finding 10; only one positive box was sliced, and no general nova3D print validator exists.
  mapped_story: 6.3 (general feature and support validation).

- source_spec: `_bmad-output/implementation-artifacts/spec-architecture-qualification.md`
  summary: Exercise cross-store deletion crash/resume windows in the implemented recovery service.
  evidence: Blind review finding 19; local rollback and ledger replay do not test interruption between database commit, object deletion and ledger completion.
  mapped_story: 8.1 AC-3 and 8.4 AC-2 (interrupted multi-store cleanup and recovery).
- source_spec: `_bmad-output/implementation-artifacts/spec-mock-first-vercel-supabase-deployment.md`
  summary: Restore the existing Supabase project and activate Google sign-in for the two approved email identities.
  evidence: The project is INACTIVE and the installed CLI has no restore subcommand; the documented Management API restore attempt returned HTTP 401 because no SUPABASE_ACCESS_TOKEN is available in this environment.
  status: believed resolved (2026-10-08, unverified by the planning run): later commits (1606107, f8c2e90) and spec-google-sign-in.md show Google sign-in working against the project, and Josh reports its sign-up setting as On. Confirm when Story 1.1 re-labels it staging.

- source_spec: `_bmad-output/implementation-artifacts/spec-1-1-adopt-and-harden-the-qualified-application-seed.md`
  summary: Build the local Google OIDC stand-in that lets Playwright sign in against the Supabase CLI stack and issues the `amr` `oauth` entries that step-up checks read.
  evidence: Browser flows added in Story 1.1 cover only the signed-out surface (login page, redirect, health). Hosted-Auth behavior is verified only on staging.
  mapped_story: 1.3 (registration needs a signed-in browser flow; first consumer) and 1.4 (session grants and step-up read the `amr` `oauth` entries).

- source_spec: `_bmad-output/implementation-artifacts/spec-1-1-adopt-and-harden-the-qualified-application-seed.md`
  summary: Build a QStash fake that implements the schedule-and-publish port, including provider-native signature verification, for the signed route framework and the periodic tasks.
  evidence: Story 1.1 ships Vitest and Playwright runners against the Supabase CLI stack with Inbucket for mail (already part of the stack), and no fake for a port that no story has defined yet. The schedule registry and signed routes that define the port are created by Story 1.9.
  mapped_story: 1.9 (schedule registry, signed route framework, first periodic tasks).

- source_spec: `_bmad-output/implementation-artifacts/spec-1-1-adopt-and-harden-the-qualified-application-seed.md`
  summary: Build a Backblaze fake for the restore-ledger bucket (hash-chained keys, no-delete application key) so the ledger relay retry can be tested without the provider.
  evidence: Story 1.1 ships Vitest and Playwright runners against the Supabase CLI stack with Inbucket for mail (already part of the stack), and no fake for a port that no story has defined yet. Story 1.8 defines the ledger port and relay; Story 1.9 runs the relay retry on a schedule; the real Backblaze adapter is Story 8.9.
  mapped_story: 1.9 (first story that runs the ledger relay retry on a schedule); the fake moves with the port defined in 1.8 and is reused by 8.9.

- source_spec: `_bmad-output/implementation-artifacts/spec-1-1-adopt-and-harden-the-qualified-application-seed.md`
  summary: Build fakes for the Railway workers (worker registration, lease renewal, fenced steps and cancellation) used by durable job tests.
  evidence: Story 1.1 ships Vitest and Playwright runners against the Supabase CLI stack with Inbucket for mail (already part of the stack), and no fake for a port that no story has defined yet. Story 2.7 creates the worker registry and the signed bounded step contract.
  mapped_story: 2.7 (durable fenced jobs and compatible worker registration).

- source_spec: `_bmad-output/implementation-artifacts/spec-1-1-adopt-and-harden-the-qualified-application-seed.md`
  summary: Build a Resend fake (application mailer port, captured in Inbucket or in memory) and a Stripe fake (or Stripe CLI webhook forwarding) for the local stack.
  evidence: Story 1.1 ships Vitest and Playwright runners against the Supabase CLI stack with Inbucket for mail (already part of the stack), and no fake for a port that no story has defined yet. The first application mail is the Administrator recovery link (Story 1.6) and the alarm email (Story 1.13); Stripe checkout is Story 2.16. None of 1.3, 1.4, 1.9 or 2.7 sends application mail or takes payment.
  mapped_story: 1.6 and 1.13 (Resend mailer port); 2.16 (Stripe test-mode checkout and webhooks).

- source_spec: `_bmad-output/implementation-artifacts/spec-1-1-adopt-and-harden-the-qualified-application-seed.md`
  summary: Declare the staging and production `[remotes]` overrides for `supabase/config.toml` (site URL, redirect URLs) before the first `supabase config push`.
  evidence: The file's `site_url` and `additional_redirect_urls` are the local stack's. Pushing it unchanged to a hosted project would replace its callbacks with loopback URLs. Story 1.1 declares the settings and documents the dashboard values; it does not push them.
  mapped_story: 1.9 (push the declared auth settings with the CLI and diff them against live settings in CI).

- source_spec: `_bmad-output/implementation-artifacts/spec-1-1-adopt-and-harden-the-qualified-application-seed.md`
  summary: Protect the `staging` branch and gate promotion to it on CI passing. Owner: Josh (GitHub branch protection or a ruleset on `staging`: no force pushes, no deletion, required `CI / Baseline checks` status).
  evidence: `vercel.json` makes `staging` the only branch that builds, and promotion is `git push origin main:staging`. Nothing prevents a force push or a push of a commit CI has not passed, and a bad commit on `staging` deploys to the staging project. Branch settings are Josh's, so Story 1.1 documents the flow but changes nothing on GitHub.
  mapped_story: 1.9 (staging provisioning and the migration and deploy pipeline that runs when the `staging` branch deploys).

- source_spec: `_bmad-output/implementation-artifacts/spec-1-1-adopt-and-harden-the-qualified-application-seed.md`
  summary: Confirm that the hosted Auth session time-box (30 days), the inactivity timeout (7 days) and the 100MiB Storage file-size limit are available on the Supabase plan in use; they may need a paid plan.
  evidence: `supabase/config.toml` declares `[auth.sessions]` and `[storage] file_size_limit = "100MiB"`, and the local stack applies them. These may be paid-plan features on hosted Supabase (not confirmed here), and the hosted project's plan is not recorded in this repository. Story 1.9 will diff the declared settings against the live ones, which cannot pass if the plan does not allow them.
  mapped_story: 1.10 (provision external accounts, credentials and spend limits; record the Supabase plan and confirm these settings against it).

- source_spec: `_bmad-output/implementation-artifacts/spec-1-10-provision-external-accounts-credentials-and-spend-limits.md`
  summary: Production ledger items cannot pass until production exists, so add a "not yet applicable" state or a per-item start story to `provisioning/ledger.json` and `scripts/check-provisioning.mjs`.
  evidence: Production projects are created in Story 8.7, after the Story 8.4 drill, but production items are due earlier in build order (the production Google OAuth client at 1-3, and the production keys at 1-6, 1-9, 2-5, 7-7 and 8-9). `check-provisioning --env production` therefore fails for every story before 8.7 and cannot tell "not yet applicable" from "missing". Only the production Stripe items are due at 8.7 so far.
  mapped_story: 8.7 (create the production projects; decide then whether production items start at that story or carry a not-yet-applicable state).
