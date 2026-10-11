
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
  summary: Build the local Google OIDC stand-in that lets Playwright drive the real Google redirect and the PKCE callback against the Supabase CLI stack, and that issues the `amr` `oauth` entries that step-up checks read. Partly met by Story 1.3 Part B: browser tests now forge sessions (a Google user and an `auth.sessions` row, a token signed with the stack's JWT secret, the `@supabase/ssr` cookie), so signed-in flows run, but the callback's code exchange and the pre-authorization it consumes are covered only by unit tests with a fake Auth client, plus the failed-exchange path against the real stack.
  evidence: `tests/support/forged-session.ts` and `tests/e2e/registration.spec.ts`. A forged session carries the `oauth` method in the token's `amr` claim but has no `auth.mfa_amr_claims` rows, so it cannot exercise the step-up reads either. Story 1.4a (session grants) did not need the stand-in: forged sessions now also get their grant (`world.activate`, `world.grant`) and `tests/e2e/authorization.spec.ts` drives the real gate with them, but the callback's code exchange, and the grant it issues, are still covered only by unit tests with a fake Auth client.
  mapped_story: 1.4b (step-up reads the `amr` `oauth` entries; first story that needs the stand-in itself).
  status: resolved by Story 1.4b (2026-10-11): `tests/support/fake-google.mjs` is a dependency-free fake Google (account chooser honoring `prompt=select_account`, token endpoint, signing keys, discovery over TLS for `accounts.google.com`, a loopback-only control API) and `scripts/fake-google-stack.mjs` (`npm run fake-google:up`) swaps only the stack's Auth container to reach it; `tests/e2e/step-up.spec.ts` runs the real second sign-in, with a real `auth.mfa_amr_claims` row and the callback's real code exchange, on desktop and phone. Forged sessions stay for everything that does not need a second sign-in. See `docs/auth-setup.md` (The fake Google).

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
  summary: **Josh: the Hebrew copy needs native review before release.** Every Hebrew string in `lib/i18n/he.ts` (about 255 messages: navigation, guidance, Settings, sign-in, the registration screen and the disabled-account message added by Story 1.3 Part B, the sign-out, "sign out my other sessions" and "Try again" strings added by Story 1.4a, sample project names and the design-kit sample) was drafted by a model and has not been read by a Hebrew speaker. It is gender-neutral second person plural and uses plural forms for one, two and many, but terminology (for example "מבוסס מקור", "מוסק", "שנוי במחלוקת" for sourced, inferred and disputed), the sample names ("המזבח החיצון והכבש", "מידות פרק ג׳") and the register have not been checked. It must not be presented as reviewed. Edit `lib/i18n/he.ts` only; the parity test keeps its keys and placeholders in step with English.
  evidence: The story's boundary says machine-drafted Hebrew is never presented as reviewed. `he.ts` carries a DRAFT HEBREW header, and the README interface row says so.
  mapped_story: release readiness for Epic 1 (before any non-Josh user sees Hebrew); each later story that adds Hebrew copy extends the same file.
  status: extended by Story 1.4b (2026-10-11): the step-up page (`stepUp.*`, `meta.stepUp`) and the sign-in message `login.error.step_up_failed` are new machine-drafted Hebrew in `lib/i18n/he.ts` and need the same native review.

- source_spec: `_bmad-output/implementation-artifacts/spec-1-2-establish-accessible-localized-navigation-and-preferences.md`
  summary: Run the rest of the signed-in shell (keyboard flows, menus and dialogs open, the 404 page, enlarged text, dark Hebrew and high contrast on every page) through CI. Story 1.3 Part B added axe runs on the real Home, My Projects, In Progress and Settings pages for an active Account (English light and Hebrew dark, desktop and phone) and for the registration screen (all four language and theme variants), using forged sessions; nothing else of the signed-in shell is covered beyond the synthetic design kit (`/kit`).
  evidence: `tests/e2e/registration.spec.ts` for the real routes; `tests/e2e/shell.spec.ts` still drives the kit. The dedicated sign-in provider stand-in is deferred above. Story 1.4a added `tests/e2e/authorization.spec.ts` (the signed-in flows with session grants: the Account menu and its sign-out, the Settings sessions section, the sign-in error states and the retry page, each on desktop and phone with axe in English light and Hebrew dark where it matters); the keyboard, menus-and-dialogs, 404, enlarged-text and high-contrast passes over the real routes remain.
  mapped_story: 1.4c (the signed-in shell CI coverage is part of its entry below); extend `tests/e2e/shell.spec.ts` to the real routes then.

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
  status: resolved by Story 1.4a (2026-10-10). The Account menu has "Sign out" (`app/account/actions.ts` `signOut`, `components/shell/shell.tsx`): it revokes the session's grant first and keeps the session, saying so, when that cannot be recorded. The menu's account card still shows the sample account (see the entry added by Story 1.4a below).

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

- source_spec: `_bmad-output/implementation-artifacts/spec-1-3-part-b-registration-and-account-gating.md`
  summary: **Josh: cut staging over from the old email list before deploying Story 1.3 Part B.** The live-Account check replaces the interim `AUTH_ALLOWED_EMAILS` gate at once, so every address that is allowed in today needs a pre-authorization (or a code) first, or it sees only the registration screen. The old list held `heimannshua@gmail.com,daniel@orvex.ai` (the staging Administrator and the second address Josh uses today). Steps: apply the two Part A migrations, expose `api`, enable the hook and set `INVITATION_HASH_KEY` and `RATE_LIMIT_HASH_KEY` (both are now required at startup, and the Vercel build fails without them); put `ADMINISTRATOR_EMAIL=heimannshua@gmail.com` and `SEED_ACCOUNT_EMAILS=daniel@orvex.ai` in `.env.staging`; run `node --env-file=.env.staging scripts/seed-accounts.mjs preauthorize --confirm staging`; delete `AUTH_ALLOWED_EMAILS` from the Vercel project (every scope) and `.env.staging`; deploy; then each address opens the app through real Google (a session from before the deploy has no Account yet and lands on `/register`, where the proxy consumes the pre-authorization and sends it Home). Written out in `docs/auth-setup.md` (Cutting over from the old email list) and `docs/deployment-setup.md`.
  evidence: Part B was verified only against the local Supabase CLI stack. Nothing was applied, pushed, seeded or deployed to staging or production. The old list is not read by anything any more, so nothing can warn or fail a deploy for an address left out of the seed; the check is the manual one above.
  mapped_story: 1.3 (AC-7, AC-9 hosted verification), then 1.9 for the config push.

- source_spec: `_bmad-output/implementation-artifacts/spec-1-3-create-invitation-only-accounts.md`
  summary: **Josh: hosted setup for Story 1.3 Part A on staging.** Apply the two new migrations (`20261010120000_accounts.sql`, `20261010120100_api.sql`), add `api` to the exposed schemas (never `identity` or `projects`), enable the Before User Created hook (`api.before_user_created`, dashboard or `supabase config push` in Story 1.9), generate `INVITATION_HASH_KEY` and `RATE_LIMIT_HASH_KEY` (`openssl rand -base64 32` each) into the staging Vercel project and `.env.staging`, then run `node --env-file=.env.staging scripts/seed-accounts.mjs preauthorize --confirm staging`. Steps are in `docs/deployment-setup.md` (Provisioning staging, steps 2 to 5) and `docs/auth-setup.md`.
  evidence: Part A was verified only against the local Supabase CLI stack, as the spec requires. Nothing was applied, pushed or seeded on staging or production. Two hosted details are unverified until the migrations run there: that the hosted `postgres` role may reference and `FOR UPDATE`-lock `auth.users` (the local one can), and that the hook payload matches what the local Auth service and the Auth source send (`app_metadata.provider` and `user_metadata.email_verified`); a hook mismatch would reject every first-time Google sign-in with "Sign-in is not available for this account".
  mapped_story: 1.3 (Part B's hosted cutover is its own entry above), then 1.9 for the config push.

- source_spec: `_bmad-output/implementation-artifacts/spec-1-3-create-invitation-only-accounts.md`
  summary: Re-check the pinned Google subject on every sign-in, not only when a pre-authorization is consumed. Auth links a new Google identity to an existing user with the same verified email, so a recycled address could add a second Google identity to an Account's Auth user; `identity.accounts.google_subject` and `identity.preauthorizations.google_subject` hold the pin, but nothing compares them with `auth.identities` after activation.
  evidence: Part A pins the subject at activation and refuses another subject only while consuming a pre-authorization (`api.consume_preauthorization`). `api.account_status` reports the Account but does not compare subjects.
  mapped_story: 1.4 (live authorization on every private request) and 1.6 (Administrator recovery).
  status: resolved for authorization by Story 1.4a (2026-10-10): `api.authorize_session` and `api.issue_grant` compare the pinned subject with the Auth user's one Google identity on every call, revoke the session's grant on a mismatch and audit it (`session.subject_mismatch`). The strictness (a second Google identity locks the Account out) and the missing recovery path are recorded in `docs/auth-setup.md` (Known limitations) and belong to Story 1.6.

- source_spec: `_bmad-output/implementation-artifacts/spec-1-3-create-invitation-only-accounts.md`
  summary: The Story 1.9 dormant-identity purge must lock the identity row first and decide after: `select ... from auth.users where id = $1 for update`, then delete only rows with no recent `identity.registration_attempts` and no Account, in a separate statement (the integration test `AC-5` shows the shape). A single `delete ... where not exists (...)` takes its snapshot before it waits for the registration's lock and would still delete an identity whose attempt was just recorded.
  evidence: A registration holds `FOR UPDATE` on the Auth user, so a delete waits; if the registration created an Account the delete then fails on `ON DELETE RESTRICT`; if it failed (wrong code) the attempt time is persisted but a one-statement predicate does not see it.
  mapped_story: 1.9 (dormant-identity purge).

- source_spec: `_bmad-output/implementation-artifacts/spec-1-3-create-invitation-only-accounts.md`
  summary: Decide where "sole Administrator" is enforced in the database. Part A has no unique index on role `administrator` (the seed derives one Administrator from `ADMINISTRATOR_EMAIL`), because the spec does not ask for one and it would make the integration suite fail on any local database where the real Administrator is already seeded. The scenario to close: `ADMINISTRATOR_EMAIL` is changed and the seed run again, whether the old Administrator has signed in (the new address becomes a second Administrator Account) or not (two Administrator pre-authorizations, either of which can be consumed). Part A only warns: `preauthorize` prints a warning when another administrator pre-authorization exists, and `unauthorize --email` withdraws one that is unconsumed.
  evidence: `identity.accounts.role` and `identity.preauthorizations.role` accept `administrator` for any number of rows.
  mapped_story: 1.6 (recover the sole Administrator securely).

- source_spec: `_bmad-output/implementation-artifacts/spec-1-3-create-invitation-only-accounts.md`
  summary: `lib/accounts.ts` is server-only by convention and by test, not by the `server-only` package, because the seed script imports it through Node type stripping and the package throws there. Story 1.3 Part B imports it from routes, the proxy and a Server Action (through `lib/access.ts`), and the seed script still imports it, so the guard stays as it is. Add `import 'server-only'` once the script no longer imports the module (or runs with `--conditions=react-server` and the package is added as a dependency).
  evidence: `tests/unit/accounts.test.ts` fails if any `'use client'` file or anything under `components/` imports `lib/accounts`, and the module throws at load when a `window` exists. `components/register-form.tsx` is a client component and imports only `lib/register.ts`, which holds the types it shares with the Server Action.
  mapped_story: 1.4 (the next story that adds server routes), or whichever story first stops the seed script importing the module.

- source_spec: `_bmad-output/implementation-artifacts/spec-1-3-create-invitation-only-accounts.md`
  summary: Verify the hook's accept path on the first real staging Google sign-in, and that the hosted `postgres` role can lock `auth.users` (`FOR UPDATE`) and reference it. The accept path is verified only against a hand-built Google payload (`app_metadata.provider` google, `user_metadata.email_verified` true), built from the Auth source and from a payload captured for an email sign-up; no real Google sign-in ran. Its reject path is verified live: `POST /auth/v1/invite` with the service key reaches the hook and returns its message, and the Auth admin create-user endpoint does not call the hook at all. A wrong accept path would reject every first-time Google sign-in with "Sign-in is not available for this account"; existing users are unaffected because the hook runs only at creation.
  evidence: The local stack cannot reach Google, and the Google provider fetches Google's OIDC discovery document when it is built, so the stack cannot fake a Google sign-in.
  mapped_story: 1.3 Part B (first sign-in through the callback) and 1.10 (a throwaway Google account for the staging check).

- source_spec: `_bmad-output/implementation-artifacts/spec-1-3-create-invitation-only-accounts.md`
  summary: Alarm on registration trips: a spike of `limited` outcomes (an origin at its limit, and above all the global limit of 100 failures an hour, which locks registration for everyone for up to an hour), repeated `registration.subject_mismatch` audit events, and unexpected registration errors. The limiter only counts today; nothing tells the Administrator it is being hit.
  evidence: Failures are counted in `identity.rate_limit_counters` and refusals are audited, but no job reads either and no alert exists in Part A.
  mapped_story: 1.13 (raise operational alarms).

- source_spec: `_bmad-output/implementation-artifacts/spec-1-3-create-invitation-only-accounts.md`
  summary: Add a canary for a hash-key mismatch. If `INVITATION_HASH_KEY` differs from the key a code was issued under (a rotated or mistyped key), every outstanding code silently stops matching and looks like a wrong code. Idea: store a keyed check value (for example the HMAC of a fixed label) beside the invitations, verify it when issuing and listing, and say so in the Administrator page.
  evidence: Only hashes are stored and no function can tell a wrong key from a wrong code.
  mapped_story: 1.11 (manage invitations with fresh authentication).

- source_spec: `_bmad-output/implementation-artifacts/spec-1-3-create-invitation-only-accounts.md`
  summary: Account removal. `identity.accounts.user_id` references `auth.users` with `ON DELETE RESTRICT`, so an Auth user that owns an Account cannot be deleted, by the dormant-identity purge, the Auth admin API or the dashboard. Deleting or anonymizing an Account (its Workspace, registration command, invitation and pre-authorization rows, audit references and the invitee label on a named code) has to be designed with the deletion stories, including what an append-only audit trail keeps.
  evidence: `accounts`, `workspaces`, `registration_commands`, `invitations.redeemed_account_id` and `preauthorizations.account_id` all restrict deletion; `invitations.label` holds the invitee's name in clear.
  mapped_story: 8.2 (account and data deletion).

- source_spec: `_bmad-output/implementation-artifacts/spec-1-3-create-invitation-only-accounts.md`
  summary: A re-pin path for the Administrator's Google subject. The subject is pinned at activation and `identity.accounts` refuses to change `google_subject` (a trigger), so if the Administrator's Google account changes its subject the new subject is refused permanently. Recovery needs a deliberate, audited re-pin that relaxes that guard.
  evidence: `identity.guard_account` rejects any change to `user_id`, `google_subject` and `source`; `api.consume_preauthorization` refuses a second subject for a consumed address.
  mapped_story: 1.6 (recover the sole Administrator securely).

- source_spec: `_bmad-output/implementation-artifacts/spec-1-3-part-b-registration-and-account-gating.md`
  summary: "Use a different Google account" on the registration screen ends the session and returns to sign-in, but Google may sign the same account straight back in. Offer the account chooser (`prompt=select_account` on the Google OAuth request) when the person came from that button, and decide whether the sign-in page should always offer it.
  evidence: `startGoogleSignIn` asks for Google with no `queryParams`, and `tests/unit/sign-in.test.tsx` pins that call. A person with one signed-in Google account in the browser is not asked which one to use.
  mapped_story: 1.4 (the next story that touches the sign-in page) or 1.11.
  status: resolved by Story 1.4b (2026-10-11): `switchGoogleAccount` ends the session, then builds a new Google sign-in on the server with `prompt=select_account` and no `login_hint` (`requestGoogleSignIn` in `lib/sign-in.ts`) and sends the browser there. The sign-in page itself still asks without `prompt`; whether it should always offer the chooser is not decided and stays open.

- source_spec: `_bmad-output/implementation-artifacts/spec-1-3-part-b-registration-and-account-gating.md`
  summary: Cover "database unreachable" end to end in a browser. The proxy, the pages, the callback and the registration action are tested for it with a fake network (`tests/unit/proxy-gating.test.ts`, `auth-callback.test.ts`, `register-action.test.ts`), but no browser test stops the stack's database or Auth service.
  evidence: The local stack is shared by every test file and by the developer; stopping a container mid-run would break parallel tests. A dedicated stack, or a switch in the fake network layer, would make it safe.
  mapped_story: 1.9 (staging provisioning and the pipeline that owns a throwaway stack) or 1.13 (alarms).
  status: resolved for the accounts database by Story 1.4a (2026-10-10), by the "switch in the fake network layer": `test:e2e` starts a second server from the same build with `tests/support/fake-network.mjs` preloaded, and a test makes the accounts API fail for one user (`tests/support/fake-network.ts`), so the proxy, pages, `/api`, sign-out and "sign out my other sessions" are exercised against an unreachable database without disturbing any other test. An Auth outage is still covered only by unit tests (see the entry added below).

- source_spec: `_bmad-output/implementation-artifacts/spec-1-3-part-b-registration-and-account-gating.md`
  summary: Private `/api` routes should answer a denied request with 401 or 403 JSON, not the HTML sign-in redirect the proxy sends every private path. A client of `/api/...` (a fetch from the app, a worker, a test) cannot use a 307 or 303 to a login page; today only `/api/health` exists and it is public.
  evidence: `proxy.ts` redirects every denied request to `/login?error=...`, whatever its path or `Accept` header.
  mapped_story: 1.4 (session grants and the first private API routes).
  status: resolved by Story 1.4a (2026-10-10): a denied private `/api` request gets 401 or 403 JSON, or a retryable 503 JSON when the check could not be made (`apiDenial` in `lib/access.ts`, `proxy.ts`; `tests/unit/proxy-gating.test.ts` and `tests/e2e/authorization.spec.ts`). No private API route exists yet; the first one inherits the gate.

- source_spec: `_bmad-output/implementation-artifacts/spec-1-3-part-b-registration-and-account-gating.md`
  summary: The gate asks twice and memoizes nothing. The proxy makes one Auth call and one service-role call for each private request, the page repeats both, and nothing is cached within a request. Replace both with session grants and, where a lookup stays, a per-request memo.
  evidence: `proxy.ts` calls `resolveAccess` and each private page calls `requireActiveAccount`; `docs/auth-setup.md` (How access is decided) records the cost.
  mapped_story: 1.4 (session grants replace the double lookup).
  status: resolved by Story 1.4a (2026-10-10): `api.authorize_session` answers the Account and the grant in one call, and `getAccess` is memoized with React `cache()` for a render. What remains is deliberate: the proxy and the page each ask Auth (`getUser`) and `authorize_session` once, because the proxy alone is not a boundary (`tests/e2e/authorization.spec.ts` counts two calls for a page and one for `/api`).

- source_spec: `_bmad-output/implementation-artifacts/spec-1-3-part-b-registration-and-account-gating.md`
  summary: The registration form needs JavaScript. The command-ID rotation, the retry after a dropped connection, the blank-code message and the stale-form redirect live in a client wrapper around the Server Action, so a form submitted before hydration is replayed by React but one with scripts disabled does nothing. Move what can move into the action and make the form submit without scripts (progressive enhancement).
  evidence: `components/register-form.tsx` (`attemptRegistration`) passes a client closure to `useActionState`, which cannot be progressively enhanced.
  mapped_story: 2.1.

- source_spec: `_bmad-output/implementation-artifacts/spec-1-3-part-b-registration-and-account-gating.md`
  summary: A deadline that fires in the middle of a token refresh can lose the refreshed cookies. `readUser` gives Auth 5 seconds; if the refresh succeeded at Auth but the answer arrives after the deadline, the new refresh token never reaches the browser, the old one is rotated away, and the next request signs the person out.
  evidence: `withDeadline` in `lib/deadline.ts` abandons the call but cannot cancel it, and `lib/supabase/proxy.ts` only carries cookies the client wrote before the deadline.
  mapped_story: 1.4 (session grants make the refresh explicit).
  status: evaluated by Story 1.4a (2026-10-10) and left deferred. Session grants do not change how Auth refreshes (the session ID, and so the grant, survive a refresh). The practical case is covered by Auth's refresh-token reuse interval, `refresh_token_reuse_interval = 10` in `supabase/config.toml`: the 5-second gating deadline is shorter, so a browser that never received the refreshed cookies presents the old refresh token again on its next request, within the interval, and Auth answers it with the same new session instead of treating it as reuse. It fails only if the person waits more than 10 seconds after a refresh whose answer was lost. Revisit if sign-outs after a slow Auth are ever reported.

- source_spec: `_bmad-output/implementation-artifacts/spec-1-3-part-b-registration-and-account-gating.md`
  summary: The sign-in callback drops the destination the person wanted. Everyone lands on Home (or on the registration screen) after Google, so a deep link such as a shared project URL is lost at sign-in.
  evidence: `app/auth/callback/route.ts` redirects to `/` or `/register` only; `proxy.ts` sends a signed-out visitor to `/login?error=not_signed_in` without remembering the path.
  mapped_story: 1.7 (the first deep-linkable pages).

- source_spec: `_bmad-output/implementation-artifacts/spec-1-3-part-b-registration-and-account-gating.md`
  summary: A link to the privacy policy is missing beside the operator notice on the registration screen. The notice says the instance operator administers the hosting accounts that hold users' data; it should lead to the policy that says what that means.
  evidence: `components/register-form.tsx` shows the notice (`register.operator`) with no link, because no policy page exists yet.
  mapped_story: 8.7 (release readiness).

- source_spec: `_bmad-output/implementation-artifacts/spec-1-3-part-b-registration-and-account-gating.md`
  summary: There is no break-glass path if the gate is misconfigured and everyone, the Administrator included, is locked out: an unseeded database, a wrong service key, or the `api` schema not exposed denies every request by design. `check-env --live` catches the last two (and not an unseeded database), but nothing lets the Administrator back in without database access and the seed command.
  evidence: `lib/access.ts` fails closed on every error; `docs/deployment-setup.md` says to seed before deploying; recovery of the sole Administrator is not built.
  mapped_story: 1.6 (recover the sole Administrator securely).

- source_spec: `_bmad-output/implementation-artifacts/spec-1-4a-session-grants.md`
  summary: Story 1.4b (step-up and request integrity): the server-controlled step-up (Postgres nonce bound to the Account, an httpOnly cookie on the initiating browser and the OAuth state; `prompt=select_account` with no `login_hint`; a new session whose `amr` has an `oauth` entry at or after the nonce start for the same verified email and Google subject; a marker for the new session only, classes administration, owner deletion, account deletion and close-instance; the initiating grant revoked; mismatch revokes only the new session locally), a minimal localized `/step-up` page, origin checks on every non-safe request and a per-session CSRF token for non-Server-Action mutations (token hash stored with the grant, so it adds a `csrf_hash` column to `identity.session_grants`), the local Google stand-in or forged `amr` for the callback tests, `prompt=select_account` for "use a different Google account", and the hosted step-up checklist (AC-9).
  evidence: Josh chose on 2026-10-10 to split Story 1.4 into three builds because one build was too large to review safely; 1.4b uses the grant table, `api.authorize_session` and the revocation primitive that 1.4a creates.
  mapped_story: 1.4 (AC-4, AC-5, AC-9).
  status: step-up part resolved by Story 1.4b (2026-10-11): nonce and marker tables, `api.start_step_up`, `api.complete_step_up`, `api.use_marker`, the `/step-up` page and Server Action, the callback branch, `prompt=select_account` for "use a different Google account", the fake Google, and the hosted checklist (`docs/auth-setup.md`, Verifying the step-up on hosted Auth). Request integrity (origin checks, the CSRF token) is Story 1.4c, in the entry below.

- source_spec: `_bmad-output/implementation-artifacts/spec-1-4a-session-grants.md`
  summary: Story 1.4c (preferences and isolation proof): the Account-owned preferences record with first-sign-in migration of the four device cookies (the record wins on a new device, cookies stay the first-paint copy), a language and theme choice on the sign-in page, the two-Account isolation suite (REST, `api` functions, a private storage bucket, composite ownership references, a table-by-table check that every Identity, Projects and Lifecycle table is closed to `anon` and `authenticated`), `docs/staging.md` (manual push of config and migrations until Story 1.9), the signed-in shell CI coverage (keyboard, menus, dark Hebrew, enlarged text), and the `server-only` note for lib/accounts.ts.
  evidence: Josh chose on 2026-10-10 to split Story 1.4 into three builds because one build was too large to review safely.
  mapped_story: 1.4 (AC-1, AC-7).

- source_spec: `_bmad-output/implementation-artifacts/spec-1-4a-session-grants.md`
  summary: **Josh: hosted cutover for Story 1.4a (session grants).** Apply `supabase/migrations/20261010130000_session_grants.sql` to staging **before** the build that uses it deploys (the build's accounts API preflight now calls `api.authorize_session` and fails with one line if it is missing), deploy, and expect every existing session to end: a session with no grant is refused as signed out, so everyone, the Administrator included, signs in again once. Then watch the first real sign-in: it is the first time the callback reads the session after the code exchange on a hosted project (`getSession()` after `exchangeCodeForSession`) and issues the grant. Steps are in `docs/auth-setup.md` (Cutting over to session grants). No new secret, setting or schema is involved.
  evidence: Story 1.4a was verified only against the local Supabase CLI stack, with forged sessions and a fake Auth client for the callback; nothing was applied, pushed or deployed to staging or production. The local stack cannot reach Google, so the callback's real exchange, and the grant it issues, have not run end to end.
  mapped_story: 1.4 (hosted verification of AC-8 and AC-10), then 1.9 for the push.

- source_spec: `_bmad-output/implementation-artifacts/spec-1-4a-session-grants.md`
  summary: Session grants are never deleted. One row is written per sign-in (and per registration or claim), revoked or not, and nothing removes expired, idle, stale or revoked ones, so `identity.session_grants` grows without bound. Add a periodic cleanup (for example, delete grants revoked, or last used, more than 90 days ago) once the scheduler exists. Account deletion must also handle them: `account_id` references `identity.accounts` with `ON DELETE RESTRICT`, like every other Account reference.
  evidence: `identity.session_grants` has no purge; `api.revoke_grants` marks rows and never removes them, and the audit family keeps the history anyway (`session.issued`, `session.revoked`).
  mapped_story: 1.9 (scheduled jobs: the periodic cleanup) and 8.2 (account and data deletion).

- source_spec: `_bmad-output/implementation-artifacts/spec-1-4a-session-grants.md`
  summary: Disabling an Account must revoke its grants, and recovery must raise its epoch. Story 1.4a builds the primitives (`api.revoke_grants` by Account, `api.raise_authorization_epoch`) and refuses a disabled Account whatever its grants say (`authorize_session` answers `disabled` before it looks at a grant), but it does not revoke grants when `identity.accounts.status` changes, because the disable and re-enable UX is Story 1.5. Re-enabling an Account whose grants were never revoked would make its old sessions valid again; revoking them at disable time (and ending the Auth sessions) closes that.
  evidence: `tests/integration/session-grants.test.ts` ("disabled Account: disabled, even with a perfectly valid grant", "re-enabling is Story 1.5's") shows a disabled Account's grant becoming valid again on re-enable.
  mapped_story: 1.5 (disable and re-enable: revoke by Account at disable) and 1.6 (recovery: raise the epoch, revoke prior sessions).

- source_spec: `_bmad-output/implementation-artifacts/spec-1-4a-session-grants.md`
  summary: The Account menu's card still shows the synthetic sample account (the name "Josh" and "Sample account"), not the signed-in person. Sign-out now works from that menu, but nothing tells the person which Account they are signed in as.
  evidence: `components/shell/shell.tsx` reads `sampleAccount` from `lib/mock-data.ts`; the shell is a client component rendered by the root layout and receives no Account data.
  mapped_story: 1.4c (the Account-owned record) or the first story that shows Account details.

- source_spec: `_bmad-output/implementation-artifacts/spec-1-4a-session-grants.md`
  summary: Cover an Auth outage in a browser too. The fake network of Story 1.4a makes the accounts API fail for one user, which exercises "database unreachable"; "Auth unreachable" is covered by unit tests (`tests/unit/proxy-gating.test.ts`, `access.test.ts`) but no browser test makes Auth fail. The preload (`tests/support/fake-network.mjs`) could also fail `/auth/v1/*` for requests carrying one session's token.
  evidence: The preload attributes a call to a user by the `p_user_id` or `user:<id>` actor of an accounts API call; Auth calls carry only the token.
  mapped_story: 1.9 (the pipeline that owns the stack) or 1.13 (alarms).

- source_spec: `_bmad-output/implementation-artifacts/spec-1-4a-session-grants.md`
  summary: Alert on two signals the gate now produces. (1) Every `session.subject_mismatch` audit event: a Google identity that is not the pinned one has just been refused for an Account, which is either a recycled address or an attempt to take one over. (2) A burst of requests that present a revoked, expired or stale-epoch grant for a session Auth still honors (the gate answers `session_ended`): that is a stolen or leaked token being replayed after the real owner signed out or was signed out. Neither is counted or reported anywhere today; the audit events and the `revoked`/`expired`/`stale_epoch` answers exist, and nothing reads them.
  evidence: `api.authorize_session` writes `session.subject_mismatch` once per revoked grant and nothing at all for a refused request (a refused request writes nothing by design, so the burst has to be counted from the application's log or a counter, not the audit table).
  mapped_story: 1.13 (raise operational alarms).

- source_spec: `_bmad-output/implementation-artifacts/spec-1-4a-session-grants.md`
  summary: Give a private page request a latency budget and measure it. A page request now costs up to three round trips to Auth plus one to the database in the proxy (the user, the stored session, the authorization) and the same again in the page, within a 5-second budget each. Nobody has measured what that costs on a hosted project, from a Vercel region to a Supabase region, or decided what is acceptable; the budget is a ceiling for a failing service, not a target. Options when it matters: read the session ID without a second Auth round trip (the token Auth just verified is already in memory), pass the proxy's answer to the page in a signed header, or cache a positive answer for seconds, each of which weakens "honor nothing cached" and so needs a decision.
  evidence: `tests/e2e/authorization.spec.ts` counts two `authorize_session` calls for a page and one for `/api`; `lib/access.ts` (`readUser`, `resolveAccess`) makes the Auth calls; no timing is recorded anywhere.
  mapped_story: 1.13 (operational measurements and alarms), or the first story that shows a slow page.

- source_spec: `_bmad-output/implementation-artifacts/spec-1-4a-session-grants.md`
  summary: A session list behind "sign out my other sessions". Today the button signs out every other session and says how many; it cannot show them. A list would name each (browser and device, last seen, approximate place, "this one"), let a person end one, and make a surprise visible. It needs facts the grant does not record (a device label, the user agent, a coarse origin) and a decision about what may be stored; `identity.session_grants` holds only the session ID, the Account, the epoch and times.
  evidence: `app/account/actions.ts` (`signOutOtherSessions`), `components/settings/sessions-section.tsx`, `identity.session_grants` columns.
  mapped_story: 2.1 or later (the first story that adds Account details beyond Settings).

- source_spec: `_bmad-output/implementation-artifacts/spec-1-4a-session-grants.md`
  summary: Sign-out, "sign out my other sessions" and registration depend on JavaScript. The buttons are forms bound to Server Actions through `useActionState` and a client wrapper (`components/use-session-action.ts`, which also reads a proxy redirect and keeps a lock against double presses), so with scripts disabled, or before hydration finishes, pressing them does nothing. A person on a shared computer who cannot sign out is the case that matters most. Make the sign-out a plain form post to a route that revokes, ends the session and redirects, and keep the enhanced version on top.
  evidence: `components/shell/shell.tsx` (`AccountPanel`), `components/settings/sessions-section.tsx`, `components/register-form.tsx` (already recorded for registration).
  mapped_story: 2.1.

- source_spec: `_bmad-output/implementation-artifacts/spec-1-4a-session-grants.md`
  summary: Decision for Josh, not made: the code review of Story 1.4a asked for a new sign-in error code `sign_in_incomplete` ("sign-in did not finish; start again") for outages that end this browser's session (the sign-in callback, the registration action's grant, the registration claim in the proxy), keeping `auth_unavailable` and its "Try again" link only for outages that keep the session. The spec's frozen matrix names `auth_unavailable` for exactly that case ("Sign-in completes ... error: sign out, `auth_unavailable`"), and Story 1.3 Part B's frozen matrix does the same for the callback, so it was not built. Today a person whose sign-in could not be completed sees "Sign-in is not available right now. Try again in a moment." beside a "Try again" link that goes Home, which is a sign-in page again for them (their session was ended), so the link is one extra click. Building it means renegotiating those two matrix rows.
  evidence: `lib/access.ts` (`issueSessionGrant`, `decideSignIn`), `app/auth/callback/route.ts`, `components/login-form.tsx` (the retry link appears for every `auth_unavailable`).
  mapped_story: 1.4 (decide before 1.4b touches the sign-in page again).
  status: still open after Story 1.4b. 1.4b did not touch the sign-in page, but it adds the error code `step_up_failed` ("That sign-in could not be used to confirm it is you") and sends a failed or unreachable step-up completion to sign-in (`step_up_failed`, or `auth_unavailable` for an outage, which shows the same "Try again" link that goes Home).

- source_spec: `_bmad-output/implementation-artifacts/spec-1-4a-session-grants.md`
  summary: Updates to the Story 1.4a entries above, after the review round (the earlier text is left as it was). (1) The entry "Disabling an Account must revoke its grants" is settled in the database: any change of `identity.accounts.status` now raises `authorization_epoch` by one in the same update (`identity.guard_account`), so a disabled Account's old sessions are stale for good and enabling it again cannot bring them back. Story 1.5 still has to end the Auth sessions of a disabled Account; it does not have to remember to revoke grants. Story 1.6 (recovery) still has to raise the epoch itself. (2) The hosted cutover entry's preflight is now `api.preflight` (it reads the grants, Accounts, and Auth's sessions and identities), not `api.authorize_session`; the cutover, the rollback and the runbook for a second Google identity are written out in `docs/auth-setup.md`. (3) New Hebrew strings in `lib/i18n/he.ts` (sessions ended, signed out, the plural forms of "other sessions signed out", and the empty case) are machine-drafted like the rest and need the same native review.
  evidence: `supabase/migrations/20261010130000_session_grants.sql`, `tests/integration/session-grants.test.ts` ("a change of status raises the epoch").
  mapped_story: 1.5, 1.6; the Hebrew review stays with the entry for `lib/i18n/he.ts`.

- source_spec: `_bmad-output/implementation-artifacts/spec-1-4b-step-up.md`
  summary: Story 1.4c (request integrity): an origin check on every non-safe request (compare `Origin` to `x-forwarded-host`, else `host`, as Next does for Server Actions; run after the access decision so the existing 401 tests hold; decide how a missing `Origin` is handled), a per-session CSRF token for non-Server-Action mutations (random token minted when a grant is issued, only its hash stored in a new write-once `csrf_hash` column of `identity.session_grants`, delivered in a cookie the page script echoes in a header, verified against the grant; grants issued before the column existed have no token and are refused for these mutations until the person signs in again), a `requireMutationAccess` helper beside `requireApiAccess` with a structural test that every non-GET handler under `app/api` uses it, and the cookie plumbing for the three places a grant is issued (callback, the proxy's `/register` claim, registration). There is no non-GET route handler yet, so tests drive the helper with a test-only route.
  evidence: Josh chose on 2026-10-11 to split request integrity out of Story 1.4b because step-up, the fake Google and request integrity are separate deliverables. Findings from the 1.4b planning investigation: Next 16 compares Origin to Host for Server Actions only and allows a missing `Origin`; the proxy runs before that check; `tests/unit/proxy-gating.test.ts:468-480` and `tests/e2e/authorization.spec.ts:674-675` send non-safe requests with no `Origin` and expect 401; `api.issue_grant` is the single place that would take the hash.
  mapped_story: 1.4 (AC-5).

- source_spec: `_bmad-output/implementation-artifacts/spec-1-4b-step-up.md`
  summary: Renumbering note: with request integrity now Story 1.4c, the entry above that is titled "Story 1.4c (preferences and isolation proof)" and the entries that name 1.4c for the signed-in shell CI coverage, `docs/staging.md` and the `server-only` note belong to Story 1.4d. Story 1.4 is set to `review` only when 1.4a, 1.4b, 1.4c and 1.4d are all done.
  evidence: Same split decision; existing entries are left as written.
  mapped_story: 1.4d.

- source_spec: `_bmad-output/implementation-artifacts/spec-1-4b-step-up.md`
  summary: **Josh: hosted verification of the step-up (AC-9) and its migration.** Apply `supabase/migrations/20261011120000_step_up.sql` to staging **before** the build that uses it deploys (the build's preflight, `api.preflight`, now also reads `identity.step_up_nonces`, `identity.fresh_authentications` and `auth.mfa_amr_claims`, and fails with one line if it is missing; the previous build keeps working with the migration). Nothing is secret or new in configuration. Then run the checklist in `docs/auth-setup.md` (Verifying the step-up on hosted Auth): the account chooser appears, the new `session_id` and its `amr` `oauth` row at or after the nonce start, the marker, the old grant revoked, and the single-session-per-user setting off. Nothing links to `/step-up` yet, so open `/step-up?for=administration` by hand on a throwaway Account.
  evidence: Story 1.4b was verified only against the local Supabase CLI stack and the fake Google; nothing was applied, pushed or deployed to staging or production. Hosted details that the fake cannot show: that Auth's `amr` row and `created_at` are set as the local Auth image sets them, that Auth and Postgres clocks agree to well under the seconds a person takes to sign in (the check is `created_at >= nonce.started_at` across the two), and what a single-session-per-user setting does to the old session.
  mapped_story: 1.4 (AC-9), then 1.9 for the push.

- source_spec: `_bmad-output/implementation-artifacts/spec-1-4b-step-up.md`
  summary: Nothing sends a person to `/step-up` and nothing checks a marker yet. The first sensitive area (Story 1.11, invitation management with fresh authentication) must send a person without a marker to `/step-up?for=<class>`, and call `api.use_marker` (typed `checkMarker` in `lib/accounts.ts`) inside the transaction of the sensitive change, passing the moment its destructive confirmation was shown for `account_deletion` and `close_instance`. Every class returns to Settings for now (`stepUpReturnPaths` in `lib/step-up.ts`); each later story changes its own line (the Administration area, the deletion confirmations).
  evidence: `lib/step-up.ts`, `tests/unit/gate-structure.test.ts` ("has no sensitive action yet that checks a marker"). The Server Action takes the class from the page's bound argument, validated against the closed list; a person who edits `?for=` can only ask for a different label on a marker for their own new session, which gives them nothing a step-up does not.
  mapped_story: 1.11 (administration), 8.2 (Account and owner deletion), 8.x close-instance.

- source_spec: `_bmad-output/implementation-artifacts/spec-1-4b-step-up.md`
  summary: Step-up nonces and markers are never deleted. One `identity.step_up_nonces` row is written per start and one `identity.fresh_authentications` row per accepted step-up, and the hourly limit reads the nonce rows, so they must stay for at least an hour; after that nothing needs them but the audit trail (`step_up.started`, `step_up.completed`, `step_up.rejected`, `step_up.marker_consumed`), which already records them. Add a periodic cleanup (for example, rows ended more than 7 days ago) once the scheduler exists. Account deletion must also handle them: both reference `identity.accounts` with `ON DELETE RESTRICT`, like every other Account reference.
  evidence: `supabase/migrations/20261011120000_step_up.sql`; `removeAccountData` in `tests/support/accounts-data.ts` deletes them first for tests.
  mapped_story: 1.9 (scheduled jobs: the periodic cleanup) and 8.2 (account and data deletion).

- source_spec: `_bmad-output/implementation-artifacts/spec-1-4b-step-up.md`
  summary: A step-up that fails after the Google sign-in ends in the sign-in page, not back in the app. The code exchange has already replaced this browser's session cookie with the new session, so a mismatch, an expired or replaced nonce, an old sign-in or a database outage ends only that new session (local scope) and the person signs in again, as the spec says. The initiating session is still valid (its grant is revoked only on acceptance) but this browser no longer holds it. Restoring the initiating session's cookies (read before the exchange, written back after the local sign-out) and carrying a "that did not confirm it is you, try again" message back to `/step-up` would keep the person where they were; it is not built.
  evidence: `app/auth/callback/route.ts`, `lib/access.ts` (`finishStepUp`), `tests/e2e/step-up.spec.ts` (mismatch, expired, replaced and outage cases end at `/login?error=...`).
  mapped_story: 1.11 (the first story where a person starts a step-up from inside a task).

- source_spec: `_bmad-output/implementation-artifacts/spec-1-4b-step-up.md`
  summary: The step-up binds to a PKCE flow through the fixed `<storage key>-code-verifier` cookie, which holds the verifier of the most recently started sign-in in that browser. auth-js can keep one verifier per flow (`-flow-<id>-code-verifier` slots), but it then needs the flow ID on the redirect URL (`experimental.appendPkceFlowIdToRedirects`), and a query string on `redirectTo` fails Auth's exact-match allow-list. So starting a second Google sign-in in the same browser between the start and the return of a step-up makes the step-up's exchange fail (a plain `auth_failed`; it fails safe). Using the slots would need a wildcard allow-list entry for the callback, a deliberate widening of what hosted Auth accepts.
  evidence: `tests/unit/step-up-flow.test.ts` (reads the verifier the installed @supabase/ssr and auth-js write), `docs/auth-setup.md` (Known limits of the step-up).
  mapped_story: 1.9 (the config push declares the redirect URLs; decide there).

- source_spec: `_bmad-output/implementation-artifacts/spec-1-4b-step-up.md`
  summary: Test tooling Josh should know about. (1) `npm run fake-google:up` needs Docker, the `openssl` command and four free local ports (9099 to 9102, fixed: a variable to move them was left out so that no new variable is introduced without asking); it recreates the local stack's Auth container, so `supabase stop` or `npm run fake-google:down` is how to get the plain one back. (2) The sign-in callback now answers with a relative `Location`: a route handler's `request.url` names `localhost` behind `next start --hostname 127.0.0.1`, which sent the browser to an origin that does not hold its session cookie. (3) No new environment variable and no secret was added: the application reads none, and the fake's ports and the swapped container's random Google client are made by the script.
  evidence: `scripts/fake-google-stack.mjs`, `tests/support/fake-google.mjs`, `tests/unit/fake-google.test.ts`, `tests/unit/fake-google-stack.test.ts`, `tests/unit/auth-callback-real-client.test.ts`.
  mapped_story: 1.9 (the pipeline that owns the stack).

- source_spec: `_bmad-output/implementation-artifacts/spec-1-4b-step-up.md`
  summary: Rate and abuse of the step-up start. Any session of an Account can start a step-up, which voids the Account's open nonce and spends one of its 10 starts an hour, so one noisy or hostile session can keep another session's step-up from completing, or use up the Account's allowance for an hour. The limit is per Account because the spec and AD-12 say so. Consider a per-session allowance (a session is the one that is signed in, so its own count is fair), and an alert on `step_up.limited`, which is already audited (once an hour per Account) and nowhere read.
  evidence: `api.start_step_up` (`identity.step_up_nonces` counted per `account_id`; the open nonce is voided by any start), `step_up.limited` in `identity.audit_events`.
  mapped_story: 1.13 (raise operational alarms).

- source_spec: `_bmad-output/implementation-artifacts/spec-1-4b-step-up.md`
  summary: Retention and erasure of step-up records. `identity.step_up_nonces` and `identity.fresh_authentications` grow without bound, and both reference `identity.accounts` with `ON DELETE RESTRICT`, so Account deletion will fail on them unless the deletion story deletes or archives them first (and the audit trail already keeps `step_up.started`, `step_up.completed`, `step_up.rejected.<reason>` and `step_up.marker_consumed`, so nothing is lost by removing the rows). The hourly start limit reads the nonce rows, so cleanup must keep at least the last hour.
  evidence: `supabase/migrations/20261011120000_step_up.sql` (foreign keys, no purge); `removeAccountData` in `tests/support/accounts-data.ts` deletes them first for tests.
  mapped_story: 1.9 (periodic cleanup) and the Account-deletion story (8.2).

- source_spec: `_bmad-output/implementation-artifacts/spec-1-4b-step-up.md`
  summary: `api.use_marker`'s `started_after` is supplied by the caller. The story that adds each action that consumes a marker (Account deletion, close-instance) must record the time its destructive confirmation was shown ON THE SERVER, when the confirmation is rendered or accepted, and pass that; it must never take the time from a form field, a header or any other client-supplied value, because a client that chooses the time chooses whether the marker is stale.
  evidence: `api.use_marker` in the step-up migration (a consumed class requires `p_started_after`); `checkMarker` in `lib/accounts.ts`; `tests/unit/gate-structure.test.ts` ("has no sensitive action yet that checks a marker").
  mapped_story: 8.2 (Account deletion) and the close-instance story.

- source_spec: `_bmad-output/implementation-artifacts/spec-1-4b-step-up.md`
  summary: Record the hosted AC-9 step-up check (`docs/auth-setup.md`, Verifying the step-up on hosted Auth) as an attestation in the provisioning ledger (`provisioning/ledger.json`), due at the first story that consumes a marker, so `check-provisioning` reports it as missing until Josh has run it on staging.
  evidence: The checklist is a manual list today; nothing in the ledger refers to it. Story 1.4b adds no ledger item because it consumes no marker itself.
  mapped_story: 1.11 (the first story that consumes a marker); the ledger format is Story 1.10's.

- source_spec: `_bmad-output/implementation-artifacts/spec-1-4b-step-up.md`
  summary: Restoring the swapped Auth container is a rebuild from `docker inspect`, not a restore. `scripts/fake-google-stack.mjs` recreates the original from its saved inspection (image, command, user, labels, network and aliases, hosts, restart policy, a CMD-SHELL health check, environment); it does not carry bind mounts, port bindings, resource limits or other health check kinds, and an interrupt between `docker stop` and `docker start` (or a failing `start`) leaves the stack without Auth until `down` or `supabase start` runs. A safer shape: keep the original container, stopped and renamed, and restore by renaming it back, with a signal handler for an interrupt between the stop and the start. The documented recovery today is `supabase stop` then `supabase start`. The Supabase CLI's Auth container has none of those settings today, so the rebuild is faithful for now.
  evidence: `scripts/fake-google-stack.mjs` (`createArguments`, `restoreOriginal`); `tests/unit/fake-google-stack.test.ts` covers an interrupted swap and a failing restore with Docker faked.
  mapped_story: 1.9 (the pipeline that owns the stack), or whenever the Supabase CLI's Auth container gains a setting the rebuild would lose.

- source_spec: `_bmad-output/implementation-artifacts/spec-1-4b-step-up.md`
  summary: The `/step-up` page does not say what is being confirmed or which Google account is signed in. It says "Sign in with Google again" and "choose the same Google account you are using now" for every class, and shows no account name. Each later story that introduces a sensitive action should add its own wording (what the person is about to do, and the address they are signed in as), on this page or on the screen that sends them here.
  evidence: `components/step-up-form.tsx`, `lib/i18n/en.ts` (`stepUp.*`); the page receives only the class, and the Account menu still shows the sample account (see the earlier entry on Account details).
  mapped_story: 1.5 (disable and re-enable), 1.11 (invitations) and 8.2 (Account deletion).
