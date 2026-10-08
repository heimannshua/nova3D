---
type: reviewer-gate
lens: adversarial
subject: ARCHITECTURE-SPINE.md and RATIFIED-DECISIONS.md, 2026-10-07 update (uncommitted diff against HEAD)
date: 2026-10-08
read-only: spine, RATIFIED-DECISIONS.md and .memlog.md were not edited
external-verification: none (no external services); provider behaviour I could not confirm from the memlog is marked (verify)
---

# Adversarial review: 2026-10-07 update

## Verdict

Not ready to hand off as written. There are no critical defects, but five high-tier gaps (step-up binding, Google-only and recovery enforceability under open sign-ups, the registration surface, backup-mirror failure, print-scale and tessellation frame). Each is closed by a one-to-three-sentence AD edit, and each lets two units that both obey the text build incompatible or unsafe code.

## Findings at a glance

| ID | Tier | Area | One line |
| --- | --- | --- | --- |
| F1 | High | AD-12 step-up | Nonce and marker are not bound to a browser or to the minted session. A stolen session can be made fresh by phishing, and the fate of the pre-step-up session and the new session's grant is unspecified. |
| F2 | High | AD-12 sign-ups on, recovery | "Google is the only credential" is unenforceable while other providers sit at defaults. A recovery route written per the Supabase SSR pattern is a confused deputy that signs in non-Administrators and revokes Administrator sessions on demand. |
| F3 | High | AD-12 registration | Any Google user now holds an `authenticated` JWT, so registration reachable from the browser bypasses the Redis limiter, and identity-keyed limits are free to evade. |
| F4 | High | AD-15 / R-9 backup | A failed or partial mirror run silently leaves deleted data in B2 forever, or destroys the only independent Storage copy. The job holds database-owner and RLS-bypassing storage keys, with no immutability or freshness alarm. |
| F5 | High | AD-8 / R-2 | "Largest uniform scale that fits" read per artifact is exactly the best-fit rescaling R-2 forbids and hides uniform dimensional error. The 0.002 mm deflection has no frame, which is a 28x to 360x error for metre-scale models. |
| F6 | Medium | AD-12 dormant purge | The age-only predicate races an in-flight registration and can delete or orphan an activated Account. |
| F7 | Medium | AD-11 caps | The reservation can be the constant $0.56 or the measured size. The input cap is not enforceable without the provider. Evidence above the reservation is unhandled. "Operation" means one call for Anthropic and up to 20 for Brave. |
| F8 | Medium | AD-15 restore | Lifecycle clocks run from upload and hide, not from deletion. A re-dump during a restore extends exposure to about D+28. Dump versus sync order can leave manifests without bytes. The ledger has no home. |
| F9 | Medium | AD-15 restore | The ledger replays deletions only. A restore reverts disables, revoked grants, consumed or rotated codes and recovery revocations. |
| F10 | Medium | AD-12 step-up | The 5-minute marker is a bearer for every sensitive class, including irreversible close-instance. |
| F11 | Medium | AD-12 recovery | A recovery session can never satisfy an `oauth`-only step-up, and every admin capability needs fresh auth, so a recovered Administrator can do nothing. |
| F12 | Medium | AD-19 / Story 1.1 | Several things the amendment now requires are not in Story 1.1 or any story, and the live Vercel production deployment conflicts with the new rule. |
| F13 | Medium | AD-5 | The free-mode omission scan covers quantities only, so the "complete" claim can be false for placement and material items. |
| L1-L6 | Low | various | See the end of this file. |

---

## High

### F1. AD-12 step-up: the binding of nonce, marker and session is open

**Units and actors**
- Unit X: the step-up route, plus the consumers of the fresh marker (Stories 1.3, 1.5, 8.2).
- Unit Y: the sign-in callback and session-grant issuance (Story 1.4).
- Attacker T: holds a stolen session A (a cookie or token copy). T has no Google credential.

