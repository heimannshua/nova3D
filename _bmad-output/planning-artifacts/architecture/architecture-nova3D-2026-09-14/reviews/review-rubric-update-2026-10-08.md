---
type: reviewer-gate
lens: rubric-walker
subject: ARCHITECTURE-SPINE.md and RATIFIED-DECISIONS.md amendments dated 2026-10-07 (update run)
reviewed: 2026-10-08
status: complete
---

# Rubric review of the 2026-10-07 amendments

Scope: the diff of `ARCHITECTURE-SPINE.md` and `RATIFIED-DECISIONS.md` against HEAD (AD-5, AD-8, AD-11, AD-12, AD-15, AD-19, Stack rows, G-6; R-2, R-5, R-6, R-9), checked against the rest of both files, `.memlog.md` (entries of 2026-10-07), `epics.md`, the story specs/inputs, and the brownfield root app. Spine lines are `ARCHITECTURE-SPINE.md:N`, ratified lines `RATIFIED-DECISIONS.md:N` (RD), memlog lines `.memlog.md:N`.

## Verdict

The amendments close the architecture-owned readiness items well and keep AD IDs stable, but three divergence points are left open (ownership and storage of the new auth records, non-Google provider/recovery-mailer state once sign-ups are on, direct-mode print scale/orientation) and the epics and story artifacts still carry the pre-amendment wording. No critical finding. Fix the three high findings in the spine and RD, then propagate to epics.

## What is sound

- AD-5 free mode closes readiness finding 2 coherently: registry-bounded discovery, deterministic extractors, a separate omission scan, gaps feeding the FR-14 offer, and a fallback to free behaviour when no paid category is granted. It does not weaken AD-4 or R-7.
- AD-11 arithmetic checks: 200,000 x $2/M + 16,000 x $10/M = $0.56 (under the $1 operation ceiling); 20 x $0.005 = $0.10. The R-9 cost total (about $35-40, about $55-60 with Vercel Pro) adds up from the stated line items.
- Model identity: `claude-sonnet-5-5` at $2/$10 per MTok matches the local claude-api skill table (cached 2026-10-06), which also lists `claude-sonnet-5` as still served. The memlog's "Legacy" label is consistent with that.
- AD-12 sign-up reasoning is internally consistent with the memlog evidence (disabling sign-up blocks every first-time Google sign-in; the live-Account check remains the gate). AD-15 stays vendor-neutral ("separate private object store"); B2 is named only in R-9 and the Stack table.
- AD-8 tolerance budget is consistent between spine and RD (0.002 + 0.002 = 0.004 of 0.01 mm). The 88 mm default scale is orientation-invariant for axis-aligned rotations because the profile volume is a cube.
- No amendment contradicts AD-1 to AD-4, AD-6, AD-7, AD-9, AD-10, AD-13, AD-14, AD-16 to AD-18 or R-1, R-3, R-4, R-7, R-8, R-10, R-11.

I did not contact the web (instruction). B2, Resend, Supabase, Google, Brave and Vercel facts are taken from the memlog's 2026-10-07 verification entries; only the model ID and price were cross-checked locally.

## Findings

### High

**H1. New AD-12 records have no owning module and no specified store (AD-2 violation by omission).**
`ARCHITECTURE-SPINE.md:118` introduces a single-use step-up nonce, a 5-minute fresh-authentication marker bound to a session, a single-use 15-minute recovery token, and (with `:160`, `:136`) dormant-purge and backup run records. AD-2 (`:58`) says the ownership table assigns "each record family exactly one module", but the Identity row (`:251`) lists only "Account status, session grants, invitations/redemptions, admin capabilities, recovery audit". The marker is never said to live in Postgres. The natural implementation is a TTL key in Redis, which the Stack row (`:214`: "Rate limiting and disposable coordination/cache only") and AD-2 ("Redis ... cannot authorize business transitions") forbid, because the marker authorizes deletion and instance closure.
Fix: add to the Identity row "step-up nonces, fresh-authentication markers, recovery tokens (hashed, single-use)" and to Lifecycle/Jobs "periodic-job run receipts"; add to AD-12 "nonce and marker are Postgres rows consumed or checked inside the sensitive command's transaction".

