# Authentication setup

The deployed shell is private and uses Google through Supabase Auth. Access is limited to the invited addresses in `AUTH_ALLOWED_EMAILS`; there is no password fallback. `AUTH_ALLOWED_EMAILS` is an interim gate: Story 1.3 replaces it with the live-Account check.

Google is the only sign-in credential: the target is Google on, and email, phone and anonymous sign-in off, in every environment. Sign-ups stay on, because turning them off blocks every first-time Google sign-in; the live-Account check is the gate. `supabase/config.toml` declares these settings and applies them to the local stack (an integration test reads them back from the running stack); nothing yet compares them with a hosted project, so staging and production are set by hand until Story 1.9. The settings: `[auth]`, `[auth.email]`, `[auth.sessions]` (30-day time-box, 7-day inactivity timeout, 15-minute OTP expiry) and `[auth.external.google]`.

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

   The stack starts without these two variables too (Google sign-in then fails at Google's screen), which is how CI runs it. `setup-env` points `.env.local` at the stack and writes `INSTANCE_ID` from the stack's `lifecycle.instance_identity` row; it prints which names it changed, never their values.

4. The application callbacks the stack accepts are declared in `supabase/config.toml` under `additional_redirect_urls`:
   - `http://127.0.0.1:3000/auth/callback`
   - `http://localhost:3000/auth/callback`

   Open the app at one of those two origins. Mail sent by the local stack is caught by Inbucket at `http://127.0.0.1:54324`.

5. `ADMINISTRATOR_EMAIL` and `AUTH_ALLOWED_EMAILS` in `.env.local` do not create Auth users; each person must sign in with the matching Google account.

`NOVA3D_DEV_ORIGINS` is a different setting: it lists hostnames (no URLs or ports) that Next.js may serve in development, for example when a phone on the same network loads the dev server. It does not add a sign-in callback. Google sign-in against the local stack works only from the two origins above, so test sign-in from `127.0.0.1` or `localhost`, not from a LAN address.

## Staging and production

Each environment has its own Supabase project, Google OAuth client and callback domain. Hosted-Auth behavior is verified only on staging. `supabase/config.toml` is the reference for the settings below; Story 1.9 pushes it with the Supabase CLI and diffs it against the live settings in CI. Until then, set the same values in the Supabase dashboard.

1. Create a Google OAuth web client for the environment and add `https://<project-ref>.supabase.co/auth/v1/callback` as its authorized redirect URI.
2. In Supabase Auth → Providers, enable Google only (paste the client ID and secret there; the secret stays in Supabase's encrypted provider settings and is never a `NEXT_PUBLIC_*` value) and turn Email and Phone off. Keep Auth → Sign In / Providers → "Allow new users to sign up" on. Match the session time-box (30 days), inactivity timeout (7 days) and OTP expiry (15 minutes) from `config.toml`.
3. In Auth → URL Configuration, set the site URL and add the deployed application's callback, `https://<deployment-domain>/auth/callback`. Do not add any `127.0.0.1`, `localhost` or LAN callback to a hosted project.
4. Set `ADMINISTRATOR_EMAIL`, `INSTANCE_ID` and `AUTH_ALLOWED_EMAILS` in the deployment's environment variables (see `docs/deployment-setup.md`).

No OAuth secret belongs in the repository or in a `NEXT_PUBLIC_*` variable. `/api/health` reports public Supabase configuration state, and the login page exposes Google only.