**What each does, spec-compliant**
- X reads "stores a fresh-authentication marker bound to that session" as the requesting session A. This is the common "reauth upgrades the current session" shape. `start` stores nonce N = (Account, A, T0) and redirects to Google with `prompt=select_account` and `login_hint`. The callback checks a new `session_id` B with an `oauth` amr entry at or after T0 and the same email, then marks A fresh. Every clause in AD-12 is satisfied.
- Y mints a grant only in the normal sign-in route.

**Defect 1: forced step-up that makes a stolen session fresh**
- T calls `start` with A. T sends the step-up URL to the Administrator as a "re-confirm your sign-in" link. The Administrator completes Google in their own browser, and the callback runs there.
- N is not tied to the browser that started it, so the server sees "new session B at or after T0, same email" and marks A fresh.
- T then has 5 minutes of fresh authority (invitations, disable, close-instance) with one victim click and no credential.

**Defect 2: the other reading is also broken**
- If the marker goes on B, Y never issued B a grant. Every private request then fails closed, so the Administrator's step-up logs them out.
- If X issues B a grant and leaves A's grant, a stolen A survives the Administrator's own step-up. Two live grants exist per Administrator, and "recovery revokes previous Administrator sessions" revokes only what it can enumerate.
- AD-12 never says what happens to the pre-step-up session.

**Defect 3: second tab, nonce lifetime and wrong account**
- A second tab starts a second nonce. The PKCE verifier cookie is a single slot, so one flow dies. There is no rule for which nonce wins.
- The nonce has no TTL. An abandoned nonce lowers the "at or after start" floor indefinitely.
- `login_hint` is only a hint. If the Administrator picks another Google account, the browser now holds that other identity's session (a valid invitee on a shared machine, or a fresh dormant identity).
- The existing `app/auth/callback/route.ts` handles mismatches with `supabase.auth.signOut()`. The supabase-js default scope is global, so a step-up mismatch would sign that other user out on every device.

**Fix (AD-12, replace the step-up sentences)**
> The step-up nonce is bound to the Account and to the initiating browser (an httpOnly cookie set at start and required at callback). It expires after 10 minutes, and at most one is outstanding per Account (a new start voids the previous). `login_hint` and the return path are derived server-side, never from request parameters. The callback is the ordinary sign-in callback. It issues the grant for the newly minted `session_id` by the same path as any sign-in and writes the fresh-authentication marker only for that new `session_id`, never for the initiating session. It revokes the initiating session's grant. A failed or mismatched step-up revokes only the newly minted session, with local scope, and never triggers a global sign-out.

---

### F2. Sign-ups enabled with other providers at defaults: the recovery route is a confused deputy

**Units and actors**
- Unit P: Story 1.1 bootstrap and `config.toml`.
- Unit R: Story 1.6 recovery.
- Attacker O: an outsider with no Google involvement. Sign-ups are on by AD-12's own choice.

**What each does, spec-compliant**
- P writes the `[auth]` block as AD-12 requires: sign-up enabled and Google enabled.
  - Nothing in the spine says to disable the email, phone, anonymous or OTP providers.
  - `supabase/config.toml` has no `[auth]` block today, so CLI defaults apply. I believe those are email sign-up on and confirmations off (verify).
  - Hosted defaults have the email provider on.
- R follows the Supabase SSR pattern: `/auth/confirm?token_hash&type` calls `verifyOtp`, sets cookies, revokes previous Administrator sessions and writes the audit event. The text says "single-use link ... over custom SMTP" and "revokes previous Administrator sessions".

**Defect**
1. O calls `signInWithOtp({email: o@x})` from the browser with the anon key. A user is created and a valid `token_hash` arrives in O's own inbox. O opens the app's recovery URL.
2. `verifyOtp` accepts any valid token_hash. A non-Google session is minted for an arbitrary address, so "Google is the only credential" is broken. For an existing invitee it is a Google bypass.
3. R's success path runs "revoke previous Administrator sessions". O now logs the Administrator out on demand, and the audit log records it as a recovery.
4. O calls `signInWithOtp({email: ADMIN})`.
   - This puts the Administrator's address on Supabase's 60-second per-user cooldown.
   - It consumes the project-wide auth-email limit (30/h with custom SMTP) and the Resend free tier (100/day).
   - The real recovery mail is then refused when it is needed.