**H2. After sign-ups were re-enabled, AD-12 no longer says which Auth providers are on, nor how the recovery token is minted and mailed.**
`ARCHITECTURE-SPINE.md:118` keeps "there are no passwords" but drops the global sign-up switch that previously made that true by configuration (memlog `.memlog.md:90`: disabling sign-up also blocks /signup, OTP and magic link). With sign-up on, the default Supabase Email provider can accept anonymous /signup and OTP requests and send mail to arbitrary addresses through the same custom SMTP that carries the Administrator recovery link (Resend free tier is 100/day per `.memlog.md:100`; Supabase custom SMTP defaults to a low hourly cap per `.memlog.md:92`). An anonymous caller can therefore exhaust the quota that recovery depends on. Separately, "issued by a server route over custom SMTP" does not say whether the link is a Supabase `generateLink`/`verifyOtp` token (needs the Email provider enabled) or an application-minted token plus an admin-minted session. That choice decides whether the provider must be on, so two stories can diverge (1.4 and 1.6). The recovery request route is unauthenticated, but the only rate limit named (`:118`) is for invitation attempts.
Fix: add "Google is the only enabled Auth provider in every environment (email, phone, anonymous and magic-link off; asserted in `supabase/config.toml` and CI)"; name the recovery primitive (recommended: application-minted hashed token in Postgres, sent by the server through the SMTP provider, redeemed by an admin-minted session; confirm on staging); add "recovery issuance is rate-limited and at most one link is outstanding".

**H3. AD-8 print-scale and orientation defaults are undefined for `image_direct` models, and the domain-package contract does not declare a base face.**
`ARCHITECTURE-SPINE.md:94` defines the default orientation as "the domain package's declared base face on the plate" and the scale from the model bounding box in millimetres. Image-derived meshes (AD-3 mode `image_direct`, AD-6 mesh snapshots) have no domain package, no declared base face and no trusted unit. Readiness finding 6 (`implementation-readiness.md`, "Unrecorded engineering defaults") lists "physical units for direct-mode meshes" as an open architecture item; the update closed its siblings (tessellation, scale, orientation) but not this one. The domain-package contract line (`:298`) also does not list a declared base face, so the Middot generator and Story 4.2 can diverge from the validator.
Fix: add to AD-8 "an image-derived model has no print scale until the user confirms a real-world dimension for the confirmed scope; its default orientation is the largest planar face on the plate, user-confirmed" (or state that this is deferred to Stories 7.3/7.6 with that owner and that qualified export is blocked until set); add "declared base face" to the `packages/domains/middot` contract line.

### Medium

