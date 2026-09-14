# Supabase and Vercel setup

The app uses separate local, staging, and production Supabase resources. Their project IDs and credentials are supplied through the deployment platform and are never committed. Vercel deployments run in `iad1`; configure preview deployments with `APP_ENV=staging` and production deployments with `APP_ENV=production` in Vercel Environment Variables. `vercel.json` intentionally does not hard-code either value, so a preview cannot inherit production settings.

Run `node scripts/setup-env.mjs local` to create an ignored `.env.local` template. Fill in local Supabase CLI credentials, then run `node scripts/check-env.mjs`. The staging and production templates document the same variable contract for Vercel environment settings.

`NEXT_PUBLIC_*` variables are browser-visible. `SUPABASE_SERVICE_ROLE_KEY` is server-only and must only be configured in encrypted Vercel settings or a local ignored file. The check fails closed on missing or placeholder values, environment mismatches, and preview/development deployments that enable paid adapters or disable synthetic data. It does not contact Supabase or Vercel and cannot provision cloud projects.

To resume the existing project through the Supabase Management API, export a personal access token with project-admin write scope and run `SUPABASE_ACCESS_TOKEN=... node scripts/restore-supabase.mjs`. The script defaults to the existing `jtxtxdzqltogxijgksyq` ref, never creates a replacement project, and reports the HTTP result without printing the token.

Google sign-in is intentionally credential-gated. After creating the OAuth web client, paste its ID and secret into Supabase Auth → Providers → Google, add the Supabase callback URL `https://<project-ref>.supabase.co/auth/v1/callback` in Google, and enable Google in Supabase Auth. `AUTH_ALLOWED_EMAILS` records the initial invite boundary for `heimannshua@gmail.com` and `daniel@orvex.ai`; it does not create users by itself. User creation and provider activation require an active Supabase project and its server credentials.

Until Google is active, keep the public deployment behind `NOVA_INTERIM_PASSWORD`. It is stored as a Vercel production secret, creates a 12-hour HTTP-only session, and should be removed after both allowlisted Google accounts can sign in.