5. A recovery route that takes no input and sends mail can be flooded by anyone, because the spec adds no limit to it.
6. The 15-minute TTL is enforced by the project-wide OTP-expiry setting unless nova3D keeps its own clock. A GET-verified single-use link is also burned by mail scanners and Resend click tracking.

**Fix (AD-12)**
> Only the Google provider is enabled in every environment. Email, phone, anonymous and OTP sign-in are disabled, and a Before User Created hook rejects any non-Google creation and any unverified email. Recovery tokens are minted by the server route through the Admin API. They are stored hashed with issued_at, used_at and Account, in Identity-owned records. They are redeemed only through a page that requires a POST confirmation. A token is valid only if it is on that record, within nova3D's own 15-minute clock, and its user email equals the configured Administrator email. Only then are Administrator sessions revoked. The route accepts no input, allows one outstanding link, and is rate-limited globally, not per identity. The app's own mailer sends the link, so Supabase's auth-email limits are not on the recovery path.

(Verify on staging whether Admin `generateLink` plus `verifyOtp` still work with the email provider disabled. If they do not, keep the provider on and restrict it to the Administrator address in the hook.)

---

### F3. Registration reachable from the browser, with an identity-keyed limiter

**Units and actors**
- Unit A: Story 1.3 registration service.
- Unit B: the rate limiter (Story 1.3 AC-3, Upstash Redis).
- Attacker G: any holder of a Google account.

**What each does, spec-compliant**
- A is a `SECURITY DEFINER` function `redeem_invitation(code)` granted to `authenticated`. This fits AD-2's "narrow transactional command" and AD-12's "narrow registration service".
- B sits in the Next.js route and is keyed by Auth user id or session ("Rate-limit attempts").

**Defect**
- Before the amendment an outsider had no JWT. Now every Google user has an `authenticated` JWT, and the rate-limit-and-code gate is the only thing standing between a Google account and an Account.
- G calls the RPC straight at PostgREST. The Redis limiter is never in the path.
- Even when the limiter is in the path, a limit keyed by identity resets for free, because G mints a fresh Google identity and a fresh bucket each time. Sign-ups are on by design.
- Codes have no expiry. The spine sets no entropy floor.
- Supabase's default privileges and PUBLIC execute on functions make a stray grant to `authenticated` the default outcome. AD-2 says "no browser DML grants" but is silent on executable functions.

**Fix (AD-12)**
> Registration and recovery run only in a server route using the service role. No registration, invitation or recovery database object is executable by `anon` or `authenticated` (PUBLIC execute is revoked). Attempt limits are keyed on network origin plus a global budget, never on Auth identity alone. Codes carry at least 128 bits of entropy.

---

### F4. AD-15 backup: silent mirror failure and single-fault destruction

**Units and actors**
- Unit S: the Storage sync (Story 8.4).
- Unit D: the dump.
- Unit M: monitoring (AD-19).
- Actors: a transient Supabase listing error, or a stolen job credential.

**What each does, spec-compliant**
- S runs `rclone sync`, or an equivalent, nightly from the Supabase S3 endpoint to B2, mirroring deletions.
- B2 lifecycle: dumps expire after 14 days, hidden versions after 7.
- Object lock is not used (AD-15 says so).
- M monitors "storage integrity and purge deadlines". Backup age and mirror lag are not listed.

**Defects**
1. **Failure leaves deleted data in B2 forever.**
   - If the sync fails, is skipped, or overruns (a Railway cron skips a run when the previous one is still active), no hide marker is written. The B2 lifecycle clock for a deleted object starts only at hide.
   - Nothing alarms, and the 30-day bound silently fails. The happy path is about D+10 to D+16. The failure path is unbounded.
2. **Partial listing destroys the backup.**
   - A partial or empty listing is indistinguishable from "everything was deleted". Deletion mirroring hides the objects, and seven days later B2 deletes them.
   - The job's B2 key can delete, with no lock or minimum-retention guard, so one bad run or a stolen key destroys the only independent Storage copy.
   - The same applies to a reversed direction (src and dst swapped) against the Supabase S3 key, which can write and bypasses RLS.
   - "Object lock is not used" is justified as "it would pin deleted data". A lock of 7 days or less pins nothing past the 30-day limit (7 + 7 is well under 30).
