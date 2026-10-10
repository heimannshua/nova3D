# Authentication setup

The deployed shell is private and uses Google through Supabase Auth. Signing in with Google is necessary but never enough: every private page needs an active Account, and an Account exists only for an invited person (a pre-authorized address or a redeemed invitation code). There is no password fallback and no list of allowed addresses in the environment; the interim email-list gate that earlier builds read is gone (Story 1.3 Part B).

Google is the only sign-in credential: the target is Google on, and email, phone and anonymous sign-in off, in every environment. Sign-ups stay on, because turning them off blocks every first-time Google sign-in; the live-Account check is the gate. `supabase/config.toml` declares these settings and applies them to the local stack (an integration test reads them back from the running stack); nothing yet compares them with a hosted project, so staging and production are set by hand until Story 1.9. The settings: `[auth]`, `[auth.email]`, `[auth.sessions]` (30-day time-box, 7-day inactivity timeout, 15-minute OTP expiry) and `[auth.external.google]`.

## How access is decided (Story 1.3)

One resolver, `lib/access.ts`, turns the verified session and the live Account into one of five states, and the proxy, every private page, the sign-in callback and the registration action all ask it. The user always comes from the verified server session (the Auth service is asked, the cookie is not trusted), never from a form field, a header or a claim.

| State | Meaning | What happens |
| --- | --- | --- |
| `signed-out` | no verified session | any private path redirects to `/login?error=not_signed_in` |
| `unregistered` | a verified Google identity with no Account | every path except `/register` redirects to `/register` |
| `active` | an active Account | the page renders; `/register` redirects Home |
| `disabled` | the Account is disabled | signed out (every session of the user is ended and the cookies expired) and sent to `/login?error=account_disabled`; no private content |
| `unavailable` | Auth or the database could not answer, in time or at all | access is denied and the request goes to `/login?error=auth_unavailable`; the session is kept so the person can return when the outage clears |

Any error, a timeout or an answer of an unexpected shape is `unavailable` (or `signed-out` when Auth says there is no session), never a pass. The proxy adds one Auth call and one service-role call to each private request, and the page repeats the check, because the proxy alone is not a boundary; Story 1.4 replaces both with session grants. `/login`, `/auth/callback` and `/api/health` stay public, and `/kit` only while synthetic data is on; `/register` is private (it needs a session) and renders without the navigation shell.

**Registration** (`/register`) is the only place a signed-in identity without an Account can go. It states that the instance operator administers the hosting accounts that hold users' data, takes an invitation code, and works on phone and desktop in English and Hebrew. A wrong, used, revoked or rate-limited code all give the same generic, localized message and a new command ID; the code is never logged and never sent back. If the database cannot be reached the form shows a retry message, keeps the command ID and keeps what was typed, so the retry is the same command. "Use a different Google account" ends this browser's session and returns to sign-in.

**Pre-authorized addresses** become Accounts in the sign-in callback: right after the code exchange it asks Auth who signed in and calls `api.consume_preauthorization` for that user. A pre-authorized address becomes an Administrator or member Account at its first verified Google sign-in (the Administrator's Google subject is pinned then), or, for a session that signed in before the address was seeded, the next time that session opens `/register` (the proxy consumes it there, and a refusal signs the person out the same way); the same address under another Google subject, or a disabled Account, is signed out (`not_allowed`, `account_disabled`); an identity with no pre-authorization goes on to `/register`; a failure of any step signs the person out with `auth_unavailable`, on this browser only (an outage says nothing about their other devices), while a refused or disabled identity is signed out everywhere. Every call to Auth or the database in these paths, and every sign-out, has a deadline (5 seconds): a hung service ends in the same fail-closed redirect, never a hung request. A Server Action refused by the proxy (a form left open after the session ended, the Account was disabled, or the Account was created in another tab) is answered with a redirect only; the form then reloads `/register`, and that page request signs out and shows the right sign-in message or Home.

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

### Browser tests

`npm run test:e2e` runs against a production build and the local stack. Local Google sign-in cannot be driven, so `tests/e2e/registration.spec.ts` forges sessions (`tests/support/forged-session.ts`): it inserts a Google user and an `auth.sessions` row into the local database, signs an HS256 access token with the stack's JWT secret (with `session_id`), and sets the `@supabase/ssr` cookie in the browser. The Auth service still validates the token, so the application's real `getUser()`, proxy and Account checks run; only the Google round trip is skipped. The tests read the keys the server runs with from `.env.local` (or the environment, which wins, as it does for Next.js) and refuse to run unless the server is pointed at the local stack. They issue their own codes under the server's `INVITATION_HASH_KEY`, create their own users and remove them afterwards (audit events are append-only and stay). The registration limiter counts every test browser as one origin, so the file runs in order and clears the limiter before each test.

No OAuth secret belongs in the repository or in a `NEXT_PUBLIC_*` variable. `/api/health` reports public Supabase configuration state, and the login page exposes Google only.