**M1. The AD-11 input-token cap is not provably enforceable as written.**
`ARCHITECTURE-SPINE.md:112` and `RD:67` bound a call at 200,000 input tokens, but `.memlog.md:86` records that `count_tokens` is only an estimate and "is not trusted as the bound", and the spine names no other method. Output is bounded by the API (`max_tokens`, thinking included); input is not. Also not covered: Sonnet 5.5 refusals are billed and the server-side `fallbacks` parameter would re-run on a differently priced model (local claude-api skill: "rescue bills at the fallback model's own rates"), which breaks the single-model rate snapshot.
Fix: define the input bound as a conservative computable maximum (UTF-8 bytes for text; the documented image-token formula after nova3D's own downscale) with `count_tokens` as a cross-check only, and add "server-side fallbacks, speed and any parameter not in the options snapshot are unsupported; a refusal settles at its usage block".

**M2. The new ambiguous-charge sentence narrows R-6.**
`ARCHITECTURE-SPINE.md:112`: "A call with no response settles at its reserved maximum unless matching usage evidence arrives." `RD:65` and `RD:71` allow three exits (usage evidence, conservative maximum settlement, documented noncharge) and say ambiguous calls "hold" the reservation until one occurs. The new text drops documented noncharge, does not say when settlement happens, and does not classify definitive failures (4xx with a request-id) versus ambiguous ones (timeout, 5xx, aborted stream; billing of aborted streams is "NOT confirmed" at `.memlog.md:86`). It also does not say whether calls are streamed.
Fix: restate as "transport loss, timeout, 5xx or an aborted stream is ambiguous and holds the reservation; definitive pre-processing rejections with a request-id are documented noncharge; use non-streaming Messages calls".

**M3. AD-8 does not state the frame of the 0.002 mm deflection, and "certified" overstates a nominal tessellation setting.**
`ARCHITECTURE-SPINE.md:94`, `RD:33`. The altar is metres across and is scaled to under 88 mm, so applying 0.002 mm in canonical millimetres versus final-print millimetres differs by about two orders of magnitude in mesh size (the memlog admits the size is "unproven", `.memlog.md:101`). OCCT linear deflection is a meshing target, not a guaranteed bound, yet `RD:33` calls it "the certified approximation bound".
Fix: add "deflection is applied in final-print-frame millimetres after the pinned transform" and "until G-2 verifies achieved deviation on the fixture corpus, the validator records measured maximum deviation and uses the larger of nominal and measured"; mention the untuned defaults in the G-2 row (`:331`, `RD:122`).

**M4. The AD-19 periodic-work rule is ambiguous and partly self-defeating, and RPO is overstated.**
`ARCHITECTURE-SPINE.md:160`: "queue schedules or the worker platform, never from a platform cron whose plan limits could silently drop it". Railway cron (the memlog's chosen backup host, `.memlog.md:98`) is a platform cron. QStash schedules on Upstash Free (`RD:97`, 1,000 messages/day shared with Jobs per `.memlog.md:94`) are exactly a plan limit that can drop periodic work. The monitor list in the same rule omits backup age and dormant-purge success. A single nightly job with nonzero run time yields a worst-case loss window of 24 h plus the run duration, so "which yields the RPO of 24 hours or less" (`RD:97`) is not strictly true.
Fix: name the hosts (QStash schedule invoking an idempotent route, or a Railway cron service; Vercel cron not used), require a run receipt per task, add "age of newest completed backup snapshot" and "last dormant-purge success" to the monitored set, and run the backup at least twice daily or measure RPO as snapshot age.

**M5. AD-15's backup sink holds all private data with no protection or scope rule, and its open items are not carried into the spine.**
`ARCHITECTURE-SPINE.md:136`. The logical dump contains the whole `auth` schema (emails, sessions, refresh tokens) and every private row; it exists transiently on a Railway disk and persistently in B2. The rule does not require encryption with a key held outside the bucket, a write-only job credential, deletion of local copies, or an explicit dump scope (application schemas plus auth and storage metadata, otherwise restore loses identities). B2 becomes a private-data processor with an unchosen region and unconfirmed S3-lifecycle behaviour; `RD:97` records these as "Not confirmed", but the spine's Deferred text (`:346`), the bootstrap-acceptance list (`:342`) and the G-9 row (`:338`) do not, and AD-19's "verify provider residency/retention before enabling private work" is the only hook.
Fix: add the protection and scope clauses to AD-15; add "B2 region, lifecycle behaviour, restore from B2, Supabase backup time versus RPO" to G-9 and the bootstrap-acceptance sentence.

**M6. Dormant-identity purge races registration, and the Story 1.3 seed is a second provisioning path the AD does not mention.**
`ARCHITECTURE-SPINE.md:118`. A purge at day 30 can delete an Auth identity while registration is claiming an invitation for it; nothing says the delete is conditional on "no Account or in-flight claim" in the same transaction, nor that the Account FK is ON DELETE RESTRICT. The verification list (`:344`) lists concurrent invitation redemption but not purge-versus-register. Story 1.3 (`epics.md` Story 1.3 scope) provisions the Administrator and the second allowlisted identity "through a documented, audited seed", but AD-12 says one narrow registration service provisions Accounts.
Fix: add "purge is a conditional delete under the registration lock; Account to Auth FK restricts deletion; the audited seed calls the same provisioning function"; add both seams to `:344`.

**M7. The step-up mechanism leaves binding details open.**
`ARCHITECTURE-SPINE.md:118`. Not stated: the nonce is bound to the initiating session, Account and the OAuth `state`; what happens to the old session after the new `session_id` is created (its grant stays valid or is revoked); whether the 5-minute marker covers several actions or one; and whether a session obtained by the recovery link counts as fresh. The mechanism is also not in the seams list (`:344`) and its two unconfirmed premises (hosted `amr` timestamps, new `session_id` on a repeat sign-in) have no staging test or gate.
Fix: add the four bindings and a staging acceptance test to G-6/Story 1.4 text; consider renaming the property "step-up sign-in" in user-facing copy since it does not prove a credential re-check (the AD already says so).

**M8. Provenance and currency of the 2026-10-07 amendments are not visible in the artifacts.**
The memlog (`.memlog.md:102`) tags A1 to A11 as `[ASSUMPTION]`s made on Josh's behalf under "go with your leans" (per-call caps, staging = existing cloud project, per-environment OAuth clients, Vercel Hobby, Resend with a verified domain, 15-minute and 5-minute windows, 30-day purge, B2 region, Railway cron, tessellation values). The spine and RD present them as binding without markers except the R-2 amendment. Also stale: spine `updated: 2026-09-14` (`:10`) against RD `updated: 2026-10-08` (`RD:5`); Verification Sources "Checked 2026-09-14" (`:350-358`) with no sources for Anthropic pricing, Brave, Google OIDC, Supabase jwt-fields/auth-smtp/backups scope, B2, Resend; `RD:57` says "keep G-5 PARTIAL" while the gate rows say BLOCKED (`:334`, `RD:125`).
Fix: add one line to the RD preamble ("amendments of 2026-10-07 carry assumptions A1 to A11, revisit at first staging provisioning"), update the frontmatter date, extend Verification Sources, and change "keep G-5 PARTIAL" to "G-5 stays BLOCKED until at least one named device class is covered, then PARTIAL".

**M9. Operational-envelope items that exist only in the memlog.**
Dimensions the altitude owns that are neither decided, deferred nor open in the spine or RD: an owned domain (needed for the Resend sending domain and the production callback origin; memlog A5 says arbitrary-recipient sending requires one); Google OAuth consent-screen publishing status per environment (Testing mode would block invitees who are not listed test users); alert routing and owner for the AD-19 monitors; provider-side spend backstops (a dedicated Anthropic workspace limit; Brave prepaid credit with no auto-recharge, `.memlog.md:86-87`); where migrations are applied (CI versus deploy).
Fix: list them under Deferred or as open questions with an owner, and add the domain and consent-screen status to the bootstrap-acceptance sentence (`:342`).

**M10. Epics and story artifacts still carry pre-amendment wording (see the table below).** These are expected to be fixed in the propagation step; listed here because they contradict the amended text now.
Fix: apply the table edits and add the missing story ownership noted after it.

### Low

- **L1. Spine contradicts the brownfield app in two places.** `ARCHITECTURE-SPINE.md:26` ("No parent architecture spine or application implementation exists") and `:222` ("No app dependencies were changed by this architecture task") sit beside `:290` (the app lives at the repository root; a mock-dashboard shell with `app/`, `components/`, `lib/`, `proxy.ts` and Next 16.3.5 exists). Fix: reword `:26` to "no parent architecture spine exists; the root application is a synthetic shell".
- **L2. R-9 amendment sits against its own preceding sentence.** `RD:95` says "Select the smallest paid production tiers"; `RD:97` starts Upstash on Free and Vercel on Hobby ($0). Fix: add "except where the amendment names a free tier".
- **L3. Override rule for print scale is missing.** `ARCHITECTURE-SPINE.md:94` and `RD:33` give only the default; the memlog (`.memlog.md:101`) says the user may choose a smaller scale and may not exceed the profile. Fix: add that sentence.
- **L4. Paid expansion ordering and a disabled search adapter.** `ARCHITECTURE-SPINE.md:76` says paid expansion is triggered by gaps, but FR-14 lets a Project be set to paid up front; it does not say free mode always runs first, nor what is offered while the Brave adapter is disabled (`RD:67`). Fix: add "free mode always runs first; paid categories apply to unresolved items; a disabled adapter removes only its category from the offer".
- **L5. AD-11 wording.** `ARCHITECTURE-SPINE.md:112` keeps "a provider with no enforceable maximum ... cannot be enabled" next to "providers expose no enforceable per-request dollar cap". Fix: say "no maximum computable by nova3D's preflight".
- **L6. Brownfield items to be reconciled by stories, not by the spine.** `.env.local` points at the hosted project while AD-19 now says local never uses a cloud project; `docs/auth-setup.md` and `.env.example` still use `AUTH_ALLOWED_EMAILS`; `supabase/config.toml` has no `[auth]` block; `scripts/check-env.mjs` checks only the `APP_ENV` label, not an immutable environment ID. The spine ratifies the right direction; Stories 1.1 and 1.4 must carry these.

## Contradictions and stale wording elsewhere

| Where | Old wording | New (spine/RD) | Tier |
| --- | --- | --- | --- |
| `epics.md:649` (AR-17); copies: `specs/spec-nova3D-story-2-5/implementation-constraints.md:59`, `story-3-7/implementation-constraints.md:84`, `story-2-8/implementation-constraints.md:70`, `story-inputs/story-2-5.json:73`, `story-3-7.json:93`, `story-2-8.json:79` | "Anthropic Messages claude-sonnet-5" | `claude-sonnet-5-5` (`RD:65`); rates and per-call caps (`RD:67`); Brave adapter disabled until terms review | Medium |
| `epics.md:1520` (Story 1.4 scope); copies: `specs/spec-nova3D-story-1-4/acceptance-criteria.md:21`, `story-inputs/story-1-4.json:28` | "Fresh authentication ... means Google re-authentication within the fresh-authentication window" | Server-controlled step-up (nonce, `prompt=select_account`, new `session_id`, `amr` oauth timestamp), 5-minute marker; Google has no documented forced re-authentication (`:118`) | Medium (an implementer would look for `prompt=login`/`max_age`) |
| `epics.md:1594` (Story 1.6 scope), `:653` (AR-18), `:107` (FR text); copies: `specs/spec-nova3D-story-1-6/acceptance-criteria.md:20`, `story-inputs/story-1-6.json:27`, several `implementation-constraints.md`; PRD `prd.md:108`, `:497` | "short-lived" recovery link, TTL undefined | Single-use, 15 minutes, server route for the configured Administrator email only, custom SMTP (`:118`) | Low (not contradicted, undefined) |
| `epics.md:685` (AR-26) | "Adopt ... nearest available Upstash with actual paid plans/topology recorded" | Local uses the Supabase CLI stack; staging and production are separate projects; per-environment Google OAuth clients; QStash set to us-east-1; named tiers (`:160`, `RD:97`) | Low |
| `epics.md:2033-2070` (Story 3.1 scope, AC-3), `:2251-2286` (Story 3.7) | Discovery "through constrained acquisition"; "low-authority page" leads | Free mode has no open-web search; discovery is the pinned registry only (`:76`) | Medium |
| `epics.md:1957-1992` (Story 2.9), `:1804-1842` (Story 2.5), `:1843-1881` (Story 2.6) | Single free/paid toggle; no per-call caps | Free mode = governing-source research; paid = two separate categories; 200,000/16,000/20-request caps and rate snapshot (`:112`, `RD:67`) | Medium |
| `epics.md:1393-1429` (Story 1.1) | No mention of re-pointing local dev | Local must run the Supabase CLI stack (`:160`); `.env.local` currently targets the hosted project | Low |
| `epics.md:3439-3470` (Story 8.4) | Nightly backup and restore owned in Epic 8 | Independent backup (dump plus Storage sync) is needed before any production private data exists, which starts at Story 2.2 | Medium (sequencing) |

`epics.md` has no remaining "disable public sign-up" wording (AR-18 and Story 1.3 were already corrected); the phrase survives only in `sprint-change-proposal-2026-10-07.md:80` and `implementation-readiness.md:40` as history.

Missing story ownership for amended behaviour: the research-engine port with deterministic extractors and the omission scan (nearest is Story 3.3, which names only the checklist and review); the dormant-identity purge job; the periodic-job scheduler; the nightly dump and Storage sync (see above); SMTP/domain provisioning for recovery (Story 1.6); staging and production project provisioning (Story 8.7 mentions acceptance only).

## Checklist result

| Rubric item | Result |
| --- | --- |
| Fixes the real divergence points, misses none | Mostly; misses H1, H2, H3 and the M-tier binding details |
| Each AD Rule enforceable and prevents its stated divergence | AD-5, AD-15 (as to retention) yes; AD-11 input bound, AD-12 provider state and step-up bindings, AD-19 periodic work no (M1, H2, M7, M4) |
| Nothing under Deferred lets two units diverge | Not met: operational items live only in the memlog (M9) |
| Named tech verified-current | Model ID and price confirmed locally; other claims rest on memlog entries; Verification Sources not extended (M8) |
| Ratifies the brownfield, no contradiction | Two stale statements (L1); `AUTH_ALLOWED_EMAILS`, cloud `.env.local` and the stub `config.toml` are consistent with the plan to replace them (L6) |
| No new text weakens or contradicts an existing AD or R-n | One narrowing (M2), one internal tension (L2) |
| Operational/environmental envelope decided, deferred or open | Environments, regions, tiers, backup and costs are decided; domain, consent screen, alerting, spend backstops and migration path are not (M9) |
