# Authentication setup

The deployed shell is private by default. Until Supabase Google Auth is active, the `NOVA_INTERIM_PASSWORD` gate protects the preview with an expiring, HTTP-only session cookie. Treat that password as temporary and rotate or remove it after provider setup.

When the `nova3D` Supabase project is resumed:

1. Create a Google OAuth web client and register the Supabase callback URL shown in Supabase Auth provider settings.
2. Put the client ID and secret in encrypted Vercel production variables as `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`.
3. Enable Google under Supabase Auth providers and set the Vercel production URL as an allowed redirect origin.
4. Create or invite `heimannshua@gmail.com` and `daniel@orvex.ai` in Supabase Auth. Google sign-in accepts only those normalized email addresses through `AUTH_ALLOWED_EMAILS`; the variable is a deployment boundary and does not create Auth records.
5. Remove `NOVA_INTERIM_PASSWORD` from Vercel after both users can sign in with Google. While it exists, it is an intentionally shared temporary access path.

No OAuth secret belongs in the repository or in a `NEXT_PUBLIC_*` variable. Until these steps are completed, `/api/health` correctly reports `authConfigured: false`.