3. **Credentials and scratch.**
   - `pg_dump` over RLS tables needs a BYPASSRLS or owner connection. I could not confirm that Supabase can issue a read-only BYPASSRLS role (verify). The S3 key bypasses RLS and no read-only scoping is recorded.
   - The job therefore holds the highest-privilege data credentials in the system, outside the Next.js and worker boundary.
   - It does not literally break AD-1 or AD-2 (it is not a business module) or AD-19's preview rule (it is not a preview build).
   - It does conflict with "the worker platform holds no authoritative or backed-up data" if the dump touches a Railway disk before upload. A crashed run leaves a full-database dump on a volume with backups disabled and no expiry.
   - Railway shares variable scope within a project and environment. A backup service in the same project as the CAD worker and file gateway shares credentials with the least-trusted component.
   - AD-19's immutable-environment-ID check covers "database, queue and callback origin" but not the backup destination. A staging job pointed at the production bucket (or the reverse) passes it.
   - Story 8.4 AC-1 says "drill actual provisioned restore paths". The only non-production cloud target is staging, which previews can reach. A production dump restored there puts real data where "previews use synthetic data".
4. **RPO.** "RPO ≤ 24 h comes from the nightly job" holds only if no run fails or overruns. One failed night is a 48 h exposure.

**Fix (AD-15 and AD-19)**
> The backup job streams the dump to B2 and never persists it on the worker platform. It has its own service with its own variables, B2 keys scoped to one bucket per environment, and no network path to anything but Supabase and B2. The sync aborts without hiding anything if a listing page errored or the object count shrinks by more than N% against the Postgres Storage metadata. B2 object lock is used only with retention of 7 days or less, which fits the 30-day limit and prevents a bad run or stolen key from destroying the only independent Storage copy. The environment-ID check covers the backup destination. A job that completes writes a dated backup manifest with the dump checksum and the sync cutoff. AD-19 monitors backup age and mirror lag, and alarms at 36 h. Restore drills target a dedicated restore project, never an environment reachable by previews.

If a read-only BYPASSRLS role is unavailable on Supabase, record the exception and confine the credential to the isolated service.

---

### F5. AD-8 / R-2: scale pinning, deflection frame, and a budget with a missing term

**Units and actors**
- Unit E: Story 4.3 equivalence comparison.
- Unit V: Stories 6.1 and 6.4, profile pinning and repair.
- Unit T: tessellation.
- Model: a metre-scale source such as the altar.

**What each does, spec-compliant**
- V computes "the largest uniform scale, never above 1:1, that fits the bounding box in the profile cube minus 1 mm per side, stored as an exact rational". A repair child is a new artifact, hence a new validation identity (it includes physical scale), so V recomputes the scale from the repaired artifact's box.
- E follows R-2 and compares "after the same pinned final-print transform".
- T tessellates the canonical solid at 0.002 mm and 0.1 rad, then applies the print scale to the mesh.

**Defects**
1. **Best-fit versus no best-fit.**
   - AD-8's default scale is a best-fit rescale. R-2 says "never independent best-fit/rescaling", and the amendment does not say from which model or when the scale freezes.
   - For a 2.5 m source the scale is 88/2500 = 0.0352 (about 1:28). The scale is set by the bounding box.
   - A repair that uniformly shrinks the model by 0.1% is renormalised back by the recomputed scale and passes. It is a dimensional change that should be consequential.
   - Even a vertex weld that moves the box by 0.28 mm at source scale changes the scale by about 1e-4. Over 88 mm that is up to 0.0099 mm, which is the entire 0.01 mm budget.
   - OCC's `BoundBox` is enlarged by tolerance and is not the vertex min and max. A story using it and a story using the mesh get different scales.
