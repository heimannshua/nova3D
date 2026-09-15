# Authentication setup

The deployed shell is private and uses Google through Supabase Auth. Access is limited to the invited addresses in `AUTH_ALLOWED_EMAILS`; there is no password fallback.

1. Create a Google OAuth web client for the `nova3D` Google Cloud project.
2. In Google Cloud, add `https://jtxtxdzqltogxijgksyq.supabase.co/auth/v1/callback` as the OAuth client's authorized redirect URI.
3. In Supabase Auth → Providers → Google, paste the client ID and client secret, then enable Google. Keep the secret in Supabase's encrypted provider settings; it is never a `NEXT_PUBLIC_*` value.
4. In Supabase Auth → URL Configuration, add these application callback URLs:
   - `http://localhost:3000/auth/callback`
   - `http://127.0.0.1:3000/auth/callback`
   - `http://10.103.0.9:3000/auth/callback`
   - `https://nova3d-weld.vercel.app/auth/callback`
5. Set `AUTH_ALLOWED_EMAILS=heimannshua@gmail.com,daniel@orvex.ai` in local and deployment environments. This variable does not create Auth users; each person must sign in with the matching Google account.

No OAuth secret belongs in the repository or in a `NEXT_PUBLIC_*` variable. `/api/health` reports public Supabase configuration state, and the login page exposes Google only.

For local LAN access, `NOVA3D_DEV_ORIGINS` contains hostnames only, not full URLs or ports. Set it in `.env.local` to the current machine address, for example `NOVA3D_DEV_ORIGINS=localhost,127.0.0.1,10.103.0.9`, then restart `npm run dev -- --hostname 0.0.0.0`. Find the current LAN address with `hostname -I`; if it changes, update both this variable and the matching Supabase callback URL.
