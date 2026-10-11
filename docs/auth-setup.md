# Authentication setup

The deployed shell is private and uses Google through Supabase Auth. Signing in with Google is necessary but never enough: every private page needs an active Account and a valid session grant, and an Account exists only for an invited person (a pre-authorized address or a redeemed invitation code). There is no password fallback and no list of allowed addresses in the environment; the interim email-list gate that earlier builds read is gone (Story 1.3 Part B).

Google is the only sign-in credential: the target is Google on, and email, phone and anonymous sign-in off, in every environment. Sign-ups stay on, because turning them off blocks every first-time Google sign-in; the live-Account check is the gate. `supabase/config.toml` declares these settings and applies them to the local stack (an integration test reads them back from the running stack); nothing yet compares them with a hosted project, so staging and production are set by hand until Story 1.9. The settings: `[auth]`, `[auth.email]`, `[auth.sessions]` (30-day time-box, 7-day inactivity timeout, 15-minute OTP expiry) and `[auth.external.google]`.

## How access is decided (Stories 1.3 and 1.4a)

One resolver, `lib/access.ts`, turns the verified session and one call to the database, `api.authorize_session`, into one of seven states, and the proxy, every private page, the sign-in callback and the registration action all ask it. The user always comes from the verified server session (the Auth service is asked, the cookie is not trusted), never from a form field, a header or a claim; the session comes from the `session_id` of the very access token Auth has just verified for that user. `authorize_session(user, session)` answers with the Account state first and then the session's grant (below), so one call replaces the separate Account lookup of Story 1.3.

| State | Meaning | What happens |
| --- | --- | --- |
| `signed-out` | no verified session, or one whose Auth session the database no longer sees | any private path redirects to `/login?error=not_signed_in` ("Sign in with an invited Google account to continue") |
| `session-ended` | a verified session whose grant is not valid: none issued, revoked, issued more than 30 days ago, unused for more than 7 days, or issued under an older epoch than the Account's | any private path redirects to `/login?error=session_ended` ("Your session ended. Sign in again."); the Auth session is left alone, and signing in again issues a new grant |
| `unregistered` | a verified Google identity with no Account | every path except `/register` redirects to `/register` |
| `active` | an active Account and a valid grant | the page renders; `/register` redirects Home |
| `disabled` | the Account is disabled | signed out (every session of the user is ended and the cookies expired) and sent to `/login?error=account_disabled`; no private content |
| `refused` | the Auth user's Google identity is no longer the one pinned to the Account | this session's grant is revoked and audited; signed out everywhere and sent to `/login?error=not_allowed` |
| `unavailable` | Auth or the database could not answer, in time or at all | access is denied and the request goes to `/login?error=auth_unavailable`, whose message offers "Try again"; the session is kept so the person can return when the outage clears |

A deliberate sign-out lands on `/login?notice=signed_out` ("You have been signed out."), shown as a notice, not an alert.

Any error, a timeout or an answer of an unexpected shape is `unavailable` (or `signed-out` when Auth says there is no session), never a pass, and nothing is cached between requests: no JWT, grant or Account answer is honored from memory. The proxy makes one Auth call (plus a read of the stored session) and one `authorize_session` call for each private request, and the page repeats them once (memoized with React `cache()` for the render, so the page and anything inside it share one answer), because the proxy alone is not a boundary. A Server Action asks for itself and never reuses an answer. The calls of one decision share one time budget (5 seconds), the sign-in callback's whole chain another (10 seconds) and a sign-out action's a third (8 seconds), so three slow answers cannot take three times as long. The session ID is taken from the verified token only if its subject is the verified user, it has not expired and it carries a `session_id`; in the sign-in callback it comes from the token the code exchange has just returned.

Route handlers under `app/api` start from `requireApiAccess()` (`lib/auth.ts`), which gives the same JSON answers; Server Actions that need the gate use `withActiveAccount` or `withVerifiedUser` (the sign-out actions). A test fails when a route handler outside the short public list (`/api/health`) does not call `requireApiAccess`. `/login`, `/auth/callback` and `/api/health` stay public, and `/kit` only while synthetic data is on; `/register` is private (it needs a session) and renders without the navigation shell.