2. **Deflection frame.**
   - 0.002 mm is stated without a frame. In the canonical frame it is 0.002 x 0.0352 = 0.00007 mm at print scale, a mesh orders of magnitude finer than needed. At the altar's real scale it may be infeasible.
   - In the print frame it is 0.002 mm of the 0.01 mm "at final print scale" budget as intended.
   - T (canonical frame) and E (print frame) are both literal-compliant.
3. **Budget arithmetic.**
   - 2 x 0.002 = 0.004 of 0.01, leaving 0.006. That arithmetic is correct.
   - But AD-8 says the deflection is "counted as R-2's approximation bound". R-2's bound is also the comparator's own sampling error and floating-point error. Those terms are missing, and a sampled Hausdorff distance underestimates.
   - OCCT's linear deflection is not a guaranteed certified bound for all surfaces (verify). G-2 must measure it rather than assume it.

**Fix (AD-8, replace the new sentences)**
> The default print scale is computed once, at the first validation of a lineage, from the exact vertex bounding box of the oriented manufacturing mesh in canonical millimetres, stored as an exact rational on the lineage, and inherited unchanged by every repair and regeneration child. A successor that does not fit fails validation as "does not fit" and is never rescaled. A user-chosen smaller scale creates a new validation identity. Manufacturing tessellation is performed on the oriented, scaled solid, so 0.002 mm and 0.1 rad are in the print frame. R-2's bound is 2 x deflection + comparator error + floating-point error, each declared with the comparator version, and the sum with the measured distance must be at most 0.01 mm.

Add a G-2 fixture: a metre-scale source with a uniform 0.1% shrink repair must fail.

---

## Medium

### F6. Dormant-identity purge versus in-flight registration

**Units and actors**
- Unit A: Story 1.3 registration. It claims the invitation, inserts Account `provisioning` plus Workspace, and activates in a later step ("partial provisioning is unusable until activation completes").
- Unit J: the daily purge. It selects identities with no activated Account at 30 days and calls the Auth Admin API.
- Actor: an invitee returning on day 30 to 31.

**Defect**
- J selects at 02:00, A activates at 02:00:01, and J deletes at 02:00:02. The deletion is not atomic with the check.
- If `accounts.user_id` cascades from `auth.users`, the activated Account and Workspace are deleted.
- If it does not cascade, the Account is orphaned. The user signs in again with a new Auth id, the invitation is consumed, and they are locked out with no recourse. The Administrator cannot repair it because there are no private reads.
- The memlog adds "and any identity whose registration never completed activation". That clause is not in the spine, and read literally it deletes every in-flight registration.

**Fix (AD-12)**
> Dormant purge deletes only identities with no Account, claim or registration attempt, determined in a single SQL transaction that locks the identity row and deletes it in that transaction (a `SECURITY DEFINER` function, not a bare Admin API call). Registration takes the same row lock. Age is measured from the last sign-in or registration attempt, not from creation. Account foreign keys to the Auth identity are RESTRICT, never cascade.

---

### F7. AD-11 caps: the arithmetic holds, the computation does not

**Arithmetic check**
- 200,000 tokens x 2 microdollars = 400,000. 16,000 x 10 = 160,000. Sum = 560,000, under 1,000,000. Brave 20 x 5,000 = 100,000. All correct.
- A $5 Job admits 8 worst-case Anthropic calls (4.48), not 9 (5.04). With ambiguous calls holding their full reservation, nine ambiguous calls exhaust a Job.

**Where two stories diverge**
1. **Constant versus measured.**
   - Story 2.6 reserves the constant $0.56 for every call. A research step that sends `max_tokens` 4,000 and 30k input expects $0.14. "The reservation is that computed maximum" permits both.
   - Story 2.5's "disclosed maximum" must match the reservation or admission can deadlock.
2. **The input cap cannot be enforced without the provider.**
   - The memlog says `count_tokens` is an estimate and "not trusted as the bound". The spine does not say what bounds input instead.
   - If a story uses `count_tokens`, billed input can exceed 200,000, so the usage block exceeds the reservation.
   - R-6 lets later evidence append a correction. It does not re-run the ceiling checks, so settled usage can exceed a limit with nothing to stop it.
   - Cache-write multipliers (1.25x, 2x) and server-tool fees are not in the $0.56 either. R-6's "unsupported parameter" list is the only guard.
