---
type: reviewer-gate
lens: technology
scope: UPDATE of ARCHITECTURE-SPINE.md and RATIFIED-DECISIONS.md (diff vs HEAD), memlog entries dated 2026-10-07
reviewed: 2026-10-08
reviewer: technology lens, read-only on the repo apart from this file
---

# Technology review: architecture update of 2026-10-07/08

## Verdict

No claim is CONTRADICTED. All seven load-bearing groups hold on live sources, so the update can go to handoff once three NOT CONFIRMED items are fixed or carried as explicit staging tests: the step-up sign-in behaviour of `prompt=select_account` together with `login_hint`, the 15 minute OTP floor, and the recovery-email delivery path (`generateLink` sends nothing). Four lower-severity gaps are listed at the end.

Method: primary docs fetched 2026-10-08; for Supabase Auth, Supabase CLI and supabase-js the source was cloned and read (supabase/auth `ce9a8ee`, 2026-09-22, latest release v2.197.0 of 2026-09-09; supabase/cli `e5f91a4`, 2026-10-08; supabase-js `84e2c5d`, 2026-10-07). "Undated" means the page shows no date; retrieval date is 2026-10-08. Hosted Supabase may lag the cloned master; that is the one residual uncertainty on the Auth items.

## Result table

| # | Claim group | Status |
|---|---|---|
| 1a | New Google users are rejected when "Allow new users to sign up" is off, so it must stay on | CONFIRMED (source; docs silent on OAuth) |
| 1b | JWT `amr[].timestamp` exists and is set on OAuth sign-in; no `auth_time` | CONFIRMED |
| 1c | `prompt=select_account` and `login_hint` pass through `signInWithOAuth` `queryParams` | CONFIRMED (passthrough). Google-side effect of the combination NOT CONFIRMED |
| 2 | `claude-sonnet-5-5` valid and current; $2/$10; `max_tokens` includes thinking; no per-request dollar cap | CONFIRMED |
| 3a | B2 lifecycle removes hidden versions (`daysFromHidingToDeleting`) | CONFIRMED on native API; S3-API field mapping NOT CONFIRMED by name |
| 3b | rclone-style sync mirrors deletions into B2 | CONFIRMED (native `b2` backend hides on delete) |
| 3c | B2 US regions | CONFIRMED (US West, US East) |
| 4 | QStash us-east-1 pinning and SDK default | CONFIRMED (SDK default is EU) |
| 5 | Railway Hobby cron; volumes optional; backups opt-in | CONFIRMED |
| 6a | CLI local Google OAuth keys | CONFIRMED |
| 6b | 15 minute OTP/link expiry configurable | CONFIRMED configurable; minimum NOT CONFIRMED |
| 6c | `auth.admin.generateLink` available | CONFIRMED; it does not send mail |
| 7 | Resend free 3,000/month, 100/day, verified domain | CONFIRMED |

## 1. Supabase Auth

**1a. Sign-up disabled blocks first-time Google sign-in: CONFIRMED.**
- `internal/api/external.go` (master, 2026-09-22), `case models.CreateAccount:` returns `ErrorCodeSignupDisabled` "Signups not allowed for this instance" when `config.DisableSignup`. `LinkAccount` and `AccountExists` branches have no such check.
- The same check is present in tags v2.100.0 and v2.150.0 (read via the GitHub API), so it is long-standing, not a recent change.
- The official page only says "If this config is disabled, only existing users can sign in" and does not name OAuth. https://supabase.com/docs/guides/auth/general-configuration (undated).
- The decision to keep sign-ups enabled and gate on a live activated Account is therefore sound.
- Residual: hosted behaviour equal to master is inferred from the release train, not tested. The memlog already says "test on staging"; keep that as a Story 1.x acceptance check.

**1b. `amr[].timestamp`: CONFIRMED.**
- Docs list `amr` as an array of `{method, timestamp}` with `oauth` among the methods; `auth_time` is not mentioned. https://supabase.com/docs/guides/auth/jwt-fields (undated).
- Source: `AddClaimToSession` is called from `IssueRefreshToken` (`internal/tokens/service.go:939`) with the sign-in method, upserting `mfa_amr_claims.updated_at`. `CalculateAALAndAMR` emits `Timestamp: claim.UpdatedAt.Unix()`. A refresh does not add a claim. A new OAuth sign-in creates a new session row (`GrantAuthenticatedUser`), so "new `session_id` plus an `oauth` entry at or after the start" is implementable as written.
- Implementation notes: the timestamp is Auth's clock at one-second resolution while the step-up start is the app's clock. Compare with floor(start) and a small skew allowance; the single-use nonce and the new-session requirement already prevent replay.

