
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

- source_spec: `_bmad-output/implementation-artifacts/spec-1-2-establish-accessible-localized-navigation-and-preferences.md`
  summary: **Josh: the Hebrew copy needs native review before release.** Every Hebrew string in `lib/i18n/he.ts` (about 230 messages: navigation, guidance, Settings, sign-in, sample project names and the design-kit sample) was drafted by a model and has not been read by a Hebrew speaker. It is gender-neutral second person plural and uses plural forms for one, two and many, but terminology (for example "מבוסס מקור", "מוסק", "שנוי במחלוקת" for sourced, inferred and disputed), the sample names ("המזבח החיצון והכבש", "מידות פרק ג׳") and the register have not been checked. It must not be presented as reviewed. Edit `lib/i18n/he.ts` only; the parity test keeps its keys and placeholders in step with English.
  evidence: The story's boundary says machine-drafted Hebrew is never presented as reviewed. `he.ts` carries a DRAFT HEBREW header, and the README interface row says so.
  mapped_story: release readiness for Epic 1 (before any non-Josh user sees Hebrew); each later story that adds Hebrew copy extends the same file.

- source_spec: `_bmad-output/implementation-artifacts/spec-1-2-establish-accessible-localized-navigation-and-preferences.md`
  summary: Run the signed-in shell (Home, My Projects, In Progress, Settings, the 404 page) through axe, keyboard and Hebrew flows in CI. Story 1.2 runs them on the synthetic design kit (`/kit`), because the real shell is behind sign-in and no test login exists.
  evidence: The real pages were checked once, by hand, with authentication bypassed in a scratch copy: no axe violations and no sideways scrolling in English and Hebrew, light and dark, on desktop and phone. That check is not repeatable in CI. The sign-in provider stand-in that would make it repeatable is already deferred to 1.3 and 1.4 above.
  mapped_story: 1.3 (the OIDC stand-in) and 1.4 (the first signed-in browser flow); extend `tests/e2e/shell.spec.ts` to the real routes then.

- source_spec: `_bmad-output/implementation-artifacts/spec-1-2-establish-accessible-localized-navigation-and-preferences.md`
  summary: Move the four device preference cookies (`nova3d-locale`, `nova3d-theme`, `nova3d-detail`, `nova3d-guidance`) into the Account-owned record, keeping the cookies as the first-paint copy, and offer a language choice on the sign-in page (today it follows the device language only, because Settings is behind sign-in).
  evidence: Story 1.2 stores preferences on the device only, as the spec requires, and `lib/preferences.ts` is the single reader and writer.
  mapped_story: 1.4 (Account record and live authorization).

- source_spec: `_bmad-output/implementation-artifacts/spec-1-2-establish-accessible-localized-navigation-and-preferences.md`
  summary: A screen-reader pass on real devices (VoiceOver on iOS and macOS, TalkBack, NVDA or JAWS) and a Windows High Contrast pass. Story 1.2 verifies names, roles, live regions and focus order through axe, Playwright role queries and `forced-colors`, `prefers-contrast` and reduced-motion emulation, which cannot show how a given screen reader reads Hebrew or the bottom navigation bar.
  evidence: No device or screen reader was available to the build, and the accessibility gates are not claimed as passed.
  mapped_story: UX-DR20 coverage verification before the first release (owner: Josh).

- source_spec: `_bmad-output/implementation-artifacts/spec-1-2-establish-accessible-localized-navigation-and-preferences.md`
  summary: Sample-only controls in the synthetic shell are disabled instead of doing nothing: the project filter, the "more actions" button on a project card and on the running job. They become real in My Projects and the job stories.
  evidence: A control that does nothing is a trap for keyboard and screen-reader users, so Story 1.2 disabled them and removed the "Learn about setup" button and the "⌘ K" hint, which had no behaviour.
  mapped_story: 1.7 (My Projects) and 2.7 (jobs).

- source_spec: `_bmad-output/implementation-artifacts/spec-1-2-establish-accessible-localized-navigation-and-preferences.md`
  summary: A language and theme control on the sign-in page. Settings is behind sign-in, so before sign-in a visitor can only get the device language and light mode.
  evidence: The sign-in page renders without the shell and has one button on purpose (the public-surface test asserts it). The preference cookies already drive its `lang`, `dir` and theme, so a control would only need to write them through `lib/preferences.ts`.
  mapped_story: 1.3 (the sign-in surface for invited users).

- source_spec: `_bmad-output/implementation-artifacts/spec-1-2-establish-accessible-localized-navigation-and-preferences.md`
  summary: The Account menu in the shell has no sign-out. It shows the sample account and a note that account details arrive later.
  evidence: Story 1.2 adds no Account, session or auth changes (its boundary), so there is nothing to sign out of that it owns.
  mapped_story: 1.4 (sessions and live authorization).

- source_spec: `_bmad-output/implementation-artifacts/spec-1-2-establish-accessible-localized-navigation-and-preferences.md`
  summary: Locale-aware date, number and relative-time helpers (built on `Intl`) are not provided. Story 1.2 shows sample dates and "12 min ago" as catalog text, so server and browser always render identical markup.
  evidence: Real dates, durations and counts first appear with project and job data. Formatting them through `Intl` risks a server and browser mismatch if their ICU data differ, so the helper needs a deliberate design (fixed time zone, one formatter shared by both sides).
  mapped_story: 2.1.

- source_spec: `_bmad-output/implementation-artifacts/spec-1-2-establish-accessible-localized-navigation-and-preferences.md`
  summary: On a very short screen (landscape phone, or zoomed far in) the bottom navigation joins the page after the main content, but it is first in tab order, because it sits before the main content in the document.
  evidence: One `<nav>` serves as the sidebar and the bottom bar so there is a single landmark and tab order. Below 30 rem of height it becomes static and moves to the end visually with CSS `order`. The skip link covers keyboard users, but the sequence does not match the visual order there.
  mapped_story: 8.5.

- source_spec: `_bmad-output/implementation-artifacts/spec-1-2-establish-accessible-localized-navigation-and-preferences.md`
  summary: Both full message catalogs (English and Hebrew) ship to every browser, because client components translate on the client. That is a few tens of kilobytes now; revisit when the catalogs grow (load only the active language, or translate on the server).
  evidence: `lib/i18n/en.ts` and `he.ts` are imported by `lib/i18n/index.ts`, which client components reach through `useI18n`.
  mapped_story: 8.5.