3. **"Operation" has two meanings.**
   - Anthropic: one call, $0.56.
   - Brave: up to 20 requests, $0.10. "Settled at count x $0.005" (memlog) conflicts with "settles at its reserved maximum" (spine), and "no duplicate request" cannot hold for a partially executed 20-request operation.
4. **Timing.** R-6 says an ambiguous call "holds its full reservation until ... conservative maximum settlement". AD-11 says it "settles at its reserved maximum unless matching usage evidence arrives". Neither names the trigger or deadline. HTTP error responses carrying a request-id have no usage block and are neither "no response" nor documented noncharge.

**Fix (AD-11)**
> The reservation equals input rate x an input bound plus output rate x the `max_tokens` actually sent. The input bound is derived without the provider (the UTF-8 length of the serialized request plus a documented per-image maximum), never `count_tokens`. The per-call caps are admission ceilings, not the reserved amount. Cache, batch and server-tool options are unsupported parameters. An ExternalOperation is exactly one provider request, and a Brave search step is up to 20 operations. Evidence above the reservation settles at the evidence, is recorded as an overrun incident that counts against every limit, and blocks new admissions for that provider until reviewed. A call that yields no response settles at its reservation at a stated reconciliation deadline. A table classifies HTTP error responses (4xx and 5xx with a request-id is a documented-noncharge candidate; timeout or abort is ambiguous).

---

### F8. AD-15 restore: the lifecycle clock is not "measured from deletion"

**Units**
- Unit L: B2 lifecycle (14 and 7 days, measured from upload and hide).
- Unit N: the nightly job.
- Unit D: restore (Story 8.4).

**Defects**
1. **Re-dump during restore.**
   - R-9 says expiry is "measured from deletion, not extended by restoration/rebackup". The mechanism measures from upload.
   - If N fires after a restore from an older dump but before ledger replay, the resurrected rows get a fresh 14-day copy. A restore at R from a dump that predates deletion D gives R − D under 14, so the re-dump expires at most D+28.
   - That is under 30 only by a 2-day margin, and the B2 lifecycle's daily granularity eats it. Any later tuning of dump retention breaks it.
2. **Dump versus sync order.**
   - Neither the spine nor R-9 orders them. If the sync runs before the dump, the restored database has manifests whose bytes were uploaded after the sync. That violates "only a committed, verified manifest can be presented as usable".
   - If the dump runs first, objects deleted between the two are hidden and kept only 7 days. A restore that lists "latest versions" loses them.
3. **Ledger home.** The memlog says the ledger "lives outside both stores". The spine and RD do not. The Structural Seed table assigns "restore-exclusion ledger" to the Lifecycle module, so Story 8.1 will build it in Postgres, where the dump and restore roll it back.

**Fix (AD-15)**
> The nightly job does not start while a restore is in progress, and the first post-restore backup waits for ledger replay. The dump runs first and the Storage sync records the dump's cutoff. A restore reads Storage as of that cutoff and treats a manifest without bytes as unusable. Backup retention is defined as the minimum of the lifecycle and deletion + 30 days: a post-restore scrub removes every ledgered target from B2 live and hidden versions. A monthly deletion canary (create, delete, assert absence from the database, Storage and B2 within 15 days) is run in staging and production. The deletion ledger is stored in a separate store that no restore or backup touches (name it in the spine).

---

### F9. Restore reverts security state, not just deletions

**Units**
- Unit K: Story 1.5 disable and session-grant revocation.
- Unit D: restore from a dump taken before a disable.

**Defect**
- The dump holds `accounts.status`, session grants, invitation redemption and rotation, and recovery revocations. Restoring it re-enables a disabled Account, un-revokes grants, un-consumes a single-use code (and un-rotates the shared code), and resurrects Administrator sessions revoked by recovery.
- AD-10's "authorization epoch" moves backwards, so a stale worker attempt carrying a higher epoch fences against a lower one.
- The ledger replays deletions only (AD-15).