**Private `/api` paths answer JSON, never HTML or a redirect.** A denied request gets `401` with `not_signed_in` (no valid session) or `session_ended` (a valid session whose grant has ended), `403` with `account_required` (no Account), `account_disabled` or `not_allowed`, or `503 {"error":"auth_unavailable","retryable":true}` with `Retry-After: 5` when the check could not be made (a 503 rather than 401 or 403, because the person has not been refused; it is retryable). The body never carries a reason beyond that code. A disabled Account or a changed Google identity is signed out on an API request as well.

**Registration** (`/register`) is the only place a signed-in identity without an Account can go. It states that the instance operator administers the hosting accounts that hold users' data, takes an invitation code, and works on phone and desktop in English and Hebrew. A wrong, used, revoked or rate-limited code all give the same generic, localized message and a new command ID; the code is never logged and never sent back. If the database cannot be reached the form shows a retry message, keeps the command ID and keeps what was typed, so the retry is the same command. "Use a different Google account" ends this browser's session and returns to sign-in.

**Pre-authorized addresses** become Accounts in the sign-in callback: right after the code exchange it asks Auth who signed in and calls `api.consume_preauthorization` for that user, and, once the Account is live, issues the grant of that session (see Session grants below). A pre-authorized address becomes an Administrator or member Account at its first verified Google sign-in (the Administrator's Google subject is pinned then), or, for a session that signed in before the address was seeded, the next time that session opens `/register` (the proxy consumes it there, and a refusal signs the person out the same way); the same address under another Google subject, or a disabled Account, is signed out (`not_allowed`, `account_disabled`); an identity with no pre-authorization goes on to `/register`; a failure of any step signs the person out with `auth_unavailable`, on this browser only (an outage says nothing about their other devices), while a refused or disabled identity is signed out everywhere. Every call to Auth or the database in these paths, and every sign-out, has a deadline (5 seconds): a hung service ends in the same fail-closed redirect, never a hung request. A Server Action refused by the proxy (a form left open after the session ended, the Account was disabled, or the Account was created in another tab) is answered with a redirect only; the form then reloads `/register`, and that page request signs out and shows the right sign-in message or Home.

## Session grants (Story 1.4a)

A session grant is the Identity-owned record that this Auth session may use this Account. A valid Google session and an active Account are not enough: the session also needs its grant, which is how one session can be signed out, all the others can be, and a session can end by age or idleness, none of which Auth's own session alone gives the application. The table is `identity.session_grants` (unexposed, row-level security on, no policies, closed to every role); the only callable surface is the `api` schema, executable by the service role alone.

- **One grant per Auth session**, keyed by Auth's `session_id`, which the server takes from the verified access token and never from a client. It records the Account, the Account's authorization epoch at issue, when it was issued, when it was last used, and, if it has ended, when, by whom and why.
- **Issued** (`api.issue_grant`) whenever a signed-in session becomes an active Account's: at the end of the sign-in callback, when a session that signed in before its address was seeded claims its pre-authorization at `/register`, and at registration with a code. It is idempotent (a repeat changes nothing and audits nothing more), never revives a revoked grant, and refuses a session Auth does not have for that user, a disabled Account, and a Google identity that is not the pinned one. If a session already has a grant that is revoked, expired, idle or stale, it says which instead of "exists". If it cannot be issued the sign-in is not complete: the person is signed out on this browser and told that sign-in is unavailable.
- **A registration retried after its answer was lost.** If the Account was created but this session never got its grant, the form's retry (same command, same code) is let through the proxy for that one case (a POST to `/register` from a session that has an Account and no grant). The action replays the registration command and the database must confirm (`api.confirm_registration`) that this command and this code created the Account, before the session gets its grant. Any other session of a user that has an Account, with any other command or code, is sent to "Your session ended".
- **Valid** only while the Auth session it belongs to still exists for that user (a primary-key lookup in `auth.sessions`: a grant whose Auth session is gone is refused at once, not when it expires), it is not revoked, was issued less than **30 days** ago, was last used less than **7 days** ago, and its epoch is at least the Account's `authorization_epoch`. Its last use is written at most once a minute and never waits for another request's write. Auth's own time-box and inactivity timeout in `supabase/config.toml` stay in force as well, so whichever is shorter ends the session.
- **Revoked** (`api.revoke_grants`) by exactly one selector: a session, an Account (optionally sparing one session), or the Account's grants below an epoch. Revocation is final and audited (`session.revoked`, one event per grant). `api.raise_authorization_epoch` raises an Account's epoch, which makes every older grant stale at once without touching a row; the epoch only rises. **Any change of an Account's status raises the epoch by one in the same update** (a trigger, `identity.guard_account`, audited as `account.epoch_raised` by `system:accounts`), whoever makes it: a disabled Account's old sessions are stale for good, and enabling it again cannot bring them back. Revoking by Account or below an epoch takes the Account row `FOR UPDATE` (issuing holds it `FOR SHARE`), so a grant being issued at that moment is either seen and revoked or issued afterwards by a new sign-in, never missed. The revocation says how many grants it ended and how many of those were still in use; "sign out my other sessions" reports the second number. Stories 1.5 (disable) and 1.6 (recovery) use these; Story 1.4a uses the session and Account selectors.
- **The pinned Google subject is checked on every authorization**: the Auth user must have exactly one Google identity, and it must be the subject pinned to the Account. Another Google identity linked to the same Auth user, or a replaced subject, revokes this session's grant, audits it once (`session.subject_mismatch`; only the request that actually revoked the grant writes it) and refuses the request, and every later request on that session is refused the same way (the grant keeps its reason), so each one signs the identity out. See the runbook below.
- **Sign out** (Account menu) revokes the session's grant first and only then asks Auth to end the session and expires the cookies, and lands on the sign-in page saying so. If the revocation cannot be recorded, the person is told (in the menu and through the page's live region) and stays signed in to try again; nothing is ended, and the message is gone when the menu is reopened. After a sign-out the old token is refused by Auth and, on its own, by the grant. A second press while one is running is ignored.
- **Sign out my other sessions** (Settings) revokes every other grant of the Account in one statement and then asks Auth to end the other sessions too (best effort, on a deadline: the revoked grants are what end them). The current session continues. It says how many sessions were signed out ("No other sessions were signed in" for none, in English and Hebrew); only grants that were still in use count. If the revocation cannot be recorded, nothing changes and the person is told. Both buttons read a Server Action answer that is not an action's (a proxy redirect, because the session has no access any more) as a reason to load the page once, which sends the person to the right sign-in message; any other failure is shown as unavailable and never reloads the page silently.
- **A session with no grant is refused as signed out.** That is also how existing sessions end at the cutover (below): there is no grandfathering, and nothing a private request does creates a grant.
- **Audit events** (append-only `identity.audit_events`, no content, no token, no address): `session.issued`, `session.revoked`, `session.subject_mismatch`, `account.epoch_raised`.
- **The hosted preflight** (`check-env --live`, and the Vercel build) calls `api.preflight`, which reads one row at most of `identity.session_grants`, `identity.accounts`, `auth.sessions` and `auth.identities` and writes nothing, so an unapplied migration, an unexposed schema or a missing privilege on a hosted `auth` table fails the build with one line instead of failing every private request after the deploy.
- **Rows accumulate**: one per sign-in, revoked or not; a periodic cleanup is planned with the scheduled jobs of Story 1.9 (see `deferred-work.md`).