**1c. Query parameter passthrough: CONFIRMED. Effect at Google: NOT CONFIRMED.**
- supabase-js types `queryParams?: { [key: string]: string }` and appends it with `URLSearchParams` (`packages/core/auth-js/src/GoTrueClient.ts` ~5727).
- The Auth server forwards every query key except `scopes`, `provider` and a reserved list (client_id, client_secret, redirect_uri, response_type, state, code_challenge, code_challenge_method, code_verifier; `nonce` is explicitly allowed through) via `oauth2.SetAuthURLParam` (`external.go` ~70-90, `custom_oauth_admin.go` ~654). `prompt` and `login_hint` are therefore forwarded.
- Google documents `prompt` values `none`, `consent`, `select_account` only; `prompt=login` and `max_age` are not listed; `auth_time` is opt-in. The spine's statement that Google offers no documented forced re-authentication is correct. https://developers.google.com/identity/openid-connect/openid-connect (last updated 2026-06-15).
- **Gap (medium):** the same Google page says `login_hint` "suppresses the account chooser". The spine requires both `prompt=select_account` and the same `login_hint`. Google does not document which wins. If the hint wins and Google has a live session, the round trip can complete with no user interaction, and the spine's closing claim that the step-up "proves a deliberate new sign-in" is not established. If `select_account` wins, the claim holds and a wrong account fails the email check.
  - Fix, either: (a) test the combination on staging with a signed-in Google session and record the result; or (b) drop `login_hint` (the server already checks that the new session's verified email equals the acting Account) so `select_account` reliably shows the chooser; or (c) reword to "proves a new Supabase session for the same verified email, not user presence".

## 2. Anthropic

All CONFIRMED against platform.claude.com pages retrieved 2026-10-08 (undated; the deprecations page carries an entry dated 2026-09-30, so it is current).
- `claude-sonnet-5-5` is a current model: API ID `claude-sonnet-5-5`, $2 / input MTok and $10 / output MTok, 1M context, 128K max output, retirement not sooner than 2027-09-28. https://platform.claude.com/docs/en/about-claude/models/overview and https://platform.claude.com/docs/en/about-claude/model-deprecations
- `claude-sonnet-5` is listed under "Legacy models (still available)" on the overview page (the deprecations table labels its state "Active", retirement not sooner than 2027-06-30). The amendment's "Legacy" wording matches the overview page. Sonnet 5 is also $2/$10 (introductory pricing made permanent). https://platform.claude.com/docs/en/about-claude/pricing
- Thinking tokens are billed as output and count toward `max_tokens`; `max_tokens` "is enforced as a strict limit". https://platform.claude.com/docs/en/build-with-claude/thinking
- The "Cost control" section names only `max_tokens` (hard cap) and `effort` (soft guidance). There is no dollar-denominated per-request cap, so the spine's premise is correct. https://platform.claude.com/docs/en/build-with-claude/thinking-steering-and-cost
- Arithmetic checks: 200,000 x $2/M = $0.40; 16,000 x $10/M = $0.16; total $0.56, under the $1 operation ceiling. Brave 20 x $0.005 = $0.10.

Notes that do not contradict anything (low):
- `count_tokens` is documented as "an estimate"; actual input "might differ by a small amount". Models from 4.7 on use a tokenizer that yields about 30 percent more tokens than earlier ones. https://platform.claude.com/docs/en/build-with-claude/token-counting. The 200,000 input cap therefore needs a margin or a strict byte/character ceiling; the $0.44 headroom under the $1 ceiling covers it.
- US-only inference (`inference_geo: "us"`) carries a 1.1x multiplier on all token prices. If a receipt ever pins it, the worst case becomes about $0.62, still under $1. Record the multiplier in the rate snapshot.
- Sonnet 5.5 defaults to `high` effort with adaptive thinking; at a 16,000 token cap, thinking can consume the budget and end with `stop_reason: max_tokens` and a truncated, schema-invalid answer. Set `effort` explicitly in the adapter and treat that stop reason as a failed (still settled) call.

## 3. Backblaze B2

**3a. Lifecycle removing hidden versions: CONFIRMED on the native API.**
- `daysFromHidingToDeleting` deletes hidden versions after N days; rules "are applied once per day"; hide markers are removed when they are the oldest version; Object Lock blocks deletion. https://www.backblaze.com/docs/cloud-storage-lifecycle-rules (updated 2026-02-05).
- S3-compatible lifecycle (Put/Get/Delete lifecycle configuration) is supported, announced 2025-12-12: https://www.backblaze.com/blog/lifecycle-rules-now-supported-through-s3-compatible-apis/ . https://www.backblaze.com/apidocs/s3-put-lifecycle-configuration (undated) says versioning must be enabled, `Expiration Days` maps to hide, `NoncurrentVersionExpiration NoncurrentDays` maps to delete, and `AbortIncompleteMultipartUpload` maps to the large-file cancel field. The overview page https://www.backblaze.com/docs/cloud-storage-s3-compatible-api (undated) does not list lifecycle among unsupported features. This resolves the author's "S3-API lifecycle behaviour not confirmed" for existence of support.
- NOT CONFIRMED: no page names `daysFromHidingToDeleting` as the target of `NoncurrentDays`. Configure the lifecycle through the native API, B2 CLI or console and read it back, rather than depending on the S3 mapping.
- Design constraint to record (low): `daysFromUploadingToHiding` "applies to all of the copies of the file, even the most current version", and overlapping rules take the smallest value of each property. The 14 day dump rule must be scoped to a `dumps/` prefix and the 7 day hidden-version rule to a disjoint Storage-mirror prefix, or the dump rule would hide the mirror. Because rules run daily, "within 7 days" is in practice 7 to 8 days plus sync lag, still far inside 30.

**3b. Mirroring deletions: CONFIRMED.** rclone's native `b2` backend, on delete, makes the current version a hidden old version unless `--b2-hard-delete` is set, and `rclone cleanup` / `backend cleanup-hidden` can purge old versions. https://rclone.org/b2/ (undated). A source deletion in `rclone sync` therefore becomes a hide, and the lifecycle rule then removes it. What a bare S3 `DeleteObject` without `versionId` does on B2 is not documented on any page I could open; use the native backend.

**3c. Regions: CONFIRMED.** US West (Sacramento CA, Phoenix AZ) and US East (Reston VA); also EU Central and CA East. https://www.backblaze.com/docs/cloud-storage-data-regions (published 2025-02-27). The region is picked at account sign-up, applies to all buckets and cannot be changed afterwards (Backblaze help article, found by search; see the sources list). Select US East at sign-up to match the Virginia layout; the S3 region code (reported as `us-east-005`) is from a forum post only and is NOT CONFIRMED, but the bucket's Endpoint field shows it.

Supporting check on the source side: Supabase's S3 endpoint supports ListObjectsV2, ListObjects, HeadObject and GetObject, and does not support versioning or lifecycle. https://supabase.com/docs/guides/storage/s3/compatibility (undated). Supabase database backups "do not include objects you store via the Storage API". https://supabase.com/docs/guides/platform/backups (undated). Both support the amendment.

## 4. Upstash QStash

**CONFIRMED.**
- Two regions only. `QSTASH_URL` unset means the SDKs default to EU (`https://qstash.upstash.io`); US is `https://qstash-us-east-1.upstash.io`, and the token and signing keys are region-specific. `QSTASH_REGION=US_EAST_1` or `EU_CENTRAL_1` switches the SDK to region-prefixed variables (multi-region mode). https://upstash.com/docs/qstash/howto/multi-region (undated; memlog cites 2026-09-08).
- Verified in the installed package: `@upstash/qstash` 2.11.3 sets `DEFAULT_QSTASH_URL = "https://qstash.upstash.io"` and has `VALID_REGIONS = ["EU_CENTRAL_1","US_EAST_1"]`; `@upstash/workflow` 1.3.3 reads `QSTASH_URL` and `QSTASH_TOKEN` (node_modules in this repo).
- The spine's "set provider regions explicitly where the SDK default differs" is accurate. Add to the bootstrap checklist: US URL, US token and US signing keys together, and a startup assertion on the host name.
- Related: QStash Free is 1,000 messages/day and 10 active schedules; pay-as-you-go $1 per 100K messages. https://upstash.com/pricing/qstash (undated). The four periodic jobs named in AD-19 fit under 10 schedules. https://upstash.com/docs/qstash/features/schedules says cron runs in UTC and a new schedule can take up to 60 seconds to load.

## 5. Railway Hobby

**CONFIRMED.**
- Cron: set a crontab under the service's Settings, UTC, at least 5 minutes apart, the process must exit, and a run is skipped if the previous one is still active. https://docs.railway.com/reference/cron-jobs (undated). The page states no plan restriction. A Railway employee wrote "Cron jobs are available on the Hobby Plan" on 2026-01-09. https://station.railway.com/questions/cron-jobs-9be762dc . railway.com/pricing was behind a bot check and docs.railway.com/pricing/plans is silent on cron, so this rests on the docs plus the staff reply.
- Hobby is $5/month including $5 usage with a 5 GB default volume. https://docs.railway.com/pricing/plans (undated).
- Volumes are not required for a service, so leaving them unused is possible. Volume backups are opt-in ("can be scheduled" or triggered manually) with daily 6 days, weekly 27 days, monthly 89 days retention, so the 89 day figure and the reason for leaving them off are correct. https://docs.railway.com/volumes/backups (undated). The page does not say "disabled by default"; it says only that schedules are configured in the Backups tab. Treat "disabled" as a configuration to verify, not a default.
- Operational note (low, not in the spine): Supabase's direct database connection is IPv6-only unless the IPv4 add-on is bought (https://supabase.com/docs/guides/troubleshooting/supabase--your-network-ipv4-and-ipv6-compatibility-cHe3BP, undated), and Railway outbound IPv6 is opt-in per service (`railway outbound-network ipv6 enable`, https://docs.railway.com/cli/outbound-network, undated). The nightly `pg_dump` job should use the Supavisor session-mode pooler string, or enable outbound IPv6 first.

## 6. Supabase CLI local stack, OTP expiry, generateLink

**6a. Google keys: CONFIRMED.**
- `[auth.external.google]` with `enabled = true`, `client_id`, `secret = "env(SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_SECRET)"`, `skip_nonce_check = false`; local redirect URI `http://127.0.0.1:54321/auth/v1/callback`. https://supabase.com/docs/guides/auth/social-login/auth-google (undated) and https://supabase.com/docs/guides/local-development/cli/config (undated). The CLI config template at supabase/cli `e5f91a4` (2026-10-08) lists the same provider keys including `skip_nonce_check`.
- The CLI template defaults `[auth] enable_signup = true`, which agrees with the amended "stays enabled" rule. Note the template also has `[auth.email] enable_signup = true`; see 6c.

**6b. 15 minute expiry: configurable; minimum NOT CONFIRMED.**
- Setting exists as dashboard "Email OTP expiration", CLI `[auth.email] otp_expiry` (default 3600), and Management API `mailer_otp_exp`. https://supabase.com/docs/guides/auth/auth-email-passwordless (undated) warns against values above 86,400 seconds and gives no minimum. The Auth server code has no lower bound (`OtpExp` is only clamped at a huge maximum; `verify.go` compares against `config.Mailer.OtpExp`).
- Not found: any documented dashboard floor. 900 seconds is very likely accepted but I could not confirm it, and the author flagged the same ([ASSUMPTION] A6).
- The setting is global: it also governs confirmation, invite, recovery and magic-link tokens.
- Recommended: enforce the 15 minute window in nova3D as well (record issuance time server-side and reject later use), and set Supabase's value at or below it, so the spine does not depend on an unverified dashboard minimum. Verify on staging.

**6c. `auth.admin.generateLink`: CONFIRMED available; delivery path needs wording.**
- The API exists with types signup, invite, magiclink, recovery, email_change_current and email_change_new, and is described as "Generates email links and OTPs to be sent via a custom email provider". https://supabase.com/docs/reference/javascript/auth-admin-generatelink (undated). Source (`internal/api/mail.go` `adminGenerateLink`) returns `action_link`, `email_otp` and `hashed_token` and sends no email; it has no sign-up check; token lifetime comes from `config.Mailer.OtpExp`. `recovery` returns 404 for an unknown email, while `magiclink` for an unknown email silently creates a user, so use `recovery` or ensure the Administrator row exists first.
- **Gap (medium):** AD-12 says the link is "issued by a server route ... over custom SMTP". `generateLink` does not use Supabase's SMTP setting at all; the app must send the message itself (Resend HTTP API or SMTP). The Supabase-sent path (`signInWithOtp`, `/recover`) requires the Email provider to be enabled (`magic_link.go`, `middleware.go requireEmailProvider`), and with the global sign-up toggle on and the Email provider on, `POST /auth/v1/signup` with an email and password would also be accepted, which cuts against "there are no passwords" at the Auth layer. The Email provider is a separate toggle (`[auth.email] enable_signup` locally; the CLI template default is true).
- Fix: state in AD-12 or AD-19 that the Email provider stays disabled in every environment and that the recovery link is minted with `generateLink` and sent by the app through Resend. In source, `/verify` has no Email-provider check, so the link should still redeem; that is a code reading of master and should be confirmed on staging.
- Supabase's built-in SMTP is team-members only at 2 messages/hour with no SLA, as the memlog says. https://supabase.com/docs/guides/auth/auth-smtp (undated).
- `auth.admin.deleteUser(id, shouldSoftDelete)` exists, service-role only, defaults to hard delete; use hard delete for the dormant-identity job so FR-30 holds. https://supabase.com/docs/reference/javascript/auth-admin-deleteuser (undated).

## 7. Resend free tier

**CONFIRMED.** Free plan: 3,000 emails/month, 100/day, 3 domains, 30 day data retention, no overage. https://resend.com/pricing (undated). The daily quota is free-plan only, resets at midnight UTC, and counts sent and received mail; the default API limit is 10 requests/second. https://resend.com/docs/api-reference/rate-limit (undated). A verified domain is required to send to arbitrary recipients: the Supabase SMTP guide lists "A verified domain" as a prerequisite (https://resend.com/docs/send-with-supabase-smtp, undated; host `smtp.resend.com`, port 465, username `resend`, password is the API key), and the `resend.dev` sandbox "can only send emails to the email address associated with your Resend account". https://resend.com/docs/knowledge-base/403-error-resend-dev-domain (undated). Observation: if the configured Administrator address is the Resend account owner's address, the sandbox would deliver without a domain; A5's revisit condition already covers the no-domain case.

## Other newly relied-on claims (spot checks)

| Claim | Status | Source |
|---|---|---|
| Brave Search $5 per 1,000 requests, $5 monthly free credit; storage needs a plan that grants it | CONFIRMED | https://brave.com/search/api/ (undated) |
| Brave ToS 3(b) bars storing, caching or building a database of results other than transient storage, and AI-improvement use | CONFIRMED | https://api-dashboard.search.brave.com/terms-of-service (last updated 2026-09-01) |
| Vercel Hobby is non-commercial personal use only; 300 s function limit | CONFIRMED | https://vercel.com/docs/plans/hobby (last_updated 2026-09-14) |
| Supabase Pro from $25/month with $10 compute credit; 100 GB files, 250 GB egress, daily backups 7 days; plans cannot mix in one org | CONFIRMED | https://supabase.com/pricing and https://supabase.com/docs/guides/platform/billing-on-supabase (both undated) |
| Sefaria v3 texts for Mishnah Middot 3: Torat Emet 357 (he, Public Domain) and Mishnah Yomit (en, CC-BY), 8 segments each | CONFIRMED by live probe 2026-10-08T13:38Z | `https://www.sefaria.org/api/v3/texts/Mishnah_Middot.3?...` |
| Staging project about +$10/month | not re-checked here; memlog cites Supabase compute docs (2026-05-25) | n/a |
| Tessellation deflection 0.002 mm / 0.1 rad "counted as R-2's approximation bound" | NOT CONFIRMED as a guarantee | see below |

**Tessellation (medium).** The OCCT meshing guide says linear deflection "limits the distance between a curve and its tessellation" and angular deflection limits segment angle, but it does not state a guaranteed mesh-to-surface bound, and notes that a deflection below the shape tolerance is replaced by the shape tolerance; faces with self-intersecting wires can be excluded. https://occt3d.com/dev/doc/overview/html/occt_user_guides__mesh.html (undated; redirected from dev.opencascade.org). The CadQuery export tolerances I could read default to 0.1 and 0.1 (Assembly export). The ratified text rightly calls the values "assumptions pending fixture evidence"; keep that framing and require G-2 to measure the realised maximum mesh-to-solid distance rather than count the nominal deflection as a certified term of the 0.01 mm budget. No web research backs these starting values; they are engineering choices, not verified facts.

## Findings to resolve before handoff

| Severity | Item | Action |
|---|---|---|
| Medium | `prompt=select_account` plus `login_hint`: Google documents that `login_hint` suppresses the chooser; the "deliberate sign-in" claim is unproven | Test on staging, or drop `login_hint`, or reword the guarantee (section 1c) |
| Medium | Recovery email path: `generateLink` sends nothing; Supabase custom SMTP applies only to Supabase-sent mail, which needs the Email provider on and would open email sign-up | State Email provider disabled; app sends the minted link via Resend (section 6c) |
| Medium | 15 minute link lifetime relies on an undocumented dashboard minimum | Enforce server-side as well; verify on staging (section 6b) |
| Medium | OCCT deflection treated as a certified bound | Measure in G-2; do not certify from nominal settings (tessellation note) |
| Low | B2 S3 lifecycle field mapping not named; prefix scoping of 14 day and 7 day rules | Configure via native API/CLI; disjoint prefixes (section 3a) |
| Low | Railway Hobby cron rests on docs plus a staff forum reply; pricing page not readable | Confirm in the dashboard at provisioning (section 5) |
| Low | Hosted Auth equal to master; Supabase direct connection IPv6 from Railway | Staging tests; use the session pooler for `pg_dump` (sections 1a, 5) |
| Low | Token-count estimate and `inference_geo` multiplier in the Anthropic bound | Add margin and record the multiplier (section 2) |

## Sources (retrieved 2026-10-08 unless noted)

- https://supabase.com/docs/guides/auth/general-configuration ; https://supabase.com/docs/guides/auth/jwt-fields ; https://supabase.com/docs/guides/auth/social-login/auth-google ; https://supabase.com/docs/guides/local-development/cli/config ; https://supabase.com/docs/guides/auth/auth-email-passwordless ; https://supabase.com/docs/reference/javascript/auth-admin-generatelink ; https://supabase.com/docs/reference/javascript/auth-admin-deleteuser ; https://supabase.com/docs/guides/auth/auth-smtp ; https://supabase.com/docs/guides/platform/backups ; https://supabase.com/docs/guides/storage/s3/compatibility ; https://supabase.com/pricing ; https://supabase.com/docs/guides/platform/billing-on-supabase ; https://supabase.com/docs/guides/troubleshooting/supabase--your-network-ipv4-and-ipv6-compatibility-cHe3BP (all undated)
- Source clones: https://github.com/supabase/auth (`ce9a8ee`, 2026-09-22; tags v2.100.0, v2.150.0, v2.197.0 of 2026-09-09), https://github.com/supabase/supabase-js (`84e2c5d`, 2026-10-07), https://github.com/supabase/cli (`e5f91a4`, 2026-10-08)
- https://developers.google.com/identity/openid-connect/openid-connect (last updated 2026-06-15)
- https://platform.claude.com/docs/en/about-claude/models/overview ; /about-claude/pricing ; /about-claude/model-deprecations ; /build-with-claude/thinking ; /build-with-claude/thinking-steering-and-cost ; /build-with-claude/token-counting (all undated)
- https://www.backblaze.com/docs/cloud-storage-lifecycle-rules (2026-02-05) ; https://www.backblaze.com/blog/lifecycle-rules-now-supported-through-s3-compatible-apis/ (2025-12-12) ; https://www.backblaze.com/blog/a-deeper-look-at-s3-compatible-lifecycle-rules-in-backblaze-b2/ (2026-02-05) ; https://www.backblaze.com/apidocs/s3-put-lifecycle-configuration (undated) ; https://www.backblaze.com/docs/cloud-storage-s3-compatible-api (undated) ; https://www.backblaze.com/docs/cloud-storage-data-regions (2025-02-27) ; https://help.backblaze.com/hc/en-us/articles/360034620773-How-can-I-set-up-my-account-in-the-EU-region (region fixed at sign-up, via search summary, page not opened) ; https://rclone.org/b2/ (undated)
- https://upstash.com/docs/qstash/howto/multi-region ; https://upstash.com/pricing/qstash ; https://upstash.com/docs/qstash/features/schedules (undated)
- https://docs.railway.com/reference/cron-jobs ; https://docs.railway.com/pricing/plans ; https://docs.railway.com/volumes/backups ; https://docs.railway.com/cli/outbound-network ; https://station.railway.com/questions/cron-jobs-9be762dc (employee reply 2026-01-09)
- https://resend.com/pricing ; https://resend.com/docs/api-reference/rate-limit ; https://resend.com/docs/send-with-supabase-smtp ; https://resend.com/docs/knowledge-base/403-error-resend-dev-domain (undated)
- https://brave.com/search/api/ ; https://api-dashboard.search.brave.com/terms-of-service (2026-09-01) ; https://vercel.com/docs/plans/hobby (2026-09-14)
- https://occt3d.com/dev/doc/overview/html/occt_user_guides__mesh.html ; https://cadquery.readthedocs.io/en/latest/classreference.html (undated)
- Sefaria live API probe, 2026-10-08T13:38Z