**Fix (AD-15)**
> After any restore, all session grants are revoked and all Auth sessions are invalidated. Disable, code consumption and code rotation, recovery and epoch state are monotonic and are carried by the same external ledger, or reconciled before access opens.

---

### F10. The fresh marker is a 5-minute bearer for every sensitive class

**Units**
- Unit I: Story 1.3 invitation issuance, which needs fresh auth.
- Unit C: Story 8.2 close-instance, which also needs fresh auth.

**Defect**
- An Administrator's step-up for an innocuous invitation opens a 5-minute window in which close-instance, an irreversible global deletion, needs only a confirm click. With XSS, a malicious extension or an unattended screen, the destructive action costs one click.
- Cookie mutations need CSRF and origin checks, but the marker itself is not scoped.

**Fix (AD-12)**
> The marker records an action class (administration, account deletion, close-instance). Instance closure and Account deletion require their own step-up, completed after the destructive confirmation is shown, and the marker is consumed by use.

---

### F11. Recovery cannot satisfy step-up

**Units**
- Unit R: Story 1.6, which issues a recovery session. Its `amr` method will be `otp`, `magiclink` or `recovery`.
- Unit S: step-up, which accepts only an `oauth` amr entry.

**Defect**
- Every Administrator capability needs fresh authentication (FR-3). A recovered Administrator therefore can invite, disable or close nothing.
- A developer will quietly accept any amr to unblock recovery, which widens F1 and F2.
- Recovery is also circular if the Administrator's email is the Google account that was lost, because the mailbox is lost with it. The spec does not say which failure recovery serves: a Google provider or OAuth client failure, or Supabase's Google outage.

**Fix (AD-12)**
> Redeeming a valid recovery link writes the fresh marker, session-bound, for 5 minutes, and only for the session created by that redemption. State the failure scenarios recovery serves.

---

### F12. AD-19 versus Story 1.1 and the existing repo

What the amendment requires and Story 1.1 (or any story) does not cover:

1. **Local still points at the cloud.**
   - `.env.local` is `APP_ENV=local` with `NEXT_PUBLIC_SUPABASE_URL=https://jtxtxdzqltogxijgksyq.supabase.co`, and `scripts/check-env.mjs` passes it because it checks the label only.
   - `scripts/test-env.mjs` uses a cloud-looking URL as its local fixture.
   - Story 1.1 AC-2 says "immutable environment identifier" but never says `APP_ENV=local` must be loopback and CLI-backed. AD-19 now forbids anything else.
   - There is also no stated source for the identifier in the CLI stack or in the relabelled cloud project, and `supabase/migrations` and the seed do not exist.
2. **`supabase/config.toml` has no `[auth]` block.** It has no `[auth.external.google]` (`skip_nonce_check=false`), site URL or redirect list, provider disables, OTP expiry or SMTP. Nothing in the repo declares the settings AD-12 now depends on.
3. **Cloud Auth settings are unverifiable.**
   - Sign-ups, providers, OTP expiry, SMTP and redirect lists are dashboard state. `check-env.mjs` cannot see them, and the readiness report already says "the cloud setting is unverified".
   - `docs/auth-setup.md` lists `http://localhost:3000`, `http://127.0.0.1:3000` and the LAN IP `10.103.0.9` as callbacks on the cloud project. That is the environment bleed AD-19 forbids.
4. **The live site's deployment conflicts with the new rule.**
   - `vercel.json` deploys `main` to Vercel Production, and `check-env.mjs` requires `APP_ENV=production` there. The existing project is relabelled staging and production does not exist until first deploy.
   - Story 1.1 AC-2 will fail that build, or Production variables point at staging and break the check.
5. **Three Google OAuth clients and the consent-screen publishing status.** Consent in "Testing" mode limits sign-in to listed test users, which acts as a silent allowlist (verify). These are prerequisites with no owning story, and `docs/auth-setup.md` and `docs/deployment-setup.md` still describe `AUTH_ALLOWED_EMAILS` and a shared cloud project.
6. **`scripts/ci/check-repository.mjs` requires `scripts/restore-supabase.mjs`**, whose default ref is the staging project. Removing the script silently breaks CI.
7. **New environment variables.** An Administrator email variable is not in the `check-env.mjs` required list. `AUTH_ALLOWED_EMAILS` stays required until Story 1.4.
8. **Periodic jobs have no owning story.** The dormant purge, backup, orphan cleanup and deadline checks have none. QStash schedules arrive with Story 2.7, but sign-ups are live from Story 1.4. Identities accumulate with no purge for the whole of Epic 1 and part of Epic 2.