## Accounts, invitations and the seed command (Story 1.3)

The accounts live in the database (below); the application half described above gates the app on them.

- **Accounts exist only through a database function.** Accounts and Workspaces live in the unexposed schemas `identity` and `projects`. The only callable surface is the `api` schema, whose functions only the service role may execute; `anon` and `authenticated` can execute and read nothing, and a function or table created later in these schemas is closed by default (default privileges, migration `*_accounts.sql`; see the note under Known limitations). A registration (`api.register_with_code`) locks the Auth user's row, records the attempt time, and creates the Account and its Workspace in one transaction. It is idempotent per command UUID: a retry, or a user who already has an Account, gets that Account back without spending any of the limiter's budget. A disabled Account is reported as `disabled`, never as a success.
- **Failures are generic and counted**: 5 per network origin per 15 minutes and 100 per hour across all origins, kept in Postgres. An unexpected database failure (a deadlock, a lock timeout) is not a bad code: it rolls the whole registration back, is not counted, and reaches the caller as an error.
- **Invitation codes** carry 160 random bits, are shown once, and only their HMAC-SHA256 under `INVITATION_HASH_KEY` is stored. Client addresses are likewise only stored as HMACs under `RATE_LIMIT_HASH_KEY`. Unused codes never expire; revoking a code never touches an existing Account. A general code is unique while unused; issuing another needs `--replace`.
- **The Before User Created hook** (`[auth.hook.before_user_created]` in `supabase/config.toml`, function `api.before_user_created`) rejects every Auth user that is not a Google identity with a verified email, so email, phone and anonymous sign-ups cannot create a user even if a provider setting is wrong. Auth calls it for sign-up, the OAuth callback and invitations (the integration test sends an invitation with the service key and checks the rejection). The Auth admin create-user endpoint does not call it; it needs the service key. The hook never raises: a payload it cannot read is a rejection.
- **The audited seed command** writes every action to the append-only `identity.audit_events` with the actor `seed:<APP_ENV>:<operating-system user>`. It first checks that `APP_ENV` and `INSTANCE_ID` match the database it is about to write, and outside local it needs `--confirm <APP_ENV>`.

