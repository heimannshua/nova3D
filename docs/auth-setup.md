# Authentication setup

The deployed shell is provider-free mock mode until Supabase is active. This keeps the preview usable without inventing keys or claiming that synthetic projects are persisted.

When the `nova3D` Supabase project is resumed:

1. Create a Google OAuth web client and register the Supabase callback URL shown in Supabase Auth provider settings.
2. Put the client ID and secret in encrypted Vercel production variables as `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`.
3. Enable Google under Supabase Auth providers and set the Vercel production URL as an allowed redirect origin.
4. Create or invite `heimannshua@gmail.com` and `daniel@orvex.ai` through the app's controlled invitation flow. `AUTH_ALLOWED_EMAILS` is a deployment boundary only; it is not a substitute for Supabase Auth records.

No OAuth secret belongs in the repository or in a `NEXT_PUBLIC_*` variable. Until these steps are completed, `/api/health` correctly reports `authConfigured: false`.