**Propagation obligations (epics and story specs are stale against the amendment)**
- Story 1.4 still says fresh authentication "means Google re-authentication within the fresh-authentication window". That contradicts the new step-up.
- Story 1.6 lacks the route rules, the 15-minute TTL and the SMTP provider.
- Story 2.6 lacks the per-call caps.
- Stories 3.1 and 3.7 lack the Brave gate and the research-engine port.
- Stories 4.3, 6.1 and 6.2 lack the tessellation and scale defaults.
- Stories 8.3 and 8.4 lack B2.

**Fix (AD-19)**
> `APP_ENV=local` is valid only against a loopback Supabase URL. Auth configuration (providers, sign-up, redirect URLs, OTP expiry, SMTP) is declared in `supabase/config.toml` and pushed to staging and production with `supabase config push`, and CI diffs the live settings. Each environment carries its own identity row, which startup and CI verify. Vercel Production deploys are disabled until a production project exists.

---

### F13. AD-5 free mode: the omission scan covers quantities only

**Units**
- Unit X: the domain-package extractors, which map governing text to checklist items.
- Unit O: the omission scan, which looks "for quantities and dimensions no item accounts for".

**Defect**
- Middot chapter 3 carries placement, material and procedure statements that are not quantities (the ramp's side, the red line round the middle, plastered with lime). The checklist includes "materials, placement ... interpretation".
- Both X and O run over the same two registry editions and are written by the same team. A scan that sees only numbers gives a false "no unresolved gap", and Hebrew number words, fractions and letter numerals defeat a simple pattern.
- AD-5's original requirement was an independent pass. A deterministic scan by the same authors is weaker than that, and the amendment names no independent reviewer or fixture.

**Fix (AD-5)**
> The omission scan covers quantity and relational or material phrases defined by a versioned grammar. Free mode is marked complete only after the scan passes a seeded-omission fixture (known statements removed from the checklist must be found) and a human or other-engine pass on the first registry subject.

---

## Low

- **L1. Administrator identity is an email, not a Google `sub`.** A recycled Workspace address would inherit the role. Pin the Google subject on first sign-in.
- **L2. Realtime.** Hints on public channels are open to anyone with the anon key, regardless of sign-ups. Require private (authorized) channels with RLS on `realtime.messages` that check the live Account and grant.
- **L3. AD-19 "never from a platform cron" versus the Railway cron service.** Railway is "the worker platform", so the sentence permits it, but a story author can read it either way. Say so.
- **L4. B2 region** is unrecorded, against AD-19's compatible primary-region layout.
- **L5. Auth identity inflation.** Open sign-ups plus Google accounts can inflate Auth MAU (Pro includes 100,000), so a Supabase usage alert should exist.
- **L6. Brave citation URL.** AD-4 pins a source URL, but AD-5 says only the fetched passage and digest are pinned. The memlog admits it is unconfirmed whether keeping a Brave result URL counts as storing results. This is harmless while the adapter ships disabled.

---

## Checked and held

- The $0.40 + $0.16 = $0.56 arithmetic, the $1 operation ceiling and the $5 Job ceiling (F7 covers only the computation).
- The 0.004 of 0.01 mm arithmetic (F5 covers the frame and the missing terms).
- The happy-path deletion timeline: active purge ≤24 h, next sync ≤24 h, hide + 7 days, dump 14 days. Worst case is about D+16, well inside 30 days.
- The backup job does not literally break AD-1, AD-2 or AD-19's preview rule. F4 covers the adjacent breakages.
- An unactivated Auth identity reaches no private data through RLS or Storage, provided policies are written as owner-and-grant checks and no policy or function is granted to `authenticated` for shared reads (F3, L2).