```sh
npm run seed:accounts -- preauthorize                  # ADMINISTRATOR_EMAIL as administrator, SEED_ACCOUNT_EMAILS as members
npm run seed:accounts -- unauthorize --email <address> # withdraw a pre-authorization nobody has used yet
npm run seed:accounts -- issue --name "Daniel"         # a named single-use code, printed once
npm run seed:accounts -- issue --general [--replace]   # the current general code; --replace revokes the current one
npm run seed:accounts -- list                          # invitation ID, kind, state, time and label; never a code
npm run seed:accounts -- revoke --id <invitation-id>   # or: printf %s "$CODE" | ... revoke --code-stdin
```

`SEED_ACCOUNT_EMAILS` is left unset in the templates on purpose: set it deliberately (comma-separated member addresses). `preauthorize` can be run as often as you like: each address has one pre-authorization. An address that already owns an Account is refused (error `N3001`), an address already pre-authorized with another role is refused (`N3002`), and a second Administrator address draws a warning. The first verified Google sign-in of a pre-authorized address activates exactly one Account and pins its Google subject (`api.consume_preauthorization`, called by the sign-in callback); a later sign-in with the same address under another Google subject is refused and audited (once an hour per user). An identity with no pre-authorization and no code gets no Account. Which environment each command needs: every command needs `APP_ENV`, `INSTANCE_ID`, `ADMINISTRATOR_EMAIL`, the Supabase URL and the service key (and checks them against the database's identity row). Beyond that, `preauthorize`, `unauthorize`, `list` and `revoke --id` need neither hashing key; `issue` and `revoke --code-stdin` need `INVITATION_HASH_KEY` only (they hash a code), and none needs `RATE_LIMIT_HASH_KEY`. The application itself needs both keys to start, in every environment except a preview, which must hold neither.

If `issue` fails or times out, its outcome is unknown: the code may have been stored. Run `list` and revoke by ID any invitation you do not recognise before issuing again.

### Known limitations

- **Fixed windows.** The limiter counts in fixed windows (15 minutes per origin, one hour overall), so an attacker who straddles a window boundary can make up to twice the limit of guesses (10 from one origin, 200 overall) in a short span. With 160-bit codes that is no practical gain.
- **The global limit can be used to lock registration.** Anyone who can send 100 wrong codes in an hour makes every registration `limited` until the window ends (at most an hour). Existing Accounts are not affected. An alarm on limiter trips is planned for Story 1.13.
- **Typographic details.** A code is matched after folding case, all whitespace, every hyphen or dash (ASCII hyphen, U+2010 to U+2015 and U+2212) and the look-alike letters (`O` as `0`, `I` and `L` as `1`), so a code survives being typed, pasted or read aloud. Input that is not shaped like a code after folding is refused without a database call. Client addresses are trusted only on Vercel (where the platform overwrites the forwarding headers); elsewhere every request shares one origin, and IPv6 addresses count by their /64 network.
- **Functions are closed by default, database-wide.** Postgres grants `EXECUTE` on every new function to PUBLIC, and a default-privileges rule limited to one schema cannot remove that. The migration therefore revokes it for every function the migration role (`postgres`) creates from now on, in any schema. Supabase's own default grants to `anon`, `authenticated` and `service_role` in the `public` schema still apply, so API functions there behave as before; but a future function that a Supabase service role must run (for example a trigger function on `auth.users`, run as `supabase_auth_admin`) needs an explicit `grant execute`.
- **A second Google identity locks the Account out.** Auth links a new Google identity to an existing user with the same verified email. The pinned-subject check treats any second Google identity on an Account's Auth user, like a replaced one, as a mismatch, so every session of that user is refused (and audited) until the extra identity is removed from Auth. That is deliberate: it is what stops a recycled address from using an Account. There is no in-app recovery for it yet (Story 1.6 gives the Administrator one).
- **Disabling revokes by epoch, not by row.** A change of status raises the Account's epoch (above), so a disabled Account's sessions are refused and stay refused after it is enabled again; the grant rows themselves are left (they are history). Story 1.5 should still end the Auth sessions of a disabled Account and, if it wants the rows marked, revoke them by Account.
- **Keys.** A hash key that no longer matches the one used to issue a code makes that code unredeemable without any error; there is no canary yet (see `deferred-work.md`).

## Local development (Supabase CLI stack)

Local development never talks to a hosted project. `APP_ENV=local` is accepted only with a loopback Supabase URL (`127.0.0.1`, `localhost` or `[::1]`).

1. Create a Google OAuth web client for local use (one client per environment; never reuse the staging or production client).
2. In Google Cloud, add `http://127.0.0.1:54321/auth/v1/callback` as the client's authorized redirect URI. This is the local Supabase Auth callback.
3. Export the client before starting the stack. The values come from the environment; they are never written to `supabase/config.toml`:

   ```sh
   export SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID=<local-client-id>
   export SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_SECRET=<local-client-secret>
   supabase start
   node scripts/setup-env.mjs local
   ```

   The stack starts without these two variables too (Google sign-in then fails at Google's screen), which is how CI runs it. `setup-env` points `.env.local` at the stack and writes `INSTANCE_ID` from the stack's `lifecycle.instance_identity` row; it also generates `INVITATION_HASH_KEY` and `RATE_LIMIT_HASH_KEY` (random, 32 bytes each) when they are missing or still placeholders, and keeps valid ones so stored invitation hashes stay valid. It prints which names it changed, never their values.

4. The application callbacks the stack accepts are declared in `supabase/config.toml` under `additional_redirect_urls`:
   - `http://127.0.0.1:3000/auth/callback`
   - `http://localhost:3000/auth/callback`

   Open the app at one of those two origins. Mail sent by the local stack is caught by Inbucket at `http://127.0.0.1:54324`.

5. `ADMINISTRATOR_EMAIL` and `SEED_ACCOUNT_EMAILS` in `.env.local` create nothing by themselves. Run `npm run seed:accounts -- preauthorize` and each person's first Google sign-in becomes their Account; or issue a code (`npm run seed:accounts -- issue --name "Someone"`) and enter it on `/register` after signing in. Without a Google client (step 1) the stack cannot sign anyone in, which is why the browser tests forge sessions instead (below).

`NOVA3D_DEV_ORIGINS` is a different setting: it lists hostnames (no URLs or ports) that Next.js may serve in development, for example when a phone on the same network loads the dev server. It does not add a sign-in callback. Google sign-in against the local stack works only from the two origins above, so test sign-in from `127.0.0.1` or `localhost`, not from a LAN address.

## Staging and production

Each environment has its own Supabase project, Google OAuth client and callback domain. Hosted-Auth behavior is verified only on staging. `supabase/config.toml` is the reference for the settings below; Story 1.9 pushes it with the Supabase CLI and diffs it against the live settings in CI. Until then, set the same values in the Supabase dashboard.

1. Create a Google OAuth web client for the environment and add `https://<project-ref>.supabase.co/auth/v1/callback` as its authorized redirect URI.
2. In Supabase Auth → Providers, enable Google only (paste the client ID and secret there; the secret stays in Supabase's encrypted provider settings and is never a `NEXT_PUBLIC_*` value) and turn Email and Phone off. Keep Auth → Sign In / Providers → "Allow new users to sign up" on. Match the session time-box (30 days), inactivity timeout (7 days) and OTP expiry (15 minutes) from `config.toml`.
3. In Auth → URL Configuration, set the site URL and add the deployed application's callback, `https://<deployment-domain>/auth/callback`. Do not add any `127.0.0.1`, `localhost` or LAN callback to a hosted project.
4. Set `ADMINISTRATOR_EMAIL`, `INSTANCE_ID`, `INVITATION_HASH_KEY` and `RATE_LIMIT_HASH_KEY` in the deployment's environment variables (see `docs/deployment-setup.md`). The two keys are required: the server does not start, and the Vercel build fails, without them.
5. Enable the Before User Created hook (Story 1.3): in Authentication → Hooks, choose Before User Created, type Postgres function, and select `api.before_user_created`. The migration has already granted the Auth service its `EXECUTE`; `supabase config push` does the same from `config.toml` once Story 1.9 pushes it. Until the hook is on, a hosted project relies on the provider settings above alone.

### Cutting over from the old email list (Josh)

The live-Account check replaces the interim email list at once, so before this build reaches staging every person who is allowed in today must have a pre-authorization or a code, or they are locked out. Do these in order; nothing in the repository applies them to a hosted project.

1. Apply the Story 1.3 migrations, expose `api`, enable the Before User Created hook and set both hashing keys (steps above, and `docs/deployment-setup.md`, Provisioning staging, steps 1 to 4).
2. Seed the addresses the old list held. For staging that is the Administrator, `heimannshua@gmail.com`, as `ADMINISTRATOR_EMAIL`, and the second address Josh uses today, `daniel@orvex.ai`, in `SEED_ACCOUNT_EMAILS` (the exact value the old list held is recorded in `_bmad-output/implementation-artifacts/deferred-work.md`). With both in `.env.staging`, run `node --env-file=.env.staging scripts/seed-accounts.mjs preauthorize --confirm staging`. Any other address that must keep access needs the same, or a named code (`issue --name <label>`).
3. Delete the variable whose name ends in `ALLOWED_EMAILS` (the old interim email list) from the Vercel project (every scope) and from `.env.staging`; nothing reads it now. A preview must hold neither hashing key.
4. Deploy, then open the app with each seeded address through the real Google flow. A fresh sign-in activates the Account in the sign-in callback. A session that was signed in before the deploy has no Account yet and lands on `/register`; opening `/register` makes the proxy consume the pre-authorization for that session (as the callback would), so the person is sent Home without signing out and in. Only the proxy, a route or an action can clear cookies, which a refusal needs, so this lives in the proxy and not in the page. The first sign-in is also the first live check of the hook's accept path (see `deferred-work.md`). If an address lands on `/register` and stays there, it was not seeded or its Google email is not verified.

Until step 4, anyone who was only on the old list sees the registration screen and nothing else; no data is lost.

### Cutting over to session grants (Josh, Story 1.4a)

Story 1.4a ends every existing session: a session with no grant is refused ("Your session ended. Sign in again."), and nothing creates grants for sessions that already exist. Everyone, the Administrator included, signs in again once after the deploy. There is nothing to seed for this; it is the expected behavior, not a fault.

1. **Apply the migration first.** Apply `supabase/migrations/20261010130000_session_grants.sql` to the hosted project **before** the build that needs it deploys (SQL editor, or `supabase db push`). `api` is already exposed from Story 1.3; no new schema, setting or secret is involved. The build's accounts API preflight (`api.preflight`) fails with one line if the migration is missing or a privilege is.
2. **The previous build keeps working with the new migration.** It uses `api.account_status`, `api.consume_preauthorization` and `api.register_with_code`, which are unchanged (`account_status` stays for this reason and for later stories), and the status-change trigger only adds an epoch bump it never reads. So the order is always: migration, then deploy.
3. **Deploy**, then open the app with each seeded address through the real Google flow. Each person sees "Sign in with an invited Google account to continue" or "Your session ended", signs in with Google, and the callback issues the grant of the new session and sends them Home.
4. **The first staging sign-in must succeed before anything goes to production.** It is the first time the callback reads the session after the code exchange on a hosted project, which the local stack cannot exercise because it cannot reach Google. If a person lands on "Sign-in is not available right now" immediately after Google, look for `The session grant could not be issued` or `Sign-in check failed closed` in the deployment's logs (names and messages only; no token, cookie or ID is logged). Do not promote until one real sign-in, sign-out and "sign out my other sessions" have worked on staging.

**Rolling back.** Redeploy the previous build; leave the migration in place (it is harmless to the previous build, and removing it would delete the grant history). The previous build does not look at grants, so a browser that still holds a session from before the cutover is let in again, as is one that signed in during the 1.4a window. Sessions that were ended in the meantime stay ended: a sign-out and "sign out my other sessions" also end the session at Auth, a disabled Account is signed out everywhere, and a changed Google identity is signed out everywhere. Rolling forward again needs the same sign-in once more for any browser that signed in only under the previous build.

### Runbook: a second Google identity locks an Account out (Josh)

**What it looks like.** Someone reports "That Google account cannot be used to sign in" (`not_allowed`) on an account that used to work, or the audit trail has `session.subject_mismatch` events. The cause: Auth links a new Google identity to an existing user with the same verified email, and the gate treats an Auth user with a second Google identity (or a replaced one) as no longer the identity pinned to the Account. Every session of that user is then refused and signed out. That is the gate working: it is what stops a recycled address from using someone else's Account. Do not remove it; remove the extra identity once you have decided it should go.

1. **Find the events.** In the Supabase SQL editor of the environment:

   ```sql
   select id, occurred_at, actor, action, target
     from identity.audit_events
    where action = 'session.subject_mismatch'
    order by id desc limit 20;
   ```

   An event reads `actor = system:authorization`, `action = session.subject_mismatch`, `target = session:<session id>`. It carries no email, token or address. (The same session can only appear once: only the request that revoked the grant writes it.)
2. **Find the Account and the identities.**

   ```sql
   select a.id as account_id, a.user_id, a.role, a.google_subject as pinned_subject
     from identity.session_grants g join identity.accounts a on a.id = g.account_id
    where g.session_id = '<session id from the event>';

   select id, provider_id, created_at, last_sign_in_at, identity_data ->> 'email' as email
     from auth.identities
    where user_id = '<user_id>' and provider = 'google'
    order by created_at;
   ```

   The identity whose `provider_id` equals `pinned_subject` is the Account's own. Any other Google identity is the extra one. If the pinned one is the one that is gone or changed, stop: that is the Administrator re-pin case that Story 1.6 will give a proper path (see `deferred-work.md`), and the Account cannot be repaired from here.
3. **Decide, then remove the extra identity.** If it should not be there (a recycled or unknown address), delete just that row, using its `id` from the second query:

   ```sql
   delete from auth.identities where id = '<identity id>' and user_id = '<user_id>' and provider = 'google' and provider_id <> '<pinned_subject>';
   ```

   If you are not sure whose it is, leave it: the Account stays locked out, which is the safe state.
4. **End every session the extra identity may have opened**, whatever the gate has already refused, by raising the Account's epoch (audited as `account.epoch_raised`; every grant issued before it is refused from then on):

   ```sql
   select * from api.raise_authorization_epoch('<account_id>', 'operator:josh');
   ```

5. **Tell the owner to sign in again.** Their grants were revoked with the reason `subject_mismatch` and stay refused (a revoked grant is final); a new sign-in issues a new one. If the Account still says "not allowed", step 2 shows an identity you did not remove.

### Browser tests

`npm run test:e2e` runs against a production build and the local stack. Local Google sign-in cannot be driven, so `tests/e2e/registration.spec.ts` and `tests/e2e/authorization.spec.ts` forge sessions (`tests/support/forged-session.ts`): it inserts a Google user and an `auth.sessions` row into the local database, signs an HS256 access token with the stack's JWT secret (with `session_id`), and sets the `@supabase/ssr` cookie in the browser. A forged session gets its grant the way the application gives one (`issue_grant`), or none, to test the cutover. The Auth service still validates the token, so the application's real `getUser()`, proxy and authorization checks run; only the Google round trip, and with it the callback's code exchange, is skipped (the callback is covered by unit tests with a fake Auth client). The tests read the keys the server runs with from `.env.local` (or the environment, which wins, as it does for Next.js) and refuse to run unless the server is pointed at the local stack. They issue their own codes under the server's `INVITATION_HASH_KEY`, create their own users and remove them afterwards (audit events are append-only and stay). The registration limiter counts every test browser as one origin, so the registration file runs in order and clears the limiter before each test.

"The database is unreachable" is made true for one user at a time on a **second application server**: `test:e2e` starts the same build on the configured port plus one (never reusing a server that is already there) with `tests/support/fake-network.mjs` preloaded (`NODE_OPTIONS` is appended to, and the preload is given as a file URL). The preload refuses to load unless `playwright.config.ts` has set `NOVA3D_FAKE_NETWORK=playwright` and handed it a private control directory made with `mkdtemp`, removed when the run ends. The preload wraps the server's `fetch`; a test switches an outage on for one user ID by writing a file (`tests/support/fake-network.ts`), and every call to the accounts API for that user, optionally for chosen functions only, then fails as a dropped connection or as a 503. Other users, the first server and the application's own code are untouched, and the preload also counts the calls it sees, which is how a test proves that a page costs one authorization call in the proxy and one in the page.

No OAuth secret belongs in the repository or in a `NEXT_PUBLIC_*` variable. `/api/health` reports public Supabase configuration state, and the login page exposes Google only.
